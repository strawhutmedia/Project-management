// One-shot boot merge (Sept 2026): Slate ended up with two projects for
// the same show — "Don't Be Alone with Jay Kogen" and "Don't Be Alone w/
// Jay Kogen". Ryan confirmed they're the same show and said to pick one
// naming and stick with it. Canonical spelling: the full "with".
//
// Data-preserving merge, not a blind delete: the keeper is whichever of
// the two actually holds the data (more episodes, then more members, then
// the canonical name), every row referencing the duplicate is re-pointed
// at the keeper (FKs discovered from the catalog, so new tables are
// covered automatically; rows that would collide with an identical keeper
// row — e.g. the same member on both — are dropped as true duplicates),
// missing metadata is copied over, the duplicate is deleted, and the
// keeper is renamed to the canonical spelling. Naturally one-shot: once
// the duplicate is gone, the 2-row condition never matches again.

import { pool } from '../db'
import { logError, logInfo } from '../diag'

const CANONICAL = "Don't Be Alone with Jay Kogen"
const VARIANT = "Don't Be Alone w/ Jay Kogen"

type ProjRow = { id: string; name: string; song_count: number; member_count: number }

export async function seedMergeJayKogen(): Promise<void> {
  try {
    const { rows } = await pool.query<ProjRow>(
      `SELECT p.id, p.name,
              (SELECT COUNT(*)::int FROM songs s WHERE s.project_id = p.id) AS song_count,
              (SELECT COUNT(*)::int FROM project_members m WHERE m.project_id = p.id) AS member_count
         FROM projects p
        WHERE p.kind = 'podcast' AND p.name IN ($1, $2)`,
      [CANONICAL, VARIANT],
    )
    if (rows.length !== 2) return // already merged (or renamed) — nothing to do

    const [a, b] = rows
    const keeper =
      a.song_count !== b.song_count ? (a.song_count > b.song_count ? a : b)
      : a.member_count !== b.member_count ? (a.member_count > b.member_count ? a : b)
      : a.name === CANONICAL ? a : b
    const dupe = keeper.id === a.id ? b : a

    // Every table with a FK to projects(id), from the catalog — covers
    // songs, members, plans, outreach, audience, qa_recordings, and any
    // future table without this file needing updates.
    const fks = await pool.query<{ tbl: string; col: string }>(
      `SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
         FROM pg_constraint c
         JOIN unnest(c.conkey) AS k(attnum) ON true
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        WHERE c.confrelid = 'projects'::regclass AND c.contype = 'f'`,
    )

    const moved: Record<string, number> = {}
    const droppedDuplicates: Record<string, number> = {}
    for (const fk of fks.rows) {
      try {
        const r = await pool.query(
          `UPDATE ${fk.tbl} SET ${fk.col} = $1 WHERE ${fk.col} = $2`,
          [keeper.id, dupe.id],
        )
        if (r.rowCount) moved[fk.tbl] = (moved[fk.tbl] ?? 0) + r.rowCount
      } catch {
        // Unique collision (e.g. the same user is a member of both
        // projects). Re-point row by row; a row that still collides is an
        // exact duplicate of something the keeper already has — drop it.
        const ids = await pool.query<{ ctid: string }>(
          `SELECT ctid::text FROM ${fk.tbl} WHERE ${fk.col} = $1`,
          [dupe.id],
        )
        for (const row of ids.rows) {
          try {
            await pool.query(
              `UPDATE ${fk.tbl} SET ${fk.col} = $1 WHERE ctid = $2::tid`,
              [keeper.id, row.ctid],
            )
            moved[fk.tbl] = (moved[fk.tbl] ?? 0) + 1
          } catch {
            await pool.query(`DELETE FROM ${fk.tbl} WHERE ctid = $1::tid`, [row.ctid])
            droppedDuplicates[fk.tbl] = (droppedDuplicates[fk.tbl] ?? 0) + 1
          }
        }
      }
    }

    // Carry over metadata the keeper is missing (cover art, feed, folder).
    await pool.query(
      `UPDATE projects k SET
         subtitle       = COALESCE(k.subtitle, d.subtitle),
         dropbox_folder = COALESCE(k.dropbox_folder, d.dropbox_folder),
         rss_feed_url   = COALESCE(k.rss_feed_url, d.rss_feed_url),
         cover_art_url  = COALESCE(k.cover_art_url, d.cover_art_url)
       FROM projects d WHERE k.id = $1 AND d.id = $2`,
      [keeper.id, dupe.id],
    )

    await pool.query(`DELETE FROM projects WHERE id = $1`, [dupe.id])
    await pool.query(`UPDATE projects SET name = $2 WHERE id = $1`, [keeper.id, CANONICAL])

    logInfo('seed: Jay Kogen duplicate merged', {
      kept: keeper.id,
      keptHadName: keeper.name,
      deleted: dupe.id,
      deletedName: dupe.name,
      moved,
      droppedDuplicates,
    })
  } catch (err) {
    logError('seed: Jay Kogen merge failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

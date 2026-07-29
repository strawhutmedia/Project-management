import { Router } from 'express'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'
import { logError } from '../diag'

// Locations: a nestable list of a film's shooting locations, auto-seeded from
// distinct scenes.location_tag. Users rename them and drag one under another
// as a sub-location. Shooting-day counts are computed live from the schedule.
export const locationsRouter = Router()
locationsRouter.use(requireUser)

async function userCanAccessProject(userId: string, role: string, projectId: string): Promise<boolean> {
  if (role === 'admin') return true
  const { rows } = await pool.query(
    `SELECT 1 FROM projects p
     LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
     WHERE p.id = $2 AND (p.created_by = $1 OR m.user_id IS NOT NULL) LIMIT 1`,
    [userId, projectId],
  )
  return rows.length > 0
}

function tagify(s: string): string {
  return s.toLowerCase().replace(/'/g, '').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80)
}

// Ensure a locations row exists for every distinct scene location_tag, and
// AUTO-ORGANIZE: script headings like "SAWYER'S APARTMENT - LIVING ROOM" get
// their specific set ("Living Room") nested under an auto-created base group
// ("Sawyer's Apartment"), so the user sees a clean per-location breakdown
// without dragging. Only newly-synced rows are auto-nested, so any manual
// re-nesting the user does afterwards is preserved.
export async function ensureLocationRows(projectId: string): Promise<void> {
  // 1. Insert any scene locations not seen before.
  await pool.query(
    `INSERT INTO locations (project_id, tag, name, position)
     SELECT $1, s.location_tag,
            COALESCE(MIN(s.location), s.location_tag),
            (row_number() OVER (ORDER BY MIN(s.script_position)) * 10)::int
       FROM scenes s
      WHERE s.project_id = $1 AND s.location_tag IS NOT NULL AND s.location_tag <> ''
      GROUP BY s.location_tag
     ON CONFLICT (project_id, tag) DO NOTHING`,
    [projectId],
  )
  // 2. Auto-nest any compound location ("SAWYER'S APT - LIVING ROOM") whose
  //    name still carries the " - " — i.e. hasn't been organized yet. We trim
  //    the name to just the sub-part ("Living Room") afterwards, and that trim
  //    is the idempotency marker: a processed or user-un-nested row no longer
  //    contains " - " and is never touched again. Skip already-synthetic
  //    group rows (base_/grp_).
  const compound = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM locations
      WHERE project_id = $1 AND name ~ '\\S\\s+-\\s+\\S'
        AND tag NOT LIKE 'base_%' AND tag NOT LIKE 'grp_%'`,
    [projectId],
  )
  for (const row of compound.rows) {
    const name = row.name ?? ''
    const dashIdx = name.search(/\s+-\s+/)
    if (dashIdx < 0) continue
    const base = name.slice(0, dashIdx).trim()
    const sub = name.replace(/^.*?\s+-\s+/, '').trim()
    if (!base || !sub) continue
    const baseTag = 'base_' + tagify(base)
    const grp = await pool.query<{ id: string }>(
      `INSERT INTO locations (project_id, tag, name, position)
       VALUES ($1, $2, $3, COALESCE((SELECT MAX(position) FROM locations WHERE project_id = $1), 0) + 10)
       ON CONFLICT (project_id, tag) DO UPDATE SET tag = EXCLUDED.tag
       RETURNING id`,
      [projectId, baseTag, base],
    )
    const parentId = grp.rows[0]?.id
    if (!parentId) continue
    await pool.query(
      `UPDATE locations SET parent_id = $2, name = $3 WHERE id = $1`,
      [row.id, parentId, sub],
    )
  }
}

// GET all locations for a project, with per-location scene count + the shoot
// day NUMBERS the location appears on (client unions these for parent roll-ups).
locationsRouter.get('/projects/:projectId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!(await userCanAccessProject(user.id, user.role, projectId))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  try {
    await ensureLocationRows(projectId)
    const locs = await pool.query<{ id: string; tag: string; name: string; parent_id: string | null; position: number }>(
      `SELECT id, tag, name, parent_id, position FROM locations
        WHERE project_id = $1 ORDER BY position ASC, name ASC`,
      [projectId],
    )
    // Per-tag scene count + the distinct scheduled shoot-day numbers.
    const stats = await pool.query<{ location_tag: string; scene_count: string; int_ext: string | null; day_numbers: number[] }>(
      `SELECT s.location_tag,
              COUNT(*)::int AS scene_count,
              (array_agg(DISTINCT s.int_ext) FILTER (WHERE s.int_ext IS NOT NULL))[1] AS int_ext,
              COALESCE(array_agg(DISTINCT sd.number) FILTER (WHERE sd.number IS NOT NULL), '{}') AS day_numbers
         FROM scenes s
         LEFT JOIN shoot_days sd ON sd.id = s.shoot_day_id
        WHERE s.project_id = $1 AND s.location_tag IS NOT NULL AND s.location_tag <> ''
        GROUP BY s.location_tag`,
      [projectId],
    )
    const statByTag = new Map(stats.rows.map((r) => [r.location_tag, r]))
    res.json({
      locations: locs.rows.map((l) => {
        const st = statByTag.get(l.tag)
        const dayNumbers = (st?.day_numbers ?? []).map(Number).sort((a, b) => a - b)
        return {
          id: l.id,
          tag: l.tag,
          name: l.name,
          parentId: l.parent_id,
          position: l.position,
          sceneCount: st ? Number(st.scene_count) : 0,
          intExt: st?.int_ext ?? null,
          dayNumbers,
          isGroup: l.tag.startsWith('grp_') || l.tag.startsWith('base_'),
        }
      }),
    })
  } catch (err) {
    logError('locations GET failed', { error: err instanceof Error ? err.message : String(err), projectId })
    res.status(500).json({ error: 'internal_error' })
  }
})

// Create a grouping location (e.g. "Sawyer's Apt") that has no scenes of its
// own — it exists to hold sub-locations. Gets a synthetic tag so it doesn't
// collide with script-derived locations.
locationsRouter.post('/projects/:projectId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!(await userCanAccessProject(user.id, user.role, projectId))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : 'New location'
  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO locations (project_id, tag, name, position)
       VALUES ($1, 'grp_' || gen_random_uuid()::text, $2,
               COALESCE((SELECT MAX(position) FROM locations WHERE project_id = $1), 0) + 10)
       RETURNING id`,
      [projectId, name],
    )
    res.json({ ok: true, id: rows[0].id })
  } catch (err) {
    logError('locations POST failed', { error: err instanceof Error ? err.message : String(err), projectId })
    res.status(500).json({ error: 'internal_error' })
  }
})

// Delete a location. Only grouping locations (synthetic 'grp_' tag) can be
// deleted — script-derived ones would just reappear on the next sync. Any
// children are lifted back to the top level (FK ON DELETE SET NULL).
locationsRouter.delete('/:id', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const id = req.params.id
  const locRes = await pool.query<{ project_id: string; tag: string }>(
    `SELECT project_id, tag FROM locations WHERE id = $1`, [id],
  )
  const loc = locRes.rows[0]
  if (!loc) { res.status(404).json({ error: 'not_found' }); return }
  if (!(await userCanAccessProject(user.id, user.role, loc.project_id))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  if (!loc.tag.startsWith('grp_') && !loc.tag.startsWith('base_')) {
    res.status(400).json({ error: 'not_deletable', message: 'Only grouping locations can be deleted.' }); return
  }
  await pool.query(`DELETE FROM locations WHERE id = $1`, [id])
  res.json({ ok: true })
})

// Would setting `parentId` as the parent of `id` create a cycle? (i.e. is
// parentId the same node or one of its descendants?)
async function wouldCycle(id: string, parentId: string): Promise<boolean> {
  if (id === parentId) return true
  // Walk up from parentId; if we reach id, nesting id under parentId loops.
  let cursor: string | null = parentId
  const seen = new Set<string>()
  while (cursor) {
    if (cursor === id) return true
    if (seen.has(cursor)) break
    seen.add(cursor)
    const { rows }: { rows: { parent_id: string | null }[] } = await pool.query(
      `SELECT parent_id FROM locations WHERE id = $1`, [cursor],
    )
    cursor = rows[0]?.parent_id ?? null
  }
  return false
}

// PATCH a location: rename, re-nest (parentId), or reorder (position).
locationsRouter.patch('/:id', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const id = req.params.id
  const locRes = await pool.query<{ project_id: string }>(
    `SELECT project_id FROM locations WHERE id = $1`, [id],
  )
  const loc = locRes.rows[0]
  if (!loc) { res.status(404).json({ error: 'not_found' }); return }
  if (!(await userCanAccessProject(user.id, user.role, loc.project_id))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const body = req.body as { parentId?: string | null; name?: string; position?: number }

  if (body.parentId !== undefined) {
    if (body.parentId === null) {
      await pool.query(`UPDATE locations SET parent_id = NULL WHERE id = $1`, [id])
    } else {
      // Parent must exist in the same project and not create a cycle.
      const p = await pool.query<{ project_id: string }>(
        `SELECT project_id FROM locations WHERE id = $1`, [body.parentId],
      )
      if (!p.rows[0] || p.rows[0].project_id !== loc.project_id) {
        res.status(400).json({ error: 'bad_parent' }); return
      }
      if (await wouldCycle(id, body.parentId)) {
        res.status(400).json({ error: 'would_cycle' }); return
      }
      await pool.query(`UPDATE locations SET parent_id = $2 WHERE id = $1`, [id, body.parentId])
    }
  }
  if (typeof body.name === 'string' && body.name.trim()) {
    await pool.query(`UPDATE locations SET name = $2 WHERE id = $1`, [id, body.name.trim()])
  }
  if (typeof body.position === 'number') {
    await pool.query(`UPDATE locations SET position = $2 WHERE id = $1`, [id, Math.round(body.position)])
  }
  res.json({ ok: true })
})

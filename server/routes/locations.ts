import { Router } from 'express'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'
import { logError } from '../diag'

// Locations: a clean, nestable breakdown of a film's shooting locations with
// how many days are shot at each — derived live from the schedule. Scene
// headings are messy ("SAWYER'S APARTMENT - LIVING ROOM - NIGHT", curly vs
// straight apostrophes, time-of-day leakage), so we collapse them to a
// canonical BASE location (e.g. "Sawyer's Apartment") and list the specific
// rooms/sub-areas under it. Only base-level rows are persisted (for renames
// and manual super-grouping); rooms + day counts are computed at query time.
export const locationsRouter = Router()
locationsRouter.use(requireUser)

const TIME_TOKENS = [
  'DAY', 'NIGHT', 'AFTERNOON', 'MORNING', 'EVENING', 'LATER', 'MOMENTS LATER',
  'CONTINUOUS', 'THE NEXT DAY', 'MAGIC HOUR', 'DAWN', 'DUSK', 'SAME', 'SAME TIME',
  'MONTAGE', 'BACK TO PRESENT', 'SUNSET', 'SUNRISE', 'TIME PASSES', 'DAYS LATER',
  'WEEKS LATER', 'INTERCUT', 'SIMULTANEOUS', 'THAT NIGHT', 'LATE NIGHT', 'PRESENT',
]
function isTimeSeg(seg: string): boolean {
  const u = seg.toUpperCase().trim()
  return TIME_TOKENS.some((t) => u === t || u.startsWith(t + ' ') || u.startsWith(t + ',') || u.startsWith(t + ' -'))
}
function stripApostrophes(s: string): string {
  return s.replace(/[‘’'`]/g, '')
}
function segmentsOf(location: string): string[] {
  return location.split(/\s+-\s+/).map((s) => s.trim()).filter(Boolean)
}
// Canonical base = the first segment (the building/place), title-normalized.
function baseNameOf(location: string): string {
  const segs = segmentsOf(location)
  return (segs[0] || location).replace(/\s+/g, ' ').trim()
}
// Stable key that merges apostrophe + case variants so "SAWYER'S APARTMENT"
// (curly) and "SAWYER'S APARTMENT" (straight) become one location.
function baseTagOf(base: string): string {
  const norm = stripApostrophes(base).toLowerCase().replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80)
  return 'base_' + (norm || 'location')
}
// Room/sub-area = segments after the base, with time-of-day dropped. May be ''.
function roomOf(location: string): string {
  return segmentsOf(location).slice(1).filter((s) => !isTimeSeg(s)).join(' - ').trim()
}
function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

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

type SceneRow = { location: string | null; location_tag: string | null; int_ext: string | null; day_number: number | null }

async function loadScenes(projectId: string): Promise<SceneRow[]> {
  const { rows } = await pool.query<SceneRow>(
    `SELECT s.location, s.location_tag, s.int_ext, sd.number AS day_number
       FROM scenes s LEFT JOIN shoot_days sd ON sd.id = s.shoot_day_id
      WHERE s.project_id = $1 AND (s.location IS NOT NULL OR s.location_tag IS NOT NULL)`,
    [projectId],
  )
  return rows
}

type BaseAgg = {
  baseTag: string; baseName: string; intExt: string | null
  days: Set<number>; sceneCount: number
  rooms: Map<string, { days: Set<number>; sceneCount: number }>
}

// Group scenes into canonical base locations with their rooms + shoot days.
function aggregateBases(scenes: SceneRow[]): Map<string, BaseAgg> {
  const bases = new Map<string, BaseAgg>()
  for (const s of scenes) {
    const raw = (s.location || s.location_tag || '').trim()
    if (!raw) continue
    const baseName = titleCase(baseNameOf(raw))
    const baseTag = baseTagOf(baseNameOf(raw))
    let b = bases.get(baseTag)
    if (!b) {
      b = { baseTag, baseName, intExt: s.int_ext, days: new Set(), sceneCount: 0, rooms: new Map() }
      bases.set(baseTag, b)
    }
    b.sceneCount += 1
    if (s.day_number != null) b.days.add(Number(s.day_number))
    if (!b.intExt && s.int_ext) b.intExt = s.int_ext
    const room = roomOf(raw)
    if (room) {
      const key = titleCase(room)
      let r = b.rooms.get(key)
      if (!r) { r = { days: new Set(), sceneCount: 0 }; b.rooms.set(key, r) }
      r.sceneCount += 1
      if (s.day_number != null) r.days.add(Number(s.day_number))
    }
  }
  return bases
}

// Ensure one persisted row per canonical base (preserving user renames /
// nesting), and delete stale rows (old per-scene leaves, vanished bases).
// User-made grouping rows (grp_) are always kept.
async function ensureBaseRows(projectId: string, bases: Map<string, BaseAgg>): Promise<void> {
  let pos = 0
  for (const b of bases.values()) {
    pos += 10
    await pool.query(
      `INSERT INTO locations (project_id, tag, name, position)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, tag) DO NOTHING`,
      [projectId, b.baseTag, b.baseName, pos],
    )
  }
  const keepTags = Array.from(bases.keys())
  await pool.query(
    `DELETE FROM locations
      WHERE project_id = $1 AND tag NOT LIKE 'grp_%' AND tag <> ALL($2::text[])`,
    [projectId, keepTags],
  )
}

// GET the location breakdown: base locations (with rooms + shoot days),
// respecting user renames + manual super-grouping (parentId).
locationsRouter.get('/projects/:projectId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!(await userCanAccessProject(user.id, user.role, projectId))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  try {
    const scenes = await loadScenes(projectId)
    const bases = aggregateBases(scenes)
    await ensureBaseRows(projectId, bases)
    const rows = await pool.query<{ id: string; tag: string; name: string; parent_id: string | null; position: number }>(
      `SELECT id, tag, name, parent_id, position FROM locations WHERE project_id = $1 ORDER BY position ASC, name ASC`,
      [projectId],
    )
    res.json({
      locations: rows.rows.map((l) => {
        const b = bases.get(l.tag)
        const rooms = b
          ? Array.from(b.rooms.entries())
              .map(([name, r]) => ({ name, sceneCount: r.sceneCount, dayNumbers: Array.from(r.days).sort((a, c) => a - c) }))
              .sort((a, c) => c.dayNumbers.length - a.dayNumbers.length || a.name.localeCompare(c.name))
          : []
        return {
          id: l.id,
          tag: l.tag,
          name: l.name,
          parentId: l.parent_id,
          position: l.position,
          sceneCount: b?.sceneCount ?? 0,
          intExt: b?.intExt ?? null,
          dayNumbers: b ? Array.from(b.days).sort((a, c) => a - c) : [],
          rooms,
          isGroup: l.tag.startsWith('grp_'),
        }
      }),
    })
  } catch (err) {
    logError('locations GET failed', { error: err instanceof Error ? err.message : String(err), projectId })
    res.status(500).json({ error: 'internal_error' })
  }
})

// Create a manual super-group (e.g. "The Kendrick Compound") to hold several
// base locations. No scenes of its own.
locationsRouter.post('/projects/:projectId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!(await userCanAccessProject(user.id, user.role, projectId))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : 'New group'
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

// Delete a manual group (grp_). Base locations can't be deleted (they'd just
// reappear on the next sync); its children lift back to the top level.
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
  if (!loc.tag.startsWith('grp_')) {
    res.status(400).json({ error: 'not_deletable', message: 'Only manual groups can be deleted.' }); return
  }
  await pool.query(`DELETE FROM locations WHERE id = $1`, [id])
  res.json({ ok: true })
})

async function wouldCycle(id: string, parentId: string): Promise<boolean> {
  if (id === parentId) return true
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
  const locRes = await pool.query<{ project_id: string }>(`SELECT project_id FROM locations WHERE id = $1`, [id])
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
      const p = await pool.query<{ project_id: string }>(`SELECT project_id FROM locations WHERE id = $1`, [body.parentId])
      if (!p.rows[0] || p.rows[0].project_id !== loc.project_id) { res.status(400).json({ error: 'bad_parent' }); return }
      if (await wouldCycle(id, body.parentId)) { res.status(400).json({ error: 'would_cycle' }); return }
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

// Pre-warm the sync at boot (called from boot_locations_dump).
export async function ensureLocationRows(projectId: string): Promise<void> {
  const scenes = await loadScenes(projectId)
  await ensureBaseRows(projectId, aggregateBases(scenes))
}

// Plain data breakdown for diagnostics: [{ name, days:[], rooms:[{name,days}] }]
export async function debugLocationBreakdown(projectId: string): Promise<Array<{ name: string; days: number[]; sceneCount: number; rooms: Array<{ name: string; days: number[] }> }>> {
  const bases = aggregateBases(await loadScenes(projectId))
  return Array.from(bases.values())
    .map((b) => ({
      name: b.baseName,
      sceneCount: b.sceneCount,
      days: Array.from(b.days).sort((a, c) => a - c),
      rooms: Array.from(b.rooms.entries()).map(([name, r]) => ({ name, days: Array.from(r.days).sort((a, c) => a - c) })),
    }))
    .sort((a, c) => c.days.length - a.days.length || a.name.localeCompare(c.name))
}

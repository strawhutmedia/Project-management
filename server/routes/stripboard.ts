import { Router } from 'express'
import { pool } from '../db'
import { requireUser, blockViewerWrites, type SessionUser } from '../auth'
import { parseFdx } from '../fdx_parser'
import { applyBackInYourArmsSchedule } from '../seeds/back_in_your_arms'

export const stripboardRouter = Router()
stripboardRouter.use(requireUser, blockViewerWrites)

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

// GET full stripboard: scenes + shoot days
stripboardRouter.get('/projects/:projectId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!(await userCanAccessProject(user.id, user.role, projectId))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const days = await pool.query(
    `SELECT id, number, is_break, shoot_date, notes
     FROM shoot_days WHERE project_id = $1 ORDER BY number ASC`,
    [projectId],
  )
  const scenes = await pool.query(
    `SELECT id, number, script_position, slug, int_ext, location, location_tag,
            time_of_day, page, page_eighths, characters, notes,
            shoot_day_id, day_position, location_status
     FROM scenes WHERE project_id = $1
     ORDER BY shoot_day_id NULLS FIRST, day_position ASC, script_position ASC`,
    [projectId],
  )
  res.json({
    days: days.rows.map((d: { id: string; number: number; is_break: boolean; shoot_date: string | null; notes: string | null }) => ({
      id: d.id,
      number: d.number,
      isBreak: d.is_break,
      shootDate: d.shoot_date,
      notes: d.notes,
    })),
    scenes: scenes.rows.map((s: {
      id: string; number: string; script_position: number; slug: string; int_ext: string | null;
      location: string | null; location_tag: string | null; time_of_day: string | null;
      page: number | null; page_eighths: number; characters: string[]; notes: string | null;
      shoot_day_id: string | null; day_position: number; location_status: string;
    }) => ({
      id: s.id,
      number: s.number,
      scriptPosition: s.script_position,
      slug: s.slug,
      intExt: s.int_ext,
      location: s.location,
      locationTag: s.location_tag,
      timeOfDay: s.time_of_day,
      page: s.page,
      pageEighths: s.page_eighths,
      characters: s.characters,
      notes: s.notes,
      shootDayId: s.shoot_day_id,
      dayPosition: s.day_position,
      locationStatus: s.location_status,
    })),
  })
})

// Import a .fdx file. Replaces all scenes for the project (idempotent on
// scene number — preserves shoot_day_id/day_position if scene number matches).
stripboardRouter.post('/projects/:projectId/import-fdx', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (user.role !== 'admin') {
    const access = await userCanAccessProject(user.id, user.role, projectId)
    if (!access) { res.status(403).json({ error: 'forbidden' }); return }
  }
  const xml = typeof req.body?.xml === 'string' ? req.body.xml : null
  if (!xml || xml.length < 100) {
    res.status(400).json({ error: 'xml_required' }); return
  }
  // Require the content to look like a Final Draft document. FD files always
  // start with the XML declaration and have a top-level <FinalDraft DocumentType="Script"...>
  // tag. Anything else is rejected with a clear error.
  const head = xml.slice(0, 2000)
  if (!head.includes('<?xml') || !head.includes('FinalDraft')) {
    res.status(400).json({ error: 'not_fdx', message: 'File does not look like a Final Draft (.fdx) document.' })
    return
  }
  let parsed: ReturnType<typeof parseFdx>
  try {
    parsed = parseFdx(xml)
  } catch (err) {
    res.status(400).json({ error: 'parse_failed', message: err instanceof Error ? err.message : String(err) }); return
  }
  if (parsed.length === 0) {
    res.status(400).json({ error: 'no_scenes', message: 'No numbered scene headings found. Make sure the script has scene numbers turned on in Final Draft.' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Preserve existing assignments by scene number
    const existing = await client.query(
      `SELECT number, shoot_day_id, day_position, location_status, notes
       FROM scenes WHERE project_id = $1`,
      [projectId],
    )
    const existingByNumber = new Map<string, { shoot_day_id: string | null; day_position: number; location_status: string; notes: string | null }>()
    for (const row of existing.rows) {
      existingByNumber.set(row.number, row)
    }
    await client.query(`DELETE FROM scenes WHERE project_id = $1`, [projectId])
    for (const sc of parsed) {
      const prior = existingByNumber.get(sc.number)
      await client.query(
        `INSERT INTO scenes
           (project_id, number, script_position, slug, int_ext, location, location_tag,
            time_of_day, page, page_eighths, characters, notes,
            shoot_day_id, day_position, location_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          projectId,
          sc.number,
          sc.scriptPosition,
          sc.slug,
          sc.intExt,
          sc.location,
          sc.locationTag,
          sc.timeOfDay,
          sc.page,
          sc.pageEighths,
          JSON.stringify(sc.characters),
          prior?.notes ?? null,
          prior?.shoot_day_id ?? null,
          prior?.day_position ?? 0,
          prior?.location_status ?? 'unset',
        ],
      )
    }
    await client.query('COMMIT')

    // If this is the BIYA project, auto-apply Ryan's StudioBinder
    // schedule. No button click required.
    let autoApplied: { assigned: number; missing: string[] } | null = null
    const proj = await pool.query<{ name: string }>(
      `SELECT name FROM projects WHERE id = $1`,
      [projectId],
    )
    if (proj.rows[0]?.name === 'Back in Your Arms') {
      autoApplied = await applyBackInYourArmsSchedule(projectId)
    }
    res.json({ ok: true, count: parsed.length, autoApplied })
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  } finally {
    client.release()
  }
})

// Create a shoot day (or break)
stripboardRouter.post('/projects/:projectId/days', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!(await userCanAccessProject(user.id, user.role, projectId))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const number = Number(req.body?.number)
  const isBreak = Boolean(req.body?.isBreak)
  const shootDate = typeof req.body?.shootDate === 'string' ? req.body.shootDate : null
  if (!Number.isFinite(number) || number < 1) {
    res.status(400).json({ error: 'invalid_number' }); return
  }
  const { rows } = await pool.query(
    `INSERT INTO shoot_days (project_id, number, is_break, shoot_date)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_id, number) DO UPDATE SET is_break = EXCLUDED.is_break, shoot_date = EXCLUDED.shoot_date
     RETURNING id`,
    [projectId, number, isBreak, shootDate],
  )
  res.json({ id: rows[0].id })
})

// Move a scene to a different shoot day or reorder within day
stripboardRouter.patch('/scenes/:sceneId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const sceneId = req.params.sceneId
  const access = await pool.query(
    `SELECT s.project_id FROM scenes s
     JOIN projects p ON p.id = s.project_id
     LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
     WHERE s.id = $2 AND ($3 = 'admin' OR p.created_by = $1 OR m.user_id IS NOT NULL)`,
    [user.id, sceneId, user.role],
  )
  if (access.rows.length === 0) { res.status(403).json({ error: 'forbidden' }); return }
  const { shootDayId, dayPosition, locationStatus, notes } = req.body ?? {}
  const updates: string[] = []
  const values: unknown[] = []
  let i = 1
  if ('shootDayId' in (req.body ?? {})) {
    if (shootDayId === null) updates.push(`shoot_day_id = NULL`)
    else if (typeof shootDayId === 'string') { updates.push(`shoot_day_id = $${i++}`); values.push(shootDayId) }
  }
  if (typeof dayPosition === 'number') { updates.push(`day_position = $${i++}`); values.push(dayPosition) }
  if (typeof locationStatus === 'string') { updates.push(`location_status = $${i++}`); values.push(locationStatus) }
  if (typeof notes === 'string') { updates.push(`notes = $${i++}`); values.push(notes) }
  if (updates.length === 0) { res.status(400).json({ error: 'no_fields' }); return }
  values.push(sceneId)
  await pool.query(`UPDATE scenes SET ${updates.join(', ')} WHERE id = $${i}`, values)
  res.json({ ok: true })
})

// Apply Ryan's pre-seeded "Back in Your Arms" StudioBinder schedule. Maps
// every scene number to its scheduled shoot day. Run this after uploading
// the .fdx for the BIYA project.
stripboardRouter.post('/projects/:projectId/apply-biya-schedule', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!(await userCanAccessProject(user.id, user.role, projectId))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const proj = await pool.query<{ name: string }>(
    `SELECT name FROM projects WHERE id = $1`,
    [projectId],
  )
  if (proj.rows.length === 0 || proj.rows[0].name !== 'Back in Your Arms') {
    res.status(400).json({ error: 'wrong_project', message: 'This action is only for the Back in Your Arms project.' })
    return
  }
  const result = await applyBackInYourArmsSchedule(projectId)
  res.json({ ok: true, ...result })
})

import { Router } from 'express'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'
import { assertWriter } from '../permissions'
import { parseFdx } from '../fdx_parser'
import { applyBackInYourArmsSchedule } from '../seeds/back_in_your_arms'
import { runSceneBreakdown, runProjectBreakdown } from '../scene_breakdown'
import { publishProjectScript } from '../script_publisher'
import { logError, logInfo } from '../diag'

export const stripboardRouter = Router()
stripboardRouter.use(requireUser)

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
    `SELECT s.id, s.number, s.script_position, s.slug, s.int_ext, s.location, s.location_tag,
            s.time_of_day, s.page, s.page_eighths, s.characters, s.notes,
            s.action_text, s.breakdown_run_at,
            s.shoot_day_id, s.day_position, s.location_status,
            COALESCE((
              SELECT SUM(li.amt * li.x * li.rate)
              FROM budget_line_items li
              WHERE li.scene_id = s.id
            ), 0) AS scene_budget_total,
            COALESCE((
              SELECT COUNT(*)
              FROM budget_line_items li
              WHERE li.scene_id = s.id
            ), 0) AS scene_budget_item_count
     FROM scenes s
     WHERE s.project_id = $1
     ORDER BY s.shoot_day_id NULLS FIRST, s.day_position ASC, s.script_position ASC`,
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
      action_text: string | null; breakdown_run_at: string | null;
      shoot_day_id: string | null; day_position: number; location_status: string;
      scene_budget_total: string | number; scene_budget_item_count: string | number;
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
      actionText: s.action_text,
      breakdownRunAt: s.breakdown_run_at,
      shootDayId: s.shoot_day_id,
      dayPosition: s.day_position,
      locationStatus: s.location_status,
      budgetTotal: Number(s.scene_budget_total) || 0,
      budgetItemCount: Number(s.scene_budget_item_count) || 0,
    })),
  })
})

// Import a .fdx file. Replaces all scenes for the project (idempotent on
// scene number — preserves shoot_day_id/day_position if scene number matches).
stripboardRouter.post('/projects/:projectId/import-fdx', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!await assertWriter(user, projectId, res)) return
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
            time_of_day, page, page_eighths, characters, notes, action_text,
            shoot_day_id, day_position, location_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
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
          sc.actionText || null,
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

    // Publish the parsed script to the status branch immediately so Claude
    // can read it during a chat session — even before the cost breakdown
    // finishes. Fire-and-forget; failure is logged but doesn't block the
    // response.
    void publishProjectScript(projectId)

    // Kick off the Claude-powered cost breakdown for every scene with action
    // text. Runs in the background — the .fdx import response returns
    // immediately so the producer isn't blocked on a multi-minute call.
    // When it finishes, re-publish to status so the snapshot includes the
    // newly-suggested cost items.
    void runProjectBreakdown(projectId, user.id)
      .then(() => publishProjectScript(projectId))
      .catch((err) => {
        logError('scene breakdown background run failed', {
          projectId,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    logInfo('fdx imported, breakdown kicked off', { projectId, count: parsed.length })

    res.json({ ok: true, count: parsed.length, autoApplied, breakdownStarted: true })
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
  if (!await assertWriter(user, projectId, res)) return
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

// Run (or re-run) the Claude-powered cost breakdown for a single scene.
// Reads the cached action_text from the .fdx, asks Claude to list everything
// that might cost money (props, wardrobe, location, vehicles, SFX, VFX,
// animals, weapons, extras, day-player roles, picture cars, special equipment),
// then inserts each as a zero-cost budget_line_items row attached to the scene.
// The producer fills in the dollar amounts.
stripboardRouter.post('/scenes/:sceneId/breakdown', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const sceneId = req.params.sceneId
  const access = await pool.query<{ project_id: string }>(
    `SELECT s.project_id FROM scenes s
     JOIN projects p ON p.id = s.project_id
     LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
     WHERE s.id = $2 AND ($3 = 'admin' OR p.created_by = $1 OR m.user_id IS NOT NULL)`,
    [user.id, sceneId, user.role],
  )
  if (access.rows.length === 0) { res.status(403).json({ error: 'forbidden' }); return }
  const projectId = access.rows[0].project_id
  try {
    const result = await runSceneBreakdown(sceneId, user.id)
    // Re-publish so the status snapshot reflects the new items.
    void publishProjectScript(projectId)
    res.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logError('scene breakdown failed', { sceneId, projectId, error: msg })
    res.status(502).json({ error: msg.slice(0, 400) })
  }
})

// Re-analyze every scene already in the database, without requiring a
// fresh .fdx upload. Useful when the breakdown prompt or model changes,
// or when the producer wants a second pass with broader coverage. Wipes
// the existing zero-cost auto-suggestions per-scene (priced rows are
// preserved) and re-runs Claude on each scene with action text. Runs in
// the background — the request returns immediately. Status branch
// republishes when finished.
stripboardRouter.post('/projects/:projectId/reanalyze-all', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!await assertWriter(user, projectId, res)) return
  const sceneCount = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM scenes WHERE project_id = $1 AND action_text IS NOT NULL`,
    [projectId],
  )
  const n = Number(sceneCount.rows[0]?.count ?? 0)
  if (n === 0) {
    res.status(400).json({ error: 'no_scenes', message: 'No scenes with action text. Re-import the .fdx first.' })
    return
  }
  void runProjectBreakdown(projectId, user.id, { force: true })
    .then(() => publishProjectScript(projectId))
    .catch((err) => {
      logError('reanalyze-all background run failed', {
        projectId,
        error: err instanceof Error ? err.message : String(err),
      })
    })
  res.json({ ok: true, sceneCount: n, started: true })
})

// Force a re-publish of the parsed script to the status branch. Normally
// fires automatically — this endpoint exists so a backfill / admin
// debugging call can trigger it without re-importing the .fdx.
stripboardRouter.post('/projects/:projectId/publish-script', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!await assertWriter(user, projectId, res)) return
  const r = await publishProjectScript(projectId)
  if (!r.ok) {
    res.status(502).json({ error: r.error || 'failed' }); return
  }
  res.json({ ok: true, path: r.path })
})

// Apply Ryan's pre-seeded "Back in Your Arms" StudioBinder schedule. Maps
// every scene number to its scheduled shoot day. Run this after uploading
// the .fdx for the BIYA project.
stripboardRouter.post('/projects/:projectId/apply-biya-schedule', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!await assertWriter(user, projectId, res)) return
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

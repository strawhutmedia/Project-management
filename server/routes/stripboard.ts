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
            s.action_text, s.breakdown_run_at, s.producer_note_suggestion,
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
      producer_note_suggestion: string | null;
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
      producerNoteSuggestion: s.producer_note_suggestion,
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
  const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName.slice(0, 200) : null
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
  // Look up the previous upload (before we insert the new one) so we can
  // diff against it. Then run the upsert by scene number, which preserves
  // scene UUIDs — critical so budget items keep their scene_id link
  // across re-uploads.
  const prevUploadRes = await pool.query<{ id: string; xml: string }>(
    `SELECT id, xml FROM project_script_uploads
     WHERE project_id = $1 ORDER BY uploaded_at DESC LIMIT 1`,
    [projectId],
  )
  let diffSummary: import('../script_diff').ScriptDiff | null = null
  let diffAgainstId: string | null = null
  if (prevUploadRes.rows.length > 0) {
    try {
      const prevParsed = parseFdx(prevUploadRes.rows[0].xml)
      const { diffScripts } = await import('../script_diff')
      diffSummary = diffScripts(prevParsed, parsed)
      diffAgainstId = prevUploadRes.rows[0].id
    } catch (err) {
      logError('diffing previous upload failed, continuing without diff', {
        projectId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const client = await pool.connect()
  let changedSceneIds: string[] = []
  let addedSceneIds: string[] = []
  try {
    await client.query('BEGIN')
    // Archive the raw XML so we can re-parse later when the parser
    // evolves and never ask the producer to re-upload.
    await client.query(
      `INSERT INTO project_script_uploads
         (project_id, uploaded_by, file_name, byte_size, scene_count, xml, diff_against_id, diff_summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        projectId, user.id, fileName, xml.length, parsed.length, xml,
        diffAgainstId, diffSummary ? JSON.stringify(diffSummary) : null,
      ],
    )

    // Upsert scenes by number. UUIDs stay the same for unchanged scenes,
    // so budget_line_items.scene_id keeps pointing at the right rows.
    // Build a set of NEW scene numbers so we can DELETE removed scenes
    // at the end.
    const newNumbers = new Set(parsed.map((p) => p.number))
    const existingRes = await client.query<{ id: string; number: string; action_text: string | null }>(
      `SELECT id, number, action_text FROM scenes WHERE project_id = $1`,
      [projectId],
    )
    const existingByNumber = new Map<string, { id: string; actionText: string | null }>()
    for (const row of existingRes.rows) {
      existingByNumber.set(row.number, { id: row.id, actionText: row.action_text })
    }

    for (const sc of parsed) {
      const prior = existingByNumber.get(sc.number)
      if (prior) {
        // UPDATE in place — preserves UUID, schedule, notes, location
        // status. Reset breakdown_run_at only if action text actually
        // changed, so re-uploading the same file doesn't blow away
        // your breakdown.
        const actionChanged = (prior.actionText || '') !== (sc.actionText || '')
        await client.query(
          `UPDATE scenes SET
             script_position = $2,
             slug = $3,
             int_ext = $4,
             location = $5,
             location_tag = $6,
             time_of_day = $7,
             page = $8,
             page_eighths = $9,
             characters = $10,
             action_text = $11,
             breakdown_run_at = CASE WHEN $12::boolean THEN NULL ELSE breakdown_run_at END
           WHERE id = $1`,
          [
            prior.id, sc.scriptPosition, sc.slug, sc.intExt, sc.location, sc.locationTag,
            sc.timeOfDay, sc.page, sc.pageEighths, JSON.stringify(sc.characters),
            sc.actionText || null, actionChanged,
          ],
        )
        if (actionChanged) changedSceneIds.push(prior.id)
      } else {
        const ins = await client.query<{ id: string }>(
          `INSERT INTO scenes
             (project_id, number, script_position, slug, int_ext, location, location_tag,
              time_of_day, page, page_eighths, characters, action_text)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           RETURNING id`,
          [
            projectId, sc.number, sc.scriptPosition, sc.slug, sc.intExt, sc.location,
            sc.locationTag, sc.timeOfDay, sc.page, sc.pageEighths,
            JSON.stringify(sc.characters), sc.actionText || null,
          ],
        )
        addedSceneIds.push(ins.rows[0].id)
      }
    }
    // Scenes removed in the new version — keep their budget items but
    // null the scene_id (handled by ON DELETE SET NULL on the FK).
    await client.query(
      `DELETE FROM scenes WHERE project_id = $1 AND number <> ALL($2::text[])`,
      [projectId, Array.from(newNumbers)],
    )
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

    // Kick off the Claude-powered cost breakdown. For the first upload
    // (no previous archive) run across every scene. For subsequent
    // uploads, only re-analyze scenes that actually changed or are new —
    // saves cost and preserves your priced rows on unchanged scenes.
    // When done, re-publish to status so the snapshot includes the
    // newly-suggested cost items.
    const selectiveRun = async () => {
      if (!diffSummary) {
        await runProjectBreakdown(projectId, user.id)
        return
      }
      const targets = [...new Set([...addedSceneIds, ...changedSceneIds])]
      for (const sid of targets) {
        try {
          await runSceneBreakdown(sid, user.id)
        } catch (err) {
          logError('selective scene breakdown failed', { sceneId: sid, error: err instanceof Error ? err.message : String(err) })
        }
      }
    }
    void selectiveRun()
      .then(() => publishProjectScript(projectId))
      .catch((err) => {
        logError('scene breakdown background run failed', {
          projectId,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    logInfo('fdx imported, breakdown kicked off', {
      projectId,
      count: parsed.length,
      added: addedSceneIds.length,
      changed: changedSceneIds.length,
      hasDiff: !!diffSummary,
    })

    res.json({
      ok: true,
      count: parsed.length,
      autoApplied,
      breakdownStarted: true,
      diff: diffSummary
        ? {
            added: diffSummary.added.length,
            removed: diffSummary.removed.length,
            changed: diffSummary.changed.length,
            unchanged: diffSummary.unchanged,
          }
        : null,
    })
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
  if ('producerNoteSuggestion' in (req.body ?? {})) {
    const next = req.body.producerNoteSuggestion
    if (next === null) updates.push(`producer_note_suggestion = NULL`)
    else if (typeof next === 'string') { updates.push(`producer_note_suggestion = $${i++}`); values.push(next) }
  }
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

// Breakdown progress for the live banner. Lets the UI poll while
// Claude is grinding through scenes after an upload, so the producer
// can see "47 / 157 analyzed" instead of staring at a static screen.
stripboardRouter.get('/projects/:projectId/breakdown-progress', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!(await userCanAccessProject(user.id, user.role, projectId))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const { rows } = await pool.query<{
    total_scenes: string;
    with_action_text: string;
    with_breakdown: string;
    last_run_at: string | null;
  }>(
    `SELECT
       COUNT(*)::text AS total_scenes,
       COUNT(*) FILTER (WHERE action_text IS NOT NULL AND length(action_text) >= 30)::text AS with_action_text,
       COUNT(*) FILTER (WHERE breakdown_run_at IS NOT NULL)::text AS with_breakdown,
       MAX(breakdown_run_at)::text AS last_run_at
     FROM scenes WHERE project_id = $1`,
    [projectId],
  )
  const r = rows[0]
  const totalScenes = Number(r.total_scenes)
  const withActionText = Number(r.with_action_text)
  const withBreakdown = Number(r.with_breakdown)
  // "Running" if there's action text we haven't broken down yet AND we
  // saw activity in the last 5 minutes. Stale (no recent activity)
  // means the user has unbroken-down scenes but no current run.
  const lastRunAt = r.last_run_at ? new Date(r.last_run_at).getTime() : 0
  const fiveMinAgo = Date.now() - 5 * 60 * 1000
  const isRunning = withBreakdown < withActionText && lastRunAt > fiveMinAgo
  const isStale = withBreakdown < withActionText && lastRunAt <= fiveMinAgo
  res.json({
    totalScenes,
    withActionText,
    withBreakdown,
    isRunning,
    isStale,
    lastRunAt: r.last_run_at,
  })
})

// List all schedule snapshots for a project. Most recent first.
stripboardRouter.get('/projects/:projectId/schedule-snapshots', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!(await userCanAccessProject(user.id, user.role, projectId))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const { rows } = await pool.query<{
    id: string; name: string; description: string | null; created_at: string;
    scene_count: number; shoot_day_count: number;
  }>(
    `SELECT id, name, description, created_at, scene_count, shoot_day_count
     FROM schedule_snapshots WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId],
  )
  res.json({
    snapshots: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      createdAt: r.created_at,
      sceneCount: r.scene_count,
      shootDayCount: r.shoot_day_count,
    })),
  })
})

// Save the current stripboard state as a named snapshot.
stripboardRouter.post('/projects/:projectId/schedule-snapshots', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!await assertWriter(user, projectId, res)) return
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : ''
  const description = typeof req.body?.description === 'string' ? req.body.description.slice(0, 500) : null
  if (!name) { res.status(400).json({ error: 'name_required' }); return }

  const daysRes = await pool.query<{ number: number; is_break: boolean; shoot_date: string | null; notes: string | null }>(
    `SELECT number, is_break, shoot_date, notes FROM shoot_days WHERE project_id = $1 ORDER BY number`,
    [projectId],
  )
  const scenesRes = await pool.query<{
    number: string; shoot_day_number: number | null; day_position: number; location_status: string; notes: string | null;
  }>(
    `SELECT s.number, sd.number AS shoot_day_number, s.day_position, s.location_status, s.notes
     FROM scenes s LEFT JOIN shoot_days sd ON sd.id = s.shoot_day_id
     WHERE s.project_id = $1 ORDER BY s.script_position`,
    [projectId],
  )
  const payload = {
    shootDays: daysRes.rows,
    scenes: scenesRes.rows.map((r) => ({
      number: r.number,
      shootDayNumber: r.shoot_day_number,
      dayPosition: r.day_position,
      locationStatus: r.location_status,
      notes: r.notes,
    })),
  }
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO schedule_snapshots
       (project_id, name, description, created_by, scene_count, shoot_day_count, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [projectId, name, description, user.id, scenesRes.rows.length, daysRes.rows.length, JSON.stringify(payload)],
  )
  logInfo('schedule snapshot saved', { projectId, snapshotId: rows[0].id, name })
  res.json({ ok: true, id: rows[0].id })
})

// Restore a schedule snapshot — re-creates shoot days and re-assigns
// every scene to where it was. Matches by scene number so works even
// across re-imports.
stripboardRouter.post('/snapshots/:snapshotId/restore', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const snapshotId = req.params.snapshotId
  const snap = await pool.query<{ project_id: string; name: string; payload: unknown }>(
    `SELECT project_id, name, payload FROM schedule_snapshots WHERE id = $1`,
    [snapshotId],
  )
  if (snap.rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!await assertWriter(user, snap.rows[0].project_id, res)) return
  const projectId = snap.rows[0].project_id
  const payload = snap.rows[0].payload as {
    shootDays: Array<{ number: number; is_break: boolean; shoot_date: string | null; notes: string | null }>
    scenes: Array<{ number: string; shootDayNumber: number | null; dayPosition: number; locationStatus: string; notes: string | null }>
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Wipe existing shoot days. Scenes get unassigned via ON DELETE SET NULL.
    await client.query(`DELETE FROM shoot_days WHERE project_id = $1`, [projectId])
    const dayIdByNumber = new Map<number, string>()
    for (const d of payload.shootDays) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO shoot_days (project_id, number, is_break, shoot_date, notes)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [projectId, d.number, d.is_break, d.shoot_date, d.notes],
      )
      dayIdByNumber.set(d.number, rows[0].id)
    }
    for (const sc of payload.scenes) {
      const dayId = sc.shootDayNumber != null ? dayIdByNumber.get(sc.shootDayNumber) ?? null : null
      await client.query(
        `UPDATE scenes SET shoot_day_id = $2, day_position = $3, location_status = $4
         WHERE project_id = $1 AND number = $5`,
        [projectId, dayId, sc.dayPosition, sc.locationStatus, sc.number],
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); return
  } finally {
    client.release()
  }

  void publishProjectScript(projectId)
  logInfo('schedule snapshot restored', { projectId, snapshotId, name: snap.rows[0].name })
  res.json({ ok: true })
})

// Delete a saved snapshot.
stripboardRouter.delete('/snapshots/:snapshotId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const snapshotId = req.params.snapshotId
  const snap = await pool.query<{ project_id: string }>(
    `SELECT project_id FROM schedule_snapshots WHERE id = $1`, [snapshotId],
  )
  if (snap.rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!await assertWriter(user, snap.rows[0].project_id, res)) return
  await pool.query(`DELETE FROM schedule_snapshots WHERE id = $1`, [snapshotId])
  res.json({ ok: true })
})

// Return the diff JSON for the most recent upload — what changed
// compared to the previous archived version. Null when this is the
// first upload (nothing to compare to) or when the previous parse
// failed.
stripboardRouter.get('/projects/:projectId/script-diff', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!(await userCanAccessProject(user.id, user.role, projectId))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const { rows } = await pool.query<{
    id: string; diff_summary: unknown; diff_against_id: string | null;
    uploaded_at: string; file_name: string | null; diff_reviewed_at: string | null;
  }>(
    `SELECT id, diff_summary, diff_against_id, uploaded_at, file_name, diff_reviewed_at
     FROM project_script_uploads
     WHERE project_id = $1 ORDER BY uploaded_at DESC LIMIT 1`,
    [projectId],
  )
  if (rows.length === 0 || !rows[0].diff_summary) {
    res.json({ diff: null }); return
  }
  // Compute scheduled / budget impact for removed scenes by looking
  // up the orphaned budget items (scene_id IS NULL after this upload
  // but description mentions the removed scene). Simpler: just count
  // line items that lost their scene_id during this transaction. We
  // don't track that yet, so for now leave budgetImpact off.
  res.json({
    diff: rows[0].diff_summary,
    uploadId: rows[0].id,
    uploadedAt: rows[0].uploaded_at,
    fileName: rows[0].file_name,
    reviewedAt: rows[0].diff_reviewed_at,
  })
})

// Mark the latest diff as reviewed so the changelog card collapses
// or disappears in the UI.
stripboardRouter.post('/projects/:projectId/script-diff/mark-reviewed', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!await assertWriter(user, projectId, res)) return
  await pool.query(
    `UPDATE project_script_uploads
     SET diff_reviewed_at = now()
     WHERE id = (
       SELECT id FROM project_script_uploads
       WHERE project_id = $1 ORDER BY uploaded_at DESC LIMIT 1
     )`,
    [projectId],
  )
  res.json({ ok: true })
})

// Get the archive metadata (last upload's file name + bytes + date) so
// the UI can show "📜 Source script: BIYA_v12.fdx · uploaded Jun 1 ·
// 480 KB" with a [Re-parse] / [Download] action.
stripboardRouter.get('/projects/:projectId/script-archive', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!(await userCanAccessProject(user.id, user.role, projectId))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const { rows } = await pool.query<{
    id: string; file_name: string | null; byte_size: number; scene_count: number; uploaded_at: string;
  }>(
    `SELECT id, file_name, byte_size, scene_count, uploaded_at
     FROM project_script_uploads WHERE project_id = $1 ORDER BY uploaded_at DESC LIMIT 1`,
    [projectId],
  )
  if (rows.length === 0) { res.json({ archive: null }); return }
  const a = rows[0]
  res.json({
    archive: {
      id: a.id,
      fileName: a.file_name,
      byteSize: a.byte_size,
      sceneCount: a.scene_count,
      uploadedAt: a.uploaded_at,
    },
  })
})

// Download the archived XML as a .fdx file. Lets the producer recover
// the original even if their copy is gone.
stripboardRouter.get('/projects/:projectId/script-archive/download', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!(await userCanAccessProject(user.id, user.role, projectId))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const { rows } = await pool.query<{ xml: string; file_name: string | null }>(
    `SELECT xml, file_name FROM project_script_uploads
     WHERE project_id = $1 ORDER BY uploaded_at DESC LIMIT 1`,
    [projectId],
  )
  if (rows.length === 0) { res.status(404).json({ error: 'no_archive' }); return }
  const fileName = rows[0].file_name || 'script.fdx'
  res.setHeader('Content-Type', 'application/xml')
  res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/"/g, '')}"`)
  res.send(rows[0].xml)
})

// Re-parse the most recent archived .fdx for this project. Same as
// uploading it again but uses the XML we already have on file, so it
// works from mobile / anywhere without the original file. Picks up
// improvements to the parser since the last run (e.g. action text
// extraction shipped after BIYA was first uploaded).
stripboardRouter.post('/projects/:projectId/reparse-archived', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!await assertWriter(user, projectId, res)) return
  const archive = await pool.query<{ id: string; xml: string; file_name: string | null; uploaded_at: string }>(
    `SELECT id, xml, file_name, uploaded_at FROM project_script_uploads
     WHERE project_id = $1 ORDER BY uploaded_at DESC LIMIT 1`,
    [projectId],
  )
  if (archive.rows.length === 0) {
    res.status(404).json({
      error: 'no_archive',
      message: 'No archived .fdx for this project. Upload one now and we\'ll keep it on file from here on.',
    })
    return
  }
  const xml = archive.rows[0].xml
  let parsed: ReturnType<typeof parseFdx>
  try {
    parsed = parseFdx(xml)
  } catch (err) {
    res.status(500).json({ error: 'parse_failed', message: err instanceof Error ? err.message : String(err) }); return
  }
  if (parsed.length === 0) {
    res.status(500).json({ error: 'no_scenes', message: 'Archive parsed to zero scenes — unexpected.' }); return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const newNumbers = new Set(parsed.map((p) => p.number))
    const existingRes = await client.query<{ id: string; number: string }>(
      `SELECT id, number FROM scenes WHERE project_id = $1`,
      [projectId],
    )
    const existingById = new Map<string, string>() // number → id
    for (const row of existingRes.rows) {
      existingById.set(row.number, row.id)
    }
    for (const sc of parsed) {
      const priorId = existingById.get(sc.number)
      if (priorId) {
        await client.query(
          `UPDATE scenes SET
             script_position = $2,
             slug = $3,
             int_ext = $4,
             location = $5,
             location_tag = $6,
             time_of_day = $7,
             page = $8,
             page_eighths = $9,
             characters = $10,
             action_text = $11,
             breakdown_run_at = NULL
           WHERE id = $1`,
          [
            priorId, sc.scriptPosition, sc.slug, sc.intExt, sc.location, sc.locationTag,
            sc.timeOfDay, sc.page, sc.pageEighths, JSON.stringify(sc.characters),
            sc.actionText || null,
          ],
        )
      } else {
        await client.query(
          `INSERT INTO scenes
             (project_id, number, script_position, slug, int_ext, location, location_tag,
              time_of_day, page, page_eighths, characters, action_text)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            projectId, sc.number, sc.scriptPosition, sc.slug, sc.intExt, sc.location,
            sc.locationTag, sc.timeOfDay, sc.page, sc.pageEighths,
            JSON.stringify(sc.characters), sc.actionText || null,
          ],
        )
      }
    }
    await client.query(
      `DELETE FROM scenes WHERE project_id = $1 AND number <> ALL($2::text[])`,
      [projectId, Array.from(newNumbers)],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); return
  } finally {
    client.release()
  }

  void publishProjectScript(projectId)
  void runProjectBreakdown(projectId, user.id, { force: true })
    .then(() => publishProjectScript(projectId))
    .catch((err) => logError('reparse-archived breakdown failed', { projectId, error: err instanceof Error ? err.message : String(err) }))

  logInfo('reparsed archived .fdx', { projectId, sceneCount: parsed.length, fileName: archive.rows[0].file_name, uploadedAt: archive.rows[0].uploaded_at })
  res.json({ ok: true, sceneCount: parsed.length, archivedAt: archive.rows[0].uploaded_at, fileName: archive.rows[0].file_name })
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
    `SELECT COUNT(*)::text AS count FROM scenes WHERE project_id = $1`,
    [projectId],
  )
  const n = Number(sceneCount.rows[0]?.count ?? 0)
  if (n === 0) {
    res.status(400).json({ error: 'no_scenes', message: 'No scenes in this project. Upload the .fdx first.' })
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

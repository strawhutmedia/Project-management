// Publish a project's parsed script + breakdown + schedule to the status
// branch as `projects/<slug>/script.json`. Lets Claude read the full
// material during a chat session via the GitHub MCP tools — no manual
// "share" step. Called automatically:
//   - after an .fdx upload (so Claude sees the script immediately)
//   - after the per-project breakdown finishes (so Claude sees Claude's
//     own suggestions and any prices the producer has attached)
//
// Idempotent — overwrites on each call.
import { pool } from './db'
import { writeStatusFile, statusReportingEnabled } from './github'
import { logError, logInfo } from './diag'

// Debounced publish queue. When a producer is rapidly editing budget
// prices or shuffling scenes, we don't want a GitHub write per
// keystroke. markProjectDirty schedules a publish 30 seconds out;
// subsequent calls within that window reset the timer so only ONE
// publish fires after the producer pauses. Per-project — different
// projects don't interfere.
const pendingPublishes = new Map<string, NodeJS.Timeout>()
const DEBOUNCE_MS = 30_000

export function markProjectDirty(projectId: string): void {
  const existing = pendingPublishes.get(projectId)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    pendingPublishes.delete(projectId)
    void publishProjectScript(projectId).catch((err) => {
      logError('debounced publish failed', {
        projectId,
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }, DEBOUNCE_MS)
  pendingPublishes.set(projectId, timer)
}

export async function publishProjectScript(projectId: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  if (!statusReportingEnabled()) {
    logInfo('publishProjectScript: skipped, no GITHUB_TOKEN', { projectId })
    return { ok: false, error: 'no_github_token' }
  }
  try {
    const proj = await pool.query<{ name: string }>(
      `SELECT name FROM projects WHERE id = $1`, [projectId],
    )
    if (proj.rows.length === 0) return { ok: false, error: 'not_found' }
    const projectName = proj.rows[0].name
    const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

    const scenes = await pool.query(
      `SELECT id, number, script_position, slug, int_ext, location, location_tag,
              time_of_day, page, page_eighths, characters, action_text, notes,
              breakdown_run_at, producer_note_suggestion, shoot_day_id, day_position
       FROM scenes WHERE project_id = $1 ORDER BY script_position ASC`,
      [projectId],
    )
    const items = await pool.query(
      `SELECT li.id, li.scene_id, li.code, li.description, li.amt, li.x, li.rate,
              li.units, li.notes, li.vendor, li.dated_at,
              a.name AS account_name, a.category
       FROM budget_line_items li
       JOIN budget_accounts a ON a.id = li.account_id
       JOIN budgets b ON b.id = a.budget_id
       WHERE b.project_id = $1
       ORDER BY li.scene_id NULLS LAST, li.position ASC`,
      [projectId],
    )
    const days = await pool.query(
      `SELECT id, number, is_break, shoot_date FROM shoot_days
       WHERE project_id = $1 ORDER BY number ASC`,
      [projectId],
    )

    const itemsByScene = new Map<string, unknown[]>()
    const projectLevelItems: unknown[] = []
    for (const it of items.rows) {
      const out = {
        id: it.id,
        category: it.code,
        description: it.description,
        amt: Number(it.amt),
        x: Number(it.x),
        rate: Number(it.rate),
        total: Number(it.amt) * Number(it.x) * Number(it.rate),
        notes: it.notes,
        vendor: it.vendor,
        datedAt: it.dated_at,
        account: it.account_name,
        accountCategory: it.category,
      }
      if (it.scene_id) {
        const arr = itemsByScene.get(it.scene_id) ?? []
        arr.push(out); itemsByScene.set(it.scene_id, arr)
      } else {
        projectLevelItems.push(out)
      }
    }

    const dump = {
      project: { id: projectId, name: projectName },
      publishedAt: new Date().toISOString(),
      counts: {
        scenes: scenes.rows.length,
        lineItems: items.rows.length,
        sceneLevelItems: items.rows.filter((r) => r.scene_id).length,
        projectLevelItems: projectLevelItems.length,
        shootDays: days.rows.length,
      },
      shootDays: days.rows.map((d) => ({
        id: d.id, number: d.number, isBreak: d.is_break, shootDate: d.shoot_date,
      })),
      scenes: scenes.rows.map((s) => ({
        id: s.id,
        number: s.number,
        scriptPosition: s.script_position,
        slug: s.slug,
        intExt: s.int_ext,
        location: s.location,
        timeOfDay: s.time_of_day,
        page: s.page,
        pageEighths: s.page_eighths,
        characters: s.characters,
        shootDayId: s.shoot_day_id,
        dayPosition: s.day_position,
        breakdownRunAt: s.breakdown_run_at,
        producerNoteSuggestion: s.producer_note_suggestion,
        notes: s.notes,
        actionText: s.action_text,
        breakdownItems: itemsByScene.get(s.id) ?? [],
      })),
      projectLevelItems,
    }
    const filePath = `projects/${slug}/script.json`
    const json = JSON.stringify(dump, null, 2)
    const result = await writeStatusFile(filePath, json, `script: publish ${projectName}`)
    if (!result.ok) {
      logError('publishProjectScript: github write failed', { projectId, error: result.error })
      return { ok: false, error: result.error }
    }
    logInfo('publishProjectScript: ok', { projectId, projectName, path: filePath, bytes: json.length, scenes: scenes.rows.length })
    return { ok: true, path: filePath }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logError('publishProjectScript: failed', { projectId, error: msg })
    return { ok: false, error: msg }
  }
}

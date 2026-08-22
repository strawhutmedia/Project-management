// Socials autopilot — the daily content engine.
//
// Every show with socials_autopilot_enabled gets a fresh batch of draft
// social content each morning (per-show PT hour, default 6am):
//
//   1. Load the show's strategy docs (incl. the 30-day calendar and the
//      Copy Your Own Winners formula), brand voice, example posts, and
//      recent episodes.
//   2. Work out which day of the 30-day calendar cycle today is and pull
//      that day's slot (idea / hook / CTA / post type).
//   3. Generate the batch (2 text posts + 1 photo + 1 reel + 1 story)
//      via generateAutopilotPlan.
//   4. Append the items to the show's freeform social plan as drafts,
//      mark them pushed to the scheduler, and assign each into today's
//      first empty slot of its kind.
//   5. Email the admin a QA digest.
//
// HARD RULE: this never publishes anywhere. Content stops at the
// scheduler in 'planned' status; a human QA reviewer edits, approves,
// posts manually, and flips the slot to 'posted'. There is deliberately
// no posting integration to call even if a prompt asked for one.
//
// Restart safety: one socials_autopilot_runs row per (project, PT date)
// with a UNIQUE constraint. The loop INSERTs ON CONFLICT DO NOTHING and
// only proceeds when its insert won, so redeploys can't double-run.

import crypto from 'crypto'
import { pool } from './db'
import { logError, logInfo } from './diag'
import { sendAdminAlert } from './email'
import {
  hasAnthropicKey,
  generateAutopilotPlan,
  type RawSocialPlan,
  type StrategyDocsInput,
} from './anthropic'
import { seedDays } from './routes/scheduler'
import type { SocialItem } from './routes/socials'

const TICK_MS = 10 * 60 * 1000 // check every 10 minutes

// Current PT date, for callers (the admin run-now endpoint) that need
// "today" in the workspace's canonical posting timezone.
export function nowPTDate(): string {
  return nowPT().date
}

// Current date + hour in Pacific time (the workspace's canonical
// posting timezone — the scheduler grid is PT).
function nowPT(): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    // Intl gives "24" for midnight in some environments; normalize.
    hour: Number(get('hour')) % 24,
  }
}

// Day 1..30 of the rolling calendar cycle, from the PT date autopilot
// was enabled. Both arguments are YYYY-MM-DD.
function calendarDayNumber(startedOn: string, today: string): number {
  const a = Date.UTC(
    Number(startedOn.slice(0, 4)), Number(startedOn.slice(5, 7)) - 1, Number(startedOn.slice(8, 10)),
  )
  const b = Date.UTC(
    Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)),
  )
  const days = Math.max(0, Math.round((b - a) / 86_400_000))
  return (days % 30) + 1
}

type ProjectRow = {
  id: string
  name: string
  subtitle: string | null
  brand_voice: string | null
  example_posts: string[] | null
  vocabulary: string | null
  default_assignees: Record<string, string> | null
  brand_assets_folder: string | null
  autopilot_hour: number
  autopilot_started_on: string | null
}

async function loadStrategyDocsAll(projectId: string): Promise<{
  forGenerator: StrategyDocsInput
  calendar: Record<string, unknown> | null
}> {
  const { rows } = await pool.query<{ kind: string; content: Record<string, unknown> }>(
    `SELECT kind, content FROM social_strategy_documents
      WHERE project_id = $1 AND status = 'generated'`,
    [projectId],
  )
  const forGenerator: StrategyDocsInput = {}
  let calendar: Record<string, unknown> | null = null
  for (const r of rows) {
    if (r.kind === 'calendar') { calendar = r.content; continue }
    if (['strategy', 'audience', 'authority', 'pillars', 'monetization', 'winners'].includes(r.kind)) {
      (forGenerator as Record<string, unknown>)[r.kind] = r.content
    }
  }
  return { forGenerator, calendar }
}

function pickCalendarSlot(
  calendar: Record<string, unknown> | null, dayNumber: number,
): { day: number; idea?: string; hook?: string; format?: string; core_message?: string; cta?: string; post_type?: string; goal?: string; pillar?: string } | null {
  if (!calendar) return null
  const days = Array.isArray(calendar.days) ? calendar.days as Array<Record<string, unknown>> : []
  const hit = days.find((d) => Number(d.day) === dayNumber)
  if (!hit) return null
  const s = (k: string) => (typeof hit[k] === 'string' ? hit[k] as string : undefined)
  return {
    day: dayNumber,
    idea: s('idea'), hook: s('hook'), format: s('format'),
    core_message: s('core_message'), cta: s('cta'),
    post_type: s('post_type'), goal: s('goal'), pillar: s('pillar'),
  }
}

// Ideas from the last few runs so consecutive days don't repeat. We use
// the first ~90 chars of each generated text post as the "theme".
async function loadRecentThemes(projectId: string, limit = 10): Promise<string[]> {
  const { rows } = await pool.query<{ item_ids: string[]; plan_id: string | null }>(
    `SELECT item_ids, plan_id FROM socials_autopilot_runs
      WHERE project_id = $1 AND status = 'done' AND plan_id IS NOT NULL
      ORDER BY run_date DESC LIMIT 5`,
    [projectId],
  )
  if (rows.length === 0) return []
  const planIds = Array.from(new Set(rows.map((r) => r.plan_id).filter((x): x is string => !!x)))
  const wanted = new Set(rows.flatMap((r) => (Array.isArray(r.item_ids) ? r.item_ids : [])))
  const plans = await pool.query<{ items: SocialItem[] }>(
    `SELECT items FROM social_plans WHERE id = ANY($1::uuid[])`,
    [planIds],
  )
  const themes: string[] = []
  for (const p of plans.rows) {
    for (const item of p.items) {
      if (!wanted.has(item.id)) continue
      if (item.kind === 'text_post') themes.push(item.text.slice(0, 90))
    }
  }
  return themes.slice(0, limit)
}

function planToItems(plan: RawSocialPlan, defaults: Record<string, string | undefined>): SocialItem[] {
  const a = (key: string): string | null => defaults[key] ?? null
  const items: SocialItem[] = []
  for (const p of plan.text_posts) {
    items.push({ id: crypto.randomUUID(), kind: 'text_post', status: 'drafted', ai_text: p.text, text: p.text })
  }
  for (const ph of plan.photo_concepts) {
    items.push({
      id: crypto.randomUUID(), kind: 'photo_concept', status: 'drafted',
      assignee_user_id: a('photo_concept'),
      image_direction: ph.image_direction, caption: ph.caption, vibe: ph.vibe,
    })
  }
  for (const r of plan.reel_concepts) {
    items.push({
      id: crypto.randomUUID(), kind: 'reel_concept', status: 'drafted',
      assignee_user_id: a('reel_concept'),
      hook: r.hook, talking_points: r.talking_points, suggested_clip: r.suggested_clip,
    })
  }
  for (const s of plan.story_concepts) {
    items.push({
      id: crypto.randomUUID(), kind: 'story_concept', status: 'drafted',
      assignee_user_id: s.medium === 'video' ? a('story_video') : a('story_photo'),
      medium: s.medium, description: s.description, caption: s.caption,
      suggested_clip: s.suggested_clip, image_direction: s.image_direction,
    })
  }
  return items
}

// Append items to the project's freeform plan (song_id IS NULL; created
// on first use), marked as pushed so they land in the scheduler backlog.
async function appendToFreeformPlan(
  projectId: string, items: SocialItem[],
): Promise<string> {
  const pushedAt = new Date().toISOString()
  for (const item of items) {
    (item as unknown as Record<string, unknown>).pushed_to_scheduler_at = pushedAt
  }
  const existing = await pool.query<{ id: string; items: SocialItem[] }>(
    `SELECT id, items FROM social_plans WHERE project_id = $1 AND song_id IS NULL LIMIT 1`,
    [projectId],
  )
  if (existing.rows.length > 0) {
    const merged = [...existing.rows[0].items, ...items]
    await pool.query(
      `UPDATE social_plans SET items = $2::jsonb, updated_at = now() WHERE id = $1`,
      [existing.rows[0].id, JSON.stringify(merged)],
    )
    return existing.rows[0].id
  }
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO social_plans (project_id, song_id, status, items, created_by)
     VALUES ($1, NULL, 'generated', $2::jsonb, NULL) RETURNING id`,
    [projectId, JSON.stringify(items)],
  )
  return inserted.rows[0].id
}

// Assign each generated item into today's first empty slot of its kind.
// Items that don't fit (grid full) simply stay in the backlog — the QA
// reviewer can drag them wherever.
async function assignToSlots(date: string, planId: string, items: SocialItem[]): Promise<number> {
  await seedDays([date])
  let assigned = 0
  for (const item of items) {
    const { rows } = await pool.query<{ id: string }>(
      `UPDATE scheduler_slots SET plan_id = $2, item_id = $3, updated_at = now()
        WHERE id = (
          SELECT id FROM scheduler_slots
           WHERE day_date = $1 AND kind = $4 AND plan_id IS NULL AND status = 'planned'
           ORDER BY slot_index LIMIT 1
           FOR UPDATE SKIP LOCKED
        )
        RETURNING id`,
      [date, planId, item.id, item.kind],
    )
    if (rows.length > 0) assigned++
  }
  return assigned
}

function digestBody(args: {
  projectName: string
  date: string
  calendarDay: number | null
  items: SocialItem[]
  assigned: number
  baseUrl: string
}): string {
  const lines: string[] = [
    `Autopilot drafts for ${args.projectName} — ${args.date}`,
    args.calendarDay ? `(Day ${args.calendarDay} of the 30-day content plan)` : '(No 30-day calendar found — generated from strategy docs)',
    '',
    `${args.items.length} items drafted, ${args.assigned} placed into today's scheduler slots.`,
    'Nothing goes live until QA approves — review, edit, post manually, then mark posted:',
    `${args.baseUrl}/scheduler`,
    '',
  ]
  for (const item of args.items) {
    if (item.kind === 'text_post') {
      lines.push('— TEXT POST —', item.text, '')
    } else if (item.kind === 'photo_concept') {
      lines.push('— PHOTO CONCEPT —', `Image: ${item.image_direction}`, `Caption: ${item.caption}`, '')
    } else if (item.kind === 'reel_concept') {
      lines.push('— REEL CONCEPT —', `Hook: ${item.hook}`, `Clip: ${item.suggested_clip}`, '')
    } else if (item.kind === 'story_concept') {
      lines.push('— STORY CONCEPT —', `(${item.medium}) ${item.description}`, `Caption: ${item.caption}`, '')
    }
  }
  return lines.join('\n')
}

// Run one project's daily generation for the given PT date. Exported so
// the admin "Run now" endpoint can fire it outside the schedule (it
// respects the same one-run-per-day lock unless force=true, which
// deletes today's failed/stale row first).
export async function runAutopilotForProject(
  projectId: string, date: string, opts: { force?: boolean } = {},
): Promise<{ ok: boolean; skipped?: string; itemCount?: number }> {
  if (!hasAnthropicKey()) return { ok: false, skipped: 'anthropic_key_missing' }

  if (opts.force) {
    // A forced re-run replaces a failed (or stuck "running") attempt.
    // Never force over a completed run — that would double the day.
    await pool.query(
      `DELETE FROM socials_autopilot_runs
        WHERE project_id = $1 AND run_date = $2 AND status <> 'done'`,
      [projectId, date],
    )
  }
  const claim = await pool.query<{ id: string }>(
    `INSERT INTO socials_autopilot_runs (project_id, run_date, status)
     VALUES ($1, $2, 'running')
     ON CONFLICT (project_id, run_date) DO NOTHING
     RETURNING id`,
    [projectId, date],
  )
  if (claim.rows.length === 0) return { ok: true, skipped: 'already_ran_today' }
  const runId = claim.rows[0].id

  try {
    const proj = await pool.query<ProjectRow>(
      `SELECT id, name, subtitle,
              socials_brand_voice AS brand_voice,
              socials_example_posts AS example_posts,
              socials_vocabulary AS vocabulary,
              socials_default_assignees AS default_assignees,
              brand_assets_folder,
              socials_autopilot_hour AS autopilot_hour,
              socials_autopilot_started_on::text AS autopilot_started_on
         FROM projects WHERE id = $1`,
      [projectId],
    )
    if (proj.rows.length === 0) throw new Error('project_not_found')
    const p = proj.rows[0]

    const { forGenerator, calendar } = await loadStrategyDocsAll(projectId)
    const dayNumber = p.autopilot_started_on
      ? calendarDayNumber(p.autopilot_started_on, date)
      : calendarDayNumber(date, date)
    const calendarSlot = pickCalendarSlot(calendar, dayNumber)

    const eps = await pool.query<{ title: string; subtitle: string | null }>(
      `SELECT title, subtitle FROM songs
        WHERE project_id = $1
        ORDER BY position DESC NULLS LAST, created_at DESC LIMIT 8`,
      [projectId],
    )

    // Brand assets are a nice-to-have; Dropbox being down must not
    // block the morning batch.
    let brandAssets: Array<{ name: string; dropboxPath: string }> = []
    if (p.brand_assets_folder) {
      try {
        const { listFolder } = await import('./dropbox')
        const r = await listFolder(p.brand_assets_folder)
        if (r.ok) {
          brandAssets = r.entries
            .filter((e) => e.type === 'file' && /\.(jpe?g|png|webp|gif|heic)$/i.test(e.name))
            .map((e) => ({ name: e.name, dropboxPath: e.path }))
        }
      } catch { /* proceed without assets */ }
    }

    const recentThemes = await loadRecentThemes(projectId)

    const result = await generateAutopilotPlan({
      showName: p.name,
      showSubtitle: p.subtitle,
      brandVoice: p.brand_voice ?? '',
      examplePosts: Array.isArray(p.example_posts) ? p.example_posts : [],
      vocabulary: p.vocabulary ?? undefined,
      strategyDocs: forGenerator,
      brandAssets,
      recentEpisodes: eps.rows,
      calendarSlot,
      recentThemes,
      date,
    })

    const items = planToItems(result.plan, p.default_assignees ?? {})
    const planId = await appendToFreeformPlan(projectId, items)
    const assigned = await assignToSlots(date, planId, items)

    await pool.query(
      `UPDATE socials_autopilot_runs
          SET status = 'done', plan_id = $2, item_ids = $3::jsonb,
              calendar_day = $4, input_tokens = $5, output_tokens = $6, updated_at = now()
        WHERE id = $1`,
      [runId, planId, JSON.stringify(items.map((i) => i.id)),
       calendarSlot ? dayNumber : null,
       result.usage.inputTokens, result.usage.outputTokens],
    )

    const baseUrl = (process.env.APP_BASE_URL || 'https://slate.strawhutmedia.com').replace(/\/+$/, '')
    await sendAdminAlert(
      `Autopilot: ${items.length} drafts ready for QA — ${p.name} (${date})`,
      digestBody({
        projectName: p.name, date,
        calendarDay: calendarSlot ? dayNumber : null,
        items, assigned, baseUrl,
      }),
      `socials-autopilot-${projectId}-${date}`,
    )

    logInfo('autopilot: run complete', {
      projectId, date, items: items.length, assigned,
      calendarDay: calendarSlot ? dayNumber : null,
    })
    return { ok: true, itemCount: items.length }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await pool.query(
      `UPDATE socials_autopilot_runs
          SET status = 'failed', error = $2, updated_at = now()
        WHERE id = $1`,
      [runId, msg.slice(0, 1000)],
    ).catch(() => {})
    logError('autopilot: run failed', { projectId, date, error: msg })
    return { ok: false, skipped: msg }
  }
}

async function tick(): Promise<void> {
  const { date, hour } = nowPT()
  const { rows } = await pool.query<{ id: string }>(
    `SELECT p.id FROM projects p
      WHERE p.socials_autopilot_enabled = true
        AND p.socials_autopilot_hour <= $2
        AND NOT EXISTS (
          SELECT 1 FROM socials_autopilot_runs r
           WHERE r.project_id = p.id AND r.run_date = $1
        )`,
    [date, hour],
  )
  for (const r of rows) {
    // Sequential on purpose — one Claude call at a time keeps the boot
    // logs readable and never bursts the API.
    await runAutopilotForProject(r.id, date)
  }
}

export function startSocialsAutopilotLoop(): void {
  logInfo('autopilot: loop started', { tickMinutes: TICK_MS / 60000 })
  const safeTick = () => {
    tick().catch((err) => {
      logError('autopilot: tick failed', { error: err instanceof Error ? err.message : String(err) })
    })
  }
  // First check shortly after boot (give migrations/seeds a beat), then
  // every TICK_MS.
  setTimeout(safeTick, 30_000)
  setInterval(safeTick, TICK_MS)
}

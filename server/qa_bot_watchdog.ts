import { pool } from './db'
import { sendAdminAlert } from './email'
import { logError, logInfo } from './diag'

// Watchdog for the edit-machine Premiere bot (Ryan, 2026-09-19: "what's the
// thing that checks twice a day and makes sure the computer is not
// running?"). The bot polls /api/qa/approved every 60s, which stamps
// qa_bot_state.last_seen_at; this loop notices when a QA-approved recording
// has been sitting unclaimed and emails the admin — at most twice a day
// (morning/afternoon dedupe keys) — saying whether the edit PC looks OFF or
// is online-but-stuck.
//
// Deliberately silent until the bot has connected at least once ever:
// before the one-time on-PC install there is nothing to watch, and the QA
// page's Edit-bot panel already shows "never connected".

const TICK_MS = 10 * 60 * 1000
// A recording gets this long to be picked up before it counts as stuck —
// generously above the bot's 60s poll so a deploy blip can't false-alarm.
const PICKUP_GRACE_MS = 15 * 60 * 1000
// The bot polls every 60s; silence this long means the PC/task is down.
const OFFLINE_AFTER_MS = 10 * 60 * 1000

async function runOnce(): Promise<void> {
  const state = await pool.query<{ last_seen_at: string }>(
    `SELECT last_seen_at FROM qa_bot_state WHERE id = 1`,
  )
  const lastSeen = state.rows[0]?.last_seen_at ? new Date(state.rows[0].last_seen_at) : null
  if (!lastSeen) return // never installed — nothing to watch yet

  // Approved recordings past the grace period that no bot-log entry has
  // claimed (pickup/success/failure all carry recordingId in data). Capped
  // at 7 days back so ancient rows can't nag forever.
  const stuck = await pool.query<{ title: string; qa_at: string; project_name: string | null }>(
    `SELECT r.title, r.qa_at::text AS qa_at, p.name AS project_name
       FROM qa_recordings r
       LEFT JOIN projects p ON p.id = r.project_id
      WHERE r.status = 'approved'
        AND r.qa_at < now() - ($1 || ' milliseconds')::interval
        AND r.qa_at > now() - interval '7 days'
        AND NOT EXISTS (
          SELECT 1 FROM qa_bot_log l WHERE l.data->>'recordingId' = r.id::text
        )
      ORDER BY r.qa_at ASC`,
    [String(PICKUP_GRACE_MS)],
  )
  if (stuck.rows.length === 0) return

  const offline = Date.now() - lastSeen.getTime() > OFFLINE_AFTER_MS
  // Only the "computer is not running" case alarms (Ryan's original ask).
  // The edit PC's own Claude session works the feed without posting
  // per-recording bot-log claims, so an "online but hasn't started" alarm
  // would nag about episodes it already delivered (2026-09-19, Chastain).
  if (!offline) return
  const list = stuck.rows
    .map((r) => `• ${r.title}${r.project_name ? ` (${r.project_name})` : ''} — approved ${new Date(r.qa_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT`)
    .join('\n')
  const reason = offline
    ? `The edit PC looks OFF — the Premiere bot hasn't checked in since ${lastSeen.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT (it normally polls every 60 seconds). Turn the edit PC on (or check the "PremiereBot" scheduled task) and assembly will start on its own.`
    : `The Premiere bot IS polling (last seen ${lastSeen.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT) but hasn't started these — check the 🤖 Edit bot panel on /qa and runs.log on the edit PC.`

  // Date + am/pm in the dedupe key; the 'digest' marker gives each key a
  // 24-hour window in sendAdminAlert — so at most two of these a day.
  const pt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const get = (t: string) => pt.find((p) => p.type === t)?.value ?? ''
  const half = Number(get('hour')) < 12 ? 'am' : 'pm'
  const key = `qa-bot-watchdog-digest-${get('year')}-${get('month')}-${get('day')}-${half}`

  logInfo(`qa bot watchdog: ${stuck.rows.length} approved recording(s) unclaimed (${offline ? 'bot offline' : 'bot online'})`)
  await sendAdminAlert(
    `QA approved but editing hasn't started (${stuck.rows.length})`,
    `${reason}\n\nWaiting to be assembled:\n${list}`,
    key,
  )
}

export function startQaBotWatchdogLoop(): void {
  const tick = () =>
    void runOnce().catch((err) =>
      logError('qa bot watchdog failed', { error: err instanceof Error ? err.message : String(err) }),
    )
  setTimeout(tick, 90 * 1000) // let boot + migrations settle first
  setInterval(tick, TICK_MS)
}

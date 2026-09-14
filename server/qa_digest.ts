import { pool } from './db'
import { sendNotificationEmail } from './email'
import { logError, logInfo } from './diag'

// Daily QA digest — every morning (8am PT) that recordings are sitting in
// 'pending', everyone on the podcast side of Slate gets one email: "these
// recordings need to be quality assured today", with the list and a link
// to /qa. One send per PT date (qa_digest_runs UNIQUE run_date), so
// redeploys and multiple instances can't double-send.

const TICK_MS = 15 * 60 * 1000
const SEND_HOUR_PT = 8

function nowPT(): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')) % 24,
  }
}

type PendingRow = {
  title: string
  record_date: string | null
  project_name: string | null
}

async function runOnce(): Promise<void> {
  const { date, hour } = nowPT()
  if (hour < SEND_HOUR_PT) return

  const pending = await pool.query<PendingRow>(
    `SELECT r.title, r.record_date::text AS record_date, p.name AS project_name
       FROM qa_recordings r
       LEFT JOIN projects p ON p.id = r.project_id
      WHERE r.status = 'pending'
      ORDER BY r.record_date ASC NULLS LAST, r.created_at ASC`,
  )
  if (pending.rows.length === 0) return

  // Claim today's send atomically — losing the race means another
  // instance (or an earlier tick) already sent it.
  const claim = await pool.query(
    `INSERT INTO qa_digest_runs (run_date, recording_count)
     VALUES ($1, $2) ON CONFLICT (run_date) DO NOTHING RETURNING id`,
    [date, pending.rows.length],
  )
  if (claim.rows.length === 0) return

  // Everyone with a Slate account on the podcast side: admins plus every
  // member/creator of a podcast project. Viewers are skipped — they can't
  // check anything off.
  const recipients = await pool.query<{ email: string; name: string }>(
    `SELECT DISTINCT u.email, COALESCE(u.display_name, u.name) AS name
       FROM users u
      WHERE u.email IS NOT NULL AND u.email <> '' AND u.role <> 'viewer'
        AND (
          u.role = 'admin'
          OR EXISTS (
            SELECT 1 FROM projects p
            LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = u.id
            WHERE p.kind = 'podcast' AND (p.created_by = u.id OR m.user_id IS NOT NULL)
          )
        )`,
  )

  const n = pending.rows.length
  const appBase = process.env.APP_BASE_URL || 'https://slate.strawhutmedia.com'
  const lines = pending.rows
    .slice(0, 20)
    .map((r) => {
      const when = r.record_date ? ` (recorded ${r.record_date.slice(0, 10)})` : ''
      return `• ${r.title}${r.project_name ? ` — ${r.project_name}` : ''}${when}`
    })
    .join('\n')
  const more = n > 20 ? `\n…and ${n - 20} more.` : ''
  const subject = `QA needed today: ${n} recording${n === 1 ? '' : 's'} awaiting quality assurance`
  const body =
    `These recordings have been logged but haven't passed QA yet. ` +
    `Please check the footage against the show's checklist and approve (or flag) them today:\n\n${lines}${more}`

  let sent = 0
  for (const r of recipients.rows) {
    try {
      await sendNotificationEmail({ to: r.email, subject, body, link: `${appBase}/qa` })
      sent++
    } catch (err) {
      logError('qa digest send failed', {
        error: err instanceof Error ? err.message : String(err),
        to: r.email,
      })
    }
  }
  await pool.query(`UPDATE qa_digest_runs SET recipient_count = $2 WHERE run_date = $1`, [date, sent])
  logInfo('qa digest sent', { pending: n, sent, recipients: recipients.rows.length })
}

export function startQaDigestLoop(): void {
  const tick = () => {
    void runOnce().catch((err) => {
      logError('qa digest tick failed', { error: err instanceof Error ? err.message : String(err) })
    })
  }
  setInterval(tick, TICK_MS)
  // First check shortly after boot (not instantly — let migrations settle).
  setTimeout(tick, 30 * 1000)
  logInfo('qa digest: loop started', { sendHourPT: SEND_HOUR_PT })
}

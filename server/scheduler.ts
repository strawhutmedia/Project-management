import { pool } from './db'
import { logError, logInfo } from './diag'
import { notify } from './notifications'
import { sendAdminAlert } from './email'

const TICK_MS = 5 * 60 * 1000 // every 5 min

async function checkDueSoon() {
  // Tasks due within next 8 hours, not done, not yet reminded, with assignee
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.due_at, t.assignee_id,
            s.id AS song_id, s.title AS song_title, s.subtitle AS song_subtitle,
            s.project_id, p.name AS project_name
     FROM tasks t
     JOIN songs s ON s.id = t.song_id
     JOIN projects p ON p.id = s.project_id
     WHERE t.done = FALSE
       AND t.assignee_id IS NOT NULL
       AND t.reminded_8h = FALSE
       AND t.due_at IS NOT NULL
       AND t.due_at > now()
       AND t.due_at <= now() + interval '8 hours'`,
  )
  for (const r of rows) {
    const songLabel = r.song_subtitle ? `${r.song_title} (${r.song_subtitle})` : r.song_title
    const due = new Date(r.due_at).toLocaleString()
    await notify({
      userId: r.assignee_id,
      kind: 'due_soon',
      title: `Due in 8 hours: ${r.title}`,
      body: `Your task "${r.title}" on ${songLabel} (${r.project_name}) is due ${due}.`,
      link: `/projects/${r.project_id}/songs/${r.song_id}`,
      songId: r.song_id,
      taskId: r.id,
    })
    // Also CC the admin (Ryan)
    const adminRows = await pool.query(`SELECT id FROM users WHERE role = 'admin'`)
    for (const a of adminRows.rows) {
      if (a.id !== r.assignee_id) {
        await notify({
          userId: a.id,
          kind: 'due_soon',
          title: `Due in 8 hours: ${r.title}`,
          body: `${songLabel} task "${r.title}" is due ${due}.`,
          link: `/projects/${r.project_id}/songs/${r.song_id}`,
          songId: r.song_id,
          taskId: r.id,
        })
      }
    }
    await pool.query(`UPDATE tasks SET reminded_8h = TRUE WHERE id = $1`, [r.id])
  }
  if (rows.length > 0) logInfo(`scheduler: due-soon notified ${rows.length} task(s)`)
}

async function checkOverdue() {
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.due_at, t.assignee_id,
            s.id AS song_id, s.title AS song_title, s.subtitle AS song_subtitle,
            s.project_id, p.name AS project_name
     FROM tasks t
     JOIN songs s ON s.id = t.song_id
     JOIN projects p ON p.id = s.project_id
     WHERE t.done = FALSE
       AND t.assignee_id IS NOT NULL
       AND t.reminded_overdue = FALSE
       AND t.due_at IS NOT NULL
       AND t.due_at < now()`,
  )
  for (const r of rows) {
    const songLabel = r.song_subtitle ? `${r.song_title} (${r.song_subtitle})` : r.song_title
    await notify({
      userId: r.assignee_id,
      kind: 'overdue',
      title: `[OVERDUE] ${r.title}`,
      body: `Your task "${r.title}" on ${songLabel} (${r.project_name}) is now overdue.`,
      link: `/projects/${r.project_id}/songs/${r.song_id}`,
      songId: r.song_id,
      taskId: r.id,
    })
    await pool.query(`UPDATE tasks SET reminded_overdue = TRUE WHERE id = $1`, [r.id])
  }
  if (rows.length > 0) logInfo(`scheduler: overdue notified ${rows.length} task(s)`)
}

// Once-per-day stuck-tasks digest for admin: tasks overdue 3+ days that
// are still not done. The actual dedupe lives in sendAdminAlert via the
// sent_admin_alerts table, so this survives Railway redeploys.
async function checkStuckDigest() {
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD UTC
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.due_at, t.assignee_id,
            u.display_name AS assignee_display, u.name AS assignee_name,
            s.title AS song_title, s.subtitle AS song_subtitle,
            s.project_id, p.name AS project_name
     FROM tasks t
     JOIN songs s ON s.id = t.song_id
     JOIN projects p ON p.id = s.project_id
     LEFT JOIN users u ON u.id = t.assignee_id
     WHERE t.done = FALSE AND t.due_at IS NOT NULL
       AND t.due_at < now() - interval '3 days'
     ORDER BY t.due_at ASC`,
  )
  if (rows.length === 0) return
  const lines = rows.map((r: { title: string; due_at: string; assignee_display: string | null; assignee_name: string | null; song_title: string; song_subtitle: string | null; project_name: string }) => {
    const songLabel = r.song_subtitle ? `${r.song_title} (${r.song_subtitle})` : r.song_title
    const days = Math.floor((Date.now() - new Date(r.due_at).getTime()) / (1000 * 60 * 60 * 24))
    const who = r.assignee_display || r.assignee_name || 'unassigned'
    return `• "${r.title}" — ${songLabel} (${r.project_name}) — ${who} — overdue ${days}d`
  })
  const body = `${rows.length} task(s) have been stuck for 3+ days:\n\n${lines.join('\n')}\n\nOpen Slate to triage.`
  await sendAdminAlert(`Stuck tasks digest (${rows.length})`, body, `stuck-digest-${today}`)
  logInfo(`scheduler: stuck digest sent (${rows.length} tasks)`)
}

export function startScheduler() {
  async function tick() {
    try {
      await checkDueSoon()
      await checkOverdue()
      await checkStuckDigest()
    } catch (err) {
      logError('scheduler tick failed', { error: err instanceof Error ? err.message : String(err) })
    }
  }
  setInterval(() => void tick(), TICK_MS)
  // Also fire once 30s after boot so we don't wait 5 min for first tick.
  setTimeout(() => void tick(), 30 * 1000)
  logInfo('scheduler started (every 5 min)')
}

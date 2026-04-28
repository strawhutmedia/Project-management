import { pool } from './db'
import { sendNotificationEmail } from './email'
import { logError } from './diag'

const APP_BASE = (process.env.APP_BASE_URL || 'https://slate.strawhutmedia.com').replace(/\/+$/, '')

type NotifyArgs = {
  userId: string
  kind: string
  title: string
  body: string
  link: string
  songId?: string | null
  taskId?: string | null
  sendEmail?: boolean
}

// Insert a notification row and (optionally) send an email to that user.
// Skips when actor === recipient (you don't notify yourself).
export async function notify(args: NotifyArgs & { actorId?: string }): Promise<void> {
  if (args.actorId && args.actorId === args.userId) return

  await pool.query(
    `INSERT INTO notifications (user_id, kind, title, body, link, song_id, task_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [args.userId, args.kind, args.title, args.body, args.link, args.songId ?? null, args.taskId ?? null],
  )

  if (args.sendEmail !== false) {
    try {
      const { rows } = await pool.query(`SELECT email FROM users WHERE id = $1`, [args.userId])
      if (rows.length === 0) return
      const email = rows[0].email
      if (!email) return // placeholder user — in-app notification only, no email
      await sendNotificationEmail({
        to: email,
        subject: args.title,
        body: args.body,
        link: `${APP_BASE}${args.link}`,
      })
    } catch (err) {
      logError('notification email failed', {
        userId: args.userId,
        kind: args.kind,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

// Find users referenced by @handle in a body string. Members must already
// have access to the song's project (so we don't notify random admins
// about every comment they aren't part of unless they're explicitly in
// the project's member list — but admins always see everything anyway).
export async function findMentionedUsers(body: string, projectId: string): Promise<Array<{ id: string; display_name: string | null; name: string }>> {
  const handles: string[] = []
  const re = /@([a-zA-Z0-9_-]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const h = m[1].toLowerCase()
    if (!handles.includes(h)) handles.push(h)
  }
  if (handles.length === 0) return []

  const { rows } = await pool.query(
    `SELECT DISTINCT u.id, u.display_name, u.name
     FROM users u
     LEFT JOIN project_members pm ON pm.user_id = u.id AND pm.project_id = $1
     LEFT JOIN song_members sm ON sm.user_id = u.id
     LEFT JOIN songs s ON s.id = sm.song_id AND s.project_id = $1
     WHERE
       (u.role = 'admin' OR pm.user_id IS NOT NULL OR sm.user_id IS NOT NULL OR
         u.id IN (SELECT created_by FROM projects WHERE id = $1))
       AND LOWER(REGEXP_REPLACE(SPLIT_PART(COALESCE(u.display_name, u.name), ' ', 1), '[^a-zA-Z0-9_-]', '', 'g'))
           = ANY($2::text[])`,
    [projectId, handles],
  )
  return rows
}

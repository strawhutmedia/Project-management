// Per-show shared chat. One thread per project (project members can
// see + post). Claude has the show's metadata as context every turn
// so it can answer questions like "who's the guest on the next
// episode" or help brainstorm intros. No tools — pure conversation.
//
// Cost discipline:
//   - Default model: Sonnet 4.6 (~$0.01/turn)
//   - Opus 4.8 available via per-message toggle (~$0.05/turn)
//   - Hard per-show daily cap (default $2.00). When hit, posts are
//     rejected with 429 until the rolling 24h spend drops below.
//   - Sliding context window — only the last ~40 messages are
//     replayed to Claude so a long-lived thread doesn't keep growing
//     the input cost per turn.

import { Router } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'
import { assertWriter } from '../permissions'
import { logError, logInfo } from '../diag'

export const showChatRouter = Router()
showChatRouter.use(requireUser)

const client = new Anthropic()

const MODEL_SONNET = 'claude-sonnet-4-6'
const MODEL_OPUS = 'claude-opus-4-8'

// Anthropic public pricing as of writing. Cents per token. Used to
// compute per-show daily spend.
const PRICING_PER_TOKEN_CENTS: Record<string, { input: number; output: number }> = {
  sonnet: { input: 0.0003, output: 0.0015 }, // $3 / $15 per 1M
  opus:   { input: 0.0015, output: 0.0075 }, // $15 / $75 per 1M
}

const DAILY_CAP_CENTS = 200 // $2.00
const CONTEXT_MESSAGES = 40 // sliding window — last N messages to Claude

type MessageRow = {
  id: string
  project_id: string
  role: 'user' | 'assistant'
  author_user_id: string | null
  author_display_name: string | null
  content: string
  model: string | null
  input_tokens: number | null
  output_tokens: number | null
  created_at: string
}

function messageToApi(row: MessageRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    role: row.role,
    authorUserId: row.author_user_id,
    authorDisplayName: row.author_display_name,
    content: row.content,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    createdAt: row.created_at,
  }
}

// Helper: sum cents spent on this project's chat in the last 24h.
async function spentCents24h(projectId: string): Promise<number> {
  const { rows } = await pool.query<{
    sonnet_in: string; sonnet_out: string
    opus_in: string; opus_out: string
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN model='sonnet' THEN input_tokens ELSE 0 END), 0)::text AS sonnet_in,
       COALESCE(SUM(CASE WHEN model='sonnet' THEN output_tokens ELSE 0 END), 0)::text AS sonnet_out,
       COALESCE(SUM(CASE WHEN model='opus'   THEN input_tokens ELSE 0 END), 0)::text AS opus_in,
       COALESCE(SUM(CASE WHEN model='opus'   THEN output_tokens ELSE 0 END), 0)::text AS opus_out
     FROM show_chat_messages
     WHERE project_id = $1 AND created_at > now() - interval '1 day'`,
    [projectId],
  )
  const r = rows[0]
  return (
    Number(r.sonnet_in)  * PRICING_PER_TOKEN_CENTS.sonnet.input +
    Number(r.sonnet_out) * PRICING_PER_TOKEN_CENTS.sonnet.output +
    Number(r.opus_in)    * PRICING_PER_TOKEN_CENTS.opus.input +
    Number(r.opus_out)   * PRICING_PER_TOKEN_CENTS.opus.output
  )
}

// Build the system prompt: show context Claude needs every turn.
// Pulled fresh per turn so updates to brand voice / RSS / etc. are
// immediately reflected.
async function buildSystemPrompt(projectId: string): Promise<string> {
  const projRes = await pool.query<{
    name: string
    subtitle: string | null
    kind: string
    socials_brand_voice: string | null
    socials_vocabulary: string | null
    socials_example_posts: string[] | null
    rss_feed_url: string | null
  }>(
    `SELECT name, subtitle, kind,
            socials_brand_voice, socials_vocabulary, socials_example_posts, rss_feed_url
       FROM projects WHERE id = $1`,
    [projectId],
  )
  if (projRes.rows.length === 0) throw new Error('project_not_found')
  const p = projRes.rows[0]

  const lines: string[] = []
  lines.push(`You are the in-Slate assistant for "${p.name}" — a ${p.kind} project.`)
  if (p.subtitle) lines.push(`Tagline / description: ${p.subtitle}`)
  lines.push('')
  lines.push('You have a long-running shared conversation with the team about this show.')
  lines.push('They\'ll ask you for help brainstorming episode angles, writing intros / outros,')
  lines.push('critiquing scripts, suggesting guests, polishing copy, and just thinking out')
  lines.push('loud. Speak in their voice when they ask for copy; otherwise be conversational')
  lines.push('and direct, no preamble.')
  lines.push('')
  lines.push('The team posts in plain English. Each message is prefixed with "[Name]: " so you')
  lines.push('know who said what. You respond as a single voice — no roleplay, no third person.')
  lines.push('')
  if (p.socials_brand_voice && p.socials_brand_voice.trim()) {
    lines.push('SHOW VOICE')
    lines.push(p.socials_brand_voice.trim())
    lines.push('')
  }
  if (Array.isArray(p.socials_example_posts) && p.socials_example_posts.length > 0) {
    lines.push('EXAMPLE POSTS (the team\'s actual published voice — copy tone, vocabulary, rhythm):')
    for (const ex of p.socials_example_posts.slice(0, 8)) {
      lines.push(`  - ${ex.trim()}`)
    }
    lines.push('')
  }
  if (p.socials_vocabulary && p.socials_vocabulary.trim()) {
    lines.push('NAMES + SPELLINGS (must appear exactly as written):')
    lines.push(p.socials_vocabulary.trim())
    lines.push('')
  }

  // Recent episodes — title + release date.
  const songRes = await pool.query<{ title: string; release_date: string | Date | null }>(
    `SELECT title, release_date FROM songs
      WHERE project_id = $1
      ORDER BY COALESCE(release_date, created_at) DESC LIMIT 10`,
    [projectId],
  )
  if (songRes.rows.length > 0) {
    lines.push('RECENT EPISODES (most recent first):')
    for (const s of songRes.rows) {
      const date = s.release_date
        ? (typeof s.release_date === 'string' ? s.release_date.slice(0, 10) : s.release_date.toISOString().slice(0, 10))
        : 'no release date'
      lines.push(`  - ${s.title} (${date})`)
    }
    lines.push('')
  }

  // RSS link (text reference, not fetched on every turn — too slow).
  if (p.rss_feed_url) {
    lines.push(`RSS: ${p.rss_feed_url}`)
    lines.push('')
  }

  lines.push('Anything you learn about the show through this conversation becomes part of the')
  lines.push('thread — there\'s no separate memory store. If the team tells you something')
  lines.push('important about a guest, an upcoming bit, or a sponsor, hold onto it and refer')
  lines.push('back to it later when it\'s relevant.')

  return lines.join('\n')
}

// GET /api/projects/:id/chat — fetches the message history + today's
// spend so the UI can show the cap progress.
showChatRouter.get('/projects/:id/chat', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.id
  if (user.role !== 'admin') { res.status(403).json({ error: 'super_admin_only' }); return }
  if (!await assertWriter(user, projectId, res)) return
  const { rows } = await pool.query<MessageRow>(
    `SELECT m.*, u.display_name AS author_display_name
       FROM show_chat_messages m
       LEFT JOIN users u ON u.id = m.author_user_id
      WHERE m.project_id = $1
      ORDER BY m.created_at ASC`,
    [projectId],
  )
  const spent = await spentCents24h(projectId)
  res.json({
    messages: rows.map(messageToApi),
    dailyCapCents: DAILY_CAP_CENTS,
    spentCents24h: Math.round(spent * 100) / 100,
  })
})

// POST /api/projects/:id/chat — send a message, get Claude's reply.
showChatRouter.post('/projects/:id/chat', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.id
  if (user.role !== 'admin') { res.status(403).json({ error: 'super_admin_only' }); return }
  if (!await assertWriter(user, projectId, res)) return
  const content = String(req.body?.content || '').trim()
  if (!content) { res.status(400).json({ error: 'content required' }); return }
  if (content.length > 16_000) { res.status(400).json({ error: 'message too long' }); return }
  const useOpus = req.body?.useOpus === true
  const modelKey = useOpus ? 'opus' : 'sonnet'
  const modelId = useOpus ? MODEL_OPUS : MODEL_SONNET

  // Daily cap gate.
  const spent = await spentCents24h(projectId)
  if (spent >= DAILY_CAP_CENTS) {
    res.status(429).json({
      error: 'daily_cap_reached',
      message: `This show's chat has used $${(spent / 100).toFixed(2)} of the $${(DAILY_CAP_CENTS / 100).toFixed(2)} daily budget. Resets rolling.`,
      spentCents24h: spent,
      dailyCapCents: DAILY_CAP_CENTS,
    })
    return
  }

  // Persist the user message first so a Claude failure doesn't lose it.
  const userRow = await pool.query<MessageRow>(
    `INSERT INTO show_chat_messages
       (project_id, role, author_user_id, content)
     VALUES ($1, 'user', $2, $3)
     RETURNING *,
       (SELECT display_name FROM users WHERE id = $2) AS author_display_name`,
    [projectId, user.id, content],
  )

  // Pull the latest CONTEXT_MESSAGES rows for the conversation window.
  // Includes the user message we just inserted.
  const ctxRes = await pool.query<MessageRow>(
    `SELECT m.*, u.display_name AS author_display_name
       FROM show_chat_messages m
       LEFT JOIN users u ON u.id = m.author_user_id
      WHERE m.project_id = $1
      ORDER BY m.created_at DESC LIMIT $2`,
    [projectId, CONTEXT_MESSAGES],
  )
  const window = ctxRes.rows.reverse()

  const apiMessages: { role: 'user' | 'assistant'; content: string }[] = []
  for (const m of window) {
    if (m.role === 'user') {
      const who = m.author_display_name || 'Someone'
      apiMessages.push({ role: 'user', content: `[${who}]: ${m.content}` })
    } else {
      apiMessages.push({ role: 'assistant', content: m.content })
    }
  }

  let response
  try {
    const system = await buildSystemPrompt(projectId)
    response = await client.messages.create({
      model: modelId,
      max_tokens: 4000,
      system,
      messages: apiMessages,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logError('show_chat: claude call failed', { projectId, error: msg })
    res.status(502).json({ error: msg.slice(0, 400) })
    return
  }

  const textBlock = response.content.find((b) => b.type === 'text')
  const replyText = textBlock && textBlock.type === 'text' ? textBlock.text : '(no response)'

  const asstRow = await pool.query<MessageRow>(
    `INSERT INTO show_chat_messages
       (project_id, role, content, model, input_tokens, output_tokens)
     VALUES ($1, 'assistant', $2, $3, $4, $5)
     RETURNING *, NULL::text AS author_display_name`,
    [projectId, replyText, modelKey, response.usage.input_tokens, response.usage.output_tokens],
  )

  logInfo('show_chat: turn', {
    projectId, by: user.id, model: modelKey,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  })

  const spentAfter = await spentCents24h(projectId)

  res.json({
    userMessage: messageToApi(userRow.rows[0]),
    assistantMessage: messageToApi(asstRow.rows[0]),
    spentCents24h: Math.round(spentAfter * 100) / 100,
    dailyCapCents: DAILY_CAP_CENTS,
  })
})

// DELETE /api/projects/:id/chat/:messageId — remove a single message
// (mistakes, junk). Admin or project admin only.
showChatRouter.delete('/projects/:id/chat/:messageId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.id
  if (user.role !== 'admin') { res.status(403).json({ error: 'super_admin_only' }); return }
  if (!await assertWriter(user, projectId, res)) return
  await pool.query(
    `DELETE FROM show_chat_messages WHERE id = $1 AND project_id = $2`,
    [req.params.messageId, projectId],
  )
  res.json({ ok: true })
})

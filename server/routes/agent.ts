// Shared Slate ↔ Claude chat. Three-way thread between Ryan, Caroline,
// and the assistant. Phase 1: text-only conversation history with
// Claude as the back-end. Phase 2 will bolt on read/write/git tools so
// Claude can actually edit Slate's code from inside Slate.
//
// Access: workspace admins (role='admin' on the users row) only.
// Caroline was promoted to admin in migration 034 so she + Ryan can
// both post.
//
// Multiple humans can post into the same conversation; Claude sees a
// chat transcript where each user turn is prefixed with the author's
// display name so it knows who said what.

import { Router } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'
import { logError, logInfo } from '../diag'

export const agentRouter = Router()
agentRouter.use(requireUser)

const client = new Anthropic()
const MODEL = 'claude-opus-4-8'

// Per-day per-user cap on Claude tokens so a runaway loop or a
// well-meaning marathon session can't surprise-bill the workspace.
const DAILY_TOKEN_CAP = 1_500_000 // ~$30/day at Opus 4.8 mixed-rate

function requireAdmin(user: SessionUser): boolean {
  return user.role === 'admin'
}

type ConversationRow = {
  id: string
  title: string
  created_by: string | null
  total_input_tokens: string
  total_output_tokens: string
  created_at: string
  updated_at: string
}

type MessageRow = {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  author_user_id: string | null
  author_display_name: string | null
  content: string
  tool_calls: unknown
  tool_results: unknown
  input_tokens: number | null
  output_tokens: number | null
  created_at: string
}

function convoToApi(row: ConversationRow) {
  return {
    id: row.id,
    title: row.title,
    createdBy: row.created_by,
    totalInputTokens: Number(row.total_input_tokens),
    totalOutputTokens: Number(row.total_output_tokens),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function messageToApi(row: MessageRow) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    authorUserId: row.author_user_id,
    authorDisplayName: row.author_display_name,
    content: row.content,
    toolCalls: row.tool_calls,
    toolResults: row.tool_results,
    createdAt: row.created_at,
  }
}

// GET /api/agent/conversations — list all conversations (newest first).
agentRouter.get('/conversations', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  if (!requireAdmin(user)) { res.status(403).json({ error: 'admin_only' }); return }
  const { rows } = await pool.query<ConversationRow>(
    `SELECT * FROM agent_conversations ORDER BY updated_at DESC LIMIT 100`,
  )
  res.json({ conversations: rows.map(convoToApi) })
})

// POST /api/agent/conversations — start a new conversation.
agentRouter.post('/conversations', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  if (!requireAdmin(user)) { res.status(403).json({ error: 'admin_only' }); return }
  const title = String((req.body?.title || 'New conversation')).slice(0, 200)
  const { rows } = await pool.query<ConversationRow>(
    `INSERT INTO agent_conversations (title, created_by)
     VALUES ($1, $2) RETURNING *`,
    [title, user.id],
  )
  res.json({ conversation: convoToApi(rows[0]) })
})

// GET /api/agent/conversations/:id — fetch conversation + all messages.
agentRouter.get('/conversations/:id', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  if (!requireAdmin(user)) { res.status(403).json({ error: 'admin_only' }); return }
  const cRes = await pool.query<ConversationRow>(
    `SELECT * FROM agent_conversations WHERE id = $1`, [req.params.id],
  )
  if (cRes.rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  const mRes = await pool.query<MessageRow>(
    `SELECT m.*, u.display_name AS author_display_name
       FROM agent_messages m
       LEFT JOIN users u ON u.id = m.author_user_id
      WHERE m.conversation_id = $1
      ORDER BY m.created_at ASC`,
    [req.params.id],
  )
  res.json({
    conversation: convoToApi(cRes.rows[0]),
    messages: mRes.rows.map(messageToApi),
  })
})

// POST /api/agent/conversations/:id/messages — post a user message and
// stream back Claude's response. Returns both rows so the client can
// append them.
agentRouter.post('/conversations/:id/messages', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  if (!requireAdmin(user)) { res.status(403).json({ error: 'admin_only' }); return }
  const content = String(req.body?.content || '').trim()
  if (!content) { res.status(400).json({ error: 'content required' }); return }
  if (content.length > 16_000) { res.status(400).json({ error: 'message too long' }); return }

  // Conversation must exist.
  const cRes = await pool.query<ConversationRow>(
    `SELECT * FROM agent_conversations WHERE id = $1`, [req.params.id],
  )
  if (cRes.rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  const convo = cRes.rows[0]

  // Per-user-day spending check. Tally all conversations the user
  // touched in the last 24h.
  const usageRes = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(input_tokens + output_tokens), 0)::text AS total
       FROM agent_messages
      WHERE author_user_id = $1
        AND created_at > now() - interval '1 day'`,
    [user.id],
  )
  const tokensToday = Number(usageRes.rows[0].total)
  if (tokensToday > DAILY_TOKEN_CAP) {
    res.status(429).json({
      error: `daily_cap_reached: ${tokensToday} tokens used in the last 24h. Cap resets rolling.`,
    })
    return
  }

  // Persist the user message.
  const userRow = await pool.query<MessageRow>(
    `INSERT INTO agent_messages (conversation_id, role, author_user_id, content)
     VALUES ($1, 'user', $2, $3)
     RETURNING *,
       (SELECT display_name FROM users WHERE id = $2) AS author_display_name`,
    [convo.id, user.id, content],
  )

  // Build the full transcript and call Claude.
  const allRes = await pool.query<MessageRow>(
    `SELECT m.*, u.display_name AS author_display_name
       FROM agent_messages m
       LEFT JOIN users u ON u.id = m.author_user_id
      WHERE m.conversation_id = $1
      ORDER BY m.created_at ASC`,
    [convo.id],
  )

  // Map to Anthropic message list. Each user turn is prefixed with
  // the author's display name so Claude knows who said what in the
  // shared chat.
  const apiMessages: { role: 'user' | 'assistant'; content: string }[] = []
  for (const m of allRes.rows) {
    if (m.role === 'user') {
      const who = m.author_display_name || 'Someone'
      apiMessages.push({ role: 'user', content: `[${who}]: ${m.content}` })
    } else {
      apiMessages.push({ role: 'assistant', content: m.content })
    }
  }

  let response
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: buildSystemPrompt(),
      messages: apiMessages,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logError('agent: claude call failed', { conversationId: convo.id, error: msg })
    res.status(502).json({ error: msg.slice(0, 400) })
    return
  }

  const textBlock = response.content.find((b) => b.type === 'text')
  const replyText = textBlock && textBlock.type === 'text' ? textBlock.text : '(no response)'

  // Persist the assistant message.
  const asstRow = await pool.query<MessageRow>(
    `INSERT INTO agent_messages
       (conversation_id, role, content, input_tokens, output_tokens)
     VALUES ($1, 'assistant', $2, $3, $4)
     RETURNING *, NULL::text AS author_display_name`,
    [convo.id, replyText, response.usage.input_tokens, response.usage.output_tokens],
  )

  // Roll up token totals on the conversation + bump updated_at.
  await pool.query(
    `UPDATE agent_conversations
        SET total_input_tokens = total_input_tokens + $2,
            total_output_tokens = total_output_tokens + $3,
            updated_at = now()
      WHERE id = $1`,
    [convo.id, response.usage.input_tokens, response.usage.output_tokens],
  )

  logInfo('agent: message exchange', {
    conversationId: convo.id,
    by: user.id,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  })

  res.json({
    userMessage: messageToApi(userRow.rows[0]),
    assistantMessage: messageToApi(asstRow.rows[0]),
  })
})

// DELETE /api/agent/conversations/:id — remove a thread.
agentRouter.delete('/conversations/:id', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  if (!requireAdmin(user)) { res.status(403).json({ error: 'admin_only' }); return }
  await pool.query(`DELETE FROM agent_conversations WHERE id = $1`, [req.params.id])
  res.json({ ok: true })
})

function buildSystemPrompt(): string {
  return `You are the in-Slate Slate assistant — a Claude agent embedded
inside the Slate project management app for Straw Hut Media.

You're talking to Ryan (founder) and Caroline (producer). They have a
shared three-way chat with you; multiple humans contribute to the same
thread. Each user message is prefixed with "[Name]: " so you know who
said what.

Tone:
  - Conversational, not bureaucratic. Match the register of the
    person asking — Ryan and Caroline both write casually.
  - Concrete and short. Bullet points and short paragraphs over
    walls of text.
  - When someone asks for a change to Slate, describe what you'd
    do in plain English and ask a clarifying question if scope is
    unclear. (Phase 1: you cannot actually edit code yet — be
    upfront about that. Phase 2 will let you ship changes
    directly.)

Capabilities (today, Phase 1):
  - Answer questions about how Slate works.
  - Describe what code change you'd make in response to a request,
    in plain language a non-engineer can read.
  - Recommend next steps, tradeoffs, and gotchas.

Hard limits:
  - You CANNOT yet read or write files, run commands, or push code
    from this chat. If asked to "just make the change," say so
    clearly and tell them Ryan needs to ship it (or that Phase 2
    of this agent will enable it).
  - Never claim work is done unless you can verify it.
  - Never share API keys, secrets, or environment variable values.

Slate context:
  - Stack: React 18 + Vite + TypeScript frontend, Express + Node 20
    + Postgres backend, deployed on Railway from the main branch.
  - Repo: github.com/strawhutmedia/Project-management
  - Three project kinds: podcasts, music (albums), films. Each
    has its own pipeline; podcasts use upload-and-go (one MP4
    triggers transcript + social plan + clip job + still
    extraction).
  - Key features: scheduler (cross-show daily posting calendar),
    transcripts (Deepgram), social plans (Claude), clips
    (OpusClip), stills (ffmpeg from MP4), scheduler with drag-
    and-drop.

If someone asks "what can you do?", give them this list briefly
plus an honest "Phase 2 will add real code editing."`
}

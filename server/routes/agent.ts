// Shared Slate ↔ Claude chat with full agent tools — Caroline + Ryan
// + Claude as a three-way thread. Claude can read, edit, typecheck,
// and push to main from inside Slate. Functions like a Claude Code
// session, just running on the production container.
//
// Safety guardrails:
//   - Forbidden paths (.env, package-lock.json, old migration files,
//     node_modules, dist, server/dist, .git).
//   - File-size limits on read/write.
//   - GITHUB_TOKEN required (set on Railway).
//   - 25-iteration hard cap on the agent loop to prevent runaways.
//
// Working dir: the agent maintains a freshly-cloned working tree at
// /tmp/slate-agent. We don't rely on Railway leaving .git in /app —
// we clone from origin on first use and pull origin/main before every
// turn so the agent always operates against current production code.

import { Router } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'
import { logError, logInfo } from '../diag'

export const agentRouter = Router()
agentRouter.use(requireUser)

const client = new Anthropic()
const MODEL = 'claude-opus-4-8'
const TRANSLATE_MODEL = 'claude-haiku-4-5-20251001' // cheaper for short turns
const MAX_AGENT_ITERATIONS = 25

// Where the agent does its work. We clone the repo here on first use
// and `git reset --hard origin/main` before each turn so we're always
// editing against current production code, never a stale checkout.
const AGENT_WORKDIR = '/tmp/slate-agent'
// The container's own /app — used to symlink node_modules into the
// workdir so npm run build doesn't have to reinstall on every turn.
const RUNTIME_APP_DIR = '/app'

// Ensures the agent's working tree exists, is on origin/main, and has
// a usable node_modules. Returns the path to the workdir. Safe to call
// before every tool that needs it.
let workdirReadyPromise: Promise<string> | null = null
async function ensureWorkdir(): Promise<string> {
  if (workdirReadyPromise) return workdirReadyPromise
  workdirReadyPromise = (async () => {
    const token = process.env.GITHUB_TOKEN
    if (!token) throw new Error('GITHUB_TOKEN env var not set on Railway')
    const repoUrl = `https://x-access-token:${token}@github.com/strawhutmedia/Project-management.git`

    const hasCheckout = fs.existsSync(path.join(AGENT_WORKDIR, '.git'))
    if (!hasCheckout) {
      logInfo('agent: cloning workdir', { dir: AGENT_WORKDIR })
      await fs.promises.mkdir(path.dirname(AGENT_WORKDIR), { recursive: true })
      // If a stale non-git dir exists, blow it away.
      if (fs.existsSync(AGENT_WORKDIR)) await fs.promises.rm(AGENT_WORKDIR, { recursive: true, force: true })
      const clone = await rawSpawn('git', ['clone', '--depth', '50', repoUrl, AGENT_WORKDIR], 180_000)
      if (clone.code !== 0) throw new Error(`git_clone_failed: ${clone.output.slice(-400)}`)
    }

    // Identify the bot for any commits this workdir produces.
    await rawSpawn('git', ['-C', AGENT_WORKDIR, 'config', 'user.email', 'slate-bot@strawhutmedia.com'], 5_000)
    await rawSpawn('git', ['-C', AGENT_WORKDIR, 'config', 'user.name', 'Slate Bot'], 5_000)
    // Make sure origin points at the tokened URL so push works.
    await rawSpawn('git', ['-C', AGENT_WORKDIR, 'remote', 'set-url', 'origin', repoUrl], 5_000)

    // Pull latest origin/main so the agent always starts on current prod.
    const fetch = await rawSpawn('git', ['-C', AGENT_WORKDIR, 'fetch', 'origin', 'main'], 60_000)
    if (fetch.code !== 0) throw new Error(`git_fetch_failed: ${fetch.output.slice(-400)}`)
    const reset = await rawSpawn('git', ['-C', AGENT_WORKDIR, 'reset', '--hard', 'origin/main'], 30_000)
    if (reset.code !== 0) throw new Error(`git_reset_failed: ${reset.output.slice(-400)}`)
    await rawSpawn('git', ['-C', AGENT_WORKDIR, 'clean', '-fd'], 30_000)

    // Symlink the runtime container's node_modules into the workdir
    // (same package.json, same install) so `npm run build` doesn't
    // need to reinstall deps on every turn.
    const wdNodeModules = path.join(AGENT_WORKDIR, 'node_modules')
    const appNodeModules = path.join(RUNTIME_APP_DIR, 'node_modules')
    try {
      const stat = fs.existsSync(wdNodeModules) ? await fs.promises.lstat(wdNodeModules) : null
      if (!stat && fs.existsSync(appNodeModules)) {
        await fs.promises.symlink(appNodeModules, wdNodeModules, 'dir')
        logInfo('agent: symlinked node_modules into workdir')
      }
    } catch (err) {
      logError('agent: node_modules symlink failed (typecheck may be slow)', {
        error: err instanceof Error ? err.message : String(err),
      })
    }

    return AGENT_WORKDIR
  })()
  try {
    return await workdirReadyPromise
  } catch (err) {
    workdirReadyPromise = null // allow retry on next request
    throw err
  }
}

// Sync the workdir against origin/main before every agent turn so
// changes made via other paths (a manual push from a real terminal)
// land in the agent's checkout too. Cheap.
async function syncWorkdir(): Promise<void> {
  await ensureWorkdir() // initial setup if needed
  await rawSpawn('git', ['-C', AGENT_WORKDIR, 'fetch', 'origin', 'main'], 60_000)
  await rawSpawn('git', ['-C', AGENT_WORKDIR, 'reset', '--hard', 'origin/main'], 30_000)
  await rawSpawn('git', ['-C', AGENT_WORKDIR, 'clean', '-fd'], 30_000)
}

type RawSpawnResult = { code: number | null; output: string }
function rawSpawn(cmd: string, args: string[], timeoutMs: number): Promise<RawSpawnResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const t = setTimeout(() => { try { proc.kill('SIGKILL') } catch {} }, timeoutMs)
    proc.stdout?.on('data', (d) => { stdout += String(d) })
    proc.stderr?.on('data', (d) => { stderr += String(d) })
    proc.on('error', () => {
      clearTimeout(t)
      resolve({ code: -1, output: stdout + stderr || 'spawn_error' })
    })
    proc.on('close', (code) => {
      clearTimeout(t)
      resolve({ code, output: stdout + (stderr ? `\n[stderr]\n${stderr}` : '') })
    })
  })
}

function requireAdmin(user: SessionUser): boolean {
  return user.role === 'admin'
}

// =============================================================
// Tool definitions
// =============================================================

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_dir',
    description: 'List files and subdirectories at a path inside the Slate repo. Use this to navigate before reading or editing.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo-relative path (e.g. "src/components"). Use "." for the repo root.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the full contents of a text file inside the Slate repo. Max 200KB.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo-relative path.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a text file in the Slate repo. Use sparingly — every write is a real change to the codebase. Max 1MB. Forbidden paths: .env, package-lock.json, any file inside node_modules/, dist/, server/dist/, .git/, or migrations older than the most recent.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo-relative path.' },
        content: { type: 'string', description: 'Full file contents that will overwrite whatever exists at that path.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'run_typecheck',
    description: 'Run "npm run build" against the current working tree. Returns success / failure + the last 200 lines of output. Always run this after editing files to make sure they compile before pushing.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'git_status',
    description: 'Show what files are currently changed in the working tree (uncommitted). Use this to confirm what you are about to push.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'git_commit_push',
    description: 'Commit all staged + unstaged changes and push to origin/main. This deploys to production via Railway. ALWAYS run run_typecheck first and confirm it passed before calling this. Provide a descriptive commit message explaining the change.',
    input_schema: {
      type: 'object',
      properties: {
        commit_message: { type: 'string', description: 'A short subject line + optional body, in the style of the existing commit log.' },
      },
      required: ['commit_message'],
    },
  },
]

// Paths Claude can never touch. Matched as prefixes / globs.
function isPathForbidden(repoRelPath: string): { forbidden: boolean; reason?: string } {
  const p = repoRelPath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (p === '' || p === '.') return { forbidden: true, reason: 'cannot edit repo root' }
  if (p === '.env' || p.startsWith('.env.')) return { forbidden: true, reason: '.env files are secret' }
  if (p === 'package-lock.json') return { forbidden: true, reason: 'package-lock.json is generated' }
  if (p.startsWith('node_modules/')) return { forbidden: true, reason: 'node_modules is not source' }
  if (p.startsWith('dist/') || p.startsWith('server/dist/')) return { forbidden: true, reason: 'build output is generated' }
  if (p.startsWith('.git/')) return { forbidden: true, reason: '.git is managed by git' }
  // Old migrations are immutable — only the latest one is editable.
  const migMatch = p.match(/^server\/migrations\/(\d{3})_/)
  if (migMatch) {
    const num = Number(migMatch[1])
    try {
      const all = fs.readdirSync(path.join(AGENT_WORKDIR, 'server/migrations'))
        .filter((f) => /^\d{3}_/.test(f))
        .map((f) => Number(f.slice(0, 3)))
      const max = all.length ? Math.max(...all) : 0
      if (num < max) return { forbidden: true, reason: 'older migrations are immutable; create a new one' }
    } catch {
      // If we can't read the dir, default to allowing — write_file will fail safely.
    }
  }
  if (p.includes('..')) return { forbidden: true, reason: 'paths cannot escape the repo' }
  return { forbidden: false }
}

function safeRepoPath(repoRelPath: string): string {
  // Normalize and ensure it stays inside AGENT_WORKDIR.
  const abs = path.resolve(AGENT_WORKDIR, repoRelPath)
  if (!abs.startsWith(AGENT_WORKDIR + path.sep) && abs !== AGENT_WORKDIR) {
    throw new Error('path_escapes_repo')
  }
  return abs
}

type ToolResult = { content: string; is_error?: boolean }

async function runTool(name: string, input: Record<string, unknown>): Promise<ToolResult> {
  try {
    // Make sure the workdir exists + is on origin/main before any tool
    // touches it. Cheap when already-ready.
    await ensureWorkdir()
    switch (name) {
      case 'list_dir': {
        const p = String(input.path || '.')
        const abs = safeRepoPath(p)
        const entries = await fs.promises.readdir(abs, { withFileTypes: true })
        const filtered = entries
          .filter((e) => !['node_modules', '.git', 'dist'].includes(e.name))
          .map((e) => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`)
          .sort()
        return { content: filtered.length ? filtered.join('\n') : '(empty)' }
      }
      case 'read_file': {
        const p = String(input.path || '')
        const abs = safeRepoPath(p)
        const stat = await fs.promises.stat(abs)
        if (stat.size > 200_000) return { content: `file too large: ${stat.size} bytes`, is_error: true }
        const text = await fs.promises.readFile(abs, 'utf8')
        return { content: text }
      }
      case 'write_file': {
        const p = String(input.path || '')
        const content = String(input.content ?? '')
        if (content.length > 1_000_000) return { content: 'content_too_large', is_error: true }
        const forbidden = isPathForbidden(p)
        if (forbidden.forbidden) return { content: `forbidden: ${forbidden.reason}`, is_error: true }
        const abs = safeRepoPath(p)
        await fs.promises.mkdir(path.dirname(abs), { recursive: true })
        await fs.promises.writeFile(abs, content, 'utf8')
        return { content: `wrote ${content.length} bytes to ${p}` }
      }
      case 'run_typecheck': {
        return await runSpawn('npm', ['run', 'build'], 360_000)
      }
      case 'git_status': {
        return await runSpawn('git', ['-C', AGENT_WORKDIR, 'status', '--porcelain=v1'], 30_000)
      }
      case 'git_commit_push': {
        const msg = String(input.commit_message || '').trim()
        if (!msg) return { content: 'commit_message required', is_error: true }
        // ensureWorkdir() already set git user + tokened remote. Just
        // stage, commit, push.
        const addRes = await runSpawn('git', ['-C', AGENT_WORKDIR, 'add', '-A'], 30_000)
        if (addRes.is_error) return addRes
        const commitRes = await runSpawn('git', ['-C', AGENT_WORKDIR, 'commit', '-m', msg], 30_000)
        // git commit returns non-zero if there's nothing to commit; treat as success-no-op.
        if (commitRes.is_error && !/nothing to commit|no changes added/i.test(commitRes.content)) {
          return commitRes
        }
        const pushRes = await runSpawn('git', ['-C', AGENT_WORKDIR, 'push', 'origin', 'HEAD:main'], 120_000)
        if (pushRes.is_error) return pushRes
        return { content: `Committed and pushed. Railway will redeploy in ~60s.\n\n${pushRes.content}` }
      }
      default:
        return { content: `unknown_tool: ${name}`, is_error: true }
    }
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), is_error: true }
  }
}

function runSpawn(cmd: string, args: string[], timeoutMs: number): Promise<ToolResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const t = setTimeout(() => { try { proc.kill('SIGKILL') } catch {} }, timeoutMs)
    proc.stdout?.on('data', (d) => { stdout += String(d) })
    proc.stderr?.on('data', (d) => { stderr += String(d) })
    proc.on('error', (err) => {
      clearTimeout(t)
      resolve({ content: `spawn_failed: ${err.message}`, is_error: true })
    })
    proc.on('close', (code) => {
      clearTimeout(t)
      // Trim to the last ~200 lines so we don't blow the token budget.
      const out = (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).split('\n').slice(-200).join('\n')
      resolve({
        content: out || `(exit ${code} with no output)`,
        is_error: code !== 0,
      })
    })
  })
}

// =============================================================
// Translation
// =============================================================

// Detect whether the text is mostly English. Cheap heuristic up front
// so we only spend Haiku tokens when we actually need to translate.
function looksMostlyEnglish(text: string): boolean {
  // ASCII letters / common English words coverage. Trips on emoji-
  // heavy messages but those are fine to skip translation on anyway.
  const ascii = (text.match(/[a-zA-Z]/g) ?? []).length
  const total = text.replace(/\s+/g, '').length
  if (total < 12) return true
  return ascii / total > 0.55
}

async function detectAndTranslate(text: string): Promise<{ language: string | null; translation: string | null }> {
  if (looksMostlyEnglish(text)) return { language: null, translation: null }
  try {
    const res = await client.messages.create({
      model: TRANSLATE_MODEL,
      max_tokens: 1500,
      system:
        'You are a strict language detector + translator. Reply ONLY with JSON in the shape {"language":"<English name>","translation":"<English text>"}. If the input is already English, return {"language":"English","translation":""}. Do not add any commentary.',
      messages: [{ role: 'user', content: text }],
    })
    const block = res.content.find((b) => b.type === 'text')
    if (!block || block.type !== 'text') return { language: null, translation: null }
    const parsed = JSON.parse(block.text) as { language?: string; translation?: string }
    return {
      language: typeof parsed.language === 'string' && parsed.language ? parsed.language : null,
      translation: typeof parsed.translation === 'string' && parsed.translation ? parsed.translation : null,
    }
  } catch (err) {
    logError('agent: translation failed', { error: err instanceof Error ? err.message : String(err) })
    return { language: null, translation: null }
  }
}

// =============================================================
// Conversation routes
// =============================================================

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
  detected_language: string | null
  english_translation: string | null
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
    detectedLanguage: row.detected_language,
    englishTranslation: row.english_translation,
    toolCalls: row.tool_calls,
    toolResults: row.tool_results,
    createdAt: row.created_at,
  }
}

agentRouter.get('/conversations', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  if (!requireAdmin(user)) { res.status(403).json({ error: 'admin_only' }); return }
  const { rows } = await pool.query<ConversationRow>(
    `SELECT * FROM agent_conversations ORDER BY updated_at DESC LIMIT 100`,
  )
  res.json({ conversations: rows.map(convoToApi) })
})

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

agentRouter.post('/conversations/:id/messages', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  if (!requireAdmin(user)) { res.status(403).json({ error: 'admin_only' }); return }
  const content = String(req.body?.content || '').trim()
  if (!content) { res.status(400).json({ error: 'content required' }); return }
  if (content.length > 16_000) { res.status(400).json({ error: 'message too long' }); return }

  const cRes = await pool.query<ConversationRow>(
    `SELECT * FROM agent_conversations WHERE id = $1`, [req.params.id],
  )
  if (cRes.rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  const convo = cRes.rows[0]

  // Always sync the workdir against origin/main before the turn so
  // the agent sees current production code, not a stale checkout.
  // Fire-and-watch — if it fails, tools will surface the failure
  // clearly when called.
  try {
    await syncWorkdir()
  } catch (err) {
    logError('agent: workdir sync failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // Auto-translate if the message isn't English.
  const tr = await detectAndTranslate(content)

  // Persist the user message with translation if any.
  const userRow = await pool.query<MessageRow>(
    `INSERT INTO agent_messages
       (conversation_id, role, author_user_id, content, detected_language, english_translation)
     VALUES ($1, 'user', $2, $3, $4, $5)
     RETURNING *,
       (SELECT display_name FROM users WHERE id = $2) AS author_display_name`,
    [convo.id, user.id, content, tr.language, tr.translation],
  )

  // Build the transcript for Claude. Each user turn is prefixed with
  // the author's name, and we use the English translation when one
  // exists so Claude reads consistent English.
  const allRes = await pool.query<MessageRow>(
    `SELECT m.*, u.display_name AS author_display_name
       FROM agent_messages m
       LEFT JOIN users u ON u.id = m.author_user_id
      WHERE m.conversation_id = $1
      ORDER BY m.created_at ASC`,
    [convo.id],
  )

  type AssistantBlock =
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  type UserBlock =
    | { type: 'text'; text: string }
    | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

  const apiMessages: Array<
    | { role: 'user'; content: UserBlock[] }
    | { role: 'assistant'; content: AssistantBlock[] }
  > = []
  for (const m of allRes.rows) {
    if (m.role === 'user') {
      const who = m.author_display_name || 'Someone'
      const text = m.english_translation || m.content
      apiMessages.push({ role: 'user', content: [{ type: 'text', text: `[${who}]: ${text}` }] })
    } else {
      // Replay assistant text + any tool_use blocks together. We
      // stored tool_calls as the array of {id,name,input} from the
      // original assistant turn. To stay in protocol, follow each
      // assistant turn that has tool_calls with a user turn carrying
      // the tool_results from the same iteration.
      const blocks: AssistantBlock[] = []
      if (m.content) blocks.push({ type: 'text', text: m.content })
      const stored = (m.tool_calls as Array<{ id: string; name: string; input: Record<string, unknown> }> | null) ?? null
      if (stored && Array.isArray(stored)) {
        for (const tu of stored) {
          blocks.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input })
        }
      }
      apiMessages.push({ role: 'assistant', content: blocks })
      const storedResults = (m.tool_results as Array<{ tool_use_id: string; content: string; is_error?: boolean }> | null) ?? null
      if (storedResults && Array.isArray(storedResults) && storedResults.length > 0) {
        apiMessages.push({
          role: 'user',
          content: storedResults.map((r) => ({
            type: 'tool_result' as const,
            tool_use_id: r.tool_use_id,
            content: r.content,
            ...(r.is_error ? { is_error: true } : {}),
          })),
        })
      }
    }
  }

  // The agent loop: Claude may use tools repeatedly until it produces
  // a final text-only response. We persist each assistant turn (with
  // tool calls + results) as one agent_messages row so the chat
  // history can replay correctly next time.
  let totalInput = 0
  let totalOutput = 0
  let savedAssistantRow: { rows: MessageRow[] } | null = null

  for (let iter = 0; iter < MAX_AGENT_ITERATIONS; iter++) {
    let response: Anthropic.Message
    try {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system: buildSystemPrompt(),
        tools: TOOLS,
        messages: apiMessages as Anthropic.MessageParam[],
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logError('agent: claude call failed', { conversationId: convo.id, iter, error: msg })
      res.status(502).json({ error: msg.slice(0, 400) })
      return
    }
    totalInput += response.usage.input_tokens
    totalOutput += response.usage.output_tokens

    // Pull the text + tool_use blocks out.
    const textParts: string[] = []
    const toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = []
    for (const b of response.content) {
      if (b.type === 'text') textParts.push(b.text)
      else if (b.type === 'tool_use') toolUses.push({ id: b.id, name: b.name, input: (b.input as Record<string, unknown>) ?? {} })
    }
    const textPart = textParts.join('\n').trim()

    if (toolUses.length === 0) {
      // Final response. Persist + return.
      savedAssistantRow = await pool.query<MessageRow>(
        `INSERT INTO agent_messages
           (conversation_id, role, content, input_tokens, output_tokens)
         VALUES ($1, 'assistant', $2, $3, $4)
         RETURNING *, NULL::text AS author_display_name`,
        [convo.id, textPart || '(no response)', totalInput, totalOutput],
      )
      break
    }

    // Run each tool sequentially. We could parallelize but sequential
    // keeps cause-and-effect clear for write/git operations.
    const results: Array<{ tool_use_id: string; content: string; is_error?: boolean }> = []
    for (const tu of toolUses) {
      logInfo('agent: tool', { name: tu.name, iter })
      const r = await runTool(tu.name, tu.input)
      results.push({
        tool_use_id: tu.id,
        content: r.content.slice(0, 60_000),
        ...(r.is_error ? { is_error: true } : {}),
      })
    }

    // Persist this intermediate turn so it survives a refresh.
    await pool.query(
      `INSERT INTO agent_messages
         (conversation_id, role, content, tool_calls, tool_results, input_tokens, output_tokens)
       VALUES ($1, 'assistant', $2, $3::jsonb, $4::jsonb, $5, $6)`,
      [
        convo.id, textPart,
        JSON.stringify(toolUses),
        JSON.stringify(results),
        response.usage.input_tokens, response.usage.output_tokens,
      ],
    )

    // Extend the transcript with this assistant turn + tool results
    // so the next loop iteration sees them.
    apiMessages.push({
      role: 'assistant',
      content: [
        ...(textPart ? [{ type: 'text' as const, text: textPart }] : []),
        ...toolUses.map((tu) => ({
          type: 'tool_use' as const, id: tu.id, name: tu.name, input: tu.input,
        })),
      ],
    })
    apiMessages.push({
      role: 'user',
      content: results.map((r) => ({
        type: 'tool_result' as const,
        tool_use_id: r.tool_use_id,
        content: r.content,
        ...(r.is_error ? { is_error: true } : {}),
      })),
    })

    if (iter === MAX_AGENT_ITERATIONS - 1) {
      // Hit the iteration cap without Claude wrapping up.
      savedAssistantRow = await pool.query<MessageRow>(
        `INSERT INTO agent_messages
           (conversation_id, role, content, input_tokens, output_tokens)
         VALUES ($1, 'assistant', $2, $3, $4)
         RETURNING *, NULL::text AS author_display_name`,
        [convo.id, `(stopped after ${MAX_AGENT_ITERATIONS} tool iterations — task is more involved than a single chat turn can handle; break it into smaller steps)`,
         totalInput, totalOutput],
      )
    }
  }

  await pool.query(
    `UPDATE agent_conversations
        SET total_input_tokens = total_input_tokens + $2,
            total_output_tokens = total_output_tokens + $3,
            updated_at = now()
      WHERE id = $1`,
    [convo.id, totalInput, totalOutput],
  )

  logInfo('agent: turn complete', {
    conversationId: convo.id,
    by: user.id,
    totalInput, totalOutput,
  })

  res.json({
    userMessage: messageToApi(userRow.rows[0]),
    assistantMessage: savedAssistantRow ? messageToApi(savedAssistantRow.rows[0]) : null,
  })
})

agentRouter.delete('/conversations/:id', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  if (!requireAdmin(user)) { res.status(403).json({ error: 'admin_only' }); return }
  await pool.query(`DELETE FROM agent_conversations WHERE id = $1`, [req.params.id])
  res.json({ ok: true })
})

function buildSystemPrompt(): string {
  return `You are the in-Slate Slate assistant — a Claude agent embedded
inside the Slate project management app for Straw Hut Media. You can
read, edit, typecheck, and push code to production.

Right now you're talking to Ryan (founder) and Caroline (producer) in
a shared three-way chat. Multiple humans contribute to the same thread.
Each user message is prefixed with "[Name]: " so you know who said
what. Caroline often writes in Filipino — those messages have been
auto-translated to English before you see them.

Tone:
  - Conversational and confident. Skip preamble — get to the point.
  - Short. Bullet points and short paragraphs.
  - Plain English a non-engineer can follow. No jargon unless asked.

Tool playbook for code changes:
  1. Read enough of the codebase to understand the change (list_dir +
     read_file). Don't ask the user to paste code — you can fetch it.
  2. Make the edits with write_file. Keep changes scoped and small.
  3. Run run_typecheck. If it fails, fix the errors and rerun. Don't
     push if it's red.
  4. Run git_status to confirm what's actually changed.
  5. Call git_commit_push with a short descriptive commit message in
     the style of recent commits.
  6. Tell the user clearly what shipped and that Railway will
     redeploy in ~60s.

Hard rules:
  - NEVER push code that doesn't typecheck.
  - NEVER edit .env, package-lock.json, node_modules, or migrations
    older than the latest — those are forbidden and write_file will
    reject them.
  - NEVER share API keys, secrets, or environment variable values.
  - Migrations: when adding a new one, use the next 3-digit number
    and explain what it does. Never modify a past migration.
  - If a change touches a lot of files or feels risky, surface the
    plan first and wait for explicit approval from the human in the
    chat before pushing.

Slate context:
  - Stack: React 18 + Vite + TypeScript frontend, Express + Node 20
    + Postgres backend, deployed on Railway from the main branch.
  - Repo on disk: /app (where you're running). git remote is
    github.com/strawhutmedia/Project-management.
  - Three project kinds: podcasts, music (albums), films. Each has
    its own pipeline; podcasts use upload-and-go (one MP4 triggers
    transcript + social plan + clip job + still extraction + clip
    extraction).
  - Key surfaces: Project page, Episode page (SongPage),
    SocialsSection, ClipsSection, Scheduler, AgentPage (this chat).

If someone asks "what can you do?", give them a brief honest answer:
read + edit Slate's code, run typechecks, and push to production —
all from this chat.`
}

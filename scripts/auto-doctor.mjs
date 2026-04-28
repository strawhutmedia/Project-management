#!/usr/bin/env node
// Slate Auto-Doctor: reads errors from the status branch, asks Claude to
// diagnose + fix each one, commits fixes to main, and updates a seen-state
// file so we don't retry the same error forever.
//
// No SDK — uses the Anthropic Messages API + native fetch.
// No Anthropic SDK install required.

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

// Verbose diagnostic log we'll write to the status branch every run.
const diagLog = []
function diag(msg, data) {
  const entry = { ts: new Date().toISOString(), msg, ...(data ? { data } : {}) }
  diagLog.push(entry)
  console.log(`[doctor] ${msg}${data ? ` :: ${JSON.stringify(data).slice(0, 200)}` : ''}`)
}

process.on('uncaughtException', (err) => {
  diag('uncaughtException', { message: err.message, stack: err.stack?.slice(0, 1000) })
  void persistDiag().finally(() => process.exit(0))
})
process.on('unhandledRejection', (err) => {
  const e = err instanceof Error ? err : new Error(String(err))
  diag('unhandledRejection', { message: e.message, stack: e.stack?.slice(0, 1000) })
  void persistDiag().finally(() => process.exit(0))
})

async function persistDiag() {
  try {
    await updateStatusFile('auto-doctor-runs.jsonl', diagLog.map((e) => JSON.stringify(e)).join('\n') + '\n', /* append */ true)
  } catch (err) {
    console.error('persistDiag failed:', err.message)
  }
}

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
if (!ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY not set — exiting')
  process.exit(1)
}

const MODEL = 'claude-sonnet-4-5-20250929'
const MAX_ITERATIONS = 20
const ERROR_LOOKBACK_HOURS = 24
const REPO_ROOT = process.cwd()

// ---------- Tool definitions ----------
const tools = [
  {
    name: 'read_file',
    description: 'Read a file from the repo. Returns the file contents (truncated to 60k chars).',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative path from repo root' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Replace a file in the repo with new content. Creates parent dirs if missing.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Replace a unique substring in an existing file. Use when you only want to change a few lines.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'list_dir',
    description: 'List entries (files + dirs) in a repo directory.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'grep',
    description: 'Search for a regex pattern in repo files. Returns up to 50 matching lines.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string', description: 'Optional dir to limit search' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'mark_fixed',
    description: 'Call when the code change is complete and ready to commit. Provide a 1-2 sentence summary of the fix.',
    input_schema: {
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
    },
  },
  {
    name: 'mark_external_issue',
    description:
      "Call when the error isn't fixable by a code change (e.g., env var, third-party config, transient). Explain why.",
    input_schema: {
      type: 'object',
      properties: { reason: { type: 'string' } },
      required: ['reason'],
    },
  },
]

// ---------- Tool implementations ----------
function safePath(p) {
  const abs = path.resolve(REPO_ROOT, p)
  if (!abs.startsWith(REPO_ROOT)) throw new Error('path escapes repo')
  return abs
}

function executeTool(name, input) {
  try {
    switch (name) {
      case 'read_file': {
        const content = fs.readFileSync(safePath(input.path), 'utf8')
        return content.length > 60000 ? content.slice(0, 60000) + '\n…[truncated]' : content
      }
      case 'write_file': {
        const abs = safePath(input.path)
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.writeFileSync(abs, input.content)
        return `wrote ${input.content.length} bytes to ${input.path}`
      }
      case 'edit_file': {
        const abs = safePath(input.path)
        const cur = fs.readFileSync(abs, 'utf8')
        const occurrences = cur.split(input.old_string).length - 1
        if (occurrences === 0) return `Error: old_string not found in ${input.path}`
        if (occurrences > 1)
          return `Error: old_string appears ${occurrences} times in ${input.path} — make it unique`
        const next = cur.replace(input.old_string, input.new_string)
        fs.writeFileSync(abs, next)
        return `replaced 1 occurrence in ${input.path}`
      }
      case 'list_dir': {
        return fs.readdirSync(safePath(input.path)).join('\n')
      }
      case 'grep': {
        const args = ['-rIn', '--include=*.ts', '--include=*.tsx', '--include=*.sql']
        if (input.path) args.push(safePath(input.path))
        else args.push(REPO_ROOT)
        const out = execSync(`grep ${args.join(' ')} ${JSON.stringify(input.pattern)}`, {
          encoding: 'utf8',
          maxBuffer: 1024 * 1024,
        })
          .split('\n')
          .slice(0, 50)
          .join('\n')
        return out || '(no matches)'
      }
      case 'mark_fixed':
      case 'mark_external_issue':
        return 'OK'
    }
  } catch (e) {
    return `Error: ${e.message}`
  }
  return 'unknown_tool'
}

// ---------- Claude messages call ----------
async function callClaude(messages) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      tools,
      messages,
      system: `You are Slate's Auto-Doctor. Slate is the Straw Hut Media project tracker (Node + Express + React + Postgres). The repo root is the cwd. Read the existing code first, find the root cause, then write a minimal fix. Prefer edit_file over write_file for small changes. When done, call mark_fixed with a one-sentence summary. If the error isn't a code issue (e.g., bad env var, third-party config), call mark_external_issue and don't write any files.`,
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 500)}`)
  }
  return res.json()
}

async function fixError(errorEntry) {
  const messages = [
    {
      role: 'user',
      content: `Slate logged this error:

\`\`\`json
${JSON.stringify(errorEntry, null, 2)}
\`\`\`

Diagnose and fix it. Use the tools to investigate the codebase first.`,
    },
  ]

  let outcome = null
  let iterations = 0

  while (!outcome && iterations < MAX_ITERATIONS) {
    iterations++
    const response = await callClaude(messages)
    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason !== 'tool_use') {
      outcome = { kind: 'no_tool_call', summary: 'agent stopped without calling a terminal tool' }
      break
    }
    const toolUses = response.content.filter((b) => b.type === 'tool_use')
    const toolResults = []
    for (const tu of toolUses) {
      const result = executeTool(tu.name, tu.input)
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: String(result).slice(0, 60000) })
      if (tu.name === 'mark_fixed') {
        outcome = { kind: 'fixed', summary: tu.input.summary }
      } else if (tu.name === 'mark_external_issue') {
        outcome = { kind: 'external', summary: tu.input.reason }
      }
    }
    messages.push({ role: 'user', content: toolResults })
  }

  if (!outcome) outcome = { kind: 'gave_up', summary: `hit max iterations (${MAX_ITERATIONS})` }
  return { ...outcome, iterations }
}

// ---------- Read files from the status branch via GitHub API ----------
const REPO_OWNER = 'strawhutmedia'
const REPO_NAME = 'Project-management'
const STATUS_BRANCH = 'status'

async function ghReadFile(filePath) {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error('GITHUB_TOKEN not set')
  const res = await fetch(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIComponent(filePath)}?ref=${STATUS_BRANCH}`,
    { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'slate-auto-doctor', Accept: 'application/vnd.github.v3+json' } },
  )
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub ${res.status} reading ${filePath}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  if (data.encoding !== 'base64') throw new Error(`unexpected encoding: ${data.encoding}`)
  return Buffer.from(data.content, 'base64').toString('utf8')
}

// ---------- Main ----------
function errorKey(e) {
  return `${e.msg}::${JSON.stringify(e.data || {}).slice(0, 80)}`
}

async function main() {
  diag('boot', {
    node: process.version,
    has_anthropic_key: Boolean(process.env.ANTHROPIC_API_KEY),
    has_github_token: Boolean(process.env.GITHUB_TOKEN),
    cwd: process.cwd(),
  })

  let errors = []
  try {
    const raw = await ghReadFile('errors.jsonl')
    if (raw === null) {
      diag('no_errors_file')
      return
    }
    errors = raw.split('\n').filter(Boolean).map((line) => {
      try { return JSON.parse(line) } catch { return null }
    }).filter(Boolean)
  } catch (e) {
    console.error('Failed to read errors.jsonl:', e.message)
    return
  }

  let seen = {}
  try {
    const raw = await ghReadFile('auto-doctor-seen.json')
    if (raw) seen = JSON.parse(raw)
  } catch (e) {
    console.warn('Could not read seen state (starting fresh):', e.message)
  }

  const cutoff = Date.now() - ERROR_LOOKBACK_HOURS * 60 * 60 * 1000
  const recent = errors.filter((e) => {
    const ts = new Date(e.ts).getTime()
    return !isNaN(ts) && ts > cutoff
  })
  const newErrors = recent.filter((e) => !seen[errorKey(e)])

  console.log(`errors total=${errors.length} recent=${recent.length} new=${newErrors.length}`)
  if (newErrors.length === 0) return

  let committed = 0
  for (const error of newErrors.slice(0, 5)) {
    const key = errorKey(error)
    console.log(`\n--- Working on: ${error.msg} ---`)
    let result
    try {
      result = await fixError(error)
    } catch (err) {
      console.error(`agent failed: ${err.message}`)
      seen[key] = { attemptedAt: new Date().toISOString(), error: err.message, iterations: 0 }
      continue
    }
    console.log(`outcome=${result.kind} iterations=${result.iterations} :: ${result.summary}`)
    seen[key] = {
      attemptedAt: new Date().toISOString(),
      outcome: result.kind,
      summary: result.summary,
      iterations: result.iterations,
    }

    if (result.kind === 'fixed') {
      const status = execSync('git status --porcelain', { encoding: 'utf8' })
      if (status.trim()) {
        execSync('git add -A')
        const commitMsg = `Auto-Doctor fix: ${error.msg.slice(0, 80)}\n\n${result.summary}\n\nTriggered by error logged at ${error.ts}.`
        execSync(`git -c user.name="slate-auto-doctor" -c user.email="auto-doctor@noreply.local" commit -m ${JSON.stringify(commitMsg)}`)
        committed++
        console.log(`Committed fix for ${error.msg}`)
      } else {
        console.log('mark_fixed but no working-tree changes — skipping commit')
      }
    }
  }

  if (committed > 0) {
    execSync('git push origin HEAD:main', { stdio: 'inherit' })
    console.log(`Pushed ${committed} fix(es) to main`)
  }

  await updateStatusFile('auto-doctor-seen.json', JSON.stringify(seen, null, 2))
}

async function updateStatusFile(filePath, content, append = false) {
  const owner = 'strawhutmedia'
  const repo = 'Project-management'
  const branch = 'status'
  const token = process.env.GH_AUTODOCTOR_TOKEN || process.env.GITHUB_TOKEN
  if (!token) {
    console.error('No GH_AUTODOCTOR_TOKEN/GITHUB_TOKEN — cannot persist file')
    return
  }
  let sha = undefined
  let existing = ''
  try {
    const headRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`,
      { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'slate-auto-doctor' } },
    )
    if (headRes.ok) {
      const data = await headRes.json()
      sha = data.sha
      if (append && data.encoding === 'base64') {
        existing = Buffer.from(data.content, 'base64').toString('utf8')
        // Tail to last 500 lines so the file doesn't grow unbounded.
        existing = existing.split('\n').slice(-500).join('\n')
        if (existing && !existing.endsWith('\n')) existing += '\n'
      }
    }
  } catch {}
  const finalContent = append ? existing + content : content
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'slate-auto-doctor',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `auto-doctor: update ${filePath}`,
        content: Buffer.from(finalContent).toString('base64'),
        branch,
        sha,
      }),
    },
  )
  if (!res.ok) {
    const text = await res.text()
    console.error(`Failed to persist ${filePath}: ${res.status} ${text.slice(0, 200)}`)
  }
}

main()
  .then(() => {
    diag('done')
    return persistDiag()
  })
  .catch(async (err) => {
    diag('fatal', { message: err?.message, stack: err?.stack?.slice(0, 1000) })
    await persistDiag()
  })
  .finally(() => process.exit(0))

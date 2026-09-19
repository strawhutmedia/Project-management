// Premiere Bot watcher — polls Slate's approved-QA feed and kicks off one
// headless Claude Code run per newly approved recording. Requires Node 18+
// (ships with the machine's Claude Code install) and a .env alongside it.
//
//   node poll.mjs
//
// Runs headless (Windows scheduled task under `editbot`, no logon needed —
// see install-task.ps1), so its status channel is Slate's bot-log
// (POST /api/qa/bot-log), which the QA page shows in the "🤖 Edit bot"
// panel. The Approve button in Slate is the trigger: within one poll
// interval (default 60s) of an approval, assembly starts here.
//
// State: seen.json (recording ids already handled) — delete it to reprocess.
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

// Tiny .env loader (no dependencies on the edit machine).
const env = {}
if (existsSync(new URL('.env', import.meta.url))) {
  for (const line of readFileSync(new URL('.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/)
    if (m && !line.trim().startsWith('#')) env[m[1]] = m[2]
  }
}
const BASE = env.SLATE_BASE_URL || 'https://slate.strawhutmedia.com'
const TOKEN = env.QA_SERVICE_TOKEN || ''
// Seconds between polls. 60s means an approval in Slate starts assembly
// within a minute — effectively instant against a 10–30 minute build.
const POLL_MS = Math.max(15, Number(env.POLL_SECONDS || (Number(env.POLL_MINUTES) || 0) * 60 || 60)) * 1000
if (!TOKEN) {
  console.error('QA_SERVICE_TOKEN missing — copy .env.example to .env and fill it in.')
  process.exit(1)
}

const seenPath = new URL('seen.json', import.meta.url)
const seen = new Set(existsSync(seenPath) ? JSON.parse(readFileSync(seenPath, 'utf8')) : [])

// Status goes to Slate's bot-log so people see the bot working from the QA
// page. Best-effort: a failed post never blocks the run itself.
async function botLog(level, message, data) {
  try {
    await fetch(`${BASE}/api/qa/bot-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-QA-Token': TOKEN },
      body: JSON.stringify({ level, source: 'premiere-bot', message, data }),
    })
  } catch (err) {
    console.error(new Date().toISOString(), 'bot-log post failed:', err.message)
  }
}

// Desktop notification, best-effort only — the scheduled task runs with no
// desktop session, so the bot-log above is the channel that matters.
function notify(title, body) {
  try {
    if (process.platform === 'darwin') {
      execFileSync('osascript', ['-e', `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`])
    } else if (process.platform === 'win32') {
      execFileSync('msg', ['*', '/TIME:30', `${title}: ${body}`], { timeout: 5000 })
    }
  } catch { /* headless or notifications unavailable — fine */ }
}

let busy = false

async function tick() {
  if (busy) return // one assembly at a time; the next tick picks up the rest
  let approved
  try {
    const res = await fetch(`${BASE}/api/qa/approved`, { headers: { 'X-QA-Token': TOKEN } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    approved = (await res.json()).approved
  } catch (err) {
    console.error(new Date().toISOString(), 'poll failed:', err.message)
    return
  }
  busy = true
  try {
    for (const rec of approved) {
      if (seen.has(rec.id)) continue
      seen.add(rec.id)
      writeFileSync(seenPath, JSON.stringify([...seen], null, 2))
      console.log(new Date().toISOString(), 'QA approved →', rec.title)
      await botLog('info', `Picked up "${rec.title}" (${rec.projectName ?? 'unknown show'}) — starting Premiere assembly`, { recordingId: rec.id })
      const prompt = [
        'A recording just passed QA in Slate. Follow CLAUDE.md and PREMIERE.md',
        'in this folder to draft its Premiere project. The recording:',
        JSON.stringify(rec, null, 2),
      ].join('\n')
      try {
        // Headless run; permissions come from .claude/settings.json. Output
        // goes to the console and runs.log.
        const out = execFileSync('claude', ['-p', prompt], { encoding: 'utf8', timeout: 60 * 60 * 1000 })
        appendFileSync(new URL('runs.log', import.meta.url), `${new Date().toISOString()} ${rec.id} ok: ${out.slice(0, 500).replace(/\n/g, ' ')}\n`)
        await botLog('ok', `Assembled "${rec.title}" — Premiere project drafted`, { recordingId: rec.id, summary: out.slice(0, 500) })
        notify('Premiere Bot', `Drafted: ${rec.title}`)
      } catch (err) {
        appendFileSync(new URL('runs.log', import.meta.url), `${new Date().toISOString()} ${rec.id} FAILED: ${String(err.message).slice(0, 300)}\n`)
        await botLog('error', `Assembly FAILED for "${rec.title}"`, { recordingId: rec.id, error: String(err.message).slice(0, 500) })
        notify('Premiere Bot — failed', rec.title)
      }
    }
  } finally {
    busy = false
  }
}

console.log(`Premiere Bot watching ${BASE} every ${POLL_MS / 1000}s. Ctrl-C to stop.`)
await botLog('info', `Premiere Bot online — watching for QA approvals every ${POLL_MS / 1000}s`)
await tick()
setInterval(() => void tick(), POLL_MS)

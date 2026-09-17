// Premiere Bot watcher — polls Slate's approved-QA feed and kicks off one
// headless Claude Code run per newly approved recording. Requires Node 18+
// (ships with the machine's Claude Code install) and a .env alongside it.
//
//   node poll.mjs
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
const POLL_MS = Math.max(1, Number(env.POLL_MINUTES || 5)) * 60 * 1000
if (!TOKEN) {
  console.error('QA_SERVICE_TOKEN missing — copy .env.example to .env and fill it in.')
  process.exit(1)
}

const seenPath = new URL('seen.json', import.meta.url)
const seen = new Set(existsSync(seenPath) ? JSON.parse(readFileSync(seenPath, 'utf8')) : [])

function notify(title, body) {
  try {
    execFileSync('osascript', ['-e', `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`])
  } catch { /* not macOS or notifications unavailable — fine */ }
}

async function tick() {
  let approved
  try {
    const res = await fetch(`${BASE}/api/qa/approved`, { headers: { 'X-QA-Token': TOKEN } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    approved = (await res.json()).approved
  } catch (err) {
    console.error(new Date().toISOString(), 'poll failed:', err.message)
    return
  }
  for (const rec of approved) {
    if (seen.has(rec.id)) continue
    seen.add(rec.id)
    writeFileSync(seenPath, JSON.stringify([...seen], null, 2))
    console.log(new Date().toISOString(), 'QA approved →', rec.title)
    const prompt = [
      'A recording just passed QA in Slate. Follow CLAUDE.md and PREMIERE.md',
      'in this folder to draft its Premiere project. The recording:',
      JSON.stringify(rec, null, 2),
    ].join('\n')
    try {
      // Headless run; permissions come from .claude/settings.json. Output
      // goes to the console and runs.log.
      const out = execFileSync('claude', ['-p', prompt], { encoding: 'utf8', timeout: 30 * 60 * 1000 })
      appendFileSync(new URL('runs.log', import.meta.url), `${new Date().toISOString()} ${rec.id} ok: ${out.slice(0, 500).replace(/\n/g, ' ')}\n`)
      notify('Premiere Bot', `Drafted: ${rec.title}`)
    } catch (err) {
      appendFileSync(new URL('runs.log', import.meta.url), `${new Date().toISOString()} ${rec.id} FAILED: ${String(err.message).slice(0, 300)}\n`)
      notify('Premiere Bot — failed', rec.title)
    }
  }
}

console.log(`Premiere Bot watching ${BASE} every ${POLL_MS / 60000} min. Ctrl-C to stop.`)
await tick()
setInterval(() => void tick(), POLL_MS)

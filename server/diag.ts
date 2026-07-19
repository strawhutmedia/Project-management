import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { pool } from './db'
import { appendStatusJsonl, statusReportingEnabled, writeStatusFile } from './github'
import { sendAdminAlert } from './email'

type LogEntry = { level: 'info' | 'error'; ts: string; msg: string; data?: unknown }

const RING_SIZE = 100
const ring: LogEntry[] = []
let bootStartedAt: string | null = null
let bootCompletedAt: string | null = null
let bootError: string | null = null
let lastReportedHealthy: boolean | null = null

export function logInfo(msg: string, data?: unknown) {
  const entry: LogEntry = { level: 'info', ts: new Date().toISOString(), msg, data }
  ring.push(entry)
  while (ring.length > RING_SIZE) ring.shift()
  console.log(`[slate] ${msg}`, data ?? '')
}

export function logError(msg: string, data?: unknown) {
  const entry: LogEntry = { level: 'error', ts: new Date().toISOString(), msg, data }
  ring.push(entry)
  while (ring.length > RING_SIZE) ring.shift()
  console.error(`[slate] ERROR ${msg}`, data ?? '')
  // Fire-and-forget: log to GitHub + email admin (rate limited per key).
  void appendStatusJsonl('errors.jsonl', entry)
  void sendAdminAlert(
    `Error: ${msg.slice(0, 80)}`,
    `Error in Slate at ${entry.ts}\n\n${msg}\n\nData:\n${JSON.stringify(data, null, 2)}\n\nSee https://github.com/strawhutmedia/Project-management/blob/status/errors.jsonl for the full log.`,
    `err:${msg}`,
  )
}

export function markBootStart() {
  bootStartedAt = new Date().toISOString()
}
export function markBootComplete() {
  bootCompletedAt = new Date().toISOString()
}
export function markBootError(err: unknown) {
  bootError = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
}

export async function reportStatus(): Promise<void> {
  if (!statusReportingEnabled()) {
    logInfo('GITHUB_TOKEN not set; status reporting disabled')
    return
  }
  const snapshot = await collectSnapshot()
  const healthy = snapshot.boot.error === null && snapshot.db.state === 'ok'
  const result = await writeStatusFile('latest.json', JSON.stringify(snapshot, null, 2), `status: ${healthy ? 'healthy' : 'degraded'}`)
  if (!result.ok) {
    console.error(`[slate] reportStatus: GitHub write failed:`, result.error)
    ring.push({ level: 'error', ts: new Date().toISOString(), msg: 'github_write_failed (latest.json)', data: { error: result.error } })
  } else {
    ring.push({ level: 'info', ts: new Date().toISOString(), msg: 'status reported to github', data: { file: 'latest.json' } })
  }

  if (lastReportedHealthy === false && healthy) {
    await sendAdminAlert(
      'Recovered',
      `Slate is back to healthy at ${snapshot.now}.\n\nLast boot completed at ${snapshot.boot.completedAt}.\nDB: ${snapshot.db.state}, ${snapshot.db.userCount} users, ${snapshot.db.projectCount} projects.`,
    )
  } else if (lastReportedHealthy === true && !healthy) {
    await sendAdminAlert(
      'Degraded',
      `Slate just went into a degraded state at ${snapshot.now}.\n\nBoot error: ${snapshot.boot.error}\nDB state: ${snapshot.db.state}\nDB error: ${snapshot.db.error}\n\nSee https://github.com/strawhutmedia/Project-management/blob/status/latest.json`,
    )
  }
  lastReportedHealthy = healthy
}

async function collectSnapshot() {
  const env = {
    NODE_ENV: process.env.NODE_ENV ?? null,
    PORT: process.env.PORT ?? null,
    HAS_DATABASE_URL: Boolean(process.env.DATABASE_URL),
    HAS_RESEND_API_KEY: Boolean(process.env.RESEND_API_KEY),
    HAS_GITHUB_TOKEN: Boolean(process.env.GITHUB_TOKEN),
    HAS_DEEPGRAM_API_KEY: Boolean(process.env.DEEPGRAM_API_KEY),
    HAS_ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
    HAS_DROPBOX_APP_KEY: Boolean(process.env.DROPBOX_APP_KEY),
    APP_BASE_URL: process.env.APP_BASE_URL ?? null,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL ?? 'ryan@strawhutmedia.com',
  }
  const cwd = process.cwd()
  const expectedPaths = {
    cwd,
    clientDir: path.resolve(cwd, 'dist'),
    clientIndex: path.resolve(cwd, 'dist/index.html'),
    migrationsDir: path.resolve(cwd, 'server/migrations'),
  }
  const exists = {
    clientDir: fs.existsSync(expectedPaths.clientDir),
    clientIndex: fs.existsSync(expectedPaths.clientIndex),
    migrationsDir: fs.existsSync(expectedPaths.migrationsDir),
  }
  let dbState: 'unknown' | 'ok' | 'error' = 'unknown'
  let dbError: string | null = null
  let migrationsApplied: string[] = []
  let userCount: number | null = null
  let projectCount: number | null = null
  try {
    const r = await pool.query('SELECT 1 as ok')
    if (r.rows[0]?.ok === 1) dbState = 'ok'
    try {
      const m = await pool.query(`SELECT name FROM migrations ORDER BY name`)
      migrationsApplied = m.rows.map((r: { name: string }) => r.name)
    } catch {
      // table may not exist yet
    }
    try {
      const u = await pool.query(`SELECT COUNT(*)::int as n FROM users`)
      userCount = u.rows[0].n
      const p = await pool.query(`SELECT COUNT(*)::int as n FROM projects`)
      projectCount = p.rows[0].n
    } catch {
      // tables may not exist yet
    }
  } catch (err) {
    dbState = 'error'
    dbError = err instanceof Error ? err.message : String(err)
  }
  return {
    version: '0.2.2',
    now: new Date().toISOString(),
    boot: {
      startedAt: bootStartedAt,
      completedAt: bootCompletedAt,
      error: bootError,
    },
    env,
    paths: { ...expectedPaths, exists },
    db: { state: dbState, error: dbError, migrationsApplied, userCount, projectCount },
    recentLog: ring.slice(-50),
  }
}

export const diagRouter = Router()

diagRouter.get('/', async (_req, res) => {
  const snapshot = await collectSnapshot()
  res.json(snapshot)
})

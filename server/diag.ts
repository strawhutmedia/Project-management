import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { pool } from './db'

type LogEntry = { level: 'info' | 'error'; ts: string; msg: string; data?: unknown }

const RING_SIZE = 100
const ring: LogEntry[] = []
let bootStartedAt: string | null = null
let bootCompletedAt: string | null = null
let bootError: string | null = null

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

export const diagRouter = Router()

diagRouter.get('/', async (_req, res) => {
  const env = {
    NODE_ENV: process.env.NODE_ENV ?? null,
    PORT: process.env.PORT ?? null,
    HAS_DATABASE_URL: Boolean(process.env.DATABASE_URL),
    HAS_RESEND_API_KEY: Boolean(process.env.RESEND_API_KEY),
    APP_BASE_URL: process.env.APP_BASE_URL ?? null,
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
  res.json({
    version: '0.2.1',
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
  })
})

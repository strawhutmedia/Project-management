import crypto from 'crypto'
import type { Request, Response, NextFunction } from 'express'
import { pool } from './db'

export const SESSION_COOKIE = 'slate_session'
const SESSION_DAYS = 30

export function makeToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url')
}

export type UserRole = 'admin' | 'user' | 'viewer'

export type SessionUser = {
  id: string
  email: string
  name: string
  display_name: string | null
  role: UserRole
  timezone: string
}

// Convenience: returns true for viewer accounts (read-only). Used by
// any route that allows non-admin writes — songs, tasks, comments,
// transcripts, budget edits, stripboard moves, etc.
export function isViewer(user: { role: UserRole }): boolean {
  return user.role === 'viewer'
}

// Router-level middleware: blocks viewer accounts from any write request
// (POST/PATCH/PUT/DELETE) on the router it's attached to. Reads are
// always allowed. Mount AFTER requireUser so req.user is populated.
export function blockViewerWrites(req: Request, res: Response, next: NextFunction) {
  const u = (req as Request & { user?: SessionUser }).user
  if (!u) { next(); return } // requireUser will have rejected already
  if (!isViewer(u)) { next(); return }
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next(); return
  }
  res.status(403).json({ error: 'read_only' })
}

export async function createSession(userId: string): Promise<string> {
  const id = makeToken(32)
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  await pool.query('INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)', [
    id,
    userId,
    expiresAt,
  ])
  return id
}

export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const sid = req.cookies?.[SESSION_COOKIE]
  if (!sid) return null
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name, u.display_name, u.role, u.timezone
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.expires_at > now()`,
    [sid],
  )
  if (rows.length === 0) return null
  return rows[0] as SessionUser
}

export function setSessionCookie(res: Response, sid: string) {
  const isProd = process.env.NODE_ENV === 'production'
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  })
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/' })
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const u = await getSessionUser(req)
  if (!u) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  ;(req as Request & { user: SessionUser }).user = u
  next()
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const u = await getSessionUser(req)
  if (!u || u.role !== 'admin') {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  ;(req as Request & { user: SessionUser }).user = u
  next()
}

// The invoicing / payroll tool is locked to a SINGLE owner account — not
// just any admin. Contractor pay is nobody else's business. Defaults to
// Ryan; override with the INVOICING_OWNER_EMAIL env var if ownership moves.
export function ownerEmail(): string {
  return (process.env.INVOICING_OWNER_EMAIL || 'ryan@strawhutmedia.com').trim().toLowerCase()
}

export function isOwner(user: { email: string }): boolean {
  return (user.email || '').trim().toLowerCase() === ownerEmail()
}

export async function requireOwner(req: Request, res: Response, next: NextFunction) {
  const u = await getSessionUser(req)
  if (!u || !isOwner(u)) {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  ;(req as Request & { user: SessionUser }).user = u
  next()
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

// Like requireOwner, but ALSO accepts a service token (INVOICING_SERVICE_TOKEN)
// via `X-Invoicing-Token` or `Authorization: Bearer` header. This lets the
// monthly invoice automation create/save invoices without a browser session.
// When authenticated by token, the request acts AS the owner account (so
// created_by is attributed to Ryan). The token is only honored when the env
// var is set; rotating or clearing it immediately revokes automation access.
export async function requireOwnerOrService(req: Request, res: Response, next: NextFunction) {
  const expected = (process.env.INVOICING_SERVICE_TOKEN || '').trim()
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : ''
  const header =
    (typeof req.headers['x-invoicing-token'] === 'string' ? (req.headers['x-invoicing-token'] as string).trim() : '') ||
    (authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '')
  if (expected && header && safeEqual(header, expected)) {
    const { rows } = await pool.query(
      `SELECT id, email, name, display_name, role, timezone FROM users WHERE lower(email) = $1 LIMIT 1`,
      [ownerEmail()],
    )
    if (!rows[0]) { res.status(500).json({ error: 'owner_user_missing' }); return }
    ;(req as Request & { user: SessionUser }).user = rows[0] as SessionUser
    next()
    return
  }
  return requireOwner(req, res, next)
}

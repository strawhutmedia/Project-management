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

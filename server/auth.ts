import crypto from 'crypto'
import type { Request, Response, NextFunction } from 'express'
import { pool } from './db'

export const SESSION_COOKIE = 'slate_session'
const SESSION_DAYS = 30

export function makeToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url')
}

export type SessionUser = {
  id: string
  email: string
  name: string
  role: 'admin' | 'user'
  timezone: string
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
    `SELECT u.id, u.email, u.name, u.role, u.timezone
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

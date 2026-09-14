import { Router } from 'express'
import { pool } from '../db'
import {
  clearSessionCookie,
  createSession,
  makeToken,
  setSessionCookie,
} from '../auth'
import { sendMagicLink } from '../email'
import { logError, logInfo } from '../diag'

export const authRouter = Router()

const TOKEN_TTL_MIN = 15

function appBaseUrl(): string {
  const fromEnv = process.env.APP_BASE_URL
  if (fromEnv) return fromEnv.replace(/\/+$/, '')
  return 'https://slate.strawhutmedia.com'
}

authRouter.post('/request', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'invalid email' })
    return
  }

  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email])
  if (rows.length === 0) {
    res.json({ ok: true })
    return
  }

  const token = makeToken(24)
  const expires = new Date(Date.now() + TOKEN_TTL_MIN * 60 * 1000)
  await pool.query(
    'INSERT INTO magic_tokens (token, email, expires_at) VALUES ($1, $2, $3)',
    [token, email, expires],
  )

  const link = `${appBaseUrl()}/auth/verify?token=${token}`
  try {
    await sendMagicLink(email, link)
    logInfo('magic link sent', { email })
  } catch (err) {
    logError('magic link send failed', {
      email,
      error: err instanceof Error ? err.message : String(err),
      from: process.env.MAIL_FROM || 'Slate <slate@strawhutmedia.com>',
    })
    res.status(500).json({ error: 'email_failed' })
    return
  }

  res.json({ ok: true })
})

authRouter.post('/verify', async (req, res) => {
  const token = String(req.body?.token || '')
  if (!token) {
    res.status(400).json({ error: 'missing token' })
    return
  }

  const { rows } = await pool.query(
    `SELECT email, expires_at, used_at FROM magic_tokens WHERE token = $1`,
    [token],
  )
  if (rows.length === 0) {
    res.status(400).json({ error: 'invalid_token' })
    return
  }
  const row = rows[0]
  if (row.used_at) {
    res.status(400).json({ error: 'token_used' })
    return
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    res.status(400).json({ error: 'token_expired' })
    return
  }

  await pool.query('UPDATE magic_tokens SET used_at = now() WHERE token = $1', [token])

  const userRes = await pool.query(
    'SELECT id, email, name, role, timezone, is_invoicing_owner FROM users WHERE email = $1',
    [row.email],
  )
  if (userRes.rows.length === 0) {
    res.status(400).json({ error: 'no_user' })
    return
  }
  const user = userRes.rows[0]
  const sid = await createSession(user.id)
  setSessionCookie(res, sid)
  res.json({ ok: true, user })
})

authRouter.post('/logout', async (req, res) => {
  const sid = req.cookies?.slate_session
  if (sid) {
    await pool.query('DELETE FROM sessions WHERE id = $1', [sid])
  }
  clearSessionCookie(res)
  res.json({ ok: true })
})

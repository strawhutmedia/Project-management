import { Router } from 'express'
import crypto from 'crypto'
import { requireOwner, type SessionUser } from '../auth'
import { logError } from '../diag'
import * as qb from '../quickbooks'

// QuickBooks OAuth connect flow. Owner-only. The callback is hit by the
// owner's browser after authorizing at Intuit (session cookie rides along on
// the top-level redirect), and a CSRF state cookie guards it.
export const quickbooksRouter = Router()

const STATE_COOKIE = 'qb_oauth_state'

quickbooksRouter.get('/status', requireOwner, async (_req, res) => {
  try {
    const c = await qb.getConnection()
    res.json({
      configured: qb.configured(),
      connected: Boolean(c),
      env: qb.qbEnv(),
      realmId: c?.realm_id ?? null,
      redirectUri: qb.redirectUri(),
    })
  } catch (err) {
    logError('qb status failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

quickbooksRouter.get('/connect', requireOwner, (req, res) => {
  if (!qb.configured()) {
    res.status(400).send('QuickBooks is not configured (QB_CLIENT_ID / QB_CLIENT_SECRET missing).')
    return
  }
  const state = crypto.randomBytes(16).toString('hex')
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 10 * 60 * 1000,
    path: '/',
  })
  res.redirect(qb.authorizeUrl(state))
})

quickbooksRouter.get('/callback', requireOwner, async (req, res) => {
  const q = req.query as Record<string, string | undefined>
  try {
    const code = q.code
    const realmId = q.realmId
    const state = q.state
    const expected = req.cookies?.[STATE_COOKIE]
    if (!code || !realmId) { res.redirect('/invoicing?qb=error'); return }
    if (!expected || !state || state !== expected) { res.redirect('/invoicing?qb=state'); return }
    const user = (req as typeof req & { user: SessionUser }).user
    const tokens = await qb.exchangeCode(code)
    await qb.saveConnection(realmId, tokens, user.id)
    res.clearCookie(STATE_COOKIE, { path: '/' })
    res.redirect('/invoicing?qb=connected')
  } catch (err) {
    logError('qb callback failed', { error: err instanceof Error ? err.message : String(err) })
    res.redirect('/invoicing?qb=error')
  }
})

quickbooksRouter.post('/disconnect', requireOwner, async (_req, res) => {
  try {
    await qb.clearConnection()
    res.json({ ok: true })
  } catch (err) {
    logError('qb disconnect failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

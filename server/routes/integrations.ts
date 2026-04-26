import { Router } from 'express'
import crypto from 'crypto'
import { requireAdmin, requireUser, type SessionUser } from '../auth'
import {
  buildAuthorizeUrl,
  createFolder,
  deleteIntegration,
  exchangeCodeForToken,
  getCurrentAccount,
  getDropboxAppKey,
  getIntegration,
  listFolder,
  saveIntegration,
} from '../dropbox'
import { logError } from '../diag'

export const integrationsRouter = Router()

// Status: anyone signed in can see whether Dropbox is connected.
integrationsRouter.get('/dropbox/status', requireUser, async (_req, res) => {
  const integration = await getIntegration()
  if (!integration) {
    res.json({ connected: false, configured: Boolean(getDropboxAppKey()) })
    return
  }
  res.json({
    connected: true,
    configured: true,
    accountName: integration.account_name ?? null,
  })
})

// Admin-only: start OAuth.
const oauthState = new Map<string, number>()
integrationsRouter.get('/dropbox/connect', requireAdmin, async (_req, res) => {
  if (!getDropboxAppKey()) {
    res.status(500).json({ error: 'dropbox_not_configured' })
    return
  }
  const state = crypto.randomBytes(16).toString('base64url')
  oauthState.set(state, Date.now())
  // garbage collect old states
  for (const [k, t] of oauthState) {
    if (Date.now() - t > 10 * 60 * 1000) oauthState.delete(k)
  }
  res.redirect(buildAuthorizeUrl(state))
})

// OAuth callback (admin only via cookie session).
integrationsRouter.get('/dropbox/callback', requireAdmin, async (req, res) => {
  const code = String(req.query.code || '')
  const state = String(req.query.state || '')
  if (!code || !state || !oauthState.has(state)) {
    res.status(400).send('Invalid OAuth state. Please retry from Settings.')
    return
  }
  oauthState.delete(state)
  try {
    const token = await exchangeCodeForToken(code)
    let accountName: string | undefined
    await saveIntegration(token, undefined)
    const acct = await getCurrentAccount()
    if (acct.ok) {
      accountName = acct.name
      await saveIntegration(token, accountName)
    }
    res.redirect('/settings?dropbox=connected')
  } catch (err) {
    logError('dropbox: callback failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).send('Dropbox connection failed. Check server logs.')
  }
})

integrationsRouter.post('/dropbox/disconnect', requireAdmin, async (_req, res) => {
  await deleteIntegration()
  res.json({ ok: true })
})

integrationsRouter.get('/dropbox/list', requireUser, async (req, res) => {
  const folder = String(req.query.path || '')
  if (!folder) {
    res.status(400).json({ error: 'path_required' })
    return
  }
  const result = await listFolder(folder)
  if (!result.ok) {
    res.status(404).json({ error: result.error })
    return
  }
  res.json({ entries: result.entries })
})

integrationsRouter.post('/dropbox/create-folder', requireUser, async (req, res) => {
  const _user = (req as typeof req & { user: SessionUser }).user
  const folder = String(req.body?.path || '')
  if (!folder) {
    res.status(400).json({ error: 'path_required' })
    return
  }
  const result = await createFolder(folder)
  if (!result.ok) {
    res.status(500).json({ error: result.error })
    return
  }
  res.json({ ok: true })
})

import express, { Router } from 'express'
import crypto from 'crypto'
import { pool } from '../db'
import { requireAdmin, requireUser, type SessionUser } from '../auth'
import {
  buildAuthorizeUrl,
  createFolder,
  createSharedLink,
  deleteIntegration,
  exchangeCodeForToken,
  getCurrentAccount,
  getDropboxAppKey,
  getIntegration,
  listFolder,
  saveIntegration,
  uploadFile,
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
    pickerStartPath: integration.picker_start_path ?? null,
  })
})

// Admin-only: set the default starting folder for Dropbox file/folder
// pickers. Used so users opening "Pick a media file" land on the team
// folder instead of the personal Dropbox root.
integrationsRouter.post('/dropbox/picker-start', requireAdmin, async (req, res) => {
  const integration = await getIntegration()
  if (!integration) {
    res.status(400).json({ error: 'not_connected' }); return
  }
  const raw = String(req.body?.path ?? '').trim()
  // Normalize: empty string clears the override; otherwise enforce a
  // leading slash and strip trailing slashes.
  const path = raw === '' ? '' : ('/' + raw.replace(/^\/+/, '').replace(/\/+$/, ''))
  await pool.query(
    `UPDATE integrations
       SET data = data || jsonb_build_object('picker_start_path', $1::text),
           updated_at = now()
     WHERE kind = 'dropbox'`,
    [path],
  )
  res.json({ ok: true, pickerStartPath: path })
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

// Scope guard: every Dropbox file operation must either come from a
// workspace admin (Super Admin — can browse anywhere, used by the
// admin-only folder pickers) OR carry a scopeSongId, in which case
// the requested path must live inside that song's assigned Dropbox
// folder. This prevents non-admin users from poking around the rest
// of Dropbox via the API.
function isPathWithin(child: string, parent: string): boolean {
  if (!parent) return false
  const c = child.replace(/\/+$/, '')
  const p = parent.replace(/\/+$/, '')
  return c === p || c.startsWith(p + '/')
}

async function assertDropboxPathAllowed(
  user: SessionUser,
  path: string,
  scopeSongId: string | null,
  scopeProjectId: string | null = null,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (user.role === 'admin') return { ok: true }
  if (!scopeSongId && !scopeProjectId) return { ok: false, status: 403, error: 'scope_required' }
  // Song scope: stricter — must be inside the song's folder.
  if (scopeSongId) {
    const { rows } = await pool.query<{ dropbox_folder: string | null; project_id: string }>(
      `SELECT s.dropbox_folder, s.project_id FROM songs s WHERE s.id = $1`,
      [scopeSongId],
    )
    if (rows.length === 0) return { ok: false, status: 404, error: 'song_not_found' }
    const songRoot = rows[0].dropbox_folder
    if (!songRoot) return { ok: false, status: 400, error: 'song_has_no_folder' }
    const access = await pool.query(
      `SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2 LIMIT 1`,
      [rows[0].project_id, user.id],
    )
    if (access.rows.length === 0) return { ok: false, status: 403, error: 'forbidden' }
    if (!isPathWithin(path, songRoot)) {
      return { ok: false, status: 403, error: `out_of_scope:path_must_be_within:${songRoot}` }
    }
    return { ok: true }
  }
  // Project scope: looser — anywhere inside the project's root folder.
  const { rows } = await pool.query<{ dropbox_folder: string | null }>(
    `SELECT dropbox_folder FROM projects WHERE id = $1`,
    [scopeProjectId],
  )
  if (rows.length === 0) return { ok: false, status: 404, error: 'project_not_found' }
  const projectRoot = rows[0].dropbox_folder
  if (!projectRoot) return { ok: false, status: 400, error: 'project_has_no_folder' }
  const access = await pool.query(
    `SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2 LIMIT 1`,
    [scopeProjectId, user.id],
  )
  if (access.rows.length === 0) return { ok: false, status: 403, error: 'forbidden' }
  if (!isPathWithin(path, projectRoot)) {
    return { ok: false, status: 403, error: `out_of_scope:path_must_be_within:${projectRoot}` }
  }
  return { ok: true }
}

integrationsRouter.get('/dropbox/list', requireUser, async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const folder = String(req.query.path || '')
  const scopeSongId = req.query.scopeSongId ? String(req.query.scopeSongId) : null
  const scopeProjectId = req.query.scopeProjectId ? String(req.query.scopeProjectId) : null
  if (!folder) {
    res.status(400).json({ error: 'path_required' })
    return
  }
  const guard = await assertDropboxPathAllowed(user, folder, scopeSongId, scopeProjectId)
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return }
  const result = await listFolder(folder)
  if (!result.ok) {
    res.status(404).json({ error: result.error })
    return
  }
  res.json({ entries: result.entries })
})

integrationsRouter.post('/dropbox/create-folder', requireUser, async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const folder = String(req.body?.path || '')
  const scopeSongId = req.body?.scopeSongId ? String(req.body.scopeSongId) : null
  const scopeProjectId = req.body?.scopeProjectId ? String(req.body.scopeProjectId) : null
  if (!folder) {
    res.status(400).json({ error: 'path_required' })
    return
  }
  const guard = await assertDropboxPathAllowed(user, folder, scopeSongId, scopeProjectId)
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return }
  const result = await createFolder(folder)
  if (!result.ok) {
    res.status(500).json({ error: result.error })
    return
  }
  res.json({ ok: true })
})

// Upload a file. Body is the raw file bytes; folder + filename in headers.
const MAX_UPLOAD = 150 * 1024 * 1024 // 150 MB single-shot Dropbox limit
integrationsRouter.post(
  '/dropbox/upload',
  requireUser,
  express.raw({ type: 'application/octet-stream', limit: MAX_UPLOAD }),
  async (req, res) => {
    const user = (req as typeof req & { user: SessionUser }).user
    const folderPath = String(req.headers['x-folder-path'] || '')
    const fileName = String(req.headers['x-file-name'] || '')
    const scopeSongId = req.headers['x-scope-song-id']
      ? String(req.headers['x-scope-song-id'])
      : null
    const scopeProjectId = req.headers['x-scope-project-id']
      ? String(req.headers['x-scope-project-id'])
      : null
    if (!folderPath || !fileName) {
      res.status(400).json({ error: 'missing_headers' })
      return
    }
    const guard = await assertDropboxPathAllowed(user, folderPath, scopeSongId, scopeProjectId)
    if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: 'empty_body' })
      return
    }
    if (req.body.length > MAX_UPLOAD) {
      res.status(413).json({ error: 'file_too_large_150mb_limit' })
      return
    }
    const result = await uploadFile(folderPath, decodeURIComponent(fileName), req.body)
    if (!result.ok) {
      res.status(500).json({ error: result.error })
      return
    }
    res.json({ ok: true, path: result.path })
  },
)

// Get a shared link for a Dropbox path (used when adding a Dropbox file as a song "Link").
integrationsRouter.post('/dropbox/share-link', requireUser, async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const path = String(req.body?.path || '')
  const scopeSongId = req.body?.scopeSongId ? String(req.body.scopeSongId) : null
  const scopeProjectId = req.body?.scopeProjectId ? String(req.body.scopeProjectId) : null
  if (!path) {
    res.status(400).json({ error: 'path_required' })
    return
  }
  const guard = await assertDropboxPathAllowed(user, path, scopeSongId, scopeProjectId)
  if (!guard.ok) { res.status(guard.status).json({ error: guard.error }); return }
  const result = await createSharedLink(path)
  if (!result.ok) {
    res.status(500).json({ error: result.error })
    return
  }
  res.json({ url: result.url })
})

// GET /api/integrations/dropbox/file?path=…
// Resolves a Dropbox path to a fresh temp link and 302-redirects the
// browser straight to it. Used as the <img src> for stills extracted
// by the social-plan auto-pipeline (Dropbox temp links last 4hr; we
// resolve per-request so they don't go stale in the DB / API payload).
integrationsRouter.get('/dropbox/file', requireUser, async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const filePath = String(req.query.path || '')
  if (!filePath) { res.status(400).send('path required'); return }

  // Allowlist:
  //   - Slate-managed asset prefixes (stills + clips we extracted)
  //   - Any path under a project's brand_assets_folder when the user
  //     can access that project. Lets the brand-assets card render
  //     inline thumbnails of curated Dropbox images.
  let allowed = filePath.startsWith('/slate-stills/') || filePath.startsWith('/slate-clips/')
  if (!allowed) {
    const { pool } = await import('../db')
    if (user.role === 'admin') {
      // Super admins can browse any configured brand-assets folder.
      const { rows } = await pool.query<{ folder: string }>(
        `SELECT brand_assets_folder AS folder FROM projects
          WHERE brand_assets_folder IS NOT NULL`,
      )
      for (const r of rows) {
        if (filePath === r.folder || filePath.startsWith(r.folder + '/')) {
          allowed = true; break
        }
      }
    } else {
      // Regular users: only folders on projects they're a member of.
      const { rows } = await pool.query<{ folder: string }>(
        `SELECT p.brand_assets_folder AS folder
           FROM projects p
           LEFT JOIN project_members m
             ON m.project_id = p.id AND m.user_id = $1
          WHERE p.brand_assets_folder IS NOT NULL
            AND (p.created_by = $1 OR m.user_id IS NOT NULL)`,
        [user.id],
      )
      for (const r of rows) {
        if (filePath === r.folder || filePath.startsWith(r.folder + '/')) {
          allowed = true; break
        }
      }
    }
  }
  if (!allowed) { res.status(403).send('forbidden'); return }

  const { getTemporaryLink } = await import('../dropbox')
  const link = await getTemporaryLink(filePath)
  if (!link.ok || !link.url) {
    res.status(502).send(link.error || 'temp_link_failed'); return
  }
  res.redirect(302, link.url)
})

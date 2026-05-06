import { pool } from './db'
import { logError, logInfo } from './diag'

const DROPBOX_OAUTH = 'https://www.dropbox.com/oauth2/authorize'
const DROPBOX_TOKEN = 'https://api.dropboxapi.com/oauth2/token'
const DROPBOX_API = 'https://api.dropboxapi.com/2'

export function getDropboxAppKey(): string | null {
  return process.env.DROPBOX_APP_KEY || null
}

function getAppSecret(): string | null {
  return process.env.DROPBOX_APP_SECRET || null
}

export function getRedirectUri(): string {
  const base = (process.env.APP_BASE_URL || 'https://slate.strawhutmedia.com').replace(/\/+$/, '')
  return `${base}/api/integrations/dropbox/callback`
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: getDropboxAppKey() || '',
    response_type: 'code',
    redirect_uri: getRedirectUri(),
    token_access_type: 'offline',
    state,
  })
  return `${DROPBOX_OAUTH}?${params.toString()}`
}

type DropboxTokenData = {
  access_token: string
  refresh_token?: string
  token_type: string
  expires_in: number
  account_id?: string
  uid?: string
}

export async function exchangeCodeForToken(code: string): Promise<DropboxTokenData> {
  const params = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: getDropboxAppKey() || '',
    client_secret: getAppSecret() || '',
    redirect_uri: getRedirectUri(),
  })
  const res = await fetch(DROPBOX_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`dropbox_token_exchange_failed: ${res.status} ${text.slice(0, 300)}`)
  }
  return (await res.json()) as DropboxTokenData
}

async function refreshAccessToken(refreshToken: string): Promise<DropboxTokenData> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: getDropboxAppKey() || '',
    client_secret: getAppSecret() || '',
  })
  const res = await fetch(DROPBOX_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`dropbox_refresh_failed: ${res.status} ${text.slice(0, 300)}`)
  }
  const data = (await res.json()) as DropboxTokenData
  return { ...data, refresh_token: refreshToken }
}

export type StoredIntegration = {
  access_token: string
  refresh_token?: string
  expires_at: string
  account_id?: string
  account_name?: string
  // Dropbox path root for team folder access (vs personal namespace).
  // Set to the team's root_namespace_id when the user is on a team account.
  root_namespace_id?: string
  // Workspace-wide default starting folder for file/folder pickers.
  // Lets the admin point Slate at the team folder so picker dialogs
  // never expose anyone's personal Dropbox tree.
  picker_start_path?: string
}

export async function saveIntegration(token: DropboxTokenData, accountName?: string, rootNamespaceId?: string): Promise<void> {
  const expiresAt = new Date(Date.now() + (token.expires_in - 60) * 1000).toISOString()
  // Preserve existing fields if updating
  const existing = await getIntegration()
  const data: StoredIntegration = {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_at: expiresAt,
    account_id: token.account_id,
    account_name: accountName ?? existing?.account_name,
    root_namespace_id: rootNamespaceId ?? existing?.root_namespace_id,
  }
  await pool.query(
    `INSERT INTO integrations (kind, data, updated_at) VALUES ('dropbox', $1::jsonb, now())
     ON CONFLICT (kind) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [JSON.stringify(data)],
  )
  logInfo('dropbox: integration saved', { account_id: token.account_id, hasRootNamespace: Boolean(data.root_namespace_id) })
}

export async function getIntegration(): Promise<StoredIntegration | null> {
  const { rows } = await pool.query(`SELECT data FROM integrations WHERE kind = 'dropbox'`)
  if (rows.length === 0) return null
  return rows[0].data as StoredIntegration
}

export async function deleteIntegration(): Promise<void> {
  await pool.query(`DELETE FROM integrations WHERE kind = 'dropbox'`)
}

async function getValidAccessToken(): Promise<string | null> {
  const integration = await getIntegration()
  if (!integration) return null
  const expired = Date.now() > new Date(integration.expires_at).getTime()
  if (!expired) return integration.access_token
  if (!integration.refresh_token) return null
  try {
    const refreshed = await refreshAccessToken(integration.refresh_token)
    await saveIntegration(refreshed, integration.account_name, integration.root_namespace_id)
    return refreshed.access_token
  } catch (err) {
    logError('dropbox: refresh failed', { error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

// Build request headers including the team-folder Path-Root header when
// the integration has a stored team root namespace. Without this header,
// Dropbox API calls operate in the user's personal namespace and will not
// see team-shared folders.
async function buildHeaders(extra: Record<string, string> = {}): Promise<Record<string, string> | null> {
  const token = await getValidAccessToken()
  if (!token) return null
  const integration = await getIntegration()
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...extra,
  }
  if (integration?.root_namespace_id) {
    headers['Dropbox-API-Path-Root'] = JSON.stringify({
      '.tag': 'root',
      root: integration.root_namespace_id,
    })
  }
  return headers
}

// Fetches root_info from get_current_account and stores root_namespace_id
// so subsequent calls can use the team's path root. Idempotent — safe to
// call repeatedly; only writes if missing or stale.
export async function ensureRootNamespace(): Promise<void> {
  const integration = await getIntegration()
  if (!integration) return
  if (integration.root_namespace_id) return
  const token = await getValidAccessToken()
  if (!token) return
  const res = await fetch(`${DROPBOX_API}/users/get_current_account`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return
  const data = (await res.json()) as {
    name?: { display_name: string }
    email?: string
    root_info?: { root_namespace_id?: string }
  }
  const namespaceId = data.root_info?.root_namespace_id
  if (!namespaceId) return
  await pool.query(
    `UPDATE integrations
     SET data = data || jsonb_build_object('root_namespace_id', $1::text),
         updated_at = now()
     WHERE kind = 'dropbox'`,
    [namespaceId],
  )
  logInfo('dropbox: root_namespace_id captured', { namespaceId })
}

export type DropboxEntry = {
  type: 'file' | 'folder'
  name: string
  path: string
  size?: number
  modified?: string
}

export async function listFolder(folderPath: string): Promise<{ ok: true; entries: DropboxEntry[] } | { ok: false; error: string }> {
  await ensureRootNamespace()
  const headers = await buildHeaders({ 'Content-Type': 'application/json' })
  if (!headers) return { ok: false, error: 'not_connected' }
  // Dropbox API quirk: root folder is empty string, not "/"
  const apiPath = folderPath === '/' ? '' : folderPath.replace(/\/$/, '')
  let res: Response
  try {
    // 20s ceiling so a hung Dropbox call doesn't outlive iOS Safari's
    // network timeout — we'd rather return a 504 than have the client
    // throw the generic "Load failed".
    res = await fetch(`${DROPBOX_API}/files/list_folder`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ path: apiPath, recursive: false, include_deleted: false }),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logError('dropbox.listFolder fetch failed', { path: folderPath, error: msg })
    return { ok: false, error: `dropbox_unreachable: ${msg.slice(0, 200)}` }
  }
  if (!res.ok) {
    const text = await res.text()
    logError('dropbox.listFolder non-2xx', { path: folderPath, status: res.status, body: text.slice(0, 500) })
    if (res.status === 409) {
      // path/not_found etc. — surface as a soft error
      return { ok: false, error: `not_found: ${folderPath}` }
    }
    return { ok: false, error: `dropbox_${res.status}: ${text.slice(0, 200)}` }
  }
  const data = (await res.json()) as {
    entries: Array<{
      '.tag': 'file' | 'folder'
      name: string
      path_display: string
      size?: number
      server_modified?: string
    }>
  }
  return {
    ok: true,
    entries: data.entries.map((e) => ({
      type: e['.tag'],
      name: e.name,
      path: e.path_display,
      size: e.size,
      modified: e.server_modified,
    })),
  }
}

export async function createFolder(folderPath: string): Promise<{ ok: boolean; error?: string }> {
  await ensureRootNamespace()
  const headers = await buildHeaders({ 'Content-Type': 'application/json' })
  if (!headers) return { ok: false, error: 'not_connected' }
  const res = await fetch(`${DROPBOX_API}/files/create_folder_v2`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ path: folderPath, autorename: false }),
  })
  if (res.ok) return { ok: true }
  const text = await res.text()
  // 409 = folder already exists, treat as success
  if (res.status === 409 && text.includes('conflict')) return { ok: true }
  return { ok: false, error: `dropbox_${res.status}: ${text.slice(0, 200)}` }
}

const SINGLE_SHOT_LIMIT = 140 * 1024 * 1024 // 140 MB — under Dropbox's 150 MB cap
const CHUNK_SIZE = 8 * 1024 * 1024 // 8 MB chunks for upload sessions

export async function uploadFile(folderPath: string, fileName: string, body: Buffer): Promise<{ ok: boolean; path?: string; error?: string }> {
  await ensureRootNamespace()
  const headers = await buildHeaders({ 'Content-Type': 'application/octet-stream' })
  if (!headers) return { ok: false, error: 'not_connected' }
  const fullPath = `${folderPath.replace(/\/$/, '')}/${fileName}`

  if (body.length <= SINGLE_SHOT_LIMIT) {
    const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        ...headers,
        'Dropbox-API-Arg': JSON.stringify({
          path: fullPath,
          mode: 'add',
          autorename: true,
          mute: false,
        }),
      },
      body: new Uint8Array(body),
    })
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, error: `dropbox_${res.status}: ${text.slice(0, 200)}` }
    }
    const data = (await res.json()) as { path_display: string }
    return { ok: true, path: data.path_display }
  }

  // Chunked upload session for files larger than the single-shot limit.
  // Step 1: start session with first chunk
  const first = body.slice(0, CHUNK_SIZE)
  const startRes = await fetch('https://content.dropboxapi.com/2/files/upload_session/start', {
    method: 'POST',
    headers: { ...headers, 'Dropbox-API-Arg': JSON.stringify({ close: false }) },
    body: new Uint8Array(first),
  })
  if (!startRes.ok) {
    const text = await startRes.text()
    return { ok: false, error: `dropbox_session_start_${startRes.status}: ${text.slice(0, 200)}` }
  }
  const startData = (await startRes.json()) as { session_id: string }
  const sessionId = startData.session_id

  // Step 2: append remaining chunks (all but the last)
  let offset = first.length
  const lastStart = Math.max(offset, body.length - CHUNK_SIZE)
  while (offset < lastStart) {
    const chunk = body.slice(offset, Math.min(offset + CHUNK_SIZE, lastStart))
    const r = await fetch('https://content.dropboxapi.com/2/files/upload_session/append_v2', {
      method: 'POST',
      headers: {
        ...headers,
        'Dropbox-API-Arg': JSON.stringify({
          cursor: { session_id: sessionId, offset },
          close: false,
        }),
      },
      body: new Uint8Array(chunk),
    })
    if (!r.ok) {
      const text = await r.text()
      return { ok: false, error: `dropbox_session_append_${r.status}: ${text.slice(0, 200)}` }
    }
    offset += chunk.length
  }

  // Step 3: finish with the final chunk + commit metadata
  const finalChunk = body.slice(offset)
  const finishRes = await fetch('https://content.dropboxapi.com/2/files/upload_session/finish', {
    method: 'POST',
    headers: {
      ...headers,
      'Dropbox-API-Arg': JSON.stringify({
        cursor: { session_id: sessionId, offset },
        commit: { path: fullPath, mode: 'add', autorename: true, mute: false },
      }),
    },
    body: new Uint8Array(finalChunk),
  })
  if (!finishRes.ok) {
    const text = await finishRes.text()
    return { ok: false, error: `dropbox_session_finish_${finishRes.status}: ${text.slice(0, 200)}` }
  }
  const finishData = (await finishRes.json()) as { path_display: string }
  return { ok: true, path: finishData.path_display }
}

export async function getTemporaryLink(filePath: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  await ensureRootNamespace()
  const headers = await buildHeaders({ 'Content-Type': 'application/json' })
  if (!headers) return { ok: false, error: 'not_connected' }
  const res = await fetch(`${DROPBOX_API}/files/get_temporary_link`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ path: filePath }),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `dropbox_${res.status}: ${text.slice(0, 200)}` }
  }
  const data = (await res.json()) as { link: string }
  return { ok: true, url: data.link }
}

export async function createSharedLink(filePath: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  await ensureRootNamespace()
  const headers = await buildHeaders({ 'Content-Type': 'application/json' })
  if (!headers) return { ok: false, error: 'not_connected' }
  const res = await fetch(`${DROPBOX_API}/sharing/create_shared_link_with_settings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ path: filePath, settings: { audience: 'public', access: 'viewer' } }),
  })
  if (res.ok) {
    const data = (await res.json()) as { url: string }
    return { ok: true, url: data.url }
  }
  // 409 = already shared, fetch the existing shared link
  if (res.status === 409) {
    const listRes = await fetch(`${DROPBOX_API}/sharing/list_shared_links`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ path: filePath, direct_only: true }),
    })
    if (listRes.ok) {
      const listData = (await listRes.json()) as { links: Array<{ url: string }> }
      if (listData.links.length > 0) return { ok: true, url: listData.links[0].url }
    }
  }
  const text = await res.text()
  return { ok: false, error: `dropbox_${res.status}: ${text.slice(0, 200)}` }
}

// File metadata — used to size-check before submitting to Deepgram so we
// can refuse files that exceed our 2GB cap with a clear error.
export async function getFileMetadata(filePath: string): Promise<{
  ok: boolean
  size?: number
  name?: string
  modified?: string
  error?: string
}> {
  await ensureRootNamespace()
  const headers = await buildHeaders({ 'Content-Type': 'application/json' })
  if (!headers) return { ok: false, error: 'not_connected' }
  const res = await fetch(`${DROPBOX_API}/files/get_metadata`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ path: filePath, include_deleted: false }),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `dropbox_${res.status}: ${text.slice(0, 200)}` }
  }
  const data = (await res.json()) as {
    '.tag': 'file' | 'folder'
    name: string
    size?: number
    server_modified?: string
  }
  if (data['.tag'] !== 'file') return { ok: false, error: 'not_a_file' }
  return { ok: true, size: data.size, name: data.name, modified: data.server_modified }
}

export async function getCurrentAccount(): Promise<{ ok: boolean; name?: string; email?: string; error?: string }> {
  const token = await getValidAccessToken()
  if (!token) return { ok: false, error: 'not_connected' }
  const res = await fetch(`${DROPBOX_API}/users/get_current_account`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `dropbox_${res.status}: ${text.slice(0, 200)}` }
  }
  const data = (await res.json()) as {
    name?: { display_name: string }
    email?: string
  }
  return { ok: true, name: data.name?.display_name, email: data.email }
}

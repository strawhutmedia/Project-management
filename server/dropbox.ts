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
}

export async function saveIntegration(token: DropboxTokenData, accountName?: string): Promise<void> {
  const expiresAt = new Date(Date.now() + (token.expires_in - 60) * 1000).toISOString()
  const data: StoredIntegration = {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_at: expiresAt,
    account_id: token.account_id,
    account_name: accountName,
  }
  await pool.query(
    `INSERT INTO integrations (kind, data, updated_at) VALUES ('dropbox', $1::jsonb, now())
     ON CONFLICT (kind) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [JSON.stringify(data)],
  )
  logInfo('dropbox: integration saved', { account_id: token.account_id })
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
    await saveIntegration(refreshed, integration.account_name)
    return refreshed.access_token
  } catch (err) {
    logError('dropbox: refresh failed', { error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

export type DropboxEntry = {
  type: 'file' | 'folder'
  name: string
  path: string
  size?: number
  modified?: string
}

export async function listFolder(folderPath: string): Promise<{ ok: true; entries: DropboxEntry[] } | { ok: false; error: string }> {
  const token = await getValidAccessToken()
  if (!token) return { ok: false, error: 'not_connected' }
  // Dropbox API quirk: root folder is empty string, not "/"
  const apiPath = folderPath === '/' ? '' : folderPath.replace(/\/$/, '')
  const res = await fetch(`${DROPBOX_API}/files/list_folder`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: apiPath, recursive: false, include_deleted: false }),
  })
  if (!res.ok) {
    const text = await res.text()
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
  const token = await getValidAccessToken()
  if (!token) return { ok: false, error: 'not_connected' }
  const res = await fetch(`${DROPBOX_API}/files/create_folder_v2`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: folderPath, autorename: false }),
  })
  if (res.ok) return { ok: true }
  const text = await res.text()
  // 409 = folder already exists, treat as success
  if (res.status === 409 && text.includes('conflict')) return { ok: true }
  return { ok: false, error: `dropbox_${res.status}: ${text.slice(0, 200)}` }
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

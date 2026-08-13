// QuickBooks Online OAuth2 + API helper. Handles the authorize URL, code
// exchange, automatic access-token refresh, and authenticated API calls.
// Config comes from env: QB_CLIENT_ID, QB_CLIENT_SECRET, QB_ENV
// ('sandbox' default | 'production'), and APP_BASE_URL for the redirect URI.
import { pool } from './db'

const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2'
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const SCOPE = 'com.intuit.quickbooks.accounting'

export function qbEnv(): 'sandbox' | 'production' {
  return process.env.QB_ENV === 'production' ? 'production' : 'sandbox'
}
export function apiBase(): string {
  return qbEnv() === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com'
}
export function redirectUri(): string {
  const base = (process.env.APP_BASE_URL || 'https://slate.strawhutmedia.com').replace(/\/+$/, '')
  return `${base}/api/qb/callback`
}
function clientId(): string { return (process.env.QB_CLIENT_ID || '').trim() }
function clientSecret(): string { return (process.env.QB_CLIENT_SECRET || '').trim() }
export function configured(): boolean { return Boolean(clientId() && clientSecret()) }

export function authorizeUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: clientId(),
    response_type: 'code',
    scope: SCOPE,
    redirect_uri: redirectUri(),
    state,
  })
  return `${AUTHORIZE_URL}?${p.toString()}`
}

type TokenResp = {
  access_token: string
  refresh_token: string
  expires_in: number
  x_refresh_token_expires_in: number
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResp> {
  const basic = Buffer.from(`${clientId()}:${clientSecret()}`).toString('base64')
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`quickbooks token ${res.status}: ${text.slice(0, 300)}`)
  }
  return (await res.json()) as TokenResp
}

export async function exchangeCode(code: string): Promise<TokenResp> {
  return tokenRequest(new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
  }))
}

async function refreshTokens(refreshToken: string): Promise<TokenResp> {
  return tokenRequest(new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  }))
}

export async function saveConnection(realmId: string, t: TokenResp, userId?: string): Promise<void> {
  const accessExpiry = new Date(Date.now() + t.expires_in * 1000).toISOString()
  const refreshExpiry = new Date(Date.now() + t.x_refresh_token_expires_in * 1000).toISOString()
  await pool.query(
    `INSERT INTO quickbooks_connection
       (id, realm_id, access_token, refresh_token, access_expires_at, refresh_expires_at, connected_by, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (id) DO UPDATE SET
       realm_id = $1, access_token = $2, refresh_token = $3,
       access_expires_at = $4, refresh_expires_at = $5, updated_at = now()`,
    [realmId, t.access_token, t.refresh_token, accessExpiry, refreshExpiry, userId ?? null],
  )
}

type ConnRow = {
  realm_id: string
  access_token: string
  refresh_token: string
  access_expires_at: string
  refresh_expires_at: string
}

export async function getConnection(): Promise<ConnRow | null> {
  const { rows } = await pool.query<ConnRow>(
    `SELECT realm_id, access_token, refresh_token, access_expires_at, refresh_expires_at
       FROM quickbooks_connection WHERE id = 1`,
  )
  return rows[0] || null
}

export async function clearConnection(): Promise<void> {
  await pool.query(`DELETE FROM quickbooks_connection WHERE id = 1`)
}

// Return a valid access token, refreshing if it's within 2 minutes of expiry.
async function validAccessToken(): Promise<{ token: string; realmId: string } | null> {
  const c = await getConnection()
  if (!c) return null
  const exp = new Date(c.access_expires_at).getTime()
  if (Date.now() < exp - 120_000) return { token: c.access_token, realmId: c.realm_id }
  const t = await refreshTokens(c.refresh_token)
  await saveConnection(c.realm_id, t)
  return { token: t.access_token, realmId: c.realm_id }
}

// Authenticated QuickBooks API call (path is relative to the company base,
// e.g. `/query?query=select * from Customer`).
export async function qbFetch(path: string, init?: RequestInit): Promise<unknown> {
  const v = await validAccessToken()
  if (!v) throw new Error('not_connected')
  const res = await fetch(`${apiBase()}/v3/company/${v.realmId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${v.token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`quickbooks api ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json()
}

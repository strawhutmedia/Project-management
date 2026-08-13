// Field-level encryption for the most sensitive contractor data — the W9
// TIN (SSN/EIN). Uses AES-256-GCM (authenticated) with a 32-byte key from
// the INVOICING_ENC_KEY env var (64 hex chars, or base64). If the key is
// not configured, the vault is "not ready" and callers MUST refuse to store
// the secret rather than fall back to plaintext.
//
// Generate a key once with:  openssl rand -hex 32
// then set it on the Railway service as INVOICING_ENC_KEY. Keep it stable —
// rotating it makes previously-encrypted values undecryptable.
import crypto from 'crypto'

function loadKey(): Buffer | null {
  const raw = (process.env.INVOICING_ENC_KEY || '').trim()
  if (!raw) return null
  let buf: Buffer
  if (/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, 'hex')
  else {
    try { buf = Buffer.from(raw, 'base64') } catch { return null }
  }
  return buf.length === 32 ? buf : null
}

export function vaultReady(): boolean {
  return loadKey() !== null
}

export function encryptSecret(plain: string): string {
  const key = loadKey()
  if (!key) throw new Error('encryption key not configured')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':')
}

export function decryptSecret(payload: string): string {
  const key = loadKey()
  if (!key) throw new Error('encryption key not configured')
  const [ivB, tagB, ctB] = payload.split(':')
  if (!ivB || !tagB || !ctB) throw new Error('malformed ciphertext')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8')
}

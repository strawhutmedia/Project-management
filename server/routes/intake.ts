import { Router } from 'express'
import crypto from 'crypto'
import { pool } from '../db'
import { logError } from '../diag'
import { vaultReady, encryptSecret } from '../crypto_vault'

// PUBLIC vendor intake — contractors open a private, expiring link (no login)
// to submit their W9 + address. Token is validated by sha256 hash against the
// contractor row; the endpoint only ever touches the one contractor the token
// belongs to, and never returns anyone else's data. Bank details are NOT
// collected here (those go into Melio directly).
export const intakeRouter = Router()

const VALID_CLASSES = new Set([
  'individual', 'sole_proprietor', 'single_member_llc', 'c_corp', 's_corp',
  'partnership', 'trust_estate', 'llc', 'other',
])

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

type IntakeContractor = { id: string; name: string; w9_status: string }

async function contractorForToken(token: string): Promise<IntakeContractor | null> {
  if (!token || token.length < 16) return null
  const { rows } = await pool.query<IntakeContractor>(
    `SELECT id, name, w9_status FROM contractors
      WHERE intake_token_hash = $1 AND intake_expires_at > now()`,
    [hashToken(token)],
  )
  return rows[0] || null
}

// GET — load minimal context to render the form (company branding + who it's for).
intakeRouter.get('/:token', async (req, res) => {
  try {
    const c = await contractorForToken(req.params.token)
    if (!c) { res.status(404).json({ error: 'invalid_or_expired' }); return }
    const { rows } = await pool.query(
      `SELECT company_name, logo_data_url FROM invoice_settings WHERE id = 1`,
    )
    res.json({
      companyName: rows[0]?.company_name || 'Straw Hut Media',
      companyLogo: rows[0]?.logo_data_url || null,
      contractorName: c.name,
      alreadyOnFile: c.w9_status === 'on_file',
      vaultReady: vaultReady(),
    })
  } catch (err) {
    logError('intake GET failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

// POST — submit the W9. Encrypts the TIN; refuses (503) if the vault key
// isn't configured rather than ever storing an SSN in plaintext.
intakeRouter.post('/:token', async (req, res) => {
  try {
    const c = await contractorForToken(req.params.token)
    if (!c) { res.status(404).json({ error: 'invalid_or_expired' }); return }

    const b = req.body ?? {}
    const legalName = String(b.legalName ?? '').trim()
    const taxClassification = String(b.taxClassification ?? '').trim()
    const isUsPerson = b.isUsPerson !== false
    const tinType = b.tinType === 'ein' ? 'ein' : 'ssn'
    const tinDigits = String(b.tin ?? '').replace(/\D/g, '')
    const signature = String(b.signature ?? '').trim()
    const certified = b.certified === true

    if (!legalName) { res.status(400).json({ error: 'name_required', detail: 'Your legal name is required.' }); return }
    if (!VALID_CLASSES.has(taxClassification)) { res.status(400).json({ error: 'classification_required', detail: 'Please choose a tax classification.' }); return }
    if (!isUsPerson) {
      res.status(400).json({ error: 'not_us_person', detail: 'This W9 form is for U.S. persons. If you are a non-U.S. person, please contact us for a W-8BEN instead.' }); return
    }
    if (tinDigits.length !== 9) { res.status(400).json({ error: 'bad_tin', detail: 'Your SSN or EIN must be 9 digits.' }); return }
    if (!signature) { res.status(400).json({ error: 'signature_required', detail: 'Please type your name to sign.' }); return }
    if (!certified) { res.status(400).json({ error: 'not_certified', detail: 'Please check the certification box.' }); return }
    if (!vaultReady()) {
      res.status(503).json({ error: 'vault_unavailable', detail: 'Secure storage is not enabled yet. Please contact Straw Hut Media.' }); return
    }

    const tinEncrypted = encryptSecret(tinDigits)
    const last4 = tinDigits.slice(-4)
    const address = String(b.address ?? '').trim().slice(0, 400)
    const email = String(b.email ?? '').trim().slice(0, 200)

    await pool.query(
      `UPDATE contractors SET
         legal_name = $2,
         business_name = $3,
         tax_classification = $4,
         tin_type = $5,
         tin_last4 = $6,
         tin_encrypted = $7,
         phone = $8,
         is_us_person = TRUE,
         prefers_ach = $9,
         w9_signature = $10,
         w9_signed_at = now(),
         w9_status = 'on_file',
         w9_submitted_at = now(),
         email = COALESCE(NULLIF($11, ''), email),
         address = COALESCE(NULLIF($12, ''), address),
         updated_at = now()
       WHERE id = $1`,
      [
        c.id, legalName.slice(0, 200), String(b.businessName ?? '').trim().slice(0, 200),
        taxClassification, tinType, last4, tinEncrypted,
        String(b.phone ?? '').trim().slice(0, 40), b.prefersAch === true,
        signature.slice(0, 200), email, address,
      ],
    )
    res.json({ ok: true })
  } catch (err) {
    logError('intake POST failed', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'internal_error' })
  }
})

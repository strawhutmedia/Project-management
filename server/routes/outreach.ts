// Per-show outreach API: template editor + prospect list.
//
//   GET   /api/outreach/projects/:projectId/template
//   PUT   /api/outreach/projects/:projectId/template
//
//   GET    /api/outreach/projects/:projectId/prospects
//   POST   /api/outreach/projects/:projectId/prospects
//   PATCH  /api/outreach/prospects/:id
//   DELETE /api/outreach/prospects/:id
//
// Admin-only for now (Ryan + Caroline). Non-admins get 403 even if
// they have project access — outreach is a keys-to-the-kingdom feature
// and shouldn't be exposed to producers/editors.

import { Router } from 'express'
import { Resend } from 'resend'
import { pool } from '../db'
import { requireAdmin, type SessionUser } from '../auth'
import { logError, logInfo } from '../diag'
import { generateUniqueSentence, generateOneSheetAuto, hasAnthropicKey, type UniqueSentenceInput } from '../anthropic'
import { loadShowBrief } from './show_brief'
import { syncMissingCoversFromRss } from '../rss_cover_sync'
import { seedFlagshipPodcasts } from '../seeds/flagship_podcasts'

const resendKey = process.env.RESEND_API_KEY
const resend = resendKey ? new Resend(resendKey) : null

export const outreachRouter = Router()
outreachRouter.use(requireAdmin)

// Merge [name] and [unique_sentence] tokens in a template. Used by the
// test-send preview + (later) the real sender. Kept minimal — the
// template writer controls which tokens exist; anything else stays.
function mergeTemplate(text: string, tokens: { name: string; uniqueSentence: string; oneSheetUrl: string }): string {
  return text
    .replace(/\[name\]/gi, tokens.name)
    .replace(/\[unique_sentence\]/gi, tokens.uniqueSentence)
    .replace(/\[one_sheet_url\]|\[onesheet_url\]|\[link\]/gi, tokens.oneSheetUrl)
}

// Build the public one-sheet URL for a show. Returns empty string
// when the show isn't published — merge tokens will be blank rather
// than emitting a broken link.
async function getOneSheetUrl(projectId: string): Promise<string> {
  const { rows } = await pool.query<{ slug: string | null; one_sheet_published: boolean }>(
    `SELECT slug, one_sheet_published FROM projects WHERE id = $1`,
    [projectId],
  )
  const r = rows[0]
  if (!r?.slug || !r.one_sheet_published) return ''
  const base = process.env.APP_BASE_URL || 'https://slate.strawhutmedia.com'
  return `${base}/shows/${r.slug}`
}

// ─── CSV template download ──────────────────────────────────────────
// Ryan's team fills this out in Excel/Sheets, then copy-pastes the
// whole block into the Bulk import textarea. Columns mirror the
// parseBulk() order in OutreachSection so what you see is what you get.
//
// Only 3 columns are required for a good send: name, email, context.
// The other 3 (full_name, type, represents) are helpful when you're
// pitching an agent/manager on behalf of someone else — leave them
// blank for direct-to-person pitches.
outreachRouter.get('/template.csv', (_req, res) => {
  const header = 'name (required),email (required),context (required — Claude writes the unique sentence from this),full_name (optional),type (optional: person / agent / manager / other),represents (optional — only for agents/managers)'
  const rows = [
    'Alex,alex@company.com,Founder of X — just did Diary of a CEO ep 342,Alex Rodriguez,person,',
    'Sarah,sarah@agency.com,Emily Blunt\'s booking agent at CAA — reached out about Wicked press,Sarah Kim,agent,Emily Blunt',
    'Tom,tom@bigfilm.com,Pedro Pascal\'s longtime manager — Pedro just wrapped The Last of Us s2,Tom Hayes,manager,Pedro Pascal',
    'Jamie,jamie@studio.com,PR contact at A24 — pitching guests from their fall slate,Jamie Ortiz,other,',
  ]
  const csv = [header, ...rows].join('\r\n') + '\r\n'
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="slate-outreach-template.csv"')
  res.send(csv)
})

// ─── Templates ──────────────────────────────────────────────────────
outreachRouter.get('/projects/:projectId/template', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT project_id, subject, body, from_name, reply_to, updated_at
       FROM outreach_templates WHERE project_id = $1`,
    [req.params.projectId],
  )
  res.json({ template: rows[0] ?? null })
})

outreachRouter.put('/projects/:projectId/template', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  const subject = String(req.body?.subject ?? '')
  const body = String(req.body?.body ?? '')
  const fromName = typeof req.body?.fromName === 'string' && req.body.fromName.trim()
    ? req.body.fromName.trim() : null
  const replyTo = typeof req.body?.replyTo === 'string' && req.body.replyTo.trim()
    ? req.body.replyTo.trim() : null
  await pool.query(
    `INSERT INTO outreach_templates
       (project_id, subject, body, from_name, reply_to, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (project_id) DO UPDATE SET
       subject = EXCLUDED.subject,
       body = EXCLUDED.body,
       from_name = EXCLUDED.from_name,
       reply_to = EXCLUDED.reply_to,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [projectId, subject, body, fromName, replyTo, user.id],
  )
  res.json({ ok: true })
})

// ─── Prospects ──────────────────────────────────────────────────────

const RECIPIENT_TYPES = new Set(['person', 'agent', 'manager', 'other'])
const STATUSES = new Set([
  'needs_email','ready','queued','sent','replied','bounced','opted_out','failed',
])

outreachRouter.get('/projects/:projectId/prospects', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, project_id, name, full_name, email, recipient_type, client_name,
            context, unique_sentence, unique_sentence_generated_at, status,
            sent_at, replied_at, bounced_at, sending_domain_id, created_at, updated_at
       FROM outreach_prospects
      WHERE project_id = $1
      ORDER BY created_at DESC`,
    [req.params.projectId],
  )
  res.json({ prospects: rows })
})

// Bulk import — paste a spreadsheet, get N prospects. Each row is
// validated + inserted in one transaction. Returns per-row status so
// the UI can show what got imported vs skipped.
outreachRouter.post('/projects/:projectId/prospects/bulk', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  const rows: unknown = req.body?.rows
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: 'rows_required' })
    return
  }
  if (rows.length > 500) {
    res.status(400).json({ error: 'too_many_rows', detail: 'max 500 per bulk import' })
    return
  }
  type Result = { row: number; ok: boolean; error?: string; id?: string }
  const results: Result[] = []
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i] as Record<string, unknown> | undefined
      const name = typeof raw?.name === 'string' ? raw.name.trim() : ''
      if (!name) {
        results.push({ row: i, ok: false, error: 'name_required' })
        continue
      }
      const fullName = typeof raw?.fullName === 'string' && raw.fullName.trim() ? raw.fullName.trim() : null
      const email = typeof raw?.email === 'string' && raw.email.trim() ? raw.email.trim().toLowerCase() : null
      const recipientType = typeof raw?.recipientType === 'string' && RECIPIENT_TYPES.has(raw.recipientType)
        ? raw.recipientType : 'person'
      const clientName = typeof raw?.clientName === 'string' && raw.clientName.trim() ? raw.clientName.trim() : null
      const context = typeof raw?.context === 'string' && raw.context.trim() ? raw.context.trim() : null
      const initialStatus = email ? 'ready' : 'needs_email'
      const insertRes = await client.query<{ id: string }>(
        `INSERT INTO outreach_prospects
           (project_id, name, full_name, email, recipient_type, client_name,
            context, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [projectId, name, fullName, email, recipientType, clientName, context, initialStatus, user.id],
      )
      results.push({ row: i, ok: true, id: insertRes.rows[0].id })
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    res.status(500).json({ error: 'bulk_import_failed', detail: err instanceof Error ? err.message : String(err) })
    return
  } finally {
    client.release()
  }
  const imported = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok).length
  res.json({ imported, failed, results })
})

outreachRouter.post('/projects/:projectId/prospects', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  const name = String(req.body?.name ?? '').trim()
  if (!name) { res.status(400).json({ error: 'name_required' }); return }
  const fullName = typeof req.body?.fullName === 'string' && req.body.fullName.trim()
    ? req.body.fullName.trim() : null
  const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim() : ''
  // Reject strings with multiple email addresses so we never end up
  // with a `to` field like "alice@x.com bob@y.com". The bulk importer
  // splits these into separate prospects; the single-add form should
  // too, but at least surface the error rather than silently corrupt.
  const emailMatches = rawEmail.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []
  if (emailMatches.length > 1) {
    res.status(400).json({ error: 'multiple_emails', detail: 'This cell has more than one email address — add each as its own prospect.' })
    return
  }
  const email = emailMatches[0] ? emailMatches[0].toLowerCase() : null
  const recipientType = typeof req.body?.recipientType === 'string' && RECIPIENT_TYPES.has(req.body.recipientType)
    ? req.body.recipientType : 'person'
  const clientName = typeof req.body?.clientName === 'string' && req.body.clientName.trim()
    ? req.body.clientName.trim() : null
  const context = typeof req.body?.context === 'string' && req.body.context.trim()
    ? req.body.context.trim() : null
  // Prospects with email start in `ready`; without email → needs_email.
  const initialStatus = email ? 'ready' : 'needs_email'
  const { rows } = await pool.query(
    `INSERT INTO outreach_prospects
       (project_id, name, full_name, email, recipient_type, client_name,
        context, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, name, full_name, email, recipient_type, client_name,
               context, unique_sentence, unique_sentence_generated_at, status,
               sent_at, replied_at, bounced_at, sending_domain_id, created_at, updated_at`,
    [projectId, name, fullName, email, recipientType, clientName, context, initialStatus, user.id],
  )
  res.json({ prospect: rows[0] })
})

outreachRouter.patch('/prospects/:id', async (req, res) => {
  const id = req.params.id
  const patch = req.body ?? {}
  const sets: string[] = []
  const values: unknown[] = []
  let idx = 1
  const addField = (col: string, val: unknown) => {
    sets.push(`${col} = $${idx++}`)
    values.push(val)
  }
  if (typeof patch.name === 'string') {
    const v = patch.name.trim()
    if (!v) { res.status(400).json({ error: 'name_required' }); return }
    addField('name', v)
  }
  if ('fullName' in patch) {
    addField('full_name', typeof patch.fullName === 'string' && patch.fullName.trim() ? patch.fullName.trim() : null)
  }
  if ('email' in patch) {
    addField('email', typeof patch.email === 'string' && patch.email.trim() ? patch.email.trim().toLowerCase() : null)
  }
  if (typeof patch.recipientType === 'string') {
    if (!RECIPIENT_TYPES.has(patch.recipientType)) { res.status(400).json({ error: 'bad_recipient_type' }); return }
    addField('recipient_type', patch.recipientType)
  }
  if ('clientName' in patch) {
    addField('client_name', typeof patch.clientName === 'string' && patch.clientName.trim() ? patch.clientName.trim() : null)
  }
  if ('context' in patch) {
    addField('context', typeof patch.context === 'string' && patch.context.trim() ? patch.context.trim() : null)
  }
  if ('uniqueSentence' in patch) {
    const v = typeof patch.uniqueSentence === 'string' && patch.uniqueSentence.trim() ? patch.uniqueSentence.trim() : null
    addField('unique_sentence', v)
    addField('unique_sentence_generated_at', v ? new Date() : null)
  }
  if (typeof patch.status === 'string') {
    if (!STATUSES.has(patch.status)) { res.status(400).json({ error: 'bad_status' }); return }
    addField('status', patch.status)
  }
  if (sets.length === 0) { res.status(400).json({ error: 'no_fields' }); return }
  sets.push(`updated_at = now()`)
  values.push(id)
  const { rowCount } = await pool.query(
    `UPDATE outreach_prospects SET ${sets.join(', ')} WHERE id = $${idx}`,
    values,
  )
  if (rowCount === 0) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ ok: true })
})

// ─── Campaign sender ─────────────────────────────────────────────────
//
// Fires N prospect sends in the background, jittered 90-180s apart so
// the pattern looks human. Rotates through verified sending domains,
// prefers a domain pinned to this show. Records every send attempt in
// outreach_sends so we can compute health per domain.

async function sendOneProspect(prospectId: string): Promise<void> {
  if (!resend) throw new Error('resend_not_configured')

  // Load prospect + template + project + one_sheet + a domain to send from.
  const pRes = await pool.query<{
    project_id: string; name: string; email: string | null;
    unique_sentence: string | null; status: string;
  }>(
    `SELECT project_id, name, email, unique_sentence, status
       FROM outreach_prospects WHERE id = $1`,
    [prospectId],
  )
  const p = pRes.rows[0]
  if (!p) throw new Error('prospect_not_found')
  if (!p.email) throw new Error('prospect_has_no_email')
  if (!p.unique_sentence?.trim()) throw new Error('prospect_missing_sentence')

  const tplRes = await pool.query<{
    subject: string; body: string; reply_to: string | null; from_name: string | null;
  }>(
    `SELECT subject, body, reply_to, from_name FROM outreach_templates WHERE project_id = $1`,
    [p.project_id],
  )
  const tpl = tplRes.rows[0]
  if (!tpl || !tpl.subject.trim() || !tpl.body.trim()) throw new Error('template_empty')

  // Pick sending domain. If the prospect was pre-assigned a domain at
  // queue time (round-robin distribution across the pool — see
  // send-campaign below), honor it as long as that domain is still
  // verified + active. If it's been disabled since queueing, or if
  // there's no pre-assignment, fall back to the healthiest available
  // domain in the pool.
  const assignedRes = await pool.query<{ id: string; name: string }>(
    `SELECT sd.id, sd.name
       FROM outreach_prospects op
       JOIN sending_domains sd ON sd.id = op.sending_domain_id
      WHERE op.id = $1
        AND sd.status = 'verified' AND sd.active = TRUE`,
    [prospectId],
  )
  let domain = assignedRes.rows[0]
  if (!domain) {
    const domRes = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM sending_domains
        WHERE status = 'verified' AND active = TRUE
        ORDER BY (primary_show_id = $1) DESC, created_at ASC
        LIMIT 1`,
      [p.project_id],
    )
    domain = domRes.rows[0]
  }
  if (!domain) throw new Error('no_verified_domain')

  const showRes = await pool.query<{ name: string }>(
    `SELECT name FROM projects WHERE id = $1`, [p.project_id],
  )
  const showName = showRes.rows[0]?.name || 'Straw Hut Media'
  const fromName = tpl.from_name?.trim() || showName
  const from = `${fromName} <booking@${domain.name}>`
  const replyTo = tpl.reply_to?.trim() || 'booking@strawhutmedia.com'

  const oneSheetUrl = await getOneSheetUrl(p.project_id)
  const subject = mergeTemplate(tpl.subject, { name: p.name, uniqueSentence: p.unique_sentence, oneSheetUrl })
  const body = mergeTemplate(tpl.body, { name: p.name, uniqueSentence: p.unique_sentence, oneSheetUrl })

  // Log the attempt (status: queued) before firing so we have a record
  // even if Resend errors mid-flight.
  const logRes = await pool.query<{ id: string }>(
    `INSERT INTO outreach_sends
       (prospect_id, sending_domain_id, from_email, to_email, subject, body, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'queued')
     RETURNING id`,
    [prospectId, domain.id, from, p.email, subject, body],
  )
  const sendLogId = logRes.rows[0].id

  try {
    const send = await resend.emails.send({
      from, to: p.email, subject, text: body, replyTo,
    })
    if (send.error) {
      const errorMsg = String(send.error.message ?? send.error).slice(0, 500)
      await pool.query(
        `UPDATE outreach_sends SET status = 'failed', error = $1 WHERE id = $2`,
        [errorMsg, sendLogId],
      )
      await pool.query(
        `UPDATE outreach_prospects SET status = 'failed', updated_at = now() WHERE id = $1`,
        [prospectId],
      )
      
      // If domain verification error, mark the domain as needing attention
      if (errorMsg.includes('domain is not verified') || errorMsg.includes('domain not verified')) {
        await pool.query(
          `UPDATE sending_domains SET status = 'failed', updated_at = now() 
           WHERE id = $1`,
          [domain.id],
        )
        logError('outreach: domain verification failed, marked domain as failed', { 
          domainId: domain.id, 
          domainName: domain.name,
          error: errorMsg
        })
      }
      
      throw new Error(`resend_error: ${send.error.message ?? send.error}`)
    }
    await pool.query(
      `UPDATE outreach_sends
          SET status = 'sent', resend_message_id = $1, sent_at = now()
        WHERE id = $2`,
      [send.data?.id ?? null, sendLogId],
    )
    await pool.query(
      `UPDATE outreach_prospects
          SET status = 'sent', sent_at = now(), sending_domain_id = $1, updated_at = now()
        WHERE id = $2`,
      [domain.id, prospectId],
    )
    logInfo('outreach: sent', { prospectId, to: p.email, domain: domain.name })
  } catch (err) {
    logError('outreach: send failed', { prospectId, error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

// In-memory scheduler — simplest thing that works. Each queued send is
// a setTimeout that fires N minutes from now. Queue is not persisted
// across Railway restarts; on redeploy any queued (not-yet-sent)
// prospects revert to 'ready' status via the resume-queue block at
// module load (see bottom of file).
const scheduledSends = new Set<string>()

function scheduleSend(prospectId: string, delayMs: number): void {
  if (scheduledSends.has(prospectId)) return
  scheduledSends.add(prospectId)
  setTimeout(async () => {
    scheduledSends.delete(prospectId)
    try {
      await sendOneProspect(prospectId)
    } catch (err) {
      logError('outreach: scheduled send failed', {
        prospectId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }, delayMs).unref()
}

outreachRouter.post('/projects/:projectId/send-campaign', async (req, res) => {
  const projectId = req.params.projectId
  if (!resend) {
    res.status(503).json({ error: 'resend_not_configured' })
    return
  }
  const rawIds = req.body?.prospectIds
  const explicit = Array.isArray(rawIds) ? rawIds.filter((x): x is string => typeof x === 'string') : null

  // Only send to prospects that are (a) belong to this project, (b)
  // have an email, (c) have a unique_sentence, (d) are in 'ready'
  // status. Anything else the operator has to fix manually.
  const q = explicit && explicit.length > 0
    ? await pool.query<{ id: string }>(
        `SELECT id FROM outreach_prospects
          WHERE project_id = $1
            AND id = ANY($2::uuid[])
            AND email IS NOT NULL
            AND unique_sentence IS NOT NULL AND trim(unique_sentence) <> ''
            AND status = 'ready'`,
        [projectId, explicit],
      )
    : await pool.query<{ id: string }>(
        `SELECT id FROM outreach_prospects
          WHERE project_id = $1
            AND email IS NOT NULL
            AND unique_sentence IS NOT NULL AND trim(unique_sentence) <> ''
            AND status = 'ready'
          ORDER BY created_at ASC`,
        [projectId],
      )
  const ids = q.rows.map((r) => r.id)
  if (ids.length === 0) {
    res.status(400).json({ error: 'no_eligible_prospects', detail: 'No prospects are Ready (need email + unique sentence).' })
    return
  }

  // Load the full pool of verified + active domains. Pinned domain
  // (if any) comes first, then oldest-created — that keeps show-owned
  // domains as the "anchor" of the rotation without giving them 100%
  // of the volume. If the show has 4 domains in the pool and 40
  // prospects, each domain gets ~10 sends — no single domain gets
  // burned by campaign volume.
  const domRes = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM sending_domains
      WHERE status = 'verified' AND active = TRUE
      ORDER BY (primary_show_id = $1) DESC, created_at ASC`,
    [projectId],
  )
  const domains = domRes.rows
  if (domains.length === 0) {
    res.status(400).json({ error: 'no_verified_domain' })
    return
  }

  // Shuffle prospect order so consecutive sends (which the outside
  // world might correlate via time-of-day) don't hit domains in a
  // predictable A,B,C,D,A,B,C,D pattern. Round-robin over shuffled
  // ids gives us even distribution + unpredictable per-domain timing.
  const shuffled = [...ids]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  // Assign each prospect a domain BEFORE queuing so a Railway restart
  // mid-campaign doesn't re-shuffle assignments. Also gives us an
  // audit trail: "prospect X was queued to send from domain Y".
  const assignments = shuffled.map((id, i) => ({
    id, domainId: domains[i % domains.length].id,
  }))
  // One round-trip per domain, not per prospect — batch by domain.
  const byDomain = new Map<string, string[]>()
  for (const a of assignments) {
    const arr = byDomain.get(a.domainId) ?? []
    arr.push(a.id)
    byDomain.set(a.domainId, arr)
  }
  for (const [domainId, prospectIds] of byDomain) {
    await pool.query(
      `UPDATE outreach_prospects
          SET status = 'queued', sending_domain_id = $1, updated_at = now()
        WHERE id = ANY($2::uuid[])`,
      [domainId, prospectIds],
    )
  }

  // Schedule each send 90-180s apart. Cursor advances by a fresh
  // random jitter for each prospect so the pattern isn't deterministic.
  let cursorMs = 0
  for (const { id } of assignments) {
    const jitter = 90_000 + Math.floor(Math.random() * 90_000) // 90-180s
    cursorMs += jitter
    scheduleSend(id, cursorMs)
  }
  const perDomainCount = Array.from(byDomain.values()).map((v) => v.length)
  logInfo('outreach: campaign started', {
    projectId,
    count: ids.length,
    domains: domains.length,
    perDomain: perDomainCount,
    estimatedMinutes: Math.round(cursorMs / 60_000),
  })
  res.json({
    ok: true,
    queued: ids.length,
    domainsUsed: domains.length,
    perDomain: perDomainCount,
    estimatedMinutes: Math.round(cursorMs / 60_000),
    firstAt: new Date(Date.now() + 90_000).toISOString(),
    lastAt: new Date(Date.now() + cursorMs).toISOString(),
  })
})

// On boot, resume any prospects that were mid-queue when the process
// died. They flip back to 'ready' so the operator can rerun the send
// button — otherwise they'd sit stuck as 'queued' forever.
;(async () => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE outreach_prospects SET status = 'ready', updated_at = now()
        WHERE status = 'queued'`,
    )
    if (rowCount && rowCount > 0) {
      logInfo('outreach: reset stuck queued prospects on boot', { count: rowCount })
    }
  } catch (err) {
    logError('outreach: boot reset failed', { error: err instanceof Error ? err.message : String(err) })
  }
})()

// Trigger the RSS cover sync on demand. Producer clicks this after
// registering a new podcast + RSS feed to fetch the cover art without
// waiting for the next Railway boot.
outreachRouter.post('/sync-rss-covers', async (_req, res) => {
  try {
    const result = await syncMissingCoversFromRss()
    res.json({ ok: true, ...result })
  } catch (err) {
    res.status(500).json({ error: 'sync_failed', detail: err instanceof Error ? err.message : String(err) })
  }
})

// Same as the boot-time seed but callable on-demand. Runs iTunes
// lookups + RSS-cover fallback for every flagship show.
outreachRouter.post('/seed-flagship', async (_req, res) => {
  try {
    await seedFlagshipPodcasts()
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'seed_failed', detail: err instanceof Error ? err.message : String(err) })
  }
})

// Auto-populate a show's one-sheet from its episode list + Show Brief.
// Producer clicks the button, Claude reads the metadata and drafts:
// hero tagline, guest pitch, notable guests, brand color. Everything
// is saved to projects and publish flag is flipped on so the URL is
// live immediately for review.
outreachRouter.post('/projects/:projectId/auto-populate-one-sheet', async (req, res) => {
  if (!hasAnthropicKey()) {
    res.status(503).json({ error: 'anthropic_key_missing' })
    return
  }
  const projectId = req.params.projectId
  const projRes = await pool.query<{
    name: string; subtitle: string | null; socials_brand_voice: string | null; slug: string | null;
  }>(
    `SELECT name, subtitle, socials_brand_voice, slug
       FROM projects WHERE id = $1 AND kind = 'podcast'`,
    [projectId],
  )
  const proj = projRes.rows[0]
  if (!proj) { res.status(404).json({ error: 'project_not_found' }); return }

  // Some podcast projects were created before migration 053 or via a
  // path that didn't set slug — auto-generate + persist so the public
  // one-sheet URL works. Dedupe by appending short suffix if taken.
  let slug = proj.slug
  if (!slug) {
    const base = proj.name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 100) || 'show'
    let candidate = base
    for (let i = 2; i < 100; i++) {
      const clash = await pool.query(
        `SELECT 1 FROM projects WHERE slug = $1 AND id <> $2 LIMIT 1`,
        [candidate, projectId],
      )
      if (clash.rows.length === 0) break
      candidate = `${base}-${i}`
    }
    slug = candidate
    await pool.query(`UPDATE projects SET slug = $1 WHERE id = $2`, [slug, projectId])
  }
  const brief = await loadShowBrief(projectId)
  const epRes = await pool.query<{ title: string; subtitle: string | null }>(
    `SELECT title, subtitle FROM songs WHERE project_id = $1
      ORDER BY position DESC NULLS LAST, created_at DESC LIMIT 40`,
    [projectId],
  )
  try {
    const result = await generateOneSheetAuto({
      showName: proj.name,
      showSubtitle: proj.subtitle,
      brandVoice: proj.socials_brand_voice,
      briefDescription: brief?.business_description ?? null,
      briefAudience: brief?.target_audience ?? null,
      briefMetrics: brief?.current_metrics ?? null,
      episodes: epRes.rows,
    })
    // Save + auto-publish. Slug already backfilled by migration 053.
    await pool.query(
      `UPDATE projects
          SET hero_tagline = $1,
              guest_pitch = $2,
              notable_guests = $3,
              notable_topics = $4,
              brand_hex = $5,
              contact_email = COALESCE(contact_email, $6),
              one_sheet_published = TRUE
        WHERE id = $7`,
      [result.heroTagline, result.guestPitch, result.notableGuests, result.notableTopics,
       result.brandHex, 'booking@strawhutmedia.com', projectId],
    )
    const base = process.env.APP_BASE_URL || 'https://slate.strawhutmedia.com'
    const url = `${base}/shows/${slug}`
    res.json({
      ok: true,
      url,
      slug,
      heroTagline: result.heroTagline,
      guestPitch: result.guestPitch,
      notableGuests: result.notableGuests,
      notableTopics: result.notableTopics,
      brandHex: result.brandHex,
    })
  } catch (err) {
    logError('outreach: one-sheet auto-populate failed', {
      projectId, error: err instanceof Error ? err.message : String(err),
    })
    res.status(500).json({ error: 'auto_populate_failed', detail: err instanceof Error ? err.message.slice(0, 300) : String(err) })
  }
})

// Wipe every prospect on a show. Useful when the operator wants to
// start over with a fresh list — deleting one at a time is tedious.
// The optional `keep=sent` query preserves rows that already fired
// so history isn't destroyed by an accidental click.
outreachRouter.delete('/projects/:projectId/prospects', async (req, res) => {
  const projectId = req.params.projectId
  const keepSent = req.query.keep === 'sent'
  const q = keepSent
    ? await pool.query(
        `DELETE FROM outreach_prospects
          WHERE project_id = $1
            AND status NOT IN ('sent', 'replied')`,
        [projectId],
      )
    : await pool.query(
        `DELETE FROM outreach_prospects WHERE project_id = $1`,
        [projectId],
      )
  res.json({ ok: true, deleted: q.rowCount ?? 0 })
})

outreachRouter.delete('/prospects/:id', async (req, res) => {
  const { rowCount } = await pool.query(
    `DELETE FROM outreach_prospects WHERE id = $1`,
    [req.params.id],
  )
  if (rowCount === 0) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ ok: true })
})

// ─── Unique-sentence generator (Claude) ─────────────────────────────
//
// Builds the input for anthropic.generateUniqueSentence from the show
// (project + Show Brief + recent episodes) and the prospect row, calls
// Claude, saves the returned sentence back on the row.

async function buildSentenceInput(prospectId: string): Promise<{ input: UniqueSentenceInput; projectId: string; prospectName: string } | { error: string }> {
  const prospectRes = await pool.query<{
    id: string; project_id: string; name: string; full_name: string | null;
    recipient_type: 'person' | 'agent' | 'manager' | 'other';
    client_name: string | null; context: string | null;
  }>(
    `SELECT id, project_id, name, full_name, recipient_type, client_name, context
       FROM outreach_prospects WHERE id = $1`,
    [prospectId],
  )
  const prospect = prospectRes.rows[0]
  if (!prospect) return { error: 'prospect_not_found' }
  const projRes = await pool.query<{
    name: string; hero_tagline: string | null; socials_brand_voice: string | null;
    notable_guests: string | null;
  }>(
    `SELECT name, hero_tagline, socials_brand_voice, notable_guests
       FROM projects WHERE id = $1`,
    [prospect.project_id],
  )
  const proj = projRes.rows[0]
  if (!proj) return { error: 'project_not_found' }
  const brief = await loadShowBrief(prospect.project_id)
  const epRes = await pool.query<{ title: string; subtitle: string | null }>(
    `SELECT title, subtitle FROM songs WHERE project_id = $1
      ORDER BY position DESC NULLS LAST, created_at DESC LIMIT 6`,
    [prospect.project_id],
  )
  return {
    projectId: prospect.project_id,
    prospectName: prospect.name,
    input: {
      show: {
        name: proj.name,
        tagline: proj.hero_tagline,
        about: brief?.business_description ?? null,
        audience: brief?.target_audience ?? null,
        niche: brief?.niche ?? null,
        brandVoice: proj.socials_brand_voice,
        notableGuests: proj.notable_guests,
        recentEpisodes: epRes.rows,
      },
      prospect: {
        name: prospect.name,
        fullName: prospect.full_name,
        recipientType: prospect.recipient_type,
        clientName: prospect.client_name,
        context: prospect.context,
      },
    },
  }
}

outreachRouter.post('/prospects/:id/generate-sentence', async (req, res) => {
  if (!hasAnthropicKey()) {
    res.status(503).json({ error: 'anthropic_key_missing' })
    return
  }
  const built = await buildSentenceInput(req.params.id)
  if ('error' in built) {
    res.status(built.error.includes('not_found') ? 404 : 400).json({ error: built.error })
    return
  }
  try {
    const result = await generateUniqueSentence(built.input)
    await pool.query(
      `UPDATE outreach_prospects
          SET unique_sentence = $1,
              unique_sentence_generated_at = now(),
              updated_at = now()
        WHERE id = $2`,
      [result.sentence, req.params.id],
    )
    res.json({ ok: true, sentence: result.sentence })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'insufficient_context') {
      res.status(422).json({
        error: 'insufficient_context',
        detail: 'Not enough context on this prospect to write a specific sentence. Add a line about who they are + something recent they did, then try again.',
      })
      return
    }
    logError('outreach: unique sentence failed', { id: req.params.id, error: msg })
    res.status(500).json({ error: 'generation_failed', detail: msg.slice(0, 300) })
  }
})

// Generate for every prospect in a show that doesn't have a sentence
// yet. Rate-limited by the shape of the request — we run 4 at a time
// so Anthropic isn't hammered and the operator sees progress quickly.
outreachRouter.post('/projects/:projectId/generate-all-sentences', async (req, res) => {
  if (!hasAnthropicKey()) {
    res.status(503).json({ error: 'anthropic_key_missing' })
    return
  }
  const projectId = req.params.projectId
  const targets = await pool.query<{ id: string }>(
    `SELECT id FROM outreach_prospects
      WHERE project_id = $1
        AND unique_sentence IS NULL
      ORDER BY created_at ASC`,
    [projectId],
  )
  const ids = targets.rows.map((r) => r.id)
  if (ids.length === 0) {
    res.json({ ok: true, generated: 0, failed: 0, insufficientContext: 0 })
    return
  }
  let generated = 0
  let failed = 0
  let insufficient = 0
  const CONCURRENCY = 4
  const queue = [...ids]
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const id = queue.shift()
      if (!id) break
      const built = await buildSentenceInput(id)
      if ('error' in built) { failed += 1; continue }
      try {
        const result = await generateUniqueSentence(built.input)
        await pool.query(
          `UPDATE outreach_prospects
              SET unique_sentence = $1, unique_sentence_generated_at = now(), updated_at = now()
            WHERE id = $2`,
          [result.sentence, id],
        )
        generated += 1
      } catch (err) {
        if (err instanceof Error && err.message === 'insufficient_context') {
          insufficient += 1
        } else {
          failed += 1
          logError('outreach: bulk sentence failed', { id, error: err instanceof Error ? err.message : String(err) })
        }
      }
    }
  }))
  res.json({ ok: true, generated, failed, insufficientContext: insufficient })
})

// ─── Test send ──────────────────────────────────────────────────────
// Fires a REAL email to `to` using the show's template merged with a
// preview prospect (or fake stand-in if the list is empty). Uses the
// first verified sending domain in the pool. Zero effect on real
// prospects — this is purely so the operator can see what recipients
// will actually get.
outreachRouter.post('/projects/:projectId/test-send', async (req, res) => {
  const projectId = req.params.projectId
  const to = String(req.body?.to || '').trim().toLowerCase()
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(to)) {
    res.status(400).json({ error: 'invalid_to_email' })
    return
  }
  if (!resend) {
    res.status(503).json({ error: 'resend_not_configured' })
    return
  }

  // Load template
  const tplRes = await pool.query<{
    subject: string; body: string; reply_to: string | null; from_name: string | null;
  }>(
    `SELECT subject, body, reply_to, from_name FROM outreach_templates WHERE project_id = $1`,
    [projectId],
  )
  const tpl = tplRes.rows[0]
  if (!tpl || !tpl.subject.trim() || !tpl.body.trim()) {
    res.status(400).json({ error: 'template_empty', detail: 'Save the template first.' })
    return
  }

  // Load a preview prospect — first ready one, else any prospect,
  // else fabricate. Priority: prospect with a unique_sentence, then
  // any with an email, then any at all, then fake.
  const previewRes = await pool.query<{ name: string; unique_sentence: string | null }>(
    `SELECT name, unique_sentence FROM outreach_prospects
      WHERE project_id = $1
      ORDER BY (unique_sentence IS NOT NULL) DESC, (email IS NOT NULL) DESC, created_at DESC
      LIMIT 1`,
    [projectId],
  )
  const preview = previewRes.rows[0]
  const previewName = preview?.name || 'Alex'
  const previewSentence = preview?.unique_sentence
    || 'Your recent work jumped out to me — the way you framed it in your last piece is exactly the angle we chase on the show.'

  const oneSheetUrl = await getOneSheetUrl(projectId)
  const subject = mergeTemplate(tpl.subject, { name: previewName, uniqueSentence: previewSentence, oneSheetUrl })
  const body = mergeTemplate(tpl.body, { name: previewName, uniqueSentence: previewSentence, oneSheetUrl })

  // Pick a sending domain — first verified + active one in the pool.
  // Prefer the domain pinned to this show if one is set.
  const domRes = await pool.query<{ name: string }>(
    `SELECT name FROM sending_domains
      WHERE status = 'verified' AND active = TRUE
      ORDER BY (primary_show_id = $1) DESC, created_at ASC
      LIMIT 1`,
    [projectId],
  )
  const domain = domRes.rows[0]?.name
  if (!domain) {
    res.status(400).json({ error: 'no_verified_domain', detail: 'Add + verify a sending domain first.' })
    return
  }
  const showNameRes = await pool.query<{ name: string }>(
    `SELECT name FROM projects WHERE id = $1`, [projectId],
  )
  const showName = showNameRes.rows[0]?.name || 'Straw Hut Media'
  const fromName = tpl.from_name?.trim() || showName
  const from = `${fromName} <booking@${domain}>`
  const replyTo = tpl.reply_to?.trim() || 'booking@strawhutmedia.com'

  try {
    const send = await resend.emails.send({
      from,
      to,
      subject: `[TEST] ${subject}`,
      text: body,
      replyTo,
    })
    if (send.error) {
      logError('outreach test-send failed', { projectId, error: send.error })
      
      // Check if the error is about domain not being verified
      const errorMsg = send.error.message ?? String(send.error)
      if (errorMsg.includes('domain is not verified') || errorMsg.includes('domain not verified')) {
        res.status(400).json({ 
          error: 'domain_not_verified', 
          detail: `The domain "${domain}" is not verified in Resend. Go to Admin > Outreach Domains and click "Sync with Resend" to update domain statuses, or verify the domain at https://resend.com/domains first.`,
          resendError: errorMsg
        })
        return
      }
      
      res.status(502).json({ error: 'send_failed', detail: errorMsg })
      return
    }
    logInfo('outreach test-send ok', { projectId, to, domain })
    res.json({ ok: true, from, to, subject: `[TEST] ${subject}`, previewName })
  } catch (err) {
    logError('outreach test-send threw', { projectId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'send_threw', detail: err instanceof Error ? err.message : String(err) })
  }
})

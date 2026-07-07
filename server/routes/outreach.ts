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
import { generateUniqueSentence, hasAnthropicKey, type UniqueSentenceInput } from '../anthropic'
import { loadShowBrief } from './show_brief'

const resendKey = process.env.RESEND_API_KEY
const resend = resendKey ? new Resend(resendKey) : null

export const outreachRouter = Router()
outreachRouter.use(requireAdmin)

// Merge [name] and [unique_sentence] tokens in a template. Used by the
// test-send preview + (later) the real sender. Kept minimal — the
// template writer controls which tokens exist; anything else stays.
function mergeTemplate(text: string, tokens: { name: string; uniqueSentence: string }): string {
  return text
    .replace(/\[name\]/gi, tokens.name)
    .replace(/\[unique_sentence\]/gi, tokens.uniqueSentence)
}

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

  const subject = mergeTemplate(tpl.subject, { name: previewName, uniqueSentence: previewSentence })
  const body = mergeTemplate(tpl.body, { name: previewName, uniqueSentence: previewSentence })

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
      res.status(502).json({ error: 'send_failed', detail: send.error.message ?? String(send.error) })
      return
    }
    logInfo('outreach test-send ok', { projectId, to, domain })
    res.json({ ok: true, from, to, subject: `[TEST] ${subject}`, previewName })
  } catch (err) {
    logError('outreach test-send threw', { projectId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ error: 'send_threw', detail: err instanceof Error ? err.message : String(err) })
  }
})

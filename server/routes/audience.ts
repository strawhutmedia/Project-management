// Per-show audience (email list) API.
//
// PUBLIC (no session — secured by the per-show capture token in the URL):
//   POST /api/audience/hooks/:token
//     Capture endpoint. ManyChat's "External Request" action POSTs here
//     when a DM flow collects an email; any future landing page can use
//     the same endpoint. Body: { email, name?, handle?, trigger_word?, source? }
//
// AUTHED (session required):
//   GET  /api/audience/projects/:projectId              → stats + recent contacts
//                                                         (+ capture URL for writers)
//   GET  /api/audience/projects/:projectId/export.csv   → full list CSV (writer)
//   POST /api/audience/projects/:projectId/contacts     → manual add (writer)
//   POST /api/audience/projects/:projectId/resync       → re-push unsynced to Resend (writer)
//   POST /api/audience/projects/:projectId/rotate-token → new capture token (admin)

import { Router } from 'express'
import crypto from 'crypto'
import { Resend } from 'resend'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'
import { assertWriter } from '../permissions'
import { logError, logInfo } from '../diag'
import { sendAdminAlert } from '../email'
import { hasAnthropicKey, generateLeadFollowup } from '../anthropic'
import { syncContactToResend, resyncProject } from '../audience_resend'

const resendApiKey = process.env.RESEND_API_KEY
const resend = resendApiKey ? new Resend(resendApiKey) : null

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export const audienceRouter = Router()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function cleanStr(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
}

// ── PUBLIC capture hook (registered BEFORE requireUser) ──────────────
audienceRouter.post('/hooks/:token', async (req, res) => {
  const token = req.params.token
  if (!token || token.length < 16) { res.status(404).json({ error: 'not_found' }); return }
  const proj = await pool.query<{ id: string; name: string; lead_alerts: boolean }>(
    `SELECT id, name, audience_lead_alerts AS lead_alerts
       FROM projects WHERE audience_capture_token = $1`,
    [token],
  )
  if (proj.rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  const projectId = proj.rows[0].id
  const projectName = proj.rows[0].name
  const leadAlerts = proj.rows[0].lead_alerts === true

  const email = cleanStr(req.body?.email, 320)?.toLowerCase() ?? null
  if (!email || !EMAIL_RE.test(email)) {
    res.status(400).json({ error: 'valid_email_required' })
    return
  }
  const name = cleanStr(req.body?.name, 120)
  const handle = cleanStr(req.body?.handle, 120)
  const triggerWord = cleanStr(req.body?.trigger_word, 60)
  const sourceRaw = cleanStr(req.body?.source, 30)
  const source = sourceRaw && ['manychat', 'landing', 'manual', 'import'].includes(sourceRaw)
    ? sourceRaw : 'manychat'

  try {
    // Re-capture of an existing contact refreshes details and clears an
    // unsubscribe (they opted back in by going through the flow again).
    const { rows } = await pool.query<{ id: string; created: boolean }>(
      `INSERT INTO audience_contacts (project_id, email, name, handle, source, trigger_word)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (project_id, email) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, audience_contacts.name),
         handle = COALESCE(EXCLUDED.handle, audience_contacts.handle),
         trigger_word = COALESCE(EXCLUDED.trigger_word, audience_contacts.trigger_word),
         unsubscribed_at = NULL
       RETURNING id, (xmax = 0) AS created`,
      [projectId, email, name, handle, source, triggerWord],
    )
    const contact = rows[0]
    // Resend mirror is fire-and-forget — capture must stay fast for
    // ManyChat's request timeout.
    void syncContactToResend({ projectId, contactId: contact.id, email, name })
    // Lead alert (sales-pipeline lists only): tell the admin the moment
    // a NEW lead lands — a lead answered in the hour closes; one found
    // next week doesn't. No dedupe key: every new lead is its own email.
    // Re-captures of an existing contact stay silent.
    if (leadAlerts && contact.created) {
      const lines = [
        `New lead for ${projectName}:`,
        '',
        `  Email:   ${email}`,
        name ? `  Name:    ${name}` : null,
        handle ? `  Handle:  ${handle}` : null,
        triggerWord ? `  Trigger: ${triggerWord}` : null,
        `  Source:  ${source}`,
        '',
        'Reply while it\'s warm. Full list in Slate → show page → Audience.',
      ].filter((l): l is string => l !== null)
      void sendAdminAlert(`New lead: ${email} (${projectName})`, lines.join('\n'))
    }
    logInfo('audience: contact captured', { projectId, source, new: contact.created })
    res.json({ ok: true, new: contact.created })
  } catch (err) {
    logError('audience: capture failed', {
      projectId, error: err instanceof Error ? err.message : String(err),
    })
    res.status(500).json({ error: 'capture_failed' })
  }
})

// ── Everything below requires a session ──────────────────────────────
audienceRouter.use(requireUser)

async function assertProjectAccess(userId: string, role: string, projectId: string): Promise<boolean> {
  if (role === 'admin') return true
  const { rows } = await pool.query(
    `SELECT 1 FROM projects p
       LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
      WHERE p.id = $2 AND (p.created_by = $1 OR m.user_id IS NOT NULL) LIMIT 1`,
    [userId, projectId],
  )
  return rows.length > 0
}

function captureUrl(token: string): string {
  const baseUrl = (process.env.APP_BASE_URL || 'https://slate.strawhutmedia.com').replace(/\/+$/, '')
  return `${baseUrl}/api/audience/hooks/${token}`
}

// GET stats + recent contacts. Writers also get the capture URL
// (generated on first view) for pasting into ManyChat.
audienceRouter.get('/projects/:projectId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!(await assertProjectAccess(user.id, user.role, projectId))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const stats = await pool.query<{ total: string; last7: string; last30: string; unsubscribed: string; unsynced: string }>(
    `SELECT count(*) FILTER (WHERE unsubscribed_at IS NULL) AS total,
            count(*) FILTER (WHERE unsubscribed_at IS NULL AND created_at > now() - interval '7 days') AS last7,
            count(*) FILTER (WHERE unsubscribed_at IS NULL AND created_at > now() - interval '30 days') AS last30,
            count(*) FILTER (WHERE unsubscribed_at IS NOT NULL) AS unsubscribed,
            count(*) FILTER (WHERE unsubscribed_at IS NULL AND resend_synced_at IS NULL) AS unsynced
       FROM audience_contacts WHERE project_id = $1`,
    [projectId],
  )
  const recent = await pool.query(
    `SELECT id, email, name, handle, source, trigger_word, resend_synced_at, created_at
       FROM audience_contacts
      WHERE project_id = $1 AND unsubscribed_at IS NULL
      ORDER BY created_at DESC LIMIT 20`,
    [projectId],
  )
  // Capture token: admins + project writers can see/mint it.
  let capture: { token: string; url: string } | null = null
  let leadAlerts = false
  const isWriter = user.role === 'admin' || await assertProjectAccess(user.id, user.role, projectId)
  if (isWriter) {
    const t = await pool.query<{ audience_capture_token: string | null; audience_lead_alerts: boolean }>(
      `SELECT audience_capture_token, audience_lead_alerts FROM projects WHERE id = $1`, [projectId],
    )
    leadAlerts = t.rows[0]?.audience_lead_alerts === true
    let token = t.rows[0]?.audience_capture_token ?? null
    if (!token) {
      token = crypto.randomBytes(24).toString('base64url')
      await pool.query(
        `UPDATE projects SET audience_capture_token = $2
          WHERE id = $1 AND audience_capture_token IS NULL`,
        [projectId, token],
      )
      const re = await pool.query<{ audience_capture_token: string }>(
        `SELECT audience_capture_token FROM projects WHERE id = $1`, [projectId],
      )
      token = re.rows[0].audience_capture_token
    }
    capture = { token, url: captureUrl(token) }
  }
  const s = stats.rows[0]
  res.json({
    stats: {
      total: Number(s.total), last7: Number(s.last7), last30: Number(s.last30),
      unsubscribed: Number(s.unsubscribed), unsynced: Number(s.unsynced),
    },
    recent: recent.rows,
    capture,
    leadAlerts,
  })
})

// CSV export — writer only (it's PII).
audienceRouter.get('/projects/:projectId/export.csv', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!await assertWriter(user, projectId, res)) return
  const { rows } = await pool.query<{
    email: string; name: string | null; handle: string | null;
    source: string; trigger_word: string | null; created_at: string;
  }>(
    `SELECT email, name, handle, source, trigger_word, created_at
       FROM audience_contacts
      WHERE project_id = $1 AND unsubscribed_at IS NULL
      ORDER BY created_at`,
    [projectId],
  )
  const esc = (v: string | null) => v == null ? '' : `"${v.replace(/"/g, '""')}"`
  const lines = ['email,name,handle,source,trigger_word,captured_at']
  for (const r of rows) {
    lines.push([esc(r.email), esc(r.name), esc(r.handle), esc(r.source), esc(r.trigger_word), esc(String(r.created_at))].join(','))
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="audience-${projectId}.csv"`)
  res.send(lines.join('\n'))
})

// Manual add — writer.
audienceRouter.post('/projects/:projectId/contacts', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!await assertWriter(user, projectId, res)) return
  const email = cleanStr(req.body?.email, 320)?.toLowerCase() ?? null
  if (!email || !EMAIL_RE.test(email)) { res.status(400).json({ error: 'valid_email_required' }); return }
  const name = cleanStr(req.body?.name, 120)
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO audience_contacts (project_id, email, name, source)
     VALUES ($1, $2, $3, 'manual')
     ON CONFLICT (project_id, email) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, audience_contacts.name),
       unsubscribed_at = NULL
     RETURNING id`,
    [projectId, email, name],
  )
  void syncContactToResend({ projectId, contactId: rows[0].id, email, name })
  res.json({ ok: true })
})

// Re-push unsynced contacts to Resend — writer.
audienceRouter.post('/projects/:projectId/resync', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!await assertWriter(user, projectId, res)) return
  const pushed = await resyncProject(projectId)
  res.json({ ok: true, pushed })
})

// Toggle instant lead alerts — admin only. On = every NEW capture for
// this project emails the admin immediately (sales-pipeline mode).
audienceRouter.post('/projects/:projectId/lead-alerts', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  if (user.role !== 'admin') { res.status(403).json({ error: 'admin_only' }); return }
  const enabled = req.body?.enabled === true
  const { rowCount } = await pool.query(
    `UPDATE projects SET audience_lead_alerts = $2 WHERE id = $1`,
    [req.params.projectId, enabled],
  )
  if ((rowCount ?? 0) === 0) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ ok: true, enabled })
})

// ─────────────────────────────────────────────────────────────────────
// Lead follow-up drafts — Claude drafts, a human edits and sends.
// Restricted to lists flagged as sales pipelines (audience_lead_alerts)
// — never a fan list. Slate never emails fans (see CLAUDE.md); this is
// the one place Slate sends real email on a human's behalf, and it is
// gated hard on that flag, not just hidden in the UI.
// ─────────────────────────────────────────────────────────────────────

async function assertLeadList(projectId: string): Promise<{ ok: true; name: string } | { ok: false }> {
  const { rows } = await pool.query<{ name: string; audience_lead_alerts: boolean }>(
    `SELECT name, audience_lead_alerts FROM projects WHERE id = $1`, [projectId],
  )
  if (rows.length === 0 || rows[0].audience_lead_alerts !== true) return { ok: false }
  return { ok: true, name: rows[0].name }
}

// GET leads needing attention (status != sent), most recent first.
audienceRouter.get('/projects/:projectId/followups', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!(await assertProjectAccess(user.id, user.role, projectId))) {
    res.status(403).json({ error: 'forbidden' }); return
  }
  const { rows } = await pool.query(
    `SELECT id, email, name, handle, source, trigger_word, created_at,
            followup_notes, followup_draft_subject, followup_draft_body,
            followup_status, followup_drafted_at, followup_sent_at
       FROM audience_contacts
      WHERE project_id = $1 AND unsubscribed_at IS NULL AND followup_status <> 'sent'
      ORDER BY created_at DESC
      LIMIT 100`,
    [projectId],
  )
  const proj = await pool.query<{ leads_booking_url: string | null }>(
    `SELECT leads_booking_url FROM projects WHERE id = $1`, [projectId],
  )
  res.json({ leads: rows, bookingUrl: proj.rows[0]?.leads_booking_url ?? null })
})

// Save the optional booking link used in drafts — writer.
audienceRouter.put('/projects/:projectId/booking-url', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!await assertWriter(user, projectId, res)) return
  const url = cleanStr(req.body?.url, 500)
  await pool.query(`UPDATE projects SET leads_booking_url = $2 WHERE id = $1`, [projectId, url])
  res.json({ ok: true })
})

// Save Caroline's context notes before drafting (or any time) — writer.
audienceRouter.put('/contacts/:contactId/followup-notes', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const contactId = req.params.contactId
  const c = await pool.query<{ project_id: string }>(
    `SELECT project_id FROM audience_contacts WHERE id = $1`, [contactId],
  )
  if (c.rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!await assertWriter(user, c.rows[0].project_id, res)) return
  const notes = cleanStr(req.body?.notes, 4000)
  await pool.query(`UPDATE audience_contacts SET followup_notes = $2 WHERE id = $1`, [contactId, notes])
  res.json({ ok: true })
})

// Draft (or redraft) a follow-up — writer, lead lists only.
audienceRouter.post('/contacts/:contactId/followup/draft', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const contactId = req.params.contactId
  if (!hasAnthropicKey()) { res.status(503).json({ error: 'anthropic_key_missing' }); return }
  const c = await pool.query<{
    project_id: string; email: string; name: string | null; handle: string | null
    source: string; trigger_word: string | null; created_at: string; followup_notes: string | null
  }>(
    `SELECT project_id, email, name, handle, source, trigger_word, created_at, followup_notes
       FROM audience_contacts WHERE id = $1`,
    [contactId],
  )
  if (c.rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  const lead = c.rows[0]
  if (!await assertWriter(user, lead.project_id, res)) return
  const list = await assertLeadList(lead.project_id)
  if (!list.ok) { res.status(400).json({ error: 'not_a_lead_list', detail: 'Turn on Instant lead alerts for this list before drafting follow-ups.' }); return }

  const proj = await pool.query<{ leads_booking_url: string | null }>(
    `SELECT leads_booking_url FROM projects WHERE id = $1`, [lead.project_id],
  )

  try {
    const result = await generateLeadFollowup({
      leadName: lead.name, leadEmail: lead.email, leadHandle: lead.handle,
      triggerWord: lead.trigger_word, source: lead.source, capturedAt: lead.created_at,
      notes: lead.followup_notes, bookingUrl: proj.rows[0]?.leads_booking_url ?? null,
      senderName: user.display_name || user.name, projectName: list.name,
    })
    await pool.query(
      `UPDATE audience_contacts
          SET followup_draft_subject = $2, followup_draft_body = $3,
              followup_status = 'drafted', followup_drafted_at = now()
        WHERE id = $1`,
      [contactId, result.subject, result.body],
    )
    logInfo('lead followup: drafted', { contactId, projectId: lead.project_id })
    res.json({ ok: true, subject: result.subject, body: result.body })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logError('lead followup: draft failed', { contactId, error: msg })
    res.status(500).json({ error: 'draft_failed', detail: msg.slice(0, 400) })
  }
})

// Hand-edit the draft before sending — writer.
audienceRouter.patch('/contacts/:contactId/followup', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const contactId = req.params.contactId
  const c = await pool.query<{ project_id: string }>(
    `SELECT project_id FROM audience_contacts WHERE id = $1`, [contactId],
  )
  if (c.rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  if (!await assertWriter(user, c.rows[0].project_id, res)) return
  const subject = cleanStr(req.body?.subject, 300)
  const body = cleanStr(req.body?.body, 8000)
  if (!subject || !body) { res.status(400).json({ error: 'subject_and_body_required' }); return }
  await pool.query(
    `UPDATE audience_contacts
        SET followup_draft_subject = $2, followup_draft_body = $3,
            followup_status = CASE WHEN followup_status = 'none' THEN 'drafted' ELSE followup_status END
      WHERE id = $1`,
    [contactId, subject, body],
  )
  res.json({ ok: true })
})

// Send — writer, lead lists only. Sends from the verified system
// domain but with a human display name and Reply-To set to the
// sender's own inbox, so a reply lands with the actual person, not
// Slate. Never batched, never scheduled — one deliberate click.
audienceRouter.post('/contacts/:contactId/followup/send', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const contactId = req.params.contactId
  if (!resend) { res.status(503).json({ error: 'resend_not_configured' }); return }
  const c = await pool.query<{
    project_id: string; email: string; followup_draft_subject: string | null; followup_draft_body: string | null
  }>(
    `SELECT project_id, email, followup_draft_subject, followup_draft_body
       FROM audience_contacts WHERE id = $1`,
    [contactId],
  )
  if (c.rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  const lead = c.rows[0]
  if (!await assertWriter(user, lead.project_id, res)) return
  const list = await assertLeadList(lead.project_id)
  if (!list.ok) { res.status(400).json({ error: 'not_a_lead_list' }); return }
  if (!lead.followup_draft_subject?.trim() || !lead.followup_draft_body?.trim()) {
    res.status(400).json({ error: 'no_draft', detail: 'Draft (or write) the email before sending.' })
    return
  }
  if (!user.email) { res.status(400).json({ error: 'sender_email_required', detail: 'Your Slate account needs an email so replies can reach you.' }); return }

  // strawhutmedia.net is the only domain verified in this Resend
  // account today (see CLAUDE.md). A human display name + Reply-To
  // keeps this from reading like the slate@ system sender even though
  // it shares the domain.
  const senderName = user.display_name || user.name || 'Straw Hut Media'
  const LEADS_FROM_DOMAIN = process.env.LEADS_MAIL_DOMAIN || 'strawhutmedia.net'
  try {
    const result = await resend.emails.send({
      from: `${senderName} at Straw Hut Media <hello@${LEADS_FROM_DOMAIN}>`,
      replyTo: user.email,
      to: lead.email,
      subject: lead.followup_draft_subject,
      text: lead.followup_draft_body,
      html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#0b0d12;white-space:pre-wrap">${escapeHtml(lead.followup_draft_body)}</div>`,
    })
    if (result.error) throw new Error(result.error.message || 'send_failed')
    await pool.query(
      `UPDATE audience_contacts
          SET followup_status = 'sent', followup_sent_at = now(), followup_sent_by = $2
        WHERE id = $1`,
      [contactId, user.id],
    )
    logInfo('lead followup: sent', { contactId, projectId: lead.project_id, by: user.id })
    res.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logError('lead followup: send failed', { contactId, error: msg })
    res.status(500).json({ error: 'send_failed', detail: msg.slice(0, 400) })
  }
})

// Rotate the capture token — admin only (invalidates the old URL in
// every ManyChat flow, so this is deliberate-action territory).
audienceRouter.post('/projects/:projectId/rotate-token', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  if (user.role !== 'admin') { res.status(403).json({ error: 'admin_only' }); return }
  const projectId = req.params.projectId
  const token = crypto.randomBytes(24).toString('base64url')
  const { rowCount } = await pool.query(
    `UPDATE projects SET audience_capture_token = $2 WHERE id = $1`,
    [projectId, token],
  )
  if ((rowCount ?? 0) === 0) { res.status(404).json({ error: 'not_found' }); return }
  logInfo('audience: capture token rotated', { projectId })
  res.json({ ok: true, token, url: captureUrl(token) })
})

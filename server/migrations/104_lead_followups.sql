-- Per-lead follow-up drafts: Claude drafts a personal follow-up email
-- for a captured lead, a human (Caroline/Ryan) edits it in Slate, and
-- sends it themselves. This is deliberately NOT the batch outreach
-- follow-up campaign (one template, jittered send to many prospects)
-- — a warm inbound lead gets one individually-written reply, reviewed
-- before it goes, same as any other message a human would send.
--
-- Restricted to lists with audience_lead_alerts = true (sales
-- pipelines) — enforced server-side too. Slate never emails fans
-- (see CLAUDE.md); this table must never be used for a fan list.
ALTER TABLE audience_contacts
  ADD COLUMN IF NOT EXISTS followup_notes text,
  ADD COLUMN IF NOT EXISTS followup_draft_subject text,
  ADD COLUMN IF NOT EXISTS followup_draft_body text,
  ADD COLUMN IF NOT EXISTS followup_status text NOT NULL DEFAULT 'none'
    CHECK (followup_status IN ('none', 'drafted', 'sent')),
  ADD COLUMN IF NOT EXISTS followup_drafted_at timestamptz,
  ADD COLUMN IF NOT EXISTS followup_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS followup_sent_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- Optional booking link shown to Claude when drafting, so the CTA can
-- point somewhere real (e.g. the GHL /book page) instead of a vague
-- "let's find time."
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS leads_booking_url text;

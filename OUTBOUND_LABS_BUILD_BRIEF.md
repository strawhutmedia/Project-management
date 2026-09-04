# Build brief — bring Straw Hut's cold-outreach in-house (replace/mirror Outbound Labs) in Slate

**For:** the Slate session picking up the cold-outreach build.
**Owner:** Ryan (ryan@strawhutmedia.com). **Written:** 2026-08-23.

## Goal in one line
Straw Hut currently pays **Outbound Labs $1,500/mo** for an "AI SDR" that cold-emails
prospects, handles the reply conversation autonomously, and books discovery calls.
Ryan wants to **rebuild that capability inside Slate** (which already has an outreach
system) so the pipeline is owned in-house — while keeping Outbound Labs running until
the in-house version is proven. Do **not** cancel Outbound Labs; mirror it, then compare.

## What Outbound Labs actually does (reverse-engineered from the live emails)
It's a full closed loop:
1. **Cold email** to a prospect introducing Straw Hut's services.
2. **AI handles the entire back-and-forth** in Ryan's voice — answers replies, qualifies,
   handles objections, sends collateral (they've sent one-pagers / overview decks /
   portfolio links via Google Drive in at least one thread).
3. When the prospect is warm, the AI **drops a calendar link** and gets them to book.
4. Booking fires two emails to Ryan: **Appointlet "Scheduled"** (the calendar event) and
   **OutboundLabs "New Result! 🥳"** (their tool reporting the win + the conversation).

Volume: ~**10 booked calls/month**. After Ryan's qualification bar (see below), ~**6/mo are
truly qualified** → ~**$250 per qualified call**. That's the number the in-house build must beat.

## Data each "New Result" email contains (useful for training the in-house AI)
From `admin@outboundlabs.com`, subject "OutboundLabs // New Result! 🥳️":
- **Lead Info:** name, job title, company, email
- **AI Engagement Summary:** a paragraph describing how the conversation went
- **Leads Last Response:** the prospect's verbatim final reply (great voice/intent data)
- **AI SDR Last Response:** what the AI said to close the booking

These are a ready-made training/eval set for the in-house reply-handler — real prospects,
real objections, real winning replies. ~40 of them sit in Ryan's Gmail (search
`from:admin@outboundlabs.com`), and the matching Appointlet questionnaires alongside them.

## Ryan's qualification rules (bake these into the in-house scoring)
- 🟢 **Money call** = wants Straw Hut to **produce/host/make a podcast FOR their business**,
  AND marketing spend **≥ $1k/month**.
- 🔴 **Not his deal** = just wants to **be a guest / be on a podcast / get exposure** (they
  want attention, not to pay) — OR marketing spend **< $1k/month**.
- 🟡 **Borderline** = genuine done-for-you fit but under $1k, or intent unclear.
- The single sharpest signal for money-vs-timewaster is the **language in the reply**:
  "host our podcast / make us a show / studio tour / next steps" = money; "I'd love to come
  on / be featured / be a guest" = pass.

## Components to build in Slate (Slate already has an outreach system — extend it)
1. **Lead sourcing** — a list of target companies/contacts (the risky, high-value input).
2. **Sending infrastructure** — verified sending domains + warmed inboxes. **Deliverability
   is the hard part and is most of what the $1,500/mo actually buys.** Do not send from the
   primary strawhutmedia.com domain; use dedicated cold-outreach domains.
3. **AI reply-handler** — an agent that answers inbound replies in Ryan's voice, qualifies
   against the rules above, sends collateral, and drops the booking link. Train/eval it on
   the ~40 real Outbound Labs threads.
4. **Booking + handoff** — currently Appointlet (owned by Outbound Labs, calendar id in
   their account). In-house, point to a Straw Hut-owned calendar (GoHighLevel calendar
   `ym8vwJwU2MiL5RuW7v68` "Discovery Call", or Slate's own) so bookings are owned.
5. **CRM sync** — push every booked call into GoHighLevel (the sub-account token now works —
   see below). Tag source, attach the conversation + questionnaire as a note.

## Integration points already in place (as of 2026-08-23)
- **GoHighLevel** contact capture is now working. A **sub-account Private Integration token**
  (`GHL_API_TOKEN`, prefix `pit-…`) with contacts + calendars scopes is live on the STRAW
  HUT SITE Railway service. Location id: `TrsMh89uPvyZdZ6ZrIyy`. API base
  `https://services.leadconnectorhq.com`, Version header `2021-07-28` (calendars `2021-04-15`).
  Upsert endpoint `POST /contacts/upsert`.
- **~38 existing Outbound Labs/Appointlet leads** were backfilled into GHL, deduped, and the
  14 under-$1k tagged `unqualified-under-1k`. Tags used: `appointlet`, `info-session`,
  `outbound-labs`.
- **Pre-call prep automation** exists: a Routine emails Ryan a briefing (verdict + what the
  prospect wants) ~15 min before each Info Session, via Resend from `prep@strawhutmedia.com`.
- **Resend** is the approved transactional email service (domain strawhutmedia.com verified).

## Risks / where this is hard (be honest with Ryan)
- **Deliverability** (domains, warmup, spam avoidance) — the real moat; underestimate it and
  the whole thing sends to spam and books nothing.
- **Reply-handling quality** — the AI must not embarrass the brand or over-promise. Needs
  guardrails + a human-review mode before it's trusted to send autonomously.
- **Compliance** — CAN-SPAM / unsubscribe handling on cold email.

## Suggested phasing
1. **Phase 1 — mirror & measure:** build sending + AI reply-handler, run a small in-house
   campaign in parallel with Outbound Labs, book into a Straw Hut-owned calendar, compare
   cost-per-qualified-call against their ~$250.
2. **Phase 2 — scale what works**, then decide whether to wind down Outbound Labs.
Keep paying Outbound Labs the whole time until Phase 1 clears their bar.

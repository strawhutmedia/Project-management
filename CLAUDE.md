# Slate — operating notes for Claude

This is **Slate**, Straw Hut Media's project tracker. The first project running
on it is the **Maggie Glass record** (13 songs, 14 tracks).

## Architecture (one-line summary)

- **Code**: GitHub `strawhutmedia/Project-management` (this repo), branch `main`
- **Deploy**: Railway, single service named "Project-management" in the SLATE
  project, paired with a Railway Postgres service
- **Email**: Resend (same key as Pod Booster), env var `RESEND_API_KEY`
- **Files** (planned): Dropbox via OAuth, admin-only connection
- **Domain**: `slate.strawhutmedia.com` (CNAME in GoDaddy → Railway)

Push to `main` → Railway auto-builds (`npm install && npm run build`) → starts
(`npm start`) → app serves both the React SPA and `/api/*` from the same Express
process on port 8080.

## Self-observability — read this first every session

The app **reports its own status to the `status` branch of this repo**. Before
doing anything else in a session that touches Slate, check it:

```
mcp__github__get_file_contents owner=strawhutmedia repo=Project-management path=latest.json ref=status
mcp__github__get_file_contents owner=strawhutmedia repo=Project-management path=errors.jsonl ref=status
```

`latest.json` has the most recent boot snapshot: env presence, file paths,
DB state, applied migrations, user/project counts, and the last 50 log lines.

`errors.jsonl` is an append-only log of every error the app caught (capped at
the last 200 lines). Each line is a JSON object with `ts`, `msg`, `data`.

If you see errors that aren't yet fixed in `main`, **investigate, fix, push to
main**. Railway will auto-deploy. After the new boot reports healthy, the app
emails the admin (Ryan) a "Recovered" alert automatically.

## Client invoices (QuickBooks AR) — NEVER send one yourself

`/invoicing` has a "Client Invoices" card (`server/routes/qb_invoices.ts` +
`ClientInvoicesCard` in `src/pages/InvoicingPage.tsx`) for billing clients
(Shaping Freedom, etc.) via QuickBooks. **Creating a draft there never emails
anyone** — QBO invoices are born unsent. Only a separate "Send" button, one
per invoice, actually emails the client, and **Claude must never call that
send endpoint (or any raw QuickBooks-connector send/email tool) itself.**
Ryan reviews every draft and clicks Send personally, every time, no
exceptions — this was learned the hard way (Sept 2026: an invoice went to
the wrong recipient, on the client's birthday, because a session sent
directly via the QuickBooks MCP connector without this review step, and the
"draft in Slate" system this note describes didn't actually exist yet).

If asked to "create" or "make" an invoice, that means create a **draft** —
in the Client Invoices card above, not a bare QuickBooks-connector call.
Never treat "make/create the invoice" as authorization to also send it.

Every draft should CC `accounting@strawhutmedia.com` (the form defaults to
this — don't clear it without being told to). Double-check the send-to
address against what Ryan actually says, not just whatever QuickBooks has on
file for the customer — a wrong on-file contact is exactly what caused the
Sept 2026 incident.

Every invoice in the Client Invoices card — draft or already-sent — has an
**Edit** button (`PUT /api/qb/invoices/:id`) that lets Ryan/Caroline fix
line items, dates, the note, the send-to address, or the CC. Editing never
emails anyone by itself, even on an already-sent invoice; it just updates
the QuickBooks record. Fixing a mistake on an invoice that already went out
means: edit it here, then hit **Resend** (the same Send button, relabeled)
— which is still the one and only action that emails the client, still
gated behind an explicit button press, still never called by Claude
directly.

This rule extends to **all** outbound client-facing email, not just
invoices: never send anything to a client, fan, or lead from any tool
(Gmail, Resend, the QuickBooks connector, anything) without an explicit,
same-turn instruction to send — draft it and hand it back for review by
default.

## Email triggers (already wired)

- Magic-link sign-in → user's inbox
- Any `logError` call → admin email (rate-limited to once per hour per error key)
- Status went healthy → degraded → admin email "Degraded"
- Status went degraded → healthy → admin email "Recovered"

## Email transport — Amazon SES via a Resend-compatible shim, Resend still live for two things

Slate's transactional email (the four triggers above, plus invites,
outreach/lead-follow-up sends, and contractor invoices) goes through
`server/mailTransport.ts` — a drop-in `Resend`-shaped class that routes
`.emails.send()` to **Amazon SES** when `SES_ACCESS_KEY_ID` +
`SES_SECRET_ACCESS_KEY` are set, and falls back to the real Resend package
otherwise. Every caller still does `import { Resend } from '...mailTransport'`
and calls it exactly like the real SDK — `server/email.ts`,
`server/routes/outreach.ts`, and `server/routes/audience.ts` all point at it.
Sends carry SES message tags (`app=slate`, `stage=<outreach|sales|team|
internal|vendor>`, `show=<project>` where applicable) so the SES/SNS event
stream stays categorized.

**Before trusting this for real traffic, confirm the SES account actually has
production access.** A sandboxed SES account only delivers to individually
verified addresses — magic links, invites, outreach, and invoices to real
people would silently fail while Slate believes everything's fine.
`server/boot_ses_probe.ts` (calls `sesAccountStatus()` in `mailTransport.ts`)
checks this on every boot and logs the result — `ses probe: production access
confirmed…` or `ses probe: SES account is still SANDBOXED` — in the status
branch / `/api/_diag` `recentLog`. Check that before assuming SES is actually
delivering to anyone outside the team.

**Update (2026-09-08): all three original Resend-only gaps have a real SES
equivalent in code now. The last one still needs one small AWS-console
action from whoever has console access before it actually turns on.**

- **Domain verification/rotation — CLOSED.** `server/routes/outreach_domains.ts`
  now has a `POST /sync-with-ses` action (button: "🔄 Sync with SES" on
  `/admin/outreach/domains`) alongside the original Resend one. Add a new
  rotation domain via the **AWS SES console** ("Create identity" → add the
  DKIM CNAMEs it gives you to DNS) instead of Resend's dashboard, then run
  this sync to pull its real SES verification status into
  `sending_domains.status` — no Resend involved. `mailTransport.ts` exports
  `sesCheckIdentity(domain)` (`GetEmailIdentity`) for this.
- **Fan-list broadcasts — CLOSED.** `POST /api/audience/projects/:id/broadcast`
  (UI: the "📣 Broadcast to this list" panel on fan lists in `AudienceSection.tsx`,
  hidden on lead-alert/sales lists) sends directly from Slate to everyone
  in `audience_contacts` who hasn't unsubscribed — through the same
  `mailTransport` shim as everything else, so it's on SES today. Every send
  gets a real per-contact one-click unsubscribe link + `List-Unsubscribe`
  header (`GET/POST /api/audience/unsub/:projectId/:contactId/:sig`, HMAC-signed
  with `AUDIENCE_UNSUB_SECRET`, falls back to hashing `DATABASE_URL` if unset).
  This replaces needing to log into the Resend dashboard to broadcast; the
  old Resend-Audience mirror in `server/audience_resend.ts` still runs
  best-effort but nothing depends on it sending anymore.
- **Bounce/complaint auto-pause on the rotation pool — CODE IS DONE, needs
  one AWS-console step to turn on.** `outreach_webhook.ts`'s `maybePauseDomain()`
  (auto-pauses a rotation domain whose 7-day bounce+complaint rate crosses
  5%) used to be driven entirely by Resend's Svix webhook. It now has a full
  SES/SNS equivalent: `server/routes/ses_notify.ts` is a public endpoint
  (`POST /api/ses/notify`) that verifies AWS's own SNS message signature,
  auto-confirms the SNS subscription handshake, and feeds Bounce/Complaint
  notifications into the exact same `handleNegativeEvent()` logic the Resend
  webhook uses (matching by the SES `MessageId` already stored in
  `outreach_sends.resend_message_id` — sends already go out via SES, so
  that column already holds SES message IDs, not Resend ones). Every boot,
  and on demand via the "🔌 Wire bounce webhook" button on
  `/admin/outreach/domains` (`POST /api/admin/outreach/domains/bounce-webhook/sync`,
  `server/ses_bounce_setup.ts`), Slate wires its `SES_CONFIG_SET` to publish
  Bounce/Complaint events to `SES_SNS_TOPIC_ARN` — using the same
  `SES_ACCESS_KEY_ID`/`SES_SECRET_ACCESS_KEY` Slate already sends mail with,
  no new AWS credentials needed anywhere in this app.
  **The one thing only a human with AWS console access can do:** create the
  SNS topic itself and add an HTTPS subscription pointing at
  `https://slate.strawhutmedia.com/api/ses/notify` (SNS's confirmation
  handshake fires automatically once that subscription exists — nothing
  else to click), then set `SES_SNS_TOPIC_ARN` to that topic's ARN as a
  Railway env var on this service. The button above reports exactly what's
  missing (`ses_sns_topic_arn_not_set`, etc.) until that's done. Until then,
  deleting Resend means losing the live auto-pause safety net for the
  outreach rotation pool; sends themselves keep working fine (confirmed all
  4 domains verified in SES), there's just no automatic reaction if one
  starts bouncing.

## Outreach reply capture (inbound email) — replies go to Slate, not a human inbox

A show's outreach template (`outreach_templates.reply_to`) can point at a
**Slate-owned capture address** instead of a real person's mailbox:
`p-<projectId>@<INBOUND_REPLY_DOMAIN>` (e.g.
`p-3f77d190-30b4-11f1-9870-3bb0f3631011@strawhutmedia.net`). The Outreach
template editor shows this exact address per show and has a one-click
"Use Slate inbox (auto-detect replies)" button that fills reply-to with it.

When a prospect replies to that address, Amazon SES receives the mail,
publishes it to an SNS topic, and `server/routes/ses_inbound_reply.ts`
(public endpoint `POST /api/ses/inbound-reply`, SNS-signature-verified like
`ses_notify.ts` — the two share `server/sns_verify.ts`) parses it with
`mailparser`, matches the sender's address against that show's
`outreach_prospects`, and:
1. Marks the prospect `status = 'replied'` (same bookkeeping as the manual
   "mark as replied" button — auto-files them into the Rolodex too).
2. Emails whoever's in that show's `outreach_templates.notify_email`
   (editable in the same template editor, "Notify on reply" field; falls
   back to `ADMIN_EMAIL` if blank) the reply's subject/body and a link
   straight to that show's Outreach page in Slate.

Nobody's real inbox needs to touch AWS for this to work — only relevant if
a show's reply-to is actually set to the `p-<projectId>@…` capture address;
any show that keeps a normal human reply-to (e.g. `booking@…`) is
unaffected, replies just land there the ordinary way as before.

**The one thing that needs an AWS-console + DNS action first, same shape as
the bounce/complaint setup:** `INBOUND_REPLY_DOMAIN` must be a domain (or
subdomain) where **nobody has a real mailbox** — MX records are domain-wide,
so pointing MX at SES for a domain real humans read mail on would break
their mail entirely. `strawhutmedia.net` (the default) is a good fit since
CLAUDE.md already treats it as system-only (`slate@strawhutmedia.net` is for
alerts, not a person). To turn this on for a show:
1. Confirm nobody receives real mail at `INBOUND_REPLY_DOMAIN`'s domain.
2. AWS SES console → Email receiving → verify the domain for receiving,
   add its MX record in DNS (GoDaddy) pointing at
   `inbound-smtp.<region>.amazonaws.com`.
3. Create a receipt rule (recipient: the whole domain, or specific
   `p-*@…` addresses) with action **SNS**, "include original message
   content" — needed for the full email to arrive inline (this endpoint
   doesn't implement an S3 fallback for oversized messages).
4. Create/reuse an SNS topic, subscribe it (HTTPS) to
   `https://slate.strawhutmedia.com/api/ses/inbound-reply` — same
   auto-confirm handshake as the bounce/complaint topic.
5. Set that show's reply-to to the `p-<projectId>@…` address shown in its
   template editor, and set `notify_email` to whoever should get pinged.

## Required env vars on the Railway "Project-management" service

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection (use `${{Postgres.DATABASE_URL}}`) |
| `RESEND_API_KEY` | Fallback transport when SES isn't configured, plus the only transport for Outreach domain management and the Audience CRM's Resend dashboard broadcasts (see "Email transport" above). Same key as Pod Booster — don't delete this account. |
| `SES_ACCESS_KEY_ID` / `SES_SECRET_ACCESS_KEY` | Amazon SES credentials — when both are set, `server/mailTransport.ts` sends transactional/outreach/lead-follow-up mail via SES instead of Resend. Falls back to `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` if the dedicated ones aren't set. |
| `SES_REGION` | Region the SES identity lives in. Falls back to `AWS_REGION`, then `us-east-1`. |
| `SES_CONFIG_SET` | SES configuration set name — required for bounce/complaint tracking (see below), otherwise optional. |
| `SES_SNS_TOPIC_ARN` | ARN of the SNS topic subscribed to `/api/ses/notify`. Must be created once in the AWS console (topic + HTTPS subscription to this endpoint) — see "Email transport" above. Without it, bounce/complaint auto-pause on the outreach rotation pool has no way to hear about bounces. |
| `INBOUND_REPLY_DOMAIN` | Domain used for Slate's per-show outreach-reply capture addresses (`p-<projectId>@<this>`) — see "Outreach reply capture" above. Defaults to `strawhutmedia.net`. Must be a domain with no real human mailboxes (MX is domain-wide). |
| `GITHUB_TOKEN` | Fine-grained PAT, repo: this repo, contents: write — for status reporting |
| `ADMIN_EMAIL` | Defaults to `ryan@strawhutmedia.com` if not set |
| `APP_BASE_URL` | Defaults to `https://slate.strawhutmedia.com` if not set |
| `PORT` | Auto-injected by Railway, defaults to 8080 |
| `INVOICING_ENC_KEY` | AES-256 key (64 hex chars, `openssl rand -hex 32`) that encrypts contractor W9 TINs. **Required** for vendors to submit W9s; without it the intake form refuses submissions (never stores plaintext). Keep stable — rotating makes stored TINs undecryptable. |
| `INVOICING_OWNER_EMAIL` | Sole account allowed into the Invoices/payroll section. Defaults to `ryan@strawhutmedia.com`. |
| `INVOICING_SERVICE_TOKEN` | Bearer token for the monthly invoice automation. Sent as `X-Invoicing-Token` (or `Authorization: Bearer`); when it matches, `/api/invoicing/*` acts as the owner without a browser session. Optional — unset means only Ryan's login works. Rotate/clear to revoke automation. |
| `QB_CLIENT_ID` / `QB_CLIENT_SECRET` | QuickBooks Online OAuth app credentials (from an Intuit Developer app). Powers the AR side — connect + draft/send client estimates & invoices. See `server/quickbooks.ts`. |
| `QB_ENV` | `sandbox` (default) or `production`. Redirect URI is `${APP_BASE_URL}/api/qb/callback` — must be registered in the Intuit app. |

## Invoicing / payroll (owner-only) + Caroline's separate client-invoicing seat

The `/invoicing` section's contractor payroll/W9 tabs, `/api/invoicing/*`
(contractor payroll, W9 intake, TIN data), and `/cashflow` are locked to a
**single owner** (`INVOICING_OWNER_EMAIL`, default Ryan) — `requireOwner` in
`server/auth.ts`, not just any admin. Contractors submit their W9 + address
via a private, expiring, token link (`/vendor/:token`, public route,
`/api/intake/:token`). The TIN is stored encrypted (`server/crypto_vault.ts`);
bank details are collected in Melio, not here.

**Caroline has a separate, narrower seat on just the client (AR) side** —
QuickBooks connection status + the Client Invoices card (`/api/qb/*`, gated
by `requireInvoicingAccess`, not `requireOwner`) — via the
`users.is_invoicing_owner` flag (migration 136). This is deliberately
**not** the same as owner access: it does NOT extend to contractor
payroll/W9/TIN or Cash Flow — Ryan was explicit she should see neither.
She gets a dedicated Client-Invoices-only view of `/invoicing` (no
Dashboard/Contractor Invoices/Contractors/Settings tabs), reached because
her flag also unlocks the "Invoices" nav link — but not the "Cash Flow" one.

If someone else needs this same narrow seat later, set their
`is_invoicing_owner` flag the same way (034/136 name-match pattern) — don't
widen `requireOwner`/`isOwner` themselves, that would also open Cash Flow
and contractor W9/TIN data.

## Pipeline (album default)

Writing → Tracking → Overdubs → Comp → Stems → Mixing → Mastering → Done

The internal stage value is still `producing` (to avoid a DB migration); only the
display label is "Comp". A future cleanup can rename the value if useful, but
for now: **the comp engineer picks the best takes, stitches them together, and
exports stems for the mixer**. They're making creative choices and communicating
with the artist (e.g. Maggie) — not mixing.

Per-project pipelines (e.g. for podcasts/films) are planned but not yet built.

## Socials autopilot (daily content engine)

Shows with `socials_autopilot_enabled` get a daily draft batch (2 text posts +
photo/reel/story concepts) generated each morning at a per-show PT hour
(`socials_autopilot_hour`, default 6am) by `server/socials_autopilot.ts`:
strategy docs + 30-day calendar slot + recent episodes → drafts appended to
the show's freeform social plan → auto-assigned into that day's scheduler
slots → QA digest emailed to the admin. One run per (project, PT date),
enforced by a UNIQUE constraint (`socials_autopilot_runs`), so redeploys
can't double-generate. Admin can fire a run manually from the Social Plan
Settings card ("Run now", uses force to retry failed runs only).

**Hard rule: Slate never posts to any social platform.** The autopilot stops
at the Scheduler in `planned` status; a human QAs, publishes manually, and
flips slots to `posted`. Do not add a posting integration without Ryan's
explicit approval.

## Audience CRM (per-show email lists)

Each podcast project has an email list (`audience_contacts`) fed by a public
capture webhook (`POST /api/audience/hooks/:token`, per-show secret token on
`projects.audience_capture_token`). ManyChat's External Request action posts
captured emails here from comment-trigger DM flows; contacts also mirror into
a lazily-created per-show Resend audience (`projects.resend_audience_id`).
Lists are per-SHOW on purpose — fans follow shows, not the network.

**Fan-facing email rule:** Slate never sends email to fans. Broadcasts go out
from the Resend dashboard, and must use a from-address that is NOT the system
sender (`slate@strawhutmedia.net` is for magic links/invites/alerts only).
Only `strawhutmedia.net` is verified in Resend today — a fan-facing address
on another domain (e.g. `@strawhutmedia.com` or a per-show domain) requires
verifying that domain in Resend first.

**One deliberate exception: lead follow-ups.** For lists flagged
`audience_lead_alerts` (sales pipelines, never fan lists — enforced
server-side in `server/routes/audience.ts`), Claude drafts a personal
follow-up per captured lead; a human adds context, edits, and sends it
themselves — nothing auto-sends. The send uses a human display name +
`Reply-To: <sender's own email>` so replies land in Caroline/Ryan's real
inbox, not Slate. House style is baked into the prompt in `anthropic.ts`
(`generateLeadFollowup`): retainer-first, never quote the hourly studio rate,
never say "AI," the client always owns their show — Straw Hut runs/leads it,
never "owns" it.

## Permissions

- **Admin** (currently Ryan only): invite/remove users, delete projects/songs,
  edit any task or comment, connect Dropbox, see "Stuck Tasks" digest, auto-access
  to every project.
- **User**: edit songs/tasks on projects they're a member of, comment, @mention,
  add links, manage their own profile/timezone.
- Project creators can invite existing workspace users into their project but
  only admins can invite brand-new accounts.

## Mentions / references inside comments + tasks

- `@username` → ping a user (autocomplete from project members)
- `#thing` → reference a song or project (autocomplete scoped to current project only)

## Don't accidentally do

- Push to a branch other than `main` for app changes (Railway only deploys main)
- Re-enable the GitHub Pages workflow (Railway is the sole deploy target)
- Add a new external service without explicit user approval — current stack is
  GitHub + Railway + Resend + Dropbox, full stop

---

# Session handoff — Teleprompter, phone remote, podcast-page cleanup (Sept 2026)

This block is the durable record of a big build session with Ryan. Read it so
you don't re-derive or re-break any of it. Everything below is LIVE on `main`.

## How Ryan wants you to work (learned the hard way — take these seriously)

- **Never overpromise. Verify a feature actually works before you claim it
  does.** Ryan got burned by a banner saying Slate "cuts clips" when the team
  doesn't use Slate's clipper. Read the code, trace the wiring, then describe
  only what's real.
- **After every deploy, confirm the EXACT built bundle hash is live** before
  telling him it's done. `npm run build:client` prints `dist/assets/index-XX
  .js`; poll `https://slate.strawhutmedia.com/` until the served
  `/assets/index-*.js` matches that hash (a substring/marker check gives false
  positives — match the full hash). Then verify the relevant API too.
- **Build for a non-technical team.** Default views must be dead simple; hide
  advanced/experimental tools behind a toggle or collapsed panel. When a page
  feels like "a wall of stuff," that's the bug.
- **Stale-bundle confusion is common.** When he says "I don't see X," it's
  usually his open tab on an old bundle — tell him to hard-refresh
  (Cmd+Shift+R) before assuming a real bug.
- He's blunt and moves fast. Give a recommendation, act, and report plainly.

## Teleprompter — `/prompter` (src/pages/PrompterPage.tsx)

A standalone, full-screen podcast teleprompter. Built this session end to end.

- **Public, no login.** Route is OUTSIDE the `<Protected>` wrapper in
  `src/App.tsx` so anyone can open it instantly on an iPad/computer. Clean URL
  is intentional: `slate.strawhutmedia.com/prompter`. Nav link to it shows only
  in the podcast workspace (`Layout.tsx`, keyed off `slate.dashboard.kindTab`).
- **Sessions are SHARED across the podcast team**, stored server-side in
  `teleprompter_sessions` (migration `094`). Not device-local, not per-user —
  one shared pool. API: `server/routes/teleprompter.ts`
  (`/api/teleprompter` list/create/update/delete), gated to podcast-access
  users (admins, or members/creators of any podcast project). Autosaves with a
  Saving/Saved badge; shows who created / last edited. Sessions can be named,
  else titled by date.
- **Look-and-feel settings stay per-device** (localStorage): speed, font size,
  line spacing, width, font (Sans/Serif/Mono/Condensed), black/white screen,
  mirror (glass rigs), vertical flip, countdown, eye-line guide, ALL CAPS.
- **Editing model Ryan explicitly wanted:** in the running, full-screen
  prompter, a CLICK on the text drops the cursor exactly where you clicked and
  starts editing IN PLACE — no popup, no play toggle on click. (Play/pause is
  the control-bar button, spacebar, and the phone remote.) Uses
  `caretRangeFromPoint` + `focus({ preventScroll: true })` (the preventScroll
  is essential — a plain focus scrolled the tall editable and made the caret
  land in the wrong spot). Mirror/flip auto-off while editing.
- **Paste preserves formatting + line breaks** (his "enters" pain): pasted HTML
  is sanitized to keep structure + basic bold/italic but strip all foreign
  colors/fonts/backgrounds; plain text falls back to one `<div>` per line so
  blank lines survive. See `sanitizePastedHtml` / `handleRichPaste`.
- **ALL CAPS** two ways: a whole-script toggle (display-only, reversible) and an
  **AA** button that toggles UPPERCASE on a selection via a CSS-uppercase span
  (reversible — the original letters are preserved, NOT rewritten).
- **True full screen** (hides Mac dock + menu bar): Start requests OS fullscreen
  from the click gesture; toggle + `F` key; Esc/Exit leaves it.
- Device-adaptive: touch tap-zones + big controls on iPad, full keyboard
  shortcuts on desktop; Screen Wake Lock so devices don't sleep mid-read.

## Phone-as-remote — `/r` (src/pages/RemotePage.tsx + server/routes/teleprompter_remote.ts)

Turn ANY phone into the teleprompter remote — no app, no purchase, works over
cellular. On the prompter tap "📱 Phone remote" → it shows a QR + 4-letter
code. Phone opens `/r` (public, no login), scans/enters the code, gets big
Play/Pause + speed/size/nudge buttons.

- **Architecture:** in-memory SSE relay. The prompter (logged-in) opens an SSE
  host stream and gets a pairing code; the phone POSTs button presses to that
  code; the server relays them to the host. Single Railway instance, so
  in-memory is fine (same model as `server/events.ts`).
- **CRITICAL routing gotcha (already fixed, don't reintroduce):** the public
  `/api/teleprompter/remote` router MUST be mounted in `server/index.ts` BEFORE
  the broad `app.use('/api', showChatRouter)` / `episodeCutsRouter` — those have
  a router-level `requireUser` and will 401 the phone's login-less requests if
  they're reached first.
- Physical-remote guidance if he asks again: buy a **Bluetooth presentation
  clicker that lists PowerPoint/Keynote/arrow keys** (works in a browser).
  AVOID volume/camera-shutter/"AB shutter" remotes and VR-box pads — iOS won't
  pass those keys to Safari. The app already listens for Space/Enter (play),
  ↑↓ (speed), ←→ (size), PageUp/Down.

## Project removal / archiving — NEW this session

There was NO delete-project feature before (that's why he couldn't remove
shows). Added **soft-archive** (reversible, avoids FK-cascade risk of a hard
delete):
- Migration `154` adds `projects.archived_at`; the project list
  (`GET /api/projects`) excludes archived. Admin-only routes
  `POST /api/projects/:id/archive` + `/unarchive`.
- UI: a red **🗑 Remove project** button at the top of each project page
  (`src/pages/ProjectPage.tsx`), admin only. Archiving hides it everywhere but
  keeps the data.
- **Ryan still intends to archive:** WICKED, Only Murders, Brandi Glanville, and
  the stray bare **"Private Talk"** (KEEP "Private Talk with Alexis Texas" —
  they're two different projects, not dupes of each other).

## Podcast project page — reframed around MARKETING (his mental model)

The page was an overwhelming wall of cards. Reworked (`ProjectPage.tsx`):
- All the admin config (Team, RSS, Brand, Audience, Brief, Social Strategy,
  Socials, Members, Claude chat) is folded into ONE collapsed **"⚙️ Show setup
  & tools"** panel. Default podcast view = header → progress → Start-here →
  episodes → transcripts.
- **The real workflow he wants: "drop in a FINISHED (or near-final) episode →
  Slate makes the marketing."** The Scheduled→Released production pipeline is
  NOT how he thinks about it (uploading implies the episode is already done).
  So the "▶ Start here" banner leads with Upload → **transcript + social
  posts**, and the SHOW PROGRESS stage bar is demoted below and labeled
  optional (he's "not sure yet" if the team uses it — leave it, don't remove
  without asking).
- **Clips: do NOT claim Slate cuts clips.** Slate has its own ffmpeg clip
  pipeline (`server/routes/clips.ts` — "OpusClip removed") and Upload's
  autopipeline (`server/routes/transcripts.ts runPostTranscriptAutopipeline`)
  DOES auto-run transcript → social plan → carousel → clip job. BUT the team
  doesn't use Slate's clips — **they still clip in Opus Clip** (the product),
  and want to keep it. The banner now says clips stay in their tool. Note:
  "Opus" elsewhere in the app = Claude's Opus MODEL (Show Chat "Use Opus"),
  unrelated to Opus Clip — don't confuse them, and don't remove the Opus model.

## Parked / next threads (NOT started — confirm before building)

- **Clips → editors (parked at his request).** Vision: the studio's
  **premiere-bot** (`automation/premiere-bot/`, Claude Code running on the edit
  machine — the ONLY thing that can open Premiere; Slate is cloud and can't)
  already cuts a variety of clips; the open question is just DELIVERY — getting
  those clips into editors' hands (surface/link them per episode in Slate). See
  `automation/premiere-bot/PREMIERE.md` "Phase 2/3": social clips are meant to
  live in Slate's clips feature, driven by the transcript. Big feature, depends
  on the on-machine bot actually running — don't build blind.
- **Play with the Upload → transcript/social flow** and make that screen great
  (the part he's most curious about).
- **Only Murders shows album-style stage names** (Writing/Tracking/…) instead of
  podcast labels (Scheduled/Prepped/…) — that project's `stage_labels` were
  never set to the podcast set. Offered to fix; not done.
- **Mara** (teammate) can sign in only if she already has a Slate account
  (invite-only); she'd see projects she's a member of. Offered to help invite.
- Heads-up seen in the status branch: `RESEND_API_KEY` was unset — fine only if
  SES is delivering (see the email-transport section above). Flag if sign-in
  emails ever stop.

## Where the code lives (quick index for this session's work)

- Teleprompter UI: `src/pages/PrompterPage.tsx`; remote UI: `src/pages/RemotePage.tsx`
- Teleprompter API: `server/routes/teleprompter.ts`; remote relay:
  `server/routes/teleprompter_remote.ts` (mounted before broad `/api` routers)
- Routes/public pages wired in `src/App.tsx` (`/prompter` behind login,
  `/r` + `/r/:code` public); nav link in `src/components/Layout.tsx`
- Project archive: `server/routes/projects.ts` + migration `154`; button in
  `src/pages/ProjectPage.tsx`
- Migrations added: `094_teleprompter_sessions.sql`, `154_project_archive.sql`
- Client dep added: `qrcode` (QR for the phone-remote pairing)

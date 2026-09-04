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

## Required env vars on the Railway "Project-management" service

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection (use `${{Postgres.DATABASE_URL}}`) |
| `RESEND_API_KEY` | Email sending (same key as Pod Booster) |
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

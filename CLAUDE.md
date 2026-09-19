# Slate — operating notes for Claude

This is **Slate**, Straw Hut Media's project tracker. The first project running
on it is the **Maggie Glass record** (13 songs, 14 tracks).

## Architecture (one-line summary)

- **Code**: GitHub `strawhutmedia/Project-management` (this repo), branch `main`
- **Deploy**: Railway, single service named "Project-management" in the SLATE
  project, paired with a Railway Postgres service
- **Email**: Amazon SES (via the `mailTransport.ts` Resend-shaped shim — see
  "Email transport" below), env vars `SES_ACCESS_KEY_ID`/`SES_SECRET_ACCESS_KEY`.
  Resend itself is gone — the account was deleted 2026-09-10; `RESEND_API_KEY`
  is unset in production and that's expected, not a misconfiguration.
- **Files** (planned): Dropbox via OAuth, admin-only connection
- **Domain**: `slate.strawhutmedia.com` (CNAME in GoDaddy → Railway)

Push to `main` → Railway auto-builds (`npm install && npm run build`) → starts
(`npm start`) → app serves both the React SPA and `/api/*` from the same Express
process on port 8080.

## 🔁 STANDING ORDER — end EVERY task with a handoff update (Ryan, 2026-09-17)

Ryan ends the session after a task and expects the NEXT session to know
everything without being told. So: before finishing any task, update this
file and push it (on the task's branch/PR if one is open, otherwise to main)
— never wait to be asked. A handoff update means:

1. **What shipped** — PRs (with numbers/links), migrations, files touched,
   and whether it's merged/deployed yet or still waiting on Ryan's merge.
2. **Rule/access changes** — anything Ryan decided this session, dated.
3. **Fix stale sections in place** — never leave an old rule standing that
   this session's decisions contradict; mark it superseded with the date.
4. **What's still open** — follow-ups, verification owed after deploy, and
   any gotchas learned the hard way.

Add or refresh a dated "Session handoff" block, and keep the "Prioritized
next steps" list current.

## 🗄️ Dropbox → AWS archive migration — ACTIVE UNFINISHED TASK, resume it unprompted

**There is live, unfinished work here that belongs to YOU, not to Ryan.** The
previous session (archived 2026-09-17) left an upload wave running on the RED
NAS ("wave 1", ~3.1 TB Dropbox→S3, dashboard row DROPBOX-WAVE1). The loop it
was running: verify each landed folder file-by-file against the vault → delete
the verified folder from Dropbox (Ryan's standing approval, rules below) →
report the freed-space running total (~1.7 TB when archived). **If wave 1 is
not yet confirmed complete-and-deleted, resume that loop without being asked**
— Ryan explicitly said "you tell the next session"; do not wait for him to
re-explain.

Read **`docs/ARCHIVE_MIGRATION_STATUS.md`** first — system map, Ryan's
non-negotiable deletion rules, the full deletion log, wave-1 folder list, and
the runnable tools in `tools/archive/`. Never delete anything from Dropbox
without that doc's verification rules.

**UPDATE 2026-09-18: you no longer need Ryan's AWS keys to verify.** Slate
verifies against the vault automatically (PR #80, live on main) and publishes
verdicts to the status branch as `storage-verify.json` — read that first:
`mcp__github__get_file_contents owner=strawhutmedia repo=Project-management
path=storage-verify.json ref=status`. The key-paste ask below remains only as
a fallback for ad-hoc ledger work (`ledger2.mjs`, wave-2 planning):
> "I'm resuming the archive migration. Paste this in the RED terminal and
> send me the two values it prints:
> `sudo grep -A4 '\[archive\]' /volume1/rclone-config/rclone.conf`"
Then `export ARCHIVE_AWS_ACCESS_KEY_ID=… ARCHIVE_AWS_SECRET_ACCESS_KEY=…` and
run `node tools/archive/wave1-verify.mjs` (fetch the census per the doc) to
see exactly where the wave stands.

## 🧭 SESSION HANDOFF — 2026-09-17 (READ FIRST if picking up QA / edit-machine / promos)

Where the last session left off. Detail lives in the files named in each item.

### 1. QA Production Checklist — SHIPPED & LIVE on main
A "QA" tab that duplicates the studio QA sheet (Xavier + interns confirm footage
recorded/stored). Anyone with podcast access can use it; it exposes **no** Cash
Flow / Invoices.
- Migrations `146`–`152`; `server/routes/qa.ts`; `src/pages/QAPage.tsx` (month-
  grouped board, card-number chip pickers, in-app Dropbox folder picker, status/
  flag/approve).
- Daily 8am-PT digest to everyone with a podcast account (`server/qa_digest.ts`,
  migration `147`). AI-usage logging (`149_ai_usage.sql` + `server/ai_usage.ts`,
  wired into all Anthropic call sites). `dropbox_path` column (`150`). Token-authed
  bot-log channel (`151`, `POST/GET /api/qa/bot-log`, header `x-qa-token` =
  `QA_SERVICE_TOKEN`).
- Seed data: 10 recent sheet rows (`148`) + the Ep190_RyanT editbot-test recording
  (`152`, under Don't Be Alone with Jay Kogen). Team-account seed
  (`server/seeds/invite_qa_team.ts` = Xavier/Riley/Blake) + Jay Kogen duplicate-
  project merge (`server/seeds/merge_jay_kogen.ts`).
- **PERMISSION RULE (Ryan, updated 2026-09-17 later that day):** the
  "podcasts only" scoping is SUPERSEDED — anyone signed in to Slate now sees
  everything (see the PR #78 handoff block at the end of this file). What
  did NOT change and never will: **no Cash Flow, no Invoices** for the team.
  "Caroline can have invoices; Cash Flow is ALWAYS just for me. That will
  not change."

### 2. Prompt-caching audit — PARTIAL, measurement NOT delivered
Ryan's rule: **do not apply any prompt-caching change until it's measured.** The
per-call usage LOGGING is built (`server/ai_usage.ts`, migration `149`, 30-day
rollup in `server/diag.ts` `aiUsage30d`). The actual MEASUREMENT + report (system-
prompt tokens per call site vs per-model cache floors — Opus 5=512, Sonnet 5/Opus
4.8=1024, Opus 4.7=2048, Haiku 4.5=4096 — and firing frequency) was **not** done.
Next: pull the usage data, measure, REPORT before touching caching.

### 3. Edit-machine Premiere assembly bot — big in-flight build
Goal: QA-approved episode in Slate → its Premiere project auto-assembled from the
synced Dropbox footage, hands-off, for EVERY episode (not one test).
- Docs on the edit PC / repo: `automation/premiere-bot/CLAUDE.md` (hard
  boundaries: only Dropbox + Premiere, only the Slate QA token, never delete
  footage), `automation/premiere-bot/PREMIERE.md` (recipe: bins Media/Video +
  Media/Audio + Cuts; per-camera **waveform** sync against the Zoom `MASTER.WAV`;
  "good audio" = the standalone recorder tracks; build the `uncut` sequence).
- **WHAT WORKS:** the on-PC Claude produced a real, clean, synced project by
  authoring the `.prproj` **directly** — organized bins + synced `uncut` sequence,
  validated, no dangling refs (`Ep190_RyanT_clean.prproj`). Also a valid FCP7/XMEML
  `uncut.xml` that imports synced (but Premiere's XMEML import **flattens bins** — a
  Premiere limitation, not our bug).
- **DECISION:** assembly = **direct `.prproj` authoring** (headless, no Premiere GUI,
  crash-safe). The UXP plugin (`automation/premiere-bot/uxp-plugin/`, v0.0.1 is an
  API probe) is for a LATER phase (in-app transcription / cutting), **not** the
  assembly. **Do NOT run local CUDA/Whisper transcription** — it hammered the GPU and
  crash/boot-looped the machine.
- **NEXT:** build `poll.mjs` as a **headless Windows scheduled task** ("run whether a
  user is logged on or not", as `editbot`) that polls Slate `/api/qa/approved` and
  assembles each new approved episode via direct `.prproj` authoring. This gives
  reboot self-recovery with **no autologon needed**.

### 4. Edit PC + remote access (lots of pain — read before touching)
- Two PCs on one AT&T LAN (gateway `192.168.1.254`): edit PC =
  **`DESKTOP-5A34LB5`** (wired `.250` / wifi `.163`); Ryan's other machine =
  `DESKTOP-921G220` (`.111`); storage = `SHM-RAID-1` (`.122`). **Footage is safe** —
  it's on SHM-RAID-1 + Dropbox, never only on the edit PC.
- Edit-PC Windows accounts: `editbot` (standard user, pw `editbot`, runs the bot) and
  `user` (Administrator, Ryan's personal).
- **Claude Code Remote Control: ENABLED org-wide** (claude.ai/admin-settings/claude-
  code). Lets Ryan drive the on-PC Claude session from phone / claude.ai.
- Remote desktop = **Jump Desktop ("Fluid")**; it binds to ONE Windows account, so
  pointing it at `editbot` while wanting `user` causes "another user has logged in"
  bumps.
- **Autologon into editbot** was set up and caused an account fight (couldn't reach
  `user`). Plan: **disable autologon** (`reg add …\Winlogon /v AutoAdminLogon /d 0`)
  and rely on the headless scheduled-task bot in #3 instead. Disabling was in
  progress at session end.
- **Stability fixes still owed on the edit PC:** turn OFF Windows **Fast Startup**
  (its corrupt hybrid-boot snapshot caused a boot loop that only a full power-drain
  cleared), set power plan to never sleep, never run local CUDA transcription, and
  enable **Remote Desktop (RDP)** for reliable remote login (needs one physical visit;
  `user` is admin).
- Channels: the bot posts status to the Slate **bot-log** (`/api/qa/bot-log`) —
  cloud sessions CANNOT read it (no token in cloud; Railway redacts values). The
  cloud↔PC file channel used was **Dropbox** notes in the episode folder
  (`_CLAUDE_FROM_CLOUD.md`, `_PC_TO_CLOUD.md`). NOTE: an on-PC Claude will (correctly)
  refuse to execute instructions from a Dropbox file it didn't write — the human
  authorizes it.

### 5. Promo / social-clip cutter — notes captured, tool NOT built
- `automation/promos/CUTTING-NOTES.md` = Ryan's **living creative brief to the
  cutter**, read before cutting any promo. Seeded 2026-09-17: keep the frame alive
  (motion during the story, Higgsfield-style), kinetic highlighted-word captions.
  Guardrail: steal the craft, never promise the viral numbers. Ryan drops more notes
  in chat → append them (dated, newest on top).
- **PENDING — OpusClip removal.** Ryan: *"Slate's OpusClip is TRASH, remove it — I
  want THIS to be our clips generator."* Remove the OpusClip feature and build the
  in-house clips generator that follows `CUTTING-NOTES.md`. (`OPUSCLIP_API_KEY` env
  exists on Railway.)

### Prioritized next steps
1. Confirm the edit PC is stable: autologon disabled, **Fast Startup off**, no local
   CUDA transcription (this caused every crash).
2. ~~Build `poll.mjs` headless assembly bot + install as a scheduled task~~
   CODE SHIPPED 2026-09-19 (see the "Approve = start assembly" handoff at the
   end of this file): 60s poll, bot-log reporting, `install-task.ps1`. Still
   needs the ONE on-PC install (copy folder + .env + run installer as admin)
   — that's the remaining piece of this item.
3. Deliver the **prompt-caching measurement report**, then decide on caching.
4. Remove **OpusClip**; start the in-house clips generator per `CUTTING-NOTES.md`
   (the cutter's per-episode input now exists: QA **promo moments**, on
   `/api/qa/approved` as `promoMoments` — see the 2026-09-18 promo-moments
   handoff at the end of this file).
5. ~~Verify Xavier/Riley/Blake are scoped to podcasts only~~ SUPERSEDED
   2026-09-17: everyone sees everything now (PR #78 handoff at end of file);
   Cash Flow / Invoices gates unchanged and verified in code.
6. ~~If PR #78 isn't merged yet, get it merged~~ MERGED 2026-09-17; its
   post-deploy verification (end of file) still owed. Storage/archive work
   continues per the PR #80 handoff block (end of file): RHINO/RECOVERY
   top-up uploads, wave-1 completion, Auto-queue decision from Ryan.
7. Anthropic-spend follow-through (2026-09-18 session, PRs #79/#81 merged +
   deploy-verified): once Ryan actually switches plans (recommended Team →
   Max 20x), update the recurring "Anthropic (Claude)" Cash Flow line via a
   new migration ($150 → whatever he lands on) — do NOT change it before
   the switch happens.
8. **After Ryan's Team→Max switch (planned ~2026-09-19): recreate ALL of
   Ryan's claude.ai Routines under his PERSONAL account — there are 14, not
   just one.** Every Routine (Podbooster daily, Straw Hut site daily pass,
   Notes→CRM sweep, Calendar prep, House alert, homepage stats refresh,
   follow-up rhythms, the Nov 3 Jaeson Wilkins follow-up, the monthly
   Anthropic reconciliation, etc.) lives on the TEAM account and stops
   firing when the org lapses **2026-10-07**. Full inventory with schedules
   and verbatim (token-redacted) prompts:
   **`docs/ROUTINES_MIGRATION_2026-09-18.md`** — follow its instructions,
   then disable the old team-account copies so nothing double-fires before
   Oct 7. Prerequisites on the personal account first: GitHub
   (claude.ai/connect-github, repo access to the three strawhutmedia repos)
   + Gmail/QuickBooks/Railway/Dropbox/Slack connectors. The monthly
   Anthropic Routine's first run also does item 7 (recurring line $150 →
   $200 if he landed on Max 20x, verified from the first Max receipt).

## 🧾 SESSION HANDOFF — 2026-09-18 (Anthropic spending → Cash Flow → Team→Max switch)

Ryan asked why his Anthropic bill exploded and whether Slate's Cash Flow
reflects it. Findings (all from primary sources — the Anthropic receipt
emails in his Gmail, read individually):

- **September 2026 Anthropic net through Sep 17: $1,324.46** — $150 Team
  plan subscription (1 Premium + 1 Standard seat, bills the 7th) plus
  ~$1,174 of one-time overage: 26 "Auto recharge extra usage, Team plan"
  top-ups ($44–58 each, Sep 9–17, Claude Code sessions + auto-reload),
  $90 prepaid extra usage, $63.61 API console credits, −$25.16 refund.
  Prior months: Aug $170, Jul $65, Jun $28.
- **Decision (Ryan, 2026-09-18): switching to Max 20x ($200/mo), planned
  for ~2026-09-19.** Steps given to him: kill extra-usage auto-reload
  (claude.ai/admin-settings/usage) → cancel Team (admin-settings/Billing;
  access runs to Oct 7, no refund) → subscribe Max 20x on his PERSONAL
  account (same email, accounts coexist; switch via initials bottom-left)
  → `/login` again on his Mac + the edit PC → reconnect connectors on the
  personal account. Remote Control + cloud sessions are confirmed included
  on Max (code.claude.com/docs/en/feature-availability). Chat history does
  NOT move between org and personal accounts.
- **Switch attempt 2026-09-18 — BLOCKED until Sep 22, then resume.** Ryan
  turned auto-reload OFF and started the switch live, but Max web checkout
  on his personal org failed with "You have an existing subscription
  through the App Store": a previously unknown **Apple-billed Claude Pro
  (~$20/mo)** sits on the personal account — already cancelled, **expires
  2026-09-22** (Apple bills it, so it never appeared in the Anthropic
  receipt audit; treat App Store as a possible hidden-spend source in
  future audits). Ryan refuses Apple pricing (correct — Apple's cut is
  priced in). Plan: wait for Sep 22, buy Max 20x on the web on his
  personal org (his two "personal" org entries turned out to be the same
  thing). A one-shot Routine ("Sep 22: buy Max 20x (Apple block expired)",
  fires 2026-09-22 18:00 UTC, push+email) sends him the exact steps,
  verifies the Team cancellation actually saved (if it didn't, he gets
  charged $150 on Oct 7 — CHECK THIS), and looks for any post-Sep-18
  auto-recharge receipts. **Not independently verified this session:**
  that auto-reload-off and Cancel-plan were completed on the Straw Hut
  Media org (Ryan initially did steps while in the wrong org) — the Sep 22
  session and/or the Oct 5 reconciliation must confirm both from receipts.
- **Servers are unaffected by the plan switch**: Slate/Podbooster/site call
  the API with Console `ANTHROPIC_API_KEY`s (separate billing, the ~$20-28
  "Auto-recharge credits" line) — nothing to change on Railway.
- **Shipped & verified: migration `156_cashflow_anthropic_september_overage.sql`**
  (PR #79, merged, confirmed applied via status-branch latest.json): logs
  the $1,174.46 September overage as a one-time entry and corrects the
  recurring line's stale "pay-as-you-go API" description (amount stays
  $150 until the switch actually happens). PR #81 (merged) recorded the
  Routine gotcha; the Routines inventory doc ships in the next PR.
- **Cash Flow had no monthly expense update** — the only monthly automation
  is `server/cashflow_payment_check.ts` (day 1–3, INCOME side only, emails
  a digest, writes nothing; the bookkeeper's QuickBooks work never flows
  into Slate). The monthly mechanism is now a claude.ai Routine ("Monthly
  Anthropic → Slate Cash Flow reconciliation", 5th of each month, after the
  bookkeeper's close): reads the prior month's Anthropic receipts from
  Gmail, compares to the tracker, ships a sourced migration PR, emails Ryan
  the delta, and flags loudly if extra-usage top-ups reappear (>2/month =
  the pattern that cost ~$1,100). Currently on the TEAM account — see
  next-steps item 8 for the migration of it and the other 13 Routines.

<!-- End 2026-09-17 handoff -->


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

`storage-verify.json` (since 2026-09-18) holds the latest vault-verification
verdict per Storage-page row — see the archive-migration section above.

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

## Email transport — Amazon SES via a Resend-compatible shim (Resend is gone)

**Resend was fully deleted 2026-09-10** — the account no longer exists,
`RESEND_API_KEY` is unset in production, and that's correct: nothing in
Slate should require it. Slate's transactional email (the four triggers
above, plus invites, outreach/lead-follow-up sends, and contractor
invoices) goes through `server/mailTransport.ts` — a drop-in `Resend`-shaped
class that routes `.emails.send()` to **Amazon SES** when
`SES_ACCESS_KEY_ID` + `SES_SECRET_ACCESS_KEY` are set (they are), and would
only fall back to the real Resend package if those were ever unset AND a
Resend key were passed in — a combination that no longer applies anywhere
in this codebase. Every caller still does
`import { Resend } from '...mailTransport'` and calls it exactly like the
real SDK — `server/email.ts`, `server/routes/outreach.ts`, and
`server/routes/audience.ts` all point at it. Sends carry SES message tags
(`app=slate`, `stage=<outreach|sales|team|internal|vendor>`,
`show=<project>` where applicable) so the SES/SNS event stream stays
categorized.

**Incident (2026-09-10): deleting Resend silently broke outreach sending,
magic-link sign-in, admin alerts, and fan-list broadcasts.** All three of
those files used to gate the shim behind
`const resend = resendKey ? new Resend(resendKey) : null`, which built a
**null** client the moment `RESEND_API_KEY` was unset — even though the
shim itself needs no Resend key to send via SES. Every `if (!resend)`
guard downstream then silently refused to send. Caught via a live user
report ("Enable Open Tracking" → `resend_not_configured`); fixed in all
three files to always construct the shim
(`const resend = new Resend(resendKey)`, `resendKey` may be `undefined`)
since `.emails.send()` itself checks for SES config first. If you ever see
a `resend_not_configured`-shaped error, or any `if (!resend)` /
`resendKey ? new Resend(...) : null` pattern reappear anywhere, that's this
same bug — always construct the shim unconditionally. Three other files
(`outreach_domains.ts`, `audience_resend.ts`, `boot_resend_probe.ts`) are
correctly gated behind a real Resend key because they're genuinely
Resend-only features (or best-effort mirrors) with no SES equivalent —
don't "fix" those.

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
  missing (`ses_sns_topic_arn_not_set`, etc.) until that's done. Until then
  — and now that Resend really is deleted (see above) — there is no live
  auto-pause safety net for the outreach rotation pool; sends themselves
  keep working fine (confirmed all 4 domains verified in SES), there's
  just no automatic reaction if one
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

## Find new prospects (AI-researched outreach batches)

The Outreach page's "🔍 Find new prospects" button is a one-click
replacement for a paid similar-shows API (Rephonic etc.): Claude researches
real, currently-active podcasts similar to the show, verifies each one's
contact email by actually fetching its RSS feed, and drops the results in
as a new prospect batch — no fields to fill in, nothing sends
automatically (same review queue as every other import).

- **Code**: `findSimilarShowProspects()` in `server/anthropic.ts` (the
  research), `POST /projects/:projectId/prospects/find-similar` in
  `server/routes/outreach.ts` (the route), `api.findSimilarProspects` in
  `src/api.ts` (the client), the button + progress bar in
  `src/components/OutreachSection.tsx`.
- **Model**: `claude-opus-5` with `web_search`/`web_fetch` server tools.
  Targets 30+ verified candidates per run, but real runs have typically
  landed 13-15 — the model prioritizes only genuinely RSS-verified shows
  over hitting the exact count. That's expected behavior, not a bug; worth
  revisiting only if the yield feels too low in practice.
- **Typical run time: ~8-15 minutes.** This is a long-running, expensive
  call — three real production bugs were found and fixed getting it stable
  (2026-09-10/11, PRs #68-#72), each one a lesson worth not re-learning:
  1. **The Anthropic SDK's own client-side request timeout.** A
     non-streaming call (`client.messages.create`) for a task this size
     ran ~15 minutes server-side and then died with `Request timed out.`
     — the SDK's default per-request timeout is 10 minutes. Fixed by
     switching to `client.messages.stream(params, { timeout }).finalMessage()`
     with an explicit generous timeout (20 min) passed in.
  2. **Railway's edge closes an HTTP request after 5 minutes with no data
     transferred** (it allows up to 15 minutes as long as *something* keeps
     moving). Fixing #1 wasn't enough — the outer browser↔Railway↔Express
     connection still had nothing written to it until the whole call
     finished, so Railway's edge killed it anyway. Fixed by having the
     route stream newline-delimited JSON events to the browser as soon as
     it commits to the long call (heartbeat `tick` + real `progress`
     events, see #3, ending in one `done`/`error` line). Because sending
     any bytes means committing to HTTP 200 before the outcome is known,
     **success/failure is encoded in the JSON body/stream itself, not the
     status code** — `api.ts`'s `findSimilarProspects` reads the stream
     and checks each event's `type`, bypassing the shared status-code-based
     `request()` helper for this one endpoint.
  3. **Progress looked stuck at 0 even while the search was genuinely
     working.** Progress was originally reported only after each full API
     call resolved, using that call's `usage.server_tool_use` totals — but
     a run this size routinely completes its *entire* tool-use loop inside
     one continuous stream without ever hitting `pause_turn`, so there's
     only one call total and its stats aren't visible until the exact
     moment it (and the whole run) finishes. Fixed by hooking the stream's
     `contentBlock` event (fires as each block — including every
     `server_tool_use` block — completes mid-stream) for live counts
     instead of waiting on a resolved call.
- **If this breaks again**: check `/api/_diag`'s `recentLog` for
  `outreach: finding similar shows` / `similar shows found` /
  `find-similar failed` log lines first — they show real start/finish
  timestamps and error messages. A push/merge while a run is mid-flight
  will kill it via Railway's redeploy restart (learned the hard way this
  same session) — check for an in-flight run before deploying a fix for
  this feature specifically.

## Required env vars on the Railway "Project-management" service

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection (use `${{Postgres.DATABASE_URL}}`) |
| `RESEND_API_KEY` | **Unset in production — the Resend account was deleted 2026-09-10 (see "Email transport" above).** Previously the fallback transport when SES wasn't configured, plus the only transport for Outreach domain management and the Audience CRM's Resend dashboard broadcasts. Those Resend-only features (`outreach_domains.ts`'s Resend sync, `audience_resend.ts`'s mirror, `boot_resend_probe.ts`) now just no-op/skip when this is unset — that's expected, not broken. Do not re-add this key without checking with Ryan first; SES is the transport now. |
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
| `ARCHIVE_ACCESS_KEY_ID` / `ARCHIVE_SECRET_ACCESS_KEY` | Archive-scoped IAM keys (S3 read, no delete) for the Master Archive browser + the automatic vault verification (`autoVerifySweep`, PR #80). Fall back to `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`. |
| `ARCHIVE_BUCKET` / `ARCHIVE_REGION` | Vault bucket (default `strawhut-master-archive`) and region (default `us-west-2`). |
| `STORAGE_REPORT_TOKEN` | Token the NAS reporter/commander containers use for `/api/storage/transfer-report` + agent command endpoints. |
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
captured emails here from comment-trigger DM flows. Contacts used to also
mirror into a lazily-created per-show Resend audience
(`projects.resend_audience_id`, `server/audience_resend.ts`) — that mirror
is now fully dead (Resend account deleted 2026-09-10, see "Email transport"
above), nothing depends on it, and it's fine to leave the dormant code and
column as-is. Lists are per-SHOW on purpose — fans follow shows, not the
network.

**Fan-facing email rule:** Slate never sends email to fans from the system
sender — broadcasts go out via the "📣 Broadcast to this list" panel in
`AudienceSection.tsx` (`POST /api/audience/projects/:id/broadcast`, see
"Email transport" above), which sends through SES, not the system sender
(`slate@strawhutmedia.net` is for magic links/invites/alerts only). A
fan-facing from-address on a domain other than the ones already verified in
SES (check `/admin/outreach/domains` or `sesCheckIdentity`) needs that
domain verified in the AWS SES console first — same DKIM-CNAME flow as any
other SES sending domain, no Resend dashboard involved anymore.

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

**Visibility rule (Ryan, 2026-09-17): every signed-in user SEES everything**
— all projects, all pages, the QA board, teleprompter, transcripts/socials/
clips tools. Exceptions that will NOT change: **Cash Flow is Ryan only**
(`requireOwner`), **Invoices are Ryan + Caroline** (`requireInvoicingAccess`
/ `is_invoicing_owner`). Dropbox browsing for non-admins is **podcast
folders only** (see the PR #78 handoff block at the end of this file).

- **Admin** (currently Ryan only): invite/remove users, delete projects/songs,
  edit any task or comment, connect Dropbox, see "Stuck Tasks" digest, browse
  Dropbox anywhere.
- **User**: sees everything (above); *edits* songs/tasks only on projects
  they're a member of (`getProjectRole` gives non-members a read-only
  `viewer` role), comments, @mentions, adds links, manages their own
  profile/timezone. Podcast tool sections (QA, transcripts, socials, clips,
  etc.) are open to all signed-in users, QA-sheet style.
- Project creators can invite existing workspace users into their project but
  only admins can invite brand-new accounts.

## Mentions / references inside comments + tasks

- `@username` → ping a user (autocomplete from project members)
- `#thing` → reference a song or project (autocomplete scoped to current project only)

## Don't accidentally do

- Push to a branch other than `main` for app changes (Railway only deploys main)
- Re-enable the GitHub Pages workflow (Railway is the sole deploy target)
- Add a new external service without explicit user approval — current stack is
  GitHub + Railway + Amazon SES + Dropbox, full stop (Resend was deleted
  2026-09-10 — see "Email transport")

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

---

# Session handoff — Cash Flow tracker, MRR Growth Pipeline, financial cleanup (Sept 2026)

This block is the durable record of a long financial-tracking session with
Ryan. Read it before touching any number in `/cashflow` or the Growth
Pipeline. Everything described as "live" below is on `main`.

## How this tracker works (learned the hard way — read before touching numbers)

- **Every dollar figure must come from a primary source** — real QuickBooks
  data, a bank statement screenshot, a real receipt/renewal email — never a
  guess, a memory, or an extrapolation. When Ryan disputes a number, go
  re-verify from source; don't defend the old figure.
- **Ryan will demand exact numbers, not approximations**, when the stakes are
  real (e.g. "There should be no approximation. There should be only an exact
  number."). If a spreadsheet or report has its own internal gaps/bugs, don't
  trust its printed totals — recompute by hand from the underlying line items.
- **Recurring lines are corrected IN PLACE via UPDATE**, not re-logged every
  month — see the `is_recurring` flag + the "latest row per counterparty"
  `DISTINCT ON (kind, counterparty) ORDER BY ... occurred_on DESC, created_at
  DESC` pattern already used throughout `server/routes/cashflow.ts`. Each
  correction gets its own numbered migration citing the real evidence in a
  SQL comment (see migrations `127`–`138`, `153` for the pattern to follow).
- `/cashflow` is locked to `requireOwner` (Ryan only, see "Invoicing / payroll"
  section above) — do not widen it, and do not let Caroline's narrower
  invoicing seat touch it.

## What's live now

### Cash Flow tracker (`/cashflow`, `src/pages/CashFlowPage.tsx` + `server/routes/cashflow.ts`)

Running balance, monthly history, a recurring-vs-one-time baseline split
(the "sustainable number" separate from lumpy project wins like Disney/Hulu),
and a fully itemized recurring checklist so every total is independently
checkable line by line. Migrations `127`–`138` corrected specific real line
items this session: Ali duplicate removed, Kirill/Carla verified, car payment
$550→$554 (new car), "Tesla Insurance"→renamed "Car Insurance" $180→$340,
Anthropic $45→$150, Ana (graphic designer) corrected to $520/mo via a real
bank ACH statement screenshot (was a $541.67/mo guess), Jump Desktop added
($23.56/mo — the monthly-equivalent of an annual Paddle renewal found in an
email; was missing from the tracker entirely).

### MRR Growth Pipeline (new this session — migration `139`, growth-pipeline
routes in `server/routes/cashflow.ts`, the "MRR Growth Pipeline" card in
`CashFlowPage.tsx`)

Built because Ryan said: *"I want to be making a million or more a year!!! I
need to get my MRR over $80k!!!"*

- Tracks an editable **target MRR** (default $80,000/mo) against **current
  MRR** (reuses the existing recurring-revenue baseline calc) and the **gap
  to close**.
- A working **deals pipeline** (`cashflow_pipeline_deals` table): name,
  estimated MRR, stage (`prospecting` → `quoted` → `negotiating` →
  `won`/`lost`), notes. Add/edit/delete from the card in the UI.
- **Current real deal:** Bruce Poon Tip (G Adventures) — introduced May 2026
  via Brett Marchand (Plus Company). Ryan quoted **$4,000/mo**; stage is now
  **negotiating**, not yet won (migration `153` corrected this from the
  original $0/`prospecting` placeholder seeded in `139`, before a rate had
  been discussed).
- **This is a live tracking tool, not a one-time snapshot.** As new prospects
  surface or a quote/stage changes, add or update a deal (via the UI, or a
  numbered migration for historical corrections, same pattern as the
  cashflow-entry fixes above) — don't let it go stale.

## Real numbers established this session (verified from primary sources)

- **Amex balance: $101,940.20** (real QuickBooks Balance Sheet). Ryan believed
  it was ~$88,000 — that was wrong. ($88,611.78, a combined-loan total, is
  likely what he was actually remembering.)
- **Hulu payment: $41,354.96** (real invoiced amount). Ryan estimated
  "$30,000" — the real number is higher, which is good news for the Amex
  payoff plan below.
- **Naked Lunch owed: exactly $41,180.00**, last paid 19 months ago —
  hand-verified from Ryan's own "Naked Lunch payout spreadsheet" (a Google
  Drive xlsx), correcting 3 real gaps in the sheet's own formulas (missing
  Megaphone line items in the printed Feb/Mar/Apr 2026 monthly totals, and no
  total row at all for May 2026). This is an EXACT figure per Ryan's explicit
  demand for no approximation — not an estimate.
- **Ana (graphic designer): $520.00/mo** ($120/wk), confirmed via a real bank
  ACH statement screenshot (now reflected in the tracker, migration `138`).

## Open / unresolved — pick these up next session

1. **QuickBooks recurring line — still wrong, real amount unknown.** Ryan said
   "it's no longer $189" but never gave the actual current number despite
   being asked directly. Ask him again before touching this line.
2. **Freelancer.com breakdown — reported to Ryan but NOT yet shipped as a
   migration.** Real itemized figures were found (Muhammad ~$520/mo steady,
   Daniel ~$1,195/mo, Talha and Alaa volatile/tapering toward near-zero),
   which should replace the flat $2,000/mo guess still sitting in the
   tracker. Needs a migration in the `127`–`138` style, or a decision from
   Ryan on whether the volatile contractors even belong in the recurring
   baseline.
3. **Sajid's real pay — unverified.** Same situation Ana was in before her
   bank screenshot: no payroll record, no email trail found. Needs a
   bank-statement-style verification directly from Ryan.
4. **Lisane Basquiat course invoicing — not finalized.** Landed on
   Production $2,400 (Ryan $800/day + Xavier $400/day; possibly $2,100 if
   Day 1 is billed three-quarter-day instead of full) + Editing $5,900, split
   Invoice 1 $5,350 (kickoff) / Invoice 2 $2,950 (delivery) — but this was
   never confirmed as final. There's also an unresolved complaint from Jenay
   Reed (about whether Lisane attended both recording days — Ryan confirmed
   she did) to close out before sending. **Do not draft or send these
   invoices from a session without QuickBooks access** — and per the "Client
   invoices" rule above, Ryan reviews and clicks Send personally, always.
5. **Amex payoff plan** ($101,940.20, real balance) using upcoming
   Disney/Hulu money — discussed, not executed. Revisit once those payments
   land (Ryan expected ~October 2026).
6. **Naked Lunch repayment plan** for the exact $41,180.00 owed — discussed,
   no plan agreed yet.
7. **MRR growth plan beyond the pipeline tool itself.** Ryan ran through a
   7-phase "get rich" Instagram AI-prompt template using real business data.
   The Growth Pipeline feature above is the tracking mechanism; the actual
   plan to fill it with new prospects (beyond Bruce Poon Tip) hasn't been
   built out — add deals as real prospects surface, don't invent placeholder
   ones.
8. **Veed/Opus AI video tools** — kept both after Ryan verified real usage
   via a Slack screenshot (Caroline confirmed Veed for captions on
   promotional videos, Opus for cutting + captions); Higgsfield was
   considered but not adopted. No action needed unless usage changes.
9. **Melio ACH transfer limits** — confirmed 5 free transfers/month, $0.50
   each after. FYI only, no action needed.

## Where the code lives

- Cash Flow page: `src/pages/CashFlowPage.tsx`
- Cash Flow + Growth Pipeline API: `server/routes/cashflow.ts`
- Migrations: `127`–`138` (individual real line-item corrections), `139`
  (growth pipeline tables + Bruce Poon Tip seed), `153` (Bruce Poon Tip
  quote/stage update)
- Client API types/functions: `src/api.ts` — `ApiCashflowOverview.growthPipeline`,
  `ApiPipelineDeal`, `updateGrowthTarget` / `createPipelineDeal` /
  `updatePipelineDeal` / `deletePipelineDeal`

---

# Session handoff — Outreach reply capture, Resend deletion fallout, Find new prospects (Sept 2026)

This block is the fast "where we left off" pointer for this session — full
technical detail already lives inline above in "Email transport", "Outreach
reply capture", and "Find new prospects"; this just summarizes what shipped
and what's still open so the next session doesn't have to re-derive it.

## What's live now (all merged to `main`, all deployed and verified)

- **Outreach reply capture** (PRs #63-64): a show's outreach template can
  point `reply_to` at a Slate-owned `p-<projectId>@<INBOUND_REPLY_DOMAIN>`
  address instead of a human inbox; replies auto-mark the prospect
  `replied`, file them in the Rolodex, and notify whoever's in
  `notify_email` (comma-separated multi-address supported). Full detail in
  "Outreach reply capture" above.
- **Resend-deletion incident, found and fixed** (PR #66-67): Ryan deleted
  the Resend account; three files (`email.ts`, `outreach.ts`, `audience.ts`)
  had a `resendKey ? new Resend(resendKey) : null` pattern that silently
  broke magic-link sign-in, outreach sending, admin alerts, and fan-list
  broadcasts the moment `RESEND_API_KEY` went unset. Fixed to always
  construct the shim. Also removed the last dead Resend-only UI ("Sync with
  Resend" button on Sending Domains). Full detail + "if this pattern
  reappears" guidance in "Email transport" above.
- **Find new prospects** (PRs #68-72): one-click AI-researched
  similar-show prospecting, built from scratch this session in direct
  response to Ryan rejecting the manual-paste workflow ("I shouldn't have
  to paste! I should be able to click a button"). Went through 4 real
  production bugs before it was solid — full blow-by-blow in "Find new
  prospects" above. Confirmed working end-to-end in production (verified
  via `/api/_diag` logs, not just "looks done"): real runs found 15 and 13
  RSS-verified shows with real emails for "Private Talk with Alexis Texas."

## Open / unresolved — pick these up next session

1. **Find new prospects targets 30+ but real runs have landed 13-15.** Not
   confirmed to be a bug — the model appears to stop once it's satisfied
   with verified quality rather than padding to hit the exact count. Worth
   revisiting only if Ryan/Caroline flag the yield as too low in practice;
   don't "fix" this speculatively.
2. **No client-side guard against double-firing a run.** The button
   disables while `findingProspects` is true, but a page refresh or a
   second browser tab could still kick off a second concurrent ~10-15 min
   research call for the same show (this actually happened once this
   session — two near-simultaneous runs on "Private Talk with Alexis
   Texas" completed fine independently, just produced two overlapping
   batches that deduped against each other on import). Not urgent; a
   server-side "already running for this project" lock would close it if
   it becomes a real annoyance.
3. **Bounce/complaint auto-pause SNS topic** — still not wired (needs one
   AWS-console step, see "Email transport" above). Not touched this
   session; was already open before it and remains open now that Resend
   really is gone (there is currently no live auto-pause safety net for
   the outreach rotation pool).
4. Everything else from this session (reply capture, the Resend bug fix,
   the dead-button cleanup) is genuinely done — no follow-up needed.

## Where the code lives

- Reply capture: `server/routes/ses_inbound_reply.ts`, `server/sns_verify.ts`
  (shared with `ses_notify.ts`), migration `139_outreach_reply_notify.sql`
- Resend/SES shim + the fixed callers: `server/mailTransport.ts`,
  `server/email.ts`, `server/routes/outreach.ts`, `server/routes/audience.ts`
- Find new prospects: `findSimilarShowProspects` + `createWithRetryStream`
  in `server/anthropic.ts`; the `find-similar` route in
  `server/routes/outreach.ts`; `api.findSimilarProspects` in `src/api.ts`;
  button + progress bar in `src/components/OutreachSection.tsx`

---

# Session handoff — QA show picker, everyone-sees-everything, Dropbox scoping (2026-09-17, PR #78)

All of this session's work is in **[PR #78](https://github.com/strawhutmedia/Project-management/pull/78)**
(branch `claude/trusting-ramanujan-3r4d7w`, 4 commits, build clean).
**MERGED to `main` 2026-09-17** (Railway deployed, migration 155 ran at
boot); the post-merge verification below is still owed.

## What's in PR #78

1. **QA show dropdown fixes** (Ryan's screenshot of `/qa` "Log a recording"):
   - It never "pulled from the sheet" — the SHOW picker is the podcast
     project list (`GET /api/qa/context`). Seed migration 148 left rows with
     NULL `project_id` when no project matched the sheet's show name.
   - **Migration `155_qa_show_fixes.sql`**: soft-archives the bare
     **"Private Talk"** project (exact-name match; "Private Talk with Alexis
     Texas" is a different show, untouched) + creates **"Invest in Her"**
     (was in the sheet, never a Slate project) and re-attaches its orphaned
     seeded QA rows.
   - `qa /context` now filters `archived_at IS NULL` (it didn't before, so
     archiving wouldn't have removed a show from the picker).
   - **"＋ Add a show…"** option in the picker: inline name input →
     `POST /api/qa/shows` → creates the podcast project via
     `createProjectRecord` (extracted from `POST /api/projects` in
     `server/routes/projects.ts` — same slug/stage-labels/Ryan-as-EP
     defaults). Dedupes: an existing name (case-insensitive) returns the
     existing project instead of creating a duplicate.
   - **Picker ordering (Ryan):** shows sorted by most recent logged
     recording, newest first; never-logged shows trail alphabetically; an
     inline-added show goes straight to the top. (The recordings board was
     already newest-first.)

2. **ACCESS MODEL CHANGE (Ryan, explicit):** *"Any person that has access to
   Slate can see anything in Slate… everyone can see everything."* Later
   clarified: anyone with access to the QA sheet has access to everything.
   - `GET /api/projects` returns ALL non-archived projects to every
     signed-in user; `getProjectRole`/`getSongRole` (`server/permissions.ts`)
     fall back to a read-only **`viewer`** role for non-members instead of
     null/403, so every project & song page opens for everyone while WRITES
     still need a real membership role.
   - Per-router access gates became existence checks (QA, transcripts,
     socials, clips, episode_cuts, carousel, show_brief, social_strategy,
     audience, budgets, locations, stripboard, exports, teleprompter) —
     whole team can work in the podcast tools, QA-sheet style.
   - **Deliberately unchanged:** notification/digest recipient queries
     (`server/notifications.ts`, `server/qa_digest.ts` decide who gets
     EMAILED, not who can see), and the money gates — **Cash Flow = Ryan
     only, Invoices = Ryan + Caroline. Ryan re-confirmed: "That will not
     change."**

3. **Dropbox scoping (Ryan): non-admins see PODCAST folders only.**
   - `assertDropboxPathAllowed` (`server/routes/integrations.ts`) — behind
     the folder picker, upload, create-folder, share-link: non-admins may
     browse inside a project's Dropbox folder only if that project is a
     podcast; album/film folders still require membership; path containment
     (can't leave the scoped folder) unchanged. Admin (Ryan) browses
     anywhere. Brand-asset file access follows the same rule.
   - **Crew workflow (Ryan):** they create the episode folder in Dropbox
     and upload the media BEFORE logging the recording in QA. So a podcast
     show with no `dropbox_folder` configured (e.g. just added inline)
     falls back: non-admins may browse within any PARENT directory of the
     configured podcast folders (never the Dropbox root — top-level parents
     excluded), and `qa /context` returns `podcastsFolder` (most common
     parent) so the picker opens there. Paste-a-link fallback also exists.

## Post-merge verification owed (per the "after every deploy" rule above)

- Confirm the exact built bundle hash is live, then check `/qa`: bare
  "Private Talk" gone, "Invest in Her" present with its 2 seeded recordings,
  dropdown recency-ordered, "＋ Add a show…" works.
- Have a non-admin (e.g. Xavier) click through: sees all projects/shows,
  Dropbox picker confined to podcast folders, `/cashflow` + `/invoicing`
  still locked.
- Remind Ryan to hard-refresh (Cmd+Shift+R) before judging the dropdown.

---

# Session handoff — Storage: "Verify against vault" button + error visibility (2026-09-18, PR #80)

Ryan panicked at the Master Archive dashboard ("1 error" badges on finished
RHINO/RECOVERY uploads) and issued a standing demand: **no terminal, no
PowerShell, no pasting — there should be a button.** This session's work is in
**PR #80** (branch `claude/storage-issue-lxjlf4`; PR #78 merged earlier).
**PR #80 is MERGED & DEPLOYED** (Ryan told the session to merge, 2026-09-18
~05:03 UTC; Railway deploy SUCCESS 05:04; auto-verify's first run confirmed
live at 05:05 via `storage-verify.json` on the status branch).

- **Vault verification is now AUTOMATIC + in-app**: `autoVerifySweep()`
  (60s after every boot, then every 30 min) verifies each finished drive
  census-vs-S3 server-side and re-checks the wave-1 folders every ≤6h,
  using the `ARCHIVE_ACCESS_KEY_ID`/`ARCHIVE_SECRET_ACCESS_KEY` already on
  Railway; a "🔍 Verify against vault" button on RHINO / RECOVERY /
  DROPBOX-WAVE1 rows runs the same check on demand
  (`POST /api/storage/transfers/:name/verify`). Runs persist in
  `storage_verify_runs` (migration `156`) and the latest verdict per row is
  published to the **status branch as `storage-verify.json`** — read THAT
  for wave-1 `VERIFIED — DELETABLE` folders; a cloud session needs no keys
  from Ryan. If files are missing, the row's Resume button re-runs the copy
  (skips existing, picks up strays) and auto-verify re-checks. Full detail:
  `docs/ARCHIVE_MIGRATION_STATUS.md` ("In-app verification" section) — the
  matching logic mirrors `tools/archive/ledger2.mjs`/`wave1-verify.mjs`,
  keep them in sync.
- **Error badges are inspectable**: the transfers API now returns `errorLines`
  (real rclone ERROR lines from the stored log tail) and the badge expands to
  show them. Key fact for talking Ryan down: rclone's `Errors:` counter is
  cumulative and doesn't un-count retries that later succeeded — "1 error" on
  a finished run can mean zero missing files; Verify is the truth.
- **Dashboard state 2026-09-18**: RHINO (13.3 TiB) + RECOVERY (12 TiB) +
  HENRI (60 GiB top-up) finished, awaiting verify; PODCASTS ~88% (~1 day
  left); DROPBOX-WAVE1 auto-paused. **Auto-queue is OFF** — wave 1 will NOT
  restart itself when PODCASTS finishes. Asked Ryan whether that was
  deliberate; unanswered so far. If wave 1 looks stalled after PODCASTS is
  done, that toggle (or the row's Resume button) is why.

## Post-merge results (2026-09-18, same session — done, not owed)
- Deploy verified live (deploy SUCCESS on merge commit `3220483`;
  `storage-verify.json` written by the new code at 05:05 UTC — stronger
  proof than the bundle hash, which was also confirmed fresh).
- **Wave 1 verdicts**: 17 previously deleted folders re-verified clean;
  **11 newly VERIFIED — DELETABLE folders were deleted from Dropbox Sept 18**
  (You Are U, Indy Automous challenge podcast, Ryan Personal Photos,
  Straw Hut General's files, Jay Kogen (1)(2)(3), Camera Uploads (1),
  Videos, Shaping Freedom Podcast, Apps — ~980 GB;
  **running total ≈ 2.7 TB freed**). Wave 1 remaining: ONLY Old Dbox
  (uploading) + one HeartBreakers file. Later sweeps: **CLIENTS VERIFIED**
  (all 1,490 files), **HENRI 25/27** (missing just Henri.prin/.prproj,
  ~110 KB). Also shipped same day (direct to main per the standing
  fix-to-main rule): auto-verify covers CLIENTS/PODCASTS/BLUE-*/HENRI
  (`331c786`), and the Verify button kicks off the check server-side
  instead of holding the HTTP request — the "Verify failed: Load failed"
  Ryan saw was the held request dying on a redeploy (`c4059fd`), plus
  calmer verdict copy ("N still to land — nothing is lost").
- **RHINO / RECOVERY: NOT wipe-safe.** Census-vs-vault found 1,414 (RHINO)
  and 6,121 (RECOVERY) files not in the vault — the "finished" rclone jobs
  covered less than the drive censuses (files are still on the physical
  drives, nothing lost). Full breakdown + next steps in
  `docs/ARCHIVE_MIGRATION_STATUS.md` "First auto-verify results".
- **Ryan's answers (2026-09-18):** Auto-queue is back ON (wave 1 self-resumes;
  Old Dbox is the last wave-1 folder). The partial RHINO/RECOVERY uploads
  were NOT intentional — "get it all uploaded so we can delete." He is out
  of Dropbox space; freeing it is the whole point, and he is (rightly)
  terrified of anything being deleted without a verified copy.
- **CRITICAL — SOLE COPIES on RHINO/RECOVERY**: the ~7,500 missing files are
  NOT in Dropbox anymore (confirmed via connector: `Can We Kick It` and
  Brandi's `_Archive_` are gone from the team space — old workflow moved
  them to drives). Until the top-ups land, those files exist only on two
  bare HDDs. **Never wipe/swap/unplug RHINO or RECOVERY.** Fix path:
  Ryan taps Resume on both rows (re-runs the same containers,
  `--ignore-existing`); auto-verify re-checks on its own. If the gap
  persists, the containers' scope excludes those subtrees → ONE paste on
  RED launches full-drive top-up containers (see
  `docs/ARCHIVE_MIGRATION_STATUS.md`).

---

# Session handoff — QA promo moments (2026-09-18, branch `claude/slate-qa-promo-moments-x4651f`)

Ryan (verbatim intent): a field on each uploaded episode/recording where the
uploader — or a producer later — enters the moments they watched happen while
shooting that they want promos of, **a separate entry per moment**, which the
promo cutter then hunts for when cutting promos. Built this session.
**MERGED & DEPLOYED 2026-09-18** — Ryan said merge it; PR #85 merged to main
(commit `cc14f10`), Railway deploy verified live 23:21 UTC: exact bundle hash
`index-Dv9M2Wt2.js` served, migration `158` in the status branch's
`migrationsApplied`, boot clean (no errors).

## What shipped

- **Migration `158_qa_promo_moments.sql`** — `qa_promo_moments`: one row per
  moment (`description` required, `approx_time` free text like "~20 min in",
  `position`, `created_by`, FK → `qa_recordings` ON DELETE CASCADE).
- **Server (`server/routes/qa.ts`)**:
  - `loadRecordings` returns `promoMoments` (description, approxTime,
    calledOutByName, createdAt) on every recording.
  - `POST /api/qa/recordings` accepts `promoMoments: [{description,
    approxTime}]` on CREATE only (stamped with the logger as created_by).
    PATCH deliberately ignores it — post-create edits go through the moment
    endpoints so attribution survives.
  - New: `POST /api/qa/recordings/:id/moments`, `PATCH /api/qa/moments/:momentId`,
    `DELETE /api/qa/moments/:momentId` (same assertQaAccess gates as checks).
  - **`GET /api/qa/approved` (the premiere-bot/cutter feed) now carries
    `promoMoments` per recording** — additive, token auth unchanged; this is
    how the promo cutter is meant to receive them.
- **UI (`src/pages/QAPage.tsx`)**: "Promo moments" editor in the Log-a-recording
  form (queue entries, saved with the recording); a live "Promo moments" block
  on every open recording card (add/remove any time, shows who called it out
  and when); a `🎬 N promo moments` chip in the collapsed row. Client API in
  `src/api.ts` (`ApiQaPromoMoment`, `qaApi.addMoment/setMoment/deleteMoment`).
- **`automation/promos/CUTTING-NOTES.md`**: dated note telling the cutter to
  cut the episode's Slate promo moments FIRST, then add its own finds.
- Build verified clean locally (`npm run build`, client tsc + vite + server tsc).

## Still open after merge

- ~~Bundle hash + migration verification~~ DONE 2026-09-18 (see above). One
  check a cloud session CANNOT do (no QA_SERVICE_TOKEN in cloud): an
  authenticated read of `/api/qa/approved` showing `promoMoments`. Ryan (or
  the premiere-bot with its token) sees it on first use; deployed code is the
  merged commit, so [Likely] fine — flag only if the bot chokes on the feed.
- Ryan should hard-refresh (Cmd+Shift+R) `/qa` before judging — old tabs stay
  on the old bundle.
- The in-house clips generator (prioritized step 4) should consume
  `promoMoments` from `/api/qa/approved`; the premiere-bot on the edit PC can
  read the same field with its existing `QA_SERVICE_TOKEN`.
- Nice-to-haves not built (ask Ryan before adding): promo moments in the daily
  QA digest email; a "moment done/cut" checkbox for the cutter to tick off.

---

# Session handoff — QA Approve = start editing/assembly (2026-09-19, branch `claude/qa-approval-automation-dpy0mx`)

Ryan asked: "when I hit QA Approve, can that BE the trigger that starts the
editing/assembly/promo process, instead of something checking periodically?"
Answer given (and now built): **the Approve button already IS the trigger on
Slate's side** — approving puts the recording on `/api/qa/approved` instantly.
Slate (cloud) cannot push into the studio LAN, so the edit PC's watcher pulls
that feed; this session tightened the pull to 60 seconds (invisible next to a
10–30 min assembly) and made the whole loop visible in Slate. No new button
was added — none is needed.

## What shipped (this branch/PR — awaiting merge)

- **`automation/premiere-bot/poll.mjs` overhauled**: default poll 5 min → **60s**
  (`POLL_SECONDS`, old `POLL_MINUTES` still honored); posts pickup / success /
  failure (+ a boot "online" line) to `POST /api/qa/bot-log` with
  `recordingId` in `data`; one-assembly-at-a-time guard; notifications now
  best-effort per-platform (headless-safe — bot-log is the real channel).
- **`automation/premiere-bot/install-task.ps1`** (new): one-paste elevated-
  PowerShell installer registering scheduled task **"PremiereBot"** running
  `node poll.mjs` as `editbot`, "whether user is logged on or not", at boot,
  self-restarting — the no-autologon headless design from the 2026-09-17
  handoff, now implemented.
- **`automation/premiere-bot/.env.example`** (new — README referenced it but it
  never existed) + README rewritten: "The Approve button in Slate IS the
  start-editing button", scheduled-task install replaces the terminal-tab step.
- **QA page "🤖 Edit bot" panel** (`BotLogPanel` in `src/pages/QAPage.tsx`,
  `qaApi.botLog` + `ApiQaBotLogEntry` in `src/api.ts`): the bot-log GET
  existed since migration 151 but NOTHING in the UI read it. Now a collapsed
  one-line strip under the QA header shows the latest bot entry (auto-refresh
  45s, expandable to last 30) — so Ryan sees "Picked up … starting Premiere
  assembly" right where he clicked Approve. No migrations; no server changes.
- Build verified clean locally (`npm run build`: client tsc + vite + server tsc).

## What this does NOT do yet (told to Ryan — don't overpromise)

- **The bot must be installed on the edit PC once** (it currently isn't
  running there as a task): copy `automation/premiere-bot/` to
  `C:\Users\editbot\premiere-bot`, create `.env` from `.env.example` with the
  real `QA_SERVICE_TOKEN` (on Railway), run `install-task.ps1` from elevated
  PowerShell. Until then, Approve marks the feed but nothing consumes it.
  Prereqs from the 2026-09-17 handoff still apply (Claude Code signed in for
  `editbot`, Dropbox synced, Fast Startup off).
- **Promos are NOT auto-cut** — the in-house clips generator is still
  prioritized-next-steps item 4 (not built). Approval delivers `promoMoments`
  to the bot via the feed; assembly of the Premiere project is what starts
  automatically.
- Anything already `approved` before the bot's first run will be picked up on
  its first poll (all-time feed + `seen.json` dedupe) — expected, not a bug.
  The footage Ryan approved 2026-09-19 will therefore assemble as soon as the
  task is installed.

## Verification owed after merge

- No Railway-deploy risk beyond the SPA bundle (server untouched); still:
  confirm exact bundle hash live, hard-refresh `/qa`, see the "🤖 Edit bot"
  strip ("no activity yet" until the PC task runs).
- After the on-PC install: the strip should show "Premiere Bot online…"
  within a minute — that's the end-to-end proof the Approve trigger works.

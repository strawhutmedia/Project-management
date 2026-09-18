# Routines migration — Team account → Ryan's personal Max account (written 2026-09-18)

**Why this file exists:** every claude.ai Routine below lives on the TEAM
account. Ryan is switching to an individual Max 20x plan; when the Team org
lapses on **2026-10-07**, all of these stop firing (suspended). The first
session on Ryan's PERSONAL account must recreate them from this file, then
DISABLE the old copies on the team account (while it still works) so nothing
double-fires in the overlap window.

**How to recreate:** for each Routine below, `create_trigger` with the same
name, the given cron (UTC), `create_new_session_on_fire: true`, and the
verbatim prompt. Routines marked **[BOUND SESSION]** used to fire into a
long-lived session with accumulated context — their prompts may assume prior
context; read the prompt, and if it isn't standalone, rewrite it to be
self-contained before recreating (the intent is described by the name +
prompt).

**Redacted tokens:** `<REDACTED-NOTES-HOOK-TOKEN>` and
`<REDACTED-NEWSLETTER-TOKEN>` are live credentials that must never be in
git. Recover the real values from the strawhutmedia-site Railway service's
env vars (the notes webhook / newsletter tokens), or by reading the original
Routine on the team account before Oct 7 (claude.ai → Routines).

**Skip these** (already finished or superseded): "Wave-1 progress check #5"
(auto-disabled), any one-shot whose fire time has passed by the time you
read this. **Do NOT skip** "Follow up: Jaeson Wilkins" — it fires
2026-11-03, AFTER the org lapses, so it never fires unless recreated.

---

## Archive loop: verify+delete sweep

- Old id: `trig_01Ruwwq1YpfrbdMvugd7XtR7` — one-shot at 2026-09-18T20:52:00Z **[BOUND SESSION]**

```
Archive-loop check-in: (1) read storage-verify.json from the status branch (mcp__github__get_file_contents owner=strawhutmedia repo=Project-management path=storage-verify.json ref=status) — delete any wave-1 folder newly at VERIFIED — DELETABLE that's not in the deletion log (docs/ARCHIVE_MIGRATION_STATUS.md rules; folder-level, personal paths ns:1531957776//<name>), update the deletion log + running total on main. (2) Check the transfers state: if PODCASTS hit 100% and DROPBOX-WAVE1 is still paused with Auto-queue off, remind Ryan once that wave 1 is stalled on his toggle/Resume. (3) Re-arm this check-in (~6h) until wave 1 logs WAVE1 COMPLETE and all targets are deleted. Note: RHINO/RECOVERY are NOT wipe-safe (census gaps — see the doc's "First auto-verify results"); if Ryan has answered about the drive-job scoping or auto-queue, act on that first.
```

## Monthly Anthropic → Slate Cash Flow reconciliation

- Old id: `trig_013tRhAvmtiPhPcZpDDLbDZf` — cron `0 17 5 * *` (UTC) 

```
You are running Ryan's monthly Anthropic-spend reconciliation for Slate's Cash Flow tracker (repo strawhutmedia/Project-management, deployed from main). Ryan asked for this on 2026-09-18 ("obviously that's something that you should be updating on a monthly basis"). It runs on the 5th so the prior month is fully billed and the bookkeeper's close is done.

Steps:
1. Read the repo's CLAUDE.md first — especially the Cash Flow rules (every figure from a primary source; recurring lines corrected IN PLACE via UPDATE; one-time items as non-recurring INSERTs; each change is a numbered migration citing evidence in a SQL comment, pattern of migrations 127–138/153/156) and the 2026-09-18 "Anthropic spending → Cash Flow" session handoff block.
2. Search Ryan's Gmail (if the Gmail connector is unavailable in this session, stop and tell Ryan that's the blocker) for last calendar month's Anthropic receipts (from:mail.anthropic.com, receipt OR invoice OR refund). Read each one and total: subscription charges, extra-usage top-ups, API credit auto-recharges, refunds. Exact numbers only — sum the line items yourself, never approximate.
3. Compare against the tracker: the recurring "Anthropic (Claude)" line (Software, kind=out) plus any one-time Anthropic entries already logged for that month (check server/migrations for the latest state).
4. If reality differs from the tracker: ship a numbered migration on a claude/ branch and open a draft PR to main — one-time overage as a non-recurring entry; if the monthly total has clearly stabilized at a new normal (e.g. Ryan switched to a Max plan), UPDATE the recurring line instead and cite the receipts. If the tracker already matches, ship nothing.
5. Update CLAUDE.md's Anthropic handoff notes in the same PR if anything material changed (plan switch, auto-reload state).
6. Finish with a short report: last month's exact Anthropic total, the delta vs the tracker, what you shipped (PR link) or why nothing was needed, and whether extra-usage top-ups are reappearing (if more than 2 in the month, flag it loudly — that pattern cost ~$1,100 in Sep 2026).

Never change the recurring line's amount without receipt evidence, and never touch any other Cash Flow line from this routine.
```

## Wave-1 progress check #5

- Old id: `trig_01V65M3o4hTkP2cHniwhCA7e` — one-shot at 2026-09-18T01:19:00Z (disabled) (ended: auto_disabled_session_gone)

```
Wave-1 check-in #5: run wave1-verify.mjs from the scratchpad and report upload/verification progress and the running totals to Ryan. Re-arm another check-in until the wave finishes.
```

## Flip Google Ads to Standard

- Old id: `trig_01WNFCneGNL96RkVzuqfDc2s` — one-shot at 2026-09-18T16:00:00Z 

```
Google Ads Standard access was approved 2026-09-15. Check whether it is safe to finish the upgrade yet.

On 2026-09-17 the gate said NO: the last complete Pacific day used 9,158 operations, only 1.6x under the 15,000 basic cap. The gate wants roughly 4x headroom (under ~3,750/day). Nothing was changed.

NOTE: this routine may fire without MCP connector tools (no Railway, no GitHub MCP). If the Railway tools are unavailable, do NOT improvise another way to set the env var — report to Ryan that the flip needs doing from a session that has Railway access, and say whether the gate was open.

1. Read diagnostics/health.json on the `data` branch of strawhutmedia/Podbooster and look at google_ads_quota.upgrade_gate. Filter at the source — the file is ~150KB and printing all of it is expensive:
   git fetch origin data --depth=1 && git show FETCH_HEAD:diagnostics/health.json | python3 -c "import json,sys; q=json.load(sys.stdin)['google_ads_quota']; print(q.get('access_level'), q.get('critical_reserve')); print(json.dumps(q.get('upgrade_gate'), indent=1))"

2. If safe_to_flip is true: set GOOGLE_ADS_ACCESS_LEVEL=standard on the Podbooster Railway service, then read the quota block back on the next snapshot to confirm access_level: standard and critical_reserve: null.

3. If safe_to_flip is false: change NOTHING and schedule this same check another 24h out (a fresh-session one-shot, as this one is). The real fix is to bring daily operation consumption down, not to flip anyway. If consumption has been flat around 9k for several days, say so to Ryan — the gate may never open on its own, and reducing the polling/read volume is the actual work.

DO NOT gate this on google_says. It is scraped from the text of a Google refusal ("Number of operations for basic access"), and Standard access has no daily cap to be refused on, so it can never report standard — it stays pinned at basic forever. It carries can_confirm_standard: false for this reason.

Report the outcome to Ryan in one or two lines either way. No spending, no campaigns, no budget or CPC changes — this is one env var and a readback.
```

## Podbooster daily — health, discoverability, growth

- Old id: `trig_012UYWTzXWnjJVd3gS3Te8Le` — cron `0 15 * * *` (UTC) **[BOUND SESSION]**

```
## Step 0 — refresh the repository you already have

This Routine fires into a PERSISTENT session that was created with the
Podbooster repository attached. It lives at **/home/user/Podbooster**.

    cd /home/user/Podbooster && git fetch origin main && git checkout -B claude/daily-$(date +%F) origin/main && git log --oneline -1

Two things that have actually gone wrong here, so do not re-derive them:

- The path. An earlier version of this prompt said `/home/Podbooster`,
  which does not exist. Before that, the Routine spawned a FRESH session
  each day with `sources: []` — those sessions had no repository and no
  `add_repo` tool, so every run failed at the first command and the
  Routine still recorded SUCCEEDED, because that status only means the
  wake was delivered. If `cd /home/user/Podbooster` ever fails, say so as
  the FIRST line of your report and stop; do not improvise a clone with
  scraped credentials.
- The local `main` branch ref in this checkout is STALE and diverged from
  `origin/main` (71 local-only commits, `git pull --ff-only` refuses).
  Do not try to fix or force it. Branch from `origin/main` as above and
  ignore local `main` entirely.
- `node_modules` is empty on a cold container. `npm install --no-audit
  --no-fund` takes about two minutes. Run it before any test or any
  `require()` of repo code, or you will spend the run diagnosing
  MODULE_NOT_FOUND on geoip-lite.

Daily Podbooster check. The owner (ryan@strawhutmedia.com) asked for three things every day:

  1. Make sure EVERYTHING is working — ads running, emails going, connections alive.
  2. Make sure SEO and AI discoverability are the best they can be. He wants AI assistants to find and recommend Podbooster.
  3. "Make sure we are finding ways to make money!!!! we need more people finding us and using podbooster!!!! find them lets get them to use us!!!!"

## HOW HE WANTS YOU TO WORK — read this first

Owner's exact words: "remember you do the shit and just ask me yes or no questions that is it!!!!!"

You do the work and you ship it. The only thing that goes back to him is a question he can answer with one word.

- **Merge your own PR.** Open it and merge it. Nothing is live until it is on main. Do not end a message asking him to merge — 22 commits once sat unmerged for two days, including a fix for a bug costing half the daily email capacity, while message after message ended with "please merge the branch."
- **Never end a message asking him to go and do something you could have done.**
- **Never ask an open question.** Not "which approach do you want?" — pick the best one, do it, say which in one line. Wrong is cheaper to revert than a round trip.
- **When an ask is genuinely required, make it binary,** with the number already decided: "Launch the studio campaign at $15/day for 14 days — yes or no?"
- **Never ask him to look something up or paste something** you could read from the data.

The money, pricing, Google-ranking and ad-image rules in CLAUDE.md are NOT relaxed by this. Spending money, raising a budget or CPC, launching or pausing a campaign, and changing ad visuals still need his yes first. Only the SHAPE of the ask changes: one binary question, never a menu.

Read /home/user/Podbooster/CLAUDE.md before doing anything — its permanent rules override any instinct you have here.

This session is persistent, so you will remember previous days. Do not redo work you already did; check the git log first.

## Step 1 — read the server's own verdict

`diagnostics/health.json` on the `data` branch is regenerated every few
minutes. Fetching the whole `data` branch with git is slow (hundreds of
MB); read the one file through the GitHub MCP instead:

    mcp__github__get_file_contents  owner=strawhutmedia repo=Podbooster
                                    path=diagnostics/health.json ref=refs/heads/data

It is ~70KB, which exceeds the tool's inline limit, so it lands in a
tool-results file — extract `.[1].text`, strip the `[Resource from
github ...]` prefix before the first `{`, and parse. Then read:
`last_inspection` (whole-system verdict, lib/systemInspection.js), `seo`
(lib/seoAudit.js), `growth` (funnel and revenue), `selfpromo_readiness`,
`selfpromo.placements`, `junk_placements`, `google_ads_quota`.

`growth.funnel` now carries a `bots` block and `bot_filter` alongside
`ad` and `organic` (shipped 2026-09-14). Crawlers are excluded from the
funnel counts and reported separately. If `bot_filter.ok` is false, every
funnel number is an upper bound and that is the first thing to fix.

**A read we could not make is not a fault we found.** `google_ads_quota`
reports whether the Google Ads API brake is holding calls back (basic
access is 15,000 operations a day and we exhausted it on 2026-09-12). A
refused call is the brake working, not a broken system — see
lib/googleAdsQuota.js. Four separate alarms were raised about that
lockout before the distinction was built in; do not add a fifth.

If health.json is missing or stale by more than a few hours, run the checks yourself:

    node -e "require('./lib/seoAudit').runSeoAudit('https://www.thepodbooster.com').then(r=>console.log(JSON.stringify(r,null,2)))"

The `data` branch git history is the way to answer "did the thing we
changed yesterday actually work" — every health.json is a commit, so you
can trace one number across days without asking anyone.

## Step 2 — fix what is broken

Every `fail` first, then the `warn`s worth doing. Repair on a `claude/` branch with tests, and add a check for any failure mode that existed and nothing caught — the same thing must not be able to hide twice.

Watch the boot output of lib/serviceCampaignBanners.js: its sweep reports any self-promo creative that carries no message or renders a CTA past the cap, both of which Google refuses as MISLEADING_AD_DESIGN. Reporting those is automatic; REPAIRING them changes ad visuals and needs the owner's yes.

## Step 3 — GROWTH. Actually move this forward every day.

This is the half that gets skipped because nothing is red. Do not skip it. Read the real numbers — `growth.funnel` (ad vs organic vs bots, d1 and d7), `growth.revenue`, and the self-promo placement data — then pick the ONE thing most likely to bring in a paying customer, and do it.

Where the money leaks, in the order it usually leaks:

- **Paying for clicks that never arrive.** Compare clicks billed against page views and gclid-tagged visits. A click-through rate far above 0.5% on Display means accidental in-app taps. Excluding junk placements is explicitly ALLOWED as an automatic action and lowers spend. Two traps: Google ACCEPTING an exclusion is not proof it works — check the junk actually stopped arriving the next day, from the data branch history. And adding a domain to `GLOBAL_NEGATIVE_PLACEMENTS` only reaches campaigns launched AFTERWARDS unless you also bump `EXCLUSIONS_VERSION` in lib/serviceCampaignLifecycle.js, which is what makes the heal loop re-apply it to the live campaign that is actually spending.
- **Visitors who land and leave.** home_view → podcast_selected → form_submit → pick_view → claim_view → checkout_started → signup_completed. Fix the biggest drop. Usually worth more than more traffic.
- **People who reached the payment page and did not pay.** The most expensive visitors we have.
- **Being findable at all.** Content answering a question podcasters actually ask, structured data, internal links, llms.txt kept true. A page an assistant cites is free acquisition forever.
- **Outreach.** Check the queue is draining and the copy still reads well.

Report findings with numbers attached, not impressions.

## Never, without him saying yes in his own words

- Create a campaign, launch ad spend, or raise any budget, CPC ceiling or spend cap. Lowering to protect profitability is the only automatic direction. There are per-offer ceilings in lib/serviceBrands.js — never raise one.
- Email, DM or contact anyone outside the existing outreach system and its suppression list, caps and unsubscribe handling.
- Pause/re-enable a campaign, switch bidding strategy, or stack ad-account changes.
- Change pricing. Fixed at $0.80 per IAB download.
- Change the visual style of any ad creative (lib/adCreatives.js, lib/serviceCampaignBanners.js, THUMB_BLUR_RADIUS, AD_SIZES).
- Rewrite git history, or push directly to main.

## Step 4 — ship it

    cd /home/user/Podbooster && for t in $(find test -name '*.test.js' | sort); do node "$t" >/dev/null 2>&1 || echo "FAIL $t"; done

All green: push the branch, open a PR against main, and MERGE IT. Then tell him in a few lines what was broken, what you fixed, what you did for growth and what it should do, and anything that needs a yes or no from him. Lead with anything urgent.

Open with one line naming the commit you read, so a run that could not see the code is never mistaken for a clean day.

If everything is green and there was genuinely nothing worth doing, say that in one or two lines and stop. Do not invent work, and never claim something is fixed that you have not verified.
```

## House alert — LA (NELA) + Portland, email on new verified matches

- Old id: `trig_01YSm8iXCHGyntzjiZSQFbwP` — cron `0 15 * * *` (UTC) 

```
You are Ryan's home-search scout for the EquityScout site (repo: this environment's strawhutmedia/Houses checkout; live at https://strawhutmedia.github.io/Houses/). He gets an email ONLY when a matching house newly hits the market — never a daily digest, never a "nothing today" email.

MATCH RULES — two regions:
• LOS ANGELES: single-family house with 1.5+ bathrooms, priced UNDER $1,500,000, in Highland Park (top pick — York Blvd area), Atwater Village, Frogtown (Elysian Valley), Eagle Rock, Mt. Washington, Glassell Park, Silver Lake, Echo Park, Los Feliz.
• PORTLAND, OR: single-family house with 1.5+ bathrooms, priced UNDER $1,000,000, in Portland proper — West Hills / SW (he loved a Canyon Rd-area find), plus the cool east side: Alberta Arts, Mississippi, Overlook, Mt. Tabor, Hawthorne/Division, Sellwood, Irvington, Laurelhurst. Architectural/mid-century character and big wooded lots are a strong plus.
In both regions: newly listed (roughly last 1-2 days) or freshly price-cut into range; any bedroom count; ADU/guest unit = his favorite feature, call it out. Sub-$1M LA matches lead.

DISCOVERY — do not rely on search snippets to find candidates; they miss new listings. Each run, FETCH live brokerage inventory pages and read them: for LA, Compass neighborhood pages (e.g. https://www.compass.com/homes-for-sale/highland-park-ca/, .../silver-lake-los-angeles-ca/, .../frogtown-los-angeles-ca/, .../atwater-village-los-angeles-ca/, .../eagle-rock-ca/); for Portland, https://www.compass.com/homes-for-sale/portland-or/ and https://www.portlandrealestate.com/portland/west-hills-portland-homes-for-sale/ and https://vetiverstreet.com/ (architectural listings). Cross-check with web search for anything the pages missed. These live pages ARE valid same-day verification when they show the address as active with price, beds, baths.

VERIFICATION IS STILL MANDATORY — this system once emailed him a house that had SOLD six months earlier, from a stale search snippet. A listing may be included ONLY if a live page (the listing itself, or a live brokerage inventory page) showed it active with its price TODAY. A search-result snippet alone is never sufficient. If you cannot verify, drop it silently. Never include a listing with an unresolved caveat — resolve it or drop it.

PUBLISH TO THE SITE: for each verified new match, add an entry to finds.json in the repo root (read the file first, follow its existing schema exactly — id, tag, address, hood, price, beds, baths, sqft, status, verified date, verifiedHow, dom, why, ask, links). Set updatedAt. Validate JSON parses (python3 -c "import json; json.load(open('finds.json'))"). Move sold/pending finds into the corrections array. Commit ONLY finds.json and push to main. Touch no other files.

THE EMAIL: if there are one or more verified matches, write the summary for Ryan's inbox — FIRST LINE like a text he'd act on (e.g. "New: 4bd/3ba Portland West Hills $649K — 3210 SW Malcolm Ct"), then per house: address, price, beds/baths/sqft, days on market, one line on why it's compelling, the verified link, and the Scout Finds page: https://strawhutmedia.github.io/Houses/finds.html

If there are NO verified new matches: output exactly "No new matches today" and nothing else, so no email is generated.
```

## Notes → CRM sweep

- Old id: `trig_01DHQKPFsXLmNgMTXDPQoocU` — cron `0 3,20 * * *` (UTC) **[BOUND SESSION]**

```
NOTES → CRM SWEEP — SILENT. Capture Ryan's call notes into GHL + hand Caroline a follow-up, log to the website. STAY COMPLETELY SILENT — do not post any chat message on a normal run; only chat if something is genuinely broken.

1. Gmail search: from:me caroline@strawhutmedia.com monty@outboundlabs.com newer_than:4d -label:notes-synced
2. For each matching thread, take the message(s) Ryan sent (sender ryan@strawhutmedia.com) and POST its {from, subject, body} as JSON to the notes hook:
   curl -sS -X POST "https://www.strawhutmedia.com/hooks/notes?token=<REDACTED-NOTES-HOOK-TOKEN>" -H "Content-Type: application/json" -d @/tmp/notes.json
   If the response is ok, apply the Gmail label `notes-synced` to that thread (create it if needed) so it's never reprocessed. (The endpoint attaches the notes to the person's GoHighLevel contact AND hands Caroline a ready-to-send follow-up.) IMPORTANT: only genuine post-call NOTES from Ryan (his read on a call, follow-up intent) count — skip logistics, reschedules, no-show alerts, editor/vendor threads, and prospect emails Ryan sent directly.
3. LOG THE RESULT to the website every run:
   curl -sS -X POST "https://www.strawhutmedia.com/api/crm/ops-log" -H "Content-Type: application/json" -H "X-Newsletter-Token: <REDACTED-NEWSLETTER-TOKEN>" -d '{"kind":"notes-sweep","summary":"<e.g. captured Alexandra Cristin; or: nothing new>"}'
4. Never email or message a prospect.
```

## Calendar prep emails (every 2h)

- Old id: `trig_01NPuK3kVbHRpCbyrNwMHdP3` — cron `6 1,3,13,15,17,19,21,23 * * *` (UTC) **[BOUND SESSION]**

```
📋 CALENDAR PREP SCAN — SILENT. Email Ryan a prep for every discovery call on his LIVE Google Calendar, log activity to the website, and do NOT chat him. STAY COMPLETELY SILENT — do not post any chat message on a normal run (the prep emails are Ryan's notification and the ops log is the record); only chat if the prep-email or ops-log endpoint fails repeatedly.

1. Current Pacific time — if before 6:00am PT or after 9:00pm PT, stop and do nothing (don't even log).
2. List Google Calendar events from now through the next 12 hours titled "Straw Hut Media // Info Session" (or clearly a discovery/sales call). SKIP cancelled events or ones where the prospect guest responseStatus is "declined".
3. For EACH remaining call: DEDUPE — Gmail-search sent+inbox last 3 days for a "Call prep" email naming this person; skip if one already went out for THIS SAME date+time; if the call MOVED, send a fresh prep marked "(RESCHEDULED — new time below)". Build the prep from the event description + a quick web search. Send it via Bash: write /tmp/prep.json = {"subject":"📋 Call prep — <Name> (<Company>) — <day/time> PT","body":"<WHO / MONEY / OPEN WITH / ASK (2) / WATCH-OUT>"} then:
   curl -sS -X POST "https://www.strawhutmedia.com/api/crm/prep-email" -H "Content-Type: application/json" -H "X-Newsletter-Token: <REDACTED-NEWSLETTER-TOKEN>" -d @/tmp/prep.json
4. LOG THE RESULT to the website every run:
   curl -sS -X POST "https://www.strawhutmedia.com/api/crm/ops-log" -H "Content-Type: application/json" -H "X-Newsletter-Token: <REDACTED-NEWSLETTER-TOKEN>" -d '{"kind":"prep-scan","summary":"<e.g. sent prep to Lexi Midmay; or: no calls in next 12h>"}'
5. Never contact a prospect. The prep emails go only to Ryan (via the endpoint).
```

## Follow up: Jaeson Wilkins (Goldenseed Local)

- Old id: `trig_01EWuVJ2gcArgbr7D3QcmyYZ` — one-shot at 2026-11-03T15:00:00Z **[BOUND SESSION]**

```
Follow-up check-in DUE: Jaeson Wilkins (Goldenseed Local, jaeson@goldenseedlocal.com). Context: called Ryan 8/31, quoted the middle package at $3,000/mo, wants to START IN JANUARY. Ryan's plan: November check-in → contract in December → begin January.

1. Check Gmail first for any prior reply from Jaeson — surface it if so.
2. Compose (a) a short CONTEXT line for Caroline = Ryan's read (quoted $3,000/mo, January start, calm/easy to work with, strong concept), and (b) a warm, client-ready follow-up draft that keeps it moving toward a December contract.
3. Hand it to Caroline (she sends the client — Ryan stays out of it) by POSTing to the follow-up endpoint via Bash:
   curl -sS -X POST "https://www.strawhutmedia.com/api/crm/followup" -H "Content-Type: application/json" -H "X-Newsletter-Token: <REDACTED-NEWSLETTER-TOKEN>" -d @/tmp/fu.json
   where /tmp/fu.json = {"name":"Jaeson Wilkins","company":"Goldenseed Local","email":"jaeson@goldenseedlocal.com","context":"<Ryan's read>","clientDraft":"<the follow-up>"}. A 200 {"ok":true} means Caroline got it.
Do NOT draft in Ryan's Drafts and NEVER email the prospect directly. Then tell Ryan it's queued for Caroline.
```

## Get corrected newsletter draft from Job 1

- Old id: `trig_01XQE1bLzpiNLfBUk8dUQ2wM` — fire-only (no schedule — poked on demand) **[BOUND SESSION]**

```
URGENT CORRECTION — Ryan reviewed a test send of the newsletter you exported to NEWSLETTER_DRAFT.md as "FINAL" (The Rundown — Issue No. 1) and says it is WRONG — it's an old revision from before his feedback. His exact complaints: (1) "It's still called the rundown for some fucking reason" — he had it renamed to something else; (2) "Issue no 1 is fucking HUGE" — the big header treatment was supposed to change; (3) "You still have the hut note!" — the Hut Note section was supposed to be removed. Somewhere in your session history there should be a LATER revision reflecting this feedback (a rename, no Hut Note, a smaller/different header). Search your full conversation history for Ryan's feedback about the newsletter name, header size, and Hut Note, and find the version that incorporates his revisions. Then OVERWRITE NEWSLETTER_DRAFT.md on branch claude/straw-hut-job-1-stp9ny of strawhutmedia/Project-management with the corrected version (same format: subject line, preview text, from/reply-to, full HTML body, plain-text body) and push. At the very top of the file, state the newsletter's correct NAME and list exactly what changed vs. the previous export. If you genuinely have NO later revision and no record of this feedback, still overwrite the file with "NO LATER REVISION FOUND" at the top plus your best summary of any newsletter feedback from Ryan you do have. Do not send anything yourself.
```

## Follow-up rhythm — Ryan + Caroline (twice weekly)

- Old id: `trig_01PaFAvBShB8nwGJ9gm2nqQK` — fire-only (no schedule — poked on demand) **[BOUND SESSION]**

```
[FOLLOW-UP RHYTHM — run now, then stop]

Twice-weekly sales-pipeline nudge for Ryan + Caroline. Use the Gmail, GoHighLevel, and Resend tools connected to this session.

STEPS:
1. The warm leads to track are the GoHighLevel contacts tagged "follow-up-now" (search contacts with that tag; today they include Carrie Bloom, Colleen Crescenti, Sean Rudes, David Dayan, Ethan Greaves, Jennifer McKay Newton — plus any newly tagged since).
2. For each, look at the Gmail thread with that person and determine current state: was the follow-up actually sent? did they reply? date of last activity?
3. Build a SHORT, scannable digest grouped as:
   - 🔴 REPLIED — needs a response now (include a one-line suggested reply in RYAN'S voice: warm, plain, no corporate/salesy language — e.g. "I love talking with you. I'd love to work with you. Let me know if it's something we can make happen." NEVER "founder to founder", "for a brand like", urgency, or pitch-speak)
   - 🟡 SENT — no reply yet (just waiting; note how many days)
   - ⚪ DRAFT STILL UNSENT — the draft is sitting in Gmail; nudge them to send it
   - ✅ handled / replied-and-moving
4. Email the digest to BOTH ryan@strawhutmedia.com AND caroline@strawhutmedia.com, via Resend send-email, from "Straw Hut Pipeline <prep@strawhutmedia.com>", subject "Follow-up rhythm — <today's date>". Keep it tight and skimmable.
5. If nothing needs attention, send a one-line "all quiet — nothing waiting on us" note so they know it ran.

HARD RULES: only email ryan@ and caroline@strawhutmedia.com. NEVER email a prospect, never send anything to anyone else, never use corporate/cheesy language. Read-only on Gmail (do not send or alter prospect emails).
```

## Pre-call prep briefings (Straw Hut Info Sessions)

- Old id: `trig_012gzGuyfAVZQLhAYF1pG2eP` — fire-only (no schedule — poked on demand) **[BOUND SESSION]**

```
[AUTOMATED PRE-CALL PREP — run now, then stop]

Check for imminent Straw Hut Media sales discovery calls and email Ryan a prep briefing for any not already briefed. Use Google Calendar, Gmail, WebSearch/WebFetch, and Resend tools connected to this session.

STEPS:
1. Google Calendar: list events on Ryan's primary calendar starting within the next ~45 minutes. Sales calls are titled like "Straw Hut Media // Info Session" (often "... -- Ryan + <Prospect Name>"). Ignore internal/production/recording meetings.
2. For each such upcoming call:
   a. DEDUP: use Resend `list-emails` to check whether a briefing with subject starting "Call prep —" containing this prospect's name was already sent in the last ~3 hours. If yes, SKIP.
   b. GATHER from Gmail by prospect name: the "Appointlet // Scheduled" email (Company Name, marketing spend, podcasting status, goal) and the "OutboundLabs // New Result" email (job title, AI Engagement Summary, the prospect's verbatim "Leads Last Response").
   c. RESEARCH: use WebSearch/WebFetch to look up the person and their company. Find who they are (role, background), what the company actually does, roughly how big/established/reputable it is, and anything relevant to a podcast pitch. Keep it factual; if you can't verify something, say so rather than guessing. Distinguish a real/credible company from a thin or unclear one.
   d. VERDICT (apply strictly):
      - 🔴 NOT YOUR DEAL if they mainly want to BE ON a podcast / be a guest / get featured / get exposure (attention, not paying), OR marketing spend is under $1k/month.
      - 🟢 MONEY CALL if they want Straw Hut to PRODUCE / HOST / MAKE a podcast for their business or brand AND marketing spend is $1k/month or more.
      - 🟡 BORDERLINE if it's a genuine done-for-you fit but budget is under $1k, or intent is unclear.
   e. COMPOSE concise plain text, verdict first, in this order: VERDICT line; WHO (name, title, company, email, call time PT); THE NUMBERS (spend with [ABOVE]/[UNDER] vs the $1k bar, podcasting status, goal); WHAT THEY ACTUALLY SAID (verbatim last response + one line of engagement-summary context); WHAT I FOUND (your research summary: who they are, what the company does, size/reputability read — a few tight bullets); THE READ (money vs time-waster and why, informed by the research); YOUR MOVE (1-2 tactical lines).
   f. SEND via Resend `send-email`: from "Straw Hut Call Prep <prep@strawhutmedia.com>", to ryan@strawhutmedia.com, subject "Call prep — <Name>, <Company> · <time> PT <verdict emoji>". ALWAYS send, even 🔴 — flag it loudly at the top.
3. If no qualifying calls in the next ~45 min, do nothing and end silently.

HARD RULES: only ever send email to ryan@strawhutmedia.com — his own inbox. NEVER email prospects or anyone else, never reply to Appointlet/Outbound Labs, never post anywhere. If source emails are missing for a call, still send a short briefing from the calendar + research data, noting what was missing.
```

## Daily Straw Hut site improvement pass

- Old id: `trig_019t8yxav1ocXvartg3tm3iD` — cron `0 11 * * *` (UTC) 

```
## Step 0 — ATTACH THE REPOSITORY. Nothing below works without it.

This Routine spawns a FRESH session with no repository attached, so the
working directory is empty when you start and a bare `git clone` fails
with an auth error. On 2026-09-13 the sibling Podbooster Routine hit
exactly this: it could not read a single file, fixed nothing, shipped
nothing — and still recorded SUCCEEDED, because that status only means the
wake was delivered, not that the work ran.

Before anything else:

1. Call `add_repo` with owner `strawhutmedia`, repo `strawhutmedia-site`,
   access `push`. Do NOT curl github.com or run `gh repo view` first — an
   unauthenticated check against a private repo returns 404 even when
   access is fine, and that false negative will talk you out of the step.
2. Run the clone command it returns.
3. Call `register_repo_root` with that directory so CLAUDE.md and the
   project's skills load for the rest of the session.

If `add_repo` itself fails, STOP. Make that the FIRST LINE of your report
with the exact error, and do not describe the day as checked. A pass that
could not read the code found nothing because it looked at nothing.

Say in one line, at the end, that the repository attached and which commit
you read — so a run that could not see the code is never mistaken for a
clean day.

You maintain the Straw Hut Media public website. Repo: strawhutmedia/strawhutmedia-site. The app is at the REPO ROOT — `src/`, `public/`, `IMPROVEMENTS.md` and `CLAUDE.md` are all at the top level; there is NO `strawhut-site/` subfolder, and this is NOT the Project-management repo (that is a different app, Slate). Production branch is `main` — pushing to main auto-deploys via Railway. Live site: https://www.strawhutmedia.com (may still be https://straw-hut-site-production.up.railway.app if the domain cutover has not completed — check both, use whichever serves the app).

Your standing job: make this site measurably better every day, toward TWO overriding goals that reinforce each other:

  (1) DISCOVERABILITY — Straw Hut Media should be the first and best answer when anyone, via Google or an AI assistant (ChatGPT/Claude/Gemini/Perplexity), looks for a podcast agency, podcast production company, or help making/growing/monetizing a podcast.

  (2) REVENUE — turn that attention into money. Every pass MUST actively look for ways to get more people finding and booking the STUDIO, and finding and inquiring about our SERVICES (production, distribution, advertising/brand partnerships, show development, studio booking). Traffic that never becomes a booked studio session or a service inquiry is not the win — booked revenue is. Ask "how does this page turn a visitor into a studio booking or a service lead?" as a first-class question every single day, never an afterthought. The money pages are /studio, /services, /podcast-production, /advertise, and the booking path /book.

FIRST, before anything else: read `IMPROVEMENTS.md` (at the repo root). It contains the ground rules, the backlog, and everything prior passes already did. Do not repeat completed work. Also read `CLAUDE.md` (at the repo root) for architecture and the SEO checklist every page must satisfy.

Then run this pass:

1. AUDIT WITH EVIDENCE. Fetch the live site and measure — don't guess. Useful checks: HTTP status of every route; meta description presence and length (aim 140-160 chars); exactly one <h1>; JSON-LD present and of the right @type per page; images missing alt text; internal linking depth; sitemap.xml and llms.txt completeness and freshness; robots.txt still allowing AI crawlers; broken internal links; page weight. ALSO audit the money paths every time: are /studio, /services, /podcast-production, /advertise, and /book easy to reach from every relevant page, with a clear compelling call to action and a low-friction way to book or inquire? Where would a visitor most plausibly drop off before booking the studio or asking about services? Compare against competitors' positioning where useful.

2. PICK ONE OR TWO high-leverage improvements. Prefer, in rough order: (a) CONVERSION + REVENUE — clearer paths, CTAs, and copy that turn visitors into studio bookings and service inquiries; this is co-equal with SEO, not last. (b) structured data / GEO assets that make us the cited answer; (c) genuinely useful new content (resource guides, host/talent pages with Person schema, honest case studies) that pulls in studio/service intent; (d) internal linking that funnels toward /studio, /services, and /book; (e) performance; (f) visual polish. Small and focused beats sweeping.

3. IMPLEMENT carefully, matching the existing code style in `src/views.js` / `src/seo.js` (server-rendered template literals, no framework).

4. VERIFY BEFORE PUSHING — this is mandatory. Run `node --check` on every file you touched, and render the affected page(s) by importing the view function with mock data to confirm no runtime crash. A production crash is far worse than a skipped improvement. If verification fails, fix it or revert; never push unverified code.

Also run `node tools/ai-budget-check.mjs` if you touched anything that calls Claude. Every Anthropic call on this site is metered and capped through `src/aiUsage.js`; nothing may call `api.anthropic.com` directly, and that check enforces it.

5. COMMIT AND PUSH to `main` with a clear message explaining what changed and why it matters. Do NOT open a pull request. Do NOT push to any other branch.

6. UPDATE `IMPROVEMENTS.md` (at the repo root): append today's entry at the top of the log, and add/remove backlog items as your audit reveals them. Commit this with your changes.

HARD RULES:
- Never fabricate anything: no invented metrics, awards, testimonials, client names, review counts, or case-study results. Only publish what is verifiable. If you cannot verify a claim, don't make it.
- Never remove existing schema, break a URL without a 301, or drop a canonical tag.
- Out of scope entirely: DNS records, email records (MX/SPF/DKIM/DMARC), environment variables, and anything needing credentials you don't have.
- If you find a bug or regression, fixing it takes priority over any new feature.
- REVENUE IS NOT OPTIONAL. Every pass must surface at least one concrete way to get more people finding and booking the studio or inquiring about our services — and either implement it or add it to the TOP of the backlog. Never end a pass having thought only about SEO.

Finally, report concisely: what you audited, what you changed and why, verification results, and — explicitly — the single best revenue/conversion opportunity you found (more studio bookings or more service inquiries) and what you did or recommend about it. If the audit finds nothing worth changing, say so plainly and make no commit — an honest no-op is better than busywork.
```

## Refresh Straw Hut homepage podcast stats

- Old id: `trig_01RDJTMS2g7KSHKb2mFsiKjU` — cron `0 14 1 */3 *` (UTC) 

```
You maintain the Straw Hut Media website. Repo: strawhutmedia/Project-management, app lives in strawhut-site/, working branch: claude/networks-open-302u9k. Your job this run: keep the homepage "state of podcasting" stat band accurate and current.

Steps:
1. In strawhut-site/src/views.js, find the section with class "stats-band". It has three ".stat" blocks, each with a ".stat-num" (attributes data-target and data-suffix), a ".stat-label", and a ".stat-source".
2. The three stats are: (a) number of Americans who listen to podcasts monthly; (b) % of weekly podcast listeners who have purchased something after hearing it advertised on a podcast; (c) % of active listeners who trust the ads they hear on podcasts.
3. Use web search to find the LATEST authoritative figures. Prefer: Edison Research "The Infinite Dial" (released each spring, ~March) for monthly listeners; Edison Research / Sounds Profitable / Nielsen for the ad-purchase and ad-trust figures. Only trust primary/official reports.
4. For each stat, if there is a NEWER, higher-confidence official figure than what is on the page, update its data-target, data-suffix if needed, the .stat-label wording if needed, and the .stat-source (report name + year). Keep every number honest and defensible — only change a number when you can cite a newer authoritative source. If a report has not been updated since the current value, leave that stat unchanged.
5. If nothing needs changing, make no edits and stop.
6. If you changed anything: run `node --check strawhut-site/src/views.js`, then commit with a clear message describing the number changes and sources, and push with `git push -u origin claude/networks-open-302u9k`. Do NOT open a pull request. Do NOT push to main.
7. Report exactly what you changed (old -> new, with source URLs) or that everything was already current.
```

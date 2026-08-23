# Straw Hut site — open work, handed off 2026-08-23

Read this at the start of a session that is picking up the subdomain redirects
or the GoHighLevel token. Delete the file once both are done.

**Needs from Ryan:** the **Railway** connector enabled for the session, and his
**GoDaddy API key + secret** pasted in when you ask (GoDaddy → Developer Portal
→ API Keys → the Production key). The previous session had the GoDaddy key but
containers are ephemeral, so it does not carry over. Ask for it; don't guess.

---

## Where things live

- **Repo:** `strawhutmedia/Project-management`, branch **`main`**, app root
  `strawhut-site/`. Push to `main` → Railway auto-builds and redeploys.
- **Railway service:** the one serving `www.strawhutmedia.com`. Its Railway
  domain is `gapfn8t9.up.railway.app`. (Not the SLATE service — that's a
  different app on `slate.strawhutmedia.com`.)
- **Health/diagnostics:** `https://www.strawhutmedia.com/healthz` reports the
  deployed commit, feature flags, GHL state, a GHL token probe, and which
  booking calendar is in use. Check it after every deploy.
- **Read `strawhut-site/CLAUDE.md` first.** It carries the mobile-first rule,
  the SEO checklist, and the gotchas below in more detail.
- **Mobile audit:** `node tools/mobile-audit.mjs --base https://www.strawhutmedia.com`
  (needs playwright symlinked into `node_modules` from `/tmp/pw/node_modules`).
  Renders every page at 390px and reports overflow, tiny text, small tap
  targets, and uncaught JS errors. Run it before calling any UI change done.

Last commit at handoff: `f28c3d4`.

---

## JOB 1 — Retire two subdomains onto the main site (the blocked one)

Two old GoDaddy-hosted pages are still live on the domain and competing with
the new site:

| Subdomain | Currently | Should 301 to |
|---|---|---|
| `start.strawhutmedia.com` | old GoDaddy "Start your podcast" page | `https://www.strawhutmedia.com/podcast-production` |
| `services.strawhutmedia.com` | old GoDaddy quote-tool page | `https://www.strawhutmedia.com/services` |

**The redirect code is already written, deployed, and verified.** See
`LEGACY_SUBDOMAINS` in `strawhut-site/src/server.js`. Confirmed by Host header
against a local server:

```
start.strawhutmedia.com     301 -> /podcast-production   (any path)
services.strawhutmedia.com  301 -> /services             (any path)
strawhutmedia.com           301 -> www, path preserved
slate.strawhutmedia.com     passes through untouched     <- leave this alone
```

It has never fired because both subdomains still A-record to GoDaddy and never
reach the app.

### Current DNS (GoDaddy, zone `strawhutmedia.com`)

```
A      services  -> 72.167.33.245   ttl=600     <- GoDaddy forwarding IP
A      start     -> 72.167.33.245   ttl=1800    <- GoDaddy forwarding IP
CNAME  www       -> gapfn8t9.up.railway.app     ttl=600
```

### Steps, in this order

1. **Railway (connector):** add `start.strawhutmedia.com` and
   `services.strawhutmedia.com` as custom domains on the service that serves
   `www.strawhutmedia.com`. Read back the CNAME target Railway assigns to each
   — it is usually a per-domain value, not the same as the `www` one.
2. **GoDaddy (REST API):** delete the two `A` records and create `CNAME`
   records pointing at the targets from step 1.
   - Auth header: `Authorization: sso-key {KEY}:{SECRET}`
   - Read: `GET https://api.godaddy.com/v1/domains/strawhutmedia.com/records`
   - Write: `PUT https://api.godaddy.com/v1/domains/strawhutmedia.com/records/CNAME/start`
     with body `[{"data":"<target>","ttl":600}]`
   - **The forwarding API is dead on this key** — every `/forwards` path
     returns `NOT_FOUND: There is no method to handle request`. Don't waste
     time on it. DNS records work fine.
3. **Wait for cert issuance** (Railway, usually a few minutes), then verify:
   ```
   curl -sSI https://start.strawhutmedia.com/    -> 301 -> /podcast-production
   curl -sSI https://services.strawhutmedia.com/ -> 301 -> /services
   curl -sSI https://strawhutmedia.com/          -> 301 -> www   (must still work)
   curl -sSI https://slate.strawhutmedia.com/    -> unchanged
   ```

**Order matters.** If DNS is flipped before Railway knows the hostnames, both
subdomains die with a TLS error — worse than today. Railway first.

**Do not touch** the `www` CNAME, the `MX` records (Google Workspace mail), or
any `TXT` record (SPF, Facebook/Google verification). Only the two `A` records
change.

---

## JOB 2 — The GHL token is the wrong kind, and it's breaking lead capture

`GHL_API_TOKEN` on the Railway service is an **agency/company-level** Private
Integration. It reads `GET /locations/{id}` fine and is refused on every
sub-account resource. Boot probe (`/healthz` → `ghlProbe`):

```
location            ok
contacts            401 The token is not authorized for this scope.
calendars           401 The token is not authorized for this scope.
calendarGroups      401 The token is not authorized for this scope.
users               401 Token's user type mismatch!     <- the tell
```

**Consequence: every website contact-form submission has failed to reach the
CRM.** No leads were lost — the notification email to Ryan goes via Resend and
is independent — but nothing has ever landed in GoHighLevel.

Adding scopes will NOT fix it. The token is the wrong *type*.

### Fix

Ryan (or you, if a GHL connector is ever available) creates a **new Private
Integration from inside the Straw Hut Media sub-account** — not the agency
dashboard — with all scopes, then that token replaces `GHL_API_TOKEN` on the
Railway service. **With the Railway connector you can set the env var
yourself** once Ryan pastes the token.

### Verify after swapping

`/healthz` should flip from
`LIMITED (Straw Hut Media) — contacts refused: ...` to `ok (Straw Hut Media)`,
and `booking.source` should change from `known` to `ghl (confirmed)`.

Then — and only then — prove the write path works. **Do NOT post a test
submission to the live contact form**; it emails Ryan and on 2026-08-23 a fake
"Jane Doe" lead had him drafting a reply to a person who doesn't exist. Verify
against a local server, or watch for the next real submission.

---

## JOB 3 — Carry ad attribution onto the GHL contact (not started)

Contact-form submissions reach GHL with name/email/company/message but no
source, so there's no way to tell which ad spend produced which lead. Capture
`gclid` / `gbraid` / `wbraid` and `utm_*` on first landing (cookie), post them
with the form, and attach them as GHL custom fields or tags.

Blocked behind JOB 2 — pointless until contacts actually reach the CRM.

Related and also worth doing: a Google Ads conversion event on the episode
landing pages. `shmTrack()` in `src/tracking.js` already fans events out to
dataLayer/gtag/fbq/ttq; the audiences themselves have to be defined in the
Google Ads and Meta UIs, not in the site.

---

## Gotchas that have already cost real time

- **Every inline `<script>` is a JS template literal.** `\/` collapses to `/`
  and `\b` to a backspace character. A regex written `/^(Europe|Atlantic\/...)/`
  shipped as an *unterminated* regex — a parse error that killed the whole
  script block, so Google Consent Mode and the cookie banner were dead on every
  page for weeks with no server-side symptom. Write `\\/` and `\\b`. The mobile
  audit's `js:` column catches this now.
- **GHL versions its API per resource family** and the values differ: Contacts
  `2021-07-28`, Calendars `2021-04-15` (docs also show `v3`). A wrong `Version`
  header returns the *same* "not authorized for this scope" message as a real
  permissions problem.
- **Don't put page HTML in `public/`.** An `express.static` mount silently
  wins over a route, and the page skips `layout()` and therefore every SEO
  guarantee. This is how an off-brand `/services` page shadowed the real site
  for months.
- **`pkill -f "src/server.js"` matches its own shell** and kills the script
  running it. Use a PID file.
- **Mobile first, and verify by rendering, not reasoning.** ~90% of visitors
  are on a phone.

---

## Standing rules

- Push app changes to **`main`** only — Railway deploys nothing else.
- **Slate never posts to any social platform.** The autopilot stops at
  `planned`; a human publishes.
- **Never post a deliverable submission to the live contact form.**
- No new external services without Ryan's explicit approval. Current stack:
  GitHub + Railway + Resend + Dropbox + Cloudflare Turnstile + GoHighLevel +
  QuickBooks.
- Booking is GoHighLevel only. The scheduler that used to run the package CTAs
  was cancelled on 2026-08-23 — do not reintroduce a second one.

---

## What just shipped (context for anything that looks new)

- All booking consolidated onto `/book` (GHL "Discovery Call" calendar,
  id `ym8vwJwU2MiL5RuW7v68`). Package picks and finished quotes stash a
  `shm_quote` payload and carry into `/book` and `/contact`.
- Fixed the dead tracking bootstrap described above.
- Replaced the static `/services` page with a real services hub —
  `servicesHubPage()` in `views.js`, `ItemList`+`FAQPage`+`BreadcrumbList`
  schema, in `sitemap.xml` and `llms.txt`, linked from the footer.
- `/healthz` gained `booking`, `ghlProbe`, and `ghlLastError`.

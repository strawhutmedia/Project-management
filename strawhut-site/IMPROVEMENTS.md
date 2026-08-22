# Site improvement log

A running record of the daily site-improvement pass. **Read this before starting
a new pass** so you build on prior work instead of repeating it. Append newest
entries at the top. Keep each entry to what changed and why it mattered.

## Ground rules for every pass

1. **Audit first, with evidence.** Measure the live site before changing it.
   Don't guess at problems.
2. **Never fabricate.** No invented metrics, awards, testimonials, client names,
   or case-study results. Everything published must be verifiable.
3. **Verify before pushing.** `node --check` every touched file and render the
   affected page(s) with mock data. A crash in production is worse than a
   missed improvement.
4. **Small and focused.** One or two real improvements per pass, not a rewrite.
5. **Never regress SEO.** Don't remove schema, change a URL without a 301, or
   drop a canonical.
6. **Out of scope:** DNS records, email records (MX/SPF/DKIM/DMARC), env vars,
   and anything requiring credentials.

## Parked — Rainbow Media app rebuild

`rainbowmedia.strawhutmedia.com` is a business-critical app used regularly, and
it is the only remaining reason the GoDaddy Windows VPS exists. Paused pending
information; **do not let that VPS lapse before this is resolved** (paid through
April 2029, so there is time).

What was established from the outside (login page + headers only):
- ASP.NET MVC 5.2 / .NET Framework 4 on IIS 10 — hence the *Windows* VPS.
- Bootstrap 5, jQuery, DataTables + Responsive, moment.js, blockUI.
- Login form posts to `/` with UserName / Password / RememberMe / ReturnUrl.
- The shared layout contains a "Are you sure you want to delete this record?"
  modal, so it is a CRUD records app.
- Purpose per the owner: Rainbow Media Co uploads/submits content to one of
  their clients; possibly produces an RSS feed.
- No public endpoints — /rss, /feed, /sitemap.xml, /robots.txt and friends all
  404. Everything is behind auth, so it cannot be reverse-engineered remotely.

Still needed before any rebuild:
1. Screenshots of every screen after login (dashboard, list, add/edit forms).
2. Whether it *generates* a feed or *pushes* files somewhere (FTP/host/email).
3. Who logs in, and how many accounts.
4. Volume of stored content, and whether the client has a saved feed URL that
   must keep resolving after a move (would need a redirect).

Rebuilding here is well-supported: admin auth, Postgres, RSS handling and AWS
S3 credentials all already exist in this app, and it would drop the Windows
dependency entirely.

## Backlog / ideas not yet built

- **Host & talent pages** (`Person` schema) — capture searches for individual
  hosts (e.g. "Phil Rosenthal podcast") and cross-link to their shows.
- **Case studies** — only with real, verifiable outcomes.
- **More resource guides** — each is a compounding organic + GEO asset.
- **Replace the `start.strawhutmedia.com` funnel** with a stronger on-site
  conversion page (subdomain now 301s to `/podcast-production`).
- Internal linking sweep: shows → service pages → guides.

---

## 2026-08-22

- **Price schema on `/pricing`.** The page listed three real packages but
  exposed no `Offer` data. Now emits `Service` + `AggregateOffer`
  ($2,450–$6,550, 3 offers) so search can show price-rich results and AI
  assistants answer "what does podcast production cost" with our real numbers.
- **Catalog schema on `/shows`.** Was a 67-char meta description and only
  `BreadcrumbList`. Now `CollectionPage` + `ItemList` over the whole catalog,
  plus a description that names the genres we cover.
- **Retired-subdomain 301s.** `start.*` → `/podcast-production`,
  `services.*` → `/pricing`, scoped to an explicit allowlist so no other
  subdomain (e.g. `slate.*`) can be swallowed.
- **RSS importer bug fixes** found by testing real third-party feeds: raised the
  XML entity-expansion ceiling (Simplecast-hosted feeds failed outright) while
  keeping the depth cap that guards against billion-laughs attacks; and
  de-duplicated `itunes:category` so cards no longer read
  "Education, Education, Education".
- **Audit baseline:** all pages 200, one `<h1>` each, JSON-LD present
  everywhere, **zero images missing alt text**, sitemap 5,449 URLs.
- **Anti-spam on the public forms.** A bot submission got through the contact
  form (random name, gibberish message) — neither `/contact` nor `/subscribe`
  had any protection. Added `src/antispam.js`: honeypot field, HMAC-signed
  render timestamp (proves we served the form and that ≥3s passed), and a
  per-IP rate limit. Deliberately no CAPTCHA and no new vendor — the checks are
  invisible, so conversion is untouched. Content heuristics only *flag* (subject
  line prefix), never block, so a real lead is never lost to a false positive.
- **Cloudflare Turnstile added** (approved by Ryan) as a fourth layer on the two
  public forms. Scoped tightly on request: it loads *only* on `/contact` and the
  homepage, and on the homepage it's lazy — the Cloudflare script isn't fetched
  until someone focuses the subscribe field, so the homepage pays nothing.
  Verified every other public page ships zero Turnstile code. A rejected token
  blocks; a *missing* one (ad blocker, Cloudflare outage) is only flagged, and
  if the challenge is still solving when someone hits submit the form holds and
  sends itself — no double click, no lost lead.
- **Fixed the ragged last row in the "The Network" cover wall on phones.** The
  wall is built as 8 covers → phone → 8 covers; at 3 columns each half of 8 left
  a short final row, which read as missing shows. Stacked breakpoints now wrap
  and centre instead of using a rigid grid (so any count degrades gracefully),
  and at ≤560px each half is trimmed to 6 so both are exact rows. Verified by
  rendering /shows headlessly at 360/390/430/560/600/768/900/1024/1280/1440px:
  complete rows at every stacked width, no horizontal scroll, desktop collage
  untouched. Also removed a stray `}` in styles.css.
- **Smoother scroll reveal.** The init loop interleaved a DOM write
  (`classList.add`) with a read (`getBoundingClientRect`) per element, forcing a
  layout recalculation on every one — the cause of the clunky first scroll.
  Measured all positions before touching any classes, and scoped `will-change`
  to elements still waiting (it was pinned on ~40 elements forever, one
  compositor layer each). Softened the motion too: 24px → 14px rise, 0.7s →
  0.55s, gentler easing, smaller stagger. Measured in headless Chromium over 5
  runs: forced layouts 46 → 33, layout time 51.8ms → 38.5ms, style recalcs
  48 → 33.
- **Cover wall widened 16 → 24 shows** (12 + phone + 12). Twelve divides evenly
  by both the 3-up and 4-up stacked layouts, so every row is full at every width
  and the nth-child trimming hack added earlier could be deleted outright.

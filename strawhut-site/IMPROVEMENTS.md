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

## Mobile-first pass (2026-08-22)

Audited every public page in headless Chromium at 390px. Findings 26 → 13,
and the 13 remaining are intentional (marquee strips, the miniature phone-player
UI, inline links inside body copy).

- **The homepage headline was being cut off on every phone.** `.hero-wave` is a
  flex row of 60 bars with a 3px minimum each — a 475px minimum width. As a grid
  item (default `min-width: auto`) it dragged the hero track past the screen
  edge, and `.hero { overflow: hidden }` clipped the h1, the intro copy and the
  second CTA rather than showing a scrollbar. That's also why the earlier
  "no horizontal scroll" check passed. Fixed with `min-width: 0` on hero
  children plus halving the bars below 560px.
- **Footer waveform** had the same fault at 90 bars / 715px — the right third
  was cut off. Halved on phones.
- **Touch targets**: footer links were 23px tall with a 9px gap; moved the gap
  inside the link so the target is 43px with the same visual rhythm. Same for
  the Instagram follow link, section counts, and breadcrumbs.
- **Nothing under 12px** on phones any more (was 9.9px in places).
- Added `tools/mobile-audit.mjs` so this is a repeatable check, not a one-off,
  and wrote the mobile-first rule into CLAUDE.md.
- **Cover wall trimmed on small screens.** 24 covers is right for the desktop
  collage but was eight rows of scrolling on a phone before the visitor reached
  the actual show list. Now two rows per breakpoint — 3+3 on a handset, 4+4 on a
  tablet, all 24 on desktop. "Original Shows" moved from 1800px down the page to
  1063px (2.1 phone screens of scrolling → 1.3); wall height 1408px → 670px.
  Counted with `nth-of-type` so only cover links are numbered: the wall also
  contains the phone mockup div and its script, and counting all children
  shifted every rule by one (caught by rendering, not by reading the CSS).
- **Featured banner rebuilt for phones, in the impact band's language.** It was
  collapsing to one column with a full-width 358x358 square cover — over half the
  screen, copy below the fold — and stopped reading as a banner at all. Ryan
  pointed at the angled full-bleed impact band as the reference. It's now the
  same treatment: full-bleed (100vw), the same angled `clip-path`, and a colour
  field that is a heavily blurred copy of the show's own cover — so **each
  featured show tints its own band**: blue for Naked Lunch, green/pink/gold for
  Wicked. No colour extraction and no new dependency; the blurred cover already
  carries the palette. Cover art still shown whole, never cropped.
  Band height 681px → ~510px. Description switched to white-at-alpha because
  `--muted` is tuned for the navy card and loses contrast over warm artwork.
  Verified edge-to-edge with no horizontal scroll at 320/360/390/430/560/700/760
  and correctly back to the inset card at 761px+. Desktop measured identical
  before/after (1178x382, 380x380 art, 22px radius, no clip) — untouched.
- **Featured band extended to desktop** (Ryan approved). Same full-bleed angled
  colour field at every width, tinted by a blurred copy of the show's own cover;
  content held to the 1180px `.container` measure with padding so the band
  bleeds but the copy doesn't stretch on a wide screen.
  - **Caught a bug the harness would have missed:** headless Chromium runs with
    `--hide-scrollbars`, so "no horizontal scroll" was passing without ever
    exercising the case. Re-launched with real scrollbars and the desktop band
    produced **8px of sideways scroll** at 1280px — `100vw` is wider than the
    content box whenever a classic (non-overlay) scrollbar is present. Guarded
    with `main { overflow-x: clip }` — `clip` rather than `hidden` because clip
    doesn't create a scroll container, so sticky positioning still works
    (verified: header stays at top: 0 after scrolling 2500px).
  - Overflow swept at 320/390/430/560/760/761/900/1024/1280/1440/1920px with
    classic scrollbars forced on: zero at every width.

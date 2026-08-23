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
- **No more truncation ellipses.** Two separate causes: `toText()` hard-sliced
  mid-word and appended `…`, and six CSS `-webkit-line-clamp` rules added their
  own. Both fixed:
  - `toText()` now cuts at the **last complete sentence** that fits, so what's
    shown is always a finished sentence someone wrote. No ellipsis, ever.
  - Removed the line-clamps on the featured copy, episode excerpts, press
    snippets, player titles and footer episode titles — text wraps in full
    instead of being cut with a `…`.
  - For the minority of shows whose description has no sentence break inside the
    space available, `generateShowBlurb()` (the same Anthropic path already
    writing meta descriptions) shortens **their own copy** into 1–2 complete
    sentences, stored in `shows.blurb` and backfilled in the background. The
    team's approved description is always preferred; the blurb is only used when
    trimming it would leave a fragment. Generated text is rejected unless it is
    under the limit and ends on a real sentence, so a bad generation can never
    ship something worse than the source.
  - Measured on all 30 real show descriptions: 22 fit as complete sentences from
    the team's own copy, the other 8 get a written blurb → 30/30 complete, 0
    ellipses added by us, 0 over the length budget.
  - Author-intended ellipses in source copy (e.g. Folklorica's "Introducing…
    Folklorica!") are left alone — deliberate style, not truncation.
- **Follow-up:** the AI blurb path alone wasn't enough — production still showed
  a fragment for String and Tell, because that show's stored `seo_description`
  is *itself* cut off ("…while racing to make friendship"), so the fallback
  chain correctly rejected it, and I can't confirm `ANTHROPIC_API_KEY` is set on
  the website service. Made a complete sentence **guaranteed without AI**:
  when nothing fits the budget, fall back to the show's own first sentence even
  if it runs slightly long (a complete sentence at 200 characters beats a
  fragment at 165). Also fixed a common feed artifact — a missing space after a
  full stop ("climate.From Straw Hut") hid the sentence boundary; now repaired,
  but only after a lowercase letter or digit so "U.S. Government" is untouched.
  Result across all 30 real descriptions: **30/30 complete sentences**, median
  123 characters, longest 232. The AI blurb remains as an upgrade that produces
  something shorter when the key is available.

## Episode pages as campaign landing pages (2026-08-23)

Ryan's spec: ads run in Podbooster, but for Straw Hut shows he wants the option
to send clicks to strawhutmedia.com — which means every episode page has to be
as strong a landing page as Podbooster's `/ep/` pages.

Read Podbooster's landing page (`routes/rss.js`) to see what actually makes it
convert: an AI hook line, key takeaways, guest names, pull-quotes from the
transcript, a real player, follow links, share, and artwork-derived theming.

Shipped on the Straw Hut episode page:

- **AI hook line** — one sentence on why the episode is worth an hour.
- **"In this episode"** — 3–4 concrete takeaways.
- **Guest card** — names pulled from the episode, empty when there are none.
- **Share** — native share sheet on a phone, copy-to-clipboard elsewhere.
- **Artwork theming** — a blurred copy of the cover tints the hero, same trick
  as the featured band, so each episode carries its own colour.
- Follow/subscribe links were already there via `platformRow()`.

Generation is **on demand**: the first view of an episode fires a background
enrichment call and caches it forever (mirroring Podbooster's precompute), so
cost follows real traffic instead of 5,370 upfront calls. The `/go/` ad landing
pages trigger it too, so paid traffic gets the enriched page immediately.

Pull-quotes need transcripts, which the feeds don't carry. Measured the options:
the full catalogue is ~5,000 hours ≈ $1,290 one-time at Deepgram's verified
$0.0043/min, plus ~$8/month to keep up (32 episodes/month). Ryan chose to
transcribe **only episodes we advertise** (~$0.25 each) and revisit the rest later.

Notes:
- `updateEpisode` listed its columns explicitly, so the new fields would have
  been silently dropped — the same trap as `artwork_url` and `blurb`. Fixed.
- First render put the tint image inside the container, so it painted over the
  copy and made the hero unreadable. Caught by screenshotting it, not by reading
  the CSS. Moved outside and deepened the scrim.
- `/healthz` now reports which optional features are configured (booleans only),
  because a backfill that silently no-ops is otherwise indistinguishable from one
  that ran. It confirmed `ai: true` on the website service.
- **Campaign landing page (`/go/…`) rebuilt to Podbooster's layout.** Ryan: "the
  Podbooster landing page layout is great." Read `routes/rss.js` and matched the
  skeleton exactly — one centred column: show name → large cover → title →
  duration → "Why listen" hook box → player (big play ring, skip 15s either
  side) → guests or transcript pull-quotes → divider → description → divider →
  "Enjoy the episode? / Subscribe to X" + platform links → share. Straw Hut
  brand, Podbooster structure.
  - Their page generates `ai_takeaways` but never renders them, so the landing
    page doesn't either; takeaways stay on the public episode page where they
    add indexable content.
  - Two old rules (`.lp-desc`, `.lp-subscribe`) drew their own top borders,
    which doubled up against the new explicit dividers into two stacked lines.
    Caught by screenshotting.

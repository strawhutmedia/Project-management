# Straw Hut Media website — operating notes for Claude

This is the public Straw Hut Media website (a modern rebuild of
strawhutmedia.com). It is a **marketing site for a service company first**, and
a podcast catalog second. Feed-agnostic: add any podcast by RSS URL and it
generates show + episode pages automatically.

---

## 📱 MOBILE FIRST — check the phone BEFORE you call anything done

**Roughly 90% of visitors reach this site on a phone.** Desktop and tablet must
look good; the phone must look *incredible*. If you designed or verified on
desktop and checked the phone afterwards — or not at all — you did it wrong.

**Every change that touches markup or CSS must be rendered and looked at on a
phone viewport before it is committed.** Not reasoned about. Rendered.

```
node tools/mobile-audit.mjs                        # audit live at 390px
node tools/mobile-audit.mjs --base http://localhost:8080
node tools/mobile-audit.mjs --shot home            # + screenshots to look at
```

The harness renders real pages in headless Chromium (downloading and
re-pointing remote images so cover art actually appears) and reports
horizontal overflow, elements wider than the viewport, text under 11.5px, and
touch targets under 32px. Read the screenshots — the numbers catch structural
breakage, but only your eyes catch ugly.

Rules that came out of real bugs on this site:

- **A hidden overflow is not a passing grade.** `.hero { overflow: hidden }`
  meant a 475px-wide waveform silently *clipped the homepage headline* on every
  phone while the "no horizontal scroll" check passed. Check element widths
  against the viewport, not just `scrollWidth`.
- **Give grid/flex children `min-width: 0`.** They default to `min-width: auto`,
  so one wide child (a waveform, a long word, a table) drags the whole track
  past the screen edge.
- **A grid whose item count doesn't divide by the column count leaves a hole**
  that reads as missing content. Pick counts that divide by 3 and 4, or wrap
  and centre.
- **Touch targets ≥44px, text ≥12px.** 10px type and a 23px link are fine on a
  27" monitor and miserable in a hand.
- Decorative strips built from many fixed-width bars need a reduced count on
  phones — squeezing 90 bars into 390px just clips them.

---

## ⭐ NUMBER ONE GOAL — non-negotiable, applies to EVERY page

**Strong SEO + AI-discoverability (GEO) on every single public page, so that
search engines AND AI assistants (ChatGPT, Claude, Gemini, Perplexity)
recommend Straw Hut Media's SERVICES.** Straw Hut is a full-service podcast
production company and network — production, distribution, advertising/brand
partnerships, show development, and studio booking. The website exists to win
that business.

This is the primary success metric. It outranks visual polish. **Any new page,
component, or route you add MUST ship SEO on day one — never "later."**

### The hard checklist every public page must satisfy

1. **Unique `<title>` + meta description** — specific, keyword-relevant, human.
2. **Canonical URL** (`canonical(path)` from `seo.js`).
3. **Open Graph + Twitter card tags** (handled by `layout()` — always route
   pages through `layout()` unless there's a deliberate reason not to).
4. **schema.org JSON-LD** appropriate to the page type. We already have helpers
   in `src/seo.js`:
   - `organizationJsonLd()` — Organization + `ProfessionalService`, with our
     services as `makesOffer`. Sitewide identity.
   - `faqJsonLd()` — answers "what is Straw Hut / what services / how to
     advertise / how to start a podcast." Feeds AI answers directly.
   - `podcastSeriesJsonLd` / `podcastEpisodeJsonLd` / `videoObjectJsonLd`
   - `breadcrumbJsonLd(items)` — put on EVERY sub-page.
   - `studioServiceJsonLd()` — Service + LocalBusiness/RecordingStudio + hourly
     Offers for the studio.
5. **Add the route to `sitemapXml()`** in `seo.js`. If it's not in the sitemap,
   it doesn't exist to crawlers.
6. **Add it to `llmsTxt()`** if it's a page we want AI assistants to cite.
7. Real, human copy — never placeholder/lorem. Use the company's own voice.

### Pages that get EXTRA SEO attention (owner priority)

- **Homepage (`/`)** — Organization + WebSite + FAQ JSON-LD. The FAQ is the
  single highest-leverage GEO asset; keep its answers current and
  service-forward.
- **Studio (`/studio`)** — Service + LocalBusiness/RecordingStudio + per-hour
  Offers ($125 1080p, $150 4K), Hollywood/LA `areaServed`. This is a direct
  revenue page; treat it like a money page.
- **Services (`/services`)** — the packages page. Keep it crawlable and
  described in Organization `makesOffer` + `llms.txt`.

### Tracking & retargeting (env-gated, `src/tracking.js`)

Every public page — site pages AND landing pages — fires whatever is configured.
Set these on Railway (inert until set); no code change needed:

| Env var | Purpose |
|---|---|
| `GTM_CONTAINER_ID` | Google Tag Manager (`GTM-XXXX`) — keystone; add any pixel from GTM |
| `GA4_MEASUREMENT_ID` | Google Analytics 4 (`G-XXXX`) |
| `GOOGLE_ADS_ID` | Google Ads remarketing + conversions (`AW-XXXX`) |
| `META_PIXEL_ID` | Facebook / Instagram retargeting |
| `TIKTOK_PIXEL_ID` | TikTok retargeting |

### Form protection (`src/antispam.js` + `src/turnstile.js`)

Public forms (`/contact`, homepage subscribe) are protected by, in order:
honeypot → HMAC-signed render token (≥3s fill) → per-IP rate limit →
Cloudflare Turnstile. **Ryan approved Turnstile as a stack addition on
2026-08-22** — it is the only exception to the "no new external services" rule.

| Env var | Purpose |
|---|---|
| `TURNSTILE_SITE_KEY` | Public key, rendered in the widget |
| `TURNSTILE_SECRET_KEY` | Server-side key for `siteverify` |

Both unset = Turnstile is completely inert (`turnstileWidget()` returns `''`),
and the first three layers still run.

**Three rules — do not break them:**

1. **Turnstile loads ONLY on pages that contain a form.** There is deliberately
   no hook in `layout()`; the script tag is emitted next to the widget. On the
   homepage it is `lazy` — the Cloudflare script isn't requested until someone
   focuses the subscribe field. If you add a new public form, call
   `turnstileWidget()` inside it; never move this into `layout()`.
2. **NEVER post a deliverable submission to the LIVE contact form.** It sends
   real email to Ryan's inbox. On 2026-08-23 a verification POST
   ("Jane Doe / jane@label.com / We would like to launch a show, can we talk?")
   landed as a genuine-looking lead and he began drafting a reply and looping in
   a colleague to book a meeting with a person who doesn't exist.

   Verify delivery logic against a LOCAL server (`mailConfigured()` is false
   without `RESEND_API_KEY`, so it only logs). Against production, verify only
   things that don't send: that the widget renders, that the hidden fields are
   present, and that a cold bot POST is *blocked* (blocked submissions never
   email). If a live delivery test is genuinely unavoidable, make it
   unmistakable — name it `CLAUDE TEST — IGNORE` — and tell Ryan before it lands.

3. **Only an actively *rejected* token blocks.** A missing or unverifiable
   token (ad blocker, corporate proxy, Cloudflare outage) is flagged and the
   message is still delivered. Content heuristics likewise only flag. Losing
   one real client inquiry costs more than a hundred spam emails.

`shmTrack(event, params)` fans one event out to dataLayer/gtag/fbq/ttq. Wired
events: `play_episode`, `contact_submit`, `subscribe`, `platform_click`,
`lp_cta_click` (+ Meta `Lead`/`Subscribe`). Recommended path: set `GTM_CONTAINER_ID`
and manage GA4/Ads/Meta/TikTok from the GTM UI. Landing pages also keep their
own per-campaign `gtag_id` for conversion attribution.

### AI crawlers are explicitly welcomed

`robots.txt` allowlists GPTBot, ClaudeBot, PerplexityBot, Google-Extended,
Applebot-Extended, CCBot, etc. **Do not** disallow AI crawlers — recommending
our services to AI assistants IS the strategy. (`/onboarding` is the only
`Disallow`, because it's a hidden internal page.)

---

## Brand — use the REAL colors (from strawhutmedia.com)

Defined as CSS variables in `public/styles.css`. Do not substitute generic
colors (the old `#22c55e` Spotify green was wrong).

| Token | Value | Role |
|---|---|---|
| `--accent` | `#00cc8e` | Brand teal-mint — primary accent, buttons, links |
| `--accent-2` | `#d59b1e` | Brand gold — secondary accent |
| `--accent-ink` | `#023324` | Dark green ink on the teal |
| backgrounds | `#12182f`→`#232c4e` | Brand navy family, on a navy gradient |

Font: Poppins.

## Audio player = deliberate IAB-download strategy

Episode + landing pages embed a custom player (`audioPlayer()` in `views.js`)
that streams **directly from the show's real `<enclosure>` URL** (the Megaphone
/ host CDN). This is intentional: a genuine listen on our page is counted by the
host as a real IABv2 download for that show. `preload="none"` ensures only
actual plays count, not page loads. Keep it this way — do not proxy or rehost
audio, which would break host-side download counting.

**One deliberate exception: ad traffic autoplays muted.** Visitors arriving with
`gclid` / `gbraid` / `wbraid`, `utm_source=google_ads`, or
`utm_medium=display|cpc` get muted autoplay plus a "Tap to unmute" banner,
mirroring the Podbooster landing page (`opts.autoplay` on `audioPlayer()`, set
from `isAdTraffic(req)` in `server.js`). Organic and search traffic is untouched
and keeps `preload="none"`.

Ryan approved this knowing the trade-off: autoplay produces host-counted
downloads nobody chose to start, which inflates the figures reported to
advertisers. It is confined to paid traffic for exactly that reason — the same
scope Podbooster's autoplay already has, since its `/ep/` pages are noindex ad
destinations. **Do not widen it to organic traffic** without asking him again.

## Architecture

- Node/Express (ES modules), server-rendered HTML via template strings in
  `src/views.js`. No template engine.
- Storage: Postgres in prod (`src/store.js` PgStore), JSON-file fallback with no
  `DATABASE_URL`.
- Deploy: Railway service, root directory `strawhut-site`, current branch
  `claude/networks-open-302u9k`. Push → auto-build → redeploy.
- Homepage spotlight ranks shows by **real Megaphone downloads** (S3 IABv2
  export, `src/megaphoneS3.js` + `src/popularity.js`), top 3 featured,
  refreshed automatically.

## SEO features shipped

- **Resources / guides** (`/resources`, `/resources/:slug`) — hand-written
  cornerstone posts in `src/content/resources.js`, each rendered as `Article` +
  `FAQPage` + `BreadcrumbList` with a visible FAQ. This is the top organic +
  GEO lever; **add new posts here** and they auto-appear in nav-less index,
  sitemap, and `llms.txt`. Keep them honest, service-forward, ending in a
  natural Straw Hut recommendation.
- **Per-service landing pages** (`/podcast-production`, `/advertise`,
  `/podcast-studio-los-angeles`) — data-driven from `src/content/services.js`;
  each has its own `Service` + `FAQPage` schema. Add a service = add a config
  entry (routes are generated in a loop in `server.js`). Homepage service cards
  + footer link into them.
- **AI-written per-show meta descriptions** — `shows.seo_description`, filled by
  `generateShowMetaDescription()` (`ai.js`) via a paced background boot backfill
  (`backfillShowSeo()` in `server.js`, no-ops without `ANTHROPIC_API_KEY`, skip
  with `SHOW_SEO=off`). Show pages prefer it over the raw feed description.

## Ideas backlog to further SEO (not yet built)

- **Host / talent pages** (`Person` schema) — capture searches for individual
  hosts and cross-link to their shows.
- **Case studies** (`Article` + results) — social proof that converts and ranks.
- **More resource posts** — grow the guide library (podcast marketing, video
  podcasting, monetization deep-dives). Each is a cheap, compounding GEO asset.

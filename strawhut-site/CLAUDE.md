# Straw Hut Media website — operating notes for Claude

This is the public Straw Hut Media website (a modern rebuild of
strawhutmedia.com). It is a **marketing site for a service company first**, and
a podcast catalog second. Feed-agnostic: add any podcast by RSS URL and it
generates show + episode pages automatically.

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

**Two rules — do not break them:**

1. **Turnstile loads ONLY on pages that contain a form.** There is deliberately
   no hook in `layout()`; the script tag is emitted next to the widget. On the
   homepage it is `lazy` — the Cloudflare script isn't requested until someone
   focuses the subscribe field. If you add a new public form, call
   `turnstileWidget()` inside it; never move this into `layout()`.
2. **Only an actively *rejected* token blocks.** A missing or unverifiable
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

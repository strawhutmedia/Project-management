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

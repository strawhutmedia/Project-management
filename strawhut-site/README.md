# Straw Hut Media — public site + admin (rebuild)

A modern rebuild of the strawhutmedia.com public podcast site and its admin,
replacing the legacy ASP.NET app on the GoDaddy VPS. Same spirit as the old
site — **add a show, and its pages generate and stay in sync automatically** —
but feed-agnostic, better looking, and built for SEO + AI discoverability.

> This lives in `strawhut-site/` and is completely separate from Slate (the
> project tracker in the repo root). It has its own `package.json` and deploy.

## How it works

- A **show is just a podcast RSS feed** plus display settings.
- Add any standard podcast feed (Megaphone, Apple, Spotify, Libsyn, Buzzsprout,
  Anchor, Acast…). The app pulls the artwork, description, and every episode.
- Each episode gets its own page automatically. A **background scheduler**
  re-checks every feed on an interval, so newly published episodes appear as
  new pages on their own — no manual work.
- Playback uses the episode's `enclosure` audio URL, so it works for **any**
  host, not just Megaphone.

## Features

- Public: home (Featured / Original / Partner shows + services), all-shows,
  show pages (paginated episode lists), episode pages (audio player + notes).
- Admin (`/admin`, password-protected): dashboard counts, add show by feed URL,
  Original vs Partner classification, feature toggle, per-show + all-feeds sync,
  delete.
- **SEO on every page** (enforced centrally in `layout()`): unique titles +
  meta descriptions, canonical URLs, Open Graph / Twitter cards, semantic HTML,
  and schema.org JSON-LD (`Organization` + `ProfessionalService`, `WebSite`,
  `FAQPage`, `PodcastSeries`, `PodcastEpisode`, `BreadcrumbList`).
- **GEO / AI discoverability**: `/robots.txt` explicitly welcomes AI crawlers
  (GPTBot, ClaudeBot, Google-Extended, PerplexityBot, …), a `/sitemap.xml` of
  every show + episode, and an `/llms.txt` summary of the company + services so
  assistants like ChatGPT, Gemini, and Claude can read and recommend the
  services accurately.

## Run locally

```bash
cd strawhut-site
npm install
ADMIN_PASSWORD=yourpassword npm start   # http://localhost:8080
```

With no `DATABASE_URL`, data is stored in a local JSON file under `data/`
(zero setup). Set `DATABASE_URL` to use Postgres in production.

## Import all existing shows

```bash
node scripts/import-from-site.mjs   # crawls strawhutmedia.com, imports every feed
```

## Environment variables

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection. If unset, uses a local JSON file. |
| `ADMIN_PASSWORD` | Password for `/admin`. |
| `SYNC_INTERVAL_MINUTES` | Feed re-check interval (default 30). |
| `APP_BASE_URL` | Public base URL for canonical links / sitemap. |
| `PORT` | Injected by Railway (default 8080). |

## Deploy (Railway)

Same pattern as Slate: point a new Railway service at this folder, add a
Postgres plugin, set `DATABASE_URL` / `ADMIN_PASSWORD` / `APP_BASE_URL`, and
`npm install && npm start`. Then run the importer once and set the DNS for
`www.strawhutmedia.com` when you're ready to cut over.

## Roadmap (from the legacy admin)

- Upcoming Shows, Hosts, Announcements (email blasts via Resend), Press
  (release/mention aggregation), Landing Pages (isolated ad-traffic pages),
  Packages (surfaced on services.strawhutmedia.com), Members.

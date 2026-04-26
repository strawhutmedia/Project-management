# Slate

Straw Hut Media's project tracker for albums, podcast seasons, and films.

> First active project: **Maggie Glass — Record** (13 songs · 14 tracks)

## Status

- **Phase 1 (current)** — UI-only preview deployed to GitHub Pages with seed data.
  No login or database yet. All 14 songs default to the **Writing** stage; statuses
  and tasks will be filled in as we go.
- **Phase 2** — Magic-link auth via Resend, Postgres on Supabase, real-time
  updates, comments, @mentions, due-date reminders.
- **Phase 3** — Custom domain `slate.strawhutmedia.com`.

## Stack

- Vite + React + TypeScript
- Tailwind CSS (custom stage palette)
- React Router

Backend (added in Phase 2):

- Supabase (Postgres, magic-link auth)
- Resend (transactional email)
- Cloudflare Worker (auth endpoint + cron for due-date reminders)

## Pipeline stages

Writing → Tracking → Overdubs → Producing → Stems → Mixing → Mastering → Done

Each stage gets its own color throughout the app so the dashboard reads at a glance.

## Local dev

```bash
npm install
npm run dev
```

## Deploy

Pushes to `main` or `claude/music-project-tracker-1Hp5G` trigger
`.github/workflows/deploy.yml`, which builds the SPA and publishes to GitHub
Pages. Make sure **Settings → Pages → Source** is set to **GitHub Actions**.

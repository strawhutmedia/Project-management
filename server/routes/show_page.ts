// Public per-show one-sheet page. Serves elegant HTML at /shows/<slug>
// — no auth, no CDN dependencies, no PDF. Every guest outreach email
// links here so the recipient sees the show's pitch inline in their
// browser, updated the moment Slate is.
//
//   GET /shows/:slug  → 200 HTML | 404 if unpublished / not a podcast
//
// Only podcast projects with `one_sheet_published = TRUE` are exposed.
// That way in-progress shows and every film/music project stay off the
// public internet.

import { Router, type Request, type Response } from 'express'
import { pool } from '../db'

export const showPageRouter = Router()

type ShowRow = {
  id: string
  name: string
  subtitle: string | null
  hero_tagline: string | null
  guest_pitch: string | null
  contact_email: string | null
  brand_hex: string | null
}

type BriefRow = {
  business_description: string | null
  niche: string | null
  target_audience: string | null
  current_metrics: string | null
}

type EpisodeRow = {
  title: string
  subtitle: string | null
}

showPageRouter.get('/shows/:slug', async (req: Request, res: Response) => {
  const slug = String(req.params.slug || '').trim().toLowerCase()
  if (!slug || !/^[a-z0-9-]{1,120}$/.test(slug)) {
    res.status(404).type('text/html').send(notFoundHtml())
    return
  }
  const showRes = await pool.query<ShowRow>(
    `SELECT id, name, subtitle, hero_tagline, guest_pitch, contact_email, brand_hex
       FROM projects
      WHERE slug = $1 AND kind = 'podcast' AND one_sheet_published = TRUE
      LIMIT 1`,
    [slug],
  )
  const show = showRes.rows[0]
  if (!show) {
    res.status(404).type('text/html').send(notFoundHtml())
    return
  }
  const [briefRes, epRes] = await Promise.all([
    pool.query<BriefRow>(
      `SELECT business_description, niche, target_audience, current_metrics
         FROM social_strategy_briefs WHERE project_id = $1`,
      [show.id],
    ),
    pool.query<EpisodeRow>(
      `SELECT title, subtitle FROM songs
        WHERE project_id = $1
        ORDER BY position DESC NULLS LAST, created_at DESC
        LIMIT 8`,
      [show.id],
    ),
  ])
  const brief = briefRes.rows[0] ?? null
  const episodes = epRes.rows
  res
    .status(200)
    .type('text/html')
    // The page is idempotent for a slug (edits redeploy new HTML on
    // next request), so let CDNs/proxies cache it briefly to absorb
    // outreach-blast link clicks without hammering the DB.
    .setHeader('Cache-Control', 'public, max-age=300, must-revalidate')
    .send(renderShowPage({ show, brief, episodes }))
})

function renderShowPage(args: {
  show: ShowRow
  brief: BriefRow | null
  episodes: EpisodeRow[]
}): string {
  const { show, brief, episodes } = args
  // Brand accent — validate the hex or fall back to Straw Hut's default.
  // Untrusted input from the DB, so we don't inject it raw.
  const accent = /^#[0-9a-fA-F]{6}$/.test(show.brand_hex ?? '')
    ? show.brand_hex!
    : '#f59e0b'
  const tagline = show.hero_tagline || show.subtitle || ''
  const about = brief?.business_description ?? ''
  const audience = brief?.target_audience ?? ''
  const metrics = brief?.current_metrics ?? ''
  const guestPitch =
    show.guest_pitch ||
    'We record remotely, run about 45 minutes, and edit for a polished final cut. ' +
    'Guests get the audio to promote wherever they like.'
  const mailto = show.contact_email
    ? `mailto:${encodeURIComponent(show.contact_email)}?subject=${encodeURIComponent(`Guest pitch — ${show.name}`)}`
    : null

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(show.name)} — Guest one-sheet</title>
<meta name="description" content="${escHtml(tagline || show.name)}">
<meta property="og:title" content="${escHtml(show.name)}">
<meta property="og:description" content="${escHtml(tagline || about.slice(0, 200))}">
<meta property="og:type" content="website">
<style>
  :root { --accent: ${accent}; --ink: #0b0f14; --panel: #12181f; --line: #232b34; --text: #e6edf3; --muted: #94a3b8; }
  * { box-sizing: border-box }
  body { margin: 0; background: var(--ink); color: var(--text); font: 16px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  main { max-width: 780px; margin: 0 auto; padding: 40px 24px 96px }
  .hero { padding: 64px 0 40px; border-bottom: 1px solid var(--line) }
  .brand { display: inline-block; font: 700 11px/1 -apple-system, sans-serif; letter-spacing: .28em; text-transform: uppercase; color: var(--muted); }
  h1 { font: 800 44px/1.1 -apple-system, sans-serif; letter-spacing: -.02em; margin: 16px 0 12px; }
  .tagline { font: 500 20px/1.4 -apple-system, sans-serif; color: var(--muted); margin: 0 0 32px; max-width: 620px; }
  .cta { display: inline-flex; align-items: center; gap: 8px; background: var(--accent); color: #0b0f14; font-weight: 700; padding: 14px 22px; border-radius: 999px; text-decoration: none; font-size: 15px; letter-spacing: .01em; transition: transform .12s ease; }
  .cta:hover { transform: translateY(-1px) }
  section { padding: 40px 0; border-bottom: 1px solid var(--line) }
  section:last-child { border-bottom: 0 }
  h2 { font: 700 12px/1 -apple-system, sans-serif; letter-spacing: .28em; text-transform: uppercase; color: var(--muted); margin: 0 0 20px }
  p { margin: 0 0 14px }
  .lead { font-size: 18px; line-height: 1.6 }
  ul.episodes { list-style: none; padding: 0; margin: 0 }
  ul.episodes li { padding: 14px 0; border-bottom: 1px solid var(--line) }
  ul.episodes li:last-child { border-bottom: 0 }
  ul.episodes .title { font-weight: 600; color: var(--text) }
  ul.episodes .sub { color: var(--muted); font-size: 14px; margin-top: 2px }
  .stats { display: grid; grid-template-columns: 1fr; gap: 16px; margin-top: 8px }
  .stat { padding: 16px 20px; background: var(--panel); border: 1px solid var(--line); border-radius: 12px }
  .stat .label { font: 700 10px/1 -apple-system, sans-serif; letter-spacing: .24em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px }
  footer { margin-top: 48px; padding-top: 24px; border-top: 1px solid var(--line); color: var(--muted); font-size: 13px }
  footer a { color: var(--muted); text-decoration: none; border-bottom: 1px dotted var(--muted) }
  @media (max-width: 600px) { h1 { font-size: 34px } .tagline { font-size: 17px } main { padding: 24px 18px 72px } .hero { padding: 32px 0 24px } }
</style>
</head>
<body>
<main>
  <section class="hero">
    <span class="brand">Straw Hut Media · Guest pitch</span>
    <h1>${escHtml(show.name)}</h1>
    ${tagline ? `<p class="tagline">${escHtml(tagline)}</p>` : ''}
    ${mailto ? `<a class="cta" href="${mailto}">Pitch us as a guest →</a>` : ''}
  </section>

  ${about ? `<section>
    <h2>About the show</h2>
    <p class="lead">${escHtml(about)}</p>
  </section>` : ''}

  ${(audience || metrics) ? `<section>
    <h2>Who listens</h2>
    <div class="stats">
      ${audience ? `<div class="stat"><div class="label">Audience</div><div>${escHtml(audience)}</div></div>` : ''}
      ${metrics ? `<div class="stat"><div class="label">Reach</div><div>${escHtml(metrics)}</div></div>` : ''}
    </div>
  </section>` : ''}

  ${episodes.length > 0 ? `<section>
    <h2>Recent episodes</h2>
    <ul class="episodes">
      ${episodes.map((e) => `<li>
        <div class="title">${escHtml(e.title)}</div>
        ${e.subtitle ? `<div class="sub">${escHtml(e.subtitle)}</div>` : ''}
      </li>`).join('')}
    </ul>
  </section>` : ''}

  <section>
    <h2>What guesting is like</h2>
    <p>${escHtml(guestPitch)}</p>
    ${mailto ? `<p><a class="cta" href="${mailto}">Pitch us as a guest →</a></p>` : ''}
  </section>

  <footer>
    Produced by <a href="https://strawhutmedia.com">Straw Hut Media</a>.
  </footer>
</main>
</body>
</html>`
}

function notFoundHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Not found</title>
<style>body{margin:0;background:#0b0f14;color:#e6edf3;font:16px/1.5 -apple-system,sans-serif;display:grid;place-items:center;min-height:100vh}main{text-align:center;padding:24px}a{color:#f59e0b}</style>
</head><body><main>
<h1>Show not found</h1>
<p>This show doesn't have a public page yet.</p>
<p><a href="https://strawhutmedia.com">Straw Hut Media →</a></p>
</main></body></html>`
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

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
  cover_art_url: string | null
  notable_guests: string | null
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
    `SELECT id, name, subtitle, hero_tagline, guest_pitch, contact_email, brand_hex,
            cover_art_url, notable_guests
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
  const guests = (show.notable_guests ?? '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12)
  const guestPitch = show.guest_pitch || 'Guests get the finished audio + a highlight clip package to share wherever they like.'
  const mailto = show.contact_email
    ? `mailto:${encodeURIComponent(show.contact_email)}?subject=${encodeURIComponent(`Guest pitch — ${show.name}`)}`
    : null
  // Cover art — validated as a URL. If missing or looks suspect,
  // fall back to a monogram tile so the hero never breaks.
  const coverUrl = typeof show.cover_art_url === 'string' && /^https?:\/\//.test(show.cover_art_url)
    ? show.cover_art_url
    : null
  const monogram = show.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?'

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(show.name)} — Guest one-sheet</title>
<meta name="description" content="${escHtml(tagline || show.name)}">
<meta property="og:title" content="${escHtml(show.name)}">
<meta property="og:description" content="${escHtml(tagline || about.slice(0, 200))}">
${coverUrl ? `<meta property="og:image" content="${escHtml(coverUrl)}">` : ''}
<meta property="og:type" content="website">
<style>
  :root { --accent: ${accent}; --ink: #08090c; --panel: #12141a; --line: #1e2129; --text: #f4f6fa; --muted: #8a94a6; }
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body { background: var(--ink); color: var(--text); font: 16px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
  a { color: inherit }
  main { max-width: 860px; margin: 0 auto; padding: 0 24px 96px }

  /* Ambient brand-color glow behind the hero. Subtle. */
  .glow { position: absolute; top: -280px; left: 50%; transform: translateX(-50%); width: 900px; height: 600px; background: radial-gradient(closest-side, ${accent}22, transparent 70%); z-index: -1; pointer-events: none; }
  header.top { max-width: 860px; margin: 0 auto; padding: 32px 24px 0; display: flex; align-items: center; gap: 14px; }
  header.top .mark { font: 700 10px/1 -apple-system, sans-serif; letter-spacing: .32em; text-transform: uppercase; color: var(--muted); }
  header.top .dot { width: 5px; height: 5px; background: var(--accent); border-radius: 50% }

  /* Hero — cover art tile + name + tagline + CTA */
  .hero { padding: 64px 0 56px; text-align: center; position: relative; }
  .cover { width: 200px; height: 200px; margin: 0 auto 32px; border-radius: 28px; overflow: hidden; box-shadow: 0 30px 80px -20px ${accent}55, 0 20px 40px -10px #000; position: relative; }
  .cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cover.monogram { display: grid; place-items: center; font: 800 88px/1 -apple-system, sans-serif; color: #08090c; background: linear-gradient(135deg, ${accent}, ${accent}88); letter-spacing: -.04em; }

  h1 { font: 800 clamp(38px, 6vw, 56px)/1.05 -apple-system, sans-serif; letter-spacing: -.03em; margin-bottom: 18px; background: linear-gradient(180deg, #fff, #d0d5e0); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .tagline { font: 500 clamp(17px, 2.2vw, 21px)/1.5 -apple-system, sans-serif; color: var(--muted); max-width: 640px; margin: 0 auto 40px; }
  .cta { display: inline-flex; align-items: center; gap: 10px; background: var(--accent); color: #08090c; font-weight: 700; padding: 15px 26px; border-radius: 999px; text-decoration: none; font-size: 15px; letter-spacing: .01em; transition: transform .12s ease, box-shadow .2s ease; box-shadow: 0 10px 30px -8px ${accent}88; }
  .cta:hover { transform: translateY(-2px); box-shadow: 0 14px 34px -6px ${accent}aa; }

  section { padding: 56px 0; border-top: 1px solid var(--line); }
  h2 { font: 700 11px/1 -apple-system, sans-serif; letter-spacing: .3em; text-transform: uppercase; color: var(--muted); margin: 0 0 22px }
  .lead { font-size: 18px; line-height: 1.65; color: var(--text); max-width: 680px; }

  /* Stats grid */
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
  .stat { padding: 22px 22px; background: var(--panel); border: 1px solid var(--line); border-radius: 16px; }
  .stat .label { font: 700 10px/1 -apple-system, sans-serif; letter-spacing: .26em; text-transform: uppercase; color: ${accent}; margin-bottom: 10px }
  .stat .value { font-size: 15px; line-height: 1.55; color: var(--text) }

  /* Notable guests — social proof */
  .guest-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px }
  .guest-tag { padding: 12px 16px; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; font-weight: 600; font-size: 14px; text-align: center; }

  /* Episodes list */
  ul.episodes { list-style: none; display: grid; gap: 2px; }
  ul.episodes li { padding: 18px 22px; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; }
  ul.episodes .title { font-weight: 600; font-size: 15px; }
  ul.episodes .sub { color: var(--muted); font-size: 13px; margin-top: 4px }

  .closing { text-align: center; padding: 72px 0 32px }
  .closing p { font-size: 17px; color: var(--text); max-width: 620px; margin: 0 auto 28px; line-height: 1.6; }

  footer { padding: 40px 0 0; border-top: 1px solid var(--line); text-align: center; color: var(--muted); font-size: 13px }
  footer a { border-bottom: 1px dotted var(--muted); text-decoration: none }

  @media (max-width: 600px) {
    .cover { width: 160px; height: 160px; border-radius: 24px; }
    .cover.monogram { font-size: 68px; }
    main { padding: 0 18px 72px }
    .hero { padding: 40px 0 40px }
    section { padding: 40px 0 }
  }
</style>
</head>
<body>
<div class="glow"></div>
<header class="top">
  <span class="dot"></span>
  <span class="mark">Straw Hut Media · Guest pitch</span>
</header>
<main>
  <section class="hero">
    ${coverUrl
      ? `<div class="cover"><img src="${escHtml(coverUrl)}" alt="${escHtml(show.name)} cover art"></div>`
      : `<div class="cover monogram">${escHtml(monogram)}</div>`}
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
      ${metrics ? `<div class="stat"><div class="label">Reach</div><div class="value">${escHtml(metrics)}</div></div>` : ''}
      ${audience ? `<div class="stat"><div class="label">Audience</div><div class="value">${escHtml(audience)}</div></div>` : ''}
    </div>
  </section>` : ''}

  ${guests.length > 0 ? `<section>
    <h2>Recent notable guests</h2>
    <div class="guest-grid">
      ${guests.map((g) => `<div class="guest-tag">${escHtml(g)}</div>`).join('')}
    </div>
  </section>` : ''}

  ${episodes.length > 0 ? `<section>
    <h2>Latest episodes</h2>
    <ul class="episodes">
      ${episodes.map((e) => `<li>
        <div class="title">${escHtml(e.title)}</div>
        ${e.subtitle ? `<div class="sub">${escHtml(e.subtitle)}</div>` : ''}
      </li>`).join('')}
    </ul>
  </section>` : ''}

  <div class="closing">
    <p>${escHtml(guestPitch)}</p>
    ${mailto ? `<a class="cta" href="${mailto}">Pitch us as a guest →</a>` : ''}
  </div>

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

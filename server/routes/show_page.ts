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
  notable_topics: string | null
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
            cover_art_url, notable_guests, notable_topics
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
  const topics = (show.notable_topics ?? '')
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
  :root {
    --accent: ${accent};
    --paper: #fdfcf7;
    --card: #ffffff;
    --ink: #14161d;
    --muted: #6b6f7a;
    --line: #e8e4dc;
    --line-strong: #ccc7b8;
  }
  * { box-sizing: border-box; margin: 0; padding: 0 }
  html { background: var(--paper) }
  body {
    background: var(--paper); color: var(--ink);
    font: 17px/1.58 'Charter', 'Georgia', 'Times New Roman', serif;
    -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
    min-height: 100vh;
  }
  .sans { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; }
  a { color: inherit }

  /* Editorial masthead bar */
  header.top {
    max-width: 900px; margin: 0 auto; padding: 28px 28px 0;
    display: flex; align-items: center; justify-content: space-between; gap: 20px;
    border-bottom: 1px solid var(--line); padding-bottom: 20px;
  }
  header.top .mark {
    font: 700 10px/1 -apple-system, sans-serif;
    letter-spacing: .32em; text-transform: uppercase; color: var(--muted);
  }
  header.top .dot { display: inline-block; width: 6px; height: 6px; background: var(--accent); border-radius: 50%; margin-right: 10px; vertical-align: middle }

  main { max-width: 900px; margin: 0 auto; padding: 0 28px 96px }

  /* Hero */
  .hero { padding: 56px 0 48px; display: grid; grid-template-columns: minmax(180px, 220px) 1fr; gap: 40px; align-items: center; }
  .cover {
    width: 100%; aspect-ratio: 1; border-radius: 18px; overflow: hidden;
    box-shadow: 0 24px 60px -20px rgba(20, 22, 29, 0.25), 0 8px 20px -6px rgba(20, 22, 29, 0.12);
    background: #f0ede4;
  }
  .cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cover.monogram {
    display: grid; place-items: center;
    font: 800 88px/1 -apple-system, sans-serif;
    color: #fff; background: linear-gradient(135deg, ${accent}, ${accent}bb);
    letter-spacing: -.04em;
  }

  h1 {
    font: 800 clamp(38px, 5.5vw, 64px)/1.02 'Charter', 'Georgia', serif;
    letter-spacing: -.02em; margin-bottom: 16px; color: var(--ink);
  }
  .tagline {
    font: 400 clamp(18px, 2vw, 22px)/1.45 'Charter', 'Georgia', serif;
    color: var(--muted); max-width: 620px; margin: 0 0 28px;
    font-style: italic;
  }
  .cta {
    display: inline-flex; align-items: center; gap: 10px;
    background: var(--ink); color: #fff;
    font: 700 14px/1 -apple-system, sans-serif;
    padding: 15px 28px; border-radius: 999px; text-decoration: none;
    letter-spacing: .02em; transition: transform .12s ease, background .2s ease;
  }
  .cta:hover { background: ${accent}; color: #14161d; transform: translateY(-2px); }
  .cta.accent { background: ${accent}; color: #14161d; box-shadow: 0 8px 24px -6px ${accent}66 }
  .cta.accent:hover { background: var(--ink); color: #fff }

  section {
    padding: 56px 0;
    border-top: 1px solid var(--line);
  }
  h2 {
    font: 700 11px/1 -apple-system, sans-serif;
    letter-spacing: .3em; text-transform: uppercase;
    color: var(--muted); margin: 0 0 28px;
    position: relative; padding-left: 20px;
  }
  h2::before {
    content: ''; position: absolute; left: 0; top: 50%; transform: translateY(-50%);
    width: 12px; height: 2px; background: ${accent}; border-radius: 2px;
  }
  .lead { font-size: 19px; line-height: 1.7; color: var(--ink); max-width: 700px; }

  /* Two-up stats */
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
  .stat {
    padding: 22px 22px; background: var(--card);
    border: 1px solid var(--line); border-radius: 12px;
  }
  .stat .label {
    font: 700 10px/1 -apple-system, sans-serif;
    letter-spacing: .26em; text-transform: uppercase;
    color: var(--muted); margin-bottom: 10px;
  }
  .stat .value { font-size: 15px; line-height: 1.55; color: var(--ink) }

  /* Chip grids (guests + topics). Editorial pill style. */
  .chip-grid { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip {
    padding: 10px 18px; background: var(--card);
    border: 1px solid var(--line-strong); border-radius: 999px;
    font: 600 14px/1 -apple-system, sans-serif;
    color: var(--ink);
  }
  .chip.accent {
    background: ${accent}18; border-color: ${accent}55; color: var(--ink);
  }

  /* Episodes */
  ul.episodes { list-style: none; display: grid; gap: 10px; }
  ul.episodes li {
    padding: 18px 22px; background: var(--card);
    border: 1px solid var(--line); border-radius: 10px;
    border-left: 3px solid ${accent};
  }
  ul.episodes .title { font: 600 16px/1.4 'Charter', 'Georgia', serif; color: var(--ink); }
  ul.episodes .sub { color: var(--muted); font-size: 14px; margin-top: 4px; font-family: -apple-system, sans-serif; }

  .closing { text-align: center; padding: 72px 0 40px; border-top: 1px solid var(--line); }
  .closing p {
    font: 400 19px/1.65 'Charter', 'Georgia', serif;
    color: var(--ink); max-width: 620px; margin: 0 auto 32px;
  }

  footer {
    padding: 32px 0 0; text-align: center;
    color: var(--muted); font-size: 12px;
    font-family: -apple-system, sans-serif;
    letter-spacing: .04em;
  }
  footer a { border-bottom: 1px dotted var(--muted); text-decoration: none }

  @media (max-width: 640px) {
    .hero { grid-template-columns: 1fr; gap: 24px; padding: 40px 0 32px; text-align: center; }
    .cover { max-width: 200px; margin: 0 auto; }
    .cover.monogram { font-size: 74px; }
    main { padding: 0 20px 80px }
    section { padding: 44px 0 }
    header.top { padding: 20px 20px 16px; flex-wrap: wrap; }
  }
</style>
</head>
<body>
<header class="top">
  <span class="mark"><span class="dot"></span>Straw Hut Media · Guest pitch</span>
  <span class="mark">${escHtml(new Date().getFullYear().toString())}</span>
</header>
<main>
  <section class="hero" style="border-top: 0; padding-top: 56px;">
    ${coverUrl
      ? `<div class="cover"><img src="${escHtml(coverUrl)}" alt="${escHtml(show.name)} cover art"></div>`
      : `<div class="cover monogram">${escHtml(monogram)}</div>`}
    <div>
      <h1>${escHtml(show.name)}</h1>
      ${tagline ? `<p class="tagline">${escHtml(tagline)}</p>` : ''}
      ${mailto ? `<a class="cta accent" href="${mailto}">Pitch us as a guest →</a>` : ''}
    </div>
  </section>

  ${about ? `<section>
    <h2>About the show</h2>
    <p class="lead">${escHtml(about)}</p>
  </section>` : ''}

  ${topics.length > 0 ? `<section>
    <h2>Topics we cover</h2>
    <div class="chip-grid">
      ${topics.map((t) => `<span class="chip accent">${escHtml(t)}</span>`).join('')}
    </div>
  </section>` : ''}

  ${guests.length > 0 ? `<section>
    <h2>Notable past guests</h2>
    <div class="chip-grid">
      ${guests.map((g) => `<span class="chip">${escHtml(g)}</span>`).join('')}
    </div>
  </section>` : ''}

  ${(audience || metrics) ? `<section>
    <h2>Who listens</h2>
    <div class="stats">
      ${metrics ? `<div class="stat"><div class="label">Reach</div><div class="value">${escHtml(metrics)}</div></div>` : ''}
      ${audience ? `<div class="stat"><div class="label">Audience</div><div class="value">${escHtml(audience)}</div></div>` : ''}
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
    ${mailto ? `<a class="cta accent" href="${mailto}">Pitch us as a guest →</a>` : ''}
  </div>

  <footer>
    A Straw Hut Media production · <a href="https://strawhutmedia.com">strawhutmedia.com</a>
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

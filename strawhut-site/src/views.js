// Server-rendered HTML views (no template engine — plain tagged strings).
// Everything user-facing is escaped via esc(); episode show-notes are
// intentionally rendered as feed-provided HTML inside a sandboxed .notes block.

import { esc, toText, formatDuration, formatDate } from './util.js';
import {
  canonical,
  organizationJsonLd,
  faqJsonLd,
  podcastSeriesJsonLd,
  podcastEpisodeJsonLd,
  breadcrumbJsonLd,
  videoObjectJsonLd,
} from './seo.js';

const FONT =
  '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">';

function layout({
  title,
  description,
  image,
  body,
  activeNav = '',
  bodyClass = '',
  path = '/',
  ogType = 'website',
  jsonLd = '',
  feedUrl = '',
}) {
  const canon = canonical(path);
  const desc = toText(description, 160);
  const nav = [
    ['/', 'Home'],
    ['/shows', 'Shows'],
    ['/press', 'Press'],
    ['/#advertise', 'Advertise'],
    ['/admin', 'Admin'],
  ]
    .map(
      ([href, label]) =>
        `<a href="${href}"${activeNav === href ? ' class="active"' : ''}>${label}</a>`
    )
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canon)}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<meta property="og:type" content="${esc(ogType)}">
<meta property="og:site_name" content="Straw Hut Media">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canon)}">
${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
${image ? `<meta name="twitter:image" content="${esc(image)}">` : ''}
${feedUrl ? `<link rel="alternate" type="application/rss+xml" title="${esc(title)}" href="${esc(feedUrl)}">` : ''}
${FONT}
<link rel="stylesheet" href="/styles.css">
${jsonLd}
</head>
<body class="${bodyClass}">
<header class="site-header"><div class="container">
  <a class="brand" href="/">Straw Hut Media<span class="dot">.</span></a>
  <nav class="nav">${nav}</nav>
</div></header>
<main>${body}</main>
<footer class="site-footer"><div class="container">
  <div>© ${new Date().getFullYear()} Straw Hut Media — ${esc('Full-service podcast production & network')}</div>
  <div>Podcasts that matter.</div>
</div></footer>
</body></html>`;
}

export function messagePage({ title, heading, message }) {
  const body = `<section class="section"><div class="container"><div class="empty" style="padding:100px 0">
    <h1 style="font-size:2rem;margin-bottom:10px">${esc(heading)}</h1>
    <p style="color:var(--muted)">${esc(message)}</p>
    <p style="margin-top:24px"><a class="btn btn-primary" href="/">← Back to Straw Hut Media</a></p>
  </div></div></section>`;
  return layout({ title, description: message, body, path: '/' });
}

const artOrPlaceholder = (url, alt) =>
  url
    ? `<img src="${esc(url)}" alt="${esc(alt)}" loading="lazy">`
    : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--muted)">🎙️</div>`;

export function homePage({ shows }) {
  const featured = shows.filter((s) => s.featured);
  const spotlight = featured.length ? featured : shows.slice(0, 6);
  const originals = shows.filter((s) => (s.show_type || 'original') !== 'partnered');
  const partners = shows.filter((s) => s.show_type === 'partnered');
  const cards = (list) =>
    list
      .map(
        (s) => `<a class="show-card" href="/${esc(s.slug)}">
      ${s.featured ? '<span class="badge">Featured</span>' : ''}
      <div class="art">${artOrPlaceholder(s.image_url, s.title)}</div>
      <div class="body"><h3>${esc(s.title)}</h3>
      <div class="meta">${s.episode_count != null ? esc(s.episode_count) + ' episodes' : esc(s.author || '')}</div></div>
    </a>`
      )
      .join('');

  // Moving cover-art strip (the "charm" from the current site) — pure CSS,
  // duplicated once so the scroll loops seamlessly.
  const marqueeShows = shows.filter((s) => s.image_url);
  const marqueeItem = (s) =>
    `<a class="marquee-item" href="/${esc(s.slug)}" title="${esc(s.title)}"><img src="${esc(s.image_url)}" alt="${esc(s.title)}" loading="lazy"></a>`;
  const marquee = marqueeShows.length
    ? `<div class="marquee"><div class="marquee-track">${[...marqueeShows, ...marqueeShows].map(marqueeItem).join('')}</div></div>`
    : '';

  const body = `
  <section class="hero"><div class="container">
    <h1>Podcasts that <span class="accent">matter</span>.</h1>
    <p>Straw Hut Media is an award-winning podcast network — home to ${shows.length}+ original and partner shows.</p>
  </div></section>
  ${marquee}

  ${
    spotlight.length
      ? `<section class="section"><div class="container">
    <div class="section-head"><h2>${featured.length ? 'Featured Shows' : 'Spotlight'}</h2><a class="count" href="/shows">View all →</a></div>
    <div class="grid">${cards(spotlight)}</div>
  </div></section>`
      : ''
  }

  <section class="section" id="original"><div class="container">
    <div class="section-head"><h2>Original Shows</h2><span class="count">${originals.length} shows</span></div>
    ${originals.length ? `<div class="grid">${cards(originals)}</div>` : `<div class="empty">No original shows yet. Add one in the <a href="/admin">admin</a>.</div>`}
  </div></section>

  ${
    partners.length
      ? `<section class="section" id="partnered"><div class="container">
    <div class="section-head"><h2>Partner Shows</h2><span class="count">${partners.length} shows</span></div>
    <div class="grid">${cards(partners)}</div>
  </div></section>`
      : ''
  }

  <section class="section" id="advertise"><div class="container">
    <div class="section-head"><h2>What we do</h2></div>
    <p style="color:var(--muted);max-width:720px;margin:-8px 0 26px">Straw Hut Media is a full-service podcast production company and network. We produce, host, distribute, and monetize podcasts — from first idea to chart-topping show.</p>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">
      ${SERVICES.map(
        (s) => `<article class="show-card" style="padding:22px 22px 24px"><h3 style="margin-top:0">${esc(s.name)}</h3><p class="meta" style="font-size:0.92rem;line-height:1.5">${esc(s.description)}</p></article>`
      ).join('')}
    </div>
  </div></section>

  <section class="section" id="subscribe"><div class="container">
    <div class="panel" style="max-width:640px;margin:0 auto;text-align:center;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:34px">
      <h2 style="margin-top:0">Get updates from Straw Hut Media</h2>
      <p style="color:var(--muted);margin-top:6px">New shows, new episodes, and behind-the-scenes — straight to your inbox.</p>
      <form method="post" action="/subscribe" style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:18px">
        <input type="email" name="email" required placeholder="you@email.com" style="flex:1;min-width:240px;padding:13px 16px;border-radius:999px;border:1px solid var(--border);background:var(--bg-2);color:var(--text);font-family:inherit">
        <button class="btn btn-primary" type="submit">Subscribe</button>
      </form>
    </div>
  </div></section>`;
  return layout({
    title: 'Straw Hut Media — Podcast Production Company & Network',
    description:
      'Straw Hut Media is a full-service podcast production company and network. We produce, host, distribute, and monetize original and partner podcasts.',
    body,
    activeNav: '/',
    path: '/',
    image: shows.find((s) => s.image_url)?.image_url,
    jsonLd: organizationJsonLd() + '\n' + faqJsonLd(),
  });
}

const SERVICES = [
  { name: 'Podcast Production', description: 'End-to-end production: recording, editing, sound design, and post-production.' },
  { name: 'Network & Distribution', description: 'Distribution across Apple Podcasts, Spotify, and every major platform.' },
  { name: 'Advertising & Partnerships', description: 'Host-read ads, branded content, and advertising sales that monetize your show.' },
  { name: 'Show Development', description: 'Concept development, launch strategy, and audience growth.' },
];

export function showsIndexPage({ shows }) {
  const cards = shows
    .map(
      (s) => `<a class="show-card" href="/${esc(s.slug)}">
      ${s.featured ? '<span class="badge">Featured</span>' : ''}
      <div class="art">${artOrPlaceholder(s.image_url, s.title)}</div>
      <div class="body"><h3>${esc(s.title)}</h3>
      <div class="meta">${s.episode_count != null ? esc(s.episode_count) + ' episodes' : ''}</div></div>
    </a>`
    )
    .join('');
  const body = `<section class="section"><div class="container">
    <div class="breadcrumb"><a href="/">Home</a> / Shows</div>
    <div class="section-head" style="margin-top:14px"><h2>All Shows</h2><span class="count">${shows.length} shows</span></div>
    ${shows.length ? `<div class="grid">${cards}</div>` : `<div class="empty">No shows yet.</div>`}
  </div></section>`;
  return layout({
    title: 'All Shows — Straw Hut Media',
    description: `Browse all ${shows.length} podcasts produced and distributed by Straw Hut Media.`,
    body,
    activeNav: '/shows',
    path: '/shows',
    jsonLd: breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Shows', path: '/shows' },
    ]),
  });
}

export function landingPage({ landing, show, episode }) {
  const ep = episode || {};
  const heroImg = landing.hero_image_url || ep.image_url || show?.image_url || '';
  const headline = landing.headline || ep.title || landing.title || 'Listen now';
  const canon = canonical('/lp/' + landing.slug);
  const gtag = landing.gtag_id
    ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(landing.gtag_id)}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${esc(landing.gtag_id)}');</script>`
    : '';
  const player = ep.youtube_id
    ? `<div class="video-embed"><iframe src="https://www.youtube-nocookie.com/embed/${esc(ep.youtube_id)}" title="${esc(headline)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`
    : ep.audio_url
      ? `<audio controls preload="none" src="${esc(ep.audio_url)}"></audio>`
      : '';
  const body = landing.body_html || (ep.description ? ep.description : '');
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(headline)} — Straw Hut Media</title>
<meta name="description" content="${esc(toText(landing.subhead || body, 160))}">
${landing.indexable ? `<link rel="canonical" href="${esc(canon)}"><meta name="robots" content="index, follow, max-image-preview:large">` : '<meta name="robots" content="noindex, nofollow">'}
<meta property="og:title" content="${esc(headline)}">
<meta property="og:description" content="${esc(toText(landing.subhead || body, 160))}">
${heroImg ? `<meta property="og:image" content="${esc(heroImg)}">` : ''}
${FONT}<link rel="stylesheet" href="/styles.css">${gtag}
</head>
<body>
<header class="site-header"><div class="container"><a class="brand" href="/">Straw Hut Media<span class="dot">.</span></a></div></header>
<main><section class="section" style="padding-top:40px"><div class="container" style="max-width:820px">
  ${heroImg ? `<img src="${esc(heroImg)}" alt="${esc(headline)}" style="width:100%;max-height:420px;object-fit:cover;border-radius:18px;box-shadow:var(--shadow);margin-bottom:26px">` : ''}
  <h1 style="font-size:clamp(1.8rem,4vw,2.8rem);margin:0 0 12px">${esc(headline)}</h1>
  ${landing.subhead ? `<p style="color:var(--muted);font-size:1.15rem;margin:0 0 22px">${esc(landing.subhead)}</p>` : ''}
  ${player}
  ${landing.cta_url ? `<div style="margin:26px 0"><a class="btn btn-primary" id="lpCta" href="${esc(landing.cta_url)}" style="font-size:1.05rem;padding:14px 30px">${esc(landing.cta_label || 'Listen now')}</a></div>` : ''}
  ${body ? `<div class="notes">${body}</div>` : ''}
</div></section></main>
<script>(function(){
  // Attribution: keep gclid/utm and append to the CTA so conversions track.
  try{var qs=new URLSearchParams(location.search);var keep=['gclid','utm_source','utm_medium','utm_campaign'];
  var cta=document.getElementById('lpCta');
  if(cta){var u=new URL(cta.href, location.origin);keep.forEach(function(k){if(qs.get(k))u.searchParams.set(k,qs.get(k));});cta.href=u.toString();
  cta.addEventListener('click',function(){if(window.gtag)gtag('event','conversion',{send_to:'${esc(landing.gtag_id || '')}'});});}
  }catch(e){}
})();</script>
</body></html>`;
}

export function pressPage({ items }) {
  const rows = items
    .map(
      (p) => `<a class="press-row" href="${esc(p.url)}" target="_blank" rel="noopener">
      <div class="press-meta">${esc(p.source || 'Press')}${p.published_at ? ' · <time datetime="' + esc(new Date(p.published_at).toISOString()) + '">' + esc(formatDate(p.published_at)) + '</time>' : ''}</div>
      <h3 class="press-title">${esc(p.title)}</h3>
      ${p.snippet ? `<p class="press-snippet">${esc(p.snippet)}</p>` : ''}
      <span class="press-link">Read on ${esc(p.source || 'source')} →</span>
    </a>`
    )
    .join('');
  const body = `
  <section class="hero" style="padding-bottom:20px"><div class="container">
    <div class="breadcrumb" style="padding:0 0 14px"><a href="/">Home</a> / Press</div>
    <h1>Straw Hut Media <span class="accent">in the press</span></h1>
    <p>Media coverage and mentions of Straw Hut Media and our shows.</p>
  </div></section>
  <section class="section"><div class="container">
    ${items.length ? `<div class="press-list">${rows}</div>` : `<div class="empty">Press mentions will appear here.</div>`}
  </div></section>`;
  return layout({
    title: 'Press — Straw Hut Media',
    description: 'Media coverage and press mentions of Straw Hut Media and its podcasts.',
    body,
    activeNav: '/press',
    path: '/press',
  });
}

export function showPage({ show, episodes, total = episodes.length, pageNum = 1, perPage = 60 }) {
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const platforms = [
    show.spotify_url && [show.spotify_url, 'Spotify'],
    show.apple_url && [show.apple_url, 'Apple Podcasts'],
    show.feed_url && [show.feed_url, 'RSS'],
  ].filter(Boolean);
  const platformBtns = platforms
    .map(([href, label]) => `<a class="btn btn-sm" href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}</a>`)
    .join('');

  const rows = episodes
    .map(
      (e) => `<a class="episode-row" href="/${esc(show.slug)}/${esc(e.slug)}">
      <img class="thumb" src="${esc(e.image_url || show.image_url || '')}" alt="${esc(e.title)} — ${esc(show.title)}" loading="lazy">
      <div>
        <h3 class="title">${esc(e.title)}</h3>
        <div class="sub">${e.published_at ? `<time datetime="${esc(new Date(e.published_at).toISOString())}">${esc(formatDate(e.published_at))}</time>` : ''}${e.duration ? ' · ' + esc(formatDuration(e.duration)) : ''}</div>
        <p class="excerpt">${esc(toText(e.description, 160))}</p>
      </div>
      <span class="btn btn-sm btn-primary listen">▶ Listen</span>
    </a>`
    )
    .join('');

  const body = `
  <section class="show-hero"><div class="container">
    <div class="breadcrumb" style="padding-bottom:20px"><a href="/">Home</a> / <a href="/shows">Shows</a> / ${esc(show.title)}</div>
    <div class="show-hero-grid">
      <div class="art">${artOrPlaceholder(show.image_url, show.title)}</div>
      <div>
        <h1>${esc(show.title)}</h1>
        ${show.author ? `<div class="author">${esc(show.author)}</div>` : ''}
        <p class="desc">${esc(toText(show.description, 600))}</p>
        <div class="platforms">${platformBtns}</div>
      </div>
    </div>
  </div></section>
  <section class="section"><div class="container">
    <div class="section-head"><h2>Episodes</h2><span class="count">${total} episodes</span></div>
    ${episodes.length ? rows : `<div class="empty">No episodes found in this feed yet.</div>`}
    ${
      pageCount > 1
        ? `<div class="platforms" style="justify-content:center;margin-top:26px">
        ${pageNum > 1 ? `<a class="btn btn-sm" href="/${esc(show.slug)}?page=${pageNum - 1}">← Newer</a>` : ''}
        <span class="btn btn-sm btn-ghost">Page ${pageNum} of ${pageCount}</span>
        ${pageNum < pageCount ? `<a class="btn btn-sm" href="/${esc(show.slug)}?page=${pageNum + 1}">Older →</a>` : ''}
      </div>`
        : ''
    }
  </div></section>`;
  return layout({
    title: `${show.title} — Podcast on Straw Hut Media`,
    description: show.description || `${show.title} — a podcast on the Straw Hut Media network.`,
    image: show.image_url,
    body,
    activeNav: '/shows',
    path: '/' + show.slug,
    ogType: 'website',
    feedUrl: show.feed_url,
    jsonLd:
      podcastSeriesJsonLd(show) +
      '\n' +
      breadcrumbJsonLd([
        { name: 'Home', path: '/' },
        { name: 'Shows', path: '/shows' },
        { name: show.title, path: '/' + show.slug },
      ]),
  });
}

function epRecCard(showSlug, showTitle, ep, showImage) {
  return `<a class="show-card" href="/${esc(showSlug)}/${esc(ep.slug)}">
    <div class="art">${artOrPlaceholder(ep.image_url || showImage, ep.title)}<span class="play-badge">▶</span></div>
    <div class="body"><h3>${esc(toText(ep.title, 70))}</h3>
    <div class="meta">${esc(showTitle)}${ep.duration ? ' · ' + esc(formatDuration(ep.duration)) : ''}</div></div>
  </a>`;
}

export function episodePage({ show, episode, moreFromShow = [], related = [] }) {
  const hook = toText(episode.description, 150);
  const body = `
  <article>
  <section class="episode-hero"><div class="container">
    <div class="breadcrumb" style="padding-bottom:18px"><a href="/">Home</a> / <a href="/${esc(show.slug)}">${esc(show.title)}</a> / Episode</div>
    <div class="episode-hero-grid">
      <div class="art">${artOrPlaceholder(episode.image_url || show.image_url, episode.title + ' — ' + show.title)}</div>
      <div>
        <a class="show-link" href="/${esc(show.slug)}">${esc(show.title)}</a>
        <h1>${esc(episode.title)}</h1>
        <div class="sub">${episode.published_at ? `<time datetime="${esc(new Date(episode.published_at).toISOString())}">${esc(formatDate(episode.published_at))}</time>` : ''}${episode.duration ? ' · ' + esc(formatDuration(episode.duration)) : ''}${episode.youtube_id ? ' · <span class="pill on">▶ Watch on video</span>' : ''}</div>
        ${hook ? `<p class="ep-hook">${esc(hook)}</p>` : ''}
        ${episode.youtube_id ? `<div class="video-embed"><iframe src="https://www.youtube-nocookie.com/embed/${esc(episode.youtube_id)}" title="${esc(episode.title)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe></div>` : ''}
        ${
          episode.audio_url
            ? `<button class="btn btn-primary play-cta" id="playCta" type="button">▶ Play this episode</button>
               <audio id="epAudio" controls preload="none" src="${esc(episode.audio_url)}"></audio>
               <script>(function(){var b=document.getElementById('playCta'),a=document.getElementById('epAudio');if(b&&a){b.addEventListener('click',function(){a.play();b.textContent='▶ Playing…';a.scrollIntoView({behavior:'smooth',block:'center'});});}})();</script>`
            : `<p class="sub">Audio unavailable for this episode.</p>`
        }
      </div>
    </div>
  </div></section>

  <section class="section"><div class="container">
    <div class="notes"><h2>About this episode</h2>${episode.description || '<p class="sub">No show notes.</p>'}</div>
  </div></section>

  <section class="section"><div class="container">
    <div class="about-show">
      <div class="art">${artOrPlaceholder(show.image_url, show.title)}</div>
      <div>
        <div class="section-head" style="margin-bottom:6px"><h2 style="margin:0">About ${esc(show.title)}</h2></div>
        ${show.author ? `<div class="author" style="margin-bottom:8px">${esc(show.author)}</div>` : ''}
        <p style="color:var(--muted);max-width:640px">${esc(toText(show.description, 320))}</p>
        <a class="btn btn-primary btn-sm" href="/${esc(show.slug)}" style="margin-top:12px">See all episodes →</a>
      </div>
    </div>
  </div></section>

  ${
    moreFromShow.length
      ? `<section class="section"><div class="container">
    <div class="section-head"><h2>More from ${esc(show.title)}</h2><a class="count" href="/${esc(show.slug)}">View all →</a></div>
    <div class="grid">${moreFromShow.map((e) => epRecCard(show.slug, show.title, e, show.image_url)).join('')}</div>
  </div></section>`
      : ''
  }

  ${
    related.length
      ? `<section class="section"><div class="container">
    <div class="section-head"><h2>You might also like</h2><a class="count" href="/shows">Browse all shows →</a></div>
    <div class="grid">${related.map((r) => epRecCard(r.show.slug, r.show.title, r.episode, r.show.image_url)).join('')}</div>
  </div></section>`
      : ''
  }
  </article>`;
  return layout({
    title: `${episode.title} — ${show.title} | Straw Hut Media`,
    description: episode.description || `${episode.title}, an episode of ${show.title} on Straw Hut Media.`,
    image: episode.image_url || show.image_url,
    body,
    activeNav: '/shows',
    path: `/${show.slug}/${episode.slug}`,
    ogType: 'article',
    jsonLd:
      podcastEpisodeJsonLd(show, episode) +
      '\n' +
      videoObjectJsonLd(show, episode) +
      '\n' +
      breadcrumbJsonLd([
        { name: 'Home', path: '/' },
        { name: show.title, path: '/' + show.slug },
        { name: episode.title, path: `/${show.slug}/${episode.slug}` },
      ]),
  });
}

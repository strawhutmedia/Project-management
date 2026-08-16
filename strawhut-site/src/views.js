// Server-rendered HTML views (no template engine — plain tagged strings).
// Everything user-facing is escaped via esc(); episode show-notes are
// intentionally rendered as feed-provided HTML inside a sandboxed .notes block.

import { esc, toText, formatDuration, formatDate } from './util.js';
import {
  canonical,
  organizationJsonLd,
  faqJsonLd,
  faqJsonLdFrom,
  articleJsonLd,
  serviceJsonLd,
  podcastSeriesJsonLd,
  podcastEpisodeJsonLd,
  breadcrumbJsonLd,
  videoObjectJsonLd,
  studioServiceJsonLd,
  FAQ,
} from './seo.js';
import { resolvePlatformLinks } from './platforms.js';
import { CONTACT_ROUTES } from './mail.js';
import { trackingHead, trackingBody } from './tracking.js';

const FONT =
  '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">';

// Warm up third-party origins the page will hit (tags, audio CDN, video thumbs)
// so the first request to each is faster.
const RESOURCE_HINTS =
  '<link rel="preconnect" href="https://www.googletagmanager.com">' +
  '<link rel="dns-prefetch" href="https://traffic.megaphone.fm">' +
  '<link rel="dns-prefetch" href="https://i.ytimg.com">';

// Custom, on-brand audio player. Renders a self-contained control (play/pause,
// seekable progress bar, elapsed/duration, mute) styled in the brand palette —
// replaces the raw <audio> element. Each instance wires only itself, so it works
// on any page (site layout or standalone landing pages) with no global script.
const SKIP_SECONDS = 15;
let _apSeq = 0;
export function audioPlayer(src, opts = {}) {
  const id = 'ap' + _apSeq++;
  const image = opts.image || '';
  const title = opts.title || '';
  const showTitle = opts.showTitle || '';
  const durSecs = Number(opts.duration) > 0 ? Math.round(Number(opts.duration)) : 0;
  const back = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11.5 4C8.43 4 5.68 5.39 3.85 7.65L2 5.75V11h5.25L5.08 8.83C6.54 7.08 8.68 6 11.5 6c4.14 0 7.5 3.36 7.5 7.5S15.64 21 11.5 21A7.5 7.5 0 0 1 4.1 14H2.08C2.56 18.84 6.6 23 11.5 23c5.25 0 9.5-4.25 9.5-9.5S16.75 4 11.5 4z"/><text x="11.5" y="17.5" text-anchor="middle" font-size="7" font-weight="700" font-family="system-ui,sans-serif">15</text></svg>`;
  const fwd = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.5 4C15.57 4 18.32 5.39 20.15 7.65L22 5.75V11h-5.25l2.17-2.17C17.46 7.08 15.32 6 12.5 6 8.36 6 5 9.36 5 13.5S8.36 21 12.5 21a7.5 7.5 0 0 0 7.4-6H21.92C21.44 18.84 17.4 23 12.5 23 7.25 23 3 18.75 3 13.5S7.25 4 12.5 4z"/><text x="12.5" y="17.5" text-anchor="middle" font-size="7" font-weight="700" font-family="system-ui,sans-serif">15</text></svg>`;
  const head =
    title || image
      ? `<div class="aplayer-head">
          ${image ? `<img class="aplayer-art" src="${esc(image)}" alt="" loading="lazy">` : ''}
          <div class="aplayer-meta">
            <div class="aplayer-eyebrow">${showTitle ? esc(showTitle) + ' &middot; ' : ''}<span class="aplayer-status">Ready to play</span></div>
            ${title ? `<div class="aplayer-title">${esc(title)}</div>` : ''}
          </div>
        </div>`
      : '';
  const BARS = 48;
  const viz = `<div class="aplayer-viz" aria-hidden="true">${Array.from({ length: BARS }, (_, i) => {
    const h = 26 + Math.round(Math.abs(Math.sin(i * 0.7) * 0.6 + Math.sin(i * 1.9) * 0.4) * 74); // 26–100%
    const delay = ((i % 12) * 0.07).toFixed(2);
    const dur = (0.65 + (i % 6) * 0.13).toFixed(2);
    return `<span style="height:${h}%;animation-delay:${delay}s;animation-duration:${dur}s"></span>`;
  }).join('')}</div>`;
  return `<div class="aplayer" id="${id}">
    <audio preload="none" src="${esc(src)}"></audio>
    ${head}
    ${viz}
    <div class="aplayer-controls">
      <button class="aplayer-skip" data-skip="back" type="button" aria-label="Back ${SKIP_SECONDS} seconds">${back}</button>
      <button class="aplayer-toggle" type="button" aria-label="Play">
        <svg class="ap-ico-play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="7,4 20,12 7,20"/></svg>
        <svg class="ap-ico-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="display:none"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
      </button>
      <button class="aplayer-skip" data-skip="fwd" type="button" aria-label="Forward ${SKIP_SECONDS} seconds">${fwd}</button>
    </div>
    <div class="aplayer-bar" tabindex="0" role="slider" aria-label="Seek">
      <div class="aplayer-track"><div class="aplayer-buffered"></div><div class="aplayer-played"></div><div class="aplayer-knob"></div></div>
    </div>
    <div class="aplayer-times"><span class="aplayer-cur">0:00</span><span class="aplayer-dur" data-secs="${durSecs}">&ndash;&ndash;:&ndash;&ndash;</span></div>
    <div class="aplayer-util">
      <button class="aplayer-speed" type="button" aria-label="Playback speed">1&times;</button>
      <button class="aplayer-vol" type="button" aria-label="Mute">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>
      </button>
    </div>
  </div>
  <script>(function(){
    var r=document.getElementById('${id}');if(!r)return;
    var a=r.querySelector('audio'),tg=r.querySelector('.aplayer-toggle'),
        ip=r.querySelector('.ap-ico-play'),ie=r.querySelector('.ap-ico-pause'),
        bar=r.querySelector('.aplayer-bar'),played=r.querySelector('.aplayer-played'),
        buf=r.querySelector('.aplayer-buffered'),knob=r.querySelector('.aplayer-knob'),
        cur=r.querySelector('.aplayer-cur'),dur=r.querySelector('.aplayer-dur'),
        spd=r.querySelector('.aplayer-speed'),vol=r.querySelector('.aplayer-vol'),
        status=r.querySelector('.aplayer-status'),SK=${SKIP_SECONDS};
    function fmt(s){if(!isFinite(s)||s<0)s=0;var m=Math.floor(s/60),x=Math.floor(s%60);return m+':'+(x<10?'0':'')+x;}
    function setPct(p){p=Math.max(0,Math.min(1,p));played.style.width=(p*100)+'%';knob.style.left=(p*100)+'%';}
    var pre=parseInt(dur.getAttribute('data-secs')||'0',10);if(pre>0)dur.textContent=fmt(pre);
    function setStatus(t){if(status)status.textContent=t;}
    tg.addEventListener('click',function(){a.paused?a.play():a.pause();});
    var _tracked=false;
    a.addEventListener('play',function(){ip.style.display='none';ie.style.display='';tg.setAttribute('aria-label','Pause');r.classList.add('is-playing');setStatus('Now playing');if(!_tracked&&window.shmTrack){_tracked=true;shmTrack('play_episode',{});}});
    a.addEventListener('pause',function(){ip.style.display='';ie.style.display='none';tg.setAttribute('aria-label','Play');r.classList.remove('is-playing');setStatus('Paused');});
    a.addEventListener('ended',function(){ip.style.display='';ie.style.display='none';r.classList.remove('is-playing');setStatus('Finished');});
    a.addEventListener('loadedmetadata',function(){dur.textContent=fmt(a.duration);});
    a.addEventListener('timeupdate',function(){cur.textContent=fmt(a.currentTime);if(a.duration)setPct(a.currentTime/a.duration);});
    a.addEventListener('progress',function(){try{if(a.buffered.length&&a.duration){buf.style.width=(a.buffered.end(a.buffered.length-1)/a.duration*100)+'%';}}catch(e){}});
    r.querySelectorAll('.aplayer-skip').forEach(function(b){b.addEventListener('click',function(){
      var d=b.getAttribute('data-skip')==='back'?-SK:SK;
      if(a.readyState===0){a.load();}
      a.currentTime=Math.max(0,Math.min((a.duration||1e9),(a.currentTime||0)+d));
    });});
    var rates=[1,1.25,1.5,1.75,2],ri=0;
    spd.addEventListener('click',function(){ri=(ri+1)%rates.length;a.playbackRate=rates[ri];spd.innerHTML=(rates[ri]%1===0?rates[ri]:rates[ri])+'&times;';});
    vol.addEventListener('click',function(){a.muted=!a.muted;vol.classList.toggle('muted',a.muted);});
    function seekTo(clientX){var rect=bar.getBoundingClientRect();var p=(clientX-rect.left)/rect.width;if(a.duration){a.currentTime=Math.max(0,Math.min(1,p))*a.duration;}else{setPct(p);}}
    var dragging=false;
    bar.addEventListener('mousedown',function(e){dragging=true;seekTo(e.clientX);});
    document.addEventListener('mousemove',function(e){if(dragging)seekTo(e.clientX);});
    document.addEventListener('mouseup',function(){dragging=false;});
    bar.addEventListener('click',function(e){seekTo(e.clientX);});
    bar.addEventListener('keydown',function(e){if(e.key==='ArrowLeft'){a.currentTime=Math.max(0,(a.currentTime||0)-SK);}else if(e.key==='ArrowRight'){a.currentTime=Math.min((a.duration||1e9),(a.currentTime||0)+SK);}});
  })();</script>`;
}

// "Listen & subscribe on" row of platform logos for a show, shown under the
// player. Each logo links to the show on that platform (see platforms.js).
export function platformRow(show) {
  const links = resolvePlatformLinks(show);
  if (!links.length) return '';
  return `<div class="listen-on">
    <div class="listen-on-label">Listen &amp; subscribe on</div>
    <div class="platform-links">
      ${links
        .map(
          (l) => `<a class="platform-link" href="${esc(l.url)}" target="_blank" rel="noopener" style="--pc:${esc(l.color)}" aria-label="${esc(l.label)}" title="${esc(l.label)}" onclick="window.shmTrack&&shmTrack('platform_click',{platform:'${esc(l.label)}'})"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${l.icon}</svg><span>${esc(l.label)}</span></a>`
        )
        .join('')}
    </div>
  </div>`;
}

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
  const nav =
    [
      ['/', 'Home'],
      ['/shows', 'Shows'],
      ['/studio', 'Studio'],
      ['/resources', 'Resources'],
      ['/press', 'Press'],
      ['/contact', 'Contact'],
    ]
      .map(
        ([href, label]) =>
          `<a href="${href}"${activeNav === href ? ' class="active"' : ''}>${label}</a>`
      )
      .join('') +
    // "Promote" — cross-sell to The Podbooster (our promotion product). External,
    // opens in a new tab, carries UTMs so Podbooster attributes the traffic, and
    // fires a tracked event for cross-property retargeting.
    `<a class="nav-cta" href="https://thepodbooster.com/?utm_source=strawhutmedia&utm_medium=nav&utm_campaign=promote" target="_blank" rel="noopener" onclick="window.shmTrack&&shmTrack('promote_click',{destination:'thepodbooster.com'})">Promote</a>`;
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
${RESOURCE_HINTS}
${trackingHead()}
${FONT}
<link rel="stylesheet" href="/styles.css">
${jsonLd}
</head>
<body class="${bodyClass}">
${trackingBody()}
<header class="site-header"><div class="container">
  <a class="brand" href="/">Straw Hut Media<span class="dot">.</span></a>
  <button class="nav-toggle" id="navToggle" type="button" aria-label="Menu" aria-expanded="false" aria-controls="siteNav"><span class="nav-toggle-bars"></span></button>
  <nav class="nav" id="siteNav">${nav}</nav>
</div></header>
<script>(function(){var t=document.getElementById('navToggle'),n=document.getElementById('siteNav');if(!t||!n)return;t.addEventListener('click',function(){var open=n.classList.toggle('open');t.classList.toggle('open',open);t.setAttribute('aria-expanded',open?'true':'false');});n.addEventListener('click',function(e){if(e.target.tagName==='A'){n.classList.remove('open');t.classList.remove('open');t.setAttribute('aria-expanded','false');}});})();</script>
<main>${body}</main>
<footer class="site-footer"><div class="container">
  <div class="footer-cols">
    <div class="footer-col">
      <div class="footer-h">Services</div>
      <a href="/podcast-production">Podcast Production</a>
      <a href="/advertise">Advertise With Us</a>
      <a href="/studio">Book the Studio</a>
    </div>
    <div class="footer-col">
      <div class="footer-h">Explore</div>
      <a href="/about">About</a>
      <a href="/shows">All Shows</a>
      <a href="/resources">Guides &amp; Resources</a>
      <a href="/press">Press</a>
      <a href="/contact">Contact</a>
    </div>
    <div class="footer-col">
      <div class="footer-h">Get started</div>
      <a href="/book">Book a 15-min fit call</a>
      <a href="/pricing">Packages &amp; pricing</a>
    </div>
  </div>
  <div class="footer-base">
    <div>© ${new Date().getFullYear()} Straw Hut Media — ${esc('Full-service podcast production & network')}</div>
    <div class="footer-links"><a href="/contact">Contact</a> · <a href="/admin">Admin</a></div>
  </div>
</div></footer>
</body></html>`;
}

export function notFoundPage({ suggestions = [] }) {
  const cards = suggestions
    .map(
      (s) => `<a class="show-card" href="/${esc(s.slug)}">
      <div class="art">${s.image_url ? `<img src="${esc(s.image_url)}" alt="${esc(s.title)}" loading="lazy">` : '🎙️'}</div>
      <div class="body"><h3>${esc(s.title)}</h3></div>
    </a>`
    )
    .join('');
  const body = `
  <section class="section"><div class="container" style="text-align:center;padding:70px 0 30px">
    <div style="font-size:3.4rem;line-height:1">🎙️</div>
    <h1 style="font-size:clamp(1.9rem,4vw,2.8rem);margin:14px 0 8px">Dead air.</h1>
    <p style="color:var(--muted);font-size:1.12rem;max-width:520px;margin:0 auto">
      That page dropped out — but the show goes on. Let's get you back to the good stuff.</p>
    <div style="margin-top:24px"><a class="btn btn-primary" href="/">Back to home</a>
      <a class="btn" href="/shows" style="margin-left:8px">Browse all shows</a></div>
  </div></section>
  ${
    suggestions.length
      ? `<section class="section"><div class="container">
    <div class="section-head"><h2>Were you looking for…</h2></div>
    <div class="grid">${cards}</div>
  </div></section>`
      : ''
  }`;
  return layout({ title: "Dead air — page not found | Straw Hut Media", description: 'Page not found.', body, path: '/404' });
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
    <h1>Think outside the <span class="accent">pod</span>.</h1>
    <p>Straw Hut Media is an award-winning, full-service podcast production company and network. We take your show from first idea to chart-topping — production, distribution, monetization, and growth, all under one roof.</p>
    <div style="margin-top:22px"><a class="btn btn-primary" href="/book">Book a 15-min fit call</a> <a class="btn btn-ghost" href="/shows" style="margin-left:8px">Hear our shows</a></div>
  </div></section>
  ${marquee}

  ${
    featured.length
      ? `<section class="section"><div class="container">
    <div class="section-head"><h2>Featured Shows</h2><a class="count" href="/shows">View all →</a></div>
    <div class="spotlight-row">${cards(featured)}</div>
  </div></section>`
      : ''
  }

  ${
    originals.length
      ? `<section class="section" id="original"><div class="container">
    <div class="section-head"><h2>Original Shows</h2><a class="count" href="/shows#original">View all ${originals.length} →</a></div>
    <div class="spotlight-row">${cards(originals.slice(0, 12))}</div>
  </div></section>`
      : ''
  }

  ${
    partners.length
      ? `<section class="section" id="partnered"><div class="container">
    <div class="section-head"><h2>Partner Shows</h2><a class="count" href="/shows#partner">View all ${partners.length} →</a></div>
    <div class="spotlight-row">${cards(partners.slice(0, 12))}</div>
  </div></section>`
      : ''
  }

  <section class="section" id="advertise"><div class="container">
    <div class="section-head"><h2>Everything you need to make a podcast</h2></div>
    <p style="color:var(--muted);max-width:760px;margin:-8px 0 26px">Straw Hut Media is a full-service podcast production company. Whether you're launching a brand-new show or scaling an existing one, we handle the entire journey — concept, recording, editing, sound design, distribution to every major platform, advertising, and audience growth. We produce our own award-winning originals and partner with brands and creators to build shows people love.</p>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">
      ${SERVICES.map(
        (s) => {
          const inner = `<h3 style="margin-top:0">${esc(s.name)}${s.href ? ' <span class="accent" style="font-weight:600">→</span>' : ''}</h3><p class="meta" style="font-size:0.92rem;line-height:1.5">${esc(s.description)}</p>`;
          return s.href
            ? `<a class="show-card svc-card" href="${esc(s.href)}" style="padding:22px 22px 24px;display:block">${inner}</a>`
            : `<article class="show-card" style="padding:22px 22px 24px">${inner}</article>`;
        }
      ).join('')}
    </div>
    <p style="margin-top:24px"><a class="btn btn-primary" href="/book">Book a 15-min fit call →</a></p>
  </div></section>

  <section class="section" id="faq"><div class="container">
    <div class="section-head"><h2>Podcasting questions, answered</h2></div>
    <div class="faq-list">
      ${FAQ.map(
        ([q, a]) => `<details class="faq-item"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`
      ).join('')}
    </div>
  </div></section>

  <section class="section" id="subscribe"><div class="container">
    <div class="panel" style="max-width:640px;margin:0 auto;text-align:center;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:34px">
      <h2 style="margin-top:0">Get updates from Straw Hut Media</h2>
      <p style="color:var(--muted);margin-top:6px">New shows, new episodes, and behind-the-scenes — straight to your inbox.</p>
      <form method="post" action="/subscribe" onsubmit="window.shmTrack&&shmTrack('subscribe',{});window.fbq&&fbq('track','Subscribe');" style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:18px">
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
  { name: 'Podcast Production', href: '/podcast-production', description: 'End-to-end production for new and existing shows — recording, editing, sound design, and post-production that sounds professional.' },
  { name: 'Network & Distribution', description: 'We publish and distribute your show to Apple Podcasts, Spotify, YouTube, and every major platform, and grow it across our network.' },
  { name: 'Advertising & Monetization', href: '/advertise', description: 'Host-read ads, branded content, and advertising sales handled in-house — turning listeners into revenue.' },
  { name: 'Show Development', description: 'Concept, format, launch strategy, and audience growth to build a show that stands out and lasts.' },
  { name: 'Hollywood Studio', href: '/studio', description: 'Record in our fully-equipped studio — pro audio and multi-camera 4K video, booked by the hour.' },
];

export function showsIndexPage({ shows }) {
  const card = (s) => `<a class="show-card" href="/${esc(s.slug)}">
      ${s.featured ? '<span class="badge">Featured</span>' : ''}
      <div class="art">${artOrPlaceholder(s.image_url, s.title)}</div>
      <div class="body"><h3>${esc(s.title)}</h3>
      <div class="meta">${s.episode_count != null ? esc(s.episode_count) + ' episodes' : ''}</div></div>
    </a>`;
  const originals = shows.filter((s) => (s.show_type || 'original') !== 'partnered');
  const partners = shows.filter((s) => s.show_type === 'partnered');
  const section = (id, heading, list) =>
    list.length
      ? `<section class="section" id="${id}"><div class="container">
    <div class="section-head"><h2>${heading}</h2><span class="count">${list.length} shows</span></div>
    <div class="grid">${list.map(card).join('')}</div>
  </div></section>`
      : '';
  const body = `<section class="section" style="padding-bottom:0"><div class="container">
    <div class="breadcrumb"><a href="/">Home</a> / Shows</div>
    <h1 style="margin:14px 0 0">All Shows</h1>
  </div></section>
  ${shows.length ? section('original', 'Original Shows', originals) + section('partner', 'Partner Shows', partners) : `<section class="section"><div class="container"><div class="empty">No shows yet.</div></div></section>`}`;
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

// --- Resources / blog -------------------------------------------------------

// Shared visible-FAQ block (used by resource posts + service pages). Renders the
// same <details> pattern as the homepage FAQ so styling is consistent.
function faqSection(pairs, heading = 'Frequently asked questions') {
  if (!pairs || !pairs.length) return '';
  return `<section class="section" id="faq"><div class="container">
    <div class="section-head"><h2>${esc(heading)}</h2></div>
    <div class="faq-list">
      ${pairs
        .map(([q, a]) => `<details class="faq-item"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`)
        .join('')}
    </div>
  </div></section>`;
}

export function resourcesIndexPage({ posts }) {
  const cards = posts
    .map(
      (p) => `<a class="resource-card" href="/resources/${esc(p.slug)}">
      <span class="resource-cat">${esc(p.category || 'Podcasting')}</span>
      <h3>${esc(p.title)}</h3>
      <p>${esc(p.description)}</p>
      <span class="resource-more">Read the guide <span class="accent">→</span></span>
    </a>`
    )
    .join('');
  const body = `
  <section class="hero" style="padding-bottom:14px"><div class="container">
    <div class="breadcrumb" style="padding:0 0 14px"><a href="/">Home</a> / Resources</div>
    <h1>Podcasting <span class="accent">guides &amp; resources</span></h1>
    <p>Straight-talking guides to starting, producing, growing, and monetizing a podcast — written by the team at Straw Hut Media. No fluff, no filler.</p>
  </div></section>
  <section class="section" style="padding-top:8px"><div class="container">
    <div class="resource-grid">${cards}</div>
    <div class="cta-band">
      <h2>Ready to make your podcast?</h2>
      <p>We take shows from first idea to chart-topping — production, distribution, and growth under one roof.</p>
      <a class="btn btn-primary" href="/book">Book a 15-min fit call →</a>
    </div>
  </div></section>`;
  return layout({
    title: 'Podcasting Guides & Resources — Straw Hut Media',
    description:
      'Practical guides to starting, producing, growing, and monetizing a podcast — written by Straw Hut Media, a full-service podcast production company and network.',
    body,
    activeNav: '/resources',
    path: '/resources',
    jsonLd: breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Resources', path: '/resources' },
    ]),
  });
}

export function resourcePostPage({ post, related = [] }) {
  const relatedCards = related.length
    ? `<div class="resource-related"><h2>Keep reading</h2><div class="resource-grid">${related
        .map(
          (p) => `<a class="resource-card" href="/resources/${esc(p.slug)}">
        <span class="resource-cat">${esc(p.category || 'Podcasting')}</span>
        <h3>${esc(p.title)}</h3>
        <p>${esc(p.description)}</p>
        <span class="resource-more">Read the guide <span class="accent">→</span></span>
      </a>`
        )
        .join('')}</div></div>`
    : '';
  const body = `
  <article class="article">
    <div class="container article-narrow">
      <div class="breadcrumb" style="padding:26px 0 14px"><a href="/">Home</a> / <a href="/resources">Resources</a> / ${esc(post.category || 'Guide')}</div>
      <span class="resource-cat">${esc(post.category || 'Podcasting')}</span>
      <h1 class="article-title">${esc(post.title)}</h1>
      ${post.dek ? `<p class="article-dek">${esc(post.dek)}</p>` : ''}
      <div class="article-byline">By Straw Hut Media${post.readingTime ? ` · ${esc(post.readingTime)}` : ''}${post.updated ? ` · Updated ${esc(formatDate(post.updated))}` : ''}</div>
      <div class="article-body">${post.body_html}</div>
      <div class="cta-band">
        <h2>Want this done for you?</h2>
        <p>Straw Hut Media is a full-service podcast production company and network. Book a quick call and we'll map out exactly what your show takes.</p>
        <a class="btn btn-primary" href="/book">Book a 15-min fit call →</a>
      </div>
    </div>
  </article>
  ${faqSection(post.faq)}
  ${relatedCards ? `<section class="section"><div class="container article-narrow">${relatedCards}</div></section>` : ''}`;
  return layout({
    title: `${post.title} | Straw Hut Media`,
    description: post.description,
    body,
    activeNav: '/resources',
    path: '/resources/' + post.slug,
    ogType: 'article',
    image: post.image,
    jsonLd:
      articleJsonLd(post) +
      '\n' +
      faqJsonLdFrom(post.faq) +
      '\n' +
      breadcrumbJsonLd([
        { name: 'Home', path: '/' },
        { name: 'Resources', path: '/resources' },
        { name: post.title, path: '/resources/' + post.slug },
      ]),
  });
}

// --- Per-service landing pages ---------------------------------------------

export function servicePage(cfg) {
  const highlights = (cfg.highlights || [])
    .map(
      (h) => `<article class="show-card" style="padding:22px 22px 24px"><h3 style="margin-top:0">${esc(h.name)}</h3><p class="meta" style="font-size:0.92rem;line-height:1.55">${esc(h.text)}</p></article>`
    )
    .join('');
  const sections = (cfg.sections || [])
    .map(
      (s) => `<section class="section"><div class="container article-narrow">
      <h2>${esc(s.h2)}</h2>
      <div class="prose">${s.html}</div>
    </div></section>`
    )
    .join('');
  const body = `
  <section class="hero"><div class="container">
    <div class="breadcrumb" style="padding:0 0 14px"><a href="/">Home</a> / ${esc(cfg.breadcrumbName || cfg.navLabel)}</div>
    <h1>${cfg.hero.h1}</h1>
    <p>${esc(cfg.hero.dek)}</p>
    <div style="margin-top:22px"><a class="btn btn-primary" href="${esc(cfg.hero.cta.href)}">${esc(cfg.hero.cta.label)}</a> <a class="btn btn-ghost" href="/resources" style="margin-left:8px">Read our guides</a></div>
  </div></section>
  ${cfg.intro ? `<section class="section" style="padding-bottom:0"><div class="container article-narrow"><p class="prose lead">${esc(cfg.intro)}</p></div></section>` : ''}
  ${
    highlights
      ? `<section class="section"><div class="container">
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">${highlights}</div>
  </div></section>`
      : ''
  }
  ${sections}
  ${faqSection(cfg.faq)}
  <section class="section"><div class="container"><div class="cta-band">
    <h2>Let's build it together</h2>
    <p>One award-winning team, the whole journey — from first idea to chart-topping show.</p>
    <a class="btn btn-primary" href="${esc(cfg.hero.cta.href)}">${esc(cfg.hero.cta.label)} →</a>
  </div></div></section>`;
  return layout({
    title: cfg.title,
    description: cfg.description,
    body,
    activeNav: '',
    path: cfg.path,
    jsonLd:
      serviceJsonLd({ path: cfg.path, ...cfg.schema }) +
      '\n' +
      faqJsonLdFrom(cfg.faq) +
      '\n' +
      breadcrumbJsonLd([
        { name: 'Home', path: '/' },
        { name: cfg.breadcrumbName || cfg.navLabel, path: cfg.path },
      ]),
  });
}

// --- About -----------------------------------------------------------------

// Companies + collaborators we've worked with. Add a `logo` path (a file in
// /public/logos/) to render a real graphic mark; otherwise a clean, uniform
// wordmark is shown. Keeping them uniform reads more premium than mismatched
// raster logos — and swapping in real files later is a one-line change each.
const CLIENTS = [
  { name: 'Universal Pictures', logo: '/public/logos/universal-pictures.svg' },
  { name: 'Disney', logo: '/public/logos/disney.svg' },
  { name: 'Hulu', logo: '/public/logos/hulu.svg' },
  { name: 'Commune', logo: '/public/logos/commune.png' },
  { name: 'Mekanism', logo: '/public/logos/mekanism.png' },
  { name: 'Next City', logo: '/public/logos/next-city.png' },
  { name: 'Plus Company', logo: '/public/logos/plus-company.png' },
  { name: 'We Are Social', logo: '/public/logos/we-are-social.png' },
  { name: 'King Pleasure', logo: '/public/logos/king-pleasure.png', tall: true },
  { name: 'Shaping Freedom', logo: '/public/logos/shaping-freedom.png' },
  { name: 'Phil Rosenthal', logo: '/public/logos/phil-rosenthal.png' },
  { name: 'Gayety', logo: '/public/logos/gayety.png' },
  { name: 'Kiss the Ground', logo: '/public/logos/kiss-the-ground.png' },
];

// Team — names + roles only (no photos, by design). Fill this in and each
// person is also emitted as Person schema for search + AI discoverability.
const TEAM = [];

export function aboutPage() {
  const logos = CLIENTS.map((c) =>
    c.logo
      ? `<span class="logo-item${c.tall ? ' tall' : ''}"><img src="${esc(c.logo)}" alt="${esc(c.name)}" loading="lazy"></span>`
      : `<span class="logo-item logo-word">${esc(c.name)}</span>`
  ).join('');
  const team = TEAM.length
    ? `<section class="section" id="team"><div class="container">
    <div class="section-head"><h2>The team</h2></div>
    <div class="team-list">
      ${TEAM.map(
        (m) => `<div class="team-member"><span class="team-name">${esc(m.name)}</span><span class="team-role">${esc(m.role)}</span></div>`
      ).join('')}
    </div>
  </div></section>`
    : '';
  const body = `
  <section class="hero" style="padding-bottom:16px"><div class="container">
    <div class="breadcrumb" style="padding:0 0 14px"><a href="/">Home</a> / About</div>
    <h1>Think outside the <span class="accent">pod</span>.</h1>
    <p>We're Straw Hut Media — an award-winning podcast production company and network, founded in Hollywood in 2017 and making podcasts since 2018.</p>
    <p>Anyone can hit record. Turning that into a show people won't stop listening to is the part we've spent years getting very good at.</p>
    <div style="margin-top:22px"><a class="btn btn-primary" href="/book">Book a 15-min fit call</a> <a class="btn btn-ghost" href="/shows" style="margin-left:8px">Hear our shows</a></div>
  </div></section>

  <section class="section clients-band" id="clients"><div class="container">
    <div class="section-head"><h2>Trusted by</h2></div>
    <div class="logo-wall">${logos}</div>
  </div></section>

  ${team}

  <section class="section"><div class="container"><div class="cta-band">
    <h2>Let's make something people love</h2>
    <p>From first idea to chart-topping show — production, distribution, and growth under one roof.</p>
    <a class="btn btn-primary" href="/book">Book a 15-min fit call →</a>
  </div></div></section>`;
  const personLd = TEAM.map((m) =>
    `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: m.name,
      jobTitle: m.role,
      worksFor: { '@type': 'Organization', name: 'Straw Hut Media', url: canonical('/') },
    }).replace(/</g, '\\u003c')}</script>`
  ).join('\n');
  return layout({
    title: 'About Straw Hut Media — Podcast Production Company in Hollywood',
    description:
      'Straw Hut Media is an award-winning, full-service podcast production company and network founded in Hollywood in 2017. We work with brands and studios like Universal, Disney, and Hulu.',
    body,
    activeNav: '/about',
    path: '/about',
    jsonLd:
      organizationJsonLd() +
      '\n' +
      breadcrumbJsonLd([
        { name: 'Home', path: '/' },
        { name: 'About', path: '/about' },
      ]) +
      (personLd ? '\n' + personLd : ''),
  });
}

// --- Book a call (GoHighLevel-backed 15-min fit call) -----------------------

export function bookPage({ widgetUrl = '' } = {}) {
  const embed = widgetUrl
    ? `<iframe src="${esc(widgetUrl)}" title="Book a 15-minute call with Straw Hut Media" scrolling="no" id="shmBookingWidget" style="width:100%;min-height:740px;border:1px solid var(--border);border-radius:14px;background:#fff"></iframe>
       <script src="https://link.msgsndr.com/js/form_embed.js"></script>`
    : `<div class="booking-note"><h3>Our scheduler is being connected</h3><p>Give us one sec to wire up the calendar. In the meantime, <a href="/contact">send us a quick note</a> and we'll get your 15-minute call on the books.</p></div>`;
  const body = `
  <section class="hero" style="padding-bottom:16px"><div class="container">
    <div class="breadcrumb" style="padding:0 0 14px"><a href="/">Home</a> / Book a call</div>
    <h1>Let's see if we're a <span class="accent">good fit</span></h1>
    <p>Book a free 15-minute call. Tell us about your show or your idea, and we'll tell you honestly whether — and how — we can help. No slides, no hard sell, no obligation.</p>
  </div></section>
  <section class="section" style="padding-top:8px"><div class="container">
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin-bottom:28px">
      <article class="show-card" style="padding:20px 22px"><h3 style="margin-top:0">What we'll cover</h3><p class="meta" style="line-height:1.55">Your idea or existing show, what you're trying to build, and wherever you're stuck.</p></article>
      <article class="show-card" style="padding:20px 22px"><h3 style="margin-top:0">What you'll leave with</h3><p class="meta" style="line-height:1.55">A straight answer on whether we're the right partner — and the smartest next step either way.</p></article>
      <article class="show-card" style="padding:20px 22px"><h3 style="margin-top:0">How long</h3><p class="meta" style="line-height:1.55">Fifteen minutes. That's genuinely it.</p></article>
    </div>
    ${embed}
  </div></section>
  <script>window.shmTrack&&shmTrack('book_call_view',{});</script>`;
  return layout({
    title: 'Book a 15-Minute Fit Call — Straw Hut Media',
    description:
      "Book a free 15-minute call with Straw Hut Media to see if we're the right podcast production partner for your show. No pressure, no hard sell.",
    body,
    activeNav: '',
    path: '/book',
    jsonLd: breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Book a call', path: '/book' },
    ]),
  });
}

// --- Pricing / packages + custom quote builder -----------------------------
// Embeds the Straw Hut "Sales-Quoting" builder (self-hosted at /public/quote/)
// in an auto-sizing iframe so it renders exactly as built, isolated from our
// styles. Booking inside it runs through the team's Calendly discovery link.
export function pricingPage() {
  const body = `
  <section class="hero" style="padding-bottom:12px"><div class="container">
    <div class="breadcrumb" style="padding:0 0 14px"><a href="/">Home</a> / Packages &amp; pricing</div>
    <h1>Packages &amp; a <span class="accent">custom quote</span></h1>
    <p>Pick one of our production packages or build a custom quote in a couple of minutes. Either way you'll get a real number — and a quick call to make sure we're the right fit for your show.</p>
  </div></section>
  <section class="section" style="padding-top:6px"><div class="container">
    <iframe id="shmQuoteFrame" src="https://services.strawhutmedia.com/" title="Straw Hut Media podcast packages and custom quote builder" loading="lazy" style="width:100%;min-height:1600px;border:1px solid var(--border);background:#fff;border-radius:16px"></iframe>
    <p style="text-align:center;color:var(--muted);margin-top:14px;font-size:0.92rem">Trouble viewing the builder? <a href="https://services.strawhutmedia.com/" target="_blank" rel="noopener" style="color:var(--accent)">Open it in a new tab →</a></p>
  </div></section>
  <script>window.shmTrack&&shmTrack('pricing_view',{});</script>`;
  return layout({
    title: 'Podcast Production Packages & Pricing — Straw Hut Media',
    description:
      'See Straw Hut Media podcast production packages or build a custom quote in minutes. Transparent options for creators, brands, and businesses.',
    body,
    activeNav: '',
    path: '/pricing',
    jsonLd: breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Packages & pricing', path: '/pricing' },
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
  // Prefer the branded AUDIO player: a play streams from Megaphone and counts
  // as a real IAB download (the goal). Fall back to YouTube only if no audio.
  const player = ep.audio_url
    ? audioPlayer(ep.audio_url, { title: ep.title, showTitle: landing.show_title || show?.title || '', image: ep.image_url || show?.image_url, duration: ep.duration })
    : ep.youtube_id
      ? `<div class="video-embed"><iframe src="https://www.youtube-nocookie.com/embed/${esc(ep.youtube_id)}" title="${esc(headline)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`
      : '';
  const body = landing.body_html || (ep.description ? ep.description : '');
  const cover = ep.image_url || show?.image_url || heroImg || '';
  const dateline = [ep.published_at ? formatDate(ep.published_at) : '', ep.duration ? formatDuration(ep.duration) : '']
    .filter(Boolean)
    .join(' · ');
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(headline)} — Straw Hut Media</title>
<meta name="description" content="${esc(toText(landing.subhead || body, 160))}">
${landing.indexable ? `<link rel="canonical" href="${esc(canon)}"><meta name="robots" content="index, follow, max-image-preview:large">` : '<meta name="robots" content="noindex, nofollow">'}
<meta property="og:title" content="${esc(headline)}">
<meta property="og:description" content="${esc(toText(landing.subhead || body, 160))}">
${heroImg ? `<meta property="og:image" content="${esc(heroImg)}">` : ''}
${trackingHead()}${FONT}<link rel="stylesheet" href="/styles.css">${gtag}
</head>
<body class="lp-body">
${trackingBody()}
<main class="lp-wrap"><div class="lp-card">
  <a class="lp-brand" href="/">Straw Hut Media<span class="dot">.</span></a>
  <div class="lp-head">
    ${cover ? `<img class="lp-cover" src="${esc(cover)}" alt="${esc(headline)}">` : ''}
    <div class="lp-head-text">
      ${show ? `<div class="lp-eyebrow">${esc(show.title)}</div>` : ''}
      <h1 class="lp-title">${esc(headline)}</h1>
      ${dateline ? `<div class="lp-date">${esc(dateline)}</div>` : ''}
    </div>
  </div>
  ${player ? `<div class="lp-playcue"><span class="lp-playcue-arrow">▶</span> Press play</div>${player}` : ''}
  ${landing.cta_url ? `<a class="btn btn-primary lp-cta-btn" id="lpCta" href="${esc(landing.cta_url)}">${esc(landing.cta_label || 'Listen now')}</a>` : ''}
  ${landing.subhead ? `<p class="lp-sub">${esc(landing.subhead)}</p>` : ''}
  ${
    show
      ? `<div class="lp-subscribe">
           <div class="lp-sub-label">Subscribe to ${esc(show.title)}</div>
           ${platformRow(show)}
         </div>`
      : ''
  }
  ${body ? `<div class="lp-desc notes">${body}</div>` : ''}
</div></main>
<script>(function(){
  // Attribution: keep gclid/utm and append to the CTA so conversions track.
  try{var qs=new URLSearchParams(location.search);var keep=['gclid','utm_source','utm_medium','utm_campaign'];
  var cta=document.getElementById('lpCta');
  if(cta){var u=new URL(cta.href, location.origin);keep.forEach(function(k){if(qs.get(k))u.searchParams.set(k,qs.get(k));});cta.href=u.toString();
  cta.addEventListener('click',function(){if(window.gtag)gtag('event','conversion',{send_to:'${esc(landing.gtag_id || '')}'});if(window.shmTrack)shmTrack('lp_cta_click',{slug:'${esc(landing.slug)}'});if(window.fbq)fbq('track','Lead');});}
  }catch(e){}
})();</script>
</body></html>`;
}

// Studio booking — embeds the same GoHighLevel widgets the current site uses,
// so calendar + Stripe payment continue to work through HighLevel unchanged.
// Real studio photos (vendored from the current site into /public/studio).
const STUDIO_PHOTOS = [
  'CA6A0795', 'CA6A0788', 'CA6A0790', 'CA6A0792', 'CA6A0793', 'CA6A0794',
  'CA6A0798', 'CA6A0799', 'CA6A0800', 'CA6A0801', 'CA6A0803',
].map((n) => `/public/studio/${n}.jpg`);

const STUDIO_DURATIONS = [
  ['1 Hour', 'ZLa4C3UbEh4WbPhXdUSd'], ['1.5 Hours', 'yAVTjHR0vqfciP3pEMlf'],
  ['2 Hours', 'x6Oz9tKdb0cVJgiOUy2a'], ['2.5 Hours', '9pB7cQ5NrF3nRR19ERgv'],
  ['3 Hours', 'mm8JdMuhjQver7V95Efv'], ['3.5 Hours', 'IgpH1BTr7WozaNT8RtN1'],
  ['4 Hours', 'ILScBGtaKr1mq6wUiDEw'], ['4.5 Hours', 'Zarf7wBti0LRV7BYFePz'],
  ['5 Hours', '5R4GIOck1WZwAyKFyrps'], ['5.5 Hours', 'bQplaFjAQsh88r6PhmS0'],
  ['6 Hours', 'EyDVEXc1A5boAcHWWrN5'], ['6.5 Hours', 'AcaZjXuJT2IDifZAVfyw'],
  ['7 Hours', 'yQbzrUSTH74dz8e6irpb'], ['7.5 Hours', 'hbmcanjDNHgYlL4LSNAW'],
  ['8 Hours', 'SiprxaRVMnRtXcQraTe2'], ['8.5 Hours', 'Fs3Ob4NBHIeBZgJ9HdE3'],
  ['9 Hours', 'hzr7vAMkVsiwp0WMjsnd'], ['9.5 Hours', 'NtZubTCRsaaSQ0o9dQnX'],
  ['10 Hours', 'HAoXAenRAlwmGlVeddTu'],
];

export function studioPage() {
  const base = 'https://api.leadconnectorhq.com/widget/group/';
  const opts = STUDIO_DURATIONS.map(
    ([label, id], i) => `<option value="${base}${id}"${i === 0 ? ' selected' : ''}>${label}</option>`
  ).join('');
  const gallery = STUDIO_PHOTOS.map(
    (src, i) => `<a class="studio-shot" href="${esc(src)}" target="_blank" rel="noopener"><img src="${esc(src)}" alt="Straw Hut Studio — Hollywood podcast studio ${i + 1}" loading="lazy"></a>`
  ).join('');
  const body = `
  <section class="hero" style="padding-bottom:16px"><div class="container">
    <div class="breadcrumb" style="padding:0 0 14px"><a href="/">Home</a> / Studio</div>
    <h1>Book the <span class="accent">Straw Hut Studio</span></h1>
    <p>A fully-equipped podcast studio in the heart of Hollywood — pick your setup, pick your time, and book instantly.</p>
  </div></section>

  ${
    STUDIO_PHOTOS.length
      ? `<section class="section" style="padding-top:8px"><div class="container">
    <div class="studio-gallery">${gallery}</div>
  </div></section>`
      : ''
  }

  <section class="section"><div class="container">
    <div class="section-head"><h2>Rates</h2></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">
      <article class="show-card" style="padding:24px">
        <div class="press-meta">1080p HD</div>
        <h3 style="font-size:1.9rem;margin:6px 0">$125<span style="font-size:1rem;color:var(--muted)">/hour</span></h3>
        <p class="meta">Full audio + video, 1080p. Everything recorded and ready to publish.</p>
      </article>
      <article class="show-card" style="padding:24px">
        <div class="press-meta">4K Ultra HD</div>
        <h3 style="font-size:1.9rem;margin:6px 0">$150<span style="font-size:1rem;color:var(--muted)">/hour</span></h3>
        <p class="meta">Full audio + video in stunning 4K, captured on 4× 4K cameras.</p>
      </article>
    </div>
  </div></section>

  <section class="section"><div class="container">
    <div class="section-head"><h2>Choose your setup</h2></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
      <article class="show-card" style="padding:24px"><h3 style="margin-top:0">🎙️ The Podcast Table</h3>
        <p class="meta" style="line-height:1.6">Our classic table setup — mics, headphones, and cameras arranged for a polished, face-to-face conversation. Perfect for interviews and panel shows.</p></article>
      <article class="show-card" style="padding:24px"><h3 style="margin-top:0">🛋️ The Cozy Couch</h3>
        <p class="meta" style="line-height:1.6">A relaxed, living-room feel for a looser, more casual vibe. Great for storytelling, hangouts, and laid-back chats.</p></article>
    </div>
  </div></section>

  <section class="section" id="book"><div class="container">
    <div class="section-head"><h2>Book your session</h2></div>
    <p style="color:var(--muted);margin:-8px 0 18px">Choose your session length, then pick a date and time. Payment and confirmation are handled securely at checkout.</p>
    <div class="booking-note">
      <h3>Before you book — please read</h3>
      <ul>
        <li><strong>Book enough time.</strong> Your reservation needs to cover everything, not just the interview — <strong>studio set-up</strong> at the start and <strong>wrap-up / tear-down</strong> at the end both come out of your booked time.</li>
        <li><strong>Building in a buffer for remote guests.</strong> If your episode has a virtual guest, leave room for <strong>login and connection issues</strong> — getting a remote guest set up and troubleshooting audio/video can eat into your session, so pad your booking accordingly.</li>
        <li><strong>Going over your time.</strong> If your session runs past the time you booked, you'll be <strong>charged for every additional half hour</strong> (or part of a half hour) that you go over. Booking a little extra up front is cheaper and less stressful than running long.</li>
      </ul>
    </div>
    <div class="field" style="max-width:460px">
      <label>Which setup?</label>
      <div id="setupSelect" class="setup-toggle">
        <button type="button" class="setup-opt active" data-setup="The Podcast Table">🎙️ Podcast Table</button>
        <button type="button" class="setup-opt" data-setup="The Cozy Couch">🛋️ Cozy Couch</button>
      </div>
    </div>
    <div class="field" style="max-width:280px">
      <label>Session length</label>
      <select id="durationSelect" style="width:100%;padding:12px 14px;border-radius:10px;border:1px solid var(--border);background:var(--bg-2);color:var(--text);font-family:inherit;font-size:0.95rem">${opts}</select>
    </div>
    <div id="bookingLoader" style="padding:40px 0;color:var(--muted)">Loading booking calendar…</div>
    <iframe id="bookingIframe" title="Book the Straw Hut Studio" style="display:none;width:100%;min-height:720px;border:1px solid var(--border);border-radius:14px;background:#fff" scrolling="no"></iframe>
  </div></section>
  <script src="https://link.msgsndr.com/js/form_embed.js"></script>
  <script>(function(){
    var sel=document.getElementById('durationSelect'),f=document.getElementById('bookingIframe'),loader=document.getElementById('bookingLoader');
    var setupBtns=document.querySelectorAll('.setup-opt'), setup='The Podcast Table';
    if(!sel||!f)return;
    function srcFor(){
      // Pass the chosen setup into the GoHighLevel widget so it lands on the
      // booking (and the calendar invite) via the calendar's "studio_setup" field.
      var base=sel.value; return base+(base.indexOf('?')>-1?'&':'?')+'studio_setup='+encodeURIComponent(setup);
    }
    function load(){ if(loader)loader.style.display='block'; f.style.display='none'; f.src=srcFor(); }
    f.addEventListener('load',function(){ setTimeout(function(){ if(loader)loader.style.display='none'; f.style.display='block'; },800); });
    sel.addEventListener('change',load);
    setupBtns.forEach(function(b){ b.addEventListener('click',function(){
      setupBtns.forEach(function(x){x.classList.remove('active');}); b.classList.add('active'); setup=b.getAttribute('data-setup'); load();
    }); });
    load();
  })();</script>`;
  return layout({
    title: 'Podcast Studio in Los Angeles (Hollywood) — Book It | Straw Hut Media',
    description: 'Book the Straw Hut Media podcast studio in Hollywood, Los Angeles. 1080p at $125/hr or 4K at $150/hr, audio + multi-camera video included. Choose the podcast table or cozy couch setup.',
    body,
    activeNav: '/studio',
    path: '/studio',
    jsonLd:
      studioServiceJsonLd() +
      '\n' +
      breadcrumbJsonLd([
        { name: 'Home', path: '/' },
        { name: 'Studio', path: '/studio' },
      ]),
  });
}

export function contactPage({ sent = false, error = '', values = {} } = {}) {
  const v = (k) => esc(values[k] || '');
  const body = `
  <section class="hero" style="padding-bottom:20px"><div class="container">
    <div class="breadcrumb" style="padding:0 0 14px"><a href="/">Home</a> / Contact</div>
    <h1>Let's make something <span class="accent">worth hearing</span></h1>
    <p>Straw Hut Media is a full-service podcast production company and network. Producing, distributing, or growing a show — or booking our Hollywood studio — start here and we'll be in touch.</p>
  </div></section>
  <section class="section"><div class="container">
    ${
      sent
        ? `<div class="contact-thanks">
             <h2 style="margin:0 0 8px">Thanks — message received.</h2>
             <p style="color:var(--muted);margin:0">We read every note and reply personally. Talk soon.</p>
           </div>
           <script>window.shmTrack&&shmTrack('contact_submit',{topic:'${esc(values.topic || 'general')}'});window.fbq&&fbq('track','Lead');</script>`
        : `<form class="contact-form" method="POST" action="/contact">
             ${error ? `<div class="flash err" style="margin-bottom:18px">${esc(error)}</div>` : ''}
             <div class="field"><label>What's this regarding?</label>
               <select name="topic" class="contact-select">
                 ${Object.entries(CONTACT_ROUTES)
                   .map(([k, r]) => `<option value="${esc(k)}"${(values.topic || 'general') === k ? ' selected' : ''}>${esc(r.label)}</option>`)
                   .join('')}
               </select>
             </div>
             <div class="contact-grid">
               <div class="field"><label>Your name</label><input type="text" name="name" value="${v('name')}" required></div>
               <div class="field"><label>Email</label><input type="email" name="email" value="${v('email')}" required></div>
             </div>
             <div class="field"><label>Company / show <span style="color:var(--muted);font-weight:400">(optional)</span></label><input type="text" name="company" value="${v('company')}"></div>
             <div class="field"><label>What can we help with?</label><textarea name="message" rows="6" required>${v('message')}</textarea></div>
             <button class="btn btn-primary" type="submit">Send message</button>
           </form>`
    }
  </div></section>`;
  return layout({
    title: 'Contact — Straw Hut Media',
    description: 'Get in touch with Straw Hut Media — full-service podcast production, network distribution, advertising, and studio booking in Hollywood.',
    body,
    activeNav: '/contact',
    path: '/contact',
    jsonLd: breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Contact', path: '/contact' },
    ]),
  });
}

export function pressPage({ items }) {
  const rows = items
    .map(
      (p) => `<a class="press-row${p.image_url ? '' : ' noimg'}" href="${esc(p.url)}" target="_blank" rel="noopener">
      <div class="press-thumb" data-source="${esc((p.source || 'Press').slice(0, 18))}">${
        p.image_url ? `<img src="${esc(p.image_url)}" alt="" loading="lazy" onerror="this.closest('.press-row').classList.add('noimg')">` : ''
      }</div>
      <div class="press-body">
        <div class="press-meta">${esc(p.source || 'Press')}${p.published_at ? ' · <time datetime="' + esc(new Date(p.published_at).toISOString()) + '">' + esc(formatDate(p.published_at)) + '</time>' : ''}</div>
        <h3 class="press-title">${esc(p.title)}</h3>
        ${p.snippet ? `<p class="press-snippet">${esc(p.snippet)}</p>` : ''}
        <span class="press-link">Read on ${esc(p.source || 'source')} →</span>
      </div>
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
    jsonLd: breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Press', path: '/press' },
    ]),
  });
}

export function showPage({ show, episodes, total = episodes.length, pageNum = 1, perPage = 60 }) {
  const pageCount = Math.max(1, Math.ceil(total / perPage));

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
        ${platformRow(show)}
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
    description:
      show.seo_description ||
      toText(show.description, 160) ||
      `${show.title} — a podcast produced and distributed by Straw Hut Media.`,
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
            ? audioPlayer(episode.audio_url, { title: episode.title, showTitle: show.title, image: episode.image_url || show.image_url, duration: episode.duration }) + platformRow(show)
            : platformRow(show) || `<p class="sub">Audio unavailable for this episode.</p>`
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

// Server-rendered HTML views (no template engine — plain tagged strings).
// Everything user-facing is escaped via esc(); episode show-notes are
// intentionally rendered as feed-provided HTML inside a sandboxed .notes block.

import { esc, toText, formatDuration, formatDate, endsSentence, firstSentence } from './util.js';
import { formFields } from './antispam.js';
import { turnstileWidget } from './turnstile.js';
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
  pricingOffersJsonLd,
  showCatalogJsonLd,
} from './seo.js';
import { resolvePlatformLinks } from './platforms.js';
import { CONTACT_ROUTES } from './mail.js';
import { trackingHead, trackingBody, consentBanner } from './tracking.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Stylesheet cache-buster. styles.css is served with a 1h cache, so without a
// versioned URL a CSS fix can take an hour to reach anyone who already loaded
// the site. Hash the file once at boot and append it to the link.
const CSS_V = (() => {
  try {
    const f = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'styles.css');
    return crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 10);
  } catch { return String(Date.now()); }
})();

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
  // Muted autoplay, matching the Podbooster landing page. Only ever set for
  // visitors arriving from an ad (see server.js) — never for search traffic.
  const autoplay = !!opts.autoplay;
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
  return `<div class="aplayer${autoplay ? ' is-autoplay' : ''}" id="${id}"${autoplay ? ' data-autoplay="1"' : ''}>
    <audio preload="${autoplay ? 'auto' : 'none'}" src="${esc(src)}"></audio>
    ${autoplay ? `<button class="aplayer-unmute" type="button" hidden>
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4.03v8.06A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06A6.98 6.98 0 0 1 19 12a6.98 6.98 0 0 1-5 6.71v2.06A8.99 8.99 0 0 0 21 12a8.99 8.99 0 0 0-7-8.77z"/></svg>
      <span>Tap to unmute</span>
    </button>` : ''}
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
    // Muted autoplay + "Tap to unmute", the Podbooster landing-page pattern.
    // Only rendered for ad traffic. Browsers allow muted autoplay but block it
    // with sound, and iOS blocks it more often than not — so the banner is
    // revealed ONLY if playback actually started. If it's blocked we do nothing
    // and the (already loud) play button stands on its own.
    if(r.getAttribute('data-autoplay')==='1'){
      var um=r.querySelector('.aplayer-unmute');
      a.muted=true;
      var p=a.play();
      if(p&&p.then)p.then(function(){
        if(um){um.hidden=false;um.classList.add('pulse');}
      }).catch(function(){
        a.muted=false;                       // leave it clean for a manual press
        if(um)um.hidden=true;
      });
      if(um)um.addEventListener('click',function(){
        a.muted=false;
        if(vol)vol.classList.remove('muted');
        um.hidden=true;
        if(a.paused)a.play();
        window.shmTrack&&shmTrack('unmute_episode',{});
      });
      // Unmuting via the volume control should also retire the banner.
      if(vol)vol.addEventListener('click',function(){if(um&&!a.muted)um.hidden=true;});
    }
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

// Straw Hut Media social profiles (from the live strawhutmedia.com footer).
const SOCIALS = [
  ['Instagram', 'https://www.instagram.com/strawhut.media/', '<path d="M12 2.2c3.2 0 3.6 0 4.9.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s0 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58 0-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.21 15.58 2.2 15.2 2.2 12s0-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.21 8.8 2.2 12 2.2Zm0 1.8c-3.15 0-3.5 0-4.75.07-.9.04-1.38.19-1.7.31-.43.17-.74.37-1.06.69-.32.32-.52.63-.69 1.06-.12.32-.27.8-.31 1.7C3.4 8.5 3.4 8.85 3.4 12s0 3.5.09 4.75c.04.9.19 1.38.31 1.7.17.43.37.74.69 1.06.32.32.63.52 1.06.69.32.12.8.27 1.7.31 1.25.06 1.6.07 4.75.07s3.5 0 4.75-.07c.9-.04 1.38-.19 1.7-.31.43-.17.74-.37 1.06-.69.32-.32.52-.63.69-1.06.12-.32.27-.8.31-1.7.06-1.25.07-1.6.07-4.75s0-3.5-.07-4.75c-.04-.9-.19-1.38-.31-1.7a2.86 2.86 0 0 0-.69-1.06 2.86 2.86 0 0 0-1.06-.69c-.32-.12-.8-.27-1.7-.31C15.5 4 15.15 4 12 4Zm0 3.06A4.94 4.94 0 1 1 12 17a4.94 4.94 0 0 1 0-9.88Zm0 8.14A3.2 3.2 0 1 0 12 8.8a3.2 3.2 0 0 0 0 6.4Zm6.3-8.34a1.15 1.15 0 1 1-2.3 0 1.15 1.15 0 0 1 2.3 0Z"/>'],
  ['Facebook', 'https://m.facebook.com/strawhutmedia/', '<path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12Z"/>'],
  ['Twitter', 'https://twitter.com/strawhutmedia', '<path d="M18.9 2.5h3.3l-7.2 8.24L23.7 21.5h-6.63l-5.2-6.8-5.94 6.8H2.63l7.7-8.8L2 2.5h6.8l4.7 6.2 5.4-6.2Zm-1.16 17h1.83L7.34 4.4H5.38l12.36 15.1Z"/>'],
  ['YouTube', 'https://www.youtube.com/@strawhutmedia', '<path d="M23.5 6.5a3 3 0 0 0-2.12-2.12C19.5 3.87 12 3.87 12 3.87s-7.5 0-9.38.51A3 3 0 0 0 .5 6.5 31.3 31.3 0 0 0 0 12a31.3 31.3 0 0 0 .5 5.5 3 3 0 0 0 2.12 2.12c1.88.51 9.38.51 9.38.51s7.5 0 9.38-.51A3 3 0 0 0 23.5 17.5 31.3 31.3 0 0 0 24 12a31.3 31.3 0 0 0-.5-5.5ZM9.6 15.6V8.4l6.24 3.6-6.24 3.6Z"/>'],
  ['Email', 'mailto:hello@strawhutmedia.com', '<path d="M3 4h18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 2v.4l9 5.6 9-5.6V6H3Zm18 12V8.75l-8.47 5.27a1 1 0 0 1-1.06 0L3 8.75V18h18Z"/>'],
];

// Sitewide footer data (recent episodes) — server.js refreshes this via
// setFooterData() on boot and after each feed sync; layout() reads from it so
// every page's footer stays current without threading data through each route.
let _footerData = { recentEpisodes: [] };
export function setFooterData(d = {}) {
  _footerData = { ..._footerData, ...d };
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
  noindex = false,
}) {
  const canon = canonical(path);
  const desc = toText(description, 160);
  const nav =
    [
      ['/', 'Home'],
      ['/shows', 'Shows'],
      ['/studio', 'Studio'],
    ]
      .map(
        ([href, label]) =>
          `<a href="${href}"${activeNav === href ? ' class="active"' : ''}>${label}</a>`
      )
      .join('') +
    // "Promote" — cross-sell to The Podbooster (our promotion product), external.
    `<a href="https://thepodbooster.com/?utm_source=strawhutmedia&utm_medium=nav&utm_campaign=promote" target="_blank" rel="noopener" onclick="window.shmTrack&&shmTrack('promote_click',{destination:'thepodbooster.com'})">Promote</a>` +
    // Primary CTA: Start Your Podcast → our production page.
    `<a class="nav-cta" href="/podcast-production"${activeNav === '/podcast-production' ? ' aria-current="page"' : ''}>Start Your Podcast</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canon)}">
${noindex
  ? '<meta name="robots" content="noindex, follow">'
  : '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">'}
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
<link rel="icon" href="/public/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/public/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/public/favicon-16.png">
<link rel="apple-touch-icon" href="/public/favicon-180.png">
${trackingHead()}
${FONT}
<link rel="stylesheet" href="/styles.css?v=${CSS_V}">
${jsonLd}
</head>
<body class="${bodyClass}">
${trackingBody()}
<header class="site-header"><div class="container">
  <a class="brand" href="/" aria-label="Straw Hut Media home"><img class="brand-logo" src="/public/shm-logo.gif" alt="Straw Hut Media" width="349" height="160"></a>
  <button class="nav-toggle" id="navToggle" type="button" aria-label="Menu" aria-expanded="false" aria-controls="siteNav"><span class="nav-toggle-bars"></span></button>
  <nav class="nav" id="siteNav">${nav}</nav>
</div></header>
<script>(function(){var t=document.getElementById('navToggle'),n=document.getElementById('siteNav');if(!t||!n)return;t.addEventListener('click',function(){var open=n.classList.toggle('open');t.classList.toggle('open',open);t.setAttribute('aria-expanded',open?'true':'false');});n.addEventListener('click',function(e){if(e.target.tagName==='A'){n.classList.remove('open');t.classList.remove('open');t.setAttribute('aria-expanded','false');}});})();</script>
<main>${body}</main>
${consentBanner()}
${footerBlock()}
<script>(function(){
var sel='.section-head,.fbanner,.impact-inner,.stats-grid,.cta-band,.faq-list,.svc-hero-art,.footer-ig,.footer-top,.grid-4>*,.featured-grid>*,.pillars>*,.inc-item,.resource-card,.svc-shot,.ig-tile,.svc-tile';
var els=[].slice.call(document.querySelectorAll(sel));
if(!('IntersectionObserver'in window)||!els.length)return;
var vh=window.innerHeight||document.documentElement.clientHeight;
// Measure everything FIRST. Interleaving a read (getBoundingClientRect) with a
// write (classList.add) forces the browser to recompute layout on every single
// element, which is what made the first scroll feel like it was catching.
var tops=els.map(function(el){return el.getBoundingClientRect().top;});
var groups=new Map();
var pending=[];
for(var k=0;k<els.length;k++){
  var el=els[k],p=el.parentNode,i2=groups.get(p)||0;
  groups.set(p,i2+1);
  el.classList.add('reveal');
  // Anything already on screen at load is shown immediately and never animates
  // — the page shouldn't play an entrance for content the visitor can see.
  if(tops[k]<vh*0.95){el.classList.add('is-visible');}
  else{if(i2)el.style.transitionDelay=Math.min(i2,4)*0.045+'s';pending.push(el);}
}
if(!pending.length)return;
var io=new IntersectionObserver(function(en){
  en.forEach(function(e){if(e.isIntersecting){e.target.classList.add('is-visible');io.unobserve(e.target);}});
},{threshold:0,rootMargin:'0px 0px -8% 0px'});
pending.forEach(function(el){io.observe(el);});
})();</script>
</body></html>`;
}

// Sitewide footer: link columns, social icons, and a live "Recent episodes"
// rail fed from _footerData, capped with an animated waveform strip.
function footerBlock() {
  const recent = (_footerData.recentEpisodes || []).slice(0, 4);
  const recentList = recent.length
    ? `<div class="footer-recent">
      <div class="footer-h">Recent episodes</div>
      <ul class="recent-list">
        ${recent
          .map((e) => {
            const d = e.published_at ? new Date(e.published_at) : null;
            const day = d ? String(d.getDate()) : '';
            const mon = d ? d.toLocaleString('en-US', { month: 'short' }) : '';
            const url = e.show_slug ? `/${esc(e.show_slug)}/${esc(e.slug)}` : '#';
            return `<li><a href="${url}">
              <span class="recent-date">${day}<small>${mon}</small></span>
              <span class="recent-title">${esc(e.title)}</span>
            </a></li>`;
          })
          .join('')}
      </ul>
    </div>`
    : '';
  const socials = `<div class="footer-socials">${SOCIALS.map(
    ([name, url, path]) =>
      `<a href="${esc(url)}"${url.startsWith('mailto:') ? '' : ' target="_blank" rel="noopener"'} aria-label="${esc(name)}" title="${esc(name)}"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${path}</svg></a>`
  ).join('')}</div>`;
  const wave = `<div class="footer-wave" aria-hidden="true">${Array.from(
    { length: 90 },
    (_, i) => `<span style="animation-delay:${((i % 18) * 0.07).toFixed(2)}s"></span>`
  ).join('')}</div>`;
  // Instagram module — recent video content as tiles that link out to the real
  // profile, with a Follow button. (Live IG post pull needs their API/approval.)
  const igUrl = (SOCIALS.find(([n]) => n === 'Instagram') || [])[1] || '#';
  const igTiles = (_footerData.recentEpisodes || [])
    .map((e) => (e.youtube_id ? `https://i.ytimg.com/vi/${e.youtube_id}/hqdefault.jpg` : e.image_url || e.show_image))
    .filter(Boolean)
    .slice(0, 6);
  const igBadge =
    '<span class="ig-badge"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.2c3.2 0 3.6 0 4.9.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s0 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58 0-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.21 15.58 2.2 15.2 2.2 12s0-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.21 8.8 2.2 12 2.2Zm0 4.86A4.94 4.94 0 1 0 12 17a4.94 4.94 0 0 0 0-9.94Zm0 8.14A3.2 3.2 0 1 1 12 8.8a3.2 3.2 0 0 1 0 6.4Zm6.3-8.34a1.15 1.15 0 1 1-2.3 0 1.15 1.15 0 0 1 2.3 0Z"/></svg></span>';
  const igWidget = igTiles.length
    ? `<div class="footer-ig">
      <div class="footer-ig-head">
        <div class="footer-h">Follow along on Instagram</div>
        <a class="ig-follow" href="${esc(igUrl)}" target="_blank" rel="noopener">@strawhut.media →</a>
      </div>
      <div class="ig-grid">${igTiles
        .map(
          (src) => `<a class="ig-tile" href="${esc(igUrl)}" target="_blank" rel="noopener"><img src="${esc(src)}" alt="Straw Hut Media on Instagram" loading="lazy">${igBadge}</a>`
        )
        .join('')}</div>
    </div>`
    : '';
  return `<footer class="site-footer"><div class="container">
  ${igWidget}
  <div class="footer-top">
    <div class="footer-brand">
      <img class="brand-logo" src="/public/shm-logo.gif" alt="Straw Hut Media" width="349" height="160">
      <p>Award-winning podcast agency &amp; network — from first idea to chart-topping show.</p>
      ${socials}
    </div>
    <div class="footer-cols">
      <div class="footer-col">
        <div class="footer-h">Services</div>
        <a href="/services">All Services</a>
        <a href="/podcast-production">Podcast Production</a>
        <a href="/advertise">Advertise With Us</a>
        <a href="/studio">Book the Studio</a>
      </div>
      <div class="footer-col">
        <div class="footer-h">Explore</div>
        <a href="/about">About</a>
        <a href="/shows">All Shows</a>
        <a href="/resources">Guides &amp; Resources</a>
        <a href="/resources#faq">Podcasting FAQ</a>
        <a href="/contact">Contact</a>
        <a href="/privacy">Privacy &amp; Cookies</a>
      </div>
      <div class="footer-col">
        <div class="footer-h">Get started</div>
        <a href="/book">Book a 15-min fit call</a>
        <a href="/pricing">Packages &amp; pricing</a>
      </div>
    </div>
    ${recentList}
  </div>
  <div class="footer-base">
    <div>© ${new Date().getFullYear()} Straw Hut Media — Full-service podcast agency &amp; network</div>
  </div>
</div>${wave}</footer>`;
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


// Structured audience events. Each fans out to dataLayer/GA4/Meta/TikTok via
// shmTrack, carrying the dimensions needed to build retargeting segments
// (which show, which category, which service) rather than just a page view.
function audienceEvent(name, params) {
  return `<script>(function(){function f(){window.shmTrack&&shmTrack(${JSON.stringify(name)},${JSON.stringify(params)});}
if(document.readyState!=='loading')setTimeout(f,0);else document.addEventListener('DOMContentLoaded',f);})();</script>`;
}


// A phone playing one of our shows, sitting in the middle of the network wall.
// Built in CSS rather than a flat mockup image so the artwork is real, rotates
// through the roster, and stays crisp at any density.
function phoneMockup(shows) {
  const picks = shows.filter((s) => s.image_url).slice(0, 6);
  if (!picks.length) return '';
  const slides = picks
    .map(
      (s, i) => `<a class="ph-slide${i === 0 ? ' active' : ''}" href="/${esc(s.slug)}">
        <span class="ph-show">${esc(s.title)}</span>
        <img src="${esc(s.image_url)}" alt="${esc(s.title)}" loading="lazy">
        <span class="ph-title">${esc(s.title)}</span>
        <span class="ph-sub">${esc(s.author || 'Straw Hut Media')}</span>
      </a>`
    )
    .join('');
  return `<div class="ph-wrap" aria-hidden="true"><div class="ph">
    <div class="ph-screen">
      <div class="ph-chrome"><span class="ph-chev">⌄</span><span class="ph-dots">•••</span></div>
      <div class="ph-slides" id="phSlides">${slides}</div>
      <div class="ph-bar"><span></span></div>
      <div class="ph-times"><em>0:00</em><em>-26:33</em></div>
      <div class="ph-ctrls">
        <span class="ph-rate">1×</span>
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8Z"/></svg>
        <div class="ph-play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7L8 5Z"/></svg></div>
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1l5 5-5 5V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8Z"/></svg>
        <span class="ph-rate">15</span>
      </div>
    </div>
  </div></div>
  <script>(function(){var s=document.querySelectorAll('#phSlides .ph-slide');if(s.length<2)return;var c=0;
setInterval(function(){s[c].classList.remove('active');c=(c+1)%s.length;s[c].classList.add('active');},3500);})();</script>`;
}

const artOrPlaceholder = (url, alt) =>
  url
    ? `<img src="${esc(url)}" alt="${esc(alt)}" loading="lazy">`
    : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--muted)">🎙️</div>`;

// Owner-curated homepage line-ups. Pinned by slug, in this exact order; any
// slug not found in the catalog is skipped, and the row is topped up from the
// rest of that category so it always shows four.
/**
 * Display copy for a show, guaranteed to end on a complete sentence and to
 * contain no ellipsis.
 *
 * The team's own approved description comes first — it's only set aside when it
 * has no sentence break inside the space available, which would leave a
 * dangling fragment. In that case we use the shortened version written for the
 * show (see backfillShowBlurbs), then the meta description, and only as a last
 * resort a clean word-boundary cut.
 */
function showBlurb(show, max = 165) {
  const own = toText(show.description, max);
  if (own && endsSentence(own)) return own;
  for (const alt of [show.blurb, show.seo_description]) {
    const t = toText(alt, max);
    if (t && endsSentence(t)) return t;
  }
  // Nothing fits the budget as a finished sentence. Run slightly long with the
  // show's own opening sentence rather than stop mid-thought — a complete
  // sentence at 200 characters reads far better than a fragment at 165.
  const first = firstSentence(show.description);
  if (first) return first;
  return own;
}

const HOME_ORIGINAL_SLUGS = ['naked-lunch', 'dont-be-alone-with-jay-kogen', 'behind-the-shadows-w-harvey-guillen', 'pride'];
const HOME_PARTNER_SLUGS = ['wicked-the-official-podcast', 'only-murders-in-the-building', 'seen-on-the-screen-with-jacqueline-coley', 'commune-with-jeff-krasno'];

function curateRow(pool, pinnedSlugs, count = 4) {
  const bySlug = new Map(pool.map((s) => [s.slug, s]));
  const picked = [];
  const seen = new Set();
  for (const slug of pinnedSlugs) {
    const s = bySlug.get(slug);
    if (s && !seen.has(slug)) { picked.push(s); seen.add(slug); }
  }
  for (const s of pool) {
    if (picked.length >= count) break;
    if (!seen.has(s.slug)) { picked.push(s); seen.add(s.slug); }
  }
  return picked.slice(0, count);
}

export function homePage({ shows }) {
  const featured = shows.filter((s) => s.featured);
  const originals = shows.filter((s) => (s.show_type || 'original') !== 'partnered');
  const partners = shows.filter((s) => s.show_type === 'partnered');
  const originalPicks = curateRow(originals, HOME_ORIGINAL_SLUGS);
  const partnerPicks = curateRow(partners, HOME_PARTNER_SLUGS);
  const cards = (list) =>
    list
      .map((s) => {
        const cats = (s.categories || []).filter(Boolean).slice(0, 4).join(', ');
        const meta = cats || (s.episode_count != null ? s.episode_count + ' episodes' : s.author || '');
        return `<a class="show-card" href="/${esc(s.slug)}">
      ${s.featured ? '<span class="badge">Featured</span>' : ''}
      <div class="art">${artOrPlaceholder(s.image_url, s.title)}</div>
      <div class="body"><h3>${esc(s.title)}</h3>
      <div class="meta">${esc(meta)}</div></div>
    </a>`;
      })
      .join('');

  // Big Featured Podcast banner/carousel — built from each show's cover art.
  const featuredBanner = featured.length
    ? `<section class="section" id="featured"><div class="container">
    <div class="section-head"><h2>Featured Podcast</h2></div>
    <div class="fbanner" id="fbanner">
      ${featured
        .map(
          (s, i) => `<a class="fbanner-slide${i === 0 ? ' active' : ''}" href="/${esc(s.slug)}">
        <div class="fb-art">${
          s.image_url
            ? `<img class="fb-bg" src="${esc(s.image_url)}" alt="" aria-hidden="true" loading="lazy"><img class="fb-main" src="${esc(s.image_url)}" alt="${esc(s.title)}" loading="lazy">`
            : artOrPlaceholder(s.image_url, s.title)
        }</div>
        <div class="fb-info">
          <h3>${esc(s.title)}</h3>
          ${s.author ? `<div class="fb-host">${esc(s.author)}</div>` : ''}
          <p>${esc(showBlurb(s))}</p>
          <span class="btn btn-primary">Start Listening →</span>
        </div>
      </a>`
        )
        .join('')}
    </div>
    ${
      featured.length > 1
        ? `<div class="fbanner-dots">${featured
            .map((_, i) => `<button class="fdot${i === 0 ? ' active' : ''}" data-i="${i}" type="button" aria-label="Featured ${i + 1}"></button>`)
            .join('')}</div>`
        : ''
    }
  </div></section>
  <script>(function(){var s=document.querySelectorAll('#fbanner .fbanner-slide'),d=document.querySelectorAll('.fdot'),c=0;if(s.length<2)return;function go(n){s[c].classList.remove('active');d[c]&&d[c].classList.remove('active');c=(n+s.length)%s.length;s[c].classList.add('active');d[c]&&d[c].classList.add('active');}d.forEach(function(x){x.addEventListener('click',function(e){e.preventDefault();go(+x.getAttribute('data-i'));});});var t=setInterval(function(){go(c+1);},6000);})();</script>`
    : '';

  // Bouncing waveform behind the hero (SSR-stable heights/delays).
  const heroWave = `<div class="hero-wave" aria-hidden="true">${Array.from({ length: 60 }, (_, i) => `<span style="animation-delay:${((i % 15) * 0.08).toFixed(2)}s"></span>`).join('')}</div>`;

  // Moving cover-art strip (the "charm" from the current site) — pure CSS,
  // duplicated once so the scroll loops seamlessly.
  const marqueeShows = shows.filter((s) => s.image_url);
  const marqueeItem = (s) =>
    `<a class="marquee-item" href="/${esc(s.slug)}" title="${esc(s.title)}"><img src="${esc(s.image_url)}" alt="${esc(s.title)}" loading="lazy"></a>`;
  const marqueeRow = (list, extra) =>
    `<div class="marquee"><div class="marquee-track${extra}">${[...list, ...list].map(marqueeItem).join('')}</div></div>`;
  const marquee = marqueeShows.length
    ? marqueeRow(marqueeShows, '') + marqueeRow([...marqueeShows].reverse(), ' reverse')
    : '';

  const body = `
  <section class="hero"><div class="container hero-inner">
    <div class="hero-copy">
      <span class="hero-eyebrow">Full-service podcast agency &amp; network · since 2018</span>
      <h1>Think outside the <span class="accent">pod</span>.</h1>
      <p><strong>Straw Hut Media is an award-winning podcast agency and network.</strong> We take your show from first idea to chart-topping — production, distribution, monetization, and growth, all under one roof.</p>
      <div class="hero-cta"><a class="btn btn-primary" href="/podcast-production">Start your podcast</a> <a class="btn btn-ghost" href="/shows">Hear our shows</a></div>
    </div>
    ${heroWave}
  </div></section>
  ${marquee}

  ${featuredBanner}

  ${
    originals.length
      ? `<section class="section" id="original"><div class="container">
    <div class="section-head"><h2>Original Shows</h2><a class="count" href="/shows#original">View all ${originals.length} →</a></div>
    <div class="grid grid-4">${cards(originalPicks)}</div>
  </div></section>`
      : ''
  }

  <section class="impact-band"><div class="container">
    <div class="impact-inner">
      <div class="impact-copy">
        <h2>Your idea deserves a real production team.</h2>
        <p>Anyone can hit record. Turning that into a show people won't stop listening to — the writing, the sound, the release strategy, the growth — is the part we've spent years getting very good at.</p>
      </div>
      <div class="impact-cta">
        <a class="btn btn-primary" href="/podcast-production">Start your podcast →</a>
        <a class="btn btn-ghost" href="/book">Book a 15-min fit call</a>
      </div>
    </div>
  </div></section>

  ${
    partners.length
      ? `<section class="section" id="partnered"><div class="container">
    <div class="section-head"><h2>Partner Shows</h2><a class="count" href="/shows#partner">View all ${partners.length} →</a></div>
    <div class="grid grid-4">${cards(partnerPicks)}</div>
  </div></section>`
      : ''
  }

  <section class="stats-band" id="stats"><div class="container">
    <div class="stats-grid">
      <div class="stat"><div class="stat-num" data-target="158" data-suffix="M">0</div><div class="stat-label">Americans listen to podcasts every month</div><div class="stat-source">Edison Research, Infinite Dial 2025</div></div>
      <div class="stat"><div class="stat-num" data-target="44" data-suffix="%">0</div><div class="stat-label">of weekly listeners have bought something after hearing it on a podcast</div><div class="stat-source">Edison Research / Sounds Profitable, 2025</div></div>
      <div class="stat"><div class="stat-num" data-target="80" data-suffix="%">0</div><div class="stat-label">of active listeners trust the ads they hear on podcasts</div><div class="stat-source">Sounds Profitable, 2025</div></div>
    </div>
  </div></section>
  <script>(function(){var band=document.getElementById('stats');if(!band)return;var nums=band.querySelectorAll('.stat-num');function run(){nums.forEach(function(n){var t=+n.getAttribute('data-target'),sfx=n.getAttribute('data-suffix')||'',start=null,dur=1600;function step(ts){if(!start)start=ts;var p=Math.min((ts-start)/dur,1);var val=Math.round((p<1?(1-Math.pow(1-p,3)):1)*t);n.textContent=val+sfx;if(p<1)requestAnimationFrame(step);}requestAnimationFrame(step);});}if('IntersectionObserver'in window){var io=new IntersectionObserver(function(e){e.forEach(function(x){if(x.isIntersecting){run();io.disconnect();}});},{threshold:0.4});io.observe(band);}else{run();}})();</script>

  <section class="section" id="subscribe"><div class="container">
    <div class="panel" style="max-width:640px;margin:0 auto;text-align:center;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:34px">
      <h2 style="margin-top:0">Get updates from Straw Hut Media</h2>
      <p style="color:var(--muted);margin-top:6px">New shows, new episodes, and behind-the-scenes — straight to your inbox.</p>
      <form method="post" action="/subscribe" onsubmit="window.shmTrack&&shmTrack('subscribe',{});window.fbq&&fbq('track','Subscribe');" style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:18px">
        ${formFields()}
        <input type="email" name="email" required placeholder="you@email.com" style="flex:1;min-width:240px;padding:13px 16px;border-radius:999px;border:1px solid var(--border);background:var(--bg-2);color:var(--text);font-family:inherit">
        <button class="btn btn-primary" type="submit">Subscribe</button>
        ${turnstileWidget({ lazy: true, action: 'subscribe' })}
      </form>
    </div>
  </div></section>`;
  return layout({
    title: 'Straw Hut Media — Podcast Agency & Network',
    description:
      'Straw Hut Media is a full-service podcast agency and network. We produce, host, distribute, and monetize original and partner podcasts.',
    body,
    activeNav: '/',
    path: '/',
    image: shows.find((s) => s.image_url)?.image_url,
    jsonLd: organizationJsonLd(),
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
  // A curated wall of cover art — the network at a glance, above the lists.
  const selections = shows.filter((s) => s.image_url).slice(0, 24);
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
  ${
    selections.length
      ? `<section class="section" style="padding-top:6px"><div class="container">
    <div class="section-head"><h2>The Network</h2><a class="count" href="#original">Browse all →</a></div>
    <div class="selections">
      ${selections
        .slice(0, 12)
        .map(
          (s) => `<a class="sel-item" href="/${esc(s.slug)}" title="${esc(s.title)}"><img src="${esc(s.image_url)}" alt="${esc(s.title)}" loading="lazy"></a>`
        )
        .join('')}
      ${phoneMockup(selections)}
      ${selections
        .slice(12, 24)
        .map(
          (s) => `<a class="sel-item" href="/${esc(s.slug)}" title="${esc(s.title)}"><img src="${esc(s.image_url)}" alt="${esc(s.title)}" loading="lazy"></a>`
        )
        .join('')}
    </div>
  </div></section>`
      : ''
  }
  ${shows.length ? section('original', 'Original Shows', originals) + section('partner', 'Partner Shows', partners) : `<section class="section"><div class="container"><div class="empty">No shows yet.</div></div></section>`}`;
  return layout({
    title: 'All Shows — Straw Hut Media',
    description: `Browse all ${shows.length} podcasts in the Straw Hut Media network — award-winning original shows and partner podcasts across comedy, true crime, culture, business, and film, produced and distributed by our Hollywood podcast agency.`,
    body,
    activeNav: '/shows',
    path: '/shows',
    jsonLd:
      breadcrumbJsonLd([
        { name: 'Home', path: '/' },
        { name: 'Shows', path: '/shows' },
      ]) +
      '\n' +
      showCatalogJsonLd(shows),
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
  </div></section>
  <section class="section" id="faq"><div class="container">
    <div class="section-head"><h2>Podcasting questions, answered</h2></div>
    <div class="faq-list">
      ${FAQ.map(
        ([q, a]) => `<details class="faq-item"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`
      ).join('')}
    </div>
    <div class="cta-band" style="margin-top:34px">
      <h2>Ready to make your podcast?</h2>
      <p>We take shows from first idea to chart-topping — production, distribution, and growth under one roof.</p>
      <a class="btn btn-primary" href="/book">Book a 15-min fit call →</a>
    </div>
  </div></section>`;
  return layout({
    title: 'Podcasting Guides, Resources & FAQ — Straw Hut Media',
    description:
      'Practical guides and answers to the most common podcasting questions — starting, producing, growing, and monetizing a podcast — from Straw Hut Media, a full-service podcast agency and network.',
    body,
    activeNav: '/resources',
    path: '/resources',
    jsonLd:
      breadcrumbJsonLd([
        { name: 'Home', path: '/' },
        { name: 'Resources', path: '/resources' },
      ]) +
      '\n' +
      faqJsonLd(),
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
  ${relatedCards ? `<section class="section"><div class="container article-narrow">${relatedCards}</div></section>` : ''}
  ${audienceEvent('view_guide',{guide:post.title,guide_slug:post.slug,category:post.category||''})}`;
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

const STUDIO_SHOTS = ['CA6A0788', 'CA6A0790', 'CA6A0794', 'CA6A0798', 'CA6A0800', 'CA6A0803'].map(
  (n) => `/public/studio/${n}.jpg`
);

// Straw Hut's flagship shows — surfaced first on the service pages.
const FLAGSHIP_SLUGS = [
  'only-murders-in-the-building',
  'the-up-here-down-low-companion-podcast',
  'wicked-the-official-podcast',
  'seen-on-the-screen-with-jacqueline-coley',
  'naked-lunch',
  'commune-with-jeff-krasno',
  'kiss-the-ground-w-ryland-engelhart',
  'shaping-freedom-with-lisane-basquiat',
];

export function servicePage(cfg, { shows = [] } = {}) {
  const withArt = shows.filter((s) => s.image_url);
  // Order shows flagship-first, then everything else.
  const flagshipOrder = new Map(FLAGSHIP_SLUGS.map((s, i) => [s, i]));
  const orderedShows = [...withArt].sort((a, b) => {
    const ai = flagshipOrder.has(a.slug) ? flagshipOrder.get(a.slug) : 999;
    const bi = flagshipOrder.has(b.slug) ? flagshipOrder.get(b.slug) : 999;
    return ai - bi;
  });
  // Hero collage — our biggest shows first (falls back to a waveform).
  const heroArt = orderedShows.slice(0, 6);
  const heroVisual =
    heroArt.length >= 4
      ? `<div class="svc-hero-art">${heroArt
          .map(
            (s) => `<a class="svc-tile" href="/${esc(s.slug)}" title="${esc(s.title)}"><img src="${esc(s.image_url)}" alt="${esc(s.title)}" loading="lazy"></a>`
          )
          .join('')}</div>`
      : `<div class="hero-wave" aria-hidden="true">${Array.from({ length: 44 }, (_, i) => `<span style="animation-delay:${((i % 12) * 0.08).toFixed(2)}s"></span>`).join('')}</div>`;

  // Trusted-by logo strip — every client mark, real brand colors on a white
  // band, normalized by height (matches /about exactly).
  const trusted = CLIENTS.filter((c) => c.logo);
  const trustedStrip = trusted.length
    ? `<section class="section clients-band"><div class="container">
      <p class="trusted-eyebrow" style="color:#5a6270">Trusted by the teams behind</p>
      <div class="logo-wall">${trusted
        .map(
          (c) => `<span class="logo-item${c.tall ? ' tall' : ''}${c.mid ? ' mid' : ''}"><img src="${esc(c.logo)}" alt="${esc(c.name)}" loading="lazy"></span>`
        )
        .join('')}</div>
    </div></section>`
    : '';

  // "What's included" — highlights as an accent-checked grid, not plain boxes.
  const highlights = (cfg.highlights || [])
    .map(
      (h) => `<div class="inc-item"><span class="inc-check">✓</span><div><h3>${esc(h.name)}</h3><p>${esc(h.text)}</p></div></div>`
    )
    .join('');

  // Cover-art marquee of shows we've produced (flagship first).
  const marquee = orderedShows.length
    ? `<section class="section"><div class="container">
      <div class="section-head"><h2>Shows we've produced</h2><a class="count" href="/shows">View all →</a></div>
    </div>
    <div class="marquee"><div class="marquee-track">${[...orderedShows, ...orderedShows]
      .map(
        (s) => `<a class="marquee-item" href="/${esc(s.slug)}" title="${esc(s.title)}"><img src="${esc(s.image_url)}" alt="${esc(s.title)}" loading="lazy"></a>`
      )
      .join('')}</div></div></section>`
    : '';

  // Real studio photos.
  const studioStrip = `<section class="section"><div class="container">
    <div class="section-head"><h2>Record in our Hollywood studio</h2><a class="count" href="/studio">Book the studio →</a></div>
    <div class="svc-studio">${STUDIO_SHOTS.map(
      (src) => `<a class="svc-shot" href="/studio"><img src="${src}" alt="Straw Hut Media podcast studio" loading="lazy"></a>`
    ).join('')}</div>
  </div></section>`;

  const sections = (cfg.sections || [])
    .map(
      (s) => `<section class="section"><div class="container article-narrow">
      <h2>${esc(s.h2)}</h2>
      <div class="prose">${s.html}</div>
    </div></section>`
    )
    .join('');
  const body = `
  <section class="hero"><div class="container hero-inner">
    <div class="hero-copy">
      <div class="breadcrumb" style="padding:0 0 14px"><a href="/">Home</a> / ${esc(cfg.breadcrumbName || cfg.navLabel)}</div>
      <h1>${cfg.hero.h1}</h1>
      <p>${esc(cfg.hero.dek)}</p>
      <div class="hero-cta"><a class="btn btn-primary" href="${esc(cfg.hero.cta.href)}">${esc(cfg.hero.cta.label)}</a> <a class="btn btn-ghost" href="/shows">Hear our shows</a></div>
    </div>
    ${heroVisual}
  </div></section>
  ${trustedStrip}
  ${cfg.intro ? `<section class="section" style="padding-bottom:0"><div class="container article-narrow"><p class="prose lead">${esc(cfg.intro)}</p></div></section>` : ''}
  ${
    highlights
      ? `<section class="section"><div class="container">
    <div class="section-head"><h2>What's included</h2></div>
    <div class="inc-grid">${highlights}</div>
  </div></section>`
      : ''
  }
  ${marquee}
  ${sections}
  ${studioStrip}
  ${faqSection(cfg.faq)}
  <section class="section"><div class="container"><div class="cta-band">
    <h2>Let's build it together</h2>
    <p>One award-winning team, the whole journey — from first idea to chart-topping show.</p>
    <a class="btn btn-primary" href="${esc(cfg.hero.cta.href)}">${esc(cfg.hero.cta.label)} →</a>
  </div></div></section>
  ${audienceEvent('view_service',{service:cfg.navLabel,service_path:cfg.path})}`;
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
  { name: 'Shaping Freedom', logo: '/public/logos/shaping-freedom.png', mid: true },
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
      ? `<span class="logo-item${c.tall ? ' tall' : ''}${c.mid ? ' mid' : ''}"><img src="${esc(c.logo)}" alt="${esc(c.name)}" loading="lazy"></span>`
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
  // Scheduling lives in GoHighLevel so every booking is a CRM event that can
  // trigger reminders and follow-up. When no calendar is configured we say so
  // and route to the contact form — never a scheduler that might be cancelled.
  const embed = widgetUrl
    ? `<iframe src="${esc(widgetUrl)}" title="Book a 15-minute call with Straw Hut Media" scrolling="no" id="shmBookingWidget" style="width:100%;min-height:740px;border:1px solid var(--border);border-radius:14px;background:#fff"></iframe>
       <script src="https://link.msgsndr.com/js/form_embed.js"></script>`
    : `<div class="panel" style="padding:28px;text-align:center">
         <h2 style="margin-top:0">Tell us about your show</h2>
         <p style="color:var(--muted);max-width:520px;margin:0 auto 18px">Send us a note and we'll come straight back with a time that works.</p>
         <a class="btn btn-primary" href="/contact">Get in touch →</a>
       </div>`;
  const body = `
  <section class="hero" style="padding-bottom:16px"><div class="container">
    <div class="breadcrumb" style="padding:0 0 14px"><a href="/">Home</a> / Book a call</div>
    <h1>Let's see if we're a <span class="accent">good fit</span></h1>
    <p>Book a free 15-minute call. Tell us about your show or your idea, and we'll tell you honestly whether — and how — we can help. No slides, no hard sell, no obligation.</p>
  </div></section>
  <section class="section" style="padding-top:8px"><div class="container">
    <div class="panel" id="shmQuoteCtx" style="display:none;padding:18px 20px;margin-bottom:20px">
      <div style="font-weight:600;margin-bottom:6px">You're asking about <span class="accent" id="shmQuoteCtxPkg"></span></div>
      <p style="color:var(--muted);margin:0;font-size:.92rem;line-height:1.55">We've kept your answers — no need to repeat them. Pick a time and we'll come to the call already up to speed.</p>
    </div>
    ${embed}

    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin-top:28px">
      <article class="show-card" style="padding:20px 22px"><h3 style="margin-top:0">What we'll cover</h3><p class="meta" style="line-height:1.55">Your idea or existing show, what you're trying to build, and wherever you're stuck.</p></article>
      <article class="show-card" style="padding:20px 22px"><h3 style="margin-top:0">What you'll leave with</h3><p class="meta" style="line-height:1.55">A straight answer on whether we're the right partner — and the smartest next step either way.</p></article>
      <article class="show-card" style="padding:20px 22px"><h3 style="margin-top:0">How long</h3><p class="meta" style="line-height:1.55">Fifteen minutes. That's genuinely it.</p></article>
    </div>
  </div></section>
  <script>
  (function(){
    window.shmTrack&&shmTrack('book_call_view',{});
    // Carry a package pick or finished quote over from /pricing so the visitor
    // can see we kept it, and so /contact can prefill it if they write instead.
    var pkg='';
    try{ pkg=new URLSearchParams(window.location.search).get('package')||''; }catch(e){}
    if(!pkg){ try{
      var raw=(window.sessionStorage&&sessionStorage.getItem('shm_quote'))||(window.localStorage&&localStorage.getItem('shm_quote'))||'';
      if(raw) pkg=(JSON.parse(raw)||{}).pkg||'';
    }catch(e){} }
    if(pkg){
      var box=document.getElementById('shmQuoteCtx');
      var name=document.getElementById('shmQuoteCtxPkg');
      if(box&&name){ name.textContent=pkg; box.style.display='block'; }
    }
  })();
  </script>`;
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

// --- Services hub ----------------------------------------------------------
// /services used to be a static file dropped into public/ — Inter instead of
// Poppins, the pre-brand green, no nav, no footer, no canonical, no schema. It
// was the only page on the site that didn't look like the site.
//
// It is now a real page: the five things Straw Hut actually sells, each linking
// to the page that sells it properly. No prices here, so unlike /pricing it can
// stay indexable — which matters, because "podcast production services" is the
// search this company needs to win.

const SERVICE_LINES = [
  {
    name: 'Podcast production',
    href: '/podcast-production',
    text: 'One team owns the whole show — development, creative direction, recording, editing, sound design, and publishing. You host; we handle everything else.',
    serviceType: 'Podcast production',
  },
  {
    name: 'Network distribution',
    href: '/shows',
    text: 'Join a network of award-winning originals and partner shows. Published and optimized across Apple Podcasts, Spotify, YouTube, and everywhere else people listen.',
    serviceType: 'Podcast distribution',
  },
  {
    name: 'Advertising & brand partnerships',
    href: '/advertise',
    text: 'Host-read ads, branded segments, and full branded series across our shows — plus paid campaigns that put your episodes in front of new listeners.',
    serviceType: 'Podcast advertising',
  },
  {
    name: 'Show development',
    href: '/podcast-production#development',
    text: "Concept, format, positioning, and a launch plan. The work that decides whether a show lands before a single episode is recorded.",
    serviceType: 'Podcast show development',
  },
  {
    name: 'Studio booking',
    href: '/studio',
    text: 'Our fully-equipped Hollywood studio — pro audio and multi-camera 4K video, from $125/hour. Book by the hour and walk out with publish-ready files.',
    serviceType: 'Recording studio rental',
  },
];

const SERVICES_FAQ = [
  ['What services does Straw Hut Media offer?',
   'Straw Hut Media is a full-service podcast production company and network in Hollywood. We offer podcast production (development, recording, editing, sound design, and publishing), distribution through our network, podcast advertising and brand partnerships, show development, and hourly booking of our Hollywood recording studio.'],
  ['Do you work with brands, or only individual creators?',
   'Both. We produce award-winning original shows, flagship podcasts for individual creators and personalities, and branded podcasts for companies who want to build authority with an audience. We have worked with partners including Universal, Disney, and Hulu.'],
  ['Can I use just one service, or do I have to take the whole package?',
   'You can use one. Plenty of clients book the studio by the hour, or come to us only for advertising on our network, without any production work. If you want the whole show handled end to end, that is what the production packages are for.'],
  ['How much does it cost?',
   'It depends on format, episode length, frequency, and how much of the work you want us to own. Our packages page lays out three production tiers and a custom quote builder that gives you a real number in a couple of minutes; the studio is priced by the hour at $125 for 1080p and $150 for 4K.'],
  ['How do I get started?',
   'Book a free 15-minute discovery call. Tell us about the show or the idea, and we will tell you honestly whether — and how — we can help. No slides and no hard sell.'],
];

export function servicesHubPage() {
  const pillars = SERVICE_LINES.map((s, i) => `
    <a class="pillar pillar-link" href="${esc(s.href)}">
      <div class="pillar-num">${String(i + 1).padStart(2, '0')}</div>
      <div class="pillar-body">
        <h3>${esc(s.name)}</h3>
        <p>${esc(s.text)}</p>
        <span class="pillar-arrow">Learn more →</span>
      </div>
    </a>`).join('');

  const body = `
  <section class="hero" style="padding-bottom:10px"><div class="container">
    <div class="breadcrumb" style="padding:0 0 14px"><a href="/">Home</a> / Services</div>
    <h1>Everything a podcast needs, <span class="accent">under one roof</span></h1>
    <p>Straw Hut Media is a full-service podcast production company and network based in Hollywood. We build shows from the idea up, distribute them, sell the ads that pay for them, and rent the studio they are recorded in — and you can use any one piece of that on its own.</p>
    <div style="margin-top:22px">
      <a class="btn btn-primary" href="/book">Book a 15-min fit call →</a>
      <a class="btn btn-ghost" href="/pricing" style="margin-left:8px">See packages &amp; pricing</a>
    </div>
  </div></section>

  <section class="section" style="padding-top:14px"><div class="container">
    <div class="section-head"><h2>What we do</h2></div>
    <div class="pillars">${pillars}</div>
  </div></section>

  <section class="section"><div class="container">
    <div class="section-head"><h2>How working with us actually goes</h2></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">
      <article class="show-card" style="padding:22px 24px">
        <h3 style="margin-top:0">1 · A straight conversation</h3>
        <p class="meta" style="line-height:1.55">Fifteen minutes on what you are building and where you are stuck. If we are not the right partner, we say so and point you somewhere better.</p>
      </article>
      <article class="show-card" style="padding:22px 24px">
        <h3 style="margin-top:0">2 · A scope and a real number</h3>
        <p class="meta" style="line-height:1.55">Format, frequency, and what we own versus what you keep — priced before anything starts, so there are no surprises later.</p>
      </article>
      <article class="show-card" style="padding:22px 24px">
        <h3 style="margin-top:0">3 · We make the show</h3>
        <p class="meta" style="line-height:1.55">One team, one point of contact, and episodes that ship on schedule. You keep your show, your feed, and your IP throughout.</p>
      </article>
    </div>
  </div></section>

  ${faqSection(SERVICES_FAQ, 'Podcast services — frequently asked')}

  <section class="section"><div class="container"><div class="cta-band">
    <h2>Not sure which piece you need?</h2>
    <p>That is exactly what the call is for. Fifteen minutes, an honest answer, no obligation.</p>
    <a class="btn btn-primary" href="/book">Book a 15-min fit call →</a>
  </div></div></section>`;

  const itemList = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Straw Hut Media podcast services',
    itemListElement: SERVICE_LINES.map((s, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Service',
        name: s.name,
        serviceType: s.serviceType,
        description: s.text,
        url: canonical(s.href.split('#')[0]),
        provider: { '@type': 'Organization', name: 'Straw Hut Media', url: canonical('/') },
      },
    })),
  }).replace(/</g, '\\u003c')}</script>`;

  return layout({
    title: 'Podcast Services — Production, Distribution & Advertising | Straw Hut Media',
    description:
      'Straw Hut Media is a full-service podcast production company and network in Hollywood — podcast production, network distribution, advertising and brand partnerships, show development, and studio booking.',
    body,
    activeNav: '/services',
    path: '/services',
    jsonLd:
      organizationJsonLd() +
      '\n' + itemList +
      '\n' + faqJsonLdFrom(SERVICES_FAQ) +
      '\n' + breadcrumbJsonLd([
        { name: 'Home', path: '/' },
        { name: 'Services', path: '/services' },
      ]),
  });
}

// --- Pricing / packages + custom quote builder -----------------------------
// Native (no iframe): package cards in our own design + the quote quiz embedded
// directly. Package interest hands off to /book, which is GoHighLevel-backed.
const PACKAGES = [
  {
    tier: 'Essential', name: 'Essential Podcast Package', price: '$2,450',
    tagline: "Your podcast, simplified. Just record your show, and we'll handle all the editing, publishing, and promotion for you.",
    features: [
      'Professional audio editing and mastering',
      'Multi-track editing and sound design',
      'Custom intros, outros, and transitions',
      'Distribution to all major platforms',
      'Weekly publishing and scheduling',
      'Basic analytics to track growth',
      'Custom branding package (cover art, logo)',
      'One custom social media clip per episode',
    ],
    dataFeatures: 'Professional audio editing and mastering, Multi-track editing and sound design, Custom intros/outros/transitions, Distribution to all major platforms, Weekly publishing and scheduling, Basic analytics, Custom branding package, One custom social media clip per episode',
  },
  {
    tier: 'Premium', name: 'Premium Studio Podcast Package', price: '$4,350', featured: true,
    tagline: 'Comprehensive production for audio and video, with full branding, music, and support for in-studio or virtual recordings.',
    features: [
      'Everything in Essential, plus:',
      'Video recording in our studio or virtual setup',
      'Original theme music created for your show',
      'Guest booking and scheduling assistance',
      'Multi-camera video setup (studio or virtual)',
      'Full social media content (clips, audiograms, graphics)',
      'Dedicated manager for seamless production',
      'Priority support for urgent needs',
    ],
    dataFeatures: 'Everything in Essential plus: Video recording (studio or virtual), Original theme music, Guest booking and scheduling, Multi-camera video setup, Full social media content creation, Dedicated production manager, Priority support',
  },
  {
    tier: 'Ultimate', name: 'Ultimate On-Location Podcast Package', price: '$6,550',
    tagline: 'For podcasters who want it all — on-location recording, professional video, and custom branding for a world-class show.',
    features: [
      'Everything in Premium, plus:',
      'On-location recording anywhere you need',
      'Multi-camera setup with 3–6 cameras',
      'Professional video editing and branding',
      'On-site producer to oversee the shoot',
      'Lighting, microphones, and camera setup included',
      'Enhanced social assets, including trailers and thumbnails',
      'Videos optimized for YouTube and social media',
    ],
    dataFeatures: 'Everything in Premium plus: On-location recording anywhere, Multi-camera setup (3-6 cameras), Professional video editing and branding, On-site producer, Lighting/microphones/camera setup included, Enhanced social media assets, Videos optimized for YouTube and social',
  },
];

export function pricingPage() {
  const cards = PACKAGES.map((p) => `
    <article class="pkg-card${p.featured ? ' featured' : ''}">
      ${p.featured ? '<div class="pkg-badge">Most popular</div>' : ''}
      <div class="pkg-tier">${esc(p.tier)}</div>
      <h3 class="pkg-name">${esc(p.name)}</h3>
      <p class="pkg-tagline">${esc(p.tagline)}</p>
      <div class="pkg-price">${esc(p.price)}<span>/month</span></div>
      <ul class="pkg-features">${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
      <button class="btn btn-primary pkg-cta" data-package="${esc(p.name + ' — ' + p.price + '/month')}" data-features="${esc(p.dataFeatures)}">Get started</button>
    </article>`).join('');
  const body = `
  <section class="hero" style="padding-bottom:8px"><div class="container">
    <div class="breadcrumb" style="padding:0 0 14px"><a href="/">Home</a> / Packages &amp; pricing</div>
    <h1>Packages &amp; a <span class="accent">custom quote</span></h1>
    <p>Pick one of our production packages or build a custom quote in a couple of minutes. Either way you'll get a real number — and a quick call to make sure we're the right fit for your show.</p>
  </div></section>
  <section class="section" style="padding-top:6px"><div class="container">
    <div class="pricing-grid">${cards}</div>
    <div class="pricing-custom">
      <h3>Need something different?</h3>
      <p>Build a custom package tailored to exactly what your show needs — format, frequency, services, and more.</p>
      <button class="btn btn-primary" id="openQuizBtn">Build your custom quote →</button>
    </div>
    <div id="quiz-view" style="display:none;margin-top:32px">
      <div class="section-head"><h2>Build your custom quote</h2></div>
      <div id="shm-quote-widget"></div>
    </div>
  </div></section>
  <script src="/public/quote/widget.js"></script>
  <script>
  (function(){
    var NL=String.fromCharCode(10);
    var openBtn=document.getElementById('openQuizBtn'), quiz=document.getElementById('quiz-view');
    if(openBtn&&quiz){openBtn.addEventListener('click',function(){quiz.style.display='block';quiz.scrollIntoView({behavior:'smooth'});window.shmTrack&&shmTrack('pricing_quiz_open',{});});}
    // Booking is GoHighLevel only — send package interest to /book so the
    // booking lands in the CRM and can trigger follow-up.
    var btns=document.querySelectorAll('.pkg-cta');
    for(var i=0;i<btns.length;i++){(function(btn){btn.addEventListener('click',function(e){
      e.preventDefault();
      var pkg=btn.getAttribute('data-package')||'';
      var feats=btn.getAttribute('data-features')||'';
      var summary='=== PACKAGE SELECTION ==='+NL+NL+'Selected package: '+pkg+NL+NL+"--- What's included ---"+NL
        +feats.split(', ').map(function(f){return '\u2022 '+f;}).join(NL);
      try{
        var payload=JSON.stringify({summary:summary,pkg:pkg,ts:Date.now()});
        if(window.sessionStorage)sessionStorage.setItem('shm_quote',payload);
        if(window.localStorage)localStorage.setItem('shm_quote',payload);
      }catch(e2){}
      window.shmTrack&&shmTrack('pricing_package_click',{pkg:pkg});
      window.location.href='/book?package='+encodeURIComponent(pkg);
    });})(btns[i]);}
  })();
  </script>`;
  return layout({
    title: 'Podcast Production Packages & Pricing — Straw Hut Media',
    description:
      'Straw Hut Media podcast production packages — Essential, Premium, and Ultimate — or build a custom quote in minutes. Transparent options for creators, brands, and businesses.',
    body,
    activeNav: '',
    path: '/pricing',
    // Kept off search by owner decision — prices stay visible to anyone we send
    // here, but aren't published to competitors via Google. 'follow' so the
    // page still passes link equity onward.
    noindex: true,
    jsonLd:
      breadcrumbJsonLd([
        { name: 'Home', path: '/' },
        { name: 'Packages & pricing', path: '/pricing' },
      ]) +
      '\n' +
      pricingOffersJsonLd(PACKAGES),
  });
}

function lpHighlight(ep) {
  // Transcript pull-quotes only. There was a guest line here; it just repeated
  // names already in the episode title two lines above, so it was noise.
  const quotes = jsonList(ep.quotes);
  if (!quotes.length) return '';
  return `<div class="lp-quotes">${quotes
    .slice(0, 2)
    .map((q) => `<blockquote class="lp-quote"><p>&ldquo;${esc(q)}&rdquo;</p><span>From the episode</span></blockquote>`)
    .join('')}</div>`;
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
${trackingHead()}${FONT}<link rel="stylesheet" href="/styles.css?v=${CSS_V}">${gtag}
</head>
<body class="lp-body">
${trackingBody()}
<main class="lp-wrap"><div class="lp-card">
  <a class="lp-brand" href="/">Straw Hut Media<span class="dot">.</span></a>
  ${show ? `<p class="lp-show-name">${esc(show.title)}</p>` : ''}
  ${cover ? `<img class="lp-cover" src="${esc(cover)}" alt="${esc(headline)}">` : ''}
  <h1 class="lp-title">${esc(headline)}</h1>
  ${dateline ? `<p class="lp-date">${esc(dateline)}</p>` : ''}
  ${
    ep.ai_hook
      ? `<div class="lp-hook"><p class="lp-hook-label">Why listen</p><p class="lp-hook-text">${esc(ep.ai_hook)}</p></div>`
      : landing.subhead
        ? `<div class="lp-hook"><p class="lp-hook-label">Why listen</p><p class="lp-hook-text">${esc(landing.subhead)}</p></div>`
        : ''
  }
  ${player || ''}
  ${lpHighlight(ep)}
  ${body ? `<div class="lp-divider"></div><div class="lp-desc notes">${body}</div>` : ''}
  ${
    show
      ? `<div class="lp-divider"></div>
         <div class="lp-subscribe">
           <p class="lp-sub-label">Enjoy the episode?</p>
           <p class="lp-sub-show">Subscribe to ${esc(show.title)}</p>
           ${platformRow(show)}
         </div>`
      : ''
  }
  ${shareRow(headline)}
  ${
    landing.cta_url
      ? `<a class="btn btn-primary lp-cta-btn" id="lpCta" href="${esc(landing.cta_url)}">${esc(landing.cta_label || 'Listen now')}</a>`
      : ''
  }
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
    <div id="bookingLoader" style="padding:40px 0;color:var(--muted)">Loading the booking calendar</div>
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

export function contactPage({ sent = false, error = '', values = {}, canBook = true } = {}) {
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
             <p style="color:var(--muted);margin:0 0 6px">We read every note and reply personally, and a confirmation is on its way to your inbox.</p>
             ${
               canBook
                 ? `<p style="color:var(--muted);margin:0 0 20px">Don't want to wait? Grab a free 15 minutes now.</p>
                    <a class="btn btn-primary" href="/book">Book a 15-minute call →</a>`
                 : `<p style="color:var(--muted);margin:0 0 20px">You'll hear back from us shortly — usually the same day.</p>
                    <a class="btn btn-ghost" href="/shows">Hear our shows</a>`
             }
           </div>
           <script>window.shmTrack&&shmTrack('contact_submit',{topic:'${esc(values.topic || 'general')}'});window.fbq&&fbq('track','Lead');</script>`
        : `<form class="contact-form" method="POST" action="/contact">
             ${formFields()}
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
             ${turnstileWidget({ action: 'contact' })}
             <button class="btn btn-primary" type="submit">Send message</button>
           </form>
           <script>
           (function(){
             // If they built a quote or picked a package first, bring it with
             // them — it lands in the email and on their CRM contact.
             var box=document.querySelector('.contact-form textarea[name="message"]');
             if(!box||box.value.trim())return;
             var raw='';
             try{ raw=(window.sessionStorage&&sessionStorage.getItem('shm_quote'))||(window.localStorage&&localStorage.getItem('shm_quote'))||''; }catch(e){}
             if(!raw)return;
             var q=null; try{ q=JSON.parse(raw); }catch(e){}
             if(!q||!q.summary)return;
             box.value=q.summary+String.fromCharCode(10,10)+'--- '+String.fromCharCode(10)+'Anything you want to add:'+String.fromCharCode(10);
           })();
           </script>`
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
  </div></section>
  ${audienceEvent('view_show',{show:show.title,show_slug:show.slug,show_type:show.show_type||'original',categories:(show.categories||[]).join('|')})}`;
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

// --- Episode landing-page blocks -------------------------------------------
// These mirror what makes the Podbooster campaign pages convert: a one-line
// reason to listen, what you actually get, who's on it, and an easy way to
// follow or share. All of it degrades to nothing when the data isn't there.

const jsonList = (v) => {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
};

function episodeHook(episode) {
  const hook = String(episode.ai_hook || '').trim();
  if (!hook) return '';
  return `<p class="ep-hook">${esc(hook)}</p>`;
}

function episodeTakeaways(episode) {
  const items = jsonList(episode.ai_takeaways);
  if (!items.length) return '';
  return `<div class="ep-takeaways">
    <h2 class="ep-block-h">In this episode</h2>
    <ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
  </div>`;
}

/** Share row — native share sheet on a phone, copy-to-clipboard everywhere else. */
function shareRow(title) {
  const t = String(title || '').replace(/'/g, "\\'");
  return `<div class="ep-share">
    <button class="ep-share-btn" type="button" onclick="shmShare(this,'${esc(t)}')" aria-label="Share this episode">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 15V3"/><path d="m8 7 4-4 4 4"/></svg>
      <span>Share</span>
    </button>
    <span class="ep-share-toast" hidden>Link copied</span>
  </div>
  <script>window.shmShare=window.shmShare||function(btn,title){
  var url=location.href, toast=btn.parentNode.querySelector('.ep-share-toast');
  window.shmTrack&&shmTrack('share_episode',{episode:title});
  if(navigator.share){navigator.share({title:title,url:url}).catch(function(){});return;}
  var done=function(){if(!toast)return;toast.hidden=false;setTimeout(function(){toast.hidden=true;},2200);};
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(url).then(done).catch(function(){});return;}
  var i=document.createElement('input');i.value=url;document.body.appendChild(i);i.select();
  try{document.execCommand('copy');done();}catch(e){}document.body.removeChild(i);};</script>`;
}

export function episodePage({ show, episode, moreFromShow = [], related = [], adTraffic = false }) {
  // One page, one URL, one layout. The top of the page is the same card layout
  // as the campaign landing page (which converts), and the SEO depth — full
  // show notes, about-the-show, and internal links to more episodes — sits
  // below it. There is no separate /go/ page to keep in sync any more.
  const cover = episode.image_url || show.image_url || '';
  const dateline = [
    episode.published_at ? formatDate(episode.published_at) : '',
    episode.duration ? formatDuration(episode.duration) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const body = `
  <article>
  <section class="ep-lp">${
    cover ? `<img class="ep-tint" src="${esc(cover)}" alt="" aria-hidden="true" loading="lazy">` : ''
  }<div class="container">
    <div class="breadcrumb ep-lp-crumb"><a href="/">Home</a> / <a href="/${esc(show.slug)}">${esc(show.title)}</a> / Episode</div>
    <div class="lp-card">
      <div class="lp-head">
        ${cover ? `<img class="lp-cover" src="${esc(cover)}" alt="${esc(episode.title)} — ${esc(show.title)}">` : ''}
        <div class="lp-head-text">
          <a class="lp-show-name" href="/${esc(show.slug)}">${esc(show.title)}</a>
          <h1 class="lp-title${episode.title.length > 100 ? ' is-xlong' : episode.title.length > 62 ? ' is-long' : ''}">${esc(episode.title)}</h1>
          ${dateline ? `<p class="lp-date">${esc(dateline)}</p>` : ''}
        </div>
      </div>
      ${
        episode.ai_hook
          ? `<div class="lp-hook"><p class="lp-hook-label">Why listen</p><p class="lp-hook-text">${esc(episode.ai_hook)}</p></div>`
          : ''
      }
      ${
        episode.youtube_id
          ? `<div class="video-embed"><iframe src="https://www.youtube-nocookie.com/embed/${esc(episode.youtube_id)}" title="${esc(episode.title)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe></div>`
          : ''
      }
      ${
        episode.audio_url
          ? audioPlayer(episode.audio_url, { title: episode.title, showTitle: show.title, image: cover, duration: episode.duration, autoplay: adTraffic })
          : `<p class="sub">Audio unavailable for this episode.</p>`
      }
      ${lpHighlight(episode)}
      ${
        platformRow(show)
          ? `<div class="lp-divider"></div>
             <div class="lp-subscribe">
               <p class="lp-sub-label">Enjoy the episode?</p>
               <p class="lp-sub-show">Subscribe to ${esc(show.title)}</p>
               ${platformRow(show)}
             </div>`
          : ''
      }
      ${shareRow(episode.title)}
    </div>
    ${episodeTakeaways(episode)}
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
  </article>
  ${audienceEvent('view_episode',{show:show.title,show_slug:show.slug,episode:episode.title})}`;
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

export function privacyPage() {
  const updated = 'August 2026';
  const body = `
  <section class="hero" style="padding-bottom:10px"><div class="container article-narrow">
    <div class="breadcrumb" style="padding:0 0 14px"><a href="/">Home</a> / Privacy &amp; Cookies</div>
    <h1>Privacy &amp; <span class="accent">cookies</span></h1>
    <p>How Straw Hut Media handles your information. Last updated ${updated}.</p>
  </div></section>
  <section class="section" style="padding-top:8px"><div class="container article-narrow"><div class="prose">
    <h2>Who we are</h2>
    <p>Straw Hut Media is a podcast agency and network based in Hollywood, California.
       If you have any question about this policy or your data, email
       <a href="mailto:hello@strawhutmedia.com">hello@strawhutmedia.com</a>.</p>

    <h2>What we collect</h2>
    <ul>
      <li><strong>Information you give us.</strong> If you submit the contact form, book a
          call, or subscribe to the newsletter, we receive what you type — typically your
          name, email address, and your message.</li>
      <li><strong>Usage information.</strong> With your consent, analytics and advertising
          tools record pages viewed, episodes played, approximate location, device and
          browser type, and how you arrived at the site.</li>
      <li><strong>Essential technical data.</strong> Server logs and a session cookie for
          the admin area. These are required for the site to work and are not used to
          track or profile you.</li>
    </ul>

    <h2>Cookies and how consent works</h2>
    <p>We set only strictly necessary cookies until you choose to accept more. Analytics
       and advertising tags start in a denied state via Google Consent Mode, and the
       Meta and TikTok pixels are not loaded at all unless you accept. Choosing
       “Essential only” means no analytics or advertising cookies are written.</p>
    <ul>
      <li><strong>Essential</strong> — session and security cookies. Always on.</li>
      <li><strong>Analytics</strong> — Google Analytics / Google Tag Manager, to understand
          which shows and pages people actually use.</li>
      <li><strong>Advertising</strong> — Google Ads, Meta, and TikTok, so we can show
          Straw Hut Media ads to people who have visited us and measure whether they work.</li>
    </ul>
    <p>You can change your mind at any time:
       <a href="#" onclick="window.shmOpenConsent&amp;&amp;window.shmOpenConsent();return false;">reopen cookie settings</a>.
       You can also clear cookies in your browser.</p>

    <h2>Why we are allowed to use it</h2>
    <p>For analytics and advertising cookies we rely on your consent. For replying to an
       enquiry or delivering a service you asked for, we rely on performing a contract or
       our legitimate interest in running the business. You can withdraw consent at any time.</p>

    <h2>Who we share it with</h2>
    <p>We do not sell your personal information. We share it only with providers that help
       us operate: our hosting provider (Railway), email delivery (Resend), and — where you
       have consented — Google, Meta, and TikTok for analytics and advertising. Podcast
       audio streams from the show’s host (for example Megaphone), which may log the request.</p>

    <h2>How long we keep it</h2>
    <p>Enquiries and subscriptions are kept until you ask us to delete them or they are no
       longer needed. Analytics data is retained according to the provider’s settings,
       typically no more than 14 months.</p>

    <h2>Your rights</h2>
    <p>Depending on where you live — including the UK and EEA under UK/EU GDPR, and
       California under the CCPA/CPRA — you may have the right to access, correct, delete,
       or port your information, to object to or restrict processing, to withdraw consent,
       and to opt out of targeted advertising or any “sale” or “sharing” of personal
       information. We do not sell personal information. To exercise any right, email
       <a href="mailto:hello@strawhutmedia.com">hello@strawhutmedia.com</a> and we will
       respond within the time the law allows. UK/EEA residents may also complain to their
       local data protection authority.</p>

    <h2>Children</h2>
    <p>This site is not directed at children under 13, and we do not knowingly collect
       their personal information.</p>

    <h2>Changes</h2>
    <p>If we change this policy we will update the date at the top of this page.</p>
  </div></div></section>`;
  return layout({
    title: 'Privacy & Cookies — Straw Hut Media',
    description:
      'How Straw Hut Media collects, uses, and protects your information, the cookies we set, and how to control your choices.',
    body,
    activeNav: '',
    path: '/privacy',
    jsonLd: breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Privacy & Cookies', path: '/privacy' },
    ]),
  });
}

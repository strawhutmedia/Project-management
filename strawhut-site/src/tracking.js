// Site-wide analytics + retargeting. Everything is OPTIONAL and enabled purely
// by environment variables, so the owner just pastes their IDs on Railway (no
// code change) and every public page — including landing pages — starts firing
// the tags. Google Tag Manager is the keystone: with GTM set, you can add GA4,
// Google Ads remarketing, Meta/TikTok/LinkedIn pixels, etc. from the GTM UI
// without touching the site again.
//
//   GTM_CONTAINER_ID    GTM-XXXXXX    (keystone — manage everything from GTM)
//   GA4_MEASUREMENT_ID  G-XXXXXXXXXX  (Google Analytics 4)
//   GOOGLE_ADS_ID       AW-XXXXXXXXX  (Google Ads remarketing + conversions)
//   META_PIXEL_ID       1234567890    (Facebook / Instagram retargeting)
//   TIKTOK_PIXEL_ID     XXXXXXXXXX    (TikTok retargeting)

// Default to the shared Straw Hut / Podbooster GTM container. Every page + event
// is stamped with `site` so both properties can share one container and still be
// told apart (filter triggers by it, add it as a GA4 custom dimension, etc.).
const GTM = (process.env.GTM_CONTAINER_ID || 'GTM-WM7DVH3Z').trim();
const GA4 = (process.env.GA4_MEASUREMENT_ID || '').trim();
const ADS = (process.env.GOOGLE_ADS_ID || '').trim();
// Straw Hut's Meta pixel, recovered from the live start/services properties
// where it was already installed. Pixel IDs are public (visible in page source),
// so this is a safe default; override with META_PIXEL_ID if it ever changes.
// NOTE: loaded only after consent — see shmLoadPixels below.
const META = (process.env.META_PIXEL_ID || '679724066324304').trim();
const TT = (process.env.TIKTOK_PIXEL_ID || '').trim();
const SITE_ID = (process.env.SITE_ID || 'strawhut-media').trim();

const j = (s) => String(s || '').replace(/[^A-Za-z0-9_-]/g, ''); // hard-sanitize IDs

export function trackingEnabled() {
  return !!(GTM || GA4 || ADS || META || TT);
}

/** Scripts for <head> — analytics libraries + a unified shmTrack() event helper. */
export function trackingHead() {
  // Stamp `site` into the dataLayer BEFORE GTM loads, so every tag/trigger and
  // GA event can see which property it came from.
  // Google Consent Mode v2 — REQUIRED before any Google tag loads. Everything
  // non-essential starts DENIED, so no advertising/analytics cookies are set
  // until the visitor opts in. `wait_for_update` gives the banner a moment to
  // apply a stored choice before tags decide. Google tags respect this
  // automatically; Meta/TikTok are withheld entirely until consent (below).
  let out = `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',personalization_storage:'denied',functionality_storage:'granted',security_storage:'granted',wait_for_update:500});
(function(){var G={ad_storage:'granted',ad_user_data:'granted',ad_personalization:'granted',analytics_storage:'granted',personalization_storage:'granted'};
var c=null;try{c=localStorage.getItem('shm_consent');}catch(e){}
if(c==='all'){gtag('consent','update',G);return;}
if(c==='essential')return;
// No stored choice: grant immediately OUTSIDE opt-in jurisdictions so the very
// first pageview is measured. Done here in <head>, before Google's tags load,
// rather than in the footer banner — otherwise the initial pageview is sent
// under 'denied' and lost. UK/EEA/CH stays denied until explicit acceptance.
try{var tz=(Intl.DateTimeFormat().resolvedOptions().timeZone||'');
var eu=/^(Europe|Atlantic\/(Azores|Madeira|Canary|Faroe|Reykjavik))/.test(tz);
if(!eu)gtag('consent','update',G);}catch(e){}})();
window.dataLayer.push({site:'${j(SITE_ID)}'});</script>`;

  if (GTM) {
    out += `<!-- Google Tag Manager --><script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],k=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';k.async=true;k.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(k,f);})(window,document,'script','dataLayer','${j(GTM)}');</script>`;
  }

  const gtagIds = [GA4, ADS].filter(Boolean).map(j);
  if (gtagIds.length) {
    out += `<script async src="https://www.googletagmanager.com/gtag/js?id=${gtagIds[0]}"></script>
<script>gtag('js',new Date());${gtagIds.map((id) => `gtag('config','${id}');`).join('')}</script>`;
  }

  // Meta and TikTok have no consent-mode equivalent, so they are not loaded at
  // all until the visitor accepts. shmLoadPixels() is called by the banner.
  const deferred = [];
  if (META) deferred.push(`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${j(META)}');fbq('track','PageView');`);
  if (TT) deferred.push(`!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.load=function(e){var n="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=n;ttq._t=ttq._t||{};ttq._t[e]=+new Date;var o=d.createElement("script");o.type="text/javascript";o.async=!0;o.src=n+"?sdkid="+e+"&lib="+t;var a=d.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('${j(TT)}');ttq.page();}(window,document,'ttq');`);
  out += `<script>window.shmLoadPixels=function(){if(window.__shmPixels)return;window.__shmPixels=1;${deferred.join('')}};
try{if(localStorage.getItem('shm_consent')==='all')window.shmLoadPixels();}catch(e){}</script>`;

  // Unified event helper: pushes to dataLayer (GTM/GA4) AND mirrors to Meta +
  // TikTok so a single call fans out to every platform for conversions/audiences.
  out += `<script>window.SHM_SITE='${j(SITE_ID)}';window.shmTrack=function(ev,params){params=Object.assign({site:window.SHM_SITE},params||{});try{(window.dataLayer=window.dataLayer||[]).push(Object.assign({event:ev},params));}catch(e){}try{if(window.gtag)gtag('event',ev,params);}catch(e){}try{if(window.fbq)fbq('trackCustom',ev,params);}catch(e){}try{if(window.ttq)ttq.track(ev,params);}catch(e){}};</script>`;
  return out;
}

/** GTM <noscript> for immediately after <body>. */
export function trackingBody() {
  return GTM
    ? `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${j(GTM)}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`
    : '';
}

/** Cookie-consent banner. Rendered on every public page; self-dismisses once a
 *  choice is stored. Rejecting leaves Consent Mode at "denied" and never loads
 *  the Meta/TikTok pixels, so no advertising cookies are written. */
export function consentBanner() {
  return `<div id="shm-consent" class="consent-bar" role="dialog" aria-live="polite" aria-label="Cookie consent" hidden>
  <div class="consent-inner">
    <p>We use cookies to understand how the site is used and to show you relevant
       Straw Hut Media ads. You can accept, or continue with only the cookies
       needed to make the site work. See our <a href="/privacy">privacy policy</a>.</p>
    <div class="consent-actions">
      <button type="button" class="btn btn-ghost btn-sm" id="shm-consent-no">Essential only</button>
      <button type="button" class="btn btn-primary btn-sm" id="shm-consent-yes">Accept all</button>
    </div>
  </div>
</div>
<script>(function(){var el=document.getElementById('shm-consent');if(!el)return;
var stored=null;try{stored=localStorage.getItem('shm_consent');}catch(e){}
// Where opt-IN is legally required (UK/EEA + Switzerland), nothing runs until the
// visitor accepts. Everywhere else (notably the US, where the standard is opt-OUT)
// tracking is on by default and the bar acts as notice with an opt-out — which is
// both compliant there and keeps the retargeting audience intact.
function needsOptIn(){
  try{
    var tz=(Intl.DateTimeFormat().resolvedOptions().timeZone||'');
    if(/^(Europe|Atlantic\/(Azores|Madeira|Canary|Faroe|Reykjavik))/.test(tz)) return true;
    var l=(navigator.languages||[navigator.language||'']).join(',');
    return /\b(en-GB|en-IE|de|fr|es|it|nl|pt|pl|sv|da|fi|no|cs|sk|hu|ro|bg|hr|sl|et|lv|lt|el|mt|ga)\b/i.test(l)
      && !/\ben-US\b/i.test(l);
  }catch(e){ return true; } // fail closed
}
if(!stored){
  if(needsOptIn()){
    el.hidden=false;                    // opt-in region: stay denied until accepted
  } else {
    try{gtag('consent','update',{ad_storage:'granted',ad_user_data:'granted',ad_personalization:'granted',analytics_storage:'granted',personalization_storage:'granted'});}catch(e){}
    try{window.shmLoadPixels&&window.shmLoadPixels();}catch(e){}
    el.classList.add('consent-notice');  // notice + opt-out, not a blocker
    el.hidden=false;
  }
}
function choose(v){try{localStorage.setItem('shm_consent',v);}catch(e){}
  if(v==='all'){try{gtag('consent','update',{ad_storage:'granted',ad_user_data:'granted',ad_personalization:'granted',analytics_storage:'granted',personalization_storage:'granted'});}catch(e){}
    try{window.shmLoadPixels&&window.shmLoadPixels();}catch(e){}}
  el.hidden=true;}
document.getElementById('shm-consent-yes').addEventListener('click',function(){choose('all');});
document.getElementById('shm-consent-no').addEventListener('click',function(){choose('essential');});
window.shmOpenConsent=function(){el.hidden=false;};})();</script>`;
}

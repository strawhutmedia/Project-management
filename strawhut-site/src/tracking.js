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
const META = (process.env.META_PIXEL_ID || '').trim();
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
  let out = `<script>window.dataLayer=window.dataLayer||[];window.dataLayer.push({site:'${j(SITE_ID)}'});</script>`;

  if (GTM) {
    out += `<!-- Google Tag Manager --><script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],k=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';k.async=true;k.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(k,f);})(window,document,'script','dataLayer','${j(GTM)}');</script>`;
  }

  const gtagIds = [GA4, ADS].filter(Boolean).map(j);
  if (gtagIds.length) {
    out += `<script async src="https://www.googletagmanager.com/gtag/js?id=${gtagIds[0]}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());${gtagIds.map((id) => `gtag('config','${id}');`).join('')}</script>`;
  }

  if (META) {
    out += `<!-- Meta Pixel --><script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${j(META)}');fbq('track','PageView');</script>`;
  }

  if (TT) {
    out += `<!-- TikTok Pixel --><script>!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.load=function(e){var n="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=n;ttq._t=ttq._t||{};ttq._t[e]=+new Date;var o=d.createElement("script");o.type="text/javascript";o.async=!0;o.src=n+"?sdkid="+e+"&lib="+t;var a=d.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('${j(TT)}');ttq.page();}(window,document,'ttq');</script>`;
  }

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

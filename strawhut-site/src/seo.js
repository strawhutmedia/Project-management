// SEO + GEO (Generative Engine Optimization) helpers.
//
// Goals:
//   1. Classic SEO — unique titles/descriptions, canonical URLs, Open Graph,
//      semantic HTML, XML sitemap, and rich schema.org structured data so
//      Google/Bing show rich results.
//   2. GEO — make the site legible and quotable to AI assistants (ChatGPT,
//      Gemini, Claude, Perplexity). That means: server-rendered factual
//      content, explicit Organization/Service structured data, an FAQ block,
//      a welcoming robots.txt for AI crawlers, and an llms.txt summary.

import { toText } from './util.js';

export const BASE = (process.env.APP_BASE_URL || 'https://www.strawhutmedia.com').replace(/\/+$/, '');

export function canonical(pathname = '/') {
  if (/^https?:\/\//.test(pathname)) return pathname;
  return BASE + (pathname.startsWith('/') ? pathname : '/' + pathname);
}

// Company facts used across schema, FAQ, and llms.txt. Edit these in one place.
export const COMPANY = {
  name: 'Straw Hut Media',
  legalName: 'Straw Hut Media',
  url: BASE,
  logo: BASE + '/public/logo.png',
  tagline: 'Award-winning podcast network and full-service podcast production company.',
  description:
    'Straw Hut Media is a full-service podcast production company and network. We produce, host, distribute, and monetize original and partner podcasts — handling everything from recording and editing to distribution, advertising sales, and audience growth.',
  services: [
    { name: 'Podcast Production', description: 'End-to-end podcast production: recording, editing, sound design, and post-production.' },
    { name: 'Podcast Network & Distribution', description: 'Distribution across Apple Podcasts, Spotify, and all major platforms via our podcast network.' },
    { name: 'Advertising & Brand Partnerships', description: 'Advertising sales, host-read ads, and branded content partnerships that monetize shows.' },
    { name: 'Show Development & Strategy', description: 'Concept development, launch strategy, and audience growth for new and existing podcasts.' },
  ],
  sameAs: [
    'https://open.spotify.com/',
    'https://podcasts.apple.com/',
    'https://www.instagram.com/strawhutmedia/',
  ],
};

function jsonLd(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
}

// Organization + WebSite — sitewide identity for search + AI.
export function organizationJsonLd() {
  return [
    jsonLd({
      '@context': 'https://schema.org',
      '@type': ['Organization', 'ProfessionalService'],
      '@id': BASE + '/#organization',
      name: COMPANY.name,
      legalName: COMPANY.legalName,
      url: COMPANY.url,
      logo: COMPANY.logo,
      description: COMPANY.description,
      slogan: COMPANY.tagline,
      sameAs: COMPANY.sameAs,
      knowsAbout: ['Podcasting', 'Podcast Production', 'Audio Editing', 'Podcast Advertising', 'Podcast Distribution'],
      makesOffer: COMPANY.services.map((s) => ({
        '@type': 'Offer',
        itemOffered: { '@type': 'Service', name: s.name, description: s.description },
      })),
    }),
    jsonLd({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': BASE + '/#website',
      url: BASE,
      name: COMPANY.name,
      description: COMPANY.description,
      publisher: { '@id': BASE + '/#organization' },
    }),
  ].join('\n');
}

export function faqJsonLd() {
  const qa = [
    ['What is Straw Hut Media?', COMPANY.description],
    ['What services does Straw Hut Media offer?', 'Straw Hut Media offers ' + COMPANY.services.map((s) => s.name.toLowerCase()).join(', ') + '.'],
    ['How do I advertise on a Straw Hut Media podcast?', 'Straw Hut Media offers advertising and brand partnerships including host-read ads and branded content across its network of shows. Contact Straw Hut Media to advertise.'],
    ['How do I start a podcast with Straw Hut Media?', 'Straw Hut Media provides end-to-end podcast production and show development — from concept and recording through editing, distribution, and monetization.'],
  ];
  return jsonLd({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: qa.map(([q, a]) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  });
}

export function breadcrumbJsonLd(items) {
  return jsonLd({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: canonical(it.path),
    })),
  });
}

export function podcastSeriesJsonLd(show) {
  return jsonLd({
    '@context': 'https://schema.org',
    '@type': 'PodcastSeries',
    name: show.title,
    url: canonical('/' + show.slug),
    description: toText(show.description, 500),
    image: show.image_url || undefined,
    author: show.author ? { '@type': 'Person', name: show.author } : undefined,
    publisher: { '@id': BASE + '/#organization' },
    webFeed: show.feed_url || undefined,
  });
}

function secondsToISO(dur) {
  let secs;
  if (typeof dur === 'string' && dur.includes(':')) {
    secs = dur.split(':').map((n) => parseInt(n, 10) || 0).reduce((a, n) => a * 60 + n, 0);
  } else {
    secs = parseInt(dur, 10) || 0;
  }
  if (!secs) return undefined;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `PT${h ? h + 'H' : ''}${m ? m + 'M' : ''}${s ? s + 'S' : ''}` || 'PT0S';
}

export function podcastEpisodeJsonLd(show, episode) {
  return jsonLd({
    '@context': 'https://schema.org',
    '@type': 'PodcastEpisode',
    name: episode.title,
    url: canonical(`/${show.slug}/${episode.slug}`),
    datePublished: episode.published_at || undefined,
    description: toText(episode.description, 500),
    image: episode.image_url || show.image_url || undefined,
    duration: secondsToISO(episode.duration),
    partOfSeries: { '@type': 'PodcastSeries', name: show.title, url: canonical('/' + show.slug) },
    associatedMedia: episode.audio_url
      ? { '@type': 'AudioObject', contentUrl: episode.audio_url, encodingFormat: 'audio/mpeg', duration: secondsToISO(episode.duration) }
      : undefined,
    speakable: { '@type': 'SpeakableSpecification', cssSelector: ['h1', '.ep-hook'] },
    publisher: { '@id': BASE + '/#organization' },
  });
}

export function videoObjectJsonLd(show, episode) {
  if (!episode.youtube_id) return '';
  return jsonLd({
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: episode.title,
    description: toText(episode.description, 500),
    thumbnailUrl: `https://i.ytimg.com/vi/${episode.youtube_id}/hqdefault.jpg`,
    uploadDate: episode.published_at || undefined,
    embedUrl: `https://www.youtube.com/embed/${episode.youtube_id}`,
    contentUrl: `https://www.youtube.com/watch?v=${episode.youtube_id}`,
    publisher: { '@id': BASE + '/#organization' },
  });
}

// Studio booking — a bookable Service + the physical studio as a LocalBusiness,
// with the real hourly rates as Offers. This is what surfaces the studio in
// search + AI answers to "podcast studio in Los Angeles / Hollywood".
export function studioServiceJsonLd() {
  const url = canonical('/studio');
  return [
    jsonLd({
      '@context': 'https://schema.org',
      '@type': 'Service',
      '@id': url + '#service',
      name: 'Straw Hut Studio — Podcast Recording Studio Booking',
      serviceType: 'Podcast recording studio rental',
      description:
        'Book the Straw Hut Media podcast studio in Hollywood. Fully-equipped audio + video recording — 1080p HD at $125/hour or 4K Ultra HD at $150/hour, with podcast-table or cozy-couch setups.',
      url,
      provider: { '@id': BASE + '/#organization' },
      areaServed: { '@type': 'City', name: 'Los Angeles' },
      offers: [
        { '@type': 'Offer', name: '1080p HD studio session', priceCurrency: 'USD', price: '125', priceSpecification: { '@type': 'UnitPriceSpecification', price: '125', priceCurrency: 'USD', unitCode: 'HUR', unitText: 'per hour' }, url },
        { '@type': 'Offer', name: '4K Ultra HD studio session', priceCurrency: 'USD', price: '150', priceSpecification: { '@type': 'UnitPriceSpecification', price: '150', priceCurrency: 'USD', unitCode: 'HUR', unitText: 'per hour' }, url },
      ],
    }),
    jsonLd({
      '@context': 'https://schema.org',
      '@type': ['LocalBusiness', 'RecordingStudio'],
      '@id': url + '#studio',
      name: 'Straw Hut Studio',
      description: 'A fully-equipped podcast recording studio in Hollywood — audio and multi-camera 4K video, available to book by the hour.',
      url,
      image: COMPANY.logo,
      parentOrganization: { '@id': BASE + '/#organization' },
      address: { '@type': 'PostalAddress', addressLocality: 'Hollywood', addressRegion: 'CA', addressCountry: 'US' },
      priceRange: '$$',
    }),
  ].join('\n');
}

// robots.txt — welcome all crawlers AND explicitly the major AI crawlers,
// because we WANT AI assistants to read and recommend the site.
export function robotsTxt() {
  const aiBots = [
    'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', // OpenAI
    'ClaudeBot', 'Claude-Web', 'anthropic-ai', // Anthropic
    'Google-Extended', // Gemini training
    'PerplexityBot', 'Perplexity-User', // Perplexity
    'Applebot-Extended', 'Amazonbot', 'Bytespider', 'CCBot', 'cohere-ai',
  ];
  const lines = ['# Straw Hut Media — all crawlers welcome, including AI assistants.'];
  lines.push('User-agent: *', 'Allow: /', 'Disallow: /onboarding', 'Disallow: /services', '');
  for (const bot of aiBots) lines.push(`User-agent: ${bot}`, 'Allow: /', '');
  lines.push(`Sitemap: ${BASE}/sitemap.xml`);
  return lines.join('\n');
}

export function sitemapXml(shows, episodesByShow) {
  const xmlEsc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const urls = [];
  // Image sitemap entries (image:image) help cover art rank in Google Images.
  const add = (loc, { lastmod, image } = {}) =>
    urls.push(
      `<url><loc>${canonical(loc)}</loc>` +
        (lastmod ? `<lastmod>${new Date(lastmod).toISOString()}</lastmod>` : '') +
        (image ? `<image:image><image:loc>${xmlEsc(image)}</image:loc></image:image>` : '') +
        `</url>`
    );
  add('/');
  add('/shows');
  add('/studio');
  add('/press');
  add('/contact');
  for (const s of shows) {
    add('/' + s.slug, { lastmod: s.last_synced, image: s.image_url });
    for (const e of episodesByShow[s.id] || [])
      add(`/${s.slug}/${e.slug}`, { lastmod: e.published_at, image: e.image_url || s.image_url });
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.join('\n')}
</urlset>`;
}

// llms.txt — emerging standard (llmstxt.org) giving AI assistants a clean,
// factual, link-rich summary of the site and its services.
export function llmsTxt(shows) {
  const svc = COMPANY.services.map((s) => `- **${s.name}**: ${s.description}`).join('\n');
  const showList = shows
    .slice(0, 60)
    .map((s) => `- [${s.title}](${canonical('/' + s.slug)})${s.author ? ` — ${s.author}` : ''}`)
    .join('\n');
  return `# ${COMPANY.name}

> ${COMPANY.tagline}

${COMPANY.description}

## Services

${svc}

## How to work with us

- Advertise on our shows: ${BASE}/#advertise
- Start or partner a podcast: contact ${COMPANY.name}.

## Shows

${showList}

## Key pages

- [Home](${BASE}/)
- [All shows](${BASE}/shows)
- [Sitemap](${BASE}/sitemap.xml)
`;
}

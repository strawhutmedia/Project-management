// Pitch documents — standalone, confidential development pitches served at
// /pitch/<slug> (noindex, unlisted; the URL is shared privately with buyers).
//
// Deliberately NOT rendered through layout(): a pitch is a document with its
// own editorial identity, not a page of the marketing site. It carries no nav,
// no footer, no tracking, and never enters the sitemap — same posture as the
// hidden /onboarding page.

import { esc } from './util.js';

// Section kinds an admin can compose. Each renders one block of the document.
// 'body' is a textarea whose expected format depends on the kind — the admin
// form shows the per-kind hint below.
export const PITCH_SECTION_KINDS = {
  text: {
    label: 'Text',
    hint: 'Prose. Blank line = new paragraph. Inline HTML like <strong> and <em> is allowed. First paragraph is set larger when the section has a heading.',
  },
  stats: {
    label: 'Stat tiles',
    hint: 'One stat per line: value | label   (e.g. "1.4B | International trips taken every year")',
  },
  episodes: {
    label: 'Episode guide',
    hint: 'One episode per block, blocks separated by a blank line. Line 1: title. Line 2: era/kicker. Rest: synopsis. A line starting with "Interviews:" is styled as the interview slate. A block starting with "INTRO:" renders as a paragraph above the list; one starting with "NOTE:" as a small note below it.',
  },
  cards: {
    label: 'Cards',
    hint: 'One card per block, blocks separated by a blank line. Line 1: card title. Line 2 (optional): small label — prefix it with "~" to mark it. Rest: card body.',
  },
  chips: {
    label: 'Chips',
    hint: 'One chip per line (e.g. alternate titles). Prose typed above a lone "---" line renders as an intro paragraph.',
  },
};

// Per-pitch visual identities. Every pitch picks one ("Look & feel" in the
// admin form); the structural components are shared, but palette, typography,
// and the cover mark change so two pitches never read as the same document.
export const PITCH_THEMES = {
  expedition: {
    label: 'Expedition (classic serif, brass & pine)',
    fontsHref:
      'https://fonts.googleapis.com/css2?family=Marcellus&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&family=Archivo:wght@500;600;700&display=swap',
    fontDisplay: 'Marcellus,Georgia,serif',
    fontBody: '"Source Serif 4",Georgia,"Times New Roman",serif',
    fontLabel: 'Archivo,system-ui,sans-serif',
    displayWeight: '400',
    displayTracking: '.04em',
    mark: 'compass',
    light: {
      paper: '#EFEDE3', 'paper-raised': '#F6F4EC', ink: '#1F2A25', 'ink-soft': '#4A554F',
      pine: '#2E5B4B', 'pine-deep': '#1E3D33', brass: '#A07526',
      line: '#CFCBBA', 'line-soft': '#DEDACB', route: '#B8B29C',
      card: '#F6F4EC', 'card-border': '#D8D4C4', 'tag-bg': '#E4E1D2',
    },
    dark: {
      paper: '#111B16', 'paper-raised': '#16231D', ink: '#EAE5D3', 'ink-soft': '#A8AFA3',
      pine: '#8FB8A5', 'pine-deep': '#A8CCBB', brass: '#D9A544',
      line: '#2C3A32', 'line-soft': '#243128', route: '#3E5045',
      card: '#16231D', 'card-border': '#2C3A32', 'tag-bg': '#1E2D25',
    },
  },
  pride: {
    label: 'Pride (Rainbow Media Co — pink, sky blue & rainbow)',
    fontsHref:
      'https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800&family=Epilogue:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap',
    fontDisplay: 'Montserrat,system-ui,-apple-system,sans-serif',
    fontBody: 'Epilogue,system-ui,-apple-system,"Segoe UI",sans-serif',
    fontLabel: 'Montserrat,system-ui,-apple-system,sans-serif',
    displayWeight: '800',
    displayTracking: '-.01em',
    mark: 'rainbow',
    light: {
      paper: '#FFFFFF', 'paper-raised': '#F8F7F9', ink: '#16181D', 'ink-soft': '#5A5F66',
      pine: '#4DB2EC', 'pine-deep': '#B71B53', brass: '#D62264',
      line: '#E3E2E7', 'line-soft': '#EDECF0', route: '#CBCDD5',
      card: '#F8F7F9', 'card-border': '#E3E2E7', 'tag-bg': '#FBE3ED',
    },
    dark: {
      paper: '#131118', 'paper-raised': '#1B1922', ink: '#F2F0EA', 'ink-soft': '#A8A5B0',
      pine: '#64C2F5', 'pine-deep': '#FF7FA8', brass: '#FF5C93',
      line: '#2C2935', 'line-soft': '#242130', route: '#443F52',
      card: '#1B1922', 'card-border': '#2C2935', 'tag-bg': '#3A2230',
    },
    // The rainbow itself: a pride ribbon across the top, a rainbow rule on the
    // cover, and stat numbers / list markers cycling through the six stripes.
    extraCss: `
  body::before{content:"";display:block;height:6px;background:linear-gradient(90deg,#FF4338,#FF6B00,#E5A81B,#2FB673,#4DB2EC,#B44FD6)}
  .rule{width:96px;height:4px;border-radius:2px;background:linear-gradient(90deg,#FF4338,#FF6B00,#E5A81B,#2FB673,#4DB2EC,#B44FD6)}
  .stat:nth-child(6n+1) .n{color:#FF4338}
  .stat:nth-child(6n+2) .n{color:#FF6B00}
  .stat:nth-child(6n+3) .n{color:#CE9310}
  .stat:nth-child(6n+4) .n{color:#22995F}
  .stat:nth-child(6n+5) .n{color:#2492D6}
  .stat:nth-child(6n+6) .n{color:#B44FD6}
  .stop:nth-child(6n+1) .marker{border-color:#FF4338;color:#FF4338}
  .stop:nth-child(6n+2) .marker{border-color:#FF6B00;color:#FF6B00}
  .stop:nth-child(6n+3) .marker{border-color:#CE9310;color:#CE9310}
  .stop:nth-child(6n+4) .marker{border-color:#22995F;color:#22995F}
  .stop:nth-child(6n+5) .marker{border-color:#2492D6;color:#2492D6}
  .stop:nth-child(6n+6) .marker{border-color:#B44FD6;color:#B44FD6}
    `,
  },
  studio: {
    label: 'Studio (bold modern, olive & amber)',
    fontsHref:
      'https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@600;700;800&family=Public+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap',
    fontDisplay: '"Big Shoulders Display",Impact,system-ui,sans-serif',
    fontBody: '"Public Sans",system-ui,-apple-system,"Segoe UI",sans-serif',
    fontLabel: '"IBM Plex Mono",ui-monospace,SFMono-Regular,monospace',
    displayWeight: '700',
    displayTracking: '.015em',
    mark: 'waveform',
    light: {
      paper: '#EEF0E7', 'paper-raised': '#F8F9F3', ink: '#1B1E19', 'ink-soft': '#5B6058',
      pine: '#3F6B7A', 'pine-deep': '#2E525F', brass: '#C9791E',
      line: '#D9DACD', 'line-soft': '#E2E3D7', route: '#C2C4B2',
      card: '#F8F9F3', 'card-border': '#D9DACD', 'tag-bg': '#E9D3AC',
    },
    dark: {
      paper: '#14181A', 'paper-raised': '#1B2022', ink: '#ECE9E0', 'ink-soft': '#9AA098',
      pine: '#7FB0BF', 'pine-deep': '#9CC4D0', brass: '#F0A94A',
      line: '#2C3234', 'line-soft': '#262C2E', route: '#3A4245',
      card: '#1B2022', 'card-border': '#2C3234', 'tag-bg': '#4A3A22',
    },
  },
};

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

const blocksOf = (body) =>
  String(body || '')
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

// Prose helper: HTML paragraphs pass through; plain text gets wrapped, with
// inline tags (<strong>/<em>/<a>) preserved because admins author this.
function paragraphs(body, { lead = false } = {}) {
  const src = String(body || '').trim();
  if (!src) return '';
  if (/<\s*(p|div|ul|ol|h\d)\b/i.test(src)) return src;
  return blocksOf(src)
    .map((b, i) => `<p${lead && i === 0 ? ' class="big"' : ''}>${b.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

function renderText(s) {
  return `<div class="prose">${paragraphs(s.body, { lead: !!s.heading })}</div>`;
}

function renderStats(s) {
  const tiles = String(s.body || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [n, ...rest] = l.split('|');
      return `<div class="stat"><div class="n">${esc((n || '').trim())}</div><div class="l">${esc(rest.join('|').trim())}</div></div>`;
    })
    .join('');
  return `<div class="stats">${tiles}</div>`;
}

function renderEpisodes(s) {
  const all = blocksOf(s.body);
  const intro = all.filter((b) => b.startsWith('INTRO:')).map((b) => b.slice(6).trim());
  const notes = all.filter((b) => b.startsWith('NOTE:')).map((b) => b.slice(5).trim());
  const stops = all
    .filter((b) => !b.startsWith('INTRO:') && !b.startsWith('NOTE:'))
    .map((block, i) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      const title = lines.shift() || '';
      const era = lines.shift() || '';
      const gets = lines.filter((l) => /^interviews:/i.test(l));
      const body = lines.filter((l) => !/^interviews:/i.test(l));
      return `<li class="stop">
        <div class="marker">${esc(ROMAN[i] || String(i + 1))}</div>
        <h3>${esc(title)}</h3>
        ${era ? `<p class="era">${esc(era)}</p>` : ''}
        ${body.length ? `<p>${body.map(esc).join(' ')}</p>` : ''}
        ${gets.map((g) => `<p class="gets">${esc(g)}</p>`).join('')}
      </li>`;
    })
    .join('');
  return `${intro.length ? `<div class="prose">${intro.map((t) => `<p>${esc(t)}</p>`).join('')}</div>` : ''}
<ol class="route-list">${stops}</ol>
${notes.map((t) => `<p class="route-note">${esc(t)}</p>`).join('')}`;
}

function renderCards(s) {
  const cards = blocksOf(s.body)
    .map((block) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      const title = lines.shift() || '';
      let sub = '';
      if (lines[0] && lines[0].startsWith('~')) sub = lines.shift().slice(1).trim();
      return `<div class="tier">
        <h3>${esc(title)}</h3>
        ${sub ? `<p class="sub">${esc(sub)}</p>` : ''}
        ${lines.length ? `<p>${lines.map(esc).join(' ')}</p>` : ''}
      </div>`;
    })
    .join('');
  return `<div class="tiers">${cards}</div>`;
}

function renderChips(s) {
  const src = String(s.body || '').replace(/\r\n/g, '\n');
  let intro = '';
  let chipSrc = src;
  const parts = src.split('\n---\n');
  if (parts.length > 1) {
    intro = parts[0];
    chipSrc = parts.slice(1).join('\n');
  }
  const chips = chipSrc
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l !== '---')
    .map((l) => `<span>${esc(l)}</span>`)
    .join('');
  return `${intro ? `<div class="prose">${paragraphs(intro)}</div>` : ''}<div class="alt-titles">${chips}</div>`;
}

const RENDERERS = { text: renderText, stats: renderStats, episodes: renderEpisodes, cards: renderCards, chips: renderChips };

function renderSection(s) {
  const render = RENDERERS[s.kind] || renderText;
  return `<section>
    ${s.eyebrow ? `<p class="eyebrow">${esc(s.eyebrow)}</p>` : ''}
    ${s.heading ? `<h2>${esc(s.heading)}</h2>` : ''}
    ${render(s)}
  </section>`;
}

const tokenBlock = (vars) =>
  Object.entries(vars).map(([k, v]) => `--${k}:${v};`).join('');

function coverMark(kind) {
  if (kind === 'rainbow') {
    const stripes = ['#FF4338', '#FF6B00', '#E5A81B', '#2FB673', '#4DB2EC', '#B44FD6'];
    const arcs = stripes
      .map((c, i) => {
        const r = 44 - i * 6;
        return `<path d="M ${50 - r} 52 A ${r} ${r} 0 0 1 ${50 + r} 52" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round"/>`;
      })
      .join('');
    return `<svg class="mark" viewBox="0 0 100 56" role="img" aria-label="Rainbow">${arcs}</svg>`;
  }
  if (kind === 'waveform') {
    const heights = [16, 30, 22, 40, 28, 44, 34, 24, 38, 18, 42, 26, 36, 20];
    const bars = heights
      .map((h, i) => `<rect x="${i * 6}" y="${46 - h}" width="4" height="${h}" rx="1" fill="${i % 3 === 0 ? 'var(--brass)' : 'var(--pine)'}"/>`)
      .join('');
    return `<svg class="mark" viewBox="0 0 82 46" role="img" aria-label="Audio waveform">${bars}</svg>`;
  }
  return `<svg class="mark" viewBox="0 0 80 80" role="img" aria-label="Compass rose">
    <circle cx="40" cy="40" r="37" fill="none" stroke="var(--brass)" stroke-width="1.5"/>
    <circle cx="40" cy="40" r="30" fill="none" stroke="var(--route)" stroke-width="1" stroke-dasharray="2 4"/>
    <polygon points="40,8 45,40 40,48 35,40" fill="var(--pine)"/>
    <polygon points="40,72 35,40 40,32 45,40" fill="var(--brass)"/>
    <circle cx="40" cy="40" r="3.5" fill="var(--ink)"/>
  </svg>`;
}

export function pitchPage({ pitch }) {
  const theme = PITCH_THEMES[pitch.theme] || PITCH_THEMES.expedition;
  const metaPills = String(pitch.meta_tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => `<span>${esc(t)}</span>`)
    .join('');
  const sections = (pitch.sections || []).map(renderSection).join('\n');
  const hasContact = pitch.contact_name || pitch.contact_email || pitch.contact_phone;
  const description = String(pitch.logline || '').slice(0, 300);

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pitch.title)} — a pitch from Straw Hut Media</title>
<meta name="robots" content="noindex, nofollow">
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(pitch.title)}">
<meta property="og:description" content="${esc(description)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="${theme.fontsHref}">
<style>
  :root{
    ${tokenBlock(theme.light)}
    --font-display:${theme.fontDisplay};
    --font-body:${theme.fontBody};
    --font-label:${theme.fontLabel};
    --display-weight:${theme.displayWeight};
    --display-tracking:${theme.displayTracking};
  }
  @media (prefers-color-scheme: dark){
    :root{ ${tokenBlock(theme.dark)} }
  }
  *{box-sizing:border-box}
  body{background:var(--paper);color:var(--ink);font-family:var(--font-body);font-size:17px;line-height:1.65;margin:0}
  .wrap{max-width:920px;margin:0 auto;padding:0 22px}
  .prose{max-width:680px}
  .prose > *{min-width:0}
  h1,h2,h3{font-family:var(--font-display);font-weight:var(--display-weight);line-height:1.12;text-wrap:balance;margin:0}
  h2{font-size:clamp(26px,4.4vw,38px);margin-bottom:22px}
  .eyebrow{font-family:var(--font-label);font-weight:600;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--brass);margin:0 0 14px}
  p{margin:0 0 1em}
  p.big{font-size:19px}
  .prose ul{margin:0 0 1em;padding-left:2px;list-style:none;display:grid;gap:10px}
  .prose ul li{padding-left:26px;position:relative}
  .prose ul li::before{content:"";position:absolute;left:2px;top:.62em;width:12px;height:2px;background:var(--brass)}
  section{padding:64px 0;border-top:1px solid var(--line-soft)}
  section > :last-child{margin-bottom:0}

  .cover{padding:84px 0 72px;text-align:center}
  .cover .studio{font-family:var(--font-label);font-weight:600;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:var(--ink-soft);margin:0 0 34px}
  .mark{width:70px;height:auto;max-height:70px;margin:0 auto 28px;display:block}
  .cover h1{font-size:clamp(44px,9vw,92px);letter-spacing:var(--display-tracking)}
  .cover .wt{font-family:var(--font-label);font-weight:600;font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:var(--ink-soft);margin:10px 0 28px}
  .cover .logline{font-size:20px;line-height:1.55;max-width:620px;margin:0 auto;font-style:italic}
  .cover .meta{display:flex;justify-content:center;gap:12px;flex-wrap:wrap;margin-top:34px;font-family:var(--font-label);font-size:12.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
  .cover .meta span{border:1px solid var(--card-border);border-radius:999px;padding:8px 16px;background:var(--card);color:var(--ink-soft)}
  .rule{width:56px;height:2px;background:var(--brass);border:none;margin:32px auto 0}

  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);margin-top:34px}
  .stat{background:var(--paper-raised);padding:20px 18px;min-width:0}
  .stat .n{font-family:var(--font-display);font-weight:var(--display-weight);font-size:32px;color:var(--pine-deep);font-variant-numeric:tabular-nums;line-height:1.1}
  .stat .l{font-family:var(--font-label);font-size:12.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-soft);margin-top:8px;line-height:1.45}

  .route-list{list-style:none;margin:40px 0 0;padding:0;position:relative}
  .route-list::before{content:"";position:absolute;left:21px;top:24px;bottom:24px;width:0;border-left:2px dotted var(--route)}
  .stop{position:relative;padding:0 0 32px 64px;min-width:0}
  .stop:last-child{padding-bottom:0}
  .stop .marker{position:absolute;left:0;top:0;width:44px;height:44px;border-radius:50%;background:var(--paper);border:2px solid var(--pine);color:var(--pine-deep);display:flex;align-items:center;justify-content:center;font-family:var(--font-display);font-weight:var(--display-weight);font-size:17px}
  .stop h3{font-size:22px}
  .stop .era{font-family:var(--font-label);font-size:11.5px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--brass);margin:3px 0 10px}
  .stop p{max-width:640px;margin-bottom:.4em}
  .stop .gets{font-size:15px;color:var(--ink-soft);font-style:italic}
  .route-note{margin:30px 0 0;font-size:15px;color:var(--ink-soft);font-style:italic}

  .tiers{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:18px;margin-top:34px}
  .tier{background:var(--card);border:1px solid var(--card-border);padding:24px 22px;min-width:0}
  .tier h3{font-size:20px;margin-bottom:6px}
  .tier .sub{font-family:var(--font-label);font-size:12px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--brass);margin-bottom:12px}
  .tier p{font-size:15.5px;color:var(--ink-soft);margin-bottom:0}

  .alt-titles{display:flex;flex-wrap:wrap;gap:10px;margin-top:6px}
  .alt-titles span{font-family:var(--font-display);font-weight:var(--display-weight);font-size:16px;border:1px solid var(--card-border);background:var(--tag-bg);padding:8px 18px;border-radius:999px}

  .close{padding:72px 0 40px;text-align:center;border-top:1px solid var(--line-soft)}
  .close .contact{margin:0 auto;max-width:520px;background:var(--card);border:1px solid var(--card-border);padding:26px 26px}
  .close .who{font-family:var(--font-display);font-weight:var(--display-weight);font-size:22px}
  .close .co{font-family:var(--font-label);font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--brass);margin:4px 0 14px}
  .close .lines{font-size:16px;color:var(--ink-soft);overflow-wrap:anywhere}
  .close a{color:var(--pine-deep);text-decoration:none;border-bottom:1px solid var(--route)}
  .close a:focus-visible{outline:2px solid var(--brass);outline-offset:2px}
  .footnote{text-align:center;font-family:var(--font-label);font-size:11.5px;letter-spacing:.06em;color:var(--ink-soft);padding:26px 22px 40px}
${theme.extraCss || ''}
</style>
</head><body>
<header class="cover wrap">
  ${pitch.eyebrow ? `<p class="studio">${esc(pitch.eyebrow)}</p>` : ''}
  ${coverMark(theme.mark)}
  <h1>${esc(pitch.title)}</h1>
  ${pitch.working_title ? '<p class="wt">Working title</p>' : ''}
  ${pitch.logline ? `<p class="logline">${esc(pitch.logline)}</p>` : ''}
  ${metaPills ? `<div class="meta">${metaPills}</div>` : ''}
  <hr class="rule">
</header>
<main class="wrap">
${sections}
</main>
${hasContact ? `<footer class="close wrap">
  <p class="eyebrow" style="text-align:center">Contact</p>
  <div class="contact">
    ${pitch.contact_name ? `<div class="who">${esc(pitch.contact_name)}</div>` : ''}
    ${pitch.contact_company ? `<div class="co">${esc(pitch.contact_company)}</div>` : ''}
    <div class="lines">
      ${pitch.contact_email ? `<a href="mailto:${esc(pitch.contact_email)}">${esc(pitch.contact_email)}</a>` : ''}
      ${pitch.contact_email && pitch.contact_phone ? ' &nbsp;·&nbsp; ' : ''}
      ${pitch.contact_phone ? esc(pitch.contact_phone) : ''}
    </div>
  </div>
</footer>` : ''}
${pitch.footer_note ? `<p class="footnote">${esc(pitch.footer_note)}</p>` : ''}
</body></html>`;
}

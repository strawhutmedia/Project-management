#!/usr/bin/env node
/**
 * Mobile-first audit harness.
 *
 * Most visitors reach this site on a phone, so a change isn't done until it has
 * been looked at on a phone. This renders real pages in headless Chromium at
 * handset widths and reports what a phone user would actually hit.
 *
 *   node tools/mobile-audit.mjs                     # audit the live site
 *   node tools/mobile-audit.mjs --base http://localhost:8080
 *   node tools/mobile-audit.mjs --shot home         # also save screenshots
 *
 * Remote images are downloaded and rewritten to local files, so pages render
 * with real cover art even where the sandbox can't reach the CDN from inside
 * the browser. Requires: npx playwright + a chromium build on disk.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'https://www.strawhutmedia.com').replace(/\/$/, '');
const SHOT = arg('--shot', '');
const WIDTHS = (arg('--widths', '390') || '390').split(',').map(Number);
const OUT = arg('--out', '/tmp/mobile-audit');
const CHROME = process.env.CHROMIUM_PATH ||
  ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome']
    .find(p => fs.existsSync(p));

// Things that are wider than the viewport on purpose (scrolling strips,
// blurred backdrops) or deliberately miniature (the phone-player mockup).
const WIDE_OK = /marquee|fb-bg|hero-wave|footer-wave/;
const TINY_OK = /^(span\.ph-|em$|div\.ph-)/;

const PAGES = ['/', '/shows', '/studio', '/contact', '/pricing', '/press', '/resources',
  '/podcast-production', '/advertise', '/privacy', '/book'];

const curl = (u) => { try { return execFileSync('curl', ['-sS', '-L', '--max-time', '30', u], { maxBuffer: 1 << 28 }); } catch { return Buffer.alloc(0); } };

fs.mkdirSync(`${OUT}/pages`, { recursive: true });
fs.mkdirSync(`${OUT}/assets`, { recursive: true });

function snapshot(route) {
  const name = route === '/' ? 'home' : route.replace(/^\//, '').replace(/[^\w-]/g, '_');
  let html = curl(BASE + route).toString();
  if (!html.trim()) return null;
  const css = curl(BASE + '/styles.css').toString();
  for (const url of [...new Set([...html.matchAll(/<img[^>]+src="(https?:\/\/[^"]+)"/g)].map(m => m[1]))].slice(0, 90)) {
    const h = createHash('sha1').update(url).digest('hex').slice(0, 16);
    const ext = (url.split('?')[0].match(/\.(jpe?g|png|gif|webp|svg)$/i) || [, 'jpg'])[1];
    const file = `${h}.${ext}`;
    const abs = `${OUT}/assets/${file}`;
    if (!fs.existsSync(abs) || !fs.statSync(abs).size) { const d = curl(url); if (d.length < 200) continue; fs.writeFileSync(abs, d); }
    html = html.split(`"${url}"`).join(`"../assets/${file}"`);
  }
  // Same-origin assets (the logo, favicons) need localising too, or screenshots
  // show alt text where the brand mark should be and you can't trust your eyes.
  for (const rel of [...new Set([...html.matchAll(/(?:src|href)="(\/[\w./-]+\.(?:png|jpe?g|gif|webp|svg|ico))"/g)].map(m => m[1]))]) {
    const file = rel.replace(/[^\w.-]/g, '_');
    const abs = `${OUT}/assets/${file}`;
    if (!fs.existsSync(abs) || !fs.statSync(abs).size) { const d = curl(BASE + rel); if (d.length < 100) continue; fs.writeFileSync(abs, d); }
    html = html.split(`"${rel}"`).join(`"../assets/${file}"`);
  }
  html = html.replace(/<link rel="stylesheet" href="\/styles\.css[^"]*">/, `<style>${css}</style>`);
  const file = `${OUT}/pages/${name}.html`;
  fs.writeFileSync(file, html);
  return { name, file };
}

const findings = (vw) => {
  const out = { overflow: document.documentElement.scrollWidth - vw, wide: [], tiny: [], taps: [] };
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height || b.left < -1000) continue;
    const cls = typeof el.className === 'string' ? el.className : '';
    const id = el.tagName.toLowerCase() + (cls ? '.' + cls.trim().split(/\s+/).slice(0, 2).join('.') : '');
    const txt = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 2);
    if (b.right > vw + 1.5 && !seen.has('w' + id)) { seen.add('w' + id); out.wide.push(id); }
    const fs2 = parseFloat(cs.fontSize);
    if (txt && fs2 < 11.5 && !seen.has('f' + id)) { seen.add('f' + id); out.tiny.push(`${id} ${fs2.toFixed(1)}px`); }
    if ((el.tagName === 'A' || el.tagName === 'BUTTON') && txt && b.height < 32 &&
        cs.display !== 'inline' && !seen.has('t' + id)) { seen.add('t' + id); out.taps.push(`${id} h${Math.round(b.height)}`); }
  }
  return out;
};

const b = await chromium.launch({ executablePath: CHROME });
let total = 0;
for (const route of PAGES) {
  const snap = snapshot(route);
  if (!snap) { console.log(`✗ ${route} — could not fetch`); continue; }
  for (const width of WIDTHS) {
    const ctx = await b.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await ctx.route('**/*', r => r.request().url().startsWith('file://') ? r.continue() : r.abort());
    const p = await ctx.newPage();
    await p.goto('file://' + snap.file, { waitUntil: 'load' });
    await p.waitForTimeout(900);
    await p.evaluate(() => scrollTo(0, document.body.scrollHeight));
    await p.waitForTimeout(900);
    const r = await p.evaluate(findings, width);
    r.wide = r.wide.filter(x => !WIDE_OK.test(x));
    r.tiny = r.tiny.filter(x => !TINY_OK.test(x));
    const n = (r.overflow > 0 ? 1 : 0) + r.wide.length + r.tiny.length + r.taps.length;
    total += n;
    console.log(`${n ? '⚠' : '✓'} ${snap.name.padEnd(20)} ${width}px  ` +
      `scroll:${(r.overflow > 0 ? r.overflow + 'px' : 'ok').padEnd(6)} wide:${String(r.wide.length).padEnd(3)} tiny:${String(r.tiny.length).padEnd(3)} taps:${r.taps.length}`);
    for (const [k, v] of [['wide', r.wide], ['tiny', r.tiny], ['taps', r.taps]])
      if (v.length) console.log(`     ${k}: ${v.slice(0, 5).join(', ')}`);
    if (SHOT && snap.name === SHOT) {
      const h = await p.evaluate(() => document.body.scrollHeight);
      for (let i = 0; i * 844 < Math.min(h, 844 * 6); i++) {
        await p.evaluate(y => scrollTo(0, y), i * 844);
        await p.waitForTimeout(700);
        await p.screenshot({ path: `${OUT}/${snap.name}-${width}-${i}.png` });
      }
      console.log(`     screenshots -> ${OUT}/${snap.name}-${width}-*.png`);
    }
    await ctx.close();
  }
}
console.log(`\n${total} finding(s). Screenshots and snapshots under ${OUT}`);
await b.close();

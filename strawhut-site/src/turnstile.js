// Cloudflare Turnstile — a CAPTCHA that almost never asks the visitor to do
// anything. Approved by Ryan as an addition to the stack (2026-08-22).
//
// Two rules shape this integration:
//
//  1. It loads ONLY on pages that contain a form. There is no hook in
//     layout(); the script tag is emitted next to the widget, so a page with
//     no form never pays for it.
//
//  2. A missing token never blocks on its own. Ad blockers, locked-down
//     corporate proxies and Cloudflare outages all produce a missing token for
//     a real person. Only a token that Cloudflare actively *rejects* is
//     treated as proof of a bot.

const SITE_KEY = (process.env.TURNSTILE_SITE_KEY || '').trim();
const SECRET_KEY = (process.env.TURNSTILE_SECRET_KEY || '').trim();
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const VERIFY_TIMEOUT_MS = 6000;

/** Inert until both keys are set on Railway, so nothing breaks before then. */
export function turnstileConfigured() {
  return Boolean(SITE_KEY && SECRET_KEY);
}

/**
 * Markup + loader for one form. Returns '' when unconfigured, so callers can
 * interpolate it unconditionally.
 *
 * @param {object}  opts
 * @param {boolean} opts.lazy   Load the Turnstile script on first interaction
 *                              with the form rather than on page load. Use on
 *                              pages whose main job isn't the form (the
 *                              homepage subscribe box).
 * @param {string}  opts.action Label shown in Cloudflare's analytics.
 */
export function turnstileWidget({ lazy = false, action = 'form' } = {}) {
  if (!turnstileConfigured()) return '';
  const id = 'ts_' + Math.random().toString(36).slice(2, 10);
  const j = (s) => JSON.stringify(String(s));
  return `<div class="cf-turnstile-slot" id="${id}"${lazy ? ' hidden' : ''}></div>
<script>(function(){
var el=document.getElementById(${j(id)});if(!el)return;
var form=el.closest('form');if(!form)return;
var solved=false,pending=false,started=false;
var btn=form.querySelector('button[type=submit],button:not([type])');
var btnText=btn?btn.textContent:'';
function done(){solved=true;if(pending){pending=false;if(btn){btn.disabled=false;btn.textContent=btnText;}
if(form.requestSubmit)form.requestSubmit();else form.submit();}}
function render(){if(!window.turnstile)return;el.hidden=false;
window.turnstile.render(el,{sitekey:${j(SITE_KEY)},action:${j(action)},theme:'dark',size:'flexible',
callback:done,'error-callback':function(){done();},'expired-callback':function(){solved=false;}});}
function load(){if(started)return;started=true;
if(window.turnstile)return render();
(window.__cfTsQueue=window.__cfTsQueue||[]).push(render);
if(document.getElementById('cf-ts-api'))return;
window.__cfTsOnload=function(){(window.__cfTsQueue||[]).forEach(function(f){f();});window.__cfTsQueue=[];};
var s=document.createElement('script');s.id='cf-ts-api';s.async=true;s.defer=true;
s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__cfTsOnload';
s.onerror=function(){done();};document.head.appendChild(s);}
${lazy ? "form.addEventListener('focusin',load,{once:true});" : 'load();'}
// If the visitor submits before the challenge finishes, hold the submit and
// send it the moment it does — never make them click twice.
form.addEventListener('submit',function(e){
if(solved||!started)return;
e.preventDefault();pending=true;
if(btn){btn.disabled=true;btn.textContent='One moment\\u2026';}
setTimeout(function(){if(pending){pending=false;if(btn){btn.disabled=false;btn.textContent=btnText;}
if(form.requestSubmit)form.requestSubmit();else form.submit();}},8000);
});
})();</script>`;
}

/**
 * Ask Cloudflare whether a token is genuine.
 * @returns {Promise<{status:'ok'|'failed'|'missing'|'unreachable', codes:string[]}>}
 *   'failed'      — Cloudflare rejected it. Real evidence of a bot.
 *   'missing'     — no token came back. Ambiguous; do not block on this alone.
 *   'unreachable' — we couldn't reach Cloudflare. Always fail open.
 */
export async function verifyTurnstile(token, ip = '') {
  if (!turnstileConfigured()) return { status: 'ok', codes: [] };
  if (!token) return { status: 'missing', codes: [] };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), VERIFY_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({ secret: SECRET_KEY, response: token });
    if (ip) params.set('remoteip', ip);
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
      signal: ctrl.signal,
    });
    if (!res.ok) return { status: 'unreachable', codes: [`http-${res.status}`] };
    const data = await res.json();
    return data.success
      ? { status: 'ok', codes: [] }
      : { status: 'failed', codes: data['error-codes'] || [] };
  } catch (e) {
    // Cloudflare down, DNS hiccup, timeout — never cost us a real lead.
    return { status: 'unreachable', codes: [e.name === 'AbortError' ? 'timeout' : e.message] };
  } finally {
    clearTimeout(timer);
  }
}

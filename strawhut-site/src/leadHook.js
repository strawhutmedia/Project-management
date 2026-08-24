// Inbound lead webhook — turns the emails Outbound Labs / Appointlet send when a
// discovery call is booked into GoHighLevel contacts, automatically.
//
// How the emails get here: a small Google Apps Script running in Ryan's own
// Gmail (see docs/OUTBOUND_LABS_GMAIL_SYNC.md) finds the booking emails and
// POSTs each one's raw {from, subject, body} to POST /hooks/leads?token=…
// This keeps inbox access on Ryan's side — the server never logs into Gmail —
// and the server just parses and upserts. Idempotent: GHL upserts by email, so
// re-sending the same booking updates the same contact rather than duplicating.
//
// Two email shapes are understood:
//   • Appointlet "Scheduled"/"Rescheduled" (notifications@appointlet.com) — the
//     RICH one: carries the questionnaire (marketing spend, podcast status,
//     goals) that drives qualification.
//   • Outbound Labs "New Result" (admin@outboundlabs.com) — the SOFT one: the
//     AI-SDR engagement summary, attached as prep context.

import { upsertContact, ghlConfigured } from './ghl.js';

const clean = (s) => String(s || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();
const firstEmail = (text) => {
  // Skip the sender/platform addresses; we want the prospect's.
  const skip = /@(appointlet\.com|strawhutmedia\.com|outboundlabs\.com)$/i;
  const all = [...String(text).matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((m) => m[0]);
  return all.find((e) => !skip.test(e)) || null;
};

// "$1k - $5k Month", "Less than $1k", "$5k+", "$10,000/mo" → a qualification tag.
// Ryan's rule: under $1k/mo of marketing spend is not a qualified lead.
function qualifyBySpend(spendText) {
  const s = clean(spendText).toLowerCase();
  if (!s) return 'needs-qualification';
  if (/less than\s*\$?\s*1\s*k|under\s*\$?\s*1\s*k|<\s*\$?\s*1\s*k|\$?\s*0\s*-\s*\$?\s*1\s*k/.test(s)) {
    return 'unqualified-under-1k';
  }
  // Any figure that reads as >= $1k/month clears the bar.
  if (/\$?\s*(1|2|3|4|5|6|7|8|9|10|[1-9]\d)\s*k|\$?\s*[1-9][\d,]{3,}/.test(s)) return null; // qualified
  return 'needs-qualification';
}

function parseAppointlet(subject, body) {
  const b = String(body || '');
  // Ignore cancellations outright.
  if (/^cancell?ed:/i.test(subject)) return null;
  // Name: from the subject ("Scheduled: NAME - Straw Hut…"); reschedules omit it,
  // so fall back to the name that sits just before the prospect's email in body.
  let name = (subject.match(/^(?:re-?scheduled|scheduled):\s*(.+?)\s*-\s*Straw Hut/i) || [])[1] || '';
  const email = firstEmail(b);
  if (!email) return null;
  if (!name) {
    const around = b.match(new RegExp('([A-Za-z][A-Za-z.\\-\' ]{1,60}?)\\s*' + email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    name = around ? clean(around[1]) : '';
  }
  const grab = (label) => {
    const m = b.match(new RegExp(label + '[^\\n]*\\n+\\s*([^\\n|]+)', 'i'));
    return m ? clean(m[1]) : '';
  };
  const company = grab('Company Name');
  const spend = grab('spending on marketing');
  const status = grab('podcasting status');
  // Goals are a bulleted list under the goal question.
  let goals = '';
  const goalBlock = b.match(/podcasting goal\?[^\n]*\n+([\s\S]*?)(?:\n\s*\n|Do you need|Cancel|Reschedule|$)/i);
  if (goalBlock) {
    goals = goalBlock[1].split('\n').map((l) => clean(l.replace(/^[*•\-]\s*/, ''))).filter(Boolean).join(', ');
  }
  const when = clean((b.match(/([A-Z][a-z]{2},\s*[A-Z][a-z]+\.?\s*\d{1,2},\s*\d{4}[^\n|]*?(?:a\.?m\.?|p\.?m\.?)[^\n|]*)/) || [])[1]);
  const qual = qualifyBySpend(spend);
  const tags = ['appointlet', 'outbound-labs', qual].filter(Boolean);
  const message = [
    'Source: Outbound Labs → Appointlet booking.',
    company && `Company: ${company}`,
    spend && `Marketing spend: ${spend}`,
    status && `Podcast status: ${status}`,
    goals && `Goals: ${goals}`,
    when && `Call: ${when}`,
    qual === 'unqualified-under-1k' && 'FLAG: under $1k/mo — not qualified per Ryan\'s rule.',
    qual === 'needs-qualification' && 'Spend not detected — verify before the call.',
  ].filter(Boolean).join('\n');
  return { name, email, company, tags, source: 'Outbound Labs (Appointlet)', message };
}

function parseOutboundLabs(subject, body) {
  const b = String(body || '');
  if (!/new result/i.test(subject)) return null;
  const email = firstEmail(b);
  if (!email) return null;
  const info = b.match(/Lead Info:\*?\s*(.+?)\s*\(([^)]*)\)\s*at\s*(.+?)\s*-/is);
  const name = info ? clean(info[1]) : '';
  const company = info ? clean(info[3]) : '';
  const summary = clean((b.match(/AI Engagement Summary:\*?\s*([\s\S]*?)➡️/i) || [])[1]).slice(0, 1200);
  const tags = ['outbound-labs', 'needs-qualification'];
  const message = [
    'Source: Outbound Labs cold outreach (AI SDR booked a call).',
    summary && `Engagement summary: ${summary}`,
    'Verify marketing spend + goals from the Appointlet questionnaire to qualify.',
  ].filter(Boolean).join('\n');
  return { name, email, company, tags, source: 'Outbound Labs', message };
}

// Returns the parsed lead, or null if this email isn't a booking we handle.
export function parseLeadEmail({ from = '', subject = '', body = '' } = {}) {
  const f = String(from).toLowerCase();
  if (f.includes('appointlet.com')) return parseAppointlet(subject, body);
  if (f.includes('outboundlabs.com')) return parseOutboundLabs(subject, body);
  // Unknown sender: try Appointlet shape first (richer), then Outbound Labs.
  return parseAppointlet(subject, body) || parseOutboundLabs(subject, body);
}

// Express handler for POST /hooks/leads?token=… (also accepts X-Lead-Token header).
export async function handleLeadHook(req, res) {
  const expected = (process.env.LEAD_HOOK_TOKEN || '').trim();
  if (!expected) return res.status(503).json({ ok: false, error: 'lead hook disabled (no LEAD_HOOK_TOKEN)' });
  const got = String(req.query.token || req.get('x-lead-token') || '').trim();
  if (got !== expected) return res.status(401).json({ ok: false, error: 'bad token' });

  const { from, subject, body } = req.body || {};
  const lead = parseLeadEmail({ from, subject, body });
  if (!lead || !lead.email) {
    return res.json({ ok: true, skipped: true, reason: 'not a recognized booking email' });
  }
  if (!ghlConfigured()) {
    return res.json({ ok: true, parsed: { email: lead.email, name: lead.name, tags: lead.tags }, note: 'GHL not configured — parsed only' });
  }
  const r = await upsertContact({
    name: lead.name,
    email: lead.email,
    company: lead.company,
    message: lead.message,
    tags: lead.tags,
    source: lead.source,
  });
  return res.json({ ok: !!r.ok, id: r.id || null, email: lead.email, tags: lead.tags, error: r.error || undefined });
}

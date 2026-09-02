// Amazon SES bounce/complaint feedback → live counters + auto-suppression.
//
// SES publishes Bounce / Complaint / Delivery events to an SNS topic, which
// POSTs them to /api/ses/notify. We tally them in app_state so the in-flight
// newsletter send can watch its own bounce rate and pause itself if it spikes,
// and so /api/newsletter/status can show live deliverability. A permanent
// bounce or a complaint also removes that address from the list immediately, so
// we never mail it again (protecting sender reputation).
//
// Security: we only act on messages whose TopicArn matches SES_SNS_TOPIC_ARN
// (set once the topic exists). Worst case of a spoofed message is removing a
// subscriber — recoverable — but the ARN gate keeps out random noise.

async function bump(store, key, n) {
  if (!n) return;
  const cur = parseInt((await store.getState(key)) || '0', 10) || 0;
  await store.setState(key, String(cur + n));
}

async function suppress(store, emails) {
  if (!emails?.length) return;
  const set = new Set(emails.map((e) => String(e).trim().toLowerCase()));
  const subs = await store.listSubscribers();
  for (const s of subs) {
    if (set.has(String(s.email).toLowerCase())) {
      await store.removeSubscriber(s.id).catch(() => {});
    }
  }
}

/** Handle one SNS delivery (raw JSON string or parsed object). */
export async function handleSnsMessage(store, rawBody) {
  let msg;
  try { msg = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody; }
  catch { return { ok: false, reason: 'bad json' }; }

  const expect = process.env.SES_SNS_TOPIC_ARN;
  if (expect && msg.TopicArn && msg.TopicArn !== expect) return { ok: false, reason: 'topic mismatch' };

  // Auto-confirm the subscription the first time SNS handshakes.
  if (msg.Type === 'SubscriptionConfirmation' && msg.SubscribeURL) {
    await fetch(msg.SubscribeURL).catch(() => {});
    return { ok: true, confirmed: true };
  }

  if (msg.Type === 'Notification') {
    let ev;
    try { ev = JSON.parse(msg.Message); } catch { ev = msg.Message || {}; }
    const type = ev.notificationType || ev.eventType;
    if (type === 'Bounce') {
      const permanent = ev.bounce?.bounceType === 'Permanent';
      const recips = (ev.bounce?.bouncedRecipients || []).map((r) => r.emailAddress).filter(Boolean);
      await bump(store, 'ses_bounces', permanent ? recips.length || 1 : 0);
      await bump(store, 'ses_soft_bounces', permanent ? 0 : recips.length || 1);
      if (permanent) await suppress(store, recips);
    } else if (type === 'Complaint') {
      const recips = (ev.complaint?.complainedRecipients || []).map((r) => r.emailAddress).filter(Boolean);
      await bump(store, 'ses_complaints', recips.length || 1);
      await suppress(store, recips);
    } else if (type === 'Delivery') {
      await bump(store, 'ses_deliveries', (ev.delivery?.recipients || []).length || 1);
    }
    return { ok: true, type };
  }
  return { ok: true, ignored: msg.Type };
}

/** Live deliverability snapshot for the current/most-recent send. */
export async function deliverabilityStats(store) {
  const n = async (k) => parseInt((await store.getState(k)) || '0', 10) || 0;
  const [sent, bounces, soft, complaints, deliveries] = await Promise.all([
    n('ses_send_total'), n('ses_bounces'), n('ses_soft_bounces'), n('ses_complaints'), n('ses_deliveries'),
  ]);
  return {
    sent, hardBounces: bounces, softBounces: soft, complaints, deliveries,
    bounceRate: sent ? +(bounces / sent).toFixed(4) : 0,
    complaintRate: sent ? +(complaints / sent).toFixed(4) : 0,
  };
}

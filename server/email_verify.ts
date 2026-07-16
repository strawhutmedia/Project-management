// In-house recipient-email verification — no third-party service.
//
// We validate two cheap, high-signal things before a cold-outreach
// campaign is allowed to send to an address:
//   1. Syntax — is it even shaped like an email?
//   2. Deliverability of the DOMAIN — does it publish MX records (i.e.
//      can it receive mail at all)? A missing MX with a live A record is
//      "risky"; a domain that doesn't resolve is "invalid".
//
// This catches typos and dead/fake domains — the bulk of what bounces —
// without confirming the specific mailbox exists (that needs an SMTP
// probe or a paid verifier, which we deliberately don't do here).

import { promises as dns } from 'dns'

export type EmailCheckStatus = 'valid' | 'risky' | 'invalid'
export type EmailCheck = { status: EmailCheckStatus; detail: string }

// Mirrors the add/import validation so "would this even be accepted" and
// "is it deliverable" agree on what a well-formed address looks like.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

// Throwaway inbox providers — a real guest never uses these, and they
// tank deliverability stats, so we reject outright.
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com',
  'temp-mail.org', 'trashmail.com', 'yopmail.com', 'throwawaymail.com',
  'getnada.com', 'sharklasers.com', 'maildrop.cc', 'fakeinbox.com',
])

// DNS answers are stable for the length of a verify run and many
// prospects share a domain (everyone at one company), so cache per
// process. Cleared naturally on redeploy.
const domainCache = new Map<string, EmailCheckStatus>()

// DNS lookups occasionally hang; cap each so a verify run can't stall.
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('dns_timeout')), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    clearTimeout(timer!)
  }
}

async function hasARecord(domain: string): Promise<boolean> {
  try {
    const a = await withTimeout(dns.resolve(domain), 5_000)
    return a.length > 0
  } catch {
    return false
  }
}

async function classifyDomain(domain: string): Promise<EmailCheckStatus> {
  const cached = domainCache.get(domain)
  if (cached) return cached
  let status: EmailCheckStatus
  try {
    const mx = await withTimeout(dns.resolveMx(domain), 5_000)
    if (mx.length > 0 && mx.some((r) => r.exchange && r.exchange.trim())) {
      status = 'valid'
    } else {
      status = (await hasARecord(domain)) ? 'risky' : 'invalid'
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      // No MX at all — deliverable only if the domain itself resolves.
      status = (await hasARecord(domain)) ? 'risky' : 'invalid'
    } else {
      // Timeout / SERVFAIL / transient — don't condemn the address on a
      // flaky lookup; mark risky so the operator can decide.
      status = 'risky'
    }
  }
  domainCache.set(domain, status)
  return status
}

function detailFor(status: EmailCheckStatus, domain: string): string {
  switch (status) {
    case 'valid': return `${domain} accepts mail (MX records found)`
    case 'risky': return `${domain} has no mail server (MX) — delivery not guaranteed`
    case 'invalid': return `${domain} doesn't resolve — undeliverable`
  }
}

export async function checkEmail(email: string): Promise<EmailCheck> {
  const addr = email.trim().toLowerCase()
  if (!EMAIL_RE.test(addr)) {
    return { status: 'invalid', detail: 'Not a valid email address format' }
  }
  const domain = addr.split('@')[1]
  if (DISPOSABLE.has(domain)) {
    return { status: 'invalid', detail: 'Disposable / temporary email domain' }
  }
  const status = await classifyDomain(domain)
  return { status, detail: detailFor(status, domain) }
}

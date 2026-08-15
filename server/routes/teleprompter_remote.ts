// Phone-as-remote for the teleprompter.
//
// The iPad running the prompter opens an SSE "host" stream and gets a short
// pairing code. Anyone's phone then opens /r (a plain public web page — no
// app) and POSTs button presses to that code; the server relays them to the
// host stream in real time.
//
//   GET  /api/teleprompter/remote/stream?suggest=CODE  (login)  → SSE host
//   POST /api/teleprompter/remote/:code/cmd            (public) → send button
//   GET  /api/teleprompter/remote/:code/status         (public) → is host live
//
// In-memory, single-instance (same model as events.ts). Codes are ephemeral —
// they exist only while the prompter's stream is open — and the only thing a
// code lets you do is press play/pause/speed on that one session, so a short
// human-typeable code is an acceptable shared secret.

import { Router } from 'express'
import type { Response } from 'express'
import { requireUser } from '../auth'

// No ambiguous characters (0/O, 1/I) — easy to read off a screen and type.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const ACTIONS = new Set(['playpause', 'faster', 'slower', 'bigger', 'smaller', 'restart', 'exit', 'start'])

type Channel = { code: string; res: Response; createdAt: number }
const channels = new Map<string, Channel>()

function randomCode(len = 4): string {
  let s = ''
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return s
}

function uniqueCode(suggest?: string): string {
  if (suggest && /^[A-Z2-9]{4,6}$/.test(suggest) && !channels.has(suggest)) return suggest
  let c = randomCode()
  let tries = 0
  while (channels.has(c) && tries < 100) {
    c = randomCode()
    tries++
  }
  return c
}

export const teleprompterRemoteRouter = Router()

// Host stream — the iPad prompter connects here to RECEIVE button presses.
// Requires login (the prompter is already behind Slate auth).
teleprompterRemoteRouter.get('/stream', requireUser, (req, res) => {
  const suggest = typeof req.query.suggest === 'string' ? req.query.suggest.toUpperCase() : ''
  const code = uniqueCode(suggest)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  const channel: Channel = { code, res, createdAt: Date.now() }
  channels.set(code, channel)
  res.write(`event: code\ndata: ${JSON.stringify({ code })}\n\n`)

  const heartbeat = setInterval(() => {
    try {
      res.write(': hb\n\n')
    } catch {
      /* closed; close handler cleans up */
    }
  }, 25_000)

  req.on('close', () => {
    clearInterval(heartbeat)
    // Only delete if this exact channel still owns the code (avoid clobbering
    // a reconnect that reclaimed the same code).
    if (channels.get(code) === channel) channels.delete(code)
  })
})

// Phone → prompter. PUBLIC, scoped by the ephemeral code.
teleprompterRemoteRouter.post('/:code/cmd', (req, res) => {
  const code = (req.params.code || '').toUpperCase()
  const action = typeof req.body?.action === 'string' ? req.body.action : ''
  if (!ACTIONS.has(action)) {
    res.status(400).json({ error: 'bad_action' })
    return
  }
  const ch = channels.get(code)
  if (!ch) {
    res.status(404).json({ error: 'no_channel' })
    return
  }
  try {
    ch.res.write(`event: cmd\ndata: ${JSON.stringify({ action, at: Date.now() })}\n\n`)
  } catch {
    /* host connection dropped; it'll be cleaned up on close */
  }
  res.json({ ok: true })
})

// Phone checks whether a prompter is actually listening on this code.
teleprompterRemoteRouter.get('/:code/status', (req, res) => {
  const code = (req.params.code || '').toUpperCase()
  res.json({ ok: true, connected: channels.has(code) })
})

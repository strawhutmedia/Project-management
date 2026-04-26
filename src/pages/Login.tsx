import { useState } from 'react'
import { api } from '../api'

export default function Login() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('sending')
    setError(null)
    try {
      await api.requestLogin(email.trim())
      setStatus('sent')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'something went wrong')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-5">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted mb-2">
            Straw Hut Media presents
          </p>
          <h1 className="font-display text-7xl text-rainbow leading-none">SLATE</h1>
          <p className="text-muted text-sm mt-3">Sign in with a magic link.</p>
        </div>

        {status === 'sent' ? (
          <div className="rounded-2xl border border-stage-mixing/40 bg-stage-mixing/10 p-6 text-center">
            <div className="text-3xl mb-2">📬</div>
            <h2 className="font-display text-2xl mb-1 text-stage-mixing">Check your email</h2>
            <p className="text-sm text-muted">
              If an account exists for <span className="text-text">{email}</span>, a sign-in link is on
              its way. Link expires in 15 minutes.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@strawhutmedia.com"
              className="w-full rounded-xl bg-panel/60 border border-line text-text px-4 py-3 outline-none focus:border-stage-mastering"
            />
            <button
              type="submit"
              disabled={status === 'sending' || !email}
              className="w-full rounded-xl bg-gradient-to-r from-stage-producing to-stage-mastering text-white font-bold uppercase tracking-wider text-sm px-4 py-3 disabled:opacity-50"
            >
              {status === 'sending' ? 'Sending…' : 'Send magic link'}
            </button>
            {error && <p className="text-urgent text-sm text-center">{error}</p>}
            <p className="text-[11px] text-muted text-center pt-2">
              Slate is invite-only. If you don't have an account, ask Ryan.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, type ApiDropboxStatus } from '../api'
import { useAuth } from '../auth'

export default function Settings() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [status, setStatus] = useState<ApiDropboxStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const justConnected = params.get('dropbox') === 'connected'

  async function load() {
    setLoading(true)
    try {
      setStatus(await api.dropboxStatus())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    if (justConnected) {
      const t = setTimeout(() => setParams({}, { replace: true }), 5000)
      return () => clearTimeout(t)
    }
  }, [justConnected, setParams])

  if (!user) return null
  const isAdmin = user.role === 'admin'

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="font-display text-5xl text-rainbow">Settings</h1>
        <p className="text-muted text-sm mt-1">Workspace integrations and admin controls.</p>
      </div>

      <section className="rounded-2xl border border-line bg-panel/60 p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="font-display text-2xl">📦 Dropbox</h2>
            <p className="text-sm text-muted mt-1">
              Connect Straw Hut's Dropbox so file lists and uploads sync per-song.
            </p>
          </div>
          {status?.connected && (
            <span className="text-[11px] uppercase tracking-wider text-stage-done bg-stage-done/10 border border-stage-done/40 rounded-full px-2.5 py-1 font-bold whitespace-nowrap">
              ✓ Connected
            </span>
          )}
        </div>

        {justConnected && (
          <div className="mb-4 rounded-xl border border-stage-done/40 bg-stage-done/10 text-stage-done p-3 text-sm">
            🎉 Dropbox connected!
          </div>
        )}

        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : !status?.configured ? (
          <p className="text-sm text-urgent">
            Dropbox not configured. <code>DROPBOX_APP_KEY</code> and{' '}
            <code>DROPBOX_APP_SECRET</code> need to be set on the Railway service.
          </p>
        ) : status.connected ? (
          <div className="space-y-3">
            <p className="text-sm">
              Connected as{' '}
              <span className="text-text font-semibold">
                {status.accountName ?? 'Dropbox account'}
              </span>
              .
            </p>
            {isAdmin && (
              <button
                onClick={async () => {
                  if (!confirm('Disconnect Dropbox? File lists will stop loading until reconnected.')) return
                  await api.dropboxDisconnect()
                  await load()
                }}
                className="text-sm text-urgent border border-urgent/40 rounded-full px-3 py-1.5"
              >
                Disconnect
              </button>
            )}
          </div>
        ) : isAdmin ? (
          <a
            href="/api/integrations/dropbox/connect"
            className="inline-block rounded-xl bg-gradient-to-r from-stage-stems to-stage-mixing text-white font-bold uppercase tracking-wider text-sm px-4 py-2.5 hover:opacity-90"
          >
            Connect Dropbox
          </a>
        ) : (
          <p className="text-sm text-muted">Only admins can connect Dropbox.</p>
        )}
      </section>

      {!isAdmin && (
        <p className="text-[11px] text-muted">
          Some settings are admin-only. Ask Ryan if you need access to something here.
        </p>
      )}
    </div>
  )
}

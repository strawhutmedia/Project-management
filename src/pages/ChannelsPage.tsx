import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api, type ApiChannelSummary } from '../api'

// Top-level list of faceless YouTube channels — a separate workspace from
// the album/podcast/film projects on the Dashboard.
export default function ChannelsPage() {
  const [channels, setChannels] = useState<ApiChannelSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .channels()
      .then(({ channels }) => setChannels(channels))
      .catch((err) => setError(err instanceof Error ? err.message : 'failed to load'))
  }, [])

  return (
    <div className="space-y-8">
      <section>
        <h1 className="font-display text-6xl mb-2 text-rainbow">Channels</h1>
        <p className="text-muted text-sm max-w-xl">
          Faceless YouTube shows — a recurring character, a locked art style, and weekly
          episodes. Everything here is written and ready to paste into your AI video tool.
        </p>
      </section>

      {error && <div className="text-sm text-urgent">{error}</div>}
      {!channels && !error && <div className="text-sm text-muted">Loading…</div>}

      {channels && channels.length === 0 && (
        <div className="text-sm text-muted">No channels yet.</div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {channels?.map((c) => (
          <Link
            key={c.id}
            to={`/channels/${c.id}`}
            className="block rounded-2xl border border-line bg-panel/60 p-5 hover:border-stage-mastering/60 transition"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl">🐙</span>
              <h2 className="font-display text-2xl text-text">{c.name}</h2>
            </div>
            {c.subtitle && <p className="text-sm text-muted mb-3">{c.subtitle}</p>}
            {c.premise && <p className="text-xs text-muted/80 line-clamp-3 mb-3">{c.premise}</p>}
            <div className="flex gap-3 text-[11px] uppercase tracking-wider text-muted">
              <span>{c.episodeCount} episode{c.episodeCount === 1 ? '' : 's'}</span>
              <span>·</span>
              <span>{c.characterCount} character{c.characterCount === 1 ? '' : 's'}</span>
              {c.audience && (
                <>
                  <span>·</span>
                  <span>{c.audience}</span>
                </>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

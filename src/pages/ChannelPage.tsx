import { Link, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api, type ApiChannelDetail } from '../api'
import CopyButton from '../components/CopyButton'

// One channel: its locked art style, the recurring cast (each with a
// copy-ready "look lock" block), and the episode list.
export default function ChannelPage() {
  const { channelId } = useParams<{ channelId: string }>()
  const [channel, setChannel] = useState<ApiChannelDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!channelId) return
    api
      .channel(channelId)
      .then(({ channel }) => setChannel(channel))
      .catch((err) => setError(err instanceof Error ? err.message : 'failed to load'))
  }, [channelId])

  if (error) return <div className="text-sm text-urgent">{error}</div>
  if (!channel) return <div className="text-sm text-muted">Loading…</div>

  return (
    <div className="space-y-10">
      <section>
        <Link to="/channels" className="text-[11px] uppercase tracking-wider text-muted hover:text-text">
          ← Channels
        </Link>
        <div className="flex items-center gap-3 mt-2">
          <span className="text-4xl">🐙</span>
          <h1 className="font-display text-5xl text-rainbow">{channel.name}</h1>
        </div>
        {channel.subtitle && <p className="text-muted mt-1">{channel.subtitle}</p>}
        {channel.audience && (
          <span className="inline-block mt-3 text-[11px] uppercase tracking-wider text-muted border border-line rounded-full px-2.5 py-1">
            {channel.audience}
          </span>
        )}
        {channel.premise && <p className="text-sm text-muted/90 max-w-2xl mt-4">{channel.premise}</p>}
      </section>

      {channel.artStyle && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-display text-2xl text-text">🎨 Locked art style</h2>
            <CopyButton text={channel.artStyle} label="Copy style" />
          </div>
          <p className="text-xs text-muted mb-2">Paste this once into your AI video tool to lock the look.</p>
          <pre className="whitespace-pre-wrap text-sm text-text/90 bg-panel/60 border border-line rounded-2xl p-4 font-sans">
            {channel.artStyle}
          </pre>
        </section>
      )}

      <section>
        <h2 className="font-display text-2xl text-text mb-3">The cast</h2>
        <div className="space-y-4">
          {channel.characters.map((c) => (
            <div key={c.id} className="rounded-2xl border border-line bg-panel/60 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-display text-xl text-text">{c.name}</span>
                  {c.role && <span className="ml-2 text-[11px] uppercase tracking-wider text-muted">{c.role}</span>}
                </div>
                {c.lookLock && <CopyButton text={c.lookLock} label="Copy look" />}
              </div>
              {c.personality && <p className="text-sm text-muted mt-2">{c.personality}</p>}
              {c.lookLock && (
                <pre className="whitespace-pre-wrap text-xs text-text/80 bg-ink/40 border border-line rounded-xl p-3 mt-3 font-sans">
                  {c.lookLock}
                </pre>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-display text-2xl text-text mb-3">Episodes</h2>
        <div className="space-y-2">
          {channel.episodes.length === 0 && <div className="text-sm text-muted">No episodes yet.</div>}
          {channel.episodes.map((e) => (
            <Link
              key={e.id}
              to={`/channels/${channel.id}/episodes/${e.id}`}
              className="flex items-center justify-between rounded-xl border border-line bg-panel/60 p-4 hover:border-stage-mastering/60 transition"
            >
              <div>
                <span className="text-muted text-sm mr-2">
                  {e.episodeNumber != null ? `#${e.episodeNumber}` : '—'}
                </span>
                <span className="text-text font-semibold">{e.title}</span>
                {e.feeling && <span className="ml-2 text-[11px] uppercase tracking-wider text-muted">{e.feeling}</span>}
              </div>
              <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted">
                <span>{e.sceneCount} scenes</span>
                <span className="rounded-full border border-line px-2 py-0.5">{e.status}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

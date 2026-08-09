import { Link, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api, type ApiEpisodeDetail } from '../api'
import CopyButton from '../components/CopyButton'

// One episode: its metadata (feeling, logline, title, thumbnail, short) and
// the scene-by-scene script. Each scene's Visual line is an image/video
// prompt; the Narration is the read-aloud text + character dialogue.
export default function EpisodePage() {
  const { channelId, episodeId } = useParams<{ channelId: string; episodeId: string }>()
  const [episode, setEpisode] = useState<ApiEpisodeDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!episodeId) return
    api
      .episode(episodeId)
      .then(({ episode }) => setEpisode(episode))
      .catch((err) => setError(err instanceof Error ? err.message : 'failed to load'))
  }, [episodeId])

  if (error) return <div className="text-sm text-urgent">{error}</div>
  if (!episode) return <div className="text-sm text-muted">Loading…</div>

  const fullScript = episode.scenes
    .map((s, i) => `SCENE ${i + 1}\nVisual: ${s.visual ?? ''}\n\n${s.narration ?? ''}`)
    .join('\n\n———\n\n')

  const fullNarration = episode.scenes.map((s) => s.narration ?? '').join('\n\n')

  return (
    <div className="space-y-8">
      <section>
        <Link
          to={channelId ? `/channels/${channelId}` : '/channels'}
          className="text-[11px] uppercase tracking-wider text-muted hover:text-text"
        >
          ← {episode.channelName}
        </Link>
        <h1 className="font-display text-4xl text-rainbow mt-2">
          {episode.episodeNumber != null && (
            <span className="text-muted text-2xl mr-2">#{episode.episodeNumber}</span>
          )}
          {episode.title}
        </h1>
        <div className="flex flex-wrap gap-2 mt-3 text-[11px] uppercase tracking-wider text-muted">
          {episode.feeling && <span className="border border-line rounded-full px-2.5 py-1">{episode.feeling}</span>}
          <span className="border border-line rounded-full px-2.5 py-1">{episode.status}</span>
        </div>
        {episode.logline && <p className="text-sm text-muted/90 max-w-2xl mt-4">{episode.logline}</p>}
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        {episode.youtubeTitle && <MetaCard label="YouTube title" value={episode.youtubeTitle} />}
        {episode.thumbnailConcept && <MetaCard label="Thumbnail concept" value={episode.thumbnailConcept} />}
        {episode.shortConcept && <MetaCard label="Short (60s) concept" value={episode.shortConcept} />}
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-2xl text-text">Script</h2>
          <div className="flex gap-2">
            <CopyButton text={fullNarration} label="Copy narration" />
            <CopyButton text={fullScript} label="Copy full script" />
          </div>
        </div>
        <div className="space-y-3">
          {episode.scenes.map((s, i) => (
            <div key={s.id} className="rounded-2xl border border-line bg-panel/60 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] uppercase tracking-wider text-stage-mastering font-bold">
                  Scene {i + 1}
                </span>
                <CopyButton text={s.visual ?? ''} label="Copy visual" />
              </div>
              {s.visual && (
                <p className="text-xs text-muted mb-3">
                  <span className="uppercase tracking-wider text-muted/70">Visual · </span>
                  {s.visual}
                </p>
              )}
              {s.narration && (
                <pre className="whitespace-pre-wrap text-sm text-text/90 font-sans">{s.narration}</pre>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel/60 p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-muted">{label}</span>
        <CopyButton text={value} />
      </div>
      <p className="text-sm text-text/90">{value}</p>
    </div>
  )
}

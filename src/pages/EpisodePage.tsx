import { Link, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api, type ApiEpisodeDetail } from '../api'
import CopyButton from '../components/CopyButton'

// One episode: the scene-by-scene script, plus the copy-ready PUBLISH KIT —
// everything Ryan needs to publish to YouTube by hand (main video metadata +
// first-class shorts that link back to the main video).
export default function EpisodePage() {
  const { channelId, episodeId } = useParams<{ channelId: string; episodeId: string }>()
  const [episode, setEpisode] = useState<ApiEpisodeDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [urlDraft, setUrlDraft] = useState('')
  const [savingUrl, setSavingUrl] = useState(false)

  async function load() {
    if (!episodeId) return
    try {
      const { episode } = await api.episode(episodeId)
      setEpisode(episode)
      setUrlDraft(episode.youtubeUrl ?? '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load')
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId])

  async function saveUrl() {
    if (!episodeId) return
    setSavingUrl(true)
    try {
      await api.updateEpisode(episodeId, { youtubeUrl: urlDraft.trim() || null })
      await load() // reload so the shorts' descriptions pick up the new URL
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save')
    } finally {
      setSavingUrl(false)
    }
  }

  if (error) return <div className="text-sm text-urgent">{error}</div>
  if (!episode) return <div className="text-sm text-muted">Loading…</div>

  const fullScript = episode.scenes
    .map((s, i) => `SCENE ${i + 1}\nVisual: ${s.visual ?? ''}\n\n${s.narration ?? ''}`)
    .join('\n\n———\n\n')
  const fullNarration = episode.scenes.map((s) => s.narration ?? '').join('\n\n')

  return (
    <div className="space-y-10">
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

      {/* ── PUBLISH KIT: main video ─────────────────────────────────────── */}
      <section>
        <h2 className="font-display text-2xl text-text mb-1">📤 Publish kit — main video</h2>
        <p className="text-xs text-muted mb-4">Copy each field straight into YouTube. Don't skip the “made for kids” toggle.</p>
        <div className="space-y-3">
          {episode.youtubeTitle && <KitRow label="Title" value={episode.youtubeTitle} />}
          {episode.ytDescription && <KitRow label="Description" value={episode.ytDescription} multiline />}
          {episode.ytTags && <KitRow label="Tags" value={episode.ytTags} />}
          <div className="grid gap-3 sm:grid-cols-2">
            {episode.ytCategory && <KitRow label="Category" value={episode.ytCategory} />}
            <div className="rounded-2xl border border-stage-tracking/40 bg-stage-tracking/[0.06] p-4">
              <span className="text-[10px] uppercase tracking-wider text-stage-tracking">⚠️ Audience</span>
              <p className="text-sm text-text mt-1">
                {episode.madeForKids ? 'Set “Yes, made for kids” (required — COPPA)' : 'Not made for kids'}
              </p>
            </div>
            {episode.playlist && <KitRow label="Playlist" value={episode.playlist} />}
            {episode.recommendedPublish && <KitRow label="📅 Recommended publish" value={episode.recommendedPublish} />}
          </div>
          {episode.thumbnailConcept && <KitRow label="Thumbnail concept" value={episode.thumbnailConcept} multiline />}
          {episode.pinnedComment && <KitRow label="Pinned comment" value={episode.pinnedComment} />}
        </div>
      </section>

      {/* ── Published URL → completes the shorts ────────────────────────── */}
      <section className="rounded-2xl border border-line bg-panel/60 p-4">
        <h3 className="text-sm font-bold text-text mb-1">After you publish the main video</h3>
        <p className="text-xs text-muted mb-3">
          Paste its YouTube URL here. It flows into every short's description so the “full episode 👉” link goes live.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder="https://youtu.be/…"
            className="flex-1 min-w-[220px] rounded-xl border border-line bg-ink/40 px-3 py-2 text-sm text-text placeholder:text-muted/50"
          />
          <button
            onClick={() => void saveUrl()}
            disabled={savingUrl}
            className="rounded-xl border border-stage-done/50 bg-stage-done/10 text-stage-done text-xs uppercase tracking-wider font-bold px-4 py-2 hover:bg-stage-done/20 transition disabled:opacity-50"
          >
            {savingUrl ? 'Saving…' : 'Save URL'}
          </button>
        </div>
        {episode.youtubeUrl && (
          <p className="text-[11px] text-stage-done mt-2">✓ Live — shorts now link to this video.</p>
        )}
      </section>

      {/* ── Shorts ──────────────────────────────────────────────────────── */}
      {episode.shorts.length > 0 && (
        <section>
          <h2 className="font-display text-2xl text-text mb-3">📱 Shorts</h2>
          <div className="space-y-3">
            {episode.shorts.map((s, i) => (
              <div key={s.id} className="rounded-2xl border border-line bg-panel/60 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] uppercase tracking-wider text-stage-mastering font-bold">
                    Short {i + 1}
                  </span>
                  <span className="text-[11px] text-muted">🔗 links to → {s.linksTo}</span>
                </div>
                <KitRow label="Title" value={s.title} />
                <div className="mt-3">
                  <KitRow label="Description" value={s.description} multiline />
                </div>
                <div className="flex flex-wrap gap-3 mt-3 text-[11px] uppercase tracking-wider text-muted">
                  <span className="border border-stage-tracking/40 text-stage-tracking rounded-full px-2.5 py-1">
                    {s.madeForKids ? 'Made for kids: Yes' : 'Not for kids'}
                  </span>
                  {s.recommendedPublish && (
                    <span className="border border-line rounded-full px-2.5 py-1">📅 {s.recommendedPublish}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Script ──────────────────────────────────────────────────────── */}
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

function KitRow({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-panel/60 p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-muted">{label}</span>
        <CopyButton text={value} />
      </div>
      {multiline ? (
        <pre className="whitespace-pre-wrap text-sm text-text/90 font-sans">{value}</pre>
      ) : (
        <p className="text-sm text-text/90">{value}</p>
      )}
    </div>
  )
}

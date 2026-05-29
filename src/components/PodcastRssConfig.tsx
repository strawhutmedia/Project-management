// Admin-only card on podcast project pages for wiring up the RSS feed.
// Paste the feed URL, hit Import — the server fetches and parses the
// feed, extracts the cover art URL, and saves both. The extracted cover
// art drives the accent color on every text-post image rendered for
// this show.
import { useState } from 'react'
import { api, type ApiProject } from '../api'

export default function PodcastRssConfig({
  project,
  onSaved,
}: {
  project: ApiProject
  onSaved: () => void | Promise<void>
}) {
  const [feedUrl, setFeedUrl] = useState(project.rssFeedUrl ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const coverArtUrl = project.coverArtUrl ?? null

  async function importNow() {
    const url = feedUrl.trim()
    if (!url) {
      setError('Paste an RSS feed URL first.')
      return
    }
    setBusy(true); setError(null)
    try {
      await api.importPodcastRss(project.id, url)
      setSavedAt(new Date())
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  async function clearFeed() {
    if (!confirm('Remove the RSS feed and cover art?')) return
    setBusy(true); setError(null)
    try {
      await api.updateProject(project.id, { rssFeedUrl: null, coverArtUrl: null })
      setFeedUrl('')
      setSavedAt(new Date())
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-6 space-y-4">
      <div>
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">📡 Podcast Feed</h2>
        <p className="text-[11px] text-muted/80 mt-1">
          Paste this show's public RSS feed URL. Slate pulls the cover art and uses its dominant
          color as the accent on every generated text post — so each show's posts feel on-brand.
        </p>
      </div>

      <div className="flex items-start gap-3 flex-wrap">
        {coverArtUrl ? (
          <img
            src={coverArtUrl}
            alt="Podcast cover"
            crossOrigin="anonymous"
            className="w-24 h-24 rounded-lg object-cover border border-line shrink-0"
          />
        ) : (
          <div className="w-24 h-24 rounded-lg border border-dashed border-line/60 grid place-items-center text-muted/70 text-[10px] uppercase tracking-wider shrink-0">
            No cover
          </div>
        )}
        <div className="flex-1 min-w-[220px] space-y-2">
          <label className="block">
            <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold mb-1">RSS feed URL</div>
            <input
              type="url"
              value={feedUrl}
              onChange={(e) => setFeedUrl(e.target.value)}
              placeholder="https://feeds.example.com/yourshow.rss"
              className="w-full rounded-lg bg-ink/40 border border-line text-text px-3 py-2 text-sm font-mono outline-none focus:border-stage-mastering"
            />
          </label>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => void importNow()}
              disabled={busy || !feedUrl.trim()}
              className="rounded-lg bg-gradient-to-r from-stage-mastering to-stage-tracking text-white font-bold uppercase tracking-wider text-[10px] px-3 py-1.5 disabled:opacity-50"
            >
              {busy ? 'Importing…' : (coverArtUrl ? '↻ Re-import' : 'Import')}
            </button>
            {project.rssFeedUrl && (
              <button
                onClick={() => void clearFeed()}
                disabled={busy}
                className="text-[10px] uppercase tracking-wider text-muted hover:text-urgent"
              >
                Clear
              </button>
            )}
            {savedAt && !error && <span className="text-[11px] text-muted">Updated {savedAt.toLocaleTimeString()}</span>}
          </div>
          {error && <p className="text-urgent text-xs">{error}</p>}
        </div>
      </div>
    </section>
  )
}

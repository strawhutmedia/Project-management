// Admin-only card on podcast project pages for wiring up the RSS feed.
// Two modes: search Apple Podcasts by show name (the easy path), or paste
// the RSS URL directly (fallback for shows not in Apple's directory).
// Either way, the server fetches and parses the feed, extracts the cover
// art URL, and saves both. The extracted cover art drives the accent color
// on every text-post image rendered for this show.
import { useEffect, useRef, useState } from 'react'
import { api, type ApiProject, type ApiPodcastSearchResult } from '../api'

type Mode = 'search' | 'paste'

export default function PodcastRssConfig({
  project,
  onSaved,
}: {
  project: ApiProject
  onSaved: () => void | Promise<void>
}) {
  const [mode, setMode] = useState<Mode>(project.rssFeedUrl ? 'paste' : 'search')
  const [feedUrl, setFeedUrl] = useState(project.rssFeedUrl ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const coverArtUrl = project.coverArtUrl ?? null

  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<ApiPodcastSearchResult[] | null>(null)
  const debounceRef = useRef<number | null>(null)

  // Debounced live search as the user types. 350ms feels responsive without
  // hammering Apple's API on every keystroke.
  useEffect(() => {
    if (mode !== 'search') return
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    const q = query.trim()
    if (q.length < 2) {
      setResults(null)
      setSearching(false)
      return
    }
    debounceRef.current = window.setTimeout(() => {
      void runSearch(q)
    }, 350)
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mode])

  async function runSearch(q: string) {
    setSearching(true)
    setError(null)
    try {
      const { results } = await api.searchPodcasts(q)
      setResults(results)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'search failed')
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  async function importFeed(url: string) {
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

  async function pickResult(r: ApiPodcastSearchResult) {
    setFeedUrl(r.feedUrl)
    setQuery('')
    setResults(null)
    await importFeed(r.feedUrl)
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
          Search Apple Podcasts by name, or paste the RSS feed URL directly. Slate pulls the cover
          art and uses its dominant color as the accent on every generated text post — so each
          show's posts feel on-brand.
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
        <div className="flex-1 min-w-[260px] space-y-3">
          {/* Mode toggle */}
          <div className="inline-flex rounded-lg border border-line bg-ink/40 p-0.5 text-[10px] uppercase tracking-wider font-bold">
            <button
              type="button"
              onClick={() => setMode('search')}
              className={`px-3 py-1 rounded-md transition ${
                mode === 'search' ? 'bg-stage-mastering text-white' : 'text-muted hover:text-text'
              }`}
            >
              Search by name
            </button>
            <button
              type="button"
              onClick={() => setMode('paste')}
              className={`px-3 py-1 rounded-md transition ${
                mode === 'paste' ? 'bg-stage-mastering text-white' : 'text-muted hover:text-text'
              }`}
            >
              Paste RSS URL
            </button>
          </div>

          {mode === 'search' ? (
            <div className="space-y-2">
              <label className="block">
                <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold mb-1">
                  Show name
                </div>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g. Ryan Is — a podcast"
                  className="w-full rounded-lg bg-ink/40 border border-line text-text px-3 py-2 text-sm outline-none focus:border-stage-mastering"
                  autoFocus
                />
              </label>
              {searching && (
                <p className="text-[11px] text-muted">Searching Apple Podcasts…</p>
              )}
              {results && results.length === 0 && !searching && (
                <p className="text-[11px] text-muted">
                  No matches. Try a different spelling, or switch to "Paste RSS URL".
                </p>
              )}
              {results && results.length > 0 && (
                <ul className="max-h-72 overflow-y-auto rounded-lg border border-line divide-y divide-line/70">
                  {results.map((r) => (
                    <li key={r.itunesId ?? r.feedUrl}>
                      <button
                        type="button"
                        onClick={() => void pickResult(r)}
                        disabled={busy}
                        className="w-full flex items-center gap-3 p-2 text-left hover:bg-ink/40 disabled:opacity-50 transition"
                      >
                        {r.artworkUrl ? (
                          <img
                            src={r.artworkUrl}
                            alt=""
                            className="w-12 h-12 rounded-md object-cover border border-line shrink-0"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-md border border-line/60 bg-ink/40 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-text truncate font-semibold">{r.title}</div>
                          {r.artist && (
                            <div className="text-[11px] text-muted truncate">{r.artist}</div>
                          )}
                          <div className="text-[10px] text-muted/70 truncate">
                            {r.trackCount ? `${r.trackCount} episodes` : ''}
                            {r.trackCount && r.genre ? ' · ' : ''}
                            {r.genre ?? ''}
                          </div>
                        </div>
                        <span className="text-[10px] uppercase tracking-wider text-stage-mastering font-bold shrink-0">
                          {busy ? '…' : 'Use'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block">
                <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold mb-1">
                  RSS feed URL
                </div>
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
                  onClick={() => void importFeed(feedUrl.trim())}
                  disabled={busy || !feedUrl.trim()}
                  className="rounded-lg bg-gradient-to-r from-stage-mastering to-stage-tracking text-white font-bold uppercase tracking-wider text-[10px] px-3 py-1.5 disabled:opacity-50"
                >
                  {busy ? 'Importing…' : (coverArtUrl ? '↻ Re-import' : 'Import')}
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap pt-1">
            {project.rssFeedUrl && (
              <>
                <span className="text-[11px] text-muted truncate max-w-[280px]" title={project.rssFeedUrl}>
                  Current: <span className="font-mono">{project.rssFeedUrl}</span>
                </span>
                <button
                  onClick={() => void clearFeed()}
                  disabled={busy}
                  className="text-[10px] uppercase tracking-wider text-muted hover:text-urgent"
                >
                  Clear
                </button>
              </>
            )}
            {savedAt && !error && (
              <span className="text-[11px] text-muted">Updated {savedAt.toLocaleTimeString()}</span>
            )}
          </div>
          {error && <p className="text-urgent text-xs">{error}</p>}
        </div>
      </div>
    </section>
  )
}

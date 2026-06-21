// The script is the centerpiece of any film project — everything else
// (schedule, budget, cast) is derived from it. This card lives at the
// top of the film project page and owns:
//
//   - Upload / re-import the .fdx
//   - Archive info (latest version on file) + download + re-parse
//   - Live breakdown progress when Claude is analyzing scenes
//   - "What changed" summary if the last upload diffed against a prior
//
// The Stripboard page still has its own upload button as a
// convenience, but the canonical place to manage the script is here.
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import ScriptChangelogCard from './ScriptChangelogCard'

type Archive = {
  id: string
  fileName: string | null
  byteSize: number
  sceneCount: number
  uploadedAt: string
}

type Progress = {
  totalScenes: number
  withActionText: number
  withBreakdown: number
  isRunning: boolean
  isStale: boolean
  lastRunAt: string | null
}

export default function ScriptOverviewCard({
  projectId,
  isAdmin,
}: {
  projectId: string
  isAdmin: boolean
}) {
  const [archive, setArchive] = useState<Archive | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [importing, setImporting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  async function loadArchive() {
    try {
      const r = await api.scriptArchive(projectId)
      setArchive(r.archive)
    } catch {
      setArchive(null)
    }
  }

  async function loadProgress() {
    try {
      const r = await api.breakdownProgress(projectId)
      setProgress(r)
    } catch {
      setProgress(null)
    }
  }

  useEffect(() => {
    void loadArchive()
    void loadProgress()
  }, [projectId])

  // Poll while breakdown is running so the bar updates live.
  useEffect(() => {
    if (!progress || progress.withBreakdown >= progress.withActionText) return
    if (!progress.isRunning && !progress.isStale) return
    const interval = setInterval(() => { void loadProgress() }, 4000)
    return () => clearInterval(interval)
  }, [progress?.isRunning, progress?.withBreakdown])

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.fdx')) {
      setError('Only .fdx files are accepted (Final Draft format).')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setImporting(true)
    setError(null)
    setNotice(null)
    try {
      const xml = await file.text()
      const r = await api.importFdx(projectId, xml, file.name)
      if (r.breakdownStarted) {
        setNotice(`✓ Uploaded ${r.count} scenes from ${file.name}. Claude is analyzing them now.`)
      } else {
        setNotice(`✓ Uploaded ${r.count} scenes from ${file.name}.`)
      }
      await loadArchive()
      await loadProgress()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'import failed')
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function reparseArchived() {
    if (!confirm('Re-parse the archived .fdx with the current parser? Refreshes scenes + breakdown without needing the file.')) return
    setBusy(true)
    setError(null)
    try {
      const r = await api.reparseArchivedScript(projectId)
      setNotice(`✓ Re-parsed ${r.sceneCount} scenes from ${r.fileName || 'archive'}. Breakdown re-running.`)
      await loadArchive()
      await loadProgress()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  async function reanalyzeAll() {
    if (!confirm('Re-analyze every scene with Claude? Existing zero-cost suggestions get replaced; rows you\'ve already priced are preserved.')) return
    setBusy(true)
    setError(null)
    try {
      const r = await api.reanalyzeAllScenes(projectId)
      setNotice(`✓ Re-analyzing ${r.sceneCount} scenes in the background.`)
      await loadProgress()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  const hasUnanalyzed = progress && progress.withBreakdown < progress.withActionText
  const isRunningNow = progress?.isRunning && hasUnanalyzed
  const isStale = progress?.isStale && hasUnanalyzed
  const pctDone = progress && progress.withActionText > 0
    ? Math.round((progress.withBreakdown / progress.withActionText) * 100)
    : 0

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-5 space-y-4">
      <header>
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">📜 Script</h2>
        <p className="text-[11px] text-muted/80 mt-1">
          Upload your Final Draft (.fdx). Claude reads every scene and lists
          everything that could cost money — props, wardrobe, locations,
          extras, day players, SFX. The schedule and budget below build from
          this.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-urgent/40 bg-urgent/10 text-urgent text-xs px-3 py-2">
          {error}
        </div>
      )}
      {notice && !error && (
        <div className="rounded-lg border border-stage-mastering/40 bg-stage-mastering/10 text-text text-xs px-3 py-2">
          {notice}
        </div>
      )}

      <ScriptChangelogCard projectId={projectId} isAdmin={isAdmin} />

      {/* Archive info or empty state */}
      {archive ? (
        <div className="rounded-xl border border-line/60 bg-ink/30 p-3 space-y-2">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="font-mono text-sm text-text truncate" title={archive.fileName ?? ''}>
                {archive.fileName || 'script.fdx'}
              </div>
              <div className="text-[11px] text-muted mt-0.5">
                {archive.sceneCount} scenes · {Math.round(archive.byteSize / 1024)} KB ·
                uploaded {new Date(archive.uploadedAt).toLocaleString()}
              </div>
            </div>
            {isAdmin && (
              <div className="flex items-center gap-3 text-[11px] shrink-0">
                <a
                  href={api.scriptArchiveDownloadUrl(projectId)}
                  download
                  className="text-stage-stems hover:underline"
                >
                  Download
                </a>
                <button
                  onClick={() => void reparseArchived()}
                  disabled={busy}
                  className="text-stage-mastering hover:underline disabled:opacity-50"
                  title="Re-parse the archived .fdx with the current parser"
                >
                  Re-parse
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        isAdmin && (
          <p className="text-muted/70 text-sm italic py-4 text-center border border-dashed border-line/60 rounded-xl">
            No script uploaded yet. Drop a .fdx below to kick off the breakdown.
          </p>
        )
      )}

      {/* Breakdown progress / paused / done */}
      {progress && progress.withActionText > 0 && (
        <div className={`rounded-xl border px-4 py-3 ${
          isStale
            ? 'border-urgent/40 bg-urgent/5'
            : isRunningNow
              ? 'border-stage-mastering/40 bg-stage-mastering/10'
              : 'border-line/60 bg-ink/30'
        }`}>
          <div className="flex items-center gap-3">
            {isRunningNow && (
              <span className="inline-block w-3 h-3 rounded-full bg-stage-mastering animate-pulse shrink-0" />
            )}
            {isStale && <span className="text-lg shrink-0">⚠️</span>}
            {!isRunningNow && !isStale && hasUnanalyzed === false && <span className="text-lg shrink-0">✓</span>}
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-wider font-bold mb-0.5">
                {isStale
                  ? `Breakdown paused — ${progress.withActionText - progress.withBreakdown} scenes still unanalyzed`
                  : isRunningNow
                    ? `Claude is analyzing your script · ${progress.withBreakdown} / ${progress.withActionText} scenes (${pctDone}%)`
                    : `Breakdown complete · ${progress.withBreakdown} / ${progress.withActionText} scenes analyzed`}
              </div>
              <div className="h-1.5 bg-ink/40 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    isStale ? 'bg-urgent' : 'bg-gradient-to-r from-stage-mastering to-stage-tracking'
                  }`}
                  style={{ width: `${pctDone}%` }}
                />
              </div>
              {isStale && (
                <div className="text-[10px] text-muted mt-1">
                  Click "Re-analyze" below to resume from where it left off.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {isAdmin && (
        <div className="flex gap-2 flex-wrap pt-1">
          <input
            ref={fileInputRef}
            type="file"
            accept=".fdx"
            onChange={(e) => void handleFile(e)}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="rounded-xl bg-gradient-to-r from-stage-producing to-stage-mastering text-white font-bold uppercase tracking-wider text-xs px-4 py-2.5 disabled:opacity-50"
          >
            {importing ? 'Parsing…' : archive ? '↻ Upload new version' : '📥 Upload Final Draft (.fdx)'}
          </button>
          {archive && progress && progress.withActionText > 0 && (
            <button
              onClick={() => void reanalyzeAll()}
              disabled={busy}
              className="rounded-xl border border-stage-mastering/40 text-stage-mastering font-bold uppercase tracking-wider text-xs px-4 py-2.5 hover:bg-stage-mastering/10 disabled:opacity-50"
            >
              ✨ Re-analyze all scenes
            </button>
          )}
        </div>
      )}
    </section>
  )
}

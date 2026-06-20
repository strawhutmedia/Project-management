// What changed since the previous .fdx upload. Shows up on the
// stripboard whenever the latest upload has a diff against a previous
// version that hasn't been marked as reviewed yet. Producer scans the
// list, makes any schedule/budget adjustments, and clicks "Mark as
// reviewed" to dismiss the card.
import { useEffect, useState } from 'react'
import { api } from '../api'

type Diff = NonNullable<Awaited<ReturnType<typeof api.scriptDiff>>['diff']>

const CHANGE_LABEL: Record<string, string> = {
  HEADING: 'Heading',
  LOCATION: 'Location',
  TIME_OF_DAY: 'Time of day',
  PAGE_COUNT: 'Page count',
  CHARACTERS: 'Cast',
  ACTION_TEXT: 'Action text',
}

function fmtEighths(eighths: number): string {
  if (eighths === 0) return '—'
  const whole = Math.floor(eighths / 8)
  const frac = eighths % 8
  if (whole === 0) return `${frac}/8`
  if (frac === 0) return `${whole}`
  return `${whole} ${frac}/8`
}

export default function ScriptChangelogCard({
  projectId,
  isAdmin,
  onChanged,
}: {
  projectId: string
  isAdmin: boolean
  onChanged?: () => void
}) {
  const [diff, setDiff] = useState<Diff | null>(null)
  const [uploadedAt, setUploadedAt] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [reviewedAt, setReviewedAt] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [marking, setMarking] = useState(false)

  async function load() {
    const r = await api.scriptDiff(projectId)
    setDiff(r.diff)
    setUploadedAt(r.uploadedAt ?? null)
    setFileName(r.fileName ?? null)
    setReviewedAt(r.reviewedAt ?? null)
  }

  useEffect(() => { void load() }, [projectId])

  async function markReviewed() {
    setMarking(true)
    try {
      await api.markScriptDiffReviewed(projectId)
      await load()
      onChanged?.()
    } finally {
      setMarking(false)
    }
  }

  if (!diff) return null
  const total = diff.added.length + diff.removed.length + diff.changed.length
  if (total === 0) return null
  if (reviewedAt) return null

  return (
    <section className="rounded-2xl border border-stage-overdubs/40 bg-stage-overdubs/5 p-4 space-y-3">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-stage-overdubs font-bold mb-1">
            📝 Script changes since last upload
          </div>
          <p className="text-[11px] text-muted">
            {fileName && <span className="font-mono">{fileName}</span>}
            {uploadedAt && <span> · uploaded {new Date(uploadedAt).toLocaleString()}</span>}
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => void markReviewed()}
            disabled={marking}
            className="text-[10px] uppercase tracking-wider font-bold text-white bg-stage-overdubs rounded-full px-3 py-1.5 disabled:opacity-50"
          >
            {marking ? '…' : '✓ Mark reviewed'}
          </button>
        )}
      </header>

      <div className="flex gap-2 flex-wrap text-[11px]">
        {diff.added.length > 0 && (
          <span className="rounded-full bg-stage-mastering/20 border border-stage-mastering/40 text-stage-mastering px-2.5 py-1 font-bold">
            + {diff.added.length} added
          </span>
        )}
        {diff.removed.length > 0 && (
          <span className="rounded-full bg-urgent/15 border border-urgent/40 text-urgent px-2.5 py-1 font-bold">
            − {diff.removed.length} removed
          </span>
        )}
        {diff.changed.length > 0 && (
          <span className="rounded-full bg-stage-tracking/20 border border-stage-tracking/40 text-stage-tracking px-2.5 py-1 font-bold">
            ✏ {diff.changed.length} changed
          </span>
        )}
        <span className="rounded-full bg-ink/40 border border-line text-muted px-2.5 py-1">
          {diff.unchanged} unchanged
        </span>
      </div>

      <button
        onClick={() => setExpanded(!expanded)}
        className="text-[11px] text-muted hover:text-text uppercase tracking-wider"
      >
        {expanded ? '▾ Hide details' : '▸ Show details'}
      </button>

      {expanded && (
        <div className="space-y-4 pt-2">
          {diff.added.length > 0 && (
            <div>
              <h4 className="text-[10px] uppercase tracking-wider font-bold text-stage-mastering mb-2">
                Added scenes ({diff.added.length})
              </h4>
              <div className="space-y-1">
                {diff.added.map((s) => (
                  <div key={s.number} className="text-xs flex items-baseline gap-2">
                    <span className="font-mono font-bold text-stage-mastering w-12">#{s.number}</span>
                    <span className="text-text flex-1 min-w-0 truncate" title={s.slug}>{s.slug}</span>
                    <span className="font-mono text-muted text-[10px] shrink-0">{fmtEighths(s.pageEighths)}p</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {diff.removed.length > 0 && (
            <div>
              <h4 className="text-[10px] uppercase tracking-wider font-bold text-urgent mb-2">
                Removed scenes ({diff.removed.length})
              </h4>
              <div className="space-y-1">
                {diff.removed.map((s) => (
                  <div key={s.number} className="text-xs flex items-baseline gap-2">
                    <span className="font-mono font-bold text-urgent w-12 line-through">#{s.number}</span>
                    <span className="text-muted flex-1 min-w-0 truncate line-through" title={s.slug}>{s.slug}</span>
                    <span className="font-mono text-muted text-[10px] shrink-0">{fmtEighths(s.pageEighths)}p</span>
                  </div>
                ))}
                <p className="text-[10px] text-urgent/80 italic mt-2">
                  Any priced budget items attached to these scenes are now
                  unattached (scene_id is NULL). Re-attach or move to
                  project-level via the budget flat view.
                </p>
              </div>
            </div>
          )}
          {diff.changed.length > 0 && (
            <div>
              <h4 className="text-[10px] uppercase tracking-wider font-bold text-stage-tracking mb-2">
                Changed scenes ({diff.changed.length})
              </h4>
              <div className="space-y-2">
                {diff.changed.map((s) => (
                  <div key={s.number} className="text-xs rounded-lg border border-stage-tracking/30 bg-stage-tracking/5 px-3 py-2">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="font-mono font-bold text-stage-tracking">#{s.number}</span>
                      <span className="text-text flex-1 min-w-0 truncate" title={s.after.slug}>
                        {s.after.slug}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mb-1">
                      {s.changes.map((c) => (
                        <span key={c} className="text-[9px] uppercase tracking-wider bg-stage-tracking/20 text-stage-tracking border border-stage-tracking/40 rounded px-1.5 py-0.5">
                          {CHANGE_LABEL[c] ?? c}
                        </span>
                      ))}
                    </div>
                    {s.changes.includes('LOCATION') && s.before.location !== s.after.location && (
                      <div className="text-[10px] text-muted">
                        Location: <span className="line-through">{s.before.location || '—'}</span>
                        {' → '}
                        <span className="text-text">{s.after.location || '—'}</span>
                      </div>
                    )}
                    {s.changes.includes('TIME_OF_DAY') && s.before.timeOfDay !== s.after.timeOfDay && (
                      <div className="text-[10px] text-muted">
                        Time: <span className="line-through">{s.before.timeOfDay || '—'}</span>
                        {' → '}
                        <span className="text-text">{s.after.timeOfDay || '—'}</span>
                      </div>
                    )}
                    {s.changes.includes('PAGE_COUNT') && (
                      <div className="text-[10px] text-muted">
                        Pages: <span className="line-through">{fmtEighths(s.before.pageEighths)}</span>
                        {' → '}
                        <span className="text-text">{fmtEighths(s.after.pageEighths)}</span>
                      </div>
                    )}
                    {s.changes.includes('CHARACTERS') && (
                      <div className="text-[10px] text-muted">
                        Cast change: {diffArrays(s.before.characters, s.after.characters)}
                      </div>
                    )}
                    {s.changes.includes('ACTION_TEXT') && (
                      <div className="text-[10px] text-muted italic">
                        Body text changed — Claude is re-running the breakdown
                        for this scene
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function diffArrays(before: string[], after: string[]): string {
  const setBefore = new Set(before)
  const setAfter = new Set(after)
  const added = after.filter((c) => !setBefore.has(c))
  const removed = before.filter((c) => !setAfter.has(c))
  const parts: string[] = []
  if (added.length > 0) parts.push(`+ ${added.join(', ')}`)
  if (removed.length > 0) parts.push(`− ${removed.join(', ')}`)
  return parts.join(' · ') || '—'
}

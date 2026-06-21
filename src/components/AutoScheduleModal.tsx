// Claude-powered shoot schedule generator. Producer answers a few
// questions, Claude reads every scene and proposes a day-by-day plan
// optimized for cast continuity, location continuity, day/night
// separation, and page count. Hard-coded for US labor rules:
// 12h turnaround, max 6 consecutive shoot days (mandatory rest),
// meal break risk flagged.
//
// The producer reviews the proposal side-by-side with the current
// schedule, then either applies it (auto-snapshots current first as
// a safety net) or discards.
import { useState } from 'react'
import { api } from '../api'

type Proposal = NonNullable<Awaited<ReturnType<typeof api.proposeAutoSchedule>>['proposal']>

export default function AutoScheduleModal({
  projectId,
  currentShootDayCount,
  onClose,
  onApplied,
}: {
  projectId: string
  currentShootDayCount: number
  onClose: () => void
  onApplied: () => void
}) {
  const [shootDays, setShootDays] = useState(currentShootDayCount > 0 ? currentShootDayCount : 18)
  const [maxPages, setMaxPages] = useState(7)
  const [useOpus, setUseOpus] = useState(true)
  const [notes, setNotes] = useState('')
  const [thinking, setThinking] = useState(false)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)

  async function propose() {
    setThinking(true)
    setError(null)
    try {
      const r = await api.proposeAutoSchedule(projectId, { shootDays, maxPagesPerDay: maxPages, useOpus, notes })
      setProposal(r.proposal)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setThinking(false)
    }
  }

  async function apply() {
    if (!proposal) return
    if (!confirm('Apply this schedule? Your current arrangement will be saved as a snapshot first so you can restore it if needed.')) return
    setApplying(true)
    setError(null)
    try {
      await api.applyAutoSchedule(projectId, proposal)
      onApplied()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setApplying(false)
    }
  }

  const shootDayCount = proposal?.shootDays.filter((d) => !d.isBreak).length ?? 0
  const breakDayCount = proposal?.shootDays.filter((d) => d.isBreak).length ?? 0

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl border border-line bg-panel shadow-2xl"
      >
        <div className="sticky top-0 bg-panel/95 backdrop-blur border-b border-line px-5 py-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted font-bold mb-0.5">
              ✨ Auto-schedule
            </div>
            <div className="font-bold text-text">Let Claude plan the shoot</div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-text text-xl px-2">✕</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {!proposal ? (
            <>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted font-bold">
                    How many shoot days?
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={200}
                    value={shootDays}
                    onChange={(e) => setShootDays(Number(e.target.value) || 1)}
                    className="w-full mt-1 rounded-lg bg-ink/40 border border-line text-text text-sm px-3 py-2 outline-none focus:border-stage-mastering"
                  />
                  <p className="text-[10px] text-muted/70 mt-1">
                    Claude may exceed this if necessary to fit everything legally.
                    Break days for the 6-day rule are inserted automatically.
                  </p>
                </div>

                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted font-bold">
                    Max pages per day
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step={0.5}
                    min={1}
                    max={20}
                    value={maxPages}
                    onChange={(e) => setMaxPages(Number(e.target.value) || 7)}
                    className="w-full mt-1 rounded-lg bg-ink/40 border border-line text-text text-sm px-3 py-2 outline-none focus:border-stage-mastering"
                  />
                  <p className="text-[10px] text-muted/70 mt-1">
                    Industry rule of thumb is 4–8 pages/day depending on
                    complexity. Going over risks overtime.
                  </p>
                </div>

                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted font-bold">
                    Anything Claude should know? (optional)
                  </label>
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={'e.g. "JANE unavailable June 5–10", "Hospital location only available Mondays", "Don’t schedule night exteriors first week"'}
                    className="w-full mt-1 rounded-lg bg-ink/40 border border-line text-text text-sm px-3 py-2 outline-none focus:border-stage-mastering"
                  />
                </div>

                <label className="flex items-center gap-2 text-[11px] text-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useOpus}
                    onChange={(e) => setUseOpus(e.target.checked)}
                  />
                  Use Opus (recommended — better with complex constraints; uncheck for faster/cheaper Sonnet)
                </label>
              </div>

              <div className="rounded-lg border border-stage-mastering/30 bg-stage-mastering/5 px-3 py-2 text-[11px] text-muted">
                <div className="text-stage-mastering font-bold mb-1">Hard-coded US labor rules:</div>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>12-hour turnaround between days</li>
                  <li>Max 6 consecutive shoot days → mandatory rest day</li>
                  <li>Lunch break ~6 hours in</li>
                  <li>Overtime / meal penalty risk flagged in warnings</li>
                </ul>
              </div>

              {error && (
                <div className="rounded-lg border border-urgent/40 bg-urgent/10 text-urgent text-xs px-3 py-2">
                  {error}
                </div>
              )}

              <button
                onClick={() => void propose()}
                disabled={thinking}
                className="w-full rounded-xl bg-gradient-to-r from-stage-mastering to-stage-tracking text-white font-bold uppercase tracking-wider text-sm py-3 disabled:opacity-50"
              >
                {thinking ? 'Claude is thinking…' : '✨ Propose schedule'}
              </button>
            </>
          ) : (
            <>
              <div className="rounded-xl border border-stage-mastering/40 bg-stage-mastering/5 p-3">
                <div className="text-[10px] uppercase tracking-wider text-stage-mastering font-bold mb-1">
                  Proposed schedule · {shootDayCount} shoot day{shootDayCount === 1 ? '' : 's'}
                  {breakDayCount > 0 && ` + ${breakDayCount} break day${breakDayCount === 1 ? '' : 's'}`}
                </div>
                <p className="text-sm text-text leading-snug">{proposal.summary}</p>
              </div>

              {proposal.warnings.length > 0 && (
                <div className="rounded-xl border border-stage-overdubs/40 bg-stage-overdubs/5 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-stage-overdubs font-bold mb-1">
                    ⚠️ Warnings
                  </div>
                  <ul className="text-xs text-text space-y-1">
                    {proposal.warnings.map((w, i) => <li key={i}>· {w}</li>)}
                  </ul>
                </div>
              )}

              {proposal.unscheduled.length > 0 && (
                <div className="rounded-xl border border-urgent/40 bg-urgent/5 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-urgent font-bold mb-1">
                    Unscheduled ({proposal.unscheduled.length})
                  </div>
                  <div className="text-xs font-mono text-text">
                    {proposal.unscheduled.join(', ')}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {proposal.shootDays.map((d) => (
                  <div
                    key={d.number}
                    className={`rounded-xl border px-3 py-2 ${
                      d.isBreak
                        ? 'border-line/40 bg-ink/20'
                        : 'border-line bg-ink/30'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2 flex-wrap">
                      <div className="text-[11px] uppercase tracking-wider font-bold">
                        {d.isBreak ? `BREAK · DAY ${d.number}` : `DAY ${d.number}`}
                      </div>
                      {!d.isBreak && (
                        <div className="text-[11px] font-mono text-muted">
                          {d.sceneNumbers.length} sc · {d.pagesTotal.toFixed(2)}p
                        </div>
                      )}
                    </div>
                    {!d.isBreak && (
                      <>
                        <div className="text-[11px] text-muted mt-1">{d.notes}</div>
                        <div className="text-xs font-mono mt-1 flex flex-wrap gap-1">
                          {d.sceneNumbers.map((n) => (
                            <span
                              key={n}
                              className="bg-stage-mastering/15 border border-stage-mastering/40 text-stage-mastering rounded px-1.5 py-0.5"
                            >
                              #{n}
                            </span>
                          ))}
                        </div>
                        {d.warnings.length > 0 && (
                          <div className="text-[10px] text-stage-overdubs mt-1">
                            ⚠️ {d.warnings.join(' · ')}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>

              {error && (
                <div className="rounded-lg border border-urgent/40 bg-urgent/10 text-urgent text-xs px-3 py-2">
                  {error}
                </div>
              )}

              <div className="sticky bottom-0 bg-panel/95 backdrop-blur border-t border-line/40 -mx-5 px-5 py-3 flex items-center justify-between gap-2">
                <button
                  onClick={() => setProposal(null)}
                  className="text-[10px] uppercase tracking-wider text-muted hover:text-text border border-line rounded-full px-3 py-1.5"
                >
                  ← Try again
                </button>
                <button
                  onClick={() => void apply()}
                  disabled={applying}
                  className="rounded-xl bg-gradient-to-r from-stage-mastering to-stage-tracking text-white font-bold uppercase tracking-wider text-sm px-5 py-2 disabled:opacity-50"
                >
                  {applying ? 'Applying…' : '✓ Apply schedule'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

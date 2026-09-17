import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth'
import DropboxFolderPicker from '../components/DropboxFolderPicker'
import {
  qaApi,
  type ApiQaContext,
  type ApiQaRecording,
  type ApiQaTemplateItem,
  type QaRecordingInput,
} from '../api'

// Production QA — the in-app home of the old "QA PRODUCTION SHEET":
// every recording session gets logged (who shot it, which cards, where it
// landed in Dropbox), then someone runs QA against the show's expected
// deliverables and approves it. Approval is the signal downstream
// automation (Premiere project assembly) will hook into.

const card = 'rounded-2xl border border-line bg-panel/60'
const labelCls = 'text-[11px] uppercase tracking-wider font-bold text-muted'
const inputCls =
  'w-full rounded-xl border border-line bg-ink/60 px-3 py-2 text-sm text-text placeholder:text-muted/60 focus:outline-none focus:border-stage-mixing/60'
const btnGhost =
  'inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-bold text-muted hover:text-text hover:border-stage-mixing/50 transition'

const RECORDING_TYPES = ['In person', 'Riverside', 'Zoom', 'Audio only', 'Other']
const RESOLUTIONS = ['1080', '4K', '1080 + 4K', '8K', 'Audio only']

// Every card number that ever appeared in the old QA sheet, normalized to
// the dominant zero-padded spelling (the sheet had SSD005 / SSD05 / SSD0005
// all meaning the same card). Tap to select instead of typing.
const AUDIO_CARDS = Array.from({ length: 18 }, (_, i) => `SD${String(i + 1).padStart(4, '0')}`)
const VIDEO_CARDS = Array.from({ length: 15 }, (_, i) => `SSD${String(i + 1).padStart(4, '0')}`)

// Cards are stored as the same free text the sheet used ("SD0010 / RIVERSIDE"),
// parsed into tokens for the picker so old-style values still round-trip.
const cardTokens = (value: string): string[] =>
  value.split(/[/,+]/).map((t) => t.trim()).filter(Boolean)
const joinCards = (tokens: string[]): string => tokens.join(' / ')

function CardField({
  label, options, value, onChange,
}: {
  label: string
  options: string[]
  value: string
  onChange: (v: string) => void
}) {
  const [other, setOther] = useState('')
  const tokens = cardTokens(value)
  const has = (opt: string) => tokens.some((t) => t.toUpperCase() === opt.toUpperCase())
  const toggle = (opt: string) =>
    onChange(joinCards(has(opt) ? tokens.filter((t) => t.toUpperCase() !== opt.toUpperCase()) : [...tokens, opt]))
  const extras = tokens.filter((t) => !options.some((o) => o.toUpperCase() === t.toUpperCase()))
  const addOther = () => {
    const v = other.trim()
    if (!v) return
    if (!tokens.some((t) => t.toUpperCase() === v.toUpperCase())) onChange(joinCards([...tokens, v]))
    setOther('')
  }
  return (
    <div>
      <div className={labelCls}>{label}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {options.map((opt) => {
          const on = has(opt)
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggle(opt)}
              className={`rounded-full border px-2 py-0.5 text-[11px] font-bold transition ${
                on
                  ? 'border-stage-stems/60 bg-stage-stems/15 text-stage-stems'
                  : 'border-line text-muted hover:text-text'
              }`}
            >
              {on ? '✓ ' : ''}{opt}
            </button>
          )
        })}
        {extras.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onChange(joinCards(tokens.filter((x) => x !== t)))}
            className="rounded-full border border-stage-stems/60 bg-stage-stems/15 text-stage-stems px-2 py-0.5 text-[11px] font-bold"
            title="Remove"
          >
            ✓ {t} ✕
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <input
          className={`${inputCls} !py-1 !text-xs flex-1`}
          placeholder="Other (e.g. Riverside, OBS, Zoom)"
          value={other}
          onChange={(e) => setOther(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOther() } }}
        />
        <button type="button" onClick={addOther} className={`${btnGhost} !py-1`}>＋</button>
      </div>
    </div>
  )
}

const STATUS_META: Record<ApiQaRecording['status'], { label: string; cls: string; dot: string }> = {
  pending: { label: 'Awaiting QA', cls: 'border-stage-tracking/40 bg-stage-tracking/10 text-stage-tracking', dot: '●' },
  approved: { label: 'QA approved', cls: 'border-stage-done/40 bg-stage-done/10 text-stage-done', dot: '✓' },
  flagged: { label: 'Flagged', cls: 'border-urgent/40 bg-urgent/10 text-urgent', dot: '⚑' },
  cancelled: { label: 'Cancelled', cls: 'border-line bg-ink/40 text-muted', dot: '—' },
}

// pg DATE arrives as an ISO timestamp at UTC midnight — take the date part
// as-is (never through new Date(), which would shift it a day in LA).
const dateStr = (v: string | null): string => (v ? v.slice(0, 10) : '')
const fmtDate = (v: string | null): string => {
  const s = dateStr(v)
  if (!s) return ''
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}
const fmtWhen = (iso: string | null): string => {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime())
    ? ''
    : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
const monthKey = (r: ApiQaRecording): string => {
  const s = dateStr(r.recordDate) || (r.createdAt ? r.createdAt.slice(0, 10) : '')
  return s ? s.slice(0, 7) : 'undated'
}
const monthLabel = (key: string): string => {
  if (key === 'undated') return 'No date'
  const [y, m] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

type FormState = {
  title: string
  projectId: string
  recordDate: string
  uploadTime: string
  recordingType: string
  resolution: string
  audioFolder: string
  audioCard: string
  videoCard: string
  dropboxUrl: string
  dropboxPath: string
  notes: string
  shooterIds: string[]
}

const emptyForm = (): FormState => ({
  title: '',
  projectId: '',
  recordDate: new Date().toISOString().slice(0, 10),
  uploadTime: '',
  recordingType: 'In person',
  resolution: '1080',
  audioFolder: '',
  audioCard: '',
  videoCard: '',
  dropboxUrl: '',
  dropboxPath: '',
  notes: '',
  shooterIds: [],
})

const formOf = (r: ApiQaRecording): FormState => ({
  title: r.title,
  projectId: r.projectId ?? '',
  recordDate: dateStr(r.recordDate),
  uploadTime: r.uploadTime,
  recordingType: r.recordingType,
  resolution: r.resolution,
  audioFolder: r.audioFolder,
  audioCard: r.audioCard,
  videoCard: r.videoCard,
  dropboxUrl: r.dropboxUrl,
  dropboxPath: r.dropboxPath,
  notes: r.notes,
  shooterIds: r.shooters.map((s) => s.id),
})

const toInput = (f: FormState): QaRecordingInput => ({
  title: f.title,
  projectId: f.projectId || null,
  recordDate: f.recordDate || null,
  uploadTime: f.uploadTime,
  recordingType: f.recordingType,
  resolution: f.resolution,
  audioFolder: f.audioFolder,
  audioCard: f.audioCard,
  videoCard: f.videoCard,
  dropboxUrl: f.dropboxUrl,
  dropboxPath: f.dropboxPath,
  notes: f.notes,
  shooterIds: f.shooterIds,
})

function ShooterPicker({
  users, selected, onChange,
}: {
  users: ApiQaContext['users']
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {users.map((u) => {
        const on = selected.includes(u.id)
        return (
          <button
            key={u.id}
            type="button"
            onClick={() => onChange(on ? selected.filter((id) => id !== u.id) : [...selected, u.id])}
            className={`rounded-full border px-2.5 py-1 text-xs font-bold transition ${
              on
                ? 'border-stage-mixing/60 bg-stage-mixing/15 text-stage-mixing'
                : 'border-line text-muted hover:text-text'
            }`}
          >
            {on ? '✓ ' : ''}{u.name}
          </button>
        )
      })}
    </div>
  )
}

function RecordingForm({
  ctx, initial, submitLabel, busy, onSubmit, onCancel,
}: {
  ctx: ApiQaContext
  initial: FormState
  submitLabel: string
  busy: boolean
  onSubmit: (f: FormState) => void
  onCancel: () => void
}) {
  const [f, setF] = useState<FormState>(initial)
  const [pickerOpen, setPickerOpen] = useState(false)
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((prev) => ({ ...prev, [k]: v }))
  const selectedShow = ctx.projects.find((p) => p.id === f.projectId)
  return (
    <div className="space-y-3">
      {pickerOpen && (
        <DropboxFolderPicker
          // Non-admins can only browse inside the selected show's folder
          // (server-side scope guard); admins can browse anywhere.
          scopeProjectId={f.projectId || undefined}
          initialPath={selectedShow?.dropboxFolder ?? undefined}
          onSelect={(p) => { set('dropboxPath', p); setPickerOpen(false) }}
          onCancel={() => setPickerOpen(false)}
        />
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <div className={labelCls}>Recording / session title</div>
          <input
            className={inputCls}
            placeholder="e.g. DBAWJK Recording — Greg Fitzsimmons"
            value={f.title}
            onChange={(e) => set('title', e.target.value)}
          />
        </div>
        <div>
          <div className={labelCls}>Show</div>
          <select className={inputCls} value={f.projectId} onChange={(e) => set('projectId', e.target.value)}>
            <option value="">— No show / one-off —</option>
            {ctx.projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <div className={labelCls}>Record date</div>
          <input type="date" className={inputCls} value={f.recordDate} onChange={(e) => set('recordDate', e.target.value)} />
        </div>
        <div>
          <div className={labelCls}>Recording type</div>
          <select className={inputCls} value={f.recordingType} onChange={(e) => set('recordingType', e.target.value)}>
            {RECORDING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <div className={labelCls}>Resolution</div>
          <select className={inputCls} value={f.resolution} onChange={(e) => set('resolution', e.target.value)}>
            {RESOLUTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <div className={labelCls}>Audio folder</div>
          <input className={inputCls} placeholder="e.g. 171014_185726" value={f.audioFolder} onChange={(e) => set('audioFolder', e.target.value)} />
        </div>
        <div>
          <div className={labelCls}>Upload time</div>
          <input className={inputCls} placeholder="e.g. 12:49 PM" value={f.uploadTime} onChange={(e) => set('uploadTime', e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <CardField label="Audio card(s)" options={AUDIO_CARDS} value={f.audioCard} onChange={(v) => set('audioCard', v)} />
        </div>
        <div className="sm:col-span-2">
          <CardField label="Video card(s)" options={VIDEO_CARDS} value={f.videoCard} onChange={(v) => set('videoCard', v)} />
        </div>
        <div className="sm:col-span-2">
          <div className={labelCls}>Dropbox folder</div>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            {f.dropboxPath ? (
              <span className="inline-flex items-center gap-2 rounded-xl border border-stage-stems/40 bg-stage-stems/10 px-3 py-1.5 text-xs font-mono text-stage-stems break-all">
                📁 {f.dropboxPath}
                <button type="button" onClick={() => set('dropboxPath', '')} className="text-stage-stems/70 hover:text-urgent" title="Clear">✕</button>
              </span>
            ) : null}
            <button type="button" onClick={() => setPickerOpen(true)} className={btnGhost}>
              📁 {f.dropboxPath ? 'Change folder' : 'Choose folder in Dropbox'}
            </button>
          </div>
          <input
            className={`${inputCls} mt-2 !py-1 !text-xs`}
            placeholder="…or paste a Dropbox link (fallback)"
            value={f.dropboxUrl}
            onChange={(e) => set('dropboxUrl', e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <div className={labelCls}>Who shot it</div>
          <div className="mt-1"><ShooterPicker users={ctx.users} selected={f.shooterIds} onChange={(ids) => set('shooterIds', ids)} /></div>
        </div>
        <div className="sm:col-span-2">
          <div className={labelCls}>Notes</div>
          <textarea
            className={`${inputCls} min-h-[64px]`}
            placeholder="e.g. Missing Tawny close-up shot"
            value={f.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          disabled={busy || !f.title.trim()}
          onClick={() => onSubmit(f)}
          className="rounded-full bg-stage-mixing/90 hover:bg-stage-mixing text-ink text-sm font-bold px-4 py-2 disabled:opacity-40 transition"
        >
          {busy ? 'Saving…' : submitLabel}
        </button>
        <button onClick={onCancel} className={btnGhost}>Cancel</button>
      </div>
    </div>
  )
}

function ChecklistBlock({
  rec, canWrite, onPatched,
}: {
  rec: ApiQaRecording
  canWrite: boolean
  onPatched: (r: ApiQaRecording) => void
}) {
  const [newLabel, setNewLabel] = useState('')
  const [newSpec, setNewSpec] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const toggle = async (checkId: string, checked: boolean) => {
    if (!canWrite) return
    setBusyId(checkId)
    try {
      const { recording } = await qaApi.setCheck(checkId, { checked })
      onPatched(recording)
    } finally {
      setBusyId(null)
    }
  }
  const add = async () => {
    if (!newLabel.trim()) return
    const { recording } = await qaApi.addCheck(rec.id, { label: newLabel.trim(), spec: newSpec.trim() })
    setNewLabel(''); setNewSpec('')
    onPatched(recording)
  }
  const remove = async (checkId: string) => {
    const out = await qaApi.deleteCheck(checkId)
    if (out.recording) onPatched(out.recording)
  }

  return (
    <div>
      <div className={labelCls}>Deliverables checklist</div>
      {rec.checks.length === 0 && (
        <div className="text-xs text-muted mt-1">
          No checklist on this recording{rec.projectId ? ' — set one up for this show in "Show checklists" and it will stamp onto future recordings' : ''}. Add items below.
        </div>
      )}
      <div className="mt-1.5 space-y-1">
        {rec.checks.map((c) => (
          <div key={c.id} className="flex items-start gap-2 group">
            <button
              disabled={!canWrite || busyId === c.id}
              onClick={() => void toggle(c.id, !c.checked)}
              className={`mt-0.5 w-5 h-5 shrink-0 rounded-md border grid place-items-center text-[11px] font-bold transition ${
                c.checked
                  ? 'border-stage-done/60 bg-stage-done/20 text-stage-done'
                  : 'border-line text-transparent hover:border-stage-done/40'
              }`}
              aria-label={c.checked ? 'Uncheck' : 'Check'}
            >
              ✓
            </button>
            <div className="min-w-0 flex-1">
              <span className={`text-sm ${c.checked ? 'text-text' : 'text-muted'}`}>{c.label}</span>
              {c.spec && <span className="ml-2 text-[11px] text-stage-tracking/90">{c.spec}</span>}
              {c.checked && c.checkedByName && (
                <span className="ml-2 text-[11px] text-muted">✓ {c.checkedByName}{c.checkedAt ? ` · ${fmtWhen(c.checkedAt)}` : ''}</span>
              )}
            </div>
            {canWrite && (
              <button
                onClick={() => void remove(c.id)}
                className="opacity-0 group-hover:opacity-100 text-muted hover:text-urgent text-xs transition"
                title="Remove item"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      {canWrite && (
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            className={`${inputCls} !w-auto flex-1 min-w-[160px]`}
            placeholder="Add item (e.g. Host Interview Audio)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void add() }}
          />
          <input
            className={`${inputCls} !w-auto w-40`}
            placeholder="Spec (e.g. 4K)"
            value={newSpec}
            onChange={(e) => setNewSpec(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void add() }}
          />
          <button onClick={() => void add()} className={btnGhost}>＋ Add</button>
        </div>
      )}
    </div>
  )
}

function RecordingCard({
  rec, ctx, canWrite, onPatched, onDeleted,
}: {
  rec: ApiQaRecording
  ctx: ApiQaContext
  canWrite: boolean
  onPatched: (r: ApiQaRecording) => void
  onDeleted: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const meta = STATUS_META[rec.status]
  const done = rec.checks.filter((c) => c.checked).length
  const total = rec.checks.length

  const setStatus = async (status: ApiQaRecording['status']) => {
    if (status === 'approved' && total > 0 && done < total) {
      const ok = window.confirm(`${total - done} checklist item${total - done === 1 ? '' : 's'} still unchecked. Approve anyway?`)
      if (!ok) return
    }
    setBusy(true)
    try {
      const { recording } = await qaApi.setStatus(rec.id, status)
      onPatched(recording)
    } finally {
      setBusy(false)
    }
  }

  const saveEdit = async (f: FormState) => {
    setBusy(true)
    try {
      const { recording } = await qaApi.updateRecording(rec.id, toInput(f))
      onPatched(recording)
      setEditing(false)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!window.confirm(`Delete "${rec.title}" from the QA log? This can't be undone.`)) return
    await qaApi.deleteRecording(rec.id)
    onDeleted(rec.id)
  }

  return (
    <div className={`${card} overflow-hidden ${rec.status === 'flagged' ? '!border-urgent/40' : ''}`}>
      <button className="w-full text-left px-4 py-3 hover:bg-line/20 transition" onClick={() => setOpen((v) => !v)}>
        <div className="flex items-center gap-3">
          {rec.projectCoverArtUrl ? (
            <img src={rec.projectCoverArtUrl} alt="" className="w-9 h-9 rounded-lg object-cover border border-line shrink-0" />
          ) : (
            <div className="w-9 h-9 rounded-lg border border-line bg-ink/60 grid place-items-center text-sm shrink-0">🎬</div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold truncate">{rec.title}</span>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${meta.cls}`}>
                {meta.dot} {meta.label}
              </span>
            </div>
            <div className="text-[11px] text-muted mt-0.5 flex items-center gap-2 flex-wrap">
              {rec.projectName && <span className="text-stage-producing font-bold">{rec.projectName}</span>}
              {rec.recordDate && <span>{fmtDate(rec.recordDate)}</span>}
              {rec.recordingType && <span>· {rec.recordingType}</span>}
              {rec.resolution && <span>· {rec.resolution}</span>}
              {rec.shooters.length > 0 && <span>· 📷 {rec.shooters.map((s) => s.name).join(', ')}</span>}
              {total > 0 && (
                <span className={done === total ? 'text-stage-done' : ''}>· ☑ {done}/{total}</span>
              )}
              {rec.status === 'approved' && rec.qaByName && (
                <span className="text-stage-done">· QA by {rec.qaByName} {fmtWhen(rec.qaAt)}</span>
              )}
            </div>
          </div>
          {total > 0 && (
            <div className="hidden sm:block w-24 shrink-0">
              <div className="h-1.5 rounded-full bg-ink/70 overflow-hidden">
                <div
                  className={`h-full rounded-full ${done === total ? 'bg-stage-done' : 'bg-stage-tracking'}`}
                  style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }}
                />
              </div>
            </div>
          )}
          <span className="text-muted text-xs shrink-0">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-line px-4 py-4 space-y-4">
          {editing ? (
            <RecordingForm
              ctx={ctx}
              initial={formOf(rec)}
              submitLabel="Save changes"
              busy={busy}
              onSubmit={(f) => void saveEdit(f)}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              <div className="grid sm:grid-cols-3 gap-x-6 gap-y-2 text-sm">
                <div><span className={labelCls}>Audio folder</span><div className="text-text/90">{rec.audioFolder || <span className="text-muted">—</span>}</div></div>
                <div><span className={labelCls}>Audio card</span><div className="text-text/90">{rec.audioCard || <span className="text-muted">—</span>}</div></div>
                <div><span className={labelCls}>Video card</span><div className="text-text/90">{rec.videoCard || <span className="text-muted">—</span>}</div></div>
                <div><span className={labelCls}>Upload time</span><div className="text-text/90">{rec.uploadTime || <span className="text-muted">—</span>}</div></div>
                <div className="sm:col-span-2">
                  <span className={labelCls}>Dropbox folder</span>
                  <div className="truncate">
                    {rec.dropboxPath || rec.dropboxUrl ? (
                      <a
                        href={rec.dropboxUrl || `https://www.dropbox.com/home${rec.dropboxPath.split('/').map(encodeURIComponent).join('/')}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-stage-stems hover:underline text-sm"
                      >
                        📁 {rec.dropboxPath ? <span className="font-mono text-xs">{rec.dropboxPath}</span> : 'Open in Dropbox'}
                      </a>
                    ) : (
                      <span className="text-muted">Not uploaded yet</span>
                    )}
                  </div>
                </div>
              </div>

              {rec.notes && (
                <div>
                  <span className={labelCls}>Notes</span>
                  <div className="text-sm text-text/90 whitespace-pre-wrap">{rec.notes}</div>
                </div>
              )}

              <ChecklistBlock rec={rec} canWrite={canWrite} onPatched={onPatched} />

              {canWrite && (
                <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-line/60">
                  {rec.status !== 'approved' && (
                    <button
                      disabled={busy}
                      onClick={() => void setStatus('approved')}
                      className="rounded-full bg-stage-done/90 hover:bg-stage-done text-ink text-xs font-bold px-3.5 py-1.5 disabled:opacity-40 transition"
                    >
                      ✓ Approve QA
                    </button>
                  )}
                  {rec.status !== 'flagged' && (
                    <button disabled={busy} onClick={() => void setStatus('flagged')} className={`${btnGhost} !text-urgent !border-urgent/40 hover:!bg-urgent/10`}>
                      ⚑ Flag a problem
                    </button>
                  )}
                  {(rec.status === 'approved' || rec.status === 'flagged') && (
                    <button disabled={busy} onClick={() => void setStatus('pending')} className={btnGhost}>
                      ↺ Reopen
                    </button>
                  )}
                  <div className="flex-1" />
                  <button onClick={() => setEditing(true)} className={btnGhost}>✏️ Edit</button>
                  <button onClick={() => void remove()} className={`${btnGhost} hover:!text-urgent hover:!border-urgent/40`}>🗑</button>
                </div>
              )}
              <div className="text-[11px] text-muted">
                Logged{rec.createdByName ? ` by ${rec.createdByName}` : ''} · {fmtWhen(rec.createdAt)}
                {rec.status === 'flagged' && rec.qaByName ? ` · flagged by ${rec.qaByName} ${fmtWhen(rec.qaAt)}` : ''}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function TemplateEditor({ ctx }: { ctx: ApiQaContext }) {
  const [projectId, setProjectId] = useState(ctx.projects[0]?.id ?? '')
  const [items, setItems] = useState<Array<{ label: string; spec: string }>>([])
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    if (!projectId) return
    setLoaded(false)
    void qaApi.template(projectId).then(({ items }: { items: ApiQaTemplateItem[] }) => {
      setItems(items.map((i) => ({ label: i.label, spec: i.spec })))
      setLoaded(true)
    })
  }, [projectId])

  const save = async () => {
    setSaving(true)
    try {
      const { items: saved } = await qaApi.saveTemplate(projectId, items.filter((i) => i.label.trim()))
      setItems(saved.map((i) => ({ label: i.label, spec: i.spec })))
      setSavedAt(Date.now())
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`${card} p-4 space-y-3`}>
      <div>
        <div className="text-sm font-bold">Show checklists</div>
        <div className="text-xs text-muted mt-0.5">
          The deliverables every recording of a show must have (cameras, audio tracks, specs). New recordings for the show get this list stamped on automatically.
        </div>
      </div>
      <div className="max-w-xs">
        <div className={labelCls}>Show</div>
        <select className={inputCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          {ctx.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      {!loaded ? (
        <div className="text-xs text-muted">Loading…</div>
      ) : (
        <>
          <div className="space-y-2">
            {items.map((item, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className={`${inputCls} flex-1`}
                  placeholder="Deliverable (e.g. Full Interview Host Camera)"
                  value={item.label}
                  onChange={(e) => setItems(items.map((it, j) => (j === i ? { ...it, label: e.target.value } : it)))}
                />
                <input
                  className={`${inputCls} w-44`}
                  placeholder="Spec (e.g. Wide & Close Up)"
                  value={item.spec}
                  onChange={(e) => setItems(items.map((it, j) => (j === i ? { ...it, spec: e.target.value } : it)))}
                />
                <button
                  onClick={() => setItems(items.filter((_, j) => j !== i))}
                  className="text-muted hover:text-urgent text-sm px-1"
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setItems([...items, { label: '', spec: '' }])} className={btnGhost}>＋ Add deliverable</button>
            <button
              onClick={() => void save()}
              disabled={saving}
              className="rounded-full bg-stage-mixing/90 hover:bg-stage-mixing text-ink text-xs font-bold px-3.5 py-1.5 disabled:opacity-40 transition"
            >
              {saving ? 'Saving…' : 'Save checklist'}
            </button>
            {savedAt && Date.now() - savedAt < 4000 && <span className="text-xs text-stage-done">Saved ✓</span>}
          </div>
        </>
      )}
    </div>
  )
}

export default function QAPage() {
  useAuth()
  const [ctx, setCtx] = useState<ApiQaContext | null>(null)
  const [recordings, setRecordings] = useState<ApiQaRecording[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showFilter, setShowFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [creating, setCreating] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([qaApi.context(), qaApi.recordings()])
      setCtx(c)
      setRecordings(r.recordings)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const patched = (r: ApiQaRecording) =>
    setRecordings((prev) => (prev ? prev.map((x) => (x.id === r.id ? r : x)) : prev))
  const deleted = (id: string) =>
    setRecordings((prev) => (prev ? prev.filter((x) => x.id !== id) : prev))

  const create = async (f: FormState) => {
    setCreateBusy(true)
    try {
      const { recording } = await qaApi.createRecording(toInput(f))
      setRecordings((prev) => (prev ? [recording, ...prev] : [recording]))
      setCreating(false)
    } finally {
      setCreateBusy(false)
    }
  }

  const filtered = useMemo(() => {
    if (!recordings) return []
    return recordings.filter(
      (r) =>
        (!showFilter || r.projectId === showFilter) &&
        (!statusFilter || r.status === statusFilter),
    )
  }, [recordings, showFilter, statusFilter])

  const groups = useMemo(() => {
    const byMonth = new Map<string, ApiQaRecording[]>()
    for (const r of filtered) {
      const key = monthKey(r)
      const list = byMonth.get(key) ?? []
      list.push(r)
      byMonth.set(key, list)
    }
    return Array.from(byMonth.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [filtered])

  const pendingCount = recordings?.filter((r) => r.status === 'pending').length ?? 0
  const flaggedCount = recordings?.filter((r) => r.status === 'flagged').length ?? 0

  if (error === 'no_podcast_access') {
    return (
      <div className={`${card} p-8 text-center`}>
        <div className="text-3xl mb-2">🔒</div>
        <div className="font-bold">Production QA is for the podcast team</div>
        <div className="text-sm text-muted mt-1">
          You need access to at least one podcast project to use the QA board. Ask an admin to add you to a show.
        </div>
      </div>
    )
  }
  if (error) {
    return <div className={`${card} p-6 text-sm text-urgent`}>Couldn't load the QA board: {error}</div>
  }
  if (!ctx || !recordings) {
    return <div className="text-muted text-sm py-12 text-center">Loading QA board…</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-4xl">Production QA</h1>
          <p className="text-sm text-muted mt-1">
            Confirm every recording was captured and stored properly — the old QA sheet, now with real checklists.
            {pendingCount > 0 && <span className="text-stage-tracking font-bold"> {pendingCount} awaiting QA.</span>}
            {flaggedCount > 0 && <span className="text-urgent font-bold"> {flaggedCount} flagged.</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setTemplatesOpen((v) => !v)} className={btnGhost}>
            ☑ Show checklists
          </button>
          {ctx.canWrite && (
            <button
              onClick={() => setCreating((v) => !v)}
              className="rounded-full bg-stage-mixing/90 hover:bg-stage-mixing text-ink text-sm font-bold px-4 py-2 transition"
            >
              ＋ Log recording
            </button>
          )}
        </div>
      </div>

      {templatesOpen && ctx.projects.length > 0 && <TemplateEditor ctx={ctx} />}

      {creating && ctx.canWrite && (
        <div className={`${card} p-4`}>
          <div className="text-sm font-bold mb-3">Log a recording</div>
          <RecordingForm
            ctx={ctx}
            initial={emptyForm()}
            submitLabel="Log recording"
            busy={createBusy}
            onSubmit={(f) => void create(f)}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <select className={`${inputCls} !w-auto`} value={showFilter} onChange={(e) => setShowFilter(e.target.value)}>
          <option value="">All shows</option>
          {ctx.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {(['', 'pending', 'approved', 'flagged'] as const).map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
              statusFilter === s
                ? 'border-stage-mixing/60 bg-stage-mixing/15 text-stage-mixing'
                : 'border-line text-muted hover:text-text'
            }`}
          >
            {s === '' ? 'All' : STATUS_META[s].label}
          </button>
        ))}
      </div>

      {groups.length === 0 && (
        <div className={`${card} p-10 text-center text-sm text-muted`}>
          Nothing here yet. {ctx.canWrite ? 'Hit "＋ Log recording" after a shoot and run QA once the footage is in Dropbox.' : ''}
        </div>
      )}

      {groups.map(([key, list]) => (
        <div key={key} className="space-y-2">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-xl text-text/90">{monthLabel(key)}</h2>
            <span className="text-[11px] text-muted">{list.length} recording{list.length === 1 ? '' : 's'}</span>
            <div className="flex-1 border-t border-line/60" />
          </div>
          <div className="space-y-2">
            {list.map((r) => (
              <RecordingCard
                key={r.id}
                rec={r}
                ctx={ctx}
                canWrite={ctx.canWrite}
                onPatched={patched}
                onDeleted={deleted}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

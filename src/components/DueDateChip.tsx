import { useEffect, useRef, useState } from 'react'

type Props = {
  value: string | null | undefined
  onChange: (next: string | null) => Promise<void> | void
  className?: string
}

// Inline due-date control: shows a pill with a colored urgency state.
// Click to open a native datetime-local picker. Clearing it sets dueAt = null.
export default function DueDateChip({ value, onChange, className = '' }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(toLocalInput(value))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft(toLocalInput(value))
  }, [value])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      // Try to immediately pop the native picker on mobile
      try {
        ;(inputRef.current as HTMLInputElement & { showPicker?: () => void }).showPicker?.()
      } catch {
        /* noop */
      }
    }
  }, [editing])

  async function commit(next: string) {
    setEditing(false)
    if (next === '') {
      await onChange(null)
      return
    }
    const iso = new Date(next).toISOString()
    await onChange(iso)
  }

  if (editing) {
    return (
      <div className="inline-flex items-center gap-1">
        <input
          ref={inputRef}
          type="datetime-local"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void commit(draft)
            }
            if (e.key === 'Escape') {
              setDraft(toLocalInput(value))
              setEditing(false)
            }
          }}
          className="bg-ink/40 border border-stage-mastering/60 rounded text-[11px] px-1.5 py-0.5 outline-none"
        />
        {value && (
          <button
            onClick={() => void commit('')}
            title="Clear"
            className="text-muted hover:text-urgent text-xs"
          >
            ✕
          </button>
        )}
      </div>
    )
  }

  if (!value) {
    return (
      <button
        onClick={() => setEditing(true)}
        className={`text-[11px] text-muted/70 hover:text-stage-stems border border-line border-dashed rounded-full px-2 py-0.5 ${className}`}
      >
        + Due
      </button>
    )
  }

  const date = new Date(value)
  const now = Date.now()
  const ms = date.getTime() - now
  const hours = ms / (1000 * 60 * 60)
  const overdue = ms < 0
  const dueSoon = !overdue && hours <= 24
  const cls = overdue
    ? 'text-urgent border-urgent/60 bg-urgent/10 animate-pulseRed'
    : dueSoon
      ? 'text-stage-tracking border-stage-tracking/40 bg-stage-tracking/10'
      : 'text-stage-stems border-stage-stems/40 bg-stage-stems/10'

  return (
    <button
      onClick={() => setEditing(true)}
      title={`Due ${date.toLocaleString()}`}
      className={`inline-flex items-center gap-1 text-[11px] border rounded-full px-2 py-0.5 font-bold uppercase tracking-wider ${cls} ${className}`}
    >
      <span>📅</span>
      <span>{formatShort(date, overdue)}</span>
    </button>
  )
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

// Convert ISO timestamp -> "YYYY-MM-DDTHH:MM" in local time for the input.
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatShort(date: Date, overdue: boolean): string {
  const now = new Date()
  const sameYear = date.getFullYear() === now.getFullYear()
  const dayOpts: Intl.DateTimeFormatOptions = sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: '2-digit' }
  const day = date.toLocaleDateString(undefined, dayOpts)
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (overdue) {
    const ms = now.getTime() - date.getTime()
    const days = Math.floor(ms / (1000 * 60 * 60 * 24))
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24)
    if (days >= 1) return `Overdue ${days}d`
    return `Overdue ${hours}h`
  }
  return `${day} · ${time}`
}

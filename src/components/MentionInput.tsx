import { useEffect, useRef, useState } from 'react'
import type { ApiMember } from '../api'

type Props = {
  value: string
  onChange: (next: string) => void
  members: ApiMember[]
  placeholder?: string
  rows?: number
  multiline?: boolean
  className?: string
  onEnter?: () => void
  disabled?: boolean
}

export default function MentionInput({
  value,
  onChange,
  members,
  placeholder,
  rows = 3,
  multiline = false,
  className = '',
  onEnter,
  disabled,
}: Props) {
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  const [trigger, setTrigger] = useState<{ start: number; query: string } | null>(null)
  const [highlight, setHighlight] = useState(0)

  // Detect "@" + token under the cursor
  function detect(text: string, caret: number) {
    // Walk back from caret to find @ that starts a fresh token
    let i = caret - 1
    while (i >= 0) {
      const ch = text[i]
      if (ch === '@') {
        const before = i === 0 ? ' ' : text[i - 1]
        if (/\s/.test(before) || before === '\n' || i === 0) {
          const query = text.slice(i + 1, caret)
          if (/^[a-zA-Z0-9_.-]*$/.test(query)) {
            return { start: i, query }
          }
        }
        return null
      }
      if (/\s/.test(ch) || ch === '\n') return null
      i--
    }
    return null
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const next = e.target.value
    onChange(next)
    const caret = e.target.selectionStart ?? next.length
    const t = detect(next, caret)
    setTrigger(t)
    setHighlight(0)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (trigger && filtered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlight((h) => (h + 1) % filtered.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlight((h) => (h - 1 + filtered.length) % filtered.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertMention(filtered[highlight])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setTrigger(null)
        return
      }
    }
    if (e.key === 'Enter' && !multiline && onEnter) {
      e.preventDefault()
      onEnter()
    }
  }

  function insertMention(member: ApiMember) {
    if (!trigger || !ref.current) return
    const handle = (member.display_name || member.name).split(' ')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '')
    const before = value.slice(0, trigger.start)
    const after = value.slice((ref.current.selectionStart ?? trigger.start + 1 + trigger.query.length))
    const inserted = `@${handle} `
    const next = before + inserted + after
    onChange(next)
    setTrigger(null)
    // restore cursor after inserted mention
    requestAnimationFrame(() => {
      if (!ref.current) return
      const pos = before.length + inserted.length
      ref.current.focus()
      ref.current.setSelectionRange(pos, pos)
    })
  }

  const filtered = trigger
    ? members
        .filter((m) => {
          const handle = (m.display_name || m.name).toLowerCase()
          const full = m.name.toLowerCase()
          return handle.includes(trigger.query.toLowerCase()) || full.includes(trigger.query.toLowerCase())
        })
        .slice(0, 6)
    : []

  useEffect(() => {
    if (highlight >= filtered.length && filtered.length > 0) setHighlight(0)
  }, [filtered.length, highlight])

  const sharedProps = {
    ref: ref as never,
    value,
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    placeholder,
    disabled,
    className,
  }

  return (
    <div className="relative">
      {multiline ? (
        <textarea {...(sharedProps as React.TextareaHTMLAttributes<HTMLTextAreaElement> & { ref: React.Ref<HTMLTextAreaElement> })} rows={rows} />
      ) : (
        <input {...(sharedProps as React.InputHTMLAttributes<HTMLInputElement> & { ref: React.Ref<HTMLInputElement> })} type="text" />
      )}
      {trigger && filtered.length > 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 rounded-xl border border-line bg-panel/95 backdrop-blur-md shadow-2xl overflow-hidden">
          {filtered.map((m, i) => {
            const handle = (m.display_name || m.name).split(' ')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '')
            return (
              <button
                key={m.id}
                onMouseDown={(e) => {
                  e.preventDefault()
                  insertMention(m)
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left ${
                  i === highlight ? 'bg-stage-mastering/15 text-text' : 'text-text/90 hover:bg-line/40'
                }`}
              >
                <span>
                  <span className="text-stage-mastering font-bold">@{handle}</span>
                  <span className="text-muted text-xs ml-2">{m.name}</span>
                </span>
                {m.role === 'admin' && (
                  <span className="text-[9px] uppercase tracking-wider text-stage-mastering bg-stage-mastering/10 border border-stage-mastering/30 rounded px-1.5 py-0.5 font-bold">
                    Admin
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Render a body string with @handles styled as colored chips, against a member list.
export function renderWithMentions(body: string, members: ApiMember[]): React.ReactNode {
  const handles = new Map<string, ApiMember>()
  for (const m of members) {
    const h = (m.display_name || m.name).split(' ')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '')
    if (h) handles.set(h, m)
  }
  const parts: React.ReactNode[] = []
  const re = /@([a-zA-Z0-9_-]+)/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(body)) !== null) {
    if (match.index > last) parts.push(body.slice(last, match.index))
    const handle = match[1].toLowerCase()
    const member = handles.get(handle)
    if (member) {
      parts.push(
        <span
          key={`${match.index}-${handle}`}
          className="inline-flex items-baseline rounded px-1 py-0.5 bg-stage-mastering/15 text-stage-mastering font-bold text-[0.95em]"
          title={member.name}
        >
          @{handle}
        </span>,
      )
    } else {
      parts.push(`@${match[1]}`)
    }
    last = match.index + match[0].length
  }
  if (last < body.length) parts.push(body.slice(last))
  return parts.length === 0 ? body : <>{parts}</>
}

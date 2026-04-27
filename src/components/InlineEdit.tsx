import { useEffect, useRef, useState } from 'react'

type Props = {
  value: string
  placeholder?: string
  onSave: (next: string) => Promise<void>
  className?: string
  inputClassName?: string
  emptyLabel?: string
  multiline?: boolean
}

export default function InlineEdit({
  value,
  placeholder,
  onSave,
  className = '',
  inputClassName = '',
  emptyLabel = 'Click to edit',
  multiline = false,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)

  useEffect(() => {
    setDraft(value)
  }, [value])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      if ('select' in inputRef.current) inputRef.current.select()
    }
  }, [editing])

  async function commit() {
    if (saving) return
    if (draft.trim() === value.trim()) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await onSave(draft.trim())
      setEditing(false)
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    setDraft(value)
    setEditing(false)
  }

  if (editing) {
    if (multiline) {
      return (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') cancel()
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void commit()
          }}
          placeholder={placeholder}
          rows={2}
          className={`bg-ink/40 border border-stage-mastering/60 rounded-lg px-2 py-1 outline-none w-full resize-none ${inputClassName}`}
          disabled={saving}
        />
      )
    }
    return (
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') cancel()
          if (e.key === 'Enter') void commit()
        }}
        placeholder={placeholder}
        className={`bg-ink/40 border border-stage-mastering/60 rounded-lg px-2 py-1 outline-none w-full ${inputClassName}`}
        disabled={saving}
      />
    )
  }

  const display = value || emptyLabel
  return (
    <button
      onClick={() => setEditing(true)}
      title="Click to edit"
      className={`text-left rounded-lg hover:bg-line/30 px-2 py-1 -mx-2 transition group ${className} ${
        !value ? 'text-muted italic' : ''
      }`}
    >
      {display}{' '}
      <span className="opacity-0 group-hover:opacity-60 text-[11px] ml-1 align-middle">✎</span>
    </button>
  )
}

// The Straw Hut Rolodex: a workspace-wide contact book. Responders file in
// here automatically; Caroline can also paste in contacts she already has.
// From here, selected contacts get pulled into the CURRENT show's outreach as
// fresh prospects (deduped by email).
import { useEffect, useState } from 'react'
import { api, type ApiRolodexContact } from '../api'

// Paste one contact per line. Split on tab / pipe / comma; the field with an
// "@" is the email, the first non-email field is the name, the rest is facts.
function parsePaste(text: string): Array<{ name: string; email: string; context?: string }> {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const parts = line.split(/\t|\||,/).map((s) => s.trim()).filter(Boolean)
    const email = parts.find((p) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p)) ?? ''
    const rest = parts.filter((p) => p !== email)
    return { name: rest[0] ?? '', email, context: rest.slice(1).join(', ') || undefined }
  }).filter((c) => c.email && c.name)
}

export default function RolodexPanel({
  projectId, onImported,
}: {
  projectId: string
  onImported: () => void
}) {
  const [contacts, setContacts] = useState<ApiRolodexContact[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  async function load() {
    try {
      const r = await api.getRolodex()
      setContacts(r.contacts)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed')
    }
  }
  useEffect(() => { void load() }, [])

  const filtered = (contacts ?? []).filter((c) => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
      || (c.client_name ?? '').toLowerCase().includes(q) || (c.source_show ?? '').toLowerCase().includes(q)
  })

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function addPasted() {
    const parsed = parsePaste(paste)
    if (parsed.length === 0) { setErr('Nothing to add — paste lines like "Name, email@x.com, a fact or two".'); return }
    setBusy(true); setErr(null); setMsg(null)
    try {
      const r = await api.addRolodexBulk(parsed)
      setMsg(`✓ Added ${r.added} to the Rolodex${r.skipped ? ` · skipped ${r.skipped} without a valid email` : ''}.`)
      setPaste(''); setShowAdd(false)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'add failed')
    } finally { setBusy(false) }
  }

  async function pullIntoShow() {
    if (selected.size === 0) { setErr('Select at least one contact to pull in.'); return }
    setBusy(true); setErr(null); setMsg(null)
    try {
      const r = await api.importRolodexToProject(projectId, Array.from(selected))
      setMsg(`✓ Pulled ${r.imported} into this show${r.dupes ? ` · ${r.dupes} already here` : ''}. They still need a sentence + verification.`)
      setSelected(new Set())
      onImported()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'pull failed')
    } finally { setBusy(false) }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Remove ${name} from the Rolodex?`)) return
    try {
      await api.deleteRolodexContact(id)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'delete failed')
    }
  }

  return (
    <div className="rounded-xl border border-stage-tracking/40 bg-stage-tracking/5 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-stage-tracking font-bold">📇 Straw Hut Rolodex</div>
          <div className="text-[10px] text-muted/80">
            Everyone who's replied, plus anyone you add. Pull them into this show's outreach anytime.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="text-[10px] uppercase tracking-wider text-stage-tracking border border-stage-tracking/40 rounded-full px-3 py-1 hover:bg-stage-tracking/10 font-bold"
          >
            {showAdd ? 'Cancel' : '➕ Add contacts'}
          </button>
          <button
            onClick={() => void pullIntoShow()}
            disabled={busy || selected.size === 0}
            className="text-[10px] uppercase tracking-wider text-white bg-stage-tracking rounded-full px-3 py-1 hover:opacity-90 disabled:opacity-40 font-bold"
            title="Add the selected contacts to this show's outreach as new prospects."
          >
            ⬇ Pull {selected.size || ''} into this show
          </button>
        </div>
      </div>

      {msg && <div className="text-[11px] text-emerald-300">{msg}</div>}
      {err && <div className="text-[11px] text-urgent">{err}</div>}

      {showAdd && (
        <div className="space-y-2">
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={5}
            placeholder={"One per line — Name, email@example.com, a fact or two\nJane Doe, jane@agency.com, Comedian, new Netflix special on burnout\nTom Hayes, tom@mgmt.com, manager for Pedro Pascal"}
            className="w-full bg-ink/40 border border-line rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-stage-tracking"
          />
          <button
            onClick={() => void addPasted()}
            disabled={busy || !paste.trim()}
            className="text-[10px] uppercase tracking-wider text-white bg-stage-tracking rounded-full px-3 py-1 hover:opacity-90 disabled:opacity-40 font-bold"
          >
            {busy ? 'Adding…' : 'Add to Rolodex'}
          </button>
        </div>
      )}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search name, email, client, show…"
        className="w-full bg-ink/40 border border-line rounded-full px-3 py-1.5 text-xs focus:outline-none focus:border-stage-tracking"
      />

      {contacts === null ? (
        <div className="text-[11px] text-muted">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-[11px] text-muted">
          {contacts.length === 0 ? 'Empty for now — responders will land here, or add some above.' : 'No matches.'}
        </div>
      ) : (
        <div className="max-h-72 overflow-y-auto rounded-lg border border-line divide-y divide-line/60">
          {filtered.map((c) => (
            <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-ink/30 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onChange={() => toggle(c.id)}
                className="accent-stage-tracking"
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold truncate">
                  {c.name}
                  {c.client_name ? <span className="text-muted font-normal"> (for {c.client_name})</span> : null}
                  {c.tags.includes('responded') ? <span className="ml-1 text-[9px] uppercase tracking-wider text-emerald-300">· replied</span> : null}
                </div>
                <div className="text-[10px] text-muted truncate">
                  {c.email}{c.source_show ? ` · from ${c.source_show}` : ''}{c.context ? ` · ${c.context}` : ''}
                </div>
              </div>
              <button
                onClick={(e) => { e.preventDefault(); void remove(c.id, c.name) }}
                className="text-[10px] text-muted hover:text-urgent px-1"
                title="Remove from Rolodex"
              >
                ✕
              </button>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

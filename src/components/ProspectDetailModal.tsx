// Full-detail edit + AI-generate modal for a single outreach prospect.
// Opens when the operator clicks a prospect row. Every field is
// editable inline. The unique sentence has a "Generate with Claude"
// button that reads the show's Show Brief + this prospect's context
// and writes the sentence tailored to this specific person on this
// specific show.
import { useEffect, useState } from 'react'
import { api, type ApiOutreachProspect } from '../api'

const RECIPIENT_OPTIONS: Array<{ value: ApiOutreachProspect['recipient_type']; label: string }> = [
  { value: 'person', label: 'The guest themselves' },
  { value: 'agent', label: 'Their agent' },
  { value: 'manager', label: 'Their manager' },
  { value: 'other', label: 'Other (PR, assistant, unclear)' },
]

export default function ProspectDetailModal({
  prospect, onClose, onChanged,
}: {
  prospect: ApiOutreachProspect
  onClose: () => void
  onChanged: () => void
}) {
  const [name, setName] = useState(prospect.name)
  const [fullName, setFullName] = useState(prospect.full_name ?? '')
  const [email, setEmail] = useState(prospect.email ?? '')
  const [recipientType, setRecipientType] = useState<ApiOutreachProspect['recipient_type']>(prospect.recipient_type)
  const [clientName, setClientName] = useState(prospect.client_name ?? '')
  const [context, setContext] = useState(prospect.context ?? '')
  const [uniqueSentence, setUniqueSentence] = useState(prospect.unique_sentence ?? '')
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await api.updateOutreachProspect(prospect.id, {
        name: name.trim(),
        fullName: fullName.trim() || null,
        email: email.trim() || null,
        recipientType,
        clientName: (recipientType === 'agent' || recipientType === 'manager') && clientName.trim() ? clientName.trim() : null,
        context: context.trim() || null,
        uniqueSentence: uniqueSentence.trim() || null,
      })
      setSavedAt(Date.now())
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed')
    } finally {
      setSaving(false)
    }
  }

  async function generateSentence() {
    setGenerating(true)
    setError(null)
    try {
      // Save any unsaved context first so Claude reads the freshest state.
      if (
        (context.trim() || null) !== (prospect.context ?? null) ||
        recipientType !== prospect.recipient_type ||
        ((clientName.trim() || null) !== (prospect.client_name ?? null))
      ) {
        await api.updateOutreachProspect(prospect.id, {
          recipientType,
          clientName: (recipientType === 'agent' || recipientType === 'manager') && clientName.trim() ? clientName.trim() : null,
          context: context.trim() || null,
        })
      }
      const r = await api.generateUniqueSentence(prospect.id)
      setUniqueSentence(r.sentence)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'generation failed')
    } finally {
      setGenerating(false)
    }
  }

  async function remove() {
    if (!confirm(`Remove ${prospect.name}? This can't be undone.`)) return
    try {
      await api.deleteOutreachProspect(prospect.id)
      onChanged()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete failed')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/85 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-line bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-line flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted font-bold">Prospect</div>
            <h2 className="text-lg font-bold mt-0.5">{prospect.name || 'Unnamed'}</h2>
          </div>
          <button onClick={onClose} className="text-muted hover:text-text text-xl leading-none">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="rounded-lg border border-urgent/40 bg-urgent/5 px-3 py-2 text-xs text-urgent">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-muted font-bold">Name (for [name] token) *</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full bg-ink/40 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-stage-mastering"
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-muted font-bold">Full name (optional)</span>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="mt-1 w-full bg-ink/40 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-stage-mastering"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-muted font-bold">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full bg-ink/40 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-stage-mastering"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-muted font-bold">Who is this?</span>
              <select
                value={recipientType}
                onChange={(e) => setRecipientType(e.target.value as ApiOutreachProspect['recipient_type'])}
                className="mt-1 w-full bg-ink/40 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-stage-mastering"
              >
                {RECIPIENT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <span className="block text-[10px] text-muted/70 mt-1 leading-snug">
                Not sure? Leave it on “The guest.” You don't have to know if it's their PR, agent, or manager.
              </span>
            </label>
            {(recipientType === 'agent' || recipientType === 'manager') && (
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-muted font-bold">Client they represent</span>
                <input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className="mt-1 w-full bg-ink/40 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-stage-mastering"
                />
              </label>
            )}
          </div>

          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-muted font-bold">
              Who are they? — Claude turns this into their personal line
            </span>
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={3}
              placeholder="Type a fact or two here… e.g. Comedian, just dropped a Netflix special on burnout"
              className="mt-1 w-full bg-ink/40 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-stage-mastering"
            />
            <span className="block text-[10px] text-muted/70 mt-1 leading-snug">
              One line is plenty. Found the email on their Instagram and don't know whose it is? Say exactly that — Claude keeps it general.
            </span>
          </label>

          <div className="rounded-xl border-2 border-emerald-500/40 bg-emerald-500/5 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-bold">Unique sentence</div>
                <div className="text-[10px] text-emerald-100/70">Add a note above, then click Generate → it fills the [unique_sentence] spot in the email.</div>
              </div>
              <button
                onClick={() => void generateSentence()}
                disabled={generating}
                className="text-[10px] uppercase tracking-wider text-emerald-950 bg-emerald-400 rounded-full px-3 py-1.5 hover:bg-emerald-300 disabled:opacity-40 font-bold"
                title="Save context first, then let Claude write a tailored sentence for this person + this show."
              >
                {generating ? 'Generating…' : '✨ Generate with Claude'}
              </button>
            </div>
            <textarea
              value={uniqueSentence}
              onChange={(e) => setUniqueSentence(e.target.value)}
              rows={4}
              placeholder="Empty — click Generate, or type it yourself."
              className="w-full bg-ink/40 border border-emerald-500/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-300 italic"
            />
          </div>
        </div>

        <div className="p-4 border-t border-line flex items-center justify-between gap-3">
          <button
            onClick={() => void remove()}
            className="text-[10px] uppercase tracking-wider text-urgent border border-urgent/40 rounded-full px-3 py-1.5 hover:bg-urgent/10 font-bold"
          >
            Delete
          </button>
          <div className="flex items-center gap-2">
            {savedAt && <span className="text-[10px] text-muted">Saved {new Date(savedAt).toLocaleTimeString()}</span>}
            <button
              onClick={onClose}
              className="text-[10px] uppercase tracking-wider text-muted border border-line rounded-full px-3 py-1.5 hover:bg-ink/40 font-bold"
            >
              Close
            </button>
            <button
              onClick={() => void save()}
              disabled={saving || !name.trim()}
              className="text-[10px] uppercase tracking-wider text-stage-mastering border border-stage-mastering/40 rounded-full px-3 py-1.5 hover:bg-stage-mastering/10 disabled:opacity-40 font-bold"
            >
              {saving ? 'Saving…' : '💾 Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

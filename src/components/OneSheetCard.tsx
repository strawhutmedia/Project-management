// One-sheet publish + preview control for a podcast show. Sits on
// the per-show outreach page. Toggles the public /shows/<slug> page
// on/off, shows the URL, gives inline fields for the copy that lives
// on the page (tagline, notable guests, contact email).
import { useEffect, useState } from 'react'
import { api, type ApiProject } from '../api'

type Fields = {
  heroTagline: string
  guestPitch: string
  contactEmail: string
  brandHex: string
  notableGuests: string
  oneSheetPublished: boolean
}

function fromProject(p: ApiProject): Fields {
  return {
    heroTagline: p.heroTagline ?? '',
    guestPitch: p.guestPitch ?? '',
    contactEmail: p.contactEmail ?? 'booking@strawhutmedia.com',
    brandHex: p.brandHex ?? '',
    notableGuests: p.notableGuests ?? '',
    oneSheetPublished: !!p.oneSheetPublished,
  }
}

export default function OneSheetCard({ project, onSaved }: { project: ApiProject; onSaved: () => void }) {
  const [fields, setFields] = useState<Fields>(fromProject(project))
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [autoPopulating, setAutoPopulating] = useState(false)

  async function autoPopulate() {
    const ok = confirm(
      'Read this show\'s episodes + Show Brief and draft the one-sheet copy (hero tagline, notable guests, guesting pitch, brand color)?\n\n' +
      'Overwrites any existing copy. Publishes the one-sheet automatically so you can preview the URL immediately.',
    )
    if (!ok) return
    setAutoPopulating(true)
    setError(null)
    try {
      const r = await api.autoPopulateOneSheet(project.id)
      setFields({
        heroTagline: r.heroTagline,
        guestPitch: r.guestPitch,
        contactEmail: fields.contactEmail || 'booking@strawhutmedia.com',
        brandHex: r.brandHex,
        notableGuests: r.notableGuests,
        oneSheetPublished: true,
      })
      setSavedAt(Date.now())
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'auto-populate failed')
    } finally {
      setAutoPopulating(false)
    }
  }

  useEffect(() => {
    setFields(fromProject(project))
  }, [project.id])

  const url = project.slug
    ? `${window.location.origin}/shows/${project.slug}`
    : null

  async function save(patch: Partial<Fields>) {
    setSaving(true)
    setError(null)
    try {
      await api.updateProject(project.id, patch as Record<string, unknown>)
      setSavedAt(Date.now())
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed')
    } finally {
      setSaving(false)
    }
  }

  async function togglePublish() {
    const next = !fields.oneSheetPublished
    setFields((f) => ({ ...f, oneSheetPublished: next }))
    await save({ oneSheetPublished: next })
  }

  async function saveField<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((f) => ({ ...f, [key]: value }))
    await save({ [key]: value } as Partial<Fields>)
  }

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">📄 Public one-sheet</h2>
          <p className="text-[11px] text-muted/80 mt-1 max-w-2xl">
            A branded, single-page pitch that every outreach email links to. Publishes at a public URL you can share
            anywhere. Elegant, mobile-friendly, uses the show's cover art.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => void autoPopulate()}
            disabled={saving || autoPopulating}
            className="text-[10px] uppercase tracking-wider text-emerald-950 bg-emerald-400 rounded-full px-3 py-1.5 hover:bg-emerald-300 disabled:opacity-40 font-bold"
            title="Read the show's episodes and Show Brief, then draft hero tagline, notable guests, guesting pitch, and brand color. Overwrites current fields."
          >
            {autoPopulating ? 'Drafting…' : '✨ Auto-populate from episodes'}
          </button>
          <button
            onClick={() => void togglePublish()}
            disabled={saving}
            className={`text-[10px] uppercase tracking-wider font-bold border rounded-full px-3 py-1.5 disabled:opacity-40 ${
              fields.oneSheetPublished
                ? 'text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/10'
                : 'text-muted border-line hover:bg-ink/40'
            }`}
          >
            {fields.oneSheetPublished ? '✓ Published' : 'Publish one-sheet'}
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-urgent">{error}</p>}

      {fields.oneSheetPublished && url && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-emerald-300 font-bold">Live at</span>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-emerald-100 underline break-all flex-1 min-w-0"
          >
            {url}
          </a>
          <button
            onClick={() => { void navigator.clipboard.writeText(url) }}
            className="text-[10px] uppercase tracking-wider text-emerald-200 border border-emerald-500/40 rounded-full px-2.5 py-1 hover:bg-emerald-500/10 font-bold"
          >
            Copy
          </button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] uppercase tracking-wider text-emerald-200 border border-emerald-500/40 rounded-full px-2.5 py-1 hover:bg-emerald-500/10 font-bold"
          >
            Preview ↗
          </a>
        </div>
      )}

      {!fields.oneSheetPublished && url && (
        <div className="text-[11px] text-muted italic">
          Would publish at <code className="font-mono text-text/80">{url}</code>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block col-span-full">
          <span className="text-[10px] uppercase tracking-wider text-muted font-bold">
            Hero tagline (one line under the show name)
          </span>
          <input
            value={fields.heroTagline}
            onChange={(e) => setFields((f) => ({ ...f, heroTagline: e.target.value }))}
            onBlur={() => void saveField('heroTagline', fields.heroTagline)}
            placeholder="e.g. A podcast on the neuroscience of decision-making."
            className="mt-1 w-full bg-ink/40 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-stage-mastering"
          />
        </label>
        <label className="block col-span-full">
          <span className="text-[10px] uppercase tracking-wider text-muted font-bold">
            Notable past guests (comma or newline separated — Claude also uses these for outreach)
          </span>
          <textarea
            value={fields.notableGuests}
            onChange={(e) => setFields((f) => ({ ...f, notableGuests: e.target.value }))}
            onBlur={() => void saveField('notableGuests', fields.notableGuests)}
            rows={3}
            placeholder="e.g. Alexis Texas, Ron Jeremy, Sasha Grey"
            className="mt-1 w-full bg-ink/40 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-stage-mastering"
          />
        </label>
        <label className="block col-span-full">
          <span className="text-[10px] uppercase tracking-wider text-muted font-bold">
            Guesting pitch — what recording is like ("recorded in-studio in Miami", "remote on Riverside", etc.)
          </span>
          <textarea
            value={fields.guestPitch}
            onChange={(e) => setFields((f) => ({ ...f, guestPitch: e.target.value }))}
            onBlur={() => void saveField('guestPitch', fields.guestPitch)}
            rows={3}
            placeholder="e.g. Recorded in-studio at our Miami space. About 45 minutes. Guests get the audio + clip package."
            className="mt-1 w-full bg-ink/40 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-stage-mastering"
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-muted font-bold">Contact (for the CTA)</span>
          <input
            type="email"
            value={fields.contactEmail}
            onChange={(e) => setFields((f) => ({ ...f, contactEmail: e.target.value }))}
            onBlur={() => void saveField('contactEmail', fields.contactEmail)}
            className="mt-1 w-full bg-ink/40 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-stage-mastering"
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-muted font-bold">Brand accent color (hex)</span>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="color"
              value={fields.brandHex || '#f59e0b'}
              onChange={(e) => setFields((f) => ({ ...f, brandHex: e.target.value }))}
              onBlur={() => void saveField('brandHex', fields.brandHex)}
              className="w-10 h-10 bg-transparent border border-line rounded-lg cursor-pointer"
            />
            <input
              value={fields.brandHex}
              onChange={(e) => setFields((f) => ({ ...f, brandHex: e.target.value }))}
              onBlur={() => void saveField('brandHex', fields.brandHex)}
              placeholder="#f59e0b"
              className="flex-1 bg-ink/40 border border-line rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-stage-mastering"
            />
          </div>
        </label>
      </div>

      {savedAt && (
        <p className="text-[10px] text-muted">Saved {new Date(savedAt).toLocaleTimeString()}</p>
      )}
    </section>
  )
}

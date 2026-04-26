import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'

const TIMEZONES = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Toronto',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Australia/Sydney',
  'UTC',
]

export default function Profile() {
  const { user, refresh } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [timezone, setTimezone] = useState('America/Los_Angeles')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!user) return
    setName(user.name || '')
    setDisplayName(user.display_name || user.name || '')
    setTimezone(user.timezone || 'America/Los_Angeles')
  }, [user])

  if (!user) return null

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await api.updateMe({ name: name.trim(), displayName: displayName.trim(), timezone })
      await refresh()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <button
          onClick={() => navigate(-1)}
          className="text-[11px] uppercase tracking-[0.2em] text-muted hover:text-text font-bold"
        >
          ← Back
        </button>
        <h1 className="font-display text-5xl text-rainbow mt-3">Profile</h1>
        <p className="text-muted text-sm mt-1">How you appear in Slate.</p>
      </div>

      <form onSubmit={save} className="space-y-5 rounded-2xl border border-line bg-panel/60 p-6">
        <Field label="Email" hint="Read-only — this is your sign-in.">
          <input
            type="email"
            value={user.email}
            readOnly
            className="w-full rounded-xl bg-ink/40 border border-line text-muted px-3 py-2.5 outline-none cursor-not-allowed"
          />
        </Field>

        <Field label="Full name" hint="Used in your profile.">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Maggie Glass"
            className="w-full rounded-xl bg-ink/40 border border-line text-text px-3 py-2.5 outline-none focus:border-stage-mastering"
          />
        </Field>

        <Field label="Display name" hint="What @mentions show. Keep it short.">
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="maggie"
            className="w-full rounded-xl bg-ink/40 border border-line text-text px-3 py-2.5 outline-none focus:border-stage-mastering"
          />
        </Field>

        <Field label="Timezone" hint="Used for due-date times and reminders.">
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full rounded-xl bg-ink/40 border border-line text-text px-3 py-2.5 outline-none focus:border-stage-mastering"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </Field>

        {error && <p className="text-urgent text-sm">{error}</p>}
        {saved && <p className="text-stage-done text-sm">Saved ✓</p>}

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-xl bg-gradient-to-r from-stage-producing to-stage-mastering text-white font-bold uppercase tracking-wider text-sm px-4 py-3 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </form>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-[0.2em] text-muted font-bold mb-1.5">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted/70 mt-1">{hint}</p>}
    </div>
  )
}

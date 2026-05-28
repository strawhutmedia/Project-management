// Project-level config for the AI social plan generator. Admin-only.
// Sets the per-show brand voice, example posts (informs the AI's tone),
// and the default assignee per social-content kind so every newly-
// generated plan auto-assigns photos → Ana, reels → editor, etc.
import { useState } from 'react'
import { api, type ApiMember, type ApiProject } from '../api'

const KIND_OPTIONS: Array<{ key: 'text_post' | 'story_text' | 'reel_concept' | 'photo_concept'; label: string }> = [
  { key: 'text_post',    label: '📝 Text posts'     },
  { key: 'story_text',   label: '💬 Stories'        },
  { key: 'reel_concept', label: '🎬 Reel concepts'  },
  { key: 'photo_concept', label: '📷 Photo concepts' },
]

export default function PodcastSocialsConfig({
  project,
  members,
  onSaved,
}: {
  project: ApiProject
  members: ApiMember[]
  onSaved: () => void | Promise<void>
}) {
  const [brandVoice, setBrandVoice] = useState(project.socialsBrandVoice ?? '')
  const [examples, setExamples] = useState<string[]>(project.socialsExamplePosts ?? [])
  const [assignees, setAssignees] = useState<Partial<Record<typeof KIND_OPTIONS[number]['key'], string>>>(
    project.socialsDefaultAssignees ?? {},
  )
  const [busy, setBusy] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true); setError(null)
    try {
      await api.updateProject(project.id, {
        socialsBrandVoice: brandVoice.trim() || null,
        socialsExamplePosts: examples.map((e) => e.trim()).filter((e) => e.length > 0),
        socialsDefaultAssignees: assignees,
      })
      setSavedAt(new Date())
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-6 space-y-4">
      <div>
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">📱 Social Plan Settings</h2>
        <p className="text-[11px] text-muted/80 mt-1">
          Configures how Claude writes the daily social plan for this show. Defaults below auto-assign
          new plan items so the right person picks them up.
        </p>
      </div>

      <div>
        <label className="block">
          <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold mb-1">Brand voice</div>
          <textarea
            value={brandVoice}
            onChange={(e) => setBrandVoice(e.target.value)}
            rows={3}
            placeholder="e.g. Brandi is irreverent, gossipy, drops names. Short sentences. Self-deprecating humor. Never uses hashtags."
            className="w-full bg-ink/40 border border-line text-text rounded-lg px-3 py-2 text-sm outline-none focus:border-stage-mastering resize-y"
          />
        </label>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold mb-1">Example posts</div>
        <p className="text-[11px] text-muted/70 mb-2">
          Paste 2–5 real published posts. Claude copies tone, vocabulary, sentence length, and formatting from these.
        </p>
        <div className="space-y-2">
          {examples.map((ex, i) => (
            <div key={i} className="flex gap-2">
              <textarea
                value={ex}
                onChange={(e) => {
                  const next = [...examples]
                  next[i] = e.target.value
                  setExamples(next)
                }}
                rows={2}
                placeholder="Paste an example post"
                className="flex-1 bg-ink/40 border border-line text-text rounded-lg px-3 py-2 text-sm outline-none focus:border-stage-mastering resize-y"
              />
              <button
                onClick={() => setExamples(examples.filter((_, j) => j !== i))}
                className="text-muted hover:text-urgent text-sm px-2 shrink-0"
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            onClick={() => setExamples([...examples, ''])}
            className="text-[11px] uppercase tracking-wider text-stage-mastering border border-stage-mastering/40 rounded-full px-2.5 py-1 hover:bg-stage-mastering/10"
          >
            + Add example
          </button>
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold mb-2">Default assignees</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {KIND_OPTIONS.map(({ key, label }) => (
            <label key={key} className="block">
              <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold mb-1">{label}</div>
              <select
                value={assignees[key] ?? ''}
                onChange={(e) => setAssignees({ ...assignees, [key]: e.target.value || undefined })}
                className="w-full bg-ink/40 border border-line text-text rounded-lg px-3 py-2 text-sm outline-none focus:border-stage-mastering"
              >
                <option value="">— Unassigned —</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.display_name || m.name}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-line">
        {error && <span className="text-urgent text-xs">{error}</span>}
        {savedAt && !error && <span className="text-[11px] text-muted">Saved {savedAt.toLocaleTimeString()}</span>}
        <button
          onClick={() => void save()}
          disabled={busy}
          className="rounded-xl bg-gradient-to-r from-stage-mastering to-stage-tracking text-white font-bold uppercase tracking-wider text-xs px-3 py-2 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </section>
  )
}

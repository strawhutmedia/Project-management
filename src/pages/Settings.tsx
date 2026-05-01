import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  api,
  type ApiAdminProject,
  type ApiAdminUser,
  type ApiDropboxStatus,
} from '../api'
import { useAuth } from '../auth'

export default function Settings() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [status, setStatus] = useState<ApiDropboxStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const justConnected = params.get('dropbox') === 'connected'

  async function load() {
    setLoading(true)
    try {
      setStatus(await api.dropboxStatus())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    if (justConnected) {
      const t = setTimeout(() => setParams({}, { replace: true }), 5000)
      return () => clearTimeout(t)
    }
  }, [justConnected, setParams])

  if (!user) return null
  const isAdmin = user.role === 'admin'

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="font-display text-5xl text-rainbow">Settings</h1>
        <p className="text-muted text-sm mt-1">Workspace integrations and admin controls.</p>
      </div>

      {/* Dropbox */}
      <section className="rounded-2xl border border-line bg-panel/60 p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="font-display text-2xl">📦 Dropbox</h2>
            <p className="text-sm text-muted mt-1">
              Connect Straw Hut's Dropbox so file lists and uploads sync per-song.
            </p>
          </div>
          {status?.connected && (
            <span className="text-[11px] uppercase tracking-wider text-stage-done bg-stage-done/10 border border-stage-done/40 rounded-full px-2.5 py-1 font-bold whitespace-nowrap">
              ✓ Connected
            </span>
          )}
        </div>
        {justConnected && (
          <div className="mb-4 rounded-xl border border-stage-done/40 bg-stage-done/10 text-stage-done p-3 text-sm">
            🎉 Dropbox connected!
          </div>
        )}
        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : !status?.configured ? (
          <p className="text-sm text-urgent">
            Dropbox not configured. <code>DROPBOX_APP_KEY</code> and{' '}
            <code>DROPBOX_APP_SECRET</code> need to be set on the Railway service.
          </p>
        ) : status.connected ? (
          <div className="space-y-3">
            <p className="text-sm">
              Connected as{' '}
              <span className="text-text font-semibold">
                {status.accountName ?? 'Dropbox account'}
              </span>
              .
            </p>
            {isAdmin && (
              <PickerStartPathControl
                current={status.pickerStartPath ?? ''}
                onSaved={load}
              />
            )}
            {isAdmin && (
              <button
                onClick={async () => {
                  if (!confirm('Disconnect Dropbox? File lists will stop loading until reconnected.')) return
                  await api.dropboxDisconnect()
                  await load()
                }}
                className="text-sm text-urgent border border-urgent/40 rounded-full px-3 py-1.5"
              >
                Disconnect
              </button>
            )}
          </div>
        ) : isAdmin ? (
          <a
            href="/api/integrations/dropbox/connect"
            className="inline-block rounded-xl bg-gradient-to-r from-stage-stems to-stage-mixing text-white font-bold uppercase tracking-wider text-sm px-4 py-2.5 hover:opacity-90"
          >
            Connect Dropbox
          </a>
        ) : (
          <p className="text-sm text-muted">Only admins can connect Dropbox.</p>
        )}
      </section>

      {/* Admin: Users */}
      {isAdmin && <UsersSection currentUserId={user.id} />}


      {!isAdmin && (
        <p className="text-[11px] text-muted">
          Some settings are admin-only. Ask Ryan if you need access to something here.
        </p>
      )}
    </div>
  )
}

function UsersSection({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<ApiAdminUser[] | null>(null)
  const [projects, setProjects] = useState<ApiAdminProject[] | null>(null)
  const [showInvite, setShowInvite] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setError(null)
    try {
      const [{ users }, { projects }] = await Promise.all([api.adminUsers(), api.adminProjects()])
      setUsers(users)
      setProjects(projects)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function remove(u: ApiAdminUser) {
    if (u.id === currentUserId) return
    if (!confirm(`Remove ${u.email}? They'll lose access immediately.`)) return
    await api.adminDeleteUser(u.id)
    await load()
  }

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="font-display text-2xl">👥 Users</h2>
          <p className="text-sm text-muted mt-1">
            Invite people to Slate. You can grant access to a whole project or just specific songs.
          </p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="rounded-xl bg-gradient-to-r from-stage-producing to-stage-mastering text-white font-bold uppercase tracking-wider text-xs px-3 py-2 whitespace-nowrap"
        >
          + Invite user
        </button>
      </div>

      {error && <p className="text-urgent text-sm mb-3">{error}</p>}

      {!users ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : users.length === 0 ? (
        <p className="text-sm text-muted">No users yet.</p>
      ) : (
        <ul className="space-y-2">
          {users.map((u) => (
            <li key={u.id} className="rounded-xl border border-line bg-ink/30 p-4 group">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-bold">{u.display_name || u.name}</span>
                    {u.id === currentUserId ? (
                      <>
                        {u.role === 'admin' && (
                          <span className="text-[10px] uppercase tracking-wider text-stage-mastering bg-stage-mastering/10 border border-stage-mastering/40 rounded-full px-2 py-0.5 font-bold">
                            Admin
                          </span>
                        )}
                        <span className="text-[10px] uppercase tracking-wider text-muted">(you)</span>
                      </>
                    ) : (
                      <RoleSelect user={u} onSaved={load} />
                    )}
                  </div>
                  <div className="text-[11px] text-muted flex items-center gap-2 flex-wrap">
                    {u.email ? (
                      <span>{u.email}</span>
                    ) : (
                      <>
                        <span className="text-stage-tracking font-bold text-[10px] uppercase tracking-wider bg-stage-tracking/10 border border-stage-tracking/40 rounded px-1.5 py-0.5">
                          No email yet
                        </span>
                        <AddEmailButton userId={u.id} onSaved={load} />
                      </>
                    )}
                  </div>
                  <div className="text-[11px] mt-1.5">
                    {u.projects.length > 0 && (
                      <span>
                        <span className="text-muted">Projects: </span>
                        {u.projects.map((p) => p.name).join(', ')}
                      </span>
                    )}
                    {u.songs.length > 0 && (
                      <span className="ml-2">
                        <span className="text-muted">Channels:</span>
                        {u.songs.map((s) => `${s.title}${s.subtitle ? ` (${s.subtitle})` : ''}`).join(', ')}
                      </span>
                    )}
                    {u.projects.length === 0 && u.songs.length === 0 && u.role !== 'admin' && (
                      <span className="text-muted italic">No project access</span>
                    )}
                    {u.role === 'admin' && u.projects.length === 0 && u.songs.length === 0 && (
                      <span className="text-muted italic">Auto-access to all projects</span>
                    )}
                  </div>
                </div>
                {u.id !== currentUserId && (
                  <button
                    onClick={() => void remove(u)}
                    className="opacity-0 group-hover:opacity-100 text-xs text-muted hover:text-urgent transition shrink-0"
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {showInvite && projects && (
        <InviteModal
          projects={projects}
          onClose={() => setShowInvite(false)}
          onAdded={() => {
            setShowInvite(false)
            void load()
          }}
        />
      )}
    </section>
  )
}

function RoleSelect({ user, onSaved }: { user: ApiAdminUser; onSaved: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false)
  async function change(next: 'admin' | 'user') {
    if (next === user.role) return
    if (next === 'admin' && !confirm(`Make ${user.display_name || user.name} a Super Admin? They'll get auto-access to every project.`)) return
    setBusy(true)
    try {
      await api.adminUpdateUser(user.id, { role: next })
      await onSaved()
    } finally {
      setBusy(false)
    }
  }
  const styleByRole: Record<string, string> = {
    admin: 'text-stage-mastering bg-stage-mastering/10 border-stage-mastering/40',
    user: 'text-text bg-ink/30 border-line',
    viewer: 'text-stage-stems bg-stage-stems/10 border-stage-stems/40',
  }
  return (
    <select
      value={user.role}
      disabled={busy || user.role === 'viewer'}
      onChange={(e) => void change(e.target.value as 'admin' | 'user')}
      title={user.role === 'viewer' ? 'Viewer is a per-project role; manage from the project page.' : 'Workspace role'}
      className={`text-[10px] uppercase tracking-wider font-bold rounded-full px-2 py-0.5 border outline-none ${styleByRole[user.role]}`}
    >
      <option value="admin">Super Admin</option>
      <option value="user">User</option>
    </select>
  )
}

function AddEmailButton({ userId, onSaved }: { userId: string; onSaved: () => void | Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    if (!email.trim()) return
    setSaving(true)
    setErr(null)
    try {
      await api.adminUpdateUser(userId, { email: email.trim() })
      setEditing(false)
      setEmail('')
      await onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed')
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-[10px] uppercase tracking-wider font-bold text-stage-stems border border-stage-stems/40 rounded px-1.5 py-0.5 hover:bg-stage-stems/10"
      >
        + Add email + invite
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save()
          if (e.key === 'Escape') {
            setEditing(false)
            setEmail('')
            setErr(null)
          }
        }}
        placeholder="dillon@example.com"
        autoFocus
        className="bg-ink/40 border border-line text-text rounded px-1.5 py-0.5 text-[11px] outline-none focus:border-stage-mastering"
      />
      <button
        onClick={() => void save()}
        disabled={saving || !email.trim()}
        className="text-[10px] uppercase font-bold text-stage-stems disabled:opacity-50"
      >
        {saving ? '…' : 'Send invite'}
      </button>
      {err && <span className="text-urgent text-[10px]">{err}</span>}
    </span>
  )
}

function InviteModal({
  projects,
  onClose,
  onAdded,
}: {
  projects: ApiAdminProject[]
  onClose: () => void
  onAdded: () => void
}) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<'admin' | 'user' | 'viewer'>('user')
  const [timezone, setTimezone] = useState('America/Los_Angeles')
  const [accessByProject, setAccessByProject] = useState<Record<string, { mode: 'none' | 'full' | 'songs'; songIds: Set<string> }>>(
    () => {
      const init: Record<string, { mode: 'none' | 'full' | 'songs'; songIds: Set<string> }> = {}
      for (const p of projects) {
        init[p.id] = { mode: 'none', songIds: new Set() }
      }
      return init
    },
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setMode(projectId: string, mode: 'none' | 'full' | 'songs') {
    setAccessByProject((prev) => ({ ...prev, [projectId]: { ...prev[projectId], mode } }))
  }

  function toggleSong(projectId: string, songId: string) {
    setAccessByProject((prev) => {
      const songIds = new Set(prev[projectId].songIds)
      if (songIds.has(songId)) songIds.delete(songId)
      else songIds.add(songId)
      return { ...prev, [projectId]: { ...prev[projectId], songIds } }
    })
  }

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      const projectIds: string[] = []
      const songIds: string[] = []
      for (const [pid, access] of Object.entries(accessByProject)) {
        if (access.mode === 'full') projectIds.push(pid)
        else if (access.mode === 'songs') songIds.push(...Array.from(access.songIds))
      }
      await api.adminInviteUser({
        email: email.trim(),
        name: name.trim(),
        displayName: displayName.trim() || undefined,
        role,
        timezone,
        projectIds,
        songIds,
      })
      onAdded()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/80 backdrop-blur-sm p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-panel/95 backdrop-blur-md shadow-2xl max-h-[88dvh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-line">
          <h2 className="font-display text-2xl">Invite user</h2>
          <button onClick={onClose} className="text-muted hover:text-text text-xl leading-none">
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <Field
            label="Email (optional)"
            hint="Leave blank to add them as a placeholder now and email later. With an email, they get an invite right away."
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="dillon@example.com (or leave blank)"
              className="w-full rounded-xl bg-ink/40 border border-line text-text px-3 py-2.5 outline-none focus:border-stage-mastering text-sm"
            />
          </Field>
          <Field label="Full name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Michael Amico"
              className="w-full rounded-xl bg-ink/40 border border-line text-text px-3 py-2.5 outline-none focus:border-stage-mastering text-sm"
            />
          </Field>
          <Field label="Display name (for @mentions)" hint="Defaults to first name if blank.">
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="michael"
              className="w-full rounded-xl bg-ink/40 border border-line text-text px-3 py-2.5 outline-none focus:border-stage-mastering text-sm"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Role">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'admin' | 'user' | 'viewer')}
                className="w-full rounded-xl bg-ink/40 border border-line text-text px-3 py-2.5 outline-none focus:border-stage-mastering text-sm"
              >
                <option value="user">User — default</option>
                <option value="admin">Super Admin — auto-access to every project</option>
              </select>
            </Field>
            <Field label="Timezone">
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full rounded-xl bg-ink/40 border border-line text-text px-3 py-2.5 outline-none focus:border-stage-mastering text-sm"
              >
                {[
                  'America/Los_Angeles',
                  'America/Denver',
                  'America/Chicago',
                  'America/New_York',
                  'Europe/London',
                  'UTC',
                ].map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {role === 'user' && (
            <div>
              <label className="block text-[11px] uppercase tracking-[0.2em] text-muted font-bold mb-2">
                Project access
              </label>
              <p className="text-[11px] text-muted mb-3">
                Admins automatically see everything. For users, pick which projects (or specific channels — songs for albums, episodes for podcasts) they can see.
              </p>
              <div className="space-y-3">
                {projects.map((p) => {
                  const acc = accessByProject[p.id]
                  return (
                    <div key={p.id} className="rounded-xl border border-line bg-ink/30 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-bold">{p.name}</span>
                        <select
                          value={acc.mode}
                          onChange={(e) => setMode(p.id, e.target.value as 'none' | 'full' | 'songs')}
                          className="rounded-lg bg-ink/40 border border-line text-text px-2 py-1 text-xs outline-none"
                        >
                          <option value="none">No access</option>
                          <option value="full">Whole project</option>
                          <option value="songs">Specific channels</option>
                        </select>
                      </div>
                      {acc.mode === 'songs' && (
                        <div className="grid grid-cols-1 gap-1 max-h-40 overflow-y-auto pl-2 border-l border-line">
                          {p.songs.length === 0 ? (
                            <p className="text-xs text-muted">No channels in this project.</p>
                          ) : (
                            p.songs.map((s) => (
                              <label
                                key={s.id}
                                className="flex items-center gap-2 text-xs cursor-pointer py-0.5"
                              >
                                <input
                                  type="checkbox"
                                  checked={acc.songIds.has(s.id)}
                                  onChange={() => toggleSong(p.id, s.id)}
                                  className="accent-stage-mastering"
                                />
                                <span>
                                  {s.title}
                                  {s.subtitle && (
                                    <span className="text-muted ml-1">({s.subtitle})</span>
                                  )}
                                </span>
                              </label>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {error && <p className="text-urgent text-sm">{error}</p>}
        </div>

        <div className="flex gap-2 p-5 border-t border-line">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-line text-muted hover:text-text font-bold uppercase tracking-wider text-xs px-4 py-2.5"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || !name.trim()}
            className="flex-1 rounded-xl bg-gradient-to-r from-stage-producing to-stage-mastering text-white font-bold uppercase tracking-wider text-xs px-4 py-2.5 disabled:opacity-50"
          >
            {submitting ? 'Adding…' : email.trim() ? 'Send invite' : 'Add as placeholder'}
          </button>
        </div>
      </div>
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

function PickerStartPathControl({ current, onSaved }: { current: string; onSaved: () => void | Promise<void> }) {
  const [value, setValue] = useState(current)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const dirty = value !== current

  async function save() {
    setBusy(true); setErr(null)
    try {
      await api.setDropboxPickerStart(value.trim())
      await onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-line bg-ink/30 p-3 space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold">
        Default folder for file pickers
      </div>
      <p className="text-[11px] text-muted/80">
        Where Slate's "Pick a folder/file" dialogs land first. Set this to your team folder
        so users never see anyone's personal Dropbox tree. Leave blank for Dropbox root.
      </p>
      <div className="flex gap-2 items-center flex-wrap">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="/Straw Hut Team Folder"
          className="flex-1 min-w-[200px] rounded-lg bg-ink/40 border border-line text-text px-3 py-1.5 text-sm font-mono outline-none focus:border-stage-mastering"
        />
        <button
          onClick={() => void save()}
          disabled={!dirty || busy}
          className="rounded-lg bg-stage-mastering/20 border border-stage-mastering/40 text-stage-mastering font-bold uppercase tracking-wider text-[10px] px-3 py-1.5 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {err && <p className="text-urgent text-xs">{err}</p>}
    </div>
  )
}

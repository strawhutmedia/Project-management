// Per-project member management. Visible to project admins (and super
// admins via project_role === 'admin'). Each member row has a role
// dropdown (admin / user / viewer) and a remove button. The current user
// is shown read-only so they can't lock themselves out.
import { useEffect, useState } from 'react'
import { api, type ApiAdminUser, type ApiMember } from '../api'

type Role = 'admin' | 'user' | 'viewer'

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Project Admin',
  user: 'User',
  viewer: 'Viewer',
}

const ROLE_HINT: Record<Role, string> = {
  admin: 'Full control of this project',
  user: 'Can edit episodes, tasks, comments',
  viewer: 'Read-only on this project',
}

export default function ProjectMembersSection({
  projectId,
  members,
  currentUserId,
  onChanged,
}: {
  projectId: string
  members: ApiMember[]
  currentUserId: string
  onChanged: () => void | Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">
            👥 Project Members
          </h2>
          <p className="text-[11px] text-muted/80 mt-1">
            Project Admins can change anything · Users can edit · Viewers are read-only.
            Super Admins (workspace) auto-have admin on every project.
          </p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="rounded-xl bg-gradient-to-r from-stage-stems to-stage-mixing text-white font-bold uppercase tracking-wider text-xs px-3 py-2"
        >
          + Add member
        </button>
      </div>

      {error && <p className="text-urgent text-xs">{error}</p>}

      <div className="space-y-2">
        {members.map((m) => (
          <MemberRow
            key={m.id}
            projectId={projectId}
            member={m}
            isCurrentUser={m.id === currentUserId}
            onChanged={onChanged}
            onError={setError}
          />
        ))}
      </div>

      {adding && (
        <AddMemberModal
          projectId={projectId}
          existingMemberIds={new Set(members.map((m) => m.id))}
          onClose={() => setAdding(false)}
          onAdded={async () => {
            setAdding(false)
            await onChanged()
          }}
        />
      )}
    </section>
  )
}

function MemberRow({
  projectId,
  member,
  isCurrentUser,
  onChanged,
  onError,
}: {
  projectId: string
  member: ApiMember
  isCurrentUser: boolean
  onChanged: () => void | Promise<void>
  onError: (msg: string) => void
}) {
  const isSuperAdmin = member.role === 'admin'
  const projectRole = (member.project_role || 'user') as Role
  const [busy, setBusy] = useState(false)

  async function changeRole(next: Role) {
    if (next === projectRole) return
    setBusy(true)
    try {
      await api.setProjectMemberRole(projectId, member.id, next)
      await onChanged()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm(`Remove ${member.display_name || member.name} from this project?`)) return
    setBusy(true)
    try {
      await api.removeProjectMember(projectId, member.id)
      await onChanged()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed'
      onError(msg === 'cannot_remove_last_admin'
        ? 'Cannot remove the last Project Admin. Promote someone else first.'
        : msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-line bg-ink/30 p-3 flex items-center gap-3 flex-wrap">
      <div className="flex-1 min-w-0">
        <div className="font-bold text-sm truncate">
          {member.display_name || member.name}
          {isSuperAdmin && (
            <span className="ml-2 text-[10px] uppercase tracking-wider text-stage-mastering">Super Admin</span>
          )}
          {isCurrentUser && (
            <span className="ml-2 text-[10px] uppercase tracking-wider text-muted">(you)</span>
          )}
        </div>
        <div className="text-[11px] text-muted truncate">{member.email}</div>
      </div>

      {isSuperAdmin ? (
        <span className="text-[11px] uppercase tracking-wider text-stage-mastering bg-stage-mastering/10 border border-stage-mastering/40 rounded-full px-2.5 py-1 font-bold">
          Project Admin (auto)
        </span>
      ) : (
        <>
          <select
            value={projectRole}
            disabled={busy || isCurrentUser}
            title={isCurrentUser ? "You can't change your own role" : ROLE_HINT[projectRole]}
            onChange={(e) => void changeRole(e.target.value as Role)}
            className="text-[11px] uppercase tracking-wider font-bold rounded-full px-2.5 py-1 border bg-ink/40 border-line outline-none"
          >
            <option value="admin">{ROLE_LABEL.admin}</option>
            <option value="user">{ROLE_LABEL.user}</option>
            <option value="viewer">{ROLE_LABEL.viewer}</option>
          </select>
          {!isCurrentUser && (
            <button
              onClick={() => void remove()}
              disabled={busy}
              className="text-[11px] text-muted hover:text-urgent"
            >
              ✕
            </button>
          )}
        </>
      )}
    </div>
  )
}

function AddMemberModal({
  projectId,
  existingMemberIds,
  onClose,
  onAdded,
}: {
  projectId: string
  existingMemberIds: Set<string>
  onClose: () => void
  onAdded: () => void | Promise<void>
}) {
  const [users, setUsers] = useState<ApiAdminUser[] | null>(null)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [role, setRole] = useState<Role>('user')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.adminUsers()
      .then(({ users }) => setUsers(users))
      .catch((err) => setError(err instanceof Error ? err.message : 'failed'))
  }, [])

  async function add() {
    if (!selectedUserId) return
    setBusy(true)
    setError(null)
    try {
      await api.addProjectMember(projectId, { userId: selectedUserId, role })
      await onAdded()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  const candidates = (users ?? []).filter((u) => !existingMemberIds.has(u.id) && u.role !== 'admin')

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-panel/95 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-line">
          <h2 className="font-display text-2xl">Add to project</h2>
          <button onClick={onClose} className="text-muted hover:text-text text-xl leading-none">✕</button>
        </div>
        <div className="p-5 space-y-3">
          {error && <p className="text-urgent text-xs">{error}</p>}
          {users === null ? (
            <p className="text-muted text-sm">Loading users…</p>
          ) : candidates.length === 0 ? (
            <p className="text-muted text-sm">
              No more users to add. Invite someone new from the Settings page first.
            </p>
          ) : (
            <>
              <label className="block">
                <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold mb-1">User</div>
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="w-full bg-ink/40 border border-line text-text text-sm rounded-lg px-3 py-2 outline-none focus:border-stage-mastering"
                >
                  <option value="">— Pick a user —</option>
                  {candidates.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.display_name || u.name} {u.email ? `(${u.email})` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <div className="text-[10px] uppercase tracking-wider text-muted/70 font-bold mb-1">Role</div>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                  className="w-full bg-ink/40 border border-line text-text text-sm rounded-lg px-3 py-2 outline-none focus:border-stage-mastering"
                >
                  <option value="admin">{ROLE_LABEL.admin} — {ROLE_HINT.admin}</option>
                  <option value="user">{ROLE_LABEL.user} — {ROLE_HINT.user}</option>
                  <option value="viewer">{ROLE_LABEL.viewer} — {ROLE_HINT.viewer}</option>
                </select>
              </label>
            </>
          )}
        </div>
        <div className="flex gap-2 p-5 border-t border-line">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-line text-muted hover:text-text font-bold uppercase tracking-wider text-xs px-4 py-2.5"
          >
            Cancel
          </button>
          <button
            onClick={() => void add()}
            disabled={!selectedUserId || busy}
            className="flex-1 rounded-xl bg-gradient-to-r from-stage-stems to-stage-mixing text-white font-bold uppercase tracking-wider text-xs px-4 py-2.5 disabled:opacity-50"
          >
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}

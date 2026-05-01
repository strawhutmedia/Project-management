// Per-project permission helpers. Workspace admins ("Super Admin") get
// admin treatment on every project automatically; everyone else's role
// comes from project_members.role.
import type { Response } from 'express'
import { pool } from './db'
import type { SessionUser } from './auth'

export type ProjectRole = 'admin' | 'user' | 'viewer'

export async function getProjectRole(
  userId: string,
  systemRole: string,
  projectId: string,
): Promise<ProjectRole | null> {
  if (systemRole === 'admin') return 'admin'
  const { rows } = await pool.query<{ role: ProjectRole }>(
    `SELECT role FROM project_members
       WHERE project_id = $1 AND user_id = $2 LIMIT 1`,
    [projectId, userId],
  )
  if (rows.length === 0) {
    // Fall back to creator-of-project as a safety net for legacy rows
    // where project_members might not have been populated.
    const { rows: creator } = await pool.query(
      `SELECT 1 FROM projects WHERE id = $1 AND created_by = $2 LIMIT 1`,
      [projectId, userId],
    )
    return creator.length > 0 ? 'admin' : null
  }
  return rows[0].role
}

export async function getSongRole(
  userId: string,
  systemRole: string,
  songId: string,
): Promise<ProjectRole | null> {
  if (systemRole === 'admin') return 'admin'
  const { rows } = await pool.query<{ role: ProjectRole; project_id: string; created_by: string }>(
    `SELECT pm.role, s.project_id, p.created_by
       FROM songs s
       JOIN projects p ON p.id = s.project_id
       LEFT JOIN project_members pm ON pm.project_id = s.project_id AND pm.user_id = $2
      WHERE s.id = $1 LIMIT 1`,
    [songId, userId],
  )
  if (rows.length === 0) return null
  if (rows[0].role) return rows[0].role
  if (rows[0].created_by === userId) return 'admin'
  return null
}

export function canWrite(role: ProjectRole | null): boolean {
  return role === 'admin' || role === 'user'
}

export function isProjectAdmin(role: ProjectRole | null): boolean {
  return role === 'admin'
}

// Assert helpers: 403 the response if the user can't write, then return
// null so the caller can early-return. Otherwise return the role.
export async function assertWriter(
  user: SessionUser,
  projectId: string,
  res: Response,
): Promise<ProjectRole | null> {
  const role = await getProjectRole(user.id, user.role, projectId)
  if (!role) { res.status(403).json({ error: 'forbidden' }); return null }
  if (!canWrite(role)) { res.status(403).json({ error: 'read_only' }); return null }
  return role
}

export async function assertSongWriter(
  user: SessionUser,
  songId: string,
  res: Response,
): Promise<ProjectRole | null> {
  const role = await getSongRole(user.id, user.role, songId)
  if (!role) { res.status(403).json({ error: 'forbidden' }); return null }
  if (!canWrite(role)) { res.status(403).json({ error: 'read_only' }); return null }
  return role
}

export async function assertProjectAdmin(
  user: SessionUser,
  projectId: string,
  res: Response,
): Promise<ProjectRole | null> {
  const role = await getProjectRole(user.id, user.role, projectId)
  if (!role) { res.status(403).json({ error: 'forbidden' }); return null }
  if (role !== 'admin') { res.status(403).json({ error: 'project_admin_only' }); return null }
  return role
}

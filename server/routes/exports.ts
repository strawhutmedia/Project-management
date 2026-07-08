// PDF export endpoints. Each one streams a finished PDF as a file
// download. Permissions: project members + workspace admins only.
import { Router } from 'express'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'
import {
  budgetTopSheetPdf, budgetDetailedPdf,
  stripboardPdf, doodPdf, castListPdf,
} from '../pdf_exports'
import { logError } from '../diag'

export const exportsRouter = Router()
exportsRouter.use(requireUser)

async function userCanAccessProject(userId: string, role: string, projectId: string): Promise<boolean> {
  if (role === 'admin') return true
  // Grant access if the user is: creator, project_member, OR song_member
  // of any song in the project. Permissive by design — anyone on the
  // project in any capacity should be able to download the printable
  // production docs.
  const { rows } = await pool.query(
    `SELECT 1 FROM projects p
       LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
       LEFT JOIN songs s ON s.project_id = p.id
       LEFT JOIN song_members sm ON sm.song_id = s.id AND sm.user_id = $1
      WHERE p.id = $2
        AND (p.created_by = $1 OR m.user_id IS NOT NULL OR sm.user_id IS NOT NULL)
      LIMIT 1`,
    [userId, projectId],
  )
  return rows.length > 0
}

function wrap(handler: (projectId: string, res: import('express').Response) => Promise<void>) {
  return async (req: import('express').Request, res: import('express').Response) => {
    const user = (req as typeof req & { user: SessionUser }).user
    const projectId = String(req.params.projectId ?? '')
    if (!projectId || !(await userCanAccessProject(user.id, user.role, projectId))) {
      res.status(403).json({ error: 'forbidden' }); return
    }
    try {
      await handler(projectId, res)
    } catch (err) {
      logError('pdf export failed', {
        projectId, path: req.path, error: err instanceof Error ? err.message : String(err),
      })
      if (!res.headersSent) res.status(500).json({ error: err instanceof Error ? err.message : 'failed' })
    }
  }
}

exportsRouter.get('/projects/:projectId/budget-topsheet.pdf', wrap(budgetTopSheetPdf))
exportsRouter.get('/projects/:projectId/budget-detailed.pdf', wrap(budgetDetailedPdf))
exportsRouter.get('/projects/:projectId/stripboard.pdf', wrap(stripboardPdf))
exportsRouter.get('/projects/:projectId/dood.pdf', wrap(doodPdf))
exportsRouter.get('/projects/:projectId/cast-list.pdf', wrap(castListPdf))

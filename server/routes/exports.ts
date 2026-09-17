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

// Everyone signed in can see and work in every project (Ryan, 2026-09-17:
// "everyone can see everything") — only existence is checked now.
async function userCanAccessProject(_userId: string, _role: string, projectId: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT 1 FROM projects WHERE id = $1 LIMIT 1`, [projectId])
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

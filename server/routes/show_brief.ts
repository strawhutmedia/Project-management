// Per-show strategic brief.
//
//   GET /api/show-brief/projects/:projectId  → { brief: {...} | null }
//   PUT /api/show-brief/projects/:projectId  → upsert, body is the brief object
//
// Read by every social strategy tool (Full Strategy, Audience,
// Authority, Pillars, Calendar, Post, Monetization) so the strategist
// starts from the same facts every time. Fill it out once per show;
// re-edit anytime.

import { Router } from 'express'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'
import { assertWriter } from '../permissions'

export const showBriefRouter = Router()
showBriefRouter.use(requireUser)

const FIELDS = [
  'business_description', 'niche', 'target_audience', 'competitors',
  'growth_goals', 'current_metrics', 'monetization_current',
  'constraints', 'notes',
] as const

async function assertProjectAccess(userId: string, role: string, projectId: string): Promise<boolean> {
  if (role === 'admin') return true
  const { rows } = await pool.query(
    `SELECT 1 FROM projects p
       LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
      WHERE p.id = $2 AND (p.created_by = $1 OR m.user_id IS NOT NULL) LIMIT 1`,
    [userId, projectId],
  )
  return rows.length > 0
}

showBriefRouter.get('/projects/:projectId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!(await assertProjectAccess(user.id, user.role, projectId))) {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  const { rows } = await pool.query(
    `SELECT project_id, business_description, niche, target_audience,
            competitors, growth_goals, current_metrics,
            monetization_current, constraints, notes,
            updated_at, created_at
       FROM social_strategy_briefs WHERE project_id = $1`,
    [projectId],
  )
  res.json({ brief: rows[0] ?? null })
})

showBriefRouter.put('/projects/:projectId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  // Writer role required — viewers can READ the brief (via the GET
  // above's membership check) but can't overwrite it.
  if (!(await assertWriter(user, projectId, res))) return
  const body = (req.body ?? {}) as Record<string, unknown>
  const values: Array<string | null> = []
  for (const f of FIELDS) {
    const v = body[f]
    values.push(typeof v === 'string' && v.trim() ? v.trim() : null)
  }
  await pool.query(
    `INSERT INTO social_strategy_briefs
       (project_id, business_description, niche, target_audience,
        competitors, growth_goals, current_metrics,
        monetization_current, constraints, notes, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
     ON CONFLICT (project_id) DO UPDATE SET
       business_description = EXCLUDED.business_description,
       niche = EXCLUDED.niche,
       target_audience = EXCLUDED.target_audience,
       competitors = EXCLUDED.competitors,
       growth_goals = EXCLUDED.growth_goals,
       current_metrics = EXCLUDED.current_metrics,
       monetization_current = EXCLUDED.monetization_current,
       constraints = EXCLUDED.constraints,
       notes = EXCLUDED.notes,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [projectId, ...values, user.id],
  )
  res.json({ ok: true })
})

// Load the brief in the shape strategy generators want (a plain
// object with just the answered fields — undefined for anything the
// operator hasn't filled in).
export type ShowBrief = Partial<Record<typeof FIELDS[number], string>>

export async function loadShowBrief(projectId: string): Promise<ShowBrief | null> {
  const { rows } = await pool.query<Record<string, string | null>>(
    `SELECT ${FIELDS.join(', ')} FROM social_strategy_briefs WHERE project_id = $1`,
    [projectId],
  )
  if (rows.length === 0) return null
  const out: ShowBrief = {}
  for (const f of FIELDS) {
    const v = rows[0][f]
    if (typeof v === 'string' && v.trim()) out[f] = v
  }
  return Object.keys(out).length > 0 ? out : null
}

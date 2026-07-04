// Per-show social strategy documents (the 7 tools).
//
//   GET    /api/social-strategy/projects/:projectId              → list all 7 documents (some may be null)
//   POST   /api/social-strategy/projects/:projectId/:kind        → generate/regenerate a document
//     body: { inputContext?: string }
//   PATCH  /api/social-strategy/projects/:projectId/:kind        → hand-edit a document
//     body: { content: object }
//   DELETE /api/social-strategy/projects/:projectId/:kind        → drop a document (start over)
//
// Generation is synchronous — each doc is a single Claude call (<30s
// typical) and the UI is one operator's action, not a background job.
// If we ever run these in batches per show, move to fire-and-forget.

import { Router } from 'express'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'
import {
  hasAnthropicKey,
  generateSocialStrategyDocument,
  type StrategyKind,
  type StrategyProjectContext,
} from '../anthropic'
import { loadShowBrief } from './show_brief'
import { logError } from '../diag'

export const socialStrategyRouter = Router()
socialStrategyRouter.use(requireUser)

const KINDS: StrategyKind[] = [
  'strategy', 'audience', 'authority', 'pillars',
  'calendar', 'post', 'monetization',
]

function isKind(x: unknown): x is StrategyKind {
  return typeof x === 'string' && (KINDS as string[]).includes(x)
}

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

async function loadProjectContext(projectId: string): Promise<StrategyProjectContext | null> {
  const proj = await pool.query<{
    name: string; kind: string; subtitle: string | null;
    brand_voice: string | null; vocabulary: string | null;
  }>(
    `SELECT name, kind, subtitle,
            socials_brand_voice AS brand_voice,
            socials_vocabulary  AS vocabulary
       FROM projects WHERE id = $1`,
    [projectId],
  )
  if (proj.rows.length === 0) return null
  const p = proj.rows[0]
  // Recent episodes — at most 8 to keep the prompt tight.
  const eps = await pool.query<{ title: string; subtitle: string | null }>(
    `SELECT title, subtitle FROM songs
       WHERE project_id = $1
       ORDER BY position DESC NULLS LAST, created_at DESC
       LIMIT 8`,
    [projectId],
  )
  return {
    showName: p.name,
    showKind: p.kind as 'album' | 'podcast' | 'film',
    showSubtitle: p.subtitle,
    brandVoice: p.brand_voice,
    vocabulary: p.vocabulary,
    recentEpisodes: eps.rows.map((r) => ({ title: r.title, subtitle: r.subtitle })),
  }
}

// Load previously-generated sibling docs so a later doc can reference
// earlier ones (pillars references the master strategy; the calendar
// references pillars; etc.).
async function loadSiblingDocs(
  projectId: string, excludeKind: StrategyKind,
): Promise<Partial<Record<StrategyKind, unknown>>> {
  const { rows } = await pool.query<{ kind: StrategyKind; content: unknown }>(
    `SELECT kind, content FROM social_strategy_documents
       WHERE project_id = $1 AND status = 'generated' AND kind <> $2`,
    [projectId, excludeKind],
  )
  const out: Partial<Record<StrategyKind, unknown>> = {}
  for (const r of rows) out[r.kind] = r.content
  return out
}

// GET all 7 documents for a project.
socialStrategyRouter.get('/projects/:projectId', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  if (!(await assertProjectAccess(user.id, user.role, projectId))) {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  const { rows } = await pool.query(
    `SELECT id, kind, content, input_context, status, error,
            input_tokens, output_tokens, created_by, created_at, updated_at
       FROM social_strategy_documents
       WHERE project_id = $1`,
    [projectId],
  )
  const byKind: Record<string, unknown> = {}
  for (const r of rows) byKind[r.kind] = r
  res.json({ documents: byKind })
})

// POST — generate (or regenerate) one document.
socialStrategyRouter.post('/projects/:projectId/:kind', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  const kind = req.params.kind
  if (!isKind(kind)) { res.status(400).json({ error: 'invalid_kind' }); return }
  if (!(await assertProjectAccess(user.id, user.role, projectId))) {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  if (!hasAnthropicKey()) { res.status(503).json({ error: 'anthropic_key_missing' }); return }
  const inputContext = typeof req.body?.inputContext === 'string' ? req.body.inputContext : undefined
  const projectContext = await loadProjectContext(projectId)
  if (!projectContext) { res.status(404).json({ error: 'project_not_found' }); return }
  projectContext.siblingDocs = await loadSiblingDocs(projectId, kind)
  // Load the Show Brief so every strategy tool starts from the same
  // structured facts the operator filled in once.
  const brief = await loadShowBrief(projectId)
  if (brief) projectContext.brief = brief

  try {
    const result = await generateSocialStrategyDocument({ kind, projectContext, inputContext })
    // Archive the previous version if one exists, then upsert.
    const prev = await pool.query(
      `SELECT id, content, input_context FROM social_strategy_documents
        WHERE project_id = $1 AND kind = $2`,
      [projectId, kind],
    )
    if (prev.rows.length > 0) {
      await pool.query(
        `INSERT INTO social_strategy_versions (document_id, content, input_context, created_by)
         VALUES ($1, $2::jsonb, $3, $4)`,
        [prev.rows[0].id, JSON.stringify(prev.rows[0].content), prev.rows[0].input_context, user.id],
      )
      await pool.query(
        `UPDATE social_strategy_documents
            SET content = $2::jsonb, input_context = $3, status = 'generated',
                error = NULL, input_tokens = $4, output_tokens = $5,
                created_by = $6, updated_at = now()
          WHERE project_id = $1 AND kind = $7`,
        [projectId, JSON.stringify(result.content), inputContext ?? null,
         result.usage.inputTokens, result.usage.outputTokens, user.id, kind],
      )
    } else {
      await pool.query(
        `INSERT INTO social_strategy_documents
           (project_id, kind, content, input_context, status,
            input_tokens, output_tokens, created_by)
         VALUES ($1, $2, $3::jsonb, $4, 'generated', $5, $6, $7)`,
        [projectId, kind, JSON.stringify(result.content), inputContext ?? null,
         result.usage.inputTokens, result.usage.outputTokens, user.id],
      )
    }
    const doc = await pool.query(
      `SELECT id, kind, content, input_context, status, error,
              input_tokens, output_tokens, created_by, created_at, updated_at
         FROM social_strategy_documents WHERE project_id = $1 AND kind = $2`,
      [projectId, kind],
    )
    res.json({ document: doc.rows[0] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logError('social-strategy: generation failed', { projectId, kind, error: msg })
    res.status(500).json({ error: 'generation_failed', detail: msg.slice(0, 600) })
  }
})

// PATCH — hand-edit a document.
socialStrategyRouter.patch('/projects/:projectId/:kind', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  const kind = req.params.kind
  if (!isKind(kind)) { res.status(400).json({ error: 'invalid_kind' }); return }
  if (!(await assertProjectAccess(user.id, user.role, projectId))) {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  const content = req.body?.content
  if (typeof content !== 'object' || content === null) {
    res.status(400).json({ error: 'content_required' })
    return
  }
  // Archive the prior version and update.
  const prev = await pool.query(
    `SELECT id, content, input_context FROM social_strategy_documents
      WHERE project_id = $1 AND kind = $2`,
    [projectId, kind],
  )
  if (prev.rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  await pool.query(
    `INSERT INTO social_strategy_versions (document_id, content, input_context, created_by)
     VALUES ($1, $2::jsonb, $3, $4)`,
    [prev.rows[0].id, JSON.stringify(prev.rows[0].content), prev.rows[0].input_context, user.id],
  )
  await pool.query(
    `UPDATE social_strategy_documents
       SET content = $2::jsonb, updated_at = now()
     WHERE project_id = $1 AND kind = $3`,
    [projectId, JSON.stringify(content), kind],
  )
  res.json({ ok: true })
})

socialStrategyRouter.delete('/projects/:projectId/:kind', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const projectId = req.params.projectId
  const kind = req.params.kind
  if (!isKind(kind)) { res.status(400).json({ error: 'invalid_kind' }); return }
  if (!(await assertProjectAccess(user.id, user.role, projectId))) {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  await pool.query(
    `DELETE FROM social_strategy_documents WHERE project_id = $1 AND kind = $2`,
    [projectId, kind],
  )
  res.json({ ok: true })
})

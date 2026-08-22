// Workspace-wide social content scheduler.
//
//   GET   /api/scheduler?from=YYYY-MM-DD&to=YYYY-MM-DD
//     → lazy-seeds slots for any missing day in the range, then returns
//       { days, backlog }
//   PATCH /api/scheduler/slots/:id
//     → assign/clear item, change time, change platforms
//       body: { planId?: string|null, itemId?: string|null,
//               scheduledTime?: "HH:MM", platforms?: string[] }
//   POST  /api/scheduler/push     body: { planId, itemId }
//     → marks an item as "queued for scheduling"; appears in backlog
//   POST  /api/scheduler/unpush   body: { planId, itemId }
//     → removes from backlog and any slot it occupies
//
// Permission model:
//   - Read: any logged-in user (this is a workspace surface)
//   - Push / unpush: writer on the item's project (matches who can edit
//     the social plan it came from)
//   - PATCH slots (drag/drop, time changes): workspace admin only — this
//     is the single canonical posting calendar.
import { Router } from 'express'
import crypto from 'crypto'
import { pool } from '../db'
import { requireUser, type SessionUser } from '../auth'
import { assertWriter } from '../permissions'
import { logError } from '../diag'
import type { SocialItem } from './socials'

export const schedulerRouter = Router()
schedulerRouter.use(requireUser)

type SlotKind = 'text_post' | 'photo_concept' | 'reel_concept' | 'story_concept'

// Default Pacific-time grid. Sized per spec: 5 text, 3 photo, 3 reel,
// 4 stories spread 8a–9p. Time strings are 24h "HH:MM:SS" so they
// round-trip cleanly with Postgres `time` columns.
const DEFAULT_GRID: Record<SlotKind, string[]> = {
  text_post: ['08:00:00', '11:00:00', '14:00:00', '17:00:00', '20:00:00'],
  photo_concept: ['09:00:00', '13:00:00', '18:00:00'],
  reel_concept: ['10:00:00', '15:00:00', '19:00:00'],
  story_concept: ['09:00:00', '12:00:00', '16:00:00', '20:00:00'],
}

const SLOT_KINDS: SlotKind[] = ['text_post', 'photo_concept', 'reel_concept', 'story_concept']

type SlotRow = {
  id: string
  day_date: string
  kind: SlotKind
  slot_index: number
  scheduled_time: string
  plan_id: string | null
  item_id: string | null
  status: 'planned' | 'posted' | 'skipped'
  platforms: string[]
}

type PlanRow = {
  id: string
  project_id: string
  project_name: string
  song_id: string | null
  song_title: string | null
  project_cover_art_url: string | null
  items: SocialItem[]
}

// Iterate every YYYY-MM-DD between `from` and `to` inclusive.
function eachDate(from: string, to: string): string[] {
  const out: string[] = []
  const a = new Date(`${from}T00:00:00Z`)
  const b = new Date(`${to}T00:00:00Z`)
  for (let d = new Date(a); d <= b; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

// Seed missing day rows in one bulk insert. ON CONFLICT skip lets us
// safely call this on partially-seeded ranges. Exported for the socials
// autopilot, which seeds today's grid before assigning its drafts.
export async function seedDays(dates: string[]): Promise<void> {
  if (dates.length === 0) return
  const values: string[] = []
  const params: unknown[] = []
  let p = 1
  for (const date of dates) {
    for (const kind of SLOT_KINDS) {
      const grid = DEFAULT_GRID[kind]
      for (let i = 0; i < grid.length; i++) {
        values.push(`($${p++}, $${p++}, $${p++}, $${p++})`)
        params.push(date, kind, i, grid[i])
      }
    }
  }
  await pool.query(
    `INSERT INTO scheduler_slots (day_date, kind, slot_index, scheduled_time)
     VALUES ${values.join(', ')}
     ON CONFLICT (day_date, kind, slot_index) DO NOTHING`,
    params,
  )
}

// Find items inside a plan's JSONB items array by id. Returns the item
// + its index, or null if not found.
function findItem(items: SocialItem[], itemId: string): { item: SocialItem; index: number } | null {
  const index = items.findIndex((i) => i.id === itemId)
  if (index < 0) return null
  return { item: items[index], index }
}

// Pull every plan that has at least one slot reference OR at least one
// pushed item. We fetch this once and use it to denormalize both the
// slots' embedded items and the backlog.
async function loadRelevantPlans(slots: SlotRow[]): Promise<Map<string, PlanRow>> {
  const slotPlanIds = Array.from(new Set(slots.map((s) => s.plan_id).filter((x): x is string => !!x)))
  // Plus any plan that has at least one item marked pushed_to_scheduler_at.
  // JSONB path query handles the "any element matches" check.
  const { rows } = await pool.query<PlanRow>(
    `SELECT sp.id, sp.project_id, p.name AS project_name, sp.song_id, s.title AS song_title,
            p.cover_art_url AS project_cover_art_url, sp.items
       FROM social_plans sp
       JOIN projects p ON p.id = sp.project_id
       LEFT JOIN songs s ON s.id = sp.song_id
      WHERE sp.id = ANY($1::uuid[])
         OR sp.items @? '$[*] ? (@.pushed_to_scheduler_at != null)'`,
    [slotPlanIds],
  )
  const map = new Map<string, PlanRow>()
  for (const r of rows) map.set(r.id, r)
  return map
}

type ApiSlotItem = {
  planId: string
  itemId: string
  projectId: string
  projectName: string
  songId: string | null
  songTitle: string | null
  projectCoverArtUrl: string | null
  item: SocialItem
}

function planItemToApi(plan: PlanRow, item: SocialItem): ApiSlotItem {
  return {
    planId: plan.id,
    itemId: item.id,
    projectId: plan.project_id,
    projectName: plan.project_name,
    songId: plan.song_id,
    songTitle: plan.song_title,
    projectCoverArtUrl: plan.project_cover_art_url,
    item,
  }
}

function slotToApi(slot: SlotRow, plans: Map<string, PlanRow>): {
  id: string
  kind: SlotKind
  index: number
  scheduledTime: string
  platforms: string[]
  status: SlotRow['status']
  item: ApiSlotItem | null
} {
  let item: ApiSlotItem | null = null
  if (slot.plan_id && slot.item_id) {
    const plan = plans.get(slot.plan_id)
    if (plan) {
      const found = findItem(plan.items, slot.item_id)
      if (found) item = planItemToApi(plan, found.item)
    }
  }
  return {
    id: slot.id,
    kind: slot.kind,
    index: slot.slot_index,
    scheduledTime: slot.scheduled_time.slice(0, 5),
    platforms: slot.platforms,
    status: slot.status,
    item,
  }
}

// GET /api/scheduler?from=YYYY-MM-DD&to=YYYY-MM-DD
schedulerRouter.get('/', async (req, res) => {
  const from = String(req.query.from || '')
  const to = String(req.query.to || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    res.status(400).json({ error: 'from and to required as YYYY-MM-DD' }); return
  }
  if (to < from) { res.status(400).json({ error: 'to_before_from' }); return }
  // Cap range to 31 days to keep payloads sane.
  const dates = eachDate(from, to)
  if (dates.length > 31) { res.status(400).json({ error: 'range_too_large_max_31_days' }); return }

  try {
    await seedDays(dates)
  } catch (err) {
    logError('scheduler.seed failed', { from, to, error: err instanceof Error ? err.message : String(err) })
  }

  const { rows: slots } = await pool.query<SlotRow>(
    `SELECT id, day_date::text, kind, slot_index, scheduled_time::text,
            plan_id, item_id, status, platforms
       FROM scheduler_slots
      WHERE day_date >= $1 AND day_date <= $2
      ORDER BY day_date, kind, slot_index`,
    [from, to],
  )
  const plans = await loadRelevantPlans(slots)

  // Group slots by day.
  const dayMap = new Map<string, typeof slots>()
  for (const date of dates) dayMap.set(date, [])
  for (const s of slots) {
    const key = s.day_date.slice(0, 10)
    const list = dayMap.get(key)
    if (list) list.push(s)
  }
  const days = Array.from(dayMap.entries()).map(([date, slotsForDay]) => ({
    date,
    slots: slotsForDay.map((s) => slotToApi(s, plans)),
  }))

  // Backlog: every pushed item across all relevant plans, minus those
  // currently assigned to a slot.
  const assigned = new Set<string>()
  for (const s of slots) {
    if (s.plan_id && s.item_id) assigned.add(`${s.plan_id}:${s.item_id}`)
  }
  const backlog: ApiSlotItem[] = []
  for (const plan of plans.values()) {
    for (const item of plan.items) {
      const pushed = (item as unknown as { pushed_to_scheduler_at?: string }).pushed_to_scheduler_at
      if (!pushed) continue
      if (assigned.has(`${plan.id}:${item.id}`)) continue
      backlog.push(planItemToApi(plan, item))
    }
  }

  res.json({ days, backlog })
})

// PATCH /api/scheduler/slots/:id — admin-only assign/clear/time/platforms.
schedulerRouter.patch('/slots/:id', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  if (user.role !== 'admin') { res.status(403).json({ error: 'admin_only' }); return }

  const { rows } = await pool.query<SlotRow>(
    `SELECT id, day_date::text, kind, slot_index, scheduled_time::text,
            plan_id, item_id, status, platforms
       FROM scheduler_slots WHERE id = $1`,
    [req.params.id],
  )
  if (rows.length === 0) { res.status(404).json({ error: 'not_found' }); return }
  const slot = rows[0]

  const body = req.body as {
    planId?: string | null
    itemId?: string | null
    scheduledTime?: string
    platforms?: string[]
    status?: 'planned' | 'posted' | 'skipped'
  }

  const sets: string[] = []
  const params: unknown[] = []
  let p = 1

  // Assigning an item: planId + itemId together, and the item must match
  // the slot's kind. Clearing: explicit null on both.
  if ('planId' in body || 'itemId' in body) {
    if (body.planId == null && body.itemId == null) {
      sets.push(`plan_id = NULL`, `item_id = NULL`)
    } else if (body.planId && body.itemId) {
      // Validate item exists and matches kind.
      const planRes = await pool.query<{ items: SocialItem[] }>(
        `SELECT items FROM social_plans WHERE id = $1`, [body.planId],
      )
      if (planRes.rows.length === 0) { res.status(400).json({ error: 'plan_not_found' }); return }
      const found = findItem(planRes.rows[0].items, body.itemId)
      if (!found) { res.status(400).json({ error: 'item_not_found' }); return }
      if (found.item.kind !== slot.kind) {
        res.status(400).json({ error: `kind_mismatch: slot=${slot.kind} item=${found.item.kind}` }); return
      }
      // If this item is already on another slot, vacate that slot first
      // (drag = move, not copy).
      await pool.query(
        `UPDATE scheduler_slots SET plan_id = NULL, item_id = NULL, updated_at = now()
          WHERE plan_id = $1 AND item_id = $2 AND id != $3`,
        [body.planId, body.itemId, slot.id],
      )
      sets.push(`plan_id = $${p++}`); params.push(body.planId)
      sets.push(`item_id = $${p++}`); params.push(body.itemId)
    } else {
      res.status(400).json({ error: 'planId_and_itemId_required_together' }); return
    }
  }

  if (typeof body.scheduledTime === 'string') {
    if (!/^\d{2}:\d{2}$/.test(body.scheduledTime)) {
      res.status(400).json({ error: 'scheduledTime must be HH:MM' }); return
    }
    sets.push(`scheduled_time = $${p++}`); params.push(`${body.scheduledTime}:00`)
  }

  if (Array.isArray(body.platforms)) {
    const cleaned = body.platforms.filter((x) => typeof x === 'string')
    sets.push(`platforms = $${p++}::text[]`); params.push(cleaned)
  }

  if (typeof body.status === 'string') {
    if (!['planned', 'posted', 'skipped'].includes(body.status)) {
      res.status(400).json({ error: 'invalid status' }); return
    }
    sets.push(`status = $${p++}`); params.push(body.status)
  }

  if (sets.length === 0) { res.json({ ok: true }); return }
  sets.push(`updated_at = now()`)
  params.push(slot.id)
  await pool.query(
    `UPDATE scheduler_slots SET ${sets.join(', ')} WHERE id = $${p}`,
    params,
  )
  res.json({ ok: true })
})

// POST /api/scheduler/items — author an ad-hoc post (no episode required).
// The new item is inserted into the project's freeform plan (song_id IS
// NULL; created on first use) and immediately marked as pushed so it
// shows up in the backlog.
//
// Body: { projectId, kind, fields: { … } }
//   text_post:     { text }
//   photo_concept: { image_direction, caption, vibe }
//   reel_concept:  { hook, talking_points, suggested_clip }
//   story_concept: { medium, description, caption, suggested_clip, image_direction }
schedulerRouter.post('/items', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const body = req.body as {
    projectId?: string
    kind?: SlotKind
    fields?: Record<string, unknown>
  }
  const projectId = body.projectId
  const kind = body.kind
  const fields = body.fields ?? {}
  if (!projectId || !kind) { res.status(400).json({ error: 'projectId and kind required' }); return }
  if (!SLOT_KINDS.includes(kind)) { res.status(400).json({ error: `invalid kind: ${kind}` }); return }
  if (!await assertWriter(user, projectId, res)) return

  // Find or lazily create the project's freeform plan.
  let planId: string
  const existing = await pool.query<{ id: string; items: SocialItem[] }>(
    `SELECT id, items FROM social_plans WHERE project_id = $1 AND song_id IS NULL LIMIT 1`,
    [projectId],
  )
  let items: SocialItem[]
  if (existing.rows.length > 0) {
    planId = existing.rows[0].id
    items = existing.rows[0].items
  } else {
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO social_plans (project_id, song_id, status, items, created_by)
       VALUES ($1, NULL, 'generated', '[]'::jsonb, $2) RETURNING id`,
      [projectId, user.id],
    )
    planId = inserted.rows[0].id
    items = []
  }

  // Build the item from the per-kind fields. Mirrors the shape produced
  // by the Claude generator so the rest of the app can consume it
  // uniformly.
  const itemId = crypto.randomUUID()
  const pushedAt = new Date().toISOString()
  let item: SocialItem
  const s = (k: string, fallback = ''): string => {
    const v = fields[k]
    return typeof v === 'string' ? v : fallback
  }
  const arr = (k: string): string[] => {
    const v = fields[k]
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  }
  switch (kind) {
    case 'text_post': {
      const text = s('text').trim()
      if (!text) { res.status(400).json({ error: 'text required' }); return }
      item = { id: itemId, kind: 'text_post', status: 'drafted', ai_text: text, text }
      break
    }
    case 'photo_concept':
      item = {
        id: itemId, kind: 'photo_concept', status: 'drafted',
        assignee_user_id: null,
        image_direction: s('image_direction'),
        caption: s('caption'),
        vibe: s('vibe'),
      }
      break
    case 'reel_concept':
      item = {
        id: itemId, kind: 'reel_concept', status: 'drafted',
        assignee_user_id: null,
        hook: s('hook'),
        talking_points: arr('talking_points'),
        suggested_clip: s('suggested_clip'),
      }
      break
    case 'story_concept': {
      const medium = s('medium') === 'photo' ? 'photo' : 'video'
      item = {
        id: itemId, kind: 'story_concept', status: 'drafted',
        assignee_user_id: null,
        medium,
        description: s('description'),
        caption: s('caption'),
        suggested_clip: s('suggested_clip'),
        image_direction: s('image_direction'),
      }
      break
    }
  }
  ;(item as unknown as Record<string, unknown>).pushed_to_scheduler_at = pushedAt
  items.push(item)
  await pool.query(
    `UPDATE social_plans SET items = $2::jsonb, updated_at = now() WHERE id = $1`,
    [planId, JSON.stringify(items)],
  )
  res.json({ ok: true, planId, itemId })
})

// POST /api/scheduler/push — mark a social item as queued for scheduling.
schedulerRouter.post('/push', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const { planId, itemId } = req.body as { planId?: string; itemId?: string }
  if (!planId || !itemId) { res.status(400).json({ error: 'planId and itemId required' }); return }

  const { rows } = await pool.query<{ project_id: string; items: SocialItem[] }>(
    `SELECT project_id, items FROM social_plans WHERE id = $1`, [planId],
  )
  if (rows.length === 0) { res.status(404).json({ error: 'plan_not_found' }); return }
  if (!await assertWriter(user, rows[0].project_id, res)) return

  const items = rows[0].items
  const found = findItem(items, itemId)
  if (!found) { res.status(404).json({ error: 'item_not_found' }); return }

  ;(items[found.index] as unknown as Record<string, unknown>).pushed_to_scheduler_at = new Date().toISOString()
  await pool.query(
    `UPDATE social_plans SET items = $2::jsonb, updated_at = now() WHERE id = $1`,
    [planId, JSON.stringify(items)],
  )
  res.json({ ok: true })
})

// POST /api/scheduler/unpush — remove an item from the scheduler (clears
// its slot if any and unsets pushed_to_scheduler_at).
schedulerRouter.post('/unpush', async (req, res) => {
  const user = (req as typeof req & { user: SessionUser }).user
  const { planId, itemId } = req.body as { planId?: string; itemId?: string }
  if (!planId || !itemId) { res.status(400).json({ error: 'planId and itemId required' }); return }

  const { rows } = await pool.query<{ project_id: string; items: SocialItem[] }>(
    `SELECT project_id, items FROM social_plans WHERE id = $1`, [planId],
  )
  if (rows.length === 0) { res.status(404).json({ error: 'plan_not_found' }); return }
  if (!await assertWriter(user, rows[0].project_id, res)) return

  const items = rows[0].items
  const found = findItem(items, itemId)
  if (!found) { res.status(404).json({ error: 'item_not_found' }); return }

  delete (items[found.index] as unknown as Record<string, unknown>).pushed_to_scheduler_at
  await pool.query(
    `UPDATE social_plans SET items = $2::jsonb, updated_at = now() WHERE id = $1`,
    [planId, JSON.stringify(items)],
  )
  await pool.query(
    `UPDATE scheduler_slots SET plan_id = NULL, item_id = NULL, updated_at = now()
      WHERE plan_id = $1 AND item_id = $2`,
    [planId, itemId],
  )
  res.json({ ok: true })
})

// Aggregate a scene's budget view: line items that are attached to
// this scene specifically PLUS shared resources that auto-link via
// LOCATION (scenes.location_tag) or CHARACTER (scenes.characters) PLUS
// resources manually attached via the scene_budget_items junction.
//
// One source of truth used by:
//   - GET /api/budgets/scenes/:sceneId/items (the scene detail modal)
//   - The script.json publisher (so Claude sees what's in each scene)
//   - "Used in N scenes" counts on shared items

import { pool } from './db'

// Mirror the normalization rules used by the FDX parser so resource_key
// values line up with scenes.location_tag and (lowercased) character
// names.
export function normalizeKey(s: string | null | undefined): string | null {
  if (!s) return null
  return s.toLowerCase().replace(/'/g, '').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || null
}

export type SceneBudgetItem = {
  id: string
  code: string | null
  description: string
  amt: number
  units: string | null
  x: number
  rate: number
  vendor: string | null
  datedAt: string | null
  notes: string | null
  position: number
  total: number
  resourceType: string | null
  resourceKey: string | null
  // Which scenes use this item. For scene-only items this is just
  // [self]. For shared items, every scene where the item shows up.
  sceneUsageCount: number
  // True if this item ONLY belongs to this scene (no resource_type and
  // not in any junction row beyond this scene).
  isSceneOnly: boolean
}

export async function getSceneBudgetItems(sceneId: string): Promise<SceneBudgetItem[]> {
  const scn = await pool.query<{
    project_id: string; location_tag: string | null; characters: string[];
  }>(
    `SELECT project_id, location_tag, characters FROM scenes WHERE id = $1`,
    [sceneId],
  )
  if (scn.rows.length === 0) return []
  const sc = scn.rows[0]
  const characterKeys = (sc.characters ?? []).map(normalizeKey).filter((k): k is string => !!k)

  // 1) Items scene_id-attached to this scene (one-off, scene-specific)
  // 2) Shared LOCATION items that match this scene's location_tag
  // 3) Shared CHARACTER items where the key is in this scene's cast
  // 4) Manually attached via scene_budget_items junction
  // Deduplicated by id (a shared item might match by tag AND junction).
  const { rows } = await pool.query<{
    id: string; code: string | null; description: string;
    amt: string; units: string | null; x: string; rate: string;
    vendor: string | null; dated_at: string | null; notes: string | null; position: number;
    resource_type: string | null; resource_key: string | null;
    usage_count: string; is_scene_only: boolean;
  }>(
    `WITH relevant_items AS (
       SELECT li.id
       FROM budget_line_items li
       JOIN budget_accounts a ON a.id = li.account_id
       JOIN budgets b ON b.id = a.budget_id
       WHERE b.project_id = $1
         AND (
              li.scene_id = $2
           OR (li.resource_type = 'LOCATION' AND li.resource_key = $3 AND $3 IS NOT NULL)
           OR (li.resource_type = 'CHARACTER' AND li.resource_key = ANY($4::text[]))
           OR EXISTS (
             SELECT 1 FROM scene_budget_items sbi
             WHERE sbi.budget_line_item_id = li.id AND sbi.scene_id = $2
           )
         )
     )
     SELECT
       li.id, li.code, li.description, li.amt, li.units, li.x, li.rate,
       li.vendor, li.dated_at, li.notes, li.position,
       li.resource_type, li.resource_key,
       (
         (CASE WHEN li.scene_id IS NOT NULL THEN 1 ELSE 0 END)
         +
         (CASE
           WHEN li.resource_type = 'LOCATION' AND li.resource_key IS NOT NULL
             THEN (SELECT COUNT(*) FROM scenes WHERE project_id = $1 AND location_tag = li.resource_key)
           WHEN li.resource_type = 'CHARACTER' AND li.resource_key IS NOT NULL
             THEN (SELECT COUNT(*) FROM scenes WHERE project_id = $1
                     AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(characters) c
                                  WHERE lower(regexp_replace(c, '[^a-zA-Z0-9]+', '_', 'g')) = li.resource_key))
           ELSE 0
         END)
         +
         (SELECT COUNT(*) FROM scene_budget_items sbi
            WHERE sbi.budget_line_item_id = li.id
              AND (li.scene_id IS NULL OR sbi.scene_id <> li.scene_id))
       )::text AS usage_count,
       (li.scene_id = $2 AND li.resource_type IS NULL
         AND NOT EXISTS (SELECT 1 FROM scene_budget_items sbi WHERE sbi.budget_line_item_id = li.id)
       ) AS is_scene_only
     FROM budget_line_items li
     WHERE li.id IN (SELECT id FROM relevant_items)
     ORDER BY li.position ASC, li.created_at ASC`,
    [sc.project_id, sceneId, sc.location_tag, characterKeys],
  )

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    description: r.description,
    amt: Number(r.amt),
    units: r.units,
    x: Number(r.x),
    rate: Number(r.rate),
    vendor: r.vendor,
    datedAt: r.dated_at,
    notes: r.notes,
    position: r.position,
    total: Number(r.amt) * Number(r.x) * Number(r.rate),
    resourceType: r.resource_type,
    resourceKey: r.resource_key,
    sceneUsageCount: Math.max(1, Number(r.usage_count)),
    isSceneOnly: r.is_scene_only,
  }))
}

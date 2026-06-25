// Cluster per-character wardrobe items into distinct outfits.
//
// Claude generates a slightly different wardrobe description per scene
// even when the character is wearing the same outfit. The producer
// wants: each DISTINCT outfit gets a single budget row, attached to
// every scene that outfit appears in. Pricing it once covers every
// scene that uses it.
//
// Pipeline:
//   1. Pull every WARDROBE-coded line item still attached to a scene
//      (i.e. not yet consolidated).
//   2. Group by character name extracted from the description prefix.
//   3. For each character, send their distinct outfit descriptions to
//      Claude and ask for a JSON clustering: distinct outfits +
//      which input descriptions map to which cluster.
//   4. Apply: for each cluster, create one shared budget_line_items
//      row with a clean label, attach it via scene_budget_items to
//      every scene that had a member item, then delete the originals.
//
// Cost on Sonnet: ~$0.02 for a 30-character feature. Run once after
// the breakdown finishes.
import Anthropic from '@anthropic-ai/sdk'
import { pool } from './db'
import { logError, logInfo } from './diag'

const client = new Anthropic()
const MODEL = 'claude-sonnet-4-6'

const SYSTEM_PROMPT = `You are a wardrobe department head doing continuity.

You receive a list of wardrobe descriptions for ONE character across many
scenes, each generated independently. They may describe the SAME outfit
with different words ("Sawyer casual day wardrobe" vs "Sawyer casual
daytime wardrobe" — both probably mean the same outfit) or DIFFERENT
outfits (formal eveningwear vs running gear).

Cluster them into distinct outfits. An outfit is a complete look that
the costume department would buy/rent ONCE — variations within the same
look stay in the same cluster.

For each cluster, write a short clean label the costume department can
use ("Casual day outfit", "Running gear", "Formal evening", etc.).

Return strict JSON only:
{
  "outfits": [
    {
      "label": "Casual day outfit",
      "memberIndices": [0, 1, 3, 7]
    },
    {
      "label": "Running gear",
      "memberIndices": [4, 5]
    }
  ]
}

memberIndices reference the 0-based index of the input descriptions
provided in the user message.

If there's only one outfit across all inputs, return a single cluster.
If every description seems unique enough to be its own outfit, return
one cluster per input — but lean toward MERGING when similar.`

export type ClusterResult = {
  characters: number
  outfitsCreated: number
  itemsConsolidated: number
}

type WardrobeRow = {
  id: string
  scene_id: string | null
  description: string
  amt: string
  x: string
  rate: string
  account_id: string
}

function characterFromDescription(d: string): { display: string; key: string } {
  const colon = d.indexOf(':')
  const dashOrComma = Math.min(
    ...[d.indexOf(','), d.indexOf(' wardrobe'), d.indexOf(' outfit')].filter((n) => n > 0),
  )
  const cut = colon > 0 && colon < 60 ? colon : (Number.isFinite(dashOrComma) ? dashOrComma : -1)
  const name = cut > 0 ? d.slice(0, cut).trim() : d.trim()
  return {
    display: name.toUpperCase().slice(0, 60),
    key: name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80),
  }
}

export async function clusterProjectWardrobe(projectId: string, userId: string): Promise<ClusterResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set')
  }
  const itemsRes = await pool.query<WardrobeRow>(
    `SELECT li.id, li.scene_id, li.description, li.amt, li.x, li.rate, li.account_id
     FROM budget_line_items li
     JOIN budget_accounts a ON a.id = li.account_id
     JOIN budgets b ON b.id = a.budget_id
     WHERE b.project_id = $1
       AND li.code = 'WARDROBE'
       AND li.resource_type IS NULL
       AND li.scene_id IS NOT NULL`,
    [projectId],
  )
  if (itemsRes.rows.length === 0) return { characters: 0, outfitsCreated: 0, itemsConsolidated: 0 }

  // Group by character
  type Group = { display: string; key: string; rows: WardrobeRow[]; accountId: string }
  const groups = new Map<string, Group>()
  for (const r of itemsRes.rows) {
    const { display, key } = characterFromDescription(r.description)
    if (!key) continue
    const g = groups.get(key)
    if (g) g.rows.push(r)
    else groups.set(key, { display, key, rows: [r], accountId: r.account_id })
  }

  let outfitsCreated = 0
  let itemsConsolidated = 0

  for (const g of groups.values()) {
    if (g.rows.length === 0) continue

    // Distinct descriptions to feed to Claude, plus mapping back to rows
    const distinctDescs: string[] = []
    const rowsByDesc = new Map<string, WardrobeRow[]>()
    for (const r of g.rows) {
      const d = r.description.trim()
      if (!rowsByDesc.has(d)) {
        rowsByDesc.set(d, [])
        distinctDescs.push(d)
      }
      rowsByDesc.get(d)!.push(r)
    }

    // Single description → trivial single cluster, skip Claude
    let clusters: Array<{ label: string; memberIndices: number[] }>
    if (distinctDescs.length === 1) {
      clusters = [{ label: distinctDescs[0], memberIndices: [0] }]
    } else {
      try {
        const userBlock = [
          `CHARACTER: ${g.display}`,
          '',
          'WARDROBE DESCRIPTIONS (index | description):',
          ...distinctDescs.map((d, i) => `${i} | ${d}`),
        ].join('\n')
        const response = await client.messages.create({
          model: MODEL,
          max_tokens: 4000,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userBlock }],
        })
        const text = response.content.find((b) => b.type === 'text')
        const raw = text && text.type === 'text' ? text.text : ''
        const start = raw.indexOf('{')
        const end = raw.lastIndexOf('}')
        if (start < 0 || end < 0) throw new Error('no JSON')
        const parsed = JSON.parse(raw.slice(start, end + 1))
        if (!Array.isArray(parsed.outfits)) throw new Error('no outfits array')
        clusters = parsed.outfits
      } catch (err) {
        logError('wardrobe_clustering: claude failed for character, falling back to per-description', {
          character: g.display,
          error: err instanceof Error ? err.message : String(err),
        })
        // Fallback: each distinct description becomes its own outfit
        clusters = distinctDescs.map((d, i) => ({ label: d, memberIndices: [i] }))
      }
    }

    for (const cluster of clusters) {
      const memberRows: WardrobeRow[] = []
      const sceneIds = new Set<string>()
      for (const idx of cluster.memberIndices ?? []) {
        const desc = distinctDescs[idx]
        if (!desc) continue
        for (const r of rowsByDesc.get(desc) ?? []) {
          memberRows.push(r)
          if (r.scene_id) sceneIds.add(r.scene_id)
        }
      }
      if (memberRows.length === 0) continue

      // Preserve highest price found in the cluster
      const maxCost = Math.max(0, ...memberRows.map((r) => Number(r.amt) * Number(r.x) * Number(r.rate)))

      // Create the shared row
      const posRes = await pool.query<{ next: number }>(
        `SELECT COALESCE(MAX(position), 0) + 10 AS next FROM budget_line_items WHERE account_id = $1`,
        [g.accountId],
      )
      const newRow = await pool.query<{ id: string }>(
        `INSERT INTO budget_line_items
          (account_id, code, description, amt, x, rate, units, notes, resource_type, resource_key, position, created_by)
         VALUES ($1, 'WARDROBE', $2, 1, 1, $3, 'Flat', $4, 'WARDROBE_OUTFIT', $5, $6, $7)
         RETURNING id`,
        [
          g.accountId,
          `${g.display} — ${cluster.label}`,
          maxCost,
          `Used in ${sceneIds.size} scene${sceneIds.size === 1 ? '' : 's'}.`,
          `${g.key}__${cluster.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}`,
          posRes.rows[0].next,
          userId,
        ],
      )
      const newRowId = newRow.rows[0].id

      // Attach via junction
      for (const sceneId of sceneIds) {
        await pool.query(
          `INSERT INTO scene_budget_items (scene_id, budget_line_item_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [sceneId, newRowId],
        )
      }

      // Delete original per-scene rows
      await pool.query(
        `DELETE FROM budget_line_items WHERE id = ANY($1::uuid[])`,
        [memberRows.map((r) => r.id)],
      )

      outfitsCreated += 1
      itemsConsolidated += memberRows.length
    }
  }

  logInfo('wardrobe clustering complete', {
    projectId, characters: groups.size, outfitsCreated, itemsConsolidated,
  })

  return {
    characters: groups.size,
    outfitsCreated,
    itemsConsolidated,
  }
}

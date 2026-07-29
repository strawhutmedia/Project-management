// Boot-time task: run the locations auto-sync for BIYA (so the grouped tree
// is ready before anyone opens the page) and mirror the resulting tree to the
// status branch as locations-dump.json for verification.

import { pool } from './db'
import { ensureLocationRows } from './routes/locations'
import { writeStatusFile, statusReportingEnabled } from './github'
import { logError, logInfo } from './diag'

const BIYA_PROJECT_ID = '12f53ed1-c6c7-4c11-8d7b-06d91744c9af'

export function scheduleBootLocationsDump(): void {
  setTimeout(() => {
    void dumpLocations()
  }, 30_000).unref()
}

async function dumpLocations(): Promise<void> {
  try {
    await ensureLocationRows(BIYA_PROJECT_ID)
  } catch (err) {
    logError('locations dump: ensure failed', { error: err instanceof Error ? err.message : String(err) })
    return
  }
  if (!statusReportingEnabled()) return
  try {
    const locs = await pool.query<{ id: string; tag: string; name: string; parent_id: string | null }>(
      `SELECT id, tag, name, parent_id FROM locations WHERE project_id = $1 ORDER BY position`,
      [BIYA_PROJECT_ID],
    )
    const stats = await pool.query<{ location_tag: string; scene_count: string; day_numbers: number[] }>(
      `SELECT s.location_tag, COUNT(*)::int AS scene_count,
              COALESCE(array_agg(DISTINCT sd.number) FILTER (WHERE sd.number IS NOT NULL), '{}') AS day_numbers
         FROM scenes s LEFT JOIN shoot_days sd ON sd.id = s.shoot_day_id
        WHERE s.project_id = $1 AND s.location_tag IS NOT NULL AND s.location_tag <> ''
        GROUP BY s.location_tag`,
      [BIYA_PROJECT_ID],
    )
    const statBy = new Map(stats.rows.map((r) => [r.location_tag, r]))
    const childrenOf = new Map<string | null, typeof locs.rows>()
    for (const l of locs.rows) {
      const k = l.parent_id
      if (!childrenOf.has(k)) childrenOf.set(k, [])
      childrenOf.get(k)!.push(l)
    }
    const rolledDays = (id: string): number[] => {
      const set = new Set<number>()
      const walk = (nid: string) => {
        const n = locs.rows.find((r) => r.id === nid)
        if (!n) return
        for (const d of (statBy.get(n.tag)?.day_numbers ?? [])) set.add(Number(d))
        for (const c of childrenOf.get(nid) ?? []) walk(c.id)
      }
      walk(id)
      return Array.from(set).sort((a, b) => a - b)
    }
    const render = (id: string, depth: number): string => {
      const n = locs.rows.find((r) => r.id === id)!
      const days = rolledDays(id)
      const isGroup = n.tag.startsWith('base_') || n.tag.startsWith('grp_')
      const line = `${'  '.repeat(depth)}${isGroup ? '▸ ' : '• '}${n.name} — ${days.length} days [${days.join(',')}]${isGroup ? ' (group)' : ''}`
      const kids = (childrenOf.get(id) ?? []).map((c) => render(c.id, depth + 1))
      return [line, ...kids].join('\n')
    }
    const tree = (childrenOf.get(null) ?? []).map((l) => render(l.id, 0)).join('\n')
    const out = {
      generatedAt: new Date().toISOString(),
      totalLocations: locs.rows.length,
      tree,
    }
    const result = await writeStatusFile('locations-dump.json', JSON.stringify(out, null, 2), 'locations: dump tree')
    if (!result.ok) { logError('locations dump: github write failed', { error: result.error }); return }
    logInfo('locations dump: wrote locations-dump.json', { total: locs.rows.length })
  } catch (err) {
    logError('locations dump: threw', { error: err instanceof Error ? err.message : String(err) })
  }
}

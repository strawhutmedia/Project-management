// Boot-time task: run the locations auto-sync for BIYA (so the grouped tree
// is ready before anyone opens the page) and mirror the resulting breakdown
// to the status branch as locations-dump.json for verification.

import { ensureLocationRows, debugLocationBreakdown } from './routes/locations'
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
    const bases = await debugLocationBreakdown(BIYA_PROJECT_ID)
    const tree = bases
      .map((b) => {
        const head = `▸ ${b.name} — ${b.days.length} days [${b.days.join(',')}] · ${b.sceneCount} scenes`
        const rooms = b.rooms
          .sort((a, c) => c.days.length - a.days.length)
          .map((r) => `    • ${r.name} — ${r.days.length}d [${r.days.join(',')}]`)
        return [head, ...rooms].join('\n')
      })
      .join('\n')
    const out = { generatedAt: new Date().toISOString(), totalBaseLocations: bases.length, tree }
    const result = await writeStatusFile('locations-dump.json', JSON.stringify(out, null, 2), 'locations: dump breakdown')
    if (!result.ok) { logError('locations dump: github write failed', { error: result.error }); return }
    logInfo('locations dump: wrote locations-dump.json', { total: bases.length })
  } catch (err) {
    logError('locations dump: threw', { error: err instanceof Error ? err.message : String(err) })
  }
}

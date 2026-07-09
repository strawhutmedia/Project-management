// Boot-time task: read the latest BIYA .fdx from project_script_uploads,
// parse to plaintext via fdx_parser, and mirror to the status branch as
// biya-screenplay.txt so future Claude Code sessions can read the full
// screenplay directly from the repo instead of only seeing the shooting
// schedule PDF.
//
// Runs 20s after boot (well after migrations, seeds, RSS sync, flagship
// seed) so it doesn't fight for startup lanes. Idempotent — writes the
// same file every boot; GitHub API handles the diff.

import { pool } from './db'
import { parseFdx } from './fdx_parser'
import { writeStatusFile, statusReportingEnabled } from './github'
import { logError, logInfo } from './diag'

const BIYA_PROJECT_ID = '12f53ed1-c6c7-4c11-8d7b-06d91744c9af'

export function scheduleBootBiyaScriptDump(): void {
  setTimeout(() => {
    void dumpBiyaScript()
  }, 20_000).unref()
}

async function dumpBiyaScript(): Promise<void> {
  if (!statusReportingEnabled()) {
    logInfo('biya script dump: skipped — GITHUB_TOKEN not set')
    return
  }
  try {
    const { rows } = await pool.query<{ id: string; file_name: string | null; xml: string; uploaded_at: string; scene_count: number }>(
      `SELECT id, file_name, xml, uploaded_at, scene_count
         FROM project_script_uploads
        WHERE project_id = $1
        ORDER BY uploaded_at DESC
        LIMIT 1`,
      [BIYA_PROJECT_ID],
    )
    const upload = rows[0]
    if (!upload) {
      logInfo('biya script dump: no upload found — skipping', { projectId: BIYA_PROJECT_ID })
      return
    }
    const scenes = parseFdx(upload.xml)
    if (scenes.length === 0) {
      logError('biya script dump: parseFdx returned 0 scenes', { uploadId: upload.id })
      return
    }
    const header = [
      `BACK IN YOUR ARMS — screenplay dump`,
      `Source: ${upload.file_name ?? '(no filename)'} — uploaded ${upload.uploaded_at}`,
      `Scenes parsed: ${scenes.length}`,
      `This file is a mirror of project_script_uploads.xml, written on every`,
      `Slate boot so Claude Code sessions have direct access to the script.`,
      `Do not hand-edit — it will be overwritten on the next deploy.`,
      ``,
      `═══════════════════════════════════════════════════════════════════`,
      ``,
    ].join('\n')

    const body = scenes.map((s) => {
      const heading = `## Scene ${s.number}  —  ${s.slug}`
      const meta = [
        s.page ? `p. ${s.page}` : null,
        s.pageEighths ? `${Math.floor(s.pageEighths / 8)} ${s.pageEighths % 8}/8 pages` : null,
        s.characters.length > 0 ? `Cast: ${s.characters.join(', ')}` : null,
      ].filter(Boolean).join('  ·  ')
      return `${heading}\n${meta}\n\n${s.actionText || '(no action text)'}\n\n───\n`
    }).join('\n')

    const content = header + body
    const result = await writeStatusFile(
      'biya-screenplay.txt',
      content,
      `biya: mirror screenplay from upload ${upload.id.slice(0, 8)}`,
    )
    if (!result.ok) {
      logError('biya script dump: github write failed', { error: result.error })
      return
    }
    logInfo('biya script dump: mirrored to status branch', {
      scenes: scenes.length,
      bytes: content.length,
      uploadId: upload.id,
    })
  } catch (err) {
    logError('biya script dump: threw', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// Auto-schedule a film shoot using Claude. Reads every scene's
// metadata (location, cast, INT/EXT, time of day, page eighths) and
// asks Claude to propose a shooting order across N days that
// optimizes for:
//
//   1. Cast continuity — actors work consecutive days, not in/out
//   2. Location continuity — minimize company moves, group scenes at
//      the same place onto adjacent days
//   3. Day/Night separation — don't mix day exteriors with night
//      shoots on the same day
//   4. Page count cap — target pages/day (default 7)
//
// Hard constraints from US production labor rules:
//   - 12-hour turnaround between days (Claude flags risk, can't
//     enforce without call times)
//   - Max 6 consecutive shoot days, then a forced rest day
//   - Lunch break every 6 hours of work (~5 hour mark)
//   - Overtime / meal penalty awareness (Claude flags in warnings)
//
// Returns a PROPOSAL — never auto-applies. The producer reviews,
// optionally saves a snapshot of the current schedule, then commits.

import Anthropic from '@anthropic-ai/sdk'
import { pool } from './db'
import { logError, logInfo } from './diag'

const client = new Anthropic()

const SCHEDULER_MODEL_SONNET = 'claude-sonnet-4-6'
const SCHEDULER_MODEL_OPUS = 'claude-opus-4-8'

export type ScheduleProposal = {
  shootDays: Array<{
    number: number
    isBreak: boolean
    sceneNumbers: string[]
    notes: string
    warnings: string[]
    pagesTotal: number
    locations: string[]
  }>
  summary: string
  unscheduled: string[]
  warnings: string[]
}

export type ScheduleConstraints = {
  shootDays: number
  maxPagesPerDay: number
  useOpus?: boolean
  notes?: string
}

const SYSTEM_PROMPT = `You are a 1st AD scheduling a film shoot. You read
every scene's metadata and propose a shooting order across N days.

Optimize, in this order of importance:

  1. CAST CONTINUITY — actors should work consecutive days, never with
     long gaps. If LISA appears in scenes 4, 17, 31, schedule them on
     adjacent days, not weeks apart. Producers pay per-day even if
     they only shoot one scene; gaps mean either expensive holding
     days or actors going home and coming back (per-diem hits).
  2. LOCATION CONTINUITY — minimize company moves. Shoot every scene
     at "KENDRICK'S HOUSE" on the same one or two days. Moving the
     trucks costs a half-day of production time.
  3. DAY/NIGHT SEPARATION — never mix day-exterior scenes with
     night-exterior scenes on the same shoot day. The sun doesn't
     cooperate. Interiors can flex.
  4. PAGE COUNT BUDGET — target the daily max in pages (eighths /
     8). Going over risks overtime and meal penalties.
  5. PHYSICAL/EMOTIONAL LOAD — try to spread out heavy scenes
     (stunts, large extra calls, long monologues) so the cast
     isn't drained mid-week.

Hard constraints (US production):

  - Max 6 consecutive shoot days. After 6, insert an isBreak: true day.
    The producer can decide if it's a rest day or a travel day.
  - 12-hour turnaround between days — if day N ends late night, day
    N+1 can't start at dawn. Flag with a warning when a late wrap
    butts up against an early call.
  - Lunch break ~6 hours into the workday. If a day's pages would
    require a 14+ hour run, flag overtime risk.
  - Meal penalty kicks in when an actor's between-meal gap exceeds
    6 hours. Flag if a day's load suggests this.

Output strict JSON only. Schema:

{
  "shootDays": [
    {
      "number": 1,
      "isBreak": false,
      "sceneNumbers": ["1", "2", "3A"],
      "notes": "INT KENDRICK'S HOUSE day cluster — JOHN, LISA",
      "warnings": [],
      "pagesTotal": 5.625,
      "locations": ["KENDRICK'S HOUSE"]
    },
    ...
    {
      "number": 7,
      "isBreak": true,
      "sceneNumbers": [],
      "notes": "Required 6-day rule break",
      "warnings": [],
      "pagesTotal": 0,
      "locations": []
    }
  ],
  "summary": "JOHN works days 1-4 consecutive. LISA days 1-2 + 8. Locations clustered: KENDRICK'S HOUSE days 1-2, DINER days 3-4, EXT FOREST day 5. Two break days inserted on the 6-day rule.",
  "unscheduled": ["Any scene numbers you can't fit go here"],
  "warnings": ["Day 4 has 8 pages with two stunt sequences — overtime likely. Consider splitting into two days."]
}

Every scene from the input list must appear in exactly ONE shootDay
sceneNumbers array OR in unscheduled. Use scene NUMBERS (the strings
like "12", "78A") not page numbers. Day numbers start at 1 and are
consecutive. If you need more days than the producer asked for to fit
everything legally, exceed the count and explain why in summary.`

// Robust JSON extractor. Claude sometimes wraps the JSON in markdown
// code fences, adds a preamble like "Here's the schedule:", or both.
// This finds the outermost balanced {...} block in the response. Returns
// null if no parsable JSON is found.
function extractAndParseJson(text: string): ScheduleProposal | null {
  // Strip markdown code fences if present.
  let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*$/gi, '').trim()
  // Try direct parse first.
  try { return JSON.parse(cleaned) as ScheduleProposal } catch {}
  // Find balanced { ... } block. Walks the string tracking brace depth,
  // ignoring braces inside strings. Returns the first complete top-level
  // object.
  let depth = 0
  let start = -1
  let inString = false
  let escape = false
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i]
    if (escape) { escape = false; continue }
    if (c === '\\') { escape = true; continue }
    if (c === '"' && !escape) { inString = !inString; continue }
    if (inString) continue
    if (c === '{') {
      if (depth === 0) start = i
      depth++
    } else if (c === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        try { return JSON.parse(cleaned.slice(start, i + 1)) as ScheduleProposal } catch {}
        start = -1
      }
    }
  }
  return null
}

function buildSceneCorpus(scenes: Array<{
  number: string
  slug: string
  intExt: string | null
  location: string | null
  timeOfDay: string | null
  pageEighths: number
  characters: string[]
  actionTextLen: number
}>): string {
  return scenes
    .map((s) => {
      const pages = (s.pageEighths / 8).toFixed(3)
      const cast = s.characters.length > 0 ? s.characters.join(', ') : '(none)'
      const tag = `${s.intExt ?? '?'} ${s.timeOfDay ?? '?'}`.trim()
      return `#${s.number} | ${tag} | ${s.location ?? '(no location)'} | ${pages}p | cast: ${cast} | "${s.slug.slice(0, 80)}"`
    })
    .join('\n')
}

export async function proposeSchedule(
  projectId: string,
  constraints: ScheduleConstraints,
): Promise<ScheduleProposal> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set')
  }
  const scenes = await pool.query<{
    number: string; slug: string; int_ext: string | null;
    location: string | null; time_of_day: string | null;
    page_eighths: number; characters: string[];
    action_text: string | null;
  }>(
    `SELECT number, slug, int_ext, location, time_of_day,
            page_eighths, characters, action_text
     FROM scenes WHERE project_id = $1 ORDER BY script_position`,
    [projectId],
  )
  if (scenes.rows.length === 0) {
    throw new Error('no_scenes')
  }

  const corpus = buildSceneCorpus(scenes.rows.map((s) => ({
    number: s.number,
    slug: s.slug,
    intExt: s.int_ext,
    location: s.location,
    timeOfDay: s.time_of_day,
    pageEighths: s.page_eighths,
    characters: s.characters ?? [],
    actionTextLen: (s.action_text ?? '').length,
  })))

  const totalEighths = scenes.rows.reduce((sum, s) => sum + s.page_eighths, 0)
  const totalPages = (totalEighths / 8).toFixed(1)

  const userBlock = [
    `PROJECT: ${scenes.rows.length} scenes, ${totalPages} pages total.`,
    `REQUESTED: ${constraints.shootDays} shoot days, max ${constraints.maxPagesPerDay} pages per day.`,
    constraints.notes ? `PRODUCER NOTES: ${constraints.notes}` : '',
    '',
    'SCENES (one per line, format: "#NUMBER | INT/EXT TIME | LOCATION | PAGES | cast: ... | slug"):',
    corpus,
  ].filter(Boolean).join('\n')

  let response
  try {
    response = await client.messages.create({
      // Default to Opus for scheduling — it's a complex constraint
      // problem and a one-shot operation. Sonnet fallback is available
      // via useOpus=false but Opus does noticeably better.
      model: constraints.useOpus === false ? SCHEDULER_MODEL_SONNET : SCHEDULER_MODEL_OPUS,
      // 16k tokens is generous enough for a feature-length script
      // (157 scenes × structure overhead well under this).
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userBlock }],
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logError('auto_scheduler: claude call failed', { projectId, error: msg })
    throw new Error(msg)
  }

  const textBlock = response.content.find((b) => b.type === 'text')
  const rawText = textBlock && textBlock.type === 'text' ? textBlock.text : ''
  const parsed = extractAndParseJson(rawText)
  if (!parsed) {
    logError('auto_scheduler: parse failed', {
      projectId,
      rawStart: rawText.slice(0, 300),
      rawEnd: rawText.slice(-300),
      length: rawText.length,
      stopReason: response.stop_reason,
      outputTokens: response.usage.output_tokens,
    })
    throw new Error(
      response.stop_reason === 'max_tokens'
        ? 'Claude response was cut off — script may have more scenes than the schedule output can fit. Try Opus or smaller chunks.'
        : 'Claude response was not valid JSON',
    )
  }

  logInfo('auto_scheduler: proposal generated', {
    projectId,
    shootDays: parsed.shootDays?.length ?? 0,
    unscheduled: parsed.unscheduled?.length ?? 0,
    warnings: parsed.warnings?.length ?? 0,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    model: constraints.useOpus ? 'opus' : 'sonnet',
  })

  return parsed
}

// Apply a previously-proposed schedule: snapshot the current state
// first (safety net), then rebuild shoot_days + scene assignments
// from the proposal. Returns the snapshot id so the UI can offer a
// quick "undo" via restore.
export async function applyProposedSchedule(
  projectId: string,
  proposal: ScheduleProposal,
  userId: string,
): Promise<{ snapshotId: string }> {
  // 1. Snapshot current state under an auto-generated name.
  const snapName = `Pre-auto-plan ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`

  const daysRes = await pool.query<{ number: number; is_break: boolean; shoot_date: string | null; notes: string | null }>(
    `SELECT number, is_break, shoot_date, notes FROM shoot_days WHERE project_id = $1 ORDER BY number`,
    [projectId],
  )
  const scenesRes = await pool.query<{
    number: string; shoot_day_number: number | null; day_position: number; location_status: string; notes: string | null;
  }>(
    `SELECT s.number, sd.number AS shoot_day_number, s.day_position, s.location_status, s.notes
     FROM scenes s LEFT JOIN shoot_days sd ON sd.id = s.shoot_day_id
     WHERE s.project_id = $1 ORDER BY s.script_position`,
    [projectId],
  )
  const snapPayload = {
    shootDays: daysRes.rows,
    scenes: scenesRes.rows.map((r) => ({
      number: r.number,
      shootDayNumber: r.shoot_day_number,
      dayPosition: r.day_position,
      locationStatus: r.location_status,
      notes: r.notes,
    })),
  }
  const snap = await pool.query<{ id: string }>(
    `INSERT INTO schedule_snapshots
       (project_id, name, description, created_by, scene_count, shoot_day_count, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      projectId, snapName, 'Auto-saved before Claude auto-plan was applied',
      userId, scenesRes.rows.length, daysRes.rows.length, JSON.stringify(snapPayload),
    ],
  )

  // 2. Rebuild shoot days + assignments from proposal.
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`DELETE FROM shoot_days WHERE project_id = $1`, [projectId])
    const dayIdByNumber = new Map<number, string>()
    for (const d of proposal.shootDays) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO shoot_days (project_id, number, is_break, notes)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [projectId, d.number, d.isBreak, d.notes || null],
      )
      dayIdByNumber.set(d.number, rows[0].id)
    }
    // Unassign every scene first, then assign per proposal.
    await client.query(
      `UPDATE scenes SET shoot_day_id = NULL, day_position = 0 WHERE project_id = $1`,
      [projectId],
    )
    for (const d of proposal.shootDays) {
      let pos = 0
      for (const sceneNumber of d.sceneNumbers) {
        pos += 10
        await client.query(
          `UPDATE scenes SET shoot_day_id = $2, day_position = $3
           WHERE project_id = $1 AND number = $4`,
          [projectId, dayIdByNumber.get(d.number) ?? null, pos, sceneNumber],
        )
      }
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  logInfo('auto_scheduler: applied', { projectId, snapshotId: snap.rows[0].id })
  return { snapshotId: snap.rows[0].id }
}

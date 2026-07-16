// Per-scene script breakdown.
//
// Given a scene's action_text (cached from the .fdx), ask Claude to list
// everything in the scene that might cost money — props, wardrobe, location
// notes, vehicles, weapons, animals, SFX, VFX, set dressing, special makeup,
// extras, day-player roles, picture cars, special equipment.
//
// We do NOT ask Claude to estimate costs or suggest a shooting order. Items
// land as zero-cost budget_line_items rows so the producer can attach
// numbers, add things Claude missed, and delete anything irrelevant.
//
// Items get tagged with a `code` like "PROPS", "WARDROBE", "LOCATION", etc.
// so the producer can filter the budget by category later. Every row is
// scene_id-attached; project-level costs (above-the-line talent, insurance)
// stay scene_id IS NULL.
import Anthropic from '@anthropic-ai/sdk'
import { pool } from './db'
import { logError, logInfo } from './diag'

const client = new Anthropic()

const MODEL = 'claude-sonnet-4-6'

// The "Production" account is where Claude's suggestions land. We look it
// up by category='production' on first item. If multiple production
// accounts exist (rare — projects usually keep the default), we pick
// "11-00 PRODUCTION STAFF" if present, else the first one.
type BreakdownItem = {
  category: 'PROPS' | 'WARDROBE' | 'LOCATION' | 'SET_DRESSING' | 'VEHICLES'
    | 'PICTURE_CARS' | 'WEAPONS' | 'ANIMALS' | 'SFX' | 'VFX' | 'MAKEUP'
    | 'HAIR' | 'STUNTS' | 'EQUIPMENT' | 'EXTRAS' | 'DAY_PLAYER'
    | 'PERMITS' | 'CATERING' | 'OTHER'
  description: string
  notes?: string
}

const SYSTEM_PROMPT = `You are a line producer doing a script breakdown.

You read a single scene from a film script and list every element that might
cost money to produce. You list — you do not price. The producer attaches
dollar amounts later. Cast a wide net: when in doubt, include it. The
producer will delete what they don't need.

DO NOT suggest a shooting order, a schedule, a shot list, or which scenes
to film together. Just enumerate cost items from THIS scene.

Two coverage modes depending on what's provided:

A) FULL — when action/dialogue text is included, scan every noun for
   prop / wardrobe / vehicle implications and listen for off-camera
   implications. Be exhaustive.

B) HEADING-ONLY — when only the scene heading, location, and character
   list are provided (no action text), do a conservative pass based on
   what's typical for that location + cast. Examples:
   - "INT. KENDRICK'S HOUSE - DAY" with characters [JASON, SAWYER]:
     suggest a location fee, basic set dressing, wardrobe per character,
     SAWYER as DAY_PLAYER if not a principal.
   - "EXT. POLICE STATION - NIGHT" with [JOHN, OFFICER MILLER, BACKGROUND COPS]:
     location, permits (exterior public), OFFICER MILLER as DAY_PLAYER,
     uniform wardrobe, police cars as PICTURE_CARS, BACKGROUND COPS as EXTRAS.
   In heading-only mode, do NOT invent specific hand props — you can't
   know what characters touch without action text.

For each item, return:
  - category : one of PROPS, WARDROBE, LOCATION, SET_DRESSING, VEHICLES,
    PICTURE_CARS, WEAPONS, ANIMALS, SFX, VFX, MAKEUP, HAIR, STUNTS,
    EQUIPMENT, EXTRAS, DAY_PLAYER, PERMITS, CATERING, OTHER
  - description : 2–6 word noun phrase the producer can scan ("vintage
    rotary phone", "police uniform, period correct", "diner location fee")
  - notes (optional, 1 sentence) : useful production detail mentioned in
    the script — e.g. "needs to be practical, character throws it"

Category guide:
  PROPS         : hand props characters touch. Two tiers — pick the
                  right one per item:
                    BUNDLE generic / routine items into a single row:
                      "dinner place settings for 8", "diner table
                      dressing", "schoolkid's backpack contents",
                      "ER nurse's tray of supplies". Don't itemize
                      every fork and spoon when the script just
                      establishes "a dinner."
                    ITEMIZE props that the action specifically calls
                      out, that drive a beat, that an actor handles,
                      or that have a unique cost:
                      "vintage rotary phone (Kendrick slams it)",
                      "$20 bill that changes hands", "the antique
                      pocket watch", "the kitchen knife (used as
                      weapon)", "loaded revolver, period correct".
                  Rule of thumb: would the prop master treat this as
                  one buy, or as a hero item to source individually?
  WARDROBE      : list ONE row per character per scene, in the form:
                  description = "CHARACTER NAME: outfit description"
                  e.g. "JANE: white sundress, no jewelry, sandals"
                  e.g. "OFFICER MILLER: police uniform, badge, sidearm
                        on belt"
                  If the script doesn't specify, infer something sensible
                  from the scene context (period, location, weather).
                  The producer will mark reused outfits as shared later.
  LOCATION      : the place itself (location fee, permit indicator).
                  One row per scene; the producer marks it shared across
                  scenes at the same location later.
  SET_DRESSING  : items that decorate the set but characters don't use
                  ("framed photos on mantle", "stack of old newspapers",
                  "blood pooling on floor")
  VEHICLES      : production vehicles, not in-shot cars
  PICTURE_CARS  : cars/trucks/bikes seen on camera (be specific:
                  "1967 Mustang fastback", "rusted pickup truck")
  WEAPONS       : firearms, knives, anything requiring an armorer
  ANIMALS       : any creature on set (requires wrangler)
  SFX           : practical effects — explosions, smoke, rain, fire,
                  blood squibs, breakaway furniture
  VFX           : anything requiring post — CG creature, screen
                  replacement, removed wires, plate shots
  MAKEUP        : specialty makeup (bruises, wounds, age, character look)
  HAIR          : wigs, period styles, anything beyond standard
  STUNTS        : any physical action requiring a stunt coordinator
  EQUIPMENT     : special grip/camera gear the scene implies (crane, drone,
                  underwater housing, steadicam)
  EXTRAS        : background performers (count if scripted, else estimate
                  e.g. "5–10 diner patrons")
  DAY_PLAYER    : named-but-small speaking roles ("WAITRESS",
                  "POLICE OFFICER #1")
  PERMITS       : street closures, exterior locations, public spaces
  CATERING      : only if scripted (banquet, feast scenes) — otherwise omit
  OTHER         : anything else with a clear cost

Be exhaustive — when in doubt, include it. The producer prefers to
DELETE items they don't need over discovering missing ones in week 3
of prep.

Coverage targets:
  - Scan EVERY noun in action lines for prop / wardrobe / vehicle implications.
  - Listen for off-camera implications: "the diner is empty" still means
    a location fee. "She fires the gun" means a weapon + armorer + likely
    blood SFX.
  - Capture named non-principal speaking parts as DAY_PLAYER.
  - Estimate extras counts when scripted ("a crowd of about 20 protestors").

In addition to the item list, write ONE producer note (1–2 sentences)
flagging anything notable about producing this scene — the kind of
thing a line producer would say out loud reading the script for the
first time. Examples:

  - "Biggest cost in your script: 20+ extras, exterior, day. Plan an
     entire shoot day around it."
  - "Stunt + armorer + SFX makeup all converge here — that's three
     extra department heads on this day."
  - "Permit-heavy: closing a street + practical rain. Allow lead time."
  - "Single-location scene with two characters. Cheap if you can lock
     this location for a half-day."

Only write a note when there's something genuinely worth flagging.
For ordinary dialogue scenes in a standard interior, return an empty
string for the note.

Return strict JSON only — no prose. Schema:
{
  "producerNote": "Biggest cost in your script: 20+ extras, exterior, day. Plan an entire shoot day around it.",
  "items": [
    { "category": "PROPS", "description": "vintage rotary phone", "notes": "Kendrick slams it down" },
    ...
  ]
}

If the scene has no cost items (e.g. a single character talking on a
generic phone call), return { "producerNote": "", "items": [] }.`

type BreakdownResponse = {
  itemsCreated: number
  itemsSuggested: number
  cost: { inputTokens: number; outputTokens: number }
}

async function ensureBreakdownAccount(budgetId: string): Promise<string> {
  // Prefer the dedicated "Script Breakdown" account so suggestions don't
  // pollute existing accounts and the producer can find them in one place.
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM budget_accounts WHERE budget_id = $1 AND code = '__breakdown__' LIMIT 1`,
    [budgetId],
  )
  if (existing.rows.length > 0) return existing.rows[0].id
  const posRes = await pool.query<{ next: number }>(
    `SELECT COALESCE(MAX(position), 0) + 10 AS next FROM budget_accounts WHERE budget_id = $1`,
    [budgetId],
  )
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO budget_accounts (budget_id, code, name, category, position)
     VALUES ($1, '__breakdown__', 'Script Breakdown (per-scene)', 'production', $2)
     RETURNING id`,
    [budgetId, posRes.rows[0].next],
  )
  return rows[0].id
}

async function ensureBudget(projectId: string, userId: string): Promise<string | null> {
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM budgets WHERE project_id = $1`,
    [projectId],
  )
  if (existing.rows.length > 0) return existing.rows[0].id
  // Auto-create a blank budget so the breakdown has somewhere to land.
  // Producers who never set up a budget still get value out of the upload.
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO budgets (project_id, currency, shoot_days, created_by)
     VALUES ($1, 'USD', 0, $2) RETURNING id`,
    [projectId, userId],
  )
  return rows[0].id
}

export async function runSceneBreakdown(sceneId: string, userId: string): Promise<BreakdownResponse> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set')
  }
  const sceneRes = await pool.query<{
    project_id: string; slug: string; action_text: string | null; number: string;
    int_ext: string | null; location: string | null; time_of_day: string | null;
    characters: string[];
  }>(
    `SELECT project_id, slug, action_text, number, int_ext, location, time_of_day, characters
     FROM scenes WHERE id = $1`,
    [sceneId],
  )
  if (sceneRes.rows.length === 0) throw new Error('scene_not_found')
  const sc = sceneRes.rows[0]
  const hasActionText = !!sc.action_text && sc.action_text.trim().length >= 30

  // Wipe previous breakdown rows for this scene so re-running gives a clean
  // result. Untouched auto-suggestions have the exact default shape
  // (days=1, x=1, cost=0); anything the producer priced or adjusted has a
  // different shape and is preserved.
  await pool.query(
    `DELETE FROM budget_line_items
     WHERE scene_id = $1 AND amt = 1 AND x = 1 AND rate = 0`,
    [sceneId],
  )

  const userBlock = [
    `SCENE ${sc.number}: ${sc.slug}`,
    sc.location ? `LOCATION: ${sc.location}` : '',
    sc.int_ext || sc.time_of_day ? `${sc.int_ext ?? ''} ${sc.time_of_day ?? ''}`.trim() : '',
    sc.characters && sc.characters.length > 0 ? `CHARACTERS: ${sc.characters.join(', ')}` : '',
    '',
    hasActionText ? 'ACTION / DIALOGUE:' : 'NOTE: No action text available — do a HEADING-ONLY pass.',
    hasActionText ? (sc.action_text as string) : '',
  ].filter(Boolean).join('\n')

  let response
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userBlock }],
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logError('scene_breakdown: claude call failed', { sceneId, error: msg })
    throw new Error(msg)
  }

  const textBlock = response.content.find((b) => b.type === 'text')
  const rawText = textBlock && textBlock.type === 'text' ? textBlock.text : ''
  let items: BreakdownItem[] = []
  let producerNote = ''
  try {
    const jsonStart = rawText.indexOf('{')
    const jsonEnd = rawText.lastIndexOf('}')
    if (jsonStart < 0 || jsonEnd < 0) throw new Error('no JSON in response')
    const parsed = JSON.parse(rawText.slice(jsonStart, jsonEnd + 1))
    if (Array.isArray(parsed.items)) items = parsed.items as BreakdownItem[]
    if (typeof parsed.producerNote === 'string') producerNote = parsed.producerNote.trim().slice(0, 500)
  } catch (err) {
    logError('scene_breakdown: failed to parse claude response', {
      sceneId,
      error: err instanceof Error ? err.message : String(err),
      raw: rawText.slice(0, 500),
    })
    throw new Error('Claude response was not valid JSON')
  }

  const budgetId = await ensureBudget(sc.project_id, userId)
  if (!budgetId) throw new Error('no_budget')
  const accountId = await ensureBreakdownAccount(budgetId)

  // Insert each item with amt=0 so the producer can attach the dollar
  // amount. Order them by category so PROPS rows sit next to PROPS rows.
  let position = 0
  const itemsCreated = items.length
  for (const it of items) {
    position += 10
    const description = String(it.description ?? '').slice(0, 200).trim()
    if (!description) continue
    await pool.query(
      `INSERT INTO budget_line_items
        (account_id, scene_id, code, description, amt, x, rate, units, notes, position, created_by)
       VALUES ($1, $2, $3, $4, 1, 1, 0, NULL, $5, $6, $7)`,
      [
        accountId,
        sceneId,
        String(it.category ?? 'OTHER').slice(0, 40),
        description,
        it.notes ? String(it.notes).slice(0, 500) : null,
        position,
        userId,
      ],
    )
  }

  await pool.query(
    `UPDATE scenes
       SET breakdown_run_at = now(),
           producer_note_suggestion = $2
     WHERE id = $1`,
    [sceneId, producerNote || null],
  )

  logInfo('scene_breakdown: complete', {
    sceneId,
    projectId: sc.project_id,
    items: itemsCreated,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  })

  return {
    itemsCreated,
    itemsSuggested: items.length,
    cost: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  }
}

// On server boot, find every project with scenes that still need
// breakdown (action_text present but breakdown_run_at IS NULL) and
// kick off a background run for each. Lets a Railway redeploy resume
// in-flight breakdowns automatically — the producer doesn't have to
// click "Re-analyze all" after every deploy. Limited to projects
// touched in the last 7 days so we don't blast credits on old archived
// projects.
export async function resumeIncompleteBreakdowns(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) return
  try {
    const { rows } = await pool.query<{ project_id: string; pending: string; admin_id: string | null }>(
      `SELECT
         s.project_id,
         COUNT(*) FILTER (WHERE s.breakdown_run_at IS NULL AND s.action_text IS NOT NULL AND length(s.action_text) >= 30)::text AS pending,
         (SELECT u.id FROM users u WHERE u.role = 'admin' ORDER BY u.created_at ASC LIMIT 1) AS admin_id
       FROM scenes s
       JOIN projects p ON p.id = s.project_id
       WHERE EXISTS (
         SELECT 1 FROM project_script_uploads u
         WHERE u.project_id = s.project_id
           AND u.uploaded_at > now() - interval '7 days'
       )
       GROUP BY s.project_id
       HAVING COUNT(*) FILTER (WHERE s.breakdown_run_at IS NULL AND s.action_text IS NOT NULL AND length(s.action_text) >= 30) > 0`,
    )
    if (rows.length === 0) return
    logInfo('scene_breakdown: resuming incomplete breakdowns', {
      projects: rows.length,
      totalPending: rows.reduce((s, r) => s + Number(r.pending), 0),
    })
    for (const row of rows) {
      if (!row.admin_id) continue
      // Fire-and-forget per project. They run serially within each
      // project; multiple projects run in parallel.
      void runProjectBreakdown(row.project_id, row.admin_id)
        .then(() => {
          // Re-publish to status branch with the final breakdown.
          // Late import to avoid a circular dep at module load.
          import('./script_publisher').then(({ publishProjectScript }) => {
            void publishProjectScript(row.project_id)
          })
        })
        .catch((err) => {
          logError('scene_breakdown: resume failed for project', {
            projectId: row.project_id,
            error: err instanceof Error ? err.message : String(err),
          })
        })
    }
  } catch (err) {
    logError('scene_breakdown: resumeIncompleteBreakdowns crashed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
// default skips scenes already broken down (breakdown_run_at IS NOT NULL).
// Pass force=true to re-analyze every scene — useful when the producer
// wants a fresh pass without re-importing the .fdx. Serial — we don't
// want to slam Anthropic with 100 parallel requests on a feature-length
// script. Per-scene calls are cheap (Sonnet, ~$0.005 each) so a 90-scene
// script totals ~$0.50.
export async function runProjectBreakdown(
  projectId: string,
  userId: string,
  opts: { force?: boolean } = {},
): Promise<{ scenes: number; created: number }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    logError('scene_breakdown: no API key, skipping project breakdown', { projectId })
    return { scenes: 0, created: 0 }
  }
  // Include scenes WITHOUT action_text — Claude does a heading-only pass
  // for them based on location + characters. Less detail than the full
  // pass, but still surfaces location, day players, extras, wardrobe.
  const where = opts.force
    ? `project_id = $1`
    : `project_id = $1 AND breakdown_run_at IS NULL`
  const scenes = await pool.query<{ id: string }>(
    `SELECT id FROM scenes WHERE ${where} ORDER BY script_position ASC`,
    [projectId],
  )
  let totalCreated = 0
  for (const row of scenes.rows) {
    try {
      const r = await runSceneBreakdown(row.id, userId)
      totalCreated += r.itemsCreated
    } catch (err) {
      logError('scene_breakdown: scene failed during project run', {
        projectId,
        sceneId: row.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  logInfo('scene_breakdown: project complete', { projectId, scenes: scenes.rows.length, created: totalCreated, force: !!opts.force })
  return { scenes: scenes.rows.length, created: totalCreated }
}

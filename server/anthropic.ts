// AI social-plan generator using Claude.
//
// One call → one full daily plan: 5 text posts + 4 story texts + 3 reel
// concepts + 3 photo concepts, in the show's brand voice, drawn from the
// episode transcript.
//
// Prompt-cache layout (per `shared/prompt-caching.md`):
//   - system prompt (stable across all shows)         → no cache_control
//   - first user block: SHOW metadata + voice + examples (stable per show)
//                                                     → cache_control here
//   - second user block: today's date + transcript    → no cache (varies)
//
// The cache_control sits on the last block of the cached prefix, so the
// system prompt + show metadata cache together. Repeat generations for
// the same show only re-process the transcript portion.
//
// Output: JSON enforced via output_config.format = json_schema. Schema is
// strict (additionalProperties: false, every property required) so the
// model can't return weird shapes we have to defend against.
import Anthropic from '@anthropic-ai/sdk'
import { logError, logInfo } from './diag'

const client = new Anthropic()

export function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

const MODEL = 'claude-opus-4-8'

const SYSTEM_PROMPT = `You are a senior social-media producer for podcasts.

Given an episode transcript, you produce a single day's social content plan
the team can act on immediately.

If the user block includes a "=== SHOW STRATEGY ===" section, that is the
authoritative brief for this show — every post you generate must serve one
of the listed content pillars, land on the audience's actual desires or
frustrations, and match the tone. When you can, tag which pillar each text
post is executing (in-line, not as metadata). Prefer messaging angles that
appear in the strategy over ones you invent. If the strategy names offers
under monetization, the small handful of "buy"-goal posts should tee those
up naturally, not sell hard.

The plan has the following structure and counts:

  - 10 text_posts  : ready-to-publish Instagram captions. These are
                     OPTIONS — the producer will pick a few. Use what
                     actually works on IG for podcast promo:
                     * A scroll-stopping hook in the FIRST LINE (before
                       the "…more" cut at ~125 chars). Lead with the
                       most provocative quote, the most surprising
                       claim, the question that makes someone tap.
                     * Mix lengths across the 10: include 3–4 short
                       punchy single-line posts, 4–5 medium captions
                       (2–4 short paragraphs) that tell a mini-story or
                       tee up the episode, and 1–2 longer narrative
                       captions for the moments that deserve room.
                     * Use line breaks generously for readability —
                       short paragraphs land better than walls of text.
                     * Emojis: sparingly and intentionally, never as
                       decoration. None is also fine.
                     * Hashtags: only if the show's examples use them.
                       Otherwise omit — IG's algorithm doesn't reward
                       them like it used to.
                     * Vary the angle across posts: hot take, vulnerable
                       moment, surprising stat/fact, juicy quote,
                       behind-the-scenes, "wait, what?", direct invite,
                       teaser, contrast, controversy.
                     * Close with intent: a question, a "listen now",
                       a "tap the link", or trust the hook and just stop.
                     * Don't repeat yourself across the 10. Each post is
                       a different reason someone would tap.
  - 4 story_concepts : each is { medium, description, caption,
                                 suggested_clip?, image_direction? }.
                       medium is "video" or "photo". For "video", include
                       suggested_clip (which exchange/moment from the
                       transcript) and skip image_direction. For "photo",
                       include image_direction (what the photo shows) and
                       skip suggested_clip. caption is the on-story overlay
                       text — keep it short, <100 chars. Aim for a mix:
                       at least 1 video and at least 1 photo across the 4.
  - 3 reel_concepts : each is { hook, talking_points (3-5 bullets),
                                suggested_clip }. Suggested_clip references
                                an actual moment from the transcript.
  - 3 photo_concepts: each is { image_direction, caption, vibe }.
                       Slate auto-extracts 5 still frames from the
                       episode video at the timecode you provide, so
                       EVERY photo_concept must reference a real
                       moment from the transcript. image_direction
                       must START with a "[HH:MM:SS] " timecode that
                       points to where in the recording the desired
                       shot composition exists in-frame, followed by
                       a one-sentence description of what we want to
                       see at that beat. Examples:
                         "[00:08:14] Guest reacting to the dad
                          question — eyes wide, hand on chest."
                         "[00:24:02] Host + guest leaning in mid-
                          laugh during the lobster bit."
                         "[00:37:50] Wide behind-the-glass while the
                          guest is mid-anecdote, producer visible at
                          the board."
                         "[00:51:31] Guest portrait — 3/4 angle,
                          looking up thoughtfully."
                       Pick variety across the 3 — mix portrait,
                       host+guest two-shot, and BTS-style wides if
                       the recording supports it.
                       NEVER a typographic graphic, NEVER text on a
                       colored background, NEVER a poll sticker, NEVER
                       a Canva-style template — those are design
                       assets, not photos.
                       caption is the IG caption text.
                       vibe is a 2-4 word mood.

For story_concepts with medium='photo': same rule — image_direction
must START with a [HH:MM:SS] timecode pointing to a moment in the
recording, followed by the shot description. Slate will pull frames
from that timecode.

Voice:
  - Match the show's brand voice exactly. The provided EXAMPLES are
    authoritative — copy their tone, vocabulary, sentence length, and
    formatting. Do not introduce a different voice.
  - If no examples are provided, default to clean, conversational,
    on-brand-for-the-show-name.

For every concept (story / reel / photo): be specific. Reference real
names, real quotes, real moments from the transcript. Avoid generic ideas
("clip a funny moment").

TIMECODES: every transcript block is prefixed with [HH:MM:SS] showing
when in the recording it occurs. Every suggested_clip field MUST begin
with the timecode range of the moment it references, in the format
"[HH:MM:SS – HH:MM:SS] " followed by the description. Use the actual
timecodes from the transcript. Example:
  "[00:14:23 – 00:15:02] Sherri's bit about the Kool-Aid vase and
   the 'I trust your visit with Adele was pleasant' line."

This lets the editor jump straight to the moment and gives the ffmpeg
clip cutter an exact cut directive.

Output: ONLY valid JSON matching the supplied schema. No preamble. No
explanation. No markdown fences.`

const SCHEMA = {
  type: 'object',
  properties: {
    text_posts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
    },
    story_concepts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          medium: { type: 'string', enum: ['video', 'photo'] },
          description: { type: 'string' },
          caption: { type: 'string' },
          suggested_clip: { type: 'string' },
          image_direction: { type: 'string' },
        },
        required: ['medium', 'description', 'caption', 'suggested_clip', 'image_direction'],
        additionalProperties: false,
      },
    },
    reel_concepts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          hook: { type: 'string' },
          talking_points: { type: 'array', items: { type: 'string' } },
          suggested_clip: { type: 'string' },
        },
        required: ['hook', 'talking_points', 'suggested_clip'],
        additionalProperties: false,
      },
    },
    photo_concepts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          image_direction: { type: 'string' },
          caption: { type: 'string' },
          vibe: { type: 'string' },
        },
        required: ['image_direction', 'caption', 'vibe'],
        additionalProperties: false,
      },
    },
  },
  required: ['text_posts', 'story_concepts', 'reel_concepts', 'photo_concepts'],
  additionalProperties: false,
}

export type RawSocialPlan = {
  text_posts: Array<{ text: string }>
  story_concepts: Array<{
    medium: 'video' | 'photo'
    description: string
    caption: string
    suggested_clip: string
    image_direction: string
  }>
  reel_concepts: Array<{ hook: string; talking_points: string[]; suggested_clip: string }>
  photo_concepts: Array<{ image_direction: string; caption: string; vibe: string }>
}

// Compact prompt block summarizing the show's strategy documents so
// downstream generators (daily plan, carousel, etc.) can align their
// output with the strategy instead of just riffing off the transcript.
// Each doc is condensed to the fields the generator actually needs —
// full JSON blowout would blow past the cache-friendly prefix budget.
export type StrategyDocsInput = Partial<Record<
  'strategy' | 'audience' | 'authority' | 'pillars' | 'monetization' | 'winners',
  Record<string, unknown> | null
>>

// Trim any single value to a bounded char count so a runaway
// long-form answer can't inflate the prompt beyond the cache-friendly
// prefix. Ellipsis added when we cut.
function truncate(s: unknown, max: number): string {
  const str = typeof s === 'string' ? s : String(s ?? '')
  return str.length <= max ? str : str.slice(0, max).trimEnd() + '…'
}

export function strategyDocsBlock(docs?: StrategyDocsInput): string {
  if (!docs) return ''
  const parts: string[] = []
  const s = docs.strategy as Record<string, unknown> | undefined
  if (s) {
    const bp = (s.brand_positioning ?? {}) as Record<string, unknown>
    const cd = (s.content_direction ?? {}) as Record<string, unknown>
    parts.push('STRATEGY DOC:')
    if (bp.one_sentence) parts.push(`  Brand position: ${truncate(bp.one_sentence, 240)}`)
    if (Array.isArray(bp.differentiators)) parts.push(`  Differentiators: ${bp.differentiators.slice(0, 4).map((x) => truncate(x, 120)).join(' · ')}`)
    if (cd.tone) parts.push(`  Tone: ${truncate(cd.tone, 200)}`)
    if (Array.isArray(cd.themes)) parts.push(`  Themes: ${cd.themes.slice(0, 6).map((x) => truncate(x, 80)).join(' · ')}`)
    if (s.growth_north_star) parts.push(`  North star: ${truncate(s.growth_north_star, 200)}`)
  }
  const a = docs.audience as Record<string, unknown> | undefined
  if (a) {
    parts.push('AUDIENCE:')
    if (a.persona_snapshot) parts.push(`  Persona: ${truncate(a.persona_snapshot, 320)}`)
    if (Array.isArray(a.frustrations)) parts.push(`  Frustrations: ${a.frustrations.slice(0, 4).map((x) => truncate(x, 100)).join(' · ')}`)
    if (Array.isArray(a.desires)) parts.push(`  Desires: ${a.desires.slice(0, 4).map((x) => truncate(x, 100)).join(' · ')}`)
    const angles = Array.isArray(a.messaging_angles) ? a.messaging_angles as Array<Record<string, unknown>> : []
    if (angles.length > 0) {
      parts.push('  Messaging angles:')
      for (const ang of angles.slice(0, 6)) parts.push(`    · ${truncate(ang.angle, 140)}`)
    }
  }
  const au = docs.authority as Record<string, unknown> | undefined
  if (au) {
    parts.push('AUTHORITY POSITIONING:')
    if (au.positioning_statement) parts.push(`  Positioning: ${truncate(au.positioning_statement, 240)}`)
    if (Array.isArray(au.signature_content_moves)) {
      parts.push(`  Signature moves: ${au.signature_content_moves.slice(0, 4).map((x) => truncate(x, 120)).join(' · ')}`)
    }
  }
  const p = docs.pillars as Record<string, unknown> | undefined
  if (p) {
    const pillars = Array.isArray(p.pillars) ? p.pillars as Array<Record<string, unknown>> : []
    if (pillars.length > 0) {
      parts.push('CONTENT PILLARS (posts should map to one of these):')
      for (const pl of pillars.slice(0, 6)) {
        parts.push(`  · ${truncate(pl.name, 60)} — ${truncate(pl.purpose ?? '', 160)}`)
      }
    }
  }
  const w = docs.winners as Record<string, unknown> | undefined
  if (w) {
    parts.push('PROVEN PATTERNS (mined from this show\'s actual past posts — follow them):')
    if (w.repeatable_formula) parts.push(`  Formula: ${truncate(w.repeatable_formula, 300)}`)
    if (Array.isArray(w.winning_patterns)) parts.push(`  What works: ${w.winning_patterns.slice(0, 4).map((x) => truncate(x, 120)).join(' · ')}`)
    if (Array.isArray(w.losing_patterns)) parts.push(`  Avoid: ${w.losing_patterns.slice(0, 4).map((x) => truncate(x, 120)).join(' · ')}`)
  }
  const m = docs.monetization as Record<string, unknown> | undefined
  if (m) {
    const offers = Array.isArray(m.offer_ideas) ? m.offer_ideas as Array<Record<string, unknown>> : []
    if (offers.length > 0) {
      parts.push('MONETIZATION OFFERS (referenceable in "buy"-stage content):')
      for (const o of offers.slice(0, 4)) parts.push(`  · ${truncate(o.name, 80)}: ${truncate(o.description ?? '', 160)}`)
    }
  }
  if (parts.length === 0) return ''
  const block = [
    '',
    '=== SHOW STRATEGY (align every choice below to this) ===',
    ...parts,
    '=== END STRATEGY ===',
    '',
  ].join('\n')
  // Final safety net: if per-field truncation still leaves us above
  // 6KB total, cut the block. Cache-friendly prefix budgets are
  // model-dependent; 6KB is well under Anthropic's ephemeral limit.
  const HARD_CAP = 6000
  return block.length > HARD_CAP ? block.slice(0, HARD_CAP).trimEnd() + '\n… (truncated)\n=== END STRATEGY ===\n' : block
}

export type GenerateInput = {
  showName: string
  showSubtitle?: string | null
  brandVoice: string
  examplePosts: string[]
  // Optional strategy docs — when present, the generator references the
  // show's brand positioning, audience, pillars, and monetization plan
  // so posts align with the strategy instead of drifting.
  strategyDocs?: StrategyDocsInput
  // Per-show "must spell these correctly" list. Free-form text; the
  // team types one name/term per line (e.g. "Cheri Oteri" not "Sherri
  // O'Teri") so phonetic transcripts can't corrupt the spelling of
  // recurring guests, show titles, brand terms, etc.
  vocabulary?: string
  // Pre-existing brand assets the team has curated in Dropbox (guest
  // headshots, logos, BTS photos, etc.). Each entry has a filename
  // and the Dropbox path. When this list is non-empty, the prompt
  // tells Claude to reference these files by name in image_direction
  // instead of describing photos that would need to be shot fresh.
  brandAssets?: Array<{ name: string; dropboxPath: string }>
  episodeTitle: string
  episodeSubtitle?: string | null
  episodeTranscript: string
  date: string
}

export type GenerateResult = {
  plan: RawSocialPlan
  usage: {
    inputTokens: number
    outputTokens: number
    cacheCreationInputTokens: number
    cacheReadInputTokens: number
  }
}

// ─────────────────────────────────────────────────────────────────────
// Autopilot daily generator — transcript-less.
// ─────────────────────────────────────────────────────────────────────
//
// The per-episode generator above needs a finished transcript; the
// autopilot runs every morning whether or not an episode dropped, so it
// writes from the show's strategy docs (especially the 30-day calendar
// slot for today), brand voice, example posts, and recent episode
// titles instead. Output reuses RawSocialPlan/SCHEMA so the items flow
// through the exact same plan → scheduler → QA pipeline as everything
// else. It's a smaller batch than the episode plan: this is a daily
// drumbeat for the QA queue, not an episode launch package.

const AUTOPILOT_SYSTEM_PROMPT = `You are the daily social-media writer for a podcast network.
Every morning you produce that day's draft content for one show. A human QA
reviewer edits and approves everything before it goes live — write finished,
postable content, not outlines.

Produce EXACTLY this batch:
  - text_posts: 2 (complete, ready-to-paste captions in the show's voice)
  - photo_concepts: 1
  - reel_concepts: 1
  - story_concepts: 1

If the user block includes a "=== SHOW STRATEGY ===" section, it is the
authoritative brief: serve the listed pillars, land on the audience's actual
desires and frustrations, match the tone, and follow the PROVEN PATTERNS
formula when present.

If the user block includes a "TODAY'S CALENDAR SLOT" section, today's content
executes that slot: use its idea and hook as the starting point (you may
sharpen the wording), respect its post type and goal, and keep its CTA intent.
When there is no calendar slot, pick the strongest angle from the strategy and
recent episodes yourself, and vary it from the previous days' themes listed
under RECENT AUTOPILOT THEMES so consecutive days never repeat.

You have NO transcript today, so:
  - NEVER invent timecodes, quotes, or moments that would need a recording.
    No [HH:MM:SS] prefixes anywhere.
  - suggested_clip fields name a real recent episode (from RECENT EPISODES)
    plus what kind of moment the editor should look for in it, e.g.
    "From 'Episode Title' — find the exchange where the guest explains X".
  - image_direction describes either a reusable brand asset by exact filename
    (when AVAILABLE BRAND ASSETS lists one that fits) or a simple shot the
    team can produce without a recording (cover art treatment, host photo,
    text-forward layout is allowed ONLY for text-quote graphics).

Voice: the EXAMPLE POSTS are authoritative — copy their tone, vocabulary,
sentence length, and formatting. Write like a person, not a brand. Respect
the SPELLING REQUIREMENTS list exactly.

Output: ONLY valid JSON matching the supplied schema. No preamble.`

export type AutopilotGenerateInput = {
  showName: string
  showSubtitle?: string | null
  brandVoice: string
  examplePosts: string[]
  vocabulary?: string
  strategyDocs?: StrategyDocsInput
  brandAssets?: Array<{ name: string; dropboxPath: string }>
  recentEpisodes: Array<{ title: string; subtitle?: string | null }>
  // Today's entry from the 30-day calendar strategy doc, if the show
  // has one. Passed through verbatim-ish so the day executes the plan.
  calendarSlot?: {
    day: number
    idea?: string
    hook?: string
    format?: string
    core_message?: string
    cta?: string
    post_type?: string
    goal?: string
    pillar?: string
  } | null
  // Ideas from the last few autopilot days, so consecutive days vary.
  recentThemes: string[]
  date: string
}

export async function generateAutopilotPlan(input: AutopilotGenerateInput): Promise<GenerateResult> {
  logInfo('autopilot: generating daily plan', {
    showName: input.showName,
    date: input.date,
    hasCalendarSlot: Boolean(input.calendarSlot),
  })
  const showBlock = showMetadataBlock({
    showName: input.showName,
    showSubtitle: input.showSubtitle,
    brandVoice: input.brandVoice,
    examplePosts: input.examplePosts,
    vocabulary: input.vocabulary,
    strategyDocs: input.strategyDocs,
    brandAssets: input.brandAssets,
    // Unused by showMetadataBlock but required by GenerateInput.
    episodeTitle: '', episodeTranscript: '', date: input.date,
  })
  const dayLines: string[] = [`DATE: ${input.date}`]
  if (input.calendarSlot) {
    const c = input.calendarSlot
    dayLines.push('', `TODAY'S CALENDAR SLOT (day ${c.day} of the 30-day plan — execute this):`)
    if (c.idea) dayLines.push(`  Idea: ${c.idea}`)
    if (c.hook) dayLines.push(`  Hook: ${c.hook}`)
    if (c.core_message) dayLines.push(`  Key message: ${c.core_message}`)
    if (c.cta) dayLines.push(`  CTA: ${c.cta}`)
    if (c.format) dayLines.push(`  Format: ${c.format}`)
    if (c.post_type) dayLines.push(`  Post type: ${c.post_type}`)
    if (c.goal) dayLines.push(`  Goal: ${c.goal}`)
    if (c.pillar) dayLines.push(`  Pillar: ${c.pillar}`)
  }
  if (input.recentEpisodes.length > 0) {
    dayLines.push('', 'RECENT EPISODES (real — reference these, never invent episodes):')
    for (const e of input.recentEpisodes.slice(0, 8)) {
      dayLines.push(`  - ${e.title}${e.subtitle ? ` — ${e.subtitle}` : ''}`)
    }
  }
  if (input.recentThemes.length > 0) {
    dayLines.push('', 'RECENT AUTOPILOT THEMES (do not repeat these):')
    for (const t of input.recentThemes.slice(0, 10)) dayLines.push(`  - ${t}`)
  }
  dayLines.push('', "Generate today's draft batch now.")

  let response
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: AUTOPILOT_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: showBlock, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: dayLines.join('\n') },
          ],
        },
      ],
      output_config: {
        format: { type: 'json_schema', schema: SCHEMA },
      },
    })
  } catch (err) {
    logError('autopilot: claude call failed', {
      showName: input.showName,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('autopilot: claude returned no text block')
  }
  let plan: RawSocialPlan
  try {
    plan = JSON.parse(textBlock.text) as RawSocialPlan
  } catch (err) {
    logError('autopilot: invalid JSON from claude', { body: textBlock.text.slice(0, 500) })
    throw new Error(`autopilot: invalid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  return {
    plan,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
    },
  }
}

function showMetadataBlock(input: GenerateInput): string {
  const lines: string[] = []
  lines.push(`SHOW: ${input.showName}`)
  if (input.showSubtitle) lines.push(`SHOW DESCRIPTION: ${input.showSubtitle}`)
  const strategy = strategyDocsBlock(input.strategyDocs)
  if (strategy) lines.push(strategy)
  lines.push('')
  lines.push('BRAND VOICE:')
  lines.push(input.brandVoice.trim() || '(none specified — infer from show name and examples)')
  lines.push('')
  if (input.examplePosts.length > 0) {
    lines.push('EXAMPLE POSTS (match this style — these are real published posts from this show):')
    for (const e of input.examplePosts) {
      lines.push(`  - ${e.trim()}`)
    }
  } else {
    lines.push('EXAMPLE POSTS: (none provided)')
  }
  const vocab = (input.vocabulary ?? '').trim()
  if (vocab) {
    lines.push('')
    lines.push('SPELLING REQUIREMENTS — these names and terms must appear EXACTLY as written below in every post, regardless of how the transcript spells them (transcripts are phonetic and often wrong on proper names):')
    lines.push(vocab)
  }
  const assets = input.brandAssets ?? []
  if (assets.length > 0) {
    lines.push('')
    lines.push('AVAILABLE BRAND ASSETS — pre-existing photos / logos the team has on file in Dropbox. When a photo_concept or story_concept (photo medium) calls for an image that one of these already covers, reference the EXACT FILENAME in image_direction (e.g. "Use cheri-headshot-warm.jpg, cropped to a tight 4:5"). Only invent a brand-new shot direction if none of these files fit:')
    for (const a of assets.slice(0, 60)) {
      lines.push(`  - ${a.name}`)
    }
  }
  return lines.join('\n')
}

function episodeBlock(input: GenerateInput): string {
  return [
    `DATE: ${input.date}`,
    '',
    `EPISODE TITLE: ${input.episodeTitle}`,
    input.episodeSubtitle ? `EPISODE SUBTITLE: ${input.episodeSubtitle}` : '',
    '',
    'TRANSCRIPT:',
    input.episodeTranscript,
    '',
    'Generate the daily social plan now.',
  ].filter(Boolean).join('\n')
}

export async function generateSocialPlan(input: GenerateInput): Promise<GenerateResult> {
  logInfo('socials: generating plan', {
    showName: input.showName,
    episodeTitle: input.episodeTitle,
    transcriptChars: input.episodeTranscript.length,
  })
  let response
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: showMetadataBlock(input),
              cache_control: { type: 'ephemeral' },
            },
            {
              type: 'text',
              text: episodeBlock(input),
            },
          ],
        },
      ],
      output_config: {
        format: {
          type: 'json_schema',
          schema: SCHEMA,
        },
      },
    })
  } catch (err) {
    logError('socials: claude call failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('socials: claude returned no text block')
  }

  let plan: RawSocialPlan
  try {
    plan = JSON.parse(textBlock.text) as RawSocialPlan
  } catch (err) {
    logError('socials: invalid JSON from claude', { body: textBlock.text.slice(0, 500) })
    throw new Error(`socials: invalid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }

  logInfo('socials: plan generated', {
    textPosts: plan.text_posts.length,
    storyConcepts: plan.story_concepts.length,
    reelConcepts: plan.reel_concepts.length,
    photoConcepts: plan.photo_concepts.length,
    cacheRead: response.usage.cache_read_input_tokens ?? 0,
    cacheCreate: response.usage.cache_creation_input_tokens ?? 0,
  })

  return {
    plan,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
    },
  }
}

// =============================================================
// Brand profile generator — "Slate's read on this show"
// =============================================================
//
// One call → an opinionated take on how the team should be running this
// show's socials. Suggests brand voice, example post styles, posting
// times, weekly cadence, and default assignees. The team adopts the
// pieces they like via per-field Accept buttons; the rest stays as
// suggestion-only.

export type BrandProfileInput = {
  showName: string
  showSubtitle: string | null
  kind: 'podcast' | 'album' | 'film'
  // From the RSS feed — show-level metadata only. Past episode titles
  // from RSS are NOT passed; Slate is forward-looking and judgments
  // should be anchored to the upcoming work, not the back catalog.
  showDescription: string | null
  // Episodes currently being worked on inside Slate (the real project
  // management surface). Sorted with upcoming first.
  upcomingEpisodes: Array<{ title: string; subtitle: string | null; stage: string; releaseDate: string | null }>
  // Up to ~6000 chars total — recent in-progress episode transcript
  // snippets for voice/tone signal.
  transcriptSamples: string
  // The pool of users the team can pick assignees from
  availableUsers: Array<{ id: string; name: string }>
}

export type BrandProfile = {
  brandVoice: string
  examplePosts: string[]
  postingTimes: {
    text: string[]
    photo: string[]
    reel: string[]
    story: string[]
  }
  weeklyCadence: {
    text: number
    photo: number
    reel: number
    story: number
  }
  defaultAssignees: {
    story_video: string | null
    story_photo: string | null
    reel_concept: string | null
    photo_concept: string | null
  }
  reasoning: string
}

export type BrandProfileResult = {
  profile: BrandProfile
  usage: GenerateResult['usage']
}

const BRAND_PROFILE_SYSTEM = `You are a senior social-media strategist for podcasts and shows.

Given a show's metadata, cover art (described implicitly), and a few
transcript samples, you produce an opinionated brand profile the team
can adopt or tweak.

The team's posting strategy: each week promotes the most recent
episode — not the back catalog. Your suggestions should reflect that
"this week = this week's episode" rhythm.

You output strict JSON. No prose outside the JSON.`

const BRAND_PROFILE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'brand_voice', 'example_posts', 'posting_times',
    'weekly_cadence', 'default_assignees', 'reasoning',
  ],
  properties: {
    brand_voice: {
      type: 'string',
      description: '2–3 sentence description of the show\'s voice for social posts. Concrete adjectives, not generic.',
    },
    example_posts: {
      type: 'array',
      items: { type: 'string' },
      description: 'Return exactly 5 example IG-style text posts in the show\'s voice promoting this week\'s episode generically. Each 1–3 short sentences. No hashtags.',
    },
    posting_times: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'photo', 'reel', 'story'],
      properties: {
        text:  { type: 'array', items: { type: 'string' } },
        photo: { type: 'array', items: { type: 'string' } },
        reel:  { type: 'array', items: { type: 'string' } },
        story: { type: 'array', items: { type: 'string' } },
      },
      description: 'Best Pacific-time slots per kind for this show. Each entry must be 24h HH:MM (e.g. "08:00", "20:30").',
    },
    weekly_cadence: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'photo', 'reel', 'story'],
      properties: {
        text:  { type: 'integer' },
        photo: { type: 'integer' },
        reel:  { type: 'integer' },
        story: { type: 'integer' },
      },
      description: 'How many of each kind to post per week for this show. Realistic given one episode/week — each value should be 0–50.',
    },
    default_assignees: {
      type: 'object',
      additionalProperties: false,
      required: ['story_video', 'story_photo', 'reel_concept', 'photo_concept'],
      properties: {
        story_video:   { type: ['string', 'null'], description: 'user_id from available_users or null' },
        story_photo:   { type: ['string', 'null'] },
        reel_concept:  { type: ['string', 'null'] },
        photo_concept: { type: ['string', 'null'] },
      },
    },
    reasoning: {
      type: 'string',
      description: 'Brief 2–4 sentence explanation of the choices, especially the posting times and cadence.',
    },
  },
} as const

export async function generateBrandProfile(input: BrandProfileInput): Promise<BrandProfileResult> {
  logInfo('brand profile: generating', {
    showName: input.showName,
    upcomingCount: input.upcomingEpisodes.length,
    transcriptChars: input.transcriptSamples.length,
  })
  const usersBlock = input.availableUsers.length === 0
    ? '(no users in the workspace)'
    : input.availableUsers.map((u) => `- ${u.id}  ${u.name}`).join('\n')
  const upcomingBlock = input.upcomingEpisodes.length === 0
    ? '(no upcoming episodes in Slate yet)'
    : input.upcomingEpisodes
        .slice(0, 8)
        .map((e, i) => `${i + 1}. ${e.title}${e.subtitle ? ` — ${e.subtitle}` : ''}\n   stage: ${e.stage}${e.releaseDate ? ` · releases ${e.releaseDate}` : ' · no release date set'}`)
        .join('\n')
  const userText = `SHOW
Name: ${input.showName}
${input.showSubtitle ? `Subtitle: ${input.showSubtitle}\n` : ''}Kind: ${input.kind}

SHOW DESCRIPTION
${input.showDescription || '(none provided)'}

UPCOMING + IN-PROGRESS EPISODES (Slate is forward-looking — these are
the episodes the team is actually shipping, sorted with soonest first.
Do NOT reference back-catalog episodes; they are not in scope.)
${upcomingBlock}

TRANSCRIPT SAMPLES (for voice signal — may be partial, from recent
in-progress episodes)
${input.transcriptSamples.slice(0, 6000) || '(no transcripts available)'}

AVAILABLE TEAM MEMBERS (id  name)
${usersBlock}

Return your brand profile as JSON matching the schema. Requirements:
- Provide exactly 5 example posts.
- posting_times values: each string is 24h "HH:MM" Pacific time (e.g. "08:00", "20:30").
- weekly_cadence values: integers between 0 and 50.
- For default_assignees, use user_ids from the AVAILABLE TEAM MEMBERS list
  above, or null if you have no basis to pick one.`

  let response
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: BRAND_PROFILE_SYSTEM,
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
      output_config: { format: { type: 'json_schema', schema: BRAND_PROFILE_SCHEMA } },
    })
  } catch (err) {
    logError('brand profile: claude call failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('brand profile: claude returned no text block')
  }

  type RawProfile = {
    brand_voice: string
    example_posts: string[]
    posting_times: { text: string[]; photo: string[]; reel: string[]; story: string[] }
    weekly_cadence: { text: number; photo: number; reel: number; story: number }
    default_assignees: {
      story_video: string | null
      story_photo: string | null
      reel_concept: string | null
      photo_concept: string | null
    }
    reasoning: string
  }
  const raw = JSON.parse(textBlock.text) as RawProfile

  const profile: BrandProfile = {
    brandVoice: raw.brand_voice,
    examplePosts: raw.example_posts,
    postingTimes: raw.posting_times,
    weeklyCadence: raw.weekly_cadence,
    defaultAssignees: raw.default_assignees,
    reasoning: raw.reasoning,
  }

  logInfo('brand profile: generated', {
    showName: input.showName,
    cadenceTotal: profile.weeklyCadence.text + profile.weeklyCadence.photo + profile.weeklyCadence.reel + profile.weeklyCadence.story,
  })

  return {
    profile,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
    },
  }
}

// =============================================================
// Transcript correction pass
// =============================================================
//
// Deepgram is phonetic — "Cheri Oteri" comes out "Sherri O'Teri",
// speakers are anonymous "Speaker 0/1". One Claude pass:
//
//   1. Hard-applies every spelling in the show's vocabulary list.
//   2. Suggests other proper-noun fixes it spots from context
//      (these come back as suggestions, not auto-applied, so a real
//      "Sherri Brown" guest doesn't get auto-corrected to a celeb).
//   3. Identifies how many distinct speakers there are and names
//      each one when it can tell from context (host introductions,
//      guest call-outs, the episode title, etc.).

export type TranscriptCorrectionInput = {
  showName: string
  episodeTitle: string
  vocabulary: string
  blocks: Array<{ speaker: string; text: string; start: number; end: number }>
}

export type SpeakerIdentification = {
  original: string
  name: string
  confidence: 'high' | 'medium' | 'low'
}

export type TranscriptCorrectionResult = {
  speakerCount: number
  speakers: SpeakerIdentification[]
  correctedBlocks: Array<{ speaker: string; text: string; start: number; end: number }>
  vocabularyChangesApplied: number
  suggestedChanges: Array<{ from: string; to: string; reason: string }>
  summary: string
  usage: GenerateResult['usage']
}

const TRANSCRIPT_FIX_SYSTEM = `You are a transcript-correction assistant.

You correct phonetic transcription errors (Deepgram output) and identify
speakers — but you NEVER paraphrase, summarize, restructure, fix
grammar, or change meaning. Word-for-word fidelity is paramount.

You will receive:
- A SPELLING LIST: names and terms that MUST appear exactly as written,
  regardless of how the transcript spells them. Hard rule.
- A transcript as a list of blocks. Each has a speaker tag ("Speaker 0",
  etc.) and text.

You do three things, in one pass:
1. Apply every spelling from the SPELLING LIST literally — find phonetic
   variants in the text and replace with the canonical spelling.
2. Suggest other proper-noun corrections you spot from context that are
   NOT in the SPELLING LIST (e.g. a famous person whose name is clearly
   mis-spelled phonetically and is unambiguous from context). These come
   back as suggestions, NOT applied. Be conservative — when in doubt,
   leave the spelling alone.
3. Identify each unique speaker tag. Use context (intros, direct
   address, the episode title) to give each one a real name when you
   can. If you genuinely can't identify a speaker, keep the original
   tag like "Speaker 0".

Output strict JSON matching the schema. Every input block must appear
in corrected_blocks at the same index, with the same start/end times,
the speaker field updated to the real name (or kept as "Speaker N"),
and the text field with vocabulary corrections applied. NEVER edit
text beyond the corrections described above.`

const TRANSCRIPT_FIX_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['speakers', 'corrected_blocks', 'vocabulary_changes_applied', 'suggested_changes', 'summary'],
  properties: {
    speakers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['original', 'name', 'confidence'],
        properties: {
          original: { type: 'string', description: 'The original tag, e.g. "Speaker 0"' },
          name: { type: 'string', description: 'Real name if identifiable, otherwise repeat the original tag.' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
    corrected_blocks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['speaker', 'text', 'start', 'end'],
        properties: {
          speaker: { type: 'string' },
          text: { type: 'string' },
          start: { type: 'number' },
          end: { type: 'number' },
        },
      },
    },
    vocabulary_changes_applied: { type: 'integer' },
    suggested_changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['from', 'to', 'reason'],
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
    summary: { type: 'string', description: '1–2 sentence human-readable summary of what changed.' },
  },
} as const

export async function correctTranscript(input: TranscriptCorrectionInput): Promise<TranscriptCorrectionResult> {
  logInfo('transcript correction: starting', {
    show: input.showName,
    episode: input.episodeTitle,
    blockCount: input.blocks.length,
    vocabSize: input.vocabulary.length,
  })

  const blocksJson = input.blocks.map((b, i) => ({
    index: i,
    speaker: b.speaker,
    text: b.text,
    start: b.start,
    end: b.end,
  }))

  const userText = `SHOW: ${input.showName}
EPISODE: ${input.episodeTitle}

SPELLING LIST (these terms MUST appear exactly as written; replace any
phonetic variant in the transcript):
${input.vocabulary.trim() || '(none provided)'}

TRANSCRIPT BLOCKS (JSON; preserve same length and same start/end times
in corrected_blocks):
${JSON.stringify(blocksJson)}

Return the JSON per the schema. Reminders:
- Apply EVERY spelling from the SPELLING LIST.
- Suggest other corrections you can infer from context, but be
  conservative — don't auto-apply uncertain corrections.
- Identify speakers when you can; keep original "Speaker N" tag when
  you can't tell.
- DO NOT rephrase, summarize, fix grammar, or change meaning. Word
  fidelity beyond spelling corrections is mandatory.`

  let response
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: TRANSCRIPT_FIX_SYSTEM,
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
      output_config: { format: { type: 'json_schema', schema: TRANSCRIPT_FIX_SCHEMA } },
    })
  } catch (err) {
    logError('transcript correction: claude call failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('transcript correction: claude returned no text block')
  }

  type RawResult = {
    speakers: SpeakerIdentification[]
    corrected_blocks: Array<{ speaker: string; text: string; start: number; end: number }>
    vocabulary_changes_applied: number
    suggested_changes: Array<{ from: string; to: string; reason: string }>
    summary: string
  }
  const raw = JSON.parse(textBlock.text) as RawResult

  if (raw.corrected_blocks.length !== input.blocks.length) {
    logError('transcript correction: block count mismatch', {
      input: input.blocks.length,
      output: raw.corrected_blocks.length,
    })
    throw new Error(`block_count_mismatch: input ${input.blocks.length} != output ${raw.corrected_blocks.length}`)
  }

  return {
    speakerCount: raw.speakers.length,
    speakers: raw.speakers,
    correctedBlocks: raw.corrected_blocks,
    vocabularyChangesApplied: raw.vocabulary_changes_applied,
    suggestedChanges: raw.suggested_changes,
    summary: raw.summary,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
    },
  }
}

// =============================================================
// Single-item regenerator
// =============================================================
//
// Per-item "give me a fresh alternative" — one Claude call, one item
// of the requested kind, generated to be distinct from the existing
// item. Cheaper than rerunning the whole plan and lets the producer
// trade individual ideas without losing the rest of the plan.

export type RegenItemKind = 'text_post' | 'story_concept' | 'reel_concept' | 'photo_concept'

export type RegenInput = {
  kind: RegenItemKind
  showName: string
  showSubtitle?: string | null
  brandVoice: string
  examplePosts: string[]
  vocabulary?: string
  episodeTitle: string
  episodeTranscript: string
  // The current copy/text/concept the user wants to replace, verbatim.
  existing: string
}

export type RegenResult = {
  // The shape mirrors a single item from RawSocialPlan, minus the kind
  // tag. Callers project this into a SocialItem after they fill in id /
  // status / assignee_user_id.
  item:
    | { text: string }
    | { medium: 'video' | 'photo'; description: string; caption: string; suggested_clip: string; image_direction: string }
    | { hook: string; talking_points: string[]; suggested_clip: string }
    | { image_direction: string; caption: string; vibe: string }
  usage: GenerateResult['usage']
}

const REGEN_SCHEMAS: Record<RegenItemKind, Record<string, unknown>> = {
  text_post: {
    type: 'object',
    additionalProperties: false,
    required: ['text'],
    properties: { text: { type: 'string' } },
  },
  story_concept: {
    type: 'object',
    additionalProperties: false,
    required: ['medium', 'description', 'caption', 'suggested_clip', 'image_direction'],
    properties: {
      medium: { type: 'string', enum: ['video', 'photo'] },
      description: { type: 'string' },
      caption: { type: 'string' },
      suggested_clip: { type: 'string' },
      image_direction: { type: 'string' },
    },
  },
  reel_concept: {
    type: 'object',
    additionalProperties: false,
    required: ['hook', 'talking_points', 'suggested_clip'],
    properties: {
      hook: { type: 'string' },
      talking_points: { type: 'array', items: { type: 'string' } },
      suggested_clip: { type: 'string' },
    },
  },
  photo_concept: {
    type: 'object',
    additionalProperties: false,
    required: ['image_direction', 'caption', 'vibe'],
    properties: {
      image_direction: { type: 'string' },
      caption: { type: 'string' },
      vibe: { type: 'string' },
    },
  },
}

const REGEN_KIND_INSTRUCTIONS: Record<RegenItemKind, string> = {
  text_post: 'one Instagram caption following the show\'s voice and the established IG-text-post rules from the system prompt',
  story_concept: 'one story concept with medium (video or photo), description, overlay caption (<100 chars), suggested_clip (with [HH:MM:SS – HH:MM:SS] timecode prefix for video; empty string for photo), and image_direction (for photo medium: describe a real photograph — subject + setting + light; never a graphic-design asset). Pick the format that fits the idea best',
  reel_concept: 'one reel concept with hook, 3–5 talking_points, and suggested_clip (with [HH:MM:SS – HH:MM:SS] timecode prefix)',
  photo_concept: 'one photo concept. image_direction must describe an ACTUAL PHOTOGRAPH to shoot — real subject in a real setting with real light/framing. NEVER a typographic graphic, NEVER text on a colored background, NEVER a poll sticker. Think shot list, not Canva. Then caption (IG caption text) and a 2–4 word vibe',
}

export async function regenerateSocialItem(input: RegenInput): Promise<RegenResult> {
  logInfo('socials: regenerating single item', {
    kind: input.kind, show: input.showName, episode: input.episodeTitle,
  })

  const userText = `SHOW: ${input.showName}
${input.showSubtitle ? `SHOW DESCRIPTION: ${input.showSubtitle}\n` : ''}EPISODE: ${input.episodeTitle}

BRAND VOICE:
${input.brandVoice.trim() || '(none specified — infer from show name)'}

${input.examplePosts.length > 0 ? `EXAMPLE POSTS (match this voice):\n${input.examplePosts.map((e) => `  - ${e.trim()}`).join('\n')}\n` : ''}${input.vocabulary?.trim() ? `SPELLING REQUIREMENTS (use exactly):\n${input.vocabulary.trim()}\n` : ''}
TRANSCRIPT (timecoded — each block prefixed with [HH:MM:SS]):
${input.episodeTranscript.slice(0, 80_000)}

EXISTING ITEM the team wants replaced:
${input.existing}

Generate ${REGEN_KIND_INSTRUCTIONS[input.kind]}. It must be MEANINGFULLY
DIFFERENT from the existing item — different angle, different moment,
different hook. Don't just rephrase.

Return strict JSON per the schema.`

  let response
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
      output_config: { format: { type: 'json_schema', schema: REGEN_SCHEMAS[input.kind] } },
    })
  } catch (err) {
    logError('socials: regen claude call failed', {
      kind: input.kind,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('socials regen: claude returned no text block')
  }
  const item = JSON.parse(textBlock.text) as RegenResult['item']
  return {
    item,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
    },
  }
}

// ============================================================
// PODCAST CAROUSEL DECK GENERATOR
// ============================================================
// Given an episode transcript + a show's visual preset, drafts a
// 5–7 slide social-media carousel matching the show's design system
// (e.g. Soul & Science: dark bg, two-tier accent headlines, concept
// diagrams, brand-callout slides for outside brands referenced,
// host-finale closer with the episode's "lesson").
//
// Output is enforced to a strict JSON schema that mirrors SlideSpec
// on the client (src/lib/carouselDeckImage.ts). The client adapts
// the flat schema into its discriminated-union SlideSpec[].

export type CarouselGenerateInput = {
  showName: string
  hostName?: string
  presetKey: string
  episodeTitle?: string | null
  episodeNumber?: number | null
  episodeTranscript: string
  // Optional strategy docs — when present, the carousel headlines,
  // accent words, and lesson wrap-up align with the show's brand
  // positioning, pillars, and audience psychology.
  strategyDocs?: StrategyDocsInput
}

export type RawDeckSlide = {
  kind: 'cover' | 'thesis' | 'callout' | 'brand-callout' | 'finale' | 'quote'
  // cover / general
  title?: string
  eyebrow?: string
  // thesis / callout / brand-callout
  headline?: string
  accent?: string
  accentSecondary?: string
  body?: string
  brandLabel?: string
  // thesis diagram
  diagramLayout?: 'two-circle' | 'three-stage' | 'none'
  diagramNodeAIcon?: string
  diagramNodeALabel?: string
  diagramNodeASub?: string
  diagramNodeBIcon?: string
  diagramNodeBLabel?: string
  diagramNodeBSub?: string
  diagramMidpointLabel?: string
  diagramMidpointSub?: string
  // callout traits
  trait1Icon?: string
  trait1Word?: string
  trait2Icon?: string
  trait2Word?: string
  trait3Icon?: string
  trait3Word?: string
  // brand-callout
  bodyParagraphs?: string[]
  finalLine?: string
  // finale
  lessonHeadline?: string
  lessonBody?: string
  tagline?: string
  // quote
  quoteText?: string
  quoteSpeaker?: string
  // asset hints — what the slide WOULD use if uploaded
  needsHostPhoto?: boolean
  needsBrandLogo?: boolean
  needsCollageImage?: boolean
  assetHint?: string  // free-form note like "Tripadvisor logo + Viator logo"
}

export type RawDeck = {
  slides: RawDeckSlide[]
  asset_requests: Array<{
    slot: 'host_photo' | 'show_logo' | 'platform_icons' | 'brand_logo' | 'collage_image'
    description: string  // "Tripadvisor logo + Viator logo for slide 4"
    slide_index: number  // 1-based
  }>
}

export type CarouselGenerateResult = {
  deck: RawDeck
  usage: {
    inputTokens: number
    outputTokens: number
    cacheCreationInputTokens: number
    cacheReadInputTokens: number
  }
}

const CONCEPT_ICONS = [
  'heritage', 'momentum', 'bridge', 'voice', 'target', 'compass', 'spark', 'pulse',
] as const

const DECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['slides', 'asset_requests'],
  properties: {
    slides: {
      // Anthropic's strict json_schema validator only allows
      // minItems values of 0 or 1 — we enforce the real 5–7 bound
      // through the prompt text instead. Same story for the array
      // size limits on bodyParagraphs and asset_requests below.
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind'],
        properties: {
          // Every enum gets `type: 'string'` alongside — Anthropic's
          // strict json_schema validator rejects bare enums on some
          // model versions.
          kind: { type: 'string', enum: ['cover', 'thesis', 'callout', 'brand-callout', 'finale', 'quote'] },
          title: { type: 'string' },
          eyebrow: { type: 'string' },
          headline: { type: 'string' },
          accent: { type: 'string' },
          accentSecondary: { type: 'string' },
          body: { type: 'string' },
          brandLabel: { type: 'string' },
          diagramLayout: { type: 'string', enum: ['two-circle', 'three-stage', 'none'] },
          diagramNodeAIcon: { type: 'string', enum: [...CONCEPT_ICONS] },
          diagramNodeALabel: { type: 'string' },
          diagramNodeASub: { type: 'string' },
          diagramNodeBIcon: { type: 'string', enum: [...CONCEPT_ICONS] },
          diagramNodeBLabel: { type: 'string' },
          diagramNodeBSub: { type: 'string' },
          diagramMidpointLabel: { type: 'string' },
          diagramMidpointSub: { type: 'string' },
          trait1Icon: { type: 'string', enum: [...CONCEPT_ICONS] },
          trait1Word: { type: 'string' },
          trait2Icon: { type: 'string', enum: [...CONCEPT_ICONS] },
          trait2Word: { type: 'string' },
          trait3Icon: { type: 'string', enum: [...CONCEPT_ICONS] },
          trait3Word: { type: 'string' },
          bodyParagraphs: { type: 'array', items: { type: 'string' } },
          finalLine: { type: 'string' },
          lessonHeadline: { type: 'string' },
          lessonBody: { type: 'string' },
          tagline: { type: 'string' },
          quoteText: { type: 'string' },
          quoteSpeaker: { type: 'string' },
          needsHostPhoto: { type: 'boolean' },
          needsBrandLogo: { type: 'boolean' },
          needsCollageImage: { type: 'boolean' },
          assetHint: { type: 'string' },
        },
      },
    },
    asset_requests: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['slot', 'description', 'slide_index'],
        properties: {
          slot: { type: 'string', enum: ['host_photo', 'show_logo', 'platform_icons', 'brand_logo', 'collage_image'] },
          description: { type: 'string' },
          slide_index: { type: 'number' },
        },
      },
    },
  },
}

const DECK_SYSTEM_PROMPT = `You are an art director for a high-end podcast social team.

Given an episode transcript, you produce a 5–7 slide Instagram carousel
that walks a reader through the episode's central argument and ends
with a "lesson" + listen-now CTA.

The visual system is fixed and brand-driven (the client renders the
slides — you only write the content). Your job is to choose the
RIGHT SHAPE for each slide, write the punchy display copy, and tag
the asset slots the design will need.

Slide shape vocabulary (pick the best fit for each beat):

  cover           Episode title card. Use an eyebrow like "EPISODE 12"
                  and a tight all-caps title (max ~8 words).

  thesis          A core argument. Headline (1 sentence, up to ~12
                  words) with the punchline as an "accent" suffix
                  that will render in the show's primary color.
                  Optional body (1–4 short sentences) supports the
                  claim. Optionally include a concept diagram via
                  diagramLayout — "two-circle" for opposed concepts
                  (Heritage vs. Momentum) or "three-stage" with a
                  bridge for transitional concepts (Old → Bridge → New).
                  Choose two icons from: heritage (castle / legacy),
                  momentum (chevron / future), bridge (the work),
                  voice (audience), target (relevance), compass
                  (direction), spark (idea), pulse (heartbeat).

  callout         Three-trait list slide. Headline with TWO accent
                  segments — "accent" renders primary, "accentSecondary"
                  renders in the secondary color. Trait1/2/3 each pair
                  an icon (same vocab) with a single word ending in a
                  period ("Real.", "Relevant.", "Resonant."). Use a
                  body with 3 short imperatives ("Know your audience.")
                  if it deepens the point.

  brand-callout   When the episode anchors on an OUTSIDE brand
                  (Tripadvisor, Lands' End, White Castle, etc.).
                  Two-tier accent headline. bodyParagraphs is an
                  array of 2–4 short paragraphs separated by accent
                  rules. finalLine is the bottom-line callout in
                  secondary color. Set brandLabel to the brand name.
                  Set needsBrandLogo or needsCollageImage so the team
                  can upload the asset.

  finale          The closer. lessonHeadline defaults to "THE LESSON:"
                  — keep it that or use a 2-3 word equivalent ending
                  in a colon. lessonBody is the takeaway (2–3
                  sentences). Tagline is a 2-3 word punchline in
                  primary color ("Realness. Relevance. Resonance.").
                  This slide ALWAYS has needsHostPhoto: true.

  quote           Pull-quote from a guest or host. Use sparingly.

Structure rules:
  - Slide 1 is always "cover".
  - The last slide is always "finale".
  - The middle 3–5 slides build the argument: 2–3 thesis slides
    setting up the central tension, then 1–2 brand-callout slides
    if the episode references outside brands, then 1 callout slide
    if there's a clean three-trait conclusion.
  - Headlines: bold, punchy, never more than 12 words. Use all-caps
    or sentence case — the renderer will uppercase. Avoid filler
    ("In this episode…", "We talked about…"). Lead with the claim.
  - Accent words: pick the most LOADED word(s) of the headline as
    the accent. The accent must be a SUFFIX of the headline (the
    renderer color-splits by suffix match).
  - Body copy: short. Two-three short sentences max. Line breaks
    are honored.
  - Diagram tags: only on thesis slides. Two-circle for opposed
    concepts, three-stage for "old → bridge → new" arcs.

Asset requests:
  After laying out the slides, list every external asset the design
  would benefit from. Slots:
    - host_photo:     for the finale (always)
    - show_logo:      if the show has an uploaded wordmark
    - platform_icons: Apple Podcasts / Spotify / YouTube
    - brand_logo:     for each brand-callout slide
    - collage_image:  for any slide where uploaded photos would add
                      visual richness (vintage photos, screenshot
                      mockups, product shots)
  Description should be specific ("Tripadvisor app screenshot mockup
  with Viator feed posts") so the team knows what to upload.

Tone:
  Match the show's voice. For business / strategy podcasts (Soul &
  Science is one): confident, declarative, no jargon, no hedging.
  Big claims in clean type.

Strategy alignment:
  If a "=== SHOW STRATEGY ===" section is included in the show block,
  it's the authoritative brief. Every slide's headline should serve
  one of the listed content pillars, land on the audience's actual
  desires or frustrations, and echo the tone. The finale's lesson +
  tagline should slot into the show's growth north star. If the
  strategy is missing, work from the transcript alone.

Return EXACTLY this JSON shape — no commentary.`

function carouselShowBlock(input: CarouselGenerateInput): string {
  return [
    `SHOW: ${input.showName}`,
    input.hostName ? `HOST: ${input.hostName}` : '',
    `PRESET: ${input.presetKey}`,
    strategyDocsBlock(input.strategyDocs),
  ].filter(Boolean).join('\n')
}

function carouselEpisodeBlock(input: CarouselGenerateInput): string {
  const head: string[] = []
  if (input.episodeNumber != null) head.push(`EPISODE #${input.episodeNumber}`)
  if (input.episodeTitle) head.push(`TITLE: ${input.episodeTitle}`)
  return [
    head.join(' · '),
    '',
    'TRANSCRIPT:',
    input.episodeTranscript,
  ].filter((x) => x !== '').join('\n')
}

// ─── Auto-derive a carousel design from a show's cover art ───────────
// Look at the podcast's cover and produce an on-brand carousel palette +
// two-line wordmark, so every show's deck matches its own art instead of a
// single hardcoded preset.
export type DerivedCarouselPreset = {
  palette: { primary: string; secondary: string; bg: string; ink: string; inkDim: string }
  logo: { name1: string; name2: string }
}

const HEX = /^#[0-9a-fA-F]{6}$/
const CAROUSEL_PALETTE_SYSTEM = `You are a brand designer. You are shown a podcast's cover art. Produce a color palette for an Instagram carousel that feels unmistakably on-brand with that cover — pull the actual dominant and accent colors from the art.

Return ONLY JSON, no prose:
{
  "primary": "#RRGGBB",    // the show's signature accent — for headline punch words. Vivid, high-contrast against bg.
  "secondary": "#RRGGBB",  // a second accent for contrast (a complementary or lighter brand color).
  "bg": "#RRGGBB",         // deep slide background — usually the cover's darkest brand color or near-black. NOT pure black unless the cover is.
  "ink": "#RRGGBB",        // body text on bg — near-white, must be clearly readable on bg.
  "inkDim": "#RRGGBB"      // muted version of ink for secondary text.
}
Rules: every value a 6-digit hex. ink must have strong contrast on bg (light text on dark bg, or dark text on light bg). primary and secondary must both pop against bg. Match the cover's mood — bold/neon covers get saturated accents, elegant covers get refined ones.`

export async function deriveCarouselPreset(
  coverBytes: Buffer,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp',
  showName: string,
): Promise<DerivedCarouselPreset | null> {
  if (!hasAnthropicKey()) return null
  const content: Anthropic.MessageParam['content'] = [
    { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType, data: coverBytes.toString('base64') } },
    { type: 'text' as const, text: `This is the cover art for the podcast "${showName}". Give me the carousel palette.` },
  ]
  const response = await createWithRetry({
    model: VISION_MODEL,
    max_tokens: 400,
    system: CAROUSEL_PALETTE_SYSTEM,
    messages: [{ role: 'user', content }],
  })
  const block = response.content.find((b) => b.type === 'text')
  const text = block && block.type === 'text' ? block.text : ''
  const s = text.indexOf('{'), e = text.lastIndexOf('}')
  if (s === -1 || e <= s) return null
  let parsed: Record<string, unknown>
  try { parsed = JSON.parse(text.slice(s, e + 1)) as Record<string, unknown> } catch { return null }
  const hex = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim() : fallback)
  const palette = {
    primary: hex(parsed.primary, '#E8B84B'),
    secondary: hex(parsed.secondary, '#4BA3E8'),
    bg: hex(parsed.bg, '#0E0E12'),
    ink: hex(parsed.ink, '#F5F5F0'),
    inkDim: hex(parsed.inkDim, '#9A9AA2'),
  }
  // Readability guard: body text MUST be legible on the background, even if the
  // model returned a low-contrast pair. Force ink light-on-dark or dark-on-
  // light based on the background, and nudge accents that vanish into the bg.
  const lum = (h: string) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  const contrast = (a: string, b: string) => {
    const la = lum(a), lb = lum(b)
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
  }
  const bgDark = lum(palette.bg) < 0.4
  if (contrast(palette.ink, palette.bg) < 4.5) palette.ink = bgDark ? '#F5F5F0' : '#14141A'
  if (contrast(palette.inkDim, palette.bg) < 2.6) palette.inkDim = bgDark ? '#9EA0A8' : '#5A5A62'
  // Accents must pop off the bg; if one collapsed into it, swap to a safe one.
  if (contrast(palette.primary, palette.bg) < 2) palette.primary = bgDark ? '#E8B84B' : '#B4451F'
  if (contrast(palette.secondary, palette.bg) < 2) palette.secondary = bgDark ? '#5AB0F0' : '#1F6FB4'
  // Two-line wordmark from the show name: split near the middle on a word
  // boundary so it stacks nicely (e.g. "Private Talk" → "PRIVATE" / "TALK").
  const words = showName.trim().split(/\s+/)
  let name1 = showName.trim(), name2 = ''
  if (words.length >= 2) {
    const mid = Math.ceil(words.length / 2)
    name1 = words.slice(0, mid).join(' ')
    name2 = words.slice(mid).join(' ')
  }
  return { palette, logo: { name1: name1.toUpperCase(), name2: name2.toUpperCase() } }
}

export async function generateCarouselDeck(input: CarouselGenerateInput): Promise<CarouselGenerateResult> {
  logInfo('carousel: generating deck', {
    showName: input.showName,
    presetKey: input.presetKey,
    transcriptChars: input.episodeTranscript.length,
  })
  let response
  try {
    response = await client.messages.create({
      model: MODEL,
      // Bumped from 8000 → 16000 to match the other generators. The
      // deck JSON for a 7-slide carousel + asset_requests is ~3-4k
      // tokens, but a verbose run can push past 8k and truncate the
      // JSON mid-string — that surfaces as "Unexpected end of JSON
      // input" further down. 16k gives plenty of headroom.
      max_tokens: 16000,
      system: DECK_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: carouselShowBlock(input),
              cache_control: { type: 'ephemeral' },
            },
            { type: 'text', text: carouselEpisodeBlock(input) },
          ],
        },
      ],
      output_config: {
        format: { type: 'json_schema', schema: DECK_SCHEMA },
      },
    })
  } catch (err) {
    logError('carousel: claude call failed', { error: err instanceof Error ? err.message : String(err) })
    throw err
  }
  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('carousel: claude returned no text block')
  }
  let deck: RawDeck
  try {
    deck = JSON.parse(textBlock.text) as RawDeck
  } catch (err) {
    logError('carousel: invalid JSON from claude', { body: textBlock.text.slice(0, 500) })
    throw new Error(`carousel: invalid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  // The strict schema no longer enforces minItems (Anthropic rejects
  // that for arrays), so Claude could technically return an empty or
  // sub-usable slide list on a bad transcript. Reject upstream so the
  // client shows a clean error instead of "No renderable slides."
  if (!Array.isArray(deck.slides) || deck.slides.length < 3) {
    throw new Error(`carousel: too few slides returned (got ${deck.slides?.length ?? 0}, need at least 3)`)
  }
  logInfo('carousel: deck generated', {
    slides: deck.slides.length,
    assetRequests: deck.asset_requests.length,
    cacheRead: response.usage.cache_read_input_tokens ?? 0,
    cacheCreate: response.usage.cache_creation_input_tokens ?? 0,
  })
  return {
    deck,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
    },
  }
}

// ============================================================
// SOCIAL STRATEGY TOOLS (10 per-show strategy documents)
// ============================================================
// One entry point — generateSocialStrategyDocument({projectContext,
// kind, inputContext}) — that dispatches to the right prompt +
// json_schema per document kind. Everything the operator would want
// to hand a strategist ("here's my niche, target audience, current
// numbers") comes in via projectContext (auto-derived from the show
// row in Slate) and inputContext (freeform text they type into the
// [paste] fields).

export type StrategyKind =
  | 'strategy'      // Full Social Media Strategy (the complete system — run first)
  | 'profile_audit' // Fix the Profile — audit before feeding it more content
  | 'audience'      // Audience Psychology Breakdown
  | 'authority'     // Authority Positioning Plan
  | 'pillars'       // Content Pillars That Convert
  | 'calendar'      // 30-Day Content Plan (hook + key message + CTA + format per day)
  | 'ideas'         // Never Run Out of Ideas — idea bank by audience level
  | 'winners'       // Copy Your Own Winners — pattern-mine past posts
  | 'post'          // Write the Caption Last (one-off; run after the rest)
  | 'monetization'  // Audience Monetization Strategy

export type StrategyProjectContext = {
  showName: string
  showKind: 'album' | 'podcast' | 'film'
  showSubtitle?: string | null
  brandVoice?: string | null
  vocabulary?: string | null
  // Recent episode titles + one-line summaries — gives Claude
  // grounding on what the show actually talks about.
  recentEpisodes?: Array<{ title: string; subtitle?: string | null; summary?: string | null }>
  // Structured brief the operator filled out for the show — business
  // description, niche, target audience, competitors, growth goals,
  // current metrics, monetization model, constraints, notes. Read by
  // every strategy tool as the authoritative starting point.
  brief?: {
    business_description?: string
    niche?: string
    target_audience?: string
    competitors?: string
    growth_goals?: string
    current_metrics?: string
    monetization_current?: string
    constraints?: string
    notes?: string
  }
  // Existing sibling docs Claude can reference when generating a new
  // one (e.g. the pillars generator should read the strategy doc so
  // pillars align with the brand positioning).
  siblingDocs?: Partial<Record<StrategyKind, unknown>>
}

export type StrategyGenerateInput = {
  kind: StrategyKind
  projectContext: StrategyProjectContext
  inputContext?: string  // whatever the operator pasted into [paste]
}

export type StrategyGenerateResult = {
  content: unknown  // shape depends on kind — validated against per-kind schema
  usage: {
    inputTokens: number
    outputTokens: number
    cacheCreationInputTokens: number
    cacheReadInputTokens: number
  }
}

// Per-kind schema + prompt. Each prompt is drafted to output a rich,
// actionable document (not a bullet-point summary). Every schema
// enforces additionalProperties: false so we can render the output
// with predictable field names in the UI.

const STRATEGY_SCHEMAS: Record<StrategyKind, Record<string, unknown>> = {
  strategy: {
    type: 'object',
    additionalProperties: false,
    required: ['brand_positioning', 'content_direction', 'audience_targeting',
               'posting_system', 'engagement_plan', 'tracking',
               'monetization_plan', 'growth_north_star'],
    properties: {
      brand_positioning: {
        type: 'object', additionalProperties: false,
        required: ['one_sentence', 'differentiators', 'category', 'tagline_options'],
        properties: {
          one_sentence: { type: 'string' },
          category: { type: 'string' },
          differentiators: { type: 'array', items: { type: 'string' } },
          tagline_options: { type: 'array', items: { type: 'string' } },
        },
      },
      content_direction: {
        type: 'object', additionalProperties: false,
        required: ['themes', 'tone', 'formats_to_prioritize'],
        properties: {
          themes: { type: 'array', items: { type: 'string' } },
          tone: { type: 'string' },
          formats_to_prioritize: { type: 'array', items: { type: 'string' } },
        },
      },
      audience_targeting: {
        type: 'object', additionalProperties: false,
        required: ['primary_persona', 'where_they_hang_out', 'what_gets_them_to_follow'],
        properties: {
          primary_persona: { type: 'string' },
          where_they_hang_out: { type: 'array', items: { type: 'string' } },
          what_gets_them_to_follow: { type: 'array', items: { type: 'string' } },
        },
      },
      posting_system: {
        type: 'object', additionalProperties: false,
        required: ['cadence', 'weekly_rhythm', 'time_budget_fit'],
        properties: {
          cadence: { type: 'string' },
          weekly_rhythm: { type: 'array', items: { type: 'string' } },
          time_budget_fit: { type: 'string' },
        },
      },
      engagement_plan: {
        type: 'object', additionalProperties: false,
        required: ['daily_habits', 'community_moves'],
        properties: {
          daily_habits: { type: 'array', items: { type: 'string' } },
          community_moves: { type: 'array', items: { type: 'string' } },
        },
      },
      tracking: {
        type: 'object', additionalProperties: false,
        required: ['metrics_to_watch', 'review_cadence'],
        properties: {
          metrics_to_watch: { type: 'array', items: { type: 'string' } },
          review_cadence: { type: 'string' },
        },
      },
      monetization_plan: {
        type: 'object', additionalProperties: false,
        required: ['near_term', 'medium_term', 'long_term'],
        properties: {
          near_term: { type: 'array', items: { type: 'string' } },
          medium_term: { type: 'array', items: { type: 'string' } },
          long_term: { type: 'array', items: { type: 'string' } },
        },
      },
      growth_north_star: { type: 'string' },
    },
  },
  profile_audit: {
    type: 'object',
    additionalProperties: false,
    required: ['first_impression', 'whats_helping', 'whats_hurting',
               'biggest_fixes', 'bio_rewrite_options', 'consistency_notes', 'engagement_notes'],
    properties: {
      first_impression: { type: 'string' },
      whats_helping: { type: 'array', items: { type: 'string' } },
      whats_hurting: { type: 'array', items: { type: 'string' } },
      biggest_fixes: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['fix', 'why', 'how'],
          properties: {
            fix: { type: 'string' },
            why: { type: 'string' },
            how: { type: 'string' },
          },
        },
      },
      bio_rewrite_options: { type: 'array', items: { type: 'string' } },
      consistency_notes: { type: 'string' },
      engagement_notes: { type: 'string' },
    },
  },
  audience: {
    type: 'object',
    additionalProperties: false,
    required: ['persona_snapshot', 'frustrations', 'desires', 'fears', 'daily_content_habits', 'messaging_angles', 'topic_ideas'],
    properties: {
      persona_snapshot: { type: 'string' },
      frustrations: { type: 'array', items: { type: 'string' } },
      desires: { type: 'array', items: { type: 'string' } },
      fears: { type: 'array', items: { type: 'string' } },
      daily_content_habits: { type: 'array', items: { type: 'string' } },
      messaging_angles: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['angle', 'why_it_works'],
          properties: {
            angle: { type: 'string' },
            why_it_works: { type: 'string' },
          },
        },
      },
      topic_ideas: { type: 'array', items: { type: 'string' } },
    },
  },
  authority: {
    type: 'object',
    additionalProperties: false,
    required: ['positioning_statement', 'differentiators', 'proof_points_to_build', 'signature_content_moves', 'competitors_to_watch'],
    properties: {
      positioning_statement: { type: 'string' },
      differentiators: { type: 'array', items: { type: 'string' } },
      proof_points_to_build: { type: 'array', items: { type: 'string' } },
      signature_content_moves: { type: 'array', items: { type: 'string' } },
      competitors_to_watch: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['name', 'why_they_matter', 'how_you_are_different'],
          properties: {
            name: { type: 'string' },
            why_they_matter: { type: 'string' },
            how_you_are_different: { type: 'string' },
          },
        },
      },
    },
  },
  pillars: {
    type: 'object',
    additionalProperties: false,
    required: ['pillars'],
    properties: {
      pillars: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['name', 'purpose', 'why_it_connects', 'example_post_topics', 'suggested_frequency'],
          properties: {
            name: { type: 'string' },
            purpose: { type: 'string' },
            why_it_connects: { type: 'string' },
            example_post_topics: { type: 'array', items: { type: 'string' } },
            suggested_frequency: { type: 'string' },
          },
        },
      },
    },
  },
  calendar: {
    type: 'object',
    additionalProperties: false,
    required: ['start_date_hint', 'days'],
    properties: {
      start_date_hint: { type: 'string' },
      days: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['day', 'idea', 'hook', 'format', 'core_message', 'cta', 'post_type', 'goal', 'pillar'],
          properties: {
            day: { type: 'integer' },
            idea: { type: 'string' },
            hook: { type: 'string' },
            format: { type: 'string' },
            core_message: { type: 'string' },
            cta: { type: 'string' },
            post_type: { type: 'string', enum: ['educational', 'entertaining', 'personal', 'authority', 'community'] },
            goal: { type: 'string', enum: ['reach', 'trust', 'buy'] },
            pillar: { type: 'string' },
          },
        },
      },
    },
  },
  ideas: {
    type: 'object',
    additionalProperties: false,
    required: ['beginner', 'intermediate', 'advanced'],
    properties: {
      beginner: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['idea', 'problem_it_solves', 'format'],
          properties: {
            idea: { type: 'string' },
            problem_it_solves: { type: 'string' },
            format: { type: 'string' },
          },
        },
      },
      intermediate: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['idea', 'problem_it_solves', 'format'],
          properties: {
            idea: { type: 'string' },
            problem_it_solves: { type: 'string' },
            format: { type: 'string' },
          },
        },
      },
      advanced: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['idea', 'problem_it_solves', 'format'],
          properties: {
            idea: { type: 'string' },
            problem_it_solves: { type: 'string' },
            format: { type: 'string' },
          },
        },
      },
    },
  },
  winners: {
    type: 'object',
    additionalProperties: false,
    required: ['post_breakdown', 'winning_patterns', 'losing_patterns',
               'specific_improvements', 'repeatable_formula'],
    properties: {
      post_breakdown: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['post', 'verdict', 'why'],
          properties: {
            post: { type: 'string' },
            verdict: { type: 'string', enum: ['strong', 'weak'] },
            why: { type: 'string' },
          },
        },
      },
      winning_patterns: { type: 'array', items: { type: 'string' } },
      losing_patterns: { type: 'array', items: { type: 'string' } },
      specific_improvements: { type: 'array', items: { type: 'string' } },
      repeatable_formula: { type: 'string' },
    },
  },
  post: {
    type: 'object',
    additionalProperties: false,
    required: ['hook', 'body', 'cta', 'why_it_stops_the_scroll'],
    properties: {
      hook: { type: 'string' },
      body: { type: 'string' },
      cta: { type: 'string' },
      why_it_stops_the_scroll: { type: 'string' },
    },
  },
  monetization: {
    type: 'object',
    additionalProperties: false,
    required: ['offer_ideas', 'pricing_structure', 'content_angles_that_convert', 'funnel_stages'],
    properties: {
      offer_ideas: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['name', 'description', 'audience_fit'],
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            audience_fit: { type: 'string' },
          },
        },
      },
      pricing_structure: { type: 'string' },
      content_angles_that_convert: { type: 'array', items: { type: 'string' } },
      funnel_stages: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['stage', 'goal', 'content_examples'],
          properties: {
            stage: { type: 'string' },
            goal: { type: 'string' },
            content_examples: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
}

const STRATEGY_SYSTEM_PROMPTS: Record<StrategyKind, string> = {
  strategy: `Act as this show's $2,000-a-month social media manager.
Before creating anything, understand the show's niche, audience, goals, brand voice, content
style, and available time — all of that is in the show block (the Show Brief is authoritative;
constraints tell you how much time the team actually has). Then build a COMPLETE system, not
just a positioning doc: planning (brand positioning, content direction, audience targeting),
posting (a realistic cadence and weekly rhythm that fits the team's available time — say
explicitly how it fits), engagement (daily habits and community moves that grow the account
between posts), growth, and tracking (which metrics to watch and how often to review them).
Be specific to THIS show (not generic advice). Ground every recommendation in what the show
actually is and what its audience actually cares about. This document is the foundation every
other tool references — make it complete enough that nothing downstream has to guess.
Return the JSON matching the schema.`,
  profile_audit: `You are a social media profile auditor. The operator pasted their profile
info into input_context — the link, bio text, and/or a description of the profile picture,
pinned content, recent posts, and engagement. Review the bio, picture, content, positioning,
messaging, consistency, and engagement. Tell them what is helping growth, what is hurting it,
and the biggest fixes — ranked, each with why it matters and exactly how to do it. Include
2-4 rewritten bio options in the show's voice. The principle: fix the account before feeding
it more content — posting into a broken profile just burns the work faster. Judge only what
you were actually given; if something important wasn't provided (e.g. no bio text), say so in
the relevant note instead of inventing it. Return the JSON matching the schema.`,
  audience: `You are an audience psychologist who studies how people consume media online.
Break down the target audience in detail — frustrations, desires, fears, and daily habits
around content. Turn that research into specific messaging angles and content topics that
will stop their scroll and build real trust over time. Be concrete and observational, not
generic. Return the JSON matching the schema.`,
  authority: `You are a personal / brand-positioning expert.
Build a positioning strategy that separates this show from everyone else in its space and
makes it the go-to name in its industry. Identify the specific competitors, why they matter,
and how to be different from each. Recommend signature content moves (patterns of content
that ONLY this show does) that build authority over time. Return the JSON matching the schema.`,
  pillars: `You are a content strategist for creators.
Build 5 content pillars for this show's social presence — durable topic categories the show
posts about consistently. Each pillar should either attract new followers, establish credibility,
or drive leads / sales — say which. For each pillar, include 3-5 example post topics and
explain exactly why it connects with the audience. Return the JSON matching the schema.`,
  calendar: `You are a social media planner.
Build a full 30-day content calendar for this show — a month of hooks in one sitting beats
deciding what to post every morning. Every day gets: the content idea, the HOOK (the actual
opening line, written out — not a description of one), the key message, the CTA, the best
format, and the goal (reach / trust / buy). Mix the post types across the month — educational,
entertaining, personal, authority, and community posts — and tag each day with its type.
Where the show has content pillars in sibling docs, map each day to a pillar. Balance the
mix — don't post the same format or type five days in a row. Return the JSON matching the schema.`,
  ideas: `You are a content ideation engine for this show's niche.
Generate a deep bank of original content ideas sorted by audience level — beginner,
intermediate, and advanced (10-15 ideas per level). Sorting by audience level is what stops
the show writing the same beginner post forever. Prioritise ideas that educate, solve real
problems, and stay relevant over time — for each idea, name the specific problem it solves
for the viewer and the best format for it. Ground the ideas in what the show actually covers
(recent episodes, pillars, and audience docs when present), not generic niche filler.
Return the JSON matching the schema.`,
  winners: `You are a social media analyst who reverse-engineers what works.
The operator pasted their past posts into input_context — ideally with performance notes
(likes, saves, shares, comments), but work with what you're given. Find the patterns behind
the strongest and weakest posts: for each pasted post, give a verdict (strong / weak) and
explain why it worked or didn't — hook structure, topic, format, emotional trigger, CTA,
timing, specificity. Then extract the winning patterns and losing patterns as reusable rules,
give specific improvements to apply going forward, and distill it all into ONE repeatable
formula the show can run on purpose. The best posts already hold the formula — your job is
to pull it out. Judge only the posts you were given; don't invent performance data.
Return the JSON matching the schema.`,
  post: `You are a copywriter for high-engagement social captions. Write the caption LAST —
this show's strategy docs (positioning, audience psychology, pillars, brand voice, winning
patterns) are in the show block, and the caption only works because they already told you
who this show is. Use them.
Write ONE caption on the topic the operator provided (input_context). It must sound natural
and match the show's brand voice — like a person, not a brand. Grab attention in the FIRST
sentence (that's the hook), deliver clear value in the body, and end with a strong call to
action that drives comments, saves, or clicks. Where a "Copy Your Own Winners" doc exists in
sibling docs, follow its repeatable formula. Also explain briefly why the hook stops the
scroll. Return the JSON matching the schema.`,
  monetization: `You are a business strategist focused on turning social followers into paying customers.
Review the show's current business model (inferred from projectContext.brand_voice and recent
episodes) and build a monetization plan that includes concrete offer ideas, pricing structure,
content angles that naturally move people from follower to buyer, and a funnel of content
stages. Be specific — don't say "sell a course" without saying WHAT course and to WHOM.
Return the JSON matching the schema.`,
}

function strategyProjectBlock(ctx: StrategyProjectContext): string {
  const parts: string[] = []
  parts.push(`SHOW: ${ctx.showName}`)
  parts.push(`TYPE: ${ctx.showKind}`)
  if (ctx.showSubtitle) parts.push(`SUBTITLE: ${ctx.showSubtitle}`)
  if (ctx.brandVoice) parts.push(`BRAND VOICE:\n${ctx.brandVoice}`)
  if (ctx.vocabulary) parts.push(`VOCABULARY:\n${ctx.vocabulary}`)
  // The Show Brief is the authoritative starting point when present —
  // the operator answered a structured questionnaire once, and every
  // strategy tool reads it here. Only emit fields that were answered.
  if (ctx.brief) {
    const briefLines: string[] = ['SHOW BRIEF (authoritative — start here):']
    const labels: Array<[keyof NonNullable<StrategyProjectContext['brief']>, string]> = [
      ['business_description', 'What the show does + business model'],
      ['niche', 'Specific niche'],
      ['target_audience', 'Target audience'],
      ['competitors', 'Named competitors'],
      ['growth_goals', 'Growth goals (next 12 months)'],
      ['current_metrics', 'Current metrics / state'],
      ['monetization_current', 'Current monetization'],
      ['constraints', 'Constraints (team, legal, brand, cadence)'],
      ['notes', 'Additional notes'],
    ]
    for (const [key, label] of labels) {
      const v = ctx.brief[key]
      if (v) briefLines.push(`  ${label}:\n    ${v.replace(/\n/g, '\n    ')}`)
    }
    if (briefLines.length > 1) parts.push(briefLines.join('\n'))
  }
  if (ctx.recentEpisodes && ctx.recentEpisodes.length > 0) {
    parts.push(
      'RECENT EPISODES:\n' +
      ctx.recentEpisodes.map((e, i) =>
        `  ${i + 1}. ${e.title}${e.subtitle ? ` — ${e.subtitle}` : ''}${e.summary ? `\n     ${e.summary}` : ''}`,
      ).join('\n'),
    )
  }
  if (ctx.siblingDocs && Object.keys(ctx.siblingDocs).length > 0) {
    parts.push(
      'EXISTING STRATEGY DOCS (reference these to stay aligned):\n' +
      JSON.stringify(ctx.siblingDocs, null, 2),
    )
  }
  return parts.join('\n\n')
}

// ─────────────────────────────────────────────────────────────────────
// Guest-outreach: unique-sentence generator per prospect
// ─────────────────────────────────────────────────────────────────────
//
// The one sentence that gets swapped in for [unique_sentence] in the
// outreach template. Reads the show's brand + audience + last few
// episodes + notable-guests list AND the prospect's own context so
// the line is specifically about them, tied specifically to this show.
//
// The recipient_type flag is the biggest signal — a note to an agent
// reads differently ("we'd love to have your client Alex on") than a
// note to the guest themselves ("your recent piece on X caught our eye").

export type UniqueSentenceInput = {
  show: {
    name: string
    tagline: string | null
    about: string | null           // Show Brief business_description
    audience: string | null        // Show Brief target_audience
    niche: string | null           // Show Brief niche
    brandVoice: string | null
    notableGuests: string | null   // Free-form list from projects.notable_guests
    recentEpisodes: Array<{ title: string; subtitle: string | null }>
  }
  prospect: {
    name: string
    fullName: string | null
    recipientType: 'person' | 'agent' | 'manager' | 'other'
    clientName: string | null
    context: string | null         // Free-form facts about the prospect
    email?: string | null          // Domain is a strong search disambiguator
  }
}

export type UniqueSentenceResult = {
  sentence: string
  usage: {
    inputTokens: number
    outputTokens: number
  }
}

const UNIQUE_SENTENCE_SYSTEM = `You write ONE sentence for a cold-outreach email to a potential podcast guest — the *reason we're reaching out to THIS person for THIS show*, and nothing else.

If the "Context on them" note already gives you a specific, usable fact (a role, a project, a launch, a recent appearance), WRITE THE SENTENCE STRAIGHT FROM THAT — you do NOT need to search. Only use the web_search tool when the note is thin or empty, or to confirm/enrich a detail. When you do search, use the full name plus any employer, handle, or title you're given — the email address's domain is a strong hint about who and where they are. Run a few searches and stop the moment you have one specific, real, verifiable detail.

Rules:
- Write EXACTLY ONE sentence, 35 words max. Not two, not a paragraph.
- NEVER open with a greeting, a salutation, or the recipient's name. Do NOT start with "Hi", "Hey", "Hello", "Dear", or "<name>," — the email template already opens with "Hi <name>,". Your sentence drops in AFTER that greeting, so it must start straight into the reason (e.g. "We'd love to have you on because…", "Your run on Love Island USA…"). A sentence that begins with a greeting produces a duplicated "Hi <name>" in the email.
- Ground it in a SPECIFIC, REAL detail — name the actual thing (the project, the show they were on, the thing they built). NEVER vague filler like "your recent work", "what you've been putting out lately", or "the way you framed it".
- Pick a FLATTERING hook, not just any true fact. NEVER build the pitch around a loss or a low placement — "finishing fourth", "runner-up", "came in second", "eliminated", "sent home", "didn't win". That reads as a backhanded compliment and kills the pitch. Name a competition placement ONLY if they actually WON or it's a genuine flex; otherwise frame around their story, their relationships, their personality, or the moment they're known for — the reason an audience wants to hear THEM — not the scoreboard. (E.g. for a reality-show cast member who didn't win, lead with their journey / a relationship / who they are, not their ranking.)
- Connect that detail to what THIS show is about, but do NOT describe or summarize the show back at them — there's a link in the email for that.
- NEVER invent facts. State only what you actually found via search or were explicitly told. If search surfaces a different person who happens to share the name, do not use it — only use a detail you're confident belongs to THIS person.
- If the recipient is an agent or manager, the sentence pitches WHY WE WANT THEIR CLIENT ON — search the client, address the agent as the sender, but make the reason about the client. The FIRST time you name the client, use their FULL name exactly as given (e.g. "Amaya Espinal", not just "Amaya") — a bare first name for someone you've never emailed reads as oddly familiar.
- If the recipient is the person themselves, address the reason to them directly.
- No em-dashes if you can avoid them. Write like a person, not a brand.
- If the note gives you ANY real detail about the person, you MUST write the sentence from it. NEVER return INSUFFICIENT_CONTEXT when you were handed real facts — use them.
- Only when the note is empty or vague AND (if you searched) search turned up nothing specific may you flag it. Never fall back to generic praise instead of flagging.

OUTPUT CONTRACT — CRITICAL. Your entire reply is pasted VERBATIM into an email to a real person, so it must be EXACTLY ONE of:
  (a) the single outreach sentence, nothing else — no quotes, no lead-in; OR
  (b) the exact string INSUFFICIENT_CONTEXT, nothing else.
NEVER describe your search, what you did or didn't find, your confidence, or your reasoning. NEVER write things like "based on what I found", "I couldn't verify", "I don't have", "search limit", or "this exact person". If you are not fully confident you hold one specific, real, verifiable detail about THIS person — including if you run out of searches or find only a vague/uncertain match — reply with exactly INSUFFICIENT_CONTEXT and nothing else. A flagged prospect is fine; a hedging paragraph landing in a real person's inbox is a disaster.`

function uniqueSentenceUserBlock(input: UniqueSentenceInput): string {
  const s = input.show
  const p = input.prospect
  const lines: string[] = []
  lines.push('=== THE SHOW ===')
  lines.push(`Name: ${s.name}`)
  if (s.tagline) lines.push(`Tagline: ${s.tagline}`)
  if (s.niche) lines.push(`Niche: ${s.niche}`)
  if (s.about) lines.push(`What it is: ${s.about}`)
  if (s.audience) lines.push(`Audience: ${s.audience}`)
  if (s.brandVoice) lines.push(`Brand voice: ${s.brandVoice.slice(0, 400)}`)
  if (s.notableGuests) lines.push(`Notable past guests: ${s.notableGuests}`)
  if (s.recentEpisodes.length > 0) {
    lines.push('Recent episodes:')
    for (const e of s.recentEpisodes.slice(0, 6)) {
      lines.push(`  - ${e.title}${e.subtitle ? ` — ${e.subtitle}` : ''}`)
    }
  }
  lines.push('')
  lines.push('=== THE RECIPIENT ===')
  lines.push(`First name (for greeting): ${p.name}`)
  if (p.fullName) lines.push(`Full name: ${p.fullName}`)
  lines.push(`Who they are: ${p.recipientType}${p.clientName ? ` for ${p.clientName}` : ''}`)
  if (p.email) lines.push(`Email (the domain is a strong hint for who/where they are): ${p.email}`)
  if (p.context) lines.push(`Context on them: ${p.context}`)
  else lines.push(`Context on them: (none provided — rely on web search)`)
  lines.push('')
  lines.push('Write the one sentence now.')
  return lines.join('\n')
}

// Phrases that only appear when the model is narrating its search or
// hedging about uncertainty — never in a genuine one-line compliment. If
// any show up (or the text runs long), it's not a usable sentence.
const SENTENCE_META_MARKERS = [
  'insufficient', 'search tool', 'search limit', 'tool limit', 'searches',
  "i don't have", 'i do not have', "i couldn't", 'i could not',
  "couldn't verify", 'could not verify', "couldn't find", 'could not find',
  "couldn't confirm", 'could not confirm', 'unable to verify', 'unable to find',
  'unable to confirm', "i wasn't able", 'i was not able',
  'based on what i found', 'based on my search', 'from my search',
  'not a concrete', "isn't a concrete", 'no concrete', 'concrete accomplishment',
  'specific, verifiable', 'verifiable project', 'verifiable credit',
  'not enough context', "don't have enough", 'not confident', 'cannot confirm',
  "can't confirm", 'as an ai', 'i apologize', 'this exact person',
]

function isUnusableSentence(raw: string): boolean {
  const lc = raw.toLowerCase()
  if (raw.toUpperCase().includes('INSUFFICIENT_CONTEXT')) return true
  if (SENTENCE_META_MARKERS.some((m) => lc.includes(m))) return true
  // A real outreach line is one tight sentence (prompt caps it at 35 words).
  // Anything much longer is the model narrating, not writing the line.
  const words = raw.split(/\s+/).filter(Boolean).length
  if (words > 45) return true
  return false
}

// Retry a message create through transient API hiccups — Anthropic 529
// "Overloaded", 429 rate limits, and 5xx blips — with exponential backoff.
// Non-transient errors (bad request, auth) throw immediately.
async function createWithRetry(
  params: Anthropic.MessageCreateParamsNonStreaming,
  maxAttempts = 4,
): Promise<Anthropic.Message> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await client.messages.create(params)
    } catch (err) {
      lastErr = err
      const status = (err as { status?: number })?.status
      const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
      const transient = status === 429 || status === 529 || status === 500 || status === 503
        || msg.includes('overloaded') || msg.includes('rate limit') || msg.includes('rate_limit')
      if (!transient || attempt === maxAttempts) throw err
      const delay = 1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 500) // ~1s, 2s, 4s + jitter
      logInfo('anthropic: transient error, retrying', { attempt, status, delayMs: delay })
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastErr
}

export async function generateUniqueSentence(input: UniqueSentenceInput): Promise<UniqueSentenceResult> {
  logInfo('outreach: generating unique sentence', {
    show: input.show.name,
    prospect: input.prospect.fullName || input.prospect.name,
    recipientType: input.prospect.recipientType,
    contextChars: input.prospect.context?.length ?? 0,
    hasEmail: Boolean(input.prospect.email),
  })
  // If the operator gave us facts, write the sentence STRAIGHT from them —
  // no web search at all. That removes the "search failed → rambled" failure
  // mode entirely. Only reach for search when the note is empty and we have
  // to find something ourselves.
  const hasFacts = (input.prospect.context ?? '').trim().length > 0
  const messages: Anthropic.MessageParam[] = [{
    role: 'user',
    content: [{ type: 'text', text: uniqueSentenceUserBlock(input) }],
  }]
  const params = (): Anthropic.MessageCreateParamsNonStreaming => {
    const p: Anthropic.MessageCreateParamsNonStreaming = {
      model: MODEL,
      max_tokens: hasFacts ? 512 : 4096,
      system: UNIQUE_SENTENCE_SYSTEM,
      messages,
    }
    if (!hasFacts) {
      p.tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }]
    }
    return p
  }

  let response = await createWithRetry(params())
  // web_search runs a server-side tool loop; if it exceeds the internal
  // iteration cap the turn pauses — re-send to let it finish. Bounded so a
  // misbehaving turn can't loop forever.
  let guard = 0
  while (response.stop_reason === 'pause_turn' && guard < 5) {
    guard += 1
    messages.push({ role: 'assistant', content: response.content })
    response = await createWithRetry(params())
  }

  // The sentence is the LAST text block — earlier text blocks can be the
  // model reasoning out loud between searches.
  const texts = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text')
  let raw = (texts.length ? texts[texts.length - 1].text : '').trim()
    .replace(/^["'`]|["'`]$/g, '')
    .replace(/^(sentence|response):\s*/i, '')
    .trim()
  // Belt-and-suspenders: the email template already opens with "Hi <name>,".
  // If the model still led with its own greeting/salutation, strip it so the
  // recipient doesn't get a doubled "Hi <name>". Handles "Hi Steven, we'd…",
  // "Hey there —", "Hello Dr. Lee:", etc. — remove the leading salutation and
  // re-capitalize what's left.
  {
    const stripped = raw.replace(
      /^(hi|hey|hello|dear|greetings|hi there|hey there)\b[^,:—-]*[,:—-]\s*/i,
      '',
    )
    if (stripped && stripped !== raw) {
      raw = stripped.charAt(0).toUpperCase() + stripped.slice(1)
    }
  }
  // Guard: the model sometimes narrates its search or hedges instead of
  // returning a clean sentence or the exact flag. Any such output would be
  // pasted verbatim into a real email, so reject it and flag the prospect
  // rather than let a "based on what I found, I couldn't verify…" paragraph
  // go out. Better a flagged prospect than an embarrassing send.
  if (!raw || isUnusableSentence(raw)) {
    throw new Error('insufficient_context')
  }
  return {
    sentence: raw,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────
// Auto-populate a show's one-sheet from its episode list
// ─────────────────────────────────────────────────────────────────────
//
// Producers point Slate at a show and get back: hero tagline, guest
// pitch (what recording looks like), notable past guests, and a brand
// color. Everything's just a starting point — the operator edits after.

export type OneSheetAutoInput = {
  showName: string
  showSubtitle: string | null
  brandVoice: string | null
  briefDescription: string | null      // from Show Brief business_description
  briefAudience: string | null
  briefMetrics: string | null
  episodes: Array<{ title: string; subtitle: string | null }>
}

export type OneSheetAutoResult = {
  heroTagline: string
  guestPitch: string
  notableGuests: string       // comma-separated
  notableTopics: string       // comma-separated
  brandHex: string            // 6-char hex including #
  usage: { inputTokens: number; outputTokens: number }
}

const ONE_SHEET_AUTO_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hero_tagline', 'guest_pitch', 'notable_guests', 'notable_topics', 'brand_hex'],
  properties: {
    hero_tagline: {
      type: 'string',
      description: 'One-sentence show description for the hero. Concrete, specific to this show, not generic. Under 200 chars.',
    },
    guest_pitch: {
      type: 'string',
      description: 'What guesting on this show is like — recording format, length, what guests get. Two crisp, upbeat sentences. Write with confidence. NEVER include caveats, format notes, or parentheticals like "(format not specified)" — if you don\'t have enough information about the recording setup, invent a reasonable industry-standard default (45-minute conversation, edited into a polished cut, guests get the audio + a highlight clip package).',
    },
    notable_guests: {
      type: 'string',
      description: 'Comma-separated list of names of past guests. Extract from episode titles + subtitles + business description + anywhere else they appear. Names to look for: "w/ NAME", "with NAME", "feat. NAME", "featuring NAME", "hosted by NAME", or a person\'s name that appears as the episode title itself. Up to 12 names. If truly none can be identified, return the empty string "".',
    },
    notable_topics: {
      type: 'string',
      description: 'Comma-separated list of the 5-8 subject areas / themes this show explores. Derive from the show description, niche, brand voice, and episode titles. Concrete themes, not filler ("Modern relationships", "Career reinvention", "Post-industry storytelling"), NOT generic ("Interviews", "Life").',
    },
    brand_hex: {
      type: 'string',
      description: 'A 6-digit hex color starting with # that matches the show\'s vibe. Adult/alt shows lean pink/magenta; business shows lean navy/gold; comedy shows lean yellow/orange; interview shows lean deep amber.',
    },
  },
} as const

const ONE_SHEET_AUTO_SYSTEM = `You draft the copy for a show's public "one-sheet" pitch page — the URL guests land on when we email them. Your output goes to the show's producer to edit; treat it as a first draft, not a final publish.

Rules:
- Hero tagline: One sentence that tells a stranger what this show actually is. Concrete. No "join us as we explore" nonsense.
- Guest pitch: Describe what recording is like based on the show's format (remote/in-studio, video/audio-only, length, edit). If the format isn't obvious from the metadata, write a reasonable default AND flag it as such.
- Notable guests: Extract from episode titles/subtitles. Look for patterns like "w/ NAME", "with NAME", "feat. NAME", or a name in the title itself. Only include names you're confident about. If you can't find guest names, return "" — don't invent.
- Brand hex: Match the show's actual vibe. Adult/lifestyle → hot pink or magenta. Business/interview → deep amber or navy. Comedy → gold/orange. Serious/documentary → dark red or deep blue.

Return ONLY the JSON.`

export async function generateOneSheetAuto(input: OneSheetAutoInput): Promise<OneSheetAutoResult> {
  const lines: string[] = []
  lines.push(`Show: ${input.showName}`)
  if (input.showSubtitle) lines.push(`Subtitle: ${input.showSubtitle}`)
  if (input.brandVoice) lines.push(`Brand voice notes: ${input.brandVoice.slice(0, 500)}`)
  if (input.briefDescription) lines.push(`\nWhat it is: ${input.briefDescription}`)
  if (input.briefAudience) lines.push(`Audience: ${input.briefAudience}`)
  if (input.briefMetrics) lines.push(`Reach: ${input.briefMetrics}`)
  if (input.episodes.length > 0) {
    lines.push('\nEpisodes (use titles + subtitles to extract guest names):')
    for (const e of input.episodes.slice(0, 40)) {
      lines.push(`  - ${e.title}${e.subtitle ? ` — ${e.subtitle}` : ''}`)
    }
  }
  logInfo('one-sheet auto: generating', { show: input.showName, episodes: input.episodes.length })
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: ONE_SHEET_AUTO_SYSTEM,
    messages: [{
      role: 'user',
      content: [{
        type: 'text',
        text: lines.join('\n'),
        cache_control: { type: 'ephemeral' },
      }],
    }],
    output_config: { format: { type: 'json_schema', schema: ONE_SHEET_AUTO_SCHEMA } },
  })
  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') throw new Error('one-sheet auto: no text block')
  const parsed = JSON.parse(textBlock.text) as {
    hero_tagline: string; guest_pitch: string; notable_guests: string;
    notable_topics: string; brand_hex: string
  }
  return {
    heroTagline: parsed.hero_tagline,
    guestPitch: parsed.guest_pitch,
    notableGuests: parsed.notable_guests,
    notableTopics: parsed.notable_topics,
    brandHex: parsed.brand_hex,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  }
}

export async function generateSocialStrategyDocument(
  input: StrategyGenerateInput,
): Promise<StrategyGenerateResult> {
  logInfo('strategy: generating', {
    showName: input.projectContext.showName,
    kind: input.kind,
    inputContextChars: input.inputContext?.length ?? 0,
  })
  const schema = STRATEGY_SCHEMAS[input.kind]
  const system = STRATEGY_SYSTEM_PROMPTS[input.kind]
  const userBlocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = [
    {
      type: 'text',
      text: strategyProjectBlock(input.projectContext),
      cache_control: { type: 'ephemeral' },
    },
  ]
  if (input.inputContext && input.inputContext.trim().length > 0) {
    userBlocks.push({
      type: 'text',
      text: `OPERATOR INPUT (paste field):\n${input.inputContext.trim()}`,
    })
  }
  let response
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system,
      messages: [{ role: 'user', content: userBlocks }],
      output_config: { format: { type: 'json_schema', schema } },
    })
  } catch (err) {
    logError('strategy: claude call failed', { kind: input.kind, error: err instanceof Error ? err.message : String(err) })
    throw err
  }
  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('strategy: claude returned no text block')
  }
  let content: unknown
  try {
    content = JSON.parse(textBlock.text)
  } catch (err) {
    logError('strategy: invalid JSON from claude', { kind: input.kind, body: textBlock.text.slice(0, 500) })
    throw new Error(`strategy: invalid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  logInfo('strategy: generated', {
    kind: input.kind,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  })
  return {
    content,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
    },
  }
}

// ── Clip moment selection ───────────────────────────────────────────
//
// Owns the "which moments are worth clipping" decision that OpusClip
// used to make in a black box. Claude reads the episode transcript
// (blocks prefixed with [HH:MM:SS]) and returns a ranked set of clip
// windows with exact in/out seconds. The ffmpeg cutter turns each into
// a vertical captioned short. Keeping selection in-house means it uses
// the show's own voice/context instead of a generic virality model.

export type ClipMomentInput = {
  showName: string
  transcript: string // timecoded blocks, "[HH:MM:SS] Speaker: text"
  focus?: string | null // optional plain-English steer from the user
  count?: number | null // desired number of clips (default 12; range 7-15)
  // What the show is about — its description / show notes / niche /
  // audience. This is the primary "based on the show" signal and comes
  // from data already on the show record; no one has to fill in a field.
  showDescription?: string | null
  brandVoice?: string | null // the show's voice, if set (bonus signal)
  vocabulary?: string | null // names/terms that signal what matters
}

export type ClipMoment = {
  startSeconds: number
  endSeconds: number
  title: string
  reason: string
}

const CLIP_PICKER_SYSTEM = `You are a senior short-form video editor for a podcast network.

Given an episode transcript, pick the moments that will actually perform
as standalone vertical clips (Reels / TikTok / Shorts) FOR THIS SPECIFIC
SHOW. Each transcript block is prefixed with its start time as [HH:MM:SS].

Fit the show: use the show's description / show notes (and voice, if
given) to judge what THIS show and THIS audience actually care about —
the recurring themes, the kind of beat this show is known for — and
weight those moments over generic "viral" ones that could come from any
podcast. The transcript tells you what was said; the show description
tells you which of it matters to this audience.

What makes a good pick:
- A self-contained beat: a story, a hot take, a surprising fact, a big
  laugh, a genuine emotional turn. It must make sense with NO outside
  context and open on a strong line.
- 20-75 seconds long. Never cut mid-sentence at the start or end —
  start on the first word of the thought, end on the last.
- Skip intros, ad reads, housekeeping, and rambly setup with no payoff.
- Pick DISTINCT moments — no two clips covering the same ground.

HOW MANY: return between 7 and 15 clips. Give as many genuinely strong,
distinct options as the episode supports — aim for the target the user
asks for, but never drop below 7 when there's material, and never pad
the list with weak picks to hit a number.

Return ONLY a JSON array (no prose, no code fences), each element:
{"startSeconds": <int>, "endSeconds": <int>, "title": "<=8 word hook", "reason": "one line: why it lands"}
Order best-first. startSeconds/endSeconds are whole seconds from the
start of the recording, derived from the [HH:MM:SS] timecodes.`

export async function pickClipMoments(input: ClipMomentInput): Promise<ClipMoment[]> {
  // Default to 12 — squarely in the 7-15 band we want per episode.
  const target = input.count && input.count > 0 && input.count <= 20 ? Math.round(input.count) : 12
  // Accept up to 15 even when the aim is lower, so a rich episode can
  // surface the full slate of options.
  const hardMax = Math.min(20, Math.max(target, 15))
  const focus = input.focus?.trim()
  const user = [
    `Show: ${input.showName}`,
    input.showDescription?.trim() ? `About this show (description / show notes):\n${input.showDescription.trim().slice(0, 2500)}` : '',
    input.brandVoice?.trim() ? `Show voice: ${input.brandVoice.trim().slice(0, 1200)}` : '',
    input.vocabulary?.trim() ? `Names / terms that matter to this show: ${input.vocabulary.trim().slice(0, 600)}` : '',
    `Aim for about ${target} clips (7-15 range).`,
    focus ? `Editor's steer (weight this heavily): ${focus}` : '',
    '',
    'TRANSCRIPT:',
    input.transcript,
  ].filter(Boolean).join('\n')

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: CLIP_PICKER_SYSTEM,
    messages: [{ role: 'user', content: user }],
  })
  const block = response.content.find((b) => b.type === 'text')
  const text = block && block.type === 'text' ? block.text : ''
  // Tolerate stray prose / fences around the JSON array.
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('clip_picker_no_json')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new Error('clip_picker_bad_json')
  }
  if (!Array.isArray(parsed)) throw new Error('clip_picker_not_array')

  const moments: ClipMoment[] = []
  for (const raw of parsed) {
    const r = (raw ?? {}) as Record<string, unknown>
    const s = Number(r.startSeconds)
    const e = Number(r.endSeconds)
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue
    // Guard against a runaway end timecode; clamp to a 90s ceiling.
    const end2 = e - s > 90 ? s + 90 : e
    moments.push({
      startSeconds: Math.max(0, Math.round(s)),
      endSeconds: Math.round(end2),
      title: typeof r.title === 'string' ? r.title.slice(0, 120) : 'Clip',
      reason: typeof r.reason === 'string' ? r.reason.slice(0, 300) : '',
    })
    if (moments.length >= hardMax) break
  }
  return moments
}

// ── Vertical crop framing (vision) ──────────────────────────────────
//
// Clips are picked from the transcript (blind to the picture). Before
// we crop a clip to full-bleed 9:16, we actually LOOK: a few frames go
// to Claude's vision, which reports where the speaker is so the crop
// keeps them in frame instead of guessing a center crop.

const VISION_MODEL = 'claude-sonnet-4-6'

export type VerticalCrop = { centerX: number; confident: boolean }

const CROP_SYSTEM = `You are framing a landscape video clip for a 9:16 vertical crop
(TikTok / Reels / Shorts). You'll see a few frames sampled from ONE clip.

Find the MAIN SPEAKER — the most prominent person / the one talking. Report where
to center a tall 9:16 crop so that person stays comfortably in frame across the clip.

Return ONLY JSON, no prose:
{"centerX": <number 0..1>, "confident": <boolean>}
  - centerX: horizontal center for the crop. 0 = far left, 0.5 = middle, 1 = far right.
  - confident: true if there is a clear single subject to follow; false if it's a wide
    shot, two people far apart, or no clear subject (we'll fall back to a safe framing).`

export async function pickVerticalCrop(frames: Buffer[]): Promise<VerticalCrop> {
  if (!hasAnthropicKey() || frames.length === 0) return { centerX: 0.5, confident: false }
  const content: Anthropic.MessageParam['content'] = [
    ...frames.map((b) => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: b.toString('base64') },
    })),
    { type: 'text' as const, text: 'Frames from one clip, left-to-right in time. Where should the vertical crop be centered?' },
  ]
  const response = await client.messages.create({
    model: VISION_MODEL,
    max_tokens: 100,
    system: CROP_SYSTEM,
    messages: [{ role: 'user', content }],
  })
  const block = response.content.find((b) => b.type === 'text')
  const text = block && block.type === 'text' ? block.text : ''
  const s = text.indexOf('{'), e = text.lastIndexOf('}')
  if (s === -1 || e <= s) return { centerX: 0.5, confident: false }
  try {
    const parsed = JSON.parse(text.slice(s, e + 1)) as { centerX?: unknown; confident?: unknown }
    const cx = Number(parsed.centerX)
    return {
      centerX: Number.isFinite(cx) ? Math.max(0, Math.min(1, cx)) : 0.5,
      confident: parsed.confident === true,
    }
  } catch {
    return { centerX: 0.5, confident: false }
  }
}

export type VerticalTrack = { path: number[]; confident: boolean }

const TRACK_SYSTEM = `You are tracking the main speaker across a landscape video clip so it
can be cropped to a moving 9:16 vertical that FOLLOWS them.

You will see N frames sampled about 1 per second, in time order. For EACH frame, report
the horizontal center (0..1) where a tall 9:16 crop should sit so the main speaker stays
framed in that moment: 0 = far left, 0.5 = middle, 1 = far right. Track the SAME person
across frames; move the value as they move.

Return ONLY JSON, no prose:
{"path": [<centerX for frame 1>, <frame 2>, ... exactly N values], "confident": <boolean>}
  - path length MUST equal the number of frames.
  - confident: true if there's a clear speaker to follow; false for a wide shot with no
    clear subject (caller will fall back to safe framing).`

// Per-frame tracking: one centerX for each ~1s frame, so the crop can
// follow the speaker instead of holding a single static position.
export async function trackVerticalCrop(frames: Buffer[]): Promise<VerticalTrack> {
  const n = frames.length
  if (!hasAnthropicKey() || n === 0) return { path: [], confident: false }
  const content: Anthropic.MessageParam['content'] = [
    ...frames.map((b) => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: b.toString('base64') },
    })),
    { type: 'text' as const, text: `These are the ${n} frames in time order. Return the path array with exactly ${n} values.` },
  ]
  const response = await client.messages.create({
    model: VISION_MODEL,
    max_tokens: 1500,
    system: TRACK_SYSTEM,
    messages: [{ role: 'user', content }],
  })
  const block = response.content.find((b) => b.type === 'text')
  const text = block && block.type === 'text' ? block.text : ''
  const s = text.indexOf('{'), e = text.lastIndexOf('}')
  if (s === -1 || e <= s) return { path: [], confident: false }
  try {
    const parsed = JSON.parse(text.slice(s, e + 1)) as { path?: unknown; confident?: unknown }
    let arr = Array.isArray(parsed.path) ? parsed.path.map((v) => Number(v)) : []
    arr = arr.map((v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5))
    // Reconcile length with the frame count: pad by repeating the last
    // value, or truncate.
    if (arr.length === 0) return { path: [], confident: false }
    while (arr.length < n) arr.push(arr[arr.length - 1])
    if (arr.length > n) arr = arr.slice(0, n)
    return { path: arr, confident: parsed.confident === true }
  } catch {
    return { path: [], confident: false }
  }
}

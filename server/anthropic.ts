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

This lets the editor jump straight to the moment and lets us hand
OpusClip an exact cut directive.

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

export type GenerateInput = {
  showName: string
  showSubtitle?: string | null
  brandVoice: string
  examplePosts: string[]
  // Per-show "must spell these correctly" list. Free-form text; the
  // team types one name/term per line (e.g. "Cheri Oteri" not "Sherri
  // O'Teri") so phonetic transcripts can't corrupt the spelling of
  // recurring guests, show titles, brand terms, etc.
  vocabulary?: string
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

function showMetadataBlock(input: GenerateInput): string {
  const lines: string[] = []
  lines.push(`SHOW: ${input.showName}`)
  if (input.showSubtitle) lines.push(`SHOW DESCRIPTION: ${input.showSubtitle}`)
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

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
                       image_direction is a brief direction for the
                       photographer. caption is the IG caption text.
                       vibe is a 2-4 word mood.

Voice:
  - Match the show's brand voice exactly. The provided EXAMPLES are
    authoritative — copy their tone, vocabulary, sentence length, and
    formatting. Do not introduce a different voice.
  - If no examples are provided, default to clean, conversational,
    on-brand-for-the-show-name.

For every concept (story / reel / photo): be specific. Reference real
names, real quotes, real moments from the transcript. Avoid generic ideas
("clip a funny moment").

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

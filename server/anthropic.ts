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

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

Given an episode transcript, you produce a single day's social content plan.
Every plan has exactly the same shape and counts:

  - 5 text_posts  : long-form posts for X / Bluesky / Threads. 1–2 sentences
                    each, hook-led. No hashtags unless the show explicitly
                    uses them in its examples.
  - 4 story_texts : short, punchy copy for Instagram Stories. <100 chars.
                    Designed to overlay on a still or short clip.
  - 3 reel_concepts: each is { hook, talking_points (3-5 bullets), suggested_clip }.
                    suggested_clip references an actual moment, quote, or
                    exchange from the transcript (with a timestamp range if
                    you can infer one, otherwise a paraphrased moment).
  - 3 photo_concepts: each is { image_direction, caption, vibe }. image_direction
                    is a brief direction for the photographer/designer.
                    caption is the IG caption text. vibe is a 2-4 word mood.

Voice:
  - Match the show's brand voice exactly. The provided EXAMPLES are
    authoritative — copy their tone, vocabulary, sentence length, and
    formatting. Do not introduce a different voice.
  - If no examples are provided, default to clean, conversational,
    on-brand-for-the-show-name.

Reels and photos: be specific. Reference real names, real quotes, real
moments from the transcript. Avoid generic ideas ("clip a funny moment").

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
    story_texts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
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
  required: ['text_posts', 'story_texts', 'reel_concepts', 'photo_concepts'],
  additionalProperties: false,
}

export type RawSocialPlan = {
  text_posts: Array<{ text: string }>
  story_texts: Array<{ text: string }>
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
    storyTexts: plan.story_texts.length,
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

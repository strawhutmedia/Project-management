// Final Draft (.fdx) parser. Extracts numbered scenes with their slug,
// page eighths, page, and tagged characters. We hand-roll regex against the
// XML rather than pull a heavy DOM library — FD's structure is regular and
// predictable.

export type ParsedScene = {
  number: string
  scriptPosition: number
  slug: string
  intExt: string | null
  location: string | null
  locationTag: string | null
  timeOfDay: string | null
  page: number | null
  pageEighths: number
  characters: string[]
  // Body text of the scene (Action + Dialogue paragraphs that follow the
  // scene heading until the next heading). Cached so Claude can read it
  // later for a budget breakdown without re-parsing the .fdx.
  actionText: string
}

// All paragraphs, in order. Type-agnostic — we sort by Type after.
const ANY_PARA_RE = /<Paragraph(?:\s[^>]*)?>([\s\S]*?)<\/Paragraph>/gi
const TYPE_ATTR_RE = /\sType="([^"]+)"/i
const PARA_RE = /<Paragraph(?:\s[^>]*)?\sType="Scene Heading"[^>]*>([\s\S]*?)<\/Paragraph>/gi
const NUMBER_ATTR_RE = /\sNumber="([^"]+)"/i
const LENGTH_ATTR_RE = /\sLength="([^"]+)"/i
const PAGE_ATTR_RE = /\sPage="([^"]+)"/i
const CHARACTER_BEAT_RE = /<CharacterArcBeat\s+Name="([^"]+)"/gi
const TEXT_INNER_RE = /<Text[^>]*>([\s\S]*?)<\/Text>/g

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function parseLengthToEighths(raw: string): number {
  const t = raw.trim()
  if (!t) return 0
  const mixed = t.match(/^(\d+)\s+(\d+)\/8$/)
  if (mixed) return parseInt(mixed[1], 10) * 8 + parseInt(mixed[2], 10)
  const fraction = t.match(/^(\d+)\/8$/)
  if (fraction) return parseInt(fraction[1], 10)
  const whole = t.match(/^(\d+)$/)
  if (whole) return parseInt(whole[1], 10) * 8
  return 0
}

const TIME_TOKENS = [
  'DAY', 'NIGHT', 'AFTERNOON', 'MORNING', 'EVENING', 'LATER',
  'MOMENTS LATER', 'CONTINUOUS', 'THE NEXT DAY', 'MAGIC HOUR',
  'DAWN', 'DUSK', 'SAME', 'SAME TIME', 'MONTAGE', 'BACK TO PRESENT',
  'SUNSET', 'SUNRISE', 'TIME PASSES', 'DAYS LATER', 'WEEKS LATER',
  'INTERCUT', 'SIMULTANEOUS',
]

function splitSlug(slug: string): { intExt: string | null; location: string | null; timeOfDay: string | null } {
  const upper = slug.toUpperCase().replace(/\s+/g, ' ').trim()
  let intExt: string | null = null
  let rest = upper
  const intExtMatch = rest.match(/^(INT\.?\s*\/?\s*EXT\.?|INT\.?|EXT\.?|I\/E\.?)\s+/)
  if (intExtMatch) {
    const tag = intExtMatch[1].replace(/\./g, '').replace(/\s/g, '')
    intExt = tag === 'INT/EXT' || tag === 'I/E' ? 'INT/EXT' : tag
    rest = rest.slice(intExtMatch[0].length)
  }
  const segments = rest.split(/\s+-\s+/).map((s) => s.trim()).filter(Boolean)
  let timeOfDay: string | null = null
  if (segments.length >= 2) {
    const last = segments[segments.length - 1]
    if (TIME_TOKENS.some((tok) => last === tok || last.startsWith(tok))) {
      timeOfDay = last
      segments.pop()
    }
  }
  const location = segments.join(' - ').trim() || null
  return { intExt, location, timeOfDay }
}

function tagify(s: string | null): string | null {
  if (!s) return null
  return s.toLowerCase().replace(/'/g, '').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || null
}

function paragraphText(block: string): string {
  let textBlock = block
  const propsEnd = textBlock.indexOf('</SceneProperties>')
  if (propsEnd >= 0) textBlock = textBlock.slice(propsEnd + '</SceneProperties>'.length)
  const textPieces: string[] = []
  const textRe = new RegExp(TEXT_INNER_RE.source, 'g')
  let tMatch: RegExpExecArray | null
  while ((tMatch = textRe.exec(textBlock)) !== null) {
    textPieces.push(decodeEntities(tMatch[1]))
  }
  return textPieces.join('').replace(/\s+/g, ' ').trim()
}

export function parseFdx(xml: string): ParsedScene[] {
  const scenes: ParsedScene[] = []
  // Buffer of action/dialogue lines for the scene currently being built.
  // Flushed into scenes[scenes.length - 1].actionText when the next scene
  // heading appears (or at end of file).
  let bodyBuf: string[] = []
  let scriptPosition = 0
  const paraRe = new RegExp(ANY_PARA_RE.source, 'gi')
  let match: RegExpExecArray | null

  function flush() {
    if (scenes.length === 0) return
    scenes[scenes.length - 1].actionText = bodyBuf.join('\n').trim()
    bodyBuf = []
  }

  while ((match = paraRe.exec(xml)) !== null) {
    const block = match[0]
    const typeMatch = block.match(TYPE_ATTR_RE)
    const type = typeMatch ? typeMatch[1] : ''

    if (type === 'Scene Heading') {
      flush()
      const numberMatch = block.match(NUMBER_ATTR_RE)
      if (!numberMatch) continue
      const number = numberMatch[1].trim()
      const lengthMatch = block.match(LENGTH_ATTR_RE)
      const pageMatch = block.match(PAGE_ATTR_RE)
      const pageEighths = lengthMatch ? parseLengthToEighths(lengthMatch[1]) : 0
      const page = pageMatch ? parseInt(pageMatch[1], 10) : null

      const characters: string[] = []
      let cMatch: RegExpExecArray | null
      const charRe = new RegExp(CHARACTER_BEAT_RE.source, 'gi')
      while ((cMatch = charRe.exec(block)) !== null) {
        const name = decodeEntities(cMatch[1]).toUpperCase().replace(/\s+/g, ' ').trim()
        if (name && !characters.includes(name)) characters.push(name)
      }

      const slug = paragraphText(block)
      const { intExt, location, timeOfDay } = splitSlug(slug)
      scriptPosition += 1
      scenes.push({
        number,
        scriptPosition,
        slug,
        intExt,
        location,
        locationTag: tagify(location),
        timeOfDay,
        page,
        pageEighths,
        characters,
        actionText: '',
      })
      continue
    }

    // Buffer action / dialogue / parentheticals / character cues / transitions
    // / shots. Skip "General" since it's usually layout (page breaks, slug
    // breaks). Anything we keep gets joined with newlines.
    if (scenes.length === 0) continue
    if (type === 'General') continue
    const text = paragraphText(block)
    if (!text) continue
    if (type === 'Character') {
      bodyBuf.push(`\n${text}:`)
    } else if (type === 'Parenthetical') {
      bodyBuf.push(`  (${text})`)
    } else if (type === 'Dialogue') {
      bodyBuf.push(`  ${text}`)
    } else if (type === 'Transition') {
      bodyBuf.push(`[${text}]`)
    } else {
      bodyBuf.push(text)
    }
  }
  flush()
  return scenes
}

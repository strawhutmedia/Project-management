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
}

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

export function parseFdx(xml: string): ParsedScene[] {
  const scenes: ParsedScene[] = []
  let scriptPosition = 0
  let match: RegExpExecArray | null
  const paraRe = new RegExp(PARA_RE.source, 'gi')
  while ((match = paraRe.exec(xml)) !== null) {
    const block = match[0]
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

    let textBlock = block
    const propsEnd = textBlock.indexOf('</SceneProperties>')
    if (propsEnd >= 0) textBlock = textBlock.slice(propsEnd + '</SceneProperties>'.length)
    const textPieces: string[] = []
    const textRe = new RegExp(TEXT_INNER_RE.source, 'g')
    let tMatch: RegExpExecArray | null
    while ((tMatch = textRe.exec(textBlock)) !== null) {
      textPieces.push(decodeEntities(tMatch[1]))
    }
    const slug = textPieces.join('').replace(/\s+/g, ' ').trim()
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
    })
  }
  return scenes
}

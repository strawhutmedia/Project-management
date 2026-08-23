// Guest names for an episode, taken ONLY from the episode title.
//
// Ported deliberately from Podbooster's extractGuests (routes/rss.js) rather
// than reimplemented: it is proven against thousands of real podcast titles,
// and — crucially — it CANNOT invent a name. Every name it returns is literally
// present in the title. An AI-generated guest list looked fine in testing and
// then quietly attributed the wrong people, which is worse than showing nothing.
//
// The failure mode here is returning [] and rendering nothing. That's the
// correct trade: no guest line beats a wrong guest line.

const NAME_CHUNK =
  /[A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+){1,3}(?:,\s*(?:and\s+)?[A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+){1,3})*/;

const ROLE_WORDS =
  /^(Director|Producer|Actor|Actress|Host|Author|Writer|Editor|Chef|Coach|Doctor|Professor|Judge|Senator|Governor|President|CEO|CFO|CTO|COO|Founder|Manager|Designer|Engineer|Comedian|Musician|Singer|Rapper|Composer|Photographer|Cinematographer)$/i;

function splitNameList(raw) {
  return raw
    // '&' added to Podbooster's separators: plenty of Straw Hut titles read
    // "A & B" where theirs would only catch "A and B" or "A, B".
    .split(/,\s*(?:and\s+)?|\s+and\s+|\s*&\s*/)
    .map((n) => n.trim())
    .filter((n) => /^[A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+){0,3}$/.test(n));
}

export function extractGuests(episodeTitle, showTitle) {
  const t = String(episodeTitle || '');
  const podcastNorm = String(showTitle || '').toLowerCase().trim();

  const isRealName = (n) => {
    const trimmed = n.trim();
    if (!trimmed) return false;
    if (!trimmed.includes(' ')) return false;            // needs first + last
    if (ROLE_WORDS.test(trimmed)) return false;          // "Director", not a name
    if (/^[A-Z][A-Z\s]+$/.test(trimmed)) return false;   // ALL CAPS = section header
    if (podcastNorm && trimmed.toLowerCase() === podcastNorm) return false;
    if (podcastNorm && podcastNorm.includes(trimmed.toLowerCase())) return false;
    return true;
  };

  const patterns = [
    new RegExp(`\\bwith\\s+(${NAME_CHUNK.source})`),
    new RegExp(`\\bfeat(?:uring|\\.)?\\s+(${NAME_CHUNK.source})`, 'i'),
    new RegExp(`\\binterview(?:ing)? with\\s+(${NAME_CHUNK.source})`, 'i'),
    new RegExp(`^(${NAME_CHUNK.source})\\s*:`),
    new RegExp(`^(${NAME_CHUNK.source})\\s+(?:on|talks|shares|reveals|explains)`, 'i'),
    // Straw Hut titles often just lead with the names: "Jeff Hanna & Billy Bob
    // Thornton, his Oscar-winning ex-roadie!"
    new RegExp(`^(${NAME_CHUNK.source}(?:\\s*&\\s*${NAME_CHUNK.source})?)\\s*[,—-]`),
    // ...or the whole title is just the names: "Ben Giroux & Tawny Platis"
    new RegExp(`^(${NAME_CHUNK.source}(?:\\s*&\\s*${NAME_CHUNK.source})?)$`),
  ];

  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      const real = splitNameList(m[1]).filter(isRealName);
      if (real.length) return real.slice(0, 4);
    }
  }
  const rolePrefix = t.match(
    /\bwith\s+(?:[\w]+\s+(?:of\s+)?[\w]+\s+)?(?:of\s+[\w]+\s+)?((?:[A-Z][a-z]+\s+){1,2}[A-Z][a-z]+)/
  );
  if (rolePrefix && isRealName(rolePrefix[1].trim())) return [rolePrefix[1].trim()];
  return [];
}

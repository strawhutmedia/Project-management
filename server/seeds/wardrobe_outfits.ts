// Auto-assign wardrobe outfit numbers for "Back In Your Arms".
//
// Derived from the story-day continuity analysis (see
// docs/refs/biya-assets/wardrobe/story-day-wardrobe.md). Each character's
// outfits are numbered independently in story order; recurring looks share
// a number (Sawyer's stakeout look = #13 across the whole surveillance
// montage; Kendrick's "Jack Robbins" XenoSouls TV costume = #16), and
// asleep-in-clothes carries keep the same number across a day boundary.
//
// Applied on boot to WARDROBE breakdown items whose outfit_number is still
// blank — it NEVER overwrites a number the costume team has set or changed,
// so producers stay in control and just adjust what they disagree with.
import { pool } from '../db'
import { logInfo, logError } from '../diag'

// character -> { sceneNumber -> outfitNumber }
const WARDROBE_OUTFIT_MAP: Record<string, Record<string, number>> = {"SAWYER":{"3":1,"4":1,"5":1,"6":1,"7":1,"8":2,"9":2,"10":2,"11":2,"12":2,"13":2,"14":3,"15":3,"16":4,"17":5,"18":6,"19":6,"20":6,"21":7,"23":7,"24":7,"25":8,"26":8,"27":8,"28":8,"29":8,"30":8,"31":9,"32":9,"33":10,"34":10,"35":10,"36":11,"37":11,"38":12,"39":12,"40":12,"41":12,"42":12,"43":13,"44":13,"45":13,"46":13,"47":13,"48":13,"49":13,"50":13,"51":13,"52":13,"53":13,"54":13,"55":13,"56":13,"57":13,"58":13,"59":13,"60":13,"61":13,"62":13,"63":13,"64":13,"65":14,"66":13,"67":15,"68":15,"69":15,"70":15,"71":15,"72":15,"73":15,"74":15,"75":15,"76":15,"77":15,"78":15,"79":15,"80":15,"81":15,"82":15,"83":15,"84":16,"85":16,"86":16,"87":16,"88":17,"89":17,"90":17,"91":17,"92":18,"93":18,"94":19,"95":20,"96":20,"97":21,"98":21,"99":22,"100":22,"101":23,"102":23,"103":23,"104":23,"105":23,"106":23,"107":24,"108":24,"109":25,"110":25,"111":25,"112":25,"113":25,"114":25,"115":25,"116":26,"117":26,"118":26,"119":26,"120":26,"121":27,"122":27,"123":27,"124":27,"126":28,"127":28,"128":28,"129":28,"130":28,"131":28,"132":28,"133":28,"134":28,"135":28,"136":28,"137":28,"139":28,"141":28,"142":29,"143":29,"144":29,"145":29,"146":29,"147":29,"149":30,"150":30,"151":30,"152":30,"153":31,"155":31,"156":31,"157":31,"158":32,"159":32,"160":33,"161":33},"KENDRICK":{"1":17,"7":16,"13":16,"16":16,"24":16,"29":16,"41":1,"45":2,"47":3,"48":3,"51":4,"52":4,"54":5,"55":6,"56":6,"57":7,"58":7,"59":7,"60":7,"61":7,"62":7,"63":7,"64":7,"69":8,"78":8,"79":8,"85":9,"98":16,"99":10,"103":11,"104":11,"106":16,"109":12,"110":12,"112":12,"113":12,"114":12,"115":12,"118":13,"119":13,"120":13,"129":14,"130":14,"131":14,"132":14,"133":14,"134":14,"135":14,"136":14,"137":14,"138":14,"140":14,"151":15,"152":15,"160":16},"AARON":{"4":1,"5":1,"6":1,"24":2,"33":3,"86":4,"87":4,"88":5,"90":5,"94":6,"95":7},"MARGO":{"1":6,"42":1,"65":2,"84":3,"116":4,"134":5},"JUSTINE":{"4":1,"5":1,"33":2,"68":3,"124":4},"NADIA":{"4":1,"5":1,"6":1,"18":2,"26":3,"33":4},"TOM":{"4":1,"5":1,"33":2,"68":3},"ANNA":{"142":1,"143":1,"144":1,"145":1,"146":1,"147":1,"161":2},"SCOTT":{"3":1,"17":2},"BERNARD":{"14":1,"21":2,"158":3,"159":3},"LILLY":{"119":1,"120":1},"ALEX":{"119":1,"120":1}}

const KNOWN = ['SAWYER', 'KENDRICK', 'AARON', 'MARGO', 'JUSTINE', 'NADIA', 'TOM', 'ANNA', 'SCOTT', 'BERNARD', 'LILLY', 'ALEX']

// One-time corrections to a previously auto-assigned value. Only replaces
// the exact old auto value, so a number the producer changed is never
// touched. Keyed by sceneNumber -> character -> { from, to }.
// - Scene 1 (prologue): its own unique looks, NOT the stab-night reuse.
const CORRECTIONS: Record<string, Record<string, { from: string; to: string }>> = {
  '1': { KENDRICK: { from: '14', to: '17' }, MARGO: { from: '5', to: '6' } },
}

// Parse the character key off a WARDROBE description like
// "Sawyer wardrobe, surveillance/casual day" or "JASON KENDRICK: suit".
function canonicalCharacter(desc: string): string | null {
  const s = (desc ?? '').trim()
  if (!s) return null
  let name: string
  const colon = s.indexOf(':')
  if (colon > 0 && colon <= 28) {
    name = s.slice(0, colon)
  } else {
    const m = s.match(/^([A-Za-z][\w'’-]*(?:\s+[A-Za-z][\w'’-]*)?)/)
    name = m ? m[1].replace(/\s+wardrobe$/i, '') : s.split(/[,\-]/)[0]
  }
  name = name.trim().toUpperCase()
  if (!name) return null
  if (name.includes('KENDRICK') || name === 'JASON') return 'KENDRICK'
  if (KNOWN.includes(name)) return name
  const first = name.split(/\s+/)[0]
  if (KNOWN.includes(first)) return first
  return null
}

export async function applyWardrobeOutfitNumbers(projectId: string): Promise<{ set: number; skipped: number }> {
  try {
    const { rows } = await pool.query<{ id: string; number: string; description: string; outfit_number: string | null }>(
      `SELECT li.id, s.number, li.description, li.outfit_number
         FROM scenes s
         JOIN budget_line_items li ON li.scene_id = s.id
        WHERE s.project_id = $1 AND li.code = 'WARDROBE'`,
      [projectId],
    )
    let set = 0
    let skipped = 0
    for (const r of rows) {
      const char = canonicalCharacter(r.description)
      if (!char) continue
      // Targeted correction: replace a specific wrong auto-value with the
      // right one. Guarded to the exact old value so producer edits survive.
      const corr = CORRECTIONS[r.number]?.[char]
      if (corr && r.outfit_number === corr.from) {
        await pool.query(
          `UPDATE budget_line_items SET outfit_number = $1 WHERE id = $2 AND outfit_number = $3`,
          [corr.to, r.id, corr.from],
        )
        set++
        continue
      }
      // Never overwrite a number the producer already set/changed.
      if (r.outfit_number != null && r.outfit_number.trim() !== '') { skipped++; continue }
      const outfit = WARDROBE_OUTFIT_MAP[char]?.[r.number]
      if (outfit == null) continue
      await pool.query(
        `UPDATE budget_line_items SET outfit_number = $1 WHERE id = $2 AND outfit_number IS NULL`,
        [String(outfit), r.id],
      )
      set++
    }
    logInfo('wardrobe outfits: applied', { projectId, set, skipped, total: rows.length })
    return { set, skipped }
  } catch (err) {
    logError('wardrobe outfits: apply failed', { projectId, error: err instanceof Error ? err.message : String(err) })
    return { set: 0, skipped: 0 }
  }
}

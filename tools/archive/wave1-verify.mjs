// Wave-1 verification: for each target folder, every Dropbox file (from the
// team census inventory-DROPBOX-TEAM.csv in the working directory) must exist
// in the vault at the same normalized path with the same size.
// Fetch the census first: node fetch-inventory.mjs _INVENTORY/inventory-DROPBOX-TEAM.csv inventory-DROPBOX-TEAM.csv
import fs from 'node:fs'
import { s3, listAll } from './creds.mjs'

const TARGETS = [
  '1_PODCASTS/Hollywood Horror Stories', '1_PODCASTS/The Inside Track',
  '2_CLIENTS/Brandi Glanville', '1_PODCASTS/Poopies', '1_PODCASTS/Murder Room',
  "1_PODCASTS/It's a Racquet", '5_MARKETING/Website', '5_MARKETING/PurchasedMaterials',
  '5_MARKETING/Decks & Marketing', '5_MARKETING/Straw Hut Podcast Newsletter',
  '1_PODCASTS/History. Rated R.', '1_PODCASTS/Virgo Sisters',
  '1_PODCASTS/Salt and Flickers', '1_PODCASTS/HeartBreakers',
  '5_MARKETING/Straw Hut Ads', '3_COURSES/Podcast Primer Pro',
  '2_CLIENTS/Rainbow Media', '4_SOCIAL/HeartBreakers',
  'Ryan Tillotson/You Are U', 'Ryan Tillotson/Indy Automous challenge podcast',
  'Ryan Tillotson/Ryan Personal Photos', 'Ryan Tillotson/Straw Hut General’s files',
  "Ryan Tillotson/Don't Be Alone with Jay Kogen (1)", "Ryan Tillotson/Don't Be Alone with Jay Kogen (2)",
  "Ryan Tillotson/Don't Be Alone with Jay Kogen (3)", 'Ryan Tillotson/Camera Uploads (1)',
  'Ryan Tillotson/Videos', 'Ryan Tillotson/Shaping Freedom Podcast',
  'Ryan Tillotson/Apps', 'Ryan Tillotson/Old Dbox',
]

const want = new Map(TARGETS.map(x => [x, new Map()]))
for (const line of fs.readFileSync('inventory-DROPBOX-TEAM.csv', 'utf8').split('\n')) {
  if (!line.trim()) continue
  const i = line.indexOf(';'); if (i < 1) continue
  const j = line.indexOf(';', i + 1); if (j < 0) continue
  const size = +line.slice(0, i)
  let p = line.slice(j + 1)
  if (!Number.isFinite(size)) continue
  if (p.startsWith('Straw Hut Team Folder/')) p = p.slice('Straw Hut Team Folder/'.length)
  if (/(^|\/)(\.DS_Store|Thumbs\.db)$/.test(p)) continue
  const tgt = TARGETS.find(x => p.startsWith(x + '/'))
  if (tgt) want.get(tgt).set(p, size)
}

const c = s3()
for (const tgt of TARGETS) {
  const w = want.get(tgt)
  if (w.size === 0) { console.log(`(no census entries — already deleted?)  ${tgt}`); continue }
  const vault = new Map((await listAll(c, tgt + '/')).map(o => [o.key, o.size]))
  let ok = 0, bytes = 0, okBytes = 0
  const missing = []
  for (const [p, size] of w) {
    bytes += size
    if (vault.get(p) === size) { ok++; okBytes += size }
    else if (missing.length < 3) missing.push(p)
  }
  const verdict = ok === w.size ? 'VERIFIED — DELETABLE' : ok === 0 ? 'not started' : 'in progress'
  console.log(`${String(ok).padStart(6)}/${String(w.size).padEnd(6)} ${String(+(okBytes / 1024 ** 3).toFixed(1)).padStart(8)}/${String(+(bytes / 1024 ** 3).toFixed(1)).padEnd(8)} GiB  ${verdict.padEnd(22)} ${tgt}`)
  if (verdict === 'in progress' && missing.length) for (const m of missing) console.log('         missing: ' + m)
}

// The Dropbox deletion ledger: every file in the team census vs copies in
// vault ∪ RED ∪ BLUE ∪ RHINO ∪ RECOVERY, with Ryan's 1-year untouched gate.
// Tier 1: exact normalized path+size. Tier 2: basename+size anywhere.
// Verdicts per folder group: DELETABLE / COVERED-BUT-RECENT / NOT covered.
//
// First fetch the census files into the working directory:
//   node fetch-inventory.mjs _INVENTORY/inventory-RED.txt inventory-RED.txt
//   … same for -BLUE.txt, -RHINO.txt, -RECOVERY.txt, -DROPBOX-TEAM.csv
// Then: node ledger2.mjs   (writes LEDGER2.json next to the inventories)
import fs from 'node:fs'
import path from 'node:path'
import { s3, listAll } from './creds.mjs'
const ONE_YEAR_AGO = new Date(Date.now() - 365 * 24 * 3600 * 1000)

const byPath = new Map()
const byNameSize = new Set()
function addCopy(p, size) {
  byPath.set(p, size)
  byNameSize.add(path.basename(p) + '|' + size)
}

// 1. Vault
const c = s3()
for (const o of await listAll(c, '')) if (!o.key.startsWith('_INVENTORY/')) addCopy(o.key, o.size)
const vaultCount = byPath.size

// 2. RED + BLUE ("SIZE ROOT/rel"), RHINO + RECOVERY drive listings
const ROOTMAP = { PODCASTS: '1_PODCASTS', CLIENTS: '2_CLIENTS', Podcast: '1_PODCASTS', '2_CLIENTS': '2_CLIENTS' }
for (const f of ['inventory-RED.txt', 'inventory-BLUE.txt']) {
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^(\d+) (.+)$/)
    if (!m) continue
    const parts = m[2].split('/')
    const root = ROOTMAP[parts[0]]
    if (!root || parts[1] === '#recycle') continue
    addCopy([root, ...parts.slice(1)].join('/'), +m[1])
  }
}
for (const [f, mapFn] of [
  ['inventory-RHINO.txt', (p) => (p.startsWith('1_PODCASTS/') ? p : '1_PODCASTS/Henri G/' + p)],
  ['inventory-RECOVERY.txt', (p) => '1_PODCASTS/' + p],
]) {
  if (!fs.existsSync(f)) continue
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^(\d+) (.+)$/)
    if (!m) continue
    const rel = m[2].replace(/^\.\//, '')
    if (/(^|\/)(\$RECYCLE\.BIN|System Volume Information)\//.test(rel)) continue
    addCopy(mapFn(rel), +m[1])
  }
}

// 3. Team census: "SIZE;TIMESTAMP;PATH" from the team-space root namespace.
const groups = new Map()
let dbTotal = 0, dbBytes = 0
for (const line of fs.readFileSync('inventory-DROPBOX-TEAM.csv', 'utf8').split('\n')) {
  if (!line.trim()) continue
  const i = line.indexOf(';')
  if (i < 1) continue
  const j = line.indexOf(';', i + 1)
  if (j < 0) continue
  const size = +line.slice(0, i)
  const mtime = new Date(line.slice(i + 1, j).replace(' ', 'T') + 'Z')
  const p = line.slice(j + 1)
  if (!Number.isFinite(size)) continue
  if (/(^|\/)(\.DS_Store|Thumbs\.db)$/.test(p)) continue
  const inTeam = p.startsWith('Straw Hut Team Folder/')
  const norm = inTeam ? p.slice('Straw Hut Team Folder/'.length) : p
  const segs = norm.split('/')
  let group
  if (inTeam) group = /^[0-9]_/.test(segs[0]) && segs.length > 2 ? segs[0] + '/' + segs[1] : segs[0]
  else group = segs.length > 2 ? segs[0] + '/' + segs[1] : 'LOOSE: ' + segs[0]
  const g = groups.get(group) ?? { files: 0, bytes: 0, covered: 0, coveredBytes: 0, t2: 0, newest: new Date(0), missing: [] }
  g.files += 1; g.bytes += size; dbTotal += 1; dbBytes += size
  if (!Number.isNaN(mtime.getTime()) && mtime > g.newest) g.newest = mtime
  if (byPath.get(norm) === size) { g.covered += 1; g.coveredBytes += size }
  else if (byNameSize.has(path.basename(norm) + '|' + size)) { g.covered += 1; g.coveredBytes += size; g.t2 += 1 }
  else if (g.missing.length < 5) g.missing.push(norm + ` (${size} B)`)
  groups.set(group, g)
}

const rows = [...groups.entries()].sort((a, b) => b[1].bytes - a[1].bytes)
const out = []
let deletableBytes = 0, coveredRecentBytes = 0
for (const [name, g] of rows) {
  const full = g.covered === g.files
  const old = g.newest < ONE_YEAR_AGO
  let verdict
  if (full && old) { verdict = 'DELETABLE'; deletableBytes += g.bytes }
  else if (full) { verdict = 'COVERED-BUT-RECENT'; coveredRecentBytes += g.bytes }
  else verdict = 'NOT covered'
  out.push({ group: name, gib: +(g.bytes / 1024 ** 3).toFixed(1), files: g.files,
    coveredPct: +(100 * g.covered / g.files).toFixed(1), tier2Matches: g.t2,
    newestFile: g.newest.toISOString().slice(0, 10), verdict,
    missingSample: full ? undefined : g.missing })
}
fs.writeFileSync('LEDGER2.json', JSON.stringify(out, null, 2))
console.log(`copies index: ${byPath.size} paths (${vaultCount} vault) | dropbox team census: ${dbTotal} files, ${(dbBytes / 1024 ** 4).toFixed(2)} TiB`)
console.log(`DELETABLE now (covered + untouched 1yr): ${(deletableBytes / 1024 ** 4).toFixed(2)} TiB`)
console.log(`covered but touched within 1yr: ${(coveredRecentBytes / 1024 ** 4).toFixed(2)} TiB`)
for (const r of out.slice(0, 50)) console.log(`${String(r.gib).padStart(9)} GiB  ${String(r.coveredPct).padStart(5)}%  ${r.newestFile}  ${r.verdict.padEnd(18)} ${r.group}`)
console.log('full detail in LEDGER2.json')

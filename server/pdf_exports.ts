// Industry-standard production PDFs. Each function streams a PDF to
// the provided Express response — no temp files. Uses pdfkit (no
// Chromium needed, lighter than Playwright).
//
// Documents shipped:
//   - Budget Top Sheet         one-page summary, category subtotals,
//                              grand total with contingency + bond,
//                              target progress.
//   - Detailed Budget          every account + line item, grouped by
//                              category, page-numbered.
//   - Stripboard / Production  one row per scene, color-coded by
//                              INT/EXT × Day/Night, grouped by
//                              shoot day. This is the "production
//                              board."
//   - Day-Out-Of-Days (DOOD)   cast × days matrix. W = work day.
//                              Showing every actor's working / hold /
//                              start / finish days at a glance.
//   - Cast list with day rates One row per cast member: character,
//                              actor name (if entered as vendor),
//                              total work days, day rate, total cost.

import type { Response } from 'express'
import PDFDocument from 'pdfkit'
import { pool } from './db'

type ProjectRow = { id: string; name: string; subtitle: string | null; kind: string }
type Account = { id: string; code: string; name: string; category: string; position: number }
type LineItem = {
  id: string; account_id: string; code: string | null; description: string;
  vendor: string | null; amt: number; x: number; rate: number;
  scene_id: string | null; shoot_day_id: string | null;
  spans_all_shoot_days: boolean; resource_type: string | null; resource_key: string | null;
}
type Scene = {
  id: string; number: string; script_position: number; slug: string;
  int_ext: string | null; location: string | null; time_of_day: string | null;
  page_eighths: number; characters: string[];
  shoot_day_id: string | null; day_position: number;
}
type ShootDay = { id: string; number: number; is_break: boolean; shoot_date: string | null; notes: string | null }
type Budget = {
  id: string; currency: string; shoot_days: number; bond_pct: number; contingency_pct: number;
  production_target: number | null; post_target: number | null;
  marketing_target: number | null; admin_target: number | null; total_target: number | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  above_line: 'Above the Line',
  production: 'Production',
  post: 'Post-Production',
  other: 'Other',
}
const CATEGORY_ORDER = ['above_line', 'production', 'post', 'other']

const STRIP_COLORS: Record<string, [number, number, number]> = {
  EXT_DAY:    [251, 191, 36],  // gold
  INT_DAY:    [244, 114, 182], // magenta
  EXT_NIGHT:  [16,  185, 129], // emerald
  INT_NIGHT:  [59,  130, 246], // blue
  SUNSET:     [251, 113, 133], // orange-red
  DEFAULT:    [148, 163, 184], // slate
}

function stripKind(intExt: string | null, timeOfDay: string | null): string {
  const ie = intExt === 'INT/EXT' ? 'EXT' : intExt
  const t = (timeOfDay || '').toUpperCase()
  if (t.startsWith('SUNSET') || t.startsWith('SUNRISE') || t.startsWith('MAGIC') || t.startsWith('DUSK') || t.startsWith('DAWN')) return 'SUNSET'
  if (t.includes('NIGHT') || t.includes('EVENING')) return ie === 'EXT' ? 'EXT_NIGHT' : 'INT_NIGHT'
  if (t.includes('DAY') || t.includes('MORNING') || t.includes('AFTERNOON') || t.includes('NOON')) return ie === 'EXT' ? 'EXT_DAY' : 'INT_DAY'
  return 'DEFAULT'
}

function fmtMoney(v: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v)
  } catch {
    return `$${Math.round(v).toLocaleString()}`
  }
}

function fmtEighths(eighths: number): string {
  if (eighths === 0) return '—'
  const whole = Math.floor(eighths / 8)
  const frac = eighths % 8
  if (whole === 0) return `${frac}/8`
  if (frac === 0) return `${whole}`
  return `${whole} ${frac}/8`
}

async function loadProjectContext(projectId: string): Promise<{
  project: ProjectRow
  budget: Budget | null
  accounts: Account[]
  items: LineItem[]
  scenes: Scene[]
  shootDays: ShootDay[]
}> {
  const proj = await pool.query<ProjectRow>(
    `SELECT id, name, subtitle, kind FROM projects WHERE id = $1`, [projectId],
  )
  if (proj.rows.length === 0) throw new Error('project_not_found')

  const budgetRes = await pool.query<Budget>(
    `SELECT id, currency, shoot_days, bond_pct, contingency_pct,
            production_target, post_target, marketing_target, admin_target, total_target
       FROM budgets WHERE project_id = $1`,
    [projectId],
  )
  const budget = budgetRes.rows[0] ?? null

  let accounts: Account[] = []
  let items: LineItem[] = []
  if (budget) {
    const a = await pool.query<Account>(
      `SELECT id, code, name, category, position FROM budget_accounts
       WHERE budget_id = $1 ORDER BY position ASC, code ASC`,
      [budget.id],
    )
    accounts = a.rows
    const ids = accounts.map((x) => x.id)
    if (ids.length > 0) {
      const li = await pool.query<LineItem & { amt: string; x: string; rate: string }>(
        `SELECT id, account_id, code, description, vendor, amt, x, rate,
                scene_id, shoot_day_id, spans_all_shoot_days, resource_type, resource_key
         FROM budget_line_items WHERE account_id = ANY($1::uuid[])
         ORDER BY position ASC, created_at ASC`,
        [ids],
      )
      items = li.rows.map((r) => ({
        ...r,
        amt: Number(r.amt), x: Number(r.x), rate: Number(r.rate),
      }))
    }
  }
  const scenesRes = await pool.query<Scene & { page_eighths: number }>(
    `SELECT id, number, script_position, slug, int_ext, location, time_of_day,
            page_eighths, characters, shoot_day_id, day_position
     FROM scenes WHERE project_id = $1 ORDER BY shoot_day_id NULLS LAST, day_position ASC, script_position ASC`,
    [projectId],
  )
  const daysRes = await pool.query<ShootDay>(
    `SELECT id, number, is_break, shoot_date, notes FROM shoot_days
     WHERE project_id = $1 ORDER BY number ASC`,
    [projectId],
  )
  return { project: proj.rows[0], budget, accounts, items, scenes: scenesRes.rows, shootDays: daysRes.rows }
}

function itemTotal(it: LineItem): number {
  return it.amt * it.x * it.rate
}

function setupPdf(res: Response, fileName: string, landscape = false): typeof PDFDocument.prototype {
  const doc = new PDFDocument({
    size: 'LETTER',
    layout: landscape ? 'landscape' : 'portrait',
    margin: 40,
    bufferPages: true,  // required so addPageNumbers can switchToPage
  })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/"/g, '')}"`)
  doc.pipe(res)
  return doc
}

function pageHeader(doc: typeof PDFDocument.prototype, project: ProjectRow, title: string) {
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#1a1a1a').text(project.name, { continued: false })
  doc.font('Helvetica').fontSize(10).fillColor('#666').text(
    `${title} · ${project.subtitle ? project.subtitle + ' · ' : ''}drafted ${new Date().toLocaleDateString()}`,
  )
  doc.moveDown(0.5)
  doc.strokeColor('#1a1a1a').lineWidth(1).moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke()
  doc.moveDown(0.8)
}

// ────────────────────────────────────────────────────────────────────
// 1. BUDGET TOP SHEET
// ────────────────────────────────────────────────────────────────────
export async function budgetTopSheetPdf(projectId: string, res: Response): Promise<void> {
  const { project, budget, accounts, items } = await loadProjectContext(projectId)
  const doc = setupPdf(res, `${slug(project.name)}-budget-topsheet.pdf`)
  pageHeader(doc, project, 'BUDGET TOP SHEET')

  if (!budget) {
    doc.fontSize(12).fillColor('#666').text('No budget created for this project yet.')
    doc.end(); return
  }

  // Subtotals per category
  const categoryTotals = new Map<string, number>()
  for (const cat of CATEGORY_ORDER) categoryTotals.set(cat, 0)
  for (const acc of accounts) {
    const accountTotal = items
      .filter((i) => i.account_id === acc.id)
      .reduce((s, i) => s + itemTotal(i), 0)
    categoryTotals.set(acc.category, (categoryTotals.get(acc.category) ?? 0) + accountTotal)
  }
  const directTotal = Array.from(categoryTotals.values()).reduce((s, v) => s + v, 0)
  const contingency = directTotal * (Number(budget.contingency_pct) / 100)
  const bond = directTotal * (Number(budget.bond_pct) / 100)
  const grand = directTotal + contingency + bond

  // Two-column section: categories left, summary right
  const leftX = 40, rightX = doc.page.width / 2 + 20
  const colW = doc.page.width / 2 - 60
  const yStart = doc.y

  // LEFT: Categories
  doc.fontSize(11).fillColor('#1a1a1a').font('Helvetica-Bold').text('CATEGORIES', leftX, yStart)
  doc.moveDown(0.3)
  for (const cat of CATEGORY_ORDER) {
    const total = categoryTotals.get(cat) ?? 0
    doc.font('Helvetica').fontSize(10).fillColor('#1a1a1a')
    doc.text(CATEGORY_LABEL[cat] ?? cat, leftX, doc.y, { width: colW * 0.6, continued: true })
    doc.font('Helvetica-Bold').text(fmtMoney(total, budget.currency), { width: colW * 0.4, align: 'right' })
  }
  doc.moveDown(0.3)
  doc.strokeColor('#aaa').lineWidth(0.5).moveTo(leftX, doc.y).lineTo(leftX + colW, doc.y).stroke()
  doc.moveDown(0.3)
  doc.font('Helvetica-Bold').fontSize(10)
  doc.text('Direct Total', leftX, doc.y, { width: colW * 0.6, continued: true })
  doc.text(fmtMoney(directTotal, budget.currency), { width: colW * 0.4, align: 'right' })
  doc.font('Helvetica').text(`Contingency (${budget.contingency_pct}%)`, leftX, doc.y, { width: colW * 0.6, continued: true })
  doc.text(fmtMoney(contingency, budget.currency), { width: colW * 0.4, align: 'right' })
  doc.text(`Bond (${budget.bond_pct}%)`, leftX, doc.y, { width: colW * 0.6, continued: true })
  doc.text(fmtMoney(bond, budget.currency), { width: colW * 0.4, align: 'right' })
  doc.moveDown(0.3)
  doc.strokeColor('#1a1a1a').lineWidth(1).moveTo(leftX, doc.y).lineTo(leftX + colW, doc.y).stroke()
  doc.moveDown(0.3)
  doc.font('Helvetica-Bold').fontSize(13)
  doc.text('GRAND TOTAL', leftX, doc.y, { width: colW * 0.6, continued: true })
  doc.text(fmtMoney(grand, budget.currency), { width: colW * 0.4, align: 'right' })

  // RIGHT: Targets vs spend
  let rightY = yStart
  doc.fontSize(11).fillColor('#1a1a1a').font('Helvetica-Bold').text('TARGETS', rightX, rightY)
  rightY = doc.y + 6
  const targets: Array<[string, number | null, number]> = [
    ['Production (Above + Production)', Number(budget.production_target) || null, (categoryTotals.get('above_line') ?? 0) + (categoryTotals.get('production') ?? 0)],
    ['Post', Number(budget.post_target) || null, categoryTotals.get('post') ?? 0],
    ['Marketing', Number(budget.marketing_target) || null, 0],
    ['Total', Number(budget.total_target) || null, grand],
  ]
  for (const [label, target, spent] of targets) {
    if (target == null || target === 0) continue
    const pct = (spent / target) * 100
    const overBy = spent - target
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a1a1a').text(label, rightX, rightY)
    rightY = doc.y
    doc.font('Helvetica').fontSize(9).fillColor('#666').text(
      `${fmtMoney(spent, budget.currency)} of ${fmtMoney(target, budget.currency)} · ${pct.toFixed(0)}%${overBy > 0 ? `  OVER by ${fmtMoney(overBy, budget.currency)}` : ''}`,
      rightX, rightY,
    )
    rightY = doc.y + 2
    const barW = colW
    const barH = 4
    doc.rect(rightX, rightY, barW, barH).fillColor('#e5e5e5').fill()
    doc.rect(rightX, rightY, Math.min(barW, barW * (pct / 100)), barH).fillColor(overBy > 0 ? '#ef4444' : '#10b981').fill()
    doc.fillColor('#1a1a1a')
    rightY += barH + 12
  }

  // Footer
  doc.font('Helvetica').fontSize(8).fillColor('#999')
  doc.text(`${budget.shoot_days} shoot days · ${budget.currency} · drafted ${new Date().toISOString().slice(0, 10)}`,
    40, doc.page.height - 60, { align: 'center', width: doc.page.width - 80 })

  addPageNumbers(doc, project, 'BUDGET TOP SHEET')
  doc.end()
}

// ────────────────────────────────────────────────────────────────────
// 2. DETAILED BUDGET
// ────────────────────────────────────────────────────────────────────
export async function budgetDetailedPdf(projectId: string, res: Response): Promise<void> {
  const { project, budget, accounts, items } = await loadProjectContext(projectId)
  const doc = setupPdf(res, `${slug(project.name)}-budget-detailed.pdf`)
  pageHeader(doc, project, 'DETAILED BUDGET')

  if (!budget) {
    doc.fontSize(12).fillColor('#666').text('No budget for this project.')
    doc.end(); return
  }

  for (const cat of CATEGORY_ORDER) {
    const accs = accounts.filter((a) => a.category === cat)
    if (accs.length === 0) continue
    const catTotal = items
      .filter((i) => accs.some((a) => a.id === i.account_id))
      .reduce((s, i) => s + itemTotal(i), 0)

    doc.moveDown(0.5)
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#1a1a1a')
      .text(`${CATEGORY_LABEL[cat]?.toUpperCase() ?? cat}  —  ${fmtMoney(catTotal, budget.currency)}`)
    doc.moveDown(0.2)
    for (const acc of accs) {
      const accItems = items.filter((i) => i.account_id === acc.id)
      const accTotal = accItems.reduce((s, i) => s + itemTotal(i), 0)
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#444')
        .text(`${acc.code}  ${acc.name}`, { continued: true })
      doc.font('Helvetica-Bold').text(`  ${fmtMoney(accTotal, budget.currency)}`, { align: 'right' })

      for (const it of accItems) {
        const total = itemTotal(it)
        const desc = it.vendor ? `${it.description} — ${it.vendor}` : it.description
        const ros = it.spans_all_shoot_days ? '  🔁' : ''
        doc.font('Helvetica').fontSize(9).fillColor('#333')
          .text(`    ${desc}${ros}`, { width: doc.page.width - 80 - 100, continued: true })
        doc.text(`  ${total > 0 ? fmtMoney(total, budget.currency) : '—'}`, { width: 100, align: 'right' })
      }
      doc.moveDown(0.2)
    }
  }
  addPageNumbers(doc, project, 'DETAILED BUDGET')
  doc.end()
}

// ────────────────────────────────────────────────────────────────────
// 3. STRIPBOARD / PRODUCTION BOARD
// ────────────────────────────────────────────────────────────────────
// Assign industry-standard cast numbers. Most-appearing character =
// #1 (the lead), next = #2, etc. Returns a Map<character_name, number>
// and the reverse map for legend rendering.
export function buildCastNumbers(scenes: Scene[]): {
  numberOf: Map<string, number>
  legend: Array<{ number: number; name: string; sceneCount: number }>
} {
  const counts = new Map<string, number>()
  for (const s of scenes) {
    for (const c of s.characters ?? []) {
      counts.set(c, (counts.get(c) ?? 0) + 1)
    }
  }
  const ordered = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const numberOf = new Map<string, number>()
  const legend: Array<{ number: number; name: string; sceneCount: number }> = []
  ordered.forEach(([name, count], i) => {
    numberOf.set(name, i + 1)
    legend.push({ number: i + 1, name, sceneCount: count })
  })
  return { numberOf, legend }
}

export async function stripboardPdf(projectId: string, res: Response): Promise<void> {
  const { project, scenes, shootDays } = await loadProjectContext(projectId)
  const doc = setupPdf(res, `${slug(project.name)}-stripboard.pdf`, true)
  pageHeader(doc, project, 'PRODUCTION BOARD')

  // Build cast numbers from all scenes (so unscheduled scenes also
  // get a number).
  const { numberOf, legend } = buildCastNumbers(scenes)

  // CAST LEGEND — block at the top of page 1 so the AD can decode
  // the cast numbers on every strip. Multi-column grid.
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a1a1a').text('CAST NUMBERS')
  doc.moveDown(0.2)
  const colCount = 4
  const colW = (doc.page.width - 80) / colCount
  let col = 0
  let rowY = doc.y
  const rowH = 11
  doc.font('Helvetica').fontSize(8).fillColor('#333')
  for (const c of legend) {
    const cx = 40 + col * colW
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#1a1a1a')
    doc.text(String(c.number).padStart(2, ' '), cx, rowY, { width: 18, continued: true })
    doc.font('Helvetica').fillColor('#333')
    doc.text(`  ${c.name}`, { width: colW - 18 - 30, continued: true })
    doc.fillColor('#888').font('Helvetica-Oblique')
    doc.text(`  ${c.sceneCount} sc`, { width: 30, align: 'right' })
    col += 1
    if (col >= colCount) { col = 0; rowY += rowH }
  }
  if (col !== 0) rowY += rowH
  doc.y = rowY + 8
  doc.strokeColor('#1a1a1a').lineWidth(0.5).moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke()
  doc.moveDown(0.5)

  // STRIP COLUMN HEADERS (sticky-ish — re-rendered at top of each
  // new page below)
  function stripHeaders(y: number) {
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#666')
    doc.text('SC#',      54,  y, { width: 30 })
    doc.text('I/E TIME', 84,  y, { width: 100 })
    doc.text('LOCATION / SLUG', 184, y, { width: 300 })
    doc.text('PGS',     484, y, { width: 40, align: 'right' })
    doc.text('CAST',    540, y, { width: doc.page.width - 580 })
  }
  stripHeaders(doc.y)
  doc.y += 12

  const scenesByDay = new Map<string | null, Scene[]>()
  for (const s of scenes) {
    const key = s.shoot_day_id ?? null
    const arr = scenesByDay.get(key) ?? []
    arr.push(s); scenesByDay.set(key, arr)
  }

  function renderDay(label: string, isBreak: boolean, scns: Scene[]) {
    const dayPages = scns.reduce((sum, s) => sum + s.page_eighths, 0)
    if (doc.y > doc.page.height - 120) {
      doc.addPage({ layout: 'landscape', margin: 40 })
      stripHeaders(doc.y); doc.y += 12
    }
    doc.moveDown(0.4)
    doc.font('Helvetica-Bold').fontSize(11).fillColor(isBreak ? '#888' : '#1a1a1a')
      .text(`${label}  —  ${scns.length} scenes  ·  ${fmtEighths(dayPages)} pages`)
    doc.moveDown(0.2)

    if (isBreak) {
      doc.font('Helvetica-Oblique').fontSize(9).fillColor('#888').text('— break day —')
      return
    }
    for (const s of scns) {
      if (doc.y > doc.page.height - 60) {
        doc.addPage({ layout: 'landscape', margin: 40 })
        stripHeaders(doc.y); doc.y += 12
      }
      const kind = stripKind(s.int_ext, s.time_of_day)
      const [r, g, b] = STRIP_COLORS[kind] ?? STRIP_COLORS.DEFAULT
      const y = doc.y
      const totalW = doc.page.width - 80
      // Color stripe on left
      doc.rect(40, y, 8, 18).fillColor(`rgb(${r},${g},${b})`).fill()
      // Strip body
      doc.rect(48, y, totalW - 8, 18).fillColor('#fff').strokeColor('#ccc').fillAndStroke()
      // Text
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#1a1a1a')
        .text(`#${s.number}`, 54, y + 5, { width: 30, continued: false })
      doc.font('Helvetica').fontSize(9).fillColor('#333')
      doc.text(`${s.int_ext ?? ''} · ${s.time_of_day ?? ''}`, 84, y + 5, { width: 100 })
      doc.text(s.location ?? s.slug.slice(0, 60), 184, y + 5, { width: 300, ellipsis: true })
      doc.text(fmtEighths(s.page_eighths), 484, y + 5, { width: 40, align: 'right' })
      // Cast NUMBERS (industry standard), not names
      const castNums = (s.characters ?? [])
        .map((c) => numberOf.get(c))
        .filter((n): n is number => typeof n === 'number')
        .sort((a, b) => a - b)
        .join(', ')
      doc.font('Helvetica-Bold').fillColor('#1a1a1a')
        .text(castNums || '—', 540, y + 5, { width: doc.page.width - 580, ellipsis: true })
      doc.y = y + 22
    }
  }

  // Unscheduled first
  const unscheduled = scenesByDay.get(null) ?? []
  if (unscheduled.length > 0) renderDay('UNSCHEDULED', false, unscheduled)
  for (const d of shootDays) {
    const scns = scenesByDay.get(d.id) ?? []
    const label = d.is_break ? `DAY ${d.number} — BREAK` : `DAY ${d.number}${d.shoot_date ? ` — ${d.shoot_date}` : ''}`
    renderDay(label, d.is_break, scns)
  }

  addPageNumbers(doc, project, 'PRODUCTION BOARD')
  doc.end()
}

// ────────────────────────────────────────────────────────────────────
// 4. DAY-OUT-OF-DAYS
// ────────────────────────────────────────────────────────────────────
export async function doodPdf(projectId: string, res: Response): Promise<void> {
  const { project, scenes, shootDays } = await loadProjectContext(projectId)
  const doc = setupPdf(res, `${slug(project.name)}-dood.pdf`, true)
  pageHeader(doc, project, 'DAY-OUT-OF-DAYS')

  const { numberOf } = buildCastNumbers(scenes)
  const allChars = Array.from(numberOf.entries())
    .sort((a, b) => a[1] - b[1])  // by cast number
    .map(([name]) => name)

  const shootingDays = shootDays.filter((d) => !d.is_break)
  if (shootingDays.length === 0 || allChars.length === 0) {
    doc.fontSize(12).fillColor('#666').text('Schedule a shoot day with cast first.')
    addPageNumbers(doc, project, 'DAY-OUT-OF-DAYS')
    doc.end(); return
  }

  type CharRow = { castNum: number; name: string; days: Map<number, boolean>; start: number | null; finish: number | null; workCount: number }
  const rows: CharRow[] = allChars.map((c) => ({
    castNum: numberOf.get(c)!, name: c, days: new Map(),
    start: null, finish: null, workCount: 0,
  }))
  const rowByName = new Map(rows.map((r) => [r.name, r]))
  for (const s of scenes) {
    if (!s.shoot_day_id) continue
    const day = shootDays.find((d) => d.id === s.shoot_day_id)
    if (!day || day.is_break) continue
    for (const c of s.characters ?? []) {
      const row = rowByName.get(c)
      if (!row) continue
      if (!row.days.has(day.number)) {
        row.days.set(day.number, true)
        row.workCount += 1
      }
    }
  }
  for (const r of rows) {
    const dayNums = Array.from(r.days.keys()).sort((a, b) => a - b)
    r.start = dayNums[0] ?? null
    r.finish = dayNums[dayNums.length - 1] ?? null
  }
  rows.sort((a, b) => a.castNum - b.castNum)  // by cast number, not start day — standard for DOOD

  const numColW = 28
  const charColW = 120
  const dayColW = Math.max(16, (doc.page.width - 80 - numColW - charColW - 180) / shootingDays.length)
  const startX = 40
  let y = doc.y + 4

  // Header row
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#1a1a1a')
  doc.text('#', startX, y, { width: numColW, align: 'center' })
  doc.text('CHARACTER', startX + numColW, y, { width: charColW })
  for (let i = 0; i < shootingDays.length; i++) {
    const d = shootingDays[i]
    doc.text(String(d.number), startX + numColW + charColW + i * dayColW, y, { width: dayColW, align: 'center' })
  }
  const summaryX = startX + numColW + charColW + shootingDays.length * dayColW
  doc.text('START',  summaryX,       y, { width: 50, align: 'center' })
  doc.text('FINISH', summaryX + 50,  y, { width: 50, align: 'center' })
  doc.text('WORK',   summaryX + 100, y, { width: 50, align: 'center' })
  y += 14
  doc.strokeColor('#1a1a1a').lineWidth(0.5).moveTo(startX, y).lineTo(doc.page.width - 40, y).stroke()
  y += 4

  doc.font('Helvetica').fontSize(8)
  for (const row of rows) {
    if (y > doc.page.height - 60) {
      doc.addPage({ layout: 'landscape', margin: 40 })
      y = 40
    }
    doc.fillColor('#1a1a1a').font('Helvetica-Bold').fontSize(8)
      .text(String(row.castNum), startX, y, { width: numColW, align: 'center' })
    doc.font('Helvetica').text(row.name, startX + numColW, y, { width: charColW, ellipsis: true })
    for (let i = 0; i < shootingDays.length; i++) {
      const d = shootingDays[i]
      const cx = startX + numColW + charColW + i * dayColW
      if (row.days.has(d.number)) {
        doc.rect(cx + 1, y - 1, dayColW - 2, 10).fillColor('#10b981').fill()
        doc.fillColor('#fff').font('Helvetica-Bold').fontSize(7)
          .text('W', cx, y, { width: dayColW, align: 'center' })
        doc.font('Helvetica').fontSize(8)
      } else if (row.start != null && row.finish != null && d.number > row.start && d.number < row.finish) {
        doc.fillColor('#999').text('H', cx, y, { width: dayColW, align: 'center' })
      }
    }
    doc.fillColor('#1a1a1a')
    doc.text(String(row.start ?? '—'), summaryX, y, { width: 50, align: 'center' })
    doc.text(String(row.finish ?? '—'), summaryX + 50, y, { width: 50, align: 'center' })
    doc.font('Helvetica-Bold').text(String(row.workCount), summaryX + 100, y, { width: 50, align: 'center' })
    doc.font('Helvetica')
    y += 14
  }

  if (y > doc.page.height - 60) { doc.addPage({ layout: 'landscape', margin: 40 }); y = 40 }
  y += 8
  doc.fontSize(8).fillColor('#666')
    .text('# = Cast number (matches production board) · W = Work day · H = Hold day (between start and finish)', startX, y)
  addPageNumbers(doc, project, 'DAY-OUT-OF-DAYS')
  doc.end()
}

// ────────────────────────────────────────────────────────────────────
// 5. CAST LIST WITH DAY RATES
// ────────────────────────────────────────────────────────────────────
export async function castListPdf(projectId: string, res: Response): Promise<void> {
  const { project, budget, accounts, items, scenes, shootDays } = await loadProjectContext(projectId)
  const doc = setupPdf(res, `${slug(project.name)}-cast-list.pdf`)
  pageHeader(doc, project, 'CAST LIST · DAY RATES')

  // Character scene counts
  const charScenes = new Map<string, number>()
  for (const s of scenes) for (const c of s.characters ?? []) {
    charScenes.set(c, (charScenes.get(c) ?? 0) + 1)
  }
  // Character work days (from DOOD logic)
  const charDays = new Map<string, number>()
  for (const s of scenes) {
    if (!s.shoot_day_id) continue
    const day = shootDays.find((d) => d.id === s.shoot_day_id)
    if (!day || day.is_break) continue
    for (const c of s.characters ?? []) {
      const k = `${c}::${day.number}`
      if (!charDays.has(k)) charDays.set(k, 1)
    }
  }
  function workDaysFor(name: string): number {
    let n = 0
    for (const k of charDays.keys()) if (k.startsWith(`${name}::`)) n += 1
    return n
  }

  // CAST budget items (account 14-00 OR shoot_day_id-attached with code CAST)
  const castItems = items.filter((it) => {
    const acc = accounts.find((a) => a.id === it.account_id)
    if (acc?.code === '14-00') return true
    if (it.code === 'CAST') return true
    return false
  })

  // Group by character name (use description as character name)
  type Row = { character: string; actor: string | null; dayRate: number; workDays: number; sceneCount: number; total: number }
  const rows: Row[] = []
  const seenChars = new Set<string>()
  for (const it of castItems) {
    const character = it.description
    if (seenChars.has(character.toUpperCase())) continue
    seenChars.add(character.toUpperCase())
    const wd = workDaysFor(character) || workDaysFor(character.toUpperCase()) || 0
    const sc = charScenes.get(character) ?? charScenes.get(character.toUpperCase()) ?? 0
    rows.push({
      character,
      actor: it.vendor,
      dayRate: itemTotal(it),
      workDays: wd,
      sceneCount: sc,
      total: itemTotal(it) * Math.max(1, wd),
    })
  }
  // Also include characters that appear in scenes but have no budget row
  for (const [char, sc] of charScenes) {
    if (seenChars.has(char.toUpperCase())) continue
    rows.push({ character: char, actor: null, dayRate: 0, workDays: workDaysFor(char), sceneCount: sc, total: 0 })
  }
  const { numberOf } = buildCastNumbers(scenes)
  // Sort by cast number (industry standard) so the list matches the
  // board and the DOOD.
  rows.sort((a, b) => {
    const na = numberOf.get(a.character) ?? numberOf.get(a.character.toUpperCase()) ?? 999
    const nb = numberOf.get(b.character) ?? numberOf.get(b.character.toUpperCase()) ?? 999
    return na - nb
  })

  // Table
  const xNum = 40, xCharacter = 70, xActor = 220, xScenes = 380, xWorkDays = 430, xRate = 480, xTotal = 530
  let y = doc.y + 4
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#1a1a1a')
  doc.text('#', xNum, y, { width: 25, align: 'center' })
  doc.text('CHARACTER', xCharacter, y)
  doc.text('ACTOR', xActor, y)
  doc.text('SCENES', xScenes, y, { width: 50, align: 'right' })
  doc.text('WORK', xWorkDays, y, { width: 50, align: 'right' })
  doc.text('DAY RATE', xRate, y, { width: 60, align: 'right' })
  doc.text('TOTAL', xTotal, y, { width: 60, align: 'right' })
  y += 14
  doc.strokeColor('#1a1a1a').lineWidth(0.5).moveTo(40, y).lineTo(doc.page.width - 40, y).stroke()
  y += 4

  let grand = 0
  doc.font('Helvetica').fontSize(9).fillColor('#1a1a1a')
  for (const r of rows) {
    if (y > doc.page.height - 60) { doc.addPage(); y = 40 }
    const num = numberOf.get(r.character) ?? numberOf.get(r.character.toUpperCase())
    doc.font('Helvetica-Bold').text(num ? String(num) : '—', xNum, y, { width: 25, align: 'center' })
    doc.font('Helvetica')
    doc.text(r.character, xCharacter, y, { width: 150, ellipsis: true })
    doc.text(r.actor ?? '—', xActor, y, { width: 160, ellipsis: true })
    doc.text(String(r.sceneCount), xScenes, y, { width: 50, align: 'right' })
    doc.text(String(r.workDays), xWorkDays, y, { width: 50, align: 'right' })
    doc.text(fmtMoney(r.dayRate, budget?.currency ?? 'USD'), xRate, y, { width: 60, align: 'right' })
    doc.font('Helvetica-Bold').text(fmtMoney(r.total, budget?.currency ?? 'USD'), xTotal, y, { width: 60, align: 'right' })
    doc.font('Helvetica')
    grand += r.total
    y += 12
  }
  y += 6
  doc.strokeColor('#1a1a1a').lineWidth(1).moveTo(40, y).lineTo(doc.page.width - 40, y).stroke()
  y += 4
  doc.font('Helvetica-Bold').fontSize(11)
  doc.text('TOTAL CAST', xWorkDays - 60, y, { width: 110, align: 'right' })
  doc.text(fmtMoney(grand, budget?.currency ?? 'USD'), xTotal, y, { width: 60, align: 'right' })

  addPageNumbers(doc, project, 'CAST LIST · DAY RATES')
  doc.end()
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project'
}

// Stamp page X of Y + project name on every page once the document
// has been fully laid out. Called right before doc.end().
function addPageNumbers(doc: typeof PDFDocument.prototype, project: ProjectRow, docTitle: string) {
  const range = doc.bufferedPageRange()
  const total = range.count
  for (let i = 0; i < total; i++) {
    doc.switchToPage(range.start + i)
    const y = doc.page.height - 30
    doc.save()
    doc.font('Helvetica').fontSize(8).fillColor('#888')
    doc.text(`${project.name} · ${docTitle}`, 40, y, {
      width: (doc.page.width - 80) / 2, align: 'left', lineBreak: false,
    })
    doc.text(`Page ${i + 1} of ${total} · drafted ${new Date().toISOString().slice(0, 10)}`,
      doc.page.width / 2, y, {
        width: (doc.page.width - 80) / 2, align: 'right', lineBreak: false,
      })
    doc.restore()
  }
}

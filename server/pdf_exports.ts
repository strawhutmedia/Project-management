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
  action_text: string | null;
}
type ShootDay = { id: string; number: number; is_break: boolean; shoot_date: string | null; notes: string | null }
type Budget = {
  id: string; currency: string; shoot_days: number; bond_pct: number; contingency_pct: number;
  cast_payroll_pct: number | null; crew_payroll_pct: number | null;
  cast_per_diem_daily: number | null; crew_per_diem_daily: number | null;
  cast_per_diem_headcount: number | null; crew_per_diem_headcount: number | null;
  home_location_tag: string | null;
  hotel_cast_nightly: number | null; hotel_crew_nightly: number | null;
  hotel_contingency_pct: number | null;
  travel_days: number | null;
  production_target: number | null; post_target: number | null;
  marketing_target: number | null; admin_target: number | null; total_target: number | null;
}
type ShootDayWithLocation = { id: string; number: number; is_break: boolean; shoot_date: string | null; notes: string | null; location_tag: string | null }

const CATEGORY_LABEL: Record<string, string> = {
  above_line: 'Above the Line',
  production: 'Production',
  post: 'Post-Production',
  other: 'Other',
}
const CATEGORY_ORDER = ['above_line', 'production', 'post', 'other']

// StudioBinder-style row tinting. White for INT DAY, pale cream for
// EXT DAY, mid-teal for INT NIGHT (white text), darker teal for EXT
// NIGHT (white text), peach for SUNSET. These colors are deliberately
// chosen to match the on-set reference at docs/refs/biya-studiobinder/.
type StripStyle = {
  bg: [number, number, number]
  text: [number, number, number]
  rowH: number
}
const STRIP_STYLES: Record<string, StripStyle> = {
  INT_DAY:    { bg: [255, 255, 255], text: [25, 25, 25], rowH: 36 },
  EXT_DAY:    { bg: [255, 245, 200], text: [25, 25, 25], rowH: 36 },
  INT_NIGHT:  { bg: [55,  140, 165], text: [255, 255, 255], rowH: 36 },
  EXT_NIGHT:  { bg: [26,  110, 130], text: [255, 255, 255], rowH: 36 },
  SUNSET:     { bg: [255, 200, 165], text: [25, 25, 25], rowH: 36 },
  DEFAULT:    { bg: [240, 240, 240], text: [25, 25, 25], rowH: 36 },
}
const DAY_BAND_BG: [number, number, number] = [27, 31, 46]      // dark navy
const DAY_BAND_TEXT: [number, number, number] = [255, 255, 255]

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
            cast_payroll_pct, crew_payroll_pct,
            cast_per_diem_daily, crew_per_diem_daily,
            cast_per_diem_headcount, crew_per_diem_headcount,
            home_location_tag, hotel_cast_nightly, hotel_crew_nightly,
            hotel_contingency_pct,
            travel_days,
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
            page_eighths, characters, shoot_day_id, day_position, action_text
     FROM scenes WHERE project_id = $1 ORDER BY shoot_day_id NULLS LAST, day_position ASC, script_position ASC`,
    [projectId],
  )
  const daysRes = await pool.query<ShootDay>(
    `SELECT id, number, is_break, shoot_date, notes, location_tag FROM shoot_days
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
  const { project, budget, accounts, items, shootDays } = await loadProjectContext(projectId)
  const doc = setupPdf(res, `${slug(project.name)}-budget-topsheet.pdf`)
  pageHeader(doc, project, 'BUDGET TOP SHEET')

  if (!budget) {
    doc.fontSize(12).fillColor('#666').text('No budget created for this project yet.')
    doc.end(); return
  }

  // Subtotals per category. We also track per-account totals so we can
  // split the "other" category into its Marketing (account code 55-XX,
  // Publicity) and Admin (56-, 57-, 58-: legal, general expense,
  // insurance) buckets for the TARGETS panel — those are the two goal
  // fields on the budget record.
  const categoryTotals = new Map<string, number>()
  for (const cat of CATEGORY_ORDER) categoryTotals.set(cat, 0)
  const accountTotals = new Map<string, number>()
  for (const acc of accounts) {
    const accountTotal = items
      .filter((i) => i.account_id === acc.id)
      .reduce((s, i) => s + itemTotal(i), 0)
    accountTotals.set(acc.id, accountTotal)
    categoryTotals.set(acc.category, (categoryTotals.get(acc.category) ?? 0) + accountTotal)
  }
  const marketingSpent = accounts
    .filter((a) => a.code?.startsWith('55-'))
    .reduce((s, a) => s + (accountTotals.get(a.id) ?? 0), 0)
  // Payroll fringes — SAG P&H + FICA + FUTA/SUTA + WC + payroll co fee.
  // Cast = account code starts with 14- (StudioBinder standard cast
  // accounts). Crew = every production-category account except cast
  // (that's already applied) — producers who don't want crew fringes on
  // equipment rentals should set the % to 0 or split those into their
  // own account family.
  const castSubtotal = accounts
    .filter((a) => a.code?.startsWith('14-'))
    .reduce((s, a) => s + (accountTotals.get(a.id) ?? 0), 0)
  const crewSubtotal = accounts
    .filter((a) => a.category === 'production' && !a.code?.startsWith('14-'))
    .reduce((s, a) => s + (accountTotals.get(a.id) ?? 0), 0)
  const castPayrollPct = Number(budget.cast_payroll_pct ?? 33)
  const crewPayrollPct = Number(budget.crew_payroll_pct ?? 15)
  const castFringes = castSubtotal * (castPayrollPct / 100)
  const crewFringes = crewSubtotal * (crewPayrollPct / 100)
  const fringesTotal = castFringes + crewFringes
  // Per diem — daily rate × headcount × shoot days. Zero on either
  // side (rate or headcount) → that side contributes 0.
  const castPerDiemDaily = Number(budget.cast_per_diem_daily ?? 0)
  const crewPerDiemDaily = Number(budget.crew_per_diem_daily ?? 0)
  const castPerDiemHeadcount = Number(budget.cast_per_diem_headcount ?? 0)
  const crewPerDiemHeadcount = Number(budget.crew_per_diem_headcount ?? 0)
  // Away days = ANY day (shoot OR break) tagged != home_location_tag.
  // Break days between Solvang shoots still need hotels + per diem —
  // crew's stuck on location. Travel days are a buffer for travel-in
  // and travel-out, applied to BOTH hotels and per diem.
  const homeTag = (budget.home_location_tag ?? '').trim().toLowerCase()
  const awayDays = (shootDays as ShootDayWithLocation[])
    .filter((d) => {
      const t = (d.location_tag ?? '').trim().toLowerCase()
      return t !== '' && t !== homeTag
    })
  const travelDays = Number(budget.travel_days ?? 0)
  const awayDaysCount = awayDays.length + travelDays
  const castPerDiemTotal = castPerDiemDaily * castPerDiemHeadcount * awayDaysCount
  const crewPerDiemTotal = crewPerDiemDaily * crewPerDiemHeadcount * awayDaysCount
  const perDiemTotal = castPerDiemTotal + crewPerDiemTotal
  const hotelCastNightly = Number(budget.hotel_cast_nightly ?? 0)
  const hotelCrewNightly = Number(budget.hotel_crew_nightly ?? 0)
  const hotelContingencyPct = Number(budget.hotel_contingency_pct ?? 10)
  const hotelCastBase = hotelCastNightly * castPerDiemHeadcount * awayDaysCount
  const hotelCrewBase = hotelCrewNightly * crewPerDiemHeadcount * awayDaysCount
  const hotelsBase = hotelCastBase + hotelCrewBase
  const hotelContingency = hotelsBase * (hotelContingencyPct / 100)
  const hotelCastTotal = hotelCastBase * (1 + hotelContingencyPct / 100)
  const hotelCrewTotal = hotelCrewBase * (1 + hotelContingencyPct / 100)
  const hotelsTotal = hotelCastTotal + hotelCrewTotal
  const directTotal = Array.from(categoryTotals.values()).reduce((s, v) => s + v, 0)
  const directPlusFringes = directTotal + fringesTotal + perDiemTotal + hotelsTotal
  const contingency = directPlusFringes * (Number(budget.contingency_pct) / 100)
  const bond = directPlusFringes * (Number(budget.bond_pct) / 100)
  const grand = directPlusFringes + contingency + bond

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
  // Payroll fringes — always render the lines so the operator sees the
  // math, even when a percentage is 0 or a subtotal is empty.
  doc.font('Helvetica').text(`Cast Fringes (${castPayrollPct}% × ${fmtMoney(castSubtotal, budget.currency)})`, leftX, doc.y, { width: colW * 0.6, continued: true })
  doc.text(fmtMoney(castFringes, budget.currency), { width: colW * 0.4, align: 'right' })
  doc.text(`Crew Fringes (${crewPayrollPct}% × ${fmtMoney(crewSubtotal, budget.currency)})`, leftX, doc.y, { width: colW * 0.6, continued: true })
  doc.text(fmtMoney(crewFringes, budget.currency), { width: colW * 0.4, align: 'right' })
  if (perDiemTotal > 0) {
    if (castPerDiemTotal > 0) {
      doc.text(`Cast per diem (${castPerDiemHeadcount} × ${awayDaysCount} away days × ${fmtMoney(castPerDiemDaily, budget.currency)}/day)`, leftX, doc.y, { width: colW * 0.6, continued: true })
      doc.text(fmtMoney(castPerDiemTotal, budget.currency), { width: colW * 0.4, align: 'right' })
    }
    if (crewPerDiemTotal > 0) {
      doc.text(`Crew per diem (${crewPerDiemHeadcount} × ${awayDaysCount} away days × ${fmtMoney(crewPerDiemDaily, budget.currency)}/day)`, leftX, doc.y, { width: colW * 0.6, continued: true })
      doc.text(fmtMoney(crewPerDiemTotal, budget.currency), { width: colW * 0.4, align: 'right' })
    }
  }
  if (hotelsTotal > 0) {
    if (hotelCastTotal > 0) {
      doc.text(`Cast hotels (${castPerDiemHeadcount} × ${awayDaysCount} nights × ${fmtMoney(hotelCastNightly, budget.currency)}/night)`, leftX, doc.y, { width: colW * 0.6, continued: true })
      doc.text(fmtMoney(hotelCastTotal, budget.currency), { width: colW * 0.4, align: 'right' })
    }
    if (hotelCrewTotal > 0) {
      doc.text(`Crew hotels (${crewPerDiemHeadcount} × ${awayDaysCount} nights × ${fmtMoney(hotelCrewNightly, budget.currency)}/night)`, leftX, doc.y, { width: colW * 0.6, continued: true })
      doc.text(fmtMoney(hotelCrewTotal, budget.currency), { width: colW * 0.4, align: 'right' })
    }
  }
  doc.text(`Contingency (${budget.contingency_pct}% of direct + fringes + per diem)`, leftX, doc.y, { width: colW * 0.6, continued: true })
  doc.text(fmtMoney(contingency, budget.currency), { width: colW * 0.4, align: 'right' })
  doc.text(`Bond (${budget.bond_pct}% of direct + fringes + per diem)`, leftX, doc.y, { width: colW * 0.6, continued: true })
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
    ['Marketing', Number(budget.marketing_target) || null, marketingSpent],
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
// Gorilla / Movie Magic style 8-column detailed budget. Each line
// item gets a proper account code (1001-01 etc.), description, units,
// multiplier, rate, and total — with subtotals at the account level,
// category band totals, and a grand total at the end. Designed to
// pass for an industry-standard top-sheet review.
const BD_COL = {
  acct: { x: 40,  w: 64,  label: 'ACCT' },
  desc: { x: 104, w: 244, label: 'DESCRIPTION' },
  amt:  { x: 348, w: 44,  label: 'AMT', align: 'right' as const },
  x:    { x: 392, w: 26,  label: 'X',   align: 'center' as const },
  rate: { x: 418, w: 64,  label: 'RATE', align: 'right' as const },
  tot:  { x: 482, w: 90,  label: 'TOTAL', align: 'right' as const },
} as const
const BD_TABLE_LEFT = 40
const BD_TABLE_RIGHT = BD_COL.tot.x + BD_COL.tot.w  // 572

function fmtMoneyTight(v: number, currency = 'USD'): string {
  if (v === 0) return '—'
  return fmtMoney(v, currency)
}

function fmtNumber(v: number): string {
  // Whole-number-friendly: "1", "1.5", "2.75" — avoid trailing zeros.
  if (Number.isInteger(v)) return String(v)
  return v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

export async function budgetDetailedPdf(projectId: string, res: Response): Promise<void> {
  const { project, budget, accounts, items } = await loadProjectContext(projectId)
  const doc = setupPdf(res, `${slug(project.name)}-budget-detailed.pdf`)

  // Cover header — same brand identity as the Production Board so
  // both documents read as a matched set, just portrait instead of
  // landscape.
  doc.font('Helvetica-Bold').fontSize(24).fillColor('#1a1a1a')
    .text('Detailed Budget', 40, 40, { lineBreak: false })
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#333')
    .text('Project', 40, 78, { continued: true })
  doc.font('Helvetica').text(` ${project.name}`)
  if (project.subtitle) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#333')
      .text('Subtitle', { continued: true })
    doc.font('Helvetica').text(` ${project.subtitle}`)
  }
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#333')
    .text('Drafted', { continued: true })
  doc.font('Helvetica').text(
    ` ${new Date().toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })}`,
  )

  // Right-side brand mark. The address column is widened so the
  // street line doesn't wrap into the production rows.
  doc.rect(doc.page.width - 240, 40, 50, 50).fillColor('#F59E0B').fill()
  const addrW = 150
  const addrX = doc.page.width - 40 - addrW
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a1a1a')
    .text('Straw Hut Media', addrX, 48, { width: addrW, align: 'right', lineBreak: false })
  doc.font('Helvetica').fontSize(8).fillColor('#666')
    .text('822 N Dillon St, Los Angeles', addrX, 62, { width: addrW, align: 'right', lineBreak: false })
    .text('CA 90026, USA', addrX, 74, { width: addrW, align: 'right', lineBreak: false })

  doc.y = 130

  if (!budget) {
    doc.font('Helvetica').fontSize(11).fillColor('#666')
      .text('No budget for this project.', BD_TABLE_LEFT, doc.y + 12)
    addPageFooter(doc)
    doc.end(); return
  }

  const currency = budget.currency

  // Compute totals once.
  const accItems = (accId: string) => items.filter((i) => i.account_id === accId)
  const accTotal = (accId: string) => accItems(accId).reduce((s, i) => s + itemTotal(i), 0)
  const catTotal = (cat: string) => accounts.filter((a) => a.category === cat)
    .reduce((s, a) => s + accTotal(a.id), 0)
  const direct = CATEGORY_ORDER.reduce((s, c) => s + catTotal(c), 0)
  const contingency = direct * (Number(budget.contingency_pct) / 100)
  const bond = direct * (Number(budget.bond_pct) / 100)
  const grand = direct + contingency + bond

  // ── Column header band ──
  function drawHeaderRow(y: number): number {
    doc.rect(BD_TABLE_LEFT, y, BD_TABLE_RIGHT - BD_TABLE_LEFT, 16)
      .fillColor('#1b1f2e').fill()
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#fff')
    const cols = [BD_COL.acct, BD_COL.desc, BD_COL.amt, BD_COL.x, BD_COL.rate, BD_COL.tot]
    for (const c of cols) {
      doc.text(c.label, c.x, y + 5, {
        width: c.w, align: (c as any).align ?? 'left', lineBreak: false,
      })
    }
    return y + 16
  }

  let y = drawHeaderRow(doc.y)

  // ── Iterate categories → accounts → line items ──
  for (const cat of CATEGORY_ORDER) {
    const accs = accounts.filter((a) => a.category === cat)
    if (accs.length === 0) continue
    const ct = catTotal(cat)

    // Pagination guard before category band
    if (y > doc.page.height - 80) {
      doc.addPage(); y = drawHeaderRow(40)
    }

    // Category band
    doc.rect(BD_TABLE_LEFT, y, BD_TABLE_RIGHT - BD_TABLE_LEFT, 16)
      .fillColor('#fef3c7').fill()
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1a1a1a')
      .text((CATEGORY_LABEL[cat] ?? cat).toUpperCase(), BD_COL.acct.x + 2, y + 4, {
        width: BD_COL.desc.x + BD_COL.desc.w - BD_COL.acct.x, lineBreak: false,
      })
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1a1a1a')
      .text(fmtMoneyTight(ct, currency), BD_COL.tot.x, y + 4, {
        width: BD_COL.tot.w, align: 'right', lineBreak: false,
      })
    y += 16

    for (const acc of accs) {
      const list = accItems(acc.id)
      const at = accTotal(acc.id)

      // Account row (always shown, even if empty — helps reviewers
      // see the chart of accounts)
      if (y > doc.page.height - 70) { doc.addPage(); y = drawHeaderRow(40) }
      doc.rect(BD_TABLE_LEFT, y, BD_TABLE_RIGHT - BD_TABLE_LEFT, 14)
        .fillColor('#f4f4f5').fill()
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#1a1a1a')
        .text(acc.code, BD_COL.acct.x + 2, y + 3, {
          width: BD_COL.acct.w, lineBreak: false,
        })
      doc.text(acc.name, BD_COL.desc.x, y + 3, {
        width: BD_COL.desc.w, ellipsis: true, lineBreak: false,
      })
      doc.text(fmtMoneyTight(at, currency), BD_COL.tot.x, y + 3, {
        width: BD_COL.tot.w, align: 'right', lineBreak: false,
      })
      y += 14
      // Horizontal line below the account
      doc.strokeColor('#e4e4e7').lineWidth(0.3)
        .moveTo(BD_TABLE_LEFT, y).lineTo(BD_TABLE_RIGHT, y).stroke()

      // Line items
      let lineIdx = 1
      for (const it of list) {
        if (y > doc.page.height - 70) { doc.addPage(); y = drawHeaderRow(40) }
        const subCode = `${acc.code}-${String(lineIdx).padStart(2, '0')}`
        lineIdx += 1

        const desc = it.vendor ? `${it.description}  ·  ${it.vendor}` : it.description
        const ros = it.spans_all_shoot_days ? '  [RoS]' : ''
        const total = itemTotal(it)

        doc.font('Helvetica').fontSize(8).fillColor('#333')
          .text(subCode, BD_COL.acct.x + 2, y + 3, {
            width: BD_COL.acct.w, lineBreak: false,
          })
          .text(`${desc}${ros}`, BD_COL.desc.x, y + 3, {
            width: BD_COL.desc.w, ellipsis: true, lineBreak: false,
          })
          .text(fmtNumber(it.amt), BD_COL.amt.x, y + 3, {
            width: BD_COL.amt.w, align: 'right', lineBreak: false,
          })
          .text(it.x === 1 ? '' : `×${fmtNumber(it.x)}`, BD_COL.x.x, y + 3, {
            width: BD_COL.x.w, align: 'center', lineBreak: false,
          })
          .text(it.rate ? fmtMoneyTight(it.rate, currency) : '', BD_COL.rate.x, y + 3, {
            width: BD_COL.rate.w, align: 'right', lineBreak: false,
          })
          .text(fmtMoneyTight(total, currency), BD_COL.tot.x, y + 3, {
            width: BD_COL.tot.w, align: 'right', lineBreak: false,
          })
        y += 13
        doc.strokeColor('#f4f4f5').lineWidth(0.3)
          .moveTo(BD_TABLE_LEFT, y).lineTo(BD_TABLE_RIGHT, y).stroke()
      }
    }
  }

  // ── Grand total panel ──
  if (y > doc.page.height - 130) { doc.addPage(); y = 40 }
  y += 14
  doc.strokeColor('#1b1f2e').lineWidth(1)
    .moveTo(BD_TABLE_LEFT, y).lineTo(BD_TABLE_RIGHT, y).stroke()
  y += 6

  function totalLine(label: string, value: number, bold = false) {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).fillColor('#1a1a1a')
      .text(label, BD_TABLE_LEFT, y, {
        width: BD_COL.rate.x + BD_COL.rate.w - BD_TABLE_LEFT - 8,
        align: 'right', lineBreak: false,
      })
      .text(fmtMoneyTight(value, currency), BD_COL.tot.x, y, {
        width: BD_COL.tot.w, align: 'right', lineBreak: false,
      })
    y += bold ? 18 : 14
  }

  totalLine('Direct Total', direct)
  totalLine(`Contingency (${budget.contingency_pct}%)`, contingency)
  totalLine(`Completion bond (${budget.bond_pct}%)`, bond)
  y += 2
  doc.strokeColor('#1b1f2e').lineWidth(1)
    .moveTo(BD_COL.amt.x, y).lineTo(BD_TABLE_RIGHT, y).stroke()
  y += 6
  totalLine('GRAND TOTAL', grand, true)

  // Footnote about RoS
  y += 8
  doc.font('Helvetica-Oblique').fontSize(7).fillColor('#666')
    .text('[RoS] = Run of Shoot — cost spans all shoot days (counted once, not per-day).',
      BD_TABLE_LEFT, y, { lineBreak: false })

  addPageFooter(doc)
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

// Layout reference for the production board (matches StudioBinder
// shooting-schedule export under docs/refs/biya-studiobinder/):
//
//   ┌────┬────────────────┬─────┬──────────┬──────────────┬────┬────┐
//   │SC.#│ SET (head+act) │ I/E │ CAST ID  │ SHOOT LOCATION│PGS │EST │
//   ├────┼────────────────┼─────┼──────────┼──────────────┼────┼────┤
//   │ 69 │ SAWYER'S CAR…  │INT/ │ 1        │ Sawyer's Car │3/8 │ 0m │
//   │    │ italic action  │EXT  │          │ - Kendrick H.│    │    │
//   │    │                │DAY  │          │              │    │    │
//   └────┴────────────────┴─────┴──────────┴──────────────┴────┴────┘
//   ▓▓▓ End of Day 1 of 21 — 7:00am to 7:00am — 1 4/8 total pages ▓▓▓
//
// Width budget (landscape LETTER, 712pt between margins):
//   SC# 36  ·  SET 248  ·  I/E 60  ·  CAST 92  ·  LOC 168  ·  PGS 48  ·  EST 60
const SB_COL = {
  sc:  { x: 40,  w: 36  },
  set: { x: 76,  w: 248 },
  ie:  { x: 324, w: 60  },
  cast:{ x: 384, w: 92  },
  loc: { x: 476, w: 168 },
  pgs: { x: 644, w: 48  },
  est: { x: 692, w: 60  },
} as const
const SB_TABLE_RIGHT = SB_COL.est.x + SB_COL.est.w  // 752
const SB_TABLE_LEFT = SB_COL.sc.x                    // 40

// Day code like "BIYA 032426" — project code + MMDDYY of the shoot
// date. Falls back to the day number if no date is set.
function dayCode(projectName: string, day: ShootDay): string {
  const code = projectName
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 6) || 'PRJ'
  if (!day.shoot_date) return `${code} DAY ${day.number}`
  const d = new Date(day.shoot_date + 'T12:00:00')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const yy = String(d.getUTCFullYear()).slice(-2)
  return `${code} ${mm}${dd}${yy}`
}

// Render the table column-header row. Called at the top of every
// page so the columns are always readable.
function drawStripHeaders(doc: typeof PDFDocument.prototype, y: number): number {
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#666')
  doc.text('SC. #',          SB_COL.sc.x,   y, { width: SB_COL.sc.w,   align: 'center', lineBreak: false })
  doc.text('SET',            SB_COL.set.x,  y, { width: SB_COL.set.w,                    lineBreak: false })
  doc.text('I/E',            SB_COL.ie.x,   y, { width: SB_COL.ie.w,   align: 'center', lineBreak: false })
  doc.text('CAST ID',        SB_COL.cast.x, y, { width: SB_COL.cast.w, align: 'center', lineBreak: false })
  doc.text('SHOOT LOCATION', SB_COL.loc.x,  y, { width: SB_COL.loc.w,                    lineBreak: false })
  doc.text('PAGES',          SB_COL.pgs.x,  y, { width: SB_COL.pgs.w,  align: 'center', lineBreak: false })
  doc.text('EST.',           SB_COL.est.x,  y, { width: SB_COL.est.w,  align: 'center', lineBreak: false })
  const baseY = y + 14
  doc.strokeColor('#999').lineWidth(0.6)
    .moveTo(SB_TABLE_LEFT, baseY).lineTo(SB_TABLE_RIGHT, baseY).stroke()
  return baseY + 2
}

// Render a single scene row at y, return the new y after the row.
function drawSceneRow(
  doc: typeof PDFDocument.prototype,
  s: Scene,
  numberOf: Map<string, number>,
  y: number,
): number {
  const kind = stripKind(s.int_ext, s.time_of_day)
  const style = STRIP_STYLES[kind] ?? STRIP_STYLES.DEFAULT
  const [br, bg, bb] = style.bg
  const [tr, tg, tb] = style.text

  // Compute row height dynamically. The SET column may need 2 lines
  // (heading + italic action). 36pt is plenty for typical content.
  const rowH = style.rowH

  // Background fill across the full table width.
  doc.rect(SB_TABLE_LEFT, y, SB_TABLE_RIGHT - SB_TABLE_LEFT, rowH)
    .fillColor([br, bg, bb] as unknown as string).fill()
  // Bottom hairline
  doc.strokeColor('#d4d4d8').lineWidth(0.4)
    .moveTo(SB_TABLE_LEFT, y + rowH).lineTo(SB_TABLE_RIGHT, y + rowH).stroke()

  const txt = [tr, tg, tb] as unknown as string
  const padY = 6

  // SC. # — centered, vertically toward top
  doc.fillColor(txt).font('Helvetica-Bold').fontSize(10)
    .text(s.number, SB_COL.sc.x, y + padY + 3, { width: SB_COL.sc.w, align: 'center', lineBreak: false })

  // SET — heading (slug in uppercase) + italic action snippet below.
  // This matches StudioBinder: the scene heading is the bold line, and
  // the first sentence of the action becomes the italic preview.
  const heading = (s.slug || s.location || '').toUpperCase()
  const action = actionSnippet(s.action_text)
  doc.font('Helvetica-Bold').fontSize(9).fillColor(txt)
    .text(heading, SB_COL.set.x, y + padY, { width: SB_COL.set.w, ellipsis: true, lineBreak: false })
  if (action) {
    doc.font('Helvetica-Oblique').fontSize(8).fillColor(txt)
      .text(action, SB_COL.set.x, y + padY + 12, {
        width: SB_COL.set.w, height: rowH - 16, ellipsis: true,
      })
  }

  // I/E — INT/EXT on top line, DAY/NIGHT on bottom line.
  const ie = (s.int_ext || '').toUpperCase()
  const tod = todLabel(s.time_of_day)
  doc.font('Helvetica-Bold').fontSize(9).fillColor(txt)
    .text(ie, SB_COL.ie.x, y + padY + 1, { width: SB_COL.ie.w, align: 'center', lineBreak: false })
  if (tod) {
    doc.text(tod, SB_COL.ie.x, y + padY + 12, { width: SB_COL.ie.w, align: 'center', lineBreak: false })
  }

  // CAST ID — comma-separated numbers, centered.
  const castNums = (s.characters ?? [])
    .map((c) => numberOf.get(c))
    .filter((n): n is number => typeof n === 'number')
    .sort((a, b) => a - b)
    .join(',  ')
  doc.font('Helvetica-Bold').fontSize(9).fillColor(txt)
    .text(castNums || '—', SB_COL.cast.x, y + padY + 6, {
      width: SB_COL.cast.w, align: 'center', ellipsis: true, lineBreak: false,
    })

  // SHOOT LOCATION
  doc.font('Helvetica').fontSize(9).fillColor(txt)
    .text(s.location || s.slug || '', SB_COL.loc.x, y + padY + 6, {
      width: SB_COL.loc.w, ellipsis: true, lineBreak: false,
    })

  // PAGES (eighths, "2 6/8" style, with the eighths slightly smaller)
  const pgs = fmtEighths(s.page_eighths)
  doc.font('Helvetica').fontSize(9).fillColor(txt)
    .text(pgs, SB_COL.pgs.x, y + padY + 6, { width: SB_COL.pgs.w, align: 'center', lineBreak: false })

  // EST. — we don't track per-scene minutes yet; default to "0m"
  // to match the StudioBinder reference for unset values.
  doc.font('Helvetica').fontSize(9).fillColor(txt)
    .text('0m', SB_COL.est.x, y + padY + 6, { width: SB_COL.est.w, align: 'center', lineBreak: false })

  return y + rowH
}

// Dark navy "End of Day X of N" separator band.
function drawDaySeparator(
  doc: typeof PDFDocument.prototype,
  y: number,
  dayNum: number,
  totalDays: number,
  totalEighths: number,
): number {
  const h = 26
  const [r, g, b] = DAY_BAND_BG
  doc.rect(SB_TABLE_LEFT, y, SB_TABLE_RIGHT - SB_TABLE_LEFT, h)
    .fillColor([r, g, b] as unknown as string).fill()
  const [tr, tg, tb] = DAY_BAND_TEXT
  doc.fillColor([tr, tg, tb] as unknown as string)
  // Two lines packed inside the band.
  doc.font('Helvetica').fontSize(7).text(
    'End of', SB_TABLE_LEFT + 12, y + 5, { lineBreak: false, continued: true },
  )
  doc.font('Helvetica-Bold').fontSize(8).text(
    ` Day ${dayNum} of ${totalDays}`, { lineBreak: false },
  )
  doc.font('Helvetica').fontSize(7)
    .text('—  7:00am ', SB_TABLE_LEFT + 12, y + 15, { lineBreak: false, continued: true })
  doc.font('Helvetica-Oblique').fontSize(7).text('to', { lineBreak: false, continued: true })
  doc.font('Helvetica').fontSize(7).text(' 7:00am  —  ', { lineBreak: false, continued: true })
  doc.font('Helvetica-Bold').fontSize(8).text(fmtEighths(totalEighths), { lineBreak: false, continued: true })
  doc.font('Helvetica').fontSize(7).text(' total pages', { lineBreak: false })
  return y + h
}

// First sentence of the scene's action body, capped to ~110 chars so
// it fits as a single italic line under the slug. Trailing ellipsis
// matches the StudioBinder reference ("As Kendrick descends the steps,
// he stops. He s…").
function actionSnippet(action: string | null): string {
  if (!action) return ''
  const trimmed = action.trim().replace(/\s+/g, ' ')
  const cap = 110
  if (trimmed.length <= cap) return trimmed
  return trimmed.slice(0, cap).trimEnd() + '…'
}

function todLabel(timeOfDay: string | null): string {
  const t = (timeOfDay || '').toUpperCase()
  if (!t) return ''
  if (t.includes('NIGHT')) return 'NIGHT'
  if (t.includes('SUNSET') || t.includes('DUSK')) return 'SUNSET'
  if (t.includes('SUNRISE') || t.includes('DAWN')) return 'DAWN'
  if (t.includes('MORNING')) return 'MORNING'
  if (t.includes('EVENING')) return 'EVENING'
  if (t.includes('DAY')) return 'DAY'
  return t.slice(0, 10)
}

// Cover header on page 1 only — title, project, script revision,
// timestamp, plus the cast legend with numbered circles.
function drawSchedulerCover(
  doc: typeof PDFDocument.prototype,
  project: ProjectRow,
  legend: Array<{ number: number; name: string; sceneCount: number }>,
  title: string = 'Shooting Schedule',
) {
  // Title block (left)
  doc.font('Helvetica-Bold').fontSize(24).fillColor('#1a1a1a')
    .text(title, 40, 40, { lineBreak: false })
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#333')
    .text('Project', 40, 78, { continued: true })
  doc.font('Helvetica').text(` ${project.name}`)
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#333')
    .text('Script v3', { continued: true })
  doc.font('Helvetica').text(` ${project.subtitle ?? project.name}`)
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#333')
    .text('Created', { continued: true })
  doc.font('Helvetica').text(
    ` on ${new Date().toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })}`,
  )

  // Orange brand square + address (right)
  doc.rect(doc.page.width - 240, 40, 60, 60).fillColor('#F59E0B').fill()
  const addrW = 150
  const addrX = doc.page.width - 40 - addrW
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a1a1a')
    .text('Straw Hut Media', addrX, 48, { width: addrW, align: 'right', lineBreak: false })
  doc.font('Helvetica').fontSize(8).fillColor('#666')
    .text('822 N Dillon St, Los Angeles', addrX, 62, { width: addrW, align: 'right', lineBreak: false })
    .text('CA 90026, USA', addrX, 74, { width: addrW, align: 'right', lineBreak: false })

  // Cast legend
  let y = 150
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#1a1a1a')
    .text('CAST LEGEND', 40, y)
  y += 14
  doc.strokeColor('#1a1a1a').lineWidth(1).moveTo(40, y).lineTo(doc.page.width - 40, y).stroke()
  y += 8

  // Numbered circles + name + middot separators. Wraps across lines.
  const lineH = 18
  let x = 40
  const maxX = doc.page.width - 40
  doc.font('Helvetica').fontSize(8.5).fillColor('#1a1a1a')
  for (let i = 0; i < legend.length; i++) {
    const c = legend[i]
    const label = c.name
    const circleR = 7
    const labelW = doc.widthOfString(label, { font: 'Helvetica', size: 8.5 })
    const sepW = 12
    const entryW = circleR * 2 + 6 + labelW + sepW
    if (x + entryW > maxX) { x = 40; y += lineH }
    // Filled gray circle with the number
    doc.circle(x + circleR, y + circleR, circleR).fillColor('#3f3f46').fill()
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(7.5)
      .text(String(c.number), x, y + circleR - 4, {
        width: circleR * 2, align: 'center', lineBreak: false,
      })
    // Name
    doc.fillColor('#1a1a1a').font('Helvetica').fontSize(8.5)
      .text(label, x + circleR * 2 + 4, y + circleR - 4, { lineBreak: false })
    x += circleR * 2 + 4 + labelW
    // Middot separator (skip after last entry)
    if (i < legend.length - 1) {
      doc.fillColor('#888').text('  ·  ', x, y + circleR - 4, { lineBreak: false })
      x += 12
    }
  }
  y += lineH + 4
  doc.strokeColor('#1a1a1a').lineWidth(1).moveTo(40, y).lineTo(doc.page.width - 40, y).stroke()
  doc.y = y + 8
}

export async function stripboardPdf(projectId: string, res: Response): Promise<void> {
  const { project, scenes, shootDays } = await loadProjectContext(projectId)
  const doc = setupPdf(res, `${slug(project.name)}-stripboard.pdf`, true)

  const { numberOf, legend } = buildCastNumbers(scenes)
  drawSchedulerCover(doc, project, legend)

  const scenesByDay = new Map<string | null, Scene[]>()
  for (const s of scenes) {
    const key = s.shoot_day_id ?? null
    const arr = scenesByDay.get(key) ?? []
    arr.push(s); scenesByDay.set(key, arr)
  }

  const shootingDays = shootDays.filter((d) => !d.is_break)
  const totalDays = shootingDays.length

  // Renders one day's worth of strips, paginating as needed and
  // re-drawing the column header at the top of any new page.
  function renderDay(label: string, day: ShootDay | null, scns: Scene[], isBreak: boolean) {
    const totalEighths = scns.reduce((s, sc) => s + sc.page_eighths, 0)

    // If we don't have at least one row's worth of vertical space,
    // start a new page so we don't break right before the day label.
    if (doc.y > doc.page.height - 100) {
      doc.addPage({ layout: 'landscape', margin: 40 })
      doc.y = 40
    }

    // Day code label e.g. "BIYA 032426". We hand-compute the next y
    // because text({lineBreak:false}) does not advance doc.y for the
    // caller, leading to the headers overlapping the day label.
    let cursorY = doc.y
    if (!isBreak) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#1a1a1a')
        .text(day ? dayCode(project.name, day) : label, SB_TABLE_LEFT, cursorY, { lineBreak: false })
      cursorY += 18
    } else {
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#888')
        .text(label, SB_TABLE_LEFT, cursorY, { lineBreak: false })
      doc.font('Helvetica-Oblique').fontSize(9).fillColor('#888')
        .text('— break day —', SB_TABLE_LEFT, cursorY + 16)
      doc.y = cursorY + 32
      return
    }

    let y = drawStripHeaders(doc, cursorY)

    for (const s of scns) {
      if (y > doc.page.height - 60) {
        doc.addPage({ layout: 'landscape', margin: 40 })
        y = drawStripHeaders(doc, 40)
      }
      y = drawSceneRow(doc, s, numberOf, y)
    }

    // End-of-day separator (only for real shooting days, not the
    // UNSCHEDULED bucket).
    if (day) {
      if (y > doc.page.height - 50) {
        doc.addPage({ layout: 'landscape', margin: 40 })
        y = 40
      }
      y = drawDaySeparator(doc, y, day.number, totalDays, totalEighths)
    }
    doc.y = y + 6
  }

  const unscheduled = scenesByDay.get(null) ?? []
  if (unscheduled.length > 0) {
    renderDay('UNSCHEDULED', null, unscheduled, false)
  }
  for (const d of shootDays) {
    const scns = scenesByDay.get(d.id) ?? []
    if (scns.length === 0 && !d.is_break) continue
    renderDay(`DAY ${d.number}`, d, scns, d.is_break)
  }

  addPageFooter(doc)
  doc.end()
}

// ────────────────────────────────────────────────────────────────────
// 4. DAY-OUT-OF-DAYS
// ────────────────────────────────────────────────────────────────────
export async function doodPdf(projectId: string, res: Response): Promise<void> {
  const { project, scenes, shootDays } = await loadProjectContext(projectId)
  const doc = setupPdf(res, `${slug(project.name)}-dood.pdf`, true)

  const { numberOf, legend } = buildCastNumbers(scenes)
  drawSchedulerCover(doc, project, legend, 'Day Out of Days')

  const allChars = Array.from(numberOf.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([name]) => name)

  const shootingDays = shootDays.filter((d) => !d.is_break)
  if (shootingDays.length === 0 || allChars.length === 0) {
    doc.font('Helvetica').fontSize(11).fillColor('#666')
      .text('Schedule a shoot day with cast first.', SB_TABLE_LEFT, doc.y + 12)
    addPageFooter(doc)
    doc.end(); return
  }

  type CharRow = {
    castNum: number; name: string;
    days: Map<number, boolean>;
    start: number | null; finish: number | null; workCount: number;
  }
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
  rows.sort((a, b) => a.castNum - b.castNum)

  // Codes per industry convention:
  //   SW   start work (= first day of work)
  //   W    work
  //   WF   work / finish (= last day of work)
  //   SWF  start / work / finish (single-day actor)
  //   H    hold (gap between start and finish)
  function codeFor(row: CharRow, dayNum: number): { code: string; bg: string; fg: string } | null {
    const works = row.days.has(dayNum)
    if (works) {
      const isStart = dayNum === row.start
      const isFinish = dayNum === row.finish
      if (isStart && isFinish) return { code: 'SWF', bg: '#1e293b', fg: '#fff' }
      if (isStart)             return { code: 'SW',  bg: '#10b981', fg: '#fff' }
      if (isFinish)            return { code: 'WF',  bg: '#0ea5e9', fg: '#fff' }
      return { code: 'W', bg: '#34d399', fg: '#0f172a' }
    }
    if (row.start != null && row.finish != null && dayNum > row.start && dayNum < row.finish) {
      return { code: 'H', bg: '#f5f5f4', fg: '#71717a' }
    }
    return null
  }

  // Column widths (landscape LETTER, 712pt content)
  const numColW = 26
  const charColW = 130
  const summaryColW = 48
  const summarySpan = summaryColW * 3
  const availDayW = doc.page.width - 80 - numColW - charColW - summarySpan
  const dayColW = Math.max(14, availDayW / shootingDays.length)
  const startX = SB_TABLE_LEFT

  function drawHeader(yIn: number): number {
    let y = yIn
    // Header background band — light gray to give the table a clean
    // top edge in the StudioBinder family.
    doc.rect(startX, y, doc.page.width - 80, 16).fillColor('#f4f4f5').fill()
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#1a1a1a')
    doc.text('#', startX, y + 5, { width: numColW, align: 'center', lineBreak: false })
    doc.text('CHARACTER', startX + numColW + 4, y + 5, { width: charColW, lineBreak: false })
    for (let i = 0; i < shootingDays.length; i++) {
      const d = shootingDays[i]
      doc.text(String(d.number),
        startX + numColW + charColW + i * dayColW, y + 5,
        { width: dayColW, align: 'center', lineBreak: false })
    }
    const summaryX = startX + numColW + charColW + shootingDays.length * dayColW
    doc.text('START',  summaryX,                  y + 5, { width: summaryColW, align: 'center', lineBreak: false })
    doc.text('FINISH', summaryX + summaryColW,    y + 5, { width: summaryColW, align: 'center', lineBreak: false })
    doc.text('WORK',   summaryX + summaryColW * 2, y + 5, { width: summaryColW, align: 'center', lineBreak: false })
    y += 16
    doc.strokeColor('#999').lineWidth(0.4)
      .moveTo(startX, y).lineTo(doc.page.width - 40, y).stroke()
    return y + 2
  }

  let y = drawHeader(doc.y)

  for (const row of rows) {
    if (y > doc.page.height - 70) {
      doc.addPage({ layout: 'landscape', margin: 40 })
      y = drawHeader(40)
    }
    const rowH = 14
    // Alternate light banding for readability — every other row.
    if (row.castNum % 2 === 0) {
      doc.rect(startX, y, doc.page.width - 80, rowH).fillColor('#fafafa').fill()
    }

    doc.fillColor('#1a1a1a').font('Helvetica-Bold').fontSize(8)
      .text(String(row.castNum), startX, y + 3, {
        width: numColW, align: 'center', lineBreak: false,
      })
    doc.font('Helvetica').fontSize(8)
      .text(row.name, startX + numColW + 4, y + 3, {
        width: charColW, ellipsis: true, lineBreak: false,
      })

    for (let i = 0; i < shootingDays.length; i++) {
      const d = shootingDays[i]
      const cx = startX + numColW + charColW + i * dayColW
      const c = codeFor(row, d.number)
      if (c) {
        doc.rect(cx + 1, y + 1, dayColW - 2, rowH - 2).fillColor(c.bg).fill()
        doc.font('Helvetica-Bold').fontSize(6.5).fillColor(c.fg)
          .text(c.code, cx, y + 3, { width: dayColW, align: 'center', lineBreak: false })
      }
    }

    const summaryX = startX + numColW + charColW + shootingDays.length * dayColW
    doc.fillColor('#1a1a1a').font('Helvetica').fontSize(8)
      .text(String(row.start ?? '—'), summaryX, y + 3,
        { width: summaryColW, align: 'center', lineBreak: false })
      .text(String(row.finish ?? '—'), summaryX + summaryColW, y + 3,
        { width: summaryColW, align: 'center', lineBreak: false })
    doc.font('Helvetica-Bold')
      .text(String(row.workCount), summaryX + summaryColW * 2, y + 3,
        { width: summaryColW, align: 'center', lineBreak: false })
    // Hairline under the row
    doc.strokeColor('#e4e4e7').lineWidth(0.3)
      .moveTo(startX, y + rowH).lineTo(doc.page.width - 40, y + rowH).stroke()
    y += rowH
  }

  // Code legend at the bottom of the last page so the AD knows what
  // each two-letter code means.
  if (y > doc.page.height - 70) {
    doc.addPage({ layout: 'landscape', margin: 40 })
    y = 40
  }
  y += 10
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#1a1a1a')
    .text('CODES', startX, y, { lineBreak: false })
  y += 12
  const codeKey: Array<[string, string, string, string]> = [
    ['SW',  'Start work — actor\'s first day on schedule', '#10b981', '#fff'],
    ['W',   'Work — actor on set this day',                 '#34d399', '#0f172a'],
    ['WF',  'Work / finish — actor wraps this day',         '#0ea5e9', '#fff'],
    ['SWF', 'Start / work / finish (single day)',           '#1e293b', '#fff'],
    ['H',   'Hold — between start and finish, not working', '#f5f5f4', '#71717a'],
  ]
  for (const [code, desc, bg, fg] of codeKey) {
    doc.rect(startX, y, 26, 11).fillColor(bg).fill()
    doc.font('Helvetica-Bold').fontSize(7).fillColor(fg)
      .text(code, startX, y + 2, { width: 26, align: 'center', lineBreak: false })
    doc.font('Helvetica').fontSize(8).fillColor('#1a1a1a')
      .text(desc, startX + 32, y + 2, { lineBreak: false })
    y += 14
  }

  addPageFooter(doc)
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

  // Group by character name (use description as character name).
  //
  // itemTotal(it) returns amt*x*rate — the full budgeted amount for the
  // line, however the producer entered it (flat fee, day-rate × days,
  // etc.). The grand total is a sum of those, so we trust it as the row
  // total. The "day rate" column is derived — total ÷ scheduled work
  // days — so a flat-fee row still shows a meaningful per-day figure
  // instead of being multiplied by work days a second time.
  type Row = { character: string; actor: string | null; dayRate: number; workDays: number; sceneCount: number; total: number }
  const rows: Row[] = []
  const seenChars = new Set<string>()
  for (const it of castItems) {
    const character = it.description
    if (seenChars.has(character.toUpperCase())) continue
    seenChars.add(character.toUpperCase())
    const wd = workDaysFor(character) || workDaysFor(character.toUpperCase()) || 0
    const sc = charScenes.get(character) ?? charScenes.get(character.toUpperCase()) ?? 0
    const total = itemTotal(it)
    rows.push({
      character,
      actor: it.vendor,
      dayRate: total / Math.max(1, wd),
      workDays: wd,
      sceneCount: sc,
      total,
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

// Minimal "X of N" page number in the bottom-right corner — the
// footer style used by the StudioBinder shooting-schedule export.
// No project/title chrome, since the cover page already carries that.
function addPageFooter(doc: typeof PDFDocument.prototype) {
  const range = doc.bufferedPageRange()
  const total = range.count
  for (let i = 0; i < total; i++) {
    doc.switchToPage(range.start + i)
    // pdfkit's text() auto-pages when doc.y is near the page bottom
    // even with `lineBreak: false`, because the wrap path still uses
    // doc.y as the start anchor. Render to a y safely above the
    // bottom margin to dodge that path entirely.
    const w = 60
    const x = doc.page.width - 40 - w
    const y = doc.page.height - 40 - 12
    doc.x = x
    doc.y = y
    doc.font('Helvetica').fontSize(8).fillColor('#888')
      .text(`${i + 1} of ${total}`, x, y, {
        width: w, align: 'right', lineBreak: false,
      })
  }
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

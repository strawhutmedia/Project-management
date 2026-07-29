// Boot-time diagnostic: compute the BIYA budget three ways and mirror the
// result to the status branch as budget-reconcile.json, so we can see on
// LIVE data exactly why the "Grand total" and the sum of per-day budgets
// disagree.
//
//   1. grand      — the top-sheet Grand total (all line items + old-model
//                    fringes/per-diem/hotels + contingency + bond)
//   2. production  — the Production goal bar (production+above_line line
//                    items + autoDayCosts from the per-day model)
//   3. sumOfDays   — the true sum of every shoot day's "Day total"
//                    (day items + scene rollup + per-day fringes)
//
// Runs 25s after boot (after the script dump) so it doesn't fight startup.
// Idempotent — writes the same file every boot.

import { pool } from './db'
import { writeStatusFile, statusReportingEnabled } from './github'
import { logError, logInfo } from './diag'

const BIYA_PROJECT_ID = '12f53ed1-c6c7-4c11-8d7b-06d91744c9af'
const STUDIO_ZONE_MI = 30

export function scheduleBootBudgetDump(): void {
  setTimeout(() => {
    void dumpBudgetReconcile()
  }, 25_000).unref()
}

async function dumpBudgetReconcile(): Promise<void> {
  if (!statusReportingEnabled()) {
    logInfo('budget dump: skipped — GITHUB_TOKEN not set')
    return
  }
  try {
    const bRes = await pool.query(
      `SELECT id, currency, shoot_days, bond_pct, contingency_pct,
              cast_payroll_pct, crew_payroll_pct,
              cast_per_diem_daily, crew_per_diem_daily,
              cast_per_diem_headcount, crew_per_diem_headcount,
              home_location_tag, hotel_cast_nightly, hotel_crew_nightly,
              hotel_contingency_pct, mileage_rate_per_mi, travel_days,
              production_target, post_target, marketing_target, admin_target, total_target
         FROM budgets WHERE project_id = $1`,
      [BIYA_PROJECT_ID],
    )
    if (bRes.rows.length === 0) {
      logInfo('budget dump: no budget for BIYA — skipping')
      return
    }
    const b = bRes.rows[0]
    const num = (v: unknown, d = 0) => (v == null ? d : Number(v))

    // --- Accounts + line items ---
    const accRes = await pool.query<{ id: string; code: string; name: string; category: string }>(
      `SELECT id, code, name, category FROM budget_accounts WHERE budget_id = $1`,
      [b.id],
    )
    const liRes = await pool.query<{ account_id: string; code: string | null; total: string; scene_id: string | null; shoot_day_id: string | null; spans_all_shoot_days: boolean }>(
      `SELECT li.account_id, li.code, li.scene_id, li.shoot_day_id, li.spans_all_shoot_days,
              (li.amt * li.x * li.rate)::numeric AS total
         FROM budget_line_items li
         JOIN budget_accounts a ON a.id = li.account_id
        WHERE a.budget_id = $1`,
      [b.id],
    )
    // Run-of-shoot multiplier: real shooting days (not travel/break).
    const shootDayRes = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::int AS n FROM shoot_days
        WHERE project_id = $1 AND COALESCE(is_travel,false)=false AND COALESCE(is_break,false)=false`,
      [BIYA_PROJECT_ID],
    )
    const N = Number(shootDayRes.rows[0]?.n ?? 0)
    const accById = new Map(accRes.rows.map((a) => [a.id, a]))
    const perAccount = new Map<string, { code: string; name: string; category: string; total: number; items: number }>()
    let directTotal = 0
    const byCategory: Record<string, number> = {}
    let castSubtotal = 0, crewSubtotal = 0
    for (const li of liRes.rows) {
      const acc = accById.get(li.account_id)
      if (!acc) continue
      // Effective cost: run-of-shoot per-day rates count once per shooting day.
      const t = Number(li.total) * (li.spans_all_shoot_days && N > 0 ? N : 1)
      directTotal += t
      byCategory[acc.category] = (byCategory[acc.category] ?? 0) + t
      if (acc.code?.startsWith('14-')) castSubtotal += t
      else if (acc.category === 'production') crewSubtotal += t
      const cur = perAccount.get(acc.id) ?? { code: acc.code, name: acc.name, category: acc.category, total: 0, items: 0 }
      cur.total += t; cur.items += 1
      perAccount.set(acc.id, cur)
    }

    // --- (1) Grand total: old headcount-based fringe model ---
    const castPct = num(b.cast_payroll_pct, 33), crewPct = num(b.crew_payroll_pct, 15)
    const homeTag = (b.home_location_tag ?? '').trim().toLowerCase()
    const awayRes = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::int AS n FROM shoot_days
        WHERE project_id = $1 AND location_tag IS NOT NULL AND LOWER(TRIM(location_tag)) <> $2`,
      [BIYA_PROJECT_ID, homeTag],
    )
    const awayDaysCount = Number(awayRes.rows[0]?.n ?? 0)
    const travelDays = num(b.travel_days)
    const perDiemDays = awayDaysCount + travelDays
    const castHead = num(b.cast_per_diem_headcount), crewHead = num(b.crew_per_diem_headcount)
    const oldFringes = castSubtotal * (castPct / 100) + crewSubtotal * (crewPct / 100)
    const oldPerDiem = (num(b.cast_per_diem_daily) * castHead + num(b.crew_per_diem_daily) * crewHead) * perDiemDays
    const oldHotels =
      (num(b.hotel_cast_nightly) * castHead + num(b.hotel_crew_nightly) * crewHead) *
      perDiemDays * (1 + num(b.hotel_contingency_pct, 10) / 100)
    const directPlusFringes = directTotal + oldFringes + oldPerDiem + oldHotels
    const contingency = directPlusFringes * (num(b.contingency_pct) / 100)
    const bond = directPlusFringes * (num(b.bond_pct) / 100)
    const grand = directPlusFringes + contingency + bond

    // --- (2)+(3) Per-day model ---
    const dayAgg = await pool.query<{
      id: string; number: string; location_tag: string | null; is_travel: boolean;
      travel_miles: string | null; travel_hours: string | null;
      cast_count: string; crew_count: string; cast_total: string; crew_total: string;
      day_items_total: string; day_items_count: string; scene_items_total: string;
    }>(
      `SELECT sd.id, sd.number, sd.location_tag, sd.is_travel, sd.travel_miles, sd.travel_hours,
              COUNT(li.id) FILTER (WHERE li.code = 'CAST') AS cast_count,
              COUNT(li.id) FILTER (WHERE li.code = 'CREW') AS crew_count,
              COALESCE(SUM(li.amt*li.x*li.rate) FILTER (WHERE li.code = 'CAST'),0) AS cast_total,
              COALESCE(SUM(li.amt*li.x*li.rate) FILTER (WHERE li.code = 'CREW'),0) AS crew_total,
              COALESCE(SUM(li.amt*li.x*li.rate),0) AS day_items_total,
              COUNT(li.id) AS day_items_count,
              COALESCE((SELECT SUM(li2.amt*li2.x*li2.rate)
                          FROM scenes s2 JOIN budget_line_items li2 ON li2.scene_id = s2.id
                         WHERE s2.shoot_day_id = sd.id AND (li2.amt*li2.x*li2.rate) >= 1),0) AS scene_items_total
         FROM shoot_days sd
         LEFT JOIN budget_line_items li ON li.shoot_day_id = sd.id
        WHERE sd.project_id = $1
        GROUP BY sd.id
        ORDER BY sd.number ASC`,
      [BIYA_PROJECT_ID],
    )
    const castPDd = num(b.cast_per_diem_daily), crewPDd = num(b.crew_per_diem_daily)
    const hotelCastN = num(b.hotel_cast_nightly), hotelCrewN = num(b.hotel_crew_nightly)
    const hotelContPct = num(b.hotel_contingency_pct, 10)
    const mileageRate = num(b.mileage_rate_per_mi, 0.7)

    let autoFringes = 0, autoPerDiem = 0, autoHotels = 0, autoMileage = 0, autoCrewDiscount = 0
    let sumOfDays = 0
    const days: unknown[] = []
    for (const d of dayAgg.rows) {
      const castCount = Number(d.cast_count), crewCount = Number(d.crew_count)
      const castTotal = Number(d.cast_total), crewTotal = Number(d.crew_total)
      const dayItemsRaw = Number(d.day_items_total), sceneItems = Number(d.scene_items_total)
      const tag = (d.location_tag ?? '').trim().toLowerCase()
      const away = tag !== '' && tag !== homeTag
      const miles = num(d.travel_miles)
      const hours = d.travel_hours != null ? Number(d.travel_hours) : null
      const crewMult = d.is_travel && hours != null && hours < 4 ? 0.5 : 1
      const effCrew = crewTotal * crewMult
      const crewReduction = crewTotal - effCrew
      autoCrewDiscount += crewReduction
      const dFringes = castTotal * (castPct / 100) + effCrew * (crewPct / 100)
      autoFringes += dFringes
      let dPerDiem = 0, dHotels = 0, dMileage = 0
      if (away) {
        dPerDiem = castPDd * castCount + crewPDd * crewCount
        dHotels = (hotelCastN * castCount + hotelCrewN * crewCount) * (1 + hotelContPct / 100)
        autoPerDiem += dPerDiem; autoHotels += dHotels
      }
      if (d.is_travel) {
        dMileage = mileageRate * Math.max(0, miles - STUDIO_ZONE_MI) * (castCount + crewCount)
        autoMileage += dMileage
      }
      const dayItemsTotal = dayItemsRaw - crewReduction
      const dayTotal = dayItemsTotal + sceneItems + dFringes + dPerDiem + dHotels + dMileage
      sumOfDays += dayTotal
      days.push({
        number: d.number, locationTag: d.location_tag, away, isTravel: d.is_travel,
        dayItemsCount: Number(d.day_items_count),
        castCount, crewCount,
        dayItemsTotal: Math.round(dayItemsTotal), sceneItems: Math.round(sceneItems),
        fringes: Math.round(dFringes), perDiem: Math.round(dPerDiem),
        hotels: Math.round(dHotels), mileage: Math.round(dMileage),
        dayTotal: Math.round(dayTotal),
      })
    }
    const autoDayCosts = autoFringes + autoPerDiem + autoHotels + autoMileage - autoCrewDiscount
    const productionLineItems = Array.from(perAccount.values())
      .filter((a) => a.category === 'above_line' || a.category === 'production')
      .reduce((s, a) => s + a.total, 0)
    const production = productionLineItems + autoDayCosts

    const accounts = Array.from(perAccount.values())
      .sort((a, b2) => b2.total - a.total)
      .map((a) => ({ code: a.code, name: a.name, category: a.category, total: Math.round(a.total), items: a.items }))

    const out = {
      generatedAt: new Date().toISOString(),
      note: 'Diagnostic: three ways of totalling the BIYA budget, to explain why they disagree.',
      totals: {
        grand: Math.round(grand),
        production_goalbar: Math.round(production),
        sumOfDayBudgets: Math.round(sumOfDays),
        directTotal_allLineItems: Math.round(directTotal),
      },
      grandBreakdown: {
        directTotal: Math.round(directTotal),
        oldModel_fringes: Math.round(oldFringes),
        oldModel_perDiem: Math.round(oldPerDiem),
        oldModel_hotels: Math.round(oldHotels),
        contingency: Math.round(contingency),
        bond: Math.round(bond),
      },
      perDayModel: {
        autoDayCosts: Math.round(autoDayCosts),
        autoFringes: Math.round(autoFringes),
        autoPerDiem: Math.round(autoPerDiem),
        autoHotels: Math.round(autoHotels),
        autoMileage: Math.round(autoMileage),
        autoCrewDiscount: Math.round(autoCrewDiscount),
        productionLineItems: Math.round(productionLineItems),
      },
      settings: {
        shootDays: num(b.shoot_days), travelDays, awayDaysCount, perDiemDays,
        castPct, crewPct, castPDd, crewPDd, castHead, crewHead,
        hotelCastN, hotelCrewN, hotelContPct, mileageRate,
        contingencyPct: num(b.contingency_pct), bondPct: num(b.bond_pct),
        targets: {
          total: num(b.total_target), production: num(b.production_target),
          post: num(b.post_target), marketing: num(b.marketing_target), admin: num(b.admin_target),
        },
      },
      byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, Math.round(v)])),
      accounts,
      days,
    }

    const result = await writeStatusFile('budget-reconcile.json', JSON.stringify(out, null, 2), 'budget: reconcile dump')
    if (!result.ok) {
      logError('budget dump: github write failed', { error: result.error })
      return
    }
    logInfo('budget dump: wrote budget-reconcile.json', {
      grand: out.totals.grand, production: out.totals.production_goalbar, sumOfDays: out.totals.sumOfDayBudgets,
    })
  } catch (err) {
    logError('budget dump: threw', { error: err instanceof Error ? err.message : String(err) })
  }
}

import type { BudgetRow } from "../performanceMetrics";

// ============ Budget sul periodo selezionato ============
//
// v_budgets_current ha granularita' mensile (season_year, month, level).
// Il budget di un periodo si ottiene dai soli mesi che il periodo copre:
// un mese intero entra per intero, un mese coperto solo in parte entra
// pro-rata giorni (unica ripartizione possibile senza un budget
// giornaliero): revenue_target, room_nights_sold_target e
// room_nights_available scalati per giorni inclusi / giorni del mese;
// l'occupazione target e' sempre sold_target / available del periodo,
// mai la percentuale salvata. Mai il mese corrente o il mese di
// periodStart per un periodo diverso.

export type PeriodKind = "month" | "year" | "range";

export type MonthSlice = {
  year: number;
  month: number;
  daysInPeriod: number;
  daysInMonth: number;
};

export type MonthlyBudgetRow = BudgetRow & { season_year: number; month: number };

export type PeriodBudget = {
  kind: PeriodKind;
  // Un BudgetRow aggregato per ciascun livello con almeno un mese di budget.
  budgets: BudgetRow[];
  monthsInPeriod: number;
  // Mesi del periodo con budget Minimo presente (copertura del budget).
  monthsWithBudget: number;
  // true se almeno un mese entra pro-rata (periodo che taglia un mese).
  prorated: boolean;
  daysInPeriod: number;
};

function daysInMonthOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export function daysBetweenInclusive(start: string, end: string): number {
  return end < start ? 0 : dayNumber(end) - dayNumber(start) + 1;
}

export function periodKind(start: string, end: string): PeriodKind {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  if (sy === ey && sm === 1 && sd === 1 && em === 12 && ed === 31) return "year";
  if (sy === ey && sm === em && sd === 1 && ed === daysInMonthOf(ey, em)) return "month";
  return "range";
}

export function monthsInPeriod(start: string, end: string): MonthSlice[] {
  if (end < start) return [];
  const slices: MonthSlice[] = [];
  let [year, month] = start.split("-").map(Number);
  const [endYear, endMonth] = end.split("-").map(Number);
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const dim = daysInMonthOf(year, month);
    const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(dim).padStart(2, "0")}`;
    const from = start > monthStart ? start : monthStart;
    const to = end < monthEnd ? end : monthEnd;
    slices.push({ year, month, daysInPeriod: daysBetweenInclusive(from, to), daysInMonth: dim });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return slices;
}

// Aggrega piu' righe budget (una per mese) in un'unica riga equivalente:
// revenue_target e room_nights_available si sommano, occupancy_pct_target
// diventa una media pesata sulle camere disponibili di ciascun mese, cosi'
// che (occupancy_pct_target x room_nights_available) ricostruisca la somma
// corretta delle camere-obiettivo mese per mese (non la somma di medie
// slegate, che darebbe un risultato diverso e sbagliato). Su un singolo
// mese (un solo elemento nell'array) restituisce esattamente la riga di
// partenza.
export function aggregateBudgetRows(rows: BudgetRow[]): BudgetRow {
  const revenue_target = rows.reduce((sum, r) => sum + Number(r.revenue_target), 0);
  const room_nights_available = rows.reduce((sum, r) => sum + Number(r.room_nights_available), 0);
  const room_nights_sold_target = rows.reduce((sum, r) => sum + Number(r.room_nights_sold_target), 0);
  const targetRoomsSoldSum = rows.reduce(
    (sum, r) => sum + Number(r.occupancy_pct_target) * Number(r.room_nights_available),
    0
  );
  const avgAdr = rows.length > 0 ? rows.reduce((sum, r) => sum + Number(r.adr), 0) / rows.length : 0;

  return {
    level: rows[0].level,
    adr: avgAdr,
    revenue_target,
    room_nights_sold_target,
    room_nights_available,
    occupancy_pct_target: room_nights_available !== 0 ? targetRoomsSoldSum / room_nights_available : 0,
  };
}

const LEVELS: BudgetRow["level"][] = ["minimo", "realistico", "sfidante"];

export function computePeriodBudget(rows: MonthlyBudgetRow[], start: string, end: string): PeriodBudget {
  const slices = monthsInPeriod(start, end);
  const inPeriod = new Map(slices.map((s) => [`${s.year}-${s.month}`, s]));

  const budgets: BudgetRow[] = [];
  for (const level of LEVELS) {
    const scaled: BudgetRow[] = [];
    for (const r of rows) {
      if (r.level !== level) continue;
      const slice = inPeriod.get(`${Number(r.season_year)}-${Number(r.month)}`);
      if (!slice || slice.daysInPeriod === 0) continue;
      const f = slice.daysInPeriod / slice.daysInMonth;
      scaled.push({
        level,
        adr: Number(r.adr),
        occupancy_pct_target: Number(r.occupancy_pct_target),
        revenue_target: Number(r.revenue_target) * f,
        room_nights_available: Number(r.room_nights_available) * f,
        room_nights_sold_target: Number(r.room_nights_sold_target) * f,
      });
    }
    if (scaled.length === 0) continue;
    const aggregated = aggregateBudgetRows(scaled);
    // Regola V1: occupazione target SEMPRE room_nights_sold_target /
    // room_nights_available del periodo (mese intero, piu' mesi o pro-rata),
    // mai la percentuale occupancy_pct_target salvata ne' una sua
    // ripartizione. occupancy_pct_target resta solo come ripiego se le
    // camere disponibili del periodo sono zero.
    if (aggregated.room_nights_available !== 0) {
      aggregated.occupancy_pct_target = aggregated.room_nights_sold_target / aggregated.room_nights_available;
    }
    budgets.push(aggregated);
  }

  const minimoMonths = new Set(
    rows
      .filter((r) => r.level === "minimo" && inPeriod.has(`${Number(r.season_year)}-${Number(r.month)}`))
      .map((r) => `${Number(r.season_year)}-${Number(r.month)}`)
  );

  return {
    kind: periodKind(start, end),
    budgets,
    monthsInPeriod: slices.length,
    monthsWithBudget: minimoMonths.size,
    prorated: slices.some((s) => s.daysInPeriod < s.daysInMonth),
    daysInPeriod: daysBetweenInclusive(start, end),
  };
}

export const periodBudgetTitles: Record<PeriodKind, string> = {
  month: "Mese selezionato vs budget",
  year: "Anno vs budget",
  range: "Periodo selezionato vs budget",
};

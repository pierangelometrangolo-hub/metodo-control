import {
  adr,
  BudgetRow,
  computePacingStatus,
  deltaPercent,
  monthRange,
  occupancy,
  PacingStatus,
  pad,
  revPar,
  shiftDate,
} from "../performanceMetrics";
import { MonthlyBudgetRow } from "./periodBudget";
import { ClosureRange, isMonthFullyClosed, MonthAsofRow } from "./sdlyAnnual";
import { DailyRow, formatDateIt, resolveSdlyAsOfComparison, SdlyAsOfComparison } from "./sdlyComparison";
import { sdlyCutoffFromRows, sdlyTargetDate } from "./sdlyCutoff";

// ============ Performance mensile (Dettaglio struttura) ============
//
// Le 12 righe gennaio-dicembre di un anno, composte dalle stesse regole gia'
// in uso nel resto di Performance - mai una seconda implementazione:
//
// - Revenue / Occupazione / ADR / RevPAR / RN: sempre l'intero mese nella
//   fotografia corrente (v_snapshot_latest), ricalcolati dalle somme.
// - vs SDLY: semantica unica di sdlyComparison - intero mese nella
//   fotografia corrente contro l'intero stesso mese dell'anno precedente
//   nella fotografia disponibile alla stessa data relativa
//   (fn_month_snapshot_asof, a carico del chiamante: vedi
//   monthlyAsofRequests). Mai un taglio delle stay_date alla data di
//   osservazione, per nessun mese (chiuso, in corso o futuro). La data di
//   osservazione e la data target LY sono UNICHE per tutte le 12 righe e
//   per il Totale: la tabella e' una sola fotografia alla data di
//   osservazione della struttura. L'estrazione realmente usata per ciascun
//   mese (l'ultima non successiva al target) puo' invece differire.
// - vs Consuntivo LY: intero mese contro il valore FINALE del mese di
//   calendario dell'anno precedente (Febbraio 2024 -> Febbraio 2023), con
//   controllo di completezza: un giorno LY senza dato vale 0 solo se
//   coperto da una chiusura dichiarata, altrimenti il confronto e' ND.
//   Distinto dallo SDLY: il consuntivo puo' esistere anche senza alcuna
//   fotografia storica alla stessa data.
// - Budget: livello Realistico del mese (riferimento di questa sola
//   tabella; gli altri widget Budget restano invariati).
//
// Un mese senza righe e' ND, mai 0. Se e' interamente coperto da una
// chiusura dichiarata e' "Chiuso": nessuna produzione inventata.
//
// Ogni confronto espone anche il valore di riferimento realmente usato dal
// calcolo (MonthComparison.reference): e' quello mostrato sotto il delta,
// mai ricalcolato nel componente.
//
// Riga "Totale anno" (buildMonthlyPerformanceTotal): somme annuali e KPI
// ricalcolati dalle somme, mai medie o somme dei valori mensili. Lo SDLY
// annuale e' l'intero anno nella fotografia corrente contro l'intero anno
// precedente nella fotografia alla stessa data: stessa semantica (e stessa
// data di osservazione) della KPI annuale del Dettaglio.

export type MonthlySnapshotRow = DailyRow & { extraction_date: string | null };

export type MonthStatus = "closed" | "current" | "future";

export type MonthComparison = {
  // Lato corrente e riferimento realmente confrontati (revenue).
  current: number | null;
  reference: number | null;
  delta: number | null;
  // Intervalli / fotografie confrontati, gia' formattati per il tooltip.
  actualDetail: string | null;
  referenceDetail: string | null;
  // Perche' il confronto e' ND, quando lo e'.
  unavailableReason: string | null;
  // Giorni / mesi senza dato valorizzati a 0 per chiusura dichiarata.
  zeroNote: string | null;
};

// Confronto SDLY: in piu' le date delle due fotografie.
export type SdlyMonthComparison = MonthComparison & {
  observationDate: string | null;
  targetDate: string | null;
};

export type MonthlyPerformanceRow = {
  month: number;
  monthStart: string;
  monthEnd: string;
  status: MonthStatus;
  hasData: boolean;
  // Nessun dato e mese interamente coperto da chiusura dichiarata.
  closedByDeclaration: boolean;
  revenue: number | null;
  roomsSold: number | null;
  roomsAvailable: number | null;
  occupancy: number | null;
  adr: number | null;
  revPar: number | null;
  // Estrazione corrente realmente usata per il mese: extraction_date piu'
  // recente tra le sue righe (<= data di osservazione dell'analisi).
  observationDate: string | null;
  // Mese chiuso la cui ultima osservazione precede la fine del mese: il
  // valore non e' ancora un consuntivo definitivo ("dato al GG/MM").
  staleAsOf: string | null;
  sdly: SdlyMonthComparison;
  consuntivoLy: MonthComparison;
  budget: { minimo: number | null; realistico: number | null; sfidante: number | null };
  // Scostamento e raggiungimento rispetto al Realistico.
  vsBudget: number | null;
  budgetAchievement: number | null;
  pacing: PacingStatus;
};

export type MonthlyPerformanceInput = {
  year: number;
  today: string;
  // v_snapshot_latest dell'anno e dell'anno precedente (una riga per giorno).
  currentRows: MonthlySnapshotRow[];
  previousRows: DailyRow[];
  budgets: MonthlyBudgetRow[];
  closures: ClosureRange[];
  // Data di osservazione unica dell'analisi: ultima estrazione della
  // struttura (fn_latest_extraction_per_structure). null = nessuna -> ND.
  observationDate: string | null;
  // Fotografie LY: asofKey(mese, cutoff) -> riga fn_month_snapshot_asof
  // dell'anno precedente; null/assente = nessuna estrazione <= cutoff.
  asof: Map<string, MonthAsofRow | null>;
};

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export function asofKey(month: number, cutoff: string): string {
  return `${month}|${cutoff}`;
}

function rangeLabel(start: string, end: string): string {
  return `${formatDateIt(start)} → ${formatDateIt(end)}`;
}

function boundsOf(year: number, month: number) {
  return monthRange(`${year}-${pad(month)}-01`);
}

function rowsInRange<T extends DailyRow>(rows: T[], start: string, end: string): T[] {
  return rows.filter((r) => r.stay_date >= start && r.stay_date <= end);
}

function sumOf(rows: DailyRow[], key: "revenue_total" | "rooms_sold" | "rooms_available"): number {
  return rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);
}

// Chiamate fn_month_snapshot_asof (anno precedente) necessarie alla tabella:
// i 12 mesi, tutti allo stesso cutoff (data di osservazione - 1 anno). Le
// stesse 12 fotografie servono alle righe e al Totale anno.
export function monthlyAsofRequests(observationDate: string | null): { month: number; cutoff: string }[] {
  if (!observationDate) return [];
  const cutoff = sdlyTargetDate(observationDate);
  return MONTHS.map((month) => ({ month, cutoff }));
}

// Intervallo di calendario dell'anno precedente con controllo di
// completezza: un giorno senza dato vale 0 solo se coperto da una chiusura
// dichiarata, altrimenti nessun totale.
function resolveLyRange(previousRows: DailyRow[], closures: ClosureRange[], start: string, end: string) {
  const inRange = rowsInRange(previousRows, start, end);
  const daysWithData = new Set(inRange.map((r) => r.stay_date));
  let daysExpected = 0;
  let closedDays = 0;
  for (let date = start; date <= end; date = shiftDate(date, 1)) {
    daysExpected += 1;
    if (!daysWithData.has(date) && closures.some((c) => c.start_date <= date && date <= c.end_date)) closedDays += 1;
  }
  const daysCovered = daysWithData.size + closedDays;
  const status: "ok" | "partial" | "none" =
    daysCovered >= daysExpected ? "ok" : daysCovered === 0 ? "none" : "partial";
  return {
    status,
    start,
    end,
    revenue: status === "ok" ? sumOf(inRange, "revenue_total") : null,
    daysCovered,
    daysExpected,
    closedDays,
  };
}

function coverageReason(status: "ok" | "partial" | "none", year: number, daysCovered: number, daysExpected: number) {
  if (status === "ok") return null;
  return status === "partial"
    ? `storico ${year} incompleto: ${daysCovered}/${daysExpected} giorni`
    : `storico ${year} non disponibile`;
}

function comparison(
  current: number | null,
  reference: number | null,
  rest: Omit<MonthComparison, "current" | "reference" | "delta">
): MonthComparison {
  const delta = deltaPercent(current, reference);
  return {
    current,
    reference,
    delta,
    ...rest,
    unavailableReason:
      rest.unavailableReason ??
      (delta === null && current !== null && reference === 0 ? "riferimento pari a 0, variazione non calcolabile" : null),
  };
}

const NO_COMPARISON = (reason: string): MonthComparison => ({
  current: null,
  reference: null,
  delta: null,
  actualDetail: null,
  referenceDetail: null,
  unavailableReason: reason,
  zeroNote: null,
});

// Consuntivo LY: intero periodo corrente vs valore finale dello stesso
// periodo di calendario dell'anno precedente, se completo.
function consuntivoComparison(
  revenue: number | null,
  previousRows: DailyRow[],
  closures: ClosureRange[],
  period: { start: string; end: string },
  ly: { start: string; end: string },
  noDataReason: string
): MonthComparison {
  if (revenue === null) return NO_COMPARISON(noDataReason);
  const previousYear = Number(ly.start.slice(0, 4));
  const range = resolveLyRange(previousRows, closures, ly.start, ly.end);
  return comparison(revenue, range.revenue, {
    actualDetail: rangeLabel(period.start, period.end),
    referenceDetail: rangeLabel(range.start, range.end),
    unavailableReason: coverageReason(range.status, previousYear, range.daysCovered, range.daysExpected),
    zeroNote:
      range.status === "ok" && range.closedDays > 0
        ? `Chiusura dichiarata ${previousYear} valorizzata a 0: ${range.closedDays} giorni.`
        : null,
  });
}

// SDLY dal confronto centrale (sdlyComparison) alla forma della tabella.
function sdlyComparison(c: SdlyAsOfComparison, noDataReason: string): SdlyMonthComparison {
  return {
    current: c.current?.revenue ?? null,
    reference: c.reference?.revenue ?? null,
    delta: c.delta,
    actualDetail: c.actualDetail,
    referenceDetail: c.referenceDetail,
    unavailableReason: c.current === null ? noDataReason : c.unavailableReason,
    zeroNote: c.zeroNote,
    observationDate: c.observationDate,
    targetDate: c.targetDate,
  };
}

export function buildMonthlyPerformance(input: MonthlyPerformanceInput): MonthlyPerformanceRow[] {
  const { year, today, currentRows, previousRows, budgets, closures, asof } = input;
  const previousYear = year - 1;
  const cutoff = input.observationDate ? sdlyTargetDate(input.observationDate) : null;

  return MONTHS.map((month) => {
    const { start: monthStart, end: monthEnd } = boundsOf(year, month);
    const status: MonthStatus = monthEnd < today ? "closed" : monthStart > today ? "future" : "current";
    const monthRows = rowsInRange(currentRows, monthStart, monthEnd);
    const hasData = monthRows.length > 0;
    const closedByDeclaration = !hasData && isMonthFullyClosed(closures, year, month);

    const revenue = hasData ? sumOf(monthRows, "revenue_total") : null;
    const roomsSold = hasData ? sumOf(monthRows, "rooms_sold") : null;
    const roomsAvailable = hasData ? sumOf(monthRows, "rooms_available") : null;
    const { observationDate } = sdlyCutoffFromRows(monthRows);

    // ---- Budget (riferimento: Realistico) ----
    const monthBudgets = budgets.filter((b) => Number(b.season_year) === year && Number(b.month) === month);
    const target = (level: BudgetRow["level"]) => {
      const row = monthBudgets.find((b) => b.level === level);
      return row ? Number(row.revenue_target) : null;
    };
    const budget = { minimo: target("minimo"), realistico: target("realistico"), sfidante: target("sfidante") };

    // ---- Confronti con l'anno precedente ----
    const noDataReason = closedByDeclaration ? "mese chiuso per chiusura dichiarata" : "nessun dato importato per questo mese";
    const lyBounds = boundsOf(previousYear, month);

    return {
      month,
      monthStart,
      monthEnd,
      status,
      hasData,
      closedByDeclaration,
      revenue,
      roomsSold,
      roomsAvailable,
      occupancy: occupancy(roomsSold, roomsAvailable),
      adr: adr(revenue, roomsSold),
      revPar: revPar(revenue, roomsAvailable),
      observationDate,
      staleAsOf: status === "closed" && observationDate !== null && observationDate < monthEnd ? observationDate : null,
      sdly: sdlyComparison(
        resolveSdlyAsOfComparison({
          periodStart: monthStart,
          periodEnd: monthEnd,
          currentRows: monthRows,
          observationDate: input.observationDate,
          reference: { kind: "months", rows: [cutoff ? asof.get(asofKey(month, cutoff)) : null] },
          closures,
        }),
        noDataReason
      ),
      consuntivoLy: consuntivoComparison(
        revenue,
        previousRows,
        closures,
        { start: monthStart, end: monthEnd },
        { start: lyBounds.start, end: lyBounds.end },
        noDataReason
      ),
      budget,
      vsBudget: deltaPercent(revenue, budget.realistico),
      budgetAchievement:
        revenue !== null && budget.realistico !== null && budget.realistico !== 0 ? revenue / budget.realistico : null,
      pacing: computePacingStatus(revenue, monthBudgets),
    };
  });
}

// ============ Riga "Totale anno" ============

export type MonthlyPerformanceTotal = {
  status: MonthStatus;
  hasData: boolean;
  monthsWithData: number;
  revenue: number | null;
  roomsSold: number | null;
  roomsAvailable: number | null;
  occupancy: number | null;
  adr: number | null;
  revPar: number | null;
  observationDate: string | null;
  sdly: SdlyMonthComparison;
  consuntivoLy: MonthComparison;
  // Somma dei soli mesi con Budget Realistico (budgetMonths su 12): un
  // budget parziale non e' mai un budget annuale completo.
  budget: { minimo: number | null; realistico: number | null; sfidante: number | null };
  budgetMonths: number;
  budgetComplete: boolean;
  // Revenue dei soli mesi con budget: lato corrente del confronto vs Budget
  // (coincide con il Revenue annuale quando il budget copre tutti i mesi
  // con dato).
  budgetRevenue: number | null;
  vsBudget: number | null;
  budgetAchievement: number | null;
  pacing: PacingStatus;
};

// rows: le 12 righe di buildMonthlyPerformance per lo stesso input.
export function buildMonthlyPerformanceTotal(
  input: MonthlyPerformanceInput,
  rows: MonthlyPerformanceRow[]
): MonthlyPerformanceTotal {
  const { year, today, currentRows, previousRows, closures, asof } = input;
  const previousYear = year - 1;
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const status: MonthStatus = yearEnd < today ? "closed" : yearStart > today ? "future" : "current";

  const yearRows = rowsInRange(currentRows, yearStart, yearEnd);
  const hasData = yearRows.length > 0;
  const revenue = hasData ? sumOf(yearRows, "revenue_total") : null;
  const roomsSold = hasData ? sumOf(yearRows, "rooms_sold") : null;
  const roomsAvailable = hasData ? sumOf(yearRows, "rooms_available") : null;
  const observationDate = input.observationDate;
  const cutoff = observationDate ? sdlyTargetDate(observationDate) : null;
  const noDataReason = "nessun dato importato per questo anno";

  // ---- Budget Realistico: somma dei mesi coperti ----
  const budgeted = rows.filter((r) => r.budget.realistico !== null);
  const sumLevel = (level: BudgetRow["level"]) =>
    budgeted.length > 0 && budgeted.every((r) => r.budget[level] !== null)
      ? budgeted.reduce((s, r) => s + (r.budget[level] as number), 0)
      : null;
  const budget = { minimo: sumLevel("minimo"), realistico: sumLevel("realistico"), sfidante: sumLevel("sfidante") };
  const budgetedWithData = budgeted.filter((r) => r.revenue !== null);
  const budgetRevenue =
    budgetedWithData.length > 0 ? budgetedWithData.reduce((s, r) => s + (r.revenue as number), 0) : null;
  const pacingBudgets = (["minimo", "realistico"] as const).flatMap((level) =>
    budget[level] === null
      ? []
      : [
          {
            level,
            revenue_target: budget[level] as number,
            adr: 0,
            room_nights_sold_target: 0,
            room_nights_available: 0,
            occupancy_pct_target: 0,
          },
        ]
  );

  return {
    status,
    hasData,
    monthsWithData: rows.filter((r) => r.hasData).length,
    revenue,
    roomsSold,
    roomsAvailable,
    occupancy: occupancy(roomsSold, roomsAvailable),
    adr: adr(revenue, roomsSold),
    revPar: revPar(revenue, roomsAvailable),
    observationDate,
    // Intero anno nella fotografia corrente vs intero anno precedente nella
    // fotografia alla stessa data: i 12 mesi allo stesso cutoff annuale.
    sdly: sdlyComparison(
      resolveSdlyAsOfComparison({
        periodStart: yearStart,
        periodEnd: yearEnd,
        currentRows: yearRows,
        observationDate,
        reference: { kind: "months", rows: MONTHS.map((m) => (cutoff ? asof.get(asofKey(m, cutoff)) : null)) },
        closures,
      }),
      noDataReason
    ),
    consuntivoLy: consuntivoComparison(
      revenue,
      previousRows,
      closures,
      { start: yearStart, end: yearEnd },
      { start: `${previousYear}-01-01`, end: `${previousYear}-12-31` },
      noDataReason
    ),
    budget,
    budgetMonths: budgeted.length,
    budgetComplete: budgeted.length === rows.length,
    budgetRevenue,
    vsBudget: deltaPercent(budgetRevenue, budget.realistico),
    budgetAchievement:
      budgetRevenue !== null && budget.realistico !== null && budget.realistico !== 0
        ? budgetRevenue / budget.realistico
        : null,
    pacing: computePacingStatus(budgetRevenue, pacingBudgets),
  };
}

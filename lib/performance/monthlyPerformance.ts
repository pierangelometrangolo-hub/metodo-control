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
  sdlyDate,
  shiftDate,
} from "../performanceMetrics";
import { MonthlyBudgetRow } from "./periodBudget";
import { aggregateMonthlyAsofWithClosures, ClosureRange, isMonthFullyClosed, MonthAsofRow } from "./sdlyAnnual";
import { DailyRow, ProductionSdly, resolveProductionSdly, SdlyMode, sdlyModeForPeriod } from "./sdlyComparison";
import { sdlyCutoffFromRows } from "./sdlyCutoff";

// ============ Performance mensile (Dettaglio struttura) ============
//
// Le 12 righe gennaio-dicembre di un anno, composte dalle stesse regole gia'
// in uso nel resto di Performance - mai una seconda implementazione:
//
// - Revenue / Occupazione / ADR / RevPAR / RN: sempre l'intero mese cosi'
//   come risulta da v_snapshot_latest (consuntivo per un mese chiuso, OTB
//   completo per un mese in corso o futuro), ricalcolati dalle somme.
// - vs SDLY: stessa semantica di sdlyComparison. Mese gia' iniziato ->
//   produzione maturata fino alla data di osservazione del mese; mese
//   interamente futuro -> OTB as-of (fn_month_snapshot_asof, a carico del
//   chiamante, vedi monthlyAsofRequests).
// - vs Consuntivo LY: intero mese contro il mese di CALENDARIO dell'anno
//   precedente (Febbraio 2024 -> Febbraio 2023, mai 01/02 -> 01/03), con
//   controllo di completezza: un giorno LY senza dato vale 0 solo se
//   coperto da una chiusura dichiarata, altrimenti il confronto e' ND.
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
// ricalcolati dalle somme, mai medie o somme dei valori mensili. I
// confronti annuali seguono la semantica delle KPI card in modalita' Anno
// (produzione maturata 01/01 -> data di osservazione per un anno iniziato).

export type MonthlySnapshotRow = DailyRow & { extraction_date: string | null };

export type MonthStatus = "closed" | "current" | "future";

export type MonthComparison = {
  // Lato corrente e riferimento realmente confrontati (revenue).
  current: number | null;
  reference: number | null;
  delta: number | null;
  // Intervalli / date confrontati, gia' formattati per il tooltip.
  actualDetail: string | null;
  referenceDetail: string | null;
  // Perche' il confronto e' ND, quando lo e'.
  unavailableReason: string | null;
  // Giorni / mese senza dato valorizzati a 0 per chiusura dichiarata.
  zeroNote: string | null;
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
  // extraction_date piu' recente tra le righe del mese.
  observationDate: string | null;
  // Mese chiuso la cui ultima osservazione precede la fine del mese: il
  // valore non e' ancora un consuntivo definitivo ("dato al GG/MM").
  staleAsOf: string | null;
  sdly: MonthComparison & { mode: SdlyMode };
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
  // Mese (1-12) -> riga fn_month_snapshot_asof dell'anno precedente al
  // cutoff del mese; null/assente = la RPC non ha restituito righe.
  asofByMonth: Map<number, MonthAsofRow | null>;
};

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function formatDateIt(date: string): string {
  return date.split("-").reverse().join("/");
}

function rangeLabel(start: string, end: string): string {
  return `${formatDateIt(start)} → ${formatDateIt(end)}`;
}

function boundsOf(year: number, month: number) {
  return monthRange(`${year}-${pad(month)}-01`);
}

function rowsInMonth<T extends DailyRow>(rows: T[], start: string, end: string): T[] {
  return rows.filter((r) => r.stay_date >= start && r.stay_date <= end);
}

function sumOf(rows: DailyRow[], key: "revenue_total" | "rooms_sold" | "rooms_available"): number {
  return rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);
}

// Cutoff as-of di un mese: data di osservazione del mese meno un anno,
// stessa regola del Dettaglio quando si seleziona quel mese (senza
// extraction_date si ricade su oggi meno un anno).
function asofCutoff(monthRows: MonthlySnapshotRow[], today: string): { observationDate: string | null; cutoff: string } {
  const { observationDate, cutoff } = sdlyCutoffFromRows(monthRows);
  return { observationDate, cutoff: cutoff ?? sdlyDate(today) };
}

// Mesi interamente futuri con dato corrente: gli unici per cui serve una
// chiamata fn_month_snapshot_asof (anno precedente, cutoff del mese).
export function monthlyAsofRequests(
  year: number,
  today: string,
  currentRows: MonthlySnapshotRow[]
): { month: number; cutoff: string }[] {
  return MONTHS.flatMap((month) => {
    const { start, end } = boundsOf(year, month);
    if (sdlyModeForPeriod(start, today) !== "otb_asof") return [];
    const monthRows = rowsInMonth(currentRows, start, end);
    return monthRows.length > 0 ? [{ month, cutoff: asofCutoff(monthRows, today).cutoff }] : [];
  });
}

// Intervallo di calendario dell'anno precedente con controllo di
// completezza: un giorno senza dato vale 0 solo se coperto da una chiusura
// dichiarata, altrimenti nessun totale.
function resolveLyRange(previousRows: DailyRow[], closures: ClosureRange[], start: string, end: string) {
  const inRange = rowsInMonth(previousRows, start, end);
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

// Mese di calendario dell'anno precedente (Febbraio -> Febbraio).
function resolveCalendarMonthLy(previousRows: DailyRow[], closures: ClosureRange[], year: number, month: number) {
  const { start, end } = boundsOf(year, month);
  return resolveLyRange(previousRows, closures, start, end);
}

function coverageReason(status: "ok" | "partial" | "none", year: number, daysCovered: number, daysExpected: number) {
  if (status === "ok") return null;
  return status === "partial"
    ? `storico ${year} incompleto: ${daysCovered}/${daysExpected} giorni`
    : `storico ${year} non disponibile`;
}

function closedDaysNote(year: number, closedDays: number): string | null {
  return closedDays > 0 ? `Chiusura dichiarata ${year} valorizzata a 0: ${closedDays} giorni.` : null;
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

// Produzione maturata (resolveProductionSdly) -> confronto con riferimento
// e motivo dell'eventuale ND.
function productionComparison(
  production: ProductionSdly,
  observationDate: string | null,
  previousYear: number,
  scope: "mese" | "anno"
): MonthComparison {
  if (production.status === "no_matured") {
    return NO_COMPARISON(
      observationDate
        ? `snapshot corrente del ${formatDateIt(observationDate)} precedente all’inizio ${
            scope === "mese" ? "del mese" : "dell’anno"
          }, nessuna produzione maturata`
        : "data di osservazione non disponibile"
    );
  }
  return comparison(production.current?.revenue ?? null, production.previous?.revenue ?? null, {
    actualDetail: rangeLabel(production.currentStart, production.currentEnd),
    referenceDetail: rangeLabel(production.previousStart, production.previousEnd),
    unavailableReason: coverageReason(production.status, previousYear, production.daysCovered, production.daysExpected),
    zeroNote: production.status === "ok" ? closedDaysNote(previousYear, production.closedDays) : null,
  });
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

export function buildMonthlyPerformance(input: MonthlyPerformanceInput): MonthlyPerformanceRow[] {
  const { year, today, currentRows, previousRows, budgets, closures, asofByMonth } = input;
  const previousYear = year - 1;

  return MONTHS.map((month) => {
    const { start: monthStart, end: monthEnd } = boundsOf(year, month);
    const status: MonthStatus = monthEnd < today ? "closed" : monthStart > today ? "future" : "current";
    const monthRows = rowsInMonth(currentRows, monthStart, monthEnd);
    const hasData = monthRows.length > 0;
    const closedByDeclaration = !hasData && isMonthFullyClosed(closures, year, month);

    const revenue = hasData ? sumOf(monthRows, "revenue_total") : null;
    const roomsSold = hasData ? sumOf(monthRows, "rooms_sold") : null;
    const roomsAvailable = hasData ? sumOf(monthRows, "rooms_available") : null;
    const { observationDate, cutoff } = asofCutoff(monthRows, today);

    // ---- Budget (riferimento: Realistico) ----
    const monthBudgets = budgets.filter((b) => Number(b.season_year) === year && Number(b.month) === month);
    const target = (level: BudgetRow["level"]) => {
      const row = monthBudgets.find((b) => b.level === level);
      return row ? Number(row.revenue_target) : null;
    };
    const budget = { minimo: target("minimo"), realistico: target("realistico"), sfidante: target("sfidante") };

    // ---- Confronti con l'anno precedente ----
    const mode = sdlyModeForPeriod(monthStart, today);
    const calendarLy = resolveCalendarMonthLy(previousRows, closures, previousYear, month);
    const noDataReason = closedByDeclaration ? "mese chiuso per chiusura dichiarata" : "nessun dato importato per questo mese";

    const consuntivoLy: MonthComparison = !hasData
      ? NO_COMPARISON(noDataReason)
      : comparison(revenue, calendarLy.revenue, {
          actualDetail: rangeLabel(monthStart, monthEnd),
          referenceDetail: rangeLabel(calendarLy.start, calendarLy.end),
          unavailableReason: coverageReason(
            calendarLy.status,
            previousYear,
            calendarLy.daysCovered,
            calendarLy.daysExpected
          ),
          zeroNote: calendarLy.status === "ok" ? closedDaysNote(previousYear, calendarLy.closedDays) : null,
        });

    let sdly: MonthComparison;
    if (!hasData) {
      sdly = NO_COMPARISON(noDataReason);
    } else if (mode === "otb_asof") {
      const asofRow = asofByMonth.get(month) ?? null;
      const lyClosed = !asofRow && isMonthFullyClosed(closures, previousYear, month);
      sdly = comparison(revenue, asofRow ? Number(asofRow.revenue_total ?? 0) : lyClosed ? 0 : null, {
        actualDetail: observationDate ? `snapshot del ${formatDateIt(observationDate)}` : null,
        referenceDetail: `al ${formatDateIt(cutoff)}`,
        unavailableReason:
          asofRow || lyClosed
            ? null
            : `nessun OTB ${previousYear} disponibile al cutoff a parità di anticipo (${formatDateIt(cutoff)})`,
        zeroNote: lyClosed ? `Chiusura dichiarata ${previousYear} valorizzata a 0.` : null,
      });
    } else if (observationDate && observationDate >= monthEnd) {
      // Mese interamente maturato: mese pieno contro il mese di calendario
      // dell'anno precedente - per costruzione lo stesso confronto del
      // Consuntivo LY (e nessuno scarto 29/02 -> 01/03 negli anni bisestili).
      sdly = { ...consuntivoLy };
    } else {
      sdly = productionComparison(
        resolveProductionSdly({
          periodStart: monthStart,
          periodEnd: monthEnd,
          observationDate,
          currentRows: monthRows,
          previousRows,
          closures,
        }),
        observationDate,
        previousYear,
        "mese"
      );
    }

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
      sdly: { ...sdly, mode },
      consuntivoLy,
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
  sdly: MonthComparison & { mode: SdlyMode };
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
  const { year, today, currentRows, previousRows, closures, asofByMonth } = input;
  const previousYear = year - 1;
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const status: MonthStatus = yearEnd < today ? "closed" : yearStart > today ? "future" : "current";

  const yearRows = rowsInMonth(currentRows, yearStart, yearEnd);
  const hasData = yearRows.length > 0;
  const revenue = hasData ? sumOf(yearRows, "revenue_total") : null;
  const roomsSold = hasData ? sumOf(yearRows, "rooms_sold") : null;
  const roomsAvailable = hasData ? sumOf(yearRows, "rooms_available") : null;
  const { observationDate, cutoff } = asofCutoff(yearRows, today);
  const noDataReason = "nessun dato importato per questo anno";

  // ---- Consuntivo LY: anno intero vs anno LY finale, se completo ----
  const lyYear = resolveLyRange(previousRows, closures, `${previousYear}-01-01`, `${previousYear}-12-31`);
  const consuntivoLy: MonthComparison = !hasData
    ? NO_COMPARISON(noDataReason)
    : comparison(revenue, lyYear.revenue, {
        actualDetail: rangeLabel(yearStart, yearEnd),
        referenceDetail: rangeLabel(lyYear.start, lyYear.end),
        unavailableReason: coverageReason(lyYear.status, previousYear, lyYear.daysCovered, lyYear.daysExpected),
        zeroNote: lyYear.status === "ok" ? closedDaysNote(previousYear, lyYear.closedDays) : null,
      });

  // ---- SDLY annuale: stessa semantica delle KPI card in modalita' Anno ----
  const mode = sdlyModeForPeriod(yearStart, today);
  let sdly: MonthComparison;
  if (!hasData) {
    sdly = NO_COMPARISON(noDataReason);
  } else if (mode === "otb_asof") {
    const { result, closedMonths } = aggregateMonthlyAsofWithClosures(
      MONTHS.map((m) => asofByMonth.get(m) ?? null),
      MONTHS,
      previousYear,
      closures
    );
    sdly = comparison(revenue, result.agg?.revenue ?? null, {
      actualDetail: observationDate ? `snapshot del ${formatDateIt(observationDate)}` : null,
      referenceDetail: `al ${formatDateIt(cutoff)}`,
      unavailableReason: result.agg
        ? null
        : `OTB ${previousYear} a parità di anticipo disponibile per ${result.monthsCovered}/${result.monthsExpected} mesi`,
      zeroNote:
        result.agg && closedMonths.length > 0
          ? `Chiusura dichiarata ${previousYear} valorizzata a 0: ${closedMonths.length} mesi.`
          : null,
    });
  } else {
    sdly = productionComparison(
      resolveProductionSdly({
        periodStart: yearStart,
        periodEnd: yearEnd,
        observationDate,
        currentRows: yearRows,
        previousRows,
        closures,
      }),
      observationDate,
      previousYear,
      "anno"
    );
  }

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
    sdly: { ...sdly, mode },
    consuntivoLy,
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

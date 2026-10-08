import { deltaPercent, monthRange, pad, shiftDate } from "../performanceMetrics";
import { monthsInPeriod } from "./periodBudget";
import { aggregateMonthlyAsof, ClosureRange, isMonthFullyClosed, MonthAsofRow } from "./sdlyAnnual";
import { sdlyTargetDate } from "./sdlyCutoff";

// ============ SDLY: unica semantica, per qualsiasi periodo ============
//
// SDLY = valore dell'INTERO periodo selezionato nella fotografia corrente
// confrontato con il valore dell'INTERO stesso periodo dell'anno precedente
// nella fotografia disponibile alla stessa data relativa dell'anno
// precedente.
//
// - La data di osservazione riguarda la FOTOGRAFIA, mai il limite delle
//   stay_date: il periodo non viene tagliato, ne' per un periodo in corso
//   ne' per uno gia' concluso o futuro.
// - Data di osservazione UNICA per l'intera analisi di una struttura: la
//   sua ultima estrazione (fn_latest_extraction_per_structure), la stessa
//   per ogni periodo e per ogni mese - non la data delle sole righe del
//   periodo. La fotografia corrente e' v_snapshot_latest: per ogni giorno
//   l'ultima estrazione disponibile a quella data (puo' essere precedente).
// - Fotografia LY: ultima estrazione con extraction_date <= data target
//   (data di osservazione - 1 anno), unica anch'essa. Esatta se esiste,
//   altrimenti la piu' recente precedente - l'estrazione realmente usata
//   puo' quindi differire da mese a mese, il target no; MAI una successiva
//   (nessun look-ahead). I testi mostrano la data target ("fotografia
//   disponibile al"), mai spacciata per data dell'estrazione. Nessuna
//   estrazione <= target -> ND. E' la regola di fn_month_snapshot_asof e
//   fn_snapshot_asof, a carico del chiamante (vedi sdlyAsofPlan).
// - "vs Consuntivo LY" resta un confronto distinto (valore finale LY) e non
//   passa da qui: una struttura puo' avere il consuntivo LY completo ma
//   nessuna fotografia storica alla stessa data -> SDLY ND.
//
// Unico punto condiviso da Dettaglio struttura, Performance mensile e
// Vista d'insieme / TOTALE METODO.

export type DailyRow = {
  stay_date: string;
  revenue_total: number | string | null;
  rooms_sold: number | string | null;
  rooms_available: number | string | null;
  arrivals: number | string | null;
  presences: number | string | null;
};

// Riga di fn_snapshot_asof: una per stay_date, con l'estrazione usata.
export type AsofDailyRow = DailyRow & { extraction_date?: string | null };

export type SdlyAgg = {
  revenue: number;
  roomsSold: number;
  roomsAvailable: number;
  arrivals: number;
  presences: number;
};

// Come leggere la fotografia LY di un periodo:
// - "months": periodo composto solo da mesi interi -> una
//   fn_month_snapshot_asof per mese (unica fonte per lo storico caricato a
//   granularita' mensile). Il periodo LY e' quello di calendario (Febbraio
//   -> Febbraio, anche negli anni bisestili).
// - "days": ogni altro intervallo -> fn_snapshot_asof sull'intervallo LY.
export type SdlyAsofPlan =
  | { kind: "months"; lyStart: string; lyEnd: string; months: { year: number; month: number }[] }
  | { kind: "days"; lyStart: string; lyEnd: string };

export function sdlyAsofPlan(periodStart: string, periodEnd: string): SdlyAsofPlan {
  const wholeMonths =
    periodEnd >= periodStart &&
    periodStart === monthRange(periodStart).start &&
    periodEnd === monthRange(periodEnd).end;
  if (!wholeMonths) {
    return { kind: "days", lyStart: sdlyTargetDate(periodStart), lyEnd: sdlyTargetDate(periodEnd) };
  }
  const months = monthsInPeriod(periodStart, periodEnd).map((m) => ({ year: m.year - 1, month: m.month }));
  const first = months[0];
  const last = months[months.length - 1];
  return {
    kind: "months",
    lyStart: `${first.year}-${pad(first.month)}-01`,
    lyEnd: monthRange(`${last.year}-${pad(last.month)}-01`).end,
    months,
  };
}

// Fotografia LY letta dal chiamante secondo sdlyAsofPlan.
export type SdlyReferenceSnapshot =
  // months[i] del piano -> riga della RPC, null/undefined se non ha
  // restituito righe (nessuna estrazione <= target per quel mese).
  | { kind: "months"; rows: (MonthAsofRow | null | undefined)[] }
  | { kind: "days"; rows: AsofDailyRow[] };

export type SdlyAsOfComparison = {
  // "ok": confronto disponibile.
  // "no_current": nessuna riga corrente nel periodo (o nessuna data di osservazione).
  // "no_snapshot": nessuna fotografia LY <= data target.
  // "partial_snapshot": la fotografia LY non copre tutto il periodo.
  status: "ok" | "no_current" | "no_snapshot" | "partial_snapshot";
  periodStart: string;
  periodEnd: string;
  lyStart: string;
  lyEnd: string;
  // Data della fotografia corrente e data target della fotografia LY.
  observationDate: string | null;
  targetDate: string | null;
  // Estrazioni LY realmente usate (prima e ultima), quando la fonte le
  // espone: solo fn_snapshot_asof, la RPC mensile restituisce il totale.
  referenceExtraction: { from: string; to: string } | null;
  // Intero periodo nella fotografia corrente / intero periodo LY as-of.
  current: SdlyAgg | null;
  reference: SdlyAgg | null;
  // Variazione del revenue.
  delta: number | null;
  covered: number;
  expected: number;
  // Mesi (1-12) / giorni LY senza fotografia valorizzati a 0 per chiusura dichiarata.
  closedMonths: number[];
  closedDays: number;
  // Testi pronti per i tooltip.
  actualDetail: string | null;
  referenceDetail: string | null;
  unavailableReason: string | null;
  zeroNote: string | null;
};

export function formatDateIt(date: string): string {
  return date.split("-").reverse().join("/");
}

function sumRows(rows: DailyRow[]): SdlyAgg {
  const sum = (key: keyof Omit<DailyRow, "stay_date">) => rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);
  return {
    revenue: sum("revenue_total"),
    roomsSold: sum("rooms_sold"),
    roomsAvailable: sum("rooms_available"),
    arrivals: sum("arrivals"),
    presences: sum("presences"),
  };
}

const ZERO_MONTH: MonthAsofRow = { revenue_total: 0, rooms_sold: 0, rooms_available: 0, arrivals: 0, presences: 0 };

// currentRows: righe giornaliere di UNA struttura nella fotografia corrente
// (v_snapshot_latest), almeno quelle del periodo. observationDate: data di
// osservazione unica della struttura (la sua ultima estrazione).
// reference: fotografia LY alla data target, letta secondo sdlyAsofPlan.
// closures: chiusure dichiarate (structure_closures).
//
// Completezza della fotografia LY: un mese / giorno senza fotografia vale 0
// solo se coperto per intero da una chiusura dichiarata; un dato reale
// prevale sempre; altrimenti il confronto e' ND, mai una somma parziale.
export function resolveSdlyAsOfComparison(input: {
  periodStart: string;
  periodEnd: string;
  currentRows: DailyRow[];
  observationDate: string | null;
  reference: SdlyReferenceSnapshot | null;
  closures: ClosureRange[];
}): SdlyAsOfComparison {
  const { periodStart, periodEnd, observationDate, reference, closures } = input;
  const plan = sdlyAsofPlan(periodStart, periodEnd);
  const currentInPeriod = input.currentRows.filter((r) => r.stay_date >= periodStart && r.stay_date <= periodEnd);
  const current = currentInPeriod.length > 0 ? sumRows(currentInPeriod) : null;
  const targetDate = observationDate ? sdlyTargetDate(observationDate) : null;
  const lyYearLabel = plan.lyStart.slice(0, 4) === plan.lyEnd.slice(0, 4) ? plan.lyStart.slice(0, 4) : "anno precedente";

  const base = {
    periodStart,
    periodEnd,
    lyStart: plan.lyStart,
    lyEnd: plan.lyEnd,
    observationDate,
    targetDate,
    current,
    actualDetail: observationDate ? `fotografia disponibile al ${formatDateIt(observationDate)}` : null,
    referenceDetail: targetDate ? `fotografia disponibile al ${formatDateIt(targetDate)}` : null,
  };
  const unavailable = (
    status: Exclude<SdlyAsOfComparison["status"], "ok">,
    reason: string,
    coverage: { covered: number; expected: number } = { covered: 0, expected: 0 }
  ): SdlyAsOfComparison => ({
    ...base,
    status,
    referenceExtraction: null,
    reference: null,
    delta: null,
    ...coverage,
    closedMonths: [],
    closedDays: 0,
    unavailableReason: reason,
    zeroNote: null,
  });

  if (current === null || !observationDate || !targetDate) {
    return unavailable(
      "no_current",
      current === null ? "nessun dato nel periodo selezionato" : "data di osservazione non disponibile"
    );
  }

  const noSnapshotReason = `nessuna fotografia ${lyYearLabel} disponibile al ${formatDateIt(targetDate)}`;
  let referenceAgg: SdlyAgg;
  let covered: number;
  let expected: number;
  let closedMonths: number[] = [];
  let closedDays = 0;
  let referenceExtraction: SdlyAsOfComparison["referenceExtraction"] = null;

  if (plan.kind === "months") {
    const rows = reference?.kind === "months" ? reference.rows : [];
    const filled = plan.months.map((m, i) => {
      const row = rows[i];
      if (row) return row;
      if (!isMonthFullyClosed(closures, m.year, m.month)) return null;
      closedMonths.push(m.month);
      return ZERO_MONTH;
    });
    const result = aggregateMonthlyAsof(filled);
    covered = result.monthsCovered;
    expected = result.monthsExpected;
    if (!result.agg) {
      closedMonths = [];
      return unavailable(
        covered === 0 ? "no_snapshot" : "partial_snapshot",
        covered === 0
          ? noSnapshotReason
          : `fotografia ${lyYearLabel} al ${formatDateIt(targetDate)} incompleta: ${covered}/${expected} mesi`,
        { covered, expected }
      );
    }
    referenceAgg = result.agg;
  } else {
    // Difesa in profondita': una riga estratta dopo la data target non e'
    // mai una fotografia valida (nessun look-ahead), anche se arrivasse.
    const rows = (reference?.kind === "days" ? reference.rows : []).filter(
      (r) =>
        r.stay_date >= plan.lyStart &&
        r.stay_date <= plan.lyEnd &&
        (!r.extraction_date || r.extraction_date <= targetDate)
    );
    const daysWithData = new Set(rows.map((r) => r.stay_date));
    expected = 0;
    for (let day = plan.lyStart; day <= plan.lyEnd; day = shiftDate(day, 1)) {
      expected += 1;
      if (!daysWithData.has(day) && closures.some((c) => c.start_date <= day && day <= c.end_date)) closedDays += 1;
    }
    covered = daysWithData.size + closedDays;
    if (covered < expected) {
      return unavailable(
        covered === 0 ? "no_snapshot" : "partial_snapshot",
        covered === 0
          ? noSnapshotReason
          : `fotografia ${lyYearLabel} al ${formatDateIt(targetDate)} incompleta: ${covered}/${expected} giorni`,
        { covered, expected }
      );
    }
    referenceAgg = sumRows(rows);
    const extractions = rows.map((r) => r.extraction_date).filter((d): d is string => Boolean(d)).sort();
    if (extractions.length > 0) {
      referenceExtraction = { from: extractions[0], to: extractions[extractions.length - 1] };
    }
  }

  const delta = deltaPercent(current.revenue, referenceAgg.revenue);
  return {
    ...base,
    status: "ok",
    referenceExtraction,
    reference: referenceAgg,
    delta,
    covered,
    expected,
    closedMonths,
    closedDays,
    unavailableReason: delta === null ? "riferimento pari a 0, variazione non calcolabile" : null,
    zeroNote:
      closedMonths.length > 0
        ? `Chiusura dichiarata ${lyYearLabel} valorizzata a 0: ${closedMonths.length} ${closedMonths.length === 1 ? "mese" : "mesi"}.`
        : closedDays > 0
          ? `Chiusura dichiarata ${lyYearLabel} valorizzata a 0: ${closedDays} giorni.`
          : null,
  };
}

// Frase unica per intestazioni e tooltip: cosa viene confrontato e in quali
// fotografie. "disponibile al": la fotografia LY e' l'ultima estrazione non
// successiva alla data target, non necessariamente di quel giorno esatto.
export function sdlyPhotoSentence(
  c: { observationDate: string | null; targetDate: string | null },
  scope: "period" | "month" | "year" = "period"
): string {
  const current = c.observationDate ? formatDateIt(c.observationDate) : "ND";
  const ly = c.targetDate ? formatDateIt(c.targetDate) : "ND";
  if (scope === "year") {
    return `Intero anno nella fotografia disponibile al ${current} vs intero anno precedente nella fotografia disponibile al ${ly}.`;
  }
  const noun = scope === "month" ? "mese" : "periodo";
  return `Intero ${noun} nella fotografia disponibile al ${current} vs stesso ${noun} dell’anno precedente nella fotografia disponibile al ${ly}.`;
}

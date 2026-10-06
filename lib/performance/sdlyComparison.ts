import { sdlyDate } from "../performanceMetrics";
import { ClosureRange } from "./sdlyAnnual";

// ============ Semantica SDLY per tipo di periodo ============
//
// Unica regola condivisa da Vista d'insieme e Dettaglio struttura.
//
// - Periodo gia' iniziato (passato, corrente, o che attraversa oggi):
//   PRODUZIONE MATURATA. Si confronta il revenue dei giorni di soggiorno
//   dal primo giorno del periodo fino alla data di osservazione (o a fine
//   periodo, se precedente) con il revenue degli stessi giorni dell'anno
//   precedente. La parte futura del periodo NON entra nel confronto.
// - Periodo interamente futuro: OTB as-of. L'OTB dell'intero periodo
//   osservato alla data dello snapshot corrente contro l'OTB dello stesso
//   periodo dell'anno precedente osservato alla stessa data relativa
//   (fn_month_snapshot_asof / fn_snapshot_asof, a carico del chiamante).
//
// Il tipo di confronto dipende solo dal periodo e da oggi, quindi e' lo
// stesso per tutte le strutture; fin dove arriva la produzione maturata
// dipende invece dalla data di osservazione della singola struttura.

export type SdlyMode = "production" | "otb_asof";

// "YYYY-MM-DD" confronta correttamente anche come stringa.
export function sdlyModeForPeriod(periodStart: string, today: string): SdlyMode {
  return periodStart > today ? "otb_asof" : "production";
}

export type DailyRow = {
  stay_date: string;
  revenue_total: number | string | null;
  rooms_sold: number | string | null;
  rooms_available: number | string | null;
  arrivals: number | string | null;
  presences: number | string | null;
};

export type ProductionAgg = {
  revenue: number;
  roomsSold: number;
  roomsAvailable: number;
  arrivals: number;
  presences: number;
};

export type ProductionSdly =
  // Lo snapshot corrente e' precedente all'inizio del periodo (o manca):
  // nessun giorno maturato da confrontare.
  | { status: "no_matured" }
  | {
      // "ok": confronto disponibile. "partial"/"none": nell'intervallo
      // dell'anno precedente mancano giorni non giustificati da una
      // chiusura dichiarata (alcuni / tutti) -> nessun riferimento.
      status: "ok" | "partial" | "none";
      currentStart: string;
      currentEnd: string;
      previousStart: string;
      previousEnd: string;
      // null = nessuna riga corrente nell'intervallo maturato.
      current: ProductionAgg | null;
      previous: ProductionAgg | null;
      daysCovered: number;
      daysExpected: number;
      // Giorni senza dato valorizzati a 0 per chiusura dichiarata.
      closedDays: number;
    };

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function sumRows(rows: DailyRow[]): ProductionAgg {
  const sum = (key: keyof Omit<DailyRow, "stay_date">) => rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);
  return {
    revenue: sum("revenue_total"),
    roomsSold: sum("rooms_sold"),
    roomsAvailable: sum("rooms_available"),
    arrivals: sum("arrivals"),
    presences: sum("presences"),
  };
}

// currentRows / previousRows: righe giornaliere di UNA struttura (una per
// stay_date, gia' risolte da v_snapshot_latest) che coprono almeno il
// periodo selezionato e lo stesso periodo dell'anno precedente. closures:
// chiusure dichiarate della struttura (structure_closures).
//
// Stagionalita': un giorno dell'anno precedente senza dato vale 0 solo se
// coperto da una chiusura dichiarata; un dato reale prevale sempre; un
// giorno senza dato e senza chiusura rende il confronto ND. La regola si
// applica alla sola porzione confrontata, non all'intero periodo.
export function resolveProductionSdly(input: {
  periodStart: string;
  periodEnd: string;
  observationDate: string | null;
  currentRows: DailyRow[];
  previousRows: DailyRow[];
  closures: ClosureRange[];
}): ProductionSdly {
  const { periodStart, periodEnd, observationDate, currentRows, previousRows, closures } = input;
  if (!observationDate || observationDate < periodStart) return { status: "no_matured" };

  const currentStart = periodStart;
  const currentEnd = observationDate < periodEnd ? observationDate : periodEnd;
  const previousStart = sdlyDate(currentStart);
  const previousEnd = sdlyDate(currentEnd);

  const inRange = (rows: DailyRow[], start: string, end: string) =>
    rows.filter((r) => r.stay_date >= start && r.stay_date <= end);
  const currentInRange = inRange(currentRows, currentStart, currentEnd);
  const previousInRange = inRange(previousRows, previousStart, previousEnd);

  const daysWithData = new Set(previousInRange.map((r) => r.stay_date));
  let daysExpected = 0;
  let closedDays = 0;
  for (let day = previousStart; day <= previousEnd; day = addDays(day, 1)) {
    daysExpected += 1;
    if (!daysWithData.has(day) && closures.some((c) => c.start_date <= day && day <= c.end_date)) closedDays += 1;
  }
  const daysCovered = daysWithData.size + closedDays;
  const status = daysCovered >= daysExpected ? "ok" : daysCovered === 0 ? "none" : "partial";

  return {
    status,
    currentStart,
    currentEnd,
    previousStart,
    previousEnd,
    current: currentInRange.length > 0 ? sumRows(currentInRange) : null,
    previous: status === "ok" ? sumRows(previousInRange) : null,
    daysCovered,
    daysExpected,
    closedDays,
  };
}

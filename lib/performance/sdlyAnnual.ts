// ============ SDLY annuale da snapshot mensili ============
//
// Per un anno pieno lo SDLY si costruisce con fn_month_snapshot_asof sui
// 12 mesi dell'anno precedente, tutti allo stesso cutoff a parita' di
// anticipo - la stessa fonte gia' usata per un mese pieno, ripetuta mese
// per mese. La RPC non restituisce nessuna riga per un mese senza dato
// (mai uno zero inventato): qui un mese assente resta assente.
//
// Aggregazione: solo somme dei valori assoluti. Occupazione e LOS si
// ricalcolano a valle dai totali (roomsSold/roomsAvailable,
// roomsSold/arrivals), mai come media di percentuali mensili.

export type MonthAsofRow = {
  revenue_total: number | string | null;
  rooms_sold: number | string | null;
  rooms_available: number | string | null;
  arrivals: number | string | null;
  presences: number | string | null;
};

export type AnnualAsofAgg = {
  revenue: number;
  roomsSold: number;
  roomsAvailable: number;
  arrivals: number;
  presences: number;
};

export type AnnualAsofResult =
  | { coverage: "full"; agg: AnnualAsofAgg; monthsCovered: number; monthsExpected: number }
  // Copertura parziale o nulla: nessun totale annuale mostrato come completo.
  | { coverage: "partial" | "none"; agg: null; monthsCovered: number; monthsExpected: number };

// monthResults: un elemento per mese (in qualunque ordine), null/undefined
// se la RPC non ha restituito righe per quel mese.
export function aggregateMonthlyAsof(monthResults: (MonthAsofRow | null | undefined)[]): AnnualAsofResult {
  const monthsExpected = monthResults.length;
  const present = monthResults.filter((r): r is MonthAsofRow => r !== null && r !== undefined);
  const monthsCovered = present.length;

  if (monthsCovered === 0) return { coverage: "none", agg: null, monthsCovered, monthsExpected };
  if (monthsCovered < monthsExpected) return { coverage: "partial", agg: null, monthsCovered, monthsExpected };

  const sum = (key: keyof MonthAsofRow) => present.reduce((s, r) => s + Number(r[key] ?? 0), 0);
  return {
    coverage: "full",
    agg: {
      revenue: sum("revenue_total"),
      roomsSold: sum("rooms_sold"),
      roomsAvailable: sum("rooms_available"),
      arrivals: sum("arrivals"),
      presences: sum("presences"),
    },
    monthsCovered,
    monthsExpected,
  };
}

// ============ Mesi di chiusura stagionale ============
//
// Una struttura stagionale non opera 12 mesi: i mesi di chiusura non hanno
// (e non avranno mai) snapshot. Valgono 0 ai fini del confronto annuale,
// ma SOLO se la chiusura e' dichiarata in structure_closures (registro
// manuale delle chiusure, lo stesso usato dal Budget) e copre l'intero
// mese - mai dedotta dalla sola assenza di snapshot. Un mese senza dato e
// senza chiusura dichiarata resta mancante (copertura parziale -> ND).

export type ClosureRange = { start_date: string; end_date: string };

const CLOSED_MONTH: MonthAsofRow = { revenue_total: 0, rooms_sold: 0, rooms_available: 0, arrivals: 0, presences: 0 };

// Tutti i giorni del mese coperti dall'unione delle chiusure dichiarate
// (anche da piu' intervalli contigui o sovrapposti).
export function isMonthFullyClosed(closures: ClosureRange[], year: number, month: number): boolean {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= lastDay; day++) {
    const date = `${year}-${pad2(month)}-${pad2(day)}`;
    if (!closures.some((c) => c.start_date <= date && date <= c.end_date)) return false;
  }
  return true;
}

// months[i] e' il mese (1-12) di monthResults[i]. Un mese con dato reale
// resta quello reale anche se dichiarato chiuso; solo un mese senza dato e
// interamente chiuso diventa 0. closedMonths = mesi valorizzati a 0.
export function applySeasonalClosures(
  monthResults: (MonthAsofRow | null | undefined)[],
  months: number[],
  year: number,
  closures: ClosureRange[]
): { monthResults: (MonthAsofRow | null)[]; closedMonths: number[] } {
  const closedMonths: number[] = [];
  const filled = monthResults.map((row, i) => {
    if (row) return row;
    if (!isMonthFullyClosed(closures, year, months[i])) return null;
    closedMonths.push(months[i]);
    return CLOSED_MONTH;
  });
  return { monthResults: filled, closedMonths };
}

// SDLY annuale completo di regola stagionale, unico punto condiviso da
// Vista d'insieme e Dettaglio struttura: totale solo se ogni mese e'
// coperto da dato reale o da chiusura dichiarata, altrimenti ND.
export function aggregateMonthlyAsofWithClosures(
  monthResults: (MonthAsofRow | null | undefined)[],
  months: number[],
  year: number,
  closures: ClosureRange[]
): { result: AnnualAsofResult; closedMonths: number[] } {
  const filled = applySeasonalClosures(monthResults, months, year, closures);
  return { result: aggregateMonthlyAsof(filled.monthResults), closedMonths: filled.closedMonths };
}

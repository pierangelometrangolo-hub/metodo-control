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

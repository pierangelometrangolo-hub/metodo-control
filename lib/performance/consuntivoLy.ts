import { shiftDate } from "../performanceMetrics";
import { ClosureRange } from "./sdlyAnnual";
import { DailyRow, formatDateIt, SdlyAgg } from "./sdlyComparison";

// ============ Consuntivo LY: valore FINALE dello stesso periodo LY ============
//
// "vs Consuntivo LY" confronta il periodo corrente con il risultato finale
// dello stesso periodo dell'anno precedente. Esiste SOLO se quel periodo e'
// realmente chiuso nei dati:
// - ogni giorno del periodo ha una riga, oppure e' coperto da una chiusura
//   dichiarata (structure_closures, vale 0);
// - ogni riga e' stata estratta DOPO la fine operativa del periodo: una
//   fotografia presa prima che il periodo finisse e' ancora OTB, non un
//   consuntivo (es. il 2026 osservato il 15/10/2026, confrontato con il
//   2027). Fine operativa = ultimo giorno del periodo non coperto da una
//   chiusura dichiarata (o con un dato reale): una struttura stagionale
//   chiusa a dicembre ha il 2025 consuntivato appena finisce novembre.
// Altrimenti ND, mai una somma parziale e mai l'OTB LY spacciato per
// consuntivo: la colonna non cambia significato a seconda dell'anno.
//
// Unico punto condiviso da Vista d'insieme / TOTALE METODO / L4L,
// Dettaglio struttura e Performance mensile. Distinto dallo SDLY
// (sdlyComparison.ts): fotografia alla stessa data vs valore finale.

// Righe di v_snapshot_latest dell'anno precedente: una per stay_date, con
// l'estrazione da cui provengono.
export type ConsuntivoLyRow = DailyRow & { extraction_date?: string | null };

export type ConsuntivoLy = {
  // "ok": periodo LY completo e chiuso. "not_final": completo ma fotografato
  // prima della fine del periodo. "partial" / "none": giorni mancanti non
  // coperti da chiusura (alcuni / tutti).
  status: "ok" | "not_final" | "partial" | "none";
  start: string;
  end: string;
  // null se status !== "ok": nessun consuntivo da confrontare.
  agg: SdlyAgg | null;
  daysCovered: number;
  daysExpected: number;
  closedDays: number;
  // Fotografia piu' recente fra le righe del periodo (per il tooltip).
  latestExtraction: string | null;
  // Ultimo giorno operativo del periodo (non coperto da chiusura
  // dichiarata, o con dato reale): le estrazioni devono essere successive.
  operationalEnd: string | null;
  unavailableReason: string | null;
  zeroNote: string | null;
};

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

// lyStart/lyEnd: periodo LY di calendario (Febbraio -> Febbraio, anche negli
// anni bisestili). rows: righe di v_snapshot_latest, anche oltre il periodo
// (vengono filtrate qui).
export function resolveConsuntivoLy(input: {
  lyStart: string;
  lyEnd: string;
  rows: ConsuntivoLyRow[];
  closures: ClosureRange[];
}): ConsuntivoLy {
  const { lyStart, lyEnd, closures } = input;
  const rows = input.rows.filter((r) => r.stay_date >= lyStart && r.stay_date <= lyEnd);
  const year = lyStart.slice(0, 4) === lyEnd.slice(0, 4) ? lyStart.slice(0, 4) : "anno precedente";

  const daysWithData = new Set(rows.map((r) => r.stay_date));
  let daysExpected = 0;
  let closedDays = 0;
  let operationalEnd: string | null = null;
  for (let day = lyStart; day <= lyEnd; day = shiftDate(day, 1)) {
    daysExpected += 1;
    const closed = !daysWithData.has(day) && closures.some((c) => c.start_date <= day && day <= c.end_date);
    if (closed) closedDays += 1;
    else operationalEnd = day;
  }
  const daysCovered = daysWithData.size + closedDays;
  const extractions = rows.map((r) => r.extraction_date ?? null);
  const latestExtraction = extractions.reduce<string | null>((max, d) => (d && (!max || d > max) ? d : max), null);

  const base = { start: lyStart, end: lyEnd, daysCovered, daysExpected, closedDays, latestExtraction, operationalEnd };

  if (daysCovered < daysExpected) {
    return {
      ...base,
      status: daysCovered === 0 ? "none" : "partial",
      agg: null,
      unavailableReason:
        daysCovered === 0
          ? `storico ${year} non disponibile`
          : `storico ${year} incompleto: ${daysCovered}/${daysExpected} giorni`,
      zeroNote: null,
    };
  }

  // Chiuso solo se OGNI riga e' stata estratta dopo la fine operativa del
  // periodo; una riga senza extraction_date non dimostra la chiusura. Un
  // periodo interamente chiuso per chiusura dichiarata e' gia' finale (0).
  const final = operationalEnd === null || extractions.every((d) => d !== null && d > operationalEnd);
  if (!final) {
    return {
      ...base,
      status: "not_final",
      agg: null,
      unavailableReason: `periodo ${year} non ancora consuntivato: ultima fotografia del ${
        latestExtraction ? formatDateIt(latestExtraction) : "ND"
      }, non successiva alla fine del periodo (${formatDateIt(operationalEnd ?? lyEnd)})`,
      zeroNote: null,
    };
  }

  return {
    ...base,
    status: "ok",
    agg: sumRows(rows),
    unavailableReason: null,
    zeroNote: closedDays > 0 ? `Chiusura dichiarata ${year} valorizzata a 0: ${closedDays} giorni.` : null,
  };
}

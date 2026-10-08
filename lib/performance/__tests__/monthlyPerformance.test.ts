import { describe, expect, it } from "vitest";
import {
  asofKey,
  buildMonthlyPerformance,
  buildMonthlyPerformanceTotal,
  monthlyAsofRequests,
  MonthlyPerformanceInput,
  MonthlySnapshotRow,
} from "../monthlyPerformance";
import { MonthlyBudgetRow } from "../periodBudget";
import { MonthAsofRow } from "../sdlyAnnual";

const TODAY = "2026-10-06";

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Una riga per giorno di soggiorno, valori costanti: i totali attesi si
// leggono come "numero di giorni x valore giornaliero".
function daily(
  start: string,
  end: string,
  revenue: number,
  extractionDate: string,
  roomsSold = 2,
  roomsAvailable = 10
): MonthlySnapshotRow[] {
  const rows: MonthlySnapshotRow[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    rows.push({
      stay_date: day,
      extraction_date: extractionDate,
      revenue_total: revenue,
      rooms_sold: roomsSold,
      rooms_available: roomsAvailable,
      arrivals: 1,
      presences: 4,
    });
  }
  return rows;
}

function budgetRows(year: number, month: number, minimo: number, realistico: number, sfidante: number): MonthlyBudgetRow[] {
  return (
    [
      ["minimo", minimo],
      ["realistico", realistico],
      ["sfidante", sfidante],
    ] as const
  ).map(([level, revenue_target]) => ({
    season_year: year,
    month,
    level,
    adr: 100,
    revenue_target,
    room_nights_sold_target: 100,
    room_nights_available: 310,
    occupancy_pct_target: 0.32,
  }));
}

const asof = (revenue: number): MonthAsofRow => ({
  revenue_total: revenue,
  rooms_sold: 10,
  rooms_available: 300,
  arrivals: 5,
  presences: 20,
});

// Fotografie LY: mese -> revenue, tutte al cutoff indicato (default: la
// fotografia corrente del 06/10/2026 meno un anno).
const CUTOFF = "2025-10-06";
function asofMap(byMonth: Record<number, number | null>, cutoff = CUTOFF): Map<string, MonthAsofRow | null> {
  return new Map(
    Object.entries(byMonth).map(([m, revenue]) => [asofKey(Number(m), cutoff), revenue === null ? null : asof(revenue)])
  );
}
// Fotografia LY same-day di tutti i 12 mesi: 70 al giorno (il consuntivo
// finale LY e' 80 al giorno), cosi' SDLY e Consuntivo LY restano distinti.
const DAYS_2025 = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const fullAsof = asofMap(Object.fromEntries(DAYS_2025.map((d, i) => [i + 1, d * 70])));

const year2026 = daily("2026-01-01", "2026-12-31", 100, TODAY);
const year2025 = daily("2025-01-01", "2025-12-31", 80, "2026-01-01");

function build(overrides: Partial<MonthlyPerformanceInput> = {}) {
  return buildMonthlyPerformance({
    year: 2026,
    today: TODAY,
    currentRows: year2026,
    previousRows: year2025,
    budgets: [],
    closures: [],
    observationDate: TODAY,
    asof: fullAsof,
    ...overrides,
  });
}

const monthOf = (rows: ReturnType<typeof build>, month: number) => rows[month - 1];

describe("buildMonthlyPerformance — struttura", () => {
  it("restituisce sempre 12 righe gennaio-dicembre con lo stato corretto", () => {
    const rows = build();
    expect(rows.map((r) => r.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(monthOf(rows, 9).status).toBe("closed");
    expect(monthOf(rows, 10).status).toBe("current");
    expect(monthOf(rows, 11).status).toBe("future");
  });
});

describe("mese chiuso", () => {
  it("vs SDLY: mese pieno vs fotografia same-day LY; vs Consuntivo LY: mese pieno vs finale LY", () => {
    const sep = monthOf(build(), 9);
    expect(sep.revenue).toBe(3000);
    expect(sep.sdly.current).toBe(3000);
    expect(sep.sdly.reference).toBe(30 * 70);
    expect(sep.sdly.delta).toBeCloseTo(3000 / 2100 - 1);
    expect(sep.sdly.observationDate).toBe("2026-10-06");
    expect(sep.sdly.targetDate).toBe("2025-10-06");
    expect(sep.consuntivoLy.reference).toBe(2400);
    expect(sep.consuntivoLy.delta).toBeCloseTo(0.25);
    expect(sep.staleAsOf).toBeNull();
  });

  it("mese aggiornato l'ultima volta prima della fine del mese: 'dato al', ma target unico dell'analisi", () => {
    const rows = build({
      currentRows: [...daily("2026-09-01", "2026-09-30", 100, "2026-09-20"), ...daily("2026-10-01", "2026-12-31", 100, TODAY)],
    });
    const sep = monthOf(rows, 9);
    // Estrazione corrente realmente usata per il mese: 20/09.
    expect(sep.observationDate).toBe("2026-09-20");
    expect(sep.staleAsOf).toBe("2026-09-20");
    // Intero mese su entrambi i lati; target = data di osservazione dell'analisi, non del mese.
    expect(sep.revenue).toBe(3000);
    expect(sep.sdly.current).toBe(3000);
    expect(sep.sdly.observationDate).toBe("2026-10-06");
    expect(sep.sdly.targetDate).toBe("2025-10-06");
    expect(sep.sdly.reference).toBe(30 * 70);
    expect(sep.consuntivoLy.reference).toBe(2400);
  });
});

describe("mese in corso", () => {
  const oct = monthOf(build(), 10);

  it("Revenue e KPI sull'intero OTB del mese", () => {
    expect(oct.revenue).toBe(3100);
    expect(oct.roomsSold).toBe(62);
    expect(oct.roomsAvailable).toBe(310);
  });

  it("vs SDLY: intero mese OTB vs intero mese LY nella fotografia same-day, mai i soli giorni maturati", () => {
    expect(oct.sdly.current).toBe(3100);
    expect(oct.sdly.current).not.toBe(600);
    expect(oct.sdly.reference).toBe(31 * 70);
    expect(oct.sdly.actualDetail).toBe("fotografia disponibile al 06/10/2026");
    expect(oct.sdly.referenceDetail).toBe("fotografia disponibile al 06/10/2025");
  });

  it("OTB vs Consuntivo LY sull'intero mese", () => {
    expect(oct.consuntivoLy.current).toBe(3100);
    expect(oct.consuntivoLy.reference).toBe(2480);
  });
});

describe("mese futuro", () => {
  it("con fotografia LY: OTB del mese vs OTB LY alla stessa data", () => {
    const nov = monthOf(build({ asof: asofMap({ 11: 1500 }) }), 11);
    expect(nov.sdly.current).toBe(3000);
    expect(nov.sdly.reference).toBe(1500);
    expect(nov.sdly.delta).toBeCloseTo(1);
    expect(nov.sdly.referenceDetail).toBe("fotografia disponibile al 06/10/2025");
    // Consuntivo LY resta il mese LY finale, non la fotografia.
    expect(nov.consuntivoLy.reference).toBe(2400);
  });

  it("senza fotografia LY: ND con motivo, mai ricostruzione dal consuntivo", () => {
    const nov = monthOf(build({ asof: new Map() }), 11);
    expect(nov.sdly.reference).toBeNull();
    expect(nov.sdly.delta).toBeNull();
    expect(nov.sdly.unavailableReason).toBe("nessuna fotografia 2025 disponibile al 06/10/2025");
  });

  it("Sangiorgio: storico LY solo a consuntivo -> SDLY ND per OGNI mese, Consuntivo LY disponibile", () => {
    const rows = build({ asof: asofMap(Object.fromEntries(DAYS_2025.map((_, i) => [i + 1, null]))) });
    rows.forEach((r) => {
      expect(r.sdly.delta).toBeNull();
      expect(r.sdly.reference).toBeNull();
      expect(r.consuntivoLy.delta).not.toBeNull();
    });
  });

  it("fotografia LY assente ma mese LY interamente chiuso: riferimento 0 dichiarato", () => {
    const dec = monthOf(build({ asof: new Map(), closures: [{ start_date: "2025-12-01", end_date: "2025-12-31" }] }), 12);
    expect(dec.sdly.reference).toBe(0);
    expect(dec.sdly.zeroNote).toBe("Chiusura dichiarata 2025 valorizzata a 0: 1 mese.");
    expect(dec.sdly.delta).toBeNull();
  });
});

describe("data di osservazione e target LY unici per l'intera tabella", () => {
  it("tutte le 12 righe e il Totale usano la stessa coppia di date", () => {
    const input: MonthlyPerformanceInput = {
      year: 2026,
      today: TODAY,
      // Fotografie incrementali: ogni mese aggiornato in una data diversa.
      currentRows: [
        ...daily("2026-01-01", "2026-08-31", 100, "2026-08-19"),
        ...daily("2026-09-01", "2026-09-30", 100, "2026-09-30"),
        ...daily("2026-10-01", "2026-10-31", 100, TODAY),
        ...daily("2026-11-01", "2026-12-31", 100, "2026-09-24"),
      ],
      previousRows: year2025,
      budgets: [],
      closures: [],
      observationDate: TODAY,
      asof: fullAsof,
    };
    const rows = buildMonthlyPerformance(input);
    const total = buildMonthlyPerformanceTotal(input, rows);
    [...rows.map((r) => r.sdly), total.sdly].forEach((sdly) => {
      expect(sdly.observationDate).toBe("2026-10-06");
      expect(sdly.targetDate).toBe("2025-10-06");
      expect(sdly.referenceDetail).toBe("fotografia disponibile al 06/10/2025");
    });
    // L'estrazione corrente realmente usata resta quella di ciascun mese.
    expect(rows.map((r) => r.observationDate)).toEqual([
      ...Array(8).fill("2026-08-19"),
      "2026-09-30",
      "2026-10-06",
      "2026-09-24",
      "2026-09-24",
    ]);
    // Riconciliazione: somma dei riferimenti mensili = riferimento del Totale.
    expect(rows.reduce((s, r) => s + (r.sdly.reference ?? 0), 0)).toBe(total.sdly.reference);
  });

  it("senza data di osservazione: SDLY ND ovunque, mai 'oggi'; Consuntivo LY invariato", () => {
    const input = { observationDate: null };
    const rows = build(input);
    rows.forEach((r) => {
      expect(r.sdly.reference).toBeNull();
      expect(r.sdly.unavailableReason).toBe("data di osservazione non disponibile");
      expect(r.consuntivoLy.reference).not.toBeNull();
    });
  });
});

describe("monthlyAsofRequests — fotografie LY da leggere", () => {
  it("sempre i 12 mesi allo stesso cutoff: data di osservazione - 1 anno", () => {
    const requests = monthlyAsofRequests(TODAY);
    expect(requests).toHaveLength(12);
    expect(new Set(requests.map((r) => r.cutoff))).toEqual(new Set(["2025-10-06"]));
    expect(requests.map((r) => r.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("29/02 -> 28/02 dell'anno precedente, mai 01/03", () => {
    expect(new Set(monthlyAsofRequests("2024-02-29").map((r) => r.cutoff))).toEqual(new Set(["2023-02-28"]));
  });

  it("senza data di osservazione: nessuna chiamata", () => {
    expect(monthlyAsofRequests(null)).toEqual([]);
  });
});

describe("mesi senza dato e chiusure", () => {
  it("mese senza righe: ND, mai 0", () => {
    const rows = build({ currentRows: daily("2026-05-01", "2026-11-30", 100, TODAY) });
    const jan = monthOf(rows, 1);
    expect(jan.hasData).toBe(false);
    expect(jan.closedByDeclaration).toBe(false);
    expect(jan.revenue).toBeNull();
    expect(jan.roomsSold).toBeNull();
    expect(jan.occupancy).toBeNull();
    expect(jan.adr).toBeNull();
    expect(jan.revPar).toBeNull();
    expect(jan.sdly.delta).toBeNull();
    expect(jan.consuntivoLy.unavailableReason).toBe("nessun dato importato per questo mese");
  });

  it("mese interamente coperto da chiusura dichiarata: 'Chiuso', nessuna produzione inventata", () => {
    const rows = build({
      currentRows: daily("2026-05-01", "2026-11-30", 100, TODAY),
      closures: [{ start_date: "2026-01-01", end_date: "2026-04-30" }],
    });
    const feb = monthOf(rows, 2);
    expect(feb.closedByDeclaration).toBe(true);
    expect(feb.revenue).toBeNull();
    expect(feb.sdly.unavailableReason).toBe("mese chiuso per chiusura dichiarata");
    // Dicembre non e' coperto dalla chiusura: resta semplice dato mancante.
    expect(monthOf(rows, 12).closedByDeclaration).toBe(false);
  });

  it("un dato reale prevale sulla chiusura dichiarata", () => {
    const rows = build({ closures: [{ start_date: "2026-01-01", end_date: "2026-01-31" }] });
    expect(monthOf(rows, 1).closedByDeclaration).toBe(false);
    expect(monthOf(rows, 1).revenue).toBe(3100);
  });

  it("mese LY finale con giorni operativi mancanti: Consuntivo LY ND, mai somma parziale; SDLY indipendente", () => {
    const rows = build({ previousRows: year2025.filter((r) => r.stay_date < "2025-09-11" || r.stay_date > "2025-09-15") });
    const sep = monthOf(rows, 9);
    expect(sep.consuntivoLy.reference).toBeNull();
    expect(sep.consuntivoLy.delta).toBeNull();
    expect(sep.consuntivoLy.unavailableReason).toBe("storico 2025 incompleto: 25/30 giorni");
    // Lo SDLY dipende dalla fotografia same-day, non dalla completezza del consuntivo.
    expect(sep.sdly.reference).toBe(30 * 70);
  });

  it("giorni LY mancanti ma coperti da chiusura dichiarata: validi a 0", () => {
    const rows = build({
      previousRows: year2025.filter((r) => r.stay_date < "2025-09-11" || r.stay_date > "2025-09-15"),
      closures: [{ start_date: "2025-09-11", end_date: "2025-09-15" }],
    });
    const sep = monthOf(rows, 9);
    expect(sep.consuntivoLy.reference).toBe(2000);
    expect(sep.consuntivoLy.zeroNote).toBe("Chiusura dichiarata 2025 valorizzata a 0: 5 giorni.");
  });

  it("storico LY del tutto assente (ne' consuntivo ne' fotografie): entrambi ND", () => {
    const sep = monthOf(build({ previousRows: [], asof: new Map() }), 9);
    expect(sep.consuntivoLy.unavailableReason).toBe("storico 2025 non disponibile");
    expect(sep.sdly.delta).toBeNull();
    expect(sep.sdly.reference).toBeNull();
  });

  it("Montecallini: stagione mag-nov, chiusure dichiarate solo sull'anno precedente", () => {
    const rows = build({
      currentRows: [
        ...daily("2026-05-01", "2026-09-30", 100, "2026-09-30"),
        ...daily("2026-10-01", "2026-10-31", 100, TODAY),
        ...daily("2026-11-01", "2026-11-30", 0, "2026-09-24", 0),
      ],
      previousRows: daily("2025-05-01", "2025-11-30", 80, "2025-12-31"),
      closures: [
        { start_date: "2025-01-01", end_date: "2025-04-30" },
        { start_date: "2025-12-01", end_date: "2025-12-31" },
      ],
      asof: asofMap({ 6: 2300, 11: 0 }),
    });
    // Gen-apr e dic 2026: nessuna chiusura 2026 dichiarata -> ND, non "Chiuso".
    [1, 2, 3, 4, 12].forEach((m) => {
      expect(monthOf(rows, m).hasData).toBe(false);
      expect(monthOf(rows, m).closedByDeclaration).toBe(false);
      expect(monthOf(rows, m).revenue).toBeNull();
    });
    expect(monthOf(rows, 6).consuntivoLy.reference).toBe(2400);
    // Novembre: revenue 0 reale (dato presente), cutoff as-of dal suo snapshot.
    const nov = monthOf(rows, 11);
    expect(nov.revenue).toBe(0);
    expect(nov.observationDate).toBe("2026-09-24");
    expect(nov.sdly.referenceDetail).toBe("fotografia disponibile al 06/10/2025");
    expect(nov.sdly.reference).toBe(0);
    // Giugno: aggiornato il 30/09, ma stesso target unico 06/10/2025.
    expect(monthOf(rows, 6).observationDate).toBe("2026-09-30");
    expect(monthOf(rows, 6).sdly.targetDate).toBe("2025-10-06");
    expect(monthOf(rows, 6).sdly.reference).toBe(2300);
  });
});

describe("febbraio e anni bisestili", () => {
  it("Febbraio 2024 si confronta con Febbraio 2023 di calendario (28 giorni), mai fino al 01/03", () => {
    const rows = buildMonthlyPerformance({
      year: 2024,
      today: TODAY,
      currentRows: daily("2024-01-01", "2024-12-31", 100, "2025-01-01"),
      previousRows: daily("2023-01-01", "2023-12-31", 80, "2024-01-01"),
      budgets: [],
      closures: [],
      // Osservazione 01/01/2025 -> fotografia LY al 01/01/2024.
      observationDate: "2025-01-01",
      asof: asofMap({ 2: 28 * 80 }, "2024-01-01"),
    });
    const feb = monthOf(rows, 2);
    expect(feb.revenue).toBe(2900);
    expect(feb.consuntivoLy.reference).toBe(28 * 80);
    expect(feb.consuntivoLy.referenceDetail).toBe("01/02/2023 → 28/02/2023");
    expect(feb.sdly.reference).toBe(28 * 80);
  });

  it("Febbraio 2025 si confronta con l'intero Febbraio 2024 (29 giorni)", () => {
    const rows = buildMonthlyPerformance({
      year: 2025,
      today: TODAY,
      currentRows: daily("2025-01-01", "2025-12-31", 100, "2026-01-01"),
      previousRows: daily("2024-01-01", "2024-12-31", 80, "2025-01-01"),
      budgets: [],
      closures: [],
      observationDate: "2026-01-01",
      asof: asofMap({ 2: 29 * 80 }, "2025-01-01"),
    });
    expect(monthOf(rows, 2).consuntivoLy.reference).toBe(29 * 80);
    expect(monthOf(rows, 2).sdly.reference).toBe(29 * 80);
  });
});

describe("budget", () => {
  const budgets = [...budgetRows(2026, 9, 2000, 2500, 4000), ...budgetRows(2026, 11, 2000, 4000, 5000)];

  it("riferimento Realistico, con i tre livelli disponibili per il tooltip", () => {
    const sep = monthOf(build({ budgets }), 9);
    expect(sep.budget).toEqual({ minimo: 2000, realistico: 2500, sfidante: 4000 });
  });

  it("scostamento e raggiungimento calcolati sul Realistico", () => {
    const rows = build({ budgets });
    const sep = monthOf(rows, 9);
    expect(sep.vsBudget).toBeCloseTo(0.2); // 3000 vs 2500, non vs Minimo (+50%)
    expect(sep.budgetAchievement).toBeCloseTo(1.2);
    expect(sep.pacing).toBe("green");
    const nov = monthOf(rows, 11);
    expect(nov.vsBudget).toBeCloseTo(-0.25);
    expect(nov.pacing).toBe("yellow");
  });

  it("mese senza budget e anno storico senza budget: ND", () => {
    expect(monthOf(build({ budgets }), 10).budget.realistico).toBeNull();
    expect(monthOf(build({ budgets }), 10).vsBudget).toBeNull();
    const rows2025 = buildMonthlyPerformance({
      year: 2025,
      today: TODAY,
      currentRows: year2025,
      previousRows: [],
      // Budget di un altro anno: mai riusato.
      budgets,
      closures: [],
      observationDate: "2026-01-01",
      asof: new Map(),
    });
    rows2025.forEach((r) => {
      expect(r.budget).toEqual({ minimo: null, realistico: null, sfidante: null });
      expect(r.vsBudget).toBeNull();
      expect(r.pacing).toBeNull();
      expect(r.status).toBe("closed");
    });
  });
});

describe("KPI ricalcolati dalle somme", () => {
  // Due meta' del mese molto diverse: la media delle percentuali giornaliere
  // darebbe un risultato diverso dal rapporto delle somme.
  const rows = build({
    currentRows: [
      ...daily("2026-09-01", "2026-09-15", 100, TODAY, 1, 10),
      ...daily("2026-09-16", "2026-09-30", 900, TODAY, 9, 30),
    ],
  });
  const sep = monthOf(rows, 9);
  const revenue = 15 * 100 + 15 * 900;
  const sold = 15 * 1 + 15 * 9;
  const available = 15 * 10 + 15 * 30;

  it("Occupazione = RN vendute / RN disponibili", () => {
    expect(sep.roomsSold).toBe(sold);
    expect(sep.occupancy).toBeCloseTo(sold / available);
  });

  it("ADR = Revenue / RN vendute", () => {
    expect(sep.adr).toBeCloseTo(revenue / sold);
  });

  it("RevPAR = Revenue / RN disponibili", () => {
    expect(sep.revPar).toBeCloseTo(revenue / available);
  });

  it("nessuna media di medie", () => {
    const meanOfDailyOccupancy = (0.1 + 0.3) / 2;
    expect(sep.occupancy).toBeCloseTo(0.25);
    expect(sep.occupancy).not.toBeCloseTo(meanOfDailyOccupancy);
    const meanOfDailyRevPar = (10 + 30) / 2;
    expect(sep.revPar).toBeCloseTo(25);
    expect(sep.revPar).not.toBeCloseTo(meanOfDailyRevPar);
  });
});

describe("valore di riferimento esposto sotto il delta", () => {
  it("SDLY mese chiuso: revenue dello stesso mese LY nella fotografia same-day", () => {
    expect(monthOf(build(), 9).sdly.reference).toBe(30 * 70);
  });

  it("SDLY mese in corso: intero mese LY nella fotografia same-day, non i giorni maturati ne' il consuntivo", () => {
    const oct = monthOf(build(), 10);
    expect(oct.sdly.reference).toBe(31 * 70);
    expect(oct.sdly.reference).not.toBe(6 * 80);
    expect(oct.consuntivoLy.reference).toBe(31 * 80);
    expect(oct.sdly.reference).not.toBe(oct.consuntivoLy.reference);
  });

  it("SDLY mese futuro: OTB LY as-of realmente usato, non il consuntivo", () => {
    const nov = monthOf(build({ asof: asofMap({ 11: 1500 }) }), 11);
    expect(nov.sdly.reference).toBe(1500);
    expect(nov.consuntivoLy.reference).toBe(30 * 80);
  });

  it("Consuntivo LY: revenue finale dell'intero mese LY", () => {
    expect(monthOf(build(), 12).consuntivoLy.reference).toBe(31 * 80);
  });

  it("confronto ND: nessun riferimento falso", () => {
    const partialLy = build({ previousRows: year2025.filter((r) => r.stay_date !== "2025-09-10") });
    expect(monthOf(partialLy, 9).consuntivoLy.reference).toBeNull();
    expect(monthOf(build({ asof: new Map() }), 11).sdly.reference).toBeNull();
    const noData = monthOf(build({ currentRows: [] }), 5);
    expect(noData.sdly.reference).toBeNull();
    expect(noData.consuntivoLy.reference).toBeNull();
  });

  it("tooltip: date delle due fotografie", () => {
    const oct = monthOf(build(), 10);
    expect(oct.sdly.actualDetail).toBe("fotografia disponibile al 06/10/2026");
    expect(oct.sdly.referenceDetail).toBe("fotografia disponibile al 06/10/2025");
  });
});

describe("buildMonthlyPerformanceTotal — riga Totale anno", () => {
  function total(overrides: Partial<MonthlyPerformanceInput> = {}) {
    const input: MonthlyPerformanceInput = {
      year: 2026,
      today: TODAY,
      currentRows: year2026,
      previousRows: year2025,
      budgets: [],
      closures: [],
      observationDate: TODAY,
      asof: fullAsof,
      ...overrides,
    };
    return buildMonthlyPerformanceTotal(input, buildMonthlyPerformance(input));
  }

  it("Revenue e RN: somme annuali", () => {
    const t = total();
    expect(t.revenue).toBe(365 * 100);
    expect(t.roomsSold).toBe(365 * 2);
    expect(t.monthsWithData).toBe(12);
    expect(t.status).toBe("current");
  });

  // Bassa stagione piccola e vuota, alta stagione grande e piena: media dei
  // KPI mensili e rapporto delle somme divergono nettamente.
  const seasonal = [
    ...daily("2026-01-01", "2026-06-30", 100, TODAY, 1, 10),
    ...daily("2026-07-01", "2026-12-31", 2700, TODAY, 27, 30),
  ];
  const seasonalRevenue = 181 * 100 + 184 * 2700;
  const seasonalSold = 181 * 1 + 184 * 27;
  const seasonalAvailable = 181 * 10 + 184 * 30;

  it("Occupazione annuale pesata: RN vendute / RN disponibili, mai media delle occupazioni mensili", () => {
    const input = { currentRows: seasonal };
    const t = total(input);
    const rows = build(input);
    const meanOfMonthly = rows.reduce((s, r) => s + (r.occupancy ?? 0), 0) / 12;
    expect(t.occupancy).toBeCloseTo(seasonalSold / seasonalAvailable);
    expect(meanOfMonthly).toBeCloseTo(0.5);
    expect(t.occupancy).not.toBeCloseTo(meanOfMonthly);
  });

  it("ADR annuale: Revenue / RN vendute", () => {
    expect(total({ currentRows: seasonal }).adr).toBeCloseTo(seasonalRevenue / seasonalSold);
  });

  it("RevPAR annuale: Revenue / RN disponibili, mai media dei RevPAR mensili", () => {
    const t = total({ currentRows: seasonal });
    const meanOfMonthly = build({ currentRows: seasonal }).reduce((s, r) => s + (r.revPar ?? 0), 0) / 12;
    expect(t.revPar).toBeCloseTo(seasonalRevenue / seasonalAvailable);
    expect(t.revPar).not.toBeCloseTo(meanOfMonthly);
  });

  it("Budget Realistico annuale completo: somma dei 12 mesi e scostamento sul Revenue annuale", () => {
    const budgets = Array.from({ length: 12 }, (_, i) => budgetRows(2026, i + 1, 2000, 2500, 4000)).flat();
    const t = total({ budgets });
    expect(t.budget).toEqual({ minimo: 24000, realistico: 30000, sfidante: 48000 });
    expect(t.budgetMonths).toBe(12);
    expect(t.budgetComplete).toBe(true);
    expect(t.budgetRevenue).toBe(36500);
    expect(t.vsBudget).toBeCloseTo(36500 / 30000 - 1);
    expect(t.pacing).toBe("green");
  });

  it("Budget annuale incompleto: copertura dichiarata, confronto solo sui mesi con budget", () => {
    const budgets = [...budgetRows(2026, 9, 2000, 2500, 4000), ...budgetRows(2026, 11, 2000, 4000, 5000)];
    const t = total({ budgets });
    expect(t.budgetMonths).toBe(2);
    expect(t.budgetComplete).toBe(false);
    expect(t.budget.realistico).toBe(6500);
    // Revenue di settembre + novembre, non dell'intero anno contro 2 mesi di budget.
    expect(t.budgetRevenue).toBe(6000);
    expect(t.vsBudget).toBeCloseTo(6000 / 6500 - 1);
    expect(t.revenue).toBe(36500);
  });

  it("anno senza budget: ND", () => {
    const t = total();
    expect(t.budget.realistico).toBeNull();
    expect(t.budgetMonths).toBe(0);
    expect(t.vsBudget).toBeNull();
    expect(t.pacing).toBeNull();
  });

  it("SDLY annuale: intero anno nella fotografia corrente vs intero anno LY nella fotografia same-day", () => {
    const t = total();
    expect(t.sdly.current).toBe(365 * 100);
    // Mai la produzione 01/01 -> 06/10 (279 giorni).
    expect(t.sdly.current).not.toBe(279 * 100);
    expect(t.sdly.reference).toBe(365 * 70);
    expect(t.sdly.observationDate).toBe("2026-10-06");
    expect(t.sdly.targetDate).toBe("2025-10-06");
    expect(t.sdly.actualDetail).toBe("fotografia disponibile al 06/10/2026");
    expect(t.sdly.referenceDetail).toBe("fotografia disponibile al 06/10/2025");
    // Stesso valore corrente del Revenue annuale mostrato in riga.
    expect(t.sdly.current).toBe(t.revenue);
  });

  it("SDLY annuale non e' la somma (ne' la media) dei delta mensili", () => {
    // Fotografie LY molto diverse tra i mesi: i delta mensili non si possono sommare.
    const asofRows = asofMap(Object.fromEntries(DAYS_2025.map((d, i) => [i + 1, i < 6 ? d * 10 : d * 400])));
    const input = { asof: asofRows };
    const t = total(input);
    const monthlyDeltas = build(input).map((r) => r.sdly.delta ?? 0);
    const sumOfDeltas = monthlyDeltas.reduce((s, d) => s + d, 0);
    const expected = (365 * 100) / (181 * 10 + 184 * 400) - 1;
    expect(t.sdly.delta).toBeCloseTo(expected);
    expect(t.sdly.delta).not.toBeCloseTo(sumOfDeltas);
    expect(t.sdly.delta).not.toBeCloseTo(sumOfDeltas / 12);
  });

  it("SDLY annuale: un mese LY senza fotografia -> ND, anche con consuntivo LY completo", () => {
    const asofRows = new Map(fullAsof);
    asofRows.delete(asofKey(7, CUTOFF));
    const t = total({ asof: asofRows });
    expect(t.sdly.reference).toBeNull();
    expect(t.sdly.unavailableReason).toBe("fotografia 2025 al 06/10/2025 incompleta: 11/12 mesi");
    expect(t.consuntivoLy.reference).toBe(365 * 80);
  });

  it("Consuntivo LY annuale: Revenue/OTB annuale vs anno LY finale", () => {
    const t = total();
    expect(t.consuntivoLy.current).toBe(36500);
    expect(t.consuntivoLy.reference).toBe(365 * 80);
    expect(t.consuntivoLy.delta).toBeCloseTo(0.25);
    // Diverso dallo SDLY: anno intero, non la sola parte maturata.
    expect(t.consuntivoLy.reference).not.toBe(t.sdly.reference);
  });

  it("consuntivo LY incompleto: Consuntivo LY annuale ND senza riferimento, SDLY indipendente", () => {
    const t = total({ previousRows: year2025.filter((r) => r.stay_date < "2025-03-01" || r.stay_date > "2025-03-10") });
    expect(t.consuntivoLy.reference).toBeNull();
    expect(t.consuntivoLy.unavailableReason).toBe("storico 2025 incompleto: 355/365 giorni");
    expect(t.sdly.reference).toBe(365 * 70);
  });

  it("Montecallini: fotografie incrementali, chiusure LY dichiarate, budget stagionale", () => {
    const input: MonthlyPerformanceInput = {
      year: 2026,
      today: TODAY,
      currentRows: [
        ...daily("2026-05-01", "2026-09-30", 100, "2026-09-30"),
        ...daily("2026-10-01", "2026-10-31", 100, TODAY),
        ...daily("2026-11-01", "2026-11-30", 0, "2026-09-24", 0),
      ],
      previousRows: daily("2025-05-01", "2025-11-30", 80, "2025-12-31"),
      closures: [
        { start_date: "2025-01-01", end_date: "2025-04-30" },
        { start_date: "2025-12-01", end_date: "2025-12-31" },
      ],
      budgets: [5, 6, 7, 8, 9, 10].flatMap((m) => budgetRows(2026, m, 2000, 2500, 4000)),
      observationDate: TODAY,
      // Un solo target (06/10/2025) per righe e Totale.
      asof: asofMap({ 5: 2000, 6: 2000, 7: 2000, 8: 2000, 9: 2000, 10: 1500, 11: 0 }),
    };
    const rows = buildMonthlyPerformance(input);
    const t = buildMonthlyPerformanceTotal(input, rows);
    expect(t.monthsWithData).toBe(7);
    expect(t.revenue).toBe(184 * 100);
    // Intero anno (mag-nov con dato) vs fotografia LY al 06/10/2025; gen-apr e dic LY chiusi a 0.
    expect(t.sdly.current).toBe(184 * 100);
    expect(t.sdly.reference).toBe(5 * 2000 + 1500);
    expect(t.sdly.targetDate).toBe("2025-10-06");
    expect(t.sdly.zeroNote).toBe("Chiusura dichiarata 2025 valorizzata a 0: 5 mesi.");
    // La riga di settembre usa lo stesso target del Totale, non la data del proprio mese.
    expect(monthOf(rows, 9).observationDate).toBe("2026-09-30");
    expect(monthOf(rows, 9).sdly.targetDate).toBe("2025-10-06");
    expect(monthOf(rows, 9).sdly.reference).toBe(2000);
    // Riconciliazione: riferimenti mensili (mag-nov) + mesi chiusi a 0 = riferimento del Totale.
    expect(rows.reduce((s, r) => s + (r.sdly.reference ?? 0), 0)).toBe(t.sdly.reference);
    // Consuntivo LY valido: gen-apr e dicembre coperti da chiusura dichiarata.
    expect(t.consuntivoLy.reference).toBe(214 * 80);
    expect(t.budgetMonths).toBe(6);
    expect(t.budgetComplete).toBe(false);
    expect(t.budgetRevenue).toBe(184 * 100);
    expect(t.budget.realistico).toBe(15000);
  });

  it("anno storico: fotografia dell'anno (01/01 successivo) vs fotografia LY alla stessa data, nessun budget", () => {
    const input: MonthlyPerformanceInput = {
      year: 2025,
      today: TODAY,
      currentRows: year2025,
      previousRows: daily("2024-01-01", "2024-12-31", 50, "2025-01-01"),
      budgets: [],
      closures: [],
      observationDate: "2026-01-01",
      asof: asofMap(Object.fromEntries(DAYS_2025.map((d, i) => [i + 1, (i === 1 ? 29 : d) * 50])), "2025-01-01"),
    };
    const t = buildMonthlyPerformanceTotal(input, buildMonthlyPerformance(input));
    expect(t.status).toBe("closed");
    expect(t.revenue).toBe(365 * 80);
    expect(t.sdly.current).toBe(365 * 80);
    expect(t.sdly.reference).toBe(366 * 50);
    expect(t.sdly.targetDate).toBe("2025-01-01");
    expect(t.consuntivoLy.reference).toBe(366 * 50);
    expect(t.budget.realistico).toBeNull();
  });

  it("anno futuro: stessa regola, intero anno OTB vs fotografia LY con tutti i mesi coperti", () => {
    const input: MonthlyPerformanceInput = {
      year: 2027,
      today: TODAY,
      currentRows: daily("2027-01-01", "2027-12-31", 10, TODAY),
      previousRows: year2026,
      budgets: [],
      closures: [],
      observationDate: TODAY,
      asof: asofMap(Object.fromEntries(DAYS_2025.map((_, i) => [i + 1, 200]))),
    };
    const full = buildMonthlyPerformanceTotal(input, buildMonthlyPerformance(input));
    expect(full.sdly.current).toBe(3650);
    expect(full.sdly.reference).toBe(2400);
    const partialInput = { ...input, asof: asofMap({ 1: 200 }) };
    const partial = buildMonthlyPerformanceTotal(partialInput, buildMonthlyPerformance(partialInput));
    expect(partial.sdly.reference).toBeNull();
    expect(partial.sdly.unavailableReason).toContain("1/12 mesi");
  });

  it("anno senza dati: tutto ND", () => {
    const t = total({ currentRows: [] });
    expect(t.hasData).toBe(false);
    expect(t.revenue).toBeNull();
    expect(t.occupancy).toBeNull();
    expect(t.sdly.reference).toBeNull();
    expect(t.consuntivoLy.reference).toBeNull();
  });
});

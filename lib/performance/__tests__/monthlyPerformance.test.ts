import { describe, expect, it } from "vitest";
import {
  buildMonthlyPerformance,
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
    asofByMonth: new Map(),
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
  it("mese chiuso completo: mese pieno vs mese pieno LY, SDLY = Consuntivo LY", () => {
    const sep = monthOf(build(), 9);
    expect(sep.revenue).toBe(3000);
    expect(sep.sdly.mode).toBe("production");
    expect(sep.sdly.current).toBe(3000);
    expect(sep.sdly.reference).toBe(2400);
    expect(sep.sdly.delta).toBeCloseTo(0.25);
    expect(sep.consuntivoLy.reference).toBe(2400);
    expect(sep.consuntivoLy.delta).toBeCloseTo(0.25);
    expect(sep.staleAsOf).toBeNull();
  });

  it("ultima osservazione precedente alla fine del mese: 'dato al' e SDLY sulla sola parte maturata", () => {
    const rows = build({
      currentRows: [...daily("2026-09-01", "2026-09-30", 100, "2026-09-20"), ...daily("2026-10-01", "2026-12-31", 100, TODAY)],
    });
    const sep = monthOf(rows, 9);
    expect(sep.staleAsOf).toBe("2026-09-20");
    // Revenue resta l'intero mese disponibile; il confronto SDLY si ferma al 20/09.
    expect(sep.revenue).toBe(3000);
    expect(sep.sdly.current).toBe(2000);
    expect(sep.sdly.reference).toBe(1600);
    expect(sep.sdly.actualDetail).toBe("01/09/2026 → 20/09/2026");
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

  it("Produzione vs SDLY solo sull'intervallo maturato fino alla data di osservazione", () => {
    expect(oct.sdly.mode).toBe("production");
    expect(oct.sdly.current).toBe(600);
    expect(oct.sdly.reference).toBe(480);
    expect(oct.sdly.actualDetail).toBe("01/10/2026 → 06/10/2026");
    expect(oct.sdly.referenceDetail).toBe("01/10/2025 → 06/10/2025");
  });

  it("OTB vs Consuntivo LY sull'intero mese", () => {
    expect(oct.consuntivoLy.current).toBe(3100);
    expect(oct.consuntivoLy.reference).toBe(2480);
  });
});

describe("mese futuro", () => {
  it("con as-of LY: OTB del mese vs OTB LY al cutoff del mese", () => {
    const nov = monthOf(build({ asofByMonth: new Map([[11, asof(1500)]]) }), 11);
    expect(nov.sdly.mode).toBe("otb_asof");
    expect(nov.sdly.current).toBe(3000);
    expect(nov.sdly.reference).toBe(1500);
    expect(nov.sdly.delta).toBeCloseTo(1);
    expect(nov.sdly.referenceDetail).toBe("al 06/10/2025");
    // Consuntivo LY resta il mese LY finale, non l'as-of.
    expect(nov.consuntivoLy.reference).toBe(2400);
  });

  it("senza as-of LY: ND con motivo, mai ricostruzione dal consuntivo", () => {
    const nov = monthOf(build(), 11);
    expect(nov.sdly.reference).toBeNull();
    expect(nov.sdly.delta).toBeNull();
    expect(nov.sdly.unavailableReason).toContain("nessun OTB 2025");
  });

  it("Sangiorgio: storico LY giornaliero a consuntivo ma nessun as-of -> SDLY ND, Consuntivo LY disponibile", () => {
    const rows = build({ asofByMonth: new Map([[11, null], [12, null]]) });
    [11, 12].forEach((m) => {
      expect(monthOf(rows, m).sdly.delta).toBeNull();
      expect(monthOf(rows, m).consuntivoLy.delta).not.toBeNull();
    });
  });

  it("as-of LY assente ma mese LY interamente chiuso: riferimento 0 dichiarato", () => {
    const dec = monthOf(build({ closures: [{ start_date: "2025-12-01", end_date: "2025-12-31" }] }), 12);
    expect(dec.sdly.reference).toBe(0);
    expect(dec.sdly.zeroNote).toContain("Chiusura dichiarata 2025");
    expect(dec.sdly.delta).toBeNull();
  });

  it("monthlyAsofRequests: una richiesta per ogni mese futuro con dato, cutoff = osservazione del mese - 1 anno", () => {
    expect(monthlyAsofRequests(2026, TODAY, year2026)).toEqual([
      { month: 11, cutoff: "2025-10-06" },
      { month: 12, cutoff: "2025-10-06" },
    ]);
    // Anno passato: nessuna RPC.
    expect(monthlyAsofRequests(2025, TODAY, year2025)).toEqual([]);
    // Mese futuro senza righe: nessuna RPC. Cutoff per mese, non per struttura.
    expect(monthlyAsofRequests(2026, TODAY, daily("2026-11-01", "2026-11-30", 10, "2026-09-24"))).toEqual([
      { month: 11, cutoff: "2025-09-24" },
    ]);
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

  it("mese LY con giorni operativi mancanti: Consuntivo LY e SDLY ND, mai somma parziale", () => {
    const rows = build({ previousRows: year2025.filter((r) => r.stay_date < "2025-09-11" || r.stay_date > "2025-09-15") });
    const sep = monthOf(rows, 9);
    expect(sep.consuntivoLy.reference).toBeNull();
    expect(sep.consuntivoLy.delta).toBeNull();
    expect(sep.consuntivoLy.unavailableReason).toBe("storico 2025 incompleto: 25/30 giorni");
    expect(sep.sdly.delta).toBeNull();
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

  it("storico LY del tutto assente: ND", () => {
    const sep = monthOf(build({ previousRows: [] }), 9);
    expect(sep.consuntivoLy.unavailableReason).toBe("storico 2025 non disponibile");
    expect(sep.sdly.delta).toBeNull();
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
      asofByMonth: new Map([[11, asof(0)]]),
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
    expect(nov.sdly.referenceDetail).toBe("al 24/09/2025");
    expect(nov.sdly.reference).toBe(0);
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
      asofByMonth: new Map(),
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
      asofByMonth: new Map(),
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
      asofByMonth: new Map(),
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

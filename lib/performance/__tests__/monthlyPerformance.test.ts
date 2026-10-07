import { describe, expect, it } from "vitest";
import {
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

describe("valore di riferimento esposto sotto il delta", () => {
  it("SDLY mese chiuso: revenue dello stesso mese LY", () => {
    expect(monthOf(build(), 9).sdly.reference).toBe(30 * 80);
  });

  it("SDLY mese in corso: revenue LY dello stesso intervallo maturato, diverso dal Consuntivo LY", () => {
    const oct = monthOf(build(), 10);
    expect(oct.sdly.reference).toBe(6 * 80);
    expect(oct.consuntivoLy.reference).toBe(31 * 80);
    expect(oct.sdly.reference).not.toBe(oct.consuntivoLy.reference);
  });

  it("SDLY mese futuro: OTB LY as-of realmente usato, non il consuntivo", () => {
    const nov = monthOf(build({ asofByMonth: new Map([[11, asof(1500)]]) }), 11);
    expect(nov.sdly.reference).toBe(1500);
    expect(nov.consuntivoLy.reference).toBe(30 * 80);
  });

  it("Consuntivo LY: revenue finale dell'intero mese LY", () => {
    expect(monthOf(build(), 12).consuntivoLy.reference).toBe(31 * 80);
  });

  it("confronto ND: nessun riferimento falso", () => {
    const partialLy = build({ previousRows: year2025.filter((r) => r.stay_date !== "2025-09-10") });
    expect(monthOf(partialLy, 9).sdly.reference).toBeNull();
    expect(monthOf(partialLy, 9).consuntivoLy.reference).toBeNull();
    expect(monthOf(build(), 11).sdly.reference).toBeNull();
    const noData = monthOf(build({ currentRows: [] }), 5);
    expect(noData.sdly.reference).toBeNull();
    expect(noData.consuntivoLy.reference).toBeNull();
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
      asofByMonth: new Map(),
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

  it("SDLY anno in corso: produzione YTD 01/01 -> data di osservazione vs stesso intervallo LY", () => {
    const t = total();
    const maturedDays = 279; // 01/01 -> 06/10
    expect(t.sdly.mode).toBe("production");
    expect(t.sdly.current).toBe(maturedDays * 100);
    expect(t.sdly.reference).toBe(maturedDays * 80);
    expect(t.sdly.actualDetail).toBe("01/01/2026 → 06/10/2026");
    expect(t.sdly.referenceDetail).toBe("01/01/2025 → 06/10/2025");
  });

  it("SDLY annuale non e' la somma (ne' la media) dei delta mensili", () => {
    // LY molto diverso tra i mesi: i delta mensili non si possono sommare.
    const previousRows = [
      ...daily("2025-01-01", "2025-06-30", 10, "2026-01-01"),
      ...daily("2025-07-01", "2025-12-31", 400, "2026-01-01"),
    ];
    const input = { previousRows };
    const t = total(input);
    const monthlyDeltas = build(input).map((r) => r.sdly.delta ?? 0);
    const sumOfDeltas = monthlyDeltas.reduce((s, d) => s + d, 0);
    const expected = (279 * 100) / (181 * 10 + 98 * 400) - 1;
    expect(t.sdly.delta).toBeCloseTo(expected);
    expect(t.sdly.delta).not.toBeCloseTo(sumOfDeltas);
    expect(t.sdly.delta).not.toBeCloseTo(sumOfDeltas / 12);
  });

  it("Consuntivo LY annuale: Revenue/OTB annuale vs anno LY finale", () => {
    const t = total();
    expect(t.consuntivoLy.current).toBe(36500);
    expect(t.consuntivoLy.reference).toBe(365 * 80);
    expect(t.consuntivoLy.delta).toBeCloseTo(0.25);
    // Diverso dallo SDLY: anno intero, non la sola parte maturata.
    expect(t.consuntivoLy.reference).not.toBe(t.sdly.reference);
  });

  it("storico LY incompleto: confronti annuali ND senza riferimento", () => {
    const t = total({ previousRows: year2025.filter((r) => r.stay_date < "2025-03-01" || r.stay_date > "2025-03-10") });
    expect(t.consuntivoLy.reference).toBeNull();
    expect(t.consuntivoLy.unavailableReason).toBe("storico 2025 incompleto: 355/365 giorni");
    expect(t.sdly.reference).toBeNull();
  });

  it("Montecallini: copertura parziale, chiusure LY dichiarate, budget stagionale", () => {
    const t = total({
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
    });
    expect(t.monthsWithData).toBe(7);
    expect(t.revenue).toBe(184 * 100);
    // Produzione 01/01 -> 06/10: mag-set + 6 giorni di ottobre, gen-apr LY chiusi a 0.
    expect(t.sdly.current).toBe((153 + 6) * 100);
    expect(t.sdly.reference).toBe((153 + 6) * 80);
    expect(t.sdly.zeroNote).toBe("Chiusura dichiarata 2025 valorizzata a 0: 120 giorni.");
    // Consuntivo LY valido: gen-apr e dicembre coperti da chiusura dichiarata.
    expect(t.consuntivoLy.reference).toBe(214 * 80);
    expect(t.budgetMonths).toBe(6);
    expect(t.budgetComplete).toBe(false);
    expect(t.budgetRevenue).toBe(184 * 100);
    expect(t.budget.realistico).toBe(15000);
  });

  it("anno storico: anno pieno vs anno LY pieno, nessun budget", () => {
    const input: MonthlyPerformanceInput = {
      year: 2025,
      today: TODAY,
      currentRows: year2025,
      previousRows: daily("2024-01-01", "2024-12-31", 50, "2025-01-01"),
      budgets: [],
      closures: [],
      asofByMonth: new Map(),
    };
    const t = buildMonthlyPerformanceTotal(input, buildMonthlyPerformance(input));
    expect(t.status).toBe("closed");
    expect(t.revenue).toBe(365 * 80);
    expect(t.sdly.mode).toBe("production");
    expect(t.sdly.current).toBe(365 * 80);
    expect(t.sdly.reference).toBe(366 * 50);
    expect(t.consuntivoLy.reference).toBe(366 * 50);
    expect(t.budget.realistico).toBeNull();
  });

  it("anno futuro: OTB vs OTB LY as-of solo con tutti i mesi coperti", () => {
    const input: MonthlyPerformanceInput = {
      year: 2027,
      today: TODAY,
      currentRows: daily("2027-01-01", "2027-12-31", 10, TODAY),
      previousRows: year2026,
      budgets: [],
      closures: [],
      asofByMonth: new Map(Array.from({ length: 12 }, (_, i) => [i + 1, asof(200)] as const)),
    };
    const full = buildMonthlyPerformanceTotal(input, buildMonthlyPerformance(input));
    expect(full.sdly.mode).toBe("otb_asof");
    expect(full.sdly.current).toBe(3650);
    expect(full.sdly.reference).toBe(2400);
    const partialInput = { ...input, asofByMonth: new Map([[1, asof(200)]]) };
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

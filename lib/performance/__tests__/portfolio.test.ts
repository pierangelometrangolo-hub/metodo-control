import { describe, expect, it } from "vitest";
import { aggregatePortfolioPerformance, type PortfolioStructureInput } from "../portfolio";
import type { BudgetRow } from "../../performanceMetrics";

function budget(level: BudgetRow["level"], revenue_target: number): BudgetRow {
  return {
    level,
    adr: 0,
    revenue_target,
    room_nights_sold_target: 0,
    room_nights_available: 0,
    occupancy_pct_target: 0,
  };
}

function row(overrides: Partial<PortfolioStructureInput> = {}): PortfolioStructureInput {
  return {
    monthRevenue: 1000,
    monthRoomsSold: 10,
    monthRoomsAvailable: 20,
    lastYearMonthRevenue: null,
    sdlyMonthRevenue: null,
    budgetsForMonth: [],
    ...overrides,
  };
}

const noData = row({ monthRevenue: null, monthRoomsSold: null, monthRoomsAvailable: null });

function expectFiniteOrNull(value: number | null) {
  if (value !== null) expect(Number.isFinite(value)).toBe(true);
}

describe("aggregatePortfolioPerformance", () => {
  it("somma il revenue delle strutture", () => {
    const p = aggregatePortfolioPerformance([row({ monthRevenue: 100 }), row({ monthRevenue: 200 })]);
    expect(p.revenue).toBe(300);
    expect(p.includedStructures).toBe(2);
    expect(p.totalStructures).toBe(2);
  });

  it("ADR = revenue totale / camere vendute totali, non media delle ADR", () => {
    // ADR singole: 100/1 = 100 e 900/9 = 100 -> ok; caso asimmetrico:
    // 100/1 = 100 e 300/10 = 30 -> media 65, aggregato 400/11.
    const p = aggregatePortfolioPerformance([
      row({ monthRevenue: 100, monthRoomsSold: 1 }),
      row({ monthRevenue: 300, monthRoomsSold: 10 }),
    ]);
    expect(p.adr).toBeCloseTo(400 / 11);
    expect(p.adr).not.toBeCloseTo(65);
  });

  it("RevPAR = revenue totale / camere disponibili totali", () => {
    const p = aggregatePortfolioPerformance([
      row({ monthRevenue: 100, monthRoomsAvailable: 10 }),
      row({ monthRevenue: 300, monthRoomsAvailable: 30 }),
    ]);
    expect(p.revpar).toBeCloseTo(400 / 40);
    expect(p.roomsAvailable).toBe(40);
  });

  it("Occupancy = camere vendute totali / camere disponibili totali", () => {
    const p = aggregatePortfolioPerformance([
      row({ monthRoomsSold: 9, monthRoomsAvailable: 10 }),
      row({ monthRoomsSold: 10, monthRoomsAvailable: 100 }),
    ]);
    // media delle occupazioni sarebbe 0,5; aggregata 19/110.
    expect(p.occupancy).toBeCloseTo(19 / 110);
    expect(p.roomsSold).toBe(19);
  });

  it("esclude le strutture senza Actual senza trattarle come zero", () => {
    const p = aggregatePortfolioPerformance([
      row({ monthRevenue: 100, monthRoomsSold: 1, monthRoomsAvailable: 2 }),
      noData,
    ]);
    expect(p.includedStructures).toBe(1);
    expect(p.totalStructures).toBe(2);
    expect(p.revenue).toBe(100);
    expect(p.adr).toBe(100);
    expect(p.occupancy).toBe(0.5);
  });

  it("nessuna struttura con dati: tutti i KPI null, non zero", () => {
    const p = aggregatePortfolioPerformance([noData, noData]);
    expect(p.includedStructures).toBe(0);
    expect(p.revenue).toBeNull();
    expect(p.roomsSold).toBeNull();
    expect(p.adr).toBeNull();
    expect(p.revpar).toBeNull();
    expect(p.occupancy).toBeNull();
    expect(p.lastYear).toBeNull();
    expect(p.pacing).toBeNull();
  });

  it("revenue zero con dati reali presenti resta incluso", () => {
    const p = aggregatePortfolioPerformance([
      row({ monthRevenue: 0, monthRoomsSold: 0, monthRoomsAvailable: 30 }),
      row({ monthRevenue: 200, monthRoomsSold: 2, monthRoomsAvailable: 10 }),
    ]);
    expect(p.includedStructures).toBe(2);
    expect(p.revenue).toBe(200);
    expect(p.revpar).toBe(5);
    expect(p.occupancy).toBe(0.05);
  });

  it("rooms sold totali = 0: ADR null, mai NaN/Infinity", () => {
    const p = aggregatePortfolioPerformance([row({ monthRevenue: 0, monthRoomsSold: 0, monthRoomsAvailable: 10 })]);
    expect(p.adr).toBeNull();
    expect(p.occupancy).toBe(0);
    expectFiniteOrNull(p.revpar);
  });

  it("rooms available totali = 0: RevPAR e Occupancy null, mai NaN/Infinity", () => {
    const p = aggregatePortfolioPerformance([row({ monthRevenue: 0, monthRoomsSold: 0, monthRoomsAvailable: 0 })]);
    expect(p.revpar).toBeNull();
    expect(p.occupancy).toBeNull();
    expect(p.adr).toBeNull();
  });

  it("confronto LY omogeneo: solo strutture con OTB e LY", () => {
    const p = aggregatePortfolioPerformance([
      row({ monthRevenue: 110, lastYearMonthRevenue: 100 }),
      row({ monthRevenue: 220, lastYearMonthRevenue: 200 }),
      row({ monthRevenue: 5000, lastYearMonthRevenue: null }), // nuova apertura
      { ...noData, lastYearMonthRevenue: 999 }, // LY senza OTB: fuori
    ]);
    expect(p.lastYear).not.toBeNull();
    expect(p.lastYear!.coverage).toBe(2);
    expect(p.lastYear!.actual).toBe(330);
    expect(p.lastYear!.reference).toBe(300);
    expect(p.lastYear!.variancePct).toBeCloseTo(0.1);
    // Il revenue del portfolio resta comunque quello di tutte le strutture con dati.
    expect(p.revenue).toBe(5330);
  });

  it("confronto SDLY omogeneo: solo strutture con OTB e SDLY", () => {
    const p = aggregatePortfolioPerformance([
      row({ monthRevenue: 150, sdlyMonthRevenue: 100 }),
      row({ monthRevenue: 800, sdlyMonthRevenue: null }),
    ]);
    expect(p.sdly!.coverage).toBe(1);
    expect(p.sdly!.actual).toBe(150);
    expect(p.sdly!.reference).toBe(100);
    expect(p.sdly!.variancePct).toBeCloseTo(0.5);
  });

  it("SDLY di riferimento a zero: variazione null, non Infinity", () => {
    const p = aggregatePortfolioPerformance([row({ monthRevenue: 150, sdlyMonthRevenue: 0 })]);
    expect(p.sdly!.coverage).toBe(1);
    expect(p.sdly!.variancePct).toBeNull();
  });

  it("confronto Budget omogeneo per livello e pacing sul sottoinsieme", () => {
    const p = aggregatePortfolioPerformance([
      row({ monthRevenue: 900, budgetsForMonth: [budget("minimo", 1000), budget("realistico", 1200)] }),
      row({ monthRevenue: 600, budgetsForMonth: [budget("minimo", 400), budget("realistico", 500), budget("sfidante", 700)] }),
      row({ monthRevenue: 10000, budgetsForMonth: [] }), // senza budget: non deve spingere il pacing
    ]);
    expect(p.budget.minimo).toEqual({ actual: 1500, reference: 1400, variancePct: 100 / 1400, coverage: 2 });
    expect(p.budget.realistico!.reference).toBe(1700);
    expect(p.budget.sfidante).toEqual({ actual: 600, reference: 700, variancePct: -100 / 700, coverage: 1 });
    // 1500 tra Minimo 1400 e Realistico 1700 -> giallo (con 10000 sarebbe verde).
    expect(p.pacing).toBe("yellow");
    expect(p.pacingCoverage).toBe(2);
  });

  it("coperture differenti per Actual, LY, SDLY e Budget", () => {
    const p = aggregatePortfolioPerformance([
      row({ lastYearMonthRevenue: 1, sdlyMonthRevenue: 1, budgetsForMonth: [budget("minimo", 1)] }),
      row({ lastYearMonthRevenue: 1, sdlyMonthRevenue: 1 }),
      row({ lastYearMonthRevenue: 1 }),
      noData,
    ]);
    expect(p.includedStructures).toBe(3);
    expect(p.totalStructures).toBe(4);
    expect(p.lastYear!.coverage).toBe(3);
    expect(p.sdly!.coverage).toBe(2);
    expect(p.budget.minimo!.coverage).toBe(1);
    expect(p.budget.realistico).toBeNull();
  });

  it("anno intero: aggrega totali annuali di strutture con periodi diversi senza riempire di zeri", () => {
    // Struttura A: tutto l'anno (365 giorni x 20 camere). Struttura B:
    // aperta a luglio, solo 184 giorni x 10 camere disponibili nel dato.
    const p = aggregatePortfolioPerformance([
      row({ monthRevenue: 500000, monthRoomsSold: 5000, monthRoomsAvailable: 7300, budgetsForMonth: [budget("minimo", 450000), budget("realistico", 520000)] }),
      row({ monthRevenue: 92000, monthRoomsSold: 920, monthRoomsAvailable: 1840, budgetsForMonth: [budget("minimo", 100000), budget("realistico", 120000)] }),
    ]);
    expect(p.revenue).toBe(592000);
    expect(p.roomsAvailable).toBe(9140);
    expect(p.adr).toBeCloseTo(592000 / 5920);
    expect(p.revpar).toBeCloseTo(592000 / 9140);
    expect(p.occupancy).toBeCloseTo(5920 / 9140);
    expect(p.budget.minimo!.reference).toBe(550000);
    expect(p.pacing).toBe("yellow");
  });

  it("segnala dati parziali quando la pagina ha errori di caricamento", () => {
    expect(aggregatePortfolioPerformance([row()], { hasLoadError: true }).partial).toBe(true);
    expect(aggregatePortfolioPerformance([row()]).partial).toBe(false);
  });

  it("nessuna struttura: coperture a zero", () => {
    const p = aggregatePortfolioPerformance([]);
    expect(p.totalStructures).toBe(0);
    expect(p.includedStructures).toBe(0);
    expect(p.revenue).toBeNull();
  });
});

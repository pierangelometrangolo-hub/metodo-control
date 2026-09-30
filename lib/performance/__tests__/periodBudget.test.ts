import { describe, expect, it } from "vitest";
import {
  aggregateBudgetRows,
  computePeriodBudget,
  monthsInPeriod,
  MonthlyBudgetRow,
  periodBudgetTitles,
  periodKind,
} from "../periodBudget";

// Budget mensile sintetico: revenue = 1000 x mese, 30 camere/giorno.
function monthRow(level: MonthlyBudgetRow["level"], year: number, month: number, factor = 1): MonthlyBudgetRow {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    season_year: year,
    month,
    level,
    adr: 100 * factor,
    revenue_target: 1000 * month * factor,
    room_nights_available: 30 * days,
    room_nights_sold_target: 15 * days * factor,
    occupancy_pct_target: 0.5 * factor,
  };
}

const LEVELS: MonthlyBudgetRow["level"][] = ["minimo", "realistico", "sfidante"];
const FACTORS = { minimo: 1, realistico: 1.1, sfidante: 1.25 };

// Struttura con budget su tutti i 12 mesi (es. Palazzo Rollo).
const FULL_YEAR = LEVELS.flatMap((l) => Array.from({ length: 12 }, (_, i) => monthRow(l, 2026, i + 1, FACTORS[l])));
// Struttura con budget solo giugno-dicembre (es. Dimora De Belli).
const JUNE_DEC = LEVELS.flatMap((l) => Array.from({ length: 7 }, (_, i) => monthRow(l, 2026, i + 6, FACTORS[l])));

const minimo = (b: ReturnType<typeof computePeriodBudget>) => b.budgets.find((x) => x.level === "minimo")!;

describe("computePeriodBudget — il budget segue il periodo selezionato", () => {
  it("A. Anno 2026 (2026-01-01 -> 2026-12-31): somma dei 12 mesi, nessun mese implicito", () => {
    const b = computePeriodBudget(FULL_YEAR, "2026-01-01", "2026-12-31");
    expect(b.kind).toBe("year");
    expect(periodBudgetTitles[b.kind]).toBe("Anno vs budget");
    expect(b.monthsInPeriod).toBe(12);
    expect(b.monthsWithBudget).toBe(12);
    expect(b.prorated).toBe(false);
    expect(b.daysInPeriod).toBe(365);
    expect(minimo(b).revenue_target).toBe(1000 * 78); // 1+2+...+12
    expect(minimo(b).room_nights_available).toBe(30 * 365);
    // Occupazione target = media pesata sulle camere, qui costante 50%.
    expect(minimo(b).occupancy_pct_target).toBeCloseTo(0.5, 10);
    expect(b.budgets.map((x) => x.level)).toEqual(["minimo", "realistico", "sfidante"]);
    expect(b.budgets.find((x) => x.level === "sfidante")!.revenue_target).toBeCloseTo(1000 * 78 * 1.25, 6);
  });

  it("B. Mese selezionato: solo il budget di quel mese, identico alla riga mensile", () => {
    const b = computePeriodBudget(FULL_YEAR, "2026-09-01", "2026-09-30");
    expect(b.kind).toBe("month");
    expect(periodBudgetTitles[b.kind]).toBe("Mese selezionato vs budget");
    const sept = FULL_YEAR.find((r) => r.level === "minimo" && r.month === 9)!;
    expect(minimo(b).revenue_target).toBe(sept.revenue_target);
    expect(minimo(b).occupancy_pct_target).toBe(sept.occupancy_pct_target);
    expect(b.daysInPeriod).toBe(30);
    expect(b.prorated).toBe(false);
  });

  it("C. Intervallo: solo i giorni compresi, mesi tagliati pro-rata giorni", () => {
    // 15/09 -> 10/10: 16/30 di settembre + 10/31 di ottobre.
    const b = computePeriodBudget(FULL_YEAR, "2026-09-15", "2026-10-10");
    expect(b.kind).toBe("range");
    expect(periodBudgetTitles[b.kind]).toBe("Periodo selezionato vs budget");
    expect(b.prorated).toBe(true);
    expect(b.monthsInPeriod).toBe(2);
    expect(b.daysInPeriod).toBe(26);
    expect(minimo(b).revenue_target).toBeCloseTo(9000 * (16 / 30) + 10000 * (10 / 31), 6);
    expect(minimo(b).room_nights_available).toBeCloseTo(30 * 26, 6);
  });

  it("D. Cambio filtro Mese -> Anno -> Intervallo: ogni calcolo dipende solo dal proprio periodo", () => {
    const month = computePeriodBudget(FULL_YEAR, "2026-09-01", "2026-09-30");
    const year = computePeriodBudget(FULL_YEAR, "2026-01-01", "2026-12-31");
    const range = computePeriodBudget(FULL_YEAR, "2026-09-15", "2026-10-10");
    const monthAgain = computePeriodBudget(FULL_YEAR, "2026-09-01", "2026-09-30");
    expect(minimo(month).revenue_target).toBe(9000);
    expect(minimo(year).revenue_target).toBe(78000);
    expect(minimo(range).revenue_target).not.toBe(minimo(month).revenue_target);
    expect(monthAgain).toEqual(month);
  });

  it("E. due strutture con budget diversi: 12 mesi vs solo giugno-dicembre (copertura esplicita)", () => {
    const full = computePeriodBudget(FULL_YEAR, "2026-01-01", "2026-12-31");
    const partial = computePeriodBudget(JUNE_DEC, "2026-01-01", "2026-12-31");
    expect(full.monthsWithBudget).toBe(12);
    expect(partial.monthsWithBudget).toBe(7);
    expect(partial.monthsInPeriod).toBe(12);
    expect(minimo(partial).revenue_target).toBe(1000 * (6 + 7 + 8 + 9 + 10 + 11 + 12));
    // Mese senza budget: nessun livello, mai uno zero inventato.
    expect(computePeriodBudget(JUNE_DEC, "2026-03-01", "2026-03-31").budgets).toEqual([]);
  });

  it("occupazione target: sempre sold_target / available del periodo, mai la % salvata", () => {
    // Righe con occupancy_pct_target salvata diversa da sold/available (caso
    // reale Palazzo Rollo Minimo 2026).
    const rows: MonthlyBudgetRow[] = [
      { season_year: 2026, month: 1, level: "minimo", adr: 100, revenue_target: 3000, room_nights_available: 162, room_nights_sold_target: 30, occupancy_pct_target: 0.100671 },
      { season_year: 2026, month: 2, level: "minimo", adr: 100, revenue_target: 3000, room_nights_available: 178, room_nights_sold_target: 30, occupancy_pct_target: 0.112782 },
    ];
    // Mese intero (Rollo gennaio Minimo): 30 / 162 = 18,52%, non 10,1%.
    const january = minimo(computePeriodBudget(rows, "2026-01-01", "2026-01-31")).occupancy_pct_target;
    expect(january).toBeCloseTo(30 / 162, 10);
    expect(january).toBeCloseTo(0.1852, 4);
    expect(january).not.toBeCloseTo(0.100671, 3);
    // Due mesi: (30 + 30) / (162 + 178).
    expect(minimo(computePeriodBudget(rows, "2026-01-01", "2026-02-28")).occupancy_pct_target).toBeCloseTo(60 / 340, 10);
    // Mese tagliato (pro-rata): sold e available scalati dello stesso fattore -> 30 / 162.
    const partial = minimo(computePeriodBudget(rows, "2026-01-01", "2026-01-15"));
    expect(partial.room_nights_sold_target).toBeCloseTo(30 * (15 / 31), 10);
    expect(partial.room_nights_available).toBeCloseTo(162 * (15 / 31), 10);
    expect(partial.occupancy_pct_target).toBeCloseTo(30 / 162, 10);
    // Valori anomali non vengono limitati (Sfidante > 100% resta tale).
    const anomalous: MonthlyBudgetRow[] = [
      { ...rows[0], month: 9, level: "sfidante", room_nights_sold_target: 170, room_nights_available: 162 },
      { ...rows[0], month: 10, level: "sfidante", room_nights_sold_target: 170, room_nights_available: 162 },
    ];
    const s = computePeriodBudget(anomalous, "2026-09-01", "2026-10-31").budgets[0];
    expect(s.occupancy_pct_target).toBeCloseTo(340 / 324, 10);
  });

  it("righe di anni fuori dal periodo ignorate; intervallo a cavallo d'anno", () => {
    const rows = [...FULL_YEAR, monthRow("minimo", 2027, 1), monthRow("minimo", 2025, 12)];
    const b = computePeriodBudget(rows, "2026-12-01", "2027-01-31");
    expect(b.monthsInPeriod).toBe(2);
    expect(minimo(b).revenue_target).toBe(12000 + 1000);
  });
});

describe("periodKind / monthsInPeriod", () => {
  it("riconosce mese, anno, intervallo (bisestile incluso)", () => {
    expect(periodKind("2028-02-01", "2028-02-29")).toBe("month");
    expect(periodKind("2026-02-01", "2026-02-27")).toBe("range");
    expect(periodKind("2026-01-01", "2026-12-31")).toBe("year");
    expect(periodKind("2026-01-01", "2027-12-31")).toBe("range");
  });

  it("giorni per mese nel periodo", () => {
    expect(monthsInPeriod("2026-01-30", "2026-03-02")).toEqual([
      { year: 2026, month: 1, daysInPeriod: 2, daysInMonth: 31 },
      { year: 2026, month: 2, daysInPeriod: 28, daysInMonth: 28 },
      { year: 2026, month: 3, daysInPeriod: 2, daysInMonth: 31 },
    ]);
  });
});

describe("aggregateBudgetRows (spostata da Dashboard, comportamento invariato)", () => {
  it("un solo mese -> la riga di partenza", () => {
    const r = monthRow("minimo", 2026, 5);
    const plain = {
      level: r.level,
      adr: r.adr,
      revenue_target: r.revenue_target,
      room_nights_sold_target: r.room_nights_sold_target,
      room_nights_available: r.room_nights_available,
      occupancy_pct_target: r.occupancy_pct_target,
    };
    expect(aggregateBudgetRows([plain])).toEqual(plain);
  });
});

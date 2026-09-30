import { describe, expect, it } from "vitest";
import {
  BudgetRow,
  computeGoalProgress,
  computeRemainingRoomNights,
  DailyCapacityRow,
  GoalProgress,
  selectGoalLevel,
} from "../performanceMetrics";

// Budget reali di Palazzo Arco Cadura, settembre 2026 (v_budgets_current).
const ARCO_BUDGETS: BudgetRow[] = [
  { level: "minimo", revenue_target: 23400, occupancy_pct_target: 0.632603, room_nights_available: 411, room_nights_sold_target: 260, adr: 90 },
  { level: "realistico", revenue_target: 24584.625, occupancy_pct_target: 0.648418, room_nights_available: 411, room_nights_sold_target: 266.5, adr: 92.25 },
  { level: "sfidante", revenue_target: 27104.5491, occupancy_pct_target: 0.847955, room_nights_available: 330, room_nights_sold_target: 279.825, adr: 96.8625 },
];

// Tutti i giorni del mese, 14 camere, `sold` vendute per giorno.
function monthRows(year: number, month: number, sold: (day: number) => number, available = 14): DailyCapacityRow[] {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => ({
    stayDate: `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`,
    roomsSold: sold(i + 1),
    roomsAvailable: available,
  }));
}

const SEPT = { periodStart: "2026-09-01", periodEnd: "2026-09-30" };

function progress(overrides: Partial<Parameters<typeof computeGoalProgress>[0]>): GoalProgress | null {
  return computeGoalProgress({
    monthRevenue: 22056.44,
    roomsSold: 226,
    budgets: ARCO_BUDGETS,
    dailyRows: monthRows(2026, 9, (d) => (d === 30 ? 6 : 8)),
    ...SEPT,
    today: "2026-09-30",
    ...overrides,
  });
}

function expectFiniteNumbers(goal: GoalProgress | null) {
  for (const value of Object.values(goal ?? {})) {
    if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
  }
}

describe("computeGoalProgress — target progressivo", () => {
  it("12. caso reale Arco Cadura 30/09/2026: gap 1.343,56, RN teoriche 34, RN residue 8, ADR operativo ~168", () => {
    const goal = progress({});
    expect(goal?.status).toBe("pending");
    if (goal?.status !== "pending") throw new Error("unreachable");
    expect(goal.level).toBe("minimo");
    expect(goal.gapRevenue).toBeCloseTo(1343.56, 2);
    expect(Math.ceil(goal.theoreticalRoomsNeeded!)).toBe(34);
    expect(goal.remainingRoomNights).toBe(8);
    expect(goal.adrNeeded).toBeCloseTo(167.945, 2);
    expect(Math.round(goal.adrNeeded)).toBe(168);
  });

  it("1. sotto Minimo + capacita' residua sufficiente: RN residue >= RN teoriche", () => {
    const goal = progress({ today: "2026-09-20", dailyRows: monthRows(2026, 9, () => 8) });
    if (goal?.status !== "pending") throw new Error(`atteso pending, ricevuto ${goal?.status}`);
    expect(goal.remainingRoomNights).toBe(11 * 6); // 20..30 = 11 giorni x (14 - 8)
    expect(goal.remainingRoomNights).toBeGreaterThanOrEqual(goal.theoreticalRoomsNeeded!);
    expect(goal.adrNeeded).toBeCloseTo(1343.56 / 66, 6);
  });

  it("2. sotto Minimo + RN teoriche > RN residue: resta 'pending' con ADR operativo, mai 'non raggiungibile'", () => {
    const goal = progress({});
    expect(goal?.status).toBe("pending");
    if (goal?.status !== "pending") throw new Error("unreachable");
    expect(goal.theoreticalRoomsNeeded!).toBeGreaterThan(goal.remainingRoomNights);
  });

  it("3. capacita' residua zero (tutto venduto) -> capacity_exhausted, nessun ADR", () => {
    const goal = progress({ dailyRows: monthRows(2026, 9, () => 14) });
    expect(goal).toMatchObject({ status: "capacity_exhausted", level: "minimo", remainingRoomNights: 0 });
    expect(goal && "adrNeeded" in goal).toBe(false);
  });

  it("4. Minimo raggiunto -> target Realistico", () => {
    const goal = progress({ monthRevenue: 23500 });
    expect(goal?.level).toBe("realistico");
    if (goal?.status !== "pending") throw new Error("unreachable");
    expect(goal.gapRevenue).toBeCloseTo(24584.625 - 23500, 6);
    expect(goal.theoreticalRoomsNeeded!).toBeCloseTo(0.648418 * 411 - 226, 6);
  });

  it("5. Realistico raggiunto -> target Sfidante", () => {
    const goal = progress({ monthRevenue: 25000 });
    expect(goal?.level).toBe("sfidante");
    if (goal?.status !== "pending") throw new Error("unreachable");
    expect(goal.gapRevenue).toBeCloseTo(27104.5491 - 25000, 6);
  });

  it("6. Sfidante raggiunto -> achieved", () => {
    expect(progress({ monthRevenue: 27200 })).toEqual({ status: "achieved", level: "sfidante" });
    // Esattamente al target conta come raggiunto.
    expect(progress({ monthRevenue: 27104.5491 })?.status).toBe("achieved");
  });

  it("7. giorno corrente incluso nella capacita' residua", () => {
    const rows = monthRows(2026, 9, () => 10);
    expect(computeRemainingRoomNights(rows, SEPT.periodStart, SEPT.periodEnd, "2026-09-30")).toBe(4);
    expect(computeRemainingRoomNights(rows, SEPT.periodStart, SEPT.periodEnd, "2026-09-29")).toBe(8);
  });

  it("8. mese passato: capacita' residua 0 -> capacity_exhausted se il gap resta", () => {
    const goal = progress({ today: "2026-10-01" });
    expect(goal).toMatchObject({ status: "capacity_exhausted", remainingRoomNights: 0 });
  });

  it("9. mese futuro completo: residuo = intero mese", () => {
    const goal = progress({
      monthRevenue: 5000,
      roomsSold: 50,
      dailyRows: monthRows(2026, 9, () => 2),
      today: "2026-08-15",
    });
    if (goal?.status !== "pending") throw new Error("unreachable");
    expect(goal.remainingRoomNights).toBe(30 * 12);
  });

  it("10. mese futuro con giorni mancanti -> insufficient_data, mai stimato dal budget", () => {
    const rows = monthRows(2026, 9, () => 2).filter((r) => r.stayDate !== "2026-09-15");
    const goal = progress({ monthRevenue: 5000, roomsSold: 50, dailyRows: rows, today: "2026-08-15" });
    expect(goal).toMatchObject({ status: "insufficient_data", level: "minimo" });
    expect(goal && "adrNeeded" in goal).toBe(false);
    expect(goal && "remainingRoomNights" in goal).toBe(false);

    // Giorni mancanti PRIMA di oggi non contano: il residuo parte da oggi.
    const pastGap = monthRows(2026, 9, (d) => (d === 30 ? 6 : 8)).filter((r) => r.stayDate !== "2026-09-05");
    expect(progress({ dailyRows: pastGap })?.status).toBe("pending");
  });

  it("11. nessun NaN/Infinity: budget con campi mancanti, righe con valori null, residuo zero", () => {
    const brokenBudgets = ARCO_BUDGETS.map((b) => ({ ...b, occupancy_pct_target: undefined as unknown as number }));
    const g1 = progress({ budgets: brokenBudgets });
    expect(g1?.status).toBe("pending");
    if (g1?.status === "pending") expect(g1.theoreticalRoomsNeeded).toBeNull();
    expectFiniteNumbers(g1);

    const nullRows = monthRows(2026, 9, () => 8).map((r) => (r.stayDate === "2026-09-30" ? { ...r, roomsSold: null } : r));
    const g2 = progress({ dailyRows: nullRows });
    expect(g2?.status).toBe("insufficient_data");
    expectFiniteNumbers(g2);

    const g3 = progress({ dailyRows: monthRows(2026, 9, () => 20) }); // venduto > disponibile: mai negativo
    expect(g3).toMatchObject({ status: "capacity_exhausted", remainingRoomNights: 0 });
    expectFiniteNumbers(g3);

    expectFiniteNumbers(progress({ roomsSold: null }));
  });

  it("RN teoriche gia' vendute (occupazione target raggiunta) -> 0 necessarie, mai negative", () => {
    const goal = progress({ roomsSold: 300 });
    if (goal?.status !== "pending") throw new Error("unreachable");
    expect(goal.theoreticalRoomsNeeded).toBe(0);
  });

  it("ND come prima: OTB mancante o nessun budget Minimo", () => {
    expect(progress({ monthRevenue: null })).toBeNull();
    expect(progress({ budgets: ARCO_BUDGETS.filter((b) => b.level !== "minimo") })).toBeNull();
  });

  it("selectGoalLevel: solo livelli presenti; tutti raggiunti -> null", () => {
    const onlyMinimo = ARCO_BUDGETS.filter((b) => b.level === "minimo");
    expect(selectGoalLevel(20000, onlyMinimo)?.level).toBe("minimo");
    expect(selectGoalLevel(24000, onlyMinimo)).toBeNull();
    expect(progress({ budgets: onlyMinimo, monthRevenue: 24000 })).toEqual({ status: "achieved", level: "minimo" });
  });

  it("periodo 'Tutto l'anno': residuo da oggi al 31/12", () => {
    const rows = [9, 10, 11, 12].flatMap((m) => monthRows(2026, m, () => 10));
    expect(computeRemainingRoomNights(rows, "2026-01-01", "2026-12-31", "2026-09-30")).toBe(4 * (1 + 31 + 30 + 31));
  });
});

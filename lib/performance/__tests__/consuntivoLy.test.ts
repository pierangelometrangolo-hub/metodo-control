import { describe, expect, it } from "vitest";
import { ConsuntivoLyRow, resolveConsuntivoLy } from "../consuntivoLy";
import { buildMonthlyPerformance, buildMonthlyPerformanceTotal, MonthlyPerformanceInput } from "../monthlyPerformance";
import { computeLikeForLike } from "../likeForLike";
import { aggregatePortfolioPerformance } from "../portfolio";

// Consuntivo LY = valore FINALE dello stesso periodo LY: solo se il periodo
// e' completo e chiuso nei dati (estratto dopo la sua fine operativa).

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function daily(start: string, end: string, revenue: number, extractionDate: string | null): ConsuntivoLyRow[] {
  const rows: ConsuntivoLyRow[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    rows.push({ stay_date: day, extraction_date: extractionDate, revenue_total: revenue, rooms_sold: 2, rooms_available: 10, arrivals: 1, presences: 4 });
  }
  return rows;
}

const resolve = (lyStart: string, lyEnd: string, rows: ConsuntivoLyRow[], closures: { start_date: string; end_date: string }[] = []) =>
  resolveConsuntivoLy({ lyStart, lyEnd, rows, closures });

describe("resolveConsuntivoLy — periodo LY completo e chiuso", () => {
  it("anno chiuso (export del 01/01 successivo): consuntivo valido con tutti i KPI", () => {
    const c = resolve("2025-01-01", "2025-12-31", daily("2025-01-01", "2025-12-31", 80, "2026-01-01"));
    expect(c.status).toBe("ok");
    expect(c.agg).toEqual({ revenue: 365 * 80, roomsSold: 730, roomsAvailable: 3650, arrivals: 365, presences: 1460 });
    expect(c.unavailableReason).toBeNull();
  });

  it("caso reale 2027: il 2026 fotografato il 15/10/2026 non e' un consuntivo -> ND", () => {
    const c = resolve("2026-01-01", "2026-12-31", daily("2026-01-01", "2026-12-31", 1369, "2026-10-15"));
    expect(c.status).toBe("not_final");
    expect(c.agg).toBeNull();
    expect(c.latestExtraction).toBe("2026-10-15");
    expect(c.unavailableReason).toBe(
      "periodo 2026 non ancora consuntivato: ultima fotografia del 15/10/2026, non successiva alla fine del periodo (31/12/2026)"
    );
  });

  it("mese: gennaio 2026 estratto il 15/10 e' chiuso, ottobre 2026 estratto il 15/10 no", () => {
    const rows = daily("2026-01-01", "2026-12-31", 100, "2026-10-15");
    expect(resolve("2026-01-01", "2026-01-31", rows).status).toBe("ok");
    expect(resolve("2026-10-01", "2026-10-31", rows).status).toBe("not_final");
  });

  it("estrazione il giorno stesso della fine del periodo: non ancora chiuso", () => {
    expect(resolve("2025-12-01", "2025-12-31", daily("2025-12-01", "2025-12-31", 80, "2025-12-31")).status).toBe("not_final");
  });

  it("basta UNA riga estratta prima della fine per non essere consuntivo", () => {
    const rows = [...daily("2025-10-01", "2025-10-30", 80, "2025-11-01"), ...daily("2025-10-31", "2025-10-31", 80, "2025-10-20")];
    expect(resolve("2025-10-01", "2025-10-31", rows).status).toBe("not_final");
  });

  it("riga senza extraction_date: la chiusura non e' dimostrata -> ND", () => {
    expect(resolve("2025-10-01", "2025-10-31", daily("2025-10-01", "2025-10-31", 80, null)).status).toBe("not_final");
  });

  it("completezza: giorni operativi mancanti -> ND, mai somma parziale", () => {
    const rows = daily("2025-09-01", "2025-09-30", 80, "2026-01-01").filter((r) => r.stay_date !== "2025-09-10");
    const c = resolve("2025-09-01", "2025-09-30", rows);
    expect(c.status).toBe("partial");
    expect(c.agg).toBeNull();
    expect(c.unavailableReason).toBe("storico 2025 incompleto: 29/30 giorni");
    expect(resolve("2025-09-01", "2025-09-30", []).unavailableReason).toBe("storico 2025 non disponibile");
  });

  it("giorni mancanti coperti da chiusura dichiarata valgono 0", () => {
    const rows = daily("2025-09-01", "2025-09-30", 80, "2026-01-01").filter((r) => r.stay_date < "2025-09-11" || r.stay_date > "2025-09-15");
    const c = resolve("2025-09-01", "2025-09-30", rows, [{ start_date: "2025-09-11", end_date: "2025-09-15" }]);
    expect(c.status).toBe("ok");
    expect(c.agg?.revenue).toBe(25 * 80);
    expect(c.zeroNote).toBe("Chiusura dichiarata 2025 valorizzata a 0: 5 giorni.");
  });

  it("Montecallini: stagione mag-nov, chiusura dichiarata a dicembre, export del 31/12 -> 2025 consuntivato", () => {
    const rows = [...daily("2025-05-01", "2025-10-31", 80, "2025-12-31"), ...daily("2025-11-01", "2025-11-30", 0, "2025-12-01")];
    const closures = [
      { start_date: "2025-01-01", end_date: "2025-04-30" },
      { start_date: "2025-12-01", end_date: "2025-12-31" },
    ];
    const c = resolve("2025-01-01", "2025-12-31", rows, closures);
    expect(c.operationalEnd).toBe("2025-11-30");
    expect(c.status).toBe("ok");
    expect(c.agg?.revenue).toBe(184 * 80);
  });

  it("periodo interamente chiuso per chiusura dichiarata: consuntivo 0", () => {
    const c = resolve("2025-12-01", "2025-12-31", [], [{ start_date: "2025-12-01", end_date: "2025-12-31" }]);
    expect(c.status).toBe("ok");
    expect(c.agg?.revenue).toBe(0);
  });

  it("filtra le righe fuori periodo", () => {
    const rows = [...daily("2025-08-01", "2025-08-31", 80, "2025-08-15"), ...daily("2025-09-01", "2025-09-30", 80, "2026-01-01")];
    expect(resolve("2025-09-01", "2025-09-30", rows)).toMatchObject({ status: "ok", agg: { revenue: 2400 } });
  });
});

describe("Performance mensile: anno futuro contro anno precedente aperto", () => {
  const TODAY = "2026-10-15";
  const input: MonthlyPerformanceInput = {
    year: 2027,
    today: TODAY,
    currentRows: daily("2027-01-01", "2027-12-31", 10, TODAY).map((r) => ({ ...r, extraction_date: TODAY })),
    previousRows: daily("2026-01-01", "2026-12-31", 100, TODAY),
    budgets: [],
    closures: [],
    observationDate: TODAY,
    asof: new Map(),
  };
  const rows = buildMonthlyPerformance(input);
  const total = buildMonthlyPerformanceTotal(input, rows);

  it("mesi 2026 gia' chiusi al 15/10 hanno il consuntivo, quelli aperti no", () => {
    expect(rows[0].consuntivoLy.reference).toBe(31 * 100);
    expect(rows[8].consuntivoLy.reference).toBe(30 * 100);
    [9, 10, 11].forEach((i) => {
      expect(rows[i].consuntivoLy.reference).toBeNull();
      expect(rows[i].consuntivoLy.unavailableReason).toMatch(/non ancora consuntivato/);
    });
  });

  it("Totale anno: 2026 non consuntivato -> ND, nessun delta", () => {
    expect(total.consuntivoLy.reference).toBeNull();
    expect(total.consuntivoLy.delta).toBeNull();
    expect(total.consuntivoLy.unavailableReason).toMatch(/periodo 2026 non ancora consuntivato/);
  });
});

describe("Vista d'insieme: TOTALE METODO e L4L senza consuntivo LY", () => {
  it("struttura con LY non consuntivato esce dal confronto LY, come un dato mancante", () => {
    const open = resolve("2026-01-01", "2026-12-31", daily("2026-01-01", "2026-12-31", 100, "2026-10-15"));
    const closed = resolve("2025-01-01", "2025-12-31", daily("2025-01-01", "2025-12-31", 100, "2026-01-01"));
    const rows = [
      { id: "a", name: "A", actual: 1000, reference: open.agg?.revenue ?? null },
      { id: "b", name: "B", actual: 2000, reference: closed.agg?.revenue ?? null },
    ];
    const memberships = rows.map((r) => ({ structure_id: r.id, valid_from: "2025-01-01", valid_to: null }));
    const l4l = computeLikeForLike(rows, memberships, 2027, 2026);
    expect(l4l.included.map((s) => s.id)).toEqual(["b"]);
    expect(l4l.excluded).toEqual([{ id: "a", name: "A", reasons: ["missing_reference_data"] }]);
    const portfolio = aggregatePortfolioPerformance(
      rows.map((r) => ({
        monthRevenue: r.actual,
        monthRoomsSold: 1,
        monthRoomsAvailable: 1,
        lastYearMonthRevenue: r.reference,
        sdlyMonthRevenue: null,
        budgetsForMonth: [],
      }))
    );
    expect(portfolio.lastYear).toMatchObject({ actual: 2000, coverage: 1 });
  });
});

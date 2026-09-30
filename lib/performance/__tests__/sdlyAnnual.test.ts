import { describe, expect, it } from "vitest";
import { aggregateMonthlyAsof, MonthAsofRow } from "../sdlyAnnual";

function month(i: number): MonthAsofRow {
  return {
    revenue_total: 10000 + i * 1000,
    rooms_sold: 200 + i * 10,
    rooms_available: i % 2 === 0 ? 400 : 300, // mesi di capacita' diversa
    arrivals: 80 + i,
    presences: 400 + i * 5,
  };
}

describe("aggregateMonthlyAsof — SDLY anno pieno dai 12 mesi allo stesso cutoff", () => {
  it("12 mesi presenti -> copertura completa, solo somme", () => {
    const rows = Array.from({ length: 12 }, (_, i) => month(i));
    const r = aggregateMonthlyAsof(rows);
    expect(r.coverage).toBe("full");
    if (r.coverage !== "full") throw new Error("unreachable");
    expect(r.agg.revenue).toBe(rows.reduce((s, x) => s + Number(x.revenue_total), 0));
    expect(r.agg.roomsSold).toBe(rows.reduce((s, x) => s + Number(x.rooms_sold), 0));
    expect(r.agg.roomsAvailable).toBe(6 * 400 + 6 * 300);
    expect(r.agg.arrivals).toBe(rows.reduce((s, x) => s + Number(x.arrivals), 0));
    expect(r.agg.presences).toBe(rows.reduce((s, x) => s + Number(x.presences), 0));
  });

  it("occupazione dai totali, mai media delle percentuali mensili", () => {
    const rows = Array.from({ length: 12 }, (_, i) => month(i));
    const r = aggregateMonthlyAsof(rows);
    if (r.coverage !== "full") throw new Error("unreachable");
    const fromTotals = r.agg.roomsSold / r.agg.roomsAvailable;
    const meanOfMonthly = rows.reduce((s, x) => s + Number(x.rooms_sold) / Number(x.rooms_available), 0) / 12;
    expect(fromTotals).not.toBeCloseTo(meanOfMonthly, 6);
  });

  it("valori numeric come stringa (PostgREST) sommati correttamente", () => {
    const rows = Array.from({ length: 12 }, () => ({
      revenue_total: "100.50",
      rooms_sold: "3",
      rooms_available: "10",
      arrivals: "1",
      presences: "6",
    }));
    const r = aggregateMonthlyAsof(rows);
    if (r.coverage !== "full") throw new Error("unreachable");
    expect(r.agg.revenue).toBeCloseTo(1206, 8);
  });

  it("F. mesi mancanti -> copertura parziale, nessun totale annuale", () => {
    const rows = Array.from({ length: 12 }, (_, i) => (i < 9 ? month(i) : null));
    const r = aggregateMonthlyAsof(rows);
    expect(r).toEqual({ coverage: "partial", agg: null, monthsCovered: 9, monthsExpected: 12 });
  });

  it("nessun mese -> nessuna copertura (ND)", () => {
    expect(aggregateMonthlyAsof(Array(12).fill(null))).toEqual({
      coverage: "none",
      agg: null,
      monthsCovered: 0,
      monthsExpected: 12,
    });
  });
});

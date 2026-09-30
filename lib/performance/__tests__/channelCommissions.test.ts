import { describe, expect, it } from "vitest";
import { ChannelRevenueMonthInput, CommissionRateInput, summarizeChannelCommissions } from "../channelCommissions";

// Una riga channel_revenue al giorno 15 di ogni mese indicato.
function revenue(channel: string, year: number, grossByMonth: Record<number, number>): ChannelRevenueMonthInput[] {
  return Object.entries(grossByMonth).map(([m, gross]) => ({
    channel,
    stayDate: `${year}-${String(Number(m)).padStart(2, "0")}-15`,
    revenueGross: gross,
  }));
}

function rates(channel: string, year: number, pctByMonth: Record<number, number>, source: "fattura" | "stima" = "fattura"): CommissionRateInput[] {
  return Object.entries(pctByMonth).map(([m, pct]) => ({
    channel,
    year,
    month: Number(m),
    pct,
    source,
    sourceReference: null,
  }));
}

const twelve = (value: number) => Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, value]));

describe("summarizeChannelCommissions — tariffa del proprio mese, mese per mese", () => {
  it("A. Booking.com 23% su tutti i mesi (Palazzo Rollo 2026): copertura completa, netto = lordo - commissione", () => {
    const gross = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 10000 + i * 1500]));
    const s = summarizeChannelCommissions(revenue("Booking.com", 2026, gross), rates("Booking.com", 2026, twelve(23))).get("Booking.com")!;
    const total = Object.values(gross).reduce((a, b) => a + b, 0);
    expect(s.coverage).toBe("full");
    expect(s.monthsCovered).toBe(12);
    expect(s.gross).toBe(total);
    expect(s.commission).toBeCloseTo(total * 0.23, 6);
    expect(s.gross - s.commission).toBeCloseTo(total * 0.77, 6);
    expect(s.effectivePct).toBeCloseTo(23, 10);
    expect(s.uncoveredGross).toBe(0);
  });

  it("B. Expedia con tariffa solo ago-nov (Palazzo Rollo 2026): copertura parziale, nessuna commissione sui mesi scoperti", () => {
    const gross = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 2000 + i * 100]));
    const s = summarizeChannelCommissions(
      revenue("Expedia", 2026, gross),
      rates("Expedia", 2026, { 8: 18, 9: 18, 10: 18, 11: 18 }, "stima")
    ).get("Expedia")!;
    const covered = gross[8] + gross[9] + gross[10] + gross[11];
    expect(s.coverage).toBe("partial");
    expect(s.monthsCovered).toBe(4);
    expect(s.monthsWithRevenue).toBe(12);
    expect(s.coveredGross).toBe(covered);
    expect(s.commission).toBeCloseTo(covered * 0.18, 6);
    expect(s.uncoveredGross).toBe(s.gross - covered);
    expect(s.effectivePct).toBeCloseTo(18, 10);
    expect(s.hasEstimate).toBe(true);
  });

  it("C. tariffa variabile tra mesi (Sangiorgio Booking 2026): somma dei calcoli mensili, non totale x una sola %", () => {
    const pct = { 1: 18, 2: 18, 3: 18, 4: 19.49, 5: 19.97, 6: 21.07, 7: 21.63 };
    const gross = { 1: 5000, 2: 6000, 3: 9000, 4: 15000, 5: 22000, 6: 30000, 7: 41000 };
    const s = summarizeChannelCommissions(revenue("Booking.com", 2026, gross), rates("Booking.com", 2026, pct)).get("Booking.com")!;
    const expected = Object.entries(gross).reduce((sum, [m, g]) => sum + g * (pct[Number(m) as keyof typeof pct] / 100), 0);
    const total = Object.values(gross).reduce((a, b) => a + b, 0);
    expect(s.commission).toBeCloseTo(expected, 6);
    expect(s.commission).not.toBeCloseTo(total * 0.18, 0); // prima tariffa
    expect(s.commission).not.toBeCloseTo(total * 0.2163, 0); // ultima tariffa
    expect(s.effectivePct).toBeCloseTo((expected / total) * 100, 10);
  });

  it("D. periodo di un solo mese: identico al calcolo precedente (lordo x % del mese)", () => {
    const s = summarizeChannelCommissions(revenue("Booking.com", 2026, { 9: 12345.67 }), rates("Booking.com", 2026, { 9: 23 })).get(
      "Booking.com"
    )!;
    expect(s.coverage).toBe("full");
    expect(s.commission).toBeCloseTo(12345.67 * 0.23, 8);
    expect(s.effectivePct).toBe(23);
  });

  it("E. intervallo a cavallo di due mesi: ogni quota usa la tariffa del proprio mese", () => {
    const rows: ChannelRevenueMonthInput[] = [
      { channel: "Expedia", stayDate: "2026-09-28", revenueGross: 300 },
      { channel: "Expedia", stayDate: "2026-09-30", revenueGross: 200 },
      { channel: "Expedia", stayDate: "2026-10-01", revenueGross: 400 },
    ];
    const s = summarizeChannelCommissions(rows, rates("Expedia", 2026, { 9: 18, 10: 23.9 })).get("Expedia")!;
    expect(s.commission).toBeCloseTo(500 * 0.18 + 400 * 0.239, 8);
    expect(s.monthsWithRevenue).toBe(2);
    expect(s.coverage).toBe("full");
  });

  it("F. nessuna tariffa per i mesi con revenue -> coverage 'none', nessuna commissione", () => {
    const s = summarizeChannelCommissions(
      revenue("Airbnb", 2026, { 1: 1000, 2: 2000 }),
      rates("Booking.com", 2026, { 1: 23, 2: 23 }) // tariffe di un altro canale
    ).get("Airbnb")!;
    expect(s.coverage).toBe("none");
    expect(s.commission).toBe(0);
    expect(s.effectivePct).toBeNull();
    expect(s.uncoveredGross).toBe(3000);
  });

  it("tariffa di un anno diverso non si applica (LY usa le proprie tariffe)", () => {
    const s = summarizeChannelCommissions(revenue("Expedia", 2025, { 8: 1000 }), rates("Expedia", 2026, { 8: 18 })).get("Expedia")!;
    expect(s.coverage).toBe("none");
  });

  it("mese con revenue netto zero non conta come mese da coprire", () => {
    const rows = [
      ...revenue("Expedia", 2026, { 8: 1000 }),
      { channel: "Expedia", stayDate: "2026-09-01", revenueGross: 100 },
      { channel: "Expedia", stayDate: "2026-09-02", revenueGross: -100 },
    ];
    const s = summarizeChannelCommissions(rows, rates("Expedia", 2026, { 8: 18 })).get("Expedia")!;
    expect(s.monthsWithRevenue).toBe(1);
    expect(s.coverage).toBe("full");
  });
});

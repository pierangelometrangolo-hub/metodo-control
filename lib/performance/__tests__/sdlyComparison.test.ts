import { describe, expect, it } from "vitest";
import { DailyRow, resolveProductionSdly, sdlyModeForPeriod } from "../sdlyComparison";
import { aggregateMonthlyAsofWithClosures, MonthAsofRow } from "../sdlyAnnual";
import { groupStructuresBySdlyCutoff, observationDateByStructure, sdlyCutoffFromRows } from "../sdlyCutoff";
import { computeLikeForLike } from "../likeForLike";
import { sumSnapshots } from "../../performanceMetrics";

const TODAY = "2026-10-06";

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Una riga per giorno di soggiorno, revenue costante: i totali attesi si
// leggono come "numero di giorni x revenue giornaliero".
function daily(start: string, end: string, revenue: number): DailyRow[] {
  const rows: DailyRow[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    rows.push({ stay_date: day, revenue_total: revenue, rooms_sold: 2, rooms_available: 10, arrivals: 1, presences: 4 });
  }
  return rows;
}

const year2026 = daily("2026-01-01", "2026-12-31", 100);
const year2025 = daily("2025-01-01", "2025-12-31", 80);

function production(periodStart: string, periodEnd: string, overrides: Partial<Parameters<typeof resolveProductionSdly>[0]> = {}) {
  return resolveProductionSdly({
    periodStart,
    periodEnd,
    observationDate: TODAY,
    currentRows: year2026,
    previousRows: year2025,
    closures: [],
    ...overrides,
  });
}

describe("sdlyModeForPeriod — tipo di confronto dal periodo", () => {
  it("periodo iniziato (passato, corrente, a cavallo di oggi) -> produzione maturata", () => {
    expect(sdlyModeForPeriod("2026-01-01", TODAY)).toBe("production");
    expect(sdlyModeForPeriod("2026-10-01", TODAY)).toBe("production");
    expect(sdlyModeForPeriod("2026-09-01", TODAY)).toBe("production");
    expect(sdlyModeForPeriod("2026-10-06", TODAY)).toBe("production");
  });

  it("periodo interamente futuro -> OTB as-of", () => {
    expect(sdlyModeForPeriod("2026-10-07", TODAY)).toBe("otb_asof");
    expect(sdlyModeForPeriod("2026-11-01", TODAY)).toBe("otb_asof");
    expect(sdlyModeForPeriod("2027-01-01", TODAY)).toBe("otb_asof");
  });
});

describe("resolveProductionSdly — produzione maturata vs stesso intervallo LY", () => {
  it("A. Tutto l'anno al 06/10: 01/01 -> 06/10 contro 01/01 -> 06/10 LY, non l'intero anno", () => {
    const r = production("2026-01-01", "2026-12-31");
    if (r.status !== "ok") throw new Error("unreachable");
    expect([r.currentStart, r.currentEnd]).toEqual(["2026-01-01", "2026-10-06"]);
    expect([r.previousStart, r.previousEnd]).toEqual(["2025-01-01", "2025-10-06"]);
    expect(r.daysExpected).toBe(279);
    expect(r.current?.revenue).toBe(279 * 100);
    expect(r.previous?.revenue).toBe(279 * 80);
    // L'OTB dell'intero anno (365 giorni) non e' il valore del confronto.
    expect(r.current?.revenue).not.toBe(sumSnapshots(year2026 as never).revenue);
  });

  it("B. Ottobre corrente al 06/10: 01/10 -> 06/10 contro 01/10 -> 06/10 LY", () => {
    const r = production("2026-10-01", "2026-10-31");
    if (r.status !== "ok") throw new Error("unreachable");
    expect([r.currentStart, r.currentEnd]).toEqual(["2026-10-01", "2026-10-06"]);
    expect([r.previousStart, r.previousEnd]).toEqual(["2025-10-01", "2025-10-06"]);
    expect(r.current?.revenue).toBe(6 * 100);
    expect(r.previous?.revenue).toBe(6 * 80);
  });

  it("C. Settembre passato: mese intero contro mese intero LY", () => {
    const r = production("2026-09-01", "2026-09-30");
    if (r.status !== "ok") throw new Error("unreachable");
    expect([r.currentStart, r.currentEnd]).toEqual(["2026-09-01", "2026-09-30"]);
    expect([r.previousStart, r.previousEnd]).toEqual(["2025-09-01", "2025-09-30"]);
    expect(r.current?.revenue).toBe(30 * 100);
    expect(r.previous?.revenue).toBe(30 * 80);
  });

  it("E. intervallo personalizzato interamente passato: intero intervallo", () => {
    const r = production("2026-08-10", "2026-09-20");
    if (r.status !== "ok") throw new Error("unreachable");
    expect([r.currentStart, r.currentEnd]).toEqual(["2026-08-10", "2026-09-20"]);
    expect([r.previousStart, r.previousEnd]).toEqual(["2025-08-10", "2025-09-20"]);
    expect(r.current?.revenue).toBe(42 * 100);
    expect(r.previous?.revenue).toBe(42 * 80);
  });

  it("F. intervallo che attraversa la data corrente: solo la parte maturata, da entrambi i lati", () => {
    const r = production("2026-09-15", "2026-10-20");
    if (r.status !== "ok") throw new Error("unreachable");
    expect([r.currentStart, r.currentEnd]).toEqual(["2026-09-15", "2026-10-06"]);
    expect([r.previousStart, r.previousEnd]).toEqual(["2025-09-15", "2025-10-06"]);
    expect(r.current?.revenue).toBe(22 * 100);
    expect(r.previous?.revenue).toBe(22 * 80);
  });

  it("data di osservazione della struttura, non oggi: snapshot al 30/09 -> anno maturato fino al 30/09", () => {
    const r = production("2026-01-01", "2026-12-31", { observationDate: "2026-09-30" });
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.currentEnd).toBe("2026-09-30");
    expect(r.previousEnd).toBe("2025-09-30");
  });

  it("snapshot precedente all'inizio del periodo (o assente) -> nessuna produzione maturata, mai zero inventato", () => {
    expect(production("2026-10-01", "2026-10-31", { observationDate: "2026-09-30" })).toEqual({ status: "no_matured" });
    expect(production("2026-10-01", "2026-10-31", { observationDate: null })).toEqual({ status: "no_matured" });
  });

  it("giorno LY mancante non giustificato -> ND, nessuna somma parziale", () => {
    const withHole = year2025.filter((r) => r.stay_date !== "2025-10-03");
    const r = production("2026-10-01", "2026-10-31", { previousRows: withHole });
    expect(r).toMatchObject({ status: "partial", previous: null, daysCovered: 5, daysExpected: 6 });
    expect(production("2026-10-01", "2026-10-31", { previousRows: [] })).toMatchObject({ status: "none", previous: null });
  });
});

describe("H. stagionalita' (structure_closures) sulla sola porzione confrontata", () => {
  // Operativa mag-nov come Montecallini; gen-apr e dic dichiarati chiusi.
  const seasonal2025 = daily("2025-05-01", "2025-11-30", 80);
  const seasonal2026 = daily("2026-05-01", "2026-11-30", 100);
  const closures = [
    { start_date: "2025-01-01", end_date: "2025-04-30" },
    { start_date: "2025-12-01", end_date: "2025-12-31" },
  ];

  it("YTD: gen-apr chiusi = 0, mag -> data osservata = dati; nov-dic fuori dal confronto", () => {
    const r = production("2026-01-01", "2026-12-31", { currentRows: seasonal2026, previousRows: seasonal2025, closures });
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.closedDays).toBe(120);
    expect(r.daysExpected).toBe(279);
    expect(r.previous?.revenue).toBe(159 * 80);
    expect(r.current?.revenue).toBe(159 * 100);
    expect(r.previous?.roomsAvailable).toBe(159 * 10);
  });

  it("senza chiusure dichiarate l'assenza di dato non diventa zero -> ND", () => {
    const r = production("2026-01-01", "2026-12-31", { currentRows: seasonal2026, previousRows: seasonal2025 });
    expect(r).toMatchObject({ status: "partial", previous: null, daysCovered: 159, daysExpected: 279 });
  });

  it("dato reale prevale sempre sulla chiusura dichiarata", () => {
    const wholeYearClosed = [{ start_date: "2025-01-01", end_date: "2025-12-31" }];
    const r = production("2026-01-01", "2026-12-31", {
      currentRows: seasonal2026,
      previousRows: seasonal2025,
      closures: wholeYearClosed,
    });
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.previous?.revenue).toBe(159 * 80);
    expect(r.closedDays).toBe(120);
  });

  it("periodo interamente dentro una chiusura dichiarata: 0 contro 0, confronto valido", () => {
    const r = production("2026-02-01", "2026-02-28", { currentRows: seasonal2026, previousRows: seasonal2025, closures });
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.previous?.revenue).toBe(0);
    expect(r.current).toBeNull();
  });
});

describe("D. mese futuro: OTB as-of, non produzione", () => {
  const month = (revenue: number): MonthAsofRow => ({
    revenue_total: revenue,
    rooms_sold: 10,
    rooms_available: 300,
    arrivals: 5,
    presences: 20,
  });

  it("novembre osservato il 06/10/2026 contro novembre 2025 osservato al 06/10/2025", () => {
    expect(sdlyModeForPeriod("2026-11-01", TODAY)).toBe("otb_asof");
    // Cutoff dalla extraction_date delle righe di novembre, per struttura.
    expect(sdlyCutoffFromRows([{ extraction_date: "2026-10-06" }]).cutoff).toBe("2025-10-06");
    // Valore corrente = OTB dell'intero mese (righe future incluse), non 0.
    const otbNovember = sumSnapshots(daily("2026-11-01", "2026-11-30", 50) as never).revenue;
    expect(otbNovember).toBe(1500);
    const { result } = aggregateMonthlyAsofWithClosures([month(1200)], [11], 2025, []);
    expect(result.agg?.revenue).toBe(1200);
  });

  it("OTB as-of non disponibile alla stessa data -> ND", () => {
    expect(aggregateMonthlyAsofWithClosures([null], [11], 2025, []).result.coverage).toBe("none");
  });
});

describe("G. Vista d'insieme e Dettaglio struttura: stessi risultati", () => {
  it("stessa data di osservazione e stesso confronto dalle stesse righe", () => {
    const rollo = year2026.map((r) => ({ ...r, structure_id: "rollo", extraction_date: "2026-10-06" }));
    const stale = year2026
      .filter((r) => r.stay_date <= "2026-11-30")
      .map((r) => ({ ...r, structure_id: "montecallini", extraction_date: "2026-09-30" }));

    // Vista d'insieme: righe di tutte le strutture.
    const overviewObservation = observationDateByStructure([...rollo, ...stale]);
    expect(Array.from(groupStructuresBySdlyCutoff(overviewObservation).keys()).sort()).toEqual([
      "2025-09-30",
      "2025-10-06",
    ]);

    for (const [id, rows] of [
      ["rollo", rollo],
      ["montecallini", stale],
    ] as const) {
      // Dettaglio: sole righe della struttura.
      const detailObservation = sdlyCutoffFromRows(rows).observationDate;
      expect(detailObservation).toBe(overviewObservation.get(id));
      const args = { periodStart: "2026-01-01", periodEnd: "2026-12-31", currentRows: rows, previousRows: year2025, closures: [] };
      expect(resolveProductionSdly({ ...args, observationDate: detailObservation })).toEqual(
        resolveProductionSdly({ ...args, observationDate: overviewObservation.get(id) ?? null })
      );
    }
  });

  it("L4L: entra nel totale chi ha copertura valida sull'intervallo confrontato, senza richiedere 12/12", () => {
    const seasonal = production("2026-01-01", "2026-12-31", {
      currentRows: daily("2026-05-01", "2026-11-30", 100),
      previousRows: daily("2025-05-01", "2025-11-30", 80),
      closures: [{ start_date: "2025-01-01", end_date: "2025-04-30" }],
    });
    const full = production("2026-01-01", "2026-12-31");
    const noHistory = production("2026-01-01", "2026-12-31", { previousRows: [] });
    const value = (r: ReturnType<typeof production>, side: "current" | "previous") =>
      r.status === "no_matured" ? null : (r[side]?.revenue ?? null);
    const l4l = computeLikeForLike(
      [
        { id: "seasonal", name: "Seasonal", actual: value(seasonal, "current"), reference: value(seasonal, "previous") },
        { id: "full", name: "Full", actual: value(full, "current"), reference: value(full, "previous") },
        { id: "new", name: "New", actual: value(noHistory, "current"), reference: value(noHistory, "previous") },
      ],
      ["seasonal", "full", "new"].map((id) => ({ structure_id: id, valid_from: null, valid_to: null })),
      2026,
      2025
    );
    expect(l4l.included.map((s) => s.id)).toEqual(["seasonal", "full"]);
    expect(l4l.actual).toBe(159 * 100 + 279 * 100);
    expect(l4l.reference).toBe(159 * 80 + 279 * 80);
  });
});

describe("I. OTB vs Consuntivo LY: nessuna regressione", () => {
  it("resta OTB dell'intero periodo contro consuntivo dell'intero periodo LY, indipendente dallo SDLY", () => {
    const otbYear = sumSnapshots(year2026 as never).revenue;
    const consuntivoYear = sumSnapshots(year2025 as never).revenue;
    expect(otbYear).toBe(365 * 100);
    expect(consuntivoYear).toBe(365 * 80);
    const l4l = computeLikeForLike(
      [{ id: "a", name: "A", actual: otbYear, reference: consuntivoYear }],
      [{ structure_id: "a", valid_from: null, valid_to: null }],
      2026,
      2025
    );
    expect(l4l.actual).toBe(36500);
    expect(l4l.reference).toBe(29200);
    expect(l4l.variancePct).toBeCloseTo(0.25, 8);
  });
});

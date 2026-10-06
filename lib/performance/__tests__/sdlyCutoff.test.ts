import { describe, expect, it } from "vitest";
import { groupStructuresBySdlyCutoff, observationDateByStructure, sdlyCutoffFromRows } from "../sdlyCutoff";
import {
  aggregateMonthlyAsof,
  aggregateMonthlyAsofWithClosures,
  applySeasonalClosures,
  isMonthFullyClosed,
  MonthAsofRow,
} from "../sdlyAnnual";
import { computeLikeForLike } from "../likeForLike";

describe("observationDateByStructure — data di osservazione dell'OTB corrente", () => {
  it("prende la extraction_date piu' recente tra le righe di ciascuna struttura", () => {
    const dates = observationDateByStructure([
      { structure_id: "rollo", extraction_date: "2026-10-06" },
      { structure_id: "montecallini", extraction_date: "2026-08-19" },
      { structure_id: "montecallini", extraction_date: "2026-09-30" },
      { structure_id: "montecallini", extraction_date: "2026-09-24" },
    ]);
    expect(dates.get("rollo")).toBe("2026-10-06");
    expect(dates.get("montecallini")).toBe("2026-09-30");
  });

  it("struttura senza righe o senza extraction_date -> assente, nessuna data inventata", () => {
    const dates = observationDateByStructure([{ structure_id: "a", extraction_date: null }]);
    expect(dates.has("a")).toBe(false);
    expect(dates.has("b")).toBe(false);
  });
});

describe("groupStructuresBySdlyCutoff — cutoff = data di osservazione - 1 anno", () => {
  it("cutoff per struttura, non 'oggi - 1 anno'", () => {
    const groups = groupStructuresBySdlyCutoff(
      new Map([
        ["rollo", "2026-10-06"],
        ["neviera", "2026-10-06"],
        ["montecallini", "2026-09-30"],
      ])
    );
    expect(groups.get("2025-10-06")).toEqual(["rollo", "neviera"]);
    expect(groups.get("2025-09-30")).toEqual(["montecallini"]);
    expect(groups.size).toBe(2);
  });
});

describe("SDLY annuale Vista d'insieme — stessa regola di copertura del dettaglio", () => {
  const month = (revenue: number): MonthAsofRow => ({
    revenue_total: revenue,
    rooms_sold: 10,
    rooms_available: 20,
    arrivals: 5,
    presences: 12,
  });
  const memberships = ["full", "seasonal"].map((id) => ({ structure_id: id, valid_from: null, valid_to: null }));

  it("12/12 mesi -> totale annuale; copertura parziale -> ND, mai somma parziale", () => {
    const full = aggregateMonthlyAsof(Array.from({ length: 12 }, () => month(1000)));
    const seasonal = aggregateMonthlyAsof(Array.from({ length: 12 }, (_, i) => (i >= 4 && i <= 10 ? month(1000) : null)));
    expect(full.coverage).toBe("full");
    expect(full.agg?.revenue).toBe(12000);
    expect(seasonal).toEqual({ coverage: "partial", agg: null, monthsCovered: 7, monthsExpected: 12 });
  });

  it("struttura con SDLY annuale incompleto esce dal L4L: popolazione, actual e reference", () => {
    const seasonal = aggregateMonthlyAsof(Array.from({ length: 12 }, (_, i) => (i >= 4 && i <= 10 ? month(1000) : null)));
    const l4l = computeLikeForLike(
      [
        { id: "full", name: "Full", actual: 15000, reference: 12000 },
        { id: "seasonal", name: "Seasonal", actual: 9000, reference: seasonal.agg?.revenue ?? null },
      ],
      memberships,
      2026,
      2025
    );
    expect(l4l.included.map((s) => s.id)).toEqual(["full"]);
    expect(l4l.excluded).toEqual([{ id: "seasonal", name: "Seasonal", reasons: ["missing_reference_data"] }]);
    expect(l4l.actual).toBe(15000);
    expect(l4l.reference).toBe(12000);
    expect(l4l.variancePct).toBeCloseTo(0.25, 8);
  });

  it("mese singolo: stessa funzione, presente -> valore, assente -> ND", () => {
    expect(aggregateMonthlyAsof([month(500)]).agg?.revenue).toBe(500);
    expect(aggregateMonthlyAsof([null]).coverage).toBe("none");
  });
});

describe("applySeasonalClosures — mesi di chiusura stagionale dichiarati valgono 0", () => {
  const month = (revenue: number): MonthAsofRow => ({
    revenue_total: revenue,
    rooms_sold: 10,
    rooms_available: 20,
    arrivals: 5,
    presences: 12,
  });
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  // Operativa mag-nov, come Montecallini.
  const seasonalData = months.map((m) => (m >= 5 && m <= 11 ? month(1000) : null));
  const winterClosures = [
    { start_date: "2025-01-01", end_date: "2025-04-30" },
    { start_date: "2025-12-01", end_date: "2025-12-31" },
  ];

  it("chiusure dichiarate su gen-apr e dic -> quei mesi valgono 0, copertura completa, solo revenue reale", () => {
    const filled = applySeasonalClosures(seasonalData, months, 2025, winterClosures);
    expect(filled.closedMonths).toEqual([1, 2, 3, 4, 12]);
    const annual = aggregateMonthlyAsof(filled.monthResults);
    expect(annual.coverage).toBe("full");
    expect(annual.agg?.revenue).toBe(7000);
    expect(annual.agg?.roomsAvailable).toBe(7 * 20);
  });

  it("nessuna chiusura dichiarata -> assenza di snapshot NON diventa zero, resta ND", () => {
    const filled = applySeasonalClosures(seasonalData, months, 2025, []);
    expect(filled.closedMonths).toEqual([]);
    expect(aggregateMonthlyAsof(filled.monthResults).coverage).toBe("partial");
  });

  it("mese senza dato chiuso solo in parte -> resta mancante, copertura parziale", () => {
    const filled = applySeasonalClosures(seasonalData, months, 2025, [
      { start_date: "2025-01-01", end_date: "2025-04-15" },
      { start_date: "2025-12-01", end_date: "2025-12-31" },
    ]);
    expect(filled.closedMonths).toEqual([1, 2, 3, 12]);
    expect(aggregateMonthlyAsof(filled.monthResults)).toMatchObject({ coverage: "partial", monthsCovered: 11 });
  });

  it("chiusure di un altro anno non contano", () => {
    const filled = applySeasonalClosures(
      seasonalData,
      months,
      2025,
      winterClosures.map((c) => ({ start_date: c.start_date.replace("2025", "2026"), end_date: c.end_date.replace("2025", "2026") }))
    );
    expect(filled.closedMonths).toEqual([]);
  });

  it("mese con dato reale resta reale anche se dichiarato chiuso", () => {
    const filled = applySeasonalClosures([month(500)], [5], 2025, [{ start_date: "2025-05-01", end_date: "2025-05-31" }]);
    expect(filled.closedMonths).toEqual([]);
    expect(filled.monthResults[0]?.revenue_total).toBe(500);
  });

  it("mese chiuso coperto da intervalli contigui e febbraio di 28 giorni", () => {
    expect(
      isMonthFullyClosed(
        [
          { start_date: "2025-01-20", end_date: "2025-02-10" },
          { start_date: "2025-02-11", end_date: "2025-02-28" },
        ],
        2025,
        2
      )
    ).toBe(true);
    expect(isMonthFullyClosed([{ start_date: "2025-02-01", end_date: "2025-02-27" }], 2025, 2)).toBe(false);
  });
});

// Dettaglio struttura e Vista d'insieme passano dalle stesse due funzioni
// (sdlyCutoffFromRows / observationDateByStructure per il cutoff,
// aggregateMonthlyAsofWithClosures per il totale): qui il caso Montecallini
// con i valori mensili reali 2025 al cutoff 30/09/2025.
describe("SDLY annuale Dettaglio struttura — stessa semantica della Vista d'insieme", () => {
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const row = (revenue: number, sold: number, available: number): MonthAsofRow => ({
    revenue_total: revenue,
    rooms_sold: sold,
    rooms_available: available,
    arrivals: 0,
    presences: 0,
  });
  // gen-apr e dic senza snapshot; novembre ha una riga reale a 0 EUR.
  const montecallini2025: (MonthAsofRow | null)[] = [
    null,
    null,
    null,
    null,
    row(1996.73, 13, 1327),
    row(123196.14, 761, 1238),
    row(176979.13, 905, 1329),
    row(214442.53, 874, 1333),
    row(145036.52, 941, 1248),
    row(23406.96, 171, 860),
    row(0, 0, 1410),
    null,
  ];
  const declaredClosures = [
    { start_date: "2025-01-01", end_date: "2025-04-30" },
    { start_date: "2025-12-01", end_date: "2025-12-31" },
  ];
  const otb2026 = 777454;

  it("cutoff dal snapshot corrente della struttura: 30/09/2026 -> 30/09/2025, non oggi - 1 anno", () => {
    const rows = [
      { extraction_date: "2026-08-19" },
      { extraction_date: "2026-09-30" },
      { extraction_date: "2026-09-24" },
    ];
    expect(sdlyCutoffFromRows(rows)).toEqual({ observationDate: "2026-09-30", cutoff: "2025-09-30" });
  });

  it("nessuna riga nel periodo corrente -> nessuna data di osservazione", () => {
    expect(sdlyCutoffFromRows([])).toEqual({ observationDate: null, cutoff: null });
  });

  it("annuale con mesi chiusi dichiarati -> totale disponibile, mesi chiusi a 0", () => {
    const { result, closedMonths } = aggregateMonthlyAsofWithClosures(montecallini2025, months, 2025, declaredClosures);
    expect(closedMonths).toEqual([1, 2, 3, 4, 12]);
    expect(result.coverage).toBe("full");
    expect(result.agg?.revenue).toBeCloseTo(685058.01, 2);
    // Nessuna camera disponibile inventata nei mesi chiusi.
    expect(result.agg?.roomsAvailable).toBe(1327 + 1238 + 1329 + 1333 + 1248 + 860 + 1410);
    expect((otb2026 - result.agg!.revenue) / result.agg!.revenue).toBeCloseTo(0.135, 3);
  });

  it("annuale con mese mancante non coperto da chiusura -> ND", () => {
    // Dicembre non dichiarato: 11/12, nessun totale.
    const { result, closedMonths } = aggregateMonthlyAsofWithClosures(montecallini2025, months, 2025, [
      declaredClosures[0],
    ]);
    expect(closedMonths).toEqual([1, 2, 3, 4]);
    expect(result).toEqual({ coverage: "partial", agg: null, monthsCovered: 11, monthsExpected: 12 });
    // Nessuna chiusura registrata (stato attuale del registro): 7/12, ND.
    expect(aggregateMonthlyAsofWithClosures(montecallini2025, months, 2025, []).result).toMatchObject({
      coverage: "partial",
      monthsCovered: 7,
    });
  });

  it("dato reale prevale sempre sulla chiusura dichiarata", () => {
    const wholeYearClosed = [{ start_date: "2025-01-01", end_date: "2025-12-31" }];
    const { result, closedMonths } = aggregateMonthlyAsofWithClosures(montecallini2025, months, 2025, wholeYearClosed);
    expect(closedMonths).toEqual([1, 2, 3, 4, 12]);
    expect(result.agg?.revenue).toBeCloseTo(685058.01, 2);
  });

  it("coerenza Vista d'insieme / Dettaglio per Montecallini: stesso cutoff, stesso SDLY, stessa variazione", () => {
    // Vista d'insieme: righe multi-struttura, cutoff per struttura.
    const overviewCutoffs = groupStructuresBySdlyCutoff(
      observationDateByStructure([
        { structure_id: "montecallini", extraction_date: "2026-09-24" },
        { structure_id: "montecallini", extraction_date: "2026-09-30" },
        { structure_id: "rollo", extraction_date: "2026-10-06" },
      ])
    );
    const overviewCutoff = Array.from(overviewCutoffs).find(([, ids]) => ids.includes("montecallini"))?.[0];
    // Dettaglio: sole righe della struttura.
    const detailCutoff = sdlyCutoffFromRows([{ extraction_date: "2026-09-24" }, { extraction_date: "2026-09-30" }]).cutoff;
    expect(detailCutoff).toBe("2025-09-30");
    expect(overviewCutoff).toBe(detailCutoff);

    const overview = aggregateMonthlyAsofWithClosures(montecallini2025, months, 2025, declaredClosures);
    const detail = aggregateMonthlyAsofWithClosures(montecallini2025, months, 2025, declaredClosures);
    expect(detail).toEqual(overview);

    // Con Montecallini inclusa il totale L4L torna a 4 strutture.
    const l4l = computeLikeForLike(
      [
        { id: "montecallini", name: "Montecallini", actual: otb2026, reference: overview.result.agg?.revenue ?? null },
        { id: "arco", name: "Palazzo Arco Cadura", actual: 190703, reference: 174366 },
        { id: "rollo", name: "Palazzo Rollo", actual: 497977, reference: 452930 },
        { id: "neviera", name: "Villa Neviera", actual: 163035, reference: 121500 },
        { id: "dimora", name: "Dimora De Belli", actual: 83814, reference: null },
        { id: "sangiorgio", name: "Sangiorgio Resort", actual: 380055, reference: null },
      ],
      ["montecallini", "arco", "rollo", "neviera"].map((id) => ({ structure_id: id, valid_from: null, valid_to: null })),
      2026,
      2025
    );
    expect(l4l.included).toHaveLength(4);
    expect(l4l.actual).toBe(1629169);
    expect(Math.round(l4l.reference as number)).toBe(1433854);
    expect(l4l.variancePct).toBeCloseTo(0.136, 3);
  });
});

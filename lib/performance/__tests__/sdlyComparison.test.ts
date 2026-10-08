import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  AsofDailyRow,
  DailyRow,
  resolveSdlyAsOfComparison,
  sdlyAsofPlan,
  sdlyPhotoSentence,
  SdlyReferenceSnapshot,
} from "../sdlyComparison";
import { ClosureRange, MonthAsofRow } from "../sdlyAnnual";
import { groupStructuresBySdlyCutoff, observationDateByStructure, sdlyCutoffFromRows, sdlyTargetDate } from "../sdlyCutoff";
import { computeLikeForLike } from "../likeForLike";
import { aggregatePortfolioPerformance } from "../portfolio";
import { sumSnapshots } from "../../performanceMetrics";

// SDLY = intero periodo nella fotografia corrente vs intero stesso periodo
// dell'anno precedente nella fotografia alla stessa data relativa. Mai un
// taglio delle stay_date alla data di osservazione.

const OBSERVATION = "2026-10-06";

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Una riga per giorno di soggiorno, revenue costante: i totali attesi si
// leggono come "numero di giorni x revenue giornaliero".
function daily(start: string, end: string, revenue: number, extractionDate: string | null = OBSERVATION): AsofDailyRow[] {
  const rows: AsofDailyRow[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    rows.push({
      stay_date: day,
      extraction_date: extractionDate,
      revenue_total: revenue,
      rooms_sold: 2,
      rooms_available: 10,
      arrivals: 1,
      presences: 4,
    });
  }
  return rows;
}

const month = (revenue: number): MonthAsofRow => ({
  revenue_total: revenue,
  rooms_sold: 10,
  rooms_available: 300,
  arrivals: 5,
  presences: 20,
});

const year2026 = daily("2026-01-01", "2026-12-31", 100);

function resolve(
  periodStart: string,
  periodEnd: string,
  reference: SdlyReferenceSnapshot | null,
  overrides: { currentRows?: DailyRow[]; observationDate?: string | null; closures?: ClosureRange[] } = {}
) {
  return resolveSdlyAsOfComparison({
    periodStart,
    periodEnd,
    currentRows: overrides.currentRows ?? year2026,
    observationDate: overrides.observationDate === undefined ? OBSERVATION : overrides.observationDate,
    reference,
    closures: overrides.closures ?? [],
  });
}

describe("sdlyAsofPlan — come leggere la fotografia LY", () => {
  it("mese intero, anno intero e piu' mesi interi -> una fotografia mensile per mese LY", () => {
    expect(sdlyAsofPlan("2026-10-01", "2026-10-31")).toEqual({
      kind: "months",
      lyStart: "2025-10-01",
      lyEnd: "2025-10-31",
      months: [{ year: 2025, month: 10 }],
    });
    const yearPlan = sdlyAsofPlan("2026-01-01", "2026-12-31");
    expect(yearPlan.kind).toBe("months");
    expect(yearPlan.kind === "months" && yearPlan.months).toHaveLength(12);
    expect(yearPlan.lyStart).toBe("2025-01-01");
    expect(yearPlan.lyEnd).toBe("2025-12-31");
    const season = sdlyAsofPlan("2026-11-01", "2027-02-28");
    expect(season.kind === "months" && season.months).toEqual([
      { year: 2025, month: 11 },
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
    ]);
  });

  it("intervallo personalizzato -> fotografia giornaliera sull'intero intervallo LY, non tagliato", () => {
    expect(sdlyAsofPlan("2026-09-15", "2026-10-20")).toEqual({ kind: "days", lyStart: "2025-09-15", lyEnd: "2025-10-20" });
  });

  it("anno bisestile: Febbraio 2024 -> Febbraio 2023 di calendario, 29/02 mai spostato al 01/03", () => {
    expect(sdlyAsofPlan("2024-02-01", "2024-02-29")).toMatchObject({ kind: "months", lyStart: "2023-02-01", lyEnd: "2023-02-28" });
    expect(sdlyAsofPlan("2025-02-01", "2025-02-28")).toMatchObject({ lyStart: "2024-02-01", lyEnd: "2024-02-29" });
    expect(sdlyAsofPlan("2024-02-10", "2024-02-29")).toEqual({ kind: "days", lyStart: "2023-02-10", lyEnd: "2023-02-28" });
  });
});

describe("sdlyTargetDate — data target della fotografia LY", () => {
  it("stessa data dell'anno precedente", () => {
    expect(sdlyTargetDate("2026-10-06")).toBe("2025-10-06");
    expect(sdlyTargetDate("2026-01-01")).toBe("2025-01-01");
  });

  it("29/02 -> 28/02, mai 01/03: nessuna estrazione successiva alla stessa data relativa", () => {
    expect(sdlyTargetDate("2024-02-29")).toBe("2023-02-28");
    expect(sdlyCutoffFromRows([{ extraction_date: "2024-02-29" }]).cutoff).toBe("2023-02-28");
    expect(Array.from(groupStructuresBySdlyCutoff(new Map([["s", "2024-02-29"]])).keys())).toEqual(["2023-02-28"]);
  });
});

describe("A. singolo mese — mai tagliato alla data di osservazione", () => {
  it("mese in corso: intero ottobre nella fotografia corrente vs intero ottobre LY nella fotografia same-day", () => {
    const c = resolve("2026-10-01", "2026-10-31", { kind: "months", rows: [month(2000)] });
    expect(c.status).toBe("ok");
    // 31 giorni, non i soli 6 giorni maturati.
    expect(c.current?.revenue).toBe(3100);
    expect(c.current?.revenue).not.toBe(600);
    expect(c.reference?.revenue).toBe(2000);
    expect(c.delta).toBeCloseTo(0.55);
    expect(c.observationDate).toBe("2026-10-06");
    expect(c.targetDate).toBe("2025-10-06");
    expect(c.lyStart).toBe("2025-10-01");
    expect(c.lyEnd).toBe("2025-10-31");
  });

  it("mese passato: resta fotografia vs fotografia, non finale vs finale", () => {
    const c = resolve("2026-09-01", "2026-09-30", { kind: "months", rows: [month(2900)] });
    expect(c.current?.revenue).toBe(3000);
    expect(c.reference?.revenue).toBe(2900);
    expect(c.targetDate).toBe("2025-10-06");
  });

  it("mese futuro: stessa identica regola", () => {
    const c = resolve("2026-11-01", "2026-11-30", { kind: "months", rows: [month(1500)] });
    expect(c.current?.revenue).toBe(3000);
    expect(c.reference?.revenue).toBe(1500);
    expect(c.delta).toBeCloseTo(1);
  });

  it("riporta tutti i KPI della fotografia LY, non solo il revenue", () => {
    const c = resolve("2026-10-01", "2026-10-31", { kind: "months", rows: [month(2000)] });
    expect(c.reference).toEqual({ revenue: 2000, roomsSold: 10, roomsAvailable: 300, arrivals: 5, presences: 20 });
    expect(c.current).toEqual({ revenue: 3100, roomsSold: 62, roomsAvailable: 310, arrivals: 31, presences: 124 });
  });
});

describe("B. intervallo personalizzato", () => {
  it("intero 15/09 -> 20/10 nella fotografia corrente vs intero 15/09 -> 20/10 LY nella fotografia same-day", () => {
    const c = resolve("2026-09-15", "2026-10-20", {
      kind: "days",
      rows: daily("2025-09-15", "2025-10-20", 80, "2025-10-06"),
    });
    expect(c.status).toBe("ok");
    expect(c.current?.revenue).toBe(36 * 100);
    expect(c.reference?.revenue).toBe(36 * 80);
    expect(c.covered).toBe(36);
    expect(c.expected).toBe(36);
  });

  it("fotografia giornaliera incompleta -> ND, mai somma parziale", () => {
    const c = resolve("2026-09-15", "2026-10-20", {
      kind: "days",
      rows: daily("2025-09-15", "2025-10-10", 80, "2025-10-06"),
    });
    expect(c.status).toBe("partial_snapshot");
    expect(c.reference).toBeNull();
    expect(c.delta).toBeNull();
    expect(c.unavailableReason).toBe("fotografia 2025 al 06/10/2025 incompleta: 26/36 giorni");
  });
});

describe("C. anno — intero anno, non 01/01 -> data di osservazione", () => {
  const ly = { kind: "months" as const, rows: Array.from({ length: 12 }, () => month(2000)) };

  it("include mesi passati, mese in corso e mesi futuri gia' OTB", () => {
    const c = resolve("2026-01-01", "2026-12-31", ly);
    expect(c.current?.revenue).toBe(365 * 100);
    // Non la produzione 01/01 -> 06/10 (279 giorni).
    expect(c.current?.revenue).not.toBe(279 * 100);
    expect(c.reference?.revenue).toBe(24000);
    expect(c.covered).toBe(12);
    expect(c.lyStart).toBe("2025-01-01");
    expect(c.lyEnd).toBe("2025-12-31");
  });

  it("anche un solo mese LY senza fotografia -> ND annuale", () => {
    const rows = [...ly.rows];
    rows[6] = null as unknown as MonthAsofRow;
    const c = resolve("2026-01-01", "2026-12-31", { kind: "months", rows });
    expect(c.status).toBe("partial_snapshot");
    expect(c.reference).toBeNull();
    expect(c.unavailableReason).toBe("fotografia 2025 al 06/10/2025 incompleta: 11/12 mesi");
  });
});

describe("regola as-of della fotografia LY", () => {
  it("fotografia esatta alla stessa data", () => {
    const c = resolve("2026-09-15", "2026-10-20", { kind: "days", rows: daily("2025-09-15", "2025-10-20", 80, "2025-10-06") });
    expect(c.referenceExtraction).toEqual({ from: "2025-10-06", to: "2025-10-06" });
  });

  it("fallback: ultima fotografia precedente alla data target", () => {
    const c = resolve("2026-09-15", "2026-10-20", { kind: "days", rows: daily("2025-09-15", "2025-10-20", 80, "2025-09-30") });
    expect(c.status).toBe("ok");
    expect(c.targetDate).toBe("2025-10-06");
    expect(c.referenceExtraction).toEqual({ from: "2025-09-30", to: "2025-09-30" });
  });

  it("nessuna fotografia <= target -> ND", () => {
    expect(resolve("2026-09-15", "2026-10-20", { kind: "days", rows: [] }).status).toBe("no_snapshot");
    const monthly = resolve("2026-10-01", "2026-10-31", { kind: "months", rows: [null] });
    expect(monthly.status).toBe("no_snapshot");
    expect(monthly.reference).toBeNull();
    expect(monthly.unavailableReason).toBe("nessuna fotografia 2025 disponibile al 06/10/2025");
    expect(resolve("2026-10-01", "2026-10-31", null).status).toBe("no_snapshot");
  });

  it("una fotografia successiva alla data target non viene mai usata (nessun look-ahead)", () => {
    // Storico caricato solo a consuntivo, estratto dopo la data target.
    const c = resolve("2026-09-15", "2026-10-20", { kind: "days", rows: daily("2025-09-15", "2025-10-20", 80, "2026-01-01") });
    expect(c.status).toBe("no_snapshot");
    expect(c.reference).toBeNull();
    // Mista: i giorni con estrazione successiva sono scartati -> incompleta.
    const mixed = resolve("2026-09-15", "2026-10-20", {
      kind: "days",
      rows: [...daily("2025-09-15", "2025-09-30", 80, "2025-10-01"), ...daily("2025-10-01", "2025-10-20", 80, "2025-10-07")],
    });
    expect(mixed.status).toBe("partial_snapshot");
    expect(mixed.reference).toBeNull();
  });

  it("le RPC as-of prendono l'ultima estrazione <= cutoff, mai una successiva (contratto SQL)", () => {
    const dir = path.resolve(__dirname, "../../../supabase/migrations");
    const dailyFn = fs.readFileSync(path.join(dir, "20260810120000_fn_snapshot_asof.sql"), "utf8");
    const monthlyFn = fs.readFileSync(path.join(dir, "20260817110000_fix_fn_month_snapshot_asof_daily_priority.sql"), "utf8");
    expect(dailyFn).toContain("pds.extraction_date <= p_cutoff_date");
    expect(dailyFn).toContain("order by pds.structure_id, pds.stay_date, pds.extraction_date desc");
    expect(monthlyFn).toContain("pms.extraction_date <= p_cutoff_date");
    expect(monthlyFn).toContain("pds.extraction_date <= p_cutoff_date");
    expect(monthlyFn).toContain("order by pms.structure_id, pms.extraction_date desc");
    expect(monthlyFn).not.toMatch(/extraction_date\s*>=?\s*p_cutoff_date/);
  });
});

describe("data di osservazione unica dell'analisi", () => {
  it("la data la decide il chiamante (ultima estrazione della struttura), non le righe del periodo", () => {
    // Novembre aggiornato l'ultima volta il 24/09, struttura osservata al 06/10:
    // il target LY resta 06/10/2025, come per ogni altro mese.
    const november = daily("2026-11-01", "2026-11-30", 100, "2026-09-24");
    const c = resolve("2026-11-01", "2026-11-30", { kind: "months", rows: [month(1500)] }, { currentRows: november });
    expect(c.observationDate).toBe("2026-10-06");
    expect(c.targetDate).toBe("2025-10-06");
    expect(c.current?.revenue).toBe(3000);
  });
});

describe("data della fotografia corrente", () => {
  it("e' quella dello snapshot della struttura, non oggi: snapshot al 30/09 -> target 30/09 LY", () => {
    const rows = daily("2026-10-01", "2026-10-31", 100, "2026-09-30");
    const { observationDate, cutoff } = sdlyCutoffFromRows(rows as { extraction_date: string | null }[]);
    expect(observationDate).toBe("2026-09-30");
    expect(cutoff).toBe("2025-09-30");
    // Fotografia precedente all'inizio del mese: il mese resta confrontabile per intero.
    const c = resolve("2026-10-01", "2026-10-31", { kind: "months", rows: [month(1800)] }, { currentRows: rows, observationDate });
    expect(c.status).toBe("ok");
    expect(c.current?.revenue).toBe(3100);
    expect(c.targetDate).toBe("2025-09-30");
  });

  it("nessuna riga corrente o nessuna data di osservazione -> ND, mai zero inventato", () => {
    const empty = resolve("2026-10-01", "2026-10-31", { kind: "months", rows: [month(2000)] }, { currentRows: [], observationDate: null });
    expect(empty.status).toBe("no_current");
    expect(empty.current).toBeNull();
    expect(empty.delta).toBeNull();
    const noDate = resolve("2026-10-01", "2026-10-31", { kind: "months", rows: [month(2000)] }, { observationDate: null });
    expect(noDate.status).toBe("no_current");
    expect(noDate.reference).toBeNull();
  });
});

describe("chiusure dichiarate (structure_closures)", () => {
  const closures2025 = [
    { start_date: "2025-01-01", end_date: "2025-04-30" },
    { start_date: "2025-12-01", end_date: "2025-12-31" },
  ];
  const seasonal = (rows: (MonthAsofRow | null)[]) => ({ kind: "months" as const, rows });
  const mayToNov = Array.from({ length: 12 }, (_, i) => (i >= 4 && i <= 10 ? month(1000) : null));

  it("mesi LY senza fotografia ma chiusi per intero valgono 0: anno confrontabile", () => {
    const c = resolve("2026-01-01", "2026-12-31", seasonal(mayToNov), { closures: closures2025 });
    expect(c.status).toBe("ok");
    expect(c.reference?.revenue).toBe(7000);
    expect(c.closedMonths).toEqual([1, 2, 3, 4, 12]);
    expect(c.zeroNote).toBe("Chiusura dichiarata 2025 valorizzata a 0: 5 mesi.");
  });

  it("senza chiusura dichiarata l'assenza di fotografia non diventa zero -> ND", () => {
    expect(resolve("2026-01-01", "2026-12-31", seasonal(mayToNov)).status).toBe("partial_snapshot");
  });

  it("un dato reale prevale sulla chiusura dichiarata", () => {
    const rows = [...mayToNov];
    rows[0] = month(500);
    const c = resolve("2026-01-01", "2026-12-31", seasonal(rows), { closures: closures2025 });
    expect(c.reference?.revenue).toBe(7500);
    expect(c.closedMonths).toEqual([2, 3, 4, 12]);
  });

  it("mese LY chiuso solo in parte -> resta mancante", () => {
    const c = resolve("2026-01-01", "2026-12-31", seasonal(mayToNov), {
      closures: [{ start_date: "2025-01-01", end_date: "2025-04-15" }, closures2025[1]],
    });
    expect(c.status).toBe("partial_snapshot");
  });

  it("intervallo giornaliero: giorni senza fotografia coperti da chiusura valgono 0", () => {
    const c = resolve(
      "2026-04-20",
      "2026-05-10",
      { kind: "days", rows: daily("2025-05-01", "2025-05-10", 80, "2025-10-06") },
      { closures: closures2025 }
    );
    expect(c.status).toBe("ok");
    expect(c.reference?.revenue).toBe(800);
    expect(c.closedDays).toBe(11);
    expect(c.zeroNote).toBe("Chiusura dichiarata 2025 valorizzata a 0: 11 giorni.");
  });
});

describe("fonti reali", () => {
  it("Montecallini: fotografie incrementali, ogni giorno alla sua ultima estrazione <= target", () => {
    const c = resolve("2026-09-15", "2026-10-20", {
      kind: "days",
      rows: [...daily("2025-09-15", "2025-09-30", 80, "2025-10-01"), ...daily("2025-10-01", "2025-10-20", 60, "2025-10-06")],
    });
    expect(c.status).toBe("ok");
    expect(c.reference?.revenue).toBe(16 * 80 + 20 * 60);
    expect(c.referenceExtraction).toEqual({ from: "2025-10-01", to: "2025-10-06" });
  });

  it("Booking Designer: export annuale denso, 12 fotografie mensili allo stesso cutoff", () => {
    const c = resolve("2026-01-01", "2026-12-31", { kind: "months", rows: Array.from({ length: 12 }, (_, i) => month(1000 + i)) });
    expect(c.status).toBe("ok");
    expect(c.reference?.revenue).toBe(12 * 1000 + 66);
    // La RPC mensile restituisce il totale, non l'estrazione usata.
    expect(c.referenceExtraction).toBeNull();
  });

  it("storico solo a consuntivo (nessuna fotografia same-day): SDLY ND anche se il consuntivo LY esiste", () => {
    const finalLy = daily("2025-10-01", "2025-10-31", 80, "2026-01-01");
    const c = resolve("2026-10-01", "2026-10-31", { kind: "months", rows: [null] });
    expect(c.status).toBe("no_snapshot");
    // Il consuntivo resta disponibile e indipendente.
    expect(sumSnapshots(finalLy.map((r) => ({ ...r, status: "consuntivo" })) as never).revenue).toBe(2480);
  });
});

describe("Consuntivo LY distinto da SDLY", () => {
  it("stesso valore corrente, riferimenti diversi: fotografia same-day vs valore finale", () => {
    const sdly = resolve("2026-10-01", "2026-10-31", { kind: "months", rows: [month(2000)] });
    const consuntivoLy = sumSnapshots(daily("2025-10-01", "2025-10-31", 80).map((r) => ({ ...r, status: "consuntivo" })) as never).revenue;
    const current = sumSnapshots(daily("2026-10-01", "2026-10-31", 100).map((r) => ({ ...r, status: "otb" })) as never).revenue;
    expect(sdly.current?.revenue).toBe(current);
    expect(sdly.reference?.revenue).toBe(2000);
    expect(consuntivoLy).toBe(2480);
    expect(sdly.reference?.revenue).not.toBe(consuntivoLy);
  });
});

describe("testi per i tooltip", () => {
  it("date delle due fotografie, mai 'parte maturata'", () => {
    const c = resolve("2026-10-01", "2026-10-31", { kind: "months", rows: [month(2000)] });
    expect(c.actualDetail).toBe("fotografia disponibile al 06/10/2026");
    expect(c.referenceDetail).toBe("fotografia disponibile al 06/10/2025");
    expect(sdlyPhotoSentence(c, "month")).toBe(
      "Intero mese nella fotografia disponibile al 06/10/2026 vs stesso mese dell’anno precedente nella fotografia disponibile al 06/10/2025."
    );
    expect(sdlyPhotoSentence(c, "year")).toBe(
      "Intero anno nella fotografia disponibile al 06/10/2026 vs intero anno precedente nella fotografia disponibile al 06/10/2025."
    );
    expect(sdlyPhotoSentence(c)).not.toMatch(/maturat/);
    // Data target, mai presentata come data dell'estrazione realmente usata.
    expect(`${c.actualDetail} ${c.referenceDetail} ${sdlyPhotoSentence(c)}`).not.toMatch(/estrazione/);
  });
});

describe("Vista d'insieme: righe struttura, TOTALE METODO e L4L", () => {
  // Tre strutture con date di fotografia diverse, ottobre 2026.
  const structures = [
    { id: "rollo", name: "Rollo", rows: daily("2026-10-01", "2026-10-31", 2000, "2026-10-06"), ly: month(60000), final: 65000 },
    { id: "monte", name: "Montecallini", rows: daily("2026-10-01", "2026-10-31", 1000, "2026-09-30"), ly: month(20000), final: 23000 },
    // Storico solo a consuntivo: nessuna fotografia same-day.
    { id: "sangiorgio", name: "Sangiorgio", rows: daily("2026-10-01", "2026-10-31", 800, "2026-10-06"), ly: null, final: 26000 },
  ];
  const observationDates = observationDateByStructure(
    structures.flatMap((s) => s.rows.map((r) => ({ structure_id: s.id, extraction_date: r.extraction_date ?? null })))
  );
  const comparisons = structures.map((s) => ({
    ...s,
    sdly: resolveSdlyAsOfComparison({
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      currentRows: s.rows,
      observationDate: observationDates.get(s.id) ?? null,
      reference: { kind: "months", rows: [s.ly] },
      closures: [],
    }),
  }));

  it("una chiamata per cutoff distinto: strutture con la stessa fotografia condividono il cutoff", () => {
    expect(groupStructuresBySdlyCutoff(observationDates)).toEqual(
      new Map([
        ["2025-10-06", ["rollo", "sangiorgio"]],
        ["2025-09-30", ["monte"]],
      ])
    );
  });

  it("riga struttura: OTB dell'intero mese vs fotografia LY alla data della propria fotografia", () => {
    const [rollo, monte, sangiorgio] = comparisons;
    expect(rollo.sdly.current?.revenue).toBe(62000);
    expect(rollo.sdly.reference?.revenue).toBe(60000);
    expect(monte.sdly.targetDate).toBe("2025-09-30");
    expect(monte.sdly.current?.revenue).toBe(31000);
    expect(sangiorgio.sdly.status).toBe("no_snapshot");
  });

  const portfolioRows = comparisons.map((s) => ({
    monthRevenue: s.sdly.current?.revenue ?? null,
    monthRoomsSold: 62,
    monthRoomsAvailable: 310,
    lastYearMonthRevenue: s.final,
    sdlyMonthRevenue: s.sdly.reference?.revenue ?? null,
    budgetsForMonth: [],
  }));

  it("TOTALE METODO: somma di valori corrente e fotografie LY delle sole strutture confrontabili", () => {
    const portfolio = aggregatePortfolioPerformance(portfolioRows);
    expect(portfolio.revenue).toBe(62000 + 31000 + 24800);
    expect(portfolio.sdly).toMatchObject({ actual: 93000, reference: 80000, coverage: 2 });
    // Consuntivo LY: tutte e tre, riferimento diverso dallo SDLY.
    expect(portfolio.lastYear).toMatchObject({ actual: 117800, reference: 114000, coverage: 3 });
  });

  it("L4L: membership invariata; senza fotografia LY la struttura esce dal solo confronto SDLY", () => {
    const memberships = structures.map((s) => ({ structure_id: s.id, valid_from: "2025-01-01", valid_to: null }));
    const inputs = (pick: (i: number) => number | null) =>
      comparisons.map((s, i) => ({ id: s.id, name: s.name, actual: s.sdly.current?.revenue ?? null, reference: pick(i) }));
    const l4lSdly = computeLikeForLike(inputs((i) => comparisons[i].sdly.reference?.revenue ?? null), memberships, 2026, 2025);
    expect(l4lSdly.included.map((s) => s.id)).toEqual(["rollo", "monte"]);
    expect(l4lSdly.excluded).toEqual([{ id: "sangiorgio", name: "Sangiorgio", reasons: ["missing_reference_data"] }]);
    expect(l4lSdly.actual).toBe(93000);
    expect(l4lSdly.reference).toBe(80000);
    const l4lLy = computeLikeForLike(inputs((i) => comparisons[i].final), memberships, 2026, 2025);
    expect(l4lLy.included).toHaveLength(3);
    // Fuori dal portfolio dell'anno precedente: esclusa per membership, non per dato.
    const newcomer = computeLikeForLike(
      inputs((i) => comparisons[i].sdly.reference?.revenue ?? null),
      [memberships[0], { structure_id: "monte", valid_from: "2026-03-01", valid_to: null }],
      2026,
      2025
    );
    expect(newcomer.excluded.find((s) => s.id === "monte")?.reasons).toEqual(["not_in_previous_portfolio"]);
  });
});

describe("Dettaglio struttura e Vista d'insieme: stesso risultato", () => {
  it("stessa data di osservazione e stesso confronto dalle stesse righe", () => {
    const rows = daily("2026-10-01", "2026-10-31", 100, "2026-09-30");
    const detailObservation = sdlyCutoffFromRows(rows as { extraction_date: string | null }[]).observationDate;
    const overviewObservation = observationDateByStructure(
      rows.map((r) => ({ structure_id: "x", extraction_date: r.extraction_date ?? null }))
    ).get("x");
    expect(detailObservation).toBe(overviewObservation);
    const args = { periodStart: "2026-10-01", periodEnd: "2026-10-31", currentRows: rows, closures: [] };
    const reference = { kind: "months" as const, rows: [month(1800)] };
    expect(resolveSdlyAsOfComparison({ ...args, observationDate: detailObservation, reference })).toEqual(
      resolveSdlyAsOfComparison({ ...args, observationDate: overviewObservation ?? null, reference })
    );
  });
});

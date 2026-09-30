import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { buildMontecalliniBatches, MontecalliniFileInput } from "../montecalliniBatching";
import { computeBatchHash, computeSnapshotContentHash } from "../normalization";
import { sha256Hex } from "../hashing";
import { stayScopeOf } from "../conflictPolicy";
import { GroupKind, ImportableRow } from "../../../performanceImportRouting";
import { parseMontecalliniPmsCsv } from "../../../montecalliniPmsParser";

// "Oggi" a meta' maggio 2026: maggio e giugno 2026 sono mesi aperti, quindi
// le righe CY di questi test producono tutte la stessa extraction_date
// (un solo gruppo per kind, come prima del calcolo per riga).
const TODAY = "2026-05-15";

function row(stayDate: string): ImportableRow {
  return { stayDate, revenueTotal: 100, roomsSold: 5, roomsAvailable: 10, arrivals: 1, presences: 8 };
}

describe("buildMontecalliniBatches - J. i diversi file PlanningForecast NON sono conflitti tra loro", () => {
  it("2 file diversi, ciascuno con solo righe CY -> un unico batch 'cy' con le righe di ENTRAMBI i file fuse, mai trattati come conflitto", () => {
    const files: MontecalliniFileInput[] = [
      { fileName: "PlanningForecast (MAGG).csv", filePath: "", sourceChecksum: "hash-magg", groups: [{ kind: "cy", rows: [row("2026-05-01"), row("2026-05-02")] }] },
      { fileName: "PlanningForecast (GIUG).csv", filePath: "", sourceChecksum: "hash-giug", groups: [{ kind: "cy", rows: [row("2026-06-01")] }] },
    ];

    const batches = buildMontecalliniBatches(files, TODAY);
    expect(batches).toHaveLength(1);
    expect(batches[0].kind).toBe("cy");
    expect(batches[0].rows.map((r) => r.stayDate).sort()).toEqual(["2026-05-01", "2026-05-02", "2026-06-01"]);
    expect(batches[0].sourceFiles).toHaveLength(2);
  });

  it("file con CY/SDLY/LY -> 3 batch separati, uno per kind, mai mescolati", () => {
    const files: MontecalliniFileInput[] = [
      {
        fileName: "PlanningForecast (MAGG).csv",
        filePath: "",
        sourceChecksum: "hash-magg",
        groups: [
          { kind: "cy", rows: [row("2026-05-01")] },
          { kind: "sdly", rows: [row("2025-05-01")] },
          { kind: "ly", rows: [row("2025-05-01")] },
        ],
      },
    ];

    const batches = buildMontecalliniBatches(files, TODAY);
    expect(batches.map((b) => b.kind).sort()).toEqual(["cy", "ly", "sdly"]);
    for (const batch of batches) expect(batch.rows).toHaveLength(1);
  });

  it("sourceIndex di ogni riga punta correttamente al proprio file all'interno di sourceFiles (mai il file sbagliato)", () => {
    const files: MontecalliniFileInput[] = [
      { fileName: "PlanningForecast (GIUG).csv", filePath: "", sourceChecksum: "hash-giug", groups: [{ kind: "cy", rows: [row("2026-06-01")] }] },
      { fileName: "PlanningForecast (MAGG).csv", filePath: "", sourceChecksum: "hash-magg", groups: [{ kind: "cy", rows: [row("2026-05-01")] }] },
    ];

    const batches = buildMontecalliniBatches(files, TODAY);
    const cyBatch = batches.find((b) => b.kind === "cy")!;
    for (const r of cyBatch.rows) {
      const sourceFile = cyBatch.sourceFiles[r.sourceIndex];
      const expectedFile = r.stayDate === "2026-05-01" ? "PlanningForecast (MAGG).csv" : "PlanningForecast (GIUG).csv";
      expect(sourceFile.fileName).toBe(expectedFile);
    }
  });

  it("nessun file contribuisce a un kind -> nessun batch per quel kind (mai un batch vuoto)", () => {
    const files: MontecalliniFileInput[] = [
      { fileName: "PlanningForecast (MAGG).csv", filePath: "", sourceChecksum: "hash-magg", groups: [{ kind: "cy", rows: [row("2026-05-01")] }] },
    ];
    const batches = buildMontecalliniBatches(files, TODAY);
    expect(batches.map((b) => b.kind)).toEqual(["cy"]);
  });
});

describe("I. indipendenza dall'ordine di selezione dei file - end to end (batching + hashing)", () => {
  it("[file A, file B] e [file B, file A] producono lo stesso batch_hash E lo stesso normalized_content_hash per il kind risultante", async () => {
    const fileA: MontecalliniFileInput = {
      fileName: "PlanningForecast (MAGG).csv",
      filePath: "",
      sourceChecksum: "hash-magg",
      groups: [{ kind: "cy", rows: [row("2026-05-01"), row("2026-05-02")] }],
    };
    const fileB: MontecalliniFileInput = {
      fileName: "PlanningForecast (GIUG).csv",
      filePath: "",
      sourceChecksum: "hash-giug",
      groups: [{ kind: "cy", rows: [row("2026-06-01")] }],
    };

    const batchesAB = buildMontecalliniBatches([fileA, fileB], TODAY);
    const batchesBA = buildMontecalliniBatches([fileB, fileA], TODAY);

    const batchHashAB = await computeBatchHash(batchesAB[0].sourceChecksums);
    const batchHashBA = await computeBatchHash(batchesBA[0].sourceChecksums);
    expect(batchHashAB).toBe(batchHashBA);

    const contentHashAB = await computeSnapshotContentHash(batchesAB[0].rows);
    const contentHashBA = await computeSnapshotContentHash(batchesBA[0].rows);
    expect(contentHashAB).toBe(contentHashBA);
  });
});

// ============ extraction_date per riga (bug 24/09/2026) ============
// Prima: una sola extraction_date per kind, presa dal mese di rows[0], cioe'
// dal primo file in ordine alfabetico ("nov" < "ott" < "sett" -> LY di
// settembre/ottobre/novembre tutti su 2025-12-01). Ora: data per riga,
// gruppi per (kind, extraction_date).
function monthRows(year: number, month: number): ImportableRow[] {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) =>
    row(`${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`)
  );
}

function fileOf(fileName: string, kind: GroupKind, rows: ImportableRow[]): MontecalliniFileInput {
  return { fileName, filePath: `path/${fileName}`, sourceChecksum: `sum-${fileName}`, groups: [{ kind, rows }] };
}

const summary = (batches: ReturnType<typeof buildMontecalliniBatches>) =>
  batches.map((b) => ({ kind: b.kind, extractionDate: b.extractionDate, scope: stayScopeOf(b.rows), files: b.sourceFiles.map((f) => f.fileName) }));

describe("buildMontecalliniBatches - extraction_date calcolata per riga", () => {
  it("A. LY settembre + ottobre + novembre nello stesso batch -> 3 gruppi 2025-10-01 / 2025-11-01 / 2025-12-01", () => {
    const batches = buildMontecalliniBatches(
      [
        fileOf("PlanningForecast sett.csv", "ly", monthRows(2025, 9)),
        fileOf("PlanningForecast ott.csv", "ly", monthRows(2025, 10)),
        fileOf("PlanningForecast nov.csv", "ly", monthRows(2025, 11)),
      ],
      "2026-09-24"
    );
    expect(summary(batches)).toEqual([
      { kind: "ly", extractionDate: "2025-10-01", scope: { start: "2025-09-01", end: "2025-09-30" }, files: ["PlanningForecast sett.csv"] },
      { kind: "ly", extractionDate: "2025-11-01", scope: { start: "2025-10-01", end: "2025-10-31" }, files: ["PlanningForecast ott.csv"] },
      { kind: "ly", extractionDate: "2025-12-01", scope: { start: "2025-11-01", end: "2025-11-30" }, files: ["PlanningForecast nov.csv"] },
    ]);
  });

  it("B. CY agosto (chiuso) + settembre (aperto) caricati a settembre -> 2 gruppi 2026-09-01 / oggi", () => {
    const batches = buildMontecalliniBatches(
      [fileOf("PlanningForecast ago.csv", "cy", monthRows(2026, 8)), fileOf("PlanningForecast sett.csv", "cy", monthRows(2026, 9))],
      "2026-09-24"
    );
    expect(summary(batches)).toEqual([
      { kind: "cy", extractionDate: "2026-09-01", scope: { start: "2026-08-01", end: "2026-08-31" }, files: ["PlanningForecast ago.csv"] },
      { kind: "cy", extractionDate: "2026-09-24", scope: { start: "2026-09-01", end: "2026-09-30" }, files: ["PlanningForecast sett.csv"] },
    ]);
  });

  it("C. CY ottobre + novembre caricati il 30/09 -> entrambi aperti, un solo gruppo 2026-09-30 con scope 01/10-30/11", () => {
    const batches = buildMontecalliniBatches(
      [fileOf("PlanningForecast ott.csv", "cy", monthRows(2026, 10)), fileOf("PlanningForecast nov.csv", "cy", monthRows(2026, 11))],
      "2026-09-30"
    );
    expect(summary(batches)).toEqual([
      {
        kind: "cy",
        extractionDate: "2026-09-30",
        scope: { start: "2026-10-01", end: "2026-11-30" },
        files: ["PlanningForecast nov.csv", "PlanningForecast ott.csv"],
      },
    ]);
    expect(batches[0].rows).toHaveLength(61);
  });

  it("D. SDLY multi-mese -> un solo gruppo, oggi meno un anno (invariato)", () => {
    const batches = buildMontecalliniBatches(
      [
        fileOf("PlanningForecast sett.csv", "sdly", monthRows(2025, 9)),
        fileOf("PlanningForecast ott.csv", "sdly", monthRows(2025, 10)),
        fileOf("PlanningForecast nov.csv", "sdly", monthRows(2025, 11)),
      ],
      "2026-09-24"
    );
    expect(summary(batches).map((b) => [b.kind, b.extractionDate, b.scope])).toEqual([
      ["sdly", "2025-09-24", { start: "2025-09-01", end: "2025-11-30" }],
    ]);
  });

  it("l'ordine alfabetico dei file non cambia piu' le date (causa radice del 24/09)", () => {
    const sett = fileOf("PlanningForecast sett.csv", "ly", monthRows(2025, 9));
    const nov = fileOf("PlanningForecast nov.csv", "ly", monthRows(2025, 11));
    const renamedSett = { ...sett, fileName: "AAA sett.csv" }; // ora viene prima di "nov"
    const dates = (files: MontecalliniFileInput[]) => buildMontecalliniBatches(files, "2026-09-24").map((b) => b.extractionDate);
    expect(dates([sett, nov])).toEqual(["2025-10-01", "2025-12-01"]);
    expect(dates([nov, renamedSett])).toEqual(["2025-10-01", "2025-12-01"]);
  });

  it("sourceIndex locale al gruppo: ogni riga punta al proprio file anche con gruppi divisi", () => {
    const file = (name: string, rows: ImportableRow[]): MontecalliniFileInput => ({
      fileName: name,
      filePath: `path/${name}`,
      sourceChecksum: `sum-${name}`,
      groups: [
        { kind: "cy", rows },
        { kind: "ly", rows: rows.map((r) => row(r.stayDate.replace("2026", "2025"))) },
      ],
    });
    const batches = buildMontecalliniBatches([file("A.csv", monthRows(2026, 8)), file("B.csv", monthRows(2026, 9))], "2026-09-24");
    for (const b of batches) {
      for (const r of b.rows) {
        const month = r.stayDate.slice(5, 7);
        expect(b.sourceFiles[r.sourceIndex].fileName).toBe(month === "08" ? "A.csv" : "B.csv");
      }
    }
    // cy agosto, cy settembre, ly agosto, ly settembre
    expect(batches.map((b) => `${b.kind}:${b.extractionDate}`)).toEqual([
      "cy:2026-09-01",
      "cy:2026-09-24",
      "ly:2025-09-01",
      "ly:2025-10-01",
    ]);
  });
});

// ============ File reali (.local-imports, gitignored) ============
const REAL_ROOT = path.join(process.cwd(), ".local-imports");

async function realFile(dir: string, name: string): Promise<MontecalliniFileInput> {
  const buf = fs.readFileSync(path.join(REAL_ROOT, dir, name));
  const parsed = parseMontecalliniPmsCsv(buf.toString("latin1"));
  const kinds: GroupKind[] = ["cy", "sdly", "ly"];
  return {
    fileName: name,
    filePath: name,
    sourceChecksum: await sha256Hex(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
    groups: kinds.map((kind) => ({ kind, rows: parsed.rows.filter((r) => r.kind === kind) as unknown as ImportableRow[] })),
  };
}

const has = (dir: string, names: string[]) => names.every((n) => fs.existsSync(path.join(REAL_ROOT, dir, n)));
const BATCH_2409 = ["PlanningForecast nov.csv", "PlanningForecast ott (1).csv", "PlanningForecast sett (1).csv"];

describe("file reali Montecallini - regressione extraction_date", () => {
  it.skipIf(!has("montecallini_2026-09-24", BATCH_2409))(
    "G. batch 24/09 (set + ott + nov): CY un gruppo 2026-09-24, SDLY un gruppo 2025-09-24, LY 3 gruppi 10-01 / 11-01 / 12-01",
    async () => {
      const files = await Promise.all(BATCH_2409.map((n) => realFile("montecallini_2026-09-24", n)));
      // Sono proprio i file del batch del 24/09 (batch_hash registrato sull'evento).
      expect(await computeBatchHash(files.map((f) => f.sourceChecksum))).toMatch(/^b44a3bca57/);
      const batches = buildMontecalliniBatches(files, "2026-09-24");
      expect(batches.map((b) => [b.kind, b.extractionDate, stayScopeOf(b.rows)])).toEqual([
        ["cy", "2026-09-24", { start: "2026-09-01", end: "2026-11-30" }],
        ["sdly", "2025-09-24", { start: "2025-09-01", end: "2025-11-30" }],
        ["ly", "2025-10-01", { start: "2025-09-01", end: "2025-09-30" }],
        ["ly", "2025-11-01", { start: "2025-10-01", end: "2025-10-31" }],
        ["ly", "2025-12-01", { start: "2025-11-01", end: "2025-11-30" }],
      ]);
      // CY e SDLY: stesso contenuto di prima (hash dell'evento del 24/09).
      expect(await computeSnapshotContentHash(batches[0].rows)).toMatch(/^863acc187a/);
      expect(await computeSnapshotContentHash(batches[1].rows)).toMatch(/^8b8cfcf550/);
      // LY settembre e ottobre: stesso contenuto degli snapshot LY legacy
      // (2025-10-01 / 2025-11-01) -> al ricaricamento sarebbero legacy_equivalent.
      expect(await computeSnapshotContentHash(batches[2].rows)).toMatch(/^cbb5d5b9b3/);
      expect(await computeSnapshotContentHash(batches[3].rows)).toMatch(/^5da99f2cc7/);
    }
  );

  it.skipIf(!has("montecallini_2026-09-30", ["PlanningForecast sett (2).csv"]))(
    "E. PlanningForecast sett (2).csv: 3 gruppi e hash identici agli import validati",
    async () => {
      const batches = buildMontecalliniBatches([await realFile("montecallini_2026-09-30", "PlanningForecast sett (2).csv")], "2026-09-30");
      const out = await Promise.all(batches.map(async (b) => [b.kind, b.extractionDate, (await computeSnapshotContentHash(b.rows)).slice(0, 10)]));
      expect(out).toEqual([
        ["cy", "2026-09-30", "4ee99f309f"],
        ["sdly", "2025-09-30", "cbb5d5b9b3"],
        ["ly", "2025-10-01", "cbb5d5b9b3"],
      ]);
    }
  );

  it.skipIf(!has("montecallini_2026-09-30", ["PlanningForecast ott (2).csv"]))(
    "F. PlanningForecast ott (2).csv: 3 gruppi e hash identici agli import validati",
    async () => {
      const batches = buildMontecalliniBatches([await realFile("montecallini_2026-09-30", "PlanningForecast ott (2).csv")], "2026-09-30");
      const out = await Promise.all(batches.map(async (b) => [b.kind, b.extractionDate, (await computeSnapshotContentHash(b.rows)).slice(0, 10)]));
      expect(out).toEqual([
        ["cy", "2026-09-30", "a3c69d534f"],
        ["sdly", "2025-09-30", "d8a3472740"],
        ["ly", "2025-11-01", "5da99f2cc7"],
      ]);
    }
  );
});

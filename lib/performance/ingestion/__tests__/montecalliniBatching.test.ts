import { describe, expect, it } from "vitest";
import { buildMontecalliniBatches, MontecalliniFileInput } from "../montecalliniBatching";
import { computeBatchHash, computeSnapshotContentHash } from "../normalization";
import { ImportableRow } from "../../../performanceImportRouting";

function row(stayDate: string): ImportableRow {
  return { stayDate, revenueTotal: 100, roomsSold: 5, roomsAvailable: 10, arrivals: 1, presences: 8 };
}

describe("buildMontecalliniBatches - J. i diversi file PlanningForecast NON sono conflitti tra loro", () => {
  it("2 file diversi, ciascuno con solo righe CY -> un unico batch 'cy' con le righe di ENTRAMBI i file fuse, mai trattati come conflitto", () => {
    const files: MontecalliniFileInput[] = [
      { fileName: "PlanningForecast (MAGG).csv", filePath: "", sourceChecksum: "hash-magg", groups: [{ kind: "cy", rows: [row("2026-05-01"), row("2026-05-02")] }] },
      { fileName: "PlanningForecast (GIUG).csv", filePath: "", sourceChecksum: "hash-giug", groups: [{ kind: "cy", rows: [row("2026-06-01")] }] },
    ];

    const batches = buildMontecalliniBatches(files);
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

    const batches = buildMontecalliniBatches(files);
    expect(batches.map((b) => b.kind).sort()).toEqual(["cy", "ly", "sdly"]);
    for (const batch of batches) expect(batch.rows).toHaveLength(1);
  });

  it("sourceIndex di ogni riga punta correttamente al proprio file all'interno di sourceFiles (mai il file sbagliato)", () => {
    const files: MontecalliniFileInput[] = [
      { fileName: "PlanningForecast (GIUG).csv", filePath: "", sourceChecksum: "hash-giug", groups: [{ kind: "cy", rows: [row("2026-06-01")] }] },
      { fileName: "PlanningForecast (MAGG).csv", filePath: "", sourceChecksum: "hash-magg", groups: [{ kind: "cy", rows: [row("2026-05-01")] }] },
    ];

    const batches = buildMontecalliniBatches(files);
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
    const batches = buildMontecalliniBatches(files);
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

    const batchesAB = buildMontecalliniBatches([fileA, fileB]);
    const batchesBA = buildMontecalliniBatches([fileB, fileA]);

    const batchHashAB = await computeBatchHash(batchesAB[0].sourceChecksums);
    const batchHashBA = await computeBatchHash(batchesBA[0].sourceChecksums);
    expect(batchHashAB).toBe(batchHashBA);

    const contentHashAB = await computeSnapshotContentHash(batchesAB[0].rows);
    const contentHashBA = await computeSnapshotContentHash(batchesBA[0].rows);
    expect(contentHashAB).toBe(contentHashBA);
  });
});

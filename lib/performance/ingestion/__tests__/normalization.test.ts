import { describe, expect, it } from "vitest";
import {
  computeBatchHash,
  computeNationalityContentHash,
  computeSnapshotContentHash,
} from "../normalization";
import { NormalizedNationalityRow, NormalizedSnapshotRow } from "../types";

function snapshotRow(overrides: Partial<NormalizedSnapshotRow>): NormalizedSnapshotRow {
  return {
    stayDate: "2026-09-08",
    revenueTotal: 500,
    roomsSold: 5,
    roomsAvailable: 10,
    arrivals: 2,
    presences: 7,
    sourceIndex: 0,
    ...overrides,
  };
}

describe("computeSnapshotContentHash", () => {
  it("stesso insieme di righe in ordine diverso -> stesso hash (canonicalizzazione per stay_date)", async () => {
    const rowsA = [snapshotRow({ stayDate: "2026-09-01" }), snapshotRow({ stayDate: "2026-09-02" })];
    const rowsB = [snapshotRow({ stayDate: "2026-09-02" }), snapshotRow({ stayDate: "2026-09-01" })];
    expect(await computeSnapshotContentHash(rowsA)).toBe(await computeSnapshotContentHash(rowsB));
  });

  it("contenuto diverso (revenue_total diverso) -> hash diverso", async () => {
    const rowsA = [snapshotRow({ revenueTotal: 500 })];
    const rowsB = [snapshotRow({ revenueTotal: 501 })];
    expect(await computeSnapshotContentHash(rowsA)).not.toBe(await computeSnapshotContentHash(rowsB));
  });

  it("rumore in virgola mobile su revenue_total (stesso importo) -> stesso hash (arrotondamento a 2 decimali)", async () => {
    const rowsA = [snapshotRow({ revenueTotal: 100.1 })];
    const rowsB = [snapshotRow({ revenueTotal: 100.09999999999999 })];
    expect(await computeSnapshotContentHash(rowsA)).toBe(await computeSnapshotContentHash(rowsB));
  });

  it("array vuoto -> hash deterministico (non un errore)", async () => {
    const hash = await computeSnapshotContentHash([]);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

function nationalityRow(overrides: Partial<NormalizedNationalityRow>): NormalizedNationalityRow {
  return { stayDate: "2026-09-08", nationality: "ITALIA", presences: 3, sourceIndex: 0, ...overrides };
}

describe("computeNationalityContentHash", () => {
  it("stesso insieme di righe (stesso giorno, nazionalità diverse) in ordine diverso -> stesso hash", async () => {
    const rowsA = [nationalityRow({ nationality: "ITALIA" }), nationalityRow({ nationality: "FRANCIA" })];
    const rowsB = [nationalityRow({ nationality: "FRANCIA" }), nationalityRow({ nationality: "ITALIA" })];
    expect(await computeNationalityContentHash(rowsA)).toBe(await computeNationalityContentHash(rowsB));
  });

  it("presences diverso -> hash diverso", async () => {
    const rowsA = [nationalityRow({ presences: 3 })];
    const rowsB = [nationalityRow({ presences: 4 })];
    expect(await computeNationalityContentHash(rowsA)).not.toBe(await computeNationalityContentHash(rowsB));
  });
});

describe("computeBatchHash - I. indipendenza dall'ordine di selezione dei file Montecallini", () => {
  it("[file A, file B] e [file B, file A] -> stesso batch_hash", async () => {
    const checksumA = "aaaa1111";
    const checksumB = "bbbb2222";
    const hashAB = await computeBatchHash([checksumA, checksumB]);
    const hashBA = await computeBatchHash([checksumB, checksumA]);
    expect(hashAB).toBe(hashBA);
  });

  it("insieme di file diverso -> batch_hash diverso", async () => {
    const hash2Files = await computeBatchHash(["aaaa1111", "bbbb2222"]);
    const hash3Files = await computeBatchHash(["aaaa1111", "bbbb2222", "cccc3333"]);
    expect(hash2Files).not.toBe(hash3Files);
  });
});

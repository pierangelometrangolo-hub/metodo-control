import { describe, expect, it } from "vitest";
import { decideImportAction, PriorImportedEvent } from "../conflictPolicy";

describe("decideImportAction - regola di decisione duplicato/conflitto (mai 'vince l'ultimo file')", () => {
  it("nessun import precedente per questa chiave -> commit", () => {
    const decision = decideImportAction(null, { sourceChecksum: "abc", normalizedContentHash: "xyz" });
    expect(decision).toEqual({ action: "commit" });
  });

  it("A. exact duplicate: stesso source_checksum di un import già completato -> skip_duplicate/exact_duplicate", () => {
    const prior: PriorImportedEvent = { id: "evt-1", sourceChecksum: "same-file-hash", normalizedContentHash: "content-hash-1" };
    const decision = decideImportAction(prior, { sourceChecksum: "same-file-hash", normalizedContentHash: "content-hash-1" });
    expect(decision).toEqual({ action: "skip_duplicate", reason: "exact_duplicate" });
  });

  it("B. semantic duplicate: source_checksum diverso ma stesso normalized_content_hash -> skip_duplicate/semantic_duplicate", () => {
    const prior: PriorImportedEvent = { id: "evt-1", sourceChecksum: "file-hash-A", normalizedContentHash: "same-content-hash" };
    const decision = decideImportAction(prior, { sourceChecksum: "file-hash-B", normalizedContentHash: "same-content-hash" });
    expect(decision).toEqual({ action: "skip_duplicate", reason: "semantic_duplicate" });
  });

  it("C. conflict: struttura/data/dataset uguali, source_checksum E normalized_content_hash entrambi diversi -> conflict", () => {
    const prior: PriorImportedEvent = { id: "evt-1", sourceChecksum: "file-hash-A", normalizedContentHash: "content-hash-A" };
    const decision = decideImportAction(prior, { sourceChecksum: "file-hash-B", normalizedContentHash: "content-hash-B" });
    expect(decision).toEqual({ action: "conflict", conflictingEventId: "evt-1" });
  });

  it("D. conflict against prior completed import: il prior può venire da qualunque sessione precedente, non solo dalla stessa - il tipo non porta alcuna informazione su 'quando', quindi la regola vale identica", () => {
    // priorImportedEvent qui rappresenta esplicitamente un evento scritto
    // in una sessione precedente (giorni/settimane prima) - la funzione
    // non fa alcuna distinzione, prova diretta che il conflitto si applica
    // anche contro import "vecchi", non solo quelli dello stesso batch.
    const priorFromPastSession: PriorImportedEvent = {
      id: "evt-vecchio-di-settimane-fa",
      sourceChecksum: "vecchio-hash-file",
      normalizedContentHash: "vecchio-hash-contenuto",
    };
    const decision = decideImportAction(priorFromPastSession, {
      sourceChecksum: "nuovo-hash-file",
      normalizedContentHash: "nuovo-hash-contenuto",
    });
    expect(decision).toEqual({ action: "conflict", conflictingEventId: "evt-vecchio-di-settimane-fa" });
  });

  it("mai un overwrite implicito: exact_duplicate ha priorità su conflict quando entrambi i criteri sarebbero teoricamente valutabili", () => {
    // Caso limite: source_checksum uguale (stesso file byte per byte) - per
    // costruzione anche il contenuto normalizzato sarebbe identico, quindi
    // e' sempre e solo exact_duplicate, mai un conflitto.
    const prior: PriorImportedEvent = { id: "evt-1", sourceChecksum: "hash-file", normalizedContentHash: "hash-contenuto" };
    const decision = decideImportAction(prior, { sourceChecksum: "hash-file", normalizedContentHash: "hash-contenuto" });
    expect(decision.action).toBe("skip_duplicate");
  });
});

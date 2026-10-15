import { describe, expect, it } from "vitest";
import {
  decideImportAction,
  isStayScopedDataset,
  PriorImportedEvent,
  selectPriorImportedEvent,
  STAY_SCOPED_DATASETS,
  StayScope,
  stayScopeOf,
} from "../conflictPolicy";

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
    expect(decision).toEqual({ action: "conflict", conflictingEventId: "evt-1", reason: "content_conflict" });
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
    expect(decision).toEqual({ action: "conflict", conflictingEventId: "evt-vecchio-di-settimane-fa", reason: "content_conflict" });
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

// ============ Scope soggiorno (migration 20260930130000) ============
// Stessa regola della RPC: per montecallini_pms la chiave include
// l'intervallo di soggiorno [stayDateStart, stayDateEnd].
describe("scope soggiorno Montecallini: selectPriorImportedEvent + decideImportAction", () => {
  const SEPT: StayScope = { start: "2026-09-01", end: "2026-09-30" };
  const OCT: StayScope = { start: "2026-10-01", end: "2026-10-31" };
  const septEvent: PriorImportedEvent = {
    id: "evt-sett",
    sourceChecksum: "file-sett",
    normalizedContentHash: "hash-sett",
    stayDateStart: SEPT.start,
    stayDateEnd: SEPT.end,
  };

  it("stayScopeOf: min/max stay_date, null senza righe", () => {
    expect(stayScopeOf([{ stayDate: "2026-09-15" }, { stayDate: "2026-09-01" }, { stayDate: "2026-09-30" }])).toEqual(SEPT);
    expect(stayScopeOf([])).toBeNull();
  });

  it("1. stesso scope, stesso contenuto -> duplicato", () => {
    const prior = selectPriorImportedEvent([septEvent], SEPT);
    expect(prior?.id).toBe("evt-sett");
    expect(decideImportAction(prior, { sourceChecksum: "altro-file", normalizedContentHash: "hash-sett" }, SEPT)).toEqual({
      action: "skip_duplicate",
      reason: "semantic_duplicate",
    });
  });

  it("2. stesso scope, contenuto diverso -> content_conflict", () => {
    const prior = selectPriorImportedEvent([septEvent], SEPT);
    expect(decideImportAction(prior, { sourceChecksum: "altro-file", normalizedContentHash: "hash-diverso" }, SEPT)).toEqual({
      action: "conflict",
      conflictingEventId: "evt-sett",
      reason: "content_conflict",
    });
  });

  it("3. scope disgiunto (ottobre dopo settembre, stessa chiave) -> nessun evento rilevante -> commit", () => {
    const prior = selectPriorImportedEvent([septEvent], OCT);
    expect(prior).toBeNull();
    expect(decideImportAction(prior, { sourceChecksum: "file-ott", normalizedContentHash: "hash-ott" }, OCT)).toEqual({
      action: "commit",
    });
  });

  it("9. scope parzialmente sovrapposto -> scope_overlap, anche con hash uguale", () => {
    const overlap: StayScope = { start: "2026-09-15", end: "2026-10-15" };
    const prior = selectPriorImportedEvent([septEvent], overlap);
    expect(prior?.id).toBe("evt-sett");
    expect(decideImportAction(prior, { sourceChecksum: "file-sett", normalizedContentHash: "hash-sett" }, overlap)).toEqual({
      action: "conflict",
      conflictingEventId: "evt-sett",
      reason: "scope_overlap",
    });
  });

  it("stesso scope preferito a un evento sovrapposto piu' recente", () => {
    const wide: PriorImportedEvent = { ...septEvent, id: "evt-largo", stayDateStart: "2026-08-15", stayDateEnd: "2026-10-15" };
    expect(selectPriorImportedEvent([wide, septEvent], SEPT)?.id).toBe("evt-sett");
  });

  it("10. evento storico senza scope: si sovrappone a tutto, regola storica (mai un bypass)", () => {
    const legacyEvent: PriorImportedEvent = { id: "evt-storico", sourceChecksum: "x", normalizedContentHash: "hash-storico" };
    const prior = selectPriorImportedEvent([legacyEvent], OCT);
    expect(prior?.id).toBe("evt-storico");
    expect(decideImportAction(prior, { sourceChecksum: "file-ott", normalizedContentHash: "hash-ott" }, OCT)).toEqual({
      action: "conflict",
      conflictingEventId: "evt-storico",
      reason: "content_conflict",
    });
    expect(decideImportAction(prior, { sourceChecksum: "y", normalizedContentHash: "hash-storico" }, OCT).action).toBe("skip_duplicate");
  });

  it("dataset non scoped (candidateScope null): evento piu' recente, comportamento invariato", () => {
    const older: PriorImportedEvent = { id: "evt-vecchio", sourceChecksum: "a", normalizedContentHash: "a" };
    expect(selectPriorImportedEvent([septEvent, older], null)?.id).toBe("evt-sett");
    expect(decideImportAction(septEvent, { sourceChecksum: "z", normalizedContentHash: "z" }).action).toBe("conflict");
  });
});

// Booking Designer non esporta piu' di un anno per file: la stessa
// extraction_date puo' avere piu' export ADR/RevPAR annuali disgiunti (caso
// reale Palazzo Rollo, 15/10/2026: 2026 e 2027). Stessa regola stay-scope di
// Montecallini, nessuna seconda implementazione.
describe("scope soggiorno ADR/RevPAR Booking Designer: export annuali con la stessa extraction_date", () => {
  const Y2026: StayScope = { start: "2026-01-01", end: "2026-12-31" };
  const Y2027: StayScope = { start: "2027-01-01", end: "2027-12-31" };
  const event2026: PriorImportedEvent = {
    id: "evt-2026",
    sourceChecksum: "chk-2026",
    normalizedContentHash: "hash-2026",
    stayDateStart: Y2026.start,
    stayDateEnd: Y2026.end,
  };
  const decide = (events: PriorImportedEvent[], scope: StayScope, chk: string, hash: string) =>
    decideImportAction(selectPriorImportedEvent(events, scope), { sourceChecksum: chk, normalizedContentHash: hash }, scope);

  it("adr_revpar e montecallini_pms usano lo scope; nationality no", () => {
    expect(STAY_SCOPED_DATASETS).toEqual(["montecallini_pms", "adr_revpar"]);
    expect(isStayScopedDataset("adr_revpar")).toBe(true);
    expect(isStayScopedDataset("montecallini_pms")).toBe(true);
    expect(isStayScopedDataset("nationality")).toBe(false);
  });

  it("1/5. 2027 con il 2026 gia' importato (scope adiacenti, stessa struttura/data/dataset) -> commit", () => {
    expect(selectPriorImportedEvent([event2026], Y2027)).toBeNull();
    expect(decide([event2026], Y2027, "chk-2027", "hash-2027")).toEqual({ action: "commit" });
  });

  it("1. ordine inverso: 2026 con il 2027 gia' importato -> commit", () => {
    const event2027 = { ...event2026, id: "evt-2027", stayDateStart: Y2027.start, stayDateEnd: Y2027.end };
    expect(decide([event2027], Y2026, "chk-2026", "hash-2026")).toEqual({ action: "commit" });
  });

  it("2. stesso scope + stesso hash -> duplicato", () => {
    expect(decide([event2026], Y2026, "chk-2026", "hash-2026")).toEqual({ action: "skip_duplicate", reason: "exact_duplicate" });
    expect(decide([event2026], Y2026, "chk-altro", "hash-2026")).toEqual({ action: "skip_duplicate", reason: "semantic_duplicate" });
  });

  it("3. stesso scope + hash diverso -> content_conflict, mai last-write-wins", () => {
    expect(decide([event2026], Y2026, "chk-altro", "hash-altro")).toEqual({
      action: "conflict",
      conflictingEventId: "evt-2026",
      reason: "content_conflict",
    });
  });

  it("3b. con 2026 e 2027 gia' importati, un 2027 diverso confligge con il 2027, non con il 2026", () => {
    const event2027 = { ...event2026, id: "evt-2027", sourceChecksum: "chk-2027", normalizedContentHash: "hash-2027", stayDateStart: Y2027.start, stayDateEnd: Y2027.end };
    expect(decide([event2027, event2026], Y2027, "chk-x", "hash-x")).toMatchObject({ action: "conflict", conflictingEventId: "evt-2027", reason: "content_conflict" });
    expect(decide([event2027, event2026], Y2027, "chk-2027", "hash-2027")).toEqual({ action: "skip_duplicate", reason: "exact_duplicate" });
  });

  it("4. sovrapposizione parziale (01/07/2026 -> 30/06/2027) -> scope_overlap, anche con hash uguale", () => {
    const mid: StayScope = { start: "2026-07-01", end: "2027-06-30" };
    expect(decide([event2026], mid, "chk-2026", "hash-2026")).toEqual({
      action: "conflict",
      conflictingEventId: "evt-2026",
      reason: "scope_overlap",
    });
  });

  it("4b. export di un solo mese dentro l'anno gia' importato -> scope_overlap", () => {
    expect(decide([event2026], { start: "2026-06-01", end: "2026-06-30" }, "chk-giu", "hash-giu")).toMatchObject({
      action: "conflict",
      reason: "scope_overlap",
    });
  });

  it("8. evento storico senza scope: si sovrappone a tutto, regola storica (mai un bypass)", () => {
    const legacyEvent = { ...event2026, stayDateStart: null, stayDateEnd: null };
    expect(decide([legacyEvent], Y2027, "chk-2027", "hash-2027")).toMatchObject({ action: "conflict", reason: "content_conflict" });
    expect(decide([legacyEvent], Y2027, "chk-2026", "hash-x")).toEqual({ action: "skip_duplicate", reason: "exact_duplicate" });
  });
});

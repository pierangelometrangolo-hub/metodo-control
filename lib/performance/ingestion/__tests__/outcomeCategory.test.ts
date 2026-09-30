import { describe, expect, it } from "vitest";
import { categorizeOutcome, describeOutcome, OUTCOME_CATEGORY_LABEL, OutcomeCategory } from "../outcomeCategory";
import type { IngestionOutcome } from "../types";

// ============ STEP 3 — test L: categorizzazione UI ============
// validation_error deve avere una categoria PROPRIA, mai la stessa di
// routing_error/parse_error ("Errore parsing/routing"). I warning (gestiti
// a livello di OutcomeLine.category in page.tsx, non da questa funzione -
// vedi outcomeCategory.ts) non passano mai da qui come "error"/
// "validationError".

describe("categorizeOutcome", () => {
  const cases: [IngestionOutcome["status"], OutcomeCategory][] = [
    ["imported", "imported"],
    ["skipped_duplicate", "duplicate"],
    ["conflict", "conflict"],
    ["routing_error", "error"],
    ["parse_error", "error"],
    ["validation_error", "validationError"],
  ];

  for (const [status, expected] of cases) {
    it(`${status} -> ${expected}`, () => {
      expect(categorizeOutcome(status)).toBe(expected);
    });
  }

  it("validation_error non ricade MAI nella stessa categoria di routing_error/parse_error", () => {
    expect(categorizeOutcome("validation_error")).not.toBe(categorizeOutcome("routing_error"));
    expect(categorizeOutcome("validation_error")).not.toBe(categorizeOutcome("parse_error"));
  });

  it("ogni categoria e' univoca per status - nessuna sovrapposizione accidentale imported/duplicate/conflict", () => {
    const results = cases.map(([status]) => categorizeOutcome(status));
    // imported, duplicate, conflict, validationError sono 4 categorie
    // distinte + "error" condiviso SOLO da routing_error/parse_error
    // (comportamento voluto, non un bug).
    const distinct = new Set(results);
    expect(distinct.size).toBe(5); // imported, duplicate, conflict, error, validationError
  });
});

describe("OUTCOME_CATEGORY_LABEL", () => {
  it("ogni categoria ha un'etichetta italiana non vuota, distinta dalle altre", () => {
    const labels = Object.values(OUTCOME_CATEGORY_LABEL);
    expect(labels.every((l) => l.trim().length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length); // nessuna etichetta duplicata fra categorie diverse
  });

  it("l'etichetta di validationError e' testualmente distinta da quella di error", () => {
    expect(OUTCOME_CATEGORY_LABEL.validationError).not.toBe(OUTCOME_CATEGORY_LABEL.error);
    expect(OUTCOME_CATEGORY_LABEL.validationError.toLowerCase()).toContain("validazione");
    expect(OUTCOME_CATEGORY_LABEL.error.toLowerCase()).not.toContain("validazione");
  });

  it("l'etichetta di warning e' distinta sia da error sia da validationError", () => {
    expect(OUTCOME_CATEGORY_LABEL.warning).not.toBe(OUTCOME_CATEGORY_LABEL.error);
    expect(OUTCOME_CATEGORY_LABEL.warning).not.toBe(OUTCOME_CATEGORY_LABEL.validationError);
  });
});

// Messaggi distinti per duplicato legacy, conflitto legacy e conflitto
// moderno - derivati dallo status/motivo reale, mai un testo unico.
describe("describeOutcome", () => {
  it("duplicato legacy equivalente", () => {
    const outcome: IngestionOutcome = { status: "skipped_duplicate", reason: "legacy_equivalent", eventId: "e1" };
    expect(describeOutcome(outcome)).toBe("Duplicato già acquisito: contenuto identico a uno snapshot legacy già presente.");
    expect(categorizeOutcome(outcome.status)).toBe("duplicate");
  });

  it("conflitto legacy reale", () => {
    const outcome: IngestionOutcome = { status: "conflict", conflictKind: "legacy", eventId: "e2", conflictingEventId: null };
    expect(describeOutcome(outcome)).toBe(
      "Conflitto con snapshot legacy: il contenuto già presente è diverso dal file caricato. Nessuna scrittura."
    );
  });

  it("conflitto moderno", () => {
    const outcome: IngestionOutcome = { status: "conflict", conflictKind: "content", eventId: "e3", conflictingEventId: "e0" };
    expect(describeOutcome(outcome)).toBe(
      "Conflitto: esiste già un import completato per questa struttura/data con contenuto diverso. Nessuna scrittura."
    );
  });

  it("conflitto per intervallo di soggiorno parzialmente sovrapposto", () => {
    const outcome: IngestionOutcome = { status: "conflict", conflictKind: "scope_overlap", eventId: "e6", conflictingEventId: "e0" };
    expect(describeOutcome(outcome)).toBe(
      "Conflitto: esiste già un import completato per questa struttura/data su un intervallo di soggiorno parzialmente sovrapposto. Nessuna scrittura."
    );
    expect(categorizeOutcome(outcome.status)).toBe("conflict");
  });

  it("duplicati moderni invariati", () => {
    expect(describeOutcome({ status: "skipped_duplicate", reason: "exact_duplicate", eventId: "e4" })).toMatch(/^Duplicato esatto/);
    expect(describeOutcome({ status: "skipped_duplicate", reason: "semantic_duplicate", eventId: "e5" })).toMatch(/^Duplicato semantico/);
  });
});

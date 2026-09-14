import { describe, expect, it } from "vitest";
import { categorizeOutcome, OUTCOME_CATEGORY_LABEL, OutcomeCategory } from "../outcomeCategory";
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

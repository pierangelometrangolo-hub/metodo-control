import { describe, expect, it } from "vitest";
import { decideCommissionWrite } from "../commissionRates";

describe("decideCommissionWrite — nessuna sovrascrittura silenziosa", () => {
  it("nessuna riga per struttura/canale/mese -> insert", () => {
    expect(decideCommissionWrite(null, { commissionPct: 18, source: "fattura" })).toEqual({ action: "insert" });
  });

  it("stessa percentuale (a 2 decimali) e stessa fonte -> nessuna modifica", () => {
    const existing = { commission_pct: "18.00", source: "fattura" as const, source_reference: "FT-1" };
    expect(decideCommissionWrite(existing, { commissionPct: 17.999, source: "fattura" })).toEqual({ action: "unchanged" });
  });

  it("percentuale diversa -> richiede conferma, riportando il valore esistente", () => {
    const existing = { commission_pct: 18, source: "fattura" as const, source_reference: "FT-1" };
    expect(decideCommissionWrite(existing, { commissionPct: 22.99, source: "fattura" })).toEqual({
      action: "confirm_replace",
      existing,
    });
  });

  it("stessa percentuale ma fonte diversa (stima -> fattura) -> richiede conferma", () => {
    const existing = { commission_pct: 18, source: "stima" as const, source_reference: null };
    expect(decideCommissionWrite(existing, { commissionPct: 18, source: "fattura" }).action).toBe("confirm_replace");
  });
});

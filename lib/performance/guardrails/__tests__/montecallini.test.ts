import { describe, expect, it } from "vitest";
import { runMontecalliniGuardrails } from "../montecallini";
import type { GuardrailSnapshotRow } from "../types";

function row(overrides: Partial<GuardrailSnapshotRow> = {}): GuardrailSnapshotRow {
  return {
    stayDate: "2026-07-01",
    revenueTotal: 8392.41,
    roomsSold: 46,
    roomsAvailable: 48,
    arrivals: null,
    presences: 90,
    ...overrides,
  };
}

describe("GR-MC-REV01 - coerenza RevPAR Montecallini", () => {
  it("RPAR assente -> nessuna finding (no-op)", () => {
    expect(runMontecalliniGuardrails([row()])).toHaveLength(0);
  });

  it("RevPAR ricalcolato coerente con l'RPAR dichiarato -> nessuna finding", () => {
    // 8392.41 / 48 = 174.84 (valore reale del file LUG per il 01/07)
    const findings = runMontecalliniGuardrails([
      row({ revenueTotal: 8392.41, roomsAvailable: 48, sourceKpi: { occupancyFraction: null, revpar: 174.84, adr: null } }),
    ]);
    expect(findings).toHaveLength(0);
  });

  it("RevPAR ricalcolato fuori tolleranza rispetto all'RPAR -> WARNING (mai blocking)", () => {
    const findings = runMontecalliniGuardrails([
      row({ revenueTotal: 8392.41, roomsAvailable: 48, sourceKpi: { occupancyFraction: null, revpar: 90, adr: null } }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("GR-MC-REV01");
    expect(findings[0].severity).toBe("warning");
  });

  it("rooms_available = 0 -> nessuna finding (no-op)", () => {
    const findings = runMontecalliniGuardrails([
      row({ roomsAvailable: 0, sourceKpi: { occupancyFraction: null, revpar: 100, adr: null } }),
    ]);
    expect(findings).toHaveLength(0);
  });

  it("scarto sotto la tolleranza unificata (0,50 assoluti) -> nessun warning anche su valori piccoli", () => {
    // regressione sull'1%-secco del vecchio parser: revenue/CV = 2.00, RPAR
    // dichiarato 2.30 -> scarto 0,30 < 0,50 -> nessuna finding
    const findings = runMontecalliniGuardrails([
      row({ revenueTotal: 96, roomsAvailable: 48, sourceKpi: { occupancyFraction: null, revpar: 2.3, adr: null } }),
    ]);
    expect(findings).toHaveLength(0);
  });
});

import { describe, expect, it } from "vitest";
import { runAdrRevparGuardrails } from "../adrRevpar";
import { runGuardrails } from "../runner";
import type { GuardrailSnapshotRow } from "../types";

function row(overrides: Partial<GuardrailSnapshotRow> = {}): GuardrailSnapshotRow {
  return {
    stayDate: "2026-01-03",
    revenueTotal: 882.34,
    roomsSold: 6,
    roomsAvailable: 9,
    arrivals: 4,
    presences: 12,
    ...overrides,
  };
}

describe("GR-ADR-OCC01 - coerenza Occupancy Booking Designer", () => {
  it("IMO assente (sourceKpi undefined) -> nessuna finding (no-op)", () => {
    expect(runAdrRevparGuardrails([row()])).toHaveLength(0);
  });

  it("IMO presente e null -> nessuna finding (no-op)", () => {
    const findings = runAdrRevparGuardrails([row({ sourceKpi: { occupancyFraction: null, revpar: null, adr: null } })]);
    expect(findings).toHaveLength(0);
  });

  it("Occupancy ricalcolata coerente con l'IMO dichiarato -> nessuna finding", () => {
    // 6/9 = 0.6667, IMO reale del file Villa Neviera per il 03/01 = "66.67 %"
    const findings = runAdrRevparGuardrails([
      row({ roomsSold: 6, roomsAvailable: 9, sourceKpi: { occupancyFraction: 0.6667, revpar: null, adr: null } }),
    ]);
    expect(findings).toHaveLength(0);
  });

  it("Occupancy ricalcolata fuori tolleranza rispetto all'IMO -> WARNING", () => {
    const findings = runAdrRevparGuardrails([
      row({ roomsSold: 6, roomsAvailable: 9, sourceKpi: { occupancyFraction: 0.30, revpar: null, adr: null } }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("GR-ADR-OCC01");
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].dataset).toBe("adr_revpar");
  });

  it("rooms_available = 0 -> nessuna finding (Occupancy non definita, no-op)", () => {
    const findings = runAdrRevparGuardrails([
      row({ roomsSold: 0, roomsAvailable: 0, sourceKpi: { occupancyFraction: 0.5, revpar: null, adr: null } }),
    ]);
    expect(findings).toHaveLength(0);
  });

  it("SEPARATO dal voto Revenue: un IMO discorde NON scarta ne' blocca la riga (solo warning)", () => {
    const result = runGuardrails({
      dataset: "adr_revpar",
      rows: [row({ roomsSold: 6, roomsAvailable: 9, sourceKpi: { occupancyFraction: 0.10, revpar: null, adr: null } })],
    });
    expect(result.hasBlockingFindings).toBe(false);
    expect(result.findings.every((f) => f.severity !== "blocking")).toBe(true);
  });
});

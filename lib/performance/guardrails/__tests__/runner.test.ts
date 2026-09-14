import { describe, expect, it } from "vitest";
import { GUARDRAILS_SHADOW_MODE, groupFindingsForDisplay, runGuardrails } from "../runner";
import { GUARDRAIL_REGISTRY } from "../registry";
import type { GuardrailSnapshotRow } from "../types";

function row(overrides: Partial<GuardrailSnapshotRow> = {}): GuardrailSnapshotRow {
  return {
    stayDate: "2026-06-01",
    revenueTotal: 1000,
    roomsSold: 8,
    roomsAvailable: 10,
    arrivals: 3,
    presences: 16,
    ...overrides,
  };
}

describe("GUARDRAILS_SHADOW_MODE", () => {
  it("STEP 3: e' FALSE - enforcement attivo, importService legge davvero hasBlockingFindings", () => {
    expect(GUARDRAILS_SHADOW_MODE).toBe(false);
  });
});

describe("runGuardrails - purezza e determinismo", () => {
  it("NON muta l'array ne' le righe passate in input", () => {
    const rows = Object.freeze([
      Object.freeze(row({ stayDate: "2026-06-02", roomsSold: -1 })),
      Object.freeze(row({ stayDate: "2026-06-01" })),
    ]) as readonly GuardrailSnapshotRow[];

    expect(() => runGuardrails({ dataset: "adr_revpar", rows })).not.toThrow();
    expect(rows).toHaveLength(2);
    expect(rows[0].stayDate).toBe("2026-06-02");
    expect(rows[1].stayDate).toBe("2026-06-01");
  });

  it("stesso insieme di righe in ordine diverso -> stesso elenco di findings nello stesso ordine", () => {
    const a = [
      row({ stayDate: "2026-06-03", roomsSold: -1 }),
      row({ stayDate: "2026-06-01", revenueTotal: -5 }),
      row({ stayDate: "2026-06-02", roomsSold: 12, roomsAvailable: 10 }),
    ];
    const b = [a[2], a[0], a[1]];

    const fa = runGuardrails({ dataset: "adr_revpar", rows: a }).findings;
    const fb = runGuardrails({ dataset: "adr_revpar", rows: b }).findings;

    expect(fb.map((f) => `${f.id}|${f.stayDate}`)).toEqual(fa.map((f) => `${f.id}|${f.stayDate}`));
  });

  it("ordina per ordine di registry, poi per stayDate", () => {
    const rows = [
      row({ stayDate: "2026-06-05", roomsSold: -1 }), // GR-C01-QTY
      row({ stayDate: "2026-06-01", roomsSold: -1 }), // GR-C01-QTY
      row({ stayDate: "2026-06-03", revenueTotal: -1 }), // GR-C01-REV
    ];
    const ids = runGuardrails({ dataset: "adr_revpar", rows }).findings.map((f) => `${f.id}|${f.stayDate}`);
    expect(ids).toEqual(["GR-C01-QTY|2026-06-01", "GR-C01-QTY|2026-06-05", "GR-C01-REV|2026-06-03"]);
  });

  it("hasBlockingFindings true se e solo se esiste una finding severity 'blocking'", () => {
    expect(runGuardrails({ dataset: "adr_revpar", rows: [row()] }).hasBlockingFindings).toBe(false);
    expect(
      runGuardrails({ dataset: "adr_revpar", rows: [row({ roomsSold: -1 })] }).hasBlockingFindings
    ).toBe(true);
    // GR-C04 (warning) da solo non alza il flag
    expect(
      runGuardrails({ dataset: "adr_revpar", rows: [row({ revenueTotal: 100, roomsSold: 0 })] }).hasBlockingFindings
    ).toBe(false);
  });

  it("ogni finding ha i campi minimi del contratto", () => {
    const findings = runGuardrails({ dataset: "adr_revpar", rows: [row({ roomsSold: -1 })] }).findings;
    for (const f of findings) {
      expect(typeof f.id).toBe("string");
      expect(f.dataset).toBe("adr_revpar");
      expect(["blocking", "warning", "info"]).toContain(f.severity);
      expect(["file", "row"]).toContain(f.scope);
      expect(f).toHaveProperty("stayDate");
      expect(f).toHaveProperty("nationality");
      expect(typeof f.message).toBe("string");
    }
  });

  it("montecallini: esegue le regole comuni + GR-MC-REV01, mai GR-ADR-OCC01", () => {
    const rows = [
      row({ roomsSold: -1 }),
      row({ stayDate: "2026-06-02", sourceKpi: { occupancyFraction: 0.99, revpar: 5, adr: null } }),
    ];
    const ids = new Set(runGuardrails({ dataset: "montecallini_pms", rows }).findings.map((f) => f.id));
    expect(ids.has("GR-C01-QTY")).toBe(true);
    expect(ids.has("GR-ADR-OCC01")).toBe(false);
  });
});

describe("groupFindingsForDisplay", () => {
  it("raggruppa per id, conta e tronca gli esempi", () => {
    const rows = Array.from({ length: 5 }, (_, i) => row({ stayDate: `2026-06-0${i + 1}`, revenueTotal: 50, roomsSold: 0 }));
    const findings = runGuardrails({ dataset: "adr_revpar", rows }).findings;
    const groups = groupFindingsForDisplay(findings, 2);
    const c04 = groups.find((g) => g.id === "GR-C04")!;
    expect(c04.count).toBe(5);
    expect(c04.examples).toHaveLength(2);
    expect(c04.hiddenCount).toBe(3);
    expect(c04.title).toBe(GUARDRAIL_REGISTRY.find((m) => m.id === "GR-C04")!.title);
  });
});

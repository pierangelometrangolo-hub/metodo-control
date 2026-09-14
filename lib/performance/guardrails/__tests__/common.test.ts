import { describe, expect, it } from "vitest";
import { runCommonSnapshotGuardrails } from "../common";
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

describe("GR-C01 - valori negativi", () => {
  it("quantita' negativa (camere vendute) -> finding BLOCKING candidata", () => {
    const findings = runCommonSnapshotGuardrails("adr_revpar", [row({ roomsSold: -1 })]);
    const c01 = findings.find((f) => f.id === "GR-C01-QTY");
    expect(c01).toBeDefined();
    expect(c01!.severity).toBe("blocking");
    expect(c01!.scope).toBe("row");
    expect(c01!.stayDate).toBe("2026-06-01");
  });

  it("camere disponibili / arrivi / presenze negative -> tutte segnalate in un'unica finding", () => {
    const findings = runCommonSnapshotGuardrails("montecallini_pms", [
      row({ roomsAvailable: -5, arrivals: -2, presences: -1 }),
    ]);
    const c01 = findings.filter((f) => f.id === "GR-C01-QTY");
    expect(c01).toHaveLength(1);
    expect(c01[0].context?.negativeQuantities).toEqual([
      "camere disponibili = -5",
      "arrivi = -2",
      "presenze = -1",
    ]);
  });

  it("arrivals = null (Montecallini) non produce mai una finding negativa", () => {
    const findings = runCommonSnapshotGuardrails("montecallini_pms", [row({ arrivals: null })]);
    expect(findings.filter((f) => f.id === "GR-C01-QTY")).toHaveLength(0);
  });

  it("ricavo negativo -> WARNING, mai blocking", () => {
    const findings = runCommonSnapshotGuardrails("adr_revpar", [row({ revenueTotal: -300 })]);
    const rev = findings.find((f) => f.id === "GR-C01-REV");
    expect(rev).toBeDefined();
    expect(rev!.severity).toBe("warning");
    expect(findings.some((f) => f.id === "GR-C01-QTY")).toBe(false);
  });
});

describe("GR-C02 - rooms_sold > rooms_available", () => {
  it("Booking Designer: nuova finding, severity WARNING (shadow, non promossa a blocking)", () => {
    const findings = runCommonSnapshotGuardrails("adr_revpar", [row({ roomsSold: 12, roomsAvailable: 10 })]);
    const c02 = findings.find((f) => f.id === "GR-C02");
    expect(c02).toBeDefined();
    expect(c02!.severity).toBe("warning");
  });

  it("nessuna finding quando rooms_sold === rooms_available (confine incluso)", () => {
    const findings = runCommonSnapshotGuardrails("adr_revpar", [row({ roomsSold: 10, roomsAvailable: 10 })]);
    expect(findings.some((f) => f.id === "GR-C02")).toBe(false);
  });
});

describe("GR-C03 - inventario a zero con attivita'", () => {
  it("rooms_available = 0 con camere vendute -> WARNING", () => {
    const findings = runCommonSnapshotGuardrails("adr_revpar", [row({ roomsAvailable: 0, roomsSold: 2, revenueTotal: 0 })]);
    const c03 = findings.find((f) => f.id === "GR-C03");
    expect(c03?.severity).toBe("warning");
  });

  it("rooms_available = 0 con solo ricavo -> WARNING", () => {
    const findings = runCommonSnapshotGuardrails("montecallini_pms", [row({ roomsAvailable: 0, roomsSold: 0, revenueTotal: 50 })]);
    expect(findings.some((f) => f.id === "GR-C03")).toBe(true);
  });

  it("CASO LEGITTIMO: struttura chiusa 0/0/0 -> nessuna finding GR-C03", () => {
    const findings = runCommonSnapshotGuardrails("montecallini_pms", [
      row({ roomsAvailable: 0, roomsSold: 0, revenueTotal: 0, arrivals: null, presences: 0 }),
    ]);
    expect(findings.some((f) => f.id === "GR-C03")).toBe(false);
    // e nemmeno GR-C04/C05: 0 e 0 non sono ne' "ricavo senza camere" ne' "camere senza ricavo"
    expect(findings.some((f) => f.id === "GR-C04" || f.id === "GR-C05")).toBe(false);
  });
});

describe("GR-C04 - ricavo senza camere vendute", () => {
  it("revenue > 0 e rooms_sold = 0 -> WARNING, riga comunque importabile", () => {
    const findings = runCommonSnapshotGuardrails("adr_revpar", [row({ revenueTotal: 106, roomsSold: 0 })]);
    const c04 = findings.find((f) => f.id === "GR-C04");
    expect(c04?.severity).toBe("warning");
  });
});

describe("GR-C05 - camere vendute senza ricavo", () => {
  it("rooms_sold > 0 e revenue = 0 -> WARNING", () => {
    const findings = runCommonSnapshotGuardrails("montecallini_pms", [row({ roomsSold: 3, revenueTotal: 0 })]);
    expect(findings.find((f) => f.id === "GR-C05")?.severity).toBe("warning");
  });

  it("revenue piccolo ma > 0 -> nessuna finding GR-C05 (confronto con 0 esatto, mai una soglia)", () => {
    const findings = runCommonSnapshotGuardrails("montecallini_pms", [row({ roomsSold: 3, revenueTotal: 0.01 })]);
    expect(findings.some((f) => f.id === "GR-C05")).toBe(false);
  });
});

describe("GR-C06 - chiave duplicata nello stesso file (NON deduplica, NON collassa)", () => {
  it("stesso stay_date due volte con valori diversi -> una sola finding BLOCKING-FILE", () => {
    const rows = [
      row({ stayDate: "2026-06-01", revenueTotal: 1000 }),
      row({ stayDate: "2026-06-01", revenueTotal: 1200 }),
      row({ stayDate: "2026-06-02" }),
    ];
    const findings = runCommonSnapshotGuardrails("adr_revpar", rows);
    const c06 = findings.filter((f) => f.id === "GR-C06");
    expect(c06).toHaveLength(1);
    expect(c06[0].severity).toBe("blocking");
    expect(c06[0].scope).toBe("file");
    expect(c06[0].context?.duplicatedStayDates).toEqual(["2026-06-01"]);
    expect(c06[0].context?.totalExtraRows).toBe(1);
  });

  it("il runner comune NON rimuove ne' fonde le righe duplicate (input non mutato, nessun filtro)", () => {
    const rows = [row({ stayDate: "2026-06-01" }), row({ stayDate: "2026-06-01" })];
    const before = rows.length;
    runCommonSnapshotGuardrails("adr_revpar", rows);
    expect(rows).toHaveLength(before);
  });

  it("stesso stay_date IDENTICO byte per byte -> comunque una finding BLOCKING-FILE (nessuna eccezione 'byte-identici' in V0)", () => {
    const rows = [row({ stayDate: "2026-06-01" }), row({ stayDate: "2026-06-01" })];
    const findings = runCommonSnapshotGuardrails("adr_revpar", rows);
    expect(findings.filter((f) => f.id === "GR-C06")).toHaveLength(1);
  });

  it("nessun duplicato -> nessuna finding GR-C06", () => {
    const rows = [row({ stayDate: "2026-06-01" }), row({ stayDate: "2026-06-02" })];
    expect(runCommonSnapshotGuardrails("adr_revpar", rows).some((f) => f.id === "GR-C06")).toBe(false);
  });
});

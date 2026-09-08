import { describe, expect, it } from "vitest";
import {
  extractBdStructureSegment,
  resolveBookingDesignerStructure,
  resolveMontecalliniStructure,
  resolveStructureForDataset,
  structureResolutionErrorMessage,
} from "../routing";
import { StructureAlias, StructureOption } from "../types";
import { MONTECALLINI_STRUCTURE_NAME } from "../../../performanceImportRouting";

const STRUCTURES: StructureOption[] = [
  { id: "s-rollo", name: "Palazzo Rollo" },
  { id: "s-neviera", name: "Villa Neviera" },
  { id: "s-cadura", name: "Palazzo Arco Cadura" },
  { id: "s-sangiorgio", name: "Sangiorgio Resort" },
  { id: "s-belli", name: "Dimora De Belli" },
  { id: "s-montecallini", name: MONTECALLINI_STRUCTURE_NAME },
];

// Stessi 5 alias reali seminati dalla migration
// 20260908113000_structure_source_aliases.sql - qui in memoria per
// testare la funzione pura senza un database.
const ALIASES: StructureAlias[] = [
  { structureId: "s-neviera", source: "booking_designer", alias: "Villa Neviera Wine Resort" },
  { structureId: "s-belli", source: "booking_designer", alias: "Palazzo De' Belli" },
  { structureId: "s-sangiorgio", source: "booking_designer", alias: "Sangiorgio Resort _____" },
  { structureId: "s-cadura", source: "booking_designer", alias: "Palazzo Arco Cadura Hotel & SPA" },
  { structureId: "s-rollo", source: "booking_designer", alias: "Palazzo Rollo" },
];

describe("extractBdStructureSegment - estrazione deterministica del segmento struttura dal filename BD", () => {
  it("[caso reale] filename ADR - RevPAR", () => {
    expect(extractBdStructureSegment("ADR - RevPAR (01 Gen 2026 - 31 Dic 2026) - Palazzo De' Belli - 2026-09-08.csv")).toBe(
      "Palazzo De' Belli"
    );
  });

  it("[caso reale] filename Ospiti per provenienza", () => {
    expect(
      extractBdStructureSegment("Ospiti per provenienza (01 Gen 2026 - 31 Dic 2026) - Palazzo De' Belli - 2026-09-01.csv")
    ).toBe("Palazzo De' Belli");
  });

  it("[caso reale] segmento con caratteri spuri preservato esattamente", () => {
    expect(extractBdStructureSegment("ADR - RevPAR (01 Gen 2026 - 31 Dic 2026) - Sangiorgio Resort _____ - 2026-08-19.xls")).toBe(
      "Sangiorgio Resort _____"
    );
  });

  it("filename che non rispetta lo schema atteso -> null, mai un'estrazione approssimativa", () => {
    expect(extractBdStructureSegment("report_generico.xls")).toBeNull();
    expect(extractBdStructureSegment("Confronto Palazzo Rollo e Villa Neviera.csv")).toBeNull();
  });
});

describe("resolveBookingDesignerStructure - match ESATTO contro alias (mai fuzzy/contains)", () => {
  it("F. alias exact match -> resolved", () => {
    const result = resolveBookingDesignerStructure(
      "ADR - RevPAR (01 Gen 2026 - 31 Dic 2026) - Palazzo Rollo - 2026-09-08.csv",
      ALIASES,
      STRUCTURES
    );
    expect(result).toEqual({ kind: "resolved", structureId: "s-rollo", structureName: "Palazzo Rollo" });
  });

  it("mapping PMS: 'Palazzo De' Belli' -> Dimora De Belli", () => {
    const result = resolveBookingDesignerStructure(
      "ADR - RevPAR (01 Gen 2026 - 31 Dic 2026) - Palazzo De' Belli - 2026-09-08.csv",
      ALIASES,
      STRUCTURES
    );
    expect(result).toEqual({ kind: "resolved", structureId: "s-belli", structureName: "Dimora De Belli" });
  });

  it("mapping PMS: 'Villa Neviera Wine Resort' -> Villa Neviera", () => {
    const result = resolveBookingDesignerStructure(
      "Ospiti per provenienza (01 Gen 2026 - 31 Dic 2026) - Villa Neviera Wine Resort - 2026-09-01.csv",
      ALIASES,
      STRUCTURES
    );
    expect(result).toEqual({ kind: "resolved", structureId: "s-neviera", structureName: "Villa Neviera" });
  });

  it("mapping PMS: 'Palazzo Arco Cadura Hotel & SPA' -> Palazzo Arco Cadura", () => {
    const result = resolveBookingDesignerStructure(
      "Ospiti per provenienza (01 Gen 2026 - 31 Dic 2026) - Palazzo Arco Cadura Hotel & SPA - 2026-09-01.csv",
      ALIASES,
      STRUCTURES
    );
    expect(result).toEqual({ kind: "resolved", structureId: "s-cadura", structureName: "Palazzo Arco Cadura" });
  });

  it("[caso reale] 'Sangiorgio Resort _____' (caratteri spuri BD) -> Sangiorgio Resort", () => {
    const result = resolveBookingDesignerStructure(
      "ADR - RevPAR (01 Gen 2026 - 31 Dic 2026) - Sangiorgio Resort _____ - 2026-08-19.xls",
      ALIASES,
      STRUCTURES
    );
    expect(result).toEqual({ kind: "resolved", structureId: "s-sangiorgio", structureName: "Sangiorgio Resort" });
  });

  it("mismatch: file Palazzo Rollo risolve su Palazzo Rollo, mai su un'altra struttura selezionata a caso (Villa Neviera)", () => {
    const result = resolveBookingDesignerStructure(
      "ADR - RevPAR (01 Gen 2026 - 31 Dic 2026) - Palazzo Rollo - 2026-09-08.csv",
      ALIASES,
      STRUCTURES
    );
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") expect(result.structureId).not.toBe("s-neviera");
  });

  it("mapping errato: 'Palazzo De' Belli' non risolve mai su Palazzo Rollo", () => {
    const result = resolveBookingDesignerStructure(
      "ADR - RevPAR (01 Gen 2026 - 31 Dic 2026) - Palazzo De' Belli - 2026-09-08.csv",
      ALIASES,
      STRUCTURES
    );
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") expect(result.structureId).toBe("s-belli");
  });

  it("G. alias 0 match -> not_found (struttura non riconosciuta, mai un fallback)", () => {
    const result = resolveBookingDesignerStructure(
      "ADR - RevPAR (01 Gen 2026 - 31 Dic 2026) - Struttura Sconosciuta - 2026-09-08.csv",
      ALIASES,
      STRUCTURES
    );
    expect(result).toEqual({ kind: "not_found" });
  });

  it("filename che non rispetta lo schema atteso -> not_found, mai un'estrazione approssimativa", () => {
    const result = resolveBookingDesignerStructure("report_rinominato_a_mano.csv", ALIASES, STRUCTURES);
    expect(result).toEqual({ kind: "not_found" });
  });

  it("H. alias >1 match -> ambiguous (BLOCCANTE, mai la 'più probabile') - stesso alias registrato per due strutture diverse", () => {
    const conflictingAliases: StructureAlias[] = [
      ...ALIASES,
      { structureId: "s-cadura", source: "booking_designer", alias: "Palazzo Rollo" }, // alias duplicato apposta, mai nel seed reale
    ];
    const result = resolveBookingDesignerStructure(
      "ADR - RevPAR (01 Gen 2026 - 31 Dic 2026) - Palazzo Rollo - 2026-09-08.csv",
      conflictingAliases,
      STRUCTURES
    );
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.candidateStructureIds.sort()).toEqual(["s-cadura", "s-rollo"]);
    }
  });

  it("alias orfano (struttura non più presente in structures) -> not_found, mai un fallback", () => {
    const orphanAliases: StructureAlias[] = [{ structureId: "s-inesistente", source: "booking_designer", alias: "Palazzo Rollo" }];
    const result = resolveBookingDesignerStructure(
      "ADR - RevPAR (01 Gen 2026 - 31 Dic 2026) - Palazzo Rollo - 2026-09-08.csv",
      orphanAliases,
      STRUCTURES
    );
    expect(result).toEqual({ kind: "not_found" });
  });
});

describe("resolveMontecalliniStructure - risoluzione per formato, mai per alias (nessun alias creato per Montecallini)", () => {
  it("risolve sempre sulla struttura chiamata esattamente 'Montecallini'", () => {
    const result = resolveMontecalliniStructure(STRUCTURES);
    expect(result).toEqual({ kind: "resolved", structureId: "s-montecallini", structureName: MONTECALLINI_STRUCTURE_NAME });
  });

  it("nessuna struttura 'Montecallini' presente -> not_found", () => {
    const result = resolveMontecalliniStructure(STRUCTURES.filter((s) => s.name !== MONTECALLINI_STRUCTURE_NAME));
    expect(result).toEqual({ kind: "not_found" });
  });
});

describe("resolveStructureForDataset - dispatch per dataset", () => {
  it("montecallini_pms -> risoluzione per formato (ignora filename e aliases)", () => {
    const result = resolveStructureForDataset("montecallini_pms", "PlanningForecast (MAGG).csv", [], STRUCTURES);
    expect(result).toEqual({ kind: "resolved", structureId: "s-montecallini", structureName: MONTECALLINI_STRUCTURE_NAME });
  });

  it("adr_revpar / nationality -> risoluzione via alias DB", () => {
    const result = resolveStructureForDataset(
      "adr_revpar",
      "ADR - RevPAR (01 Gen 2026 - 31 Dic 2026) - Palazzo Rollo - 2026-09-08.csv",
      ALIASES,
      STRUCTURES
    );
    expect(result).toEqual({ kind: "resolved", structureId: "s-rollo", structureName: "Palazzo Rollo" });
  });
});

describe("structureResolutionErrorMessage", () => {
  it("not_found -> messaggio 'impossibile identificare con sicurezza'", () => {
    expect(structureResolutionErrorMessage({ kind: "not_found" }, STRUCTURES)).toContain("Impossibile identificare con sicurezza");
  });

  it("ambiguous -> nomina le strutture candidate", () => {
    const msg = structureResolutionErrorMessage({ kind: "ambiguous", candidateStructureIds: ["s-rollo", "s-cadura"] }, STRUCTURES);
    expect(msg).toContain("Palazzo Rollo");
    expect(msg).toContain("Palazzo Arco Cadura");
  });
});

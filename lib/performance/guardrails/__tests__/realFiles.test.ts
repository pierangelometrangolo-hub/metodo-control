import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { parseBdExportCsv, parseBdExportWorkbook } from "../../../bdExportParser";
import { parseMontecalliniPmsCsv } from "../../../montecalliniPmsParser";
import { parseNationalityWorkbook } from "../../../nationalityParser";
import { runGuardrails } from "../runner";
import type { GuardrailFinding, GuardrailSnapshotRow } from "../types";

// ============ Guardrails V0 - esecuzione sui file REALI gia' validati ============
//
// Regola (dal prompt STEP 2): se un candidate-blocking (severity="blocking")
// scatta su un file gia' validato come corretto, NON si abbassa la severity
// in automatico - il test FALLISCE, ed e' il segnale per una revisione
// umana (possibile falso positivo del guardrail, non un problema del file).
//
// I warning invece sono attesi e vengono solo STAMPATI (report diagnostico),
// mai trattati come fallimento.

const BD_DIR = path.join(process.cwd(), ".local-imports", "bd_villa_neviera_2026-09-01");
const BD_CSV = "ADR - RevPAR (01 Gen 2026 - 31 Dic 2026) - Villa Neviera Wine Resort - 2026-09-01.csv";
const BD_XLS = "ADR - RevPAR (01 Gen 2026 - 31 Dic 2026) - Villa Neviera Wine Resort - 2026-09-01.xls";
const MC_DIR = path.join(process.cwd(), ".local-imports", "montecallini_planningforecast_maggio_ottobre_2026");
const MC_FILES = [
  "PlanningForecast (MAGG).csv",
  "PlanningForecast (GIUG).csv",
  "PlanningForecast (LUG).csv",
  "PlanningForecast (AGO).csv",
  "PlanningForecast (SETT).csv",
  "PlanningForecast (OTT).csv",
];
const NAT_DIR = path.join(process.cwd(), ".local-imports", "nationality_palazzo_debelli_2026-09-01");
const NAT_XLS = "Ospiti per provenienza (01 Gen 2026 - 31 Dic 2026) - Palazzo De' Belli - 2026-09-01.xls";

const bdAvailable = fs.existsSync(path.join(BD_DIR, BD_CSV)) && fs.existsSync(path.join(BD_DIR, BD_XLS));
const mcAvailable = MC_FILES.every((f) => fs.existsSync(path.join(MC_DIR, f)));
const natAvailable = fs.existsSync(path.join(NAT_DIR, NAT_XLS));

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function snapshotRows(
  rows: { stayDate: string; revenueTotal: number; roomsSold: number; roomsAvailable: number; arrivals: number | null; presences: number }[],
  sourceKpiByRow: GuardrailSnapshotRow["sourceKpi"][]
): GuardrailSnapshotRow[] {
  return rows.map((r, i) => ({ ...r, sourceKpi: sourceKpiByRow[i] }));
}

function report(label: string, findings: GuardrailFinding[]) {
  const byId = new Map<string, number>();
  for (const f of findings) byId.set(`${f.severity}/${f.id}`, (byId.get(`${f.severity}/${f.id}`) ?? 0) + 1);
  const summary = [...byId.entries()].map(([k, n]) => `${k}=${n}`).join(", ") || "nessuna finding";
  console.log(`[Guardrails V0 real-file] ${label}: ${summary}`);
  for (const f of findings.slice(0, 8)) {
    console.log(`    - [${f.severity}] ${f.id} ${f.stayDate ?? ""}: ${f.message}`);
  }
}

function candidateBlocking(findings: GuardrailFinding[]) {
  return findings.filter((f) => f.severity === "blocking");
}

describe.skipIf(!bdAvailable)("Villa Neviera BD reale 2026-09-01", () => {
  const csv = parseBdExportCsv(fs.readFileSync(path.join(BD_DIR, BD_CSV), "utf-8"));
  const xls = parseBdExportWorkbook(toArrayBuffer(fs.readFileSync(path.join(BD_DIR, BD_XLS))));

  const csvFindings = runGuardrails({
    dataset: "adr_revpar",
    rows: snapshotRows(csv.rows, csv.sourceKpiByRow),
  }).findings;
  const xlsFindings = runGuardrails({
    dataset: "adr_revpar",
    rows: snapshotRows(xls.rows, xls.sourceKpiByRow),
  }).findings;

  it("REPORT diagnostico", () => {
    report("Villa Neviera CSV (365 righe)", csvFindings);
    report("Villa Neviera XLS (364 righe)", xlsFindings);
    expect(true).toBe(true);
  });

  it("nessun candidate-blocking sul file validato come corretto (se scatta -> revisione umana del guardrail)", () => {
    expect(candidateBlocking(csvFindings)).toHaveLength(0);
    expect(candidateBlocking(xlsFindings)).toHaveLength(0);
  });

  it("GR-C06: nessun stay_date duplicato (365 giorni unici)", () => {
    expect(csvFindings.some((f) => f.id === "GR-C06")).toBe(false);
  });

  it("GR-C04 atteso sui 2 giorni noti a 0 camere vendute con ricavo (04 Gen, 15 Feb) - WARNING, non bloccante", () => {
    const c04 = csvFindings.filter((f) => f.id === "GR-C04");
    expect(c04.map((f) => f.stayDate).sort()).toEqual(["2026-01-04", "2026-02-15"]);
    expect(c04.every((f) => f.severity === "warning")).toBe(true);
  });

  // ---- Casi reali che dimostrano perche' alcune regole NON vanno promosse a blocking ----

  it("GR-C02 su dato reale VALIDATO: 17/07/2026 ha rooms_sold=10 > rooms_available=9 (overbooking, IMO dichiarato 111%). Solo WARNING - un blocco qui scarterebbe un giorno corretto", () => {
    const c02 = csvFindings.filter((f) => f.id === "GR-C02");
    expect(c02.map((f) => f.stayDate)).toEqual(["2026-07-17"]);
    expect(c02[0].severity).toBe("warning");
  });

  it("GR-C01-REV su dato reale VALIDATO: 23/02/2026 ha revenue -119 (storno). Solo WARNING, mai una quantita' negativa", () => {
    const revNeg = csvFindings.filter((f) => f.id === "GR-C01-REV");
    expect(revNeg.map((f) => f.stayDate)).toEqual(["2026-02-23"]);
    expect(revNeg[0].severity).toBe("warning");
    // e NESSUN GR-C01-QTY: le quantita' (camere/arrivi/presenze) restano non negative
    expect(csvFindings.some((f) => f.id === "GR-C01-QTY")).toBe(false);
  });

  it("GR-ADR-OCC01: nessuna finding - l'IMO del file coincide sempre con rooms_sold/rooms_available", () => {
    expect(csvFindings.some((f) => f.id === "GR-ADR-OCC01")).toBe(false);
    expect(xlsFindings.some((f) => f.id === "GR-ADR-OCC01")).toBe(false);
  });

  it("conferma audit: l'IMO sorgente rappresenta davvero rooms_sold/rooms_available (entro arrotondamento)", () => {
    for (let i = 0; i < csv.rows.length; i++) {
      const r = csv.rows[i];
      const imo = csv.sourceKpiByRow[i]?.occupancyFraction;
      if (imo === null || imo === undefined || r.roomsAvailable === 0) continue;
      expect(Math.abs(r.roomsSold / r.roomsAvailable - imo)).toBeLessThanOrEqual(0.006);
    }
  });
});

describe.skipIf(!mcAvailable)("Montecallini PlanningForecast reali maggio-ottobre 2026", () => {
  for (const file of MC_FILES) {
    const parsed = parseMontecalliniPmsCsv(fs.readFileSync(path.join(MC_DIR, file), "utf-8"));

    describe(file, () => {
      // Un run per kind, come fa importService.
      const kinds = ["cy", "sdly", "ly"] as const;
      const findingsByKind = kinds.map((kind) => {
        const idx: number[] = [];
        parsed.rows.forEach((r, i) => {
          if (r.kind === kind) idx.push(i);
        });
        const rows = snapshotRows(
          idx.map((i) => parsed.rows[i]),
          idx.map((i) => parsed.sourceKpiByRow[i])
        );
        return { kind, findings: runGuardrails({ dataset: "montecallini_pms", rows }).findings };
      });

      it("REPORT diagnostico per kind", () => {
        for (const { kind, findings } of findingsByKind) report(`${file} [${kind}]`, findings);
        expect(true).toBe(true);
      });

      it("nessun candidate-blocking su nessun kind (file validato)", () => {
        for (const { findings } of findingsByKind) expect(candidateBlocking(findings)).toHaveLength(0);
      });

      it("GR-C06: nessun stay_date duplicato dentro un kind", () => {
        for (const { findings } of findingsByKind) expect(findings.some((f) => f.id === "GR-C06")).toBe(false);
      });

      it("GR-MC-REV01: nessuna finding - revenue/CV coincide sempre con l'RPAR dichiarato", () => {
        for (const { findings } of findingsByKind) expect(findings.some((f) => f.id === "GR-MC-REV01")).toBe(false);
      });
    });
  }
});

describe.skipIf(!natAvailable)("Nazionalita' Palazzo De' Belli reale 2026-09-01", () => {
  const parsed = parseNationalityWorkbook(toArrayBuffer(fs.readFileSync(path.join(NAT_DIR, NAT_XLS))));
  const findings = runGuardrails({
    dataset: "nationality",
    rows: parsed.rows.map((r) => ({ stayDate: r.stayDate, nationality: r.nationality, presences: r.presences })),
  }).findings;

  it("REPORT diagnostico", () => {
    report("Nazionalita' Palazzo De' Belli (220 righe)", findings);
    expect(true).toBe(true);
  });

  it("nessun candidate-blocking: nessuna coppia (giorno, nazionalita') duplicata nel file validato", () => {
    expect(candidateBlocking(findings)).toHaveLength(0);
    expect(findings).toHaveLength(0);
  });
});

for (const [name, ok] of [
  ["BD Villa Neviera", bdAvailable],
  ["Montecallini", mcAvailable],
  ["Nazionalita'", natAvailable],
] as const) {
  if (!ok) {
    describe(`Guardrails V0 real-file (${name}) - SALTATA`, () => {
      it.skip(`file reali non trovati - copiarli in .local-imports/ per eseguire`, () => {});
    });
  }
}

import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { parseNationalityWorkbook, ParsedNationalityRow } from "../nationalityParser";
import { resolveBdStructureFromFileName, StructureOption } from "../performanceImportRouting";

const STRUCTURES: StructureOption[] = [
  { id: "s-rollo", name: "Palazzo Rollo" },
  { id: "s-neviera", name: "Villa Neviera" },
  { id: "s-cadura", name: "Palazzo Arco Cadura" },
  { id: "s-sangiorgio", name: "Sangiorgio Resort" },
  { id: "s-belli", name: "Dimora De Belli" },
];

// Test di regressione sul file REALE export BD "Ospiti per provenienza"
// (Nazionalità) di Palazzo De' Belli, estrazione 2026-09-01 - stesso
// identico export scaricato in entrambi i formati (.csv e .xls) dallo
// stesso pannello BD, che ha fatto emergere il bug originale (intestazione
// gerarchica a due righe interpretata come intestazione piatta). Gira solo
// se i file sono presenti in .local-imports/ (gitignored, mai committati -
// vedi .gitignore); su una macchina/CI senza quei file la suite li salta
// esplicitamente invece di fallire, cosi' il resto della suite
// (nationalityParser.test.ts, con fixture minime permanenti) resta l'unica
// garanzia obbligatoria in CI.
const REAL_FILES_DIR = path.join(process.cwd(), ".local-imports", "nationality_palazzo_debelli_2026-09-01");
const CSV_FILE = "Ospiti per provenienza (01 Gen 2026 - 31 Dic 2026) - Palazzo De' Belli - 2026-09-01.csv";
const XLS_FILE = "Ospiti per provenienza (01 Gen 2026 - 31 Dic 2026) - Palazzo De' Belli - 2026-09-01.xls";

const filesAvailable = fs.existsSync(path.join(REAL_FILES_DIR, CSV_FILE)) && fs.existsSync(path.join(REAL_FILES_DIR, XLS_FILE));

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe.skipIf(!filesAvailable)("parseNationalityWorkbook - regressione sul file reale Palazzo De' Belli 2026-09-01", () => {
  const csvResult = parseNationalityWorkbook(toArrayBuffer(fs.readFileSync(path.join(REAL_FILES_DIR, CSV_FILE))));
  const xlsResult = parseNationalityWorkbook(toArrayBuffer(fs.readFileSync(path.join(REAL_FILES_DIR, XLS_FILE))));

  it("CSV: nessun errore, righe giorno x nazionalità riconosciute (prima del fix: 0 righe, 1 errore 'colonna Data non trovata')", () => {
    expect(csvResult.errors).toHaveLength(0);
    expect(csvResult.rows.length).toBeGreaterThan(0);
  });

  it('XLS: stesso comportamento del CSV (era GIA\' rotto anche per .xls prima del fix, stesso identico errore)', () => {
    expect(xlsResult.errors).toHaveLength(0);
    expect(xlsResult.rows.length).toBeGreaterThan(0);
  });

  it("CSV e XLS producono esattamente lo stesso insieme di righe (stesso export, due formati)", () => {
    const normalize = (rows: ParsedNationalityRow[]) => rows.map((r) => `${r.stayDate}|${r.nationality}|${r.presences}`).sort();
    expect(normalize(csvResult.rows)).toEqual(normalize(xlsResult.rows));
  });

  it("mai una riga con nazionalità 'Totali' (aggregato BD, non una nazionalità)", () => {
    expect(csvResult.rows.some((r) => r.nationality.toLowerCase() === "totali")).toBe(false);
  });

  it("mai una riga con presences <= 0 (solo combinazioni realmente riportate da BD)", () => {
    expect(csvResult.rows.every((r) => r.presences > 0)).toBe(true);
  });

  it("nazionalità con apostrofo preservata esattamente ('STATI UNITI D'AMERICA')", () => {
    expect(csvResult.rows.some((r) => r.nationality === "STATI UNITI D'AMERICA")).toBe(true);
  });

  it("la somma delle presenze importate coincide con il totale annuale dichiarato da BD nella riga di chiusura del file (629)", () => {
    const sum = csvResult.rows.reduce((s, r) => s + r.presences, 0);
    expect(sum).toBe(629);
  });

  it("nazionalità distinte riconosciute dinamicamente corrispondono a quelle realmente presenti nel file (20, nessuna hardcoded)", () => {
    const distinct = new Set(csvResult.rows.map((r) => r.nationality));
    expect(distinct.size).toBe(20);
  });

  it("test fondamentale richiesto: 220 righe, 629 presenze totali, 20 nazionalità", () => {
    expect(csvResult.rows).toHaveLength(220);
    expect(csvResult.rows.reduce((s, r) => s + r.presences, 0)).toBe(629);
    expect(new Set(csvResult.rows.map((r) => r.nationality)).size).toBe(20);
  });

  it("guardrail struttura-file: il filename reale risolve su 'Dimora De Belli' (alias PMS->DB), import consentito selezionando quella struttura", () => {
    const match = resolveBdStructureFromFileName(CSV_FILE, STRUCTURES);
    expect(match).toEqual({ kind: "resolved", structureId: "s-belli", structureName: "Dimora De Belli" });
  });

  it("guardrail struttura-file: lo stesso filename reale NON risolve su nessun'altra struttura (mai un mismatch falso positivo)", () => {
    const match = resolveBdStructureFromFileName(CSV_FILE, STRUCTURES);
    expect(match.kind).toBe("resolved");
    if (match.kind === "resolved") {
      expect(["s-rollo", "s-neviera", "s-cadura", "s-sangiorgio"]).not.toContain(match.structureId);
    }
  });
});

if (!filesAvailable) {
  describe("parseNationalityWorkbook - regressione su file reale (SALTATA)", () => {
    it.skip(
      `file reali non trovati in ${REAL_FILES_DIR} - copiarli li' (CSV + XLS dello stesso export) per eseguire il test di regressione`,
      () => {}
    );
  });
}

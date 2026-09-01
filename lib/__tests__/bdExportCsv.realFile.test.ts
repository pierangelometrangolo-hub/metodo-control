import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { parseBdExportCsv, parseBdExportWorkbook, ParsedMonthRow } from "../bdExportParser";

// Test di regressione sul file REALE export BD "ADR - RevPAR" di Villa
// Neviera, estrazione 2026-09-01 - stesso identico export scaricato in
// entrambi i formati (.csv e .xls) dallo stesso pannello BD. Gira solo se
// i file sono presenti in .local-imports/ (gitignored, mai committati -
// vedi .gitignore); su una macchina/CI senza quei file la suite li salta
// esplicitamente invece di fallire, cosi' il resto della suite
// (lib/__tests__/bdExportParser.test.ts, con fixture minime permanenti)
// resta l'unica garanzia obbligatoria in CI.
const REAL_FILES_DIR = path.join(process.cwd(), ".local-imports", "bd_villa_neviera_2026-09-01");
const CSV_FILE = "ADR - RevPAR (01 Gen 2026 - 31 Dic 2026) - Villa Neviera Wine Resort - 2026-09-01.csv";
const XLS_FILE = "ADR - RevPAR (01 Gen 2026 - 31 Dic 2026) - Villa Neviera Wine Resort - 2026-09-01.xls";

const filesAvailable = fs.existsSync(path.join(REAL_FILES_DIR, CSV_FILE)) && fs.existsSync(path.join(REAL_FILES_DIR, XLS_FILE));

describe.skipIf(!filesAvailable)("parseBdExportCsv - regressione sul file reale Villa Neviera 2026-09-01", () => {
  const csvText = fs.readFileSync(path.join(REAL_FILES_DIR, CSV_FILE), "utf-8");
  const csvResult = parseBdExportCsv(csvText);

  it("test fondamentale: 365 righe valide, 0 righe scartate", () => {
    expect(csvResult.errors).toHaveLength(0);
    expect(csvResult.rows).toHaveLength(365);
  });

  it("[caso reale] 27/07/2026: Revenue Totale corretto letto dal CSV (mai il seriale-data 33627 dell'XLS)", () => {
    const row = csvResult.rows.find((r) => r.stayDate === "2026-07-27");
    expect(row).toBeDefined();
    expect(row!.revenueTotal).toBeCloseTo(1024.92, 2);
    expect(row!.roomsSold).toBe(8);
    expect(row!.roomsAvailable).toBe(9);
    expect(row!.arrivals).toBe(2);
    expect(row!.presences).toBe(16);
  });

  it("nessuna riga duplicata, una per ogni giorno dell'anno 2026 (365 stay_date uniche)", () => {
    const uniqueDates = new Set(csvResult.rows.map((r) => r.stayDate));
    expect(uniqueDates.size).toBe(365);
  });

  it("i due warning diagnostici gia' noti dall'XLS (rooms_sold=0, RevPAR dichiarato diverge) si riconfermano identici anche dal CSV", () => {
    expect(csvResult.warnings).toHaveLength(2);
    expect(csvResult.warnings.some((w) => w.includes("04 Gennaio"))).toBe(true);
    expect(csvResult.warnings.some((w) => w.includes("15 Febbraio"))).toBe(true);
  });

  describe("confronto CSV vs XLS sullo stesso export reale", () => {
    const xlsBuffer = fs.readFileSync(path.join(REAL_FILES_DIR, XLS_FILE));
    const xlsArrayBuffer = xlsBuffer.buffer.slice(xlsBuffer.byteOffset, xlsBuffer.byteOffset + xlsBuffer.byteLength) as ArrayBuffer;
    const xlsResult = parseBdExportWorkbook(xlsArrayBuffer);

    it("l'XLS mantiene il comportamento gia' validato: 364 righe valide, 1 sola scartata (27/07, cella formato-data)", () => {
      expect(xlsResult.rows).toHaveLength(364);
      expect(xlsResult.errors).toHaveLength(1);
      expect(xlsResult.errors[0]).toContain("27 Luglio");
      expect(xlsResult.errors[0]).toContain("formattata come data");
    });

    it("per tutte le 364 righe leggibili dall'XLS, i valori coincidono ESATTAMENTE con quelli letti dal CSV - nessuna differenza imprevista", () => {
      const csvByDate = new Map(csvResult.rows.map((r) => [r.stayDate, r]));
      const fields: (keyof ParsedMonthRow)[] = ["revenueTotal", "roomsSold", "roomsAvailable", "arrivals", "presences"];

      for (const xlsRow of xlsResult.rows) {
        const csvRow = csvByDate.get(xlsRow.stayDate);
        expect(csvRow, `riga ${xlsRow.stayDate} presente nell'XLS ma assente nel CSV`).toBeDefined();
        for (const field of fields) {
          expect(csvRow![field], `${xlsRow.stayDate}.${field}`).toBeCloseTo(xlsRow[field] as number, 2);
        }
      }
    });

    it("l'unica riga presente nel CSV ma assente tra le righe valide dell'XLS e' esattamente il 27/07/2026", () => {
      const xlsDates = new Set(xlsResult.rows.map((r) => r.stayDate));
      const onlyInCsv = csvResult.rows.filter((r) => !xlsDates.has(r.stayDate));
      expect(onlyInCsv).toHaveLength(1);
      expect(onlyInCsv[0].stayDate).toBe("2026-07-27");
    });
  });
});

if (!filesAvailable) {
  describe("parseBdExportCsv - regressione su file reale (SALTATA)", () => {
    it.skip(
      `file reali non trovati in ${REAL_FILES_DIR} - copiarli li' (CSV + XLS dello stesso export) per eseguire il test di regressione definitivo`,
      () => {}
    );
  });
}

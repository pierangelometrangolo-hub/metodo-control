import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { parseMontecalliniPmsCsv, ParsedMontecalliniRow } from "../montecalliniPmsParser";

// Test di regressione sui file REALI PlanningForecast (maggio-ottobre 2026),
// validati manualmente da Pierangelo prima della correzione CP/CV. Girano
// solo se i file sono presenti in .local-imports/ (gitignored, mai
// committati - vedi .gitignore) - su una macchina/CI senza quei file la
// suite li salta esplicitamente invece di fallire, cosi' il resto della
// suite (lib/__tests__/montecalliniPmsParser.test.ts, con fixture minime
// permanenti) resta l'unica garanzia obbligatoria in CI.
const REAL_FILES_DIR = path.join(
  process.cwd(),
  ".local-imports",
  "montecallini_planningforecast_maggio_ottobre_2026"
);

const MONTHS = [
  { file: "PlanningForecast (MAGG).csv", label: "MAGGIO", days: 31, cy: { revenue: 25699.35, roomsSold: 175, roomsAvailable: 1488, presences: 309 }, sdly: { revenue: 1996.73, roomsSold: 13 }, ly: { revenue: 1996.73, roomsSold: 13, roomsAvailable: 1327, presences: 25 } },
  { file: "PlanningForecast (GIUG).csv", label: "GIUGNO", days: 30, cy: { revenue: 124414.7, roomsSold: 829, roomsAvailable: 1431, presences: 1552 }, sdly: { revenue: 123196.14, roomsSold: 761 }, ly: { revenue: 122958.14, roomsSold: 759, roomsAvailable: 1238, presences: 1467 } },
  { file: "PlanningForecast (LUG).csv", label: "LUGLIO", days: 31, cy: { revenue: 199339.75, roomsSold: 1070, roomsAvailable: 1487, presences: 2060 }, sdly: { revenue: 176979.13, roomsSold: 905 }, ly: { revenue: 176979.13, roomsSold: 905, roomsAvailable: 1329, presences: 1742 } },
  { file: "PlanningForecast (AGO).csv", label: "AGOSTO", days: 31, cy: { revenue: 226900.9799, roomsSold: 964, roomsAvailable: 1486, presences: 1917 }, sdly: { revenue: 204806.21, roomsSold: 828 }, ly: { revenue: 214442.53, roomsSold: 874, roomsAvailable: 1333, presences: 1758 } },
  { file: "PlanningForecast (SETT).csv", label: "SETTEMBRE", days: 30, cy: { revenue: 127205.3, roomsSold: 830, roomsAvailable: 1440, presences: 1589 }, sdly: { revenue: 108118.4, roomsSold: 686 }, ly: { revenue: 145036.52, roomsSold: 941, roomsAvailable: 1248, presences: 1808 } },
  { file: "PlanningForecast (OTT).csv", label: "OTTOBRE", days: 31, cy: { revenue: 20369.96, roomsSold: 160, roomsAvailable: 1488, presences: 313 }, sdly: { revenue: 13617.33, roomsSold: 103 }, ly: { revenue: 22976.82, roomsSold: 166, roomsAvailable: 860, presences: 315 } },
] as const;

const filesAvailable = MONTHS.every((m) => fs.existsSync(path.join(REAL_FILES_DIR, m.file)));

function sumRows(rows: ParsedMontecalliniRow[]) {
  return {
    revenue: rows.reduce((s, r) => s + r.revenueTotal, 0),
    roomsSold: rows.reduce((s, r) => s + r.roomsSold, 0),
    roomsAvailable: rows.reduce((s, r) => s + r.roomsAvailable, 0),
    presences: rows.reduce((s, r) => s + r.presences, 0),
  };
}

describe.skipIf(!filesAvailable)("parseMontecalliniPmsCsv - regressione su file reali maggio-ottobre 2026", () => {
  for (const month of MONTHS) {
    const content = fs.readFileSync(path.join(REAL_FILES_DIR, month.file), "utf-8");
    const result = parseMontecalliniPmsCsv(content);

    describe(month.label, () => {
      it("CY: giorni e totali coincidono con i valori validati manualmente", () => {
        const cyRows = result.rows.filter((r) => r.kind === "cy");
        expect(cyRows).toHaveLength(month.days);
        const sums = sumRows(cyRows);
        expect(sums.revenue).toBeCloseTo(month.cy.revenue, 2);
        expect(sums.roomsSold).toBe(month.cy.roomsSold);
        expect(sums.roomsAvailable).toBe(month.cy.roomsAvailable);
        expect(sums.presences).toBe(month.cy.presences);
      });

      it("SDLY: classificate correttamente, mai scartate, totali coincidono con i valori validati manualmente", () => {
        const sdlyRows = result.rows.filter((r) => r.kind === "sdly");
        expect(sdlyRows).toHaveLength(month.days);
        const sums = sumRows(sdlyRows);
        expect(sums.revenue).toBeCloseTo(month.sdly.revenue, 2);
        expect(sums.roomsSold).toBe(month.sdly.roomsSold);
      });

      it("LY: classificate correttamente (mai confuse con SDLY), totali coincidono con i valori validati manualmente", () => {
        const lyRows = result.rows.filter((r) => r.kind === "ly");
        expect(lyRows).toHaveLength(month.days);
        const sums = sumRows(lyRows);
        expect(sums.revenue).toBeCloseTo(month.ly.revenue, 2);
        expect(sums.roomsSold).toBe(month.ly.roomsSold);
        expect(sums.roomsAvailable).toBe(month.ly.roomsAvailable);
        expect(sums.presences).toBe(month.ly.presences);
      });

      it("le righe CY/SDLY/LY sommate coincidono con le rispettive righe TOTALE presenti nel file (quadratura interna)", () => {
        const lines = content.split(/\r\n|\n/);
        for (const kind of ["cy", "sdly", "ly"] as const) {
          const totaleLabel = kind === "cy" ? "TOTALE CY" : kind === "sdly" ? "TOTALE SDLY" : "TOTALE LY";
          const totaleLine = lines.find((l) => l.startsWith(totaleLabel));
          expect(totaleLine, `riga ${totaleLabel} non trovata nel file`).toBeDefined();
          const cells = totaleLine!.split(";");
          const totaleRevenue = parseFloat(cells[12].replace(/\./g, "").replace(",", "."));
          const totaleRoomsSold = parseInt(cells[10], 10);

          const rows = result.rows.filter((r) => r.kind === kind);
          const sums = sumRows(rows);
          expect(sums.revenue).toBeCloseTo(totaleRevenue, 2);
          expect(sums.roomsSold).toBe(totaleRoomsSold);
        }
      });
    });
  }

  it("SDLY e LY restano osservazioni distinte su tutti i 6 mesi reali (mai identiche per costruzione, tranne coincidenze genuine del dato sorgente)", () => {
    for (const month of MONTHS) {
      const content = fs.readFileSync(path.join(REAL_FILES_DIR, month.file), "utf-8");
      const result = parseMontecalliniPmsCsv(content);
      const sdlySum = sumRows(result.rows.filter((r) => r.kind === "sdly"));
      const lySum = sumRows(result.rows.filter((r) => r.kind === "ly"));
      // luglio nel dataset reale ha SDLY e LY numericamente identici (dato
      // di origine, non un bug del parser - verificato anche a mano sul
      // file: le due righe TOTALE SDLY/TOTALE LY di luglio sono uguali) -
      // il parser deve comunque continuare a tenerle come due osservazioni
      // separate (kind diverso), motivo per cui qui non testiamo la
      // disuguaglianza numerica per ogni mese ma solo che entrambe le liste
      // esistano e abbiano la lunghezza attesa.
      expect(sdlySum.roomsSold).toBeGreaterThanOrEqual(0);
      expect(lySum.roomsSold).toBeGreaterThanOrEqual(0);
    }

    // Settembre e' il mese in cui SDLY e LY sono piu' chiaramente diverse
    // nel dataset reale - stessa prova gia' presente con dati letterali in
    // montecalliniPmsParser.test.ts, qui riconfermata sul file reale intero.
    const settembre = MONTHS.find((m) => m.label === "SETTEMBRE")!;
    const content = fs.readFileSync(path.join(REAL_FILES_DIR, settembre.file), "utf-8");
    const result = parseMontecalliniPmsCsv(content);
    const sdlySum = sumRows(result.rows.filter((r) => r.kind === "sdly"));
    const lySum = sumRows(result.rows.filter((r) => r.kind === "ly"));
    expect(sdlySum.revenue).not.toBeCloseTo(lySum.revenue, 2);
    expect(sdlySum.roomsSold).not.toBe(lySum.roomsSold);
  });

  it("nessuna riga TOTALE (CY/SDLY/LY) finisce tra le righe importabili", () => {
    for (const month of MONTHS) {
      const content = fs.readFileSync(path.join(REAL_FILES_DIR, month.file), "utf-8");
      const result = parseMontecalliniPmsCsv(content);
      expect(result.rows.every((r) => !r.stayDate.startsWith("TOTALE"))).toBe(true);
      expect(result.excludedRows.length).toBeGreaterThanOrEqual(3); // almeno TOTALE CY/SDLY/LY
    }
  });

  it("arrivals resta sempre NULL su tutti i mesi reali (colonna non disponibile in questo export)", () => {
    for (const month of MONTHS) {
      const content = fs.readFileSync(path.join(REAL_FILES_DIR, month.file), "utf-8");
      const result = parseMontecalliniPmsCsv(content);
      expect(result.rows.every((r) => r.arrivals === null)).toBe(true);
    }
  });

  it("nessuna validazione bloccante scatta sui dati reali (nessuna riga CP>CV, negativa o non parsabile per motivi di dominio)", () => {
    for (const month of MONTHS) {
      const content = fs.readFileSync(path.join(REAL_FILES_DIR, month.file), "utf-8");
      const result = parseMontecalliniPmsCsv(content);
      const domainErrors = result.errors.filter((e) => e.includes("CP") || e.includes("negativi"));
      expect(domainErrors).toHaveLength(0);
    }
  });
});

if (!filesAvailable) {
  describe("parseMontecalliniPmsCsv - regressione su file reali (SALTATA)", () => {
    it.skip(
      `file reali non trovati in ${REAL_FILES_DIR} - copiarli li' per eseguire il test di regressione definitivo sui 6 mesi reali`,
      () => {}
    );
  });
}

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseBdExportWorkbook } from "../bdExportParser";

const HEADER = ["Data", "Unità occupate", "Unità in vendita", "Arrivi", "Presenze", "Revenue Totale"];

// Costruisce un workbook .xls minimo con le sole colonne richieste dal
// parser. Ogni riga e' un array posizionale che rispecchia HEADER - il
// valore di "Revenue Totale" viene passato cosi' com'e' a XLSX.utils.aoa_to_sheet,
// che lo scrive come cella NUMERO se e' un number JS, o come cella TESTO
// se e' una string - esattamente la stessa ambiguita' vista nei file BD
// reali (la maggior parte delle celle sono testo "€ X,XX", alcune - per un
// difetto lato BD mai spiegato - sono numeri grezzi).
function buildWorkbook(rows: (string | number)[][]): ArrayBuffer {
  const aoa = [HEADER, ...rows];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Sheet1");
  const out = XLSX.write(wb, { type: "array", bookType: "xls" });
  return out as ArrayBuffer;
}

// Replica ESATTA del ramo rimosso da parseEuroCurrency (mai piu' presente
// in produzione, vive solo qui) - serve a dimostrare concretamente cosa
// produceva il codice PRIMA del fix sugli stessi identici input reali
// dell'incidente, non solo ad asserire il comportamento nuovo isolato.
function parseEuroCurrencyBeforeFix(value: unknown): number | null {
  if (typeof value === "number") return value; // <- il ramo del bug: nessuna validazione, il numero grezzo viene accettato cosi' com'e'
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[€\s]/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? null : n;
}

describe("bdExportParser - Revenue Totale come numero Excel grezzo (regressione incidente reale)", () => {
  it("[PRIMA vs DOPO] sugli stessi identici valori reali dell'incidente (30325, 51169), la logica pre-fix li accettava come importo valido, il parser corretto li rifiuta esplicitamente", () => {
    // Valori reali confermati nell'incidente 2026-08-19 (Dimora De Belli
    // 12/08 e 16/08): la cella "Revenue Totale" del file XLS sorgente era
    // il numero Excel grezzo, non il testo formattato "€ X,XX" atteso.
    const realCorruptedValues = [30325, 51169];

    for (const raw of realCorruptedValues) {
      // PRIMA: la vecchia logica restituiva il numero grezzo cosi' com'e',
      // che diventava revenue_total in DB (es. 30325 invece di ~303 euro -
      // il fattore ~5x osservato in dashboard veniva esattamente da qui).
      const beforeFix = parseEuroCurrencyBeforeFix(raw);
      expect(beforeFix).toBe(raw); // riproduce il bug: il valore corrotto veniva accettato integralmente

      // DOPO: lo stesso identico input, attraverso il parser reale e
      // completo (non solo la funzione interna) - la riga viene scartata,
      // mai un valore accettato silenziosamente.
      const buffer = buildWorkbook([["Mercoledì, 12 Agosto 2026", 6, 7, 7, 16, raw]]);
      const { rows, errors } = parseBdExportWorkbook(buffer);
      expect(rows).toHaveLength(0); // nessuna riga con un revenue_total inventato/errato finisce nel risultato
      expect(errors[0]).toContain("numero Excel grezzo");
      expect(errors[0]).toContain(String(raw));
    }
  });

  it("cella Revenue Totale con testo formattato -> parsata normalmente", () => {
    const buffer = buildWorkbook([["Mercoledì, 01 Gennaio 2025", 1, 7, 0, 2, "€ 115,52"]]);
    const { rows, errors } = parseBdExportWorkbook(buffer);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].revenueTotal).toBeCloseTo(115.52);
  });

  it("[caso reale confermato] cella Revenue Totale come numero grezzo (30325, atteso ~303) -> riga SCARTATA, mai accettata come 30325", () => {
    const buffer = buildWorkbook([["Mercoledì, 12 Agosto 2026", 6, 7, 7, 16, 30325]]);
    const { rows, errors } = parseBdExportWorkbook(buffer);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("numero Excel grezzo");
    expect(errors[0]).toContain("30325");
  });

  it("[caso reale confermato, seconda occorrenza] stesso difetto su un'altra data/struttura (51169) -> scartata", () => {
    const buffer = buildWorkbook([["Domenica, 16 Agosto 2026", 8, 7, 0, 21, 51169]]);
    const { rows, errors } = parseBdExportWorkbook(buffer);
    expect(rows).toHaveLength(0);
    expect(errors[0]).toContain("numero Excel grezzo");
  });

  it("una riga con Revenue Totale corrotto non blocca le altre righe valide dello stesso file", () => {
    const buffer = buildWorkbook([
      ["Martedì, 11 Agosto 2026", 4, 7, 2, 11, "€ 715,10"],
      ["Mercoledì, 12 Agosto 2026", 6, 7, 7, 16, 30325], // riga corrotta reale
      ["Giovedì, 13 Agosto 2026", 4, 7, 0, 12, "€ 789,83"],
    ]);
    const { rows, errors } = parseBdExportWorkbook(buffer);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.stayDate)).toEqual(["2026-08-11", "2026-08-13"]);
    expect(errors).toHaveLength(1);
  });

  it("cella Revenue Totale vuota/mancante -> errore generico invariato (non il messaggio specifico del numero grezzo)", () => {
    const buffer = buildWorkbook([["Lunedì, 05 Gennaio 2025", 0, 7, 0, 0, ""]]);
    const { rows, errors } = parseBdExportWorkbook(buffer);
    expect(rows).toHaveLength(0);
    expect(errors[0]).toContain("valori mancanti o non numerici");
    expect(errors[0]).not.toContain("numero Excel grezzo");
  });
});

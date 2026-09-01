import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseNationalityWorkbook } from "../nationalityParser";

// Costruisce un workbook .xls minimo con l'intestazione GERARCHICA a due
// righe realmente usata dal report BD "Ospiti per provenienza" (verificata
// su file reali .xls e .csv - vedi lib/nationalityParser.ts): riga 0 =
// etichetta di gruppo (nazionalità o "Totali") solo nella prima colonna del
// blocco, riga 1 = "Data"/"Presenze"/"Arrivi"/"Partenze" ripetuti per ogni
// gruppo. `groups` e' un elenco di { label, hasTotalsShape } - ogni gruppo
// occupa 3 colonne (Presenze/Arrivi/Partenze), la colonna 0 e' sempre la
// data.
function buildWorkbook(groups: string[], rows: (string | number)[][]): ArrayBuffer {
  const groupRow: (string | number)[] = [""];
  const metricRow: (string | number)[] = ["Data"];
  for (const group of groups) {
    groupRow.push(group, "", "");
    metricRow.push("Presenze", "Arrivi", "Partenze");
  }

  const aoa = [groupRow, metricRow, ...rows];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Sheet1");
  return XLSX.write(wb, { type: "array", bookType: "xls" }) as ArrayBuffer;
}

describe("parseNationalityWorkbook - intestazione gerarchica a due righe (report BD 'Ospiti per provenienza')", () => {
  it("estrae correttamente le combinazioni giorno x nazionalità, ignorando Arrivi/Partenze", () => {
    const buffer = buildWorkbook(
      ["Totali", "ITALIA", "FRANCIA"],
      [["Giovedì, 01 Gennaio 2026", 5, 3, 1, 3, 2, 0, 2, 1, 1]]
    );
    const { rows, errors } = parseNationalityWorkbook(buffer);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2); // Totali escluso, restano ITALIA e FRANCIA
    expect(rows).toContainEqual({ stayDate: "2026-01-01", nationality: "ITALIA", presences: 3 });
    expect(rows).toContainEqual({ stayDate: "2026-01-01", nationality: "FRANCIA", presences: 2 });
  });

  it('il gruppo "Totali" non produce mai una riga come se fosse una nazionalità', () => {
    const buffer = buildWorkbook(["Totali", "ITALIA"], [["Giovedì, 01 Gennaio 2026", 5, 3, 1, 5, 2, 0]]);
    const { rows } = parseNationalityWorkbook(buffer);
    expect(rows.every((r) => r.nationality.toLowerCase() !== "totali")).toBe(true);
  });

  it("cella Presenze vuota o pari a zero -> nessuna riga (mai la matrice artificiale giorno x tutte le nazionalità)", () => {
    const buffer = buildWorkbook(
      ["Totali", "ITALIA", "FRANCIA"],
      [["Giovedì, 01 Gennaio 2026", 3, 3, 0, 3, 2, 0, "", "", ""]]
    );
    const { rows } = parseNationalityWorkbook(buffer);
    expect(rows).toHaveLength(1); // solo ITALIA, FRANCIA aveva Presenze vuota
    expect(rows[0].nationality).toBe("ITALIA");
  });

  it("Presenze=0 ma Arrivi>0 -> comunque nessuna riga (solo Presenze conta, mai Arrivi/Partenze)", () => {
    const buffer = buildWorkbook(["Totali", "ITALIA"], [["Giovedì, 01 Gennaio 2026", 0, 2, 0, 0, 2, 0]]);
    const { rows } = parseNationalityWorkbook(buffer);
    expect(rows).toHaveLength(0);
  });

  it("riga finale di chiusura tabella (colonna data vuota, es. il totale annuale) -> saltata senza errore", () => {
    const buffer = buildWorkbook(
      ["Totali", "ITALIA"],
      [
        ["Giovedì, 01 Gennaio 2026", 2, 2, 0, 2, 2, 0],
        ["", 2, 2, 0, 2, 2, 0],
      ]
    );
    const { rows, errors } = parseNationalityWorkbook(buffer);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
  });

  it("nomi di nazionalità con apostrofi e caratteri speciali preservati esattamente, mai tradotti/normalizzati", () => {
    const buffer = buildWorkbook(
      ["Totali", "STATI UNITI D'AMERICA", "REGNO UNITO", "EMIRATI ARABI UNITI"],
      [["Giovedì, 01 Gennaio 2026", 3, 3, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0]]
    );
    const { rows } = parseNationalityWorkbook(buffer);
    const names = rows.map((r) => r.nationality).sort();
    expect(names).toEqual(["EMIRATI ARABI UNITI", "REGNO UNITO", "STATI UNITI D'AMERICA"]);
  });

  it("numero e nomi di nazionalità completamente dinamici - nessun hardcode nel parser (nazionalità fittizie mai viste altrove nel progetto)", () => {
    const buffer = buildWorkbook(
      ["Totali", "ATLANTIDE", "WAKANDA", "GENOVIA"],
      [["Giovedì, 01 Gennaio 2026", 3, 3, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0]]
    );
    const { rows, errors } = parseNationalityWorkbook(buffer);
    expect(errors).toHaveLength(0);
    expect(rows.map((r) => r.nationality).sort()).toEqual(["ATLANTIDE", "GENOVIA", "WAKANDA"]);
  });

  it("data in formato esteso italiano ('Giovedì, 01 Gennaio 2026') interpretata correttamente", () => {
    const buffer = buildWorkbook(["Totali", "ITALIA"], [["Mercoledì, 31 Dicembre 2026", 2, 2, 0, 2, 2, 0]]);
    const { rows } = parseNationalityWorkbook(buffer);
    expect(rows[0].stayDate).toBe("2026-12-31");
  });

  it("data non interpretabile -> errore esplicito per quella riga, le altre righe restano processate", () => {
    const buffer = buildWorkbook(
      ["Totali", "ITALIA"],
      [
        ["31/13/2026", 2, 2, 0, 2, 2, 0],
        ["Giovedì, 01 Gennaio 2026", 3, 3, 0, 3, 3, 0],
      ]
    );
    const { rows, errors } = parseNationalityWorkbook(buffer);
    expect(errors).toHaveLength(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].stayDate).toBe("2026-01-01");
  });

  it("file senza le due righe di intestazione attese -> errore esplicito", () => {
    const sheet = XLSX.utils.aoa_to_sheet([["solo una riga"]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "Sheet1");
    const buffer = XLSX.write(wb, { type: "array", bookType: "xls" }) as ArrayBuffer;

    const { rows, errors } = parseNationalityWorkbook(buffer);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  it("nessuna colonna Presenze riconoscibile nell'intestazione -> errore esplicito che mostra entrambe le righe di intestazione", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["", "Totali", "", ""],
      ["Data", "Ospiti", "Camere", "Notti"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "Sheet1");
    const buffer = XLSX.write(wb, { type: "array", bookType: "xls" }) as ArrayBuffer;

    const { rows, errors } = parseNationalityWorkbook(buffer);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Presenze");
  });

  it("file vuoto -> errore esplicito", () => {
    const sheet = XLSX.utils.aoa_to_sheet([]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "Sheet1");
    const buffer = XLSX.write(wb, { type: "array", bookType: "xls" }) as ArrayBuffer;

    const { rows, errors } = parseNationalityWorkbook(buffer);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });
});

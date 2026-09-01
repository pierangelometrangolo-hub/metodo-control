import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseBdExportWorkbook, parseEuroCurrency } from "../bdExportParser";

const HEADER = ["Data", "Unità occupate", "Unità in vendita", "Arrivi", "Presenze", "Revenue Totale"];

// Costruisce un workbook .xls minimo con le sole colonne richieste dal
// parser. Ogni riga e' un array posizionale che rispecchia HEADER - il
// valore di "Revenue Totale" viene passato cosi' com'e' a XLSX.utils.aoa_to_sheet,
// che lo scrive come cella NUMERO se e' un number JS, o come cella TESTO
// se e' una string - esattamente la stessa ambiguita' vista nei file BD
// reali (la maggior parte delle celle sono testo "€ X,XX", alcune arrivano
// come numero Excel grezzo perche' la formattazione testo lato BD va
// persa).
function buildWorkbook(rows: (string | number)[][]): ArrayBuffer {
  const aoa = [HEADER, ...rows];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Sheet1");
  const out = XLSX.write(wb, { type: "array", bookType: "xls" });
  return out as ArrayBuffer;
}

// Come HEADER/buildWorkbook, ma con le due colonne KPI opzionali ("ADR",
// "RevPAR") che il file reale "ADR - RevPAR" porta accanto a Revenue
// Totale - usate SOLO dal guardrail di coerenza (checkRevenueConsistency),
// mai come fonte del dato. Ogni riga ha 8 celle: le 6 di HEADER + ADR +
// RevPAR (stringa vuota "" = colonna presente ma cella non compilata,
// diverso dal caso "colonna assente dal file" testato con buildWorkbook).
const HEADER_WITH_KPI = [...HEADER, "ADR", "RevPAR"];
function buildWorkbookWithKpi(rows: (string | number)[][]): ArrayBuffer {
  const aoa = [HEADER_WITH_KPI, ...rows];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Sheet1");
  const out = XLSX.write(wb, { type: "array", bookType: "xls" });
  return out as ArrayBuffer;
}

describe("parseEuroCurrency", () => {
  it("number intero -> accettato cosi' com'e' (caso reale Villa Neviera, estrazione 2026-09-01: 33627)", () => {
    expect(parseEuroCurrency(33627)).toBe(33627);
  });

  it("number decimale -> accettato cosi' com'e', decimali originali preservati (mai un round-trip stringa)", () => {
    expect(parseEuroCurrency(33627.45)).toBe(33627.45);
  });

  it("stringa italiana gia' valida -> parsata normalmente (comportamento invariato)", () => {
    expect(parseEuroCurrency("€ 1.234,56")).toBeCloseTo(1234.56, 2);
    expect(parseEuroCurrency("115,52")).toBeCloseTo(115.52, 2);
    expect(parseEuroCurrency(" € 789,83 ")).toBeCloseTo(789.83, 2);
  });

  it("NaN -> rifiutato", () => {
    expect(parseEuroCurrency(NaN)).toBeNull();
  });

  it("Infinity/-Infinity -> rifiutati", () => {
    expect(parseEuroCurrency(Infinity)).toBeNull();
    expect(parseEuroCurrency(-Infinity)).toBeNull();
  });

  it("stringa non numerica -> rifiutata", () => {
    expect(parseEuroCurrency("N/D")).toBeNull();
    expect(parseEuroCurrency("abc")).toBeNull();
    expect(parseEuroCurrency("")).toBeNull();
  });

  it("null/undefined -> rifiutati", () => {
    expect(parseEuroCurrency(null)).toBeNull();
    expect(parseEuroCurrency(undefined)).toBeNull();
  });

  it("altri tipi non numerici/non stringa (boolean, oggetto) -> rifiutati", () => {
    expect(parseEuroCurrency(true)).toBeNull();
    expect(parseEuroCurrency({})).toBeNull();
  });
});

describe("bdExportParser - Revenue Totale come numero Excel grezzo (fix regressione reale 2026-09-01)", () => {
  it("[caso reale] Villa Neviera, Lunedì 27 Luglio 2026, Revenue Totale come number grezzo 33627 -> riga importata correttamente, non piu' scartata", () => {
    const buffer = buildWorkbook([["Lunedì, 27 Luglio 2026", 6, 7, 2, 14, 33627]]);
    const { rows, errors } = parseBdExportWorkbook(buffer);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].revenueTotal).toBe(33627);
  });

  it("Revenue Totale come number grezzo con decimali -> importato senza perdita di precisione", () => {
    const buffer = buildWorkbook([["Martedì, 28 Luglio 2026", 5, 7, 1, 12, 33627.45]]);
    const { rows, errors } = parseBdExportWorkbook(buffer);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].revenueTotal).toBe(33627.45);
  });

  it("cella Revenue Totale con testo formattato -> parsata normalmente (comportamento invariato)", () => {
    const buffer = buildWorkbook([["Mercoledì, 01 Gennaio 2025", 1, 7, 0, 2, "€ 115,52"]]);
    const { rows, errors } = parseBdExportWorkbook(buffer);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].revenueTotal).toBeCloseTo(115.52, 2);
  });

  it("file misto: righe con Revenue Totale come stringa formattata e righe come number grezzo -> tutte importate correttamente, nessuna scartata", () => {
    const buffer = buildWorkbook([
      ["Martedì, 11 Agosto 2026", 4, 7, 2, 11, "€ 715,10"],
      ["Mercoledì, 12 Agosto 2026", 6, 7, 7, 16, 33627], // caso reale: number grezzo
      ["Giovedì, 13 Agosto 2026", 4, 7, 0, 12, "€ 789,83"],
    ]);
    const { rows, errors } = parseBdExportWorkbook(buffer);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.revenueTotal)).toEqual([715.1, 33627, 789.83]);
  });

  it("replica esatta dell'incidente reale 2026-09-01: 365 righe di cui alcune con Revenue Totale come number grezzo -> tutte e 365 importate (prima del fix ne mancavano 1 su Villa Neviera e 9 su Palazzo Rollo)", () => {
    const rows: (string | number)[][] = [];
    for (let day = 1; day <= 31; day++) {
      // Revenue Totale alternato stringa/number grezzo, per riprodurre il
      // mix reale osservato nell'export - nessuna riga deve andare persa.
      const revenue = day % 3 === 0 ? 200 + day : `€ ${(200 + day).toFixed(2).replace(".", ",")}`;
      rows.push([`Lunedì, ${String(day).padStart(2, "0")} Agosto 2026`, 5, 7, 1, 10, revenue]);
    }
    const buffer = buildWorkbook(rows);
    const { rows: parsedRows, errors } = parseBdExportWorkbook(buffer);
    expect(errors).toHaveLength(0);
    expect(parsedRows).toHaveLength(31);
  });

  it("cella Revenue Totale vuota/mancante -> ancora rifiutata, errore generico (guardrail invariato)", () => {
    const buffer = buildWorkbook([["Lunedì, 05 Gennaio 2025", 0, 7, 0, 0, ""]]);
    const { rows, errors } = parseBdExportWorkbook(buffer);
    expect(rows).toHaveLength(0);
    expect(errors[0]).toContain("valori mancanti o non numerici");
  });

  it("cella Revenue Totale con testo non interpretabile -> riga scartata (guardrail invariato)", () => {
    const buffer = buildWorkbook([["Lunedì, 05 Gennaio 2025", 0, 7, 0, 0, "N/D"]]);
    const { rows, errors } = parseBdExportWorkbook(buffer);
    expect(rows).toHaveLength(0);
    expect(errors[0]).toContain("valori mancanti o non numerici");
  });

  it("una riga con Revenue Totale davvero non interpretabile non blocca le altre righe valide dello stesso file", () => {
    const buffer = buildWorkbook([
      ["Martedì, 11 Agosto 2026", 4, 7, 2, 11, "€ 715,10"],
      ["Mercoledì, 12 Agosto 2026", 6, 7, 7, 16, "N/D"], // riga davvero non interpretabile
      ["Giovedì, 13 Agosto 2026", 4, 7, 0, 12, "€ 789,83"],
    ]);
    const { rows, errors } = parseBdExportWorkbook(buffer);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.stayDate)).toEqual(["2026-08-11", "2026-08-13"]);
    expect(errors).toHaveLength(1);
  });
});

describe("bdExportParser - guardrail di coerenza Revenue Totale vs ADR/RevPAR", () => {
  it("[caso reale] number legittimo 33627, coerente con ADR/RevPAR dichiarati nel file -> accettato", () => {
    // ADR = 33627/1 = 33627.00, RevPAR = 33627/7 = 4803.857... (BD arrotonda
    // a 2 decimali cio' che mostra: "4.803,86").
    const buffer = buildWorkbookWithKpi([["Lunedì, 27 Luglio 2026", 1, 7, 0, 2, 33627, "33.627,00", "4.803,86"]]);
    const { rows, errors } = parseBdExportWorkbook(buffer);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].revenueTotal).toBe(33627);
  });

  it("stringa monetaria coerente con ADR/RevPAR dichiarati -> accettata", () => {
    // ADR = 715.10/4 = 178.775, RevPAR = 715.10/7 = 102.157... (BD arrotonda
    // a "178,78" e "102,16").
    const buffer = buildWorkbookWithKpi([["Martedì, 11 Agosto 2026", 4, 7, 2, 11, "€ 715,10", "178,78", "102,16"]]);
    const { rows, errors } = parseBdExportWorkbook(buffer);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].revenueTotal).toBeCloseTo(715.1, 2);
  });

  it("[caso reale, ricostruito] number finito ma fortemente incoerente con ADR/RevPAR dichiarati -> rifiutato con errore esplicito", () => {
    // Stesso valore dell'incidente reale 2026-08-19 (30325): ADR calcolato
    // da 30325/6 = 5054.17, contro un ADR dichiarato nel file di 115,52
    // (valore plausibile per una struttura reale) - scostamento enorme,
    // ben oltre qualunque arrotondamento.
    const buffer = buildWorkbookWithKpi([["Mercoledì, 12 Agosto 2026", 6, 7, 7, 16, 30325, "115,52", "99,02"]]);
    const { rows, errors } = parseBdExportWorkbook(buffer);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("ADR");
    expect(errors[0]).toContain("incoerente");
  });

  it("piccoli arrotondamenti tra Revenue Totale/ADR/RevPAR calcolati e dichiarati -> accettati (tolleranza)", () => {
    // ADR = 1234.56/9 = 137.1733..., RevPAR = 1234.56/10 = 123.456 - BD
    // dichiara i valori arrotondati a 2 decimali ("137,17", "123,46"),
    // scostamento di pochi millesimi di euro, ben dentro tolleranza.
    const buffer = buildWorkbookWithKpi([["Giovedì, 20 Agosto 2026", 9, 10, 3, 18, "€ 1.234,56", "137,17", "123,46"]]);
    const { rows, errors } = parseBdExportWorkbook(buffer);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
  });

  it("rooms_sold = 0 -> controllo ADR saltato (mai una divisione per zero, mai un falso positivo), RevPAR ancora verificabile", () => {
    // ADR dichiarato deliberatamente "sbagliato" (999,99): se il controllo
    // ADR venisse comunque eseguito con roomsSold=0 la riga verrebbe
    // rifiutata per errore - deve invece essere ignorato. RevPAR e' invece
    // verificabile (roomsAvailable=7>0) e coerente (0/7=0 come dichiarato).
    const buffer = buildWorkbookWithKpi([["Lunedì, 05 Gennaio 2025", 0, 7, 0, 0, 0, "999,99", "0,00"]]);
    const { rows, errors } = parseBdExportWorkbook(buffer);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].roomsSold).toBe(0);
  });

  it("rooms_available = 0 -> controllo RevPAR saltato, ADR ancora verificabile", () => {
    const buffer = buildWorkbookWithKpi([["Martedì, 06 Gennaio 2025", 0, 0, 0, 0, 0, "0,00", "999,99"]]);
    const { rows, errors } = parseBdExportWorkbook(buffer);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
  });

  it("KPI sorgente ASSENTE dal file (colonne ADR/RevPAR non presenti) -> nessun controllo tentato, comportamento prudente invariato", () => {
    // Stesso valore \"sospetto\" dell'incidente reale (30325), ma senza
    // nessuna colonna di riferimento nel file: senza un dato con cui
    // confrontarlo, il guardrail non ha base per bloccare - mai una soglia
    // assoluta indovinata su Revenue Totale in se'.
    const buffer = buildWorkbook([["Mercoledì, 12 Agosto 2026", 6, 7, 7, 16, 30325]]);
    const { rows, errors } = parseBdExportWorkbook(buffer);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].revenueTotal).toBe(30325);
  });

  it("KPI sorgente presente ma NON UTILIZZABILE (celle vuote o testo non interpretabile) -> nessun controllo tentato, comportamento prudente invariato", () => {
    const buffer = buildWorkbookWithKpi([
      ["Mercoledì, 12 Agosto 2026", 6, 7, 7, 16, 30325, "", ""],
      ["Giovedì, 13 Agosto 2026", 6, 7, 7, 16, 30325, "N/D", "N/D"],
    ]);
    const { rows, errors } = parseBdExportWorkbook(buffer);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
  });

  it("KPI dichiarato coerente solo su uno dei due (ADR) ma l'altro (RevPAR) e' assente/vuoto -> basta un solo riscontro coerente per accettare", () => {
    const buffer = buildWorkbookWithKpi([["Lunedì, 27 Luglio 2026", 1, 7, 0, 2, 33627, "33.627,00", ""]]);
    const { rows, errors } = parseBdExportWorkbook(buffer);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
  });
});

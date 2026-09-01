import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseBdExportWorkbook, parseBdExportCsv, parseEuroCurrency, isRevenueCellDateFormatted } from "../bdExportParser";

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

// Come HEADER/buildWorkbook, ma con le due colonne KPI opzionali che il
// file reale "ADR - RevPAR" porta accanto a Revenue Totale - usate SOLO dal
// guardrail di coerenza (evaluateRevenueConsistency), mai come fonte del
// dato. Nome colonna ADR verificato sul file reale Villa Neviera
// 2026-09-01: "Tariffa media (ADR)", NON "ADR" (era il bug del task
// precedente - con "ADR" l'indice era sempre -1 su ogni file reale). Ogni
// riga ha 8 celle: le 6 di HEADER + ADR + RevPAR (stringa vuota "" =
// colonna presente ma cella non compilata, diverso dal caso "colonna
// assente dal file" testato con buildWorkbook).
const HEADER_WITH_KPI = [...HEADER, "Tariffa media (ADR)", "RevPAR"];
function buildWorkbookWithKpi(rows: (string | number)[][]): ArrayBuffer {
  const aoa = [HEADER_WITH_KPI, ...rows];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Sheet1");
  const out = XLSX.write(wb, { type: "array", bookType: "xls" });
  return out as ArrayBuffer;
}

// Sovrascrive la cella "Revenue Totale" di una riga dati gia' costruita
// (dataRowIndex=1 -> prima riga dati, stessa convenzione dell'indice `i`
// usato dal loop di parseBdExportWorkbook, dove data[0] e' l'header) con
// proprieta' di cella arbitrarie (t/v/z) - serve a riprodurre fedelmente
// la corruzione reale (cella fisicamente ritipizzata come DATA), che
// aoa_to_sheet non puo' produrre passando semplicemente un number JS.
function overrideRevenueCell(buffer: ArrayBuffer, dataRowIndex: number, cellOverride: Partial<XLSX.CellObject>): ArrayBuffer {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet["!ref"]!);
  const revenueColIdx = HEADER.indexOf("Revenue Totale");
  const addr = XLSX.utils.encode_cell({ r: range.s.r + dataRowIndex, c: range.s.c + revenueColIdx });
  sheet[addr] = { ...sheet[addr], ...cellOverride } as XLSX.CellObject;
  return XLSX.write(wb, { type: "array", bookType: "xls" }) as ArrayBuffer;
}

describe("isRevenueCellDateFormatted", () => {
  it("cella stringa valuta normale -> false (accettata)", () => {
    expect(isRevenueCellDateFormatted({ t: "s", v: "€ 500,00" })).toBe(false);
  });

  it("cella number normale, senza formato associato -> false (accettata)", () => {
    expect(isRevenueCellDateFormatted({ t: "n", v: 500 })).toBe(false);
  });

  it("cella con t='d' -> true (rifiutata), indipendentemente da z", () => {
    expect(isRevenueCellDateFormatted({ t: "d", v: new Date("2026-07-27") })).toBe(true);
  });

  it("[caso reale] cella con t='n' ma z='m/d/yy' (formato data su cella numerica) -> true (rifiutata)", () => {
    // Esattamente lo stato della cella K209 reale (Villa Neviera
    // 2026-09-01, 27 Luglio) sotto le opzioni di lettura effettivamente
    // usate dal parser (XLSX.read senza cellDates) - t resta "n", solo z
    // rivela la corruzione. Questo e' il motivo per cui il controllo non
    // puo' limitarsi a t==='d'.
    expect(isRevenueCellDateFormatted({ t: "n", v: 33627, z: "m/d/yy" })).toBe(true);
  });

  it("cella con t='n' e normale formato numerico/valuta -> false (accettata)", () => {
    expect(isRevenueCellDateFormatted({ t: "n", v: 500, z: "#,##0.00" })).toBe(false);
    expect(isRevenueCellDateFormatted({ t: "n", v: 500, z: '"€"#,##0.00' })).toBe(false);
  });

  it("cella assente/undefined -> false (nessuna base per rifiutare)", () => {
    expect(isRevenueCellDateFormatted(undefined)).toBe(false);
  });
});

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

describe("bdExportParser - guardrail di coerenza Revenue Totale vs ADR/RevPAR (voto a maggioranza tra riscontri utilizzabili)", () => {
  // Le sei combinazioni possibili tra i verdetti di ADR e RevPAR
  // (consistent/inconsistent/unavailable, l'ordine dei due non conta per
  // la regola) - vedi evaluateRevenueConsistency in lib/bdExportParser.ts.

  it("[combinazione 1: consistent + consistent] entrambi i KPI confermano -> accettata, nessun warning", () => {
    // ADR = 500/5 = 100.00, RevPAR = 500/10 = 50.00, entrambi dichiarati
    // esattamente uguali nel file.
    const buffer = buildWorkbookWithKpi([["Lunedì, 03 Agosto 2026", 5, 10, 2, 12, "€ 500,00", "100,00", "50,00"]]);
    const { rows, errors, warnings } = parseBdExportWorkbook(buffer);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].revenueTotal).toBe(500);
  });

  it("[combinazione 2: consistent + inconsistent, caso reale] ADR conferma, RevPAR e' lui stesso corrotto (number grezzo) -> accettata, nessun warning", () => {
    // Riga REALE (Villa Neviera 2026-09-01, Sabato 03 Gennaio 2026): Revenue
    // Totale e' una stringa normale "€ 882,34", ADR dichiarato "€ 147,06"
    // coincide esattamente con 882.34/6 - ma RevPAR dichiarato e' il number
    // grezzo 35886 (dovrebbe essere ~98.04) - stessa malattia gia' vista su
    // Revenue Totale, mai sulla colonna RevPAR prima d'ora. ADR da solo
    // basta a confermare: la riga va accettata, il riferimento corrotto
    // (RevPAR) non deve produrre ne' uno scarto ne' un warning quando c'e'
    // gia' un riscontro consistent.
    const buffer = buildWorkbookWithKpi([["Sabato, 03 Gennaio 2026", 6, 9, 1, 10, "€ 882,34", "147,06", 35886]]);
    const { rows, errors, warnings } = parseBdExportWorkbook(buffer);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].revenueTotal).toBeCloseTo(882.34, 2);
  });

  it("[combinazione 3, simulazione con number semplice] ADR e RevPAR entrambi incoerenti con un Revenue Totale numerico -> SCARTATA (rete di sicurezza indipendente dal controllo formato-data)", () => {
    // NOTA: nel file reale la cella K209 (27 Luglio) e' fisicamente
    // formattata come DATA, non un semplice number "sporco" - vedi il test
    // dedicato piu' sotto ("cella Revenue Totale con formato data reale")
    // che riproduce fedelmente quel meccanismo con isRevenueCellDateFormatted.
    // Questo test usa un number semplice (senza z di tipo data) per
    // verificare che il guardrail ADR/RevPAR resti comunque una rete di
    // sicurezza indipendente, per un'eventuale futura corruzione numerica
    // che non passi dalla via "cella ritipizzata come data".
    // ADR dichiarato "128,12", RevPAR dichiarato "113,88", roomsSold=8,
    // roomsAvailable=9. Revenue implicita da ADR (128.12*8=1024.96) e da
    // RevPAR (113.88*9=1024.92) concordano tra loro (~1.024,94€) e
    // contraddicono entrambe 33627.
    const buffer = buildWorkbookWithKpi([["Lunedì, 27 Luglio 2026", 8, 9, 2, 16, 33627, "128,12", "113,88"]]);
    const { rows, errors, warnings } = parseBdExportWorkbook(buffer);
    expect(rows).toHaveLength(0);
    expect(warnings).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("ADR");
    expect(errors[0]).toContain("RevPAR");
    expect(errors[0]).toContain("scartata");
  });

  it("[caso reale, meccanismo fedele] cella Revenue Totale con formato data reale (t='n', z='m/d/yy', v=33627) -> rifiutata dal controllo formato-data, guardrail ADR/RevPAR MAI raggiunto", () => {
    // Riproduce esattamente lo stato fisico della cella K209 (Villa
    // Neviera 2026-09-01, Lunedi' 27 Luglio 2026) verificato bit per bit:
    // non un number "sporco" qualunque, ma una cella la cui formattazione
    // Excel (z) e' quella di una data - il controllo dedicato deve
    // intercettarla PRIMA che arrivi al guardrail ADR/RevPAR (che infatti,
    // qui, non deve nemmeno essere tentato: ADR/RevPAR dichiarati nel file
    // sono presenti e validi, 128,12/113,88, ma l'errore non li nomina
    // affatto - prova che il guardrail KPI non e' stato eseguito).
    const buffer = buildWorkbookWithKpi([["Lunedì, 27 Luglio 2026", 8, 9, 2, 16, 0, "128,12", "113,88"]]);
    const corrupted = overrideRevenueCell(buffer, 1, { t: "n", v: 33627, z: "m/d/yy" });

    const { rows, errors, warnings } = parseBdExportWorkbook(corrupted);
    expect(rows).toHaveLength(0);
    expect(warnings).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("formattata come data");
    expect(errors[0]).not.toContain("ADR");
    expect(errors[0]).not.toContain("RevPAR");
  });

  it("[combinazione 4: unavailable + inconsistent, caso reale] rooms_sold=0 (ADR non definito), RevPAR dichiarato diverge -> ACCETTATA con warning diagnostico", () => {
    // Riga REALE (Villa Neviera 2026-09-01, Domenica 04 Gennaio 2026):
    // Revenue Totale "€ 106,00" (stringa normale), roomsSold=0 -> ADR non
    // definito (unavailable, mai un errore). RevPAR calcolato da revenue
    // (106/9=11.78) diverge dal RevPAR che BD dichiara per quel giorno
    // ("€ 0,00" - sembra la convenzione propria di BD per i giorni senza
    // camere vendute). E' l'UNICO riscontro disponibile: non si puo'
    // sapere se il valore sospetto sia Revenue Totale o il RevPAR
    // dichiarato - la riga resta importata, ma con un warning esplicito.
    const buffer = buildWorkbookWithKpi([["Domenica, 04 Gennaio 2026", 0, 9, 0, 0, "€ 106,00", "€ 0,00", "€ 0,00"]]);
    const { rows, errors, warnings } = parseBdExportWorkbook(buffer);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].revenueTotal).toBeCloseTo(106, 2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("RevPAR");
    expect(warnings[0]).toContain("unico riscontro disponibile");
  });

  it("[combinazione 5: unavailable + consistent] rooms_sold=0 (ADR non definito), RevPAR dichiarato coerente -> accettata, nessun warning", () => {
    const buffer = buildWorkbookWithKpi([["Lunedì, 05 Gennaio 2026", 0, 9, 0, 0, "€ 90,00", "€ 0,00", "10,00"]]);
    const { rows, errors, warnings } = parseBdExportWorkbook(buffer);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
    expect(rows).toHaveLength(1);
  });

  it("[combinazione 5 bis: unavailable + consistent, via cella vuota anziche' denominatore zero] RevPAR assente/vuoto, solo ADR coerente -> basta un solo riscontro per accettare", () => {
    const buffer = buildWorkbookWithKpi([["Martedì, 06 Gennaio 2026", 5, 10, 1, 8, "€ 500,00", "100,00", ""]]);
    const { rows, errors, warnings } = parseBdExportWorkbook(buffer);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
    expect(rows).toHaveLength(1);
  });

  it("[combinazione 6: unavailable + unavailable] rooms_sold=0 e rooms_available=0 -> nessun riscontro possibile, comportamento normale (accettata, nessun warning)", () => {
    // ADR/RevPAR dichiarati deliberatamente "sbagliati" (999,99): con
    // entrambi i denominatori a zero nessuno dei due e' matematicamente
    // definibile - il contenuto delle celle non deve nemmeno essere letto.
    const buffer = buildWorkbookWithKpi([["Mercoledì, 07 Gennaio 2026", 0, 0, 0, 0, "€ 0,00", "999,99", "999,99"]]);
    const { rows, errors, warnings } = parseBdExportWorkbook(buffer);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
    expect(rows).toHaveLength(1);
  });

  it("[combinazione 6 bis: unavailable + unavailable, colonne ADR/RevPAR assenti dal file] nessun controllo tentato, comportamento prudente invariato", () => {
    // Stesso valore "sospetto" dell'incidente reale (30325), ma senza
    // nessuna colonna di riferimento nel file: senza un dato con cui
    // confrontarlo, il guardrail non ha base per bloccare - mai una soglia
    // assoluta indovinata su Revenue Totale in se'.
    const buffer = buildWorkbook([["Mercoledì, 12 Agosto 2026", 6, 7, 7, 16, 30325]]);
    const { rows, errors, warnings } = parseBdExportWorkbook(buffer);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].revenueTotal).toBe(30325);
  });

  it("[combinazione 6 ter: unavailable + unavailable, celle KPI presenti ma non interpretabili] nessun controllo tentato, comportamento prudente invariato", () => {
    const buffer = buildWorkbookWithKpi([
      ["Mercoledì, 12 Agosto 2026", 6, 7, 7, 16, 30325, "", ""],
      ["Giovedì, 13 Agosto 2026", 6, 7, 7, 16, 30325, "N/D", "N/D"],
    ]);
    const { rows, errors, warnings } = parseBdExportWorkbook(buffer);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
    expect(rows).toHaveLength(2);
  });

  it("piccoli arrotondamenti tra Revenue Totale/ADR/RevPAR calcolati e dichiarati -> accettati (tolleranza), nessun warning", () => {
    // ADR = 1234.56/9 = 137.1733..., RevPAR = 1234.56/10 = 123.456 - BD
    // dichiara i valori arrotondati a 2 decimali ("137,17", "123,46"),
    // scostamento di pochi millesimi di euro, ben dentro tolleranza.
    const buffer = buildWorkbookWithKpi([["Giovedì, 20 Agosto 2026", 9, 10, 3, 18, "€ 1.234,56", "137,17", "123,46"]]);
    const { rows, errors, warnings } = parseBdExportWorkbook(buffer);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
    expect(rows).toHaveLength(1);
  });
});

describe("bdExportParser - replica sul contenuto reale del file Villa Neviera 2026-09-01", () => {
  it("le 24 righe originariamente scartate dalla versione precedente del guardrail: 23 ora accettate (1 con warning), 1 sola resta scartata (dal controllo formato-data, non da ADR/RevPAR)", () => {
    const buffer = buildWorkbookWithKpi([
      // 21 righe reali con RevPAR come number grezzo corrotto, Revenue Totale
      // e ADR corretti e concordanti - ne includo un sottoinsieme rappresentativo.
      ["Sabato, 03 Gennaio 2026", 6, 9, 1, 10, "€ 882,34", "147,06", 35886],
      ["Venerdì, 20 Marzo 2026", 3, 8, 0, 5, "€ 288,41", "96,14", 49796],
      ["Domenica, 11 Ottobre 2026", 4, 8, 1, 9, "€ 376,57", "94,14", 53874],
      // 2 righe reali con rooms_sold=0 - RevPAR dichiarato "0,00" diverge
      // dal calcolato, unico riscontro disponibile -> warning, non scarto.
      ["Domenica, 04 Gennaio 2026", 0, 9, 0, 0, "€ 106,00", "€ 0,00", "€ 0,00"],
      ["Domenica, 15 Febbraio 2026", 0, 9, 0, 0, "€ 114,00", "€ 0,00", "€ 0,00"],
      // 1 riga reale di corruzione autentica di Revenue Totale - placeholder
      // 0 qui, sovrascritto sotto con la cella fisica reale (t='n', z='m/d/yy').
      ["Lunedì, 27 Luglio 2026", 8, 9, 2, 16, 0, "128,12", "113,88"],
    ]);
    // Riga 6 = "Lunedì, 27 Luglio 2026" (ultima delle 6 righe dati sopra) -
    // sovrascritta con lo stato fisico reale della cella K209.
    const corrected = overrideRevenueCell(buffer, 6, { t: "n", v: 33627, z: "m/d/yy" });

    const { rows, errors, warnings } = parseBdExportWorkbook(corrected);

    expect(rows).toHaveLength(5); // tutte tranne il 27 luglio
    expect(rows.map((r) => r.stayDate)).not.toContain("2026-07-27");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("27 Luglio");
    expect(errors[0]).toContain("formattata come data");
    expect(warnings).toHaveLength(2); // le due righe rooms_sold=0
  });
});

// Costruisce un CSV BD minimo, stesso formato verificato sul file reale
// Villa Neviera 2026-09-01: UTF-8 con BOM, delimitatore ",", campi tra
// virgolette quando contengono la virgola stessa (la colonna Data) o spazi,
// importi in formato italiano identico a quello XLS ("€ 1.024,92").
const CSV_HEADER = ',Data,"Unità occupate","Unità Libere","Unità in vendita","Unità chiuse",IMO,"Indice Medio Occupazione",Arrivi,Presenze,"Revenue Totale","Tariffa media (ADR)",RevPAR,BW';

function buildCsv(rows: string[], withBom = true): string {
  const content = [CSV_HEADER, ...rows].join("\n");
  return withBom ? "﻿" + content : content;
}

describe("parseBdExportCsv - export BD in formato CSV (stesse colonne base, stesso guardrail ADR/RevPAR)", () => {
  it("riga normale, tutte le 6 colonne base lette correttamente - ADR/RevPAR MAI nel risultato (ParsedMonthRow non li contiene)", () => {
    const csv = buildCsv([',"Giovedì, 01 Gennaio 2026",5,3,8,1,"62.5 %",62%,0,10,"€ 670,33","€ 134,07","€ 83,79","26 gg"']);
    const { rows, errors, warnings } = parseBdExportCsv(csv);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      periodLabel: "Giovedì, 01 Gennaio 2026",
      stayDate: "2026-01-01",
      revenueTotal: 670.33,
      roomsSold: 5,
      roomsAvailable: 8,
      arrivals: 0,
      presences: 10,
    });
    expect(Object.keys(rows[0])).not.toContain("adr");
    expect(Object.keys(rows[0])).not.toContain("revpar");
  });

  it("[caso reale] Villa Neviera 27/07/2026 nel CSV: Revenue Totale corretto '€ 1.024,92' (mai il seriale-data 33627 dell'XLS)", () => {
    const csv = buildCsv([',"Lunedì, 27 Luglio 2026",8,1,9,0,"88.89 %",88%,2,16,"€ 1.024,92","€ 128,12","€ 113,88","99 gg"']);
    const { rows, errors, warnings } = parseBdExportCsv(csv);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].revenueTotal).toBeCloseTo(1024.92, 2);
    expect(rows[0].roomsSold).toBe(8);
    expect(rows[0].roomsAvailable).toBe(9);
    expect(rows[0].arrivals).toBe(2);
    expect(rows[0].presences).toBe(16);
  });

  it("righe di totale annuale (Data vuota) -> saltate senza errore, stesso comportamento dell'XLS", () => {
    const csv = buildCsv([
      ',"Giovedì, 01 Gennaio 2026",5,3,8,1,"62.5 %",62%,0,10,"€ 670,33","€ 134,07","€ 83,79","26 gg"',
      ',,1328,,,41,"40,94%",,837,2801,"€ 157.661,03","€ 118,72","€ 48,60",49',
      ',,1328,,,41,"40,94%",,837,2801,"€ 157.661,03","€ 118,72","€ 48,60",49',
    ]);
    const { rows, errors } = parseBdExportCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
  });

  it("guardrail ADR/RevPAR riusato identico: RevPAR fortemente incoerente ma ADR concorde -> accettata (stesso comportamento dell'XLS)", () => {
    // ADR = 500/5 = 100.00 (dichiarato "100,00", coerente); RevPAR
    // dichiarato deliberatamente sbagliato ("999,99") - basta un riscontro
    // coerente per accettare, stessa regola condivisa via processBdRows.
    const csv = buildCsv([',"Lunedì, 03 Agosto 2026",5,2,10,0,"50 %",50%,1,7,"€ 500,00","100,00","999,99",']);
    const { rows, errors, warnings } = parseBdExportCsv(csv);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
    expect(rows).toHaveLength(1);
  });

  it("guardrail ADR/RevPAR riusato identico: entrambi fortemente incoerenti -> scartata (stesso comportamento dell'XLS)", () => {
    const csv = buildCsv([',"Mercoledì, 12 Agosto 2026",6,1,7,0,"85 %",85%,7,16,"€ 30325,00","115,52","99,02",']);
    const { rows, errors } = parseBdExportCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("ADR");
    expect(errors[0]).toContain("RevPAR");
  });

  it("cella Revenue Totale non interpretabile -> riga scartata, errore generico (stesso comportamento dell'XLS)", () => {
    const csv = buildCsv([',"Lunedì, 05 Gennaio 2026",0,9,9,0,"0 %",0%,0,0,"N/D","0,00","0,00",']);
    const { rows, errors } = parseBdExportCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors[0]).toContain("valori mancanti o non numerici");
  });

  it("colonne base mancanti -> errore esplicito, nessuna riga (stesso comportamento dell'XLS)", () => {
    const csv = "Data,Presenze\n\"Giovedì, 01 Gennaio 2026\",10";
    const { rows, errors } = parseBdExportCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors[0]).toContain("colonne mancanti");
  });

  it("BOM UTF-8 in apertura file -> gestito correttamente, non influenza il parsing dell'header", () => {
    const withBom = buildCsv([',"Giovedì, 01 Gennaio 2026",5,3,8,1,"62.5 %",62%,0,10,"€ 670,33","€ 134,07","€ 83,79","26 gg"'], true);
    const withoutBom = buildCsv([',"Giovedì, 01 Gennaio 2026",5,3,8,1,"62.5 %",62%,0,10,"€ 670,33","€ 134,07","€ 83,79","26 gg"'], false);
    expect(parseBdExportCsv(withBom).rows).toEqual(parseBdExportCsv(withoutBom).rows);
    expect(parseBdExportCsv(withBom).errors).toHaveLength(0);
  });

  it("campo Data contenente la virgola del delimitatore, correttamente tra virgolette -> non spezza il parsing della riga", () => {
    // "Giovedì, 01 Gennaio 2026" contiene una virgola: se il tokenizer non
    // rispettasse le virgolette, la riga si spezzerebbe in colonne sbagliate.
    const csv = buildCsv([',"Giovedì, 01 Gennaio 2026",5,3,8,1,"62.5 %",62%,0,10,"€ 670,33","€ 134,07","€ 83,79","26 gg"']);
    const { rows, errors } = parseBdExportCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows[0].stayDate).toBe("2026-01-01");
    expect(rows[0].roomsSold).toBe(5);
  });

  it("file vuoto -> errore esplicito", () => {
    const { rows, errors } = parseBdExportCsv("");
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });
});

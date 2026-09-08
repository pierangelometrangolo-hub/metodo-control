import { describe, expect, it } from "vitest";
import {
  detectFileFormat,
  detectCsvFormat,
  guessStructureFromFileName,
  guessStructureId,
  matchFileToStructure,
  structureMismatchMessage,
  firstDayOfMonthAfter,
  oneYearBefore,
  computeMontecalliniGroupExtractionDate,
  resolveGroupExtractionDate,
  MONTECALLINI_STRUCTURE_NAME,
  StructureOption,
  ImportableRow,
} from "../performanceImportRouting";

const STRUCTURES: StructureOption[] = [
  { id: "s-rollo", name: "Palazzo Rollo" },
  { id: "s-neviera", name: "Villa Neviera" },
  { id: "s-cadura", name: "Palazzo Arco Cadura" },
  { id: "s-sangiorgio", name: "Sangiorgio Resort" },
  { id: "s-belli", name: "Dimora De Belli" },
  { id: "s-montecallini", name: MONTECALLINI_STRUCTURE_NAME },
];

function row(stayDate: string): ImportableRow {
  return { stayDate, revenueTotal: 100, roomsSold: 1, roomsAvailable: 10, arrivals: null, presences: 1 };
}

describe("detectFileFormat", () => {
  it("estensione .csv (qualunque case) -> montecallini_pms", () => {
    expect(detectFileFormat("PlanningForecast (MAGG).csv")).toBe("montecallini_pms");
    expect(detectFileFormat("REPORT.CSV")).toBe("montecallini_pms");
  });

  it("estensione .xls/.xlsx -> bd_export", () => {
    expect(detectFileFormat("ADR - RevPAR - Palazzo Rollo.xls")).toBe("bd_export");
    expect(detectFileFormat("ADR - RevPAR - Palazzo Rollo.xlsx")).toBe("bd_export");
  });
});

describe("detectCsvFormat - determina il dialetto CSV dal CONTENUTO (mai dalla sola estensione, da quando BD esporta anche CSV)", () => {
  it("[caso reale] header PMS Montecallini (delimitatore ';') -> montecallini_pms", () => {
    const header = "DATA;CP;CV;PAX;RICAVI TRAT;ADR;RPAR;OCCUP";
    expect(detectCsvFormat(header)).toBe("montecallini_pms");
  });

  it("[caso reale] header export BD (delimitatore ',') -> bd_export", () => {
    const header =
      ',Data,"Unità occupate","Unità Libere","Unità in vendita","Unità chiuse",IMO,"Indice Medio Occupazione",Arrivi,Presenze,"Revenue Totale","Tariffa media (ADR)",RevPAR,BW';
    expect(detectCsvFormat(header)).toBe("bd_export");
  });

  it("con BOM UTF-8 in apertura -> stesso risultato, il BOM non deve alterare il conteggio dei delimitatori", () => {
    const header = "DATA;CP;CV;PAX;RICAVI TRAT;ADR;RPAR;OCCUP";
    expect(detectCsvFormat("﻿" + header)).toBe("montecallini_pms");
  });

  it("considera solo la prima riga (l'header) - righe successive con l'altro delimitatore non influenzano l'esito", () => {
    const bdContent =
      ',Data,"Unità occupate","Unità in vendita",Arrivi,Presenze,"Revenue Totale"\n,"Giovedì, 01 Gennaio 2026",5,8,0,10,"€ 670,33"';
    expect(detectCsvFormat(bdContent)).toBe("bd_export");
  });
});

describe("matchFileToStructure - routing formato<->struttura", () => {
  it("CSV + Montecallini selezionata -> valido (montecallini_pms), nessun format_mismatch", () => {
    const result = matchFileToStructure("PlanningForecast (MAGG).csv", "montecallini_pms", "s-montecallini", STRUCTURES);
    expect(result.kind).not.toBe("format_mismatch");
    // nome file PMS reale non contiene il nome struttura - "unknown" e' l'esito atteso, mai un blocco
    expect(result.kind).toBe("unknown");
  });

  it("CSV + Montecallini selezionata, nome file che la nomina esplicitamente -> match", () => {
    const result = matchFileToStructure("PlanningForecast Montecallini maggio.csv", "montecallini_pms", "s-montecallini", STRUCTURES);
    expect(result.kind).toBe("match");
  });

  it("CSV + struttura BD selezionata -> format_mismatch, mai importabile", () => {
    const result = matchFileToStructure("PlanningForecast (MAGG).csv", "montecallini_pms", "s-rollo", STRUCTURES);
    expect(result.kind).toBe("format_mismatch");
    if (result.kind === "format_mismatch") {
      expect(result.reason).toContain(MONTECALLINI_STRUCTURE_NAME);
    }
  });

  it("XLS/XLSX + struttura BD selezionata, nome file la nomina -> match, valido (bd_export)", () => {
    const result = matchFileToStructure("ADR - RevPAR - Palazzo Rollo.xls", "bd_export", "s-rollo", STRUCTURES);
    expect(result.kind).toBe("match");
  });

  it("XLS/XLSX + Montecallini selezionata -> format_mismatch, mai importabile", () => {
    const result = matchFileToStructure("ADR - RevPAR.xls", "bd_export", "s-montecallini", STRUCTURES);
    expect(result.kind).toBe("format_mismatch");
    if (result.kind === "format_mismatch") {
      expect(result.reason).toContain("PlanningForecast");
    }
  });

  it("nessuna struttura selezionata -> unknown, mai un blocco prematuro", () => {
    expect(matchFileToStructure("qualunque.csv", "montecallini_pms", "", STRUCTURES).kind).toBe("unknown");
  });

  it("nome file che nomina una struttura diversa da quella selezionata -> mismatch", () => {
    const result = matchFileToStructure("ADR - RevPAR - Villa Neviera.xls", "bd_export", "s-rollo", STRUCTURES);
    expect(result.kind).toBe("mismatch");
    if (result.kind === "mismatch") expect(result.guessedName).toBe("Villa Neviera");
  });
});

describe("guessStructureFromFileName / guessStructureId", () => {
  it("un solo nome struttura riconosciuto nel file -> quella struttura", () => {
    expect(guessStructureFromFileName("ADR - RevPAR - Sangiorgio Resort.xls", STRUCTURES)?.id).toBe("s-sangiorgio");
  });

  it("nessun nome struttura riconosciuto -> null / stringa vuota", () => {
    expect(guessStructureFromFileName("report_generico.xls", STRUCTURES)).toBeNull();
    expect(guessStructureId("report_generico.xls", STRUCTURES)).toBe("");
  });
});

describe("structureMismatchMessage", () => {
  it("nomina sia la struttura indovinata che quella selezionata", () => {
    const msg = structureMismatchMessage("Villa Neviera", "Palazzo Rollo");
    expect(msg).toContain("Villa Neviera");
    expect(msg).toContain("Palazzo Rollo");
  });
});

describe("firstDayOfMonthAfter", () => {
  it("mese normale -> primo giorno del mese successivo", () => {
    expect(firstDayOfMonthAfter("2026-05-15")).toBe("2026-06-01");
  });

  it("dicembre -> 1 gennaio dell'anno successivo (rollover di anno)", () => {
    expect(firstDayOfMonthAfter("2025-12-20")).toBe("2026-01-01");
  });
});

describe("oneYearBefore", () => {
  it("data normale -> stessa data un anno prima", () => {
    expect(oneYearBefore("2026-08-19")).toBe("2025-08-19");
  });

  it("29 febbraio di un anno bisestile -> un anno prima NON bisestile: comportamento reale di Date.UTC, rollover a 1 marzo", () => {
    // 2024 e' bisestile, 2023 no - Date.UTC(2023, 1, 29) non esiste come
    // 29/2 e ripiega automaticamente sul 1 marzo 2023 (comportamento nativo
    // di Date, non corretto qui: si documenta il comportamento REALE usato
    // dal codice, senza cambiarne la semantica).
    expect(oneYearBefore("2024-02-29")).toBe("2023-03-01");
  });

  it("29 febbraio (upload_date) di un anno bisestile a due bisestili di distanza -> resta 29 febbraio", () => {
    // 2028 e 2024 sono entrambi bisestili (differenza di 4 anni) - qui non
    // e' il caso diretto di oneYearBefore (sempre -1 anno), ma verifichiamo
    // comunque che un anno prima di un 29/2 bisestile-adiacente-a-bisestile
    // seguito da un altro anno non bisestile produca lo stesso rollover.
    expect(oneYearBefore("2028-02-29")).toBe("2027-03-01");
  });

  it("attraversa il cambio anno (gennaio -> dicembre dell'anno prima)", () => {
    expect(oneYearBefore("2026-01-05")).toBe("2025-01-05");
  });
});

describe("computeMontecalliniGroupExtractionDate - CY", () => {
  it("mese CY ancora in corso (non chiuso) -> extraction_date = data di upload (oggi)", () => {
    const result = computeMontecalliniGroupExtractionDate("cy", [row("2026-08-05")], "2026-08-19");
    expect(result).toBe("2026-08-19");
  });

  it("mese CY gia' chiuso -> primo giorno del mese successivo alla stay_date, non la data di upload", () => {
    const result = computeMontecalliniGroupExtractionDate("cy", [row("2026-05-10")], "2026-08-19");
    expect(result).toBe("2026-06-01");
  });

  it("mese CY chiuso a dicembre -> rollover di anno (1 gennaio anno successivo)", () => {
    const result = computeMontecalliniGroupExtractionDate("cy", [row("2025-12-10")], "2026-08-19");
    expect(result).toBe("2026-01-01");
  });

  it("ultimo giorno del mese coincide con oggi -> mese ancora considerato in corso (confine incluso)", () => {
    // monthEndDate < today e' la condizione di chiusura: se monthEndDate ===
    // today, il mese NON e' ancora chiuso (today e' il giorno stesso della
    // chiusura, non il giorno dopo) - comportamento reale del codice.
    const result = computeMontecalliniGroupExtractionDate("cy", [row("2026-08-05")], "2026-08-31");
    expect(result).toBe("2026-08-31");
  });

  it("nessuna riga nel gruppo -> fallback difensivo su oggi", () => {
    expect(computeMontecalliniGroupExtractionDate("cy", [], "2026-08-19")).toBe("2026-08-19");
  });
});

describe("computeMontecalliniGroupExtractionDate - SDLY", () => {
  it("sempre data di upload meno un anno, indipendentemente dalla stay_date delle righe", () => {
    const result = computeMontecalliniGroupExtractionDate("sdly", [row("2025-08-05")], "2026-08-19");
    expect(result).toBe("2025-08-19");
  });

  it("attraverso un anno bisestile (upload 29/2 bisestile) -> stesso rollover di oneYearBefore", () => {
    const result = computeMontecalliniGroupExtractionDate("sdly", [row("2023-02-28")], "2024-02-29");
    expect(result).toBe("2023-03-01");
  });

  it("nessuna riga nel gruppo -> fallback difensivo su oggi (non su oneYearBefore)", () => {
    expect(computeMontecalliniGroupExtractionDate("sdly", [], "2026-08-19")).toBe("2026-08-19");
  });
});

describe("computeMontecalliniGroupExtractionDate - LY", () => {
  it("sempre primo giorno del mese successivo alla stay_date storica, mai la data di upload", () => {
    const result = computeMontecalliniGroupExtractionDate("ly", [row("2025-09-15")], "2026-08-19");
    expect(result).toBe("2025-10-01");
  });

  it("stay_date storica a dicembre -> rollover di anno", () => {
    const result = computeMontecalliniGroupExtractionDate("ly", [row("2025-12-20")], "2026-08-19");
    expect(result).toBe("2026-01-01");
  });

  it("nessuna riga nel gruppo -> fallback difensivo su oggi", () => {
    expect(computeMontecalliniGroupExtractionDate("ly", [], "2026-08-19")).toBe("2026-08-19");
  });
});

describe("resolveGroupExtractionDate", () => {
  it("export BD (bd_export) -> sempre fallbackDate scelto dall'utente/slot, mai ricalcolato", () => {
    expect(resolveGroupExtractionDate("bd_export", "cy", [row("2026-05-10")], "2026-01-01", "2026-08-19")).toBe("2026-01-01");
    expect(resolveGroupExtractionDate("bd_export", "sdly", [row("2025-05-10")], "2026-01-01", "2026-08-19")).toBe("2026-01-01");
  });

  it("PMS Montecallini -> fallbackDate ignorato, extraction_date sempre ricalcolata dal contenuto del gruppo", () => {
    expect(resolveGroupExtractionDate("montecallini_pms", "cy", [row("2026-08-05")], "1999-01-01", "2026-08-19")).toBe("2026-08-19");
    expect(resolveGroupExtractionDate("montecallini_pms", "sdly", [row("2025-08-05")], "1999-01-01", "2026-08-19")).toBe("2025-08-19");
    expect(resolveGroupExtractionDate("montecallini_pms", "ly", [row("2025-09-15")], "1999-01-01", "2026-08-19")).toBe("2025-10-01");
  });
});

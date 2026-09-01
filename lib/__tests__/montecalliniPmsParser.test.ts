import { describe, expect, it } from "vitest";
import { parseMontecalliniPmsCsv } from "../montecalliniPmsParser";

// Nessun file PMS reale disponibile in questa sessione - fixture costruito
// seguendo esattamente le colonne/il formato/la mappatura CP/CV confermati
// da Pierangelo (CORREZIONE rispetto alla prima versione: CP->rooms_sold,
// CV->rooms_available dinamico, mai fisso). Da riverificare su file reali
// non appena disponibili (vedi test di regressione separato).
const HEADER = "DATA;CP;CV;PAX;RICAVI TRAT;ADR;RPAR;OCCUP";

function csv(rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

describe("parseMontecalliniPmsCsv", () => {
  it("riga CY normale -> CP diventa rooms_sold, CV diventa rooms_available (mappatura corretta)", () => {
    const content = csv(["21/05/2026 gio;29;48;54;3.245,80;111,92;67,62;60,4%"]);
    const result = parseMontecalliniPmsCsv(content);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({
      kind: "cy",
      stayDate: "2026-05-21",
      revenueTotal: 3245.8,
      roomsSold: 29, // da CP, non da CV
      roomsAvailable: 48, // da CV
      arrivals: null,
      presences: 54,
    });
  });

  it("rooms_available e' DINAMICO, mai fisso a 48 - verificato con CV diverso da 48 sulla stessa struttura", () => {
    // Caso reale confermato: righe CY di una stagione aperta hanno CV=48,
    // righe SDLY/LY della stessa giornata hanno CV=38 (chiusura stagionale
    // diversa un anno prima) - prova diretta che CV varia riga per riga.
    const content = csv([
      "21/05/2026 gio;29;48;54;3.245,80;111,92;67,62;60,4%",
      "21/05/2025 mer (SDLY);18;38;33;1.850,00;102,78;48,68;47,4%",
    ]);
    const result = parseMontecalliniPmsCsv(content);
    expect(result.rows.find((r) => r.kind === "cy")?.roomsAvailable).toBe(48);
    expect(result.rows.find((r) => r.kind === "sdly")?.roomsAvailable).toBe(38);
  });

  it("cattura le righe SDLY come osservazione distinta (kind='sdly'), MAI piu' scartate", () => {
    const content = csv(["21/05/2025 mer (SDLY);18;38;33;1.850,00;102,78;48,68;47,4%"]);
    const result = parseMontecalliniPmsCsv(content);
    expect(result.excludedRows).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].kind).toBe("sdly");
    expect(result.rows[0].stayDate).toBe("2025-05-21"); // data storica reale letta dal file, non calcolata
  });

  it("cattura le righe LY come osservazione distinta (kind='ly'), MAI piu' scartate", () => {
    const content = csv(["21/05/2025 mer (LY);24;38;44;2.400,00;100,00;63,16;63,2%"]);
    const result = parseMontecalliniPmsCsv(content);
    expect(result.excludedRows).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].kind).toBe("ly");
    expect(result.rows[0].stayDate).toBe("2025-05-21");
  });

  it("SDLY e LY per la STESSA stay_date hanno valori indipendenti - non sono ridondanti", () => {
    // Caso reale confermato (settembre): SDLY revenue 108.118,40/CP 686, LY
    // revenue 145.036,52/CP 941 - stessa data, valori diversi per costruzione
    // (SDLY = fotografia OTB a meta' curva, LY = consuntivo chiuso).
    const content = csv([
      "15/09/2025 lun (SDLY);686;1000;1200;108.118,40;157,60;108,12;68,6%",
      "15/09/2025 lun (LY);941;1000;1550;145.036,52;154,13;145,04;94,1%",
    ]);
    const result = parseMontecalliniPmsCsv(content);
    expect(result.rows).toHaveLength(2);
    const sdly = result.rows.find((r) => r.kind === "sdly")!;
    const ly = result.rows.find((r) => r.kind === "ly")!;
    expect(sdly.stayDate).toBe(ly.stayDate); // stessa data storica
    expect(sdly.revenueTotal).not.toBe(ly.revenueTotal); // ma valori diversi
    expect(sdly.roomsSold).not.toBe(ly.roomsSold);
  });

  it("esclude le righe finali di totale (TOTALE CY/SDLY/LY), mai un errore", () => {
    const content = csv([
      "21/05/2026 gio;29;48;54;3.245,80;111,92;67,62;60,4%",
      "TOTALE CY;850;1440;1620;95.420,50;112,26;65,71;58,5%",
      "TOTALE SDLY;780;1440;1490;82.100,00;105,26;58,73;54,3%",
      "TOTALE LY;760;1440;1450;79.500,00;104,61;55,90;51,7%",
    ]);
    const result = parseMontecalliniPmsCsv(content);
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(result.excludedRows).toHaveLength(3);
  });

  it("esclude la riga di servizio 'DISPONIBILI A FINE MESE' (footer reale del file AGO) - mai un errore, mai una riga snapshot", () => {
    const content = csv([
      "21/05/2026 gio;29;48;54;3.245,80;111,92;67,62;60,4%",
      "TOTALE CY;29;48;54;3.245,80;111,92;67,62;60,4%",
      "TOTALE SDLY;0;0;0;0,00;0,00;0,00;0,0%",
      "TOTALE LY;0;0;0;0,00;0,00;0,00;0,0%",
      "DISPONIBILI A FINE MESE;;13;19;153;12;31;34;8",
    ]);
    const result = parseMontecalliniPmsCsv(content);
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(result.excludedRows).toHaveLength(4);
    expect(result.excludedRows.some((r) => r.reason.includes("DISPONIBILI A FINE MESE"))).toBe(true);
  });

  it("riconciliazione: la somma delle righe CY parsate coincide con la riga TOTALE CY del file", () => {
    const rows = [
      "01/05/2026 ven;16;48;28;1.800,25;112,52;33,33;33,3%",
      "02/05/2026 sab;31;48;58;3.900,75;125,83;64,58;64,6%",
      "03/05/2026 dom;22;48;41;2.750,00;125,00;45,83;45,8%",
    ];
    const totaleCyRevenue = 1800.25 + 3900.75 + 2750.0;
    const totaleCyCp = 16 + 31 + 22;
    const content = csv([...rows, `TOTALE CY;${totaleCyCp};144;127;${totaleCyRevenue.toFixed(2).replace(".", ",")};122,48;58,69;47,9%`]);
    const result = parseMontecalliniPmsCsv(content);
    const sommaRevenue = result.rows.reduce((s, r) => s + r.revenueTotal, 0);
    const sommaCp = result.rows.reduce((s, r) => s + r.roomsSold, 0);
    expect(sommaRevenue).toBeCloseTo(totaleCyRevenue, 2);
    expect(sommaCp).toBe(totaleCyCp);
  });

  it("arrivals resta sempre NULL (colonna non disponibile in questo export)", () => {
    const content = csv(["21/05/2026 gio;29;48;54;3.245,80;111,92;67,62;60,4%"]);
    const result = parseMontecalliniPmsCsv(content);
    expect(result.rows[0].arrivals).toBeNull();
  });

  describe("validazioni bloccanti (stati fisicamente impossibili)", () => {
    it("CP > CV -> riga scartata con errore esplicito", () => {
      const content = csv(["21/05/2026 gio;50;48;54;3.245,80;111,92;67,62;60,4%"]);
      const result = parseMontecalliniPmsCsv(content);
      expect(result.rows).toHaveLength(0);
      expect(result.errors[0]).toContain("CP");
      expect(result.errors[0]).toContain("CV");
    });

    it("CP negativo -> riga scartata", () => {
      const content = csv(["21/05/2026 gio;-1;48;54;3.245,80;111,92;67,62;60,4%"]);
      const result = parseMontecalliniPmsCsv(content);
      expect(result.rows).toHaveLength(0);
      expect(result.errors[0]).toContain("negativi");
    });

    it("revenue negativo -> riga scartata", () => {
      const content = csv(["21/05/2026 gio;10;48;20;-500,00;111,92;67,62;60,4%"]);
      const result = parseMontecalliniPmsCsv(content);
      expect(result.rows).toHaveLength(0);
      expect(result.errors[0]).toContain("negativi");
    });
  });

  describe("warning indicativi (mai bloccanti - la riga resta importata)", () => {
    it("CV > 48 -> warning, ma la riga resta importata (potrebbe essere un inventario futuro legittimo)", () => {
      const content = csv(["21/05/2026 gio;40;52;70;5.000,00;125,00;96,15;76,9%"]);
      const result = parseMontecalliniPmsCsv(content);
      expect(result.rows).toHaveLength(1); // importata comunque
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].message).toContain("CV");
      expect(result.warnings[0].message).toContain("52");
    });

    it("revenue/CP incoerente con ADR dichiarato -> warning, riga comunque importata", () => {
      // revenue/CP = 3245.80/29 = 111.925..., ADR dichiarato 500 (chiaramente incoerente)
      const content = csv(["21/05/2026 gio;29;48;54;3.245,80;500,00;67,62;60,4%"]);
      const result = parseMontecalliniPmsCsv(content);
      expect(result.rows).toHaveLength(1);
      expect(result.warnings.some((w) => w.message.includes("ADR"))).toBe(true);
    });

    it("CP/CV incoerente con OCCUP dichiarato -> warning, riga comunque importata", () => {
      // CP/CV = 29/48 = 60.4%, OCCUP dichiarato 10% (chiaramente incoerente)
      const content = csv(["21/05/2026 gio;29;48;54;3.245,80;111,92;67,62;10,0%"]);
      const result = parseMontecalliniPmsCsv(content);
      expect(result.rows).toHaveLength(1);
      expect(result.warnings.some((w) => w.message.includes("OCCUP"))).toBe(true);
    });

    it("ADR/OCCUP coerenti entro tolleranza -> nessun warning", () => {
      const content = csv(["21/05/2026 gio;29;48;54;3.245,80;111,92;67,62;60,4%"]);
      const result = parseMontecalliniPmsCsv(content);
      expect(result.warnings).toHaveLength(0);
    });

    it("colonne ADR/OCCUP assenti dal file -> nessun controllo tentato, nessun errore", () => {
      const noAdrOccupHeader = "DATA;CP;CV;PAX;RICAVI TRAT";
      const content = [noAdrOccupHeader, "21/05/2026 gio;29;48;54;3.245,80"].join("\n");
      const result = parseMontecalliniPmsCsv(content);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
      expect(result.rows).toHaveLength(1);
    });
  });

  it("riga con data malformata -> errore esplicito, riga scartata, resto del file processato", () => {
    const content = csv([
      "2026-05-21;29;48;54;3.245,80;111,92;67,62;60,4%", // formato ISO invece di gg/mm/aaaa
      "22/05/2026 ven;30;48;56;3.300,00;110,00;68,75;62,5%",
    ]);
    const result = parseMontecalliniPmsCsv(content);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].stayDate).toBe("2026-05-22");
    expect(result.errors).toHaveLength(1);
  });

  it("riga con RICAVI TRAT non numerico -> errore esplicito, riga scartata", () => {
    const content = csv(["21/05/2026 gio;29;48;54;N/D;111,92;67,62;60,4%"]);
    const result = parseMontecalliniPmsCsv(content);
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0]).toContain("RICAVI TRAT");
  });

  it("file con colonne mancanti (CV assente) -> errore chiaro, nessuna riga processata", () => {
    const content = "DATA;CP;PAX;RICAVI TRAT\n21/05/2026 gio;29;54;3.245,80";
    const result = parseMontecalliniPmsCsv(content);
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0]).toContain("colonne mancanti");
    expect(result.errors[0]).toContain("CV");
  });

  it("rimuove il BOM UTF-8 in apertura file senza romperne il parsing", () => {
    const content = "﻿" + csv(["21/05/2026 gio;29;48;54;3.245,80;111,92;67,62;60,4%"]);
    const result = parseMontecalliniPmsCsv(content);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
  });

  it("file vuoto -> errore esplicito", () => {
    const result = parseMontecalliniPmsCsv("");
    expect(result.errors).toHaveLength(1);
  });
});

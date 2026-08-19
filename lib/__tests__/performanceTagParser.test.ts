import { describe, expect, it } from "vitest";
import { parseTagBookingsCsv } from "../performanceTagParser";

const HEADER = "Cod.;Check-in;Check-out;Totale;Totale Soggiorno;Stato";

function csv(rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

describe("parseTagBookingsCsv", () => {
  it("interpreta una riga CONFERMATA valida: codice, date, importo italiano, periodo derivato dal check-in", () => {
    const content = csv(["3KO79N2449;15/07/2025;20/07/2025;600,00;581,00;CONFERMATA"]);
    const result = parseTagBookingsCsv(content);
    expect(result.errors).toHaveLength(0);
    expect(result.excludedRows).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      bookingCode: "3KO79N2449",
      checkIn: "2025-07-15",
      checkOut: "2025-07-20",
      periodYear: 2025,
      periodMonth: 7,
      tagAmount: 581,
    });
  });

  it("esclude esplicitamente le righe IN ATTESA, senza scartarle silenziosamente", () => {
    const content = csv([
      "AAA111;01/03/2025;05/03/2025;300,00;290,00;CONFERMATA",
      "BBB222;02/03/2025;06/03/2025;300,00;290,00;IN ATTESA",
    ]);
    const result = parseTagBookingsCsv(content);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].bookingCode).toBe("AAA111");
    expect(result.excludedRows).toHaveLength(1);
    expect(result.excludedRows[0].bookingCode).toBe("BBB222");
    expect(result.excludedRows[0].reason).toContain("IN ATTESA");
  });

  it("gestisce un soggiorno a cavallo di due mesi: il periodo e' sempre quello del check-in, mai split", () => {
    const content = csv(["XYZ999;28/02/2025;05/03/2025;800,00;750,00;CONFERMATA"]);
    const result = parseTagBookingsCsv(content);
    expect(result.rows[0].periodYear).toBe(2025);
    expect(result.rows[0].periodMonth).toBe(2); // febbraio, mese di check-in - non marzo
    expect(result.rows[0].tagAmount).toBe(750); // intero importo, nessuno split proporzionale
  });

  it("rimuove il BOM UTF-8 in apertura file senza romperne il parsing", () => {
    const content = "﻿" + csv(["COD1;10/01/2025;12/01/2025;200,00;190,00;CONFERMATA"]);
    const result = parseTagBookingsCsv(content);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
  });

  it("importo con formato italiano a migliaia (punto) e decimali (virgola)", () => {
    const content = csv(["COD2;01/06/2025;10/06/2025;1.500,00;1.234,56;CONFERMATA"]);
    const result = parseTagBookingsCsv(content);
    expect(result.rows[0].tagAmount).toBeCloseTo(1234.56);
  });

  it("riga con data check-in non nel formato atteso -> errore esplicito, riga scartata, resto del file processato", () => {
    const content = csv([
      "COD3;2025-01-10;15/01/2025;100,00;90,00;CONFERMATA", // formato ISO invece di gg/mm/aaaa
      "COD4;11/01/2025;15/01/2025;100,00;90,00;CONFERMATA",
    ]);
    const result = parseTagBookingsCsv(content);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].bookingCode).toBe("COD4");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("COD3");
  });

  it("riga con importo non parsabile -> errore esplicito, riga scartata", () => {
    const content = csv(["COD5;01/01/2025;05/01/2025;100,00;N/D;CONFERMATA"]);
    const result = parseTagBookingsCsv(content);
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0]).toContain("COD5");
  });

  it("riga senza codice prenotazione -> errore esplicito, riga scartata", () => {
    const content = csv([";01/01/2025;05/01/2025;100,00;90,00;CONFERMATA"]);
    const result = parseTagBookingsCsv(content);
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0]).toContain("mancante");
  });

  it("file con colonne mancanti -> errore chiaro, nessuna riga processata", () => {
    const content = "Cod.;Check-in;Stato\nCOD1;01/01/2025;CONFERMATA";
    const result = parseTagBookingsCsv(content);
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0]).toContain("colonne mancanti");
  });

  it("file vuoto -> errore esplicito", () => {
    const result = parseTagBookingsCsv("");
    expect(result.errors).toHaveLength(1);
  });
});

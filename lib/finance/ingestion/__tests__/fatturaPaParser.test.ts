import { describe, expect, it } from "vitest";
import { parseFatturaPaXml, extractDocumentSeries } from "../fatturaPaParser";
import { buildFatturaPaXml } from "./fixtures";

describe("fatturaPaParser", () => {
  it("estrae emittente, controparte, importi e righe da una TD01 ordinaria", () => {
    const xml = buildFatturaPaXml({
      number: "V/12",
      lines: [{ descrizione: "Fee GAP maggio 2025", prezzoTotale: 1200 }],
    });
    const parsed = parseFatturaPaXml(xml);
    expect(parsed.documentTypeCode).toBe("TD01");
    expect(parsed.issuer.vatNumber).toBe("IT05320500753");
    expect(parsed.counterparty.vatNumber).toBe("IT01430150746");
    expect(parsed.netAmount).toBeCloseTo(1200);
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.creditNote.isCreditNote).toBe(false);
  });

  it("riconosce una TD04 come nota di credito, con segno proposto -1 e riferimento al documento originario", () => {
    const xml = buildFatturaPaXml({
      documentType: "TD04",
      number: "V/13",
      lines: [{ descrizione: "Storno fattura V/9 per errore importo", prezzoTotale: 500 }],
      datiFattureCollegate: { idDocumento: "V/9", data: "2025-03-01" },
      causale: "Nota di credito a storno totale fattura V/9",
    });
    const parsed = parseFatturaPaXml(xml);
    expect(parsed.creditNote.isCreditNote).toBe(true);
    expect(parsed.creditNote.proposedEconomicSign).toBe(-1);
    expect(parsed.creditNote.referencedDocumentNumber).toBe("V/9");
    expect(parsed.creditNote.reasonDescription).toContain("storno");
  });

  it("TD04 senza Causale/DatiFattureCollegate strutturati (caso reale del batch 2025): riferimento e motivo estratti dalla descrizione della prima riga, segnalati come euristica", () => {
    const xml = buildFatturaPaXml({
      documentType: "TD04",
      number: "V00089",
      lines: [{ descrizione: "Totale storno fatt V00088 per errato importo", prezzoTotale: 583.91 }],
    });
    const parsed = parseFatturaPaXml(xml);
    expect(parsed.creditNote.isCreditNote).toBe(true);
    expect(parsed.creditNote.referencedDocumentNumber).toBe("V00088");
    expect(parsed.creditNote.reasonDescription).toBe("Totale storno fatt V00088 per errato importo");
    expect(parsed.parseWarnings.some((w) => w.includes("euristica"))).toBe(true);
  });

  it.each([
    ["A totale storno fattura nr. L00024 del 18/02/2025 per errato importo", "L00024"],
    ["A totale storno fatt. n. V00089 per errata emissione", "V00089"],
  ])("estrae il riferimento anche con 'nr./n.' interposto: %s -> %s", (descrizione, expectedRef) => {
    const xml = buildFatturaPaXml({ documentType: "TD04", lines: [{ descrizione, prezzoTotale: 100 }] });
    const parsed = parseFatturaPaXml(xml);
    expect(parsed.creditNote.referencedDocumentNumber).toBe(expectedRef);
  });

  it("[TEST C/D regression V00012] riferimento a 'V00089' estratto come testo grezzo, MAI risolto a un document_id o a un anno - il modello non ha alcun campo di risoluzione a questo livello", () => {
    // Caso reale: V00012 (document_date 2025-03-07) storna testualmente
    // "V00089", ma la V00089 originaria e' del 2024 (batch non ancora
    // importato) - NON deve mai essere confusa con la V00089 del batch 2025
    // stesso. A questo livello (parsing) non esiste alcuna logica di
    // matching/anno: solo estrazione del testo, la disambiguazione per
    // esercizio e' lavoro futuro (import 2024), mai anticipato qui.
    const xml = buildFatturaPaXml({
      documentType: "TD04",
      number: "V00012",
      date: "2025-03-07",
      lines: [{ descrizione: "A totale storno fatt. n. V00089 per errata emissione", prezzoTotale: 100 }],
    });
    const parsed = parseFatturaPaXml(xml);
    expect(parsed.creditNote.isCreditNote).toBe(true);
    expect(parsed.creditNote.referencedDocumentNumber).toBe("V00089");
    // Nessuna data di riferimento strutturata nella fonte -> null, mai
    // dedotta/inventata (nessun anno assunto implicitamente dal contesto).
    expect(parsed.creditNote.referencedDocumentDate).toBeNull();
    // Il tipo CreditNoteInfo non espone alcun related_document_id/anno
    // risolto - la sola proprieta' di collegamento e' questo riferimento
    // testuale grezzo, verificato qui esaustivamente sulle chiavi presenti.
    expect(Object.keys(parsed.creditNote).sort()).toEqual(
      ["isCreditNote", "proposedEconomicSign", "reasonDescription", "referencedDocumentDate", "referencedDocumentNumber"].sort()
    );
  });

  it("non tratta una TD01 come nota di credito", () => {
    const xml = buildFatturaPaXml({ documentType: "TD01", lines: [{ descrizione: "x", prezzoTotale: 10 }] });
    const parsed = parseFatturaPaXml(xml);
    expect(parsed.creditNote.isCreditNote).toBe(false);
    expect(parsed.creditNote.proposedEconomicSign).toBe(1);
  });

  it("estrae il periodo di servizio strutturato quando presente sulla riga", () => {
    const xml = buildFatturaPaXml({
      lines: [{ descrizione: "Fee maggio", prezzoTotale: 1200, dataInizioPeriodo: "2025-05-01", dataFinePeriodo: "2025-05-31" }],
    });
    const parsed = parseFatturaPaXml(xml);
    expect(parsed.lines[0].servicePeriodFrom).toBe("2025-05-01");
    expect(parsed.lines[0].servicePeriodTo).toBe("2025-05-31");
  });
});

describe("extractDocumentSeries", () => {
  it("riconosce il prefisso serie separato da /", () => {
    expect(extractDocumentSeries("V/123")).toEqual({ series: "V", numberPart: "123" });
  });

  it("riconosce il prefisso serie senza separatore", () => {
    expect(extractDocumentSeries("L45")).toEqual({ series: "L", numberPart: "45" });
  });

  it("numero puramente numerico -> nessuna serie, mai inventata", () => {
    expect(extractDocumentSeries("123")).toEqual({ series: null, numberPart: "123" });
  });
});

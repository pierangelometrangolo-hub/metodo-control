import { describe, expect, it } from "vitest";
import { classifyDocument, type DocumentClassificationOverride, type InitiativeDocumentOverride } from "../classificationProposer";
import type { NormalizedDocumentLine } from "../types";

function line(overrides: Partial<NormalizedDocumentLine>): NormalizedDocumentLine {
  return {
    lineNumber: 1,
    description: null,
    quantity: null,
    unit: null,
    unitPrice: null,
    netAmount: 100,
    vatRate: 22,
    vatAmount: null,
    servicePeriodFrom: null,
    servicePeriodTo: null,
    ...overrides,
  };
}

describe("classificationProposer", () => {
  it("righe uniformi -> proposal 'classified' a livello documento", () => {
    const lines = [
      line({ lineNumber: 1, description: "Consulenza Sales e Marketing dicembre 2024" }),
      line({ lineNumber: 2, description: "attività sales gennaio 2025" }),
    ];
    const result = classifyDocument(lines, "V");
    expect(result.status).toBe("classified");
    expect(result.documentLevelBusinessUnit?.code).toBe("consulenza");
  });

  it("righe con BU diverse -> 'classified_at_line_level', mai forzato a un solo BU", () => {
    const lines = [
      line({ lineNumber: 1, description: "Masterclass Breakfast Wow" }),
      line({ lineNumber: 2, description: "Puglia Destination Off - quota partecipazione" }),
    ];
    const result = classifyDocument(lines, null);
    expect(result.status).toBe("classified_at_line_level");
    expect(result.documentLevelBusinessUnit).toBeNull();
    expect(result.lineProposals[0].businessUnitCandidate?.code).toBe("formazione");
    expect(result.lineProposals[1].businessUnitCandidate?.code).toBe("eventi");
  });

  it("caso BIT: co-partecipazione BIT nello stesso documento di Consulenza Sales & Marketing -> tutto Consulenza, non Eventi", () => {
    const lines = [
      line({ lineNumber: 1, description: "Consulenza sales e Marketing dicembre 2024" }),
      line({ lineNumber: 2, description: "co-partecipazione BIT 2025" }),
    ];
    const result = classifyDocument(lines, "V");
    expect(result.status).toBe("classified");
    expect(result.documentLevelBusinessUnit?.code).toBe("consulenza");
  });

  it("caso BIT confermato dal business (batch 2025): co-partecipazione BIT STANDALONE (fattura a riga singola) -> Consulenza, non Eventi, non unclassified", () => {
    // Casi reali V00005 (Volito) e V00006 (La Roccia): documento con
    // un'unica riga, nessuna riga "Consulenza Sales & Marketing" compagna
    // - prima di questa conferma di business restavano unclassified.
    const result = classifyDocument([line({ description: "co-partecipazione BIT 2025 Volito Hotel" })], "V");
    expect(result.status).toBe("classified");
    expect(result.documentLevelBusinessUnit?.code).toBe("consulenza");
  });

  it("un bare 'BIT' fuori dal contesto 'co-partecipazione' non matcha nulla - mai una regola assoluta BIT=Consulenza", () => {
    const result = classifyDocument([line({ description: "Rimborso spese trasferta BIT Milano" })], "V");
    expect(result.status).toBe("unclassified");
  });

  it("Professione Mystery Guest -> Formazione (confermato dal business)", () => {
    const result = classifyDocument([line({ description: "Quota di iscrizione al corso PROFESSIONE MYSTERY GUEST" })], "L");
    expect(result.status).toBe("classified");
    expect(result.documentLevelBusinessUnit?.code).toBe("formazione");
  });

  it("Networking Post BTM 2025 -> Eventi, project BTM 2025 (confermato dal business)", () => {
    const result = classifyDocument([line({ description: "Contributo partnership - Networking Post BTM 2025" })], "L");
    expect(result.status).toBe("classified");
    expect(result.documentLevelBusinessUnit?.code).toBe("eventi");
    expect(result.documentLevelProjectCode).toBe("btm-2025");
  });

  it("Masterclass -> Formazione", () => {
    const result = classifyDocument([line({ description: "Masterclass Disintermediazione" })], null);
    expect(result.status).toBe("classified");
    expect(result.documentLevelBusinessUnit?.code).toBe("formazione");
  });

  it("Puglia Destination Off -> Eventi, project PDO", () => {
    const result = classifyDocument([line({ description: "Puglia Destination Off 2025 - co-partecipazione" })], "L");
    expect(result.status).toBe("classified");
    expect(result.documentLevelBusinessUnit?.code).toBe("eventi");
    expect(result.documentLevelProjectCode).toBe("pdo");
  });

  it("la serie non influenza mai la classificazione (V su un documento di Formazione)", () => {
    const result = classifyDocument([line({ description: "Masterclass L'AI Spiegata Semplice" })], "V");
    expect(result.documentLevelBusinessUnit?.code).toBe("formazione");
    expect(result.seriesSignal.series).toBe("V"); // il segnale e' riportato per analisi, ma non determina l'esito
  });

  it("nessuna riga con pattern riconosciuto -> 'unclassified'", () => {
    const result = classifyDocument([line({ description: "Acconto fattura n. 45" })], null);
    expect(result.status).toBe("unclassified");
    expect(result.documentLevelBusinessUnit).toBeNull();
  });

  describe("override documento-specifico (decisioni Referral)", () => {
    const overrides: DocumentClassificationOverride[] = [
      { documentNumber: "V00093", businessUnitCode: "referral", reason: "Attivita' di supporto commerciale confermata Referral per questo documento specifico" },
    ];

    it("un documento con override viene classificato secondo la decisione puntuale, non secondo le regole generiche", () => {
      const result = classifyDocument(
        [line({ description: "Attivita' di supporto commerciale" })],
        "V",
        undefined,
        "V00093",
        overrides
      );
      expect(result.status).toBe("classified");
      expect(result.documentLevelBusinessUnit?.code).toBe("referral");
      expect(result.documentLevelBusinessUnit?.reason).toContain("Override documento-specifico");
    });

    it("la STESSA descrizione su un documento NON presente negli override non diventa mai Referral automaticamente", () => {
      // Prova esplicita che non e' stata introdotta una regola generalizzata
      // - la stessa frase su un altro numero documento resta unclassified.
      const result = classifyDocument(
        [line({ description: "Attivita' di supporto commerciale" })],
        "V",
        undefined,
        "V99999",
        overrides
      );
      expect(result.status).toBe("unclassified");
    });
  });

  describe("override documento-specifico (Initiative - caso reale Puglia Wedding/PDO New York 2025)", () => {
    const initiativeOverrides: InitiativeDocumentOverride[] = [
      { documentNumber: "L00002", initiativeCode: "new-york-2025", reason: "Confermato dal business: evento PDO New York 2025 (Puglia Wedding Production Association)" },
    ];

    it('[TEST A] "Quota di partecipazione evento Puglia Destination Off per n. 2 persone" (L00002, caso reale) -> Eventi / PDO / New York 2025', () => {
      const result = classifyDocument(
        [line({ description: 'Quota di partecipazione evento "Puglia Destination Off" per n. 2 persone' })],
        "L",
        undefined,
        "L00002",
        undefined,
        initiativeOverrides
      );
      // BU e Project restano dedotti dalla regola generica esistente (pattern
      // "Puglia Destination Off"/PDO) - la reason NON diventa mai "Override
      // documento-specifico", perche' quella parte della classificazione non
      // e' stata forzata, solo l'Initiative lo e' stata.
      expect(result.status).toBe("classified");
      expect(result.documentLevelBusinessUnit?.code).toBe("eventi");
      expect(result.documentLevelBusinessUnit?.reason).not.toContain("Override documento-specifico");
      expect(result.documentLevelProjectCode).toBe("pdo");
      expect(result.documentLevelInitiativeCode).toBe("new-york-2025");
      expect(result.lineProposals[0].initiativeCandidateCode).toBe("new-york-2025");
    });

    it('[TEST B] la stessa descrizione generica "Puglia Destination Off" su un ALTRO documento non presente nell\'elenco initiative NON diventa mai "New York 2025" per somiglianza testuale', () => {
      // Regression esplicita sulla scoperta Fase 1D: esistono altri documenti
      // PDO con testo identico o con citta' diverse ("- NY", "- Londra") - un
      // singolo documento business-confermato non deve mai propagarsi per
      // pattern agli altri.
      const result = classifyDocument(
        [line({ description: 'Quota di partecipazione evento "Puglia Destination Off"' })],
        "L",
        undefined,
        "L00099-NON-IN-ELENCO",
        undefined,
        initiativeOverrides
      );
      expect(result.documentLevelBusinessUnit?.code).toBe("eventi");
      expect(result.documentLevelProjectCode).toBe("pdo");
      expect(result.documentLevelInitiativeCode).toBeNull();
    });

    it('[TEST B] la classificazione BU/Project/Initiative non dipende MAI dallo stato di risoluzione della counterparty - classifyDocument non riceve ne\' richiede alcun dato di controparte', () => {
      // Prova strutturale: la firma di classifyDocument (lines, series, rules,
      // documentNumber, overrides, initiativeOverrides) non include ne' un
      // parametro ne' un dato di controparte - la classificazione e la
      // risoluzione counterparty sono pipeline indipendenti per costruzione,
      // non solo per comportamento osservato. Verificato anche empiricamente
      // sul batch reale (L00002: counterparty "unresolved", classification
      // "classified" con questo stesso risultato - vedi report Fase 1D).
      const result = classifyDocument(
        [line({ description: 'Quota di partecipazione evento "Puglia Destination Off" per n. 2 persone' })],
        "L",
        undefined,
        "L00002",
        undefined,
        initiativeOverrides
      );
      expect(result.documentLevelInitiativeCode).toBe("new-york-2025");
    });

    it("un override Initiative su un documento SENZA project risolto non viene applicato silenziosamente (nessun aggancio valido)", () => {
      const result = classifyDocument(
        [line({ description: "Acconto fattura n. 45" })], // nessun pattern -> unclassified, nessun project
        null,
        undefined,
        "L00002",
        undefined,
        initiativeOverrides
      );
      expect(result.status).toBe("unclassified");
      expect(result.documentLevelInitiativeCode).toBeNull();
    });
  });

  describe("regola semantica generica Initiative PDO (New York 2025 / Londra 2025 - caso reale audit 15 fatture PDO)", () => {
    it('[TEST 1] PDO + "NY" -> New York 2025', () => {
      const result = classifyDocument([line({ description: 'Quota di partecipazione evento "Puglia Destination Off - NY"' })], "L");
      expect(result.documentLevelBusinessUnit?.code).toBe("eventi");
      expect(result.documentLevelProjectCode).toBe("pdo");
      expect(result.documentLevelInitiativeCode).toBe("new-york-2025");
    });

    it('[TEST 2] PDO + "New York" -> New York 2025', () => {
      const result = classifyDocument([line({ description: 'Puglia Destination Off - New York, quota di partecipazione' })], "L");
      expect(result.documentLevelInitiativeCode).toBe("new-york-2025");
    });

    it('[TEST 3] PDO + "Londra" -> Londra 2025', () => {
      const result = classifyDocument([line({ description: 'Quota di partecipazione "Puglia Destination Off - Londra"' })], "L");
      expect(result.documentLevelBusinessUnit?.code).toBe("eventi");
      expect(result.documentLevelProjectCode).toBe("pdo");
      expect(result.documentLevelInitiativeCode).toBe("londra-2025");
    });

    it('[TEST 4] PDO + "London" -> Londra 2025', () => {
      const result = classifyDocument([line({ description: "Puglia Destination Off - London edition, participation fee" })], "L");
      expect(result.documentLevelInitiativeCode).toBe("londra-2025");
    });

    it('[TEST 5] "NY" su documento NON PDO -> New York 2025 NON assegnata (nessuna regola globale NY->PDO)', () => {
      const result = classifyDocument([line({ description: "Trasferta commerciale a NY per incontro cliente" })], null);
      expect(result.documentLevelProjectCode).not.toBe("pdo");
      expect(result.documentLevelInitiativeCode).toBeNull();
    });

    it('[TEST 6] "Londra" su documento NON PDO -> Londra 2025 NON assegnata', () => {
      const result = classifyDocument([line({ description: "Masterclass Disintermediazione - sessione Londra" })], null);
      expect(result.documentLevelBusinessUnit?.code).toBe("formazione");
      expect(result.documentLevelInitiativeCode).toBeNull();
    });

    it("[TEST 7] PDO senza citta' -> Initiative NULL, salvo override business esplicito L00002 (nessuna deduzione dalla sola data, qui nemmeno passata alla funzione)", () => {
      const result = classifyDocument([line({ description: 'Quota di partecipazione evento "Puglia Destination Off" per n. 2 persone' })], "L");
      expect(result.documentLevelBusinessUnit?.code).toBe("eventi");
      expect(result.documentLevelProjectCode).toBe("pdo");
      expect(result.documentLevelInitiativeCode).toBeNull();
    });

    it("[TEST 8] L00002 (override business puntuale) -> New York 2025, anche senza alcun segnale testuale", () => {
      const result = classifyDocument(
        [line({ description: 'Quota di partecipazione evento "Puglia Destination Off" per n. 2 persone' })],
        "L",
        undefined,
        "L00002",
        undefined,
        [{ documentNumber: "L00002", initiativeCode: "new-york-2025", reason: "Decisione business confermata" }]
      );
      expect(result.documentLevelInitiativeCode).toBe("new-york-2025");
    });

    it("documento con segnali CONTRADDITTORI (sia New York sia Londra) -> Initiative NULL, mai indovinata", () => {
      const result = classifyDocument(
        [
          line({ lineNumber: 1, description: 'Puglia Destination Off - NY, quota parziale' }),
          line({ lineNumber: 2, description: 'Puglia Destination Off - Londra, quota parziale' }),
        ],
        "L"
      );
      expect(result.documentLevelProjectCode).toBe("pdo");
      expect(result.documentLevelInitiativeCode).toBeNull();
    });
  });
});

// Tipi condivisi dell'ingestion engine Finance Core. Nessuna dipendenza da
// Consulting qui dentro - il motore e' generico (source -> normalized
// finance document + proposte), Consulting Revenue Control consumera' solo
// i documenti pertinenti dopo, non e' un partecipante di questa pipeline.

export type Direction = "receivable" | "payable";

export type SourceFileType = "xml" | "xml_p7m" | "receipt";

// ---------- Source layer (raw, mai modificato) ----------

export type RawSourceFile = {
  fileName: string;
  // Contenuto binario cosi' come letto dal file - per un .p7m e' il
  // pacchetto PKCS#7 completo, non l'XML estratto.
  content: Buffer;
  fileType: SourceFileType;
};

export type ExtractedSourceDocument = {
  originalFileName: string;
  sourceType: SourceFileType;
  sha256Hash: string;
  // XML FatturaPA in chiaro, ottenuto direttamente (fileType "xml") o
  // estratto dalla busta PKCS#7 (fileType "xml_p7m").
  xmlContent: string;
  // Presente solo se il file era un .p7m e la firma e' stata verificata
  // con successo - un fallimento di verifica NON blocca l'estrazione del
  // contenuto (serve comunque per il dry-run) ma viene segnalato.
  signatureVerified: boolean | null;
  signatureError: string | null;
};

// ---------- Documento normalizzato (proposta, mai scritta in dry-run) ----------

export type PartyInfo = {
  legalName: string | null;
  vatNumber: string | null;
  fiscalCode: string | null;
  address: string | null;
  pec: string | null;
  sdiCode: string | null;
};

export type NormalizedDocumentLine = {
  lineNumber: number;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  netAmount: number;
  vatRate: number | null;
  vatAmount: number | null;
  servicePeriodFrom: string | null;
  servicePeriodTo: string | null;
};

export type PaymentInfo = {
  dueDate: string | null;
  paymentTerms: string | null;
  paymentMethod: string | null;
};

export type CreditNoteInfo = {
  // true solo per TD04 (o equivalente) - il documento e' una nota di
  // credito/storno, non una fattura ordinaria.
  isCreditNote: boolean;
  // Riferimento al documento originario COSI' COME scritto nell'XML
  // sorgente (numero/data) - la risoluzione a un finance_documents.id
  // reale (related_document_id) e' un passo successivo, non fatto qui.
  referencedDocumentNumber: string | null;
  referencedDocumentDate: string | null;
  reasonDescription: string | null;
  proposedEconomicSign: 1 | -1;
};

export type NormalizedDocument = {
  sourceDocument: ExtractedSourceDocument;

  documentTypeCode: string; // "TD01" | "TD04" | ... - valore XML grezzo, mai reinterpretato qui
  documentNumber: string;
  documentSeries: string | null; // sezionale estratto dal numero documento
  documentDate: string;
  currency: string;
  direction: Direction;

  issuer: PartyInfo;
  counterpartyRaw: PartyInfo; // controparte cosi' come appare nell'XML, prima di qualunque matching

  netAmount: number;
  vatAmount: number;
  grossAmount: number;

  lines: NormalizedDocumentLine[];

  payment: PaymentInfo;
  creditNote: CreditNoteInfo;

  issuerMatchesExpectedLegalEntity: boolean;
  issuerMismatchDetail: string | null;
};

// ---------- Counterparty resolution ----------

export type CounterpartyMatchMethod = "vat_exact" | "fiscal_code_exact" | "crm_relation" | "normalized_name" | "none";
export type CounterpartyResolutionStatus = "matched" | "proposed" | "unresolved" | "ambiguous";

export type CounterpartyResolutionResult = {
  status: CounterpartyResolutionStatus;
  matchMethod: CounterpartyMatchMethod;
  matchedCounterpartyId: string | null;
  matchedCounterpartyDisplayName: string | null;
  ambiguousCandidateIds: string[]; // popolato solo quando status === "ambiguous"
  proposedNewCounterparty: PartyInfo | null; // popolato solo quando status === "unresolved" e non c'e' nulla su cui proporre un match debole
  notes: string;
};

// ---------- Competence resolution ----------

export type CompetenceResolutionMethod = "structured_period" | "description_month_year" | "unresolved";
export type CompetenceStatus = "resolved" | "missing_data";

export type CompetenceResolutionResult = {
  competenceFrom: string | null;
  competenceTo: string | null;
  status: CompetenceStatus;
  method: CompetenceResolutionMethod;
  detail: string;
};

// ---------- Classification proposal ----------

export type ClassificationStatusProposal = "classified" | "classified_at_line_level" | "needs_review" | "unclassified";

export type BusinessUnitCandidate = {
  code: string; // 'consulenza' | 'formazione' | 'eventi' - deve corrispondere a finance_business_units.code gia' seedati
  confidence: "high" | "medium" | "low";
  reason: string;
};

export type LineClassificationProposal = {
  lineNumber: number;
  businessUnitCandidate: BusinessUnitCandidate | null;
  projectCandidateCode: string | null; // es. 'pdo' - solo se riconoscibile con evidenza esplicita
  // Tappa/edizione sotto il Project (es. 'new-york-2025' sotto PDO) - solo
  // da override documento-specifico per ora, mai da un pattern generico
  // testuale (un progetto puo' avere piu' tappe con descrizioni identiche
  // o senza alcun segnale geografico in fattura).
  initiativeCandidateCode: string | null;
};

export type ClassificationProposal = {
  status: ClassificationStatusProposal;
  documentLevelBusinessUnit: BusinessUnitCandidate | null; // popolato solo se status === "classified"
  documentLevelProjectCode: string | null;
  documentLevelInitiativeCode: string | null;
  lineProposals: LineClassificationProposal[]; // popolato sempre, anche quando lo status e' "classified" (per trasparenza/audit)
  seriesSignal: { series: string | null; note: string }; // il segnale della serie, MAI usato come unica prova
};

// ---------- Consulting engagement candidate (usato solo per doc classificati Consulenza) ----------

export type EngagementCandidateStatus = "matched" | "ambiguous" | "unresolved" | "not_applicable";

export type EngagementCandidateResult = {
  status: EngagementCandidateStatus;
  candidateEngagementId: string | null;
  candidateEngagementName: string | null;
  ambiguousCandidates: { id: string; displayName: string }[];
  confidence: "high" | "medium" | "low" | null;
  reason: string;
};

// ---------- Audit per singolo documento (l'unita' del dry-run) ----------

export type DocumentAudit = {
  document: NormalizedDocument;
  counterpartyResolution: CounterpartyResolutionResult;
  competenceResolution: CompetenceResolutionResult; // a livello documento (competenza "principale")
  lineCompetenceResolutions: (CompetenceResolutionResult & { lineNumber: number })[];
  classification: ClassificationProposal;
  engagementCandidate: EngagementCandidateResult;
  parseErrors: string[]; // non vuoto se il documento e' stato parzialmente/non interpretabile - non blocca il batch
};

// ---------- Report di batch ----------

export type SeriesStat = {
  series: string;
  documentCount: number;
  netAmount: number;
  grossAmount: number;
  exampleDescriptions: string[];
};

export type DryRunReport = {
  generatedAt: string;
  dryRun: true;
  documents: {
    totalFiles: number;
    fiscalDocuments: number;
    receipts: number;
    parsedSuccessfully: number;
    failed: number;
  };
  types: Record<string, number>; // { TD01: n, TD04: n, ... }
  series: SeriesStat[];
  counterparties: {
    distinctFiscalCounterparties: number;
    matched: number;
    proposed: number;
    unresolved: number;
    ambiguous: number;
    unresolvedOrAmbiguousList: {
      documentNumber: string;
      counterparty: PartyInfo;
      status: CounterpartyResolutionStatus;
    }[];
  };
  competence: {
    resolved: number;
    unresolved: number;
    methodDistribution: Record<CompetenceResolutionMethod, number>;
  };
  classification: {
    // Conteggio per codice Business Unit, generico (Finance Core, non
    // specifico Consulting) - nuove BU non richiedono di toccare questo
    // tipo, compaiono semplicemente come nuova chiave.
    byBusinessUnit: Record<string, number>;
    classifiedAtLineLevel: number;
    needsReview: number;
    unclassified: number;
    businessUnitsSeeded: boolean; // false se finance_business_units risulta vuota - segnalato, non creata qui
  };
  projects: {
    pdoCandidates: number;
    otherProjectCandidates: string[];
  };
  creditNotes: {
    number: string;
    date: string;
    counterparty: PartyInfo;
    netAmount: number;
    grossAmount: number;
    referencedDocumentNumber: string | null;
    reason: string | null;
  }[];
  engagementCandidates: {
    matched: number;
    ambiguous: number;
    unresolved: number;
    notApplicable: number;
    ambiguousList: {
      documentNumber: string;
      counterpartyDisplayName: string | null;
      candidates: string[];
    }[];
  };
  issuerAnomalies: {
    documentNumber: string;
    detail: string;
  }[];
  documentAudits: DocumentAudit[]; // dettaglio completo, una riga per documento - usato per l'export CSV/JSON
};

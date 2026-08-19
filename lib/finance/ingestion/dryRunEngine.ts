import { sha256Hex } from "./hash";
import { extractXmlFromP7m } from "./p7mExtractor";
import { parseFatturaPaXml, extractDocumentSeries } from "./fatturaPaParser";
import { resolveCounterparty, normalizeVat, type CounterpartyRepository } from "./counterpartyResolver";
import { resolveCompetence } from "./competenceResolver";
import {
  classifyDocument,
  DEFAULT_CLASSIFICATION_RULES,
  type ClassificationRule,
  type DocumentClassificationOverride,
  type InitiativeDocumentOverride,
} from "./classificationProposer";
import { resolveEngagementCandidate, type EngagementRepository } from "./engagementResolver";
import type {
  CompetenceResolutionMethod,
  DocumentAudit,
  DryRunReport,
  ExtractedSourceDocument,
  NormalizedDocument,
  RawSourceFile,
  SeriesStat,
} from "./types";

export type ExpectedIssuer = {
  legalName: string;
  vatNumber: string;
};

export type DryRunOptions = {
  files: RawSourceFile[];
  expectedIssuer: ExpectedIssuer;
  counterpartyRepo: CounterpartyRepository;
  engagementRepo: EngagementRepository;
  // true se finance_business_units contiene gia' righe - se false, la
  // proposta di classificazione resta comunque calcolata (e' pura logica,
  // non serve il DB) ma il report deve segnalarlo chiaramente: non ha
  // senso proporre una BU che poi non esiste da nessuna parte da scrivere.
  businessUnitsSeeded: boolean;
  classificationRules?: ClassificationRule[];
  // Decisioni di business su documenti SPECIFICI (per numero) - mai una
  // regola generalizzabile per pattern. Vedi classificationProposer.ts:
  // "Attivita' di supporto commerciale" e simili non diventano una regola
  // testuale, restano decisioni puntuali su questi documenti.
  documentOverrides?: DocumentClassificationOverride[];
  initiativeOverrides?: InitiativeDocumentOverride[];
};

// Riusa la stessa normalizzazione di counterpartyResolver (strip prefisso
// paese) - avere due implementazioni separate e' esattamente cio' che ha
// causato il falso positivo "emittente inatteso" su tutti i 188 documenti
// del batch reale (questa copia locale non toglieva "IT", l'altra si').
function normalizeVatForCompare(vat: string | null): string {
  return normalizeVat(vat) ?? "";
}

function extractSourceDocument(file: RawSourceFile): { doc: ExtractedSourceDocument | null; error: string | null } {
  const hash = sha256Hex(file.content);

  if (file.fileType === "receipt") {
    return { doc: null, error: null }; // le ricevute non sono documenti fiscali - non producono un DocumentAudit, ma contano nel totale file
  }

  if (file.fileType === "xml_p7m") {
    const extracted = extractXmlFromP7m(file.content);
    if (extracted.signatureError && !extracted.content) {
      return { doc: null, error: `Estrazione P7M fallita per ${file.fileName}: ${extracted.signatureError}` };
    }
    return {
      doc: {
        originalFileName: file.fileName,
        sourceType: "xml_p7m",
        sha256Hash: hash,
        xmlContent: extracted.content,
        signatureVerified: extracted.signatureVerified,
        signatureError: extracted.signatureError,
      },
      error: null,
    };
  }

  // xml diretto (non firmato)
  return {
    doc: {
      originalFileName: file.fileName,
      sourceType: "xml",
      sha256Hash: hash,
      xmlContent: file.content.toString("utf-8"),
      signatureVerified: null,
      signatureError: null,
    },
    error: null,
  };
}

function documentFullText(doc: NormalizedDocument): string {
  const lineTexts = doc.lines.map((l) => l.description ?? "").join(" | ");
  return `${doc.creditNote.reasonDescription ?? ""} ${lineTexts}`;
}

export async function runDryRun(options: DryRunOptions): Promise<DryRunReport> {
  const { files, expectedIssuer, counterpartyRepo, engagementRepo, businessUnitsSeeded } = options;
  const rules = options.classificationRules ?? DEFAULT_CLASSIFICATION_RULES;
  const documentOverrides = options.documentOverrides ?? [];
  const initiativeOverrides = options.initiativeOverrides ?? [];

  const documentAudits: DocumentAudit[] = [];
  const issuerAnomalies: DryRunReport["issuerAnomalies"] = [];
  const typeCounts: Record<string, number> = {};
  const seriesMap = new Map<string, SeriesStat>();
  const competenceMethodDistribution: Record<CompetenceResolutionMethod, number> = {
    structured_period: 0,
    description_month_year: 0,
    unresolved: 0,
  };

  let receiptsCount = 0;
  let fiscalDocumentsCount = 0;
  let failedCount = 0;

  const distinctCounterpartyKeys = new Set<string>();
  let matchedCount = 0;
  let proposedCount = 0;
  let unresolvedCount = 0;
  let ambiguousCount = 0;
  const unresolvedOrAmbiguousList: DryRunReport["counterparties"]["unresolvedOrAmbiguousList"] = [];

  let competenceResolvedCount = 0;
  let competenceUnresolvedCount = 0;

  const byBusinessUnitCount: Record<string, number> = {};
  let classifiedAtLineLevelCount = 0;
  let needsReviewCount = 0;
  let unclassifiedCount = 0;
  let pdoCandidates = 0;
  const otherProjectCandidates = new Set<string>();

  const creditNotes: DryRunReport["creditNotes"] = [];

  let engagementMatched = 0;
  let engagementAmbiguous = 0;
  let engagementUnresolved = 0;
  let engagementNotApplicable = 0;
  const engagementAmbiguousList: DryRunReport["engagementCandidates"]["ambiguousList"] = [];

  for (const file of files) {
    if (file.fileType === "receipt") {
      receiptsCount += 1;
      continue;
    }

    const { doc: sourceDoc, error } = extractSourceDocument(file);
    if (error || !sourceDoc) {
      failedCount += 1;
      issuerAnomalies.push({ documentNumber: file.fileName, detail: error ?? "Estrazione fallita senza dettaglio." });
      continue;
    }

    fiscalDocumentsCount += 1;

    let parsed;
    try {
      parsed = parseFatturaPaXml(sourceDoc.xmlContent);
    } catch (err) {
      failedCount += 1;
      issuerAnomalies.push({
        documentNumber: file.fileName,
        detail: `Parsing FatturaPA fallito: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    typeCounts[parsed.documentTypeCode] = (typeCounts[parsed.documentTypeCode] ?? 0) + 1;

    const { series } = extractDocumentSeries(parsed.documentNumberRaw);

    const issuerMatches = normalizeVatForCompare(parsed.issuer.vatNumber) === normalizeVatForCompare(expectedIssuer.vatNumber);
    if (!issuerMatches) {
      issuerAnomalies.push({
        documentNumber: parsed.documentNumberRaw,
        detail: `Emittente inatteso: P.IVA ${parsed.issuer.vatNumber ?? "N/D"} (${parsed.issuer.legalName ?? "N/D"}) non corrisponde a ${expectedIssuer.legalName} (${expectedIssuer.vatNumber}). Documento NON escluso dal dry-run, solo segnalato.`,
      });
    }

    const document: NormalizedDocument = {
      sourceDocument: sourceDoc,
      documentTypeCode: parsed.documentTypeCode,
      documentNumber: parsed.documentNumberRaw,
      documentSeries: series,
      documentDate: parsed.documentDate,
      currency: parsed.currency,
      direction: "receivable", // le 188 fatture 2025 sono tutte emesse da GAP - il motore resta comunque generico, "direction" e' un campo del documento normalizzato, non un'assunzione strutturale dell'engine
      issuer: parsed.issuer,
      counterpartyRaw: parsed.counterparty,
      netAmount: parsed.netAmount,
      vatAmount: parsed.vatAmount,
      grossAmount: parsed.grossAmount,
      lines: parsed.lines,
      payment: parsed.payment,
      creditNote: parsed.creditNote,
      issuerMatchesExpectedLegalEntity: issuerMatches,
      issuerMismatchDetail: issuerMatches ? null : `P.IVA emittente ${parsed.issuer.vatNumber ?? "N/D"} != atteso ${expectedIssuer.vatNumber}`,
    };

    // Series stats
    const seriesKey = series ?? "(nessuna)";
    if (!seriesMap.has(seriesKey)) {
      seriesMap.set(seriesKey, { series: seriesKey, documentCount: 0, netAmount: 0, grossAmount: 0, exampleDescriptions: [] });
    }
    const seriesStat = seriesMap.get(seriesKey)!;
    seriesStat.documentCount += 1;
    seriesStat.netAmount += document.netAmount;
    seriesStat.grossAmount += document.grossAmount;
    if (seriesStat.exampleDescriptions.length < 3) {
      const firstLineDesc = document.lines[0]?.description;
      if (firstLineDesc) seriesStat.exampleDescriptions.push(firstLineDesc);
    }

    // Counterparty resolution
    const counterpartyResolution = await resolveCounterparty(document.counterpartyRaw, counterpartyRepo);
    const cpKey = normalizeVatForCompare(document.counterpartyRaw.vatNumber) || document.counterpartyRaw.legalName || "?";
    distinctCounterpartyKeys.add(cpKey);
    if (counterpartyResolution.status === "matched") matchedCount += 1;
    else if (counterpartyResolution.status === "proposed") proposedCount += 1;
    else if (counterpartyResolution.status === "unresolved") unresolvedCount += 1;
    else if (counterpartyResolution.status === "ambiguous") ambiguousCount += 1;
    if (counterpartyResolution.status === "unresolved" || counterpartyResolution.status === "ambiguous") {
      unresolvedOrAmbiguousList.push({
        documentNumber: document.documentNumber,
        counterparty: document.counterpartyRaw,
        status: counterpartyResolution.status,
      });
    }

    // Competence resolution (documento) - usa il primo periodo di riga disponibile + causale/descrizione come fallback
    const firstLineWithPeriod = document.lines.find((l) => l.servicePeriodFrom && l.servicePeriodTo);
    const docDescription = document.creditNote.reasonDescription ?? document.lines[0]?.description ?? null;
    const competenceResolution = resolveCompetence(
      firstLineWithPeriod?.servicePeriodFrom ?? null,
      firstLineWithPeriod?.servicePeriodTo ?? null,
      docDescription
    );
    competenceMethodDistribution[competenceResolution.method] += 1;
    if (competenceResolution.status === "resolved") competenceResolvedCount += 1;
    else competenceUnresolvedCount += 1;

    const lineCompetenceResolutions = document.lines.map((line) => ({
      lineNumber: line.lineNumber,
      ...resolveCompetence(line.servicePeriodFrom, line.servicePeriodTo, line.description),
    }));

    // Classification
    const classification = classifyDocument(document.lines, series, rules, document.documentNumber, documentOverrides, initiativeOverrides);
    if (classification.status === "classified") {
      const buCode = classification.documentLevelBusinessUnit?.code;
      if (buCode) byBusinessUnitCount[buCode] = (byBusinessUnitCount[buCode] ?? 0) + 1;
      if (classification.documentLevelProjectCode === "pdo") pdoCandidates += 1;
      if (classification.documentLevelProjectCode && classification.documentLevelProjectCode !== "pdo") {
        otherProjectCandidates.add(classification.documentLevelProjectCode);
      }
    } else if (classification.status === "classified_at_line_level") {
      classifiedAtLineLevelCount += 1;
    } else if (classification.status === "needs_review") {
      needsReviewCount += 1;
    } else {
      unclassifiedCount += 1;
    }

    // Engagement candidate - solo se pertinente a Consulenza
    const touchesConsulenza =
      (classification.status === "classified" && classification.documentLevelBusinessUnit?.code === "consulenza") ||
      (classification.status === "classified_at_line_level" &&
        classification.lineProposals.some((p) => p.businessUnitCandidate?.code === "consulenza"));

    let engagementCandidate;
    if (!touchesConsulenza) {
      engagementCandidate = {
        status: "not_applicable" as const,
        candidateEngagementId: null,
        candidateEngagementName: null,
        ambiguousCandidates: [],
        confidence: null,
        reason: "Documento non classificato (in tutto o in parte) come Consulenza - risoluzione engagement non pertinente.",
      };
      engagementNotApplicable += 1;
    } else {
      engagementCandidate = await resolveEngagementCandidate(
        counterpartyResolution.matchedCounterpartyId,
        documentFullText(document),
        engagementRepo
      );
      if (engagementCandidate.status === "matched") engagementMatched += 1;
      else if (engagementCandidate.status === "ambiguous") {
        engagementAmbiguous += 1;
        engagementAmbiguousList.push({
          documentNumber: document.documentNumber,
          counterpartyDisplayName: counterpartyResolution.matchedCounterpartyDisplayName,
          candidates: engagementCandidate.ambiguousCandidates.map((c) => c.displayName),
        });
      } else if (engagementCandidate.status === "unresolved") engagementUnresolved += 1;
    }

    // Credit note aggregation
    if (document.creditNote.isCreditNote) {
      creditNotes.push({
        number: document.documentNumber,
        date: document.documentDate,
        counterparty: document.counterpartyRaw,
        netAmount: document.netAmount,
        grossAmount: document.grossAmount,
        referencedDocumentNumber: document.creditNote.referencedDocumentNumber,
        reason: document.creditNote.reasonDescription,
      });
    }

    documentAudits.push({
      document,
      counterpartyResolution,
      competenceResolution,
      lineCompetenceResolutions,
      classification,
      engagementCandidate,
      parseErrors: parsed.parseWarnings,
    });
  }

  const series: SeriesStat[] = [...seriesMap.values()].sort((a, b) => b.documentCount - a.documentCount);

  return {
    generatedAt: new Date().toISOString(),
    dryRun: true,
    documents: {
      totalFiles: files.length,
      fiscalDocuments: fiscalDocumentsCount,
      receipts: receiptsCount,
      parsedSuccessfully: documentAudits.length,
      failed: failedCount,
    },
    types: typeCounts,
    series,
    counterparties: {
      distinctFiscalCounterparties: distinctCounterpartyKeys.size,
      matched: matchedCount,
      proposed: proposedCount,
      unresolved: unresolvedCount,
      ambiguous: ambiguousCount,
      unresolvedOrAmbiguousList,
    },
    competence: {
      resolved: competenceResolvedCount,
      unresolved: competenceUnresolvedCount,
      methodDistribution: competenceMethodDistribution,
    },
    classification: {
      byBusinessUnit: byBusinessUnitCount,
      classifiedAtLineLevel: classifiedAtLineLevelCount,
      needsReview: needsReviewCount,
      unclassified: unclassifiedCount,
      businessUnitsSeeded,
    },
    projects: {
      pdoCandidates,
      otherProjectCandidates: [...otherProjectCandidates],
    },
    creditNotes,
    engagementCandidates: {
      matched: engagementMatched,
      ambiguous: engagementAmbiguous,
      unresolved: engagementUnresolved,
      notApplicable: engagementNotApplicable,
      ambiguousList: engagementAmbiguousList,
    },
    issuerAnomalies,
    documentAudits,
  };
}

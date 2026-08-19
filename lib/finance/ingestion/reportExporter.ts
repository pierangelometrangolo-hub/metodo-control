import type { DryRunReport } from "./types";

export function reportToJson(report: DryRunReport): string {
  return JSON.stringify(report, null, 2);
}

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const CSV_COLUMNS = [
  "document_number",
  "document_series",
  "document_type",
  "document_date",
  "counterparty_legal_name",
  "counterparty_vat",
  "counterparty_resolution_status",
  "counterparty_match_method",
  "matched_counterparty_display_name",
  "net_amount",
  "gross_amount",
  "is_credit_note",
  "competence_from",
  "competence_to",
  "competence_status",
  "competence_method",
  "classification_status",
  "classification_business_unit",
  "classification_project",
  "engagement_status",
  "engagement_candidate_name",
  "issuer_matches_expected",
  "parse_warnings",
] as const;

// Una riga per DOCUMENTO (non per riga di fattura) - sufficiente per
// l'audit richiesto in sezione 19. Il dettaglio riga per riga resta nel
// JSON completo (documentAudits[].document.lines), non duplicato qui.
export function reportToCsv(report: DryRunReport): string {
  const rows = report.documentAudits.map((audit) => {
    const d = audit.document;
    const row: Record<(typeof CSV_COLUMNS)[number], unknown> = {
      document_number: d.documentNumber,
      document_series: d.documentSeries,
      document_type: d.documentTypeCode,
      document_date: d.documentDate,
      counterparty_legal_name: d.counterpartyRaw.legalName,
      counterparty_vat: d.counterpartyRaw.vatNumber,
      counterparty_resolution_status: audit.counterpartyResolution.status,
      counterparty_match_method: audit.counterpartyResolution.matchMethod,
      matched_counterparty_display_name: audit.counterpartyResolution.matchedCounterpartyDisplayName,
      net_amount: d.netAmount,
      gross_amount: d.grossAmount,
      is_credit_note: d.creditNote.isCreditNote,
      competence_from: audit.competenceResolution.competenceFrom,
      competence_to: audit.competenceResolution.competenceTo,
      competence_status: audit.competenceResolution.status,
      competence_method: audit.competenceResolution.method,
      classification_status: audit.classification.status,
      classification_business_unit: audit.classification.documentLevelBusinessUnit?.code ?? "",
      classification_project: audit.classification.documentLevelProjectCode ?? "",
      engagement_status: audit.engagementCandidate.status,
      engagement_candidate_name: audit.engagementCandidate.candidateEngagementName,
      issuer_matches_expected: d.issuerMatchesExpectedLegalEntity,
      parse_warnings: audit.parseErrors.join(" | "),
    };
    return CSV_COLUMNS.map((col) => csvEscape(row[col])).join(",");
  });

  return [CSV_COLUMNS.join(","), ...rows].join("\n");
}

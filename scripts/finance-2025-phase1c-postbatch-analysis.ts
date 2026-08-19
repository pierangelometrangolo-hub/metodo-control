// Fase 1C - analisi POST batch approval: ri-esegue il dry-run (sola
// lettura, NESSUNA scrittura - ne' su finance_documents ne' su
// consulting_engagements) per misurare l'effetto reale della batch
// creation delle 69 counterparties, costruisce la CRM Candidate Queue
// (report, nessuna scrittura su crm_clients), l'audit dei documenti
// Consulenza senza engagement, la verifica Kelina/Villa Neviera e il
// regression check finale.
//
// Uso: npx tsx scripts/finance-2025-phase1c-postbatch-analysis.ts <path-allo-zip>

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { extractFilesFromZip } from "../lib/finance/ingestion/zipExtractor";
import { runDryRun } from "../lib/finance/ingestion/dryRunEngine";
import { reportToJson, reportToCsv } from "../lib/finance/ingestion/reportExporter";
import { buildCounterpartyProposals } from "../lib/finance/ingestion/counterpartyProposalAggregator";
import type { DocumentClassificationOverride } from "../lib/finance/ingestion/classificationProposer";
import {
  SupabaseCounterpartyRepository,
  SupabaseEngagementRepository,
  checkBusinessUnitsSeeded,
  fetchExpectedIssuer,
} from "../lib/finance/ingestion/supabaseRepositories";
import type { DocumentAudit } from "../lib/finance/ingestion/types";

// Stessa lista usata nel dry-run originale (finance-2025-dry-run.ts) - non
// duplicata per caso, e' la STESSA decisione di business, deve restare
// identica tra le due esecuzioni o il regression check sulla
// classificazione perderebbe di senso.
const REFERRAL_DOCUMENT_OVERRIDES: DocumentClassificationOverride[] = [
  { documentNumber: "V00093", businessUnitCode: "referral", reason: "Attivita' di supporto commerciale - confermato Referral dal business per questo documento" },
  { documentNumber: "V00069", businessUnitCode: "referral", reason: "Riconoscimento per segnalazione cliente - confermato Referral dal business per questo documento" },
  { documentNumber: "V00007", businessUnitCode: "referral", reason: "Revenue share anno 2024 - confermato Referral dal business per questo documento" },
];

// Consulenze storiche gia' deliberate Finance-only PRIMA di questa fase
// (decisione pregressa, sessione Finance Core / audit CRM<->Counterparty) -
// per nome display_name, mai per euristica. Escluse dalla CRM Candidate
// Queue indipendentemente da quali BU tocchino i loro documenti 2025.
const PRE_DELIBERATED_FINANCE_ONLY = new Set(["Borgo Bevagna", "Kelina", "Sarmenti", "Giorgia", "Volito", "La Roccia", "La Villa", "Sea Garden"]);

const EXPECTED_REGRESSION = {
  fiscalDocuments: 188,
  td01: 184,
  td04: 4,
  netAmount: 257616.44,
  vatAmount: 56675.67,
  grossAmount: 314292.11,
  byBusinessUnit: { consulenza: 88, formazione: 70, eventi: 23, referral: 3 },
  unclassified: 4,
};

function loadEnv() {
  const envPath = path.resolve(__dirname, "../.env.local");
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }
}

type CrmCandidateRecord = {
  counterparty_id: string;
  display_name: string;
  legal_name: string | null;
  vat_number: string | null;
  fiscal_code: string | null;
  current_crm_client_id: string | null;
  n_documenti_2025: number;
  imponibile_totale: number;
  business_units_coinvolte: string[];
  projects_coinvolti: string[];
  classification_reason: string[];
  candidate_reason: string;
  proposed_action: "propose_crm_create" | "already_linked" | "finance_only" | "needs_review";
  confidence: "high" | "medium" | "low";
  notes: string;
};

async function main() {
  const zipPath = process.argv[2];
  if (!zipPath) {
    console.error("Uso: npx tsx scripts/finance-2025-phase1c-postbatch-analysis.ts <path-allo-zip>");
    process.exit(1);
  }

  loadEnv();
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const counterpartyRepo = new SupabaseCounterpartyRepository(client);

  const expectedIssuer = await fetchExpectedIssuer(client);
  const businessUnitsSeeded = await checkBusinessUnitsSeeded(client);
  const zipBuffer = fs.readFileSync(zipPath);
  const files = extractFilesFromZip(zipBuffer);

  console.log("Ri-eseguo il dry-run completo (sola lettura, nessun import)...");
  const report = await runDryRun({
    files,
    expectedIssuer,
    counterpartyRepo,
    engagementRepo: new SupabaseEngagementRepository(client),
    businessUnitsSeeded,
    documentOverrides: REFERRAL_DOCUMENT_OVERRIDES,
  });

  const counterpartyProposalsAfter = await buildCounterpartyProposals(report.documentAudits, counterpartyRepo);

  const outDir = path.resolve(__dirname, "../data/generated");
  fs.writeFileSync(path.join(outDir, "finance-2025-ingestion-audit-postbatch.json"), reportToJson(report));
  fs.writeFileSync(path.join(outDir, "finance-2025-ingestion-audit-postbatch.csv"), reportToCsv(report));
  fs.writeFileSync(path.join(outDir, "finance-2025-counterparty-proposals-postbatch.json"), JSON.stringify(counterpartyProposalsAfter, null, 2));

  // ============ E/F: confronto risoluzione documenti + identita' ============
  const documentResolutionAfter = {
    matched: report.counterparties.matched,
    proposed: report.counterparties.proposed,
    unresolved: report.counterparties.unresolved,
    ambiguous: report.counterparties.ambiguous,
  };
  const identityResolutionAfter: Record<string, number> = {};
  for (const p of counterpartyProposalsAfter) identityResolutionAfter[p.proposedAction] = (identityResolutionAfter[p.proposedAction] ?? 0) + 1;

  // ============ G: audit engagement Consulenza (solo, nessuna creazione) ============
  const consulenzaTouchingUnresolved: DocumentAudit[] = report.documentAudits.filter((a) => {
    const touchesConsulenza =
      (a.classification.status === "classified" && a.classification.documentLevelBusinessUnit?.code === "consulenza") ||
      (a.classification.status === "classified_at_line_level" && a.classification.lineProposals.some((p) => p.businessUnitCandidate?.code === "consulenza"));
    return touchesConsulenza && a.engagementCandidate.status !== "matched";
  });

  const consultingUnresolvedDetail = consulenzaTouchingUnresolved.map((a) => ({
    counterparty: a.document.counterpartyRaw.legalName,
    vatNumber: a.document.counterpartyRaw.vatNumber,
    fiscalCode: a.document.counterpartyRaw.fiscalCode,
    documentNumber: a.document.documentNumber,
    documentDate: a.document.documentDate,
    description: a.document.creditNote.reasonDescription ?? a.document.lines[0]?.description ?? null,
    netAmount: a.document.netAmount,
    competenceStatus: a.competenceResolution.status,
    counterpartyResolutionStatus: a.counterpartyResolution.status,
    matchedCounterpartyId: a.counterpartyResolution.matchedCounterpartyId,
    matchedCounterpartyDisplayName: a.counterpartyResolution.matchedCounterpartyDisplayName,
    engagementStatus: a.engagementCandidate.status,
    engagementCandidates: a.engagementCandidate.ambiguousCandidates,
    reason: a.engagementCandidate.reason,
  }));

  // ============ I: validazione Kelina / Villa Neviera ============
  const kelinaDocs = report.documentAudits.filter((a) => a.engagementCandidate.candidateEngagementName === "Kelina");
  const villaNevieraDocs = report.documentAudits.filter((a) => a.engagementCandidate.candidateEngagementName === "Villa Neviera");

  // ============ D: CRM Candidate Queue ============
  type Group = {
    counterpartyId: string;
    docs: DocumentAudit[];
  };
  const groups = new Map<string, Group>();
  for (const a of report.documentAudits) {
    const id = a.counterpartyResolution.matchedCounterpartyId;
    if (!id) continue; // solo documenti con counterparty risolta - senza id non c'e' nulla da mettere in coda
    if (!groups.has(id)) groups.set(id, { counterpartyId: id, docs: [] });
    groups.get(id)!.docs.push(a);
  }

  const allCounterparties = await counterpartyRepo.findAll();
  const cpById = new Map(allCounterparties.map((c) => [c.id, c]));

  const candidates: CrmCandidateRecord[] = [];
  for (const [id, group] of groups.entries()) {
    const cp = cpById.get(id);
    if (!cp) continue;

    const businessUnitsSet = new Set<string>();
    const projectsSet = new Set<string>();
    const reasonsSet = new Set<string>();
    let hasUnclassifiedOrLineLevelOrNeedsReview = false;

    for (const a of group.docs) {
      const c = a.classification;
      if (c.status === "classified") {
        if (c.documentLevelBusinessUnit) {
          businessUnitsSet.add(c.documentLevelBusinessUnit.code);
          reasonsSet.add(c.documentLevelBusinessUnit.reason);
        }
        if (c.documentLevelProjectCode) projectsSet.add(c.documentLevelProjectCode);
      } else {
        hasUnclassifiedOrLineLevelOrNeedsReview = true;
        for (const lp of c.lineProposals) {
          if (lp.businessUnitCandidate) {
            businessUnitsSet.add(lp.businessUnitCandidate.code);
            reasonsSet.add(lp.businessUnitCandidate.reason);
          }
          if (lp.projectCandidateCode) projectsSet.add(lp.projectCandidateCode);
        }
      }
    }

    const netTotal = group.docs.reduce((sum, a) => sum + a.document.netAmount, 0);
    const touchesFormazione = businessUnitsSet.has("formazione");
    const touchesReferral = businessUnitsSet.has("referral");
    const touchesPdo = projectsSet.has("pdo");
    const onlyConsulenza = businessUnitsSet.size === 1 && businessUnitsSet.has("consulenza") && !hasUnclassifiedOrLineLevelOrNeedsReview;

    let proposedAction: CrmCandidateRecord["proposed_action"];
    let candidateReason: string;
    let confidence: CrmCandidateRecord["confidence"];

    if (cp.crmClientId) {
      proposedAction = "already_linked";
      candidateReason = "Gia' collegata a un crm_clients esistente (counterparties.crm_client_id valorizzato) - nessuna azione necessaria.";
      confidence = "high";
    } else if (PRE_DELIBERATED_FINANCE_ONLY.has(cp.displayName)) {
      proposedAction = "finance_only";
      candidateReason = "Consulenza storica gia' deliberata Finance-only (decisione pregressa, audit CRM<->Counterparty) - esclusa dalla coda indipendentemente dalle BU toccate nel batch 2025.";
      confidence = "high";
    } else if (touchesFormazione) {
      proposedAction = "propose_crm_create";
      candidateReason = "Criterio A: almeno un documento 2025 classificato Business Unit = Formazione.";
      confidence = "high";
    } else if (touchesPdo) {
      proposedAction = "propose_crm_create";
      candidateReason = "Criterio B: almeno un documento 2025 con Project = PDO.";
      confidence = "high";
    } else if (touchesReferral) {
      proposedAction = "propose_crm_create";
      candidateReason = "Criterio C: almeno un documento 2025 classificato Business Unit = Referral / Partnership Commerciali.";
      confidence = "high";
    } else if (onlyConsulenza) {
      proposedAction = "finance_only";
      candidateReason = "Unica BU toccata e' Consulenza, nessun altro segnale - la sola BU Consulenza non e' criterio automatico di candidatura CRM (regola esplicita Fase 1C).";
      confidence = "medium";
    } else if (hasUnclassifiedOrLineLevelOrNeedsReview) {
      // Caso D (letterale): almeno un documento e' davvero unclassified/ibrido a livello di riga.
      proposedAction = "needs_review";
      candidateReason = "Criterio D: almeno un documento del batch e' unclassified/ibrido a livello di riga - non e' possibile escludere con certezza un ruolo non puramente fiscale, regola di sicurezza applicata (entra in coda per revisione).";
      confidence = "low";
    } else {
      // Nessuno dei criteri A/B/C soddisfatto, ma la classificazione e'
      // PULITA (non ibrida/unclassified) - es. Eventi non-PDO (Networking
      // Post BTM 2025). Non e' "dubbio" in senso letterale, ma non e'
      // nemmeno un caso di esclusione esplicita (non e' supplier/consultant
      // puro, non e' una consulenza storica deliberata) - va in coda per
      // decisione Master, con un motivo onesto e distinto dal caso D reale.
      proposedAction = "needs_review";
      candidateReason = `Nessun criterio di inclusione automatica (A/B/C) soddisfatto - BU coinvolta: ${[...businessUnitsSet].join(", ") || "nessuna"}${projectsSet.size > 0 ? `, project: ${[...projectsSet].join(", ")}` : ""} - non e' un caso di esclusione esplicita (non e' supplier/consultant puro ne' una consulenza storica gia' deliberata), richiede decisione Master.`;
      confidence = "medium";
    }

    candidates.push({
      counterparty_id: cp.id,
      display_name: cp.displayName,
      legal_name: cp.legalName,
      vat_number: cp.vatNumber,
      fiscal_code: cp.fiscalCode,
      current_crm_client_id: cp.crmClientId,
      n_documenti_2025: group.docs.length,
      imponibile_totale: Math.round(netTotal * 100) / 100,
      business_units_coinvolte: [...businessUnitsSet],
      projects_coinvolti: [...projectsSet],
      classification_reason: [...reasonsSet],
      candidate_reason: candidateReason,
      proposed_action: proposedAction,
      confidence,
      notes: hasUnclassifiedOrLineLevelOrNeedsReview
        ? "Almeno un documento di questa counterparty non ha una classificazione BU pulita a livello documento (unclassified o disaccordo tra righe)."
        : "",
    });
  }

  candidates.sort((a, b) => {
    const order = { propose_crm_create: 0, needs_review: 1, already_linked: 2, finance_only: 3 };
    return order[a.proposed_action] - order[b.proposed_action] || b.imponibile_totale - a.imponibile_totale;
  });

  const candidatesJsonPath = path.join(outDir, "finance-2025-crm-candidates.json");
  fs.writeFileSync(candidatesJsonPath, JSON.stringify(candidates, null, 2));

  const csvHeader = [
    "counterparty_id", "display_name", "legal_name", "vat_number", "fiscal_code", "current_crm_client_id",
    "n_documenti_2025", "imponibile_totale", "business_units_coinvolte", "projects_coinvolti",
    "proposed_action", "confidence", "candidate_reason",
  ].join(";");
  const csvRows = candidates.map((c) =>
    [
      c.counterparty_id, c.display_name, c.legal_name ?? "", c.vat_number ?? "", c.fiscal_code ?? "", c.current_crm_client_id ?? "",
      c.n_documenti_2025, c.imponibile_totale.toFixed(2), c.business_units_coinvolte.join("|"), c.projects_coinvolti.join("|"),
      c.proposed_action, c.confidence, `"${c.candidate_reason.replace(/"/g, '""')}"`,
    ].join(";")
  );
  fs.writeFileSync(path.join(outDir, "finance-2025-crm-candidates.csv"), [csvHeader, ...csvRows].join("\n"));

  const candidateBreakdown: Record<string, number> = {};
  for (const c of candidates) candidateBreakdown[c.proposed_action] = (candidateBreakdown[c.proposed_action] ?? 0) + 1;

  // ============ J: regression check ============
  let netAmount = 0, vatAmount = 0, grossAmount = 0;
  for (const a of report.documentAudits) {
    netAmount += a.document.netAmount;
    vatAmount += a.document.vatAmount;
    grossAmount += a.document.grossAmount;
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const regression = {
    fiscalDocuments: { actual: report.documents.fiscalDocuments, expected: EXPECTED_REGRESSION.fiscalDocuments, ok: report.documents.fiscalDocuments === EXPECTED_REGRESSION.fiscalDocuments },
    td01: { actual: report.types.TD01 ?? 0, expected: EXPECTED_REGRESSION.td01, ok: (report.types.TD01 ?? 0) === EXPECTED_REGRESSION.td01 },
    td04: { actual: report.types.TD04 ?? 0, expected: EXPECTED_REGRESSION.td04, ok: (report.types.TD04 ?? 0) === EXPECTED_REGRESSION.td04 },
    netAmount: { actual: round2(netAmount), expected: EXPECTED_REGRESSION.netAmount, ok: round2(netAmount) === EXPECTED_REGRESSION.netAmount },
    vatAmount: { actual: round2(vatAmount), expected: EXPECTED_REGRESSION.vatAmount, ok: round2(vatAmount) === EXPECTED_REGRESSION.vatAmount },
    grossAmount: { actual: round2(grossAmount), expected: EXPECTED_REGRESSION.grossAmount, ok: round2(grossAmount) === EXPECTED_REGRESSION.grossAmount },
    byBusinessUnit: {
      actual: report.classification.byBusinessUnit,
      expected: EXPECTED_REGRESSION.byBusinessUnit,
      ok: JSON.stringify(report.classification.byBusinessUnit) === JSON.stringify(EXPECTED_REGRESSION.byBusinessUnit),
    },
    unclassified: { actual: report.classification.unclassified, expected: EXPECTED_REGRESSION.unclassified, ok: report.classification.unclassified === EXPECTED_REGRESSION.unclassified },
  };

  const output = {
    generatedAt: new Date().toISOString(),
    documentResolution: { before: { matched: 80, proposed: 0, unresolved: 108, ambiguous: 0 }, after: documentResolutionAfter },
    identityResolution: { before: { existing_match: 8, safe_to_create: 69, review: 1 }, after: identityResolutionAfter },
    engagementAudit: {
      matched: report.engagementCandidates.matched,
      ambiguous: report.engagementCandidates.ambiguous,
      unresolved: report.engagementCandidates.unresolved,
      notApplicable: report.engagementCandidates.notApplicable,
      before: { matched: 78, ambiguous: 0, unresolved: 10, notApplicable: 100 },
    },
    consultingUnresolvedDetail,
    kelinaValidation: {
      kelinaCount: kelinaDocs.length,
      villaNevieraCount: villaNevieraDocs.length,
      expectedKelina: 6,
      expectedVillaNeviera: 12,
      ok: kelinaDocs.length === 6 && villaNevieraDocs.length === 12,
    },
    crmCandidateQueue: {
      total: candidates.length,
      breakdown: candidateBreakdown,
      jsonPath: candidatesJsonPath,
    },
    regression,
  };

  fs.writeFileSync(path.join(outDir, "finance-2025-phase1c-postbatch-result.json"), JSON.stringify(output, null, 2));

  console.log("\n=== RISULTATO (senza consultingUnresolvedDetail/candidati per brevita' console) ===");
  const outputForConsole = { ...output, consultingUnresolvedDetail: undefined };
  console.log(JSON.stringify(outputForConsole, null, 2));
  console.log(`\nDettaglio Consulenza unresolved (${consultingUnresolvedDetail.length} righe) e CRM candidates (${candidates.length} righe) salvati sui file JSON.`);
}

main().catch((err) => {
  console.error("ERRORE post-batch analysis:", err);
  process.exit(1);
});

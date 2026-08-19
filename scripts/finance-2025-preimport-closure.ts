// Pre-import 2025 - chiusura blocker residui Fase 1D: fee rule Palazzo San
// Lazzaro (consultant_pct=0 confermato, non piu' missing), initiative PDO
// "New York 2025", classificazione Puglia Wedding (gia' corretta dalla
// regola generica - qui aggiungiamo solo l'Initiative), CRM Candidate Queue
// aggiornata (Puglia Wedding entra come needs_review con identita' fiscale
// ancora in review), regression completo. Scritture autorizzate SOLO:
// consulting_fee_rules (1 riga, Palazzo San Lazzaro), finance_initiatives
// (1 riga, se non esiste). Nessuna counterparty/crm_client/structure
// creata, nessun import finance_documents.
//
// Uso: npx tsx scripts/finance-2025-preimport-closure.ts <path-allo-zip>

import fs from "fs";
import path from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { extractFilesFromZip } from "../lib/finance/ingestion/zipExtractor";
import { runDryRun } from "../lib/finance/ingestion/dryRunEngine";
import type { DocumentClassificationOverride, InitiativeDocumentOverride } from "../lib/finance/ingestion/classificationProposer";
import {
  SupabaseCounterpartyRepository,
  SupabaseEngagementRepository,
  checkBusinessUnitsSeeded,
  fetchExpectedIssuer,
} from "../lib/finance/ingestion/supabaseRepositories";
import type { DocumentAudit } from "../lib/finance/ingestion/types";

const REFERRAL_DOCUMENT_OVERRIDES: DocumentClassificationOverride[] = [
  { documentNumber: "V00093", businessUnitCode: "referral", reason: "Attivita' di supporto commerciale - confermato Referral dal business per questo documento" },
  { documentNumber: "V00069", businessUnitCode: "referral", reason: "Riconoscimento per segnalazione cliente - confermato Referral dal business per questo documento" },
  { documentNumber: "V00007", businessUnitCode: "referral", reason: "Revenue share anno 2024 - confermato Referral dal business per questo documento" },
];

// Solo Puglia Wedding (L00002) - decisione business puntuale, MAI propagata
// per somiglianza testuale agli altri documenti PDO con descrizione
// identica o con citta' diverse ("- NY", "- Londra") scoperti in Fase 1D.
const INITIATIVE_DOCUMENT_OVERRIDES: InitiativeDocumentOverride[] = [
  {
    documentNumber: "L00002",
    initiativeCode: "new-york-2025",
    reason: "Confermato dal business: Puglia Wedding Production Association, quota di partecipazione PDO New York 2025",
  },
];

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
  counterpartyMatched: 187,
  counterpartyUnresolved: 1,
  consultingMatched: 88,
  consultingUnresolved: 0,
  consultingAmbiguous: 0,
  consultingNotApplicable: 100,
};

function loadEnv() {
  const envPath = path.resolve(__dirname, "../.env.local");
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }
}

async function closePalazzoSanLazzaroFeeRule(client: SupabaseClient) {
  const result: Record<string, unknown> = {};

  const { data: engagements, error: engErr } = await client
    .from("consulting_engagements")
    .select("id, display_name, counterparty_id, valid_from, valid_to, status")
    .eq("display_name", "Palazzo San Lazzaro");
  if (engErr) throw engErr;
  if (!engagements || engagements.length !== 1) {
    result.blocker = `Atteso 1 engagement "Palazzo San Lazzaro", trovati ${engagements?.length ?? 0} - nessuna scrittura.`;
    return result;
  }
  const engagement = engagements[0];
  result.engagement = engagement;

  const { data: existingFeeRules, error: existingErr } = await client
    .from("consulting_fee_rules")
    .select("id, fee_model, fee_pct, calculation_basis, consultant_pct, valid_from, valid_to, is_active")
    .eq("consulting_engagement_id", engagement.id);
  if (existingErr) throw existingErr;

  if (existingFeeRules && existingFeeRules.length > 0) {
    result.action = "already_exists";
    result.feeRule = existingFeeRules[0];
    return result;
  }

  const { data: inserted, error: insertErr } = await client
    .from("consulting_fee_rules")
    .insert({
      consulting_engagement_id: engagement.id,
      valid_from: engagement.valid_from,
      valid_to: engagement.valid_to,
      fee_model: "percentage",
      fee_pct: 10,
      calculation_basis: "revenue",
      consultant_pct: 0,
      is_active: true,
      notes: "Palazzo San Lazzaro 2022-2024: fee GAP 10% revenue. consultant_pct=0 confermato dal business (nessuna commissione consulenti prevista per questo engagement) - non un valore mancante, un dato reale.",
    })
    .select("id, fee_model, fee_pct, calculation_basis, consultant_pct, valid_from, valid_to, is_active")
    .single();
  if (insertErr) {
    result.action = "blocked";
    result.blockerRaw = insertErr.message;
    return result;
  }

  result.action = "created";
  result.feeRule = inserted;
  return result;
}

async function closeNewYork2025Initiative(client: SupabaseClient) {
  const result: Record<string, unknown> = {};

  const { data: pdoProjects, error: pdoErr } = await client
    .from("finance_projects")
    .select("id, code, name, business_unit_id")
    .eq("code", "pdo");
  if (pdoErr) throw pdoErr;
  if (!pdoProjects || pdoProjects.length !== 1) {
    result.blocker = `Atteso 1 project con code="pdo", trovati ${pdoProjects?.length ?? 0} - nessuna scrittura.`;
    return result;
  }
  const pdoProject = pdoProjects[0];
  result.pdoProjectId = pdoProject.id;

  // Verifica assenza di duplicati/sinonimi (per nome, non solo per code)
  // prima di creare - "PDO New York", "New York", "NYC 2025", "PDO NY 2025"
  // non devono coesistere con "New York 2025".
  const { data: allInitiatives, error: allErr } = await client
    .from("finance_initiatives")
    .select("id, project_id, code, name")
    .eq("project_id", pdoProject.id);
  if (allErr) throw allErr;
  result.existingInitiativesUnderPdo = allInitiatives;

  const canonicalCode = "new-york-2025";
  const exactMatch = (allInitiatives ?? []).find((i) => i.code === canonicalCode);
  if (exactMatch) {
    result.action = "already_exists";
    result.initiative = exactMatch;
    return result;
  }

  const looseNameMatches = (allInitiatives ?? []).filter((i) => /new\s*york|ny\b/i.test(i.name) || /new-?york|^ny/i.test(i.code));
  if (looseNameMatches.length > 0) {
    result.blocker = `Trovate initiative esistenti con nome/code simile a "New York 2025" ma diverse dal canonico: ${JSON.stringify(
      looseNameMatches
    )} - possibile sinonimo/duplicato, NON creata, richiede revisione manuale prima di procedere.`;
    return result;
  }

  const { data: inserted, error: insertErr } = await client
    .from("finance_initiatives")
    .insert({
      project_id: pdoProject.id,
      code: canonicalCode,
      name: "New York 2025",
      period_start: null,
      period_end: null,
      is_active: true,
    })
    .select("id, project_id, code, name, period_start, period_end, is_active")
    .single();
  if (insertErr) {
    result.action = "blocked";
    result.blockerRaw = insertErr.message;
    return result;
  }

  result.action = "created";
  result.initiative = inserted;
  return result;
}

async function main() {
  const zipPath = process.argv[2];
  if (!zipPath) {
    console.error("Uso: npx tsx scripts/finance-2025-preimport-closure.ts <path-allo-zip>");
    process.exit(1);
  }

  loadEnv();
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  console.log("=== 1. Palazzo San Lazzaro - fee rule (consultant_pct=0) ===");
  const { count: feeRulesBefore } = await client.from("consulting_fee_rules").select("*", { count: "exact", head: true });
  const sanLazzaroFeeRuleResult = await closePalazzoSanLazzaroFeeRule(client);
  console.log(JSON.stringify(sanLazzaroFeeRuleResult, null, 2));
  const { count: feeRulesAfter } = await client.from("consulting_fee_rules").select("*", { count: "exact", head: true });

  console.log("\n=== 2. Initiative PDO 'New York 2025' ===");
  const initiativeResult = await closeNewYork2025Initiative(client);
  console.log(JSON.stringify(initiativeResult, null, 2));

  console.log("\n=== 3. Riesecuzione dry-run completo (classificazione + counterparty + consulting) ===");
  const expectedIssuer = await fetchExpectedIssuer(client);
  const businessUnitsSeeded = await checkBusinessUnitsSeeded(client);
  const zipBuffer = fs.readFileSync(zipPath);
  const files = extractFilesFromZip(zipBuffer);
  const counterpartyRepo = new SupabaseCounterpartyRepository(client);

  const report = await runDryRun({
    files,
    expectedIssuer,
    counterpartyRepo,
    engagementRepo: new SupabaseEngagementRepository(client),
    businessUnitsSeeded,
    documentOverrides: REFERRAL_DOCUMENT_OVERRIDES,
    initiativeOverrides: INITIATIVE_DOCUMENT_OVERRIDES,
  });

  const pugliaWeddingAudit = report.documentAudits.find((a) => a.document.documentNumber === "L00002");

  // ============ CRM Candidate Queue v2 (include unresolved-identity con trigger) ============
  type Group = { counterpartyId: string | null; docs: DocumentAudit[]; rawParty?: DocumentAudit["document"]["counterpartyRaw"] };
  const groups = new Map<string, Group>();
  for (const a of report.documentAudits) {
    const id = a.counterpartyResolution.matchedCounterpartyId;
    if (id) {
      if (!groups.has(id)) groups.set(id, { counterpartyId: id, docs: [] });
      groups.get(id)!.docs.push(a);
    } else {
      // Nessuna counterparty risolta: raggruppa comunque per identificativo
      // fiscale grezzo, cosi' un documento con trigger di candidatura (es.
      // PDO) non sparisce silenziosamente dalla coda solo perche' l'identita'
      // fiscale non e' ancora risolta.
      const rawKey = `unresolved:${a.document.counterpartyRaw.vatNumber ?? a.document.counterpartyRaw.fiscalCode ?? a.document.counterpartyRaw.legalName ?? a.document.documentNumber}`;
      if (!groups.has(rawKey)) groups.set(rawKey, { counterpartyId: null, docs: [], rawParty: a.document.counterpartyRaw });
      groups.get(rawKey)!.docs.push(a);
    }
  }

  const allCounterparties = await counterpartyRepo.findAll();
  const cpById = new Map(allCounterparties.map((c) => [c.id, c]));

  type CrmCandidateRecord = {
    counterparty_id: string | null;
    display_name: string;
    legal_name: string | null;
    vat_number: string | null;
    fiscal_code: string | null;
    current_crm_client_id: string | null;
    counterparty_identity_status: "resolved" | "review";
    n_documenti_2025: number;
    imponibile_totale: number;
    business_units_coinvolte: string[];
    projects_coinvolti: string[];
    initiatives_coinvolte: string[];
    classification_reason: string[];
    candidate_reason: string;
    proposed_action: "propose_crm_create" | "already_linked" | "finance_only" | "needs_review";
    confidence: "high" | "medium" | "low";
    notes: string;
  };

  const candidates: CrmCandidateRecord[] = [];
  for (const [, group] of groups.entries()) {
    const cp = group.counterpartyId ? cpById.get(group.counterpartyId) : undefined;
    if (group.counterpartyId && !cp) continue;

    const businessUnitsSet = new Set<string>();
    const projectsSet = new Set<string>();
    const initiativesSet = new Set<string>();
    const reasonsSet = new Set<string>();
    let hasUnclassifiedOrLineLevel = false;

    for (const a of group.docs) {
      const c = a.classification;
      if (c.status === "classified") {
        if (c.documentLevelBusinessUnit) {
          businessUnitsSet.add(c.documentLevelBusinessUnit.code);
          reasonsSet.add(c.documentLevelBusinessUnit.reason);
        }
        if (c.documentLevelProjectCode) projectsSet.add(c.documentLevelProjectCode);
        if (c.documentLevelInitiativeCode) initiativesSet.add(c.documentLevelInitiativeCode);
      } else {
        hasUnclassifiedOrLineLevel = true;
        for (const lp of c.lineProposals) {
          if (lp.businessUnitCandidate) {
            businessUnitsSet.add(lp.businessUnitCandidate.code);
            reasonsSet.add(lp.businessUnitCandidate.reason);
          }
          if (lp.projectCandidateCode) projectsSet.add(lp.projectCandidateCode);
          if (lp.initiativeCandidateCode) initiativesSet.add(lp.initiativeCandidateCode);
        }
      }
    }

    const netTotal = group.docs.reduce((sum, a) => sum + a.document.netAmount, 0);
    const touchesFormazione = businessUnitsSet.has("formazione");
    const touchesReferral = businessUnitsSet.has("referral");
    const touchesPdo = projectsSet.has("pdo");
    const onlyConsulenza = businessUnitsSet.size === 1 && businessUnitsSet.has("consulenza") && !hasUnclassifiedOrLineLevel;

    const displayName = cp?.displayName ?? group.rawParty?.legalName ?? "Sconosciuto";
    const legalName = cp?.legalName ?? group.rawParty?.legalName ?? null;
    const vatNumber = cp?.vatNumber ?? group.rawParty?.vatNumber ?? null;
    const fiscalCode = cp?.fiscalCode ?? group.rawParty?.fiscalCode ?? null;
    const identityStatus: "resolved" | "review" = cp ? "resolved" : "review";

    let proposedAction: CrmCandidateRecord["proposed_action"];
    let candidateReason: string;
    let confidence: CrmCandidateRecord["confidence"];

    if (cp?.crmClientId) {
      proposedAction = "already_linked";
      candidateReason = "Gia' collegata a un crm_clients esistente - nessuna azione necessaria.";
      confidence = "high";
    } else if (cp && PRE_DELIBERATED_FINANCE_ONLY.has(cp.displayName)) {
      proposedAction = "finance_only";
      candidateReason = "Consulenza storica gia' deliberata Finance-only - esclusa indipendentemente dalle BU toccate.";
      confidence = "high";
    } else if (!cp) {
      // Identita' fiscale non risolta: la classificazione economica resta
      // valida e puo' comunque far scattare un trigger di candidatura (qui
      // Project=PDO), ma non esiste un counterparty_id a cui agganciare una
      // futura creazione crm_client - resta needs_review finche' l'identita'
      // non e' risolta separatamente (mai forzata a "matched" solo perche'
      // la classificazione economica lo e').
      const triggers = [touchesFormazione && "Formazione", touchesPdo && "PDO", touchesReferral && "Referral"].filter(Boolean);
      proposedAction = "needs_review";
      confidence = triggers.length > 0 ? "medium" : "low";
      candidateReason =
        triggers.length > 0
          ? `Classificazione economica RISOLTA (trigger: ${triggers.join(", ")}) ma identita' fiscale della counterparty ancora REVIEW/unresolved (nessuna counterparty creata) - candidatura CRM sospesa fino a risoluzione master-data, non un dato mancante nella classificazione.`
          : "Identita' fiscale unresolved, nessun trigger di candidatura CRM rilevato nei documenti disponibili.";
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
      candidateReason = "Unica BU toccata e' Consulenza, nessun altro segnale - non e' criterio automatico di candidatura CRM.";
      confidence = "medium";
    } else if (hasUnclassifiedOrLineLevel) {
      proposedAction = "needs_review";
      candidateReason = "Criterio D: almeno un documento del batch e' unclassified/ibrido a livello di riga.";
      confidence = "low";
    } else {
      proposedAction = "needs_review";
      candidateReason = `Nessun criterio di inclusione automatica (A/B/C) soddisfatto - BU coinvolta: ${[...businessUnitsSet].join(", ") || "nessuna"} - non e' un caso di esclusione esplicita, richiede decisione Master.`;
      confidence = "medium";
    }

    candidates.push({
      counterparty_id: cp?.id ?? null,
      display_name: displayName,
      legal_name: legalName,
      vat_number: vatNumber,
      fiscal_code: fiscalCode,
      current_crm_client_id: cp?.crmClientId ?? null,
      counterparty_identity_status: identityStatus,
      n_documenti_2025: group.docs.length,
      imponibile_totale: Math.round(netTotal * 100) / 100,
      business_units_coinvolte: [...businessUnitsSet],
      projects_coinvolti: [...projectsSet],
      initiatives_coinvolte: [...initiativesSet],
      classification_reason: [...reasonsSet],
      candidate_reason: candidateReason,
      proposed_action: proposedAction,
      confidence,
      notes: hasUnclassifiedOrLineLevel ? "Almeno un documento non ha una classificazione BU pulita a livello documento." : "",
    });
  }

  candidates.sort((a, b) => {
    const order = { propose_crm_create: 0, needs_review: 1, already_linked: 2, finance_only: 3 };
    return order[a.proposed_action] - order[b.proposed_action] || b.imponibile_totale - a.imponibile_totale;
  });

  const outDir = path.resolve(__dirname, "../data/generated");
  fs.writeFileSync(path.join(outDir, "finance-2025-crm-candidates-preimport.json"), JSON.stringify(candidates, null, 2));

  const candidateBreakdown: Record<string, number> = {};
  for (const c of candidates) candidateBreakdown[c.proposed_action] = (candidateBreakdown[c.proposed_action] ?? 0) + 1;
  const pugliaWeddingCandidate = candidates.find((c) => /puglia wedding/i.test(c.display_name));

  // ============ Regression ============
  let netAmount = 0, vatAmount = 0, grossAmount = 0;
  for (const a of report.documentAudits) {
    netAmount += a.document.netAmount;
    vatAmount += a.document.vatAmount;
    grossAmount += a.document.grossAmount;
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const bu = report.classification.byBusinessUnit;
  const buOk =
    bu.consulenza === EXPECTED_REGRESSION.byBusinessUnit.consulenza &&
    bu.formazione === EXPECTED_REGRESSION.byBusinessUnit.formazione &&
    bu.eventi === EXPECTED_REGRESSION.byBusinessUnit.eventi &&
    bu.referral === EXPECTED_REGRESSION.byBusinessUnit.referral;

  const engagementNameCounts: Record<string, number> = {};
  for (const a of report.documentAudits) {
    const name = a.engagementCandidate.candidateEngagementName;
    if (name) engagementNameCounts[name] = (engagementNameCounts[name] ?? 0) + 1;
  }

  const regression = {
    fiscalDocuments: { actual: report.documents.fiscalDocuments, expected: EXPECTED_REGRESSION.fiscalDocuments, ok: report.documents.fiscalDocuments === EXPECTED_REGRESSION.fiscalDocuments },
    td01: { actual: report.types.TD01 ?? 0, expected: EXPECTED_REGRESSION.td01, ok: (report.types.TD01 ?? 0) === EXPECTED_REGRESSION.td01 },
    td04: { actual: report.types.TD04 ?? 0, expected: EXPECTED_REGRESSION.td04, ok: (report.types.TD04 ?? 0) === EXPECTED_REGRESSION.td04 },
    netAmount: { actual: round2(netAmount), expected: EXPECTED_REGRESSION.netAmount, ok: round2(netAmount) === EXPECTED_REGRESSION.netAmount },
    vatAmount: { actual: round2(vatAmount), expected: EXPECTED_REGRESSION.vatAmount, ok: round2(vatAmount) === EXPECTED_REGRESSION.vatAmount },
    grossAmount: { actual: round2(grossAmount), expected: EXPECTED_REGRESSION.grossAmount, ok: round2(grossAmount) === EXPECTED_REGRESSION.grossAmount },
    byBusinessUnit: { actual: bu, expected: EXPECTED_REGRESSION.byBusinessUnit, ok: buOk },
    unclassified: { actual: report.classification.unclassified, expected: EXPECTED_REGRESSION.unclassified, ok: report.classification.unclassified === EXPECTED_REGRESSION.unclassified },
    counterpartyMatched: { actual: report.counterparties.matched, expected: EXPECTED_REGRESSION.counterpartyMatched, ok: report.counterparties.matched === EXPECTED_REGRESSION.counterpartyMatched },
    counterpartyUnresolved: { actual: report.counterparties.unresolved, expected: EXPECTED_REGRESSION.counterpartyUnresolved, ok: report.counterparties.unresolved === EXPECTED_REGRESSION.counterpartyUnresolved },
    consultingMatched: { actual: report.engagementCandidates.matched, expected: EXPECTED_REGRESSION.consultingMatched, ok: report.engagementCandidates.matched === EXPECTED_REGRESSION.consultingMatched },
    consultingUnresolved: { actual: report.engagementCandidates.unresolved, expected: EXPECTED_REGRESSION.consultingUnresolved, ok: report.engagementCandidates.unresolved === EXPECTED_REGRESSION.consultingUnresolved },
    consultingAmbiguous: { actual: report.engagementCandidates.ambiguous, expected: EXPECTED_REGRESSION.consultingAmbiguous, ok: report.engagementCandidates.ambiguous === EXPECTED_REGRESSION.consultingAmbiguous },
    consultingNotApplicable: { actual: report.engagementCandidates.notApplicable, expected: EXPECTED_REGRESSION.consultingNotApplicable, ok: report.engagementCandidates.notApplicable === EXPECTED_REGRESSION.consultingNotApplicable },
  };

  const validationCounts = {
    Sarmenti: engagementNameCounts["Sarmenti"] ?? 0,
    "Borgo Bevagna": engagementNameCounts["Borgo Bevagna"] ?? 0,
    "Palazzo San Lazzaro": engagementNameCounts["Palazzo San Lazzaro"] ?? 0,
    Kelina: engagementNameCounts["Kelina"] ?? 0,
    "Villa Neviera": engagementNameCounts["Villa Neviera"] ?? 0,
  };

  const output = {
    generatedAt: new Date().toISOString(),
    feeRulesCount: { before: feeRulesBefore, after: feeRulesAfter },
    palazzoSanLazzaroFeeRule: sanLazzaroFeeRuleResult,
    newYork2025Initiative: initiativeResult,
    pugliaWedding: pugliaWeddingAudit
      ? {
          documentNumber: pugliaWeddingAudit.document.documentNumber,
          description: pugliaWeddingAudit.document.lines[0]?.description,
          classification: pugliaWeddingAudit.classification,
          counterpartyResolutionStatus: pugliaWeddingAudit.counterpartyResolution.status,
          engagementCandidateStatus: pugliaWeddingAudit.engagementCandidate.status,
        }
      : null,
    crmCandidateQueue: { total: candidates.length, breakdown: candidateBreakdown, pugliaWeddingCandidate },
    validationCounts,
    regression,
  };

  fs.writeFileSync(path.join(outDir, "finance-2025-preimport-closure-result.json"), JSON.stringify(output, null, 2));

  console.log("\n=== RISULTATO FINALE ===");
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error("ERRORE pre-import closure:", err);
  process.exit(1);
});

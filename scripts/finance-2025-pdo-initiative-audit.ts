// Pre-import 2025 - audit definitivo Initiative PDO + freeze baseline.
// Scritture autorizzate SOLO: finance_initiatives (Londra 2025, se non
// esiste). New York 2025 viene solo verificata (gia' esistente). Nessuna
// counterparty/crm_client/structure/finance_documents toccata.
//
// Uso: npx tsx scripts/finance-2025-pdo-initiative-audit.ts <path-allo-zip>

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

const REFERRAL_DOCUMENT_OVERRIDES: DocumentClassificationOverride[] = [
  { documentNumber: "V00093", businessUnitCode: "referral", reason: "Attivita' di supporto commerciale - confermato Referral dal business per questo documento" },
  { documentNumber: "V00069", businessUnitCode: "referral", reason: "Riconoscimento per segnalazione cliente - confermato Referral dal business per questo documento" },
  { documentNumber: "V00007", businessUnitCode: "referral", reason: "Revenue share anno 2024 - confermato Referral dal business per questo documento" },
];

const INITIATIVE_DOCUMENT_OVERRIDES: InitiativeDocumentOverride[] = [
  {
    documentNumber: "L00002",
    initiativeCode: "new-york-2025",
    reason: "Confermato dal business: Puglia Wedding Production Association, quota di partecipazione PDO New York 2025",
  },
];

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
  feeRulesTotal: 17,
};

const KNOWN_NEW_YORK_INITIATIVE_ID = "81afc579-dc6d-474d-ac57-1d61a9167f2f";

function loadEnv() {
  const envPath = path.resolve(__dirname, "../.env.local");
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }
}

async function verifyNewYork2025(client: SupabaseClient) {
  const { data, error } = await client.from("finance_initiatives").select("*").eq("id", KNOWN_NEW_YORK_INITIATIVE_ID);
  if (error) throw error;
  if (!data || data.length !== 1) {
    return { blocker: `Record New York 2025 (id ${KNOWN_NEW_YORK_INITIATIVE_ID}) non trovato live - atteso 1, trovati ${data?.length ?? 0}.` };
  }
  return { verified: true, record: data[0] };
}

async function closeLondra2025(client: SupabaseClient, pdoProjectId: string) {
  const result: Record<string, unknown> = {};

  const { data: allUnderPdo, error: allErr } = await client.from("finance_initiatives").select("id, project_id, code, name").eq("project_id", pdoProjectId);
  if (allErr) throw allErr;
  result.existingInitiativesUnderPdo = allUnderPdo;

  const canonicalCode = "londra-2025";
  const exact = (allUnderPdo ?? []).find((i) => i.code === canonicalCode);
  if (exact) {
    result.action = "already_exists";
    result.initiative = exact;
    return result;
  }

  const synonymCandidates = (allUnderPdo ?? []).filter((i) => /londra|london/i.test(i.name) || /londra|london/i.test(i.code));
  if (synonymCandidates.length > 0) {
    result.blocker = `Trovate initiative simili a "Londra 2025" ma con code/nome diverso dal canonico: ${JSON.stringify(synonymCandidates)} - NON creata, possibile duplicato/sinonimo, richiede revisione manuale.`;
    return result;
  }

  const { data: inserted, error: insertErr } = await client
    .from("finance_initiatives")
    .insert({
      project_id: pdoProjectId,
      code: canonicalCode,
      name: "Londra 2025",
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
    console.error("Uso: npx tsx scripts/finance-2025-pdo-initiative-audit.ts <path-allo-zip>");
    process.exit(1);
  }

  loadEnv();
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  console.log("=== 1. Verifica live New York 2025 ===");
  const newYorkVerification = await verifyNewYork2025(client);
  console.log(JSON.stringify(newYorkVerification, null, 2));

  console.log("\n=== 2. Project PDO ===");
  const { data: pdoProjects, error: pdoErr } = await client.from("finance_projects").select("id, code, name, business_unit_id").eq("code", "pdo");
  if (pdoErr) throw pdoErr;
  if (!pdoProjects || pdoProjects.length !== 1) {
    console.error(`Atteso 1 project PDO, trovati ${pdoProjects?.length ?? 0} - STOP.`);
    process.exit(1);
  }
  console.log(JSON.stringify(pdoProjects[0], null, 2));

  console.log("\n=== 3. Crea/verifica Londra 2025 ===");
  const londraResult = await closeLondra2025(client, pdoProjects[0].id);
  console.log(JSON.stringify(londraResult, null, 2));

  console.log("\n=== 4. Riesecuzione dry-run completo (188 documenti reali) ===");
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

  // ============ Audit completo dei 15 documenti PDO ============
  const pdoAudits = report.documentAudits.filter(
    (a) =>
      a.classification.documentLevelProjectCode === "pdo" ||
      a.classification.lineProposals.some((lp) => lp.projectCandidateCode === "pdo")
  );

  const pdoTable = pdoAudits
    .map((a) => ({
      documentNumber: a.document.documentNumber,
      documentDate: a.document.documentDate,
      documentType: a.document.documentTypeCode,
      counterparty: a.document.counterpartyRaw.legalName,
      vatNumber: a.document.counterpartyRaw.vatNumber,
      fiscalCode: a.document.counterpartyRaw.fiscalCode,
      netAmount: a.document.netAmount,
      description: a.document.lines.map((l) => l.description).join(" | "),
      isCreditNote: a.document.creditNote.isCreditNote,
      initiative: a.classification.documentLevelInitiativeCode,
      counterpartyResolutionStatus: a.counterpartyResolution.status,
    }))
    .sort((x, y) => x.documentNumber.localeCompare(y.documentNumber));

  const newYorkDocs = pdoTable.filter((d) => d.initiative === "new-york-2025");
  const londraDocs = pdoTable.filter((d) => d.initiative === "londra-2025");
  const unresolvedDocs = pdoTable.filter((d) => d.initiative === null);

  const sum = (docs: typeof pdoTable) => Math.round(docs.reduce((s, d) => s + d.netAmount, 0) * 100) / 100;

  // ============ Data quality ============
  const creditNotesInPdo = pdoTable.filter((d) => d.isCreditNote);
  const contradictorySignal = pdoAudits.filter((a) => {
    const hasNy = a.document.lines.some((l) => l.description && /\bNY\b|new\s*york/i.test(l.description));
    const hasLondra = a.document.lines.some((l) => l.description && /londra|london/i.test(l.description));
    return hasNy && hasLondra;
  });
  const dupCheck = new Map<string, string[]>();
  for (const d of pdoTable) {
    const key = `${d.vatNumber ?? d.fiscalCode ?? d.counterparty}|${d.netAmount}|${d.description}`;
    if (!dupCheck.has(key)) dupCheck.set(key, []);
    dupCheck.get(key)!.push(d.documentNumber);
  }
  const possibleDuplicates = [...dupCheck.entries()].filter(([, docs]) => docs.length > 1);

  // Anomalia data/segnale: NY esplicito ma la data fattura NON e' coerente
  // con "gennaio 2025" (finestra dichiarata dell'evento New York) - solo
  // segnalata, MAI usata per correggere l'assegnazione (il segnale testuale
  // vince sempre sulla data, per esplicita istruzione).
  const nyDateAnomalies = newYorkDocs.filter((d) => d.documentNumber !== "L00002" && !d.documentDate.startsWith("2025-01") && !d.documentDate.startsWith("2025-02"));

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

  const { count: feeRulesTotal } = await client.from("consulting_fee_rules").select("*", { count: "exact", head: true });

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
    feeRulesTotal: { actual: feeRulesTotal, expected: EXPECTED_REGRESSION.feeRulesTotal, ok: feeRulesTotal === EXPECTED_REGRESSION.feeRulesTotal },
  };

  // ============ Competence + credit note baseline (per il freeze artifact) ============
  const competenceBaseline = {
    resolved: report.competence.resolved,
    unresolved: report.competence.unresolved,
    methodDistribution: report.competence.methodDistribution,
  };
  const creditNoteBaseline = report.creditNotes.map((c) => ({
    number: c.number,
    date: c.date,
    counterparty: c.counterparty.legalName,
    netAmount: c.netAmount,
    grossAmount: c.grossAmount,
    referencedDocumentNumber: c.referencedDocumentNumber,
    reason: c.reason,
  }));

  // ============ FREEZE BASELINE ARTIFACT ============
  const baseline = {
    generatedAt: new Date().toISOString(),
    label: "FINANCE 2025 PRE-IMPORT BASELINE",
    batchMetrics: {
      totalFiles: report.documents.totalFiles,
      fiscalDocuments: report.documents.fiscalDocuments,
      receipts: report.documents.receipts,
      parsedSuccessfully: report.documents.parsedSuccessfully,
      failed: report.documents.failed,
    },
    documentTypeMetrics: report.types,
    amountTotals: { netAmount: round2(netAmount), vatAmount: round2(vatAmount), grossAmount: round2(grossAmount) },
    businessUnitClassificationCounts: bu,
    unclassifiedCount: report.classification.unclassified,
    pdoInitiativeCounts: {
      totalPdoDocuments: pdoTable.length,
      newYork2025: { documentCount: newYorkDocs.length, netAmount: sum(newYorkDocs) },
      londra2025: { documentCount: londraDocs.length, netAmount: sum(londraDocs) },
      unresolved: { documentCount: unresolvedDocs.length, netAmount: sum(unresolvedDocs) },
    },
    counterpartyResolutionCounts: {
      matched: report.counterparties.matched,
      proposed: report.counterparties.proposed,
      unresolved: report.counterparties.unresolved,
      ambiguous: report.counterparties.ambiguous,
    },
    consultingEngagementResolutionCounts: {
      matched: report.engagementCandidates.matched,
      ambiguous: report.engagementCandidates.ambiguous,
      unresolved: report.engagementCandidates.unresolved,
      notApplicable: report.engagementCandidates.notApplicable,
    },
    competenceResolutionCounts: competenceBaseline,
    creditNoteAudit: creditNoteBaseline,
    unresolvedReviewCases: {
      pugliaWeddingProductionAssociation: {
        documentNumber: "L00002",
        fiscalIdentifier: "90115700727",
        counterpartyIdentityStatus: "review",
        classificationStatus: "resolved",
        businessUnit: "eventi",
        project: "pdo",
        initiative: "new-york-2025",
      },
      v00012RelatedDocument: {
        documentNumber: "V00012",
        rawReferencedDocumentNumber: "V00089",
        relatedDocumentId: null,
        note: "Storno di V00089/2024 (esercizio precedente al batch 2025) - risoluzione rimandata al futuro import 2024, nessun campo di stato dedicato nello schema attuale.",
      },
    },
  };

  const outDir = path.resolve(__dirname, "../data/generated");
  fs.writeFileSync(path.join(outDir, "finance-2025-preimport-baseline.json"), JSON.stringify(baseline, null, 2));
  fs.writeFileSync(path.join(outDir, "finance-2025-pdo-audit.json"), JSON.stringify(pdoTable, null, 2));

  const output = {
    newYorkVerification,
    londraResult,
    pdoTable,
    newYorkTotals: { documentCount: newYorkDocs.length, netAmount: sum(newYorkDocs), documents: newYorkDocs.map((d) => d.documentNumber) },
    londraTotals: { documentCount: londraDocs.length, netAmount: sum(londraDocs), documents: londraDocs.map((d) => d.documentNumber) },
    unresolvedTotals: { documentCount: unresolvedDocs.length, netAmount: sum(unresolvedDocs), documents: unresolvedDocs.map((d) => d.documentNumber) },
    reconciliationCheck: {
      sumOfGroups: newYorkDocs.length + londraDocs.length + unresolvedDocs.length,
      totalPdoDocuments: pdoTable.length,
      countsMatch: newYorkDocs.length + londraDocs.length + unresolvedDocs.length === pdoTable.length,
      sumOfAmounts: round2(sum(newYorkDocs) + sum(londraDocs) + sum(unresolvedDocs)),
      totalPdoNetAmount: round2(pdoTable.reduce((s, d) => s + d.netAmount, 0)),
    },
    dataQuality: {
      creditNotesInPdo,
      contradictorySignalDocuments: contradictorySignal.map((a) => a.document.documentNumber),
      possibleDuplicates,
      nyDateAnomalies: nyDateAnomalies.map((d) => ({ documentNumber: d.documentNumber, documentDate: d.documentDate, note: "Segnale testuale NY esplicito ma data fattura fuori dalla finestra gennaio 2025 dichiarata per l'evento New York - segnalato, NON usato per correggere l'assegnazione." })),
    },
    regression,
  };

  console.log("\n=== RISULTATO FINALE ===");
  console.log(JSON.stringify(output, null, 2));
  console.log(`\nBaseline freeze salvato in: ${path.join(outDir, "finance-2025-preimport-baseline.json")}`);
}

main().catch((err) => {
  console.error("ERRORE PDO initiative audit:", err);
  process.exit(1);
});

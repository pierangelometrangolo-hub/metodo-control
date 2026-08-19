// Fase 1D chiusura - ripuntamento controllato Sarmenti/Borgo Bevagna sulle
// rispettive counterparty fiscali reali + creazione engagement/fee rule
// Palazzo San Lazzaro. Unico script di questa fase autorizzato a scrivere:
// consulting_engagements.counterparty_id (2 righe esistenti),
// consulting_engagements (1 nuova riga), consulting_fee_rules (1 nuova riga
// SOLO se tutti i campi obbligatori sono verificabili). Nessun'altra
// tabella toccata. Diagnostica prima, idempotente, verifica dopo, nessun
// hard delete.
//
// Uso: npx tsx scripts/finance-2025-phase1d-closure.ts <path-allo-zip>

import fs from "fs";
import path from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { extractFilesFromZip } from "../lib/finance/ingestion/zipExtractor";
import { runDryRun } from "../lib/finance/ingestion/dryRunEngine";
import type { DocumentClassificationOverride } from "../lib/finance/ingestion/classificationProposer";
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
};

function loadEnv() {
  const envPath = path.resolve(__dirname, "../.env.local");
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }
}

async function repointEngagement(
  client: SupabaseClient,
  engagementDisplayName: string,
  targetVat: string
) {
  const report: Record<string, unknown> = { engagementDisplayName, targetVat };

  // 1. Recupera engagement per display_name
  const { data: engagements, error: engErr } = await client
    .from("consulting_engagements")
    .select("id, counterparty_id, display_name, status, valid_from, valid_to")
    .eq("display_name", engagementDisplayName);
  if (engErr) throw engErr;
  if (!engagements || engagements.length !== 1) {
    report.blocker = `Atteso esattamente 1 engagement con display_name="${engagementDisplayName}", trovati ${engagements?.length ?? 0} - nessuna scrittura eseguita.`;
    return report;
  }
  const engagement = engagements[0];
  report.engagementId = engagement.id;
  report.statusBefore = engagement.status;
  report.validFromBefore = engagement.valid_from;
  report.validToBefore = engagement.valid_to;
  const oldCounterpartyId = engagement.counterparty_id;
  report.oldCounterpartyId = oldCounterpartyId;

  // 2/3. Recupera counterparty per VAT, verifica univocita'
  const { data: targets, error: targetErr } = await client
    .from("counterparties")
    .select("id, display_name, vat_number")
    .eq("vat_number", targetVat);
  if (targetErr) throw targetErr;
  if (!targets || targets.length !== 1) {
    report.blocker = `Atteso esattamente 1 counterparty con vat_number="${targetVat}", trovate ${targets?.length ?? 0} - nessuna scrittura eseguita.`;
    return report;
  }
  const newCounterparty = targets[0];
  report.newCounterpartyId = newCounterparty.id;
  report.newCounterpartyDisplayName = newCounterparty.display_name;

  // 4. Fee rules collegate all'engagement - snapshot PRIMA (mai modificate)
  const { data: feeRulesBefore, error: feeErr } = await client
    .from("consulting_fee_rules")
    .select("id, fee_model, fee_pct, fixed_amount, calculation_basis, consultant_pct, valid_from, valid_to, is_active")
    .eq("consulting_engagement_id", engagement.id);
  if (feeErr) throw feeErr;
  report.feeRulesBefore = feeRulesBefore;

  // 5. Nessun altro engagement dipende dalla placeholder in modo inatteso
  const { data: otherEngagements, error: otherErr } = await client
    .from("consulting_engagements")
    .select("id, display_name")
    .eq("counterparty_id", oldCounterpartyId);
  if (otherErr) throw otherErr;
  const unexpectedDependents = (otherEngagements ?? []).filter((e) => e.id !== engagement.id);
  report.unexpectedDependentsOnOldCounterparty = unexpectedDependents;
  if (unexpectedDependents.length > 0) {
    report.blocker = `Altri ${unexpectedDependents.length} engagement dipendono ancora dalla placeholder ${oldCounterpartyId} oltre a "${engagementDisplayName}" - repointing NON eseguito per sicurezza, richiede revisione manuale.`;
    return report;
  }

  // Idempotenza: gia' ripuntato in una esecuzione precedente?
  if (engagement.counterparty_id === newCounterparty.id) {
    report.action = "already_repointed";
    report.feeRulesAfter = feeRulesBefore;
  } else {
    const { data: updated, error: updateErr } = await client
      .from("consulting_engagements")
      .update({ counterparty_id: newCounterparty.id })
      .eq("id", engagement.id)
      .select("id, counterparty_id, status, valid_from, valid_to")
      .single();
    if (updateErr) throw updateErr;
    report.action = "repointed";
    report.statusAfter = updated!.status;
    report.validFromAfter = updated!.valid_from;
    report.validToAfter = updated!.valid_to;

    const { data: feeRulesAfter, error: feeAfterErr } = await client
      .from("consulting_fee_rules")
      .select("id, fee_model, fee_pct, fixed_amount, calculation_basis, consultant_pct, valid_from, valid_to, is_active")
      .eq("consulting_engagement_id", engagement.id);
    if (feeAfterErr) throw feeAfterErr;
    report.feeRulesAfter = feeRulesAfter;
    report.feeRulesUnchanged = JSON.stringify(feeRulesBefore) === JSON.stringify(feeRulesAfter);
  }

  // Verifica orphan status della vecchia placeholder
  const { data: remainingOnOld, error: remainingErr } = await client
    .from("consulting_engagements")
    .select("id")
    .eq("counterparty_id", oldCounterpartyId);
  if (remainingErr) throw remainingErr;
  report.oldPlaceholderNowOrphan = (remainingOnOld ?? []).length === 0;

  return report;
}

async function main() {
  const zipPath = process.argv[2];
  if (!zipPath) {
    console.error("Uso: npx tsx scripts/finance-2025-phase1d-closure.ts <path-allo-zip>");
    process.exit(1);
  }

  loadEnv();
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  console.log("=== 1/2. Ripuntamento Sarmenti -> Agriotranto ===");
  const sarmentiResult = await repointEngagement(client, "Sarmenti", "04307980757");
  console.log(JSON.stringify(sarmentiResult, null, 2));

  console.log("\n=== 2/2. Ripuntamento Borgo Bevagna -> Grandi Vacanze ===");
  const borgoBevagnaResult = await repointEngagement(client, "Borgo Bevagna", "02690960741");
  console.log(JSON.stringify(borgoBevagnaResult, null, 2));

  // ============ Palazzo San Lazzaro ============
  console.log("\n=== Palazzo San Lazzaro ===");
  const sanLazzaroResult: Record<string, unknown> = {};

  const { data: sitTargets, error: sitErr } = await client
    .from("counterparties")
    .select("id, display_name, vat_number")
    .eq("vat_number", "05070830756");
  if (sitErr) throw sitErr;
  if (!sitTargets || sitTargets.length !== 1) {
    sanLazzaroResult.blocker = `Atteso esattamente 1 counterparty con vat_number="05070830756" (S.I.T. S.R.L.), trovate ${sitTargets?.length ?? 0} - nessuna scrittura eseguita.`;
    console.log(JSON.stringify(sanLazzaroResult, null, 2));
  } else {
    const sitCounterparty = sitTargets[0];
    sanLazzaroResult.counterpartyId = sitCounterparty.id;
    sanLazzaroResult.counterpartyDisplayName = sitCounterparty.display_name;

    // Idempotenza: engagement gia' esistente?
    const { data: existingEngagement, error: existingErr } = await client
      .from("consulting_engagements")
      .select("id, counterparty_id, display_name, structure_id, valid_from, valid_to, status")
      .eq("display_name", "Palazzo San Lazzaro")
      .eq("counterparty_id", sitCounterparty.id);
    if (existingErr) throw existingErr;

    let engagementId: string;
    if (existingEngagement && existingEngagement.length > 0) {
      engagementId = existingEngagement[0].id;
      sanLazzaroResult.engagementAction = "already_exists";
      sanLazzaroResult.engagement = existingEngagement[0];
    } else {
      const { data: inserted, error: insertErr } = await client
        .from("consulting_engagements")
        .insert({
          counterparty_id: sitCounterparty.id,
          structure_id: null,
          display_name: "Palazzo San Lazzaro",
          valid_from: "2022-01-01",
          valid_to: "2024-12-31",
          status: "closed",
          notes: "Consulenza storica 2022-2024, chiusa. Counterparty fiscale reale: S.I.T. S.R.L. (VAT 05070830756), identificata via analisi documentale Fase 1D (fattura V00003, competenza dicembre 2024).",
        })
        .select("id, counterparty_id, display_name, structure_id, valid_from, valid_to, status")
        .single();
      if (insertErr) throw insertErr;
      engagementId = inserted!.id;
      sanLazzaroResult.engagementAction = "created";
      sanLazzaroResult.engagement = inserted;
    }

    // Fee rule: idempotenza + verifica campi obbligatori (consultant_pct)
    const { data: existingFeeRule, error: existingFeeErr } = await client
      .from("consulting_fee_rules")
      .select("id, fee_model, fee_pct, calculation_basis, consultant_pct, valid_from, valid_to, is_active")
      .eq("consulting_engagement_id", engagementId);
    if (existingFeeErr) throw existingFeeErr;

    if (existingFeeRule && existingFeeRule.length > 0) {
      sanLazzaroResult.feeRuleAction = "already_exists";
      sanLazzaroResult.feeRule = existingFeeRule[0];
    } else {
      const { data: insertedFee, error: feeInsertErr } = await client
        .from("consulting_fee_rules")
        .insert({
          consulting_engagement_id: engagementId,
          valid_from: "2022-01-01",
          valid_to: "2024-12-31",
          fee_model: "percentage",
          fee_pct: 10,
          calculation_basis: "revenue",
          consultant_pct: null,
          is_active: true,
          notes: "Palazzo San Lazzaro 2022-2024: fee GAP 10% revenue (confermato). Quota GM/consultant_pct non fornita/verificata - lasciata NULL, non inventata (Fase 1D).",
        })
        .select("id, fee_model, fee_pct, calculation_basis, consultant_pct, valid_from, valid_to, is_active")
        .single();

      if (feeInsertErr) {
        sanLazzaroResult.feeRuleAction = "blocked";
        sanLazzaroResult.feeRuleBlockerRaw = feeInsertErr.message;
        sanLazzaroResult.feeRuleBlocker =
          feeInsertErr.code === "23502" && feeInsertErr.message.includes("consultant_pct")
            ? "consultant_pct_missing: la colonna consultant_pct e' NOT NULL nello schema reale - non e' stato possibile creare la fee rule senza inventare un valore. Engagement creato/presente comunque, fee rule NON creata."
            : `Errore inatteso in creazione fee rule: ${feeInsertErr.message}`;
      } else {
        sanLazzaroResult.feeRuleAction = "created";
        sanLazzaroResult.feeRule = insertedFee;
      }
    }
  }
  console.log(JSON.stringify(sanLazzaroResult, null, 2));

  // ============ Riesecuzione dry-run + Consulting Engagement Resolver ============
  console.log("\n=== Riesecuzione dry-run + resolver sui 188 documenti reali ===");
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
  });

  const engagementNameCounts: Record<string, number> = {};
  for (const a of report.documentAudits) {
    const name = a.engagementCandidate.candidateEngagementName;
    if (name) engagementNameCounts[name] = (engagementNameCounts[name] ?? 0) + 1;
  }

  const validationCounts = {
    Sarmenti: engagementNameCounts["Sarmenti"] ?? 0,
    "Borgo Bevagna": engagementNameCounts["Borgo Bevagna"] ?? 0,
    "Palazzo San Lazzaro": engagementNameCounts["Palazzo San Lazzaro"] ?? 0,
    Kelina: engagementNameCounts["Kelina"] ?? 0,
    "Villa Neviera": engagementNameCounts["Villa Neviera"] ?? 0,
  };

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
  };

  // ============ Fee rules totale prima/dopo ============
  const { count: feeRulesTotal } = await client.from("consulting_fee_rules").select("*", { count: "exact", head: true });

  const output = {
    generatedAt: new Date().toISOString(),
    sarmenti: sarmentiResult,
    borgoBevagna: borgoBevagnaResult,
    palazzoSanLazzaro: sanLazzaroResult,
    engagementResolution: {
      matched: report.engagementCandidates.matched,
      ambiguous: report.engagementCandidates.ambiguous,
      unresolved: report.engagementCandidates.unresolved,
      notApplicable: report.engagementCandidates.notApplicable,
    },
    validationCounts,
    feeRulesTotal,
    regression,
  };

  const outPath = path.resolve(__dirname, "../data/generated/finance-2025-phase1d-closure-result.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log("\n=== RISULTATO FINALE ===");
  console.log(JSON.stringify({ engagementResolution: output.engagementResolution, validationCounts, feeRulesTotal, regression }, null, 2));
  console.log(`\nSalvato in: ${outPath}`);
}

main().catch((err) => {
  console.error("ERRORE Fase 1D closure:", err);
  process.exit(1);
});

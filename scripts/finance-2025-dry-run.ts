// Entry point per il dry-run del batch reale "188 fatture emesse GAP GROUP
// S.R.L. 2025". NON esegue alcuna scrittura definitiva (import.ts sara' un
// file separato, da scrivere dopo approvazione esplicita del dry-run).
//
// Uso: npx tsx scripts/finance-2025-dry-run.ts <path-allo-zip>
//
// Richiede .env.local con NEXT_PUBLIC_SUPABASE_URL e
// SUPABASE_SERVICE_ROLE_KEY (stesso pattern gia' in uso in tutti gli script
// di questa repo).

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

// Decisioni di business su documenti SPECIFICI (batch 2025, confermate
// dall'utente) - MAI regole generalizzabili per pattern testuale. Le
// stesse descrizioni potrebbero in futuro appartenere a una vera
// consulenza; qui si registra solo cio' che vale per QUESTI documenti.
const REFERRAL_DOCUMENT_OVERRIDES: DocumentClassificationOverride[] = [
  { documentNumber: "V00093", businessUnitCode: "referral", reason: "Attivita' di supporto commerciale - confermato Referral dal business per questo documento" },
  { documentNumber: "V00069", businessUnitCode: "referral", reason: "Riconoscimento per segnalazione cliente - confermato Referral dal business per questo documento" },
  { documentNumber: "V00007", businessUnitCode: "referral", reason: "Revenue share anno 2024 - confermato Referral dal business per questo documento" },
];

function loadEnv() {
  const envPath = path.resolve(__dirname, "../.env.local");
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }
}

async function main() {
  const zipPath = process.argv[2];
  if (!zipPath) {
    console.error("Uso: npx tsx scripts/finance-2025-dry-run.ts <path-allo-zip>");
    process.exit(1);
  }

  loadEnv();
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

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

  const counterpartyProposals = await buildCounterpartyProposals(report.documentAudits, counterpartyRepo);

  const outDir = path.resolve(__dirname, "../data/generated");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "finance-2025-ingestion-audit.json"), reportToJson(report));
  fs.writeFileSync(path.join(outDir, "finance-2025-ingestion-audit.csv"), reportToCsv(report));
  fs.writeFileSync(path.join(outDir, "finance-2025-counterparty-proposals.json"), JSON.stringify(counterpartyProposals, null, 2));

  console.log("Dry-run completato.");
  console.log(`  File totali: ${report.documents.totalFiles}`);
  console.log(`  Documenti fiscali: ${report.documents.fiscalDocuments} (parsati: ${report.documents.parsedSuccessfully}, falliti: ${report.documents.failed})`);
  console.log(`  Ricevute: ${report.documents.receipts}`);
  console.log(`  Tipi documento: ${JSON.stringify(report.types)}`);
  console.log(`  Controparti distinte: ${report.counterparties.distinctFiscalCounterparties} (matched: ${report.counterparties.matched}, proposed: ${report.counterparties.proposed}, unresolved: ${report.counterparties.unresolved}, ambiguous: ${report.counterparties.ambiguous})`);
  console.log(`  Note di credito: ${report.creditNotes.length}`);
  console.log(`  Classificazione per BU: ${JSON.stringify(report.classification.byBusinessUnit)} | unclassified: ${report.classification.unclassified}`);
  console.log(`  Proposte counterparty (per identita' fiscale, non per documento): ${counterpartyProposals.length}`);
  console.log(`  Report scritto in: ${outDir}`);
}

main().catch((err) => {
  console.error("ERRORE dry-run:", err);
  process.exit(1);
});

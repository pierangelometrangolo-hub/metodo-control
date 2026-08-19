// Fase 1C - Batch approval delle counterparty "safe_to_create" (69 identita'
// dal dry-run 2025) + fix puntuale CRM Palazzo Arco Cadura. Unico script di
// questa fase che scrive sul DB (counterparties, counterparty_roles,
// crm_clients.vat_number/fiscal_code per Arco Cadura) - nessun'altra
// tabella viene toccata qui.
//
// Riusa resolveCounterparty/normalizeVat/normalizeCompanyName gia' testati:
// il pre-flight per ogni proposta e' un secondo giro della STESSA logica di
// matching usata per generare il report, ma contro lo stato REALE e
// corrente del DB (non contro lo snapshot del JSON) - se qualcosa e'
// cambiato dall'ultima generazione del report, il pre-flight lo scopre qui,
// non lo ignora.
//
// Uso: npx tsx scripts/finance-2025-phase1c-batch-approval.ts

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { resolveCounterparty, normalizeVat, normalizeCompanyName, type CounterpartyRepository } from "../lib/finance/ingestion/counterpartyResolver";
import { isValidItalianVat, isValidItalianFiscalCode } from "../lib/finance/ingestion/italianFiscalIdValidators";
import { SupabaseCounterpartyRepository } from "../lib/finance/ingestion/supabaseRepositories";
import type { PartyInfo } from "../lib/finance/ingestion/types";
import type { CounterpartyProposal } from "../lib/finance/ingestion/counterpartyProposalAggregator";

function loadEnv() {
  const envPath = path.resolve(__dirname, "../.env.local");
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }
}

type PreflightOutcome =
  | { action: "create" }
  | { action: "skip_already_exists"; existingId: string; existingDisplayName: string }
  | { action: "review"; reason: string };

async function preflightCheck(p: CounterpartyProposal, repo: CounterpartyRepository): Promise<PreflightOutcome> {
  const party: PartyInfo = {
    legalName: p.legalName,
    vatNumber: p.vatNumber,
    fiscalCode: p.fiscalCode,
    address: null,
    pec: null,
    sdiCode: null,
  };

  // 1/6: e' gia' risolvibile oggi (creata nel frattempo, o collisione reale)?
  const resolution = await resolveCounterparty(party, repo);

  if (resolution.status === "matched") {
    const all = await repo.findAll();
    const existing = all.find((c) => c.id === resolution.matchedCounterpartyId)!;
    const sameIdentity = normalizeCompanyName(existing.legalName ?? existing.displayName) === normalizeCompanyName(p.legalName);
    if (sameIdentity) {
      return { action: "skip_already_exists", existingId: existing.id, existingDisplayName: existing.displayName };
    }
    return {
      action: "review",
      reason: `Pre-flight: risolve ora come MATCHED (${resolution.matchMethod}) su counterparty esistente "${existing.displayName}" (${existing.id}), ma il nome non corrisponde a "${p.legalName}" - possibile collisione reale su VAT/CF, non idempotenza. Non creata.`,
    };
  }

  if (resolution.status === "ambiguous") {
    return { action: "review", reason: `Pre-flight: ${resolution.notes}` };
  }

  if (resolution.status === "proposed") {
    return {
      action: "review",
      reason: `Pre-flight: risolverebbe ora come enrich_placeholder su "${resolution.matchedCounterpartyDisplayName}" (${resolution.matchedCounterpartyId}), non piu' safe_to_create - stato del DB cambiato dall'ultima generazione del report, richiede decisione manuale (creare vs arricchire placeholder esistente).`,
    };
  }

  // 2/3/4: unresolved - ri-verifica checksum (2/3) e collisioni di nome (4) contro il DB corrente
  const vat = normalizeVat(p.vatNumber);
  const cf = p.fiscalCode ? p.fiscalCode.toUpperCase() : null;
  const vatValid = vat ? isValidItalianVat(vat) : false;
  const cfValid = !vat && cf ? isValidItalianFiscalCode(cf) : false;

  if (!vat && !cf) {
    return { action: "review", reason: "Pre-flight: nessun identificativo fiscale (VAT/CF) presente nella proposta." };
  }
  if (vat && !vatValid) {
    return { action: "review", reason: `Pre-flight: P.IVA "${p.vatNumber}" non supera (piu') il controllo di validita' (checksum).` };
  }
  if (!vat && cf && !cfValid) {
    return { action: "review", reason: `Pre-flight: Codice Fiscale "${p.fiscalCode}" non supera (piu') il controllo di validita' (checksum).` };
  }

  // 5: collisione di legal_name normalizzato contro il DB corrente (include eventuali counterparty
  // gia' create in QUESTA stessa esecuzione, dato che repo interroga il DB live ad ogni chiamata)
  const normalizedName = normalizeCompanyName(p.legalName);
  if (normalizedName) {
    const all = await repo.findAll();
    const nameCollisions = all.filter((c) => {
      const candidates = [normalizeCompanyName(c.legalName), normalizeCompanyName(c.displayName)];
      return candidates.includes(normalizedName);
    });
    if (nameCollisions.length > 0) {
      return {
        action: "review",
        reason: `Pre-flight: collisione di ragione sociale normalizzata con counterparty esistente/gia' creata in questo batch: ${nameCollisions
          .map((c) => `"${c.displayName}" (${c.id})`)
          .join(", ")}.`,
      };
    }
  }

  return { action: "create" };
}

async function main() {
  loadEnv();
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const repo = new SupabaseCounterpartyRepository(client);

  const proposalsPath = path.resolve(__dirname, "../data/generated/finance-2025-counterparty-proposals.json");
  const proposals: CounterpartyProposal[] = JSON.parse(fs.readFileSync(proposalsPath, "utf-8"));

  const { count: countBefore } = await client.from("counterparties").select("*", { count: "exact", head: true });

  const safeToCreate = proposals.filter((p) => p.proposedAction === "safe_to_create");
  const reviewFromJson = proposals.filter((p) => p.proposedAction === "review");

  console.log(`Proposte nel JSON: ${proposals.length} totali | safe_to_create: ${safeToCreate.length} | review: ${reviewFromJson.length}`);
  console.log(`counterparties in DB PRIMA: ${countBefore}`);
  console.log("");

  const created: { legalName: string | null; vatNumber: string | null; fiscalCode: string | null; id: string }[] = [];
  const skippedAlreadyExists: { legalName: string | null; existingId: string; existingDisplayName: string }[] = [];
  const movedToReview: { legalName: string | null; vatNumber: string | null; fiscalCode: string | null; reason: string }[] = [];
  const errors: { legalName: string | null; error: string }[] = [];

  // Sequenziale, mai in parallelo: ogni pre-flight interroga il DB live e
  // deve vedere le scritture delle iterazioni precedenti di QUESTO stesso
  // batch (altrimenti due proposte con lo stesso nome normalizzato ma VAT
  // diverse potrebbero essere create entrambe senza mai vedersi a vicenda).
  for (const p of safeToCreate) {
    try {
      const outcome = await preflightCheck(p, repo);

      if (outcome.action === "skip_already_exists") {
        skippedAlreadyExists.push({ legalName: p.legalName, existingId: outcome.existingId, existingDisplayName: outcome.existingDisplayName });
        console.log(`SKIP (gia' esistente): ${p.legalName} -> ${outcome.existingDisplayName} (${outcome.existingId})`);
        // Idempotenza del ruolo anche per le identita' gia' esistenti (potrebbero mancare del ruolo customer da una scrittura parziale precedente)
        const { error: roleError } = await client
          .from("counterparty_roles")
          .upsert({ counterparty_id: outcome.existingId, role: "customer" }, { onConflict: "counterparty_id,role", ignoreDuplicates: true });
        if (roleError) errors.push({ legalName: p.legalName, error: `Ruolo customer (idempotente) su counterparty esistente: ${roleError.message}` });
        continue;
      }

      if (outcome.action === "review") {
        movedToReview.push({ legalName: p.legalName, vatNumber: p.vatNumber, fiscalCode: p.fiscalCode, reason: outcome.reason });
        console.log(`REVIEW: ${p.legalName} - ${outcome.reason}`);
        continue;
      }

      // action === "create"
      const displayName = (p.legalName ?? p.vatNumber ?? p.fiscalCode ?? "").trim();
      if (!displayName) {
        errors.push({ legalName: p.legalName, error: "display_name vuoto dopo il pre-flight (nessun dato reale disponibile) - riga saltata, non scritta." });
        continue;
      }

      const { data: inserted, error: insertError } = await client
        .from("counterparties")
        .insert({
          display_name: displayName,
          legal_name: p.legalName,
          vat_number: p.vatNumber,
          fiscal_code: p.fiscalCode ? p.fiscalCode.toUpperCase() : null,
          country: p.country,
          status: "active",
          structure_id: null,
          crm_client_id: null,
          profile_id: null,
        })
        .select("id")
        .single();

      if (insertError || !inserted) {
        errors.push({ legalName: p.legalName, error: insertError?.message ?? "insert senza errore ma senza riga restituita." });
        console.log(`ERRORE creazione: ${p.legalName} - ${insertError?.message}`);
        continue;
      }

      const { error: roleError } = await client
        .from("counterparty_roles")
        .upsert({ counterparty_id: inserted.id, role: "customer" }, { onConflict: "counterparty_id,role", ignoreDuplicates: true });
      if (roleError) {
        errors.push({ legalName: p.legalName, error: `Counterparty creata (${inserted.id}) ma ruolo customer fallito: ${roleError.message}` });
      }

      created.push({ legalName: p.legalName, vatNumber: p.vatNumber, fiscalCode: p.fiscalCode, id: inserted.id });
      console.log(`CREATA: ${p.legalName} (${inserted.id})`);
    } catch (err) {
      errors.push({ legalName: p.legalName, error: err instanceof Error ? err.message : String(err) });
      console.log(`ECCEZIONE: ${p.legalName} - ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ============ Caso review noto: Puglia Wedding Production Association ============
  // Non deve MAI passare dal ramo "create" sopra (non e' in safeToCreate,
  // resta nel JSON come "review") - qui solo verifica esplicita che non sia
  // stata toccata, nessuna scrittura.
  const pugliaWedding = reviewFromJson.find((p) => (p.vatNumber ?? "").includes("90115700727") || (p.fiscalCode ?? "").includes("90115700727"));
  const { data: pugliaCheck } = await client.from("counterparties").select("id, display_name").ilike("display_name", "%puglia wedding%");

  const { count: countAfter } = await client.from("counterparties").select("*", { count: "exact", head: true });
  const { count: rolesAfter } = await client.from("counterparty_roles").select("*", { count: "exact", head: true });

  const { data: allCp } = await client.from("counterparties").select("vat_number, fiscal_code").not("vat_number", "is", null);
  const vatCounts = new Map<string, number>();
  for (const r of allCp ?? []) vatCounts.set(r.vat_number!, (vatCounts.get(r.vat_number!) ?? 0) + 1);
  const vatDuplicates = [...vatCounts.entries()].filter(([, n]) => n > 1);

  const { data: allCpCf } = await client.from("counterparties").select("vat_number, fiscal_code").not("fiscal_code", "is", null);
  const cfCounts = new Map<string, number>();
  for (const r of allCpCf ?? []) cfCounts.set(r.fiscal_code!, (cfCounts.get(r.fiscal_code!) ?? 0) + 1);
  const cfDuplicates = [...cfCounts.entries()].filter(([, n]) => n > 1);

  // ============ Fix puntuale CRM Palazzo Arco Cadura ============
  const arcoCaduraCp = (await repo.findAll()).find((c) => c.displayName === "Palazzo Arco Cadura");
  const crmFix: {
    crmClientId: string | null;
    before: { vat_number: string | null; fiscal_code: string | null } | null;
    after: { vat_number: string | null; fiscal_code: string | null } | null;
    rowsUpdated: number;
    skippedReason: string | null;
  } = { crmClientId: null, before: null, after: null, rowsUpdated: 0, skippedReason: null };

  if (!arcoCaduraCp || !arcoCaduraCp.crmClientId) {
    crmFix.skippedReason = "Nessuna counterparty 'Palazzo Arco Cadura' con crm_client_id valorizzato trovata - fix non eseguito.";
  } else {
    crmFix.crmClientId = arcoCaduraCp.crmClientId;
    const { data: crmRow, error: crmReadError } = await client
      .from("crm_clients")
      .select("id, vat_number, fiscal_code")
      .eq("id", arcoCaduraCp.crmClientId)
      .single();

    if (crmReadError || !crmRow) {
      crmFix.skippedReason = `Lettura crm_clients fallita: ${crmReadError?.message ?? "riga non trovata"}.`;
    } else {
      crmFix.before = { vat_number: crmRow.vat_number, fiscal_code: crmRow.fiscal_code };
      const isKnownDirtyValue = crmRow.vat_number === "04641400751 - NBLLSN77E57D862T";
      const alreadyFixed = crmRow.vat_number === "04641400751" && crmRow.fiscal_code === "NBLLSN77E57D862T";
      const fiscalCodeIsNullOrIncoherent = crmRow.fiscal_code === null || crmRow.fiscal_code !== "NBLLSN77E57D862T";

      if (alreadyFixed) {
        crmFix.skippedReason = "Gia' corretto in un'esecuzione precedente (vat_number/fiscal_code gia' ai valori attesi) - nessuna scrittura necessaria, idempotente.";
        crmFix.after = crmFix.before;
      } else if (!isKnownDirtyValue) {
        crmFix.skippedReason = `vat_number attuale ("${crmRow.vat_number}") non corrisponde ne' al valore sporco noto ne' al valore gia' corretto - fix non eseguito per sicurezza (nessuna scrittura su un dato diverso da quello atteso).`;
      } else if (!fiscalCodeIsNullOrIncoherent) {
        crmFix.skippedReason = "fiscal_code gia' coerente (NBLLSN77E57D862T) - nessuna scrittura necessaria, idempotente.";
        crmFix.after = crmFix.before;
      } else {
        const { data: updated, error: updateError } = await client
          .from("crm_clients")
          .update({ vat_number: "04641400751", fiscal_code: "NBLLSN77E57D862T" })
          .eq("id", arcoCaduraCp.crmClientId)
          .select("id, vat_number, fiscal_code");

        if (updateError) {
          crmFix.skippedReason = `Update fallito: ${updateError.message}`;
        } else {
          crmFix.rowsUpdated = updated?.length ?? 0;
          crmFix.after = updated?.[0] ? { vat_number: updated[0].vat_number, fiscal_code: updated[0].fiscal_code } : null;
        }
      }
    }
  }

  // Verifica: nessun'altra riga CRM toccata (idempotenza - conta quante righe crm_clients hanno questo identificativo, deve essere esattamente 1: Arco Cadura)
  const { data: crmVerify } = await client.from("crm_clients").select("id, business_name, vat_number, fiscal_code").eq("vat_number", "04641400751");
  const arcoCaduraCpAfter = (await repo.findAll()).find((c) => c.displayName === "Palazzo Arco Cadura");

  const output = {
    generatedAt: new Date().toISOString(),
    batchCreation: {
      safeToCreateInJson: safeToCreate.length,
      created: created.length,
      createdList: created,
      skippedAlreadyExists: skippedAlreadyExists.length,
      skippedAlreadyExistsList: skippedAlreadyExists,
      movedToReview: movedToReview.length,
      movedToReviewList: movedToReview,
      errors: errors.length,
      errorsList: errors,
    },
    counterpartiesDb: {
      totalBefore: countBefore,
      totalAfter: countAfter,
      vatDuplicates,
      cfDuplicates,
      customerRolesTotal: rolesAfter,
    },
    pugliaWeddingReview: {
      foundInReviewJson: !!pugliaWedding,
      createdInDb: (pugliaCheck?.length ?? 0) > 0,
      dbMatches: pugliaCheck ?? [],
    },
    crmArcoCaduraFix: {
      ...crmFix,
      crmClientIdUnchanged: crmFix.crmClientId === arcoCaduraCpAfter?.crmClientId,
      otherCrmRowsWithThisVat: (crmVerify ?? []).filter((r) => r.id !== crmFix.crmClientId),
    },
  };

  const outPath = path.resolve(__dirname, "../data/generated/finance-2025-phase1c-batch-approval-result.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log("\n=== RISULTATO ===");
  console.log(JSON.stringify(output, null, 2));
  console.log(`\nSalvato in: ${outPath}`);
}

main().catch((err) => {
  console.error("ERRORE Fase 1C batch approval:", err);
  process.exit(1);
});

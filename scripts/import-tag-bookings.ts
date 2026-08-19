// Import storico TAG (Booking Designer, export "Esportazione Prenotazioni"
// con filtro Tag attivo) in structure_tag_bookings. Nessuna logica Finance
// qui - solo acquisizione/storicizzazione Performance.
//
// Uso:
//   npx tsx scripts/import-tag-bookings.ts --structure "Palazzo Rollo" --file /percorso/export.csv
//
// structure_id NON e' mai hard-codato: risolto per nome struttura passato
// da riga di comando, cosi' la stessa routine funziona per altre strutture
// in futuro senza modifiche.
//
// Comportamento re-import (confermato): upsert su (structure_id,
// booking_code) - una prenotazione gia' presente viene aggiornata
// (tag_amount/check_out/source_reference) al dato piu' recente, non
// ignorata.
//
// Righe con Stato diverso da CONFERMATA (confermato: solo CONFERMATA
// esclusa IN ATTESA) e righe con errori di formato NON bloccano l'intero
// import - vengono escluse/segnalate esplicitamente nel report finale, mai
// scartate in silenzio.

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { parseTagBookingsCsv } from "../lib/performanceTagParser";

function loadEnv() {
  const envPath = path.resolve(__dirname, "../.env.local");
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }
}

function parseArgs(argv: string[]): { structure: string; file: string } {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  if (!args.structure || !args.file) {
    console.error('Uso: npx tsx scripts/import-tag-bookings.ts --structure "Nome Struttura" --file /percorso/export.csv');
    process.exit(1);
  }
  return { structure: args.structure, file: args.file };
}

async function main() {
  const { structure, file } = parseArgs(process.argv.slice(2));
  loadEnv();

  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: structRow, error: structError } = await client.from("structures").select("id, name").eq("name", structure).maybeSingle();
  if (structError) {
    console.error("Errore risoluzione struttura:", structError.message);
    process.exit(1);
  }
  if (!structRow) {
    const { data: all } = await client.from("structures").select("name").order("name");
    console.error(`Struttura "${structure}" non trovata. Strutture disponibili:`);
    for (const s of all ?? []) console.error(" - " + s.name);
    process.exit(1);
  }

  const fileContent = fs.readFileSync(file, "utf-8");
  const parsed = parseTagBookingsCsv(fileContent);

  console.log(`Struttura: ${structRow.name} (${structRow.id})`);
  console.log(`File: ${file}`);
  console.log(`Righe CONFERMATA da importare: ${parsed.rows.length}`);
  console.log(`Righe escluse (Stato != CONFERMATA): ${parsed.excludedRows.length}`);
  if (parsed.excludedRows.length > 0) {
    for (const r of parsed.excludedRows) console.log(`  - riga ${r.line} (${r.bookingCode}): ${r.reason}`);
  }
  console.log(`Righe scartate per errore di formato: ${parsed.errors.length}`);
  if (parsed.errors.length > 0) {
    for (const e of parsed.errors) console.log("  - " + e);
  }

  if (parsed.rows.length === 0) {
    console.log("Nessuna riga da importare.");
    return;
  }

  const sourceReference = `${path.basename(file)} (import ${new Date().toISOString().slice(0, 10)})`;

  const payload = parsed.rows.map((r) => ({
    structure_id: structRow.id,
    booking_code: r.bookingCode,
    period_year: r.periodYear,
    period_month: r.periodMonth,
    tag_amount: r.tagAmount,
    check_in: r.checkIn,
    check_out: r.checkOut,
    source_reference: sourceReference,
  }));

  const { data: upserted, error: upsertError } = await client
    .from("structure_tag_bookings")
    .upsert(payload, { onConflict: "structure_id,booking_code" })
    .select("id");

  if (upsertError) {
    console.error("Errore import:", upsertError.message);
    process.exit(1);
  }

  const totalAmount = parsed.rows.reduce((sum, r) => sum + r.tagAmount, 0);
  console.log(`\nImport completato: ${upserted?.length ?? 0} righe scritte (insert o update).`);
  console.log(`TAG totale importato in questo batch: €${totalAmount.toFixed(2)}`);
}

main().catch((err) => {
  console.error("ERRORE import TAG:", err);
  process.exit(1);
});

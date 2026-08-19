// Tabella di controllo Revenue / TAG / Revenue netto TAG per una struttura
// e un anno, mese per mese. Solo validazione che Performance produce dati
// coerenti - NON un confronto con fatture GAP o altro dato Finance.
//
// Uso: npx tsx scripts/tag-validation-report.ts --structure "Palazzo Rollo" --year 2025

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  const envPath = path.resolve(__dirname, "../.env.local");
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }
}

function parseArgs(argv: string[]): { structure: string; year: number } {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  if (!args.structure || !args.year) {
    console.error('Uso: npx tsx scripts/tag-validation-report.ts --structure "Nome Struttura" --year 2025');
    process.exit(1);
  }
  return { structure: args.structure, year: Number(args.year) };
}

async function main() {
  const { structure, year } = parseArgs(process.argv.slice(2));
  loadEnv();

  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: structRow, error: structError } = await client.from("structures").select("id, name").eq("name", structure).maybeSingle();
  if (structError || !structRow) {
    console.error(`Struttura "${structure}" non trovata.`, structError?.message ?? "");
    process.exit(1);
  }

  const cutoff = new Date().toISOString().slice(0, 10);
  const rows: { month: number; revenue: number | null; tag: number; net: number | null }[] = [];

  for (let month = 1; month <= 12; month++) {
    // Revenue: fonte esistente, via la RPC gia' sanzionata dal modulo
    // Performance - mai una query diretta su performance_daily_snapshot/
    // performance_monthly_snapshot.
    const { data: revData, error: revError } = await client.rpc("fn_month_snapshot_asof", {
      p_structure_ids: [structRow.id],
      p_period_year: year,
      p_period_month: month,
      p_cutoff_date: cutoff,
    });
    if (revError) {
      console.error(`Errore fn_month_snapshot_asof mese ${month}:`, revError.message);
      process.exit(1);
    }
    const revenue = revData && revData[0] ? Number(revData[0].revenue_total) : null;

    const { data: tagData, error: tagError } = await client.rpc("fn_tag_month_snapshot_asof", {
      p_structure_id: structRow.id,
      p_year: year,
      p_month: month,
    });
    if (tagError) {
      console.error(`Errore fn_tag_month_snapshot_asof mese ${month}:`, tagError.message);
      process.exit(1);
    }
    const tag = Number(tagData ?? 0);

    rows.push({ month, revenue, tag, net: revenue !== null ? revenue - tag : null });
  }

  const monthNames = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];

  console.log(`\nValidazione Revenue / TAG — ${structRow.name} — ${year}\n`);
  console.log("Mese | Revenue (Performance) | TAG | Revenue netto TAG");
  console.log("-----|------------------------|-----|-------------------");

  let totalRevenue = 0;
  let totalTag = 0;
  for (const r of rows) {
    const revStr = r.revenue !== null ? r.revenue.toFixed(2) : "ND";
    const netStr = r.net !== null ? r.net.toFixed(2) : "ND";
    console.log(`${monthNames[r.month - 1]}  | ${revStr.padStart(10)} | ${r.tag.toFixed(2).padStart(8)} | ${netStr.padStart(10)}`);
    if (r.revenue !== null) totalRevenue += r.revenue;
    totalTag += r.tag;
  }

  console.log("-----|------------------------|-----|-------------------");
  console.log(`TOT  | ${totalRevenue.toFixed(2).padStart(10)} | ${totalTag.toFixed(2).padStart(8)} | ${(totalRevenue - totalTag).toFixed(2).padStart(10)}`);
}

main().catch((err) => {
  console.error("ERRORE validazione TAG:", err);
  process.exit(1);
});

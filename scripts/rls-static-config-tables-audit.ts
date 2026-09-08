// ============ Audit empirico RLS: 4 tabelle statiche di configurazione permessi ============
// Tabelle:  modules, macro_areas, macro_area_min_level, user_level_rank
//
// Stesso metodo degli audit di sicurezza precedenti del repo: si testa con la
// chiave anon pubblica (nessun login) e con utenti reali autenticati via
// PostgREST come il browser. La service key NON viene usata per i test di
// accesso (bypasserebbe la RLS) - solo per creare/cancellare gli utenti
// effimeri.
//
// Requisiti attesi DOPO l'applicazione della migration
// 20260908170000_reenable_rls_static_config_tables.sql:
//   1. anon (nessun login) -> 0 righe / errore su tutte e 4 le tabelle
//   2. utente authenticated (qualsiasi livello) -> puo' ancora leggere le 4
//      tabelle (policy SELECT "to authenticated")
//   3. fn_user_level_rank / fn_user_can_view_module (security definer)
//      continuano a funzionare -> il modal "Moduli" in /admin/utenti non si
//      rompe
//
// Uso:  RUN_RLS_STATIC_AUDIT=1 npx tsx scripts/rls-static-config-tables-audit.ts

import fs from "fs";
import path from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const TABLES = ["modules", "macro_areas", "macro_area_min_level", "user_level_rank"] as const;
type Table = (typeof TABLES)[number];

function loadEnv() {
  const envPath = path.resolve(__dirname, "../.env.local");
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }
}

async function readTable(c: SupabaseClient, table: Table): Promise<number | string> {
  const { data, error } = await c.from(table).select("*").limit(50);
  if (error) return `blocked(${error.code ?? error.message})`;
  return data?.length ?? 0;
}

async function provisionUser(admin: SupabaseClient, level: "user" | "master", stamp: number, password: string) {
  const email = `rls-static-audit+${level}-${stamp}@yourmetodo.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser ${level}: ${error?.message}`);
  const id = data.user.id;
  const { error: pErr } = await admin
    .from("profiles")
    .upsert({ id, nome: `RlsStaticAudit ${level}`, email, level, is_active: true }, { onConflict: "id" });
  if (pErr) throw new Error(`profile upsert ${level}: ${pErr.message}`);
  return { id, email };
}

async function signIn(url: string, anonKey: string, email: string, password: string) {
  const c = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return c;
}

async function main() {
  if (process.env.RUN_RLS_STATIC_AUDIT !== "1") {
    console.error("Rifiutato: imposta RUN_RLS_STATIC_AUDIT=1 per eseguire (crea/cancella utenti reali).");
    process.exit(1);
  }
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const stamp = Date.now();
  const password = `Audit!${stamp}xQ`;
  const created: { id: string; email: string; level: "user" | "master" }[] = [];

  const report: Record<string, Record<string, number | string>> = {
    "anon (no login)": {},
    "authenticated user": {},
    "authenticated master": {},
  };
  let fnCheck = "";

  try {
    // --- 1. anon, nessun login ---
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    for (const t of TABLES) report["anon (no login)"][t] = await readTable(anon, t);

    // --- 2. utenti reali autenticati ---
    for (const level of ["user", "master"] as const) {
      created.push({ ...(await provisionUser(admin, level, stamp, password)), level });
    }
    for (const { email, level } of created) {
      const c = await signIn(url, anonKey, email, password);
      const key = level === "user" ? "authenticated user" : "authenticated master";
      for (const t of TABLES) report[key][t] = await readTable(c, t);

      if (level === "master") {
        // le funzioni security definer devono continuare a leggere le tabelle
        // anche con RLS attiva -> il modal Moduli non si rompe
        const masterId = created.find((u) => u.level === "master")!.id;
        const { data: rank, error: rErr } = await c.rpc("fn_user_level_rank", { p_user_id: masterId });
        const { data: canView, error: cErr } = await c.rpc("fn_user_can_view_module", {
          p_user_id: masterId,
          p_module_key: "performance",
        });
        fnCheck =
          rErr || cErr
            ? `FAIL  fn_user_level_rank=${rErr?.message ?? rank} / fn_user_can_view_module=${cErr?.message ?? canView}`
            : `PASS  fn_user_level_rank(master)=${rank} (atteso 3), fn_user_can_view_module(master,'performance')=${canView} (atteso true)`;
      }
    }
  } finally {
    for (const { id } of created) {
      await admin.from("profiles").delete().eq("id", id);
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  }

  console.log("\n=== RLS STATIC CONFIG TABLES - ACCESS MATRIX (empirical) ===\n");
  console.log(JSON.stringify(report, null, 2));
  console.log("\n=== SECURITY DEFINER FUNCTIONS ===\n" + fnCheck);

  const anonRow = report["anon (no login)"];
  const userRow = report["authenticated user"];
  // macro_areas e macro_area_min_level sono vuote dal seed: 0 righe non
  // distingue "RLS blocca" da "tabella vuota". Il segnale netto e' sulle due
  // tabelle popolate (modules, user_level_rank): anon deve vederne 0, un
  // authenticated deve continuare a leggerle. Su tutte e 4, comunque, nessun
  // client deve ricevere un errore `blocked(...)` da authenticated.
  const anonClosed =
    (anonRow.modules === 0 || String(anonRow.modules).startsWith("blocked")) &&
    (anonRow.user_level_rank === 0 || String(anonRow.user_level_rank).startsWith("blocked")) &&
    TABLES.every((t) => anonRow[t] === 0 || String(anonRow[t]).startsWith("blocked"));
  const authWorks =
    typeof userRow.modules === "number" && (userRow.modules as number) > 0 &&
    typeof userRow.user_level_rank === "number" && (userRow.user_level_rank as number) > 0 &&
    TABLES.every((t) => !String(userRow[t]).startsWith("blocked"));
  const fnOk = fnCheck.startsWith("PASS");

  console.log("\n=== VERDETTO ===");
  console.log(`${anonClosed ? "PASS" : "FAIL"}  anon (nessun login) non legge nessuna delle 4 tabelle`);
  console.log(`${authWorks ? "PASS" : "FAIL"}  utente authenticated legge ancora tutte e 4 le tabelle`);
  console.log(`${fnOk ? "PASS" : "FAIL"}  funzioni security definer intatte`);

  const allPass = anonClosed && authWorks && fnOk;
  console.log(`\n${allPass ? "TUTTI I REQUISITI SODDISFATTI (fix applicato)" : "!!! NON TUTTI SODDISFATTI (atteso PRIMA della migration: anon legge le tabelle)"}`);

  const outDir = path.resolve(__dirname, "../data/generated");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "rls-static-config-tables-audit.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), report, fnCheck, allPass }, null, 2)
  );
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error("ERRORE audit:", err);
  process.exit(1);
});

// ============ Audit empirico RLS: guest_nationality SELECT level gate ============
// GitHub issue #1 - vedi supabase/migrations/20260919090000_guest_nationality_select_level_gate.sql
//
// Stesso metodo degli audit di sicurezza precedenti del repo (vedi
// scripts/rls-static-config-tables-audit.ts, scripts/finance-security-audit.ts):
// utenti reali autenticati via PostgREST come il browser, MAI la service
// key per i test di accesso (bypasserebbe la RLS) - solo per
// creare/cancellare gli utenti effimeri.
//
// Va eseguito:
//   1. PRIMA della migration -> baseline, prova la vulnerabilita' (level="user"
//      legge tutte le righe).
//   2. DOPO che la migration e' stata applicata manualmente su Supabase
//      (questo ambiente non ha accesso SQL diretto, la migration va
//      eseguita a mano) -> conferma che user/senior sono bloccati e master
//      legge ancora.
//
// Uso:  RUN_GUEST_NATIONALITY_AUDIT=1 npx tsx scripts/guest-nationality-select-level-gate-audit.ts

import fs from "fs";
import path from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Level = "user" | "senior" | "master";
const LEVELS: Level[] = ["user", "senior", "master"];

function loadEnv() {
  const envPath = path.resolve(__dirname, "../.env.local");
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }
}

async function readCount(c: SupabaseClient, table: string): Promise<number | string> {
  const { data, error, count } = await c.from(table).select("*", { count: "exact", head: false }).limit(5);
  if (error) return `blocked(${error.code ?? error.message})`;
  return typeof count === "number" ? count : (data?.length ?? 0);
}

async function provision(admin: SupabaseClient, level: Level, stamp: number, password: string) {
  const email = `guest-nat-audit+${level}-${stamp}@yourmetodo.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser ${level}: ${error?.message}`);
  const id = data.user.id;
  const { error: pErr } = await admin
    .from("profiles")
    .upsert({ id, nome: `GuestNatAudit ${level}`, email, level, is_active: true }, { onConflict: "id" });
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
  if (process.env.RUN_GUEST_NATIONALITY_AUDIT !== "1") {
    console.error("Rifiutato: imposta RUN_GUEST_NATIONALITY_AUDIT=1 per eseguire (crea/cancella utenti reali).");
    process.exit(1);
  }
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const stamp = Date.now();
  const password = `Audit!${stamp}xQ`;
  const created: { id: string; email: string; level: Level }[] = [];

  const report: Record<Level, number | string> = { user: "", senior: "", master: "" };

  try {
    const { data: masterRow } = await admin.from("guest_nationality").select("id").limit(1);
    const serviceCanRead = (masterRow?.length ?? 0) > 0;

    for (const level of LEVELS) created.push({ ...(await provision(admin, level, stamp, password)), level });

    for (const { email, level } of created) {
      const c = await signIn(url, anonKey, email, password);
      report[level] = await readCount(c, "guest_nationality");
    }

    console.log("\n=== guest_nationality SELECT - ACCESS MATRIX (empirical) ===\n");
    console.log(JSON.stringify(report, null, 2));
    console.log(`\n(service role, per riferimento: ${serviceCanRead ? "tabella non vuota" : "tabella VUOTA - risultati 0/0/0 non sono probanti, servono righe reali"})`);

    const isBlocked = (v: unknown) => typeof v === "string" && v.startsWith("blocked");
    const isZero = (v: unknown) => v === 0;
    const hasRows = (v: unknown) => typeof v === "number" && v > 0;

    // Requisito ATTESO DOPO la migration (fn_user_level_rank >= 2, cioe'
    // senior/master): user bloccato, senior E master leggono entrambi.
    // Se eseguito PRIMA della migration, "user legge" e' la vulnerabilita'
    // stessa (atteso: user NON bloccato finche' il fix non e' applicato).
    const userBlocked = isBlocked(report.user) || isZero(report.user);
    const seniorReads = hasRows(report.senior);
    const masterReads = hasRows(report.master);

    console.log("\n=== VERDETTO (requisiti ATTESI DOPO l'applicazione della migration) ===");
    console.log(`${userBlocked ? "PASS" : "FAIL (atteso PRIMA della migration: e' la vulnerabilita' da correggere)"}  level=user NON legge guest_nationality`);
    console.log(`${seniorReads ? "PASS" : "FAIL"}  level=senior legge guest_nationality (rank>=2)`);
    console.log(`${masterReads ? "PASS" : "FAIL"}  level=master legge guest_nationality (rank>=2)`);

    const outDir = path.resolve(__dirname, "../data/generated");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, "guest-nationality-select-level-gate-audit.json"),
      JSON.stringify({ generatedAt: new Date().toISOString(), report, serviceCanRead }, null, 2)
    );
  } finally {
    for (const { id } of created) {
      await admin.from("profiles").delete().eq("id", id);
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error("ERRORE audit:", err);
  process.exit(1);
});

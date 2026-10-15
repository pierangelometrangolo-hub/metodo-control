import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Contratto testuale della migration 20261015120000 (adr_revpar con scope
// soggiorno): questo ambiente non esegue SQL, quindi si verifica sul testo
// che la nuova definizione di fn_commit_performance_import differisca dalla
// precedente (20260930130000) SOLO per la dichiarazione di v_scoped, e che
// le regole che contano restino quelle gia' in produzione.

const dir = path.join(process.cwd(), "supabase", "migrations");
const read = (file: string) => fs.readFileSync(path.join(dir, file), "utf-8");
const PREVIOUS = read("20260930130000_performance_import_events_stay_scope.sql");
const NEXT = read("20261015120000_performance_import_events_adr_revpar_stay_scope.sql");

function functionCode(sql: string): string {
  const start = sql.indexOf("create or replace function fn_commit_performance_import(");
  const end = sql.indexOf("comment on function fn_commit_performance_import", start);
  return sql
    .slice(start, end)
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

describe("fn_commit_performance_import — scope soggiorno esteso ad adr_revpar", () => {
  const previous = functionCode(PREVIOUS);
  const next = functionCode(NEXT);

  it("adr_revpar entra fra i dataset con scope; nationality resta fuori", () => {
    expect(previous).toContain("v_scoped boolean := p_dataset = 'montecallini_pms';");
    expect(next).toContain("v_scoped boolean := p_dataset in ('montecallini_pms', 'adr_revpar');");
    expect(next).not.toMatch(/v_scoped boolean := [^;]*nationality/);
  });

  it("unica differenza di codice rispetto alla definizione attiva: la dichiarazione di v_scoped", () => {
    const normalize = (code: string) =>
      code.replace("v_scoped boolean := p_dataset = 'montecallini_pms';", "<<V_SCOPED>>")
        .replace("v_scoped boolean := p_dataset in ('montecallini_pms', 'adr_revpar');", "<<V_SCOPED>>");
    expect(normalize(next)).toBe(normalize(previous));
  });

  it("6/7. la chiave resta struttura + extraction_date + dataset: altre strutture o altri dataset indipendenti", () => {
    expect(next).toContain("where structure_id = p_structure_id\n    and extraction_date = p_extraction_date\n    and dataset = p_dataset");
  });

  it("intervalli disgiunti esclusi dalla ricerca, sovrapposizione parziale -> scope_overlap, stesso scope -> hash", () => {
    expect(next).toContain("(stay_date_start <= v_scope_end and stay_date_end >= v_scope_start)");
    expect(next).toContain("'scope_overlap'");
    expect(next).toContain("'content_conflict'");
  });

  it("10. nessun overwrite: la funzione inserisce soltanto, mai update/delete dei dati", () => {
    expect(next).not.toMatch(/update\s+performance_daily_snapshot/i);
    expect(next).not.toMatch(/delete\s+from/i);
    expect(next).toContain("insert into performance_daily_snapshot");
  });

  it("nessuna modifica di schema nella nuova migration", () => {
    expect(NEXT).not.toMatch(/alter table|create table|add column|drop /i);
  });
});

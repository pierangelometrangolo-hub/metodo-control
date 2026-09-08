import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Test CONTRATTUALE/statico sul testo SQL della migration
// fn_commit_performance_import - non un test contro un Postgres reale
// (nessuna capacita' di eseguire SQL in questo ambiente). Verifica che il
// pg_advisory_xact_lock richiesto contro la race concorrente
// "check-then-act" (due chiamate RPC sulla stessa chiave, entrambe in
// READ COMMITTED, che vedono entrambe 'nessun import precedente' prima
// che l'altra faccia commit) sia presente, transazionale, con la chiave
// giusta, e sia la PRIMA operazione sensibile allo stato/DB della funzione:
// acquisito prima di qualunque query o scrittura che possa osservare o
// modificare stato persistente. La sola costruzione locale della stringa
// di chiave logica (v_lock_key) puo' precederlo ed e' esplicitamente
// accettabile, non un fallimento. La correttezza a runtime (che il lock
// davvero serializzi due sessioni concorrenti) resta verificabile solo
// eseguendo la migration su un Postgres reale.
const MIGRATION_PATH = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260908113200_fn_commit_performance_import.sql"
);

const sql = fs.readFileSync(MIGRATION_PATH, "utf-8");

// Tutte le ricerche sotto partono da QUI, non dall'inizio del file: i
// commenti sopra "create or replace function" (che spiegano il motivo del
// lock) citano deliberatamente frammenti di codice come "select * into
// v_existing" a scopo esplicativo - cercarli dall'inizio del file
// troverebbe quella citazione invece della riga di codice reale dentro il
// corpo della funzione, producendo un falso negativo.
const functionStart = sql.indexOf("create or replace function fn_commit_performance_import(");
// Fallimento esplicito qui (fuori da un blocco it/describe, prima ancora
// che vitest esegua i test) se il file non contiene piu' la funzione
// attesa - meglio di indici -1 silenziosi propagati sotto.
if (functionStart === -1) {
  throw new Error("create or replace function fn_commit_performance_import( non trovato nel file di migration");
}

// Indice della singola istruzione di lock e di ogni verifica/scrittura
// successiva - usati sotto per confrontare l'ORDINE testuale, che dentro
// un corpo plpgsql sequenziale (nessun ramo condizionale prima del lock)
// coincide con l'ordine di esecuzione.
const lockIndex = sql.indexOf("pg_advisory_xact_lock(", functionStart);

const checkpoints: Record<string, number> = {
  "ricerca evento imported (select * into v_existing)": sql.indexOf("select * into v_existing", functionStart),
  // "into v_legacy_exists" (l'assegnazione dentro le due select...into),
  // MAI "v_legacy_exists" da solo: quel token compare per primo nella
  // dichiarazione della variabile ("v_legacy_exists boolean;"), che
  // precede testualmente anche il lock stesso e farebbe fallire il test
  // per un motivo sbagliato (dichiarare una variabile non è "un controllo
  // che precede il lock").
  "controllo legacy (select ... into v_legacy_exists)": sql.indexOf("into v_legacy_exists", functionStart),
  "creazione bd_imports": sql.indexOf("insert into bd_imports", functionStart),
  "insert performance_daily_snapshot": sql.indexOf("insert into performance_daily_snapshot", functionStart),
  "insert guest_nationality": sql.indexOf("insert into guest_nationality", functionStart),
};

describe("Migration fn_commit_performance_import - advisory lock transazionale sulla chiave logica", () => {
  it("il file di migration esiste ed e' leggibile", () => {
    expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it("usa pg_advisory_xact_lock (transaction-scoped) - MAI pg_advisory_lock/pg_advisory_unlock (session-scoped, richiederebbe un unlock manuale)", () => {
    expect(lockIndex).toBeGreaterThan(-1);
    expect(sql).not.toMatch(/pg_advisory_unlock/);
    // pg_advisory_lock( senza il suffisso _xact non deve comparire da
    // nessuna parte - un lock session-scoped resterebbe attivo oltre la
    // singola chiamata RPC (violerebbe il requisito "si libera
    // automaticamente a commit/rollback").
    expect(sql).not.toMatch(/[^_]pg_advisory_lock\(/);
  });

  it("la chiave del lock e' derivata da structure_id + extraction_date + dataset (mai una chiave fissa/globale)", () => {
    // La riga immediatamente precedente alla chiamata di lock costruisce
    // v_lock_key concatenando i 3 parametri - verifica testuale che tutti
    // e 3 compaiano nella costruzione della chiave.
    const lockKeyLine = sql.slice(sql.indexOf("v_lock_key :=", functionStart), lockIndex);
    expect(lockKeyLine).toContain("p_structure_id");
    expect(lockKeyLine).toContain("p_extraction_date");
    expect(lockKeyLine).toContain("p_dataset");

    // La entry "declare" del lock e' text, non un valore fisso/costante -
    // nessun letterale numerico sostituisce la chiave (che indicherebbe
    // un lock globale invece che sulla chiave logica).
    expect(sql).toMatch(/v_lock_key\s+text;/);
  });

  it.each(Object.entries(checkpoints))(
    "il lock (pg_advisory_xact_lock) precede testualmente: %s",
    (_label, checkpointIndex) => {
      expect(checkpointIndex).toBeGreaterThan(-1); // il checkpoint atteso esiste davvero nel file
      expect(lockIndex).toBeGreaterThan(-1);
      expect(lockIndex).toBeLessThan(checkpointIndex);
    }
  );

  it("il lock e' la PRIMA operazione sensibile allo stato/DB del corpo funzione: nessuna query o scrittura che osserva/modifica stato persistente lo precede (la sola costruzione in memoria di v_lock_key e' ammessa, non e' un fallimento)", () => {
    const bodyStart = sql.indexOf("begin", sql.indexOf("declare", functionStart));
    const beforeLock = sql.slice(bodyStart, lockIndex);

    // Fra "begin" e la chiamata di lock possono esserci solo commenti e
    // l'assegnazione locale di v_lock_key (calcolo in memoria: non legge
    // ne' scrive stato persistente). NON deve comparire alcuna operazione
    // che osserva o modifica stato persistente prima del lock -
    // performance_import_events/performance_daily_snapshot/guest_nationality/bd_imports
    // o qualunque altra select/insert/update/delete.
    expect(beforeLock).not.toMatch(/\bselect\s/i);
    expect(beforeLock).not.toMatch(/\binsert\s+into\b/i);
    expect(beforeLock).not.toMatch(/\bupdate\s/i);
    expect(beforeLock).not.toMatch(/\bdelete\s+from\b/i);

    // Costruire la chiave logica locale PRIMA del lock e' esplicitamente
    // consentito (in memoria, nessuno stato persistente toccato).
    expect(beforeLock).toContain("v_lock_key :=");
  });

  it("contiene una nota SQL che spiega perché il lock esiste (race check-then-act sotto READ COMMITTED)", () => {
    expect(sql).toMatch(/READ COMMITTED/);
    expect(sql).toMatch(/check-then-act/);
  });
});

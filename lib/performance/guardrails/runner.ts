// ============ Performance Guardrails — runner ============
//
// STEP 3 — enforcement controllato (GUARDRAILS_SHADOW_MODE = false).
//
// runGuardrails() e' PURO: nessun I/O, nessuna dipendenza da
// React/Supabase, e NON muta l'input (ne' l'array ne' le righe). Restituisce
// solo un elenco di findings + il flag hasBlockingFindings.
//
// importService esegue il runner DOPO la normalizzazione e PRIMA del
// calcolo hash/conflict/commit, e ORA legge davvero hasBlockingFindings:
// se true, l'unita' (file per ADR/RevPAR e Nazionalita', singolo kind per
// Montecallini) viene bloccata - status validation_error, zero righe
// scritte, zero bd_imports, zero RPC di commit, evento auditato (vedi
// lib/performance/ingestion/validationError.ts). Solo le findings con
// severity="blocking" nel registry (oggi: GR-C06, GR-C01-QTY) bloccano -
// tutte le altre restano warning/info, mai promosse automaticamente da
// questo cambio: la severity di ciascun guardrail e' decisa nel registry
// (registry.ts), il runner e importService si limitano a rispettarla.

import { runAdrRevparGuardrails } from "./adrRevpar";
import { runCommonSnapshotGuardrails } from "./common";
import { runMontecalliniGuardrails } from "./montecallini";
import { runNationalityGuardrails } from "./nationality";
import { guardrailMeta, guardrailOrder } from "./registry";
import type {
  GuardrailFinding,
  GuardrailNationalityRow,
  GuardrailResult,
  GuardrailSnapshotRow,
} from "./types";

// Interruttore unico dell'enforcement - ora FALSE: importService legge
// davvero hasBlockingFindings e blocca (vedi importService.ts,
// validationError.ts). Resta come costante esplicita, mai rimossa, cosi'
// un eventuale rollback a shadow mode e' un cambiamento di una riga sola,
// deliberato e visibile in un test dedicato (mai un flag implicito sparso
// nel codice chiamante).
export const GUARDRAILS_SHADOW_MODE = false as const;

export type RunGuardrailsInput =
  | { dataset: "adr_revpar"; rows: readonly GuardrailSnapshotRow[] }
  | { dataset: "montecallini_pms"; rows: readonly GuardrailSnapshotRow[] }
  | { dataset: "nationality"; rows: readonly GuardrailNationalityRow[] };

// Ordinamento deterministico: prima per ordine di dichiarazione nel
// registry, poi per stay_date, poi per nazionalita'. Due input con lo
// stesso insieme di righe (in qualunque ordine) producono lo stesso elenco
// di findings nello stesso ordine.
function sortFindings(findings: GuardrailFinding[]): GuardrailFinding[] {
  return [...findings].sort((a, b) => {
    const byRegistry = guardrailOrder(a.id) - guardrailOrder(b.id);
    if (byRegistry !== 0) return byRegistry;
    const byDate = (a.stayDate ?? "").localeCompare(b.stayDate ?? "");
    if (byDate !== 0) return byDate;
    return (a.nationality ?? "").localeCompare(b.nationality ?? "");
  });
}

export function runGuardrails(input: RunGuardrailsInput): GuardrailResult {
  let findings: GuardrailFinding[];

  if (input.dataset === "nationality") {
    findings = runNationalityGuardrails(input.rows);
  } else {
    findings = [
      ...runCommonSnapshotGuardrails(input.dataset, input.rows),
      ...(input.dataset === "adr_revpar" ? runAdrRevparGuardrails(input.rows) : []),
      ...(input.dataset === "montecallini_pms" ? runMontecalliniGuardrails(input.rows) : []),
    ];
  }

  findings = sortFindings(findings);
  return {
    findings,
    hasBlockingFindings: findings.some((f) => f.severity === "blocking"),
  };
}

// ---- Raggruppamento per la UI / il log ----
// Le findings ripetute (es. GR-C04 su decine di giorni) non vanno stampate
// una per una: si raggruppano per id, si mostra il conteggio e pochi
// esempi.

export type GuardrailFindingGroup = {
  id: string;
  title: string;
  severity: GuardrailFinding["severity"];
  scope: GuardrailFinding["scope"];
  count: number;
  examples: string[]; // messaggi, troncati a `exampleLimit`
  hiddenCount: number; // esempi non mostrati
};

export function groupFindingsForDisplay(
  findings: readonly GuardrailFinding[],
  exampleLimit = 3
): GuardrailFindingGroup[] {
  const byId = new Map<string, GuardrailFinding[]>();
  for (const f of findings) {
    const bucket = byId.get(f.id);
    if (bucket) bucket.push(f);
    else byId.set(f.id, [f]);
  }

  return [...byId.entries()]
    .sort((a, b) => guardrailOrder(a[0]) - guardrailOrder(b[0]))
    .map(([id, group]) => {
      const meta = guardrailMeta(id);
      const examples = group.slice(0, exampleLimit).map((f) => f.message);
      return {
        id,
        title: meta?.title ?? id,
        severity: group[0].severity,
        scope: group[0].scope,
        count: group.length,
        examples,
        hiddenCount: Math.max(0, group.length - examples.length),
      };
    });
}

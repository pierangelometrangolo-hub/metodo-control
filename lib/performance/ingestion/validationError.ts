// ============ Performance Guardrails — Step 3: validation_error ============
//
// Punto unico per costruire error_code/messaggio quando un import viene
// bloccato PRIMA del commit (parser o guardrail). Nessuna logica di
// decisione qui dentro (quella resta in importService.ts: QUANDO bloccare)
// - solo COME descrivere il blocco, cosi' il formato resta identico fra
// ingestSingleFile e ingestMontecalliniBatch, mai duplicato/divergente fra
// i due.
//
// Principio non negoziabile (STEP 3): un solo evento validation_error per
// file/kind bloccato, mai una proliferazione di eventi - anche quando piu'
// findings blocking coesistono nello stesso file/kind.

import { groupFindingsForDisplay } from "../guardrails/runner";
import type { GuardrailFinding } from "../guardrails/types";

export type ValidationErrorCode =
  | "parser_structure_error" // il file non ha prodotto NESSUNA riga (colonne mancanti, file vuoto, struttura non riconosciuta)
  | "parser_row_error" // almeno una vera riga-dato non e' risultata parsabile/valida, pur con altre righe sopravvissute
  | "negative_physical_quantity" // GR-C01-QTY
  | "duplicate_logical_key" // GR-C06
  | "guardrail_validation_failed"; // piu' guardrail blocking distinti nello stesso file/kind - nessun codice singolo li rappresenta

// ---------- Parser errors (categoria B: vere righe-dato non parsabili) ----------

// rowsSurvived = quante righe l'unita' bloccata (file o, per Montecallini,
// l'insieme dei file del batch) ha comunque prodotto nonostante gli
// errori. 0 -> l'intero file/i file sono strutturalmente inutilizzabili
// (colonne mancanti, file vuoto...): parser_structure_error. >0 -> il
// formato e' valido ma almeno una riga-dato specifica non lo e':
// parser_row_error. In entrambi i casi l'esito e' lo stesso: BLOCKING,
// zero scritture - il codice serve solo a distinguere la causa nell'audit.
export function classifyParserErrorCode(rowsSurvived: number): Extract<ValidationErrorCode, "parser_structure_error" | "parser_row_error"> {
  return rowsSurvived === 0 ? "parser_structure_error" : "parser_row_error";
}

// unitLabel: nome file (ingestSingleFile) o elenco file del batch
// (ingestMontecalliniBatch) - mai un file fisico combinato, solo
// un'etichetta leggibile per il messaggio.
export function buildParserBlockMessage(unitLabel: string, parseErrors: readonly string[]): string {
  const examples = parseErrors.slice(0, 3).join(" | ");
  const hidden = parseErrors.length > 3 ? ` (+${parseErrors.length - 3} altri)` : "";
  return `Import bloccato: ${unitLabel} contiene ${parseErrors.length} riga/e non valida/e - nessuna scrittura, nessun import parziale. ${examples}${hidden}`;
}

// ---------- Guardrail blocking findings (GR-C01-QTY, GR-C06) ----------

// Un solo error_code quando le findings blocking appartengono TUTTE allo
// stesso guardrail; "guardrail_validation_failed" (sintetico, mai una
// proliferazione di codici) quando coesistono piu' guardrail blocking
// distinti nello stesso file/kind.
export function classifyGuardrailErrorCode(findings: readonly GuardrailFinding[]): ValidationErrorCode {
  const blockingIds = new Set(findings.filter((f) => f.severity === "blocking").map((f) => f.id));
  if (blockingIds.size === 1) {
    const [id] = blockingIds;
    if (id === "GR-C01-QTY") return "negative_physical_quantity";
    if (id === "GR-C06") return "duplicate_logical_key";
  }
  return "guardrail_validation_failed";
}

// Messaggio sintetico (mai centinaia di righe) - un solo evento
// validation_error riassume TUTTE le findings blocking di questo
// file/kind; il dettaglio completo (fino a 3 esempi per guardrail) resta
// disponibile a parte in outcome.guardrailFindings per la UI.
export function buildGuardrailBlockMessage(findings: readonly GuardrailFinding[]): string {
  const blocking = findings.filter((f) => f.severity === "blocking");
  const groups = groupFindingsForDisplay(blocking);
  const summary = groups.map((g) => `${g.title} (${g.id}): ${g.count} caso/i`).join("; ");
  return `Import bloccato dai controlli di qualità - ${summary}. Nessuna scrittura, nessun import parziale.`;
}

// ============ Performance Guardrails V0 — Nazionalita' ============
//
// Guardrails V0 shadow mode — no enforcement.
//
// GR-C06 (variante nationality): la chiave logica e' (stay_date,
// nationality). Il report BD "Ospiti per provenienza" non dovrebbe mai
// riportare due volte la stessa coppia - se succede, non c'e' modo di
// sapere quale valore di presenze sia autoritativo. NON deduplica, NON
// somma: emette una sola finding scope="file".
//
// Nessun controllo sui VOLUMI di presenze in V0: non esiste un riferimento
// indipendente affidabile e "assenza dato != zero" impedisce qualunque
// inferenza sui buchi.

import type { GuardrailFinding, GuardrailNationalityRow } from "./types";

export function runNationalityGuardrails(rows: readonly GuardrailNationalityRow[]): GuardrailFinding[] {
  const seen = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.stayDate}|${row.nationality}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }

  const duplicated = [...seen.entries()].filter(([, count]) => count > 1);
  if (duplicated.length === 0) return [];

  duplicated.sort((a, b) => a[0].localeCompare(b[0]));
  const detail = duplicated
    .map(([key, count]) => {
      const [stayDate, nationality] = key.split("|");
      return `${stayDate} / ${nationality} (${count}x)`;
    })
    .join(", ");
  const totalExtraRows = duplicated.reduce((sum, [, count]) => sum + (count - 1), 0);

  return [
    {
      id: "GR-C06",
      dataset: "nationality",
      severity: "blocking",
      scope: "file",
      stayDate: null,
      nationality: null,
      message: `Il file contiene ${duplicated.length} coppia/e giorno + nazionalita' ripetute (${detail}). Impossibile stabilire quale valore di presenze sia autoritativo - nessuna deduplica automatica.`,
      context: {
        duplicatedKeys: duplicated.map(([key]) => key),
        totalExtraRows,
      },
    },
  ];
}

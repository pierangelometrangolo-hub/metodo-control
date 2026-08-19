import type { CompetenceResolutionResult } from "./types";

const ITALIAN_MONTHS: Record<string, number> = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
  luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
};

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Cerca "<mese> <anno>" nella descrizione (es. "dicembre 2024",
// "Dicembre 2025"). Un solo pattern riconosciuto per invocazione - se la
// descrizione contiene piu' riferimenti a mesi diversi, il chiamante deve
// trattarlo come non risolvibile con certezza (non gestito qui: questa
// funzione ritorna comunque il PRIMO trovato, il chiamante decide se
// fidarsi in base al contesto).
function extractMonthYearFromDescription(description: string): { year: number; month: number } | null {
  const lower = description.toLowerCase();
  for (const [name, month] of Object.entries(ITALIAN_MONTHS)) {
    const regex = new RegExp(`\\b${name}\\b\\s+(\\d{4})`, "i");
    const match = lower.match(regex);
    if (match) {
      return { year: Number(match[1]), month };
    }
  }
  return null;
}

// Risolve la competenza per un documento o una singola riga. Ordine
// fisso, mai invertito: periodo strutturato XML (il piu' affidabile) ->
// descrizione con mese/anno esplicito -> non risolto. MAI un fallback
// silenzioso sulla data documento: il caso reale noto (fattura emessa
// gennaio 2026, competenza dicembre 2025) e' esattamente cio' che questa
// funzione deve evitare di sbagliare.
export function resolveCompetence(
  structuredFrom: string | null,
  structuredTo: string | null,
  description: string | null
): CompetenceResolutionResult {
  if (structuredFrom && structuredTo) {
    return {
      competenceFrom: structuredFrom,
      competenceTo: structuredTo,
      status: "resolved",
      method: "structured_period",
      detail: `Periodo di servizio dichiarato esplicitamente nell'XML (DataInizioPeriodo/DataFinePeriodo): ${structuredFrom} -> ${structuredTo}.`,
    };
  }

  if (description) {
    const found = extractMonthYearFromDescription(description);
    if (found) {
      const from = `${found.year}-${pad(found.month)}-01`;
      const to = `${found.year}-${pad(found.month)}-${pad(lastDayOfMonth(found.year, found.month))}`;
      return {
        competenceFrom: from,
        competenceTo: to,
        status: "resolved",
        method: "description_month_year",
        detail: `Mese/anno riconosciuto nella descrizione ("${description}") -> ${from} / ${to}. Verificare comunque a campione: un solo riferimento mensile per riga e' assunto, descrizioni con piu' mesi non sono gestite da questa euristica.`,
      };
    }
  }

  return {
    competenceFrom: null,
    competenceTo: null,
    status: "missing_data",
    method: "unresolved",
    detail: "Nessun periodo strutturato ne' riferimento a mese/anno riconoscibile nella descrizione - competenza non inferita, mai dedotta dalla sola data documento.",
  };
}

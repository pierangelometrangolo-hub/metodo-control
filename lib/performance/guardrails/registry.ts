// ============ Performance Guardrails V0 — registry ============
//
// Metadati dichiarativi di ogni guardrail: unica fonte di verita' per
// id, titolo, descrizione, severity di default, scope e dataset applicabili.
// Usato da:
//   - runner.ts   -> ordinamento deterministico delle findings
//   - la UI       -> etichette e raggruppamento nel riepilogo "Avvisi"
//   - i test      -> asserzioni sulla forma delle findings
//
// L'ordine di dichiarazione qui e' anche l'ordine con cui le findings
// vengono ordinate a parita' di stayDate (vedi runner.sortFindings).

import type { GuardrailDataset, GuardrailScope, GuardrailSeverity } from "./types";

export type GuardrailId =
  | "GR-C01-QTY"
  | "GR-C01-REV"
  | "GR-C02"
  | "GR-C03"
  | "GR-C04"
  | "GR-C05"
  | "GR-C06"
  | "GR-ADR-OCC01"
  | "GR-MC-REV01";

export type GuardrailMeta = {
  id: GuardrailId;
  title: string;
  description: string;
  // Severity con cui questo guardrail emette le sue findings in Guardrails
  // V0 (shadow mode). "blocking" = anomalia bloccante CANDIDATA: in shadow
  // mode non blocca, ma sara' promossa a blocco reale nello step di
  // enforcement.
  defaultSeverity: GuardrailSeverity;
  scope: GuardrailScope;
  datasets: GuardrailDataset[];
};

// Ordine = priorita' di valutazione/visualizzazione. Structural/chiave
// prima, poi controlli di valore fisico, poi coerenze KPI.
export const GUARDRAIL_REGISTRY: GuardrailMeta[] = [
  {
    id: "GR-C06",
    title: "Chiave duplicata nel file",
    description:
      "La stessa chiave logica (giorno per ADR/RevPAR e Montecallini, giorno + nazionalita' per Nazionalita') compare piu' volte nello stesso file/dataset. Nessuna deduplica automatica: impossibile stabilire quale riga sia autoritativa.",
    defaultSeverity: "blocking",
    scope: "file",
    datasets: ["adr_revpar", "montecallini_pms", "nationality"],
  },
  {
    id: "GR-C01-QTY",
    title: "Quantita' negativa",
    description:
      "Camere vendute, camere disponibili, arrivi o presenze con valore negativo: stato fisicamente impossibile.",
    defaultSeverity: "blocking",
    scope: "row",
    datasets: ["adr_revpar", "montecallini_pms"],
  },
  {
    id: "GR-C01-REV",
    title: "Ricavo negativo",
    description:
      "Revenue totale negativo. Segnalato ma non bloccante: puo' rappresentare uno storno/nota di credito legittima.",
    defaultSeverity: "warning",
    scope: "row",
    datasets: ["adr_revpar", "montecallini_pms"],
  },
  {
    id: "GR-C02",
    title: "Camere vendute oltre le disponibili",
    description:
      "rooms_sold maggiore di rooms_available. Per Montecallini il parser lo blocca gia' a monte; per Booking Designer e' una nuova segnalazione in osservazione (non ancora bloccante).",
    defaultSeverity: "warning",
    scope: "row",
    datasets: ["adr_revpar", "montecallini_pms"],
  },
  {
    id: "GR-C03",
    title: "Inventario a zero con attivita'",
    description:
      "rooms_available = 0 ma con camere vendute o ricavo. Occupancy e RevPAR non saranno calcolabili per quel giorno.",
    defaultSeverity: "warning",
    scope: "row",
    datasets: ["adr_revpar", "montecallini_pms"],
  },
  {
    id: "GR-C04",
    title: "Ricavo senza camere vendute",
    description:
      "revenue_total > 0 con rooms_sold = 0. Possibile ricavo accessorio, penale o deposito - non bloccante.",
    defaultSeverity: "warning",
    scope: "row",
    datasets: ["adr_revpar", "montecallini_pms"],
  },
  {
    id: "GR-C05",
    title: "Camere vendute senza ricavo",
    description:
      "rooms_sold > 0 con revenue_total = 0. Possibili camere comp/staff o dato ricavo non ancora disponibile - non bloccante.",
    defaultSeverity: "warning",
    scope: "row",
    datasets: ["adr_revpar", "montecallini_pms"],
  },
  {
    id: "GR-ADR-OCC01",
    title: "Coerenza Occupancy (Booking Designer)",
    description:
      "Occupancy ricalcolata (rooms_sold / rooms_available) confrontata con l'IMO dichiarato dalla fonte. Controllo SEPARATO dalla coerenza Revenue: l'Occupancy non valida il Revenue. No-op se l'IMO e' assente o non interpretabile.",
    defaultSeverity: "warning",
    scope: "row",
    datasets: ["adr_revpar"],
  },
  {
    id: "GR-MC-REV01",
    title: "Coerenza RevPAR (Montecallini)",
    description:
      "RevPAR ricalcolato (revenue_total / rooms_available) confrontato con l'RPAR dichiarato dalla fonte. No-op se l'RPAR e' assente o non interpretabile.",
    defaultSeverity: "warning",
    scope: "row",
    datasets: ["montecallini_pms"],
  },
];

const REGISTRY_BY_ID = new Map<string, GuardrailMeta>(GUARDRAIL_REGISTRY.map((m) => [m.id, m]));

export function guardrailMeta(id: string): GuardrailMeta | undefined {
  return REGISTRY_BY_ID.get(id);
}

// Indice di dichiarazione (per l'ordinamento deterministico delle
// findings). Un id sconosciuto finisce in coda in modo stabile.
export function guardrailOrder(id: string): number {
  const idx = GUARDRAIL_REGISTRY.findIndex((m) => m.id === id);
  return idx === -1 ? GUARDRAIL_REGISTRY.length : idx;
}

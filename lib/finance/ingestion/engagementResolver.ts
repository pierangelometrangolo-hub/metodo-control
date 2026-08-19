import type { EngagementCandidateResult } from "./types";

export type EngagementRecord = {
  id: string;
  displayName: string;
  status: "active" | "closed";
};

export interface EngagementRepository {
  findByCounterpartyId(counterpartyId: string): Promise<EngagementRecord[]>;
}

// Propone (mai decide) l'engagement Consulting per un documento gia'
// classificato come pertinente alla BU Consulenza. Il caso guida e' Cantine
// Due Palme -> Kelina / Villa Neviera: la sola P.IVA porta a PIU' di un
// engagement, e questa funzione non sceglie da sola - prova un segnale
// debole (nome engagement citato nel testo del documento) solo per
// arricchire la proposta, mai per chiuderla in automatico. Nessun merge,
// nessuna scrittura: e' sempre e solo un candidate per la revisione umana.
export async function resolveEngagementCandidate(
  counterpartyId: string | null,
  documentText: string,
  repo: EngagementRepository
): Promise<EngagementCandidateResult> {
  if (!counterpartyId) {
    return {
      status: "unresolved",
      candidateEngagementId: null,
      candidateEngagementName: null,
      ambiguousCandidates: [],
      confidence: null,
      reason: "Nessuna counterparty risolta - impossibile cercare un engagement senza sapere a quale controparte fiscale appartiene il documento.",
    };
  }

  const engagements = await repo.findByCounterpartyId(counterpartyId);

  if (engagements.length === 0) {
    return {
      status: "unresolved",
      candidateEngagementId: null,
      candidateEngagementName: null,
      ambiguousCandidates: [],
      confidence: null,
      reason: "Nessun consulting_engagement esistente per questa counterparty - potrebbe essere una consulenza non ancora modellata, non creato in dry-run.",
    };
  }

  if (engagements.length === 1) {
    return {
      status: "matched",
      candidateEngagementId: engagements[0].id,
      candidateEngagementName: engagements[0].displayName,
      ambiguousCandidates: [],
      confidence: "high",
      reason: "Unico consulting_engagement collegato a questa counterparty - nessuna ambiguita' strutturale.",
    };
  }

  // Piu' di un engagement sulla stessa counterparty (es. Cantine Due Palme).
  // Tentativo debole di disambiguazione: il nome di UN SOLO engagement
  // compare nel testo del documento (descrizione righe/causale)?
  const lowerText = documentText.toLowerCase();
  const nameMatches = engagements.filter((e) => lowerText.includes(e.displayName.toLowerCase()));

  if (nameMatches.length === 1) {
    return {
      status: "matched",
      candidateEngagementId: nameMatches[0].id,
      candidateEngagementName: nameMatches[0].displayName,
      ambiguousCandidates: engagements
        .filter((e) => e.id !== nameMatches[0].id)
        .map((e) => ({ id: e.id, displayName: e.displayName })),
      confidence: "medium",
      reason: `Controparte con ${engagements.length} engagement (${engagements.map((e) => e.displayName).join(", ")}) - il nome "${nameMatches[0].displayName}" compare nel testo del documento, proposto come candidate ma da confermare a mano (segnale testuale, non identificativo strutturale).`,
    };
  }

  return {
    status: "ambiguous",
    candidateEngagementId: null,
    candidateEngagementName: null,
    ambiguousCandidates: engagements.map((e) => ({ id: e.id, displayName: e.displayName })),
    confidence: null,
    reason: `Controparte con ${engagements.length} engagement (${engagements.map((e) => e.displayName).join(", ")}) - nessun nome riconosciuto nel testo del documento, richiede revisione manuale. La P.IVA da sola non basta a disambiguare.`,
  };
}

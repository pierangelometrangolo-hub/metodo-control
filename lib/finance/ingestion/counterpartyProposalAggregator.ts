import { resolveCounterparty, normalizeVat, normalizeCompanyName, type CounterpartyRepository } from "./counterpartyResolver";
import { isValidItalianVat, isValidItalianFiscalCode } from "./italianFiscalIdValidators";
import type { DocumentAudit, PartyInfo } from "./types";

// "safe_to_create"/"review" secondo il criterio confermato:
//   SAFE TO CREATE = VAT/CF valido (checksum reale) + nessuna collisione +
//                     identita' fiscale univoca + dati XML coerenti
//   REVIEW = identificativo anomalo, collisione, dati fiscali discordanti,
//            identita' dubbia
// existing_match/enrich_placeholder/ambiguous restano separati: riguardano
// il confronto con counterparties gia' in DB, non la qualita' del dato
// sorgente in se'.
export type CounterpartyProposalAction = "existing_match" | "enrich_placeholder" | "safe_to_create" | "review";

export type CounterpartyProposal = {
  legalName: string | null;
  vatNumber: string | null;
  fiscalCode: string | null;
  country: string | null;
  documentCount: number;
  netAmount: number;
  grossAmount: number;
  existingMatchId: string | null;
  existingMatchDisplayName: string | null;
  existingMatchMethod: string | null;
  proposedAction: CounterpartyProposalAction;
  confidence: "high" | "medium" | "low";
  reason: string;
};

type Group = {
  party: PartyInfo;
  documentCount: number;
  netAmount: number;
  grossAmount: number;
  distinctLegalNames: Set<string>; // per rilevare dati fiscali discordanti all'interno dello stesso gruppo
};

// Componente Finance Core generico (non specifico Consulting): raggruppa i
// documenti di un batch per IDENTITA' FISCALE (non per documento) e
// propone un'azione per ciascuna - mai una creazione automatica, sempre e
// solo una proposta da approvare. Riusa lo stesso resolveCounterparty gia'
// testato, non reimplementa la logica di matching.
export async function buildCounterpartyProposals(
  documentAudits: DocumentAudit[],
  repo: CounterpartyRepository
): Promise<CounterpartyProposal[]> {
  const groups = new Map<string, Group>();

  for (const audit of documentAudits) {
    const party = audit.document.counterpartyRaw;
    const key = normalizeVat(party.vatNumber) ?? party.fiscalCode ?? party.legalName ?? "?";
    const existing = groups.get(key);
    if (existing) {
      existing.documentCount += 1;
      existing.netAmount += audit.document.netAmount;
      existing.grossAmount += audit.document.grossAmount;
      if (party.legalName) existing.distinctLegalNames.add(party.legalName.trim().toUpperCase());
    } else {
      groups.set(key, {
        party,
        documentCount: 1,
        netAmount: audit.document.netAmount,
        grossAmount: audit.document.grossAmount,
        distinctLegalNames: new Set(party.legalName ? [party.legalName.trim().toUpperCase()] : []),
      });
    }
  }

  // Indice nome normalizzato -> chiavi di gruppo, per rilevare collisioni
  // cross-gruppo (stesso nome societario sotto P.IVA/CF diversi - possibile
  // typo/OCR su uno dei due, non necessariamente due entita' reali diverse).
  const nameToKeys = new Map<string, Set<string>>();
  for (const [key, group] of groups.entries()) {
    const normalized = normalizeCompanyName(group.party.legalName);
    if (!normalized) continue;
    if (!nameToKeys.has(normalized)) nameToKeys.set(normalized, new Set());
    nameToKeys.get(normalized)!.add(key);
  }

  const proposals: CounterpartyProposal[] = [];

  for (const [key, group] of groups.entries()) {
    const resolution = await resolveCounterparty(group.party, repo);
    const vat = normalizeVat(group.party.vatNumber);

    let proposedAction: CounterpartyProposalAction;
    let confidence: "high" | "medium" | "low";
    let reason: string;

    if (resolution.status === "matched") {
      proposedAction = "existing_match";
      confidence = "high";
      reason = `Gia' presente in counterparties, risolto via ${resolution.matchMethod} - nessuna azione necessaria.`;
    } else if (resolution.status === "proposed") {
      proposedAction = "enrich_placeholder";
      confidence = "medium";
      reason = `Nome normalizzato corrisponde alla counterparty placeholder "${resolution.matchedCounterpartyDisplayName}" (${resolution.matchedCounterpartyId}) - nessuna P.IVA/CF a conferma, verificare manualmente prima di arricchire.`;
    } else if (resolution.status === "ambiguous") {
      proposedAction = "review";
      confidence = "low";
      reason = "Piu' di una counterparty candidata - collisione, richiede revisione manuale, mai un merge automatico.";
    } else {
      // unresolved: applica il criterio SAFE TO CREATE vs REVIEW
      const vatValid = isValidItalianVat(vat);
      const cfValid = isValidItalianFiscalCode(group.party.fiscalCode);
      const dataCoherent = group.distinctLegalNames.size <= 1; // stessa identita' fiscale, stesso nome su tutti i documenti del gruppo
      const nameCollisionKeys = normalizeCompanyName(group.party.legalName)
        ? [...(nameToKeys.get(normalizeCompanyName(group.party.legalName)!) ?? [])].filter((k) => k !== key)
        : [];
      const hasCollision = nameCollisionKeys.length > 0;

      if (!dataCoherent) {
        proposedAction = "review";
        confidence = "low";
        reason = `Dati fiscali discordanti: la stessa identita' fiscale compare con ${group.distinctLegalNames.size} ragioni sociali diverse nel batch (${[...group.distinctLegalNames].join(" / ")}) - richiede verifica manuale.`;
      } else if (hasCollision) {
        proposedAction = "review";
        confidence = "low";
        reason = `Collisione: la ragione sociale normalizzata corrisponde anche ad almeno un'altra identita' fiscale distinta nel batch (P.IVA/CF diversi) - possibile errore di trascrizione, richiede verifica manuale.`;
      } else if (vatValid) {
        proposedAction = "safe_to_create";
        confidence = "high";
        reason = `P.IVA ${group.party.vatNumber} valida (checksum verificato), identita' univoca nel batch, nessuna collisione - nessun match esistente in counterparties.`;
      } else if (cfValid) {
        proposedAction = "safe_to_create";
        confidence = "high";
        reason = `Nessuna P.IVA (persona fisica), Codice Fiscale ${group.party.fiscalCode} valido (checksum verificato), identita' univoca nel batch, nessuna collisione - nessun match esistente in counterparties.`;
      } else {
        proposedAction = "review";
        confidence = "low";
        reason = vat || group.party.fiscalCode
          ? `Identificativo anomalo: ${vat ? `P.IVA "${group.party.vatNumber}"` : `Codice Fiscale "${group.party.fiscalCode}"`} non supera il controllo di validita' (checksum) - possibile errore di trascrizione/OCR, richiede verifica manuale.`
          : "Nessun identificativo (P.IVA o Codice Fiscale) presente - identita' dubbia, richiede verifica manuale prima di creare qualunque record.";
      }
    }

    proposals.push({
      legalName: group.party.legalName,
      vatNumber: vat,
      fiscalCode: group.party.fiscalCode,
      country: "IT",
      documentCount: group.documentCount,
      netAmount: group.netAmount,
      grossAmount: group.grossAmount,
      existingMatchId: resolution.matchedCounterpartyId,
      existingMatchDisplayName: resolution.matchedCounterpartyDisplayName,
      existingMatchMethod: resolution.matchMethod !== "none" ? resolution.matchMethod : null,
      proposedAction,
      confidence,
      reason,
    });
  }

  return proposals.sort((a, b) => b.netAmount - a.netAmount);
}

import type { CounterpartyResolutionResult, PartyInfo } from "./types";

export type CounterpartyRecord = {
  id: string;
  displayName: string;
  legalName: string | null;
  vatNumber: string | null;
  fiscalCode: string | null;
  crmClientId: string | null;
};

// Interfaccia minima per il data access - permette test unitari con un
// repository in-memory, senza toccare Supabase. L'implementazione reale
// (Supabase) vive altrove e non e' parte di questo modulo puro.
export interface CounterpartyRepository {
  findByVatNumber(vat: string): Promise<CounterpartyRecord[]>;
  findByFiscalCode(cf: string): Promise<CounterpartyRecord[]>;
  // Risolve via crm_clients.vat_number -> counterparties collegate tramite
  // crm_client_id, per il caso in cui la P.IVA sia nota in CRM ma non
  // ancora allineata su counterparties.vat_number.
  findByCrmClientVatNumber(vat: string): Promise<CounterpartyRecord[]>;
  findAll(): Promise<CounterpartyRecord[]>;
}

// counterparties.vat_number nel database e' salvata SENZA prefisso paese
// (es. "01430150746"), ma il campo IdFiscaleIVA di FatturaPA e' sempre
// IdPaese+IdCodice (es. "IT01430150746") - verificato sul batch reale 2025
// (bug trovato: senza questo strip, Cantine Due Palme risultava
// "unresolved" nonostante la P.IVA fosse identica). Rimuove un prefisso
// alfabetico di 2 lettere (codice paese ISO) SOLO se seguito da sole
// cifre - assume controparti italiane, limite dichiarato: una P.IVA
// estera con struttura "2 lettere + solo cifre" verrebbe normalizzata
// allo stesso modo, da rivedere se/quando compariranno controparti non
// italiane nel batch.
export function normalizeVat(vat: string | null): string | null {
  if (!vat) return null;
  const stripped = vat.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const withoutCountryPrefix = stripped.match(/^[A-Z]{2}(\d+)$/);
  return withoutCountryPrefix ? withoutCountryPrefix[1] : stripped;
}

function normalizeFiscalCode(cf: string | null): string | null {
  if (!cf) return null;
  return cf.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

// Forme societarie da scorporare - SEMPRE senza punteggiatura: il
// confronto avviene dopo che la punteggiatura e' gia' stata rimossa dal
// nome in ingresso, quindi un suffisso scritto con punti/apostrofi qui non
// combacerebbe mai (bug reale trovato e corretto in fase di test: "S.R.L."
// nella lista non intercettava mai "SRL" dopo la normalizzazione).
const LEGAL_FORM_SUFFIXES = ["SOCIETA COOPERATIVA", "SOC COOP", "SRL", "SPA", "SNC", "SAS", "DI"];

// Normalizzazione debole per il fallback sul nome: maiuscolo, punteggiatura
// rimossa (non sostituita con spazio: "S.R.L." -> "SRL", non "S R L"),
// forme societarie comuni scorporate per parola intera, spazi multipli
// collassati. Serve solo a produrre un match "proposed" (mai "matched") -
// un nome uguale non e' prova di identita' fiscale quanto una P.IVA/CF.
export function normalizeCompanyName(name: string | null): string | null {
  if (!name) return null;
  let normalized = name.toUpperCase().replace(/[.,'"()]/g, "");
  for (const suffix of LEGAL_FORM_SUFFIXES) {
    normalized = normalized.replace(new RegExp(`\\b${suffix}\\b`, "g"), " ");
  }
  return normalized.replace(/\s+/g, " ").trim();
}

export async function resolveCounterparty(
  party: PartyInfo,
  repo: CounterpartyRepository
): Promise<CounterpartyResolutionResult> {
  const vat = normalizeVat(party.vatNumber);
  const cf = normalizeFiscalCode(party.fiscalCode);

  // 1. VAT exact
  if (vat) {
    const byVat = await repo.findByVatNumber(vat);
    if (byVat.length === 1) {
      return matched(byVat[0], "vat_exact", `P.IVA ${party.vatNumber} corrisponde esattamente a counterparty esistente.`);
    }
    if (byVat.length > 1) {
      return ambiguous(byVat, `Piu' di una counterparty condivide la P.IVA ${party.vatNumber} - non dovrebbe accadere dato il vincolo UNIQUE, segnalare per verifica dati.`);
    }
  }

  // 2. Fiscal code exact
  if (cf) {
    const byCf = await repo.findByFiscalCode(cf);
    if (byCf.length === 1) {
      return matched(byCf[0], "fiscal_code_exact", `Codice Fiscale ${party.fiscalCode} corrisponde esattamente a counterparty esistente.`);
    }
    if (byCf.length > 1) {
      return ambiguous(byCf, `Piu' di una counterparty condivide il Codice Fiscale ${party.fiscalCode}.`);
    }
  }

  // 3. Relazione CRM: P.IVA nota in crm_clients ma non ancora allineata su counterparties.vat_number
  if (vat) {
    const byCrmVat = await repo.findByCrmClientVatNumber(vat);
    if (byCrmVat.length === 1) {
      return matched(byCrmVat[0], "crm_relation", `P.IVA ${party.vatNumber} trovata su crm_clients, risolta alla counterparty collegata (vat_number non ancora allineato su counterparties).`);
    }
    if (byCrmVat.length > 1) {
      return ambiguous(byCrmVat, `Piu' di una counterparty risulta collegata via CRM alla P.IVA ${party.vatNumber}.`);
    }
  }

  // 4. Nome normalizzato - fallback debole, produce sempre "proposed", mai "matched"
  const normalizedIncoming = normalizeCompanyName(party.legalName);
  if (normalizedIncoming) {
    const all = await repo.findAll();
    const nameMatches = all.filter((c) => {
      const candidateNames = [normalizeCompanyName(c.legalName), normalizeCompanyName(c.displayName)];
      return candidateNames.includes(normalizedIncoming);
    });
    if (nameMatches.length === 1) {
      return {
        status: "proposed",
        matchMethod: "normalized_name",
        matchedCounterpartyId: nameMatches[0].id,
        matchedCounterpartyDisplayName: nameMatches[0].displayName,
        ambiguousCandidateIds: [],
        proposedNewCounterparty: null,
        notes: `Nome normalizzato "${normalizedIncoming}" corrisponde a counterparty esistente - nessuna P.IVA/CF a conferma, richiede verifica manuale prima di considerarlo un match certo.`,
      };
    }
    if (nameMatches.length > 1) {
      return ambiguous(nameMatches, `Nome normalizzato "${normalizedIncoming}" corrisponde a piu' di una counterparty.`);
    }
  }

  // 5. Unresolved
  return {
    status: "unresolved",
    matchMethod: "none",
    matchedCounterpartyId: null,
    matchedCounterpartyDisplayName: null,
    ambiguousCandidateIds: [],
    proposedNewCounterparty: party,
    notes: "Nessun match su P.IVA, Codice Fiscale, relazione CRM o nome normalizzato - counterparty non creata (dry-run), proposta riportata per revisione.",
  };
}

function matched(record: CounterpartyRecord, method: "vat_exact" | "fiscal_code_exact" | "crm_relation", notes: string): CounterpartyResolutionResult {
  return {
    status: "matched",
    matchMethod: method,
    matchedCounterpartyId: record.id,
    matchedCounterpartyDisplayName: record.displayName,
    ambiguousCandidateIds: [],
    proposedNewCounterparty: null,
    notes,
  };
}

function ambiguous(records: CounterpartyRecord[], notes: string): CounterpartyResolutionResult {
  return {
    status: "ambiguous",
    matchMethod: "none",
    matchedCounterpartyId: null,
    matchedCounterpartyDisplayName: null,
    ambiguousCandidateIds: records.map((r) => r.id),
    proposedNewCounterparty: null,
    notes,
  };
}

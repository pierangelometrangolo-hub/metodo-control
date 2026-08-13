export type CrmClientStatus = "prospect" | "attivo" | "ex_cliente";
export type CrmContractStatus = "attivo" | "non_definito" | "scaduto" | "disdetto";
export type CrmBadgeStatus = "attivo" | "da_definire" | "prospect" | "ex_cliente";
export type CrmCommissionType = "percentuale" | "fisso_piu_override";

// Riga di v_crm_clients_badge - badge_status e' sempre calcolato li', mai
// ricalcolato lato componente (stessa logica gia' centralizzata nella view
// per evitare duplicazioni, come per computePacingStatus in Performance).
export type CrmClient = {
  id: string;
  business_name: string;
  vat_number: string | null;
  fiscal_code: string | null;
  address: string | null;
  postal_code: string | null;
  sdi_code: string | null;
  pec: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  is_consulenza: boolean;
  is_formazione: boolean;
  is_eventi: boolean;
  is_fornitore: boolean;
  status: CrmClientStatus;
  assigned_consultant_id: string | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  contract_status: CrmContractStatus | null;
  contract_notice_months: number | null;
  contract_document_url: string | null;
  structure_id: string | null;
  source_event: string | null;
  acquired_at: string | null;
  cin: string | null;
  cis: string | null;
  notes: string | null;
  commission_type: CrmCommissionType | null;
  commission_percentage: number | null;
  commission_fixed_amount: number | null;
  commission_fixed_months: number | null;
  commission_override_percentage: number | null;
  commission_override_threshold: number | null;
  created_at: string;
  updated_at: string;
  badge_status: CrmBadgeStatus;
};

export type CrmContact = {
  id: string;
  client_id: string;
  name: string;
  role: string;
  phone: string | null;
  email: string | null;
  created_at: string;
};

export const badgeStatusLabels: Record<CrmBadgeStatus, string> = {
  attivo: "Attivo",
  da_definire: "Da definire",
  prospect: "Prospect",
  ex_cliente: "Ex cliente",
};

// Mappa sulle varianti gia' esistenti in AppBadge.tsx (verde/giallo/grigio)
// - nessuna nuova variante introdotta.
export const badgeStatusVariant: Record<CrmBadgeStatus, "success" | "warning" | "neutral"> = {
  attivo: "success",
  da_definire: "warning",
  prospect: "neutral",
  ex_cliente: "neutral",
};

export const contractStatusLabels: Record<CrmContractStatus, string> = {
  attivo: "Attivo",
  non_definito: "Da definire",
  scaduto: "Scaduto",
  disdetto: "Disdetto",
};

// Etichette dei tre tipi indipendenti (checkbox multiple, non piu' un
// enum singolo). "Eventi" e' il nuovo nome di cio' che a DB/nel codice
// storico si chiamava PDO - nessun riferimento a "PDO" resta in UI.
export const typeFlagLabels = {
  is_consulenza: "Consulenza",
  is_formazione: "Formazione",
  is_eventi: "Eventi",
} as const;

export type TypeFlagKey = keyof typeof typeFlagLabels;

// Etichette dei tipi di un cliente, in ordine fisso Consulenza/Formazione/
// Eventi, per badge e sottotitoli nell'elenco e nel dettaglio.
export function clientTypeLabels(client: Pick<CrmClient, "is_consulenza" | "is_formazione" | "is_eventi">): string {
  const labels: string[] = [];
  if (client.is_consulenza) labels.push(typeFlagLabels.is_consulenza);
  if (client.is_formazione) labels.push(typeFlagLabels.is_formazione);
  if (client.is_eventi) labels.push(typeFlagLabels.is_eventi);
  return labels.join(" · ") || "ND";
}

// Iniziali per l'avatar: prime lettere delle prime due parole del nome
// business, o le prime due lettere se una sola parola.
export function clientInitials(businessName: string): string {
  const words = businessName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// "Nome C." - stessa convenzione gia' in uso per owner_display_name in
// Operations/subtasks (v_subtasks_detailed: nome + iniziale cognome + '.').
export function consultantDisplayName(
  consultantId: string | null,
  profilesById: Map<string, { nome?: string | null; cognome?: string | null }>
): string {
  if (!consultantId) return "ND";
  const profile = profilesById.get(consultantId);
  if (!profile || !profile.nome) return "ND";
  const cognomeIniziale = profile.cognome ? `${profile.cognome.trim().slice(0, 1)}.` : "";
  return [profile.nome.trim(), cognomeIniziale].filter(Boolean).join(" ");
}

// "In scadenza nei prossimi N mesi": solo contract_end_date, senza
// contract_notice_months (confermato con Pierangelo prima di implementare
// - notice_months resta un dato mostrato nel dettaglio contratto, non
// influenza questo conteggio).
export function isExpiringWithinMonths(
  contractEndDate: string | null,
  months: number,
  today: Date = new Date()
): boolean {
  if (!contractEndDate) return false;

  const [y, m, d] = contractEndDate.split("-").map(Number);
  const end = Date.UTC(y, m - 1, d);

  const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const limit = new Date(todayUTC);
  limit.setUTCMonth(limit.getUTCMonth() + months);

  return end >= todayUTC && end <= limit.getTime();
}

// Testo esplicativo del blocco commissioni per il tipo "fisso_piu_override"
// - solo termini contrattuali salvati, nessun calcolo su un fatturato reale
// (quel collegamento e' del futuro modulo Finance).
export function commissionFixedOverrideText(client: CrmClient): string {
  const fixed = client.commission_fixed_amount ?? 0;
  const months = client.commission_fixed_months ?? 0;
  const overridePct = client.commission_override_percentage ?? 0;
  const threshold = client.commission_override_threshold ?? 0;
  return `€${fixed}/mese per ${months} mesi, poi ${overridePct}% oltre €${threshold} di consuntivo`;
}

export type CrmClientType = "consulenza" | "formazione" | "pdo";
export type CrmClientStatus = "prospect" | "attivo" | "ex_cliente";
export type CrmContractStatus = "attivo" | "non_definito" | "scaduto" | "disdetto";
export type CrmBadgeStatus = "attivo" | "da_definire" | "prospect" | "ex_cliente";

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
  client_type: CrmClientType;
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

export const clientTypeLabels: Record<CrmClientType, string> = {
  consulenza: "Consulenza",
  formazione: "Formazione",
  pdo: "PDO",
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

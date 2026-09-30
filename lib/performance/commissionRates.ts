// Scrittura channel_commission_rates senza sovrascritture silenziose:
// la chiave (structure_id, channel, period_year, period_month) e' UNIQUE,
// e un valore gia' presente viene sostituito solo dopo conferma esplicita.

export type CommissionSource = "fattura" | "stima";

export type ExistingCommissionRate = {
  commission_pct: number | string;
  source: CommissionSource;
  source_reference: string | null;
};

export type CommissionWriteDecision =
  | { action: "insert" }
  | { action: "unchanged" }
  | { action: "confirm_replace"; existing: ExistingCommissionRate };

// Percentuale salvata con 2 decimali (stesso arrotondamento gia' in uso nel form).
export function roundCommissionPct(pct: number): number {
  return Math.round(pct * 100) / 100;
}

export function decideCommissionWrite(
  existing: ExistingCommissionRate | null,
  candidate: { commissionPct: number; source: CommissionSource }
): CommissionWriteDecision {
  if (existing === null) return { action: "insert" };
  const samePct = roundCommissionPct(Number(existing.commission_pct)) === roundCommissionPct(candidate.commissionPct);
  if (samePct && existing.source === candidate.source) return { action: "unchanged" };
  return { action: "confirm_replace", existing };
}

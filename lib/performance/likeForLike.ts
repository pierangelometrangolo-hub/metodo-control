import { deltaPercent } from "../performanceMetrics";

// Intervallo di appartenenza al portfolio Metodo di una struttura, da
// consulting_engagements (valid_from/valid_to, null = aperto). Una
// struttura puo' avere piu' engagement nel tempo.
export type PortfolioMembership = {
  structure_id: string;
  valid_from: string | null;
  valid_to: string | null;
};

export type DateRange = { start: string; end: string };

export type LikeForLikeStructureInput = {
  id: string;
  name: string;
  actual: number | null;
  reference: number | null;
};

export type LikeForLikeExclusionReason =
  | "not_in_previous_portfolio"
  | "not_in_current_portfolio"
  | "missing_current_data"
  | "missing_reference_data";

export const likeForLikeReasonLabels: Record<LikeForLikeExclusionReason, string> = {
  not_in_previous_portfolio: "non presente nel portfolio anno precedente",
  not_in_current_portfolio: "non presente nel portfolio anno corrente",
  missing_current_data: "dati del periodo corrente non disponibili",
  missing_reference_data: "dato di confronto non disponibile",
};

export type LikeForLikeComparison = {
  total: number;
  included: { id: string; name: string }[];
  excluded: { id: string; name: string; reasons: LikeForLikeExclusionReason[] }[];
  // null se nessuna struttura e' comparabile: mai un totale 0 inventato.
  actual: number | null;
  reference: number | null;
  variancePct: number | null;
};

// "YYYY-MM-DD" confronta correttamente anche come stringa.
export function isPortfolioMember(
  memberships: PortfolioMembership[],
  structureId: string,
  period: DateRange
): boolean {
  return memberships.some(
    (m) =>
      m.structure_id === structureId &&
      (m.valid_from === null || m.valid_from <= period.end) &&
      (m.valid_to === null || m.valid_to >= period.start)
  );
}

export function fullYear(year: number): DateRange {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

// Confronto like-for-like: la POPOLAZIONE e' determinata dalla membership
// del portfolio nei due ANNI confrontati (engagement che interseca 01/01 -
// 31/12 di ciascun anno), non dalla semplice presenza di dati storici e
// non dal singolo mese visualizzato - es. engagement iniziato a novembre
// 2025 = struttura nel portfolio 2025, quindi inclusa anche nel confronto
// settembre 2026 vs settembre 2025. I DATI confrontati (actual/reference)
// restano quelli del periodo selezionato, gia' calcolati dal chiamante.
// Una struttura comparabile per membership ma senza il dato (corrente o di
// confronto) resta comunque fuori: dato mancante non e' zero.
export function computeLikeForLike(
  structures: LikeForLikeStructureInput[],
  memberships: PortfolioMembership[],
  currentYear: number,
  previousYear: number
): LikeForLikeComparison {
  const currentPeriod = fullYear(currentYear);
  const previousPeriod = fullYear(previousYear);
  const included: LikeForLikeComparison["included"] = [];
  const excluded: LikeForLikeComparison["excluded"] = [];
  let actual = 0;
  let reference = 0;

  structures.forEach((s) => {
    const reasons: LikeForLikeExclusionReason[] = [];
    if (!isPortfolioMember(memberships, s.id, previousPeriod)) reasons.push("not_in_previous_portfolio");
    if (!isPortfolioMember(memberships, s.id, currentPeriod)) reasons.push("not_in_current_portfolio");
    if (reasons.length === 0) {
      if (s.actual === null) reasons.push("missing_current_data");
      if (s.reference === null) reasons.push("missing_reference_data");
    }

    if (reasons.length > 0) {
      excluded.push({ id: s.id, name: s.name, reasons });
      return;
    }

    included.push({ id: s.id, name: s.name });
    actual += s.actual as number;
    reference += s.reference as number;
  });

  return {
    total: structures.length,
    included,
    excluded,
    actual: included.length > 0 ? actual : null,
    reference: included.length > 0 ? reference : null,
    variancePct: included.length > 0 ? deltaPercent(actual, reference) : null,
  };
}

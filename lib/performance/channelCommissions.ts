// ============ Commissioni per canale su periodi multi-mese ============
//
// channel_commission_rates ha granularita' (struttura, canale, anno, mese):
// la commissione di un periodo e' la SOMMA delle commissioni mensili,
// ciascuna calcolata col revenue lordo di quel mese e la tariffa di quel
// mese - mai una sola tariffa (primo/ultimo mese, media) applicata al
// totale. I mesi con revenue ma senza tariffa restano "scoperti": nessuna
// commissione inventata, il loro lordo e' tenuto separato (uncoveredGross).

export type ChannelRevenueMonthInput = {
  channel: string;
  // Giorno di soggiorno della riga channel_revenue (period_start, YYYY-MM-DD).
  stayDate: string;
  revenueGross: number;
};

export type CommissionRateInput = {
  channel: string;
  year: number;
  month: number;
  pct: number;
  source: "fattura" | "stima";
  sourceReference: string | null;
};

export type CommissionCoverage = "full" | "partial" | "none";

export type ChannelCommissionSummary = {
  gross: number;
  // Lordo dei soli mesi con tariffa nota, e relativa commissione.
  coveredGross: number;
  commission: number;
  // Lordo dei mesi con revenue ma senza tariffa: mai commissionato.
  uncoveredGross: number;
  // commission / coveredGross, in punti percentuali; null se coveredGross <= 0.
  effectivePct: number | null;
  monthsWithRevenue: number;
  monthsCovered: number;
  coverage: CommissionCoverage;
  // Almeno un mese coperto con tariffa "stima" (non da fattura).
  hasEstimate: boolean;
  // Riferimenti delle tariffe usate (dedup), per il tooltip "Stima".
  sourceReferences: string[];
};

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function summarizeChannelCommissions(
  revenueRows: ChannelRevenueMonthInput[],
  rates: CommissionRateInput[]
): Map<string, ChannelCommissionSummary> {
  const rateByChannelMonth = new Map<string, CommissionRateInput>();
  for (const r of rates) rateByChannelMonth.set(`${r.channel}|${monthKey(r.year, r.month)}`, r);

  // channel -> mese -> lordo del mese
  const grossByChannelMonth = new Map<string, Map<string, number>>();
  for (const row of revenueRows) {
    const byMonth = grossByChannelMonth.get(row.channel) ?? new Map<string, number>();
    const key = row.stayDate.slice(0, 7);
    byMonth.set(key, (byMonth.get(key) ?? 0) + Number(row.revenueGross));
    grossByChannelMonth.set(row.channel, byMonth);
  }

  const result = new Map<string, ChannelCommissionSummary>();
  for (const [channel, byMonth] of grossByChannelMonth) {
    let gross = 0;
    let coveredGross = 0;
    let commission = 0;
    let uncoveredGross = 0;
    let monthsWithRevenue = 0;
    let monthsCovered = 0;
    let hasEstimate = false;
    const refs = new Set<string>();

    for (const [month, monthGross] of byMonth) {
      gross += monthGross;
      if (monthGross === 0) continue;
      monthsWithRevenue += 1;
      const rate = rateByChannelMonth.get(`${channel}|${month}`);
      if (rate && Number.isFinite(rate.pct)) {
        monthsCovered += 1;
        coveredGross += monthGross;
        commission += monthGross * (rate.pct / 100);
        if (rate.source === "stima") hasEstimate = true;
        if (rate.sourceReference) refs.add(rate.sourceReference);
      } else {
        uncoveredGross += monthGross;
      }
    }

    const coverage: CommissionCoverage =
      monthsCovered === 0 ? "none" : monthsCovered === monthsWithRevenue ? "full" : "partial";

    result.set(channel, {
      gross,
      coveredGross,
      commission,
      uncoveredGross,
      effectivePct: coveredGross > 0 ? (commission / coveredGross) * 100 : null,
      monthsWithRevenue,
      monthsCovered,
      coverage,
      hasEstimate,
      sourceReferences: [...refs],
    });
  }
  return result;
}

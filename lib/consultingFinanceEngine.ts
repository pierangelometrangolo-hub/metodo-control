// Calculation engine puro per Consulting Revenue Control (Finance).
//
// Nessuna di queste funzioni interroga Supabase: ricevono solo valori gia'
// risolti come input e restituiscono un risultato o un esito esplicito
// "missing_data" - mai un numero silenziosamente sbagliato quando manca un
// dato. Il data access layer (query a Performance/consulting_fee_rules/
// consulting_fee_basis_values) e' un livello separato, non ancora
// collegato a queste funzioni.

export type FeeComponentResult =
  | { status: "ok"; value: number }
  | { status: "missing_data"; reason: string };

// --- Fee percentuale sulla revenue (o base commissionabile) --------------
//
// baseAmount e' gia' la base corretta per la struttura (revenue MC per la
// maggior parte delle strutture, revenue - TAG per Palazzo Rollo) - questa
// funzione non sa nulla di calculation_basis, quella scelta avviene nel
// data access layer prima di chiamarla.
export function calculatePercentageFee(baseAmount: number | null, feePct: number | null): FeeComponentResult {
  if (baseAmount === null) return { status: "missing_data", reason: "base_amount_missing" };
  if (feePct === null) return { status: "missing_data", reason: "fee_pct_missing" };
  return { status: "ok", value: baseAmount * (feePct / 100) };
}

// --- Componente fissa da consulting_fee_schedule --------------------------
//
// scheduledAmount e' l'importo del mese di competenza gia' letto dal
// calendario (consulting_fee_schedule.fixed_amount) - null se il mese non
// ha una riga in calendario (mai assumere 0 al posto di un dato mancante).
export function calculateFixedFee(scheduledAmount: number | null): FeeComponentResult {
  if (scheduledAmount === null) return { status: "missing_data", reason: "fee_schedule_missing" };
  return { status: "ok", value: scheduledAmount };
}

// --- Overcommission sulla sola eccedenza oltre soglia ----------------------
//
// MAX(baseAmount - threshold, 0) x percentage/100. baseAmount qui e' la
// metrica cumulativa (YTD o annuale) su cui si applica la soglia - per
// Montecallini/Sangiorgio e' Room & Breakfast Revenue, metrica che
// Performance non possiede: se il chiamante non ha un baseAmount
// affidabile, DEVE passare null, mai stimarlo da revenue_total.
export function calculateExcessOvercommission(
  baseAmount: number | null,
  threshold: number | null,
  percentage: number | null
): FeeComponentResult {
  if (baseAmount === null) return { status: "missing_data", reason: "overcommission_base_missing" };
  if (threshold === null) return { status: "missing_data", reason: "overcommission_threshold_missing" };
  if (percentage === null) return { status: "missing_data", reason: "overcommission_pct_missing" };
  return { status: "ok", value: Math.max(baseAmount - threshold, 0) * (percentage / 100) };
}

// --- Overcommission incrementale mese su mese ------------------------------
//
// L'overcommission si applica sempre alla base cumulativa dell'anno (mai a
// una quota mensile della soglia - la soglia non va MAI divisa per 12).
// Per sapere quanto overcommission "matura" in un singolo mese si calcola
// la cumulativa a fine mese corrente meno la cumulativa a fine mese
// precedente - mai un calcolo mensile indipendente, altrimenti si
// duplicherebbe l'eccedenza in ogni mese successivo al superamento soglia.
export function calculateIncrementalOvercommission(
  currentCumulativeBase: number | null,
  previousCumulativeBase: number | null,
  threshold: number | null,
  percentage: number | null
): FeeComponentResult {
  const current = calculateExcessOvercommission(currentCumulativeBase, threshold, percentage);
  if (current.status === "missing_data") return current;

  // Nessun mese precedente (es. gennaio): l'incrementale coincide con la
  // cumulativa del mese stesso, non e' un dato mancante.
  if (previousCumulativeBase === null) return current;

  const previous = calculateExcessOvercommission(previousCumulativeBase, threshold, percentage);
  if (previous.status === "missing_data") return previous;

  return { status: "ok", value: current.value - previous.value };
}

// --- Overcommission sul totale (application: total_revenue) ---------------
//
// Alternativa a calculateExcessOvercommission per
// overcommission_application = "total_revenue": percentuale sull'intera
// base, non solo sull'eccedenza. Nessuna regola attuale la usa (tutte
// "excess_only"), ma il campo esiste in consulting_fee_rules quindi la
// implementiamo separata per evitare un ramo if nascosto dentro
// calculateExcessOvercommission.
export function calculateTotalBaseOvercommission(baseAmount: number | null, percentage: number | null): FeeComponentResult {
  if (baseAmount === null) return { status: "missing_data", reason: "overcommission_base_missing" };
  if (percentage === null) return { status: "missing_data", reason: "overcommission_pct_missing" };
  return { status: "ok", value: baseAmount * (percentage / 100) };
}

// --- Quota Giorgia (teorica o maturata, a seconda del feeAmount passato) --
//
// Stessa funzione per entrambe le letture richieste dalla spec:
//   teorica  = calculateConsultantShare(expectedGapFee, consultant_pct)
//   maturata = calculateConsultantShare(actualGapFee, consultant_pct)
// La distinzione e' tutta nel valore passato come feeAmount, non qui.
export function calculateConsultantShare(feeAmount: number | null, consultantPct: number | null): FeeComponentResult {
  if (feeAmount === null) return { status: "missing_data", reason: "fee_amount_missing" };
  if (consultantPct === null) return { status: "missing_data", reason: "consultant_pct_missing" };
  return { status: "ok", value: feeAmount * (consultantPct / 100) };
}

// --- Delta actual vs expected ---------------------------------------------
export type DeltaResult =
  | { status: "ok"; delta: number; deltaPct: number | null }
  | { status: "missing_data"; reason: string };

export function calculateDelta(actual: number | null, expected: number | null): DeltaResult {
  if (actual === null) return { status: "missing_data", reason: "actual_missing" };
  if (expected === null) return { status: "missing_data", reason: "expected_missing" };
  const delta = actual - expected;
  const deltaPct = expected !== 0 ? delta / expected : null;
  return { status: "ok", delta, deltaPct };
}

// --- Somma di componenti fee eventualmente parziali ------------------------
//
// Per fee_model = fixed_plus_overcommission: la componente fissa puo'
// essere "ok" mentre l'overcommission e' "missing_data" (es. R&B Revenue
// futuro non disponibile) - la spec impone di NON bloccare l'intero
// record in quel caso. Questa funzione somma solo i componenti "ok" e
// riporta esplicitamente quali sono mancanti, senza inventare uno zero al
// posto del componente mancante.
export type CombinedFeeResult = {
  total: number | null; // null se ANCHE la componente fissa manca - altrimenti somma dei soli componenti "ok"
  components: Record<string, FeeComponentResult>;
  hasMissingData: boolean;
};

export function combineFeeComponents(components: Record<string, FeeComponentResult>): CombinedFeeResult {
  let total: number | null = null;
  let hasMissingData = false;

  for (const key of Object.keys(components)) {
    const c = components[key];
    if (c.status === "missing_data") {
      hasMissingData = true;
      continue;
    }
    total = (total ?? 0) + c.value;
  }

  return { total, components, hasMissingData };
}

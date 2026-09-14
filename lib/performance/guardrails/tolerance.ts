// ============ Performance Guardrails V0 — tolleranza coerenza KPI ============
//
// Un'unica politica di tolleranza per TUTTI i confronti "KPI ricalcolato vs
// KPI dichiarato dalla fonte", cosi' non convivono regimi diversi (l'audit
// ha rilevato che Booking Designer usava max(0,50, 1%) mentre il parser
// Montecallini usava 1% secco - troppo stretto sui valori piccoli).
//
//   scarto ammesso = max( floor assoluto, |dichiarato| * 1% )
//
// - KPI in valuta (RevPAR, ADR): floor 0,50 (mezzo euro)
// - KPI in frazione (Occupancy 0..1): floor 0,005 (mezzo punto percentuale)

export const RELATIVE_TOLERANCE = 0.01;
export const CURRENCY_ABS_TOLERANCE = 0.5;
export const FRACTION_ABS_TOLERANCE = 0.005;

function within(computed: number, declared: number, absFloor: number): boolean {
  const allowed = Math.max(absFloor, Math.abs(declared) * RELATIVE_TOLERANCE);
  return Math.abs(computed - declared) <= allowed;
}

export function currencyWithinTolerance(computed: number, declared: number): boolean {
  return within(computed, declared, CURRENCY_ABS_TOLERANCE);
}

export function fractionWithinTolerance(computed: number, declared: number): boolean {
  return within(computed, declared, FRACTION_ABS_TOLERANCE);
}

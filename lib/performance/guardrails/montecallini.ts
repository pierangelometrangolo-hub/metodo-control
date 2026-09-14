// ============ Performance Guardrails V0 — Montecallini (PlanningForecast) ============
//
// Guardrails V0 shadow mode — no enforcement.
//
// GR-MC-REV01: coerenza RevPAR.
//   RevPAR ricalcolato = revenue_total / rooms_available (da CV, dinamico)
//   vs RPAR dichiarato dalla fonte (row.sourceKpi.revpar).
//
// Il parser Montecallini controlla gia' ADR e OCCUP; questo aggiunge il
// terzo riscontro (RevPAR), allineando il dataset a Booking Designer.
// Resta WARNING: coerente con la policy "Montecallini non blocca sulle
// coerenze KPI".
//
// No-op quando l'RPAR e' assente / non interpretabile / rooms_available = 0.
//
// Il runner viene invocato UNA VOLTA PER KIND (cy/sdly/ly) da importService,
// quindi qui non c'e' bisogno di distinguere il kind.

import { guardrailMeta } from "./registry";
import { currencyWithinTolerance } from "./tolerance";
import type { GuardrailFinding, GuardrailSnapshotRow } from "./types";

export function runMontecalliniGuardrails(rows: readonly GuardrailSnapshotRow[]): GuardrailFinding[] {
  const meta = guardrailMeta("GR-MC-REV01");
  const severity = meta?.defaultSeverity ?? "warning";

  const out: GuardrailFinding[] = [];
  for (const row of rows) {
    const declared = row.sourceKpi?.revpar;
    if (declared === undefined || declared === null) continue; // RPAR assente -> no-op
    if (row.roomsAvailable <= 0) continue;

    const computed = row.revenueTotal / row.roomsAvailable;
    if (currencyWithinTolerance(computed, declared)) continue;

    out.push({
      id: "GR-MC-REV01",
      dataset: "montecallini_pms",
      severity,
      scope: "row",
      stayDate: row.stayDate,
      nationality: null,
      message: `Giorno ${row.stayDate}: RevPAR ricalcolato ${computed.toFixed(2)} (revenue/${row.roomsAvailable}) diverso dall'RPAR dichiarato dalla fonte ${declared.toFixed(2)} - possibile errore di lettura colonne.`,
      context: { computedRevpar: computed, declaredRevpar: declared, roomsAvailable: row.roomsAvailable },
    });
  }
  return out;
}

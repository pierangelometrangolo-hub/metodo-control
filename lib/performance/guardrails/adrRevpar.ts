// ============ Performance Guardrails V0 — Booking Designer (ADR/RevPAR) ============
//
// Guardrails V0 shadow mode — no enforcement.
//
// GR-ADR-OCC01: coerenza Occupancy.
//   Occupancy ricalcolata = rooms_sold / rooms_available (entrambi gia'
//   validati) vs IMO dichiarato dalla fonte (row.sourceKpi.occupancyFraction,
//   gia' normalizzato a frazione 0..1 dal parser).
//
// SEPARATO dal voto di coerenza Revenue del parser (evaluateRevenueConsistency):
// l'Occupancy NON viene aggiunta a quel voto e NON valida il Revenue - e'
// una relazione fra rooms_sold e rooms_available, indipendente dal ricavo.
//
// No-op quando l'IMO e' assente / non interpretabile / il denominatore e'
// zero: un riferimento mancante non e' mai una prova di anomalia.

import { guardrailMeta } from "./registry";
import { fractionWithinTolerance } from "./tolerance";
import type { GuardrailFinding, GuardrailSnapshotRow } from "./types";

export function runAdrRevparGuardrails(rows: readonly GuardrailSnapshotRow[]): GuardrailFinding[] {
  const meta = guardrailMeta("GR-ADR-OCC01");
  const severity = meta?.defaultSeverity ?? "warning";

  const out: GuardrailFinding[] = [];
  for (const row of rows) {
    const declared = row.sourceKpi?.occupancyFraction;
    if (declared === undefined || declared === null) continue; // IMO assente -> no-op
    if (row.roomsAvailable <= 0) continue; // Occupancy non definita -> no-op

    const computed = row.roomsSold / row.roomsAvailable;
    if (fractionWithinTolerance(computed, declared)) continue;

    out.push({
      id: "GR-ADR-OCC01",
      dataset: "adr_revpar",
      severity,
      scope: "row",
      stayDate: row.stayDate,
      nationality: null,
      message: `Giorno ${row.stayDate}: Occupancy ricalcolata ${(computed * 100).toFixed(1)}% (${row.roomsSold}/${row.roomsAvailable}) diversa dall'IMO dichiarato dalla fonte ${(declared * 100).toFixed(1)}% - possibile errore di lettura camere.`,
      context: {
        computedOccupancy: computed,
        declaredOccupancy: declared,
        roomsSold: row.roomsSold,
        roomsAvailable: row.roomsAvailable,
      },
    });
  }
  return out;
}

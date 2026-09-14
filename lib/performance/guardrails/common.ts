// ============ Performance Guardrails V0 — regole comuni ai dataset snapshot ============
//
// Guardrails V0 shadow mode — no enforcement.
//
// GR-C01 .. GR-C06 su GuardrailSnapshotRow[] (ADR/RevPAR e Montecallini).
// Nessuna di queste funzioni muta l'input. Nessuna riga viene scartata:
// una finding "blocking" e' solo una CANDIDATA in shadow mode.

import type { GuardrailDataset, GuardrailFinding, GuardrailSnapshotRow } from "./types";

type SnapshotDataset = Extract<GuardrailDataset, "adr_revpar" | "montecallini_pms">;

function finding(
  partial: Omit<GuardrailFinding, "dataset" | "nationality"> & { dataset: SnapshotDataset }
): GuardrailFinding {
  return { nationality: null, ...partial };
}

// ---- GR-C01: valori negativi ----
// Quantita' (camere/arrivi/presenze) negative -> anomalia bloccante
// candidata. Revenue negativo -> solo warning (puo' essere uno storno).
function grC01(dataset: SnapshotDataset, rows: readonly GuardrailSnapshotRow[]): GuardrailFinding[] {
  const out: GuardrailFinding[] = [];
  for (const row of rows) {
    const negativeQuantities: string[] = [];
    if (row.roomsSold < 0) negativeQuantities.push(`camere vendute = ${row.roomsSold}`);
    if (row.roomsAvailable < 0) negativeQuantities.push(`camere disponibili = ${row.roomsAvailable}`);
    if (row.arrivals !== null && row.arrivals < 0) negativeQuantities.push(`arrivi = ${row.arrivals}`);
    if (row.presences < 0) negativeQuantities.push(`presenze = ${row.presences}`);

    if (negativeQuantities.length > 0) {
      out.push(
        finding({
          id: "GR-C01-QTY",
          dataset,
          severity: "blocking",
          scope: "row",
          stayDate: row.stayDate,
          message: `Giorno ${row.stayDate}: quantita' negativa non valida (${negativeQuantities.join(", ")}).`,
          context: { negativeQuantities },
        })
      );
    }

    if (row.revenueTotal < 0) {
      out.push(
        finding({
          id: "GR-C01-REV",
          dataset,
          severity: "warning",
          scope: "row",
          stayDate: row.stayDate,
          message: `Giorno ${row.stayDate}: ricavo negativo (${row.revenueTotal}). Verificare se e' uno storno/nota di credito.`,
          context: { revenueTotal: row.revenueTotal },
        })
      );
    }
  }
  return out;
}

// ---- GR-C02: rooms_sold > rooms_available ----
// Per Montecallini il parser scarta gia' queste righe a monte: qui la
// regola resta come rete di sicurezza (non dovrebbe mai scattare su output
// del parser MC). Per Booking Designer e' una segnalazione nuova, NON
// promossa a blocking finche' non si vedono i file reali.
function grC02(dataset: SnapshotDataset, rows: readonly GuardrailSnapshotRow[]): GuardrailFinding[] {
  const out: GuardrailFinding[] = [];
  for (const row of rows) {
    if (row.roomsSold > row.roomsAvailable) {
      out.push(
        finding({
          id: "GR-C02",
          dataset,
          severity: "warning",
          scope: "row",
          stayDate: row.stayDate,
          message: `Giorno ${row.stayDate}: camere vendute (${row.roomsSold}) maggiori delle disponibili (${row.roomsAvailable}).`,
          context: { roomsSold: row.roomsSold, roomsAvailable: row.roomsAvailable },
        })
      );
    }
  }
  return out;
}

// ---- GR-C03: inventario a zero con attivita' ----
function grC03(dataset: SnapshotDataset, rows: readonly GuardrailSnapshotRow[]): GuardrailFinding[] {
  const out: GuardrailFinding[] = [];
  for (const row of rows) {
    if (row.roomsAvailable === 0 && (row.roomsSold > 0 || row.revenueTotal > 0)) {
      out.push(
        finding({
          id: "GR-C03",
          dataset,
          severity: "warning",
          scope: "row",
          stayDate: row.stayDate,
          message: `Giorno ${row.stayDate}: 0 camere disponibili ma risultano ${row.roomsSold} vendute / ${row.revenueTotal} di ricavo. Occupancy e RevPAR non calcolabili per questo giorno.`,
          context: { roomsSold: row.roomsSold, revenueTotal: row.revenueTotal },
        })
      );
    }
  }
  return out;
}

// ---- GR-C04: ricavo senza camere vendute ----
function grC04(dataset: SnapshotDataset, rows: readonly GuardrailSnapshotRow[]): GuardrailFinding[] {
  const out: GuardrailFinding[] = [];
  for (const row of rows) {
    if (row.revenueTotal > 0 && row.roomsSold === 0) {
      out.push(
        finding({
          id: "GR-C04",
          dataset,
          severity: "warning",
          scope: "row",
          stayDate: row.stayDate,
          message: `Giorno ${row.stayDate}: ricavo ${row.revenueTotal} con 0 camere vendute. ADR non calcolabile; possibile ricavo accessorio o penale.`,
          context: { revenueTotal: row.revenueTotal },
        })
      );
    }
  }
  return out;
}

// ---- GR-C05: camere vendute senza ricavo ----
function grC05(dataset: SnapshotDataset, rows: readonly GuardrailSnapshotRow[]): GuardrailFinding[] {
  const out: GuardrailFinding[] = [];
  for (const row of rows) {
    if (row.roomsSold > 0 && row.revenueTotal === 0) {
      out.push(
        finding({
          id: "GR-C05",
          dataset,
          severity: "warning",
          scope: "row",
          stayDate: row.stayDate,
          message: `Giorno ${row.stayDate}: ${row.roomsSold} camere vendute con ricavo 0. Verificare se il dato ricavo e' mancante o si tratta di camere comp/staff.`,
          context: { roomsSold: row.roomsSold },
        })
      );
    }
  }
  return out;
}

// ---- GR-C06: chiave duplicata nello stesso file/dataset ----
// La chiave logica per i dataset snapshot e' lo stay_date. Per Montecallini
// il runner viene invocato UNA VOLTA PER KIND (cy/sdly/ly), quindi qui la
// chiave e' sempre solo lo stay_date all'interno del kind corrente.
// NON deduplica, NON collassa, NON sceglie una riga: emette una sola
// finding scope="file" che elenca i giorni in collisione.
function grC06(dataset: SnapshotDataset, rows: readonly GuardrailSnapshotRow[]): GuardrailFinding[] {
  const seen = new Map<string, number>();
  for (const row of rows) {
    seen.set(row.stayDate, (seen.get(row.stayDate) ?? 0) + 1);
  }
  const duplicated = [...seen.entries()].filter(([, count]) => count > 1);
  if (duplicated.length === 0) return [];

  duplicated.sort((a, b) => a[0].localeCompare(b[0]));
  const detail = duplicated.map(([stayDate, count]) => `${stayDate} (${count}x)`).join(", ");
  const totalExtraRows = duplicated.reduce((sum, [, count]) => sum + (count - 1), 0);

  return [
    finding({
      id: "GR-C06",
      dataset,
      severity: "blocking",
      scope: "file",
      stayDate: null,
      message: `Il file contiene ${duplicated.length} giorno/i ripetuti con lo stesso stay_date (${detail}). Impossibile stabilire quale riga sia autoritativa - nessuna deduplica automatica.`,
      context: { duplicatedStayDates: duplicated.map(([stayDate]) => stayDate), totalExtraRows },
    }),
  ];
}

export function runCommonSnapshotGuardrails(
  dataset: SnapshotDataset,
  rows: readonly GuardrailSnapshotRow[]
): GuardrailFinding[] {
  return [
    ...grC06(dataset, rows),
    ...grC01(dataset, rows),
    ...grC02(dataset, rows),
    ...grC03(dataset, rows),
    ...grC04(dataset, rows),
    ...grC05(dataset, rows),
  ];
}

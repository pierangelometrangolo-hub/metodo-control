import { sdlyDate } from "../performanceMetrics";

// ============ Cutoff SDLY per struttura ============
//
// "Stessa data di osservazione": l'OTB corrente di una struttura e' quello
// della sua ultima estrazione (v_snapshot_latest), che puo' essere
// precedente a oggi. Il cutoff SDLY e' quindi la extraction_date piu'
// recente tra le righe che compongono il valore mostrato, meno un anno -
// non genericamente "oggi meno un anno".

export type ExtractionRow = {
  structure_id: string;
  extraction_date: string | null;
};

// "YYYY-MM-DD" confronta correttamente anche come stringa. Una struttura
// senza righe (o senza extraction_date) resta assente dalla mappa: nessuna
// data di osservazione inventata.
export function observationDateByStructure(rows: ExtractionRow[]): Map<string, string> {
  const result = new Map<string, string>();
  rows.forEach((r) => {
    if (!r.extraction_date) return;
    const current = result.get(r.structure_id);
    if (!current || r.extraction_date > current) result.set(r.structure_id, r.extraction_date);
  });
  return result;
}

// Raggruppa le strutture per cutoff SDLY (data di osservazione - 1 anno):
// fn_month_snapshot_asof accetta un solo cutoff per chiamata, quindi una
// chiamata per cutoff distinto invece che una per struttura.
export function groupStructuresBySdlyCutoff(observationDates: Map<string, string>): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  observationDates.forEach((observationDate, structureId) => {
    const cutoff = sdlyDate(observationDate);
    groups.set(cutoff, [...(groups.get(cutoff) || []), structureId]);
  });
  return groups;
}

// Cutoff SDLY di una singola struttura dalle righe che compongono il suo
// OTB corrente (stessa regola di observationDateByStructure, per il
// Dettaglio struttura). null = nessuna riga, nessuna data di osservazione.
export function sdlyCutoffFromRows(rows: { extraction_date: string | null }[]): {
  observationDate: string | null;
  cutoff: string | null;
} {
  const observationDate =
    observationDateByStructure(rows.map((r) => ({ structure_id: "", extraction_date: r.extraction_date }))).get("") ??
    null;
  return { observationDate, cutoff: observationDate ? sdlyDate(observationDate) : null };
}

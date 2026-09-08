import { sha256Hex } from "./hashing";
import { NormalizedNationalityRow, NormalizedSnapshotRow } from "./types";

// Arrotonda a 2 decimali e normalizza -0 -> 0, cosi' lo stesso importo
// scritto come 100 / 100.00 / 99.999999999999 (rumore in virgola mobile,
// possibile su revenue_total che passa per somme/parsing diversi a
// seconda del formato sorgente) produce sempre la stessa rappresentazione
// canonica ai fini dell'hash - MAI un arrotondamento che cambi il valore
// scritto in DB (che resta il number originale), solo la stringa usata
// per calcolare normalized_content_hash.
function canonicalAmount(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return (rounded === 0 ? 0 : rounded).toFixed(2);
}

// Ordina per stay_date - unico criterio deterministico e stabile
// disponibile per il dataset "a snapshot giornaliero" (ADR/RevPAR,
// Montecallini): non esistono due righe con la stessa stay_date nello
// stesso gruppo/kind, quindi l'ordinamento e' gia' univoco.
export function canonicalizeSnapshotRows(rows: NormalizedSnapshotRow[]): NormalizedSnapshotRow[] {
  return [...rows].sort((a, b) => a.stayDate.localeCompare(b.stayDate));
}

// Ordina per (stay_date, nazionalita') - qui invece PIU' righe condividono
// la stessa stay_date (una per nazionalita'), serve un secondo criterio
// per un ordinamento totale e deterministico.
export function canonicalizeNationalityRows(rows: NormalizedNationalityRow[]): NormalizedNationalityRow[] {
  return [...rows].sort((a, b) => a.stayDate.localeCompare(b.stayDate) || a.nationality.localeCompare(b.nationality));
}

function snapshotRowSignature(r: NormalizedSnapshotRow): string {
  return [
    r.stayDate,
    canonicalAmount(r.revenueTotal),
    String(r.roomsSold),
    String(r.roomsAvailable),
    r.arrivals === null ? "" : String(r.arrivals),
    String(r.presences),
  ].join("|");
}

function nationalityRowSignature(r: NormalizedNationalityRow): string {
  return [r.stayDate, r.nationality, String(r.presences)].join("|");
}

// Hash SEMANTICO dei dati (vedi commento su performance_import_events.
// normalized_content_hash nella migration): stesso set di righe -> stesso
// hash, indipendentemente dall'ordine con cui il parser le ha prodotte o
// da come il file sorgente formattava i numeri.
export async function computeSnapshotContentHash(rows: NormalizedSnapshotRow[]): Promise<string> {
  const canonical = canonicalizeSnapshotRows(rows)
    .map(snapshotRowSignature)
    .join("\n");
  return sha256Hex(canonical);
}

export async function computeNationalityContentHash(rows: NormalizedNationalityRow[]): Promise<string> {
  const canonical = canonicalizeNationalityRows(rows)
    .map(nationalityRowSignature)
    .join("\n");
  return sha256Hex(canonical);
}

// batch_hash (solo Montecallini oggi, vedi migration): hash dell'insieme
// ORDINATO dei source_checksum dei singoli file che compongono il batch -
// MAI dell'ordine di selezione. [A, B] e [B, A] producono lo stesso
// batch_hash perche' l'array viene riordinato PRIMA di essere unito.
export async function computeBatchHash(fileSourceChecksums: string[]): Promise<string> {
  const sorted = [...fileSourceChecksums].sort();
  return sha256Hex(sorted.join(","));
}

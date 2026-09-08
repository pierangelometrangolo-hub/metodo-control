// SHA-256 via Web Crypto (globalThis.crypto.subtle) invece del modulo
// "crypto" di Node usato da lib/finance/ingestion/hash.ts: quel motore
// gira lato server, questo servizio Performance gira interamente
// client-side (la pagina Import e' "use client", legge i file con
// FileReader nel browser) - Web Crypto e' l'unica API di hashing
// disponibile li'. E' comunque disponibile anche in Node 19+ (incluso
// l'ambiente di test di questo progetto), quindi le stesse funzioni
// restano testabili senza polyfill.
export async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

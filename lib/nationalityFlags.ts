// Mappatura nome-nazionalità (testo esatto come salvato in guest_nationality)
// -> codice ISO 3166-1 alpha-2. Verificata contro l'unione di tutte le
// nazionalità che compaiono in una Top 10 mensile per presenze, su tutte
// le strutture, per l'intero 2026.
const NATIONALITY_TO_ISO: Record<string, string> = {
  "ARABIA SAUDITA": "SA",
  ARGENTINA: "AR",
  AUSTRALIA: "AU",
  AUSTRIA: "AT",
  BELGIO: "BE",
  BRASILE: "BR",
  CANADA: "CA",
  CILE: "CL",
  COLOMBIA: "CO",
  "COREA DEL SUD": "KR",
  CROAZIA: "HR",
  DANIMARCA: "DK",
  "EMIRATI ARABI UNITI": "AE",
  ESTONIA: "EE",
  FINLANDIA: "FI",
  FRANCIA: "FR",
  GERMANIA: "DE",
  GIAPPONE: "JP",
  GRECIA: "GR",
  INDIA: "IN",
  IRLANDA: "IE",
  ISLANDA: "IS",
  ISRAELE: "IL",
  ITALIA: "IT",
  LITUANIA: "LT",
  LUSSEMBURGO: "LU",
  MESSICO: "MX",
  "PAESI BASSI": "NL",
  "PERU'": "PE",
  POLONIA: "PL",
  PORTOGALLO: "PT",
  "REGNO UNITO": "GB",
  ROMANIA: "RO",
  RUSSIA: "RU",
  SLOVENIA: "SI",
  SPAGNA: "ES",
  "STATI UNITI D'AMERICA": "US",
  SVEZIA: "SE",
  SVIZZERA: "CH",
  UNGHERIA: "HU",
};

function isoToFlagEmoji(iso: string): string {
  return iso
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

// Ritorna null se la nazionalità non è mappata (nuovo import futuro con un
// paese non ancora visto): il chiamante deve gestire il fallback, mai
// mostrare un'icona rotta.
export function flagForNationality(nationality: string): string | null {
  const iso = NATIONALITY_TO_ISO[nationality];
  return iso ? isoToFlagEmoji(iso) : null;
}

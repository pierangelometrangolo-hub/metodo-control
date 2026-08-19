// Validazione strutturale REALE (checksum ufficiale), non solo "sembra
// della lunghezza giusta" - per distinguere in modo affidabile un
// identificativo fiscale valido da uno anomalo (typo, OCR, dato corrotto).

// ---------- Partita IVA (11 cifre, algoritmo ufficiale Agenzia Entrate) ----------
export function isValidItalianVat(vat: string | null): boolean {
  if (!vat) return false;
  if (!/^\d{11}$/.test(vat)) return false;

  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const digit = Number(vat[i]);
    if (i % 2 === 0) {
      sum += digit;
    } else {
      const doubled = digit * 2;
      sum += doubled > 9 ? doubled - 9 : doubled;
    }
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === Number(vat[10]);
}

// ---------- Codice Fiscale persona fisica (16 caratteri, algoritmo ufficiale) ----------
const CF_PATTERN = /^[A-Z]{6}\d{2}[A-EHLMPRST]\d{2}[A-Z]\d{3}[A-Z]$/;

const ODD_TABLE: Record<string, number> = {
  "0": 1, "1": 0, "2": 5, "3": 7, "4": 9, "5": 13, "6": 15, "7": 17, "8": 19, "9": 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21,
  K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14,
  U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function evenValue(ch: string): number {
  return /\d/.test(ch) ? Number(ch) : ALPHABET.indexOf(ch);
}

export function isValidItalianFiscalCode(cf: string | null): boolean {
  if (!cf) return false;
  const upper = cf.toUpperCase();
  if (!CF_PATTERN.test(upper)) return false;

  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const ch = upper[i];
    // Posizioni dispari (1-indexed: 1,3,5...) -> indice pari (0-indexed: 0,2,4...)
    sum += i % 2 === 0 ? ODD_TABLE[ch] : evenValue(ch);
  }
  const expectedCheckLetter = ALPHABET[sum % 26];
  return upper[15] === expectedCheckLetter;
}

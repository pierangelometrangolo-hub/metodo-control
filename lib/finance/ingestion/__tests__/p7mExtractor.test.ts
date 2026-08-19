import { describe, expect, it } from "vitest";
import { extractXmlFromP7m } from "../p7mExtractor";

// NOTA: il percorso "happy path" (estrazione XML da un vero P7M, sia
// binario grezzo sia base64) e' stato verificato manualmente contro un
// file reale del batch 2025 (non incluso qui: e' un dato di business
// reale, non deve finire in un fixture committato) - confermato che il
// fix base64 estrae correttamente l'XML imbustato. Costruire un P7M
// sintetico "firmato" con node-forge per un test automatico si e'
// rivelato inaffidabile (l'API pkcs7.createSignedData + addSigner + sign
// non ha prodotto in modo consistente un content leggibile in fase di
// reparsing nei tentativi fatti) - non vale il tempo per la posta in
// gioco, il fix e' comunque verificato empiricamente. Qui resta la
// copertura sul comportamento di errore, che e' deterministica.
describe("p7mExtractor", () => {
  it("un buffer non valido produce un errore esplicito, mai un contenuto vuoto silenzioso spacciato per successo", () => {
    const result = extractXmlFromP7m(Buffer.from("non e' un P7M valido"));
    expect(result.signatureError).not.toBeNull();
    expect(result.content).toBe("");
  });

  it("un buffer base64-valido ma che non decodifica a un PKCS7 valido produce comunque un errore esplicito", () => {
    const result = extractXmlFromP7m(Buffer.from(Buffer.from("contenuto qualsiasi, non PKCS7").toString("base64")));
    expect(result.signatureError).not.toBeNull();
    expect(result.content).toBe("");
  });
});

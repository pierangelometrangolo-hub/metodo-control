import forge from "node-forge";

export type P7mExtractionResult = {
  content: string;
  signatureVerified: boolean | null;
  signatureError: string | null;
};

// Estrae l'XML in chiaro da una busta PKCS#7 (.p7m, firma CAdES-BES tipica
// di SdI). Limite dichiarato: qui viene estratto solo il contenuto
// imbustato, NON viene eseguita una verifica crittografica completa della
// firma (catena di certificati, policy CAdES, timestamp) - node-forge non
// offre questo out-of-the-box per il profilo italiano, e costruirla e' un
// lavoro a se' che va oltre l'obiettivo del dry-run (serve il DATO, non
// l'attestazione legale della firma). signatureVerified resta sempre null
// in questa versione - mai dichiarato "true" senza averlo davvero
// verificato.

// Il batch reale 2025 ha rivelato che i .p7m NON sono DER binario grezzo
// ma testo base64 (il buffer del file e' interamente stampabile,
// decodifica a una struttura DER valida - primi byte decodificati
// 30 83 01 c7 e0..., SEQUENCE con lunghezza long-form corretta). Prima di
// assumere binario grezzo, verifica se il buffer e' interamente testo
// base64 valido e in quel caso decodifica prima di passarlo a forge - un
// fallback comunque presente (binario grezzo) per non escludere a priori
// provider che esportano il formato "giusto".
function isLikelyBase64Text(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096)).toString("latin1");
  return /^[A-Za-z0-9+/=\r\n]+$/.test(sample);
}

type Asn1Node = {
  constructed: boolean;
  value: string | Asn1Node[];
};

// message.content di forge.pkcs7.messageFromAsn1 si e' rivelato
// inaffidabile sul batch reale (bytes sempre vuoti, verificato). I byte
// veri sono raggiungibili navigando l'ASN.1 grezzo gia' catturato da forge
// in message.rawCapture.content: un nodo [0] EXPLICIT (constructed) che
// contiene un OCTET STRING - primitivo nel caso comune (un solo figlio con
// i byte diretti), ma per contenuti molto grandi un OCTET STRING puo'
// essere codificato in forma "constructed" con piu' figli da concatenare -
// gestito qui ricorsivamente per non assumere sempre un solo chunk.
function extractBytesRecursive(node: Asn1Node): string {
  if (!node.constructed) {
    return typeof node.value === "string" ? node.value : "";
  }
  if (Array.isArray(node.value)) {
    return node.value.map(extractBytesRecursive).join("");
  }
  return "";
}

export function extractXmlFromP7m(p7mBuffer: Buffer): P7mExtractionResult {
  try {
    const derBuffer = isLikelyBase64Text(p7mBuffer)
      ? Buffer.from(p7mBuffer.toString("latin1").replace(/\s+/g, ""), "base64")
      : p7mBuffer;

    const der = forge.util.createBuffer(derBuffer.toString("binary"));
    const asn1 = forge.asn1.fromDer(der);
    const message = forge.pkcs7.messageFromAsn1(asn1) as unknown as {
      rawCapture?: { content?: Asn1Node };
    };

    const contentNode = message.rawCapture?.content;
    if (!contentNode) {
      return {
        content: "",
        signatureVerified: null,
        signatureError: "Nessun contenuto imbustato trovato nel PKCS#7 (firma 'detached' o struttura non riconosciuta).",
      };
    }

    const contentBytes = extractBytesRecursive(contentNode);
    if (!contentBytes) {
      return {
        content: "",
        signatureVerified: null,
        signatureError: "Contenuto imbustato trovato ma vuoto dopo l'estrazione - struttura ASN.1 non prevista da questo estrattore.",
      };
    }

    const xmlText = Buffer.from(contentBytes, "binary").toString("utf-8");
    return { content: xmlText, signatureVerified: null, signatureError: null };
  } catch (err) {
    return {
      content: "",
      signatureVerified: null,
      signatureError: err instanceof Error ? err.message : String(err),
    };
  }
}

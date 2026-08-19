import { XMLParser } from "fast-xml-parser";
import type { NormalizedDocumentLine, PartyInfo, PaymentInfo, CreditNoteInfo } from "./types";

// Parser per XML FatturaPA (fattura elettronica italiana). Copre il
// sottoinsieme di campi richiesto dal dry-run - non l'intero schema
// ministeriale (es. non estrae DatiTrasporto, DatiDDT, allegati). Difensivo
// per costruzione: un campo mancante o inatteso produce null, mai
// un'eccezione che blocca l'intero documento - l'unica eccezione lanciata
// e' se l'XML non e' nemmeno parsabile come tale.

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false, // manteniamo tutto come stringa - i cast numerici li facciamo noi esplicitamente, mai un parsing implicito silenzioso
  trimValues: true,
});

// fast-xml-parser restituisce un oggetto singolo quando un tag ripetibile
// compare una sola volta, e un array quando ne compare piu' di uno - questo
// helper normalizza sempre ad array, per non dover gestire i due casi
// separatamente ad ogni accesso.
function arrayify<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function asString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

function asNumber(value: unknown): number | null {
  const s = asString(value);
  if (s === null) return null;
  const n = Number(s.replace(",", "."));
  return Number.isNaN(n) ? null : n;
}

export type ParsedFatturaPa = {
  documentTypeCode: string;
  documentNumberRaw: string;
  documentDate: string;
  currency: string;
  issuer: PartyInfo;
  counterparty: PartyInfo;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  lines: NormalizedDocumentLine[];
  payment: PaymentInfo;
  creditNote: CreditNoteInfo;
  parseWarnings: string[];
};

function extractParty(anagrafica: Record<string, unknown> | undefined, sede: Record<string, unknown> | undefined, contatti: Record<string, unknown> | undefined): PartyInfo {
  const datiAnagrafici = (anagrafica?.DatiAnagrafici ?? {}) as Record<string, unknown>;
  const idFiscaleIva = (datiAnagrafici.IdFiscaleIVA ?? {}) as Record<string, unknown>;
  const anagraficaBlock = (datiAnagrafici.Anagrafica ?? {}) as Record<string, unknown>;

  const denominazione = asString(anagraficaBlock.Denominazione);
  const nome = asString(anagraficaBlock.Nome);
  const cognome = asString(anagraficaBlock.Cognome);
  const legalName = denominazione ?? (nome && cognome ? `${nome} ${cognome}` : nome ?? cognome);

  const idPaese = asString(idFiscaleIva.IdPaese);
  const idCodice = asString(idFiscaleIva.IdCodice);
  const vatNumber = idCodice ? `${idPaese ?? "IT"}${idCodice}` : null;

  const indirizzoBlock = (sede ?? {}) as Record<string, unknown>;
  const addressParts = [
    asString(indirizzoBlock.Indirizzo),
    asString(indirizzoBlock.NumeroCivico),
    asString(indirizzoBlock.CAP),
    asString(indirizzoBlock.Comune),
    asString(indirizzoBlock.Provincia),
  ].filter(Boolean);

  return {
    legalName,
    vatNumber,
    fiscalCode: asString(datiAnagrafici.CodiceFiscale),
    address: addressParts.length > 0 ? addressParts.join(", ") : null,
    pec: asString((contatti as Record<string, unknown> | undefined)?.Email),
    sdiCode: null, // il codice destinatario SdI del CESSIONARIO non e' un dato anagrafico della controparte in senso stretto - non estratto qui, vive in DatiTrasmissione se serve in futuro
  };
}

export function parseFatturaPaXml(xmlContent: string): ParsedFatturaPa {
  const parsed = parser.parse(xmlContent) as Record<string, unknown>;

  // Il root element ha spesso un prefisso di namespace variabile
  // (p:FatturaElettronica, ns2:FatturaElettronica, o senza prefisso) -
  // cerchiamo la prima chiave che termina con "FatturaElettronica" invece
  // di assumere un prefisso fisso.
  const rootKey = Object.keys(parsed).find((k) => k.endsWith("FatturaElettronica"));
  if (!rootKey) {
    throw new Error("XML non riconosciuto come FatturaElettronica: elemento radice atteso non trovato.");
  }
  const root = parsed[rootKey] as Record<string, unknown>;
  const header = (root.FatturaElettronicaHeader ?? {}) as Record<string, unknown>;
  const bodies = arrayify(root.FatturaElettronicaBody as Record<string, unknown> | Record<string, unknown>[] | undefined);
  const body = bodies[0] ?? {}; // un file .xml puo' contenere piu' body (fatture multiple) - qui gestiamo il primo, il chiamante e' responsabile di iterare se ce ne sono altri

  const warnings: string[] = [];
  if (bodies.length > 1) warnings.push(`Il file contiene ${bodies.length} FatturaElettronicaBody - solo il primo e' stato interpretato, gli altri vanno gestiti separatamente.`);

  const cedente = (header.CedentePrestatore ?? {}) as Record<string, unknown>;
  const cessionario = (header.CessionarioCommittente ?? {}) as Record<string, unknown>;

  const issuer = extractParty(cedente, cedente.Sede as Record<string, unknown>, cedente.Contatti as Record<string, unknown>);
  const counterparty = extractParty(cessionario, cessionario.Sede as Record<string, unknown>, cessionario.Contatti as Record<string, unknown>);

  const datiGenerali = (body.DatiGenerali ?? {}) as Record<string, unknown>;
  const datiGeneraliDocumento = (datiGenerali.DatiGeneraliDocumento ?? {}) as Record<string, unknown>;

  const documentTypeCode = asString(datiGeneraliDocumento.TipoDocumento) ?? "UNKNOWN";
  const documentNumberRaw = asString(datiGeneraliDocumento.Numero) ?? "";
  const documentDate = asString(datiGeneraliDocumento.Data) ?? "";
  const currency = asString(datiGeneraliDocumento.Divisa) ?? "EUR";

  // Nota di credito: TD04 e' il codice standard, ma il documento resta
  // valido anche se in futuro emergono altri codici assimilabili (TD08
  // nota di credito semplificata, ecc.) - qui riconosciamo solo TD04 come
  // richiesto esplicitamente, altri codici restano "non nota di credito"
  // finche' non confermato diversamente.
  const isCreditNote = documentTypeCode === "TD04";
  const datiFattureCollegate = arrayify(datiGenerali.DatiFattureCollegate as Record<string, unknown> | Record<string, unknown>[] | undefined)[0] as
    | Record<string, unknown>
    | undefined;
  const causali = arrayify(datiGeneraliDocumento.Causale as string | string[] | undefined).map((c) => asString(c)).filter((c): c is string => c !== null);

  const datiBeniServizi = (body.DatiBeniServizi ?? {}) as Record<string, unknown>;
  const dettaglioLinee = arrayify(datiBeniServizi.DettaglioLinee as Record<string, unknown> | Record<string, unknown>[] | undefined);

  const lines: NormalizedDocumentLine[] = dettaglioLinee.map((linea, idx) => {
    const periodo = (linea.DatiRiepilogoLinee ?? {}) as Record<string, unknown>;
    return {
      lineNumber: asNumber(linea.NumeroLinea) ?? idx + 1,
      description: asString(linea.Descrizione),
      quantity: asNumber(linea.Quantita),
      unit: asString(linea.UnitaMisura),
      unitPrice: asNumber(linea.PrezzoUnitario),
      netAmount: asNumber(linea.PrezzoTotale) ?? 0,
      vatRate: asNumber(linea.AliquotaIVA),
      vatAmount: null, // l'IVA per linea non e' quasi mai esplicita in FatturaPA (si aggrega per aliquota in DatiRiepilogo) - lasciata null piuttosto che ricalcolata implicitamente
      servicePeriodFrom: asString(linea.DataInizioPeriodo) ?? asString(periodo.DataInizioPeriodo),
      servicePeriodTo: asString(linea.DataFinePeriodo) ?? asString(periodo.DataFinePeriodo),
    };
  });

  // Caso reale trovato nel batch 2025: TD04 senza Causale ne'
  // DatiFattureCollegate strutturati - riferimento e motivo vivono nella
  // descrizione della prima riga (es. "Totale storno fatt V00088 per
  // errato importo"). Fallback in due passi, entrambi segnalati come tali
  // (mai spacciati per il dato strutturato): reasonDescription cade sulla
  // descrizione della prima riga se Causale e' assente; il numero
  // documento referenziato viene cercato con un'euristica testuale
  // ("fatt(ura)? <numero>") solo se DatiFattureCollegate manca - resta un
  // CANDIDATE, non una certezza strutturale, verificato dal chiamante
  // tramite parseWarnings.
  const firstLineDescription = lines[0]?.description ?? null;
  const reasonFromCausale = causali.length > 0 ? causali.join(" | ") : null;
  const reasonDescription = reasonFromCausale ?? firstLineDescription;
  if (!reasonFromCausale && firstLineDescription && isCreditNote) {
    warnings.push("Causale assente per una TD04 - motivo dello storno preso dalla descrizione della prima riga (fallback, non campo strutturato).");
  }

  let referencedDocumentNumber = datiFattureCollegate ? asString(datiFattureCollegate.IdDocumento) : null;
  const referencedDocumentDate = datiFattureCollegate ? asString(datiFattureCollegate.Data) : null;
  if (!referencedDocumentNumber && isCreditNote && reasonDescription) {
    // Varianti reali osservate nel batch: "fatt V00088", "fatt. L00003",
    // "fattura nr. L00024", "fatt. n. V00089" - "nr."/"n." opzionali tra il
    // riferimento a "fattura" e il numero vero e proprio.
    const refMatch = reasonDescription.match(/fatt(?:ura)?\.?\s*(?:nr?\.?\s*)?([A-Za-z]?\/?\d[\w/]*)/i);
    if (refMatch) {
      referencedDocumentNumber = refMatch[1];
      warnings.push(
        `TD04 senza DatiFattureCollegate strutturato - numero documento originario "${refMatch[1]}" estratto per euristica dalla descrizione, NON e' un riferimento strutturale certo, da confermare a mano.`
      );
    }
  }

  const creditNote: CreditNoteInfo = {
    isCreditNote,
    referencedDocumentNumber,
    referencedDocumentDate,
    reasonDescription,
    proposedEconomicSign: isCreditNote ? -1 : 1,
  };

  const datiRiepilogo = arrayify(datiBeniServizi.DatiRiepilogo as Record<string, unknown> | Record<string, unknown>[] | undefined);
  let netAmount: number;
  let vatAmount: number;
  if (datiRiepilogo.length > 0) {
    netAmount = datiRiepilogo.reduce((sum, r) => sum + (asNumber(r.ImponibileImporto) ?? 0), 0);
    vatAmount = datiRiepilogo.reduce((sum, r) => sum + (asNumber(r.Imposta) ?? 0), 0);
  } else {
    warnings.push("DatiRiepilogo assente - imponibile calcolato come somma delle righe, IVA non determinabile (0 per difetto, da verificare a mano).");
    netAmount = lines.reduce((sum, l) => sum + l.netAmount, 0);
    vatAmount = 0;
  }
  const grossAmount = netAmount + vatAmount;

  const datiPagamento = arrayify(body.DatiPagamento as Record<string, unknown> | Record<string, unknown>[] | undefined)[0] as
    | Record<string, unknown>
    | undefined;
  const dettaglioPagamento = arrayify(datiPagamento?.DettaglioPagamento as Record<string, unknown> | Record<string, unknown>[] | undefined)[0] as
    | Record<string, unknown>
    | undefined;

  const payment: PaymentInfo = {
    dueDate: asString(dettaglioPagamento?.DataScadenzaPagamento),
    paymentTerms: asString(datiPagamento?.CondizioniPagamento),
    paymentMethod: asString(dettaglioPagamento?.ModalitaPagamento),
  };

  return {
    documentTypeCode,
    documentNumberRaw,
    documentDate,
    currency,
    issuer,
    counterparty,
    netAmount,
    vatAmount,
    grossAmount,
    lines,
    payment,
    creditNote,
    parseWarnings: warnings,
  };
}

// Estrae il sezionale/serie dal numero documento. Euristica: un prefisso
// alfabetico separato da / - o spazio dalla parte numerica (es. "V/123",
// "L-45", "V 7"). Se il numero e' puramente numerico, series = null - MAI
// una serie inventata quando non c'e' un prefisso riconoscibile. Va
// validata sui numeri reali del batch (sezione 7 del prompt: il dry-run
// stesso deve rivelare quanto questa euristica sia affidabile).
export function extractDocumentSeries(documentNumberRaw: string): { series: string | null; numberPart: string } {
  const match = documentNumberRaw.match(/^([A-Za-z]+)[\/\-\s]?(\d.*)$/);
  if (match) {
    return { series: match[1].toUpperCase(), numberPart: match[2] };
  }
  return { series: null, numberPart: documentNumberRaw };
}

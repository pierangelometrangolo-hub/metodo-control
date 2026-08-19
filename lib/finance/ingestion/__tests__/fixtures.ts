// Fixture XML FatturaPA sintetiche per i test - non provengono dal batch
// reale (non ancora disponibile), costruite per esercitare esattamente gli
// scenari richiesti (TD01/TD04, periodo strutturato, causale con mese,
// piu' aliquote, ecc.). Struttura minima ma fedele allo schema reale.

export function buildFatturaPaXml(opts: {
  documentType?: string;
  number?: string;
  date?: string;
  issuerVat?: string;
  issuerName?: string;
  counterpartyVat?: string;
  counterpartyCf?: string;
  counterpartyName?: string;
  lines: { descrizione: string; prezzoTotale: number; aliquotaIva?: number; dataInizioPeriodo?: string; dataFinePeriodo?: string }[];
  datiFattureCollegate?: { idDocumento: string; data: string };
  causale?: string;
}): string {
  const {
    documentType = "TD01",
    number = "1",
    date = "2025-05-15",
    issuerVat = "05320500753",
    issuerName = "GAP GROUP S.R.L.",
    counterpartyVat = "01430150746",
    counterpartyCf,
    counterpartyName = "CANTINE DUE PALME SOCIETA' COOPERATIVA",
    lines,
    datiFattureCollegate,
    causale,
  } = opts;

  const netTotal = lines.reduce((s, l) => s + l.prezzoTotale, 0);
  const vatTotal = lines.reduce((s, l) => s + l.prezzoTotale * ((l.aliquotaIva ?? 22) / 100), 0);

  const linesXml = lines
    .map(
      (l, i) => `
      <DettaglioLinee>
        <NumeroLinea>${i + 1}</NumeroLinea>
        <Descrizione>${l.descrizione}</Descrizione>
        <PrezzoUnitario>${l.prezzoTotale}</PrezzoUnitario>
        <PrezzoTotale>${l.prezzoTotale}</PrezzoTotale>
        <AliquotaIVA>${l.aliquotaIva ?? 22}</AliquotaIVA>
        ${l.dataInizioPeriodo ? `<DataInizioPeriodo>${l.dataInizioPeriodo}</DataInizioPeriodo>` : ""}
        ${l.dataFinePeriodo ? `<DataFinePeriodo>${l.dataFinePeriodo}</DataFinePeriodo>` : ""}
      </DettaglioLinee>`
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica xmlns:p="ns" versione="FPR12">
  <FatturaElettronicaHeader>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${issuerVat}</IdCodice></IdFiscaleIVA>
        <Anagrafica><Denominazione>${issuerName}</Denominazione></Anagrafica>
      </DatiAnagrafici>
    </CedentePrestatore>
    <CessionarioCommittente>
      <DatiAnagrafici>
        ${counterpartyVat ? `<IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${counterpartyVat}</IdCodice></IdFiscaleIVA>` : ""}
        ${counterpartyCf ? `<CodiceFiscale>${counterpartyCf}</CodiceFiscale>` : ""}
        <Anagrafica><Denominazione>${counterpartyName}</Denominazione></Anagrafica>
      </DatiAnagrafici>
    </CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>${documentType}</TipoDocumento>
        <Divisa>EUR</Divisa>
        <Data>${date}</Data>
        <Numero>${number}</Numero>
        ${causale ? `<Causale>${causale}</Causale>` : ""}
      </DatiGeneraliDocumento>
      ${
        datiFattureCollegate
          ? `<DatiFattureCollegate><IdDocumento>${datiFattureCollegate.idDocumento}</IdDocumento><Data>${datiFattureCollegate.data}</Data></DatiFattureCollegate>`
          : ""
      }
    </DatiGenerali>
    <DatiBeniServizi>
      ${linesXml}
      <DatiRiepilogo>
        <AliquotaIVA>22</AliquotaIVA>
        <ImponibileImporto>${netTotal.toFixed(2)}</ImponibileImporto>
        <Imposta>${vatTotal.toFixed(2)}</Imposta>
      </DatiRiepilogo>
    </DatiBeniServizi>
  </FatturaElettronicaBody>
</p:FatturaElettronica>`;
}

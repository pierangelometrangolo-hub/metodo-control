import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { parseBdExportCsv, parseBdExportWorkbook } from "../../../bdExportParser";
import { parseMontecalliniPmsCsv } from "../../../montecalliniPmsParser";

// ============ AUDIT — snapshot parziale da errori parser su VERE righe-dato ============
//
// Questo test NON cambia il comportamento: DOCUMENTA lo stato attuale, che
// nello STEP successivo diventera' il primo blocco reale.
//
// STATO ATTUALE (Guardrails V0 / Import Integrity Foundation Fase 1):
//   - parseBdExportWorkbook / parseMontecalliniPmsCsv, di fronte a una VERA
//     riga-dato non leggibile (es. cella Revenue formattata come data,
//     CP>CV, valore non numerico), SCARTANO quella riga e restituiscono le
//     ALTRE righe come valide + un messaggio in `errors`.
//   - La pagina Import (app/(control)/performance/import/page.tsx) NON
//     blocca il submit sulla presenza di `parseErrors`: `canSubmit`
//     controlla solo totalRowsInEntry(e) > 0 e i mismatch di
//     struttura/formato. Quindi l'import PROSEGUE con le sole righe
//     sopravvissute -> snapshot PARZIALE, senza alcun audit del fatto che
//     N righe siano cadute.
//   - Le righe strutturali attese (TOTALE / "DISPONIBILI A FINE MESE" /
//     totali annuali con etichetta vuota) NON sono errori: finiscono in
//     `excludedRows` o vengono saltate in silenzio - corretto, nessun
//     blocco previsto per loro.
//
// STEP SUCCESSIVO (enforcement): un errore parser su una VERA riga-dato
// dovra' produrre validation_error a livello FILE (zero righe scritte),
// mai "importa il resto".

const BD_DIR = path.join(process.cwd(), ".local-imports", "bd_villa_neviera_2026-09-01");
const BD_XLS = "ADR - RevPAR (01 Gen 2026 - 31 Dic 2026) - Villa Neviera Wine Resort - 2026-09-01.xls";
const bdAvailable = fs.existsSync(path.join(BD_DIR, BD_XLS));

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe("AUDIT snapshot parziale - parser BD: vere righe-dato scartate + resto importabile", () => {
  it.skipIf(!bdAvailable)(
    "Villa Neviera XLS: il 27/07/2026 (cella Revenue formato-data) e' scartato, ma le altre 364 righe restano 'valide' e importabili",
    () => {
      const result = parseBdExportWorkbook(toArrayBuffer(fs.readFileSync(path.join(BD_DIR, BD_XLS))));

      // Una VERA riga-dato scartata...
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("27 Luglio");
      expect(result.errors[0]).toContain("formattata come data");

      // ...ma il parser restituisce comunque le altre come valide: oggi la
      // pagina Import le manderebbe a ingestSingleFile e verrebbero
      // committate (snapshot parziale 364/365, nessun audit del buco).
      expect(result.rows.length).toBe(364);
      expect(result.rows.some((r) => r.stayDate === "2026-07-27")).toBe(false);
    }
  );

  it("fixture sintetico: riga con valore non numerico -> scartata, le altre 2 restano valide (comportamento ATTUALE, da bloccare nello step enforcement)", () => {
    // header minimo BD via CSV (stesso processBdRows dell'XLS)
    const header =
      ',Data,"Unità occupate","Unità Libere","Unità in vendita","Unità chiuse",IMO,"Indice Medio Occupazione",Arrivi,Presenze,"Revenue Totale","Tariffa media (ADR)",RevPAR,BW';
    const good1 = ',"Giovedì, 01 Gennaio 2026",5,3,8,0,"62.5 %",62%,2,10,"€ 670,33","€ 134,07","€ 83,79","26 gg"';
    const broken = ',"Venerdì, 02 Gennaio 2026",5,3,8,0,"62.5 %",62%,2,10,"non-un-numero","€ 0","€ 0","1 gg"';
    const good2 = ',"Sabato, 03 Gennaio 2026",6,3,9,0,"66.67 %",66%,4,12,"€ 882,34","€ 147,06","€ 98,04","26 gg"';
    const result = parseBdExportCsv([header, good1, broken, good2].join("\n"));

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("02 Gennaio");
    expect(result.rows.map((r) => r.stayDate)).toEqual(["2026-01-01", "2026-01-03"]); // la riga rotta NON blocca le altre
  });
});

describe("AUDIT - righe strutturali attese NON sono errori", () => {
  it("Montecallini: TOTALE / DISPONIBILI A FINE MESE finiscono in excludedRows, mai in errors", () => {
    const csv = [
      "DATA;CP;CV;PAX;RICAVI TRAT;ADR;RPAR;OCCUP",
      "01/05/2026 ven;10;48;20;1.000,00;100,00;20,83;20,8%",
      "TOTALE CY;;;;;;;",
      "DISPONIBILI A FINE MESE;;;;;;;",
    ].join("\n");
    const result = parseMontecalliniPmsCsv(csv);
    expect(result.errors).toHaveLength(0);
    expect(result.excludedRows.map((r) => r.line).sort()).toEqual([3, 4]);
    expect(result.rows).toHaveLength(1);
  });
});

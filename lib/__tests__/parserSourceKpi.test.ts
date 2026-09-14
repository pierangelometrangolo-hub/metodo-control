import { describe, expect, it } from "vitest";
import { parseBdExportCsv, parseOccupancyToFraction } from "../bdExportParser";
import { parseMontecalliniPmsCsv } from "../montecalliniPmsParser";

// I parser espongono i KPI dichiarati dalla fonte in un array PARALLELO a
// `rows` (sourceKpiByRow) - MAI dentro ParsedMonthRow / ParsedMontecalliniRow
// (che restano i soli campi importati). Solo per i guardrail di coerenza.

const BD_HEADER =
  ',Data,"Unità occupate","Unità Libere","Unità in vendita","Unità chiuse",IMO,"Indice Medio Occupazione",Arrivi,Presenze,"Revenue Totale","Tariffa media (ADR)",RevPAR,BW';

describe("parseOccupancyToFraction", () => {
  it('testo "62.5 %" (decimale col punto, formato BD CSV) -> 0.625', () => {
    expect(parseOccupancyToFraction("62.5 %")).toBeCloseTo(0.625, 6);
  });
  it('testo "60,4%" (decimale con la virgola, formato Montecallini OCCUP) -> 0.604', () => {
    expect(parseOccupancyToFraction("60,4%")).toBeCloseTo(0.604, 6);
  });
  it("frazione grezza 0.625 (formato BD .xls) -> 0.625", () => {
    expect(parseOccupancyToFraction(0.625)).toBe(0.625);
  });
  it('"0 %" -> 0', () => {
    expect(parseOccupancyToFraction("0 %")).toBe(0);
  });
  it('overbooking "111.11 %" -> 1.1111', () => {
    expect(parseOccupancyToFraction("111.11 %")).toBeCloseTo(1.1111, 4);
  });
  it("assente / non interpretabile -> null", () => {
    expect(parseOccupancyToFraction("")).toBeNull();
    expect(parseOccupancyToFraction("n/d")).toBeNull();
    expect(parseOccupancyToFraction(undefined)).toBeNull();
    expect(parseOccupancyToFraction(Infinity)).toBeNull();
  });
});

describe("parseBdExportCsv - sourceKpiByRow", () => {
  it("allineato 1:1 con rows; IMO/RevPAR/ADR letti dalle colonne, mai in ParsedMonthRow", () => {
    const csv = [
      BD_HEADER,
      ',"Giovedì, 01 Gennaio 2026",5,3,8,0,"62.5 %",62%,2,10,"€ 670,33","€ 134,07","€ 83,79","26 gg"',
    ].join("\n");
    const result = parseBdExportCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.sourceKpiByRow).toHaveLength(1);
    expect(result.sourceKpiByRow[0].occupancyFraction).toBeCloseTo(0.625, 6);
    expect(result.sourceKpiByRow[0].revpar).toBeCloseTo(83.79, 2);
    expect(result.sourceKpiByRow[0].adr).toBeCloseTo(134.07, 2);
    // ParsedMonthRow resta i soli 6 campi + periodLabel
    expect(Object.keys(result.rows[0]).sort()).toEqual(
      ["arrivals", "periodLabel", "presences", "revenueTotal", "roomsAvailable", "roomsSold", "stayDate"].sort()
    );
  });

  it("riga scartata (revenue non numerico) -> sourceKpiByRow resta allineato alle SOLE righe valide", () => {
    const csv = [
      BD_HEADER,
      ',"Giovedì, 01 Gennaio 2026",5,3,8,0,"62.5 %",62%,2,10,"€ 670,33","€ 134,07","€ 83,79","26 gg"',
      ',"Venerdì, 02 Gennaio 2026",5,3,8,0,"62.5 %",62%,2,10,"xxx","€ 0","€ 0","1 gg"',
      ',"Sabato, 03 Gennaio 2026",6,3,9,0,"66.67 %",66%,4,12,"€ 882,34","€ 147,06","€ 98,04","26 gg"',
    ].join("\n");
    const result = parseBdExportCsv(csv);
    expect(result.rows.map((r) => r.stayDate)).toEqual(["2026-01-01", "2026-01-03"]);
    expect(result.sourceKpiByRow).toHaveLength(2);
    expect(result.sourceKpiByRow[1].revpar).toBeCloseTo(98.04, 2);
  });
});

describe("parseMontecalliniPmsCsv - sourceKpiByRow", () => {
  it("legge OCCUP -> occupancyFraction, RPAR -> revpar, ADR -> adr, allineato 1:1 con rows", () => {
    const csv = [
      "DATA;CP;CV;PAX;RICAVI TRAT;ADR;RPAR;OCCUP",
      "21/05/2026 gio;29;48;54;3.245,80;111,92;67,62;60,4%",
    ].join("\n");
    const result = parseMontecalliniPmsCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.sourceKpiByRow).toHaveLength(1);
    expect(result.sourceKpiByRow[0].revpar).toBeCloseTo(67.62, 2);
    expect(result.sourceKpiByRow[0].adr).toBeCloseTo(111.92, 2);
    expect(result.sourceKpiByRow[0].occupancyFraction).toBeCloseTo(0.604, 4);
  });

  it("colonna RPAR assente -> revpar null (no-op a valle), nessun errore", () => {
    const csv = ["DATA;CP;CV;PAX;RICAVI TRAT", "21/05/2026 gio;29;48;54;3.245,80"].join("\n");
    const result = parseMontecalliniPmsCsv(csv);
    expect(result.errors).toHaveLength(0);
    expect(result.sourceKpiByRow[0]).toEqual({ occupancyFraction: null, revpar: null, adr: null });
  });
});

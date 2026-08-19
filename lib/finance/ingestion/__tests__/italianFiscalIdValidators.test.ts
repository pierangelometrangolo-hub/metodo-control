import { describe, expect, it } from "vitest";
import { isValidItalianVat, isValidItalianFiscalCode } from "../italianFiscalIdValidators";

describe("isValidItalianVat", () => {
  it("accetta P.IVA reali verificate in questa sessione (GAP GROUP, Villa Neviera, Arco Cadura)", () => {
    expect(isValidItalianVat("05320500753")).toBe(true);
    expect(isValidItalianVat("01430150746")).toBe(true);
    expect(isValidItalianVat("04641400751")).toBe(true);
  });

  it("respinge una P.IVA con check digit sbagliato", () => {
    expect(isValidItalianVat("05320500750")).toBe(false);
  });

  it("respinge formati non validi (lunghezza, caratteri non numerici, null)", () => {
    expect(isValidItalianVat("123")).toBe(false);
    expect(isValidItalianVat("IT05320500753")).toBe(false);
    expect(isValidItalianVat(null)).toBe(false);
  });
});

describe("isValidItalianFiscalCode", () => {
  it("accetta Codici Fiscali reali dal batch 2025 (Patrick Pisano, Sea Garden) e da Arco Cadura", () => {
    expect(isValidItalianFiscalCode("PSNPRK79M04Z133G")).toBe(true);
    expect(isValidItalianFiscalCode("CLZPLA80C09E506F")).toBe(true);
    expect(isValidItalianFiscalCode("NBLLSN77E57D862T")).toBe(true);
  });

  it("respinge un CF con carattere di controllo sbagliato", () => {
    expect(isValidItalianFiscalCode("PSNPRK79M04Z133A")).toBe(false);
  });

  it("respinge formati non validi (lunghezza, pattern posizionale errato, null)", () => {
    expect(isValidItalianFiscalCode("123")).toBe(false);
    expect(isValidItalianFiscalCode("0123456789012345")).toBe(false);
    expect(isValidItalianFiscalCode(null)).toBe(false);
  });
});

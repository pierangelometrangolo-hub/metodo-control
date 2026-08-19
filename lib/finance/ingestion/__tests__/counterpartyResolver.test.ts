import { describe, expect, it } from "vitest";
import { resolveCounterparty, type CounterpartyRecord, type CounterpartyRepository } from "../counterpartyResolver";
import type { PartyInfo } from "../types";

function fakeRepo(records: CounterpartyRecord[]): CounterpartyRepository {
  return {
    async findByVatNumber(vat) {
      return records.filter((r) => r.vatNumber === vat);
    },
    async findByFiscalCode(cf) {
      return records.filter((r) => r.fiscalCode === cf);
    },
    async findByCrmClientVatNumber() {
      return []; // non esercitato in questi test - copertura dedicata non richiesta dalla sezione 20
    },
    async findAll() {
      return records;
    },
  };
}

const party = (overrides: Partial<PartyInfo>): PartyInfo => ({
  legalName: null,
  vatNumber: null,
  fiscalCode: null,
  address: null,
  pec: null,
  sdiCode: null,
  ...overrides,
});

describe("counterpartyResolver", () => {
  it("VAT exact match", async () => {
    const repo = fakeRepo([{ id: "cp-1", displayName: "Villa Neviera", legalName: "Cantina Due Palme", vatNumber: "01430150746", fiscalCode: null, crmClientId: null }]);
    const result = await resolveCounterparty(party({ vatNumber: "01430150746" }), repo);
    expect(result.status).toBe("matched");
    expect(result.matchMethod).toBe("vat_exact");
    expect(result.matchedCounterpartyId).toBe("cp-1");
  });

  it("VAT exact match anche con prefisso paese IT nell'XML e vat_number senza prefisso in DB (bug reale trovato sul batch 2025 - Cantine Due Palme)", async () => {
    const repo = fakeRepo([{ id: "cp-1", displayName: "Villa Neviera", legalName: "Cantina Due Palme soc. coop. Agricola", vatNumber: "01430150746", fiscalCode: null, crmClientId: null }]);
    const result = await resolveCounterparty(party({ vatNumber: "IT01430150746", legalName: "CANTINE DUE PALME SOCIETA' COOPERATIVA" }), repo);
    expect(result.status).toBe("matched");
    expect(result.matchMethod).toBe("vat_exact");
    expect(result.matchedCounterpartyId).toBe("cp-1");
  });

  it("CF exact match quando manca la P.IVA", async () => {
    const repo = fakeRepo([
      { id: "cp-2", displayName: "Palazzo Arco Cadura", legalName: null, vatNumber: "04641400751", fiscalCode: "NBLLSN77E57D862T", crmClientId: null },
    ]);
    const result = await resolveCounterparty(party({ vatNumber: "99999999999", fiscalCode: "NBLLSN77E57D862T" }), repo);
    // La P.IVA non matcha nessuna riga, il CF si': deve scendere al metodo successivo.
    expect(result.status).toBe("matched");
    expect(result.matchMethod).toBe("fiscal_code_exact");
    expect(result.matchedCounterpartyId).toBe("cp-2");
  });

  it("nessun match -> unresolved, nessuna counterparty proposta come creata", async () => {
    const repo = fakeRepo([{ id: "cp-1", displayName: "Villa Neviera", legalName: null, vatNumber: "01430150746", fiscalCode: null, crmClientId: null }]);
    const incoming = party({ vatNumber: "00000000000", legalName: "SOGGETTO SCONOSCIUTO SRL" });
    const result = await resolveCounterparty(incoming, repo);
    expect(result.status).toBe("unresolved");
    expect(result.matchedCounterpartyId).toBeNull();
    expect(result.proposedNewCounterparty).toEqual(incoming);
  });

  it("ambiguous quando piu' counterparty condividono lo stesso VAT (dato anomalo)", async () => {
    const repo = fakeRepo([
      { id: "cp-a", displayName: "A", legalName: null, vatNumber: "11111111111", fiscalCode: null, crmClientId: null },
      { id: "cp-b", displayName: "B", legalName: null, vatNumber: "11111111111", fiscalCode: null, crmClientId: null },
    ]);
    const result = await resolveCounterparty(party({ vatNumber: "11111111111" }), repo);
    expect(result.status).toBe("ambiguous");
    expect(result.ambiguousCandidateIds.sort()).toEqual(["cp-a", "cp-b"]);
  });

  it("nome normalizzato produce solo 'proposed', mai 'matched'", async () => {
    const repo = fakeRepo([{ id: "cp-1", displayName: "Kelina", legalName: "CANTINE DUE PALME SOCIETA' COOPERATIVA", vatNumber: null, fiscalCode: null, crmClientId: null }]);
    const result = await resolveCounterparty(party({ legalName: "Cantine Due Palme S.r.l." }), repo);
    expect(result.status).toBe("proposed");
    expect(result.matchMethod).toBe("normalized_name");
  });
});

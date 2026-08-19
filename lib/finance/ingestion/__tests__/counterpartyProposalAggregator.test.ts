import { describe, expect, it } from "vitest";
import { buildCounterpartyProposals } from "../counterpartyProposalAggregator";
import type { CounterpartyRepository, CounterpartyRecord } from "../counterpartyResolver";
import type { DocumentAudit, PartyInfo } from "../types";

function fakeRepo(records: CounterpartyRecord[]): CounterpartyRepository {
  return {
    async findByVatNumber(vat) {
      return records.filter((r) => r.vatNumber === vat);
    },
    async findByFiscalCode(cf) {
      return records.filter((r) => r.fiscalCode === cf);
    },
    async findByCrmClientVatNumber() {
      return [];
    },
    async findAll() {
      return records;
    },
  };
}

function fakeAudit(party: Partial<PartyInfo>, net: number, gross: number): DocumentAudit {
  return {
    document: {
      counterpartyRaw: { legalName: null, vatNumber: null, fiscalCode: null, address: null, pec: null, sdiCode: null, ...party },
      netAmount: net,
      grossAmount: gross,
    },
  } as unknown as DocumentAudit;
}

describe("counterpartyProposalAggregator", () => {
  it("raggruppa piu' documenti della stessa identita' fiscale in una sola proposta, sommando gli importi", async () => {
    const repo = fakeRepo([]);
    const audits = [
      fakeAudit({ vatNumber: "IT02925500759", legalName: "LIDO VENERE S.R.L." }, 100, 122),
      fakeAudit({ vatNumber: "IT02925500759", legalName: "LIDO VENERE S.R.L." }, 200, 244),
    ];
    const proposals = await buildCounterpartyProposals(audits, repo);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].documentCount).toBe(2);
    expect(proposals[0].netAmount).toBe(300);
  });

  it("controparte gia' esistente -> proposedAction 'existing_match'", async () => {
    const repo = fakeRepo([{ id: "cp-1", displayName: "Villa Neviera", legalName: null, vatNumber: "01430150746", fiscalCode: null, crmClientId: null }]);
    const audits = [fakeAudit({ vatNumber: "IT01430150746" }, 100, 122)];
    const proposals = await buildCounterpartyProposals(audits, repo);
    expect(proposals[0].proposedAction).toBe("existing_match");
    expect(proposals[0].confidence).toBe("high");
  });

  it("nessun match, P.IVA valida (checksum verificato) e coerente nel batch -> 'safe_to_create' alta confidenza", async () => {
    const repo = fakeRepo([]);
    const audits = [fakeAudit({ vatNumber: "IT02925500759", legalName: "LIDO VENERE S.R.L." }, 100, 122)];
    const proposals = await buildCounterpartyProposals(audits, repo);
    expect(proposals[0].proposedAction).toBe("safe_to_create");
    expect(proposals[0].confidence).toBe("high");
  });

  it("P.IVA formalmente a 11 cifre ma con checksum ERRATO -> 'review', non safe_to_create (identificativo anomalo)", async () => {
    const repo = fakeRepo([]);
    const audits = [fakeAudit({ vatNumber: "IT02925500750", legalName: "SOGGETTO CON PIVA ERRATA SRL" }, 100, 122)];
    const proposals = await buildCounterpartyProposals(audits, repo);
    expect(proposals[0].proposedAction).toBe("review");
    expect(proposals[0].reason).toContain("anomalo");
  });

  it("nessun match e nessun identificativo affidabile -> 'review'", async () => {
    const repo = fakeRepo([]);
    const audits = [fakeAudit({ vatNumber: null, fiscalCode: null, legalName: "SOGGETTO SENZA IDENTIFICATIVI" }, 100, 122)];
    const proposals = await buildCounterpartyProposals(audits, repo);
    expect(proposals[0].proposedAction).toBe("review");
  });

  it("persona fisica senza P.IVA ma con Codice Fiscale valido (checksum verificato) -> 'safe_to_create' alta confidenza (caso reale del batch 2025)", async () => {
    const repo = fakeRepo([]);
    const audits = [fakeAudit({ vatNumber: null, fiscalCode: "PSNPRK79M04Z133G", legalName: "PATRICK PISANO'" }, 1392.62, 1699)];
    const proposals = await buildCounterpartyProposals(audits, repo);
    expect(proposals[0].proposedAction).toBe("safe_to_create");
    expect(proposals[0].confidence).toBe("high");
  });

  it("dati fiscali discordanti: stessa P.IVA con ragioni sociali diverse nel batch -> 'review'", async () => {
    const repo = fakeRepo([]);
    const audits = [
      fakeAudit({ vatNumber: "IT12345678903", legalName: "ALFA SRL" }, 100, 122),
      fakeAudit({ vatNumber: "IT12345678903", legalName: "BETA SRL" }, 100, 122),
    ];
    const proposals = await buildCounterpartyProposals(audits, repo);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].proposedAction).toBe("review");
    expect(proposals[0].reason).toContain("discordanti");
  });

  it("collisione: stessa ragione sociale normalizzata sotto due P.IVA distinte nel batch -> entrambe 'review'", async () => {
    const repo = fakeRepo([]);
    const audits = [
      fakeAudit({ vatNumber: "IT02925500759", legalName: "GAMMA SRL" }, 100, 122),
      fakeAudit({ vatNumber: "IT12345678903", legalName: "GAMMA S.R.L." }, 100, 122), // stesso nome normalizzato, P.IVA diversa
    ];
    const proposals = await buildCounterpartyProposals(audits, repo);
    expect(proposals).toHaveLength(2);
    for (const p of proposals) {
      expect(p.proposedAction).toBe("review");
      expect(p.reason).toContain("Collisione");
    }
  });
});

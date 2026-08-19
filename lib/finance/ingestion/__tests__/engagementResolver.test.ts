import { describe, expect, it } from "vitest";
import { resolveEngagementCandidate, type EngagementRecord, type EngagementRepository } from "../engagementResolver";

function fakeRepo(records: EngagementRecord[]): EngagementRepository {
  return {
    async findByCounterpartyId() {
      return records;
    },
  };
}

describe("engagementResolver", () => {
  it("un solo engagement sulla counterparty -> matched, alta confidenza", async () => {
    const repo = fakeRepo([{ id: "eng-villa", displayName: "Villa Neviera", status: "active" }]);
    const result = await resolveEngagementCandidate("cp-1", "Fee GAP maggio 2025", repo);
    expect(result.status).toBe("matched");
    expect(result.candidateEngagementId).toBe("eng-villa");
    expect(result.confidence).toBe("high");
  });

  it("caso Cantine Due Palme: due engagement sulla stessa counterparty (Kelina + Villa Neviera), nessun segnale testuale -> ambiguous, mai deciso da solo", async () => {
    const repo = fakeRepo([
      { id: "eng-kelina", displayName: "Kelina", status: "closed" },
      { id: "eng-villa", displayName: "Villa Neviera", status: "active" },
    ]);
    const result = await resolveEngagementCandidate("cp-cantine-due-palme", "Fee GAP consulenza maggio 2025", repo);
    expect(result.status).toBe("ambiguous");
    expect(result.candidateEngagementId).toBeNull();
    expect(result.ambiguousCandidates.map((c) => c.displayName).sort()).toEqual(["Kelina", "Villa Neviera"]);
  });

  it("caso Cantine Due Palme con segnale testuale: il nome di un engagement compare nel documento -> matched a confidenza media, l'altro resta visibile come alternativa", async () => {
    const repo = fakeRepo([
      { id: "eng-kelina", displayName: "Kelina", status: "closed" },
      { id: "eng-villa", displayName: "Villa Neviera", status: "active" },
    ]);
    const result = await resolveEngagementCandidate("cp-cantine-due-palme", "Consulenza Kelina - fee maggio 2025", repo);
    expect(result.status).toBe("matched");
    expect(result.candidateEngagementId).toBe("eng-kelina");
    expect(result.confidence).toBe("medium"); // mai "high": e' un segnale testuale, non un identificativo strutturale
    expect(result.ambiguousCandidates.map((c) => c.displayName)).toContain("Villa Neviera");
  });

  it("nessun engagement per la counterparty -> unresolved", async () => {
    const repo = fakeRepo([]);
    const result = await resolveEngagementCandidate("cp-nuova", "descrizione qualsiasi", repo);
    expect(result.status).toBe("unresolved");
  });

  it("counterparty non risolta -> unresolved senza nemmeno interrogare il repository", async () => {
    const repo = fakeRepo([{ id: "eng-x", displayName: "X", status: "active" }]);
    const result = await resolveEngagementCandidate(null, "descrizione", repo);
    expect(result.status).toBe("unresolved");
  });
});

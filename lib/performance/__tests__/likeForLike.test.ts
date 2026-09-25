import { describe, expect, it } from "vitest";
import {
  computeLikeForLike,
  isPortfolioMember,
  type LikeForLikeStructureInput,
  type PortfolioMembership,
} from "../likeForLike";

const Y2026 = { start: "2026-01-01", end: "2026-12-31" };
const Y2025 = { start: "2025-01-01", end: "2025-12-31" };

function member(structure_id: string, valid_from: string | null, valid_to: string | null): PortfolioMembership {
  return { structure_id, valid_from, valid_to };
}

function s(id: string, actual: number | null, reference: number | null): LikeForLikeStructureInput {
  return { id, name: id.toUpperCase(), actual, reference };
}

describe("isPortfolioMember", () => {
  it("interseca il periodo, estremi inclusi", () => {
    const m = [member("a", "2025-01-01", "2025-12-31")];
    expect(isPortfolioMember(m, "a", Y2025)).toBe(true);
    expect(isPortfolioMember(m, "a", { start: "2025-12-31", end: "2026-01-31" })).toBe(true);
    expect(isPortfolioMember(m, "a", Y2026)).toBe(false);
  });

  it("valid_from/valid_to null = intervallo aperto", () => {
    expect(isPortfolioMember([member("a", null, null)], "a", Y2025)).toBe(true);
    expect(isPortfolioMember([member("a", "2026-03-01", null)], "a", Y2026)).toBe(true);
    expect(isPortfolioMember([member("a", "2026-03-01", null)], "a", Y2025)).toBe(false);
  });

  it("piu' engagement per struttura: basta uno che copra il periodo", () => {
    const m = [member("a", "2022-01-01", "2023-12-31"), member("a", "2025-06-01", "2026-12-31")];
    expect(isPortfolioMember(m, "a", Y2025)).toBe(true);
    expect(isPortfolioMember(m, "a", { start: "2024-01-01", end: "2024-12-31" })).toBe(false);
  });

  it("struttura senza engagement: mai membro", () => {
    expect(isPortfolioMember([member("b", null, null)], "a", Y2025)).toBe(false);
  });
});

describe("computeLikeForLike", () => {
  const memberships = [
    member("rollo", "2025-01-01", "2026-12-31"),
    member("arco", "2025-01-01", "2026-12-31"),
    member("neviera", "2025-01-01", "2026-12-31"),
    member("dimora", "2026-01-01", "2026-12-31"),
    member("sangiorgio", "2026-01-01", "2026-12-31"),
    member("montecallini", "2026-01-01", "2026-12-31"),
  ];

  it("popolazione da membership, non da presenza dati storici", () => {
    const l4l = computeLikeForLike(
      [
        s("rollo", 110, 100),
        s("arco", 220, 200),
        s("neviera", 330, 300),
        s("dimora", 50, null),
        // Dati 2025 presenti ma struttura non nel portfolio 2025: esclusa.
        s("sangiorgio", 400, 350),
        s("montecallini", 900, 800),
      ],
      memberships,
      2026,
      2025
    );
    expect(l4l.included.map((x) => x.id)).toEqual(["rollo", "arco", "neviera"]);
    expect(l4l.total).toBe(6);
    expect(l4l.actual).toBe(660);
    expect(l4l.reference).toBe(600);
    expect(l4l.variancePct).toBeCloseTo(0.1);
    expect(l4l.excluded).toEqual([
      { id: "dimora", name: "DIMORA", reasons: ["not_in_previous_portfolio"] },
      { id: "sangiorgio", name: "SANGIORGIO", reasons: ["not_in_previous_portfolio"] },
      { id: "montecallini", name: "MONTECALLINI", reasons: ["not_in_previous_portfolio"] },
    ]);
  });

  it("struttura uscita dal portfolio: esclusa come non presente nell'anno corrente", () => {
    const l4l = computeLikeForLike(
      [s("rollo", 110, 100), s("uscita", 50, 40)],
      [...memberships, member("uscita", "2025-01-01", "2025-12-31")],
      2026,
      2025
    );
    expect(l4l.included.map((x) => x.id)).toEqual(["rollo"]);
    expect(l4l.excluded).toEqual([{ id: "uscita", name: "USCITA", reasons: ["not_in_current_portfolio"] }]);
  });

  it("mai nel portfolio: entrambi i motivi", () => {
    const l4l = computeLikeForLike([s("x", 10, 10)], memberships, 2026, 2025);
    expect(l4l.excluded[0].reasons).toEqual(["not_in_previous_portfolio", "not_in_current_portfolio"]);
    expect(l4l.actual).toBeNull();
    expect(l4l.reference).toBeNull();
    expect(l4l.variancePct).toBeNull();
  });

  it("membro in entrambi i periodi ma senza dato di confronto: escluso, non zero", () => {
    const l4l = computeLikeForLike([s("rollo", 110, 100), s("arco", 220, null)], memberships, 2026, 2025);
    expect(l4l.actual).toBe(110);
    expect(l4l.reference).toBe(100);
    expect(l4l.excluded).toEqual([{ id: "arco", name: "ARCO", reasons: ["missing_reference_data"] }]);
  });

  it("membro in entrambi i periodi ma senza Actual: escluso", () => {
    const l4l = computeLikeForLike([s("rollo", null, 100)], memberships, 2026, 2025);
    expect(l4l.included).toEqual([]);
    expect(l4l.excluded[0].reasons).toEqual(["missing_current_data"]);
    expect(l4l.actual).toBeNull();
  });

  it("riferimento a zero: variazione null, mai Infinity", () => {
    const l4l = computeLikeForLike([s("rollo", 110, 0)], memberships, 2026, 2025);
    expect(l4l.reference).toBe(0);
    expect(l4l.variancePct).toBeNull();
  });

  it("membership annuale, non sul mese visualizzato: engagement da novembre 2025 incluso", () => {
    // Nel portfolio 2025 (interseca 01/01-31/12/2025) e 2026: inclusa anche
    // se il confronto visualizzato e' settembre 2026 vs settembre 2025.
    const m = [member("nuova", "2025-11-01", null)];
    const l4l = computeLikeForLike([s("nuova", 10, 8)], m, 2026, 2025);
    expect(l4l.included.map((x) => x.id)).toEqual(["nuova"]);
    expect(l4l.actual).toBe(10);
    expect(l4l.reference).toBe(8);
  });

  it("engagement chiuso a marzo 2026: nel portfolio 2026, incluso", () => {
    const m = [member("chiusa", "2024-01-01", "2026-03-31")];
    const l4l = computeLikeForLike([s("chiusa", 10, 8)], m, 2026, 2025);
    expect(l4l.included.map((x) => x.id)).toEqual(["chiusa"]);
  });

  it("engagement iniziato a gennaio 2026: fuori dal portfolio 2025, escluso", () => {
    const m = [member("nuova", "2026-01-01", null)];
    const l4l = computeLikeForLike([s("nuova", 10, 8)], m, 2026, 2025);
    expect(l4l.excluded[0].reasons).toEqual(["not_in_previous_portfolio"]);
  });

  it("nessuna membership disponibile: tutte escluse", () => {
    const l4l = computeLikeForLike([s("rollo", 110, 100)], [], 2026, 2025);
    expect(l4l.included).toEqual([]);
    expect(l4l.actual).toBeNull();
  });
});

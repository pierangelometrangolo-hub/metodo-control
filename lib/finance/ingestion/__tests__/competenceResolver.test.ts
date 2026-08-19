import { describe, expect, it } from "vitest";
import { resolveCompetence } from "../competenceResolver";

describe("competenceResolver", () => {
  it("competenza da periodo strutturato XML (priorita' massima)", () => {
    const result = resolveCompetence("2025-05-01", "2025-05-31", "descrizione ignorata quando c'e' il periodo strutturato");
    expect(result.status).toBe("resolved");
    expect(result.method).toBe("structured_period");
    expect(result.competenceFrom).toBe("2025-05-01");
    expect(result.competenceTo).toBe("2025-05-31");
  });

  it("competenza da mese/anno in descrizione quando manca il periodo strutturato", () => {
    const result = resolveCompetence(null, null, "Consulenza sales e Marketing dicembre 2024");
    expect(result.status).toBe("resolved");
    expect(result.method).toBe("description_month_year");
    expect(result.competenceFrom).toBe("2024-12-01");
    expect(result.competenceTo).toBe("2024-12-31");
  });

  it("caso reale: fattura emessa a gennaio con competenza dicembre precedente", () => {
    // La data documento (gennaio 2026, non passata qui) non deve MAI
    // influenzare la competenza - solo la descrizione o il periodo XML.
    const result = resolveCompetence(null, null, "Fee GAP dicembre 2025");
    expect(result.competenceFrom).toBe("2025-12-01");
    expect(result.competenceTo).toBe("2025-12-31");
  });

  it("[TEST E regression V00003 - Palazzo San Lazzaro] document_date 2025 e competence 2024 sono valori legittimamente diversi, mai forzati a coincidere", () => {
    // Caso reale: V00003 emessa il 17/01/2025, descrizione "Consulenza sales
    // e Marketing Dicembre 2024" -> competenza dicembre 2024. La data
    // documento (non passata a questa funzione per costruzione) non entra
    // mai nel calcolo.
    const result = resolveCompetence(null, null, "Consulenza sales e Marketing Dicembre 2024");
    expect(result.status).toBe("resolved");
    expect(result.competenceFrom).toBe("2024-12-01");
    expect(result.competenceTo).toBe("2024-12-31");
  });

  it("nessun periodo ne' mese riconoscibile -> missing_data, mai inventata", () => {
    const result = resolveCompetence(null, null, "Acconto fattura");
    expect(result.status).toBe("missing_data");
    expect(result.method).toBe("unresolved");
    expect(result.competenceFrom).toBeNull();
    expect(result.competenceTo).toBeNull();
  });
});

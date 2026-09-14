import { describe, expect, it } from "vitest";
import { runNationalityGuardrails } from "../nationality";
import { runGuardrails } from "../runner";
import type { GuardrailNationalityRow } from "../types";

describe("GR-C06 (nationality) - chiave (stay_date, nationality) duplicata", () => {
  it("stessa coppia giorno+nazionalita' due volte -> finding BLOCKING-FILE, nessuna deduplica", () => {
    const rows: GuardrailNationalityRow[] = [
      { stayDate: "2026-01-01", nationality: "ITALIA", presences: 3 },
      { stayDate: "2026-01-01", nationality: "ITALIA", presences: 5 },
      { stayDate: "2026-01-01", nationality: "FRANCIA", presences: 2 },
    ];
    const findings = runNationalityGuardrails(rows);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("GR-C06");
    expect(findings[0].severity).toBe("blocking");
    expect(findings[0].scope).toBe("file");
    expect(findings[0].dataset).toBe("nationality");
    expect(findings[0].context?.totalExtraRows).toBe(1);
  });

  it("stessa nazionalita' in giorni diversi -> nessuna finding (chiave e' la COPPIA)", () => {
    const rows: GuardrailNationalityRow[] = [
      { stayDate: "2026-01-01", nationality: "ITALIA", presences: 3 },
      { stayDate: "2026-01-02", nationality: "ITALIA", presences: 4 },
    ];
    expect(runNationalityGuardrails(rows)).toHaveLength(0);
  });

  it("l'input non viene mutato (nessun filtro, nessuna somma)", () => {
    const rows: GuardrailNationalityRow[] = [
      { stayDate: "2026-01-01", nationality: "ITALIA", presences: 3 },
      { stayDate: "2026-01-01", nationality: "ITALIA", presences: 5 },
    ];
    runNationalityGuardrails(rows);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.presences)).toEqual([3, 5]);
  });

  it("via runGuardrails: dataset nationality esegue SOLO GR-C06, nessun controllo sui volumi", () => {
    const result = runGuardrails({
      dataset: "nationality",
      rows: [
        { stayDate: "2026-01-01", nationality: "ITALIA", presences: 0 },
        { stayDate: "2026-01-01", nationality: "FRANCIA", presences: 999999 },
      ],
    });
    expect(result.findings).toHaveLength(0);
  });
});

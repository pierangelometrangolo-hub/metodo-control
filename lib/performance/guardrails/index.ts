// ============ Performance Guardrails V0 ============
//
// Guardrails V0 shadow mode — no enforcement.
//
// Punto d'ingresso unico del livello guardrail. Vedi types.ts per il
// contratto e runner.ts per GUARDRAILS_SHADOW_MODE.

export * from "./types";
export { GUARDRAIL_REGISTRY, guardrailMeta, guardrailOrder } from "./registry";
export type { GuardrailId, GuardrailMeta } from "./registry";
export {
  GUARDRAILS_SHADOW_MODE,
  runGuardrails,
  groupFindingsForDisplay,
} from "./runner";
export type { RunGuardrailsInput, GuardrailFindingGroup } from "./runner";

import type { BusinessUnitCandidate, ClassificationProposal, LineClassificationProposal, NormalizedDocumentLine } from "./types";

export type ClassificationRule = {
  pattern: RegExp;
  businessUnitCode: string;
  projectCode?: string;
  confidence: "high" | "medium" | "low";
  note: string;
};

// Regole configurabili, non hard-coded nel resolver: aggiungere/rimuovere
// pattern non richiede toccare la logica sotto.
export const DEFAULT_CLASSIFICATION_RULES: ClassificationRule[] = [
  { pattern: /masterclass/i, businessUnitCode: "formazione", confidence: "high", note: "Masterclass" },
  { pattern: /breakfast\s*wow/i, businessUnitCode: "formazione", confidence: "high", note: "Masterclass Breakfast Wow" },
  { pattern: /disintermediazione/i, businessUnitCode: "formazione", confidence: "high", note: "Masterclass Disintermediazione" },
  { pattern: /l['’]?ai\s+spiegata\s+semplice/i, businessUnitCode: "formazione", confidence: "high", note: "Masterclass L'AI Spiegata Semplice" },
  {
    pattern: /profession[ei]\s+mystery\s+guest/i,
    businessUnitCode: "formazione",
    confidence: "high",
    note: "Corso Professione Mystery Guest - confermato Formazione",
  },
  { pattern: /puglia\s+destination\s+off|\bpdo\b/i, businessUnitCode: "eventi", projectCode: "pdo", confidence: "high", note: "Puglia Destination Off / PDO" },
  {
    pattern: /networking\s+post\s+btm\s*2025|\bbtm\s*2025\b/i,
    businessUnitCode: "eventi",
    projectCode: "btm-2025",
    confidence: "high",
    note: "Networking Post BTM 2025 - confermato Eventi / Project BTM 2025",
  },
  // Deliberatamente NON un bare "BIT" - solo nel contesto esplicito di
  // "co-partecipazione BIT", il pattern confermato dal business (fa parte
  // del rapporto Sales & Marketing dei clienti Consulenza, non e' un
  // progetto Eventi MeToDo). Una menzione generica di "BIT" fuori da
  // questo contesto non matcha nulla, resta unclassified per revisione.
  {
    pattern: /co-?partecipazione\s+bit\b/i,
    businessUnitCode: "consulenza",
    confidence: "high",
    note: "Co-partecipazione BIT nell'ambito Sales & Marketing - confermato Consulenza (non e' un progetto Eventi MeToDo)",
  },
  {
    pattern: /consulenza\s+sales|sales\s*(?:e|&)\s*marketing|attivit[aà]\s+sales/i,
    businessUnitCode: "consulenza",
    confidence: "high",
    note: "Consulenza Sales & Marketing",
  },
];

// Override puntuali per singolo documento - DELIBERATAMENTE separati dalle
// regole generiche sopra. "Attivita' di supporto commerciale" e simili non
// diventano MAI una regola per pattern: la stessa descrizione potrebbe in
// futuro appartenere a una vera consulenza. Qui si registra una decisione
// di business su documenti specifici (per numero), non un pattern
// generalizzabile - la distinzione e' strutturale, non solo di commento.
export type DocumentClassificationOverride = {
  documentNumber: string;
  businessUnitCode: string;
  projectCode?: string;
  reason: string;
};

// Override SOLO per l'Initiative (tappa/edizione sotto un Project), mai per
// BU/Project - quelli restano quelli gia' dedotti (da regola generica o da
// DocumentClassificationOverride). Applicato in coda, come step separato:
// la ragione "BU/Project" resta genuina (pattern-matched), solo l'Initiative
// e' una decisione puntuale confermata dal business per QUEL documento -
// mai propagata per somiglianza testuale ad altri documenti con la stessa
// descrizione generica (es. "Puglia Destination Off" senza citta').
export type InitiativeDocumentOverride = {
  documentNumber: string;
  initiativeCode: string;
  reason: string;
};

// Regola SEMANTICA (non per numero documento) per l'Initiative - si applica
// SOLO dopo che BU/Project sono gia' risolti a livello documento (mai prima:
// "PDO" da solo non deve mai risolvere un'Initiative, "NY"/"Londra" da soli
// fuori da un documento gia' Eventi/PDO non devono mai risolvere nulla).
// Riutilizzabile per futuri Project/tappe - preferita esplicitamente
// dal business alle eccezioni per numero documento (vedi
// InitiativeDocumentOverride, riservato solo a decisioni puntuali come
// L00002 dove il testo non contiene alcun segnale).
export type InitiativeRule = {
  pattern: RegExp;
  businessUnitCode: string;
  projectCode: string;
  initiativeCode: string;
  note: string;
};

export const DEFAULT_INITIATIVE_RULES: InitiativeRule[] = [
  { pattern: /\bNY\b|new\s*york/i, businessUnitCode: "eventi", projectCode: "pdo", initiativeCode: "new-york-2025", note: "Puglia Destination Off - segnale New York/NY" },
  { pattern: /londra|london/i, businessUnitCode: "eventi", projectCode: "pdo", initiativeCode: "londra-2025", note: "Puglia Destination Off - segnale Londra/London" },
];

function applyInitiativeCode(base: ClassificationProposal, initiativeCode: string): ClassificationProposal {
  return {
    ...base,
    documentLevelInitiativeCode: initiativeCode,
    lineProposals: base.lineProposals.map((lp) =>
      lp.projectCandidateCode === base.documentLevelProjectCode ? { ...lp, initiativeCandidateCode: initiativeCode } : lp
    ),
  };
}

function matchRule(description: string | null, rules: ClassificationRule[]): ClassificationRule | null {
  if (!description) return null;
  return rules.find((r) => r.pattern.test(description)) ?? null;
}

function toCandidate(rule: ClassificationRule): BusinessUnitCandidate {
  return { code: rule.businessUnitCode, confidence: rule.confidence, reason: rule.note };
}

// Classifica un documento a partire dalle sue righe. Regola di
// aggregazione (mai la serie, mai una parola isolata su una riga senza
// contesto):
//   - ogni riga con un pattern riconosciuto ottiene un candidate proprio
//   - una riga SENZA pattern non ottiene un candidate proprio - eredita
//     quello del documento se le righe CON pattern sono unanimi (stesso
//     comportamento di finance_document_lines: NULL = eredita l'header)
//   - se le righe con pattern sono unanimi -> proposta "classified" a
//     livello documento
//   - se le righe con pattern disaccordano tra loro -> "classified_at_line_level"
//   - se nessuna riga ha un pattern riconosciuto -> "unclassified"
export function classifyDocument(
  lines: NormalizedDocumentLine[],
  documentSeries: string | null,
  rules: ClassificationRule[] = DEFAULT_CLASSIFICATION_RULES,
  documentNumber: string | null = null,
  overrides: DocumentClassificationOverride[] = [],
  initiativeOverrides: InitiativeDocumentOverride[] = [],
  initiativeRules: InitiativeRule[] = DEFAULT_INITIATIVE_RULES
): ClassificationProposal {
  const base = classifyDocumentBusinessUnitAndProject(lines, documentSeries, rules, documentNumber, overrides);

  // L'Initiative si applica solo sopra BU/Project gia' risolti a livello
  // documento (schema: finance_initiatives.project_id NOT NULL) - mai
  // prima. Se il documento non ha una classificazione pulita a livello
  // header (unclassified/classified_at_line_level), nessuna Initiative
  // viene assegnata, ne' da override ne' da regola generica.
  if (!base.documentLevelBusinessUnit || !base.documentLevelProjectCode) return base;

  // 1. Override puntuale per documento (es. L00002 - nessun segnale
  // testuale, decisione business confermata) - ha sempre precedenza.
  const initiativeOverride = documentNumber ? initiativeOverrides.find((o) => o.documentNumber === documentNumber) : undefined;
  if (initiativeOverride) return applyInitiativeCode(base, initiativeOverride.initiativeCode);

  // 2. Regola semantica generica: scansiona le righe cercando un segnale
  // esplicito coerente con BU/Project gia' risolti. Se piu' di un
  // initiativeCode distinto trova riscontro nello stesso documento
  // (segnali contraddittori, es. sia "NY" sia "Londra"), NON si indovina -
  // l'Initiative resta null, da segnalare per revisione manuale.
  const matchedCodes = new Set<string>();
  for (const line of lines) {
    if (!line.description) continue;
    for (const rule of initiativeRules) {
      if (rule.businessUnitCode !== base.documentLevelBusinessUnit.code) continue;
      if (rule.projectCode !== base.documentLevelProjectCode) continue;
      if (rule.pattern.test(line.description)) matchedCodes.add(rule.initiativeCode);
    }
  }

  if (matchedCodes.size === 1) return applyInitiativeCode(base, [...matchedCodes][0]);
  return base; // 0 match (nessuna evidenza) o >1 match (contraddittorio): mai indovinare.
}

function classifyDocumentBusinessUnitAndProject(
  lines: NormalizedDocumentLine[],
  documentSeries: string | null,
  rules: ClassificationRule[],
  documentNumber: string | null,
  overrides: DocumentClassificationOverride[]
): ClassificationProposal {
  const seriesSignalBase = {
    series: documentSeries,
    note: "Segnale contabile, mai usato come prova di classificazione - solo per analisi statistica serie/BU nel report.",
  };

  const override = documentNumber ? overrides.find((o) => o.documentNumber === documentNumber) : undefined;
  if (override) {
    const candidate: BusinessUnitCandidate = { code: override.businessUnitCode, confidence: "high", reason: `Override documento-specifico: ${override.reason}` };
    return {
      status: "classified",
      documentLevelBusinessUnit: candidate,
      documentLevelProjectCode: override.projectCode ?? null,
      documentLevelInitiativeCode: null,
      lineProposals: lines.map((line) => ({
        lineNumber: line.lineNumber,
        businessUnitCandidate: candidate,
        projectCandidateCode: override.projectCode ?? null,
        initiativeCandidateCode: null,
      })),
      seriesSignal: seriesSignalBase,
    };
  }

  const lineProposals: LineClassificationProposal[] = lines.map((line) => {
    const rule = matchRule(line.description, rules);
    return {
      lineNumber: line.lineNumber,
      businessUnitCandidate: rule ? toCandidate(rule) : null,
      projectCandidateCode: rule?.projectCode ?? null,
      initiativeCandidateCode: null,
    };
  });

  const withSignal = lineProposals.filter((p) => p.businessUnitCandidate !== null);
  const distinctBusinessUnits = new Set(withSignal.map((p) => p.businessUnitCandidate!.code));

  if (distinctBusinessUnits.size === 0) {
    return {
      status: "unclassified",
      documentLevelBusinessUnit: null,
      documentLevelProjectCode: null,
      documentLevelInitiativeCode: null,
      lineProposals,
      seriesSignal: seriesSignalBase,
    };
  }

  if (distinctBusinessUnits.size === 1) {
    const businessUnitCode = [...distinctBusinessUnits][0];
    const projectCode = withSignal.find((p) => p.projectCandidateCode)?.projectCandidateCode ?? null;
    const bestConfidence = withSignal.find((p) => p.businessUnitCandidate!.code === businessUnitCode)!.businessUnitCandidate!;
    return {
      status: "classified",
      documentLevelBusinessUnit: bestConfidence,
      documentLevelProjectCode: projectCode,
      documentLevelInitiativeCode: null,
      lineProposals,
      seriesSignal: seriesSignalBase,
    };
  }

  return {
    status: "classified_at_line_level",
    documentLevelBusinessUnit: null,
    documentLevelProjectCode: null,
    documentLevelInitiativeCode: null,
    lineProposals,
    seriesSignal: seriesSignalBase,
  };
}

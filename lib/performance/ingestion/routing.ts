import { MONTECALLINI_STRUCTURE_NAME } from "../../performanceImportRouting";
import { Dataset, StructureAlias, StructureOption, StructureResolution } from "./types";

// Segmento struttura nel filename Booking Designer: SEMPRE tra la
// chiusura ")" del range di date tra parentesi e il trattino finale
// seguito dalla data di estrazione YYYY-MM-DD - verificato sui filename
// reali osservati per entrambi i report BD gia' supportati:
//   "ADR - RevPAR (01 Gen 2026 - 31 Dic 2026) - Palazzo De' Belli - 2026-09-08.csv"
//   "Ospiti per provenienza (01 Gen 2026 - 31 Dic 2026) - Palazzo De' Belli - 2026-09-01.csv"
// Estrazione DETERMINISTICA per posizione strutturale (mai un
// "contains"/euristica sul nome): il gruppo (.+?) e' non-greedy ma,
// essendoci un solo suffisso " - YYYY-MM-DD.ext" nel filename, cattura
// esattamente e per intero il segmento struttura - apostrofi, "&",
// caratteri spuri (es. "Sangiorgio Resort _____") inclusi cosi' come sono.
// Se il filename non rispetta questo schema (rinominato a mano, fonte
// diversa, ecc.) il regex non produce nessun match: "struttura non
// riconosciuta", mai un tentativo di recupero piu' permissivo.
const BD_FILENAME_STRUCTURE_SEGMENT = /\)\s*-\s*(.+?)\s*-\s*\d{4}-\d{2}-\d{2}\.[A-Za-z0-9]+$/;

const BOOKING_DESIGNER_SOURCE = "booking_designer";

export function extractBdStructureSegment(fileName: string): string | null {
  const match = fileName.match(BD_FILENAME_STRUCTURE_SEGMENT);
  return match ? match[1].trim() : null;
}

// Risoluzione struttura per Booking Designer (dataset adr_revpar e
// nationality, stesso filename/nome struttura in entrambi i report) -
// match ESATTO del segmento estratto contro structure_source_aliases
// (source='booking_designer'), MAI fuzzy/contains. Aliases e structures
// sono gia' caricati dal chiamante (repository.ts): questa funzione resta
// pura, senza I/O, per restare testabile con fixture in memoria.
export function resolveBookingDesignerStructure(
  fileName: string,
  aliases: StructureAlias[],
  structures: StructureOption[]
): StructureResolution {
  const segment = extractBdStructureSegment(fileName);
  if (!segment) return { kind: "not_found" };

  const matchingStructureIds = new Set(
    aliases.filter((a) => a.source === BOOKING_DESIGNER_SOURCE && a.alias === segment).map((a) => a.structureId)
  );

  if (matchingStructureIds.size === 0) return { kind: "not_found" };
  if (matchingStructureIds.size > 1) return { kind: "ambiguous", candidateStructureIds: [...matchingStructureIds] };

  const structureId = [...matchingStructureIds][0];
  const structure = structures.find((s) => s.id === structureId);
  // Alias orfano (struttura cancellata dopo la creazione dell'alias) - mai
  // un fallback, tratta come non risolta.
  if (!structure) return { kind: "not_found" };

  return { kind: "resolved", structureId: structure.id, structureName: structure.name };
}

// Montecallini NON ha righe in structure_source_aliases (nessun alias
// creato per lei - vedi commento nella migration structure_source_aliases):
// il suo unico formato (PMS "PlanningForecast", CSV ";"-delimited,
// verificato che non lo produce nessun'altra struttura e che Montecallini
// non ha un export Booking Designer) identifica la struttura in modo
// strutturale, prima ancora di guardare il filename - un alias qui
// sarebbe un mapping ridondante di un fatto gia' certo altrove
// (matchFileToStructure/detectCsvFormat in performanceImportRouting.ts).
// La risoluzione e' quindi un lookup diretto per nome esatto, non basato
// sul filename PlanningForecast (che non contiene comunque alcun nome
// struttura, verificato: "PlanningForecast (MAGG).csv").
export function resolveMontecalliniStructure(structures: StructureOption[]): StructureResolution {
  const matches = structures.filter((s) => s.name === MONTECALLINI_STRUCTURE_NAME);

  if (matches.length === 0) return { kind: "not_found" };
  if (matches.length > 1) return { kind: "ambiguous", candidateStructureIds: matches.map((s) => s.id) };

  return { kind: "resolved", structureId: matches[0].id, structureName: matches[0].name };
}

// Punto unico usato da importService.ts - branch sul dataset, mai
// duplicato altrove.
export function resolveStructureForDataset(
  dataset: Dataset,
  fileName: string,
  aliases: StructureAlias[],
  structures: StructureOption[]
): StructureResolution {
  if (dataset === "montecallini_pms") return resolveMontecalliniStructure(structures);
  return resolveBookingDesignerStructure(fileName, aliases, structures);
}

export function structureResolutionErrorMessage(resolution: StructureResolution, structures: StructureOption[]): string {
  if (resolution.kind === "not_found") {
    return "Impossibile identificare con sicurezza la struttura del file. Verifica il file prima di procedere.";
  }
  if (resolution.kind === "ambiguous") {
    const names = resolution.candidateStructureIds
      .map((id) => structures.find((s) => s.id === id)?.name ?? id)
      .join(", ");
    return `Il file risulta associato a più strutture (${names}) - alias ambiguo. Import bloccato.`;
  }
  return "";
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { AppCard } from "@/components/ui/AppCard";
import { AppButton } from "@/components/ui/AppButton";
import { AppInput } from "@/components/ui/AppInput";
import { supabase } from "@/lib/supabaseClient";
import { canViewModule, getUserLevelRank } from "@/lib/permissions";
import { parseBdExportWorkbook, parseBdExportCsv } from "@/lib/bdExportParser";
import { parseMontecalliniPmsCsv } from "@/lib/montecalliniPmsParser";
import { parseNationalityWorkbook, ParsedNationalityRow } from "@/lib/nationalityParser";
import { MONTH_LABELS } from "@/components/performance/Calendar";
import {
  StructureOption,
  ImportableRow,
  FileFormat,
  GroupKind,
  MONTECALLINI_STRUCTURE_NAME,
  detectFileFormat,
  detectCsvFormat,
  guessStructureId,
  matchFileToStructure,
  structureMismatchMessage,
} from "@/lib/performanceImportRouting";
import {
  ingestSingleFile,
  ingestMontecalliniBatch,
  MontecalliniFileGroups,
} from "@/lib/performance/ingestion/importService";
import { IngestionOutcome, StructureAlias, StructureResolution } from "@/lib/performance/ingestion/types";
import { resolveBookingDesignerStructure, structureResolutionErrorMessage } from "@/lib/performance/ingestion/routing";
import { loadStructureAliases } from "@/lib/performance/ingestion/repository";

// channel_commission_rates ha RLS insert/update a rank >= 2 - il form
// Commissioni va nascosto del tutto per level=user, non solo disabilitato
// (stesso principio gia' applicato al toggle "Mostra netto" nel drill-down
// struttura). In pratica chi arriva su /performance/import e' gia'
// senior/master (modulo Performance e' senior/master-only), ma il
// controllo esplicito resta la convenzione di questo progetto.
const SENIOR_RANK = 2;

// Canali noti (stessi nomi usati in ChannelRevenueBars/channel_revenue) -
// suggeriti nel campo Canale del form Commissioni, che resta comunque
// testo libero per qualunque altro canale.
const KNOWN_CHANNELS = [
  "Booking.com",
  "Expedia",
  "CRM",
  "Booking Engine",
  "Booking Engine - Advance",
  "Imperatore Travel",
  "SunHotels",
  "HotelBeds",
];

const CURRENT_YEAR = new Date().getFullYear();

// MONTECALLINI_STRUCTURE_NAME, StructureOption, ImportableRow, FileFormat,
// GroupKind: spostati in lib/performanceImportRouting.ts (vedi import in
// cima al file) - stessa definizione, refactor puro senza cambio di
// comportamento.

type ParsedGroup = {
  kind: GroupKind;
  rows: ImportableRow[];
};

type FileEntry = {
  file: File;
  structureId: string;
  groups: ParsedGroup[];
  parseErrors: string[];
  // Warning di coerenza (mai bloccanti) del parser PMS Montecallini - lista
  // vuota per l'export BD, che non li produce.
  parseWarnings: string[];
  // Doppia conferma manuale quando il nome file non permette un match
  // automatico univoco con nessuna struttura (vedi matchFileToStructure)
  // - irrilevante/ignorato negli altri casi (match/mismatch/format_mismatch).
  structureConfirmed: boolean;
  format: FileFormat;
};

function totalRowsInEntry(entry: FileEntry): number {
  return entry.groups.reduce((sum, g) => sum + g.rows.length, 0);
}

// Riepilogo import (Import Integrity Foundation Fase 1): non piu' un
// singolo numero "duplicati saltati" che confondeva "e' normale, stesso
// file ricaricato" con "attenzione, questo e' un conflitto da guardare" -
// 4 categorie distinte, derivate 1:1 dallo status di IngestionOutcome
// (lib/performance/ingestion/types.ts). routing_error/parse_error/
// validation_error sono fuse in una sola categoria "Errore parsing/routing"
// come richiesto, mai mostrate separate all'utente.
type OutcomeCategory = "imported" | "duplicate" | "conflict" | "error";

function categorizeOutcome(status: IngestionOutcome["status"]): OutcomeCategory {
  if (status === "imported") return "imported";
  if (status === "skipped_duplicate") return "duplicate";
  if (status === "conflict") return "conflict";
  return "error";
}

function outcomeDetail(outcome: IngestionOutcome): string {
  switch (outcome.status) {
    case "imported":
      return `${outcome.importedCount} righe importate`;
    case "skipped_duplicate":
      return outcome.reason === "exact_duplicate"
        ? "Duplicato esatto (stesso file già importato) - nessuna scrittura."
        : "Duplicato semantico (stesso contenuto già importato con un file diverso) - nessuna scrittura.";
    case "conflict":
      return "Un import già completato per questa struttura/data ha un contenuto diverso - nessuna scrittura, richiede verifica manuale.";
    case "routing_error":
    case "parse_error":
    case "validation_error":
      return outcome.message;
  }
}

type OutcomeLine = { label: string; category: OutcomeCategory; detail: string };
type RunSummary = { lines: OutcomeLine[] };

// Stesso messaggio prodotto da ingestSingleFile per il caso "risolto ma
// struttura diversa da quella selezionata" (importService.ts) - duplicato
// qui solo per l'anteprima UI di ImportNazionalita, che deve mostrarlo
// PRIMA di inviare il file al servizio (difesa in profondita', invariata
// nello spirito rispetto al vecchio bdStructureMismatchMessage).
function bookingDesignerStructureMismatchMessage(
  resolution: StructureResolution,
  selectedStructureId: string,
  structures: StructureOption[]
): string {
  if (resolution.kind === "resolved") {
    const selectedName = structures.find((s) => s.id === selectedStructureId)?.name ?? selectedStructureId;
    return `Il file appartiene a "${resolution.structureName}", ma hai selezionato "${selectedName}". Seleziona la struttura corretta prima di procedere.`;
  }
  return structureResolutionErrorMessage(resolution, structures);
}

const OUTCOME_CATEGORY_LABEL: Record<OutcomeCategory, string> = {
  imported: "Importato",
  duplicate: "Duplicato già acquisito",
  conflict: "Conflitto",
  error: "Errore parsing/routing",
};

function countByCategory(lines: OutcomeLine[]): Record<OutcomeCategory, number> {
  const counts: Record<OutcomeCategory, number> = { imported: 0, duplicate: 0, conflict: 0, error: 0 };
  for (const line of lines) counts[line.category] += 1;
  return counts;
}

// Un solo componente di riepilogo, riusato identico dai 3 flussi (Import
// storico/actual/Nazionalità) - mai una formulazione diversa per lo stesso
// esito.
function ImportRunSummaryView({ summary }: { summary: RunSummary }) {
  const counts = countByCategory(summary.lines);

  return (
    <div className="rounded-[14px] border border-[#cfe3d3] bg-[#f2f8f3] p-4 text-sm text-[#2B2D2F]">
      <p className="font-semibold">Import completato</p>
      <p className="mt-1">Importato: {counts.imported}</p>
      <p>Duplicato già acquisito: {counts.duplicate}</p>
      <p className={counts.conflict > 0 ? "font-semibold text-[#8a3a3a]" : undefined}>Conflitto: {counts.conflict}</p>
      <p className={counts.error > 0 ? "text-[#8a3a3a]" : undefined}>Errore parsing/routing: {counts.error}</p>

      {summary.lines.length > 0 && (
        <ul className="mt-2 list-disc pl-5">
          {summary.lines.map((line, i) => (
            <li key={i} className={line.category === "conflict" || line.category === "error" ? "text-[#8a3a3a]" : undefined}>
              <span className="font-semibold">[{OUTCOME_CATEGORY_LABEL[line.category]}]</span> {line.label}: {line.detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function todayString() {
  return new Date().toISOString().split("T")[0];
}

// detectFileFormat: spostata in lib/performanceImportRouting.ts.

async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "UTF-8");
  });
}

// Punto unico di parsing per tutti i formati - branch sul formato
// rilevato, mai duplicato nei singoli componenti (ImportStorico/ImportActual
// chiamano sempre e solo questa funzione, non i parser direttamente). Per
// l'export BD (.xls/.xlsx o CSV) produce sempre un solo gruppo "cy"
// (comportamento invariato). Per il PMS Montecallini separa le righe gia'
// classificate dal parser in fino a 3 gruppi (cy/sdly/ly), ciascuno scritto
// poi con la propria extraction_date (vedi resolveGroupExtractionDate).
//
// Un file .csv non e' piu' un segnale univoco (BD ora esporta anche CSV,
// oltre a Montecallini) - per un .csv il formato reale viene sempre
// determinato dal CONTENUTO (detectCsvFormat, mai dalla sola estensione,
// che qui serve solo a scegliere COME leggere il file: come testo per i
// due dialetti CSV, come binario per .xls/.xlsx).
async function parseImportFile(
  file: File
): Promise<{ groups: ParsedGroup[]; errors: string[]; warnings: string[]; format: FileFormat }> {
  const isCsv = file.name.toLowerCase().endsWith(".csv");

  if (isCsv) {
    const text = await readFileAsText(file);
    const csvFormat = detectCsvFormat(text);

    if (csvFormat === "montecallini_pms") {
      const { rows, errors, warnings } = parseMontecalliniPmsCsv(text);

      const groups: ParsedGroup[] = (["cy", "sdly", "ly"] as const)
        .map((kind) => ({ kind, rows: rows.filter((r) => r.kind === kind) }))
        .filter((g) => g.rows.length > 0);

      return {
        groups,
        errors,
        warnings: warnings.map((w) => `Riga ${w.line}: ${w.message}`),
        format: csvFormat,
      };
    }

    const { rows, errors, warnings } = parseBdExportCsv(text);
    return { groups: rows.length > 0 ? [{ kind: "cy", rows }] : [], errors, warnings, format: csvFormat };
  }

  const buffer = await readFileAsArrayBuffer(file);
  const { rows, errors, warnings } = parseBdExportWorkbook(buffer);
  return { groups: rows.length > 0 ? [{ kind: "cy", rows }] : [], errors, warnings, format: "bd_export" };
}

// firstDayOfMonthAfter, oneYearBefore, computeMontecalliniGroupExtractionDate,
// resolveGroupExtractionDate, guessStructureFromFileName, guessStructureId,
// StructureMatch, matchFileToStructure, structureMismatchMessage: tutte
// spostate in lib/performanceImportRouting.ts (vedi import in cima al file).

async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

// processFileImport (dedup per-riga + insert diretti + DELETE compensativo
// su errore) e' stato RIMOSSO - Import Integrity Foundation Fase 1. Quel
// codice scartava silenziosamente come "duplicato" qualunque riga con uno
// stay_date gia' presente per la stessa struttura+data, anche quando il
// CONTENUTO differiva (bug reale: un secondo file correttivo veniva
// interpretato come duplicato invece che come conflitto). Sostituito da
// lib/performance/ingestion/importService.ts (ingestSingleFile /
// ingestMontecalliniBatch), che confronta il CONTENUTO (hash) prima di
// decidere, e scrive in modo atomico via la RPC fn_commit_performance_import
// (vedi supabase/migrations/20260908113200_fn_commit_performance_import.sql).

export default function PerformanceImportPage() {
  const router = useRouter();

  const [accessState, setAccessState] = useState<"checking" | "granted" | "denied">(
    "checking"
  );
  const [canManage, setCanManage] = useState(false);
  const [structures, setStructures] = useState<StructureOption[]>([]);
  const [importType, setImportType] = useState<"adr_revpar" | "commissioni" | "nazionalita">("adr_revpar");
  // "Import actual" e' il flusso ricorrente settimanale (5 strutture, una
  // dopo l'altra) - deve essere la tab aperta di default. "Import storico"
  // e' un'operazione occasionale (batch multi-file storico), non quella con
  // cui l'utente interagisce piu' spesso.
  const [activeTab, setActiveTab] = useState<"storico" | "actual">("actual");

  useEffect(() => {
    void checkAccessAndLoadStructures();
  }, []);

  async function checkAccessAndLoadStructures() {
    const canView = await canViewModule("performance");

    if (!canView) {
      setAccessState("denied");
      router.replace("/dashboard");
      return;
    }

    setAccessState("granted");

    const rank = await getUserLevelRank();
    setCanManage(rank !== null && rank >= SENIOR_RANK);

    const { data } = await supabase.from("structures").select("id, name").order("name");
    setStructures((data as StructureOption[]) || []);
  }

  if (accessState !== "granted") {
    return null;
  }

  return (
    <div className="space-y-6">
      <Link href="/performance" className="text-sm font-medium text-[#017A92] hover:underline">
        ← Torna alla vista d'insieme Performance
      </Link>

      <PageHeader
        eyebrow="Performance"
        title="Import"
        description="Import ADR/RevPAR (storico e actual), Commissioni canale e Nazionalità."
      />

      <div className="flex flex-wrap gap-2">
        {[
          { value: "adr_revpar" as const, label: "ADR/RevPAR" },
          { value: "commissioni" as const, label: "Commissioni canale" },
          { value: "nazionalita" as const, label: "Nazionalità" },
        ].map((opt) => (
          <button
            key={opt.value}
            onClick={() => setImportType(opt.value)}
            className={`rounded-[14px] px-4 py-2 text-sm font-semibold transition ${
              importType === opt.value
                ? "bg-teal text-white"
                : "border border-[#e7dfd8] bg-white text-[#2B2D2F] hover:bg-[#f8f6f2]"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {importType === "adr_revpar" && (
        <>
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab("storico")}
              className={`rounded-[14px] px-4 py-2 text-sm font-semibold transition ${
                activeTab === "storico"
                  ? "bg-[#017A92] text-white"
                  : "border border-[#e7dfd8] bg-white text-[#2B2D2F] hover:bg-[#f8f6f2]"
              }`}
            >
              Import storico
            </button>
            <button
              onClick={() => setActiveTab("actual")}
              className={`rounded-[14px] px-4 py-2 text-sm font-semibold transition ${
                activeTab === "actual"
                  ? "bg-[#017A92] text-white"
                  : "border border-[#e7dfd8] bg-white text-[#2B2D2F] hover:bg-[#f8f6f2]"
              }`}
            >
              Import actual
            </button>
          </div>

          {activeTab === "storico" ? (
            <ImportStorico structures={structures} />
          ) : (
            <ImportActual structures={structures} />
          )}

          <Link
            href="/performance/inserimento-manuale"
            className="block text-[12px] font-medium text-[#017A92] hover:underline"
          >
            Montecallini: nessun export PMS disponibile per un mese specifico? Inserimento manuale (opzione secondaria) →
          </Link>
        </>
      )}

      {importType === "commissioni" &&
        (canManage ? (
          <ImportCommissioni structures={structures} />
        ) : (
          <AppCard title="Commissioni canale">
            <p className="text-sm text-[#6a6d70]">Sezione riservata a senior/master.</p>
          </AppCard>
        ))}

      {importType === "nazionalita" && <ImportNazionalita structures={structures} />}
    </div>
  );
}

function DropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
      className={`flex flex-col items-center justify-center rounded-[16px] border-2 border-dashed p-8 text-center transition ${
        dragOver ? "border-[#017A92] bg-[#f3f8fa]" : "border-[#e7dfd8] bg-[#fcfbf9]"
      }`}
    >
      <p className="text-sm text-[#6a6d70]">
        Trascina qui i file export BD (.xls/.xlsx/.csv) o export PMS Montecallini (.csv), oppure
      </p>
      <label className="mt-3 cursor-pointer rounded-[14px] bg-[#017A92] px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
        Scegli file
        <input
          type="file"
          multiple
          accept=".xls,.xlsx,.csv"
          className="hidden"
          onChange={(e) => onFiles(Array.from(e.target.files || []))}
        />
      </label>
    </div>
  );
}

function ImportStorico({ structures }: { structures: StructureOption[] }) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [extractionDate, setExtractionDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [globalError, setGlobalError] = useState("");

  async function handleFiles(files: File[]) {
    setGlobalError("");
    setSummary(null);

    const newEntries: FileEntry[] = [];

    for (const file of files) {
      try {
        const { groups, errors, warnings, format } = await parseImportFile(file);
        newEntries.push({
          file,
          // Il formato PMS non ha (per ora) evidenza di un nome file da cui
          // indovinare la struttura - guessStructureId non trova nulla e
          // structureId resta vuoto, correttamente: il controllo che conta
          // per Montecallini e' quello di formato (vedi matchFileToStructure),
          // non il nome file.
          structureId: guessStructureId(file.name, structures),
          groups,
          parseErrors: errors,
          parseWarnings: warnings,
          structureConfirmed: false,
          format,
        });
      } catch (err) {
        newEntries.push({
          file,
          structureId: "",
          groups: [],
          parseErrors: [err instanceof Error ? err.message : String(err)],
          parseWarnings: [],
          structureConfirmed: false,
          format: detectFileFormat(file.name),
        });
      }
    }

    setEntries((prev) => [...prev, ...newEntries]);
  }

  function updateEntryStructure(fileIndex: number, structureId: string) {
    // Cambiare struttura invalida sempre una conferma precedente - non deve
    // mai restare "valida" per una struttura diversa da quella confermata.
    setEntries((prev) =>
      prev.map((entry, i) => (i === fileIndex ? { ...entry, structureId, structureConfirmed: false } : entry))
    );
  }

  function updateEntryConfirmed(fileIndex: number, confirmed: boolean) {
    setEntries((prev) => prev.map((entry, i) => (i === fileIndex ? { ...entry, structureConfirmed: confirmed } : entry)));
  }

  function removeEntry(fileIndex: number) {
    setEntries((prev) => prev.filter((_, i) => i !== fileIndex));
  }

  const entryMatches = entries.map((e) => matchFileToStructure(e.file.name, e.format, e.structureId, structures));
  const hasBlockingMismatch = entryMatches.some((m) => m.kind === "mismatch" || m.kind === "format_mismatch");
  const hasUnconfirmedUnknown = entries.some((e, i) => e.structureId !== "" && entryMatches[i].kind === "unknown" && !e.structureConfirmed);

  const canSubmit =
    entries.length > 0 &&
    extractionDate !== "" &&
    entries.every((e) => e.structureId !== "" && totalRowsInEntry(e) > 0) &&
    !hasBlockingMismatch &&
    !hasUnconfirmedUnknown;

  async function handleSubmit() {
    setGlobalError("");
    setSummary(null);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setGlobalError("Sessione non valida, rieffettua il login");
      return;
    }

    setSubmitting(true);

    const lines: OutcomeLine[] = [];
    const today = todayString();

    // I file PMS Montecallini vanno raggruppati e passati INSIEME al
    // servizio (N file = 1 batch per kind CY/SDLY/LY, mai confrontati file
    // contro file - vedi lib/performance/ingestion/montecalliniBatching.ts):
    // separati qui dai file BD, che restano invece un'unita' di import per
    // file (comportamento invariato).
    const bdEntries = entries.filter((e) => e.format !== "montecallini_pms");
    const montecalliniEntries = entries.filter((e) => e.format === "montecallini_pms");

    for (const entry of bdEntries) {
      // Riverifica prima di scrivere, non solo tramite il pulsante disabilitato
      // (difesa in profondita' - vedi canSubmit sopra, guardrail invariato).
      const match = matchFileToStructure(entry.file.name, entry.format, entry.structureId, structures);
      const selectedName = structures.find((s) => s.id === entry.structureId)?.name ?? entry.structureId;
      if (match.kind === "format_mismatch") {
        lines.push({ label: entry.file.name, category: "error", detail: `${match.reason} File saltato.` });
        continue;
      }
      if (match.kind === "mismatch") {
        lines.push({ label: entry.file.name, category: "error", detail: `${structureMismatchMessage(match.guessedName, selectedName)} File saltato.` });
        continue;
      }
      if (match.kind === "unknown" && !entry.structureConfirmed) {
        lines.push({ label: entry.file.name, category: "error", detail: "corrispondenza struttura non confermata - file saltato." });
        continue;
      }

      const content = await entry.file.arrayBuffer();
      const rows = entry.groups.flatMap((g) => g.rows); // sempre un solo gruppo "cy" per l'export BD, invariato
      const outcome = await ingestSingleFile({
        supabase,
        dataset: "adr_revpar",
        selectedStructureId: entry.structureId,
        structures,
        uploadedBy: user.id,
        file: entry.file,
        fileContent: content,
        extractionDate,
        snapshotRows: rows,
      });
      lines.push({ label: entry.file.name, category: categorizeOutcome(outcome.status), detail: outcomeDetail(outcome) });
    }

    if (montecalliniEntries.length > 0) {
      const formatMismatch = montecalliniEntries
        .map((entry) => ({ entry, match: matchFileToStructure(entry.file.name, entry.format, entry.structureId, structures) }))
        .filter(({ match }) => match.kind === "format_mismatch");

      for (const { entry, match } of formatMismatch) {
        if (match.kind === "format_mismatch") {
          lines.push({ label: entry.file.name, category: "error", detail: `${match.reason} File saltato.` });
        }
      }

      const validEntries = montecalliniEntries.filter((e) => !formatMismatch.some(({ entry }) => entry === e));

      if (validEntries.length > 0) {
        const structureId = validEntries[0].structureId;
        const files: MontecalliniFileGroups[] = await Promise.all(
          validEntries.map(async (e) => ({ fileName: e.file.name, file: e.file, content: await e.file.arrayBuffer(), groups: e.groups }))
        );
        const batchResult = await ingestMontecalliniBatch({ supabase, selectedStructureId: structureId, structures, uploadedBy: user.id, files, today });

        if (batchResult.status === "routing_error") {
          lines.push({ label: validEntries.map((e) => e.file.name).join(", "), category: "error", detail: batchResult.message });
        } else {
          for (const { kind, outcome } of batchResult.batches) {
            lines.push({ label: `Montecallini [${kind.toUpperCase()}]`, category: categorizeOutcome(outcome.status), detail: outcomeDetail(outcome) });
          }
        }
      }
    }

    setSubmitting(false);
    setSummary({ lines });
    setEntries([]);
  }

  return (
    <AppCard
      title="Import storico"
      subtitle="Carica uno o più export BD (.xls/.xlsx/.csv, anche aggregati mensili/annuali) o export PMS Montecallini (.csv, un file per mese). La data di estrazione va scelta manualmente per l'intero batch, tranne per i file PMS Montecallini (calcolata automaticamente dal mese coperto)."
    >
      <div className="space-y-5">
        <div>
          <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
            Data di estrazione del report (per tutti i file caricati ora)
          </label>
          <AppInput
            type="date"
            value={extractionDate}
            onChange={(e) => setExtractionDate(e.target.value)}
            className="max-w-xs"
          />
        </div>

        <DropZone onFiles={handleFiles} />

        {entries.length > 0 && (
          <div className="space-y-3">
            {entries.map((entry, i) => {
              const match = entryMatches[i];
              const selectedName = structures.find((s) => s.id === entry.structureId)?.name;
              return (
                <div key={i} className="rounded-[14px] border border-[#e7dfd8] bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[#2B2D2F]">{entry.file.name}</p>
                      <p className="mt-1 text-[12px] text-[#6a6d70]">
                        {totalRowsInEntry(entry)} periodi riconosciuti
                        {entry.groups.length > 1 &&
                          ` (${entry.groups.map((g) => `${g.kind.toUpperCase()}: ${g.rows.length}`).join(", ")})`}
                        {entry.parseErrors.length > 0 && `, ${entry.parseErrors.length} righe con errori`}
                        {entry.parseWarnings.length > 0 && `, ${entry.parseWarnings.length} avvisi di coerenza`}
                      </p>
                    </div>
                    <button
                      onClick={() => removeEntry(i)}
                      className="text-[12px] font-semibold text-[#8a3a3a] hover:underline"
                    >
                      Rimuovi
                    </button>
                  </div>

                  <div className="mt-3">
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                      Struttura
                    </label>
                    <select
                      value={entry.structureId}
                      onChange={(e) => updateEntryStructure(i, e.target.value)}
                      className={`h-10 w-full max-w-xs rounded-[12px] border px-3 text-sm outline-none ${
                        entry.structureId ? "border-[#e7dfd8]" : "border-[#e9c9c9] bg-[#fbf1f1]"
                      }`}
                    >
                      <option value="">— seleziona struttura —</option>
                      {structures.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {match.kind === "format_mismatch" && (
                    <p className="mt-2 text-[12px] font-semibold text-[#8a3a3a]">{match.reason}</p>
                  )}

                  {match.kind === "mismatch" && (
                    <p className="mt-2 text-[12px] font-semibold text-[#8a3a3a]">
                      {structureMismatchMessage(match.guessedName, selectedName ?? entry.structureId)}
                    </p>
                  )}

                  {match.kind === "unknown" && entry.structureId !== "" && (
                    <label className="mt-2 flex items-center gap-2 text-[12px] text-[#6b625c]">
                      <input
                        type="checkbox"
                        checked={entry.structureConfirmed}
                        onChange={(e) => updateEntryConfirmed(i, e.target.checked)}
                      />
                      Confermo che questo file corrisponde a &quot;{selectedName}&quot; (nome file non riconosciuto automaticamente)
                    </label>
                  )}

                  {entry.parseWarnings.length > 0 && (
                    <ul className="mt-2 list-disc pl-5 text-[12px] text-[#8a6a1f]">
                      {entry.parseWarnings.map((warn, wi) => (
                        <li key={wi}>{warn}</li>
                      ))}
                    </ul>
                  )}

                  {entry.parseErrors.length > 0 && (
                    <ul className="mt-2 list-disc pl-5 text-[12px] text-[#8a3a3a]">
                      {entry.parseErrors.map((err, ei) => (
                        <li key={ei}>{err}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {globalError && <p className="text-sm text-[#8a3a3a]">{globalError}</p>}

        {summary && <ImportRunSummaryView summary={summary} />}

        <div className="flex justify-end">
          <AppButton variant="primary" disabled={!canSubmit || submitting} onClick={handleSubmit}>
            {submitting ? "Import in corso..." : "Importa"}
          </AppButton>
        </div>
      </div>
    </AppCard>
  );
}

function ImportActual({ structures }: { structures: StructureOption[] }) {
  const [structureId, setStructureId] = useState("");
  // Array anche per l'export BD (dove contiene sempre 0 o 1 elemento, dato
  // che l'input file per le altre 5 strutture non ha l'attributo multiple)
  // - solo Montecallini puo' selezionare piu' file PlanningForecast in un
  // solo passaggio (stagione maggio-ottobre, piu' mesi ancora aperti).
  const [currentFiles, setCurrentFiles] = useState<FileEntry[]>([]);
  const [historicalFile, setHistoricalFile] = useState<FileEntry | null>(null);
  const [historicalDate, setHistoricalDate] = useState("");

  // Due azioni indipendenti (import corrente settimanale vs import storico
  // SDLY occasionale) - stato separato per ciascuna, non piu' un'unica
  // submit/summary/error condivisa: l'una non deve mai bloccare ne'
  // dipendere dall'altra.
  const [submittingCurrent, setSubmittingCurrent] = useState(false);
  const [currentSummary, setCurrentSummary] = useState<RunSummary | null>(null);
  const [currentError, setCurrentError] = useState("");
  // Incrementata dopo ogni import riuscito per forzare il remount del
  // <input type="file"> nativo - senza questo, il nome del file gia'
  // caricato resterebbe visibile nell'input anche dopo il reset dello
  // stato React (gli input file sono non controllati).
  const [currentFileInputKey, setCurrentFileInputKey] = useState(0);

  const [submittingHistorical, setSubmittingHistorical] = useState(false);
  const [historicalSummary, setHistoricalSummary] = useState<RunSummary | null>(null);
  const [historicalFileInputKey, setHistoricalFileInputKey] = useState(0);
  const [historicalError, setHistoricalError] = useState("");

  const today = useMemo(() => todayString(), []);
  const isMontecalliniSelected = structures.find((s) => s.id === structureId)?.name === MONTECALLINI_STRUCTURE_NAME;

  async function handleCurrentFiles(files: File[]) {
    setCurrentError("");
    setCurrentSummary(null);

    const newEntries: FileEntry[] = [];
    for (const file of files) {
      try {
        const { groups, errors, warnings, format } = await parseImportFile(file);
        newEntries.push({ file, structureId: "", groups, parseErrors: errors, parseWarnings: warnings, structureConfirmed: false, format });
      } catch (err) {
        newEntries.push({
          file,
          structureId: "",
          groups: [],
          parseErrors: [err instanceof Error ? err.message : String(err)],
          parseWarnings: [],
          structureConfirmed: false,
          format: detectFileFormat(file.name),
        });
      }
    }
    setCurrentFiles((prev) => [...prev, ...newEntries]);
  }

  function removeCurrentFile(index: number) {
    setCurrentFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function updateCurrentFileConfirmed(index: number, confirmed: boolean) {
    setCurrentFiles((prev) => prev.map((e, i) => (i === index ? { ...e, structureConfirmed: confirmed } : e)));
  }

  async function handleHistoricalFile(file: File) {
    setHistoricalError("");
    setHistoricalSummary(null);

    try {
      const { groups, errors, warnings, format } = await parseImportFile(file);
      setHistoricalFile({ file, structureId: "", groups, parseErrors: errors, parseWarnings: warnings, structureConfirmed: false, format });
    } catch (err) {
      setHistoricalError(err instanceof Error ? err.message : String(err));
    }
  }

  const currentMatches = currentFiles.map((f) => matchFileToStructure(f.file.name, f.format, structureId, structures));
  const historicalMatch = historicalFile
    ? matchFileToStructure(historicalFile.file.name, historicalFile.format, structureId, structures)
    : null;

  const currentHasBlockingMismatch = currentMatches.some((m) => m.kind === "mismatch" || m.kind === "format_mismatch");
  const currentHasUnconfirmedUnknown = currentFiles.some(
    (f, i) => structureId !== "" && currentMatches[i].kind === "unknown" && !f.structureConfirmed
  );
  const currentHasRows = currentFiles.some((f) => totalRowsInEntry(f) > 0);

  const canSubmitCurrent =
    structureId !== "" && currentFiles.length > 0 && currentHasRows && !currentHasBlockingMismatch && !currentHasUnconfirmedUnknown;

  const canSubmitHistorical =
    structureId !== "" &&
    historicalFile !== null &&
    totalRowsInEntry(historicalFile) > 0 &&
    historicalDate !== "" &&
    historicalMatch?.kind !== "mismatch" &&
    historicalMatch?.kind !== "format_mismatch" &&
    !(historicalMatch?.kind === "unknown" && !historicalFile.structureConfirmed);

  async function handleSubmitCurrent() {
    setCurrentError("");
    setCurrentSummary(null);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user || currentFiles.length === 0) {
      setCurrentError("Sessione non valida o nessun file selezionato");
      return;
    }

    setSubmittingCurrent(true);

    const lines: OutcomeLine[] = [];
    const selectedName = structures.find((s) => s.id === structureId)?.name ?? structureId;

    // Stessa separazione BD/Montecallini di ImportStorico: i file PMS
    // Montecallini vanno passati INSIEME al servizio come un unico batch
    // per kind (CY/SDLY/LY), mai confrontati file contro file.
    const bdEntries = currentFiles.filter((e) => e.format !== "montecallini_pms");
    const montecalliniEntries = currentFiles.filter((e) => e.format === "montecallini_pms");

    for (const entry of bdEntries) {
      // Riverifica prima di scrivere, non solo tramite il pulsante disabilitato.
      const match = matchFileToStructure(entry.file.name, entry.format, structureId, structures);
      if (match.kind === "format_mismatch" || match.kind === "mismatch") {
        const msg = match.kind === "format_mismatch" ? match.reason : structureMismatchMessage(match.guessedName, selectedName);
        lines.push({ label: entry.file.name, category: "error", detail: `${msg} File saltato.` });
        continue;
      }
      if (match.kind === "unknown" && !entry.structureConfirmed) {
        lines.push({ label: entry.file.name, category: "error", detail: "corrispondenza struttura non confermata - file saltato." });
        continue;
      }

      const content = await entry.file.arrayBuffer();
      const rows = entry.groups.flatMap((g) => g.rows); // sempre un solo gruppo "cy" per l'export BD, invariato
      const outcome = await ingestSingleFile({
        supabase,
        dataset: "adr_revpar",
        selectedStructureId: structureId,
        structures,
        uploadedBy: user.id,
        file: entry.file,
        fileContent: content,
        extractionDate: today,
        snapshotRows: rows,
      });
      lines.push({ label: entry.file.name, category: categorizeOutcome(outcome.status), detail: outcomeDetail(outcome) });
    }

    if (montecalliniEntries.length > 0) {
      const formatMismatchEntries = montecalliniEntries
        .map((entry) => ({ entry, match: matchFileToStructure(entry.file.name, entry.format, structureId, structures) }))
        .filter(({ match }) => match.kind === "format_mismatch");

      for (const { entry, match } of formatMismatchEntries) {
        if (match.kind === "format_mismatch") lines.push({ label: entry.file.name, category: "error", detail: `${match.reason} File saltato.` });
      }

      const validEntries = montecalliniEntries.filter((e) => !formatMismatchEntries.some(({ entry }) => entry === e));

      if (validEntries.length > 0) {
        const files: MontecalliniFileGroups[] = await Promise.all(
          validEntries.map(async (e) => ({ fileName: e.file.name, file: e.file, content: await e.file.arrayBuffer(), groups: e.groups }))
        );
        const batchResult = await ingestMontecalliniBatch({ supabase, selectedStructureId: structureId, structures, uploadedBy: user.id, files, today });

        if (batchResult.status === "routing_error") {
          lines.push({ label: validEntries.map((e) => e.file.name).join(", "), category: "error", detail: batchResult.message });
        } else {
          for (const { kind, outcome } of batchResult.batches) {
            lines.push({ label: `Montecallini [${kind.toUpperCase()}]`, category: categorizeOutcome(outcome.status), detail: outcomeDetail(outcome) });
          }
        }
      }
    }

    setSubmittingCurrent(false);
    setCurrentSummary({ lines });
    setCurrentFiles([]);
    setCurrentFileInputKey((k) => k + 1);
    // Il selettore struttura torna pronto per la prossima struttura del
    // flusso settimanale - mai lasciato sulla selezione precedente (e'
    // proprio questo il pattern che ha causato l'incidente Rollo/Sangiorgio).
    setStructureId("");
  }

  async function handleSubmitHistorical() {
    setHistoricalError("");
    setHistoricalSummary(null);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user || !historicalFile) {
      setHistoricalError("Sessione non valida o file mancante");
      return;
    }

    const selectedName = structures.find((s) => s.id === structureId)?.name ?? structureId;
    const match = matchFileToStructure(historicalFile.file.name, historicalFile.format, structureId, structures);
    if (match.kind === "format_mismatch") {
      setHistoricalError(match.reason);
      return;
    }
    if (match.kind === "mismatch") {
      setHistoricalError(structureMismatchMessage(match.guessedName, selectedName));
      return;
    }
    if (match.kind === "unknown" && !historicalFile.structureConfirmed) {
      setHistoricalError("Conferma che il file corrisponde alla struttura selezionata prima di procedere.");
      return;
    }

    setSubmittingHistorical(true);

    const lines: OutcomeLine[] = [];
    for (const w of historicalFile.parseWarnings) lines.push({ label: historicalFile.file.name, category: "error", detail: w });

    if (historicalFile.format === "montecallini_pms") {
      // Un solo file, ma passato comunque come batch di 1 al servizio
      // Montecallini - stessa via del multi-file, mai un percorso separato
      // che potrebbe divergere nel calcolo dell'hash o della data. La data
      // scelta nello slot "storico" (historicalDate) NON viene usata per
      // Montecallini: resolveGroupExtractionDate ignora sempre fallbackDate
      // per questo formato e ricava la data dal contenuto del file stesso
      // (invariato, vedi performanceImportRouting.ts).
      const content = await historicalFile.file.arrayBuffer();
      const batchResult = await ingestMontecalliniBatch({
        supabase,
        selectedStructureId: structureId,
        structures,
        uploadedBy: user.id,
        files: [{ fileName: historicalFile.file.name, file: historicalFile.file, content, groups: historicalFile.groups }],
        today,
      });

      if (batchResult.status === "routing_error") {
        lines.push({ label: historicalFile.file.name, category: "error", detail: batchResult.message });
      } else {
        for (const { kind, outcome } of batchResult.batches) {
          lines.push({ label: `Montecallini [${kind.toUpperCase()}]`, category: categorizeOutcome(outcome.status), detail: outcomeDetail(outcome) });
        }
      }
    } else {
      const content = await historicalFile.file.arrayBuffer();
      const rows = historicalFile.groups.flatMap((g) => g.rows); // export BD: sempre un solo gruppo "cy", invariato
      const outcome = await ingestSingleFile({
        supabase,
        dataset: "adr_revpar",
        selectedStructureId: structureId,
        structures,
        uploadedBy: user.id,
        file: historicalFile.file,
        fileContent: content,
        extractionDate: historicalDate,
        snapshotRows: rows,
      });
      lines.push({ label: historicalFile.file.name, category: categorizeOutcome(outcome.status), detail: outcomeDetail(outcome) });
    }

    setSubmittingHistorical(false);
    setHistoricalSummary({ lines });
    setHistoricalFile(null);
    setHistoricalDate("");
    setHistoricalFileInputKey((k) => k + 1);
    setStructureId("");
  }

  return (
    <AppCard
      title="Import actual"
      subtitle="Flusso ricorrente (tipicamente ogni martedì): export BD corrente + uno storico di riferimento per il confronto SDLY. Per Montecallini usa l'export PMS PlanningForecast (.csv)."
    >
      <div className="space-y-6">
        <div>
          <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
            Struttura
          </label>
          <select
            value={structureId}
            onChange={(e) => setStructureId(e.target.value)}
            className="h-11 w-full max-w-xs rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 text-sm text-[#2B2D2F] outline-none"
          >
            <option value="">— seleziona struttura —</option>
            {structures.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-[14px] border border-[#e7dfd8] p-4">
          <p className="text-sm font-semibold text-[#2B2D2F]">
            {isMontecalliniSelected ? (
              <>
                Export corrente PMS — per ciascun file la data di estrazione è calcolata singolarmente (mese in corso = oggi, mese
                chiuso = primo giorno del mese successivo; per le righe SDLY/LY vedi il riepilogo dopo l&apos;import)
              </>
            ) : (
              <>Export BD corrente — data di estrazione: {today} (oggi, non modificabile)</>
            )}
          </p>
          <div className="mt-3">
            <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              File (export BD .xls/.xlsx/.csv, o export PMS Montecallini .csv
              {isMontecalliniSelected ? " — è possibile selezionare più file PlanningForecast insieme" : ""})
            </label>
            <input
              key={currentFileInputKey}
              type="file"
              accept=".xls,.xlsx,.csv"
              multiple={isMontecalliniSelected}
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleCurrentFiles(Array.from(e.target.files));
                  e.target.value = "";
                }
              }}
            />

            {currentFiles.length > 0 && (
              <ul className="mt-2 space-y-2">
                {currentFiles.map((entry, i) => {
                  const match = currentMatches[i];
                  return (
                    <li key={i} className="rounded-[10px] border border-[#e7dfd8] bg-[#fcfbf9] p-2 text-[12px] text-[#6a6d70]">
                      <div className="flex items-center justify-between gap-2">
                        <span>
                          {entry.file.name} — {totalRowsInEntry(entry)} periodi riconosciuti
                          {entry.parseErrors.length > 0 && `, ${entry.parseErrors.length} errori`}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeCurrentFile(i)}
                          className="shrink-0 text-[#8a3a3a] underline"
                        >
                          rimuovi
                        </button>
                      </div>
                      {entry.groups.length > 1 && (
                        <p className="mt-1 text-[#6a6d70]">
                          ({entry.groups.map((g) => `${g.kind.toUpperCase()}: ${g.rows.length}`).join(", ")})
                        </p>
                      )}
                      {entry.parseErrors.length > 0 && (
                        <ul className="mt-1 list-disc pl-4 text-[#8a3a3a]">
                          {entry.parseErrors.map((err, j) => (
                            <li key={j}>{err}</li>
                          ))}
                        </ul>
                      )}
                      {entry.parseWarnings.length > 0 && (
                        <ul className="mt-1 list-disc pl-4 text-[#8a6a1f]">
                          {entry.parseWarnings.map((w, j) => (
                            <li key={j}>{w}</li>
                          ))}
                        </ul>
                      )}

                      {match?.kind === "format_mismatch" && (
                        <p className="mt-1 font-semibold text-[#8a3a3a]">{match.reason}</p>
                      )}

                      {match?.kind === "mismatch" && (
                        <p className="mt-1 font-semibold text-[#8a3a3a]">
                          {structureMismatchMessage(match.guessedName, structures.find((s) => s.id === structureId)?.name ?? structureId)}
                        </p>
                      )}

                      {match?.kind === "unknown" && structureId !== "" && (
                        <label className="mt-1 flex items-center gap-2 text-[#6b625c]">
                          <input
                            type="checkbox"
                            checked={entry.structureConfirmed}
                            onChange={(e) => updateCurrentFileConfirmed(i, e.target.checked)}
                          />
                          Confermo che questo file corrisponde a &quot;{structures.find((s) => s.id === structureId)?.name}&quot; (nome
                          file non riconosciuto automaticamente)
                        </label>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {currentError && <p className="mt-3 text-sm text-[#8a3a3a]">{currentError}</p>}

          {currentSummary && <ImportRunSummaryView summary={currentSummary} />}

          <div className="mt-4 flex justify-end">
            <AppButton variant="primary" disabled={!canSubmitCurrent || submittingCurrent} onClick={handleSubmitCurrent}>
              {submittingCurrent ? "Import in corso..." : "Importa corrente"}
            </AppButton>
          </div>
        </div>

        <div className="rounded-[14px] border border-[#e7dfd8] p-4">
          <p className="text-sm font-semibold text-[#2B2D2F]">Storico anno precedente (per confronto SDLY)</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                Data di estrazione di questo report
              </label>
              <AppInput
                type="date"
                value={historicalDate}
                onChange={(e) => setHistoricalDate(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                File
              </label>
              <input
                key={historicalFileInputKey}
                type="file"
                accept=".xls,.xlsx,.csv"
                onChange={(e) => e.target.files?.[0] && handleHistoricalFile(e.target.files[0])}
              />
            </div>
          </div>
          {historicalFile && (
            <p className="mt-2 text-[12px] text-[#6a6d70]">
              {historicalFile.file.name} — {totalRowsInEntry(historicalFile)} periodi riconosciuti
              {historicalFile.parseErrors.length > 0 && `, ${historicalFile.parseErrors.length} errori`}
            </p>
          )}
          {historicalFile && historicalFile.parseWarnings.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-[12px] text-[#8a6a1f]">
              {historicalFile.parseWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}

          {historicalMatch?.kind === "format_mismatch" && (
            <p className="mt-2 text-[12px] font-semibold text-[#8a3a3a]">{historicalMatch.reason}</p>
          )}

          {historicalMatch?.kind === "mismatch" && (
            <p className="mt-2 text-[12px] font-semibold text-[#8a3a3a]">
              {structureMismatchMessage(historicalMatch.guessedName, structures.find((s) => s.id === structureId)?.name ?? structureId)}
            </p>
          )}

          {historicalMatch?.kind === "unknown" && structureId !== "" && historicalFile && (
            <label className="mt-2 flex items-center gap-2 text-[12px] text-[#6b625c]">
              <input
                type="checkbox"
                checked={historicalFile.structureConfirmed}
                onChange={(e) => setHistoricalFile((prev) => (prev ? { ...prev, structureConfirmed: e.target.checked } : prev))}
              />
              Confermo che questo file corrisponde a &quot;{structures.find((s) => s.id === structureId)?.name}&quot; (nome file non riconosciuto automaticamente)
            </label>
          )}

          {historicalError && <p className="mt-3 text-sm text-[#8a3a3a]">{historicalError}</p>}

          {historicalSummary && <ImportRunSummaryView summary={historicalSummary} />}

          <div className="mt-4 flex justify-end">
            <AppButton
              variant="primary"
              disabled={!canSubmitHistorical || submittingHistorical}
              onClick={handleSubmitHistorical}
            >
              {submittingHistorical ? "Import in corso..." : "Importa storico"}
            </AppButton>
          </div>
        </div>
      </div>
    </AppCard>
  );
}

type CommissioniFormState = {
  structureId: string;
  channel: string;
  periodYear: string;
  periodMonth: string;
  totalBookings: string;
  totalCommission: string;
  reference: string;
};

const EMPTY_COMMISSIONI_FORM: CommissioniFormState = {
  structureId: "",
  channel: "",
  periodYear: String(CURRENT_YEAR),
  periodMonth: "",
  totalBookings: "",
  totalCommission: "",
  reference: "",
};

function ImportCommissioni({ structures }: { structures: StructureOption[] }) {
  // Struttura/Canale/Anno/Mese restano compilati dopo un salvataggio (si
  // inserisce spesso una riga per mese dello stesso canale/struttura in
  // sequenza) - solo importi e riferimento si azzerano.
  const [form, setForm] = useState<CommissioniFormState>(EMPTY_COMMISSIONI_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const totalBookingsNum = Number(form.totalBookings.replace(",", "."));
  const totalCommissionNum = Number(form.totalCommission.replace(",", "."));
  const computedPct =
    form.totalBookings !== "" &&
    form.totalCommission !== "" &&
    !Number.isNaN(totalBookingsNum) &&
    !Number.isNaN(totalCommissionNum) &&
    totalBookingsNum > 0
      ? (totalCommissionNum / totalBookingsNum) * 100
      : null;

  const canSubmit =
    form.structureId !== "" &&
    form.channel.trim() !== "" &&
    form.periodYear !== "" &&
    form.periodMonth !== "" &&
    computedPct !== null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccessMessage("");

    if (computedPct === null) {
      setError("Totale prenotazioni e totale commissione devono essere numeri validi, il totale prenotazioni maggiore di zero");
      return;
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setError("Sessione non valida, rieffettua il login");
      return;
    }

    setSubmitting(true);

    // ON CONFLICT su (structure_id, channel, period_year, period_month) -
    // stesso vincolo unique gia' presente sulla tabella: se la riga esiste
    // gia' per quel mese/canale/struttura, upsert la aggiorna invece di
    // duplicarla.
    const { error: upsertError } = await supabase
      .from("channel_commission_rates")
      .upsert(
        {
          structure_id: form.structureId,
          channel: form.channel.trim(),
          period_year: Number(form.periodYear),
          period_month: Number(form.periodMonth),
          commission_pct: Math.round(computedPct * 100) / 100,
          source: "fattura",
          source_reference: form.reference.trim() || "Inserimento manuale MC",
          created_by: user.id,
        },
        { onConflict: "structure_id,channel,period_year,period_month" }
      );

    setSubmitting(false);

    if (upsertError) {
      setError(upsertError.message);
      return;
    }

    setSuccessMessage(
      `Salvato: ${form.channel.trim()} — ${MONTH_LABELS[Number(form.periodMonth) - 1]} ${form.periodYear} — ${(
        Math.round(computedPct * 100) / 100
      ).toLocaleString("it-IT", { maximumFractionDigits: 2 })}%`
    );
    setForm((f) => ({ ...f, totalBookings: "", totalCommission: "", reference: "" }));
  }

  return (
    <AppCard
      title="Commissioni canale"
      subtitle="Inserimento manuale da fattura: calcola automaticamente la percentuale commissione e salva (o aggiorna se già presente per struttura/canale/mese)."
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              Struttura
            </label>
            <select
              value={form.structureId}
              onChange={(e) => setForm((f) => ({ ...f, structureId: e.target.value }))}
              className="h-11 w-full rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 text-sm text-[#2B2D2F] outline-none"
            >
              <option value="">— seleziona struttura —</option>
              {structures.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              Canale
            </label>
            <AppInput
              value={form.channel}
              onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))}
              placeholder="es. Booking.com"
            />
            <input list="known-channels" className="hidden" readOnly />
            <datalist id="known-channels">
              {KNOWN_CHANNELS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                Anno
              </label>
              <AppInput
                type="number"
                value={form.periodYear}
                onChange={(e) => setForm((f) => ({ ...f, periodYear: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                Mese
              </label>
              <select
                value={form.periodMonth}
                onChange={(e) => setForm((f) => ({ ...f, periodMonth: e.target.value }))}
                className="h-11 w-full rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 text-sm text-[#2B2D2F] outline-none"
              >
                <option value="">—</option>
                {MONTH_LABELS.map((label, i) => (
                  <option key={label} value={i + 1}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              Totale prenotazioni (€)
            </label>
            <AppInput
              value={form.totalBookings}
              onChange={(e) => setForm((f) => ({ ...f, totalBookings: e.target.value }))}
              placeholder="es. 8748"
            />
          </div>

          <div>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              Totale commissione (€)
            </label>
            <AppInput
              value={form.totalCommission}
              onChange={(e) => setForm((f) => ({ ...f, totalCommission: e.target.value }))}
              placeholder="es. 2012"
            />
          </div>

          <div>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              Riferimento (opzionale)
            </label>
            <AppInput
              value={form.reference}
              onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
              placeholder="es. numero fattura"
            />
          </div>
        </div>

        {computedPct !== null && (
          <p className="text-sm text-[#2B2D2F]">
            Percentuale calcolata:{" "}
            <span className="font-semibold">
              {(Math.round(computedPct * 100) / 100).toLocaleString("it-IT", { maximumFractionDigits: 2 })}%
            </span>
          </p>
        )}

        {error && <p className="text-sm text-[#8a3a3a]">{error}</p>}
        {successMessage && (
          <p className="rounded-[14px] border border-[#cfe3d3] bg-[#f2f8f3] px-4 py-3 text-sm text-[#2B2D2F]">
            {successMessage}
          </p>
        )}

        <div className="flex justify-end">
          <AppButton type="submit" variant="primary" disabled={!canSubmit || submitting}>
            {submitting ? "Salvataggio..." : "Salva commissione"}
          </AppButton>
        </div>
      </form>
    </AppCard>
  );
}

function ImportNazionalita({ structures }: { structures: StructureOption[] }) {
  const [structureId, setStructureId] = useState("");
  const [extractionDate, setExtractionDate] = useState("");
  const [fileEntry, setFileEntry] = useState<{ file: File; rows: ParsedNationalityRow[]; parseErrors: string[] } | null>(
    null
  );
  // Alias booking_designer caricati una sola volta all'ingresso nella
  // pagina (structure_source_aliases via repository.ts) - stesso elenco
  // usato sia per l'anteprima di corrispondenza qui sotto sia,
  // indipendentemente, dalla verifica autoritativa dentro ingestSingleFile.
  const [aliases, setAliases] = useState<StructureAlias[]>([]);
  const [aliasesError, setAliasesError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [globalError, setGlobalError] = useState("");

  useEffect(() => {
    loadStructureAliases(supabase, "booking_designer")
      .then(setAliases)
      .catch((err) => setAliasesError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function handleFile(file: File) {
    setGlobalError("");
    setSummary(null);

    try {
      const buffer = await readFileAsArrayBuffer(file);
      const { rows, errors } = parseNationalityWorkbook(buffer);
      setFileEntry({ file, rows, parseErrors: errors });
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : String(err));
    }
  }

  // Guardrail BLOCCANTE struttura-file vs struttura selezionata (mai un
  // warning: un mismatch qui salverebbe righe di nazionalità/bd_imports
  // formalmente valide ma sulla struttura sbagliata, un errore di qualita'
  // dati non piu' rilevabile a posteriori). Ricalcolato reattivamente da
  // fileEntry/structures/aliases ad ogni render, stesso pattern gia' in uso
  // per matchFileToStructure in ImportStorico/ImportActual - mai salvato in
  // uno stato separato che potrebbe disallinearsi. Match ESATTO via alias
  // DB (resolveBookingDesignerStructure), mai fuzzy.
  const structureMatch = fileEntry ? resolveBookingDesignerStructure(fileEntry.file.name, aliases, structures) : null;
  const structureMatchOk = structureMatch !== null && structureMatch.kind === "resolved" && structureMatch.structureId === structureId;
  const selectedStructureName = structures.find((s) => s.id === structureId)?.name ?? structureId;

  const canSubmit =
    structureId !== "" && extractionDate !== "" && fileEntry !== null && fileEntry.rows.length > 0 && structureMatchOk;

  async function handleSubmit() {
    setGlobalError("");
    setSummary(null);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user || !fileEntry) {
      setGlobalError("Sessione non valida o file mancante");
      return;
    }

    // Riverifica prima di scrivere, non solo tramite il pulsante disabilitato
    // (difesa in profondita' - stesso principio gia' in uso per ADR/RevPAR).
    const match = resolveBookingDesignerStructure(fileEntry.file.name, aliases, structures);
    if (match.kind !== "resolved" || match.structureId !== structureId) {
      setGlobalError(bookingDesignerStructureMismatchMessage(match, structureId, structures));
      return;
    }

    setSubmitting(true);

    const content = await fileEntry.file.arrayBuffer();
    const outcome = await ingestSingleFile({
      supabase,
      dataset: "nationality",
      selectedStructureId: structureId,
      structures,
      uploadedBy: user.id,
      file: fileEntry.file,
      fileContent: content,
      extractionDate,
      nationalityRows: fileEntry.rows,
    });

    setSubmitting(false);
    setSummary({
      lines: [
        ...fileEntry.parseErrors.map((e): OutcomeLine => ({ label: fileEntry.file.name, category: "error", detail: e })),
        { label: fileEntry.file.name, category: categorizeOutcome(outcome.status), detail: outcomeDetail(outcome) },
      ],
    });
    setFileEntry(null);
  }

  return (
    <AppCard
      title="Nazionalità"
      subtitle='Report "Ospiti per provenienza" BD (.xls/.xlsx/.csv, intestazione a due righe: gruppo nazionalità + Presenze/Arrivi/Partenze). Importa solo le combinazioni giorno × nazionalità con presenze effettive.'
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:max-w-lg">
          <div>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              Struttura
            </label>
            <select
              value={structureId}
              onChange={(e) => setStructureId(e.target.value)}
              className="h-11 w-full rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 text-sm text-[#2B2D2F] outline-none"
            >
              <option value="">— seleziona struttura —</option>
              {structures.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              Data di estrazione del report
            </label>
            <AppInput type="date" value={extractionDate} onChange={(e) => setExtractionDate(e.target.value)} />
          </div>
        </div>

        <DropZone onFiles={(files) => files[0] && handleFile(files[0])} />

        {fileEntry && (
          <div className="rounded-[14px] border border-[#e7dfd8] bg-white p-4">
            <p className="text-sm font-semibold text-[#2B2D2F]">{fileEntry.file.name}</p>
            <p className="mt-1 text-[12px] text-[#6a6d70]">
              {fileEntry.rows.length} righe (giorno × nazionalità) riconosciute
              {fileEntry.parseErrors.length > 0 && `, ${fileEntry.parseErrors.length} righe con errori`}
            </p>
            {fileEntry.parseErrors.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-[12px] text-[#8a3a3a]">
                {fileEntry.parseErrors.slice(0, 10).map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            )}

            {structureMatch && structureMatch.kind === "resolved" && (
              <div className="mt-3 rounded-[10px] border border-[#e7dfd8] bg-[#fcfbf9] p-3 text-[12px]">
                <p className="text-[#6a6d70]">Struttura rilevata dal file: {structureMatch.structureName}</p>
                {structureId === "" ? (
                  <p className="mt-1 text-[#6a6d70]">Seleziona la struttura per verificare la corrispondenza.</p>
                ) : structureMatchOk ? (
                  <p className="mt-1 font-semibold text-[#2f6b3a]">✓ Corrispondenza verificata</p>
                ) : (
                  <>
                    <p className="text-[#6a6d70]">Struttura selezionata: {selectedStructureName}</p>
                    <p className="mt-1 font-semibold text-[#8a3a3a]">
                      ✕ {bookingDesignerStructureMismatchMessage(structureMatch, structureId, structures)}
                    </p>
                  </>
                )}
              </div>
            )}

            {structureMatch && structureMatch.kind !== "resolved" && (
              <div className="mt-3 rounded-[10px] border border-[#e9c9c9] bg-[#fbf1f1] p-3 text-[12px]">
                <p className="font-semibold text-[#8a3a3a]">
                  ✕ {bookingDesignerStructureMismatchMessage(structureMatch, structureId, structures)}
                </p>
              </div>
            )}
          </div>
        )}

        {aliasesError && <p className="text-sm text-[#8a3a3a]">Impossibile caricare gli alias struttura: {aliasesError}</p>}
        {globalError && <p className="text-sm text-[#8a3a3a]">{globalError}</p>}

        {summary && <ImportRunSummaryView summary={summary} />}

        <div className="flex justify-end">
          <AppButton variant="primary" disabled={!canSubmit || submitting} onClick={handleSubmit}>
            {submitting ? "Import in corso..." : "Importa"}
          </AppButton>
        </div>
      </div>
    </AppCard>
  );
}

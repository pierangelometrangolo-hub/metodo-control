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
import { parseBdExportWorkbook, ParsedMonthRow } from "@/lib/bdExportParser";
import { parseNationalityWorkbook, ParsedNationalityRow } from "@/lib/nationalityParser";
import { MONTH_LABELS } from "@/components/performance/Calendar";

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

type StructureOption = {
  id: string;
  name: string;
};

type FileEntry = {
  file: File;
  structureId: string;
  rows: ParsedMonthRow[];
  parseErrors: string[];
};

type ImportSummary = {
  imported: number;
  duplicatesSkipped: number;
  errors: string[];
};

function todayString() {
  return new Date().toISOString().split("T")[0];
}

function guessStructureId(fileName: string, structures: StructureOption[]): string {
  const lower = fileName.toLowerCase();
  const matches = structures.filter((s) => lower.includes(s.name.toLowerCase()));
  return matches.length === 1 ? matches[0].id : "";
}

async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

async function processFileImport(params: {
  file: File;
  structureId: string;
  rows: ParsedMonthRow[];
  extractionDate: string;
  uploadedBy: string;
}): Promise<{ imported: number; duplicatesSkipped: number; dbErrors: string[] }> {
  const { file, structureId, rows, extractionDate, uploadedBy } = params;
  const dbErrors: string[] = [];

  if (rows.length === 0) {
    return { imported: 0, duplicatesSkipped: 0, dbErrors };
  }

  const stayDates = rows.map((r) => r.stayDate);

  const dupCheck = await supabase
    .from("performance_daily_snapshot")
    .select("stay_date")
    .eq("structure_id", structureId)
    .eq("extraction_date", extractionDate)
    .in("stay_date", stayDates);

  if (dupCheck.error) {
    dbErrors.push(`${file.name}: errore verifica duplicati (${dupCheck.error.message})`);
    return { imported: 0, duplicatesSkipped: 0, dbErrors };
  }

  const existingDates = new Set((dupCheck.data || []).map((r) => r.stay_date as string));
  const rowsToInsert = rows.filter((r) => !existingDates.has(r.stayDate));
  const duplicatesSkipped = rows.length - rowsToInsert.length;

  if (rowsToInsert.length === 0) {
    return { imported: 0, duplicatesSkipped, dbErrors };
  }

  const storagePath = `${structureId}/${extractionDate}/${Date.now()}-${file.name}`;

  const upload = await supabase.storage.from("bd-import-files").upload(storagePath, file);
  if (upload.error) {
    dbErrors.push(`${file.name}: errore caricamento file (${upload.error.message})`);
    return { imported: 0, duplicatesSkipped, dbErrors };
  }

  const bdImport = await supabase
    .from("bd_imports")
    .insert({
      structure_id: structureId,
      source: "bd_export",
      file_name: file.name,
      file_path: storagePath,
      extraction_date: extractionDate,
      uploaded_by: uploadedBy,
    })
    .select("id")
    .single();

  if (bdImport.error || !bdImport.data) {
    dbErrors.push(`${file.name}: errore creazione import (${bdImport.error?.message})`);
    return { imported: 0, duplicatesSkipped, dbErrors };
  }

  const snapshotRows = rowsToInsert.map((r) => ({
    structure_id: structureId,
    stay_date: r.stayDate,
    stay_year: Number(r.stayDate.slice(0, 4)),
    extraction_date: extractionDate,
    revenue_total: r.revenueTotal,
    rooms_sold: r.roomsSold,
    rooms_available: r.roomsAvailable,
    arrivals: r.arrivals,
    presences: r.presences,
    bd_import_id: bdImport.data.id,
  }));

  const snapshotInsert = await supabase.from("performance_daily_snapshot").insert(snapshotRows);

  if (snapshotInsert.error) {
    await supabase.from("bd_imports").delete().eq("id", bdImport.data.id);
    dbErrors.push(`${file.name}: errore salvataggio dati (${snapshotInsert.error.message})`);
    return { imported: 0, duplicatesSkipped, dbErrors };
  }

  return { imported: rowsToInsert.length, duplicatesSkipped, dbErrors };
}

export default function PerformanceImportPage() {
  const router = useRouter();

  const [accessState, setAccessState] = useState<"checking" | "granted" | "denied">(
    "checking"
  );
  const [canManage, setCanManage] = useState(false);
  const [structures, setStructures] = useState<StructureOption[]>([]);
  const [importType, setImportType] = useState<"adr_revpar" | "commissioni" | "nazionalita">("adr_revpar");
  const [activeTab, setActiveTab] = useState<"storico" | "actual">("storico");

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
      <p className="text-sm text-[#6a6d70]">Trascina qui i file Excel, oppure</p>
      <label className="mt-3 cursor-pointer rounded-[14px] bg-[#017A92] px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
        Scegli file
        <input
          type="file"
          multiple
          accept=".xls,.xlsx"
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
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [globalError, setGlobalError] = useState("");

  async function handleFiles(files: File[]) {
    setGlobalError("");
    setSummary(null);

    const newEntries: FileEntry[] = [];

    for (const file of files) {
      try {
        const buffer = await readFileAsArrayBuffer(file);
        const { rows, errors } = parseBdExportWorkbook(buffer);
        newEntries.push({
          file,
          structureId: guessStructureId(file.name, structures),
          rows,
          parseErrors: errors,
        });
      } catch (err) {
        newEntries.push({
          file,
          structureId: "",
          rows: [],
          parseErrors: [err instanceof Error ? err.message : String(err)],
        });
      }
    }

    setEntries((prev) => [...prev, ...newEntries]);
  }

  function updateEntryStructure(fileIndex: number, structureId: string) {
    setEntries((prev) =>
      prev.map((entry, i) => (i === fileIndex ? { ...entry, structureId } : entry))
    );
  }

  function removeEntry(fileIndex: number) {
    setEntries((prev) => prev.filter((_, i) => i !== fileIndex));
  }

  const canSubmit =
    entries.length > 0 &&
    extractionDate !== "" &&
    entries.every((e) => e.structureId !== "" && e.rows.length > 0);

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

    let totalImported = 0;
    let totalDuplicatesSkipped = 0;
    const allErrors: string[] = [];

    for (const entry of entries) {
      allErrors.push(...entry.parseErrors.map((e) => `${entry.file.name}: ${e}`));

      const result = await processFileImport({
        file: entry.file,
        structureId: entry.structureId,
        rows: entry.rows,
        extractionDate,
        uploadedBy: user.id,
      });

      totalImported += result.imported;
      totalDuplicatesSkipped += result.duplicatesSkipped;
      allErrors.push(...result.dbErrors);
    }

    setSubmitting(false);
    setSummary({ imported: totalImported, duplicatesSkipped: totalDuplicatesSkipped, errors: allErrors });
    setEntries([]);
  }

  return (
    <AppCard
      title="Import storico"
      subtitle="Carica uno o più export BD (anche aggregati mensili/annuali). La data di estrazione va scelta manualmente per l'intero batch."
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
            {entries.map((entry, i) => (
              <div key={i} className="rounded-[14px] border border-[#e7dfd8] bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[#2B2D2F]">{entry.file.name}</p>
                    <p className="mt-1 text-[12px] text-[#6a6d70]">
                      {entry.rows.length} periodi riconosciuti
                      {entry.parseErrors.length > 0 && `, ${entry.parseErrors.length} righe con errori`}
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

                {entry.parseErrors.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-[12px] text-[#8a3a3a]">
                    {entry.parseErrors.map((err, ei) => (
                      <li key={ei}>{err}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}

        {globalError && <p className="text-sm text-[#8a3a3a]">{globalError}</p>}

        {summary && (
          <div className="rounded-[14px] border border-[#cfe3d3] bg-[#f2f8f3] p-4 text-sm text-[#2B2D2F]">
            <p className="font-semibold">Import completato</p>
            <p className="mt-1">Righe importate: {summary.imported}</p>
            <p>Duplicati saltati (già presenti per quella data di estrazione): {summary.duplicatesSkipped}</p>
            {summary.errors.length > 0 && (
              <>
                <p className="mt-2 font-semibold text-[#8a3a3a]">Errori:</p>
                <ul className="list-disc pl-5 text-[#8a3a3a]">
                  {summary.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

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
  const [currentFile, setCurrentFile] = useState<FileEntry | null>(null);
  const [historicalFile, setHistoricalFile] = useState<FileEntry | null>(null);
  const [historicalDate, setHistoricalDate] = useState("");

  // Due azioni indipendenti (import corrente settimanale vs import storico
  // SDLY occasionale) - stato separato per ciascuna, non piu' un'unica
  // submit/summary/error condivisa: l'una non deve mai bloccare ne'
  // dipendere dall'altra.
  const [submittingCurrent, setSubmittingCurrent] = useState(false);
  const [currentSummary, setCurrentSummary] = useState<ImportSummary | null>(null);
  const [currentError, setCurrentError] = useState("");

  const [submittingHistorical, setSubmittingHistorical] = useState(false);
  const [historicalSummary, setHistoricalSummary] = useState<ImportSummary | null>(null);
  const [historicalError, setHistoricalError] = useState("");

  const today = useMemo(() => todayString(), []);

  async function handleFile(file: File, target: "current" | "historical") {
    if (target === "current") {
      setCurrentError("");
      setCurrentSummary(null);
    } else {
      setHistoricalError("");
      setHistoricalSummary(null);
    }

    try {
      const buffer = await readFileAsArrayBuffer(file);
      const { rows, errors } = parseBdExportWorkbook(buffer);
      const entry: FileEntry = { file, structureId: "", rows, parseErrors: errors };

      if (target === "current") setCurrentFile(entry);
      else setHistoricalFile(entry);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (target === "current") setCurrentError(message);
      else setHistoricalError(message);
    }
  }

  const canSubmitCurrent = structureId !== "" && currentFile !== null && currentFile.rows.length > 0;

  const canSubmitHistorical =
    structureId !== "" && historicalFile !== null && historicalFile.rows.length > 0 && historicalDate !== "";

  async function handleSubmitCurrent() {
    setCurrentError("");
    setCurrentSummary(null);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user || !currentFile) {
      setCurrentError("Sessione non valida o file mancante");
      return;
    }

    setSubmittingCurrent(true);

    const result = await processFileImport({
      file: currentFile.file,
      structureId,
      rows: currentFile.rows,
      extractionDate: today,
      uploadedBy: user.id,
    });

    setSubmittingCurrent(false);
    setCurrentSummary({
      imported: result.imported,
      duplicatesSkipped: result.duplicatesSkipped,
      errors: [...currentFile.parseErrors.map((e) => `${currentFile.file.name}: ${e}`), ...result.dbErrors],
    });
    setCurrentFile(null);
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

    setSubmittingHistorical(true);

    const result = await processFileImport({
      file: historicalFile.file,
      structureId,
      rows: historicalFile.rows,
      extractionDate: historicalDate,
      uploadedBy: user.id,
    });

    setSubmittingHistorical(false);
    setHistoricalSummary({
      imported: result.imported,
      duplicatesSkipped: result.duplicatesSkipped,
      errors: [...historicalFile.parseErrors.map((e) => `${historicalFile.file.name}: ${e}`), ...result.dbErrors],
    });
    setHistoricalFile(null);
    setHistoricalDate("");
  }

  return (
    <AppCard
      title="Import actual"
      subtitle="Flusso ricorrente (tipicamente ogni martedì): export BD corrente + uno storico di riferimento per il confronto SDLY."
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
            Export BD corrente — data di estrazione: {today} (oggi, non modificabile)
          </p>
          <div className="mt-3">
            <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              File
            </label>
            <input
              type="file"
              accept=".xls,.xlsx"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0], "current")}
            />
            {currentFile && (
              <p className="mt-2 text-[12px] text-[#6a6d70]">
                {currentFile.file.name} — {currentFile.rows.length} periodi riconosciuti
                {currentFile.parseErrors.length > 0 && `, ${currentFile.parseErrors.length} errori`}
              </p>
            )}
          </div>

          {currentError && <p className="mt-3 text-sm text-[#8a3a3a]">{currentError}</p>}

          {currentSummary && (
            <div className="mt-3 rounded-[14px] border border-[#cfe3d3] bg-[#f2f8f3] p-4 text-sm text-[#2B2D2F]">
              <p className="font-semibold">Import completato</p>
              <p className="mt-1">Righe importate: {currentSummary.imported}</p>
              <p>Duplicati saltati: {currentSummary.duplicatesSkipped}</p>
              {currentSummary.errors.length > 0 && (
                <>
                  <p className="mt-2 font-semibold text-[#8a3a3a]">Errori:</p>
                  <ul className="list-disc pl-5 text-[#8a3a3a]">
                    {currentSummary.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

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
                type="file"
                accept=".xls,.xlsx"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0], "historical")}
              />
            </div>
          </div>
          {historicalFile && (
            <p className="mt-2 text-[12px] text-[#6a6d70]">
              {historicalFile.file.name} — {historicalFile.rows.length} periodi riconosciuti
              {historicalFile.parseErrors.length > 0 && `, ${historicalFile.parseErrors.length} errori`}
            </p>
          )}

          {historicalError && <p className="mt-3 text-sm text-[#8a3a3a]">{historicalError}</p>}

          {historicalSummary && (
            <div className="mt-3 rounded-[14px] border border-[#cfe3d3] bg-[#f2f8f3] p-4 text-sm text-[#2B2D2F]">
              <p className="font-semibold">Import completato</p>
              <p className="mt-1">Righe importate: {historicalSummary.imported}</p>
              <p>Duplicati saltati: {historicalSummary.duplicatesSkipped}</p>
              {historicalSummary.errors.length > 0 && (
                <>
                  <p className="mt-2 font-semibold text-[#8a3a3a]">Errori:</p>
                  <ul className="list-disc pl-5 text-[#8a3a3a]">
                    {historicalSummary.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

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

async function processNationalityImport(params: {
  file: File;
  structureId: string;
  rows: ParsedNationalityRow[];
  extractionDate: string;
  uploadedBy: string;
}): Promise<{ imported: number; duplicatesSkipped: number; dbErrors: string[] }> {
  const { file, structureId, rows, extractionDate, uploadedBy } = params;
  const dbErrors: string[] = [];

  if (rows.length === 0) {
    return { imported: 0, duplicatesSkipped: 0, dbErrors };
  }

  // Duplicati: stessa struttura + stessa extraction_date gia' importata,
  // stesso principio gia' in uso in processFileImport per ADR/RevPAR (una
  // sola volta per data di estrazione, non una entry per ogni upload).
  const dupCheck = await supabase
    .from("guest_nationality")
    .select("id")
    .eq("structure_id", structureId)
    .eq("extraction_date", extractionDate)
    .limit(1);

  if (dupCheck.error) {
    dbErrors.push(`${file.name}: errore verifica duplicati (${dupCheck.error.message})`);
    return { imported: 0, duplicatesSkipped: 0, dbErrors };
  }

  if ((dupCheck.data || []).length > 0) {
    return { imported: 0, duplicatesSkipped: rows.length, dbErrors };
  }

  const storagePath = `${structureId}/${extractionDate}/${Date.now()}-${file.name}`;

  const upload = await supabase.storage.from("bd-import-files").upload(storagePath, file);
  if (upload.error) {
    dbErrors.push(`${file.name}: errore caricamento file (${upload.error.message})`);
    return { imported: 0, duplicatesSkipped: 0, dbErrors };
  }

  const bdImport = await supabase
    .from("bd_imports")
    .insert({
      structure_id: structureId,
      source: "bd_export",
      report_type: "nationality",
      file_name: file.name,
      file_path: storagePath,
      extraction_date: extractionDate,
      uploaded_by: uploadedBy,
    })
    .select("id")
    .single();

  if (bdImport.error || !bdImport.data) {
    dbErrors.push(`${file.name}: errore creazione import (${bdImport.error?.message})`);
    return { imported: 0, duplicatesSkipped: 0, dbErrors };
  }

  const nationalityRows = rows.map((r) => ({
    structure_id: structureId,
    stay_date: r.stayDate,
    extraction_date: extractionDate,
    nationality: r.nationality,
    presences: r.presences,
    bd_import_id: bdImport.data.id,
  }));

  const insert = await supabase.from("guest_nationality").insert(nationalityRows);

  if (insert.error) {
    await supabase.from("bd_imports").delete().eq("id", bdImport.data.id);
    dbErrors.push(`${file.name}: errore salvataggio dati (${insert.error.message})`);
    return { imported: 0, duplicatesSkipped: 0, dbErrors };
  }

  return { imported: nationalityRows.length, duplicatesSkipped: 0, dbErrors };
}

function ImportNazionalita({ structures }: { structures: StructureOption[] }) {
  const [structureId, setStructureId] = useState("");
  const [extractionDate, setExtractionDate] = useState("");
  const [fileEntry, setFileEntry] = useState<{ file: File; rows: ParsedNationalityRow[]; parseErrors: string[] } | null>(
    null
  );
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [globalError, setGlobalError] = useState("");

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

  const canSubmit = structureId !== "" && extractionDate !== "" && fileEntry !== null && fileEntry.rows.length > 0;

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

    setSubmitting(true);

    const result = await processNationalityImport({
      file: fileEntry.file,
      structureId,
      rows: fileEntry.rows,
      extractionDate,
      uploadedBy: user.id,
    });

    setSubmitting(false);
    setSummary({
      imported: result.imported,
      duplicatesSkipped: result.duplicatesSkipped,
      errors: [...fileEntry.parseErrors.map((e) => `${fileEntry.file.name}: ${e}`), ...result.dbErrors],
    });
    setFileEntry(null);
  }

  return (
    <AppCard
      title="Nazionalità"
      subtitle='Report "Ospiti per Nazione" (colonna Data + una colonna per nazionalità). Formato non ancora validato su un file reale — se il file viene rifiutato, verifica le intestazioni riportate nell’errore.'
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
          </div>
        )}

        {globalError && <p className="text-sm text-[#8a3a3a]">{globalError}</p>}

        {summary && (
          <div className="rounded-[14px] border border-[#cfe3d3] bg-[#f2f8f3] p-4 text-sm text-[#2B2D2F]">
            <p className="font-semibold">Import completato</p>
            <p className="mt-1">Righe importate: {summary.imported}</p>
            <p>Duplicati saltati (già presente un import per questa struttura e data di estrazione): {summary.duplicatesSkipped}</p>
            {summary.errors.length > 0 && (
              <>
                <p className="mt-2 font-semibold text-[#8a3a3a]">Errori:</p>
                <ul className="list-disc pl-5 text-[#8a3a3a]">
                  {summary.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <AppButton variant="primary" disabled={!canSubmit || submitting} onClick={handleSubmit}>
            {submitting ? "Import in corso..." : "Importa"}
          </AppButton>
        </div>
      </div>
    </AppCard>
  );
}

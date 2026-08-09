"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { AppCard } from "@/components/ui/AppCard";
import { AppButton } from "@/components/ui/AppButton";
import { AppInput } from "@/components/ui/AppInput";
import { supabase } from "@/lib/supabaseClient";
import { canViewModule } from "@/lib/permissions";

const STRUCTURE_NAME = "Montecallini";
const MAX_RANGE_DAYS = 62;

type StructureInfo = {
  id: string;
  name: string;
  n_rooms: number;
};

type RowState = {
  stayDate: string;
  revenueTotal: string;
  roomsSold: string;
  roomsAvailable: string;
  arrivals: string;
  presences: string;
};

function todayString() {
  return new Date().toISOString().split("T")[0];
}

function generateDateRange(start: string, end: string): string[] {
  const [startY, startM, startD] = start.split("-").map(Number);
  const [endY, endM, endD] = end.split("-").map(Number);

  const dates: string[] = [];
  let cursor = Date.UTC(startY, startM - 1, startD);
  const endTime = Date.UTC(endY, endM - 1, endD);

  while (cursor <= endTime) {
    const dt = new Date(cursor);
    const yyyy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    dates.push(`${yyyy}-${mm}-${dd}`);
    cursor += 24 * 60 * 60 * 1000;
  }

  return dates;
}

function firstDayOfMonth() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function PerformancePage() {
  const router = useRouter();

  const [accessState, setAccessState] = useState<"checking" | "granted" | "denied">(
    "checking"
  );
  const [structure, setStructure] = useState<StructureInfo | null>(null);
  const [structureError, setStructureError] = useState("");

  const [rangeStart, setRangeStart] = useState(firstDayOfMonth());
  const [rangeEnd, setRangeEnd] = useState(todayString());
  const [rangeError, setRangeError] = useState("");

  const [rows, setRows] = useState<RowState[]>([]);
  const [duplicateDates, setDuplicateDates] = useState<Set<string>>(new Set());
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);

  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    void checkAccessAndLoadStructure();
  }, []);

  async function checkAccessAndLoadStructure() {
    const canView = await canViewModule("performance");

    if (!canView) {
      setAccessState("denied");
      router.replace("/dashboard");
      return;
    }

    setAccessState("granted");

    const { data, error } = await supabase
      .from("structures")
      .select("id, name, n_rooms")
      .eq("name", STRUCTURE_NAME)
      .single();

    if (error || !data) {
      setStructureError(`Struttura "${STRUCTURE_NAME}" non trovata: ${error?.message || ""}`);
      return;
    }

    setStructure(data as StructureInfo);
  }

  async function handleGenerateRows() {
    setRangeError("");
    setSubmitError("");
    setSuccessMessage("");

    if (!structure) return;

    if (rangeStart > rangeEnd) {
      setRangeError("La data di inizio deve precedere la data di fine");
      return;
    }

    const dates = generateDateRange(rangeStart, rangeEnd);

    if (dates.length > MAX_RANGE_DAYS) {
      setRangeError(`Range troppo ampio (${dates.length} giorni, massimo ${MAX_RANGE_DAYS})`);
      return;
    }

    setRows(
      dates.map((stayDate) => ({
        stayDate,
        revenueTotal: "",
        roomsSold: "",
        roomsAvailable: String(structure.n_rooms),
        arrivals: "",
        presences: "",
      }))
    );

    setCheckingDuplicates(true);
    const { data, error } = await supabase
      .from("performance_daily_snapshot")
      .select("stay_date")
      .eq("structure_id", structure.id)
      .eq("extraction_date", todayString())
      .in("stay_date", dates);
    setCheckingDuplicates(false);

    if (error) {
      setRangeError(`Errore verifica duplicati: ${error.message}`);
      return;
    }

    setDuplicateDates(new Set((data || []).map((r) => r.stay_date as string)));
  }

  function updateRow(stayDate: string, field: keyof RowState, value: string) {
    setRows((prev) =>
      prev.map((row) => (row.stayDate === stayDate ? { ...row, [field]: value } : row))
    );
  }

  function validateRows(): string | null {
    if (rows.length === 0) return "Genera almeno una riga prima di salvare";

    for (const row of rows) {
      const values = [
        row.revenueTotal,
        row.roomsSold,
        row.roomsAvailable,
        row.arrivals,
        row.presences,
      ];

      for (const v of values) {
        if (v.trim() === "" || Number.isNaN(Number(v))) {
          return `Compila tutti i campi con valori numerici validi (giorno ${row.stayDate})`;
        }
      }
    }

    return null;
  }

  async function handleSubmit() {
    setSubmitError("");
    setSuccessMessage("");

    if (!structure) return;

    if (duplicateDates.size > 0) {
      setSubmitError(
        "Ci sono giorni già inseriti oggi per questa struttura: rimuovili dal range prima di salvare"
      );
      return;
    }

    const validationError = validateRows();
    if (validationError) {
      setSubmitError(validationError);
      return;
    }

    setSaving(true);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setSubmitError("Sessione non valida, rieffettua il login");
      setSaving(false);
      return;
    }

    const extractionDate = todayString();

    // Ricontrollo di sicurezza appena prima dell'insert, per evitare una
    // race condition tra la verifica fatta in "Genera righe" e il submit.
    const recheck = await supabase
      .from("performance_daily_snapshot")
      .select("stay_date")
      .eq("structure_id", structure.id)
      .eq("extraction_date", extractionDate)
      .in(
        "stay_date",
        rows.map((r) => r.stayDate)
      );

    if (recheck.error) {
      setSubmitError(`Errore verifica duplicati: ${recheck.error.message}`);
      setSaving(false);
      return;
    }

    if ((recheck.data || []).length > 0) {
      setDuplicateDates(new Set(recheck.data!.map((r) => r.stay_date as string)));
      setSubmitError(
        "Alcuni giorni sono stati inseriti da qualcun altro nel frattempo: rimuovili dal range prima di salvare"
      );
      setSaving(false);
      return;
    }

    const { data: bdImport, error: bdImportError } = await supabase
      .from("bd_imports")
      .insert({
        structure_id: structure.id,
        source: "manual",
        extraction_date: extractionDate,
        uploaded_by: user.id,
      })
      .select("id")
      .single();

    if (bdImportError || !bdImport) {
      setSubmitError(`Errore creazione import: ${bdImportError?.message}`);
      setSaving(false);
      return;
    }

    const snapshotRows = rows.map((row) => ({
      structure_id: structure.id,
      stay_date: row.stayDate,
      stay_year: Number(row.stayDate.slice(0, 4)),
      extraction_date: extractionDate,
      revenue_total: Number(row.revenueTotal),
      rooms_sold: Number(row.roomsSold),
      rooms_available: Number(row.roomsAvailable),
      arrivals: Number(row.arrivals),
      presences: Number(row.presences),
      bd_import_id: bdImport.id,
    }));

    const { error: snapshotError } = await supabase
      .from("performance_daily_snapshot")
      .insert(snapshotRows);

    if (snapshotError) {
      // Compensazione: l'import senza righe non deve restare orfano.
      await supabase.from("bd_imports").delete().eq("id", bdImport.id);
      setSubmitError(`Errore salvataggio dati: ${snapshotError.message}`);
      setSaving(false);
      return;
    }

    setSaving(false);
    setSuccessMessage(`Salvate ${snapshotRows.length} righe per ${STRUCTURE_NAME}`);
    setRows([]);
    setDuplicateDates(new Set());
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
        title="Inserimento manuale"
        description={`${STRUCTURE_NAME} non ha un export Booking Designer: i dati vengono inseriti qui a mano, con lo stesso formato usato per le altre strutture.`}
      />

      {structureError && (
        <AppCard>
          <p className="text-sm text-[#8a3a3a]">{structureError}</p>
        </AppCard>
      )}

      {structure && (
        <>
          <AppCard title="Seleziona il periodo">
            <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div>
                <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                  Data inizio
                </label>
                <AppInput
                  type="date"
                  value={rangeStart}
                  onChange={(e) => setRangeStart(e.target.value)}
                />
              </div>

              <div>
                <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                  Data fine
                </label>
                <AppInput
                  type="date"
                  value={rangeEnd}
                  onChange={(e) => setRangeEnd(e.target.value)}
                />
              </div>

              <AppButton variant="primary" onClick={handleGenerateRows}>
                {checkingDuplicates ? "Verifica..." : "Genera righe"}
              </AppButton>
            </div>

            {rangeError && <p className="mt-3 text-sm text-[#8a3a3a]">{rangeError}</p>}
          </AppCard>

          {rows.length > 0 && (
            <AppCard
              title="Dati giornalieri"
              subtitle={`${rows.length} giorni — camere disponibili precompilate a ${structure.n_rooms}`}
            >
              {duplicateDates.size > 0 && (
                <p className="mb-4 rounded-[12px] border border-[#e9c9c9] bg-[#fbf1f1] px-4 py-3 text-sm text-[#8a3a3a]">
                  Già presente un inserimento di oggi per: {Array.from(duplicateDates).join(", ")}.
                  Rimuovi queste date dal range prima di salvare.
                </p>
              )}

              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[#e7dfd8] text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                      <th className="pb-3 pr-3">Giorno</th>
                      <th className="pb-3 pr-3">Revenue tot.</th>
                      <th className="pb-3 pr-3">Camere vendute</th>
                      <th className="pb-3 pr-3">Camere disponibili</th>
                      <th className="pb-3 pr-3">Arrivi</th>
                      <th className="pb-3">Presenze</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const isDuplicate = duplicateDates.has(row.stayDate);

                      return (
                        <tr
                          key={row.stayDate}
                          className={`border-b border-[#f0ece6] last:border-0 ${
                            isDuplicate ? "bg-[#fbf1f1]" : ""
                          }`}
                        >
                          <td className="py-2 pr-3 text-[#2B2D2F]">
                            {row.stayDate}
                            {isDuplicate && (
                              <span className="ml-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#8a3a3a]">
                                Duplicato
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-3">
                            <AppInput
                              type="number"
                              value={row.revenueTotal}
                              onChange={(e) =>
                                updateRow(row.stayDate, "revenueTotal", e.target.value)
                              }
                              className={isDuplicate ? "opacity-50" : ""}
                            />
                          </td>
                          <td className="py-2 pr-3">
                            <AppInput
                              type="number"
                              value={row.roomsSold}
                              onChange={(e) =>
                                updateRow(row.stayDate, "roomsSold", e.target.value)
                              }
                              className={isDuplicate ? "opacity-50" : ""}
                            />
                          </td>
                          <td className="py-2 pr-3">
                            <AppInput
                              type="number"
                              value={row.roomsAvailable}
                              onChange={(e) =>
                                updateRow(row.stayDate, "roomsAvailable", e.target.value)
                              }
                              className={isDuplicate ? "opacity-50" : ""}
                            />
                          </td>
                          <td className="py-2 pr-3">
                            <AppInput
                              type="number"
                              value={row.arrivals}
                              onChange={(e) =>
                                updateRow(row.stayDate, "arrivals", e.target.value)
                              }
                              className={isDuplicate ? "opacity-50" : ""}
                            />
                          </td>
                          <td className="py-2">
                            <AppInput
                              type="number"
                              value={row.presences}
                              onChange={(e) =>
                                updateRow(row.stayDate, "presences", e.target.value)
                              }
                              className={isDuplicate ? "opacity-50" : ""}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {submitError && (
                <p className="mt-4 text-sm text-[#8a3a3a]">{submitError}</p>
              )}

              {successMessage && (
                <p className="mt-4 text-sm text-[#2f7d43]">{successMessage}</p>
              )}

              <div className="mt-5 flex justify-end">
                <AppButton
                  variant="primary"
                  disabled={saving || duplicateDates.size > 0}
                  onClick={handleSubmit}
                >
                  {saving ? "Salvataggio..." : "Salva dati"}
                </AppButton>
              </div>
            </AppCard>
          )}
        </>
      )}
    </div>
  );
}

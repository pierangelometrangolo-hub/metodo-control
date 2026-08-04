"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import TrackingStats from "@/components/time-tracking/TrackingStats";
import TrackingAnalysis from "@/components/time-tracking/TrackingAnalysis";
import TrackingForm from "@/components/time-tracking/TrackingForm";
import TrackingList from "@/components/time-tracking/TrackingList";
import { supabase } from "@/lib/supabaseClient";
import {
  trackingOperators,
  consulenzaReferences,
  TrackingArea,
  TrackingEntry,
} from "@/lib/tracking";

type AnalysisFocus =
  | {
      type: "all" | "reference" | "activity" | "operator" | "area";
      value?: string;
    }
  | null;

type AnalysisFiltersState = {
  macroArea: "all" | TrackingArea;
  referenceName: string;
  operator: string;
  activity: string;
  startDate: string;
  endDate: string;
  searchTerm: string;
};

type SelectOption = {
  id: string;
  label: string;
};

type ProfileRow = {
  id: string;
  nome: string | null;
  cognome: string | null;
  email: string | null;
  avatar_url: string | null;
};

type ClientRow = {
  id: string;
  name: string | null;
  status: string | null;
};

type TrackingHistoryRow = {
  id: string;
  campo_modificato: string;
  valore_precedente: string | null;
  valore_nuovo: string | null;
  changed_at: string;
  changed_by: string | null;
};

type TrackingRow = {
  id: string;
  macroarea: string;
  riferimento: string | null;
  client_id: string | null;
  operatore_id: string | null;
  data: string;
  attivita: string;
  minuti: number;
  notes: string | null;
  task_id: string | null;
  subtask_id: string | null;
  created_at: string;
  tracking_history?: TrackingHistoryRow[] | null;
};

function getProfileDisplayName(profile: ProfileRow) {
  const nome = profile.nome?.trim() || "";
  const cognome = profile.cognome?.trim() || "";

  if (!nome && !cognome) {
    return profile.email || profile.id;
  }

  if (!cognome) {
    return nome;
  }

  return `${nome} ${cognome.charAt(0).toUpperCase()}.`;
}

export default function TimeTrackingPage() {
  const today = new Date().toISOString().split("T")[0];

  const [entries, setEntries] = useState<TrackingEntry[]>([]);
  const [analysisFocus, setAnalysisFocus] = useState<AnalysisFocus>(null);

  const [operatorOptions, setOperatorOptions] = useState<SelectOption[]>(
    trackingOperators.map((operator) => ({
      id: operator,
      label: operator,
    }))
  );

  const [clientOptions, setClientOptions] = useState<SelectOption[]>(
    consulenzaReferences.map((client) => ({
      id: client,
      label: client,
    }))
  );

  const [analysisFilters, setAnalysisFilters] = useState<AnalysisFiltersState>({
    macroArea: "all",
    referenceName: "",
    operator: "",
    activity: "",
    startDate: today,
    endDate: today,
    searchTerm: "",
  });

  const totalMinutes = entries.reduce((sum, entry) => sum + entry.minutes, 0);

  useEffect(() => {
    void loadTrackingPageData();
  }, []);

  async function loadTrackingPageData() {
    const [
      { data: profilesData, error: profilesError },
      { data: clientsData, error: clientsError },
      { data: trackingData, error: trackingError },
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, nome, cognome, email, avatar_url")
        .order("nome", { ascending: true }),
      supabase
        .from("clients")
        .select("id, name, status")
        .eq("status", "active")
        .order("name", { ascending: true }),
      supabase
        .from("tracking")
        .select(`
          *,
          tracking_history!tracking_history_tracking_fk (
            id,
            campo_modificato,
            valore_precedente,
            valore_nuovo,
            changed_at,
            changed_by
          )
        `)
        .order("created_at", { ascending: false }),
    ]);

    let nextOperatorOptions: SelectOption[] = trackingOperators.map((operator) => ({
      id: operator,
      label: operator,
    }));

    if (!profilesError && profilesData && profilesData.length > 0) {
      nextOperatorOptions = (profilesData as ProfileRow[])
        .map((profile) => ({
          id: String(profile.id),
          label: getProfileDisplayName(profile),
        }))
        .filter((item) => item.label);

      setOperatorOptions(nextOperatorOptions);
    }

    let nextClientOptions: SelectOption[] = consulenzaReferences.map((client) => ({
      id: client,
      label: client,
    }));

    if (!clientsError && clientsData && clientsData.length > 0) {
      nextClientOptions = (clientsData as ClientRow[])
        .map((client) => ({
          id: String(client.id),
          label: String(client.name || "").trim(),
        }))
        .filter((item) => item.label);

      setClientOptions(nextClientOptions);
    }

    if (trackingError) {
      console.error("Errore fetch tracking:", trackingError.message);
      setEntries([]);
      return;
    }

    const nextOperatorMap = nextOperatorOptions.reduce<Record<string, string>>(
      (acc, item) => {
        acc[item.id] = item.label;
        return acc;
      },
      {}
    );

    const nextClientMap = nextClientOptions.reduce<Record<string, string>>(
      (acc, item) => {
        acc[item.id] = item.label;
        return acc;
      },
      {}
    );

    const fallbackOperator =
      nextOperatorOptions[0]?.label || trackingOperators[0] || "Operatore";

    const mappedEntries: TrackingEntry[] = ((trackingData as TrackingRow[]) || []).map(
      (row) => ({
        id: row.id,
        macroArea: row.macroarea as TrackingArea,
        referenceName:
          row.client_id && nextClientMap[row.client_id]
            ? nextClientMap[row.client_id]
            : row.riferimento || "—",
        operator:
          row.operatore_id && nextOperatorMap[row.operatore_id]
            ? (nextOperatorMap[row.operatore_id] as TrackingEntry["operator"])
            : (fallbackOperator as TrackingEntry["operator"]),
        operatorId: row.operatore_id || undefined,
        clientId: row.client_id || undefined,
        date: row.data ? row.data.split("T")[0] : row.data,
        activity: row.attivita as TrackingEntry["activity"],
        minutes: row.minuti,
        notes: row.notes || undefined,
        taskId: row.task_id || undefined,
        subtaskId: row.subtask_id || undefined,
        createdAt: row.created_at,
        editHistory:
          row.tracking_history?.map((historyItem) => ({
            id: historyItem.id,
            field: mapHistoryField(historyItem.campo_modificato),
            previousValue: historyItem.valore_precedente || "",
            nextValue: historyItem.valore_nuovo || "",
            changedAt: historyItem.changed_at,
            changedBy: historyItem.changed_by ? "Utente" : "Sistema",
          })) || [],
      })
    );

    setEntries(mappedEntries);
  }

  function handleAddEntry(newEntry: TrackingEntry) {
    setEntries((prev) => [newEntry, ...prev]);
  }

  function handleUpdateEntry(entryId: string, patch: Partial<TrackingEntry>) {
    setEntries((prev) =>
      prev.map((entry) => {
        if (entry.id !== entryId) return entry;

        return {
          ...entry,
          ...patch,
          editHistory: patch.editHistory || entry.editHistory,
        };
      })
    );
  }

  function handleOpenAnalysis(focus?: {
    type: "all" | "reference" | "activity" | "operator" | "area";
    value?: string;
  }) {
    setAnalysisFocus(focus ?? { type: "all" });

    requestAnimationFrame(() => {
      const section = document.getElementById("tracking-analysis");
      if (section) {
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="MeToDo Control"
        title="Tracking"
        description="Controllo operativo del tempo registrato con visione chiara su aree, riferimenti, operatori, attività e storico."
      >
        <div className="flex flex-wrap gap-3">
          <div className="rounded-[16px] border border-[#dbe8eb] bg-[#f3f8fa] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#017A92]">
              Registrazioni
            </p>
            <p className="mt-1 text-[22px] font-semibold leading-none text-[#2B2D2F]">
              {entries.length}
            </p>
          </div>

          <div className="rounded-[16px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2B2D2F]">
              Minuti
            </p>
            <p className="mt-1 text-[22px] font-semibold leading-none text-[#2B2D2F]">
              {totalMinutes}
            </p>
          </div>
        </div>
      </PageHeader>

      <TrackingStats entries={entries} onOpenAnalysis={handleOpenAnalysis} />

      <TrackingAnalysis
        entries={entries}
        operators={operatorOptions}
        clientReferences={clientOptions}
        focus={analysisFocus}
        filters={analysisFilters}
        onFiltersChange={setAnalysisFilters}
      />

      <TrackingForm
        onAddEntry={handleAddEntry}
        operators={operatorOptions}
        clientReferences={clientOptions}
      />

      <TrackingList
        entries={entries}
        onUpdateEntry={handleUpdateEntry}
        operators={operatorOptions}
        clientReferences={clientOptions}
      />
    </div>
  );
}

function mapHistoryField(
  value: string
): NonNullable<TrackingEntry["editHistory"]>[number]["field"] {
  switch (value) {
    case "macroarea":
      return "macroArea";
    case "riferimento":
      return "referenceName";
    case "operatore_id":
      return "operatorId";
    case "data":
      return "date";
    case "attivita":
      return "activity";
    case "minuti":
      return "minutes";
    case "notes":
    case "note":
      return "notes";
    case "task_id":
      return "taskId";
    case "subtask_id":
      return "subtaskId";
    case "client_id":
      return "clientId";
    default:
      return "notes";
  }
}
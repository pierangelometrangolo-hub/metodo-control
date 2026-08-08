"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppBadge } from "@/components/ui/AppBadge";
import { AppButton } from "@/components/ui/AppButton";
import { AppCard } from "@/components/ui/AppCard";
import { AppInput } from "@/components/ui/AppInput";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { supabase } from "@/lib/supabaseClient";
import {
  activityMap,
  referenceMap,
  trackingAreas,
  TrackingArea,
  TrackingEntry,
} from "@/lib/tracking";

type SelectOption = {
  id: string;
  label: string;
};

type TaskOption = {
  id: string;
  title: string;
  macroarea: string;
  riferimento: string | null;
};

type SubtaskOption = {
  id: string;
  label: string;
};

type TrackingListProps = {
  entries: TrackingEntry[];
  onUpdateEntry: (entryId: string, patch: Partial<TrackingEntry>) => void;
  operators: SelectOption[];
  clientReferences: SelectOption[];
  tasks: TaskOption[];
  subtasksByTaskId: Record<string, SubtaskOption[]>;
};

type FiltersState = {
  macroArea: "all" | TrackingArea;
  referenceName: string;
  operator: string;
  activity: string;
  startDate: string;
  endDate: string;
  searchTerm: string;
};

type EditFormState = {
  macroArea: TrackingArea;
  referenceName: string;
  operator: string;
  date: string;
  activity: string;
  minutes: string;
  notes: string;
  taskId: string;
  subtaskId: string;
};

const selectClassName =
  "h-10 w-full rounded-[12px] border border-[#e7dfd8] bg-[#fcfbf9] px-3 text-[13px] text-[#2B2D2F] outline-none transition focus:border-[#017A92] focus:bg-white";

const jumpButtonClassName =
  "inline-flex items-center rounded-[10px] border border-[#dbe8eb] bg-[#f3f8fa] px-3 py-2 text-[12px] font-semibold text-[#017A92] transition hover:bg-[#e9f4f6]";

export default function TrackingList({
  entries,
  onUpdateEntry,
  operators,
  clientReferences,
  tasks,
  subtasksByTaskId,
}: TrackingListProps) {
  const router = useRouter();

  const [filters, setFilters] = useState<FiltersState>({
    macroArea: "all",
    referenceName: "",
    operator: "",
    activity: "",
    startDate: "",
    endDate: "",
    searchTerm: "",
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailsOpenId, setDetailsOpenId] = useState<string | null>(null);
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const availableReferences = useMemo(() => {
    if (filters.macroArea === "all") {
      return Array.from(
        new Set([
          ...clientReferences.map((item) => item.label),
          ...Object.entries(referenceMap)
            .filter(([key]) => key !== "consulenza")
            .flatMap(([, values]) => values),
        ])
      );
    }

    if (filters.macroArea === "consulenza") {
      return clientReferences.length > 0
        ? clientReferences.map((item) => item.label)
        : referenceMap.consulenza;
    }

    return referenceMap[filters.macroArea] ?? [];
  }, [filters.macroArea, clientReferences]);

  const availableActivities = useMemo(() => {
    if (filters.macroArea === "all") {
      return Array.from(new Set(Object.values(activityMap).flat()));
    }

    return activityMap[filters.macroArea] ?? [];
  }, [filters.macroArea]);

  const filteredEntries = useMemo(() => {
    const search = filters.searchTerm.trim().toLowerCase();

    return entries.filter((entry) => {
      const matchesMacroArea =
        filters.macroArea === "all" || entry.macroArea === filters.macroArea;

      const matchesReference =
        !filters.referenceName || entry.referenceName === filters.referenceName;

      const matchesOperator =
        !filters.operator || entry.operator === filters.operator;

      const matchesActivity =
        !filters.activity || entry.activity === filters.activity;

      const matchesDateRange =
        (!filters.startDate || entry.date >= filters.startDate) &&
        (!filters.endDate || entry.date <= filters.endDate);

      const matchesSearch =
        search === "" ||
        entry.referenceName.toLowerCase().includes(search) ||
        entry.operator.toLowerCase().includes(search) ||
        entry.activity.toLowerCase().includes(search) ||
        entry.macroArea.toLowerCase().includes(search) ||
        (entry.notes || "").toLowerCase().includes(search) ||
        (entry.taskId || "").toLowerCase().includes(search) ||
        (entry.subtaskId || "").toLowerCase().includes(search);

      return (
        matchesMacroArea &&
        matchesReference &&
        matchesOperator &&
        matchesActivity &&
        matchesDateRange &&
        matchesSearch
      );
    });
  }, [entries, filters]);

  const sortedEntries = useMemo(() => {
    return [...filteredEntries].sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [filteredEntries]);

  useEffect(() => {
    if (!editingId) {
      setEditForm(null);
      return;
    }

    const entry = entries.find((item) => item.id === editingId);
    if (!entry) return;

    setEditForm({
      macroArea: entry.macroArea,
      referenceName: entry.referenceName,
      operator: entry.operator,
      date: entry.date,
      activity: entry.activity,
      minutes: String(entry.minutes),
      notes: entry.notes || "",
      taskId: entry.taskId || "",
      subtaskId: entry.subtaskId || "",
    });
  }, [editingId, entries]);

  function updateFilter<K extends keyof FiltersState>(
    field: K,
    value: FiltersState[K]
  ) {
    const nextFilters: FiltersState = {
      ...filters,
      [field]: value,
    };

    if (field === "macroArea") {
      nextFilters.referenceName = "";
      nextFilters.activity = "";
    }

    setFilters(nextFilters);
  }

  function resetFilters() {
    setFilters({
      macroArea: "all",
      referenceName: "",
      operator: "",
      activity: "",
      startDate: "",
      endDate: "",
      searchTerm: "",
    });
  }

  function updateEditField<K extends keyof EditFormState>(
    field: K,
    value: EditFormState[K]
  ) {
    setEditForm((prev) => {
      if (!prev) return prev;

      const next = {
        ...prev,
        [field]: value,
      };

      if (field === "macroArea") {
        next.referenceName = "";
        next.activity = "";
        next.taskId = "";
        next.subtaskId = "";
      }

      if (field === "referenceName") {
        next.taskId = "";
        next.subtaskId = "";
      }

      if (field === "taskId") {
        next.subtaskId = "";
      }

      return next;
    });
  }

  async function saveEdit(entryId: string) {
    if (!editForm) return;
    if (!editForm.referenceName || !editForm.operator || !editForm.activity) {
      return;
    }

    const previousEntry = entries.find((entry) => entry.id === entryId);
    if (!previousEntry) return;

    const parsedMinutes = Number(editForm.minutes);

    if (Number.isNaN(parsedMinutes) || parsedMinutes <= 0) {
      return;
    }

    const operatorMatch = operators.find(
      (item) => item.label === editForm.operator
    );

    const clientMatch =
      editForm.macroArea === "consulenza"
        ? clientReferences.find((item) => item.label === editForm.referenceName)
        : undefined;

    const patch: Partial<TrackingEntry> = {
      macroArea: editForm.macroArea,
      referenceName: editForm.referenceName,
      operator: editForm.operator as TrackingEntry["operator"],
      operatorId: operatorMatch?.id,
      clientId: clientMatch?.id,
      date: editForm.date,
      activity: editForm.activity as TrackingEntry["activity"],
      minutes: parsedMinutes,
      notes: editForm.notes.trim() || undefined,
      taskId: editForm.taskId.trim() || undefined,
      subtaskId: editForm.subtaskId.trim() || undefined,
    };

    const dbPatch: Record<string, string | number | null> = {
      macroarea: editForm.macroArea,
      riferimento: editForm.referenceName,
      operatore_id: operatorMatch?.id || null,
      client_id: clientMatch?.id || null,
      data: editForm.date,
      attivita: editForm.activity,
      minuti: parsedMinutes,
      notes: editForm.notes.trim() || null,
      task_id: editForm.taskId.trim() || null,
      subtask_id: editForm.subtaskId.trim() || null,
    };

    const historyRows = [
      buildHistoryRow(entryId, "macroarea", previousEntry.macroArea, patch.macroArea),
      buildHistoryRow(entryId, "riferimento", previousEntry.referenceName, patch.referenceName),
      buildHistoryRow(entryId, "operatore_id", previousEntry.operatorId, patch.operatorId),
      buildHistoryRow(entryId, "client_id", previousEntry.clientId, patch.clientId),
      buildHistoryRow(entryId, "data", previousEntry.date, patch.date),
      buildHistoryRow(entryId, "attivita", previousEntry.activity, patch.activity),
      buildHistoryRow(entryId, "minuti", previousEntry.minutes, patch.minutes),
      buildHistoryRow(entryId, "notes", previousEntry.notes, patch.notes),
      buildHistoryRow(entryId, "task_id", previousEntry.taskId, patch.taskId),
      buildHistoryRow(entryId, "subtask_id", previousEntry.subtaskId, patch.subtaskId),
    ].filter(Boolean);

    setSavingId(entryId);

    const { error } = await supabase
      .from("tracking")
      .update(dbPatch)
      .eq("id", entryId);

    if (error) {
      console.error("Errore update tracking:", error.message);
      setSavingId(null);
      return;
    }

    if (historyRows.length > 0) {
      const { error: historyError } = await supabase
        .from("tracking_history")
        .insert(historyRows);

      if (historyError) {
        console.error("Errore inserimento storico tracking:", historyError.message);
      }
    }

    onUpdateEntry(entryId, patch);

    setSavingId(null);
    setEditingId(null);
  }

  function buildHistoryRow(
    trackingId: string,
    campoModificato: string,
    previousValue: unknown,
    nextValue: unknown
  ) {
    const previousString =
      previousValue === undefined || previousValue === null
        ? ""
        : String(previousValue);

    const nextString =
      nextValue === undefined || nextValue === null ? "" : String(nextValue);

    if (previousString === nextString) return null;

    return {
      tracking_id: trackingId,
      campo_modificato: campoModificato,
      valore_precedente: previousString || null,
      valore_nuovo: nextString || null,
    };
  }

  function toggleDetails(entryId: string) {
    setDetailsOpenId((prev) => {
      if (prev === entryId) {
        if (historyOpenId === entryId) {
          setHistoryOpenId(null);
        }
        return null;
      }

      return entryId;
    });
  }

  function toggleHistory(entryId: string) {
    if (detailsOpenId !== entryId) {
      setDetailsOpenId(entryId);
    }

    setHistoryOpenId((prev) => (prev === entryId ? null : entryId));
  }

  function goToOperations(taskId?: string, subtaskId?: string) {
    if (!taskId) return;

    const params = new URLSearchParams();
    params.set("taskId", taskId);

    if (subtaskId) {
      params.set("subtaskId", subtaskId);
    }

    router.push(`/operations?${params.toString()}`);
  }

  return (
    <AppCard className="rounded-[24px] p-7">
      <SectionHeader
        title="Tracking list"
        description="Ricerca e gestione operativa delle registrazioni con filtri avanzati."
        className="mb-6"
        action={
          <AppButton variant="ghost" onClick={resetFilters}>
            Reset filtri
          </AppButton>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_220px_1fr_220px_220px]">
        <div>
          <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
            Ricerca
          </label>
          <AppInput
            placeholder="Cerca per riferimento, operatore, attività, note, task ID o subtask ID"
            value={filters.searchTerm}
            onChange={(e) => updateFilter("searchTerm", e.target.value)}
          />
        </div>

        <div>
          <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
            Macroarea
          </label>
          <select
            value={filters.macroArea}
            onChange={(e) =>
              updateFilter("macroArea", e.target.value as "all" | TrackingArea)
            }
            className={selectClassName}
          >
            <option value="all">Tutte</option>
            {trackingAreas.map((area) => (
              <option key={area} value={area}>
                {formatMacroArea(area)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
            Riferimento
          </label>
          <select
            value={filters.referenceName}
            onChange={(e) => updateFilter("referenceName", e.target.value)}
            className={selectClassName}
          >
            <option value="">Tutti</option>
            {availableReferences.map((reference) => (
              <option key={reference} value={reference}>
                {reference}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
            Operatore
          </label>
          <select
            value={filters.operator}
            onChange={(e) => updateFilter("operator", e.target.value)}
            className={selectClassName}
          >
            <option value="">Tutti</option>
            {operators.map((operator) => (
              <option key={operator.id} value={operator.label}>
                {operator.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
            Attività
          </label>
          <select
            value={filters.activity}
            onChange={(e) => updateFilter("activity", e.target.value)}
            className={selectClassName}
          >
            <option value="">Tutte</option>
            {availableActivities.map((activity) => (
              <option key={activity} value={activity}>
                {formatActivity(activity)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[220px_220px_auto] xl:items-end">
        <div>
          <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
            Data inizio
          </label>
          <AppInput
            type="date"
            value={filters.startDate}
            onChange={(e) => updateFilter("startDate", e.target.value)}
          />
        </div>

        <div>
          <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
            Data fine
          </label>
          <AppInput
            type="date"
            value={filters.endDate}
            onChange={(e) => updateFilter("endDate", e.target.value)}
          />
        </div>

        <div className="rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#017A92]">
            Risultati trovati
          </p>
          <p className="mt-1 text-sm font-semibold text-[#2B2D2F]">
            {sortedEntries.length} registrazioni
          </p>
        </div>
      </div>

      <div className="grid gap-3">
        {sortedEntries.length === 0 ? (
          <div className="rounded-[18px] border border-[#ebe4dc] bg-[#fcfbf9] p-5 text-sm leading-6 text-[#666666]">
            Nessun track trovato con questi filtri.
          </div>
        ) : (
          sortedEntries.map((entry) => {
            const isEditing = editingId === entry.id;
            const isDetailsOpen = detailsOpenId === entry.id;
            const isHistoryOpen = historyOpenId === entry.id;

            const editAvailableReferences =
              editForm && isEditing
                ? editForm.macroArea === "consulenza"
                  ? clientReferences.length > 0
                    ? clientReferences.map((item) => item.label)
                    : referenceMap.consulenza
                  : referenceMap[editForm.macroArea] ?? []
                : entry.macroArea === "consulenza"
                ? clientReferences.length > 0
                  ? clientReferences.map((item) => item.label)
                  : referenceMap.consulenza
                : referenceMap[entry.macroArea] ?? [];

            const editAvailableActivities =
              editForm && isEditing
                ? activityMap[editForm.macroArea] ?? []
                : activityMap[entry.macroArea] ?? [];

            const editAvailableTasks =
              editForm && isEditing
                ? tasks.filter((task) => {
                    const macroareaLabel = formatMacroArea(editForm.macroArea);
                    const matchesMacroarea = task.macroarea === macroareaLabel;
                    const matchesRiferimento =
                      !editForm.referenceName || task.riferimento === editForm.referenceName;

                    return matchesMacroarea && matchesRiferimento;
                  })
                : [];

            const editAvailableSubtasks =
              editForm && isEditing ? subtasksByTaskId[editForm.taskId] || [] : [];

            return (
              <article
                key={entry.id}
                className="rounded-[18px] border border-[#ebe4dc] bg-[#fcfbf9] p-4 shadow-[0_6px_16px_rgba(43,45,47,0.03)]"
              >
                {!isEditing ? (
                  <div className="grid gap-4">
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_220px] xl:items-center">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate font-serif text-[18px] leading-5 text-[#2B2D2F]">
                            {entry.referenceName}
                          </h3>

                          <AppBadge variant="neutral" className="px-2.5 py-0.5 text-[11px]">
                            {formatMacroArea(entry.macroArea)}
                          </AppBadge>

                          <AppBadge variant="info" className="px-2.5 py-0.5 text-[11px]">
                            {formatActivity(entry.activity)}
                          </AppBadge>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-4">
                          <CompactMeta label="Data" value={formatDate(entry.date)} />
                          <CompactMeta label="Operatore" value={entry.operator} />
                          <CompactMeta label="Minuti" value={`${entry.minutes}`} />
                          <CompactMeta
                            label="Modifiche"
                            value={`${entry.editHistory?.length || 0}`}
                          />
                        </div>
                      </div>

                      <div className="rounded-[14px] border border-[#e7dfd8] bg-white px-4 py-3">
                        <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7a726c]">
                          Sintesi
                        </span>
                        <p className="mt-1 line-clamp-2 text-[13px] leading-6 text-[#2B2D2F]">
                          {entry.operator} · {entry.minutes} min ·{" "}
                          {formatActivity(entry.activity)} ·{" "}
                          {formatMacroArea(entry.macroArea)}
                        </p>
                      </div>

                      <div className="flex flex-col gap-2">
                        <AppButton
                          variant="secondary"
                          onClick={() => toggleDetails(entry.id)}
                          className="h-10 justify-start px-3 py-2 text-[12px]"
                        >
                          {isDetailsOpen ? "Nascondi dettaglio" : "Apri dettaglio"}
                        </AppButton>

                        <AppButton
                          variant="ghost"
                          onClick={() => setEditingId(entry.id)}
                          className="h-10 justify-start px-3 py-2 text-[12px]"
                        >
                          Modifica
                        </AppButton>
                      </div>
                    </div>

                    {isDetailsOpen && (
                      <div className="rounded-[14px] border border-[#e7dfd8] bg-white p-4">
                        <div className="grid gap-4 xl:grid-cols-[1.4fr_220px]">
                          <div className="grid gap-4">
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                              <Meta label="Macroarea" value={formatMacroArea(entry.macroArea)} />
                              <Meta label="Riferimento" value={entry.referenceName} />
                              <Meta label="Attività" value={formatActivity(entry.activity)} />
                              <Meta label="Task ID" value={entry.taskId || "—"} />
                              <Meta label="Subtask ID" value={entry.subtaskId || "—"} />
                              <Meta label="Data creazione" value={formatDateTime(entry.createdAt)} />
                            </div>

                            <div className="flex flex-wrap gap-2">
                              {entry.taskId ? (
                                <button
                                  type="button"
                                  onClick={() => goToOperations(entry.taskId, entry.subtaskId)}
                                  className={jumpButtonClassName}
                                >
                                  Apri task in Operations
                                </button>
                              ) : null}

                              {entry.taskId && entry.subtaskId ? (
                                <button
                                  type="button"
                                  onClick={() => goToOperations(entry.taskId, entry.subtaskId)}
                                  className={jumpButtonClassName}
                                >
                                  Apri subtask in Operations
                                </button>
                              ) : null}
                            </div>

                            <div className="grid gap-3 md:grid-cols-2">
                              <DetailBox
                                label="Note"
                                value={entry.notes?.trim() || "Nessuna nota"}
                              />
                              <DetailBox
                                label="Riepilogo operativo"
                                value={`${entry.operator} ha registrato ${entry.minutes} minuti su ${entry.referenceName} per attività di ${formatActivity(
                                  entry.activity
                                ).toLowerCase()}.`}
                              />
                            </div>
                          </div>

                          <div className="flex flex-col gap-3">
                            <div className="rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 py-3">
                              <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7a726c]">
                                Storico
                              </span>
                              <div className="mt-1 text-[22px] font-semibold leading-none text-[#2B2D2F]">
                                {entry.editHistory?.length || 0}
                              </div>
                              <p className="mt-2 text-[12px] leading-5 text-[#666666]">
                                Modifiche registrate su questa voce.
                              </p>
                            </div>

                            <AppButton
                              variant="ghost"
                              onClick={() => toggleHistory(entry.id)}
                              className="h-10 justify-start px-3 py-2 text-[12px]"
                            >
                              {isHistoryOpen
                                ? "Nascondi storico modifiche"
                                : "Apri storico modifiche"}
                            </AppButton>
                          </div>
                        </div>

                        {isHistoryOpen && (
                          <div className="mt-4 border-t border-[#eee7df] pt-4">
                            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#017A92]">
                              Storico modifiche
                            </p>

                            {!entry.editHistory || entry.editHistory.length === 0 ? (
                              <p className="text-sm text-[#666666]">
                                Nessuna modifica registrata.
                              </p>
                            ) : (
                              <div className="grid gap-2">
                                {[...entry.editHistory]
                                  .slice()
                                  .reverse()
                                  .map((item) => (
                                    <HistoryRow key={item.id} item={item} />
                                  ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="grid gap-4">
                    <div>
                      <h3 className="font-serif text-[20px] text-[#2B2D2F]">
                        Modifica track
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-[#666666]">
                        Correggi campi selezionati o eventuali errori di battitura.
                        Le modifiche vengono salvate nello storico.
                      </p>
                    </div>

                    {editForm && (
                      <>
                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.2fr_1fr]">
                          <div>
                            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                              Macroarea
                            </label>
                            <select
                              value={editForm.macroArea}
                              onChange={(e) =>
                                updateEditField("macroArea", e.target.value as TrackingArea)
                              }
                              className={selectClassName}
                            >
                              {trackingAreas.map((area) => (
                                <option key={area} value={area}>
                                  {formatMacroArea(area)}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                              Riferimento
                            </label>
                            <select
                              value={editForm.referenceName}
                              onChange={(e) => updateEditField("referenceName", e.target.value)}
                              className={selectClassName}
                            >
                              <option value="">Seleziona riferimento</option>
                              {editAvailableReferences.map((reference) => (
                                <option key={reference} value={reference}>
                                  {reference}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                              Operatore
                            </label>
                            <select
                              value={editForm.operator}
                              onChange={(e) => updateEditField("operator", e.target.value)}
                              className={selectClassName}
                            >
                              <option value="">Seleziona operatore</option>
                              {operators.map((operator) => (
                                <option key={operator.id} value={operator.label}>
                                  {operator.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr_180px_1fr_1fr]">
                          <div>
                            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                              Data
                            </label>
                            <AppInput
                              type="date"
                              value={editForm.date}
                              onChange={(e) => updateEditField("date", e.target.value)}
                            />
                          </div>

                          <div>
                            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                              Attività
                            </label>
                            <select
                              value={editForm.activity}
                              onChange={(e) => updateEditField("activity", e.target.value)}
                              className={selectClassName}
                            >
                              <option value="">Seleziona attività</option>
                              {editAvailableActivities.map((activity) => (
                                <option key={activity} value={activity}>
                                  {formatActivity(activity)}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                              Minuti
                            </label>
                            <AppInput
                              type="number"
                              value={editForm.minutes}
                              onChange={(e) => updateEditField("minutes", e.target.value)}
                            />
                          </div>

                          <div>
                            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                              Task collegata
                            </label>
                            <select
                              value={editForm.taskId}
                              onChange={(e) => updateEditField("taskId", e.target.value)}
                              className={selectClassName}
                            >
                              <option value="">Nessuna task collegata</option>
                              {editAvailableTasks.map((task) => (
                                <option key={task.id} value={task.id}>
                                  {task.title}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                              Subtask collegata
                            </label>
                            <select
                              value={editForm.subtaskId}
                              onChange={(e) => updateEditField("subtaskId", e.target.value)}
                              className={selectClassName}
                              disabled={editAvailableSubtasks.length === 0}
                            >
                              <option value="">Nessuna subtask collegata</option>
                              {editAvailableSubtasks.map((subtask) => (
                                <option key={subtask.id} value={subtask.id}>
                                  {subtask.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div>
                          <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                            Note
                          </label>
                          <textarea
                            value={editForm.notes}
                            onChange={(e) => updateEditField("notes", e.target.value)}
                            rows={3}
                            className="w-full rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 py-3 text-sm text-[#2B2D2F] outline-none transition placeholder:text-[#8b8f94] focus:border-[#017A92] focus:bg-white"
                          />
                        </div>

                        <div className="flex flex-wrap justify-end gap-2">
                          <AppButton variant="ghost" onClick={() => setEditingId(null)}>
                            Annulla
                          </AppButton>

                          <AppButton onClick={() => saveEdit(entry.id)}>
                            {savingId === entry.id ? "Salvataggio..." : "Salva modifica"}
                          </AppButton>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>
    </AppCard>
  );
}

function CompactMeta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7a726c]">
        {label}
      </span>
      <div className="mt-0.5 text-[13px] font-semibold text-[#2B2D2F] break-words">
        {value}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7a726c]">
        {label}
      </span>
      <div className="mt-0.5 text-[13px] font-semibold text-[#2B2D2F] break-words">
        {value}
      </div>
    </div>
  );
}

function DetailBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 py-3">
      <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7a726c]">
        {label}
      </span>
      <p className="mt-2 text-[13px] leading-6 text-[#2B2D2F]">{value}</p>
    </div>
  );
}

function HistoryRow({
  item,
}: {
  item: NonNullable<TrackingEntry["editHistory"]>[number];
}) {
  return (
    <div className="rounded-[12px] border border-[#e7dfd8] bg-[#fcfbf9] px-3 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#017A92]">
        {formatField(item.field)} · {formatDateTime(item.changedAt)}
      </p>
      <p className="mt-1 text-sm leading-6 text-[#2B2D2F]">
        Da <strong>{item.previousValue || "—"}</strong> a{" "}
        <strong>{item.nextValue || "—"}</strong>
      </p>
      {item.changedBy ? (
        <p className="mt-1 text-[12px] leading-5 text-[#666666]">
          Modificato da <strong>{item.changedBy}</strong>
        </p>
      ) : null}
    </div>
  );
}

function formatField(value: string) {
  switch (value) {
    case "macroArea":
      return "Macroarea";
    case "referenceName":
      return "Riferimento";
    case "operator":
      return "Operatore";
    case "operatorId":
      return "Operatore";
    case "date":
      return "Data";
    case "activity":
      return "Attività";
    case "minutes":
      return "Minuti";
    case "notes":
      return "Note";
    case "taskId":
      return "Task ID";
    case "subtaskId":
      return "Subtask ID";
    case "clientId":
      return "Cliente";
    default:
      return value;
  }
}

function formatDate(date?: string) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("it-IT");
}

function formatDateTime(date?: string) {
  if (!date) return "—";
  return new Date(date).toLocaleString("it-IT");
}

function formatMacroArea(value: string) {
  switch (value) {
    case "consulenza":
      return "Consulenza";
    case "projects":
      return "Projects";
    case "commerciale":
      return "Commerciale";
    case "sales-marketing":
      return "Sales & Marketing";
    case "amministrazione-finance":
      return "Amministrazione & Finance";
    case "it":
      return "IT";
    default:
      return value;
  }
}

function formatActivity(value: string) {
  switch (value) {
    case "call":
      return "Call";
    case "email":
      return "Email";
    case "whatsapp":
      return "WhatsApp";
    case "meeting":
      return "Meeting";
    case "follow up":
      return "Follow up";
    case "analisi":
      return "Analisi";
    case "reportistica":
      return "Reportistica";
    case "amministrazione":
      return "Amministrazione";
    case "organizzazione":
      return "Organizzazione";
    case "coordinamento":
      return "Coordinamento";
    case "on-boarding":
      return "On-boarding";
    case "sviluppo":
      return "Sviluppo";
    case "testing":
      return "Testing";
    case "social media":
      return "Social media";
    case "contenuti":
      return "Contenuti";
    case "PR & networking":
      return "PR & Networking";
    default:
      return value;
  }
}
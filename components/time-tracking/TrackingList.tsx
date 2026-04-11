"use client";

import { useEffect, useMemo, useState } from "react";
import { AppBadge } from "@/components/ui/AppBadge";
import { AppButton } from "@/components/ui/AppButton";
import { AppCard } from "@/components/ui/AppCard";
import { AppInput } from "@/components/ui/AppInput";
import { SectionHeader } from "@/components/ui/SectionHeader";
import {
  referenceMap,
  trackingActivities,
  trackingOperators,
  TrackingArea,
  TrackingEditHistoryItem,
  TrackingEntry,
} from "@/lib/tracking";

type TrackingListProps = {
  entries: TrackingEntry[];
  onUpdateEntry: (
    entryId: string,
    patch: Partial<TrackingEntry>
  ) => void;
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
};

const selectClassName =
  "h-10 w-full rounded-[12px] border border-[#e7dfd8] bg-[#fcfbf9] px-3 text-[13px] text-[#2B2D2F] outline-none transition focus:border-[#017A92] focus:bg-white";

export default function TrackingList({
  entries,
  onUpdateEntry,
}: TrackingListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [entries]);

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
    });
  }, [editingId, entries]);

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
      }

      return next;
    });
  }

  function saveEdit(entryId: string) {
    if (!editForm) return;
    if (!editForm.referenceName || !editForm.operator || !editForm.activity) {
      return;
    }

    const parsedMinutes = Number(editForm.minutes);

    if (Number.isNaN(parsedMinutes) || parsedMinutes <= 0) {
      return;
    }

    onUpdateEntry(entryId, {
      macroArea: editForm.macroArea,
      referenceName: editForm.referenceName,
      operator: editForm.operator as TrackingEntry["operator"],
      date: editForm.date,
      activity: editForm.activity as TrackingEntry["activity"],
      minutes: parsedMinutes,
      notes: editForm.notes.trim(),
      taskId: editForm.taskId.trim() || undefined,
    });

    setEditingId(null);
  }

  return (
    <AppCard className="rounded-[24px] p-7">
      <SectionHeader
        title="Tracking list"
        description="Vista operativa compatta con storico, modifica e tracciabilità delle variazioni."
        className="mb-6"
      />

      <div className="grid gap-3">
        {sortedEntries.length === 0 ? (
          <div className="rounded-[18px] border border-[#ebe4dc] bg-[#fcfbf9] p-5 text-sm leading-6 text-[#666666]">
            Nessun track trovato con questi filtri.
          </div>
        ) : (
          sortedEntries.map((entry) => {
            const isEditing = editingId === entry.id;
            const isHistoryOpen = historyOpenId === entry.id;
            const availableReferences =
              editForm && isEditing
                ? referenceMap[editForm.macroArea] ?? []
                : referenceMap[entry.macroArea] ?? [];

            return (
              <article
                key={entry.id}
                className="rounded-[18px] border border-[#ebe4dc] bg-[#fcfbf9] p-4 shadow-[0_6px_16px_rgba(43,45,47,0.03)]"
              >
                {!isEditing ? (
                  <>
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.9fr_1fr_220px]">
                      <div>
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <h3 className="font-serif text-[18px] leading-5 text-[#2B2D2F]">
                            {entry.referenceName}
                          </h3>

                          <AppBadge
                            variant="neutral"
                            className="px-2.5 py-0.5 text-[11px]"
                          >
                            {formatMacroArea(entry.macroArea)}
                          </AppBadge>

                          <AppBadge
                            variant="info"
                            className="px-2.5 py-0.5 text-[11px]"
                          >
                            {formatActivity(entry.activity)}
                          </AppBadge>
                        </div>

                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-3 xl:grid-cols-5">
                          <Meta label="Operatore" value={entry.operator} />
                          <Meta label="Data" value={formatDate(entry.date)} />
                          <Meta label="Minuti" value={`${entry.minutes}`} />
                          <Meta label="Task ID" value={entry.taskId || "—"} />
                          <Meta
                            label="Note"
                            value={entry.notes?.trim() || "Nessuna nota"}
                          />
                        </div>
                      </div>

                      <div className="rounded-[14px] border border-[#e7dfd8] bg-white px-4 py-3">
                        <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7a726c]">
                          Riepilogo
                        </span>
                        <p className="mt-1 text-[13px] leading-6 text-[#2B2D2F]">
                          {entry.operator} ha registrato {entry.minutes} minuti su{" "}
                          {entry.referenceName} per attività di{" "}
                          {formatActivity(entry.activity).toLowerCase()}.
                        </p>
                      </div>

                      <div className="flex flex-col gap-2">
                        <AppButton
                          variant="secondary"
                          onClick={() => setEditingId(entry.id)}
                          className="h-10 justify-start px-3 py-2 text-[12px]"
                        >
                          Modifica
                        </AppButton>

                        <AppButton
                          variant="ghost"
                          onClick={() =>
                            setHistoryOpenId((prev) =>
                              prev === entry.id ? null : entry.id
                            )
                          }
                          className="h-10 justify-start px-3 py-2 text-[12px]"
                        >
                          {isHistoryOpen ? "Nascondi storico" : "Storico modifiche"}
                        </AppButton>

                        <div className="rounded-[14px] border border-[#e7dfd8] bg-white px-3 py-2">
                          <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7a726c]">
                            Modifiche
                          </span>
                          <div className="mt-1 text-[13px] font-semibold text-[#2B2D2F]">
                            {entry.editHistory?.length || 0}
                          </div>
                        </div>
                      </div>
                    </div>

                    {isHistoryOpen && (
                      <div className="mt-4 rounded-[14px] border border-[#e7dfd8] bg-white p-4">
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
                  </>
                ) : (
                  <div className="grid gap-4">
                    <div>
                      <h3 className="font-serif text-[20px] text-[#2B2D2F]">
                        Modifica track
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-[#666666]">
                        Correggi campi selezionati o eventuali errori di battitura. Le modifiche vengono salvate nello storico.
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
                                updateEditField(
                                  "macroArea",
                                  e.target.value as TrackingArea
                                )
                              }
                              className={selectClassName}
                            >
                              {Object.keys(referenceMap).map((area) => (
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
                              onChange={(e) =>
                                updateEditField("referenceName", e.target.value)
                              }
                              className={selectClassName}
                            >
                              <option value="">Seleziona riferimento</option>
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
                              value={editForm.operator}
                              onChange={(e) =>
                                updateEditField("operator", e.target.value)
                              }
                              className={selectClassName}
                            >
                              <option value="">Seleziona operatore</option>
                              {trackingOperators.map((operator) => (
                                <option key={operator} value={operator}>
                                  {operator}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr_180px_1fr]">
                          <div>
                            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                              Data
                            </label>
                            <AppInput
                              type="date"
                              value={editForm.date}
                              onChange={(e) =>
                                updateEditField("date", e.target.value)
                              }
                            />
                          </div>

                          <div>
                            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                              Attività
                            </label>
                            <select
                              value={editForm.activity}
                              onChange={(e) =>
                                updateEditField("activity", e.target.value)
                              }
                              className={selectClassName}
                            >
                              <option value="">Seleziona attività</option>
                              {trackingActivities.map((activity) => (
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
                              onChange={(e) =>
                                updateEditField("minutes", e.target.value)
                              }
                            />
                          </div>

                          <div>
                            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                              Task ID
                            </label>
                            <AppInput
                              value={editForm.taskId}
                              onChange={(e) =>
                                updateEditField("taskId", e.target.value)
                              }
                              placeholder="Facoltativo"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                            Note
                          </label>
                          <textarea
                            value={editForm.notes}
                            onChange={(e) =>
                              updateEditField("notes", e.target.value)
                            }
                            rows={3}
                            className="w-full rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 py-3 text-sm text-[#2B2D2F] outline-none transition placeholder:text-[#8b8f94] focus:border-[#017A92] focus:bg-white"
                          />
                        </div>

                        <div className="flex flex-wrap justify-end gap-2">
                          <AppButton
                            variant="ghost"
                            onClick={() => setEditingId(null)}
                          >
                            Annulla
                          </AppButton>

                          <AppButton onClick={() => saveEdit(entry.id)}>
                            Salva modifica
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

function HistoryRow({ item }: { item: TrackingEditHistoryItem }) {
  return (
    <div className="rounded-[12px] border border-[#e7dfd8] bg-[#fcfbf9] px-3 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#017A92]">
        {formatField(item.field)} · {formatDateTime(item.changedAt)}
      </p>
      <p className="mt-1 text-sm leading-6 text-[#2B2D2F]">
        Da <strong>{item.previousValue || "—"}</strong> a{" "}
        <strong>{item.nextValue || "—"}</strong>
      </p>
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
    default:
      return value;
  }
}
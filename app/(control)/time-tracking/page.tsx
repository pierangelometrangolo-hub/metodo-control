"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import TrackingStats from "@/components/time-tracking/TrackingStats";
import TrackingAnalysis from "@/components/time-tracking/TrackingAnalysis";
import TrackingForm from "@/components/time-tracking/TrackingForm";
import TrackingFilters, {
  TrackingFiltersState,
} from "@/components/time-tracking/TrackingFilters";
import TrackingList from "@/components/time-tracking/TrackingList";
import {
  mockTrackingEntries,
  trackingOperators,
  TrackingEditHistoryItem,
  TrackingEntry,
} from "@/lib/tracking";

type AnalysisFocus =
  | {
      type: "all" | "reference" | "activity" | "operator" | "area";
      value?: string;
    }
  | null;

export default function TimeTrackingPage() {
  const [entries, setEntries] = useState<TrackingEntry[]>(mockTrackingEntries);
  const [analysisFocus, setAnalysisFocus] = useState<AnalysisFocus>(null);

  const [filters, setFilters] = useState<TrackingFiltersState>({
    macroArea: "all",
    referenceName: "",
    operator: "",
    date: "",
    searchTerm: "",
  });

  function handleAddEntry(newEntry: TrackingEntry) {
    setEntries((prev) => [newEntry, ...prev]);
  }

  function handleUpdateEntry(
    entryId: string,
    patch: Partial<TrackingEntry>
  ) {
    setEntries((prev) =>
      prev.map((entry) => {
        if (entry.id !== entryId) return entry;

        const editableFields: Array<keyof TrackingEntry> = [
          "macroArea",
          "referenceName",
          "operator",
          "date",
          "activity",
          "minutes",
          "notes",
          "taskId",
        ];

        const historyItems: TrackingEditHistoryItem[] = [];

        editableFields.forEach((field) => {
          if (!(field in patch)) return;

          const previousValue = String(entry[field] ?? "");
          const nextValue = String(patch[field] ?? "");

          if (previousValue !== nextValue) {
            historyItems.push({
              id: crypto.randomUUID(),
              changedAt: new Date().toISOString(),
              field: field as TrackingEditHistoryItem["field"],
              previousValue,
              nextValue,
            });
          }
        });

        return {
          ...entry,
          ...patch,
          editHistory: [...(entry.editHistory || []), ...historyItems],
        };
      })
    );
  }

  const totalMinutes = entries.reduce((sum, entry) => sum + entry.minutes, 0);

  const filteredEntries = useMemo(() => {
    const search = filters.searchTerm.trim().toLowerCase();

    return entries.filter((entry) => {
      const matchesMacroArea =
        filters.macroArea === "all" || entry.macroArea === filters.macroArea;

      const matchesReference =
        !filters.referenceName || entry.referenceName === filters.referenceName;

      const matchesOperator =
        !filters.operator || entry.operator === filters.operator;

      const matchesDate = !filters.date || entry.date === filters.date;

      const matchesSearch =
        search === "" ||
        entry.referenceName.toLowerCase().includes(search) ||
        entry.operator.toLowerCase().includes(search) ||
        entry.activity.toLowerCase().includes(search) ||
        entry.macroArea.toLowerCase().includes(search) ||
        (entry.notes || "").toLowerCase().includes(search) ||
        (entry.taskId || "").toLowerCase().includes(search);

      return (
        matchesMacroArea &&
        matchesReference &&
        matchesOperator &&
        matchesDate &&
        matchesSearch
      );
    });
  }, [entries, filters]);

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

      <TrackingAnalysis entries={entries} focus={analysisFocus} />

      <TrackingForm onAddEntry={handleAddEntry} />

      <TrackingFilters
        filters={filters}
        onChange={setFilters}
        operators={[...trackingOperators]}
      />

      <TrackingList
        entries={filteredEntries}
        onUpdateEntry={handleUpdateEntry}
      />
    </div>
  );
}
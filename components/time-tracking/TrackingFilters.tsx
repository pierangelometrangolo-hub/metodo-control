"use client";

import { useMemo } from "react";
import { AppCard } from "@/components/ui/AppCard";
import { AppButton } from "@/components/ui/AppButton";
import { AppInput } from "@/components/ui/AppInput";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { referenceMap, trackingAreas, TrackingArea } from "@/lib/tracking";

export type TrackingFiltersState = {
  macroArea: "all" | TrackingArea;
  referenceName: string;
  operator: string;
  date: string;
  searchTerm: string;
};

type TrackingFiltersProps = {
  filters: TrackingFiltersState;
  onChange: (filters: TrackingFiltersState) => void;
  operators: string[];
};

const selectClassName =
  "h-11 w-full rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 text-sm text-[#2B2D2F] outline-none transition focus:border-[#017A92] focus:bg-white";

export default function TrackingFilters({
  filters,
  onChange,
  operators,
}: TrackingFiltersProps) {
  const availableReferences = useMemo(() => {
    if (filters.macroArea === "all") {
      return Object.values(referenceMap).flat();
    }

    return referenceMap[filters.macroArea] ?? [];
  }, [filters.macroArea]);

  function updateFilter<K extends keyof TrackingFiltersState>(
    field: K,
    value: TrackingFiltersState[K]
  ) {
    const nextFilters = {
      ...filters,
      [field]: value,
    };

    if (field === "macroArea") {
      nextFilters.referenceName = "";
    }

    onChange(nextFilters);
  }

  function resetFilters() {
    onChange({
      macroArea: "all",
      referenceName: "",
      operator: "",
      date: "",
      searchTerm: "",
    });
  }

  return (
    <AppCard className="rounded-[24px] p-7">
      <SectionHeader
        title="Filtri tracking"
        description="Vista operativa compatta con ricerca e lettura del tempo registrato."
        className="mb-6"
        action={
          <AppButton variant="ghost" onClick={resetFilters}>
            Reset filtri
          </AppButton>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_220px_1fr_220px_220px]">
        <div>
          <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
            Ricerca track
          </label>
          <AppInput
            placeholder="Cerca per riferimento, operatore, attività, note o task ID"
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
              <option key={operator} value={operator}>
                {operator}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
            Data
          </label>
          <AppInput
            type="date"
            value={filters.date}
            onChange={(e) => updateFilter("date", e.target.value)}
          />
        </div>
      </div>
    </AppCard>
  );
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
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppButton } from "@/components/ui/AppButton";
import { AppCard } from "@/components/ui/AppCard";
import { AppInput } from "@/components/ui/AppInput";
import { SectionHeader } from "@/components/ui/SectionHeader";
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

type AnalysisFiltersState = {
  macroArea: "all" | TrackingArea;
  referenceName: string;
  operator: string;
  activity: string;
  startDate: string;
  endDate: string;
  searchTerm: string;
};

type Props = {
  entries: TrackingEntry[];
  operators: SelectOption[];
  clientReferences: SelectOption[];
  focus?: {
    type: "all" | "reference" | "activity" | "operator" | "area";
    value?: string;
  } | null;
  filters: AnalysisFiltersState;
  onFiltersChange: (filters: AnalysisFiltersState) => void;
};

type AnalysisGroupKey =
  | "operator"
  | "referenceName"
  | "activity"
  | "macroArea";

type ChartItem = {
  name: string;
  minutes: number;
  percentage: number;
};

type DetailState = {
  group: AnalysisGroupKey;
  label: string;
} | null;

const PIE_COLORS = [
  "#017A92",
  "#2B2D2F",
  "#7BAEB7",
  "#C7DDE1",
  "#D9CEC3",
  "#B9A28E",
  "#7D8A91",
  "#AEC5CA",
];

const selectClassName =
  "h-11 w-full rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 text-sm text-[#2B2D2F] outline-none transition focus:border-[#017A92] focus:bg-white";

const openOperationsButtonClassName =
  "inline-flex h-9 items-center justify-center rounded-[12px] border border-[#017A92] bg-[#f3f8fa] px-3 text-[12px] font-semibold text-[#017A92] transition hover:bg-[#e9f4f6]";

export default function TrackingAnalysis({
  entries,
  operators,
  clientReferences,
  focus = null,
  filters,
  onFiltersChange,
}: Props) {
  const router = useRouter();
  const today = new Date().toISOString().split("T")[0];
  const [selectedDetail, setSelectedDetail] = useState<DetailState>(null);

  function goToOperations(taskId?: string, subtaskId?: string) {
    if (!taskId) return;

    const params = new URLSearchParams();
    params.set("taskId", taskId);

    if (subtaskId) {
      params.set("subtaskId", subtaskId);
    }

    router.push(`/operations?${params.toString()}`);
  }

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

  const filtersResetKey = useMemo(() => {
    return [
      filters.macroArea,
      filters.referenceName,
      filters.operator,
      filters.activity,
      filters.startDate,
      filters.endDate,
      filters.searchTerm,
    ].join("|");
  }, [
    filters.macroArea,
    filters.referenceName,
    filters.operator,
    filters.activity,
    filters.startDate,
    filters.endDate,
    filters.searchTerm,
  ]);

  useEffect(() => {
    setSelectedDetail(null);
  }, [filtersResetKey]);

  useEffect(() => {
    if (!focus) return;

    if (focus.type === "all") {
      setSelectedDetail(null);
      return;
    }

    if (focus.type === "reference" && focus.value) {
      setSelectedDetail({
        group: "referenceName",
        label: focus.value,
      });
      return;
    }

    if (focus.type === "activity" && focus.value) {
      setSelectedDetail({
        group: "activity",
        label: focus.value,
      });
      return;
    }

    if (focus.type === "operator" && focus.value) {
      setSelectedDetail({
        group: "operator",
        label: focus.value,
      });
      return;
    }

    if (focus.type === "area" && focus.value) {
      setSelectedDetail({
        group: "macroArea",
        label: focus.value,
      });
    }
  }, [focus]);

  function updateFilter<K extends keyof AnalysisFiltersState>(
    field: K,
    value: AnalysisFiltersState[K]
  ) {
    const nextFilters: AnalysisFiltersState = {
      ...filters,
      [field]: value,
    };

    if (field === "macroArea") {
      nextFilters.referenceName = "";
      nextFilters.activity = "";
    }

    onFiltersChange(nextFilters);
  }

  function resetFilters() {
    onFiltersChange({
      macroArea: "all",
      referenceName: "",
      operator: "",
      activity: "",
      startDate: today,
      endDate: today,
      searchTerm: "",
    });
    setSelectedDetail(null);
  }

  const analysisEntries = useMemo(() => {
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

      return (
        matchesMacroArea &&
        matchesReference &&
        matchesOperator &&
        matchesActivity &&
        matchesDateRange
      );
    });
  }, [entries, filters]);

  const groupedData = useMemo(() => {
    return {
      byArea: groupEntries(analysisEntries, "macroArea"),
      byReference: groupEntries(analysisEntries, "referenceName"),
      byOperator: groupEntries(analysisEntries, "operator"),
      byActivity: groupEntries(analysisEntries, "activity"),
    };
  }, [analysisEntries]);

  const detailEntries = useMemo(() => {
    if (!selectedDetail) return [];

    return analysisEntries.filter((entry) => {
      if (selectedDetail.group === "operator") {
        return entry.operator === selectedDetail.label;
      }

      if (selectedDetail.group === "referenceName") {
        return entry.referenceName === selectedDetail.label;
      }

      if (selectedDetail.group === "activity") {
        return entry.activity === selectedDetail.label;
      }

      if (selectedDetail.group === "macroArea") {
        return entry.macroArea === selectedDetail.label;
      }

      return false;
    });
  }, [analysisEntries, selectedDetail]);

  const detailMinutes = detailEntries.reduce(
    (sum, entry) => sum + entry.minutes,
    0
  );

  const totalMinutes = analysisEntries.reduce(
    (sum, entry) => sum + entry.minutes,
    0
  );

  const detailPercentage =
    totalMinutes > 0 ? Math.round((detailMinutes / totalMinutes) * 100) : 0;

  return (
    <div id="tracking-analysis">
      <AppCard className="rounded-[24px] p-7">
        <SectionHeader
          title="Analisi operativa"
          description="Distribuzione del tempo per area, riferimento, operatore e attività, con accesso diretto alla task collegata."
          className="mb-6"
          action={
            <AppButton variant="ghost" onClick={resetFilters}>
              Reset filtri
            </AppButton>
          }
        />

        <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[220px_1fr_220px_220px]">
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
              Periodo analizzato
            </p>
            <p className="mt-1 text-sm font-semibold text-[#2B2D2F]">
              {formatRange(filters.startDate, filters.endDate)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <PieAnalysisBlock
            title="Per area"
            items={groupedData.byArea}
            selectedDetail={selectedDetail}
            onSelect={(label) =>
              setSelectedDetail({ group: "macroArea", label })
            }
          />

          <PieAnalysisBlock
            title="Per riferimento"
            items={groupedData.byReference}
            selectedDetail={selectedDetail}
            onSelect={(label) =>
              setSelectedDetail({ group: "referenceName", label })
            }
          />

          <PieAnalysisBlock
            title="Per operatore"
            items={groupedData.byOperator}
            selectedDetail={selectedDetail}
            onSelect={(label) =>
              setSelectedDetail({ group: "operator", label })
            }
          />

          <PieAnalysisBlock
            title="Per attività"
            items={groupedData.byActivity}
            selectedDetail={selectedDetail}
            onSelect={(label) =>
              setSelectedDetail({ group: "activity", label })
            }
          />
        </div>

        <div className="mt-6 rounded-[18px] border border-[#ebe4dc] bg-[#fcfbf9] p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h3 className="text-[20px] text-[#2B2D2F]">
                Dettaglio selezione
              </h3>
              <p className="mt-1 text-sm leading-6 text-[#666666]">
                {selectedDetail
                  ? `Stai leggendo il dettaglio di ${formatLabel(
                      selectedDetail.label
                    )} nel periodo selezionato.`
                  : "Stai leggendo l’insieme delle attività del periodo selezionato."}
              </p>
            </div>

            {selectedDetail && (
              <button
                type="button"
                onClick={() => setSelectedDetail(null)}
                className="inline-flex h-9 items-center justify-center rounded-[14px] border border-[#e7dfd8] bg-white px-4 text-sm font-semibold text-[#2B2D2F] transition hover:bg-[#f7f3ee]"
              >
                Chiudi dettaglio
              </button>
            )}
          </div>

          {!selectedDetail ? (
            <>
              <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-3">
                <DetailMiniCard
                  label="Registrazioni"
                  value={`${analysisEntries.length}`}
                />
                <DetailMiniCard label="Minuti" value={`${totalMinutes}`} />
                <DetailMiniCard
                  label="Periodo"
                  value={formatRange(filters.startDate, filters.endDate)}
                />
              </div>

              <div className="grid gap-3">
                {analysisEntries.length === 0 ? (
                  <div className="rounded-[14px] border border-[#e7dfd8] bg-white p-4 text-sm text-[#666666]">
                    Nessuna attività trovata.
                  </div>
                ) : (
                  analysisEntries.map((entry) => (
                    <article
                      key={entry.id}
                      className="rounded-[16px] border border-[#e7dfd8] bg-white p-4"
                    >
                      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-serif text-[18px] leading-5 text-[#2B2D2F]">
                              {entry.referenceName}
                            </h4>

                            <span className="inline-flex rounded-full border border-[#dbe8eb] bg-[#f3f8fa] px-2.5 py-0.5 text-[11px] font-semibold text-[#017A92]">
                              {formatActivity(entry.activity)}
                            </span>

                            <span className="inline-flex rounded-full border border-[#e7dfd8] bg-[#fcfbf9] px-2.5 py-0.5 text-[11px] font-semibold text-[#2B2D2F]">
                              {formatMacroArea(entry.macroArea)}
                            </span>
                          </div>

                          <p className="mt-2 text-sm leading-6 text-[#666666]">
                            {entry.notes?.trim() || "Nessuna nota inserita"}
                          </p>

                          {entry.taskId ? (
                            <div className="mt-3">
                              <button
                                type="button"
                                onClick={() =>
                                  goToOperations(entry.taskId, entry.subtaskId)
                                }
                                className={openOperationsButtonClassName}
                              >
                                Apri in Operations
                              </button>
                            </div>
                          ) : null}
                        </div>

                        <div className="grid grid-cols-2 gap-x-6 gap-y-2 xl:min-w-[280px]">
                          <Meta label="Operatore" value={entry.operator} />
                          <Meta label="Data" value={formatDate(entry.date)} />
                          <Meta label="Minuti" value={`${entry.minutes}`} />
                          <Meta label="Task ID" value={entry.taskId || "—"} />
                        </div>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-4">
                <DetailMiniCard
                  label="Sezione"
                  value={getDetailGroupLabel(selectedDetail.group)}
                />
                <DetailMiniCard
                  label="Elemento"
                  value={formatLabel(selectedDetail.label)}
                />
                <DetailMiniCard
                  label="Peso sul totale"
                  value={`${detailPercentage}%`}
                />
                <DetailMiniCard
                  label="Periodo"
                  value={formatRange(filters.startDate, filters.endDate)}
                />
              </div>

              <div className="mb-5 rounded-[14px] border border-[#e7dfd8] bg-white px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#017A92]">
                  Tempo registrato
                </p>
                <p className="mt-2 text-[28px] font-semibold leading-none text-[#2B2D2F]">
                  {detailMinutes} min
                </p>
              </div>

              <div className="grid gap-3">
                {detailEntries.length === 0 ? (
                  <div className="rounded-[14px] border border-[#e7dfd8] bg-white p-4 text-sm text-[#666666]">
                    Nessuna attività trovata.
                  </div>
                ) : (
                  detailEntries.map((entry) => (
                    <article
                      key={entry.id}
                      className="rounded-[16px] border border-[#e7dfd8] bg-white p-4"
                    >
                      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-serif text-[18px] leading-5 text-[#2B2D2F]">
                              {entry.referenceName}
                            </h4>

                            <span className="inline-flex rounded-full border border-[#dbe8eb] bg-[#f3f8fa] px-2.5 py-0.5 text-[11px] font-semibold text-[#017A92]">
                              {formatActivity(entry.activity)}
                            </span>

                            <span className="inline-flex rounded-full border border-[#e7dfd8] bg-[#fcfbf9] px-2.5 py-0.5 text-[11px] font-semibold text-[#2B2D2F]">
                              {formatMacroArea(entry.macroArea)}
                            </span>
                          </div>

                          <p className="mt-2 text-sm leading-6 text-[#666666]">
                            {entry.notes?.trim() || "Nessuna nota inserita"}
                          </p>

                          {entry.taskId ? (
                            <div className="mt-3">
                              <button
                                type="button"
                                onClick={() =>
                                  goToOperations(entry.taskId, entry.subtaskId)
                                }
                                className={openOperationsButtonClassName}
                              >
                                Apri in Operations
                              </button>
                            </div>
                          ) : null}
                        </div>

                        <div className="grid grid-cols-2 gap-x-6 gap-y-2 xl:min-w-[280px]">
                          <Meta label="Operatore" value={entry.operator} />
                          <Meta label="Data" value={formatDate(entry.date)} />
                          <Meta label="Minuti" value={`${entry.minutes}`} />
                          <Meta label="Task ID" value={entry.taskId || "—"} />
                        </div>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </AppCard>
    </div>
  );
}

function PieAnalysisBlock({
  title,
  items,
  selectedDetail,
  onSelect,
}: {
  title: string;
  items: ChartItem[];
  selectedDetail: DetailState;
  onSelect: (label: string) => void;
}) {
  return (
    <div className="rounded-[18px] border border-[#ebe4dc] bg-[#fcfbf9] p-4">
      <div className="mb-4">
        <h3 className="text-[18px] text-[#2B2D2F]">{title}</h3>
      </div>

      {items.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-[#e7dfd8] bg-white p-4 text-sm text-[#666666]">
          Nessun dato disponibile nel periodo selezionato.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[260px_1fr]">
          <div className="flex h-[260px] items-center justify-center">
            <SvgPieChart
              items={items}
              selectedLabel={selectedDetail?.label ?? null}
              onSelect={onSelect}
            />
          </div>

          <div className="space-y-2">
            {items.slice(0, 6).map((item, index) => {
              const isSelected = selectedDetail?.label === item.name;

              return (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => onSelect(item.name)}
                  className={`flex w-full items-center justify-between rounded-[12px] border px-3 py-2 text-left transition ${
                    isSelected
                      ? "border-[#017A92] bg-[#f3f8fa]"
                      : "border-[#e7dfd8] bg-white hover:bg-[#f7f3ee]"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{
                        backgroundColor: PIE_COLORS[index % PIE_COLORS.length],
                      }}
                    />
                    <span className="text-sm text-[#2B2D2F]">
                      {formatLabel(item.name)}
                    </span>
                  </div>

                  <div className="text-right">
                    <div className="text-sm font-semibold text-[#017A92]">
                      {item.minutes} min
                    </div>
                    <div className="text-[11px] text-[#666666]">
                      {item.percentage}%
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function SvgPieChart({
  items,
  selectedLabel,
  onSelect,
}: {
  items: ChartItem[];
  selectedLabel: string | null;
  onSelect: (label: string) => void;
}) {
  const radius = 80;
  const innerRadius = 42;
  const center = 110;
  const total = items.reduce((sum, item) => sum + item.minutes, 0);

  const isSingleFullSlice =
    items.length === 1 || items.some((item) => item.percentage === 100);

  if (isSingleFullSlice && items[0]) {
    const slice = items[0];
    const isSelected = selectedLabel === slice.name;

    return (
      <svg width="220" height="220" viewBox="0 0 220 220">
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill={PIE_COLORS[0]}
          onClick={() => onSelect(slice.name)}
          style={{
            cursor: "pointer",
            opacity: selectedLabel && !isSelected ? 0.45 : 1,
            filter: isSelected
              ? "drop-shadow(0 0 8px rgba(1,122,146,0.25))"
              : "none",
            transition: "opacity 0.2s ease",
          }}
        />
        <circle cx={center} cy={center} r={innerRadius} fill="#ffffff" />
        <text
          x={center}
          y={center - 4}
          textAnchor="middle"
          className="fill-[#6b625c]"
          style={{
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.18em",
          }}
        >
          TOTALE
        </text>
        <text
          x={center}
          y={center + 20}
          textAnchor="middle"
          className="fill-[#2B2D2F]"
          style={{ fontSize: "20px", fontWeight: 700 }}
        >
          {total}
        </text>
      </svg>
    );
  }

  let cumulative = -Math.PI / 2;

  const slices = items.map((item, index) => {
    const angle = total > 0 ? (item.minutes / total) * Math.PI * 2 : 0;
    const startAngle = cumulative;
    const endAngle = cumulative + angle;
    cumulative += angle;

    const isSelected = selectedLabel === item.name;

    const path = createDonutSlicePath(
      center,
      center,
      radius,
      innerRadius,
      startAngle,
      endAngle
    );

    return {
      ...item,
      index,
      path,
      color: PIE_COLORS[index % PIE_COLORS.length],
      isSelected,
    };
  });

  return (
    <svg width="220" height="220" viewBox="0 0 220 220">
      {slices.map((slice) => (
        <g key={slice.name}>
          <path
            d={slice.path}
            fill={slice.color}
            stroke="#ffffff"
            strokeWidth="3"
            onClick={() => onSelect(slice.name)}
            style={{
              cursor: "pointer",
              opacity: selectedLabel && !slice.isSelected ? 0.45 : 1,
              filter: slice.isSelected
                ? "drop-shadow(0 0 8px rgba(1,122,146,0.25))"
                : "none",
              transition: "opacity 0.2s ease",
            }}
          />
        </g>
      ))}
      <circle cx={center} cy={center} r={innerRadius - 1} fill="#ffffff" />
      <text
        x={center}
        y={center - 4}
        textAnchor="middle"
        className="fill-[#6b625c]"
        style={{
          fontSize: "10px",
          fontWeight: 700,
          letterSpacing: "0.18em",
        }}
      >
        TOTALE
      </text>
      <text
        x={center}
        y={center + 20}
        textAnchor="middle"
        className="fill-[#2B2D2F]"
        style={{ fontSize: "20px", fontWeight: 700 }}
      >
        {total}
      </text>
    </svg>
  );
}

function createDonutSlicePath(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startAngle: number,
  endAngle: number
) {
  const largeArcFlag = endAngle - startAngle > Math.PI ? 1 : 0;

  const outerStartX = cx + outerR * Math.cos(startAngle);
  const outerStartY = cy + outerR * Math.sin(startAngle);
  const outerEndX = cx + outerR * Math.cos(endAngle);
  const outerEndY = cy + outerR * Math.sin(endAngle);

  const innerStartX = cx + innerR * Math.cos(endAngle);
  const innerStartY = cy + innerR * Math.sin(endAngle);
  const innerEndX = cx + innerR * Math.cos(startAngle);
  const innerEndY = cy + innerR * Math.sin(startAngle);

  return [
    `M ${outerStartX} ${outerStartY}`,
    `A ${outerR} ${outerR} 0 ${largeArcFlag} 1 ${outerEndX} ${outerEndY}`,
    `L ${innerStartX} ${innerStartY}`,
    `A ${innerR} ${innerR} 0 ${largeArcFlag} 0 ${innerEndX} ${innerEndY}`,
    "Z",
  ].join(" ");
}

function DetailMiniCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[14px] border border-[#e7dfd8] bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#017A92]">
        {label}
      </p>
      <p className="mt-2 text-[18px] font-semibold leading-6 text-[#2B2D2F]">
        {value}
      </p>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7a726c]">
        {label}
      </span>
      <div className="mt-0.5 text-[13px] font-semibold text-[#2B2D2F]">
        {value}
      </div>
    </div>
  );
}

function groupEntries(
  entries: TrackingEntry[],
  key: AnalysisGroupKey
): ChartItem[] {
  const totals: Record<string, number> = {};

  entries.forEach((entry) => {
    const value = String(entry[key]);
    totals[value] = (totals[value] || 0) + entry.minutes;
  });

  const totalMinutes = entries.reduce((sum, entry) => sum + entry.minutes, 0);

  return Object.entries(totals)
    .map(([name, minutes]) => ({
      name,
      minutes,
      percentage:
        totalMinutes > 0 ? Math.round((minutes / totalMinutes) * 100) : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes);
}

function getDetailGroupLabel(value: AnalysisGroupKey) {
  switch (value) {
    case "operator":
      return "Operatore";
    case "referenceName":
      return "Riferimento";
    case "activity":
      return "Attività";
    case "macroArea":
      return "Area";
    default:
      return value;
  }
}

function formatRange(start?: string, end?: string) {
  if (!start && !end) return "Tutto il periodo";
  if (start && end && start === end) return formatDate(start);
  return `${formatDate(start)} → ${formatDate(end)}`;
}

function formatDate(date?: string) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("it-IT");
}

function formatLabel(value: string) {
  return formatActivity(formatMacroArea(value));
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
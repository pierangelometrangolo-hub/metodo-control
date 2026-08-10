"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { AppCard } from "@/components/ui/AppCard";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { Calendar, MONTH_LABELS } from "@/components/performance/Calendar";
import { supabase } from "@/lib/supabaseClient";
import { canViewModule } from "@/lib/permissions";
import {
  ND,
  SnapshotRow,
  BudgetRow,
  todayString,
  shiftDate,
  sdlyDate,
  monthRange,
  pad,
  formatCurrency,
  formatPercent,
  formatDelta,
  occupancy,
  adr,
  revPar,
  computePacingStatus,
  pacingLabels,
  pacingDotClasses,
  pacingDetail,
  sumSnapshots,
} from "@/lib/performanceMetrics";

type StructureOption = {
  id: string;
  name: string;
};

type StructureRowData = {
  structure: StructureOption;
  reference: SnapshotRow | null;
  weekAgo: SnapshotRow | null;
  sdly: SnapshotRow | null;
  monthRevenue: number | null;
  lastYearMonthRevenue: number | null;
  budgetsForMonth: BudgetRow[];
  pacing: ReturnType<typeof computePacingStatus>;
};

const [TODAY_YEAR, TODAY_MONTH] = todayString().split("-").map(Number);
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => TODAY_YEAR - 3 + i);

export default function PerformanceOverviewPage() {
  const router = useRouter();

  const [accessState, setAccessState] = useState<"checking" | "granted" | "denied">(
    "checking"
  );
  const [selectedYear, setSelectedYear] = useState(TODAY_YEAR);
  const [selectedMonth, setSelectedMonth] = useState(TODAY_MONTH);
  const [allExtractionDates, setAllExtractionDates] = useState<Set<string>>(new Set());
  const [calendarOpen, setCalendarOpen] = useState(false);

  const [rows, setRows] = useState<StructureRowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const isCurrentMonth = selectedYear === TODAY_YEAR && selectedMonth === TODAY_MONTH;

  useEffect(() => {
    void checkAccess();
  }, []);

  useEffect(() => {
    if (accessState === "granted") void loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessState, selectedYear, selectedMonth]);

  async function checkAccess() {
    const canView = await canViewModule("performance");

    if (!canView) {
      setAccessState("denied");
      router.replace("/dashboard");
      return;
    }

    setAccessState("granted");
  }

  async function loadOverview() {
    setLoading(true);
    setLoadError("");

    const { data: structuresData, error: structuresError } = await supabase
      .from("structures")
      .select("id, name")
      .order("name", { ascending: true });

    if (structuresError) {
      setLoadError(`Errore caricamento strutture: ${structuresError.message}`);
      setLoading(false);
      return;
    }

    const structures = (structuresData as StructureOption[]) || [];
    const ids = structures.map((s) => s.id);

    const { start, end, year, month } = monthRange(`${selectedYear}-${pad(selectedMonth)}-01`);
    // Il mese corrente usa "oggi" come giorno di riferimento per le metriche
    // giornaliere (comportamento invariato). Per qualunque altro mese si usa
    // l'ultimo giorno del mese selezionato come "fotografia di chiusura":
    // per un mese futuro non ci saranno dati (ND), per uno passato è il
    // punto di riferimento più naturale.
    const referenceDate = isCurrentMonth ? todayString() : end;
    const weekAgo = shiftDate(referenceDate, -7);
    const sdly = sdlyDate(referenceDate);
    const lastYearMonth = monthRange(`${year - 1}-${pad(month)}-01`);

    const snapshotColumns =
      "structure_id, stay_date, revenue_total, rooms_sold, rooms_available, arrivals, presences, status";

    const [referenceRes, weekAgoRes, sdlyRes, monthRes, lastYearMonthRes, budgetsRes, importsRes] =
      await Promise.all([
        supabase.from("v_snapshot_latest").select(snapshotColumns).eq("stay_date", referenceDate).in("structure_id", ids),
        supabase.from("v_snapshot_latest").select(snapshotColumns).eq("stay_date", weekAgo).in("structure_id", ids),
        supabase.from("v_snapshot_latest").select(snapshotColumns).eq("stay_date", sdly).in("structure_id", ids),
        supabase
          .from("v_snapshot_latest")
          .select(snapshotColumns)
          .gte("stay_date", start)
          .lte("stay_date", end)
          .in("structure_id", ids),
        supabase
          .from("v_snapshot_latest")
          .select(snapshotColumns)
          .gte("stay_date", lastYearMonth.start)
          .lte("stay_date", lastYearMonth.end)
          .in("structure_id", ids),
        supabase
          .from("v_budgets_current")
          .select("structure_id, level, adr, revenue_target, room_nights_sold_target, room_nights_available, occupancy_pct_target")
          .eq("season_year", year)
          .eq("month", month)
          .in("structure_id", ids),
        supabase.from("bd_imports").select("extraction_date").in("structure_id", ids),
      ]);

    if (referenceRes.error) setLoadError(referenceRes.error.message);
    if (weekAgoRes.error) setLoadError(weekAgoRes.error.message);
    if (sdlyRes.error) setLoadError(sdlyRes.error.message);
    if (monthRes.error) setLoadError(monthRes.error.message);
    if (lastYearMonthRes.error) setLoadError(lastYearMonthRes.error.message);
    if (budgetsRes.error) setLoadError(budgetsRes.error.message);
    if (importsRes.error) setLoadError(importsRes.error.message);

    setAllExtractionDates(new Set((importsRes.data || []).map((r) => r.extraction_date as string)));

    const referenceByStructure = new Map((referenceRes.data || []).map((r) => [r.structure_id, r as SnapshotRow]));
    const weekAgoByStructure = new Map((weekAgoRes.data || []).map((r) => [r.structure_id, r as SnapshotRow]));
    const sdlyByStructure = new Map((sdlyRes.data || []).map((r) => [r.structure_id, r as SnapshotRow]));

    const monthByStructure = new Map<string, SnapshotRow[]>();
    (monthRes.data || []).forEach((r) => {
      const list = monthByStructure.get(r.structure_id) || [];
      list.push(r as SnapshotRow);
      monthByStructure.set(r.structure_id, list);
    });

    const lastYearMonthByStructure = new Map<string, SnapshotRow[]>();
    (lastYearMonthRes.data || []).forEach((r) => {
      const list = lastYearMonthByStructure.get(r.structure_id) || [];
      list.push(r as SnapshotRow);
      lastYearMonthByStructure.set(r.structure_id, list);
    });

    const budgetsByStructure = new Map<string, BudgetRow[]>();
    (budgetsRes.data || []).forEach((r) => {
      const list = budgetsByStructure.get(r.structure_id) || [];
      list.push(r as BudgetRow);
      budgetsByStructure.set(r.structure_id, list);
    });

    const nextRows: StructureRowData[] = structures.map((structure) => {
      const monthSnapshots = monthByStructure.get(structure.id) || [];
      const monthToDate = sumSnapshots(monthSnapshots);
      const lastYearMonthToDate = sumSnapshots(lastYearMonthByStructure.get(structure.id) || []);
      const budgetsForMonth = budgetsByStructure.get(structure.id) || [];

      return {
        structure,
        reference: referenceByStructure.get(structure.id) || null,
        weekAgo: weekAgoByStructure.get(structure.id) || null,
        sdly: sdlyByStructure.get(structure.id) || null,
        monthRevenue: monthToDate.revenue,
        lastYearMonthRevenue: lastYearMonthToDate.revenue,
        budgetsForMonth,
        pacing: computePacingStatus(monthToDate.revenue, budgetsForMonth),
      };
    });

    setRows(nextRows);
    setLoading(false);
  }

  function handleCalendarPick(dateStr: string) {
    const [y, m] = dateStr.split("-").map(Number);
    setSelectedYear(y);
    setSelectedMonth(m);
  }

  if (accessState !== "granted") {
    return null;
  }

  const periodLabel = `${MONTH_LABELS[selectedMonth - 1]} ${selectedYear}`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Performance"
        title="Dashboard Performance"
        description="Stato commerciale di tutte le strutture, con ritmo verso il budget del mese e confronto sulla stessa data della settimana precedente. Seleziona un mese diverso per rivedere periodi passati o futuri."
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
          <Link href="/performance/import" className="text-sm font-medium text-[#017A92] hover:underline">
            Vai a Import (storico / actual) →
          </Link>
          <Link
            href="/performance/inserimento-manuale"
            className="text-sm font-medium text-[#017A92] hover:underline"
          >
            Vai all'inserimento manuale (Montecallini) →
          </Link>
        </div>
      </PageHeader>

      <AppCard
        title="Periodo di riferimento"
        subtitle="Di default mostra il mese corrente. Scegli un mese/anno dai menu, oppure clicca un giorno nel calendario per saltare al mese corrispondente."
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                Mese
              </label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="h-11 rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 text-sm text-[#2B2D2F] outline-none transition focus:border-[#017A92] focus:bg-white"
              >
                {MONTH_LABELS.map((label, i) => (
                  <option key={label} value={i + 1}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                Anno
              </label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="h-11 rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 text-sm text-[#2B2D2F] outline-none transition focus:border-[#017A92] focus:bg-white"
              >
                {YEAR_OPTIONS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            {!isCurrentMonth && (
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedYear(TODAY_YEAR);
                    setSelectedMonth(TODAY_MONTH);
                  }}
                  className="h-11 rounded-[14px] border border-[#e7dfd8] bg-white px-4 text-sm font-medium text-[#017A92] hover:bg-[#f3f8fa]"
                >
                  Torna al mese corrente
                </button>
              </div>
            )}
          </div>

          <div>
            <button
              type="button"
              onClick={() => setCalendarOpen((prev) => !prev)}
              className="flex h-11 items-center gap-2 rounded-[14px] border border-[#e7dfd8] bg-white px-4 text-sm font-medium text-[#017A92] hover:bg-[#f3f8fa]"
            >
              {calendarOpen ? "Nascondi calendario ▲" : "Mostra calendario ▾"}
            </button>

            {calendarOpen && (
              <div className="mt-3">
                <Calendar
                  value={`${selectedYear}-${pad(selectedMonth)}-01`}
                  onChange={handleCalendarPick}
                  highlightedDates={allExtractionDates}
                  legendLabel="giorni con almeno un import reale registrato (qualunque struttura)"
                />
              </div>
            )}
          </div>
        </div>
      </AppCard>

      <AppCard
        title="Strutture"
        subtitle={`Dati riferiti a ${periodLabel}${isCurrentMonth ? " (mese corrente)" : ""} — clicca una riga per il dettaglio giornaliero e il pickup`}
      >
        {loadError && <p className="mb-3 text-sm text-[#8a3a3a]">{loadError}</p>}

        {loading ? (
          <p className="text-sm text-[#6a6d70]">Caricamento...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1400px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#e7dfd8] text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                  <th className="pb-3 pr-4">Struttura</th>
                  <th className="pb-3 pr-4">
                    Revenue OTB (mese)
                    <InfoTooltip text="Somma del revenue on-the-books di tutti i giorni del mese selezionato per cui esiste un dato importato. Valore parziale se il mese non è concluso o mancano import." />
                  </th>
                  <th className="pb-3 pr-4">
                    Ritmo vs budget
                    <InfoTooltip text="Confronta il Revenue OTB del mese selezionato con i tre livelli di budget dello stesso mese: rosso sotto Minimo, giallo tra Minimo e Realistico, verde sopra Realistico. Il dettaglio mostra la distanza in euro dal Budget Minimo." />
                  </th>
                  <th className="pb-3 pr-4">
                    SDLY
                    <InfoTooltip text="Revenue on-the-books del giorno di riferimento (oggi per il mese corrente, ultimo giorno del mese per gli altri) confrontato con l'OTB alla stessa data dell'anno scorso. 'ND' quando manca lo storico per quella data." />
                  </th>
                  <th className="pb-3 pr-4">
                    Consuntivo anno prec. vs OTB
                    <InfoTooltip text="Revenue totale chiuso dello stesso mese dell'anno precedente rispetto al mese selezionato, confrontato con il Revenue OTB del mese selezionato. 'ND' quando manca lo storico per quel mese." />
                  </th>
                  <th className="pb-3 pr-4">
                    ADR
                    <InfoTooltip text="Tariffa media giornaliera: revenue diviso camere vendute, sul giorno di riferimento (oggi per il mese corrente, ultimo giorno del mese per gli altri)." />
                  </th>
                  <th className="pb-3 pr-4">
                    RevPAR
                    <InfoTooltip text="Revenue per camera disponibile: revenue diviso camere disponibili, sul giorno di riferimento (oggi per il mese corrente, ultimo giorno del mese per gli altri)." />
                  </th>
                  <th className="pb-3 pr-4">
                    Occupazione
                    <InfoTooltip text="Camere vendute diviso camere disponibili, sullo stesso giorno di riferimento e sulla stessa riga dati — numeratore e denominatore coprono sempre lo stesso periodo." />
                  </th>
                  <th className="pb-3 pr-4">
                    Budget Minimo
                    <InfoTooltip text="Revenue target dello scenario Minimo per il mese selezionato, da v_budgets_current." />
                  </th>
                  <th className="pb-3 pr-4">
                    Budget Realistico
                    <InfoTooltip text="Revenue target dello scenario Realistico per il mese selezionato, da v_budgets_current." />
                  </th>
                  <th className="pb-3">
                    Budget Sfidante
                    <InfoTooltip text="Revenue target dello scenario Sfidante per il mese selezionato, da v_budgets_current." />
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const referenceAdr = row.reference
                    ? adr(Number(row.reference.revenue_total), Number(row.reference.rooms_sold))
                    : null;
                  const weekAgoAdr = row.weekAgo
                    ? adr(Number(row.weekAgo.revenue_total), Number(row.weekAgo.rooms_sold))
                    : null;

                  const referenceRevPar = row.reference
                    ? revPar(Number(row.reference.revenue_total), Number(row.reference.rooms_available))
                    : null;
                  const weekAgoRevPar = row.weekAgo
                    ? revPar(Number(row.weekAgo.revenue_total), Number(row.weekAgo.rooms_available))
                    : null;

                  const referenceOcc = row.reference
                    ? occupancy(Number(row.reference.rooms_sold), Number(row.reference.rooms_available))
                    : null;
                  const weekAgoOcc = row.weekAgo
                    ? occupancy(Number(row.weekAgo.rooms_sold), Number(row.weekAgo.rooms_available))
                    : null;

                  const referenceRevenue = row.reference ? Number(row.reference.revenue_total) : null;
                  const sdlyRevenue = row.sdly ? Number(row.sdly.revenue_total) : null;

                  const minimoBudget = row.budgetsForMonth.find((b) => b.level === "minimo");
                  const minimoTarget = minimoBudget ? Number(minimoBudget.revenue_target) : null;
                  const detail = pacingDetail(row.monthRevenue, minimoTarget);

                  return (
                    <tr
                      key={row.structure.id}
                      onClick={() => router.push(`/performance/${row.structure.id}`)}
                      className="cursor-pointer border-b border-[#f0ece6] transition last:border-0 hover:bg-[#f8f6f2]"
                    >
                      <td className="py-3 pr-4 font-semibold text-[#2B2D2F]">{row.structure.name}</td>

                      <td className="py-3 pr-4 text-[#2B2D2F]">
                        {row.monthRevenue !== null ? formatCurrency(row.monthRevenue) : ND}
                      </td>

                      <td className="py-3 pr-4">
                        {row.pacing ? (
                          <div>
                            <div className="flex items-center gap-2">
                              <span className={`h-2.5 w-2.5 rounded-full ${pacingDotClasses[row.pacing]}`} />
                              <span className="text-[#2B2D2F]">{pacingLabels[row.pacing]}</span>
                            </div>
                            {detail && <p className="mt-1 text-[11px] text-[#6a6d70]">{detail}</p>}
                          </div>
                        ) : (
                          <span className="text-[#6a6d70]">{ND}</span>
                        )}
                      </td>

                      <MetricCell
                        current={formatCurrency(sdlyRevenue)}
                        delta={formatDelta(referenceRevenue, sdlyRevenue)}
                        deltaLabel="vs SDLY"
                      />

                      <MetricCell
                        current={formatCurrency(row.lastYearMonthRevenue)}
                        delta={formatDelta(row.monthRevenue, row.lastYearMonthRevenue)}
                        deltaLabel="vs mese-anno-scorso"
                      />

                      <MetricCell
                        current={formatCurrency(referenceAdr)}
                        delta={formatDelta(referenceAdr, weekAgoAdr)}
                        deltaLabel="vs 7gg fa"
                      />
                      <MetricCell
                        current={formatCurrency(referenceRevPar)}
                        delta={formatDelta(referenceRevPar, weekAgoRevPar)}
                        deltaLabel="vs 7gg fa"
                      />
                      <MetricCell
                        current={formatPercent(referenceOcc)}
                        delta={formatDelta(referenceOcc, weekAgoOcc)}
                        deltaLabel="vs 7gg fa"
                      />

                      <td className="py-3 pr-4 text-[#2B2D2F]">
                        {(() => {
                          const b = row.budgetsForMonth.find((x) => x.level === "minimo");
                          return b ? formatCurrency(Number(b.revenue_target)) : ND;
                        })()}
                      </td>
                      <td className="py-3 pr-4 text-[#2B2D2F]">
                        {(() => {
                          const b = row.budgetsForMonth.find((x) => x.level === "realistico");
                          return b ? formatCurrency(Number(b.revenue_target)) : ND;
                        })()}
                      </td>
                      <td className="py-3 text-[#2B2D2F]">
                        {(() => {
                          const b = row.budgetsForMonth.find((x) => x.level === "sfidante");
                          return b ? formatCurrency(Number(b.revenue_target)) : ND;
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </AppCard>
    </div>
  );
}

function MetricCell({
  current,
  delta,
  deltaLabel,
}: {
  current: string;
  delta: { text: string; colorClass: string };
  deltaLabel: string;
}) {
  return (
    <td className="py-3 pr-4">
      <p className="text-[#2B2D2F]">{current}</p>
      <p className={`text-[11px] ${delta.colorClass}`}>
        {delta.text} {deltaLabel}
      </p>
    </td>
  );
}

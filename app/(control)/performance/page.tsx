"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { AppCard } from "@/components/ui/AppCard";
import { supabase } from "@/lib/supabaseClient";
import { canViewModule } from "@/lib/permissions";
import {
  ND,
  SnapshotRow,
  BudgetRow,
  todayString,
  shiftDate,
  monthRange,
  formatCurrency,
  formatPercent,
  formatDelta,
  occupancy,
  adr,
  revPar,
  los,
  computePacingStatus,
  pacingLabels,
  pacingDotClasses,
  sumSnapshots,
} from "@/lib/performanceMetrics";

type StructureOption = {
  id: string;
  name: string;
};

type StructureRowData = {
  structure: StructureOption;
  today: SnapshotRow | null;
  weekAgo: SnapshotRow | null;
  monthRevenue: number | null;
  pacing: ReturnType<typeof computePacingStatus>;
};

export default function PerformanceOverviewPage() {
  const router = useRouter();

  const [accessState, setAccessState] = useState<"checking" | "granted" | "denied">(
    "checking"
  );
  const [rows, setRows] = useState<StructureRowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    void checkAccessAndLoad();
  }, []);

  async function checkAccessAndLoad() {
    const canView = await canViewModule("performance");

    if (!canView) {
      setAccessState("denied");
      router.replace("/dashboard");
      return;
    }

    setAccessState("granted");
    await loadOverview();
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

    const today = todayString();
    const weekAgo = shiftDate(today, -7);
    const { start, end, year, month } = monthRange(today);

    const [dayRes, weekAgoRes, monthRes, budgetsRes] = await Promise.all([
      supabase
        .from("v_snapshot_latest")
        .select("structure_id, stay_date, revenue_total, rooms_sold, rooms_available, arrivals, presences, status")
        .eq("stay_date", today)
        .in("structure_id", ids),
      supabase
        .from("v_snapshot_latest")
        .select("structure_id, stay_date, revenue_total, rooms_sold, rooms_available, arrivals, presences, status")
        .eq("stay_date", weekAgo)
        .in("structure_id", ids),
      supabase
        .from("v_snapshot_latest")
        .select("structure_id, stay_date, revenue_total, rooms_sold, rooms_available, arrivals, presences, status")
        .gte("stay_date", start)
        .lte("stay_date", end)
        .in("structure_id", ids),
      supabase
        .from("budgets")
        .select("structure_id, level, adr, revenue_target, room_nights_sold_target, room_nights_available, occupancy_pct_target")
        .eq("season_year", year)
        .eq("month", month)
        .in("structure_id", ids),
    ]);

    if (dayRes.error) setLoadError(dayRes.error.message);
    if (weekAgoRes.error) setLoadError(weekAgoRes.error.message);
    if (monthRes.error) setLoadError(monthRes.error.message);
    if (budgetsRes.error) setLoadError(budgetsRes.error.message);

    const dayByStructure = new Map((dayRes.data || []).map((r) => [r.structure_id, r as SnapshotRow]));
    const weekAgoByStructure = new Map((weekAgoRes.data || []).map((r) => [r.structure_id, r as SnapshotRow]));

    const monthByStructure = new Map<string, SnapshotRow[]>();
    (monthRes.data || []).forEach((r) => {
      const list = monthByStructure.get(r.structure_id) || [];
      list.push(r as SnapshotRow);
      monthByStructure.set(r.structure_id, list);
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
      const budgetsForMonth = budgetsByStructure.get(structure.id) || [];

      return {
        structure,
        today: dayByStructure.get(structure.id) || null,
        weekAgo: weekAgoByStructure.get(structure.id) || null,
        monthRevenue: monthToDate.revenue,
        pacing: computePacingStatus(monthToDate.revenue, budgetsForMonth),
      };
    });

    setRows(nextRows);
    setLoading(false);
  }

  if (accessState !== "granted") {
    return null;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Performance"
        title="Vista d'insieme"
        description="Snapshot di oggi per tutte le strutture, confronto vs la stessa data di 7 giorni fa, ritmo del mese in corso rispetto al budget. 'ND' indica che manca un dato — mai un valore pari a zero."
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

      <AppCard title="Strutture" subtitle="Clicca una riga per il dettaglio giornaliero e il pickup">
        {loadError && <p className="mb-3 text-sm text-[#8a3a3a]">{loadError}</p>}

        {loading ? (
          <p className="text-sm text-[#6a6d70]">Caricamento...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#e7dfd8] text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                  <th className="pb-3 pr-4">Struttura</th>
                  <th className="pb-3 pr-4">ADR</th>
                  <th className="pb-3 pr-4">RevPAR</th>
                  <th className="pb-3 pr-4">Occupazione</th>
                  <th className="pb-3 pr-4">LOS</th>
                  <th className="pb-3">Ritmo mese vs budget</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const todayAdr = row.today ? adr(Number(row.today.revenue_total), Number(row.today.rooms_sold)) : null;
                  const weekAgoAdr = row.weekAgo
                    ? adr(Number(row.weekAgo.revenue_total), Number(row.weekAgo.rooms_sold))
                    : null;

                  const todayRevPar = row.today
                    ? revPar(Number(row.today.revenue_total), Number(row.today.rooms_available))
                    : null;
                  const weekAgoRevPar = row.weekAgo
                    ? revPar(Number(row.weekAgo.revenue_total), Number(row.weekAgo.rooms_available))
                    : null;

                  const todayOcc = row.today
                    ? occupancy(Number(row.today.rooms_sold), Number(row.today.rooms_available))
                    : null;
                  const weekAgoOcc = row.weekAgo
                    ? occupancy(Number(row.weekAgo.rooms_sold), Number(row.weekAgo.rooms_available))
                    : null;

                  const todayLos = row.today ? los(Number(row.today.rooms_sold), Number(row.today.arrivals)) : null;
                  const weekAgoLos = row.weekAgo
                    ? los(Number(row.weekAgo.rooms_sold), Number(row.weekAgo.arrivals))
                    : null;

                  return (
                    <tr
                      key={row.structure.id}
                      onClick={() => router.push(`/performance/${row.structure.id}`)}
                      className="cursor-pointer border-b border-[#f0ece6] transition last:border-0 hover:bg-[#f8f6f2]"
                    >
                      <td className="py-3 pr-4 font-semibold text-[#2B2D2F]">{row.structure.name}</td>
                      <MetricCell current={formatCurrency(todayAdr)} delta={formatDelta(todayAdr, weekAgoAdr)} />
                      <MetricCell current={formatCurrency(todayRevPar)} delta={formatDelta(todayRevPar, weekAgoRevPar)} />
                      <MetricCell current={formatPercent(todayOcc)} delta={formatDelta(todayOcc, weekAgoOcc)} />
                      <MetricCell
                        current={todayLos !== null ? todayLos.toLocaleString("it-IT", { maximumFractionDigits: 1 }) : ND}
                        delta={formatDelta(todayLos, weekAgoLos)}
                      />
                      <td className="py-3">
                        {row.pacing ? (
                          <div className="flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full ${pacingDotClasses[row.pacing]}`} />
                            <span className="text-[#2B2D2F]">{pacingLabels[row.pacing]}</span>
                          </div>
                        ) : (
                          <span className="text-[#6a6d70]">{ND}</span>
                        )}
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

function MetricCell({ current, delta }: { current: string; delta: { text: string; colorClass: string } }) {
  return (
    <td className="py-3 pr-4">
      <p className="text-[#2B2D2F]">{current}</p>
      <p className={`text-[11px] ${delta.colorClass}`}>{delta.text} vs 7gg fa</p>
    </td>
  );
}

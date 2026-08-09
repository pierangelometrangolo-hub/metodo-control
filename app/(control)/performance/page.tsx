"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { AppCard } from "@/components/ui/AppCard";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
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
  sdly: SnapshotRow | null;
  monthRevenue: number | null;
  lastYearMonthRevenue: number | null;
  budgetsForMonth: BudgetRow[];
  pacing: ReturnType<typeof computePacingStatus>;
};

function pacingDetail(monthRevenue: number | null, minimoTarget: number | null): string | null {
  if (monthRevenue === null || minimoTarget === null) return null;

  const diff = monthRevenue - minimoTarget;
  const diffFormatted = formatCurrency(Math.abs(diff));

  if (diff < 0) {
    return `Budget Minimo: ${formatCurrency(minimoTarget)} — mancano ${diffFormatted}`;
  }

  return `Budget Minimo: ${formatCurrency(minimoTarget)} — +${diffFormatted} sopra Minimo`;
}

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
    const sdly = sdlyDate(today);
    const { start, end, year, month } = monthRange(today);
    const lastYearMonth = monthRange(`${year - 1}-${pad(month)}-01`);

    const snapshotColumns =
      "structure_id, stay_date, revenue_total, rooms_sold, rooms_available, arrivals, presences, status";

    const [dayRes, weekAgoRes, sdlyRes, monthRes, lastYearMonthRes, budgetsRes] = await Promise.all([
      supabase.from("v_snapshot_latest").select(snapshotColumns).eq("stay_date", today).in("structure_id", ids),
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
    ]);

    if (dayRes.error) setLoadError(dayRes.error.message);
    if (weekAgoRes.error) setLoadError(weekAgoRes.error.message);
    if (sdlyRes.error) setLoadError(sdlyRes.error.message);
    if (monthRes.error) setLoadError(monthRes.error.message);
    if (lastYearMonthRes.error) setLoadError(lastYearMonthRes.error.message);
    if (budgetsRes.error) setLoadError(budgetsRes.error.message);

    const dayByStructure = new Map((dayRes.data || []).map((r) => [r.structure_id, r as SnapshotRow]));
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
        today: dayByStructure.get(structure.id) || null,
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

  if (accessState !== "granted") {
    return null;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Performance"
        title="Dashboard Performance"
        description="Stato commerciale di tutte le strutture aggiornato a oggi, con ritmo verso il budget del mese e confronto sulla stessa data della settimana precedente."
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
            <table className="w-full min-w-[1400px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#e7dfd8] text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                  <th className="pb-3 pr-4">Struttura</th>
                  <th className="pb-3 pr-4">
                    Revenue OTB (mese)
                    <InfoTooltip text="Somma del revenue on-the-books di tutti i giorni del mese corrente per cui esiste un dato importato. Valore parziale se il mese non è concluso o mancano import." />
                  </th>
                  <th className="pb-3 pr-4">
                    Ritmo vs budget
                    <InfoTooltip text="Confronta il Revenue OTB del mese corrente con i tre livelli di budget dello stesso mese: rosso sotto Minimo, giallo tra Minimo e Realistico, verde sopra Realistico. Il dettaglio mostra la distanza in euro dal Budget Minimo." />
                  </th>
                  <th className="pb-3 pr-4">
                    SDLY
                    <InfoTooltip text="Revenue on-the-books di oggi confrontato con l'OTB registrato alla stessa data dell'anno scorso (same day last year). 'ND' quando manca lo storico per quella data." />
                  </th>
                  <th className="pb-3 pr-4">
                    Storico consuntivo mese-anno-scorso
                    <InfoTooltip text="Revenue totale chiuso dello stesso mese dell'anno precedente (es. agosto 2025 se oggi siamo in agosto 2026), confrontato con il Revenue OTB del mese corrente. 'ND' quando manca lo storico per quel mese." />
                  </th>
                  <th className="pb-3 pr-4">
                    ADR
                    <InfoTooltip text="Tariffa media giornaliera (Average Daily Rate): revenue di oggi diviso camere vendute oggi. Calcolato sul singolo giorno, non sul mese." />
                  </th>
                  <th className="pb-3 pr-4">
                    RevPAR
                    <InfoTooltip text="Revenue per camera disponibile: revenue di oggi diviso camere disponibili oggi. Calcolato sul singolo giorno, non sul mese." />
                  </th>
                  <th className="pb-3 pr-4">
                    Occupazione
                    <InfoTooltip text="Camere vendute diviso camere disponibili, nello stesso giorno (oggi) e sulla stessa riga dati — numeratore e denominatore coprono sempre lo stesso periodo." />
                  </th>
                  <th className="pb-3 pr-4">
                    Budget Minimo
                    <InfoTooltip text="Revenue target dello scenario Minimo per il mese corrente, da v_budgets_current." />
                  </th>
                  <th className="pb-3 pr-4">
                    Budget Realistico
                    <InfoTooltip text="Revenue target dello scenario Realistico per il mese corrente, da v_budgets_current." />
                  </th>
                  <th className="pb-3">
                    Budget Sfidante
                    <InfoTooltip text="Revenue target dello scenario Sfidante per il mese corrente, da v_budgets_current." />
                  </th>
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

                  const todayRevenue = row.today ? Number(row.today.revenue_total) : null;
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
                        delta={formatDelta(todayRevenue, sdlyRevenue)}
                        deltaLabel="vs SDLY"
                      />

                      <MetricCell
                        current={formatCurrency(row.lastYearMonthRevenue)}
                        delta={formatDelta(row.monthRevenue, row.lastYearMonthRevenue)}
                        deltaLabel="vs mese-anno-scorso"
                      />

                      <MetricCell current={formatCurrency(todayAdr)} delta={formatDelta(todayAdr, weekAgoAdr)} deltaLabel="vs 7gg fa" />
                      <MetricCell
                        current={formatCurrency(todayRevPar)}
                        delta={formatDelta(todayRevPar, weekAgoRevPar)}
                        deltaLabel="vs 7gg fa"
                      />
                      <MetricCell
                        current={formatPercent(todayOcc)}
                        delta={formatDelta(todayOcc, weekAgoOcc)}
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

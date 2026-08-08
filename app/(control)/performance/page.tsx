"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { AppCard } from "@/components/ui/AppCard";
import { AppInput } from "@/components/ui/AppInput";
import { supabase } from "@/lib/supabaseClient";
import { canViewModule } from "@/lib/permissions";

type StructureOption = {
  id: string;
  name: string;
};

type SnapshotRow = {
  stay_date: string;
  revenue_total: number;
  rooms_sold: number;
  rooms_available: number;
  arrivals: number;
  presences: number;
  status: "otb" | "in_corso" | "consuntivo" | string;
};

type BudgetRow = {
  level: "minimo" | "realistico" | "sfidante";
  adr: number;
  revenue_target: number;
  room_nights_sold_target: number;
  room_nights_available: number;
  occupancy_pct_target: number;
};

const ND = "ND";

function todayString() {
  return new Date().toISOString().split("T")[0];
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function sdlyDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y - 1, m - 1, d));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function monthRange(dateStr: string) {
  const [y, m] = dateStr.split("-").map(Number);
  const start = `${y}-${pad(m)}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${y}-${pad(m)}-${pad(lastDay)}`;
  return { start, end, year: y, month: m, daysInMonth: lastDay };
}

function formatCurrency(value: number | null) {
  if (value === null) return ND;
  return value.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

function formatNumber(value: number | null, digits = 0) {
  if (value === null) return ND;
  return value.toLocaleString("it-IT", { maximumFractionDigits: digits });
}

function formatPercent(value: number | null) {
  if (value === null) return ND;
  return `${(value * 100).toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`;
}

function occupancy(soldOrNull: number | null, available: number | null) {
  if (soldOrNull === null || available === null || available === 0) return null;
  return soldOrNull / available;
}

const budgetLevelLabels: Record<string, string> = {
  minimo: "Minimo",
  realistico: "Realistico",
  sfidante: "Sfidante",
};

export default function PerformanceDashboardPage() {
  const router = useRouter();

  const [accessState, setAccessState] = useState<"checking" | "granted" | "denied">(
    "checking"
  );

  const [structures, setStructures] = useState<StructureOption[]>([]);
  const [structureId, setStructureId] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState(todayString());

  const [daySnapshot, setDaySnapshot] = useState<SnapshotRow | null>(null);
  const [sdlySnapshot, setSdlySnapshot] = useState<SnapshotRow | null>(null);
  const [monthSnapshots, setMonthSnapshots] = useState<SnapshotRow[]>([]);
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);

  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    void checkAccessAndLoadStructures();
  }, []);

  async function checkAccessAndLoadStructures() {
    const canView = await canViewModule("performance");

    if (!canView) {
      setAccessState("denied");
      router.replace("/dashboard");
      return;
    }

    setAccessState("granted");

    const { data, error } = await supabase
      .from("structures")
      .select("id, name")
      .order("name", { ascending: true });

    if (error) {
      setLoadError(`Errore caricamento strutture: ${error.message}`);
      return;
    }

    setStructures((data as StructureOption[]) || []);
    if (data && data.length > 0) {
      setStructureId(data[0].id);
    }
  }

  useEffect(() => {
    if (structureId) void loadMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureId, selectedDate]);

  async function loadMetrics() {
    setLoadingMetrics(true);
    setLoadError("");

    const sdly = sdlyDate(selectedDate);
    const { start, end, year, month } = monthRange(selectedDate);

    const [dayRes, sdlyRes, monthRes, budgetsRes] = await Promise.all([
      supabase
        .from("v_snapshot_latest")
        .select("stay_date, revenue_total, rooms_sold, rooms_available, arrivals, presences, status")
        .eq("structure_id", structureId)
        .eq("stay_date", selectedDate)
        .maybeSingle(),
      supabase
        .from("v_snapshot_latest")
        .select("stay_date, revenue_total, rooms_sold, rooms_available, arrivals, presences, status")
        .eq("structure_id", structureId)
        .eq("stay_date", sdly)
        .maybeSingle(),
      supabase
        .from("v_snapshot_latest")
        .select("stay_date, revenue_total, rooms_sold, rooms_available, arrivals, presences, status")
        .eq("structure_id", structureId)
        .gte("stay_date", start)
        .lte("stay_date", end),
      supabase
        .from("budgets")
        .select("level, adr, revenue_target, room_nights_sold_target, room_nights_available, occupancy_pct_target")
        .eq("structure_id", structureId)
        .eq("season_year", year)
        .eq("month", month),
    ]);

    if (dayRes.error) setLoadError(dayRes.error.message);
    if (sdlyRes.error) setLoadError(sdlyRes.error.message);
    if (monthRes.error) setLoadError(monthRes.error.message);
    if (budgetsRes.error) setLoadError(budgetsRes.error.message);

    setDaySnapshot((dayRes.data as SnapshotRow) || null);
    setSdlySnapshot((sdlyRes.data as SnapshotRow) || null);
    setMonthSnapshots((monthRes.data as SnapshotRow[]) || []);
    setBudgets((budgetsRes.data as BudgetRow[]) || []);

    setLoadingMetrics(false);
  }

  const monthToDate = useMemo(() => {
    if (monthSnapshots.length === 0) {
      return { revenue: null, roomsSold: null, roomsAvailable: null, arrivals: null, presences: null, daysWithData: 0 };
    }

    const totals = monthSnapshots.reduce(
      (acc, row) => ({
        revenue: acc.revenue + Number(row.revenue_total),
        roomsSold: acc.roomsSold + Number(row.rooms_sold),
        roomsAvailable: acc.roomsAvailable + Number(row.rooms_available),
        arrivals: acc.arrivals + Number(row.arrivals),
        presences: acc.presences + Number(row.presences),
      }),
      { revenue: 0, roomsSold: 0, roomsAvailable: 0, arrivals: 0, presences: 0 }
    );

    return { ...totals, daysWithData: monthSnapshots.length };
  }, [monthSnapshots]);

  const selectedStructureName = structures.find((s) => s.id === structureId)?.name || "";
  const { daysInMonth } = monthRange(selectedDate);

  if (accessState !== "granted") {
    return null;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Performance"
        title="Dashboard"
        description="Confronto giornaliero vs stesso giorno anno precedente (SDLY) e mese in corso vs budget. 'ND' indica che non esiste ancora un dato importato per quella struttura/data — mai un valore pari a zero."
      >
        <Link
          href="/performance/inserimento-manuale"
          className="text-sm font-medium text-[#017A92] hover:underline"
        >
          Vai all'inserimento manuale (Montecallini) →
        </Link>
      </PageHeader>

      <AppCard title="Struttura e data">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              Struttura
            </label>
            <select
              value={structureId}
              onChange={(e) => setStructureId(e.target.value)}
              className="h-11 w-full rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 text-sm text-[#2B2D2F] outline-none transition focus:border-[#017A92] focus:bg-white"
            >
              {structures.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              Giorno di riferimento
            </label>
            <AppInput
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
        </div>

        {loadError && <p className="mt-3 text-sm text-[#8a3a3a]">{loadError}</p>}
      </AppCard>

      <AppCard
        title={`${selectedStructureName} — ${selectedDate}`}
        subtitle={
          daySnapshot
            ? `Dato ${daySnapshot.status === "consuntivo" ? "consuntivo" : daySnapshot.status === "otb" ? "on-the-books" : "in corso"} · confronto con ${sdlyDate(selectedDate)} (SDLY)`
            : `Nessun dato importato per questo giorno · confronto con ${sdlyDate(selectedDate)} (SDLY)`
        }
      >
        {loadingMetrics ? (
          <p className="text-sm text-[#6a6d70]">Caricamento...</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Revenue"
              current={formatCurrency(daySnapshot ? Number(daySnapshot.revenue_total) : null)}
              sdly={formatCurrency(sdlySnapshot ? Number(sdlySnapshot.revenue_total) : null)}
            />
            <KpiCard
              label="Occupazione"
              current={formatPercent(
                occupancy(
                  daySnapshot ? Number(daySnapshot.rooms_sold) : null,
                  daySnapshot ? Number(daySnapshot.rooms_available) : null
                )
              )}
              sdly={formatPercent(
                occupancy(
                  sdlySnapshot ? Number(sdlySnapshot.rooms_sold) : null,
                  sdlySnapshot ? Number(sdlySnapshot.rooms_available) : null
                )
              )}
            />
            <KpiCard
              label="Arrivi"
              current={formatNumber(daySnapshot ? Number(daySnapshot.arrivals) : null)}
              sdly={formatNumber(sdlySnapshot ? Number(sdlySnapshot.arrivals) : null)}
            />
            <KpiCard
              label="Presenze"
              current={formatNumber(daySnapshot ? Number(daySnapshot.presences) : null)}
              sdly={formatNumber(sdlySnapshot ? Number(sdlySnapshot.presences) : null)}
            />
          </div>
        )}
      </AppCard>

      <AppCard
        title="Mese in corso vs budget"
        subtitle={
          monthToDate.daysWithData > 0
            ? `Somma di ${monthToDate.daysWithData} giorni con dati su ${daysInMonth} del mese (dato parziale se il mese non è concluso o mancano import)`
            : "Nessun dato importato per questo mese"
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[#e7dfd8] text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                <th className="pb-3 pr-4">Scenario</th>
                <th className="pb-3 pr-4">Revenue target</th>
                <th className="pb-3 pr-4">Revenue reale (mese)</th>
                <th className="pb-3 pr-4">Occupazione target</th>
                <th className="pb-3">Occupazione reale (mese)</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[#f0ece6]">
                <td className="py-2 pr-4 font-semibold text-[#2B2D2F]">Reale</td>
                <td className="py-2 pr-4 text-[#6a6d70]">—</td>
                <td className="py-2 pr-4 text-[#2B2D2F]">
                  {monthToDate.daysWithData > 0 ? formatCurrency(monthToDate.revenue) : ND}
                </td>
                <td className="py-2 pr-4 text-[#6a6d70]">—</td>
                <td className="py-2 text-[#2B2D2F]">
                  {monthToDate.daysWithData > 0
                    ? formatPercent(occupancy(monthToDate.roomsSold, monthToDate.roomsAvailable))
                    : ND}
                </td>
              </tr>

              {["minimo", "realistico", "sfidante"].map((level) => {
                const budget = budgets.find((b) => b.level === level);

                return (
                  <tr key={level} className="border-b border-[#f0ece6] last:border-0">
                    <td className="py-2 pr-4 text-[#2B2D2F]">{budgetLevelLabels[level]}</td>
                    <td className="py-2 pr-4 text-[#2B2D2F]">
                      {budget ? formatCurrency(Number(budget.revenue_target)) : ND}
                    </td>
                    <td className="py-2 pr-4 text-[#6a6d70]">—</td>
                    <td className="py-2 pr-4 text-[#2B2D2F]">
                      {budget ? formatPercent(Number(budget.occupancy_pct_target)) : ND}
                    </td>
                    <td className="py-2 text-[#6a6d70]">—</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </AppCard>
    </div>
  );
}

function KpiCard({
  label,
  current,
  sdly,
}: {
  label: string;
  current: string;
  sdly: string;
}) {
  return (
    <div className="rounded-[16px] border border-[#e7dfd8] bg-[#fcfbf9] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
        {label}
      </p>
      <p className="mt-2 text-[22px] font-semibold leading-none text-[#2B2D2F]">{current}</p>
      <p className="mt-2 text-[12px] text-[#6a6d70]">SDLY: {sdly}</p>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { use as usePromise } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { AppCard } from "@/components/ui/AppCard";
import { supabase } from "@/lib/supabaseClient";
import { canViewModule } from "@/lib/permissions";
import { Calendar } from "@/components/performance/Calendar";
import { PickupChart, PickupPoint } from "@/components/performance/PickupChart";
import {
  ND,
  SnapshotRow,
  BudgetRow,
  todayString,
  sdlyDate,
  monthRange,
  formatCurrency,
  formatNumber,
  formatPercent,
  occupancy,
  sumSnapshots,
} from "@/lib/performanceMetrics";

const budgetLevelLabels: Record<string, string> = {
  minimo: "Minimo",
  realistico: "Realistico",
  sfidante: "Sfidante",
};

export default function PerformanceStructureDrilldownPage({
  params,
}: {
  params: Promise<{ structureId: string }>;
}) {
  const { structureId } = usePromise(params);
  const router = useRouter();

  const [accessState, setAccessState] = useState<"checking" | "granted" | "denied">(
    "checking"
  );
  const [structureName, setStructureName] = useState("");
  const [selectedDate, setSelectedDate] = useState(todayString());
  const [highlightedDates, setHighlightedDates] = useState<Set<string>>(new Set());
  const [anomalyDates, setAnomalyDates] = useState<Set<string>>(new Set());

  const [daySnapshot, setDaySnapshot] = useState<SnapshotRow | null>(null);
  const [sdlySnapshot, setSdlySnapshot] = useState<SnapshotRow | null>(null);
  const [monthSnapshots, setMonthSnapshots] = useState<SnapshotRow[]>([]);
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [pickupPoints, setPickupPoints] = useState<PickupPoint[]>([]);

  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    void checkAccessAndLoadStructure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkAccessAndLoadStructure() {
    const canView = await canViewModule("performance");

    if (!canView) {
      setAccessState("denied");
      router.replace("/dashboard");
      return;
    }

    setAccessState("granted");

    const { data, error } = await supabase
      .from("structures")
      .select("name")
      .eq("id", structureId)
      .single();

    if (error || !data) {
      setLoadError(`Struttura non trovata: ${error?.message || ""}`);
      return;
    }

    setStructureName(data.name);

    const importsRes = await supabase
      .from("bd_imports")
      .select("extraction_date")
      .eq("structure_id", structureId);

    if (!importsRes.error) {
      setHighlightedDates(new Set((importsRes.data || []).map((r) => r.extraction_date as string)));
    }

    // Calcolo dinamico, non una lista fissa: rilegge sempre lo stato attuale
    // di v_snapshot_latest, quindi nuove estrazioni con lo stesso problema
    // vengono segnalate automaticamente senza bisogno di aggiornare codice.
    const anomalyRes = await supabase
      .from("v_snapshot_latest")
      .select("stay_date, rooms_sold, rooms_available")
      .eq("structure_id", structureId);

    if (!anomalyRes.error) {
      const anomalies = (anomalyRes.data || [])
        .filter((r) => Number(r.rooms_sold) > Number(r.rooms_available))
        .map((r) => r.stay_date as string);
      setAnomalyDates(new Set(anomalies));
    }
  }

  useEffect(() => {
    if (accessState === "granted") void loadMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessState, selectedDate]);

  async function loadMetrics() {
    setLoadingMetrics(true);
    setLoadError("");

    const sdly = sdlyDate(selectedDate);
    const { start, end, year, month } = monthRange(selectedDate);

    const [dayRes, sdlyRes, monthRes, budgetsRes, pickupRes] = await Promise.all([
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
      supabase
        .from("performance_daily_snapshot")
        .select("extraction_date, revenue_total")
        .eq("structure_id", structureId)
        .eq("stay_date", selectedDate)
        .order("extraction_date", { ascending: true }),
    ]);

    if (dayRes.error) setLoadError(dayRes.error.message);
    if (sdlyRes.error) setLoadError(sdlyRes.error.message);
    if (monthRes.error) setLoadError(monthRes.error.message);
    if (budgetsRes.error) setLoadError(budgetsRes.error.message);
    if (pickupRes.error) setLoadError(pickupRes.error.message);

    setDaySnapshot((dayRes.data as SnapshotRow) || null);
    setSdlySnapshot((sdlyRes.data as SnapshotRow) || null);
    setMonthSnapshots((monthRes.data as SnapshotRow[]) || []);
    setBudgets((budgetsRes.data as BudgetRow[]) || []);
    setPickupPoints(
      (pickupRes.data || []).map((r) => ({
        extractionDate: r.extraction_date as string,
        revenue: Number(r.revenue_total),
      }))
    );

    setLoadingMetrics(false);
  }

  const monthToDate = useMemo(() => sumSnapshots(monthSnapshots), [monthSnapshots]);
  const { daysInMonth } = monthRange(selectedDate);

  if (accessState !== "granted") {
    return null;
  }

  return (
    <div className="space-y-6">
      <Link href="/performance" className="text-sm font-medium text-[#017A92] hover:underline">
        ← Torna alla vista d'insieme
      </Link>

      <PageHeader
        eyebrow="Performance"
        title={structureName || "Struttura"}
        description="Confronto giornaliero vs stesso giorno anno precedente (SDLY), mese in corso vs budget, pickup revenue. 'ND' indica che non esiste ancora un dato importato — mai un valore pari a zero."
      />

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <AppCard title="Giorno di riferimento">
          <Calendar
            value={selectedDate}
            onChange={setSelectedDate}
            highlightedDates={highlightedDates}
            anomalyDates={anomalyDates}
          />
          {loadError && <p className="mt-3 text-sm text-[#8a3a3a]">{loadError}</p>}
        </AppCard>

        <div className="space-y-6">
          <AppCard
            title={`${selectedDate}`}
            subtitle={
              daySnapshot
                ? `Dato ${daySnapshot.status === "consuntivo" ? "consuntivo" : daySnapshot.status === "otb" ? "on-the-books" : "in corso"} · confronto con ${sdlyDate(selectedDate)} (SDLY)`
                : `Nessun dato importato per questo giorno · confronto con ${sdlyDate(selectedDate)} (SDLY)`
            }
          >
            {loadingMetrics ? (
              <p className="text-sm text-[#6a6d70]">Caricamento...</p>
            ) : (
              <>
                {daySnapshot && Number(daySnapshot.rooms_sold) > Number(daySnapshot.rooms_available) && (
                  <p className="mb-4 rounded-[12px] border border-[#e9c9c9] bg-[#fbf1f1] px-4 py-3 text-sm text-[#8a3a3a]">
                    Attenzione: Booking Designer riporta {Number(daySnapshot.rooms_sold)} camere vendute su{" "}
                    {Number(daySnapshot.rooms_available)} disponibili per questo giorno — inconsistenza nella fonte,
                    non un errore di calcolo nostro. Dato mostrato così com'è arrivato da BD.
                  </p>
                )}

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
              </>
            )}
          </AppCard>

          <AppCard
            title="Pickup revenue per questo giorno"
            subtitle="Come è cresciuto il revenue on-the-books nelle ultime estrazioni disponibili per questa stay_date"
          >
            <PickupChart points={pickupPoints} />
          </AppCard>
        </div>
      </div>

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

"use client";

import { useEffect, useMemo, useState } from "react";
import { use as usePromise } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { AppCard } from "@/components/ui/AppCard";
import { supabase } from "@/lib/supabaseClient";
import { canViewModule } from "@/lib/permissions";
import { Calendar, MONTH_LABELS } from "@/components/performance/Calendar";
import { PickupChart, PickupPoint } from "@/components/performance/PickupChart";
import { ChannelRevenueBars, ChannelRevenueDatum } from "@/components/performance/ChannelRevenueBars";
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
  los,
  sumSnapshots,
  computePacingStatus,
  pacingDotClasses,
  pacingDetail,
} from "@/lib/performanceMetrics";

const budgetLevelLabels: Record<string, string> = {
  minimo: "Minimo",
  realistico: "Realistico",
  sfidante: "Sfidante",
};

const DEFAULT_MONTH = monthRange(todayString());

function isFullMonth(start: string, end: string): boolean {
  const { start: monthStart, end: monthEnd } = monthRange(start);
  return start === monthStart && end === monthEnd;
}

function formatPeriodLabel(start: string, end: string): string {
  if (isFullMonth(start, end)) {
    const [y, m] = start.split("-").map(Number);
    return `${MONTH_LABELS[m - 1]} ${y}`;
  }
  if (start === end) return start;
  return `${start} → ${end}`;
}

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
  const [highlightedDates, setHighlightedDates] = useState<Set<string>>(new Set());
  const [anomalyDates, setAnomalyDates] = useState<Set<string>>(new Set());

  // Stato "grezzo" del calendario: durante la selezione di un intervallo
  // rangeEnd puo' essere null (primo click gia' fatto, in attesa del
  // secondo). Nessuna modalita'/toggle esplicita: il calendario e' sempre
  // in questo comportamento, un giorno singolo e' semplicemente un
  // intervallo con inizio e fine coincidenti (due click sulla stessa data).
  const [rangeStart, setRangeStart] = useState<string>(DEFAULT_MONTH.start);
  const [rangeEnd, setRangeEnd] = useState<string | null>(DEFAULT_MONTH.end);

  // Periodo "confermato": si aggiorna solo quando la selezione e'
  // completa (rangeEnd non nullo), cosi' il primo click di un nuovo
  // intervallo non fa sparire i dati del periodo precedente mentre si
  // attende il secondo click.
  const [confirmedStart, setConfirmedStart] = useState(DEFAULT_MONTH.start);
  const [confirmedEnd, setConfirmedEnd] = useState(DEFAULT_MONTH.end);

  useEffect(() => {
    if (rangeEnd) {
      setConfirmedStart(rangeStart);
      setConfirmedEnd(rangeEnd);
    }
  }, [rangeStart, rangeEnd]);

  const [periodSnapshots, setPeriodSnapshots] = useState<SnapshotRow[]>([]);
  const [sdlySnapshots, setSdlySnapshots] = useState<SnapshotRow[]>([]);
  const [monthSnapshots, setMonthSnapshots] = useState<SnapshotRow[]>([]);
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [pickupPoints, setPickupPoints] = useState<PickupPoint[]>([]);
  const [hasChannelData, setHasChannelData] = useState(false);
  const [channelRevenue, setChannelRevenue] = useState<ChannelRevenueDatum[]>([]);

  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [loadError, setLoadError] = useState("");

  const periodStart = confirmedStart;
  const periodEnd = confirmedEnd;
  // "Mese in corso vs budget" resta un concetto mensile: usa il mese del
  // primo giorno del periodo attivo come ancora (di default e' gia' il
  // mese corrente, dato che il periodo di default e' il mese intero).
  const budgetAnchorDate = periodStart;

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

    // Struttura mai popolata (es. Montecallini): la sezione va nascosta
    // del tutto, non solo mostrata con "ND" - controllo una volta sola,
    // non ad ogni cambio di periodo.
    const { count: channelCount, error: channelCountError } = await supabase
      .from("channel_revenue")
      .select("*", { count: "exact", head: true })
      .eq("structure_id", structureId);

    if (!channelCountError) {
      setHasChannelData((channelCount || 0) > 0);
    }
  }

  useEffect(() => {
    if (accessState === "granted") void loadMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessState, periodStart, periodEnd, hasChannelData]);

  async function loadMetrics() {
    setLoadingMetrics(true);
    setLoadError("");

    const sdlyStart = sdlyDate(periodStart);
    const sdlyEnd = sdlyDate(periodEnd);
    const { start: monthStart, end: monthEnd, year, month } = monthRange(budgetAnchorDate);

    const snapshotColumns =
      "stay_date, revenue_total, rooms_sold, rooms_available, arrivals, presences, status";

    const [periodRes, sdlyRes, monthRes, budgetsRes, pickupRes, channelRes] = await Promise.all([
      supabase
        .from("v_snapshot_latest")
        .select(snapshotColumns)
        .eq("structure_id", structureId)
        .gte("stay_date", periodStart)
        .lte("stay_date", periodEnd),
      supabase
        .from("v_snapshot_latest")
        .select(snapshotColumns)
        .eq("structure_id", structureId)
        .gte("stay_date", sdlyStart)
        .lte("stay_date", sdlyEnd),
      supabase
        .from("v_snapshot_latest")
        .select(snapshotColumns)
        .eq("structure_id", structureId)
        .gte("stay_date", monthStart)
        .lte("stay_date", monthEnd),
      supabase
        .from("v_budgets_current")
        .select("level, adr, revenue_target, room_nights_sold_target, room_nights_available, occupancy_pct_target")
        .eq("structure_id", structureId)
        .eq("season_year", year)
        .eq("month", month),
      supabase
        .from("performance_daily_snapshot")
        .select("extraction_date, revenue_total")
        .eq("structure_id", structureId)
        .gte("stay_date", periodStart)
        .lte("stay_date", periodEnd),
      hasChannelData
        ? supabase
            .from("channel_revenue")
            .select("channel, revenue_gross")
            .eq("structure_id", structureId)
            .gte("period_start", periodStart)
            .lte("period_start", periodEnd)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (periodRes.error) setLoadError(periodRes.error.message);
    if (sdlyRes.error) setLoadError(sdlyRes.error.message);
    if (monthRes.error) setLoadError(monthRes.error.message);
    if (budgetsRes.error) setLoadError(budgetsRes.error.message);
    if (pickupRes.error) setLoadError(pickupRes.error.message);
    if (channelRes.error) setLoadError(channelRes.error.message);

    setPeriodSnapshots((periodRes.data as SnapshotRow[]) || []);
    setSdlySnapshots((sdlyRes.data as SnapshotRow[]) || []);
    setMonthSnapshots((monthRes.data as SnapshotRow[]) || []);
    setBudgets((budgetsRes.data as BudgetRow[]) || []);

    // Un punto per extraction_date: per un giorno singolo coincide con le
    // righe stesse, per un intervallo/mese somma il revenue di tutti i
    // giorni che condividono la stessa estrazione (stessa logica,
    // generalizzata).
    const pickupMap = new Map<string, number>();
    (pickupRes.data || []).forEach((r) => {
      const key = r.extraction_date as string;
      pickupMap.set(key, (pickupMap.get(key) || 0) + Number(r.revenue_total));
    });
    setPickupPoints(
      Array.from(pickupMap, ([extractionDate, revenue]) => ({ extractionDate, revenue })).sort((a, b) =>
        a.extractionDate.localeCompare(b.extractionDate)
      )
    );

    const channelTotals = new Map<string, number>();
    (channelRes.data || []).forEach((r) => {
      const key = r.channel as string;
      channelTotals.set(key, (channelTotals.get(key) || 0) + Number(r.revenue_gross));
    });
    setChannelRevenue(Array.from(channelTotals, ([channel, revenue]) => ({ channel, revenue })));

    setLoadingMetrics(false);
  }

  const periodAgg = useMemo(() => sumSnapshots(periodSnapshots), [periodSnapshots]);
  const sdlyAgg = useMemo(() => sumSnapshots(sdlySnapshots), [sdlySnapshots]);
  const monthToDate = useMemo(() => sumSnapshots(monthSnapshots), [monthSnapshots]);

  const monthPacing = useMemo(
    () => computePacingStatus(monthToDate.revenue, budgets),
    [monthToDate.revenue, budgets]
  );
  const monthPacingDetail = useMemo(() => {
    const minimoBudget = budgets.find((b) => b.level === "minimo");
    return pacingDetail(monthToDate.revenue, minimoBudget ? Number(minimoBudget.revenue_target) : null);
  }, [monthToDate.revenue, budgets]);

  const { daysInMonth } = monthRange(budgetAnchorDate);

  const hasPeriodAnomaly =
    periodAgg.roomsSold !== null &&
    periodAgg.roomsAvailable !== null &&
    periodAgg.roomsSold > periodAgg.roomsAvailable;

  if (accessState !== "granted") {
    return null;
  }

  const isSingleDay = periodStart === periodEnd;
  const periodLabel = formatPeriodLabel(periodStart, periodEnd);
  const sdlyLabel = formatPeriodLabel(sdlyDate(periodStart), sdlyDate(periodEnd));

  return (
    <div className="space-y-6">
      <Link href="/performance" className="text-sm font-medium text-[#017A92] hover:underline">
        ← Torna alla vista d'insieme
      </Link>

      <PageHeader
        eyebrow="Performance"
        title={structureName || "Struttura"}
        description="Confronto vs stesso periodo anno precedente (SDLY), mese in corso vs budget, pickup revenue. 'ND' indica che non esiste ancora un dato importato — mai un valore pari a zero."
      />

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <AppCard
          title="Periodo di riferimento"
          subtitle="Clicca una data per l'inizio, un'altra per la fine. Clicca due volte la stessa data per un giorno singolo."
        >
          <Calendar
            value={rangeStart}
            onChange={() => {}}
            highlightedDates={highlightedDates}
            anomalyDates={anomalyDates}
            rangeMode
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            onRangeChange={(start, end) => {
              setRangeStart(start ?? DEFAULT_MONTH.start);
              setRangeEnd(end);
            }}
          />
          {loadError && <p className="mt-3 text-sm text-[#8a3a3a]">{loadError}</p>}
        </AppCard>

        <div className="space-y-6">
          <AppCard
            title={periodLabel}
            subtitle={
              isSingleDay
                ? periodAgg.daysWithData > 0
                  ? `Dato importato per questo giorno · confronto con ${sdlyLabel} (SDLY)`
                  : `Nessun dato importato per questo giorno · confronto con ${sdlyLabel} (SDLY)`
                : `Somma di ${periodAgg.daysWithData} giorni con dati nel periodo · confronto con ${sdlyLabel} (SDLY)`
            }
          >
            {loadingMetrics ? (
              <p className="text-sm text-[#6a6d70]">Caricamento...</p>
            ) : (
              <>
                {hasPeriodAnomaly && (
                  <p className="mb-4 rounded-[12px] border border-[#e9c9c9] bg-[#fbf1f1] px-4 py-3 text-sm text-[#8a3a3a]">
                    Attenzione: Booking Designer riporta {periodAgg.roomsSold} camere vendute su{" "}
                    {periodAgg.roomsAvailable} disponibili{isSingleDay ? " per questo giorno" : " nel periodo selezionato"}{" "}
                    — inconsistenza nella fonte, non un errore di calcolo nostro. Dato mostrato così com'è arrivato da BD.
                  </p>
                )}

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                  <KpiCard
                    label="Revenue"
                    current={formatCurrency(periodAgg.revenue)}
                    sdly={formatCurrency(sdlyAgg.revenue)}
                  />
                  <KpiCard
                    label="Occupazione"
                    current={formatPercent(occupancy(periodAgg.roomsSold, periodAgg.roomsAvailable))}
                    sdly={formatPercent(occupancy(sdlyAgg.roomsSold, sdlyAgg.roomsAvailable))}
                  />
                  <KpiCard label="Arrivi" current={formatNumber(periodAgg.arrivals)} sdly={formatNumber(sdlyAgg.arrivals)} />
                  <KpiCard
                    label="Presenze"
                    current={formatNumber(periodAgg.presences)}
                    sdly={formatNumber(sdlyAgg.presences)}
                  />
                  <KpiCard
                    label="LOS"
                    current={(() => {
                      const value = los(periodAgg.roomsSold, periodAgg.arrivals);
                      return value !== null ? value.toLocaleString("it-IT", { maximumFractionDigits: 1 }) : ND;
                    })()}
                    sdly={(() => {
                      const value = los(sdlyAgg.roomsSold, sdlyAgg.arrivals);
                      return value !== null ? value.toLocaleString("it-IT", { maximumFractionDigits: 1 }) : ND;
                    })()}
                  />
                </div>
              </>
            )}
          </AppCard>

          <AppCard
            title={isSingleDay ? "Pickup revenue per questo giorno" : "Pickup revenue per il periodo selezionato"}
            subtitle="Come è cresciuto il revenue on-the-books nelle ultime estrazioni disponibili"
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
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[#e7dfd8] text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                <th className="pb-3 pr-4">Scenario</th>
                <th className="pb-3 pr-4">Revenue</th>
                <th className="pb-3">Occupazione</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[#f0ece6]">
                <td className="py-2 pr-4 font-semibold text-[#2B2D2F]">Reale</td>
                <td className="py-2 pr-4 text-[#2B2D2F]">
                  {monthToDate.daysWithData > 0 ? (
                    <div className="flex items-start gap-2">
                      {monthPacing && (
                        <span
                          className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${pacingDotClasses[monthPacing]}`}
                        />
                      )}
                      <div>
                        <div>{formatCurrency(monthToDate.revenue)}</div>
                        {monthPacingDetail && (
                          <div className="text-[11px] text-[#6a6d70]">{monthPacingDetail}</div>
                        )}
                      </div>
                    </div>
                  ) : (
                    ND
                  )}
                </td>
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
                    <td className="py-2 text-[#2B2D2F]">
                      {budget ? formatPercent(Number(budget.occupancy_pct_target)) : ND}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </AppCard>

      {hasChannelData && (
        <AppCard
          title="Revenue per canale"
          subtitle={`Fatturato aggregato per canale sul periodo visualizzato (${periodLabel}) — la riga Totale deve coincidere con la somma delle barre`}
        >
          <ChannelRevenueBars data={channelRevenue} />
        </AppCard>
      )}
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

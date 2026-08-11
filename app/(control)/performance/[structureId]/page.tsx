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
import { ChannelRevenueBars, ChannelRevenueDatum } from "@/components/performance/ChannelRevenueBars";
import { NationalityBars, NationalityDatum } from "@/components/performance/NationalityBars";
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
  adr,
  revPar,
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

// CRM + Booking Engine (entrambe le varianti, stesso strumento) sono i
// canali "diretti": nessuna commissione a OTA terze.
const DIRECT_CHANNELS = new Set(["CRM", "Booking Engine", "Booking Engine - Advance"]);

function directShareOf(data: ChannelRevenueDatum[]) {
  if (data.length === 0) return { direct: null as number | null, total: null as number | null, share: null as number | null };
  const total = data.reduce((sum, r) => sum + r.revenue, 0);
  const direct = data.filter((r) => DIRECT_CHANNELS.has(r.channel)).reduce((sum, r) => sum + r.revenue, 0);
  return { direct, total, share: total !== 0 ? direct / total : null };
}

// "YYYY-MM-DD" -> "DD/MM/YYYY" senza passare da Date (eviterebbe scarti di
// fuso orario sulla mezzanotte UTC).
function formatDateIt(dateStr: string): string {
  return dateStr.split("-").reverse().join("/");
}

type DailyDetailRow = {
  stayDate: string;
  revenue: number;
  adr: number | null;
  revPar: number | null;
  occupancy: number | null;
  pickup: number | null;
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
  const [lastAdrRevparUpdate, setLastAdrRevparUpdate] = useState<string | null>(null);

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
  const [hasChannelData, setHasChannelData] = useState(false);
  const [channelRevenue, setChannelRevenue] = useState<ChannelRevenueDatum[]>([]);
  const [channelRevenueSdly, setChannelRevenueSdly] = useState<ChannelRevenueDatum[]>([]);
  const [hasNationalityData, setHasNationalityData] = useState(false);
  const [nationalityData, setNationalityData] = useState<NationalityDatum[]>([]);

  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [loadError, setLoadError] = useState("");

  // Dettaglio giornaliero: nascosto di default, caricato solo quando aperto
  // (query aggiuntiva non necessaria finche' nessuno lo chiede).
  const [dailyDetailOpen, setDailyDetailOpen] = useState(false);
  const [dailyDetailRows, setDailyDetailRows] = useState<DailyDetailRow[] | null>(null);
  const [dailyDetailLoading, setDailyDetailLoading] = useState(false);

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

    // Data dell'ultima estrazione che alimenta Revenue OTB/ADR/RevPAR/
    // Occupazione (performance_daily_snapshot + performance_monthly_snapshot),
    // non le fonti di Canali/Nazionalità che sono tabelle separate.
    const [dailyLatestRes, monthlyLatestRes] = await Promise.all([
      supabase
        .from("performance_daily_snapshot")
        .select("extraction_date")
        .eq("structure_id", structureId)
        .order("extraction_date", { ascending: false })
        .limit(1),
      supabase
        .from("performance_monthly_snapshot")
        .select("extraction_date")
        .eq("structure_id", structureId)
        .order("extraction_date", { ascending: false })
        .limit(1),
    ]);

    const dailyLatest = dailyLatestRes.data?.[0]?.extraction_date as string | undefined;
    const monthlyLatest = monthlyLatestRes.data?.[0]?.extraction_date as string | undefined;
    const candidates = [dailyLatest, monthlyLatest].filter((d): d is string => Boolean(d));
    setLastAdrRevparUpdate(candidates.length > 0 ? candidates.sort().at(-1)! : null);

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

    const { count: nationalityCount, error: nationalityCountError } = await supabase
      .from("guest_nationality")
      .select("*", { count: "exact", head: true })
      .eq("structure_id", structureId);

    if (!nationalityCountError) {
      setHasNationalityData((nationalityCount || 0) > 0);
    }
  }

  useEffect(() => {
    if (accessState === "granted") void loadMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessState, periodStart, periodEnd, hasChannelData, hasNationalityData]);

  async function loadMetrics() {
    setLoadingMetrics(true);
    setLoadError("");

    const sdlyStart = sdlyDate(periodStart);
    const sdlyEnd = sdlyDate(periodEnd);
    const { start: monthStart, end: monthEnd, year, month } = monthRange(budgetAnchorDate);

    const snapshotColumns =
      "stay_date, revenue_total, rooms_sold, rooms_available, arrivals, presences, status";

    const [periodRes, sdlyRes, monthRes, budgetsRes, channelRes, channelSdlyRes, nationalityRes] = await Promise.all([
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
      hasChannelData
        ? supabase
            .from("channel_revenue")
            .select("channel, revenue_gross")
            .eq("structure_id", structureId)
            .gte("period_start", periodStart)
            .lte("period_start", periodEnd)
        : Promise.resolve({ data: [], error: null }),
      // Direct Booking Share vs anno precedente: stesso periodo SDLY gia'
      // usato per gli altri confronti storici della pagina.
      hasChannelData
        ? supabase
            .from("channel_revenue")
            .select("channel, revenue_gross")
            .eq("structure_id", structureId)
            .gte("period_start", sdlyStart)
            .lte("period_start", sdlyEnd)
        : Promise.resolve({ data: [], error: null }),
      hasNationalityData
        ? supabase
            .from("guest_nationality")
            .select("nationality, presences")
            .eq("structure_id", structureId)
            .gte("stay_date", periodStart)
            .lte("stay_date", periodEnd)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (periodRes.error) setLoadError(periodRes.error.message);
    if (sdlyRes.error) setLoadError(sdlyRes.error.message);
    if (monthRes.error) setLoadError(monthRes.error.message);
    if (budgetsRes.error) setLoadError(budgetsRes.error.message);
    if (channelRes.error) setLoadError(channelRes.error.message);
    if (channelSdlyRes.error) setLoadError(channelSdlyRes.error.message);
    if (nationalityRes.error) setLoadError(nationalityRes.error.message);

    setPeriodSnapshots((periodRes.data as SnapshotRow[]) || []);
    setSdlySnapshots((sdlyRes.data as SnapshotRow[]) || []);
    setMonthSnapshots((monthRes.data as SnapshotRow[]) || []);
    setBudgets((budgetsRes.data as BudgetRow[]) || []);

    const channelTotals = new Map<string, number>();
    (channelRes.data || []).forEach((r) => {
      const key = r.channel as string;
      channelTotals.set(key, (channelTotals.get(key) || 0) + Number(r.revenue_gross));
    });
    setChannelRevenue(Array.from(channelTotals, ([channel, revenue]) => ({ channel, revenue })));

    const channelSdlyTotals = new Map<string, number>();
    (channelSdlyRes.data || []).forEach((r) => {
      const key = r.channel as string;
      channelSdlyTotals.set(key, (channelSdlyTotals.get(key) || 0) + Number(r.revenue_gross));
    });
    setChannelRevenueSdly(Array.from(channelSdlyTotals, ([channel, revenue]) => ({ channel, revenue })));

    const nationalityTotals = new Map<string, number>();
    (nationalityRes.data || []).forEach((r) => {
      const key = r.nationality as string;
      nationalityTotals.set(key, (nationalityTotals.get(key) || 0) + Number(r.presences));
    });
    setNationalityData(Array.from(nationalityTotals, ([nationality, presences]) => ({ nationality, presences })));

    setLoadingMetrics(false);
  }

  useEffect(() => {
    if (dailyDetailOpen) void loadDailyDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyDetailOpen, periodStart, periodEnd]);

  async function loadDailyDetail() {
    setDailyDetailLoading(true);

    const { data, error } = await supabase
      .from("performance_daily_snapshot")
      .select("stay_date, extraction_date, revenue_total, rooms_sold, rooms_available")
      .eq("structure_id", structureId)
      .gte("stay_date", periodStart)
      .lte("stay_date", periodEnd)
      .order("stay_date", { ascending: true })
      .order("extraction_date", { ascending: false });

    if (error) {
      setLoadError(error.message);
      setDailyDetailLoading(false);
      return;
    }

    // Per ogni stay_date, le righe arrivano gia' ordinate per extraction_date
    // decrescente: la prima e' l'ultima estrazione disponibile, la seconda
    // (se c'e') e' l'upload precedente - il pickup e' la differenza tra le due.
    const byDay = new Map<string, { revenue_total: number; rooms_sold: number; rooms_available: number }[]>();
    (data || []).forEach((r) => {
      const key = r.stay_date as string;
      const list = byDay.get(key) || [];
      list.push({
        revenue_total: Number(r.revenue_total),
        rooms_sold: Number(r.rooms_sold),
        rooms_available: Number(r.rooms_available),
      });
      byDay.set(key, list);
    });

    const rows: DailyDetailRow[] = Array.from(byDay.entries())
      .map(([stayDate, extractions]) => {
        const latest = extractions[0];
        const previous = extractions[1];

        return {
          stayDate,
          revenue: latest.revenue_total,
          adr: adr(latest.revenue_total, latest.rooms_sold),
          revPar: revPar(latest.revenue_total, latest.rooms_available),
          occupancy: occupancy(latest.rooms_sold, latest.rooms_available),
          pickup: previous ? latest.revenue_total - previous.revenue_total : null,
        };
      })
      .sort((a, b) => a.stayDate.localeCompare(b.stayDate));

    setDailyDetailRows(rows);
    setDailyDetailLoading(false);
  }

  const periodAgg = useMemo(() => sumSnapshots(periodSnapshots), [periodSnapshots]);
  const sdlyAgg = useMemo(() => sumSnapshots(sdlySnapshots), [sdlySnapshots]);
  const monthToDate = useMemo(() => sumSnapshots(monthSnapshots), [monthSnapshots]);

  const directShareCurrent = useMemo(() => directShareOf(channelRevenue), [channelRevenue]);
  const directShareSdly = useMemo(() => directShareOf(channelRevenueSdly), [channelRevenueSdly]);

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
        description="Confronto vs stesso periodo anno precedente (SDLY), mese in corso vs budget. 'ND' indica che non esiste ancora un dato importato — mai un valore pari a zero."
      >
        <p className="text-sm text-[#6a6d70]">
          Ultimo aggiornamento dati (ADR/RevPAR):{" "}
          <span className="font-medium text-[#2B2D2F]">
            {lastAdrRevparUpdate ? formatDateIt(lastAdrRevparUpdate) : ND}
          </span>
        </p>
      </PageHeader>

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
        </div>
      </div>

      <AppCard
        title="Dettaglio giornaliero"
        subtitle={`Una riga per ogni giorno di ${periodLabel} con dato disponibile`}
      >
        <button
          type="button"
          onClick={() => setDailyDetailOpen((prev) => !prev)}
          className="flex h-11 items-center gap-2 rounded-[14px] border border-[#e7dfd8] bg-white px-4 text-sm font-medium text-[#017A92] hover:bg-[#f3f8fa]"
        >
          {dailyDetailOpen ? "Nascondi dettaglio giornaliero ▲" : "Mostra dettaglio giornaliero ▾"}
        </button>

        {dailyDetailOpen && (
          <div className="mt-4 overflow-x-auto">
            {dailyDetailLoading ? (
              <p className="text-sm text-[#6a6d70]">Caricamento...</p>
            ) : dailyDetailRows && dailyDetailRows.length > 0 ? (
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[#e7dfd8] text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                    <th className="pb-3 pr-4">Data</th>
                    <th className="pb-3 pr-4">Revenue</th>
                    <th className="pb-3 pr-4">ADR</th>
                    <th className="pb-3 pr-4">RevPAR</th>
                    <th className="pb-3 pr-4">Occupazione</th>
                    <th className="pb-3">Pickup (vs ultimo upload)</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyDetailRows.map((row) => (
                    <tr key={row.stayDate} className="border-b border-[#f0ece6] last:border-0">
                      <td className="py-2 pr-4 text-[#2B2D2F]">{formatDateIt(row.stayDate)}</td>
                      <td className="py-2 pr-4 text-[#2B2D2F]">{formatCurrency(row.revenue)}</td>
                      <td className="py-2 pr-4 text-[#2B2D2F]">{formatCurrency(row.adr)}</td>
                      <td className="py-2 pr-4 text-[#2B2D2F]">{formatCurrency(row.revPar)}</td>
                      <td className="py-2 pr-4 text-[#2B2D2F]">{formatPercent(row.occupancy)}</td>
                      <td className="py-2 text-[#2B2D2F]">
                        {row.pickup === null ? (
                          ND
                        ) : (
                          <span
                            className={
                              row.pickup > 0
                                ? "text-[#2f7d43]"
                                : row.pickup < 0
                                ? "text-[#8a3a3a]"
                                : undefined
                            }
                          >
                            {row.pickup >= 0 ? "+" : ""}
                            {formatCurrency(row.pickup)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-[#6a6d70]">{ND} — nessun dato per questo periodo.</p>
            )}
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
        <>
          <AppCard
            title="Revenue per canale"
            subtitle={`Fatturato aggregato per canale sul periodo visualizzato (${periodLabel}) — la riga Totale deve coincidere con la somma delle barre`}
          >
            <ChannelRevenueBars data={channelRevenue} />
          </AppCard>

          <AppCard
            title="Direct Booking Share"
            subtitle={`Quota dei canali diretti (CRM + Booking Engine) sul totale, ${periodLabel}`}
          >
            <div className="flex flex-wrap items-end gap-10">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                  Quota diretta
                </p>
                <p className="mt-2 text-[28px] font-semibold leading-none text-[#2B2D2F]">
                  {directShareCurrent.share !== null ? formatPercent(directShareCurrent.share) : ND}
                </p>
                {directShareCurrent.direct !== null && directShareCurrent.total !== null && (
                  <p className="mt-2 text-[12px] text-[#6a6d70]">
                    {formatCurrency(directShareCurrent.direct)} su {formatCurrency(directShareCurrent.total)} totali
                  </p>
                )}
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                  vs {sdlyLabel} (SDLY)
                </p>
                <p className="mt-2 text-[22px] font-semibold leading-none text-[#2B2D2F]">
                  {directShareSdly.share !== null ? formatPercent(directShareSdly.share) : ND}
                </p>
                {directShareCurrent.share !== null && directShareSdly.share !== null && (
                  <p
                    className={`mt-2 text-[12px] ${
                      directShareCurrent.share >= directShareSdly.share ? "text-[#2f7d43]" : "text-[#8a3a3a]"
                    }`}
                  >
                    {directShareCurrent.share >= directShareSdly.share ? "+" : ""}
                    {((directShareCurrent.share - directShareSdly.share) * 100).toLocaleString("it-IT", {
                      maximumFractionDigits: 1,
                    })}{" "}
                    p.p.
                  </p>
                )}
              </div>
            </div>
          </AppCard>
        </>
      )}

      {hasNationalityData && (
        <AppCard
          title="Presenze per nazionalità"
          subtitle={`Top 10 nazionalità per presenze sul periodo visualizzato (${periodLabel}), le restanti aggregate in "Altri" — la riga Totale deve coincidere con la somma delle barre`}
        >
          <NationalityBars data={nationalityData} />
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

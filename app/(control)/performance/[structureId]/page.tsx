"use client";

import { useEffect, useMemo, useState } from "react";
import { use as usePromise } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { AppCard } from "@/components/ui/AppCard";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { CellTooltip } from "@/components/ui/CellTooltip";
import { supabase } from "@/lib/supabaseClient";
import { canViewModule, getUserLevelRank } from "@/lib/permissions";
import { Calendar, MONTH_LABELS } from "@/components/performance/Calendar";
import { ChannelRevenueBars, ChannelRevenueDatum, ChannelCommissionInfo } from "@/components/performance/ChannelRevenueBars";
import { NationalityBars, NationalityDatum } from "@/components/performance/NationalityBars";
import {
  ND,
  SnapshotRow,
  BudgetRow,
  todayString,
  sdlyDate,
  monthRange,
  pad,
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
  formatDelta,
} from "@/lib/performanceMetrics";

const budgetLevelLabels: Record<string, string> = {
  minimo: "Minimo",
  realistico: "Realistico",
  sfidante: "Sfidante",
};

// CRM + Booking Engine (entrambe le varianti, stesso strumento) sono i
// canali "diretti": nessuna commissione a OTA terze.
const DIRECT_CHANNELS = new Set(["CRM", "Booking Engine", "Booking Engine - Advance"]);

// channel_commission_rates ha RLS SELECT a rank >= 2 (dato economico
// sensibile, stessa soglia di channel_revenue) - il toggle "Mostra netto"
// va nascosto del tutto per level=user, non solo disabilitato, altrimenti
// risulterebbe un controllo che non fa mai nulla per quell'utente.
const SENIOR_RANK = 2;

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
  roomsSold: number;
  roomsAvailable: number;
  pickupRooms: number | null;
  pickupRevenue: number | null;
  previousExtractionDate: string | null;
};

// Righe grezze da performance_daily_snapshot -> DailyDetailRow, con calcolo
// pickup (ultima estrazione vs precedente). Condivisa tra loadDailyDetail
// (scoped al periodo del calendario) e loadYearlyDetail (scoped all'anno,
// per la vista Mensile "tutto l'anno") - stessa logica, fonti diverse.
function toDailyDetailRows(
  data: {
    stay_date: string;
    extraction_date: string;
    revenue_total: number | string;
    rooms_sold: number | string;
    rooms_available: number | string;
  }[]
): DailyDetailRow[] {
  const byDay = new Map<
    string,
    { extraction_date: string; revenue_total: number; rooms_sold: number; rooms_available: number }[]
  >();

  data.forEach((r) => {
    const key = r.stay_date;
    const list = byDay.get(key) || [];
    list.push({
      extraction_date: r.extraction_date,
      revenue_total: Number(r.revenue_total),
      rooms_sold: Number(r.rooms_sold),
      rooms_available: Number(r.rooms_available),
    });
    byDay.set(key, list);
  });

  return Array.from(byDay.entries())
    .map(([stayDate, extractions]) => {
      const latest = extractions[0];
      const previous = extractions[1];

      return {
        stayDate,
        revenue: latest.revenue_total,
        adr: adr(latest.revenue_total, latest.rooms_sold),
        revPar: revPar(latest.revenue_total, latest.rooms_available),
        occupancy: occupancy(latest.rooms_sold, latest.rooms_available),
        roomsSold: latest.rooms_sold,
        roomsAvailable: latest.rooms_available,
        pickupRooms: previous ? latest.rooms_sold - previous.rooms_sold : null,
        pickupRevenue: previous ? latest.revenue_total - previous.revenue_total : null,
        previousExtractionDate: previous ? previous.extraction_date : null,
      };
    })
    .sort((a, b) => a.stayDate.localeCompare(b.stayDate));
}

type DetailGranularity = "day" | "week" | "month";

// Riga visualizzata nella tabella "Dettaglio giornaliero", indipendente
// dalla granularita' scelta - a livello giorno e' un mapping 1:1 da
// DailyDetailRow, a livello settimana/mese e' un aggregato ricalcolato
// (mai una media di medie: ADR/RevPAR/Occupazione sempre ricalcolati da
// revenue/camere sommati, stessa regola gia' in uso per periodAgg/sdlyAgg).
type DetailRow = {
  key: string;
  label: string;
  revenue: number;
  adr: number | null;
  revPar: number | null;
  occupancy: number | null;
  roomsSold: number;
  roomsAvailable: number;
  pickupRooms: number | null;
  pickupRevenue: number | null;
  pickupTooltip: string;
  // false solo per i mesi senza alcun dato nella vista Mensile "tutto
  // l'anno" (vedi buildFullYearMonthRows) - riga mostrata comunque, con ND
  // nelle celle, mai omessa: l'utente deve vedere tutti i 12 mesi.
  hasData: boolean;
};

// Lunedi' della settimana ISO contenente dateStr, in "YYYY-MM-DD".
function weekStartDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay(); // 0=domenica..6=sabato
  const diffToMonday = dow === 0 ? 6 : dow - 1;
  date.setUTCDate(date.getUTCDate() - diffToMonday);
  return date.toISOString().slice(0, 10);
}

function buildDetailRows(rows: DailyDetailRow[], granularity: DetailGranularity): DetailRow[] {
  if (granularity === "day") {
    return rows.map((r) => ({
      key: r.stayDate,
      label: formatDateIt(r.stayDate),
      revenue: r.revenue,
      adr: r.adr,
      revPar: r.revPar,
      occupancy: r.occupancy,
      roomsSold: r.roomsSold,
      roomsAvailable: r.roomsAvailable,
      pickupRooms: r.pickupRooms,
      pickupRevenue: r.pickupRevenue,
      pickupTooltip: `vs ultimo aggiornamento: ${r.previousExtractionDate ? formatDateIt(r.previousExtractionDate) : ND}`,
      hasData: true,
    }));
  }

  const bucketKey = (stayDate: string) => (granularity === "week" ? weekStartDate(stayDate) : stayDate.slice(0, 7));

  const buckets = new Map<string, DailyDetailRow[]>();
  rows.forEach((r) => {
    const key = bucketKey(r.stayDate);
    const list = buckets.get(key) || [];
    list.push(r);
    buckets.set(key, list);
  });

  const pickupTooltipSuffix = granularity === "week" ? "della settimana" : "del mese";

  return Array.from(buckets.entries())
    .map(([key, bucketRows]) => {
      const sorted = [...bucketRows].sort((a, b) => a.stayDate.localeCompare(b.stayDate));
      const revenue = sorted.reduce((sum, r) => sum + r.revenue, 0);
      const roomsSold = sorted.reduce((sum, r) => sum + r.roomsSold, 0);
      const roomsAvailable = sorted.reduce((sum, r) => sum + r.roomsAvailable, 0);

      const pickupRoomsRows = sorted.filter((r) => r.pickupRooms !== null);
      const pickupRevenueRows = sorted.filter((r) => r.pickupRevenue !== null);

      const label =
        granularity === "week"
          ? sorted.length > 1
            ? `${formatDateIt(sorted[0].stayDate)} – ${formatDateIt(sorted[sorted.length - 1].stayDate)}`
            : formatDateIt(sorted[0].stayDate)
          : `${MONTH_LABELS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

      return {
        key,
        label,
        revenue,
        adr: adr(revenue, roomsSold),
        revPar: revPar(revenue, roomsAvailable),
        occupancy: occupancy(roomsSold, roomsAvailable),
        roomsSold,
        roomsAvailable,
        pickupRooms: pickupRoomsRows.length > 0 ? pickupRoomsRows.reduce((sum, r) => sum + (r.pickupRooms || 0), 0) : null,
        pickupRevenue:
          pickupRevenueRows.length > 0 ? pickupRevenueRows.reduce((sum, r) => sum + (r.pickupRevenue || 0), 0) : null,
        pickupTooltip: `Somma dei pickup giornalieri ${pickupTooltipSuffix}`,
        hasData: true,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

// Vista Mensile "tutto l'anno": sempre 12 righe (Gennaio-Dicembre), mai solo
// i mesi del periodo selezionato nel calendario - i mesi senza alcun dato
// restano in elenco con hasData:false (ND in tabella), non vengono omessi.
function buildFullYearMonthRows(rows: DailyDetailRow[], year: number): DetailRow[] {
  const buckets = new Map<string, DailyDetailRow[]>();
  rows.forEach((r) => {
    const key = r.stayDate.slice(0, 7);
    const list = buckets.get(key) || [];
    list.push(r);
    buckets.set(key, list);
  });

  return Array.from({ length: 12 }, (_, i) => i + 1).map((monthNum) => {
    const key = `${year}-${pad(monthNum)}`;
    const bucketRows = buckets.get(key);
    const label = `${MONTH_LABELS[monthNum - 1]} ${year}`;

    if (!bucketRows || bucketRows.length === 0) {
      return {
        key,
        label,
        revenue: 0,
        adr: null,
        revPar: null,
        occupancy: null,
        roomsSold: 0,
        roomsAvailable: 0,
        pickupRooms: null,
        pickupRevenue: null,
        pickupTooltip: "Nessun dato per questo mese",
        hasData: false,
      };
    }

    const sorted = [...bucketRows].sort((a, b) => a.stayDate.localeCompare(b.stayDate));
    const revenue = sorted.reduce((sum, r) => sum + r.revenue, 0);
    const roomsSold = sorted.reduce((sum, r) => sum + r.roomsSold, 0);
    const roomsAvailable = sorted.reduce((sum, r) => sum + r.roomsAvailable, 0);
    const pickupRoomsRows = sorted.filter((r) => r.pickupRooms !== null);
    const pickupRevenueRows = sorted.filter((r) => r.pickupRevenue !== null);

    return {
      key,
      label,
      revenue,
      adr: adr(revenue, roomsSold),
      revPar: revPar(revenue, roomsAvailable),
      occupancy: occupancy(roomsSold, roomsAvailable),
      roomsSold,
      roomsAvailable,
      pickupRooms: pickupRoomsRows.length > 0 ? pickupRoomsRows.reduce((sum, r) => sum + (r.pickupRooms || 0), 0) : null,
      pickupRevenue:
        pickupRevenueRows.length > 0 ? pickupRevenueRows.reduce((sum, r) => sum + (r.pickupRevenue || 0), 0) : null,
      pickupTooltip: "Somma dei pickup giornalieri del mese",
      hasData: true,
    };
  });
}

const DETAIL_GRANULARITY_OPTIONS: { value: DetailGranularity; label: string }[] = [
  { value: "day", label: "Giornaliero" },
  { value: "week", label: "Settimanale" },
  { value: "month", label: "Mensile" },
];

type ComparisonTab = "sdly" | "consuntivo";

type KpiAgg = {
  revenue: number | null;
  roomsSold: number | null;
  roomsAvailable: number | null;
  arrivals: number | null;
  presences: number | null;
};

const EMPTY_KPI_AGG: KpiAgg = {
  revenue: null,
  roomsSold: null,
  roomsAvailable: null,
  arrivals: null,
  presences: null,
};

const COMPARISON_TAB_OPTIONS: { value: ComparisonTab; label: string }[] = [
  { value: "sdly", label: "vs SDLY" },
  { value: "consuntivo", label: "vs Consuntivo anno prec." },
];

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
  const [canManage, setCanManage] = useState(false);
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
  // "Consuntivo anno prec.": v_snapshot_latest sullo stesso periodo di un
  // anno fa, senza cutoff - per un periodo passato e' sempre il risultato
  // finale chiuso, non un OTB storico (correttamente cosi', e' quello che
  // rappresenta).
  const [sdlySnapshots, setSdlySnapshots] = useState<SnapshotRow[]>([]);
  // "SDLY" vero: stesso periodo di un anno fa, ma con l'estrazione
  // disponibile al cutoff = oggi meno un anno (fn_month_snapshot_asof per
  // un mese pieno, fn_snapshot_asof per un periodo custom) - a parita' di
  // anticipo rispetto ad oggi, non il consuntivo finale. Vedi loadMetrics.
  const [sdlyAsofAgg, setSdlyAsofAgg] = useState<KpiAgg>(EMPTY_KPI_AGG);
  const [comparisonTab, setComparisonTab] = useState<ComparisonTab>("sdly");
  const [monthSnapshots, setMonthSnapshots] = useState<SnapshotRow[]>([]);
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [hasChannelData, setHasChannelData] = useState(false);
  const [channelRevenue, setChannelRevenue] = useState<ChannelRevenueDatum[]>([]);
  const [channelRevenueSdly, setChannelRevenueSdly] = useState<ChannelRevenueDatum[]>([]);
  // Percentuale commissione per canale, per il mese ancora del periodo
  // selezionato (stesso mese usato da "Mese in corso vs budget") - solo i
  // canali con una riga in channel_commission_rates per quel mese finiscono
  // in questa mappa, gli altri restano senza netto calcolato.
  const [channelCommissionRates, setChannelCommissionRates] = useState<Map<string, ChannelCommissionInfo>>(new Map());
  const [showNetChannelRevenue, setShowNetChannelRevenue] = useState(false);
  const [hasNationalityData, setHasNationalityData] = useState(false);
  const [nationalityData, setNationalityData] = useState<NationalityDatum[]>([]);
  const [nationalityDataSdly, setNationalityDataSdly] = useState<NationalityDatum[]>([]);
  // false = nessun dato Nazionalita' importato per questa struttura per
  // l'intero anno del confronto SDLY (es. Sangiorgio Resort, Dimora De
  // Belli, Montecallini) - va distinto da "0 presenze in questo periodo",
  // che e' un dato reale, non un'assenza di copertura.
  const [nationalitySdlyAvailable, setNationalitySdlyAvailable] = useState(false);
  const [showNationalityComparison, setShowNationalityComparison] = useState(false);

  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [loadError, setLoadError] = useState("");

  // Dettaglio giornaliero: nascosto di default, caricato solo quando aperto
  // (query aggiuntiva non necessaria finche' nessuno lo chiede).
  const [dailyDetailOpen, setDailyDetailOpen] = useState(false);
  const [dailyDetailRows, setDailyDetailRows] = useState<DailyDetailRow[] | null>(null);
  const [dailyDetailLoading, setDailyDetailLoading] = useState(false);
  const [detailGranularity, setDetailGranularity] = useState<DetailGranularity>("day");
  // Vista Mensile: sempre tutti i 12 mesi dell'anno del periodo selezionato
  // nel calendario, non solo il periodo attivo - fonte dati separata da
  // dailyDetailRows (che resta scoped al periodo del calendario per
  // Giornaliero/Settimanale).
  const [yearlyDetailRows, setYearlyDetailRows] = useState<DailyDetailRow[] | null>(null);
  const [yearlyDetailLoading, setYearlyDetailLoading] = useState(false);

  const periodStart = confirmedStart;
  const periodEnd = confirmedEnd;
  // "Mese in corso vs budget" resta un concetto mensile: usa il mese del
  // primo giorno del periodo attivo come ancora (di default e' gia' il
  // mese corrente, dato che il periodo di default e' il mese intero).
  const budgetAnchorDate = periodStart;
  // Anno della vista Mensile "tutto l'anno": segue l'anno del periodo
  // selezionato nel calendario, non e' un selettore separato.
  const detailYear = Number(periodStart.slice(0, 4));

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

    const rank = await getUserLevelRank();
    setCanManage(rank !== null && rank >= SENIOR_RANK);

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
    // non le fonti di Canali/Nazionalità che sono tabelle separate. Stessa
    // funzione usata dalla Dashboard per la colonna "Ultimo upload".
    const latestExtractionRes = await supabase.rpc("fn_latest_extraction_per_structure", {
      p_structure_ids: [structureId],
    });

    if (!latestExtractionRes.error) {
      setLastAdrRevparUpdate(latestExtractionRes.data?.[0]?.extraction_date ?? null);
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
  }, [accessState, periodStart, periodEnd, hasChannelData, hasNationalityData, canManage]);

  async function loadMetrics() {
    setLoadingMetrics(true);
    setLoadError("");

    const sdlyStart = sdlyDate(periodStart);
    const sdlyEnd = sdlyDate(periodEnd);
    const { start: monthStart, end: monthEnd, year, month } = monthRange(budgetAnchorDate);

    const snapshotColumns =
      "stay_date, revenue_total, rooms_sold, rooms_available, arrivals, presences, status";

    // Tab "SDLY": OTB del periodo di un anno fa cosi' come si presentava
    // allo stesso cutoff di oggi (oggi meno un anno), non il consuntivo
    // finale - stessa convenzione gia' validata sulla Dashboard
    // (fn_month_snapshot_asof, sdlyCutoff = sdlyDate(todayString())). Per
    // un mese pieno usa la funzione mensile (unica fonte per lo storico
    // 2025, caricato a granularita' mensile); per un periodo custom usa la
    // funzione giornaliera - che per periodi 2025 non ancora coperti da
    // performance_daily_snapshot torna ND, onestamente, invece di un dato
    // approssimato.
    const sdlyCutoff = sdlyDate(todayString());
    const sdlyIsFullMonth = isFullMonth(periodStart, periodEnd);
    const sdlyAsofPromise = sdlyIsFullMonth
      ? supabase.rpc("fn_month_snapshot_asof", {
          p_structure_ids: [structureId],
          p_period_year: Number(sdlyStart.slice(0, 4)),
          p_period_month: Number(sdlyStart.slice(5, 7)),
          p_cutoff_date: sdlyCutoff,
        })
      : supabase.rpc("fn_snapshot_asof", {
          p_structure_ids: [structureId],
          p_stay_date_start: sdlyStart,
          p_stay_date_end: sdlyEnd,
          p_cutoff_date: sdlyCutoff,
        });

    const [
      periodRes,
      sdlyRes,
      sdlyAsofRes,
      monthRes,
      budgetsRes,
      channelRes,
      channelSdlyRes,
      commissionRatesRes,
      nationalityRes,
      nationalitySdlyRes,
      nationalitySdlyYearCountRes,
    ] = await Promise.all([
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
      sdlyAsofPromise,
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
      // Direct Booking Share vs anno precedente: SEMPRE consuntivo, mai vero
      // SDLY - verificato empiricamente che channel_revenue non ha uno
      // storico di estrazioni (un solo bd_import_id/extraction_date per
      // ogni combinazione period_start/channel, a differenza di
      // performance_daily_snapshot che ha una riga per ogni estrazione).
      // Senza uno storico non esiste un "OTB a parita' di anticipo" da
      // ricostruire: l'unico dato disponibile per l'anno scorso e' gia' il
      // risultato finale, quindi qui non c'e' un tab SDLY - l'etichetta
      // dice esplicitamente "Consuntivo anno prec." invece di "SDLY".
      hasChannelData
        ? supabase
            .from("channel_revenue")
            .select("channel, revenue_gross")
            .eq("structure_id", structureId)
            .gte("period_start", sdlyStart)
            .lte("period_start", sdlyEnd)
        : Promise.resolve({ data: [], error: null }),
      // Percentuali commissione per il toggle "Mostra netto" su Revenue per
      // canale - ancorate allo stesso mese di budgetAnchorDate/monthRange
      // gia' usato per "Mese in corso vs budget" (year/month qui sopra).
      // RLS su channel_commission_rates e' gia' rank >= 2: gated anche qui
      // lato query per non fare una fetch inutile a chi non la vedrebbe
      // comunque (torna 0 righe, non un errore).
      hasChannelData && canManage
        ? supabase
            .from("channel_commission_rates")
            .select("channel, commission_pct, source, source_reference")
            .eq("structure_id", structureId)
            .eq("period_year", year)
            .eq("period_month", month)
        : Promise.resolve({ data: [], error: null }),
      hasNationalityData
        ? supabase
            .from("guest_nationality")
            .select("nationality, presences")
            .eq("structure_id", structureId)
            .gte("stay_date", periodStart)
            .lte("stay_date", periodEnd)
        : Promise.resolve({ data: [], error: null }),
      // Confronto Nazionalità 2026 vs 2025: stesso periodo SDLY gia'
      // calcolato per le altre sezioni della pagina.
      hasNationalityData
        ? supabase
            .from("guest_nationality")
            .select("nationality, presences")
            .eq("structure_id", structureId)
            .gte("stay_date", sdlyStart)
            .lte("stay_date", sdlyEnd)
        : Promise.resolve({ data: [], error: null }),
      // Disponibilita' storico Nazionalita' per l'ANNO del periodo SDLY
      // (non solo il periodo specifico): distingue "nessun dato importato
      // per questa struttura quell'anno" (es. Sangiorgio, migrazione BD nel
      // 2026 - dati precedenti non attendibili, mai importati) da "importato,
      // ma zero presenze in questo specifico periodo" (0 e' un dato reale,
      // non un'assenza di copertura). Verificato una volta sull'intero anno,
      // non sul singolo periodo scelto nel calendario.
      hasNationalityData
        ? supabase
            .from("guest_nationality")
            .select("id", { count: "exact", head: true })
            .eq("structure_id", structureId)
            .gte("stay_date", `${sdlyStart.slice(0, 4)}-01-01`)
            .lte("stay_date", `${sdlyStart.slice(0, 4)}-12-31`)
        : Promise.resolve({ count: 0, error: null }),
    ]);

    if (periodRes.error) setLoadError(periodRes.error.message);
    if (sdlyRes.error) setLoadError(sdlyRes.error.message);
    if (sdlyAsofRes.error) setLoadError(sdlyAsofRes.error.message);
    if (monthRes.error) setLoadError(monthRes.error.message);
    if (budgetsRes.error) setLoadError(budgetsRes.error.message);
    if (channelRes.error) setLoadError(channelRes.error.message);
    if (channelSdlyRes.error) setLoadError(channelSdlyRes.error.message);
    if (commissionRatesRes.error) setLoadError(commissionRatesRes.error.message);
    if (nationalityRes.error) setLoadError(nationalityRes.error.message);
    if (nationalitySdlyRes.error) setLoadError(nationalitySdlyRes.error.message);
    if (nationalitySdlyYearCountRes.error) setLoadError(nationalitySdlyYearCountRes.error.message);

    setPeriodSnapshots((periodRes.data as SnapshotRow[]) || []);
    setSdlySnapshots((sdlyRes.data as SnapshotRow[]) || []);
    setMonthSnapshots((monthRes.data as SnapshotRow[]) || []);
    setBudgets((budgetsRes.data as BudgetRow[]) || []);

    setChannelCommissionRates(
      new Map(
        (
          (commissionRatesRes.data as
            | { channel: string; commission_pct: number; source: "fattura" | "stima"; source_reference: string | null }[]
            | null) || []
        ).map((r) => [
          r.channel,
          { pct: Number(r.commission_pct), source: r.source, sourceReference: r.source_reference },
        ])
      )
    );

    if (sdlyIsFullMonth) {
      const row = ((sdlyAsofRes.data as
        | { revenue_total: number; rooms_sold: number; rooms_available: number; arrivals: number; presences: number }[]
        | null) || [])[0];
      setSdlyAsofAgg(
        row
          ? {
              revenue: Number(row.revenue_total),
              roomsSold: Number(row.rooms_sold),
              roomsAvailable: Number(row.rooms_available),
              arrivals: Number(row.arrivals),
              presences: Number(row.presences),
            }
          : EMPTY_KPI_AGG
      );
    } else {
      const rowsWithStatus = ((sdlyAsofRes.data as SnapshotRow[] | null) || []).map((r) => ({
        ...r,
        status: "otb" as const,
      }));
      const agg = sumSnapshots(rowsWithStatus);
      setSdlyAsofAgg({
        revenue: agg.revenue,
        roomsSold: agg.roomsSold,
        roomsAvailable: agg.roomsAvailable,
        arrivals: agg.arrivals,
        presences: agg.presences,
      });
    }

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

    const nationalitySdlyTotals = new Map<string, number>();
    (nationalitySdlyRes.data || []).forEach((r) => {
      const key = r.nationality as string;
      nationalitySdlyTotals.set(key, (nationalitySdlyTotals.get(key) || 0) + Number(r.presences));
    });
    setNationalityDataSdly(
      Array.from(nationalitySdlyTotals, ([nationality, presences]) => ({ nationality, presences }))
    );
    setNationalitySdlyAvailable((nationalitySdlyYearCountRes.count || 0) > 0);

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

    setDailyDetailRows(toDailyDetailRows((data || []) as never[]));
    setDailyDetailLoading(false);
  }

  useEffect(() => {
    if (dailyDetailOpen && detailGranularity === "month") void loadYearlyDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyDetailOpen, detailGranularity, detailYear]);

  async function loadYearlyDetail() {
    setYearlyDetailLoading(true);

    const { data, error } = await supabase
      .from("performance_daily_snapshot")
      .select("stay_date, extraction_date, revenue_total, rooms_sold, rooms_available")
      .eq("structure_id", structureId)
      .gte("stay_date", `${detailYear}-01-01`)
      .lte("stay_date", `${detailYear}-12-31`)
      .order("stay_date", { ascending: true })
      .order("extraction_date", { ascending: false });

    if (error) {
      setLoadError(error.message);
      setYearlyDetailLoading(false);
      return;
    }

    setYearlyDetailRows(toDailyDetailRows((data || []) as never[]));
    setYearlyDetailLoading(false);
  }

  const periodAgg = useMemo(() => sumSnapshots(periodSnapshots), [periodSnapshots]);
  // "Consuntivo anno prec.": v_snapshot_latest sullo stesso periodo di un
  // anno fa, invariato. "SDLY": sdlyAsofAgg, calcolato con cutoff (vedi
  // loadMetrics) - due fonti diverse per due confronti diversi, mai
  // scambiate tra loro.
  const sdlyAgg = useMemo(() => sumSnapshots(sdlySnapshots), [sdlySnapshots]);
  const comparisonAgg: KpiAgg = comparisonTab === "sdly" ? sdlyAsofAgg : sdlyAgg;
  const comparisonLabel = comparisonTab === "sdly" ? "SDLY" : "Consuntivo anno prec.";
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

  const displayedDetailRows = useMemo(
    () =>
      detailGranularity === "month"
        ? buildFullYearMonthRows(yearlyDetailRows || [], detailYear)
        : buildDetailRows(dailyDetailRows || [], detailGranularity),
    [dailyDetailRows, yearlyDetailRows, detailGranularity, detailYear]
  );

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
        description="Confronto vs stesso periodo anno precedente — SDLY (a parità di anticipo) o Consuntivo finale, a scelta — e mese in corso vs budget. 'ND' indica che non esiste ancora un dato importato — mai un valore pari a zero."
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
                  ? `Dato importato per questo giorno · confronto con ${sdlyLabel}`
                  : `Nessun dato importato per questo giorno · confronto con ${sdlyLabel}`
                : `Somma di ${periodAgg.daysWithData} giorni con dati nel periodo · confronto con ${sdlyLabel}`
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

                <div className="mb-4 flex flex-wrap gap-2">
                  {COMPARISON_TAB_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setComparisonTab(opt.value)}
                      className={`rounded-[14px] px-4 py-2 text-sm font-semibold transition ${
                        comparisonTab === opt.value
                          ? "bg-teal text-white"
                          : "border border-[#e7dfd8] bg-white text-[#2B2D2F] hover:bg-[#f8f6f2]"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {comparisonTab === "sdly" &&
                  comparisonAgg.revenue === null &&
                  comparisonAgg.roomsSold === null && (
                    <p className="mb-4 text-sm text-[#6a6d70]">
                      {ND} — nessun dato disponibile per {sdlyLabel} al cutoff a parità di anticipo (
                      {formatDateIt(sdlyDate(todayString()))}).
                    </p>
                  )}

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                  <KpiCard
                    label="Revenue"
                    current={formatCurrency(periodAgg.revenue)}
                    currentRaw={periodAgg.revenue}
                    comparison={formatCurrency(comparisonAgg.revenue)}
                    comparisonRaw={comparisonAgg.revenue}
                    comparisonLabel={comparisonLabel}
                  />
                  <KpiCard
                    label="Occupazione"
                    current={formatPercent(occupancy(periodAgg.roomsSold, periodAgg.roomsAvailable))}
                    currentRaw={occupancy(periodAgg.roomsSold, periodAgg.roomsAvailable)}
                    comparison={formatPercent(occupancy(comparisonAgg.roomsSold, comparisonAgg.roomsAvailable))}
                    comparisonRaw={occupancy(comparisonAgg.roomsSold, comparisonAgg.roomsAvailable)}
                    comparisonLabel={comparisonLabel}
                  />
                  <KpiCard
                    label="Arrivi"
                    current={formatNumber(periodAgg.arrivals)}
                    currentRaw={periodAgg.arrivals}
                    comparison={formatNumber(comparisonAgg.arrivals)}
                    comparisonRaw={comparisonAgg.arrivals}
                    comparisonLabel={comparisonLabel}
                  />
                  <KpiCard
                    label="Presenze"
                    current={formatNumber(periodAgg.presences)}
                    currentRaw={periodAgg.presences}
                    comparison={formatNumber(comparisonAgg.presences)}
                    comparisonRaw={comparisonAgg.presences}
                    comparisonLabel={comparisonLabel}
                  />
                  <KpiCard
                    label="LOS"
                    current={(() => {
                      const value = los(periodAgg.roomsSold, periodAgg.arrivals);
                      return value !== null ? value.toLocaleString("it-IT", { maximumFractionDigits: 1 }) : ND;
                    })()}
                    currentRaw={los(periodAgg.roomsSold, periodAgg.arrivals)}
                    comparison={(() => {
                      const value = los(comparisonAgg.roomsSold, comparisonAgg.arrivals);
                      return value !== null ? value.toLocaleString("it-IT", { maximumFractionDigits: 1 }) : ND;
                    })()}
                    comparisonRaw={los(comparisonAgg.roomsSold, comparisonAgg.arrivals)}
                    comparisonLabel={comparisonLabel}
                  />
                </div>
              </>
            )}
          </AppCard>

          <AppCard
            title="Mese in corso vs budget"
            subtitle={
              monthToDate.daysWithData > 0
                ? `${monthToDate.daysWithData}/${daysInMonth} giorni con dati (parziale se il mese non è concluso o mancano import)`
                : "Nessun dato importato per questo mese"
            }
            className="p-4"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[380px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[#e7dfd8] text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                    <th className="pb-2 pr-4">Scenario</th>
                    <th className="pb-2 pr-4">Revenue</th>
                    <th className="pb-2">Occupazione</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-[#f0ece6]">
                    <td className="py-1.5 pr-4 font-semibold text-[#2B2D2F]">Reale</td>
                    <td className="py-1.5 pr-4 text-[#2B2D2F]">
                      {monthToDate.daysWithData > 0 ? (
                        <div className="flex items-start gap-2">
                          {monthPacing && (
                            <span
                              className={`mt-1 h-2 w-2 shrink-0 rounded-full ${pacingDotClasses[monthPacing]}`}
                            />
                          )}
                          <div>
                            <div>{formatCurrency(monthToDate.revenue)}</div>
                            {monthPacingDetail && (
                              <div className="text-[12px] text-[#6a6d70]">{monthPacingDetail}</div>
                            )}
                          </div>
                        </div>
                      ) : (
                        ND
                      )}
                    </td>
                    <td className="py-1.5 text-[#2B2D2F]">
                      {monthToDate.daysWithData > 0
                        ? formatPercent(occupancy(monthToDate.roomsSold, monthToDate.roomsAvailable))
                        : ND}
                    </td>
                  </tr>

                  {["minimo", "realistico", "sfidante"].map((level) => {
                    const budget = budgets.find((b) => b.level === level);

                    return (
                      <tr key={level} className="border-b border-[#f0ece6] last:border-0">
                        <td className="py-1.5 pr-4 text-[#2B2D2F]">{budgetLevelLabels[level]}</td>
                        <td className="py-1.5 pr-4 text-[#2B2D2F]">
                          {budget ? formatCurrency(Number(budget.revenue_target)) : ND}
                        </td>
                        <td className="py-1.5 text-[#2B2D2F]">
                          {budget ? formatPercent(Number(budget.occupancy_pct_target)) : ND}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </AppCard>
        </div>
      </div>

      {hasChannelData && (
        <>
          <AppCard
            title="Revenue per canale"
            subtitle={`Fatturato aggregato per canale sul periodo visualizzato (${periodLabel}) — la riga Totale deve coincidere con la somma delle barre`}
            action={
              canManage ? (
                <label className="flex items-center gap-2 text-sm text-[#2B2D2F]">
                  <input
                    type="checkbox"
                    checked={showNetChannelRevenue}
                    onChange={(e) => setShowNetChannelRevenue(e.target.checked)}
                  />
                  Mostra netto
                </label>
              ) : undefined
            }
          >
            <ChannelRevenueBars
              data={channelRevenue}
              commissionRates={channelCommissionRates}
              showNet={showNetChannelRevenue}
            />
          </AppCard>

          <AppCard
            title="Direct Booking Share"
            subtitle={`Quota dei canali diretti (CRM + Booking Engine) sul totale, ${periodLabel}`}
          >
            <div className="flex flex-wrap items-end gap-10">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                  Quota diretta
                </p>
                <p className="mt-2 text-[28px] font-semibold leading-none text-[#2B2D2F]">
                  {directShareCurrent.share !== null ? formatPercent(directShareCurrent.share) : ND}
                </p>
                {directShareCurrent.direct !== null && directShareCurrent.total !== null && (
                  <p className="mt-2 text-[14px] text-[#6a6d70]">
                    {formatCurrency(directShareCurrent.direct)} su {formatCurrency(directShareCurrent.total)} totali
                  </p>
                )}
              </div>

              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                  vs {sdlyLabel} (Consuntivo anno prec.)
                </p>
                <p className="mt-2 text-[22px] font-semibold leading-none text-[#2B2D2F]">
                  {directShareSdly.share !== null ? formatPercent(directShareSdly.share) : ND}
                </p>
                {directShareCurrent.share !== null && directShareSdly.share !== null && (
                  <p
                    className={`mt-2 text-[14px] ${
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
          action={
            <label className="flex items-center gap-2 text-sm text-[#2B2D2F]">
              <input
                type="checkbox"
                checked={showNationalityComparison}
                onChange={(e) => setShowNationalityComparison(e.target.checked)}
              />
              Confronta con {sdlyDate(periodStart).slice(0, 4)}
            </label>
          }
        >
          <NationalityBars
            data={nationalityData}
            sdlyData={nationalityDataSdly}
            sdlyYearLabel={sdlyDate(periodStart).slice(0, 4)}
            sdlyAvailable={nationalitySdlyAvailable}
            showComparison={showNationalityComparison}
          />
        </AppCard>
      )}

      <AppCard
        title="Dettaglio giornaliero"
        subtitle={
          detailGranularity === "month"
            ? `Tutti i 12 mesi di ${detailYear} — i mesi senza dati mostrano ND`
            : `Una riga per ${
                detailGranularity === "day" ? "ogni giorno" : "ogni settimana"
              } di ${periodLabel} con dato disponibile`
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setDailyDetailOpen((prev) => !prev)}
            className="flex h-11 items-center gap-2 rounded-[14px] border border-[#e7dfd8] bg-white px-4 text-sm font-medium text-[#017A92] hover:bg-[#f3f8fa]"
          >
            {dailyDetailOpen ? "Nascondi dettaglio giornaliero ▲" : "Mostra dettaglio giornaliero ▾"}
          </button>

          {dailyDetailOpen && (
            <div className="flex flex-wrap gap-2">
              {DETAIL_GRANULARITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDetailGranularity(opt.value)}
                  className={`rounded-[14px] px-4 py-2 text-sm font-semibold transition ${
                    detailGranularity === opt.value
                      ? "bg-teal text-white"
                      : "border border-[#e7dfd8] bg-white text-[#2B2D2F] hover:bg-[#f8f6f2]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {dailyDetailOpen && (
          <div className="mt-4 overflow-x-auto">
            {(detailGranularity === "month" ? yearlyDetailLoading : dailyDetailLoading) ? (
              <p className="text-sm text-[#6a6d70]">Caricamento...</p>
            ) : displayedDetailRows.length > 0 ? (
              <table className="w-full min-w-[920px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[#e7dfd8] text-left text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                    <th className="pb-3 pr-4">
                      {detailGranularity === "day" ? "Data" : detailGranularity === "week" ? "Settimana" : "Mese"}
                    </th>
                    <th className="pb-3 pr-4">Revenue</th>
                    <th className="pb-3 pr-4">ADR</th>
                    <th className="pb-3 pr-4">RevPAR</th>
                    <th className="pb-3 pr-4">Occupazione</th>
                    <th className="pb-3 pr-4">Camere occupate</th>
                    <th className="pb-3 pr-4">Camere disponibili</th>
                    <th className="pb-3 pr-4">
                      Camere libere
                      <InfoTooltip text="Camere disponibili non ancora vendute per questo periodo (disponibili − occupate) — quelle su cui si può ancora generare revenue, non l'inventario totale della struttura." />
                    </th>
                    <th className="pb-3 pr-4">
                      Pickup RN
                      <InfoTooltip text="Differenza di camere vendute tra l'ultima estrazione disponibile e quella precedente, per giorno se la vista è giornaliera, sommata se è settimanale/mensile." />
                    </th>
                    <th className="pb-3">
                      Pickup €
                      <InfoTooltip text="Differenza di revenue tra l'ultima estrazione disponibile e quella precedente, per giorno se la vista è giornaliera, sommata se è settimanale/mensile." />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayedDetailRows.map((row) => (
                    <tr key={row.key} className="border-b border-[#f0ece6] last:border-0">
                      <td className="py-2 pr-4 text-[#2B2D2F]">{row.label}</td>
                      <td className="py-2 pr-4 text-[#2B2D2F]">{row.hasData ? formatCurrency(row.revenue) : ND}</td>
                      <td className="py-2 pr-4 text-[#2B2D2F]">{row.hasData ? formatCurrency(row.adr) : ND}</td>
                      <td className="py-2 pr-4 text-[#2B2D2F]">{row.hasData ? formatCurrency(row.revPar) : ND}</td>
                      <td className="py-2 pr-4 text-[#2B2D2F]">{row.hasData ? formatPercent(row.occupancy) : ND}</td>
                      <td className="py-2 pr-4 text-[#2B2D2F]">{row.hasData ? formatNumber(row.roomsSold) : ND}</td>
                      <td className="py-2 pr-4 text-[#2B2D2F]">{row.hasData ? formatNumber(row.roomsAvailable) : ND}</td>
                      <td className="py-2 pr-4 text-[#2B2D2F]">
                        {row.hasData ? formatNumber(row.roomsAvailable - row.roomsSold) : ND}
                      </td>
                      <td className="py-2 pr-4">
                        {row.pickupRooms === null ? (
                          <span className="text-[#2B2D2F]">{ND}</span>
                        ) : (
                          <CellTooltip
                            trigger={
                              <span
                                className={
                                  row.pickupRooms > 0
                                    ? "text-[#2f7d43]"
                                    : row.pickupRooms < 0
                                    ? "text-[#8a3a3a]"
                                    : "text-[#2B2D2F]"
                                }
                              >
                                {row.pickupRooms >= 0 ? "+" : ""}
                                {formatNumber(row.pickupRooms)}
                              </span>
                            }
                          >
                            {row.pickupTooltip}
                          </CellTooltip>
                        )}
                      </td>
                      <td className="py-2">
                        {row.pickupRevenue === null ? (
                          <span className="text-[#2B2D2F]">{ND}</span>
                        ) : (
                          <CellTooltip
                            trigger={
                              <span
                                className={
                                  row.pickupRevenue > 0
                                    ? "text-[#2f7d43]"
                                    : row.pickupRevenue < 0
                                    ? "text-[#8a3a3a]"
                                    : "text-[#2B2D2F]"
                                }
                              >
                                {row.pickupRevenue >= 0 ? "+" : ""}
                                {formatCurrency(row.pickupRevenue)}
                              </span>
                            }
                          >
                            {row.pickupTooltip}
                          </CellTooltip>
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
    </div>
  );
}

function KpiCard({
  label,
  current,
  currentRaw,
  comparison,
  comparisonRaw,
  comparisonLabel,
}: {
  label: string;
  current: string;
  currentRaw: number | null;
  comparison: string;
  comparisonRaw: number | null;
  comparisonLabel: string;
}) {
  const delta = formatDelta(currentRaw, comparisonRaw);

  return (
    <div className="rounded-[16px] border border-[#e7dfd8] bg-[#fcfbf9] p-4">
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
        {label}
      </p>
      <p className="mt-2 text-[22px] font-semibold leading-none text-[#2B2D2F]">{current}</p>
      <p className="mt-2 text-[14px] text-[#6a6d70]">
        {comparisonLabel}: {comparison}
      </p>
      <p className={`mt-1 text-[14px] font-medium ${delta.colorClass}`}>
        {delta.text} vs {comparisonLabel}
      </p>
    </div>
  );
}

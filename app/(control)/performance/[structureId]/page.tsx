"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { use as usePromise } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { AppCard } from "@/components/ui/AppCard";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { CellTooltip } from "@/components/ui/CellTooltip";
import { supabase } from "@/lib/supabaseClient";
import { canViewModule, getUserLevelRank } from "@/lib/permissions";
import { Calendar, MONTH_LABELS } from "@/components/performance/Calendar";
import { ChannelRevenueBars, ChannelRevenueDatum } from "@/components/performance/ChannelRevenueBars";
import {
  ChannelCommissionSummary,
  CommissionRateInput,
  summarizeChannelCommissions,
} from "@/lib/performance/channelCommissions";
import {
  computePeriodBudget,
  MonthlyBudgetRow,
  PeriodBudget,
  periodBudgetTitles,
  periodKind,
} from "@/lib/performance/periodBudget";
import { aggregateMonthlyAsofWithClosures, ClosureRange, MonthAsofRow } from "@/lib/performance/sdlyAnnual";
import { sdlyCutoffFromRows } from "@/lib/performance/sdlyCutoff";
import { DailyRow, resolveProductionSdly, SdlyMode, sdlyModeForPeriod } from "@/lib/performance/sdlyComparison";
import { NationalityBars, NationalityDatum } from "@/components/performance/NationalityBars";
import { MonthlyPerformanceTable } from "@/components/performance/MonthlyPerformanceTable";
import {
  buildMonthlyPerformance,
  buildMonthlyPerformanceTotal,
  monthlyAsofRequests,
  MonthlySnapshotRow,
} from "@/lib/performance/monthlyPerformance";
import {
  ND,
  SnapshotRow,
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

// Vista Mensile "tutto l'anno": costruita direttamente in loadYearlyDetail()
// via fn_month_snapshot_asof (12 chiamate, una per mese, stesso cutoff) -
// nessuna aggregazione lato client da righe giornaliere, per non reintrodurre
// una seconda implementazione che diverga dalla RPC canonica.

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

// Stesso pattern gia' in uso in performance/page.tsx (Vista d'insieme) per
// le scorciatoie Mese/Anno - stesso range di 5 anni, stessa provenienza
// (todayString, calcolato una sola volta al caricamento del modulo).
const [TODAY_YEAR, TODAY_MONTH] = todayString().split("-").map(Number);
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => TODAY_YEAR - 3 + i);

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

// Stesso rischio e stessa soluzione di fetchAllSnapshotRows in
// app/(control)/performance/page.tsx: una risposta senza .range() esplicito
// viene troncata da PostgREST oltre un limite di righe fisso lato server
// (1.000 in questo progetto), senza errore - verificato dal vero che il
// widget "Revenue per canale" di Palazzo Rollo mostrava un totale parziale
// e non deterministico (order-dependent) proprio per questo, non solo per
// la doppia extraction_date. v_channel_revenue_latest gia' deduplica per
// extraction_date, ma resta comunque potenzialmente > 1.000 righe per
// struttura/periodo (es. Palazzo Arco Cadura: 1.412 righe grezze, di cui
// solo una per chiave logica sopravvive alla view - ma il conteggio finale
// puo' comunque superare 1.000 su periodi lunghi con molti canali).
const CHANNEL_REVENUE_PAGE_SIZE = 1000;

type ChannelRevenueQueryRow = { channel: string; period_start: string; revenue_gross: number | string };

async function fetchAllChannelRevenueRows(
  sId: string,
  start: string,
  end: string
): Promise<{ data: ChannelRevenueQueryRow[]; error: { message: string } | null }> {
  const allRows: ChannelRevenueQueryRow[] = [];
  let from = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from("v_channel_revenue_latest")
      .select("channel, period_start, revenue_gross")
      .eq("structure_id", sId)
      .gte("period_start", start)
      .lte("period_start", end)
      .order("period_start", { ascending: true })
      .order("channel", { ascending: true })
      .range(from, from + CHANNEL_REVENUE_PAGE_SIZE - 1);

    if (error) return { data: allRows, error };

    allRows.push(...((data as ChannelRevenueQueryRow[]) || []));

    if (!data || data.length < CHANNEL_REVENUE_PAGE_SIZE) break;
    from += CHANNEL_REVENUE_PAGE_SIZE;
  }

  return { data: allRows, error: null };
}

// Stesso helper, stesso motivo, per Nazionalita': v_nationality_latest
// dedupplica per extraction_date ma la risposta resta comunque soggetta
// allo stesso limite implicito di PostgREST su periodi/anni con molte
// nazionalita' diverse.
const NATIONALITY_PAGE_SIZE = 1000;

type NationalityQueryRow = { nationality: string; presences: number | string };

async function fetchAllNationalityRows(
  sId: string,
  start: string,
  end: string
): Promise<{ data: NationalityQueryRow[]; error: { message: string } | null }> {
  const allRows: NationalityQueryRow[] = [];
  let from = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from("v_nationality_latest")
      .select("nationality, presences")
      .eq("structure_id", sId)
      .gte("stay_date", start)
      .lte("stay_date", end)
      .order("stay_date", { ascending: true })
      .order("nationality", { ascending: true })
      .range(from, from + NATIONALITY_PAGE_SIZE - 1);

    if (error) return { data: allRows, error };

    allRows.push(...((data as NationalityQueryRow[]) || []));

    if (!data || data.length < NATIONALITY_PAGE_SIZE) break;
    from += NATIONALITY_PAGE_SIZE;
  }

  return { data: allRows, error: null };
}

export default function PerformanceStructureDrilldownPage({
  params,
}: {
  params: Promise<{ structureId: string }>;
}) {
  const { structureId } = usePromise(params);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Link rapido da Budget: ?anno=YYYY preseleziona l'intero anno invece
  // del mese corrente di default - solo all'arrivo sulla pagina, non
  // riletto ad ogni render (l'utente puo' poi cambiare periodo a mano dal
  // calendario come sempre).
  const annoParam = searchParams.get("anno");
  const initialRange = useMemo(() => {
    const year = annoParam ? Number(annoParam) : null;
    if (year && !Number.isNaN(year)) {
      return { start: `${year}-01-01`, end: `${year}-12-31` };
    }
    return DEFAULT_MONTH;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // secondo). Un giorno singolo e' semplicemente un intervallo con inizio
  // e fine coincidenti (due click sulla stessa data). Le modalita' Mese/
  // Anno (sotto) sono scorciatoie che scrivono su questi stessi due stati -
  // mai una seconda source of truth.
  const [rangeStart, setRangeStart] = useState<string>(initialRange.start);
  const [rangeEnd, setRangeEnd] = useState<string | null>(initialRange.end);

  // Periodo "confermato": si aggiorna solo quando la selezione e'
  // completa (rangeEnd non nullo), cosi' il primo click di un nuovo
  // intervallo non fa sparire i dati del periodo precedente mentre si
  // attende il secondo click.
  const [confirmedStart, setConfirmedStart] = useState(initialRange.start);
  const [confirmedEnd, setConfirmedEnd] = useState(initialRange.end);

  useEffect(() => {
    if (rangeEnd) {
      setConfirmedStart(rangeStart);
      setConfirmedEnd(rangeEnd);
    }
  }, [rangeStart, rangeEnd]);

  // Modalita' di navigazione del periodo: Intervallo (calendario libero,
  // comportamento di sempre), Mese, Anno. Scrivono tutte su rangeStart/
  // rangeEnd - "anno" e' la modalita' iniziale coerente quando si arriva
  // da ?anno=YYYY (link da Budget), altrimenti si parte da Intervallo.
  const [periodMode, setPeriodMode] = useState<"intervallo" | "mese" | "anno">(
    annoParam && !Number.isNaN(Number(annoParam)) ? "anno" : "intervallo"
  );
  const [initialSelectedYear, initialSelectedMonth] = initialRange.start.split("-").map(Number);
  const [selectedMonth, setSelectedMonth] = useState(initialSelectedMonth);
  const [selectedYear, setSelectedYear] = useState(initialSelectedYear);

  function applyMonthSelection(year: number, month: number) {
    const { start, end } = monthRange(`${year}-${pad(month)}-01`);
    setRangeStart(start);
    setRangeEnd(end);
  }

  function applyYearSelection(year: number) {
    setRangeStart(`${year}-01-01`);
    setRangeEnd(`${year}-12-31`);
  }

  function switchPeriodMode(mode: "intervallo" | "mese" | "anno") {
    setPeriodMode(mode);
    if (mode === "mese") {
      applyMonthSelection(selectedYear, selectedMonth);
    } else if (mode === "anno") {
      applyYearSelection(selectedYear);
    } else if (!rangeEnd) {
      // Si passa a Intervallo con una selezione lasciata a meta' (rangeEnd
      // nullo, mai realmente accaduto perche' Mese/Anno impostano sempre
      // coppie complete, ma copre anche il caso limite di partenza): torna
      // all'ultimo periodo confermato invece di lasciare uno stato
      // incompleto.
      setRangeStart(confirmedStart);
      setRangeEnd(confirmedEnd);
    }
  }

  const [periodSnapshots, setPeriodSnapshots] = useState<SnapshotRow[]>([]);
  // "Consuntivo anno prec.": v_snapshot_latest sullo stesso periodo di un
  // anno fa, senza cutoff - per un periodo passato e' sempre il risultato
  // finale chiuso, non un OTB storico (correttamente cosi', e' quello che
  // rappresenta).
  const [sdlySnapshots, setSdlySnapshots] = useState<SnapshotRow[]>([]);
  // "SDLY" vero: stesso periodo di un anno fa, ma con l'estrazione
  // disponibile al cutoff = data dello snapshot corrente della struttura
  // meno un anno (fn_month_snapshot_asof per un mese pieno, fn_snapshot_asof
  // per un periodo custom) - stessa data di osservazione, non il consuntivo
  // finale. Vedi loadMetrics.
  const [sdlyAsofAgg, setSdlyAsofAgg] = useState<KpiAgg>(EMPTY_KPI_AGG);
  const [comparisonTab, setComparisonTab] = useState<ComparisonTab>("sdly");
  // Budget del periodo selezionato, insieme agli estremi del periodo per cui
  // e' stato calcolato: il widget lo mostra solo se coincidono col periodo
  // attivo, mai valori residui di un periodo precedente durante il reload.
  const [periodBudgetView, setPeriodBudgetView] = useState<{
    start: string;
    end: string;
    budget: PeriodBudget;
  } | null>(null);
  const [hasChannelData, setHasChannelData] = useState(false);
  const [channelRevenue, setChannelRevenue] = useState<ChannelRevenueDatum[]>([]);
  const [channelRevenueSdly, setChannelRevenueSdly] = useState<ChannelRevenueDatum[]>([]);
  // Commissione per canale sul periodo selezionato, calcolata mese per mese
  // con la tariffa di ciascun mese (summarizeChannelCommissions) - con la
  // copertura (mesi con tariffa / mesi con revenue) per canale.
  const [channelCommissionRates, setChannelCommissionRates] = useState<Map<string, ChannelCommissionSummary>>(
    new Map()
  );
  const [channelCommissionRatesLy, setChannelCommissionRatesLy] = useState<Map<string, ChannelCommissionSummary>>(
    new Map()
  );
  // SDLY anno pieno: mesi dell'anno precedente coperti al cutoff (null per
  // periodi non annuali), per distinguere copertura parziale da nessun dato.
  const [sdlyAnnualCoverage, setSdlyAnnualCoverage] = useState<{
    covered: number;
    expected: number;
    // Mesi senza snapshot valorizzati a 0 per chiusura dichiarata.
    closedMonths: number[];
  } | null>(null);
  // Tab "SDLY" del periodo caricato (stessa regola della Vista d'insieme,
  // lib/performance/sdlyComparison): produzione maturata fino alla data di
  // osservazione per i periodi gia' iniziati - in quel caso currentAgg e'
  // il lato corrente del confronto, limitato ai giorni maturati - oppure
  // OTB as-of dell'intero periodo per i periodi interamente futuri.
  const [sdlyInfo, setSdlyInfo] = useState<{
    mode: SdlyMode;
    currentAgg: KpiAgg | null;
    actualDetail: string | null;
    referenceDetail: string | null;
    unavailableReason: string | null;
    zeroNote: string | null;
  }>({
    mode: "production",
    currentAgg: null,
    actualDetail: null,
    referenceDetail: null,
    unavailableReason: null,
    zeroNote: null,
  });
  // Cutoff SDLY effettivamente usato per il periodo caricato.
  const [sdlyCutoffUsed, setSdlyCutoffUsed] = useState(sdlyDate(todayString()));
  const [showNetChannelRevenue, setShowNetChannelRevenue] = useState(false);
  // Indipendente da "Mostra netto" - entrambi attivabili insieme, mai
  // gated da canManage (channel_revenue non ha la stessa RLS rank>=2 di
  // channel_commission_rates, a differenza di "Mostra netto").
  const [showChannelSdlyCompare, setShowChannelSdlyCompare] = useState(false);
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
  const [yearlyDetailRows, setYearlyDetailRows] = useState<DetailRow[] | null>(null);
  const [yearlyDetailLoading, setYearlyDetailLoading] = useState(false);

  // Performance mensile: righe giornaliere dell'anno e dell'anno precedente
  // (v_snapshot_latest) piu' l'OTB as-of dei soli mesi futuri - caricate una
  // volta per anno (loadMonthlyPerformance), non ad ogni cambio di mese.
  // Budget mensile e chiusure arrivano da loadMetrics, che li legge gia'.
  const [monthlyData, setMonthlyData] = useState<{
    year: number;
    currentRows: MonthlySnapshotRow[];
    previousRows: MonthlySnapshotRow[];
    asofByMonth: Map<number, MonthAsofRow | null>;
  } | null>(null);
  const [monthlyBudgetRows, setMonthlyBudgetRows] = useState<MonthlyBudgetRow[]>([]);
  const [structureClosures, setStructureClosures] = useState<ClosureRange[]>([]);
  // Anno dell'ultima richiesta: una risposta arrivata dopo un cambio anno
  // viene scartata.
  const monthlyYearRef = useRef<number | null>(null);

  const periodStart = confirmedStart;
  const periodEnd = confirmedEnd;
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
      .from("v_channel_revenue_latest")
      .select("*", { count: "exact", head: true })
      .eq("structure_id", structureId);

    if (!channelCountError) {
      setHasChannelData((channelCount || 0) > 0);
    }

    const { count: nationalityCount, error: nationalityCountError } = await supabase
      .from("v_nationality_latest")
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
    // Anni coperti dal periodo corrente e da quello SDLY: budget e tariffe
    // commissione sono mensili, si leggono tutti i mesi di questi anni e si
    // filtrano poi sui soli mesi del periodo (periodBudget.ts /
    // channelCommissions.ts) - mai il solo mese di periodStart.
    const yearsOf = (start: string, end: string) => {
      const years: number[] = [];
      for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) years.push(y);
      return years;
    };
    const periodYears = yearsOf(periodStart, periodEnd);
    const sdlyYears = yearsOf(sdlyStart, sdlyEnd);

    const snapshotColumns =
      "stay_date, extraction_date, revenue_total, rooms_sold, rooms_available, arrivals, presences, status";

    // Le righe del periodo corrente si leggono per prime: la loro
    // extraction_date piu' recente e' la data di osservazione dell'OTB
    // mostrato, da cui dipende il cutoff SDLY.
    const periodRes = await supabase
      .from("v_snapshot_latest")
      .select(snapshotColumns)
      .eq("structure_id", structureId)
      .gte("stay_date", periodStart)
      .lte("stay_date", periodEnd);

    // Tab "SDLY": OTB del periodo di un anno fa cosi' come si presentava
    // alla stessa data di osservazione dell'OTB corrente (snapshot corrente
    // della struttura meno un anno, non genericamente oggi meno un anno),
    // non il consuntivo finale - stessa regola della Vista d'insieme
    // (sdlyCutoffFromRows). Senza righe nel periodo corrente non esiste una
    // data di osservazione: si ricade su oggi meno un anno. Per
    // un mese pieno usa la funzione mensile (unica fonte per lo storico
    // 2025, caricato a granularita' mensile); per un periodo custom usa la
    // funzione giornaliera - che per periodi 2025 non ancora coperti da
    // performance_daily_snapshot torna ND, onestamente, invece di un dato
    // approssimato.
    // Anno pieno: stessa fonte del mese pieno (fn_month_snapshot_asof),
    // ripetuta sui 12 mesi dell'anno precedente allo stesso cutoff e
    // aggregata in aggregateMonthlyAsof - lo storico 2025 e' caricato a
    // granularita' mensile, fn_snapshot_asof (giornaliera) tornerebbe ND.
    // Intervallo custom: invariato, fn_snapshot_asof.
    //
    // Le RPC as-of servono solo per un periodo interamente futuro (OTB
    // as-of). Per un periodo gia' iniziato lo SDLY e' produzione maturata:
    // righe giornaliere del periodo e dello stesso periodo dell'anno
    // precedente, gia' caricate qui sotto, nessuna RPC.
    const sdlyObservation = sdlyCutoffFromRows(
      (periodRes.data as unknown as { extraction_date: string | null }[] | null) || []
    );
    const sdlyCutoff = sdlyObservation.cutoff ?? sdlyDate(todayString());
    const sdlyMode = sdlyModeForPeriod(periodStart, todayString());
    const sdlyIsFullMonth = isFullMonth(periodStart, periodEnd);
    const sdlyIsFullYear = periodKind(periodStart, periodEnd) === "year";
    const sdlyAsofPromise = sdlyMode === "production" || sdlyIsFullYear
      ? Promise.resolve({ data: null, error: null })
      : sdlyIsFullMonth
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
    const sdlyAnnualPromise = sdlyMode === "otb_asof" && sdlyIsFullYear
      ? Promise.all(
          Array.from({ length: 12 }, (_, i) =>
            supabase.rpc("fn_month_snapshot_asof", {
              p_structure_ids: [structureId],
              p_period_year: Number(sdlyStart.slice(0, 4)),
              p_period_month: i + 1,
              p_cutoff_date: sdlyCutoff,
            })
          )
        )
      : Promise.resolve(null);

    const [
      closuresRes,
      sdlyRes,
      sdlyAsofRes,
      sdlyAnnualRes,
      budgetsRes,
      channelRes,
      channelSdlyRes,
      commissionRatesRes,
      commissionRatesLyRes,
      nationalityRes,
      nationalitySdlyRes,
      nationalitySdlyYearCountRes,
    ] = await Promise.all([
      // Chiusure dichiarate (stesso registro del Budget): unica fonte per
      // riconoscere un mese di chiusura stagionale nello SDLY annuale.
      supabase.from("structure_closures").select("start_date, end_date").eq("structure_id", structureId),
      supabase
        .from("v_snapshot_latest")
        .select(snapshotColumns)
        .eq("structure_id", structureId)
        .gte("stay_date", sdlyStart)
        .lte("stay_date", sdlyEnd),
      sdlyAsofPromise,
      sdlyAnnualPromise,
      supabase
        .from("v_budgets_current")
        .select(
          "season_year, month, level, adr, revenue_target, room_nights_sold_target, room_nights_available, occupancy_pct_target"
        )
        .eq("structure_id", structureId)
        .in("season_year", periodYears),
      hasChannelData
        ? fetchAllChannelRevenueRows(structureId, periodStart, periodEnd)
        : Promise.resolve({ data: [], error: null }),
      // Direct Booking Share vs anno precedente: SEMPRE consuntivo, mai vero
      // SDLY - channel_revenue e' uno storico di estrazioni (v_channel_
      // revenue_latest ne prende solo l'ultima per chiave logica), ma non
      // esiste un "OTB a parita' di anticipo" da ricostruire per l'anno
      // scorso: l'unico dato disponibile e' gia' il risultato finale di
      // quell'extraction_date, quindi qui non c'e' un tab SDLY vero -
      // l'etichetta dice esplicitamente "Consuntivo anno prec." invece di
      // "SDLY".
      hasChannelData
        ? fetchAllChannelRevenueRows(structureId, sdlyStart, sdlyEnd)
        : Promise.resolve({ data: [], error: null }),
      // Tariffe commissione per il toggle "Mostra netto" su Revenue per
      // canale: tutti i mesi degli anni del periodo, poi applicate mese per
      // mese (summarizeChannelCommissions) - mai la sola tariffa del mese di
      // periodStart. RLS su channel_commission_rates e' gia' rank >= 2:
      // gated anche qui lato query per non fare una fetch inutile a chi non
      // la vedrebbe comunque (torna 0 righe, non un errore).
      hasChannelData && canManage
        ? supabase
            .from("channel_commission_rates")
            .select("channel, period_year, period_month, commission_pct, source, source_reference")
            .eq("structure_id", structureId)
            .in("period_year", periodYears)
        : Promise.resolve({ data: [], error: null }),
      // Stessa query sugli anni del periodo SDLY: le tariffe dell'anno
      // precedente, mai la percentuale corrente riusata sul LY.
      hasChannelData && canManage
        ? supabase
            .from("channel_commission_rates")
            .select("channel, period_year, period_month, commission_pct, source, source_reference")
            .eq("structure_id", structureId)
            .in("period_year", sdlyYears)
        : Promise.resolve({ data: [], error: null }),
      hasNationalityData
        ? fetchAllNationalityRows(structureId, periodStart, periodEnd)
        : Promise.resolve({ data: [], error: null }),
      // Confronto Nazionalità 2026 vs 2025: stesso periodo SDLY gia'
      // calcolato per le altre sezioni della pagina.
      hasNationalityData
        ? fetchAllNationalityRows(structureId, sdlyStart, sdlyEnd)
        : Promise.resolve({ data: [], error: null }),
      // Disponibilita' storico Nazionalita' per l'ANNO del periodo SDLY
      // (non solo il periodo specifico): distingue "nessun dato importato
      // per questa struttura quell'anno" (es. Sangiorgio, migrazione BD nel
      // 2026 - dati precedenti non attendibili, mai importati) da "importato,
      // ma zero presenze in questo specifico periodo" (0 e' un dato reale,
      // non un'assenza di copertura). Verificato una volta sull'intero anno,
      // non sul singolo periodo scelto nel calendario. head:true -> nessuna
      // riga restituita, il limite PostgREST non si applica qui.
      hasNationalityData
        ? supabase
            .from("v_nationality_latest")
            .select("id", { count: "exact", head: true })
            .eq("structure_id", structureId)
            .gte("stay_date", `${sdlyStart.slice(0, 4)}-01-01`)
            .lte("stay_date", `${sdlyStart.slice(0, 4)}-12-31`)
        : Promise.resolve({ count: 0, error: null }),
    ]);

    if (periodRes.error) setLoadError(periodRes.error.message);
    if (closuresRes.error) setLoadError(closuresRes.error.message);
    if (sdlyRes.error) setLoadError(sdlyRes.error.message);
    if (sdlyAsofRes.error) setLoadError(sdlyAsofRes.error.message);
    sdlyAnnualRes?.forEach((res) => {
      if (res.error) setLoadError(res.error.message);
    });
    if (budgetsRes.error) setLoadError(budgetsRes.error.message);
    if (channelRes.error) setLoadError(channelRes.error.message);
    if (channelSdlyRes.error) setLoadError(channelSdlyRes.error.message);
    if (commissionRatesRes.error) setLoadError(commissionRatesRes.error.message);
    if (commissionRatesLyRes.error) setLoadError(commissionRatesLyRes.error.message);
    if (nationalityRes.error) setLoadError(nationalityRes.error.message);
    if (nationalitySdlyRes.error) setLoadError(nationalitySdlyRes.error.message);
    if (nationalitySdlyYearCountRes.error) setLoadError(nationalitySdlyYearCountRes.error.message);

    setPeriodSnapshots((periodRes.data as SnapshotRow[]) || []);
    setSdlySnapshots((sdlyRes.data as SnapshotRow[]) || []);
    setMonthlyBudgetRows((budgetsRes.data as MonthlyBudgetRow[] | null) || []);
    setStructureClosures((closuresRes.data as ClosureRange[] | null) || []);
    // Anno pieno: le righe appena lette sono gia' quelle della Performance
    // mensile, nessuna seconda lettura di v_snapshot_latest.
    if (sdlyIsFullYear && !periodRes.error && !sdlyRes.error) {
      void loadMonthlyPerformance(Number(periodStart.slice(0, 4)), {
        currentRows: (periodRes.data as unknown as MonthlySnapshotRow[] | null) || [],
        previousRows: (sdlyRes.data as unknown as MonthlySnapshotRow[] | null) || [],
      });
    }
    setPeriodBudgetView({
      start: periodStart,
      end: periodEnd,
      budget: computePeriodBudget((budgetsRes.data as MonthlyBudgetRow[] | null) || [], periodStart, periodEnd),
    });

    type CommissionRow = {
      channel: string;
      period_year: number;
      period_month: number;
      commission_pct: number | string;
      source: "fattura" | "stima";
      source_reference: string | null;
    };
    const toRates = (rows: CommissionRow[] | null): CommissionRateInput[] =>
      (rows || []).map((r) => ({
        channel: r.channel,
        year: Number(r.period_year),
        month: Number(r.period_month),
        pct: Number(r.commission_pct),
        source: r.source,
        sourceReference: r.source_reference,
      }));
    const toRevenueInput = (rows: ChannelRevenueQueryRow[]) =>
      rows.map((r) => ({ channel: r.channel, stayDate: r.period_start, revenueGross: Number(r.revenue_gross) }));

    setChannelCommissionRates(
      summarizeChannelCommissions(
        toRevenueInput(channelRes.data || []),
        toRates(commissionRatesRes.data as CommissionRow[] | null)
      )
    );
    // Revenue LY con le tariffe LY dei rispettivi mesi - mai la percentuale
    // corrente riusata sul LY.
    setChannelCommissionRatesLy(
      summarizeChannelCommissions(
        toRevenueInput(channelSdlyRes.data || []),
        toRates(commissionRatesLyRes.data as CommissionRow[] | null)
      )
    );

    setSdlyCutoffUsed(sdlyCutoff);
    setSdlyAnnualCoverage(null);
    const rangeLabel = (startDate: string, endDate: string) => `${formatDateIt(startDate)} → ${formatDateIt(endDate)}`;
    if (sdlyMode === "production") {
      const production = resolveProductionSdly({
        periodStart,
        periodEnd,
        observationDate: sdlyObservation.observationDate,
        currentRows: (periodRes.data as unknown as DailyRow[] | null) || [],
        previousRows: (sdlyRes.data as unknown as DailyRow[] | null) || [],
        closures: (closuresRes.data as ClosureRange[] | null) || [],
      });
      const previousYear = sdlyStart.slice(0, 4);
      if (production.status === "no_matured") {
        setSdlyAsofAgg(EMPTY_KPI_AGG);
        setSdlyInfo({
          mode: sdlyMode,
          currentAgg: EMPTY_KPI_AGG,
          actualDetail: null,
          referenceDetail: null,
          unavailableReason: sdlyObservation.observationDate
            ? `snapshot corrente del ${formatDateIt(sdlyObservation.observationDate)} precedente all’inizio del periodo, nessuna produzione maturata`
            : "nessun dato nel periodo selezionato",
          zeroNote: null,
        });
      } else {
        setSdlyAsofAgg(production.previous ?? EMPTY_KPI_AGG);
        setSdlyInfo({
          mode: sdlyMode,
          currentAgg: production.current ?? EMPTY_KPI_AGG,
          actualDetail: rangeLabel(production.currentStart, production.currentEnd),
          referenceDetail: rangeLabel(production.previousStart, production.previousEnd),
          unavailableReason:
            production.status === "ok"
              ? null
              : production.status === "partial"
                ? `storico ${previousYear} incompleto: ${production.daysCovered}/${production.daysExpected} giorni dell’intervallo`
                : `storico ${previousYear} non disponibile per l’intervallo`,
          zeroNote:
            production.closedDays > 0
              ? `Chiusura dichiarata ${previousYear} valorizzata a 0: ${production.closedDays} giorni.`
              : null,
        });
      }
    } else if (sdlyIsFullYear) {
      // Stessa regola della Vista d'insieme: mese con dato reale -> dato
      // reale; mese senza dato ma chiuso per intero da una chiusura
      // dichiarata -> 0; altrimenti mancante e nessun totale annuale.
      const { result: annual, closedMonths } = aggregateMonthlyAsofWithClosures(
        (sdlyAnnualRes ?? []).map((res) => ((res.data as MonthAsofRow[] | null) || [])[0] ?? null),
        Array.from({ length: 12 }, (_, i) => i + 1),
        Number(sdlyStart.slice(0, 4)),
        (closuresRes.data as ClosureRange[] | null) || []
      );
      setSdlyAnnualCoverage({ covered: annual.monthsCovered, expected: annual.monthsExpected, closedMonths });
      setSdlyAsofAgg(annual.agg ?? EMPTY_KPI_AGG);
    }
    if (sdlyMode === "otb_asof") {
      setSdlyInfo({
        mode: sdlyMode,
        currentAgg: null,
        actualDetail: sdlyObservation.observationDate
          ? `snapshot del ${formatDateIt(sdlyObservation.observationDate)}`
          : null,
        referenceDetail: `al ${formatDateIt(sdlyCutoff)}`,
        unavailableReason: null,
        zeroNote: null,
      });
    }
    if (sdlyMode === "production" || sdlyIsFullYear) {
      // Produzione maturata e OTB as-of annuale: gia' risolti sopra.
    } else if (sdlyIsFullMonth) {
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
    // In modalita' Anno le righe arrivano da loadMetrics (vedi sopra).
    if (accessState !== "granted" || periodKind(periodStart, periodEnd) === "year") return;
    if (monthlyData?.year === detailYear) return;
    void loadMonthlyPerformance(detailYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessState, detailYear, periodStart, periodEnd]);

  // Massimo 2 letture annuali di v_snapshot_latest (<= 366 righe ciascuna
  // per una sola struttura: sotto il limite PostgREST di 1.000, nessuna
  // paginazione necessaria) + una fn_month_snapshot_asof per ciascun mese
  // interamente futuro con dato. Mai il pattern 12+12 di loadYearlyDetail.
  async function loadMonthlyPerformance(
    year: number,
    preloaded?: { currentRows: MonthlySnapshotRow[]; previousRows: MonthlySnapshotRow[] }
  ) {
    monthlyYearRef.current = year;

    let currentRows = preloaded?.currentRows;
    let previousRows = preloaded?.previousRows;

    if (!currentRows || !previousRows) {
      const columns = "stay_date, extraction_date, revenue_total, rooms_sold, rooms_available, arrivals, presences";
      const yearRows = (y: number) =>
        supabase
          .from("v_snapshot_latest")
          .select(columns)
          .eq("structure_id", structureId)
          .gte("stay_date", `${y}-01-01`)
          .lte("stay_date", `${y}-12-31`);
      const [currentRes, previousRes] = await Promise.all([yearRows(year), yearRows(year - 1)]);

      if (currentRes.error || previousRes.error) {
        setLoadError((currentRes.error || previousRes.error)!.message);
        return;
      }
      currentRows = (currentRes.data as unknown as MonthlySnapshotRow[] | null) || [];
      previousRows = (previousRes.data as unknown as MonthlySnapshotRow[] | null) || [];
    }

    const asofResults = await Promise.all(
      monthlyAsofRequests(year, todayString(), currentRows).map(async ({ month, cutoff }) => {
        const res = await supabase.rpc("fn_month_snapshot_asof", {
          p_structure_ids: [structureId],
          p_period_year: year - 1,
          p_period_month: month,
          p_cutoff_date: cutoff,
        });
        return { month, row: ((res.data as MonthAsofRow[] | null) || [])[0] ?? null, error: res.error };
      })
    );

    const asofError = asofResults.find((r) => r.error)?.error;
    if (asofError) {
      setLoadError(asofError.message);
      return;
    }
    if (monthlyYearRef.current !== year) return;

    setMonthlyData({
      year,
      currentRows,
      previousRows,
      asofByMonth: new Map(asofResults.map((r) => [r.month, r.row])),
    });
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

  // Vista Mensile "tutto l'anno": stessa fonte canonica di ogni altro punto
  // di Performance, mai una query diretta su performance_daily_snapshot -
  // un'unica implementazione (fn_month_snapshot_asof), non due che
  // potrebbero divergere di nuovo in futuro (vedi fix daily-priority in
  // 20260817110000_fix_fn_month_snapshot_asof_daily_priority.sql).
  //
  // Pickup mensile reale: fn_month_snapshot_asof resta invariata, il
  // pickup si costruisce sopra con due chiamate a cutoff diversi (ultima e
  // penultima estrazione disponibile per la struttura, via
  // fn_available_extractions - 20260817120000). Nessuna nuova logica di
  // aggregazione lato client: la differenza e' tra due valori gia'
  // calcolati dalla stessa RPC canonica.
  async function loadYearlyDetail() {
    setYearlyDetailLoading(true);

    const { data: extractionsData, error: extractionsError } = await supabase.rpc("fn_available_extractions", {
      p_structure_id: structureId,
    });

    if (extractionsError) {
      setLoadError(extractionsError.message);
      setYearlyDetailLoading(false);
      return;
    }

    const extractions = ((extractionsData || []) as { extraction_date: string }[]).map((r) => r.extraction_date);
    const latestExtraction = extractions[0] ?? null;
    const previousExtraction = extractions[1] ?? null;
    const cutoffCurrent = latestExtraction ?? todayString();

    const months = Array.from({ length: 12 }, (_, i) => i + 1);

    const [currentResults, previousResults] = await Promise.all([
      Promise.all(
        months.map((month) =>
          supabase.rpc("fn_month_snapshot_asof", {
            p_structure_ids: [structureId],
            p_period_year: detailYear,
            p_period_month: month,
            p_cutoff_date: cutoffCurrent,
          })
        )
      ),
      previousExtraction
        ? Promise.all(
            months.map((month) =>
              supabase.rpc("fn_month_snapshot_asof", {
                p_structure_ids: [structureId],
                p_period_year: detailYear,
                p_period_month: month,
                p_cutoff_date: previousExtraction,
              })
            )
          )
        : Promise.resolve(null),
    ]);

    const firstError =
      currentResults.find((r) => r.error)?.error || previousResults?.find((r) => r.error)?.error;
    if (firstError) {
      setLoadError(firstError.message);
      setYearlyDetailLoading(false);
      return;
    }

    const rows: DetailRow[] = currentResults.map((res, i) => {
      const month = i + 1;
      const key = `${detailYear}-${pad(month)}`;
      const label = `${MONTH_LABELS[month - 1]} ${detailYear}`;
      const row = res.data && res.data[0];

      if (!row) {
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

      const revenue = Number(row.revenue_total);
      const roomsSold = Number(row.rooms_sold);
      const roomsAvailable = Number(row.rooms_available);

      const previousRow = previousResults ? previousResults[i]?.data?.[0] : null;
      const pickupRooms = previousRow ? roomsSold - Number(previousRow.rooms_sold) : null;
      const pickupRevenue = previousRow ? revenue - Number(previousRow.revenue_total) : null;
      const pickupTooltip = !previousExtraction
        ? "Pickup non disponibile (prima estrazione per questa struttura)"
        : !previousRow
        ? "Pickup non disponibile per questo mese (nessun dato all'estrazione precedente)"
        : `vs estrazione del ${formatDateIt(previousExtraction)}`;

      return {
        key,
        label,
        revenue,
        adr: adr(revenue, roomsSold),
        revPar: revPar(revenue, roomsAvailable),
        occupancy: occupancy(roomsSold, roomsAvailable),
        roomsSold,
        roomsAvailable,
        pickupRooms,
        pickupRevenue,
        pickupTooltip,
        hasData: true,
      };
    });

    setYearlyDetailRows(rows);
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
  // Lato corrente delle card KPI: nel tab SDLY di un periodo gia' iniziato
  // e' la sola produzione maturata (stesso intervallo del riferimento);
  // negli altri casi resta l'intero periodo selezionato.
  const kpiCurrentAgg: KpiAgg =
    comparisonTab === "sdly" && sdlyInfo.mode === "production" && sdlyInfo.currentAgg ? sdlyInfo.currentAgg : periodAgg;
  const directShareCurrent = useMemo(() => directShareOf(channelRevenue), [channelRevenue]);
  const directShareSdly = useMemo(() => directShareOf(channelRevenueSdly), [channelRevenueSdly]);

  // Budget widget: stesso periodo del selettore (periodAgg per il reale,
  // periodBudget per i livelli) - null finche' il budget del periodo attivo
  // non e' stato caricato, mai quello di un periodo precedente.
  const periodBudget =
    periodBudgetView && periodBudgetView.start === periodStart && periodBudgetView.end === periodEnd
      ? periodBudgetView.budget
      : null;
  const periodBudgets = useMemo(() => periodBudget?.budgets ?? [], [periodBudget]);
  const periodPacing = useMemo(
    () => computePacingStatus(periodAgg.revenue, periodBudgets),
    [periodAgg.revenue, periodBudgets]
  );
  const periodPacingDetail = useMemo(() => {
    const minimoBudget = periodBudgets.find((b) => b.level === "minimo");
    return pacingDetail(periodAgg.revenue, minimoBudget ? Number(minimoBudget.revenue_target) : null);
  }, [periodAgg.revenue, periodBudgets]);

  // null finche' i dati dell'anno visualizzato non sono caricati: mai le
  // righe di un altro anno durante il reload.
  const monthlyPerformance = useMemo(() => {
    if (!monthlyData || monthlyData.year !== detailYear) return null;
    const input = {
      year: detailYear,
      today: todayString(),
      currentRows: monthlyData.currentRows,
      previousRows: monthlyData.previousRows,
      budgets: monthlyBudgetRows,
      closures: structureClosures,
      asofByMonth: monthlyData.asofByMonth,
    };
    const rows = buildMonthlyPerformance(input);
    return { rows, total: buildMonthlyPerformanceTotal(input, rows) };
  }, [monthlyData, detailYear, monthlyBudgetRows, structureClosures]);

  const displayedDetailRows = useMemo(
    () =>
      detailGranularity === "month"
        ? yearlyDetailRows || []
        : buildDetailRows(dailyDetailRows || [], detailGranularity),
    [dailyDetailRows, yearlyDetailRows, detailGranularity]
  );

  const budgetSubtitleParts: string[] = [];
  if (periodBudget) {
    budgetSubtitleParts.push(
      periodAgg.daysWithData > 0
        ? `${periodAgg.daysWithData}/${periodBudget.daysInPeriod} giorni con dati (parziale se il periodo non è concluso o mancano import)`
        : "Nessun dato importato per questo periodo"
    );
    if (periodBudget.monthsWithBudget < periodBudget.monthsInPeriod) {
      budgetSubtitleParts.push(
        `budget presente per ${periodBudget.monthsWithBudget}/${periodBudget.monthsInPeriod} mesi del periodo`
      );
    }
    if (periodBudget.prorated) budgetSubtitleParts.push("budget dei mesi parziali ripartito pro-rata giorni");
  }

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
        description="Confronto vs stesso periodo anno precedente — SDLY (a parità di anticipo) o Consuntivo finale, a scelta — e periodo selezionato vs budget. 'ND' indica che non esiste ancora un dato importato — mai un valore pari a zero."
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
          subtitle={
            periodMode === "intervallo"
              ? "Clicca una data per l'inizio, un'altra per la fine. Clicca due volte la stessa data per un giorno singolo."
              : periodMode === "mese"
                ? "Il periodo copre automaticamente dal primo all'ultimo giorno del mese scelto."
                : "Il periodo copre automaticamente dal 1 gennaio al 31 dicembre dell'anno scelto."
          }
        >
          <div className="mb-3 flex gap-1 rounded-[10px] bg-[#f0ece6] p-1">
            {(
              [
                { key: "intervallo", label: "Intervallo" },
                { key: "mese", label: "Mese" },
                { key: "anno", label: "Anno" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => switchPeriodMode(opt.key)}
                className={`flex-1 rounded-[8px] py-1.5 text-[12px] font-semibold transition ${
                  periodMode === opt.key
                    ? "bg-white text-[#017A92] shadow-sm"
                    : "text-[#6a6d70] hover:text-[#2B2D2F]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {periodMode === "intervallo" && (
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
          )}

          {periodMode === "mese" && (
            <div className="flex flex-wrap gap-3">
              <div>
                <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                  Mese
                </label>
                <select
                  value={selectedMonth}
                  onChange={(e) => {
                    const m = Number(e.target.value);
                    setSelectedMonth(m);
                    applyMonthSelection(selectedYear, m);
                  }}
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
                  onChange={(e) => {
                    const y = Number(e.target.value);
                    setSelectedYear(y);
                    applyMonthSelection(y, selectedMonth);
                  }}
                  className="h-11 rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 text-sm text-[#2B2D2F] outline-none transition focus:border-[#017A92] focus:bg-white"
                >
                  {YEAR_OPTIONS.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>

              {(selectedYear !== TODAY_YEAR || selectedMonth !== TODAY_MONTH) && (
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedYear(TODAY_YEAR);
                      setSelectedMonth(TODAY_MONTH);
                      applyMonthSelection(TODAY_YEAR, TODAY_MONTH);
                    }}
                    className="h-11 rounded-[14px] border border-[#e7dfd8] bg-white px-4 text-sm font-medium text-[#017A92] hover:bg-[#f3f8fa]"
                  >
                    Mese corrente
                  </button>
                </div>
              )}
            </div>
          )}

          {periodMode === "anno" && (
            <div className="flex flex-wrap gap-3">
              <div>
                <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                  Anno
                </label>
                <select
                  value={selectedYear}
                  onChange={(e) => {
                    const y = Number(e.target.value);
                    setSelectedYear(y);
                    applyYearSelection(y);
                  }}
                  className="h-11 rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 text-sm text-[#2B2D2F] outline-none transition focus:border-[#017A92] focus:bg-white"
                >
                  {YEAR_OPTIONS.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>

              {selectedYear !== TODAY_YEAR && (
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedYear(TODAY_YEAR);
                      applyYearSelection(TODAY_YEAR);
                    }}
                    className="h-11 rounded-[14px] border border-[#e7dfd8] bg-white px-4 text-sm font-medium text-[#017A92] hover:bg-[#f3f8fa]"
                  >
                    Anno corrente
                  </button>
                </div>
              )}
            </div>
          )}

          <p className="mt-3 text-[11px] leading-4 text-[#017A92]">
            Intervallo selezionato: {confirmedStart} → {confirmedEnd}
          </p>

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

                {comparisonTab === "sdly" && (
                  <p className="mb-4 text-sm text-[#6a6d70]">
                    {sdlyInfo.mode === "production"
                      ? `Produzione vs SDLY: produzione maturata${
                          sdlyInfo.actualDetail ? ` ${sdlyInfo.actualDetail}` : ""
                        } confrontata con lo stesso intervallo dell’anno precedente${
                          sdlyInfo.referenceDetail ? ` (${sdlyInfo.referenceDetail})` : ""
                        }. La parte futura del periodo non entra nel confronto.`
                      : `OTB vs SDLY: OTB del periodo osservato alla data corrente${
                          sdlyInfo.actualDetail ? ` (${sdlyInfo.actualDetail})` : ""
                        } confrontato con l’OTB dello stesso periodo osservato alla stessa data dell’anno precedente${
                          sdlyInfo.referenceDetail ? ` (${sdlyInfo.referenceDetail})` : ""
                        }.`}
                    {sdlyInfo.zeroNote ? ` ${sdlyInfo.zeroNote}` : ""}
                  </p>
                )}

                {comparisonTab === "sdly" &&
                  sdlyInfo.mode === "production" &&
                  comparisonAgg.revenue === null &&
                  comparisonAgg.roomsSold === null && (
                    <p className="mb-4 text-sm text-[#6a6d70]">
                      {ND} — confronto non disponibile
                      {sdlyInfo.unavailableReason ? `: ${sdlyInfo.unavailableReason}` : ""}. Un giorno senza dati vale 0
                      solo se coperto da una chiusura registrata nel Budget.
                    </p>
                  )}

                {comparisonTab === "sdly" &&
                  sdlyInfo.mode === "otb_asof" &&
                  comparisonAgg.revenue === null &&
                  comparisonAgg.roomsSold === null && (
                    <p className="mb-4 text-sm text-[#6a6d70]">
                      {sdlyAnnualCoverage && sdlyAnnualCoverage.covered > 0
                        ? `${ND} — copertura parziale per ${sdlyLabel} al cutoff a parità di anticipo (${formatDateIt(
                            sdlyCutoffUsed
                          )}): ${sdlyAnnualCoverage.covered}/${sdlyAnnualCoverage.expected} mesi disponibili, nessun totale annuale mostrato. Un mese senza dati vale 0 solo se coperto per intero da una chiusura registrata nel Budget.`
                        : `${ND} — nessun dato disponibile per ${sdlyLabel} al cutoff a parità di anticipo (${formatDateIt(
                            sdlyCutoffUsed
                          )}).`}
                    </p>
                  )}

                {comparisonTab === "sdly" &&
                  comparisonAgg.revenue !== null &&
                  sdlyAnnualCoverage &&
                  sdlyAnnualCoverage.closedMonths.length > 0 && (
                    <p className="mb-4 text-sm text-[#6a6d70]">
                      SDLY al cutoff {formatDateIt(sdlyCutoffUsed)} · chiusura stagionale valorizzata a 0:{" "}
                      {sdlyAnnualCoverage.closedMonths.map((m) => MONTH_LABELS[m - 1]).join(", ")}.
                    </p>
                  )}

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                  <KpiCard
                    label="Revenue"
                    current={formatCurrency(kpiCurrentAgg.revenue)}
                    currentRaw={kpiCurrentAgg.revenue}
                    comparison={formatCurrency(comparisonAgg.revenue)}
                    comparisonRaw={comparisonAgg.revenue}
                    comparisonLabel={comparisonLabel}
                  />
                  <KpiCard
                    label="Occupazione"
                    current={formatPercent(occupancy(kpiCurrentAgg.roomsSold, kpiCurrentAgg.roomsAvailable))}
                    currentRaw={occupancy(kpiCurrentAgg.roomsSold, kpiCurrentAgg.roomsAvailable)}
                    comparison={formatPercent(occupancy(comparisonAgg.roomsSold, comparisonAgg.roomsAvailable))}
                    comparisonRaw={occupancy(comparisonAgg.roomsSold, comparisonAgg.roomsAvailable)}
                    comparisonLabel={comparisonLabel}
                  />
                  <KpiCard
                    label="Arrivi"
                    current={formatNumber(kpiCurrentAgg.arrivals)}
                    currentRaw={kpiCurrentAgg.arrivals}
                    comparison={formatNumber(comparisonAgg.arrivals)}
                    comparisonRaw={comparisonAgg.arrivals}
                    comparisonLabel={comparisonLabel}
                  />
                  <KpiCard
                    label="Presenze"
                    current={formatNumber(kpiCurrentAgg.presences)}
                    currentRaw={kpiCurrentAgg.presences}
                    comparison={formatNumber(comparisonAgg.presences)}
                    comparisonRaw={comparisonAgg.presences}
                    comparisonLabel={comparisonLabel}
                  />
                  <KpiCard
                    label="LOS"
                    current={(() => {
                      const value = los(kpiCurrentAgg.roomsSold, kpiCurrentAgg.arrivals);
                      return value !== null ? value.toLocaleString("it-IT", { maximumFractionDigits: 1 }) : ND;
                    })()}
                    currentRaw={los(kpiCurrentAgg.roomsSold, kpiCurrentAgg.arrivals)}
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
            title={periodBudgetTitles[periodKind(periodStart, periodEnd)]}
            subtitle={periodBudget ? budgetSubtitleParts.join(" · ") : "Caricamento budget del periodo…"}
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
                      {periodAgg.daysWithData > 0 ? (
                        <div className="flex items-start gap-2">
                          {periodPacing && (
                            <span
                              className={`mt-1 h-2 w-2 shrink-0 rounded-full ${pacingDotClasses[periodPacing]}`}
                            />
                          )}
                          <div>
                            <div>{formatCurrency(periodAgg.revenue)}</div>
                            {periodPacingDetail && (
                              <div className="text-[12px] text-[#6a6d70]">{periodPacingDetail}</div>
                            )}
                          </div>
                        </div>
                      ) : (
                        ND
                      )}
                    </td>
                    <td className="py-1.5 text-[#2B2D2F]">
                      {periodAgg.daysWithData > 0
                        ? formatPercent(occupancy(periodAgg.roomsSold, periodAgg.roomsAvailable))
                        : ND}
                    </td>
                  </tr>

                  {["minimo", "realistico", "sfidante"].map((level) => {
                    const budget = periodBudgets.find((b) => b.level === level);

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

      <MonthlyPerformanceTable
        year={detailYear}
        rows={monthlyPerformance?.rows ?? null}
        total={monthlyPerformance?.total ?? null}
      />

      {hasChannelData && (
        <>
          <AppCard
            title="Revenue per canale"
            subtitle={`Fatturato aggregato per canale sul periodo visualizzato (${periodLabel}) — la riga Totale deve coincidere con la somma delle barre`}
            action={
              <div className="flex flex-wrap items-center gap-4">
                {canManage && (
                  <label className="flex items-center gap-2 text-sm text-[#2B2D2F]">
                    <input
                      type="checkbox"
                      checked={showNetChannelRevenue}
                      onChange={(e) => setShowNetChannelRevenue(e.target.checked)}
                    />
                    Mostra netto
                  </label>
                )}
                <label className="flex items-center gap-2 text-sm text-[#2B2D2F]">
                  <input
                    type="checkbox"
                    checked={showChannelSdlyCompare}
                    onChange={(e) => setShowChannelSdlyCompare(e.target.checked)}
                  />
                  Confronta anno precedente
                </label>
              </div>
            }
          >
            <ChannelRevenueBars
              data={channelRevenue}
              commissionRates={channelCommissionRates}
              commissionRatesLy={channelCommissionRatesLy}
              showNet={showNetChannelRevenue}
              compareData={channelRevenueSdly}
              showCompare={showChannelSdlyCompare}
              currentYearLabel={periodStart.slice(0, 4)}
              compareYearLabel={sdlyDate(periodStart).slice(0, 4)}
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
                          <CellTooltip trigger={<span className="text-[#2B2D2F]">{ND}</span>}>{row.pickupTooltip}</CellTooltip>
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
                          <CellTooltip trigger={<span className="text-[#2B2D2F]">{ND}</span>}>{row.pickupTooltip}</CellTooltip>
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

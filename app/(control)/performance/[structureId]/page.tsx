"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { use as usePromise } from "react";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { AppCard } from "@/components/ui/AppCard";
import { AppDialog } from "@/components/ui/AppDialog";
import { AppTable, AppTableCell, AppTableRow } from "@/components/ui/AppTable";
import { AppComparisonTone } from "@/components/ui/AppComparisonValue";
import { AppMetricCard } from "@/components/ui/AppMetricCard";
import { AppSegmentedControl } from "@/components/ui/AppSegmentedControl";
import { AppSelect } from "@/components/ui/AppSelect";
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
  periodKind,
} from "@/lib/performance/periodBudget";
import { ClosureRange, MonthAsofRow } from "@/lib/performance/sdlyAnnual";
import { sdlyTargetDate } from "@/lib/performance/sdlyCutoff";
import {
  AsofDailyRow,
  DailyRow,
  resolveSdlyAsOfComparison,
  sdlyAsofPlan,
  SdlyAsOfComparison,
  sdlyPhotoSentence,
  SdlyReferenceSnapshot,
} from "@/lib/performance/sdlyComparison";
import { NationalityBars, NationalityDatum } from "@/components/performance/NationalityBars";
import { MonthlyPerformanceTable } from "@/components/performance/MonthlyPerformanceTable";
import {
  asofKey,
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
  deltaPercent,
  formatDelta,
} from "@/lib/performanceMetrics";

const PERIOD_MODE_OPTIONS = [
  { value: "intervallo", label: "Intervallo" },
  { value: "mese", label: "Mese" },
  { value: "anno", label: "Anno" },
] as const;

function formatLos(value: number | null): string {
  return value !== null ? value.toLocaleString("it-IT", { maximumFractionDigits: 1 }) : ND;
}

// Confronto di una card KPI del periodo: il tono lo decide la pagina (sopra
// il riferimento = positivo), AppMetricCard si limita a mostrarlo.
function kpiComparison(
  currentRaw: number | null,
  comparisonRaw: number | null,
  comparisonText: string,
  note?: string
): { delta: string; tone: AppComparisonTone; reference: string; note?: string } {
  const delta = deltaPercent(currentRaw, comparisonRaw);
  return {
    delta: formatDelta(currentRaw, comparisonRaw).text,
    tone: delta === null || delta === 0 ? "neutral" : delta > 0 ? "positive" : "negative",
    reference: `vs ${comparisonText}`,
    note,
  };
}

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
  { value: "consuntivo", label: "vs Consuntivo LY" },
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
  if (periodKind(start, end) === "year") return `Anno ${start.slice(0, 4)}`;
  if (start === end) return formatDateIt(start);
  return `${formatDateIt(start)} → ${formatDateIt(end)}`;
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
  // da ?anno=YYYY (link da Budget), altrimenti si parte dal mese corrente
  // in modalita' Mese.
  const [periodMode, setPeriodMode] = useState<"intervallo" | "mese" | "anno">(
    annoParam && !Number.isNaN(Number(annoParam)) ? "anno" : "mese"
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

  // Selezione dell'intervallo in un dialog: il calendario lavora su una
  // bozza (draftStart/draftEnd) e il periodo reale cambia solo con Applica.
  // Annulla, ESC e click fuori chiudono e scartano la bozza: modalita',
  // periodo e dati della pagina restano quelli di prima.
  const [intervalDialogOpen, setIntervalDialogOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(initialRange.start);
  const [draftEnd, setDraftEnd] = useState<string | null>(initialRange.end);

  function openIntervalDialog() {
    setDraftStart(confirmedStart);
    setDraftEnd(confirmedEnd);
    setIntervalDialogOpen(true);
  }

  function applyIntervalDraft() {
    if (!draftEnd) return;
    // Stessi stati scritti da Mese/Anno: conferma del periodo e
    // ricaricamento dei dati seguono il flusso di sempre.
    setPeriodMode("intervallo");
    setRangeStart(draftStart);
    setRangeEnd(draftEnd);
    setIntervalDialogOpen(false);
  }

  function switchPeriodMode(mode: "intervallo" | "mese" | "anno") {
    if (mode === "intervallo") {
      // Nessun cambio di modalita' finche' l'intervallo non viene applicato.
      openIntervalDialog();
      return;
    }
    setPeriodMode(mode);
    if (mode === "mese") {
      applyMonthSelection(selectedYear, selectedMonth);
    } else {
      applyYearSelection(selectedYear);
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
  // Tab "SDLY" del periodo caricato: intero periodo nella fotografia
  // corrente vs intero stesso periodo dell'anno precedente nella fotografia
  // alla stessa data (lib/performance/sdlyComparison, unica semantica
  // condivisa con Vista d'insieme e Performance mensile). null = non ancora
  // caricato.
  const [sdlyInfo, setSdlyInfo] = useState<SdlyAsOfComparison | null>(null);
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
    observationDate: string | null;
    asof: Map<string, MonthAsofRow | null>;
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

    // Data di osservazione UNICA dell'analisi: l'ultima estrazione della
    // struttura (stessa funzione di "Dati aggiornati al"), non la data
    // delle sole righe del periodo - ogni periodo e ogni mese della stessa
    // struttura si confrontano con la stessa data target dell'anno prima.
    const [periodRes, observationRes] = await Promise.all([
      supabase
        .from("v_snapshot_latest")
        .select(snapshotColumns)
        .eq("structure_id", structureId)
        .gte("stay_date", periodStart)
        .lte("stay_date", periodEnd),
      supabase.rpc("fn_latest_extraction_per_structure", { p_structure_ids: [structureId] }),
    ]);
    if (observationRes.error) setLoadError(observationRes.error.message);
    // Senza data di osservazione nessun confronto SDLY (ND), mai "oggi".
    const sdlyObservationDate: string | null =
      (observationRes.data as { extraction_date: string | null }[] | null)?.[0]?.extraction_date ?? null;

    // Tab "SDLY": intero periodo nella fotografia corrente contro l'intero
    // stesso periodo dell'anno precedente nella fotografia disponibile alla
    // stessa data relativa (data di osservazione - 1 anno, ultima estrazione
    // non successiva) - per QUALSIASI periodo: passato, in corso o futuro.
    // Periodo fatto
    // di mesi interi (mese, anno, piu' mesi): fn_month_snapshot_asof per
    // ciascun mese, unica fonte per lo storico caricato a granularita'
    // mensile; ogni altro intervallo: fn_snapshot_asof, che dove lo storico
    // giornaliero non ha fotografie a quella data torna ND, onestamente.
    const sdlyTarget = sdlyObservationDate ? sdlyTargetDate(sdlyObservationDate) : null;
    const sdlyPlan = sdlyAsofPlan(periodStart, periodEnd);
    const sdlyIsFullYear = periodKind(periodStart, periodEnd) === "year";
    const sdlyReferencePromise = (async (): Promise<{
      reference: SdlyReferenceSnapshot | null;
      error: string | null;
    }> => {
      if (!sdlyTarget) return { reference: null, error: null };
      if (sdlyPlan.kind === "months") {
        const results = await Promise.all(
          sdlyPlan.months.map((m) =>
            supabase.rpc("fn_month_snapshot_asof", {
              p_structure_ids: [structureId],
              p_period_year: m.year,
              p_period_month: m.month,
              p_cutoff_date: sdlyTarget,
            })
          )
        );
        return {
          reference: {
            kind: "months",
            rows: results.map((res) => ((res.data as MonthAsofRow[] | null) || [])[0] ?? null),
          },
          error: results.find((res) => res.error)?.error?.message ?? null,
        };
      }
      const res = await supabase.rpc("fn_snapshot_asof", {
        p_structure_ids: [structureId],
        p_stay_date_start: sdlyPlan.lyStart,
        p_stay_date_end: sdlyPlan.lyEnd,
        p_cutoff_date: sdlyTarget,
      });
      return {
        reference: { kind: "days", rows: (res.data as AsofDailyRow[] | null) || [] },
        error: res.error?.message ?? null,
      };
    })();

    const [
      closuresRes,
      sdlyRes,
      sdlyReferenceRes,
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
      sdlyReferencePromise,
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
    if (sdlyReferenceRes.error) setLoadError(sdlyReferenceRes.error);
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
      // Stesso cutoff annuale: le 12 fotografie LY appena lette servono
      // anche alla riga Totale anno (e alle righe mese con la stessa data).
      const annualAsof = new Map<string, MonthAsofRow | null>();
      if (sdlyTarget && sdlyReferenceRes.reference?.kind === "months" && !sdlyReferenceRes.error) {
        sdlyReferenceRes.reference.rows.forEach((row, i) => annualAsof.set(asofKey(i + 1, sdlyTarget), row ?? null));
      }
      void loadMonthlyPerformance(Number(periodStart.slice(0, 4)), {
        currentRows: (periodRes.data as unknown as MonthlySnapshotRow[] | null) || [],
        previousRows: (sdlyRes.data as unknown as MonthlySnapshotRow[] | null) || [],
        observationDate: sdlyObservationDate,
        asof: annualAsof,
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

    const sdly = resolveSdlyAsOfComparison({
      periodStart,
      periodEnd,
      currentRows: (periodRes.data as unknown as DailyRow[] | null) || [],
      observationDate: sdlyObservationDate,
      reference: sdlyReferenceRes.reference,
      closures: (closuresRes.data as ClosureRange[] | null) || [],
    });
    setSdlyAsofAgg(sdly.reference ?? EMPTY_KPI_AGG);
    setSdlyInfo(sdly);

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
  // paginazione necessaria) + le 12 fotografie LY dei mesi, tutte alla
  // stessa data target (fn_month_snapshot_asof, vedi monthlyAsofRequests),
  // escluse quelle gia' lette da loadMetrics in modalita' Anno.
  async function loadMonthlyPerformance(
    year: number,
    preloaded?: {
      currentRows: MonthlySnapshotRow[];
      previousRows: MonthlySnapshotRow[];
      observationDate: string | null;
      asof: Map<string, MonthAsofRow | null>;
    }
  ) {
    monthlyYearRef.current = year;

    let currentRows = preloaded?.currentRows;
    let previousRows = preloaded?.previousRows;
    // Data di osservazione unica della struttura, la stessa di loadMetrics.
    let observationDate = preloaded?.observationDate ?? null;

    if (!currentRows || !previousRows) {
      const columns = "stay_date, extraction_date, revenue_total, rooms_sold, rooms_available, arrivals, presences";
      const yearRows = (y: number) =>
        supabase
          .from("v_snapshot_latest")
          .select(columns)
          .eq("structure_id", structureId)
          .gte("stay_date", `${y}-01-01`)
          .lte("stay_date", `${y}-12-31`);
      const [currentRes, previousRes, observationRes] = await Promise.all([
        yearRows(year),
        yearRows(year - 1),
        supabase.rpc("fn_latest_extraction_per_structure", { p_structure_ids: [structureId] }),
      ]);

      if (currentRes.error || previousRes.error || observationRes.error) {
        setLoadError((currentRes.error || previousRes.error || observationRes.error)!.message);
        return;
      }
      observationDate =
        (observationRes.data as { extraction_date: string | null }[] | null)?.[0]?.extraction_date ?? null;
      currentRows = (currentRes.data as unknown as MonthlySnapshotRow[] | null) || [];
      previousRows = (previousRes.data as unknown as MonthlySnapshotRow[] | null) || [];
    }

    const asof = new Map(preloaded?.asof ?? []);
    const asofResults = await Promise.all(
      monthlyAsofRequests(observationDate)
        .filter(({ month, cutoff }) => !asof.has(asofKey(month, cutoff)))
        .map(async ({ month, cutoff }) => {
          const res = await supabase.rpc("fn_month_snapshot_asof", {
            p_structure_ids: [structureId],
            p_period_year: year - 1,
            p_period_month: month,
            p_cutoff_date: cutoff,
          });
          return { month, cutoff, row: ((res.data as MonthAsofRow[] | null) || [])[0] ?? null, error: res.error };
        })
    );

    const asofError = asofResults.find((r) => r.error)?.error;
    if (asofError) {
      setLoadError(asofError.message);
      return;
    }
    if (monthlyYearRef.current !== year) return;

    asofResults.forEach((r) => asof.set(asofKey(r.month, r.cutoff), r.row));
    setMonthlyData({ year, currentRows, previousRows, observationDate, asof });
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
  // Tab SDLY: sulle card la data target della fotografia LY (il lato
  // corrente e' sempre l'intero periodo nella fotografia corrente).
  const kpiComparisonNote =
    comparisonTab === "sdly" && sdlyInfo?.status === "ok" && sdlyInfo.targetDate
      ? `as-of ${formatDateIt(sdlyInfo.targetDate)}`
      : undefined;
  // Testo di contesto sopra le card: dice quale base temporale e quale lato
  // LY sta leggendo l'utente nel confronto attivo. Solo copy, nessun calcolo.
  const previousYearLabel = sdlyDate(periodStart).slice(0, 4);
  const sdlyScope =
    periodKind(periodStart, periodEnd) === "year" ? "year" : isFullMonth(periodStart, periodEnd) ? "month" : "period";
  const kpiContext =
    comparisonTab === "consuntivo"
      ? periodKind(periodStart, periodEnd) === "year"
        ? `Intero anno · confronto con il consuntivo finale ${previousYearLabel}`
        : `Intero periodo · confronto con il consuntivo finale di ${formatPeriodLabel(
            sdlyDate(periodStart),
            sdlyDate(periodEnd)
          )}`
      : sdlyInfo?.observationDate
        ? `OTB vs SDLY · ${sdlyPhotoSentence(sdlyInfo, sdlyScope)}`
        : "OTB vs SDLY · intero periodo nella fotografia corrente vs stesso periodo dell’anno precedente nella fotografia alla stessa data.";
  // Lato corrente delle card KPI: sempre l'intero periodo selezionato nella
  // fotografia corrente, per entrambi i confronti.
  const kpiCurrentAgg: KpiAgg = periodAgg;
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
  // Budget Realistico del periodo: lo stesso valore della riga "Realistico"
  // negli Scenari budget, mostrato anche come sesta card KPI.
  const budgetRealistico = periodBudgets.find((b) => b.level === "realistico");

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
      observationDate: monthlyData.observationDate,
      asof: monthlyData.asof,
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
    <div className="space-y-3">
      <PageHeader variant="prominent" eyebrow="Performance" title={structureName || "Struttura"} description="Dettaglio performance">
        <CellTooltip
          className="inline-flex"
          align="right"
          widthClassName="w-80"
          trigger={
            <span
              aria-label="Come leggere questa pagina"
              className="flex h-5 w-5 items-center justify-center rounded-full border border-[#c7bfb6] text-[10px] font-bold text-[#6b625c] hover:border-[#017A92] hover:text-[#017A92]"
            >
              i
            </span>
          }
        >
          <span className="block">
            <span className="font-semibold">SDLY.</span> Confronta l’intero periodo nella fotografia corrente con lo
            stesso periodo dell’anno precedente nella fotografia disponibile alla stessa data dell’anno precedente
            (ultima estrazione non successiva a quella data). Vale per ogni periodo: passato, in corso o futuro. ND se
            quella fotografia non esiste.
          </span>
          <span className="mt-1 block">
            <span className="font-semibold">Consuntivo LY.</span> Confronta l’intero periodo corrente con il risultato
            finale dello stesso periodo dell’anno precedente.
          </span>
          <span className="mt-1 block">ND indica dato non disponibile, mai zero.</span>
        </CellTooltip>
        <p className="text-[12px] text-mc-text-secondary">
          Dati aggiornati al{" "}
          <span className="font-semibold text-mc-text">
            {lastAdrRevparUpdate ? formatDateIt(lastAdrRevparUpdate) : ND}
          </span>
        </p>
        <Link href="/performance" className="text-[13px] font-medium text-teal hover:underline">
          ← Vista d&apos;insieme
        </Link>
      </PageHeader>

      <div className="space-y-3">
        {/* Control bar del periodo: non e' una sezione di contenuto, quindi
            niente card - una barra bassa con fondo leggero. */}
        <div className="rounded-[8px] border border-mc-border bg-mc-surface-subtle px-2.5 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <AppSegmentedControl
            ariaLabel="Tipo di periodo"
            options={PERIOD_MODE_OPTIONS}
            value={periodMode}
            onChange={switchPeriodMode}
          />

          {periodMode === "mese" && (
            <div className="flex flex-wrap items-center gap-3">
              <AppSelect
                label="Mese"
                value={selectedMonth}
                onChange={(e) => {
                  const m = Number(e.target.value);
                  setSelectedMonth(m);
                  applyMonthSelection(selectedYear, m);
                }}
              >
                {MONTH_LABELS.map((label, i) => (
                  <option key={label} value={i + 1}>
                    {label}
                  </option>
                ))}
              </AppSelect>

              <AppSelect
                label="Anno"
                value={selectedYear}
                onChange={(e) => {
                  const y = Number(e.target.value);
                  setSelectedYear(y);
                  applyMonthSelection(y, selectedMonth);
                }}
              >
                {YEAR_OPTIONS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </AppSelect>

              {(selectedYear !== TODAY_YEAR || selectedMonth !== TODAY_MONTH) && (
                <button
                  type="button"
                  className="h-[34px] rounded-[7px] px-2.5 text-[13px] font-medium text-teal transition hover:bg-mc-surface-muted"
                  onClick={() => {
                    setSelectedYear(TODAY_YEAR);
                    setSelectedMonth(TODAY_MONTH);
                    applyMonthSelection(TODAY_YEAR, TODAY_MONTH);
                  }}
                >
                  Mese corrente
                </button>
              )}
            </div>
          )}

          {periodMode === "anno" && (
            <div className="flex flex-wrap items-center gap-3">
              <AppSelect
                label="Anno"
                value={selectedYear}
                onChange={(e) => {
                  const y = Number(e.target.value);
                  setSelectedYear(y);
                  applyYearSelection(y);
                }}
              >
                {YEAR_OPTIONS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </AppSelect>

              {selectedYear !== TODAY_YEAR && (
                <button
                  type="button"
                  className="h-[34px] rounded-[7px] px-2.5 text-[13px] font-medium text-teal transition hover:bg-mc-surface-muted"
                  onClick={() => {
                    setSelectedYear(TODAY_YEAR);
                    applyYearSelection(TODAY_YEAR);
                  }}
                >
                  Anno corrente
                </button>
              )}
            </div>
          )}

          {periodMode === "intervallo" && (
            <button
              type="button"
              onClick={openIntervalDialog}
              aria-label="Modifica intervallo"
              className="flex h-[34px] items-center gap-2 rounded-[7px] border border-mc-border bg-mc-surface px-2.5 text-[13px] text-mc-text-secondary transition hover:border-teal"
            >
              <CalendarDays className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span>
                Periodo:{" "}
                <span className="font-semibold text-mc-text">
                  {formatDateIt(confirmedStart)} → {formatDateIt(confirmedEnd)}
                </span>
              </span>
            </button>
          )}
          </div>

          <AppDialog
            open={intervalDialogOpen}
            onOpenChange={setIntervalDialogOpen}
            title="Seleziona intervallo"
            description="Clicca una data per l’inizio, un’altra per la fine. Clicca due volte la stessa data per un giorno singolo."
            widthClassName="sm:max-w-[340px]"
            secondaryAction={{ label: "Annulla", onClick: () => setIntervalDialogOpen(false) }}
            primaryAction={{ label: "Applica", onClick: applyIntervalDraft, disabled: !draftEnd }}
          >
            <Calendar
              embedded
              value={draftStart}
              onChange={() => {}}
              highlightedDates={highlightedDates}
              anomalyDates={anomalyDates}
              rangeMode
              rangeStart={draftStart}
              rangeEnd={draftEnd}
              onRangeChange={(start, end) => {
                setDraftStart(start ?? draftStart);
                setDraftEnd(end);
              }}
            />
          </AppDialog>

          {loadError && <p className="mt-2 text-[13px] text-mc-negative">{loadError}</p>}
        </div>

        <div className="space-y-3">
          <section>
            <div className="mb-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
              <div>
                <h2 className="text-[16px] font-semibold leading-tight text-mc-text">{periodLabel}</h2>
                <p className="mt-0.5 text-[12px] leading-4 text-mc-text-secondary">
                  {kpiContext}
                </p>
              </div>
              <AppSegmentedControl
                variant="pills"
                ariaLabel="Confronto"
                options={COMPARISON_TAB_OPTIONS}
                value={comparisonTab}
                onChange={setComparisonTab}
              />
            </div>

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

                {comparisonTab === "sdly" && sdlyInfo?.zeroNote && (
                  <p className="mb-2 text-[12px] leading-4 text-mc-text-tertiary">{sdlyInfo.zeroNote}</p>
                )}

                {comparisonTab === "sdly" && sdlyInfo?.status === "ok" && sdlyInfo.referenceExtraction && (
                  <p className="mb-2 text-[12px] leading-4 text-mc-text-tertiary">
                    Fotografia {previousYearLabel} usata:{" "}
                    {sdlyInfo.referenceExtraction.from === sdlyInfo.referenceExtraction.to
                      ? `estrazione del ${formatDateIt(sdlyInfo.referenceExtraction.to)}`
                      : `estrazioni dal ${formatDateIt(sdlyInfo.referenceExtraction.from)} al ${formatDateIt(
                          sdlyInfo.referenceExtraction.to
                        )}`}
                    .
                  </p>
                )}

                {comparisonTab === "sdly" && sdlyInfo && sdlyInfo.status !== "ok" && (
                  <p className="mb-2 text-[12px] leading-4 text-mc-text-tertiary">
                    {ND} — confronto SDLY non disponibile
                    {sdlyInfo.unavailableReason ? `: ${sdlyInfo.unavailableReason}` : ""}. Serve una fotografia dello
                    stesso periodo non successiva alla stessa data dell’anno precedente; un mese o un giorno senza
                    fotografia vale 0 solo se coperto per intero da una chiusura registrata nel Budget. Il confronto con
                    il consuntivo finale resta disponibile nell’altro tab.
                  </p>
                )}

                <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
                  <AppMetricCard
                    label="Revenue"
                    value={formatCurrency(kpiCurrentAgg.revenue)}
                    comparison={kpiComparison(
                      kpiCurrentAgg.revenue,
                      comparisonAgg.revenue,
                      formatCurrency(comparisonAgg.revenue),
                      kpiComparisonNote
                    )}
                  />
                  <AppMetricCard
                    label="Occupazione"
                    value={formatPercent(occupancy(kpiCurrentAgg.roomsSold, kpiCurrentAgg.roomsAvailable))}
                    comparison={kpiComparison(
                      occupancy(kpiCurrentAgg.roomsSold, kpiCurrentAgg.roomsAvailable),
                      occupancy(comparisonAgg.roomsSold, comparisonAgg.roomsAvailable),
                      formatPercent(occupancy(comparisonAgg.roomsSold, comparisonAgg.roomsAvailable)),
                      kpiComparisonNote
                    )}
                  />
                  <AppMetricCard
                    label="Arrivi"
                    value={formatNumber(kpiCurrentAgg.arrivals)}
                    comparison={kpiComparison(
                      kpiCurrentAgg.arrivals,
                      comparisonAgg.arrivals,
                      formatNumber(comparisonAgg.arrivals),
                      kpiComparisonNote
                    )}
                  />
                  <AppMetricCard
                    label="Presenze"
                    value={formatNumber(kpiCurrentAgg.presences)}
                    comparison={kpiComparison(
                      kpiCurrentAgg.presences,
                      comparisonAgg.presences,
                      formatNumber(comparisonAgg.presences),
                      kpiComparisonNote
                    )}
                  />
                  <AppMetricCard
                    label="LOS"
                    value={formatLos(los(kpiCurrentAgg.roomsSold, kpiCurrentAgg.arrivals))}
                    comparison={kpiComparison(
                      los(kpiCurrentAgg.roomsSold, kpiCurrentAgg.arrivals),
                      los(comparisonAgg.roomsSold, comparisonAgg.arrivals),
                      formatLos(los(comparisonAgg.roomsSold, comparisonAgg.arrivals)),
                      kpiComparisonNote
                    )}
                  />
                  <AppMetricCard
                    label="Budget Realistico"
                    value={budgetRealistico ? formatCurrency(Number(budgetRealistico.revenue_target)) : ND}
                  />
                </div>
              </>
            )}
          </section>

          {/* Pannello di supporto: i valori principali sono gia' nelle card KPI,
              qui restano i tre scenari come riferimento. Piu' basso e fitto
              delle sezioni primarie ("!" = eccezione locale al padding
              standard della card e delle celle, senza toccare le primitive). */}
          <AppCard density="compact" className="!py-2.5">
            <div className="mb-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <h2 className="text-[13px] font-semibold leading-5 text-mc-text">Scenari budget</h2>
              <p className="text-[11.5px] leading-4 text-mc-text-secondary">
                {periodBudget ? budgetSubtitleParts.join(" · ") : "Caricamento budget del periodo…"}
              </p>
            </div>
            <AppTable minWidthClassName="min-w-[320px]">
              <thead>
                <AppTableRow state="header" className="text-[11.5px]">
                  <AppTableCell className="!py-1">Scenario</AppTableCell>
                  <AppTableCell numeric className="!py-1">
                    Revenue
                  </AppTableCell>
                  <AppTableCell numeric className="!py-1">
                    Occupazione
                  </AppTableCell>
                </AppTableRow>
              </thead>
              <tbody>
                {["minimo", "realistico", "sfidante"].map((level) => {
                  const budget = periodBudgets.find((b) => b.level === level);

                  return (
                    <AppTableRow key={level} className="text-[12px] text-mc-text-secondary last:border-0">
                      <AppTableCell className="!py-0.5">{budgetLevelLabels[level]}</AppTableCell>
                      <AppTableCell numeric className="!py-0.5">
                        {budget ? formatCurrency(Number(budget.revenue_target)) : ND}
                      </AppTableCell>
                      <AppTableCell numeric className="!py-0.5">
                        {budget ? formatPercent(Number(budget.occupancy_pct_target)) : ND}
                      </AppTableCell>
                    </AppTableRow>
                  );
                })}
              </tbody>
            </AppTable>
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
            density="compact"
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
            density="compact"
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
          density="compact"
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
        density="compact"
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
            className="flex h-[34px] items-center gap-2 rounded-[7px] border border-mc-border bg-mc-surface px-3 text-[13px] font-medium text-teal transition hover:bg-mc-surface-subtle"
          >
            {dailyDetailOpen ? "Nascondi dettaglio giornaliero ▲" : "Mostra dettaglio giornaliero ▾"}
          </button>

          {dailyDetailOpen && (
            <AppSegmentedControl
              variant="pills"
              ariaLabel="Granularità del dettaglio"
              options={DETAIL_GRANULARITY_OPTIONS}
              value={detailGranularity}
              onChange={setDetailGranularity}
            />
          )}
        </div>

        {/* overflow-y-hidden: i tooltip nascosti dell'ultima riga allungavano l'area
            scrollabile e l'intestazione poteva scorrere via sotto i controlli;
            pb-12 lascia loro lo spazio per aprirsi senza essere tagliati. */}
        {dailyDetailOpen && (
          <div className="mt-3 overflow-x-auto overflow-y-hidden border-t border-mc-border-subtle pb-12 pt-3">
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

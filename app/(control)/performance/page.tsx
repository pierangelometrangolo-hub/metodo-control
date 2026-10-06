"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { AppCard } from "@/components/ui/AppCard";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { CellTooltip } from "@/components/ui/CellTooltip";
import { Calendar, MONTH_LABELS } from "@/components/performance/Calendar";
import { supabase } from "@/lib/supabaseClient";
import { canViewModule } from "@/lib/permissions";
import {
  ND,
  SnapshotRow,
  BudgetRow,
  todayString,
  sdlyDate,
  monthRange,
  pad,
  formatCurrency,
  formatCurrencyCents,
  formatSignedCurrency,
  formatPercent,
  formatNumber,
  formatDelta,
  occupancy,
  adr,
  revPar,
  computeGoalProgress,
  DailyCapacityRow,
  GoalProgress,
  goalLevelLabels,
  computePacingStatus,
  pacingLabels,
  pacingDotClasses,
  pacingDetail,
  sumSnapshots,
} from "@/lib/performanceMetrics";
import { aggregatePortfolioPerformance, PortfolioComparison } from "@/lib/performance/portfolio";
import { aggregateBudgetRows } from "@/lib/performance/periodBudget";
import { aggregateMonthlyAsofWithClosures, ClosureRange, MonthAsofRow } from "@/lib/performance/sdlyAnnual";
import { groupStructuresBySdlyCutoff, observationDateByStructure } from "@/lib/performance/sdlyCutoff";
import {
  computeLikeForLike,
  LikeForLikeComparison,
  likeForLikeReasonLabels,
  PortfolioMembership,
} from "@/lib/performance/likeForLike";

type StructureOption = {
  id: string;
  name: string;
};

// PostgREST tronca silenziosamente ogni risposta oltre le 1.000 righe (il
// suo limite di default) se non si passa un .range() esplicito - nessun
// errore, solo meno righe di quelle che soddisfano il filtro. Con una query
// multi-struttura su un range di date ampio ("Tutto l'anno": fino a 366
// giorni x N strutture) questo limite si supera facilmente: bug verificato
// il 12/08/2026 su Sangiorgio Resort, gen-ago 2026 - 1.120 righe reali,
// risposta troncata a 1.000, somma di appena 8.514 EUR contro i 212.947 EUR
// veri (le strutture il cui structure_id ordina alfabeticamente dopo
// restano fuori dalle prime 1.000). Paginazione reale con .range() invece
// di un limite piu' alto ma comunque fisso: nessun numero massimo di
// giorni/strutture da ricalcolare a mano quando lo storico cresce.
//
// .order() esplicito e deterministico e' indispensabile per la
// paginazione stessa: senza un ordinamento stabile, pagine successive di
// .range() potrebbero saltare o ripetere righe tra una chiamata e l'altra.
const SNAPSHOT_PAGE_SIZE = 1000;

type SnapshotRowWithStructure = SnapshotRow & { structure_id: string; extraction_date: string | null };

async function fetchAllSnapshotRows(
  start: string,
  end: string,
  ids: string[],
  columns: string
): Promise<{ data: SnapshotRowWithStructure[]; error: { message: string } | null }> {
  const allRows: SnapshotRowWithStructure[] = [];
  let from = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from("v_snapshot_latest")
      .select(columns)
      .gte("stay_date", start)
      .lte("stay_date", end)
      .in("structure_id", ids)
      .order("structure_id", { ascending: true })
      .order("stay_date", { ascending: true })
      .range(from, from + SNAPSHOT_PAGE_SIZE - 1);

    if (error) return { data: allRows, error };

    allRows.push(...((data as unknown as SnapshotRowWithStructure[]) || []));

    if (!data || data.length < SNAPSHOT_PAGE_SIZE) break;
    from += SNAPSHOT_PAGE_SIZE;
  }

  return { data: allRows, error: null };
}

type StructureRowData = {
  structure: StructureOption;
  monthRevenue: number | null;
  monthRoomsSold: number | null;
  monthRoomsAvailable: number | null;
  sdlyMonthRevenue: number | null;
  // Data di osservazione dell'OTB corrente (extraction_date piu' recente
  // tra le righe del periodo) e cutoff SDLY che ne deriva (- 1 anno); mesi
  // dell'anno precedente coperti a quel cutoff sui mesi attesi.
  observationDate: string | null;
  sdlyCutoff: string | null;
  sdlyMonthsCovered: number;
  sdlyMonthsExpected: number;
  // Mesi dell'anno precedente senza snapshot valorizzati a 0 perche'
  // interamente coperti da una chiusura dichiarata (structure_closures).
  sdlyClosedMonths: number[];
  lastYearMonthRevenue: number | null;
  budgetsForMonth: BudgetRow[];
  pacing: ReturnType<typeof computePacingStatus>;
  // Righe giornaliere del periodo + suoi estremi, per la capacita' residua
  // di RN/ADR TO GOAL (vedi computeGoalProgress).
  dailyCapacity: DailyCapacityRow[];
  periodStart: string;
  periodEnd: string;
};

// "YYYY-MM-DD" -> "DD/MM/YYYY" senza passare da Date (eviterebbe scarti di
// fuso orario sulla mezzanotte UTC).
function formatDateIt(dateStr: string): string {
  return dateStr.split("-").reverse().join("/");
}

function formatRoomNights(n: number | null): string {
  return n === null ? ND : formatNumber(Math.ceil(n));
}

// Dettaglio comune ai tooltip di RN e ADR TO GOAL: sempre gap, RN teoriche
// e RN realmente disponibili, mai il solo numero teorico.
function GoalTooltipBody({ goal }: { goal: Exclude<GoalProgress, { status: "achieved" }> }) {
  return (
    <>
      <p className="font-semibold">Target: {goalLevelLabels[goal.level]}</p>
      <p>Gap: {formatCurrency(goal.gapRevenue)}</p>
      <p>RN teoriche necessarie: {formatRoomNights(goal.theoreticalRoomsNeeded)}</p>
      <p>
        RN disponibili nel periodo residuo:{" "}
        {goal.status === "insufficient_data" ? "dati insufficienti" : formatRoomNights(goal.remainingRoomNights)}
      </p>
      {goal.status === "pending" && (
        <p className="mt-1">
          ADR medio necessario sulle {formatRoomNights(goal.remainingRoomNights)} room nights ancora disponibili per
          raggiungere il {goalLevelLabels[goal.level]}: {formatCurrency(goal.adrNeeded)}.
        </p>
      )}
      {goal.status === "capacity_exhausted" && (
        <p className="mt-1">Target non più raggiungibile per esaurimento capacità residua.</p>
      )}
      {goal.status === "insufficient_data" && (
        <p className="mt-1">Mancano righe giornaliere nel periodo residuo: capacità non determinabile.</p>
      )}
    </>
  );
}

function GoalCell({ goal, metric }: { goal: GoalProgress | null; metric: "rooms" | "adr" }) {
  if (goal === null) return <>{ND}</>;
  if (goal.status === "achieved") return <span className="text-[#2f7d43]">✓ Raggiunto</span>;

  let trigger: React.ReactNode;
  if (goal.status === "pending") {
    trigger =
      metric === "rooms" ? (
        <span>
          {formatRoomNights(goal.theoreticalRoomsNeeded)} necessarie
          <span className="block text-[12px] text-[#6a6d70]">
            {formatRoomNights(goal.remainingRoomNights)} disponibili
          </span>
        </span>
      ) : (
        formatCurrency(goal.adrNeeded)
      );
  } else if (goal.status === "capacity_exhausted") {
    trigger = <span className="text-[#6a6d70]">{metric === "rooms" ? "Non raggiungibile" : "N/A"}</span>;
  } else {
    trigger = <span className="text-[#6a6d70]">N/A</span>;
  }

  return (
    <CellTooltip trigger={trigger}>
      <GoalTooltipBody goal={goal} />
    </CellTooltip>
  );
}

// Gerarchia comune alle colonne di confronto (OTB vs SDLY, OTB vs
// Consuntivo LY), sia sulle righe struttura sia sul TOTALE METODO: valore
// dell'anno corrente in primo piano, variazione subito sotto, riferimento
// dell'anno precedente piu' piccolo e secondario - mai il contrario.
function ComparisonValue({
  actual,
  reference,
  referenceLabel,
}: {
  actual: number | null;
  reference: number | null;
  referenceLabel: string;
}) {
  const delta = formatDelta(actual, reference);
  return (
    <span className="block">
      <span className="block font-semibold text-[#2B2D2F]">{formatCurrency(actual)}</span>
      <span className={`block ${delta.colorClass}`}>{delta.text}</span>
      <span className="block whitespace-nowrap text-[12px] font-normal text-[#6a6d70]">
        {referenceLabel}: {formatCurrency(reference)}
      </span>
    </span>
  );
}

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
  // Data dell'ultimo upload piu' recente tra tutte le strutture - non una
  // colonna per riga (le strutture hanno date diverse, es. Montecallini
  // aggiornata via export PMS con cadenza propria), ma un'unica
  // riga di sintesi nella descrizione, stesso trattamento per tutte.
  const [latestUploadDate, setLatestUploadDate] = useState<string | null>(null);
  // Membership del portfolio (consulting_engagements) + l'anno selezionato
  // al caricamento, per i confronti like-for-like del TOTALE METODO. null =
  // membership non caricata: nessun confronto L4L mostrato.
  const [portfolioMembership, setPortfolioMembership] = useState<{
    engagements: PortfolioMembership[];
    year: number;
  } | null>(null);

  const isCurrentMonth = selectedYear === TODAY_YEAR && selectedMonth === TODAY_MONTH;
  // selectedMonth === 0 e' il valore sentinella per "Tutto l'anno" (i mesi
  // veri vanno da 1 a 12).
  const isWholeYear = selectedMonth === 0;

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

    // "Tutto l'anno": stesso principio di aggregazione dei mesi, con range
    // piu' ampio - sempre 1 gen - 31 dic, anno corrente incluso. Revenue
    // OTB (On The Books) significa per definizione "gia' prenotato ad
    // oggi", non "gia' soggiornato": include correttamente le date future
    // dell'anno corrente gia' prenotate (es. settembre-dicembre prenotati
    // entro l'estrazione di agosto). Troncare a todayString() escludeva
    // quell'OTB futuro - bug verificato confrontando con i file BD reali
    // (differenza 0,00 EUR su tutte le strutture dopo la rimozione del
    // troncamento, prima sottostima da 35.000 a 165.000 EUR a struttura).
    // Il mese singolo (non "Tutto l'anno") non ha mai avuto questo
    // troncamento: currentMonthRange.end e' gia' sempre fine mese.
    const currentMonthRange = monthRange(`${selectedYear}-${pad(isWholeYear ? 1 : selectedMonth)}-01`);
    const start = isWholeYear ? `${selectedYear}-01-01` : currentMonthRange.start;
    const end = isWholeYear ? `${selectedYear}-12-31` : currentMonthRange.end;

    // Consuntivo anno prec.: sempre il periodo pieno e chiuso dell'anno
    // precedente (a differenza del periodo corrente, un anno passato e'
    // per definizione concluso, non va troncato ad "oggi").
    const lastYearMonthRange = monthRange(`${selectedYear - 1}-${pad(isWholeYear ? 1 : selectedMonth)}-01`);
    const lastYearStart = isWholeYear ? `${selectedYear - 1}-01-01` : lastYearMonthRange.start;
    const lastYearEnd = isWholeYear ? `${selectedYear - 1}-12-31` : lastYearMonthRange.end;

    // Mesi per il confronto SDLY "a parita' di anticipo": 1 solo mese in
    // modalita' mensile, sempre tutti e 12 in "Tutto l'anno" - stesso
    // periodo di soggiorno (1 gen - 31 dic) del Revenue OTB qui sopra,
    // anno corrente incluso: fermarsi al mese di oggi confrontava l'OTB
    // gen-dic con un riferimento gen-ott.
    const sdlyMonthsInScope = isWholeYear ? Array.from({ length: 12 }, (_, i) => i + 1) : [selectedMonth];

    // Mesi per il target di budget: sempre l'intero anno (1-12) in "Tutto
    // l'anno", anche per l'anno corrente - deve coprire lo stesso periodo
    // del Revenue OTB qui sopra (ora sempre 1 gen - 31 dic, l'OTB include
    // le prenotazioni future gia' confermate), altrimenti "OTB vs BUDGET"
    // confronterebbe un OTB dell'intero anno con un target di sole
    // gennaio-agosto - stesso tipo di disallineamento appena corretto sul
    // Revenue OTB, ma sul lato budget del confronto.
    const budgetMonthsInScope = isWholeYear ? Array.from({ length: 12 }, (_, i) => i + 1) : [selectedMonth];

    // Confronto SDLY "a parità di anticipo": non l'OTB dell'ultima estrazione
    // disponibile per il mese dell'anno scorso (sarebbe il consuntivo finale,
    // già coperto dalla colonna "Consuntivo anno prec."), ma l'OTB di quel
    // mese così come si presentava un anno esatto prima della data di
    // osservazione dell'OTB corrente. La data di osservazione e' per
    // struttura (extraction_date piu' recente tra le righe del periodo in
    // v_snapshot_latest), non "oggi": una struttura aggiornata il 30/09 si
    // confronta con cio' che era noto al 30/09 dell'anno prima.
    const snapshotColumns =
      "structure_id, stay_date, extraction_date, revenue_total, rooms_sold, rooms_available, arrivals, presences, status";

    const [monthRes, lastYearMonthRes, budgetsRes, importsRes, lastExtractionRes, membershipRes, closuresRes] = await Promise.all([
      fetchAllSnapshotRows(start, end, ids, snapshotColumns),
      fetchAllSnapshotRows(lastYearStart, lastYearEnd, ids, snapshotColumns),
      supabase
        .from("v_budgets_current")
        .select("structure_id, level, adr, revenue_target, room_nights_sold_target, room_nights_available, occupancy_pct_target")
        .eq("season_year", selectedYear)
        .in("month", budgetMonthsInScope)
        .in("structure_id", ids),
      supabase.from("bd_imports").select("extraction_date").in("structure_id", ids),
      // Data ultimo upload (ADR/RevPAR) per struttura: non dipende dal
      // periodo selezionato, e' una fotografia di freschezza del dato.
      supabase.rpc("fn_latest_extraction_per_structure", { p_structure_ids: ids }),
      // Membership del portfolio per il like-for-like del TOTALE METODO:
      // solo struttura e date dell'engagement, nessun dato economico.
      supabase.from("consulting_engagements").select("structure_id, valid_from, valid_to").in("structure_id", ids),
      // Chiusure dichiarate (stesso registro del Budget): unica fonte per
      // riconoscere un mese di chiusura stagionale nel confronto SDLY.
      supabase.from("structure_closures").select("structure_id, start_date, end_date").in("structure_id", ids),
    ]);

    // Una chiamata per (cutoff distinto, mese): le strutture con la stessa
    // data di osservazione condividono il cutoff. Struttura senza righe nel
    // periodo = nessuna data di osservazione, nessun confronto SDLY.
    const observationDates = observationDateByStructure(monthRes.data || []);
    const sdlyResults = await Promise.all(
      Array.from(groupStructuresBySdlyCutoff(observationDates)).flatMap(([cutoff, structureIds]) =>
        sdlyMonthsInScope.map(async (m) => {
          const res = await supabase.rpc("fn_month_snapshot_asof", {
            p_structure_ids: structureIds,
            p_period_year: selectedYear - 1,
            p_period_month: m,
            p_cutoff_date: cutoff,
          });
          return { month: m, data: res.data as (MonthAsofRow & { structure_id: string })[] | null, error: res.error };
        })
      )
    );

    if (monthRes.error) setLoadError(monthRes.error.message);
    if (lastYearMonthRes.error) setLoadError(lastYearMonthRes.error.message);
    if (budgetsRes.error) setLoadError(budgetsRes.error.message);
    if (importsRes.error) setLoadError(importsRes.error.message);
    if (lastExtractionRes.error) setLoadError(lastExtractionRes.error.message);
    if (membershipRes.error) setLoadError(membershipRes.error.message);
    if (closuresRes.error) setLoadError(closuresRes.error.message);
    sdlyResults.forEach((res) => {
      if (res.error) setLoadError(res.error.message);
    });

    setAllExtractionDates(new Set((importsRes.data || []).map((r) => r.extraction_date as string)));

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

    // fn_month_snapshot_asof restituisce già un totale mensile risolto per
    // struttura (riga performance_monthly_snapshot se disponibile al cutoff,
    // altrimenti somma dei giorni disponibili in performance_daily_snapshot).
    // In modalità "Tutto l'anno" si somma su 12 mesi con la stessa regola
    // del dettaglio struttura (aggregateMonthlyAsof): totale solo con
    // copertura completa, "ND" se manca anche un solo mese - mai una somma
    // parziale presentata come confronto annuale.
    const sdlyMonthsByStructure = new Map<string, Map<number, MonthAsofRow>>();
    sdlyResults.forEach((res) => {
      (res.data || []).forEach((r) => {
        const months = sdlyMonthsByStructure.get(r.structure_id) || new Map<number, MonthAsofRow>();
        months.set(res.month, r);
        sdlyMonthsByStructure.set(r.structure_id, months);
      });
    });

    const closuresByStructure = new Map<string, ClosureRange[]>();
    ((closuresRes.data as (ClosureRange & { structure_id: string })[] | null) || []).forEach((c) => {
      closuresByStructure.set(c.structure_id, [...(closuresByStructure.get(c.structure_id) || []), c]);
    });

    const budgetRowsByStructureLevel = new Map<string, BudgetRow[]>();
    (budgetsRes.data || []).forEach((r) => {
      const key = `${r.structure_id}::${r.level}`;
      const list = budgetRowsByStructureLevel.get(key) || [];
      list.push(r as BudgetRow);
      budgetRowsByStructureLevel.set(key, list);
    });

    const lastExtractionByStructure = new Map<string, string>(
      (lastExtractionRes.data || []).map((r: { structure_id: string; extraction_date: string }) => [
        r.structure_id,
        r.extraction_date,
      ])
    );

    // "YYYY-MM-DD" ordina correttamente anche come stringa, non serve
    // passare da Date per trovare la piu' recente tra le strutture.
    const latestDate = Array.from(lastExtractionByStructure.values()).sort().pop();
    setLatestUploadDate(latestDate ?? null);

    const nextRows: StructureRowData[] = structures.map((structure) => {
      const monthSnapshots = monthByStructure.get(structure.id) || [];
      const monthToDate = sumSnapshots(monthSnapshots);
      const lastYearMonthToDate = sumSnapshots(lastYearMonthByStructure.get(structure.id) || []);
      const observationDate = observationDates.get(structure.id) ?? null;
      // Senza data di osservazione non c'e' confronto: nessun mese viene
      // riempito. Altrimenti un mese senza snapshot vale 0 solo se chiuso
      // per intero da una chiusura dichiarata, mai per sola assenza di dato.
      const { result: sdlyAsof, closedMonths: sdlyClosedMonths } = aggregateMonthlyAsofWithClosures(
        sdlyMonthsInScope.map((m) => sdlyMonthsByStructure.get(structure.id)?.get(m) ?? null),
        sdlyMonthsInScope,
        selectedYear - 1,
        observationDate ? closuresByStructure.get(structure.id) || [] : []
      );

      const budgetsForMonth: BudgetRow[] = ["minimo", "realistico", "sfidante"]
        .map((level) => budgetRowsByStructureLevel.get(`${structure.id}::${level}`))
        .filter((rows): rows is BudgetRow[] => Boolean(rows && rows.length > 0))
        .map((rows) => aggregateBudgetRows(rows));

      return {
        structure,
        monthRevenue: monthToDate.revenue,
        monthRoomsSold: monthToDate.roomsSold,
        monthRoomsAvailable: monthToDate.roomsAvailable,
        sdlyMonthRevenue: sdlyAsof.agg ? sdlyAsof.agg.revenue : null,
        observationDate,
        sdlyCutoff: observationDate ? sdlyDate(observationDate) : null,
        sdlyMonthsCovered: sdlyAsof.monthsCovered,
        sdlyMonthsExpected: sdlyAsof.monthsExpected,
        sdlyClosedMonths,
        lastYearMonthRevenue: lastYearMonthToDate.revenue,
        budgetsForMonth,
        pacing: computePacingStatus(monthToDate.revenue, budgetsForMonth),
        dailyCapacity: monthSnapshots.map((s) => ({
          stayDate: s.stay_date,
          roomsSold: s.rooms_sold === null ? null : Number(s.rooms_sold),
          roomsAvailable: s.rooms_available === null ? null : Number(s.rooms_available),
        })),
        periodStart: start,
        periodEnd: end,
      };
    });

    // Popolazione like-for-like: membership sugli ANNI interi (corrente e
    // precedente), non sul mese visualizzato ne' sulla finestra dati SDLY.
    setPortfolioMembership(
      membershipRes.error
        ? null
        : { engagements: (membershipRes.data as PortfolioMembership[]) || [], year: selectedYear }
    );
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

  const periodLabel = isWholeYear ? `${selectedYear}` : `${MONTH_LABELS[selectedMonth - 1]} ${selectedYear}`;
  const lastYearPeriodLabel = isWholeYear
    ? `${selectedYear - 1}`
    : `${MONTH_LABELS[selectedMonth - 1]} ${selectedYear - 1}`;

  // TOTALE METODO: aggregato dalle stesse righe gia' mostrate sopra (stesso
  // periodo, stesso snapshot per struttura), nessuna query aggiuntiva.
  const portfolio = aggregatePortfolioPerformance(rows, { hasLoadError: loadError !== "" });
  const portfolioOf = `${portfolio.totalStructures}`;
  // LY e SDLY del totale: like-for-like sulla membership del portfolio nei
  // due anni confrontati (non sulla presenza di dati storici). Stessa
  // popolazione per LY e SDLY; i dati restano quelli del periodo scelto.
  // Budget resta sul confronto per presenza dato: e' nello stesso anno.
  const l4lInputs = (pickReference: (row: StructureRowData) => number | null) =>
    rows.map((row) => ({
      id: row.structure.id,
      name: row.structure.name,
      actual: row.monthRevenue,
      reference: pickReference(row),
    }));
  const l4lLastYear = portfolioMembership
    ? computeLikeForLike(
        l4lInputs((row) => row.lastYearMonthRevenue),
        portfolioMembership.engagements,
        portfolioMembership.year,
        portfolioMembership.year - 1
      )
    : null;
  const l4lSdly = portfolioMembership
    ? computeLikeForLike(
        l4lInputs((row) => row.sdlyMonthRevenue),
        portfolioMembership.engagements,
        portfolioMembership.year,
        portfolioMembership.year - 1
      )
    : null;
  const portfolioCoverageParts = [
    `Budget ${portfolio.budget.minimo?.coverage ?? 0}/${portfolioOf}`,
    `L4L LY ${l4lLastYear?.included.length ?? 0}/${portfolioOf}`,
    `L4L SDLY ${l4lSdly?.included.length ?? 0}/${portfolioOf}`,
  ];
  // "su x/y" sotto il valore solo se il confronto copre meno strutture del
  // totale: a colpo d'occhio si vede che il riferimento non e' 6/6.
  const portfolioCoverageNote = (coverage: number, prefix = "") =>
    coverage < portfolio.totalStructures ? (
      <p className="mt-0.5 text-[11px] font-normal text-[#6a6d70]">
        {prefix}su {coverage}/{portfolioOf}
      </p>
    ) : null;

  // Testi dei due confronti con l'anno precedente, condivisi da
  // intestazioni, righe struttura e TOTALE METODO: stessa definizione
  // ovunque, declinata sul periodo selezionato (mese o intero anno).
  const sdlyComparison = {
    title: "OTB vs stesso momento dello scorso anno",
    intro: isWholeYear
      ? `Confronta l’OTB dell’intero ${selectedYear} osservato alla data dello snapshot corrente con l’OTB dell’intero ${selectedYear - 1} osservato alla stessa data dell’anno precedente.`
      : `Confronta l’OTB di ${periodLabel} osservato alla data dello snapshot corrente con l’OTB di ${lastYearPeriodLabel} osservato alla stessa data dell’anno precedente.`,
    actualLabel: `OTB ${periodLabel} alla data osservata`,
    referenceLabel: `OTB ${lastYearPeriodLabel} alla stessa data`,
  };
  const consuntivoComparison = {
    title: `OTB ${periodLabel} completo vs consuntivo finale ${lastYearPeriodLabel}`,
    intro: isWholeYear
      ? `Confronta l’OTB complessivo dell’anno ${selectedYear} con il consuntivo finale chiuso del ${selectedYear - 1}.`
      : `Confronta l’OTB complessivo di ${periodLabel} con il consuntivo finale chiuso di ${lastYearPeriodLabel}.`,
    actualLabel: `OTB completo ${periodLabel}`,
    referenceLabel: `Consuntivo finale ${lastYearPeriodLabel}`,
  };
  // Motivo di esclusione specifico dello SDLY: storico dell'anno precedente
  // presente ma incompleto al cutoff (es. 7/12 mesi) - piu' esplicito del
  // generico "dato di confronto non disponibile".
  const sdlyPartialCoverageReason = (structureId: string) => {
    const row = rows.find((r) => r.structure.id === structureId);
    return row && row.sdlyMonthRevenue === null && row.sdlyMonthsCovered > 0
      ? `storico SDLY incompleto: ${row.sdlyMonthsCovered}/${row.sdlyMonthsExpected} mesi`
      : null;
  };
  const likeForLikeDetail = (
    l4l: LikeForLikeComparison,
    comparison: { title: string; intro: string; actualLabel: string; referenceLabel: string },
    reasonOverride?: (structureId: string) => string | null
  ) => (
    <>
      <p className="font-semibold">{comparison.title}</p>
      <p>
        {comparison.intro} Il totale considera solo le strutture presenti nel portafoglio Metodo in entrambi gli
        anni.
      </p>
      <p className="mt-1">
        Strutture incluse ({l4l.included.length}/{l4l.total}):{" "}
        {l4l.included.length > 0 ? l4l.included.map((s) => s.name).join(", ") : "nessuna"}
      </p>
      {/* Escluse raggruppate per motivo: il tooltip cresce per motivo, non
          per struttura, e resta dentro la tabella anche con piu' esclusioni. */}
      {Array.from(
        l4l.excluded.reduce((groups, s) => {
          const reason =
            (s.reasons.includes("missing_reference_data") ? reasonOverride?.(s.id) : null) ??
            s.reasons.map((r) => likeForLikeReasonLabels[r]).join(" e ");
          groups.set(reason, [...(groups.get(reason) || []), s.name]);
          return groups;
        }, new Map<string, string[]>())
      ).map(([reason, names]) => (
        <p key={reason} className="mt-1">
          Strutture escluse ({reason}): {names.join(", ")}
        </p>
      ))}
      {l4l.actual !== null && l4l.reference !== null && (
        <>
          <p className="mt-1">
            {comparison.actualLabel}: {formatCurrency(l4l.actual)}
          </p>
          <p>
            {comparison.referenceLabel}: {formatCurrency(l4l.reference)}
          </p>
          <p className="mt-1">Differenza: {formatSignedCurrency(l4l.actual - l4l.reference)}</p>
          <p>Variazione: {formatDelta(l4l.actual, l4l.reference).text}</p>
        </>
      )}
    </>
  );
  const portfolioBudgetCell = (comparison: PortfolioComparison | null, label: string) =>
    comparison ? (
      <>
        <CellTooltip placement="top" align="right" trigger={<span>{formatCurrency(comparison.reference)}</span>}>
          <p>
            Budget {label}: somma su {comparison.coverage}/{portfolioOf} strutture con OTB e budget
          </p>
          <p>OTB stesse strutture: {formatCurrency(comparison.actual)}</p>
          <p>Variazione: {formatDelta(comparison.actual, comparison.reference).text}</p>
        </CellTooltip>
        {portfolioCoverageNote(comparison.coverage)}
      </>
    ) : (
      ND
    );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Performance"
        title="Dashboard Performance"
        description="Stato commerciale mensile di tutte le strutture, con ritmo verso il budget del mese e confronto SDLY a parità di anticipo. Seleziona un mese diverso per rivedere periodi passati o futuri."
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
          <Link href="/performance/import" className="text-sm font-medium text-[#017A92] hover:underline">
            Vai ad Aggiornamenti Performance (import) →
          </Link>
          <Link href="/performance/budget" className="text-sm font-medium text-[#017A92] hover:underline">
            Vai a Budget →
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
                <option value={0}>Tutto l'anno</option>
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
                  value={`${selectedYear}-${pad(isWholeYear ? 1 : selectedMonth)}-01`}
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
        subtitle={`Dati riferiti a ${periodLabel}${isCurrentMonth ? " (mese corrente)" : ""} — clicca una riga per il dettaglio giornaliero e il pickup. Ultimo upload: ${
          latestUploadDate ? formatDateIt(latestUploadDate) : ND
        }`}
      >
        {loadError && <p className="mb-3 text-sm text-[#8a3a3a]">{loadError}</p>}

        {loading ? (
          <p className="text-sm text-[#6a6d70]">Caricamento...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1700px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#e7dfd8] text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                  <th className="pb-3 pr-4">Struttura</th>
                  <th className="pb-3 pr-4">
                    Revenue OTB ({isWholeYear ? "anno" : "mese"})
                    <InfoTooltip
                      text={
                        isWholeYear
                          ? "Somma del revenue on-the-books di tutti i giorni dell'anno selezionato (fino ad oggi se l'anno è quello corrente) per cui esiste un dato importato. Valore parziale se l'anno non è concluso o mancano import."
                          : "Somma del revenue on-the-books di tutti i giorni del mese selezionato per cui esiste un dato importato. Valore parziale se il mese non è concluso o mancano import."
                      }
                    />
                  </th>
                  <th className="pb-3 pr-4">
                    OTB vs BUDGET
                    <InfoTooltip text="Confronta il Revenue OTB del mese selezionato con i tre livelli di budget dello stesso mese: rosso sotto Minimo, giallo tra Minimo e Realistico, verde sopra Realistico. Passa il mouse (o tocca) sulla riga per il dettaglio in euro dal Budget Minimo." />
                  </th>
                  <th className="pb-3 pr-4">
                    OTB vs SDLY
                    <InfoTooltip
                      text={`${sdlyComparison.intro} La data di osservazione è quella dell’ultimo snapshot di ciascuna struttura. 'ND' quando lo storico dell’anno precedente non copre l’intero periodo a quella data (nessuna somma parziale). Passa il mouse (o tocca) sulla riga per i valori assoluti.`}
                    />
                  </th>
                  <th className="pb-3 pr-4">
                    OTB vs Consuntivo LY
                    <InfoTooltip
                      text={`${consuntivoComparison.intro} 'ND' quando manca lo storico per quel periodo. Passa il mouse (o tocca) sulla riga per i valori assoluti.`}
                    />
                  </th>
                  <th className="pb-3 pr-4">
                    ADR
                    <InfoTooltip text="Tariffa media mensile: somma revenue del mese selezionato diviso somma camere vendute nello stesso mese." />
                  </th>
                  <th className="pb-3 pr-4">
                    RevPAR
                    <InfoTooltip text="Revenue per camera disponibile nel mese: somma revenue del mese selezionato diviso somma camere disponibili nello stesso mese." />
                  </th>
                  <th className="pb-3 pr-4">
                    Occupazione
                    <InfoTooltip text="Somma camere vendute diviso somma camere disponibili sull'intero mese selezionato — numeratore e denominatore coprono sempre lo stesso periodo." />
                  </th>
                  <th className="pb-3 pr-4">
                    RN TO GOAL
                    <InfoTooltip text="Target progressivo: Minimo, poi Realistico, poi Sfidante (il primo non ancora raggiunto in revenue). RN necessarie = (% Occupazione target × Room night disponibili del livello) − Room night già vendute; RN disponibili = camere ancora vendibili (disponibili − vendute) da oggi incluso a fine periodo. 'Non raggiungibile' solo se non resta nessuna camera vendibile; 'N/A' se mancano dati giornalieri; '✓ Raggiunto' se anche lo Sfidante è superato." />
                  </th>
                  <th className="pb-3 pr-4">
                    ADR TO GOAL
                    <InfoTooltip text="ADR medio necessario sulle room night ancora disponibili per raggiungere il target progressivo: (Target − Revenue OTB) / RN disponibili da oggi a fine periodo. 'N/A' se non resta nessuna camera vendibile o se mancano dati giornalieri." />
                  </th>
                  <th className="pb-3 pr-4">
                    Min.
                    <InfoTooltip text="Budget Minimo — revenue target dello scenario Minimo per il mese selezionato, da v_budgets_current." />
                  </th>
                  <th className="pb-3 pr-4">
                    Real.
                    <InfoTooltip text="Budget Realistico — revenue target dello scenario Realistico per il mese selezionato, da v_budgets_current." />
                  </th>
                  <th className="pb-3">
                    Sfid.
                    <InfoTooltip text="Budget Sfidante — revenue target dello scenario Sfidante per il mese selezionato, da v_budgets_current." />
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const monthAdr = adr(row.monthRevenue, row.monthRoomsSold);
                  const monthRevPar = revPar(row.monthRevenue, row.monthRoomsAvailable);
                  const monthOcc = occupancy(row.monthRoomsSold, row.monthRoomsAvailable);

                  const minimoBudget = row.budgetsForMonth.find((b) => b.level === "minimo");
                  const minimoTarget = minimoBudget ? Number(minimoBudget.revenue_target) : null;
                  const detail = pacingDetail(row.monthRevenue, minimoTarget);

                  const sdlyDelta = formatDelta(row.monthRevenue, row.sdlyMonthRevenue);
                  const lastYearDelta = formatDelta(row.monthRevenue, row.lastYearMonthRevenue);
                  const goal = computeGoalProgress({
                    monthRevenue: row.monthRevenue,
                    roomsSold: row.monthRoomsSold,
                    budgets: row.budgetsForMonth,
                    dailyRows: row.dailyCapacity,
                    periodStart: row.periodStart,
                    periodEnd: row.periodEnd,
                    today: todayString(),
                  });

                  return (
                    <tr
                      key={row.structure.id}
                      onClick={() => router.push(`/performance/${row.structure.id}`)}
                      className="cursor-pointer border-b border-[#f0ece6] transition last:border-0 hover:bg-[#f8f6f2]"
                    >
                      <td className="py-3 pr-4 font-semibold text-[#2B2D2F]">{row.structure.name}</td>

                      <td className="py-3 pr-4 text-[#2B2D2F]">
                        {row.monthRevenue !== null ? formatCurrencyCents(row.monthRevenue) : ND}
                      </td>

                      <td className="py-3 pr-4">
                        {row.pacing ? (
                          <CellTooltip
                            trigger={
                              <div className="flex items-center gap-2">
                                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${pacingDotClasses[row.pacing]}`} />
                                <span className="text-[#2B2D2F]">{pacingLabels[row.pacing]}</span>
                              </div>
                            }
                          >
                            {detail || "Nessun dettaglio disponibile."}
                          </CellTooltip>
                        ) : (
                          <span className="text-[#6a6d70]">{ND}</span>
                        )}
                      </td>

                      <td className="py-3 pr-4">
                        {row.sdlyMonthRevenue !== null ? (
                          <CellTooltip
                            widthClassName="w-80"
                            trigger={
                              <ComparisonValue
                                actual={row.monthRevenue}
                                reference={row.sdlyMonthRevenue}
                                referenceLabel={`vs ${sdlyComparison.referenceLabel}`}
                              />
                            }
                          >
                            <p className="font-semibold">{sdlyComparison.title}</p>
                            <p>{sdlyComparison.intro}</p>
                            <p className="mt-1">
                              {sdlyComparison.actualLabel}
                              {row.observationDate ? ` (${formatDateIt(row.observationDate)})` : ""}:{" "}
                              {formatCurrency(row.monthRevenue)}
                            </p>
                            <p>
                              {sdlyComparison.referenceLabel}
                              {row.sdlyCutoff ? ` (${formatDateIt(row.sdlyCutoff)})` : ""}:{" "}
                              {formatCurrency(row.sdlyMonthRevenue)}
                            </p>
                            <p className="mt-1">
                              Differenza:{" "}
                              {formatSignedCurrency(
                                row.monthRevenue !== null ? row.monthRevenue - row.sdlyMonthRevenue : null
                              )}
                            </p>
                            <p>Variazione: {sdlyDelta.text}</p>
                            {row.sdlyClosedMonths.length > 0 && (
                              <p className="mt-1">
                                Chiusura stagionale {selectedYear - 1} valorizzata a 0:{" "}
                                {row.sdlyClosedMonths.map((m) => MONTH_LABELS[m - 1]).join(", ")}.
                              </p>
                            )}
                          </CellTooltip>
                        ) : row.sdlyMonthsCovered > 0 ? (
                          <CellTooltip trigger={<span className="text-[#6a6d70]">{ND}</span>}>
                            Copertura parziale per {lastYearPeriodLabel}
                            {row.sdlyCutoff ? ` al ${formatDateIt(row.sdlyCutoff)}` : ""}: {row.sdlyMonthsCovered}/
                            {row.sdlyMonthsExpected} mesi disponibili, nessun totale annuale mostrato. Un mese senza
                            dati vale 0 solo se coperto per intero da una chiusura registrata nel Budget.
                          </CellTooltip>
                        ) : (
                          <span className="text-[#6a6d70]">{ND}</span>
                        )}
                      </td>

                      <td className="py-3 pr-4">
                        {row.lastYearMonthRevenue !== null ? (
                          <CellTooltip
                            widthClassName="w-80"
                            trigger={
                              <ComparisonValue
                                actual={row.monthRevenue}
                                reference={row.lastYearMonthRevenue}
                                referenceLabel={`vs Consuntivo ${lastYearPeriodLabel}`}
                              />
                            }
                          >
                            <p className="font-semibold">{consuntivoComparison.title}</p>
                            <p>{consuntivoComparison.intro}</p>
                            <p className="mt-1">
                              {consuntivoComparison.actualLabel}: {formatCurrency(row.monthRevenue)}
                            </p>
                            <p>
                              {consuntivoComparison.referenceLabel}: {formatCurrency(row.lastYearMonthRevenue)}
                            </p>
                            <p className="mt-1">
                              Differenza:{" "}
                              {formatSignedCurrency(
                                row.monthRevenue !== null ? row.monthRevenue - row.lastYearMonthRevenue : null
                              )}
                            </p>
                            <p>Variazione: {lastYearDelta.text}</p>
                          </CellTooltip>
                        ) : (
                          <span className="text-[#6a6d70]">{ND}</span>
                        )}
                      </td>

                      <td className="py-3 pr-4 text-[#2B2D2F]">{formatCurrency(monthAdr)}</td>
                      <td className="py-3 pr-4 text-[#2B2D2F]">{formatCurrency(monthRevPar)}</td>
                      <td className="py-3 pr-4 text-[#2B2D2F]">{formatPercent(monthOcc)}</td>

                      <td className="py-3 pr-4 text-[#2B2D2F]">
                        <GoalCell goal={goal} metric="rooms" />
                      </td>

                      <td className="py-3 pr-4 text-[#2B2D2F]">
                        <GoalCell goal={goal} metric="adr" />
                      </td>

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
              {portfolio.totalStructures > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-[#e7dfd8] bg-[#f8f6f2] font-semibold text-[#2B2D2F]">
                    <td className="py-3 pr-4 align-top">
                      <p className="uppercase tracking-[0.08em]">TOTALE METODO</p>
                      <p className="mt-1 whitespace-nowrap text-[11px] font-normal text-[#6a6d70]">
                        {portfolio.includedStructures}/{portfolioOf} strutture con dati
                      </p>
                      <p className="whitespace-nowrap text-[11px] font-normal text-[#6a6d70]">
                        {portfolioCoverageParts.join(" · ")}
                      </p>
                      {portfolio.partial && (
                        <p className="text-[11px] font-normal text-[#8a3a3a]">Dati parziali</p>
                      )}
                    </td>

                    <td className="py-3 pr-4 align-top">
                      {portfolio.revenue !== null ? formatCurrencyCents(portfolio.revenue) : ND}
                    </td>

                    <td className="py-3 pr-4 align-top">
                      {portfolio.pacing ? (
                        <CellTooltip
                          placement="top"
                          trigger={
                            <div className="flex items-center gap-2">
                              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${pacingDotClasses[portfolio.pacing]}`} />
                              <span>{pacingLabels[portfolio.pacing]}</span>
                            </div>
                          }
                        >
                          <p>
                            Calcolato su {portfolio.pacingCoverage}/{portfolioOf} strutture con OTB e budget Minimo e
                            Realistico.
                          </p>
                          {portfolio.budget.minimo && (
                            <>
                              <p className="mt-1">
                                {pacingDetail(portfolio.budget.minimo.actual, portfolio.budget.minimo.reference)} (
                                {portfolio.budget.minimo.coverage}/{portfolioOf} strutture)
                              </p>
                              <p>
                                Variazione vs Minimo:{" "}
                                {formatDelta(portfolio.budget.minimo.actual, portfolio.budget.minimo.reference).text}
                              </p>
                            </>
                          )}
                        </CellTooltip>
                      ) : (
                        <span className="text-[#6a6d70]">{ND}</span>
                      )}
                    </td>

                    {[
                      {
                        l4l: l4lSdly,
                        comparison: sdlyComparison,
                        referenceLabel: `vs ${sdlyComparison.referenceLabel}`,
                        reasonOverride: sdlyPartialCoverageReason,
                      },
                      {
                        l4l: l4lLastYear,
                        comparison: consuntivoComparison,
                        referenceLabel: `vs Consuntivo ${lastYearPeriodLabel}`,
                        reasonOverride: undefined,
                      },
                    ].map(({ l4l, comparison, referenceLabel, reasonOverride }) => (
                      <td key={comparison.title} className="py-3 pr-4 align-top">
                        {l4l ? (
                          <>
                            <CellTooltip
                              placement="top"
                              widthClassName="w-80"
                              trigger={
                                l4l.actual !== null && l4l.reference !== null ? (
                                  <ComparisonValue
                                    actual={l4l.actual}
                                    reference={l4l.reference}
                                    referenceLabel={referenceLabel}
                                  />
                                ) : (
                                  <span className="text-[#6a6d70]">{ND}</span>
                                )
                              }
                            >
                              {likeForLikeDetail(l4l, comparison, reasonOverride)}
                            </CellTooltip>
                            {portfolioCoverageNote(l4l.included.length, "L4L ")}
                          </>
                        ) : (
                          <span className="text-[#6a6d70]">{ND}</span>
                        )}
                      </td>
                    ))}

                    <td className="py-3 pr-4 align-top">{formatCurrency(portfolio.adr)}</td>
                    <td className="py-3 pr-4 align-top">{formatCurrency(portfolio.revpar)}</td>
                    <td className="py-3 pr-4 align-top">{formatPercent(portfolio.occupancy)}</td>

                    <td className="py-3 pr-4 align-top text-[#6a6d70]">—</td>
                    <td className="py-3 pr-4 align-top text-[#6a6d70]">—</td>

                    <td className="py-3 pr-4 align-top">{portfolioBudgetCell(portfolio.budget.minimo, "Minimo")}</td>
                    <td className="py-3 pr-4 align-top">{portfolioBudgetCell(portfolio.budget.realistico, "Realistico")}</td>
                    <td className="py-3 align-top">{portfolioBudgetCell(portfolio.budget.sfidante, "Sfidante")}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </AppCard>
    </div>
  );
}

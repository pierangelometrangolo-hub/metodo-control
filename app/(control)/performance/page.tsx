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
  computeGoalGap,
  GoalGap,
  computePacingStatus,
  pacingLabels,
  pacingDotClasses,
  pacingDetail,
  sumSnapshots,
} from "@/lib/performanceMetrics";

type StructureOption = {
  id: string;
  name: string;
};

// Aggrega piu' righe budget (una per mese) in un'unica riga equivalente:
// revenue_target e room_nights_available si sommano, occupancy_pct_target
// diventa una media pesata sulle camere disponibili di ciascun mese, cosi'
// che (occupancy_pct_target x room_nights_available) ricostruisca la somma
// corretta delle camere-obiettivo mese per mese (non la somma di medie
// slegate, che darebbe un risultato diverso e sbagliato). Su un singolo
// mese (un solo elemento nell'array) restituisce esattamente la riga di
// partenza: stessa funzione usata per la modalita' "Tutto l'anno" e per
// quella mensile, senza bisogno di due percorsi di calcolo separati.
function aggregateBudgetRows(rows: BudgetRow[]): BudgetRow {
  const revenue_target = rows.reduce((sum, r) => sum + Number(r.revenue_target), 0);
  const room_nights_available = rows.reduce((sum, r) => sum + Number(r.room_nights_available), 0);
  const room_nights_sold_target = rows.reduce((sum, r) => sum + Number(r.room_nights_sold_target), 0);
  const targetRoomsSoldSum = rows.reduce(
    (sum, r) => sum + Number(r.occupancy_pct_target) * Number(r.room_nights_available),
    0
  );
  const avgAdr = rows.length > 0 ? rows.reduce((sum, r) => sum + Number(r.adr), 0) / rows.length : 0;

  return {
    level: rows[0].level,
    adr: avgAdr,
    revenue_target,
    room_nights_sold_target,
    room_nights_available,
    occupancy_pct_target: room_nights_available !== 0 ? targetRoomsSoldSum / room_nights_available : 0,
  };
}

type StructureRowData = {
  structure: StructureOption;
  monthRevenue: number | null;
  monthRoomsSold: number | null;
  monthRoomsAvailable: number | null;
  sdlyMonthRevenue: number | null;
  lastYearMonthRevenue: number | null;
  budgetsForMonth: BudgetRow[];
  pacing: ReturnType<typeof computePacingStatus>;
  lastExtractionDate: string | null;
};

// "YYYY-MM-DD" -> "DD/MM/YYYY" senza passare da Date (eviterebbe scarti di
// fuso orario sulla mezzanotte UTC).
function formatDateIt(dateStr: string): string {
  return dateStr.split("-").reverse().join("/");
}

function GoalCell({ goal, render }: { goal: GoalGap | null; render: (g: GoalGap) => string }) {
  if (goal === null) return <>{ND}</>;
  if (goal.status === "achieved") return <span className="text-[#2f7d43]">✓ Raggiunto</span>;
  if (goal.status === "sold_out") return <span className="text-[#6a6d70]">Esaurito</span>;
  return <>{render(goal)}</>;
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
    // piu' ampio. L'anno corrente si ferma ad oggi (non ha senso includere
    // prenotazioni OTB future di mesi non ancora iniziati nell'anno in
    // corso), un anno passato copre invece l'intero 1 gen - 31 dic.
    const currentMonthRange = monthRange(`${selectedYear}-${pad(isWholeYear ? 1 : selectedMonth)}-01`);
    const start = isWholeYear ? `${selectedYear}-01-01` : currentMonthRange.start;
    const end = isWholeYear
      ? selectedYear === TODAY_YEAR
        ? todayString()
        : `${selectedYear}-12-31`
      : currentMonthRange.end;

    // Consuntivo anno prec.: sempre il periodo pieno e chiuso dell'anno
    // precedente (a differenza del periodo corrente, un anno passato e'
    // per definizione concluso, non va troncato ad "oggi").
    const lastYearMonthRange = monthRange(`${selectedYear - 1}-${pad(isWholeYear ? 1 : selectedMonth)}-01`);
    const lastYearStart = isWholeYear ? `${selectedYear - 1}-01-01` : lastYearMonthRange.start;
    const lastYearEnd = isWholeYear ? `${selectedYear - 1}-12-31` : lastYearMonthRange.end;

    // Mesi dell'anno selezionato effettivamente in ambito: 1 solo mese in
    // modalita' mensile, fino al mese di oggi se l'anno corrente e' quello
    // selezionato (non ha senso includere budget/SDLY di mesi futuri non
    // ancora iniziati), altrimenti tutti e 12 per un anno passato concluso.
    // Riusato sia per i budget dell'anno selezionato sia, spostato di un
    // anno indietro, per il confronto SDLY "a parita' di anticipo".
    const monthsInScope = isWholeYear
      ? Array.from({ length: selectedYear === TODAY_YEAR ? TODAY_MONTH : 12 }, (_, i) => i + 1)
      : [selectedMonth];

    // Confronto SDLY "a parità di anticipo": non l'OTB dell'ultima estrazione
    // disponibile per il mese dell'anno scorso (sarebbe il consuntivo finale,
    // già coperto dalla colonna "Consuntivo anno prec."), ma l'OTB di quel
    // mese così come si presentava un anno esatto fa rispetto ad oggi.
    const sdlyCutoff = sdlyDate(todayString());

    const snapshotColumns =
      "structure_id, stay_date, revenue_total, rooms_sold, rooms_available, arrivals, presences, status";

    const sdlyPromises = monthsInScope.map((m) =>
      supabase.rpc("fn_month_snapshot_asof", {
        p_structure_ids: ids,
        p_period_year: selectedYear - 1,
        p_period_month: m,
        p_cutoff_date: sdlyCutoff,
      })
    );

    const [monthRes, lastYearMonthRes, budgetsRes, importsRes, lastExtractionRes, ...sdlyResults] = await Promise.all([
      supabase
        .from("v_snapshot_latest")
        .select(snapshotColumns)
        .gte("stay_date", start)
        .lte("stay_date", end)
        .in("structure_id", ids),
      supabase
        .from("v_snapshot_latest")
        .select(snapshotColumns)
        .gte("stay_date", lastYearStart)
        .lte("stay_date", lastYearEnd)
        .in("structure_id", ids),
      supabase
        .from("v_budgets_current")
        .select("structure_id, level, adr, revenue_target, room_nights_sold_target, room_nights_available, occupancy_pct_target")
        .eq("season_year", selectedYear)
        .in("month", monthsInScope)
        .in("structure_id", ids),
      supabase.from("bd_imports").select("extraction_date").in("structure_id", ids),
      // Data ultimo upload (ADR/RevPAR) per struttura: non dipende dal
      // periodo selezionato, e' una fotografia di freschezza del dato.
      supabase.rpc("fn_latest_extraction_per_structure", { p_structure_ids: ids }),
      ...sdlyPromises,
    ]);

    if (monthRes.error) setLoadError(monthRes.error.message);
    if (lastYearMonthRes.error) setLoadError(lastYearMonthRes.error.message);
    if (budgetsRes.error) setLoadError(budgetsRes.error.message);
    if (importsRes.error) setLoadError(importsRes.error.message);
    if (lastExtractionRes.error) setLoadError(lastExtractionRes.error.message);
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
    // In modalità "Tutto l'anno" si somma su più mesi: se anche un solo
    // mese ha copertura si mostra la somma parziale, "ND" solo se nessun
    // mese in ambito ha alcuna copertura per quella struttura.
    const sdlySumByStructure = new Map<string, number>();
    const sdlyCoverageByStructure = new Map<string, number>();
    sdlyResults.forEach((res) => {
      (res.data || []).forEach((r: { structure_id: string; revenue_total: number }) => {
        sdlySumByStructure.set(r.structure_id, (sdlySumByStructure.get(r.structure_id) || 0) + Number(r.revenue_total));
        sdlyCoverageByStructure.set(r.structure_id, (sdlyCoverageByStructure.get(r.structure_id) || 0) + 1);
      });
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

    const nextRows: StructureRowData[] = structures.map((structure) => {
      const monthSnapshots = monthByStructure.get(structure.id) || [];
      const monthToDate = sumSnapshots(monthSnapshots);
      const lastYearMonthToDate = sumSnapshots(lastYearMonthByStructure.get(structure.id) || []);

      const budgetsForMonth: BudgetRow[] = ["minimo", "realistico", "sfidante"]
        .map((level) => budgetRowsByStructureLevel.get(`${structure.id}::${level}`))
        .filter((rows): rows is BudgetRow[] => Boolean(rows && rows.length > 0))
        .map((rows) => aggregateBudgetRows(rows));

      return {
        structure,
        monthRevenue: monthToDate.revenue,
        monthRoomsSold: monthToDate.roomsSold,
        monthRoomsAvailable: monthToDate.roomsAvailable,
        sdlyMonthRevenue: (sdlyCoverageByStructure.get(structure.id) || 0) > 0
          ? sdlySumByStructure.get(structure.id) ?? 0
          : null,
        lastYearMonthRevenue: lastYearMonthToDate.revenue,
        budgetsForMonth,
        pacing: computePacingStatus(monthToDate.revenue, budgetsForMonth),
        lastExtractionDate: lastExtractionByStructure.get(structure.id) ?? null,
      };
    });

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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Performance"
        title="Dashboard Performance"
        description="Stato commerciale mensile di tutte le strutture, con ritmo verso il budget del mese e confronto SDLY a parità di anticipo. Seleziona un mese diverso per rivedere periodi passati o futuri."
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
        subtitle={`Dati riferiti a ${periodLabel}${isCurrentMonth ? " (mese corrente)" : ""} — clicca una riga per il dettaglio giornaliero e il pickup`}
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
                    Ultimo upload
                    <InfoTooltip text="Data dell'ultima estrazione ADR/RevPAR disponibile per questa struttura (la fonte che alimenta Revenue OTB/ADR/RevPAR/Occupazione) — non le estrazioni di Canali o Nazionalità." />
                  </th>
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
                    SDLY
                    <InfoTooltip text="Revenue on-the-books dell'intero mese selezionato confrontato con l'OTB dello stesso mese dell'anno scorso, preso allo stesso punto di anticipo (cutoff sull'estrazione a un anno esatto da oggi) — non il consuntivo finale. Usa lo storico mensile se disponibile a quella data, altrimenti la somma dei giorni disponibili. 'ND' quando manca copertura per quel mese. Passa il mouse (o tocca) sulla riga per i valori assoluti." />
                  </th>
                  <th className="pb-3 pr-4">
                    Consuntivo anno prec. vs OTB
                    <InfoTooltip text="Revenue totale chiuso dello stesso mese dell'anno precedente rispetto al mese selezionato, confrontato con il Revenue OTB del mese selezionato. 'ND' quando manca lo storico per quel mese. Passa il mouse (o tocca) sulla riga per i valori assoluti." />
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
                    <InfoTooltip text="Room night mancanti rispetto all'occupazione target del Budget Minimo: (% Occupazione target × Room night disponibili del Minimo) − Room night già vendute. '✓ Raggiunto' se il Minimo è già superato in revenue, 'Esaurito' se le room night target sono già tutte vendute ma manca ancora revenue (serve un prezzo più alto, non altre camere)." />
                  </th>
                  <th className="pb-3 pr-4">
                    ADR TO GOAL
                    <InfoTooltip text="ADR necessaria sulle room night mancanti (colonna RN TO GOAL) per raggiungere il Budget Minimo: (Budget Minimo − Revenue OTB) / RN TO GOAL. Stessi stati '✓ Raggiunto' / 'Esaurito' di RN TO GOAL." />
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
                  const goal = computeGoalGap(row.monthRevenue, minimoBudget, row.monthRoomsSold);

                  return (
                    <tr
                      key={row.structure.id}
                      onClick={() => router.push(`/performance/${row.structure.id}`)}
                      className="cursor-pointer border-b border-[#f0ece6] transition last:border-0 hover:bg-[#f8f6f2]"
                    >
                      <td className="py-3 pr-4 font-semibold text-[#2B2D2F]">{row.structure.name}</td>

                      <td className="py-3 pr-4 text-[#2B2D2F]">
                        {row.lastExtractionDate ? formatDateIt(row.lastExtractionDate) : ND}
                      </td>

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
                            trigger={
                              <span className="text-[#2B2D2F]">
                                {formatCurrency(row.sdlyMonthRevenue)}{" "}
                                <span className={sdlyDelta.colorClass}>({sdlyDelta.text})</span>
                              </span>
                            }
                          >
                            <p>OTB {periodLabel}: {formatCurrency(row.monthRevenue)}</p>
                            <p>SDLY {lastYearPeriodLabel} (a parità di anticipo): {formatCurrency(row.sdlyMonthRevenue)}</p>
                            <p className="mt-1">
                              Differenza:{" "}
                              {formatSignedCurrency(
                                row.monthRevenue !== null ? row.monthRevenue - row.sdlyMonthRevenue : null
                              )}
                            </p>
                            <p>Variazione: {sdlyDelta.text}</p>
                          </CellTooltip>
                        ) : (
                          <span className="text-[#6a6d70]">{ND}</span>
                        )}
                      </td>

                      <td className="py-3 pr-4">
                        {row.lastYearMonthRevenue !== null ? (
                          <CellTooltip
                            trigger={
                              <span className="text-[#2B2D2F]">
                                {formatCurrency(row.lastYearMonthRevenue)}{" "}
                                <span className={lastYearDelta.colorClass}>({lastYearDelta.text})</span>
                              </span>
                            }
                          >
                            <p>Revenue OTB {periodLabel}: {formatCurrency(row.monthRevenue)}</p>
                            <p>Consuntivo chiuso {lastYearPeriodLabel}: {formatCurrency(row.lastYearMonthRevenue)}</p>
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
                        <GoalCell goal={goal} render={(g) => formatNumber(Math.ceil(g.roomsNeeded ?? 0))} />
                      </td>

                      <td className="py-3 pr-4 text-[#2B2D2F]">
                        <GoalCell goal={goal} render={(g) => formatCurrency(g.adrNeeded)} />
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
            </table>
          </div>
        )}
      </AppCard>
    </div>
  );
}

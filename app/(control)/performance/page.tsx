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
  formatPercent,
  formatDelta,
  occupancy,
  adr,
  revPar,
  adrToGoal,
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

type StructureRowData = {
  structure: StructureOption;
  monthRevenue: number | null;
  monthRoomsSold: number | null;
  monthRoomsAvailable: number | null;
  sdlyMonthRevenue: number | null;
  lastYearMonthRevenue: number | null;
  budgetsForMonth: BudgetRow[];
  pacing: ReturnType<typeof computePacingStatus>;
};

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

    const { start, end, year, month } = monthRange(`${selectedYear}-${pad(selectedMonth)}-01`);
    const lastYearMonth = monthRange(`${year - 1}-${pad(month)}-01`);
    // Confronto SDLY "a parità di anticipo": non l'OTB dell'ultima estrazione
    // disponibile per il mese dell'anno scorso (sarebbe il consuntivo finale,
    // già coperto dalla colonna "Consuntivo anno prec."), ma l'OTB di quel
    // mese così come si presentava un anno esatto fa rispetto ad oggi.
    const sdlyCutoff = sdlyDate(todayString());

    const snapshotColumns =
      "structure_id, stay_date, revenue_total, rooms_sold, rooms_available, arrivals, presences, status";

    const [monthRes, lastYearMonthRes, sdlyMonthRes, budgetsRes, importsRes] = await Promise.all([
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
      supabase.rpc("fn_month_snapshot_asof", {
        p_structure_ids: ids,
        p_period_year: lastYearMonth.year,
        p_period_month: lastYearMonth.month,
        p_cutoff_date: sdlyCutoff,
      }),
      supabase
        .from("v_budgets_current")
        .select("structure_id, level, adr, revenue_target, room_nights_sold_target, room_nights_available, occupancy_pct_target")
        .eq("season_year", year)
        .eq("month", month)
        .in("structure_id", ids),
      supabase.from("bd_imports").select("extraction_date").in("structure_id", ids),
    ]);

    if (monthRes.error) setLoadError(monthRes.error.message);
    if (lastYearMonthRes.error) setLoadError(lastYearMonthRes.error.message);
    if (sdlyMonthRes.error) setLoadError(sdlyMonthRes.error.message);
    if (budgetsRes.error) setLoadError(budgetsRes.error.message);
    if (importsRes.error) setLoadError(importsRes.error.message);

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
    // altrimenti somma dei giorni disponibili in performance_daily_snapshot):
    // niente da sommare qui, un'unica riga per struttura o nessuna (ND).
    const sdlyMonthRevenueByStructure = new Map<string, number>(
      (sdlyMonthRes.data || []).map((r: { structure_id: string; revenue_total: number }) => [
        r.structure_id,
        Number(r.revenue_total),
      ])
    );

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
        monthRevenue: monthToDate.revenue,
        monthRoomsSold: monthToDate.roomsSold,
        monthRoomsAvailable: monthToDate.roomsAvailable,
        sdlyMonthRevenue: sdlyMonthRevenueByStructure.get(structure.id) ?? null,
        lastYearMonthRevenue: lastYearMonthToDate.revenue,
        budgetsForMonth,
        pacing: computePacingStatus(monthToDate.revenue, budgetsForMonth),
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

  const periodLabel = `${MONTH_LABELS[selectedMonth - 1]} ${selectedYear}`;
  const lastYearPeriodLabel = `${MONTH_LABELS[selectedMonth - 1]} ${selectedYear - 1}`;

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
                  value={`${selectedYear}-${pad(selectedMonth)}-01`}
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
            <table className="w-full min-w-[1500px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#e7dfd8] text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                  <th className="pb-3 pr-4">Struttura</th>
                  <th className="pb-3 pr-4">
                    Revenue OTB (mese)
                    <InfoTooltip text="Somma del revenue on-the-books di tutti i giorni del mese selezionato per cui esiste un dato importato. Valore parziale se il mese non è concluso o mancano import." />
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
                    ADR TO GOAL
                    <InfoTooltip text="ADR necessaria per raggiungere il Budget Minimo, sulle camere che mancano rispetto all'occupazione target del Minimo: (Budget Minimo − Revenue OTB) / ((% Occupazione target × Room night disponibili del Minimo) − Room night già vendute). '✓ Raggiunto' se il Minimo è già superato in revenue." />
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
                  const goal = adrToGoal(row.monthRevenue, minimoBudget, row.monthRoomsSold);

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
                            trigger={
                              <span className="text-[#2B2D2F]">
                                {formatCurrency(row.sdlyMonthRevenue)}{" "}
                                <span className={sdlyDelta.colorClass}>({sdlyDelta.text})</span>
                              </span>
                            }
                          >
                            <p>OTB {periodLabel}: {formatCurrency(row.monthRevenue)}</p>
                            <p>SDLY {lastYearPeriodLabel} (a parità di anticipo): {formatCurrency(row.sdlyMonthRevenue)}</p>
                            <p className="mt-1">Variazione: {sdlyDelta.text}</p>
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
                            <p className="mt-1">Variazione: {lastYearDelta.text}</p>
                          </CellTooltip>
                        ) : (
                          <span className="text-[#6a6d70]">{ND}</span>
                        )}
                      </td>

                      <td className="py-3 pr-4 text-[#2B2D2F]">{formatCurrency(monthAdr)}</td>
                      <td className="py-3 pr-4 text-[#2B2D2F]">{formatCurrency(monthRevPar)}</td>
                      <td className="py-3 pr-4 text-[#2B2D2F]">{formatPercent(monthOcc)}</td>

                      <td className="py-3 pr-4 text-[#2B2D2F]">
                        {goal.achieved ? (
                          <span className="text-[#2f7d43]">✓ Raggiunto</span>
                        ) : goal.value !== null ? (
                          formatCurrency(goal.value)
                        ) : (
                          ND
                        )}
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

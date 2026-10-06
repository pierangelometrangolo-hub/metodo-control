"use client";

import { ReactNode } from "react";
import { AppBadge } from "@/components/ui/AppBadge";
import { AppCard } from "@/components/ui/AppCard";
import { CellTooltip } from "@/components/ui/CellTooltip";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { MONTH_LABELS } from "@/components/performance/Calendar";
import { MonthComparison, MonthlyPerformanceRow } from "@/lib/performance/monthlyPerformance";
import {
  ND,
  formatCurrency,
  formatDelta,
  formatNumber,
  formatPercent,
  pacingDotClasses,
  pacingLabels,
} from "@/lib/performanceMetrics";

type MonthlyPerformanceTableProps = {
  year: number;
  // null = dati dell'anno non ancora caricati.
  rows: MonthlyPerformanceRow[] | null;
};

const NEUTRAL = "text-[#6a6d70]";
const CLOSURE_TOOLTIP =
  "Chiusura dichiarata nel Budget per l’intero mese: nessuna produzione attesa, il mese non è un dato mancante.";

function formatDateIt(date: string): string {
  return date.split("-").reverse().join("/");
}

// Le ultime righe aprono il tooltip verso l'alto: verso il basso verrebbe
// tagliato dal contenitore scrollabile della tabella.
function placementFor(month: number): "top" | "bottom" {
  return month > 6 ? "top" : "bottom";
}

// Tooltip di una cella numerica: allineato al bordo destro della cella, testo
// a sinistra (la cella e' allineata a destra).
function RowTooltip({ row, trigger, children }: { row: MonthlyPerformanceRow; trigger: ReactNode; children: ReactNode }) {
  return (
    <CellTooltip align="right" placement={placementFor(row.month)} trigger={trigger}>
      <span className="block text-left">{children}</span>
    </CellTooltip>
  );
}

function NdCell({ row, reason }: { row: MonthlyPerformanceRow; reason: string }) {
  return (
    <RowTooltip
      row={row}
      trigger={<span className={NEUTRAL}>{row.closedByDeclaration ? "—" : ND}</span>}
    >
      {row.closedByDeclaration ? CLOSURE_TOOLTIP : reason}
    </RowTooltip>
  );
}

function ComparisonCell({
  row,
  comparison,
  title,
  referenceLabel,
}: {
  row: MonthlyPerformanceRow;
  comparison: MonthComparison;
  title: string;
  referenceLabel: string;
}) {
  if (comparison.delta === null) {
    return (
      <NdCell
        row={row}
        reason={`${title}: confronto non disponibile${
          comparison.unavailableReason ? ` — ${comparison.unavailableReason}` : ""
        }.${comparison.zeroNote ? ` ${comparison.zeroNote}` : ""}`}
      />
    );
  }

  const delta = formatDelta(comparison.current, comparison.reference);

  return (
    <RowTooltip
      row={row}
      trigger={<span className={`font-medium ${delta.colorClass}`}>{delta.text}</span>}
    >
      <span className="block font-semibold">{title}</span>
      <span className="block">
        {formatCurrency(comparison.current)}
        {comparison.actualDetail ? ` (${comparison.actualDetail})` : ""}
      </span>
      <span className="block">
        {referenceLabel}: {formatCurrency(comparison.reference)}
        {comparison.referenceDetail ? ` (${comparison.referenceDetail})` : ""}
      </span>
      {comparison.zeroNote && <span className="block">{comparison.zeroNote}</span>}
    </RowTooltip>
  );
}

function BudgetCell({ row }: { row: MonthlyPerformanceRow }) {
  const { minimo, realistico, sfidante } = row.budget;
  const hasAnyLevel = minimo !== null || realistico !== null || sfidante !== null;

  return (
    <RowTooltip
      row={row}
      trigger={
        <span className={realistico === null ? NEUTRAL : "text-[#2B2D2F]"}>
          {realistico === null ? ND : formatCurrency(realistico)}
        </span>
      }
    >
      {hasAnyLevel ? (
        <>
          <span className="block font-semibold">Budget {MONTH_LABELS[row.month - 1]}</span>
          <span className="block">Minimo: {formatCurrency(minimo)}</span>
          <span className="block">Realistico: {formatCurrency(realistico)}</span>
          <span className="block">Sfidante: {formatCurrency(sfidante)}</span>
        </>
      ) : (
        "Nessun budget inserito per questo mese."
      )}
    </RowTooltip>
  );
}

function VsBudgetCell({ row }: { row: MonthlyPerformanceRow }) {
  if (row.vsBudget === null) {
    return (
      <NdCell
        row={row}
        reason={
          row.budget.realistico === null
            ? "Nessun Budget Realistico per questo mese."
            : "Nessun dato importato per questo mese."
        }
      />
    );
  }

  const delta = formatDelta(row.revenue, row.budget.realistico);
  const isClosed = row.status === "closed";

  return (
    <RowTooltip
      row={row}
      trigger={
        <span className="inline-flex items-center justify-end gap-2">
          {/* Mese futuro: l'OTB crescera' ancora, nessun semaforo da consuntivo. */}
          {row.pacing && row.status !== "future" && (
            <span className={`h-2 w-2 shrink-0 rounded-full ${pacingDotClasses[row.pacing]}`} />
          )}
          <span className={`font-medium ${isClosed ? delta.colorClass : NEUTRAL}`}>{delta.text}</span>
        </span>
      }
    >
      <span className="block font-semibold">
        {isClosed ? "Revenue" : "OTB"} vs Budget Realistico
      </span>
      <span className="block">
        {formatCurrency(row.revenue)} su {formatCurrency(row.budget.realistico)} ({formatPercent(row.budgetAchievement)}{" "}
        del Realistico)
      </span>
      {row.pacing && <span className="block">{pacingLabels[row.pacing]}</span>}
      {!isClosed && (
        <span className="block">Mese non concluso: OTB a oggi sul budget del mese pieno, non uno scostamento definitivo.</span>
      )}
    </RowTooltip>
  );
}

function KpiCell({ row, children }: { row: MonthlyPerformanceRow; children: ReactNode }) {
  if (!row.hasData) return <NdCell row={row} reason="Nessun dato importato per questo mese." />;
  return <span className={row.status === "future" ? NEUTRAL : "text-[#2B2D2F]"}>{children}</span>;
}

export function MonthlyPerformanceTable({ year, rows }: MonthlyPerformanceTableProps) {
  return (
    <AppCard title="Performance mensile" subtitle="Andamento mensile con confronti, budget e principali KPI">
      {rows === null ? (
        <p className="text-sm text-[#6a6d70]">Caricamento...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[#e7dfd8] text-right text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                <th className="sticky left-0 z-[1] bg-white pb-3 pr-4 text-left">Mese {year}</th>
                <th className="pb-3 pr-4">
                  Revenue / OTB
                  <InfoTooltip text="Mese chiuso: revenue finale del mese. Mese in corso o futuro: OTB dell’intero mese all’ultimo snapshot disponibile." />
                </th>
                <th className="pb-3 pr-4">
                  vs SDLY
                  <InfoTooltip text="Mese già iniziato: produzione maturata fino alla data dell’ultimo snapshot contro gli stessi giorni dell’anno precedente. Mese futuro: OTB contro l’OTB dello stesso mese osservato alla stessa data dell’anno precedente. Passa il mouse (o tocca) sul valore per l’intervallo confrontato." />
                </th>
                <th className="pb-3 pr-4">
                  vs Consuntivo LY
                  <InfoTooltip text="Intero mese contro il risultato finale dello stesso mese di calendario dell’anno precedente. ND se lo storico non copre tutti i giorni del mese (un giorno senza dati vale 0 solo se coperto da una chiusura registrata nel Budget)." />
                </th>
                <th className="pb-3 pr-4">
                  Budget
                  <InfoTooltip text="Revenue target dello scenario Realistico per il mese. Passa il mouse (o tocca) sul valore per Minimo, Realistico e Sfidante." />
                </th>
                <th className="pb-3 pr-4">
                  vs Budget
                  <InfoTooltip text="Scostamento del Revenue / OTB dal Budget Realistico del mese pieno. Per i mesi non conclusi è un avanzamento, non uno scostamento definitivo." />
                </th>
                <th className="pb-3 pr-4">Occupazione</th>
                <th className="pb-3 pr-4">ADR</th>
                <th className="pb-3 pr-4">RevPAR</th>
                <th className="pb-3">RN vendute</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isCurrent = row.status === "current";
                const rowBg = isCurrent ? "bg-[#f3f8fa]" : "bg-white";

                return (
                  <tr key={row.month} className={`border-b border-[#f0ece6] text-right last:border-0 ${rowBg}`}>
                    {/* hover/has: porta in primo piano la cella sticky quando un suo tooltip e' aperto. */}
                    <td
                      className={`sticky left-0 z-[1] py-2.5 pr-4 text-left hover:z-20 has-[.opacity-100]:z-20 ${rowBg}`}
                    >
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <span className="font-semibold text-[#2B2D2F]">{MONTH_LABELS[row.month - 1]}</span>
                        {row.closedByDeclaration ? (
                          <CellTooltip
                            className="inline-flex"
                            placement={placementFor(row.month)}
                            trigger={
                              <AppBadge variant="neutral" className="px-2 py-0.5 text-[11px]">
                                Chiuso
                              </AppBadge>
                            }
                          >
                            <span className="whitespace-normal">{CLOSURE_TOOLTIP}</span>
                          </CellTooltip>
                        ) : isCurrent ? (
                          <AppBadge variant="info" className="px-2 py-0.5 text-[11px]">
                            In corso
                          </AppBadge>
                        ) : row.status === "future" ? (
                          <AppBadge variant="neutral" className="px-2 py-0.5 text-[11px]">
                            OTB
                          </AppBadge>
                        ) : null}
                      </div>
                      {row.staleAsOf && (
                        <p className="mt-0.5 whitespace-nowrap text-[11px] text-[#8a5a12]">
                          dato al {formatDateIt(row.staleAsOf).slice(0, 5)}
                        </p>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 font-semibold">
                      <KpiCell row={row}>
                        <span className="text-[#2B2D2F]">{formatCurrency(row.revenue)}</span>
                      </KpiCell>
                    </td>
                    <td className="py-2.5 pr-4">
                      <ComparisonCell
                        row={row}
                        comparison={row.sdly}
                        title={row.sdly.mode === "production" ? "Produzione vs SDLY" : "OTB vs SDLY"}
                        referenceLabel="SDLY"
                      />
                    </td>
                    <td className="py-2.5 pr-4">
                      <ComparisonCell
                        row={row}
                        comparison={row.consuntivoLy}
                        title={row.status === "closed" ? "Revenue vs Consuntivo LY" : "OTB vs Consuntivo LY"}
                        referenceLabel="Consuntivo LY"
                      />
                    </td>
                    <td className="py-2.5 pr-4">
                      <BudgetCell row={row} />
                    </td>
                    <td className="py-2.5 pr-4">
                      <VsBudgetCell row={row} />
                    </td>
                    <td className="py-2.5 pr-4">
                      <KpiCell row={row}>{formatPercent(row.occupancy)}</KpiCell>
                    </td>
                    <td className="py-2.5 pr-4">
                      <KpiCell row={row}>{formatCurrency(row.adr)}</KpiCell>
                    </td>
                    <td className="py-2.5 pr-4">
                      <KpiCell row={row}>{formatCurrency(row.revPar)}</KpiCell>
                    </td>
                    <td className="py-2.5">
                      <KpiCell row={row}>{formatNumber(row.roomsSold)}</KpiCell>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppCard>
  );
}

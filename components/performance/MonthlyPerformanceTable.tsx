"use client";

import { ReactNode } from "react";
import { AppBadge } from "@/components/ui/AppBadge";
import { AppCard } from "@/components/ui/AppCard";
import { AppComparisonTone, AppComparisonValue } from "@/components/ui/AppComparisonValue";
import { AppTable, AppTableCell, AppTableRow, AppTableRowState } from "@/components/ui/AppTable";
import { CellTooltip } from "@/components/ui/CellTooltip";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { MONTH_LABELS } from "@/components/performance/Calendar";
import {
  MonthComparison,
  MonthlyPerformanceRow,
  MonthlyPerformanceTotal,
  MonthStatus,
} from "@/lib/performance/monthlyPerformance";
import {
  ND,
  PacingStatus,
  deltaPercent,
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
  total: MonthlyPerformanceTotal | null;
};

// Contesto di rendering di una cella: dove aprire il tooltip e come
// rappresentare l'assenza di dato (mese chiuso per chiusura dichiarata).
type CellContext = {
  placement: "top" | "bottom";
  closedByDeclaration: boolean;
};

const NEUTRAL = "text-[#6a6d70]";
const SUBLINE = "block whitespace-nowrap text-[11px] font-normal leading-4 text-[#6a6d70]";
const CLOSURE_TOOLTIP =
  "Chiusura dichiarata nel Budget per l’intero mese: nessuna produzione attesa, il mese non è un dato mancante.";

// Il tono del delta lo decide chi conosce il significato del numero (qui:
// sopra il riferimento = positivo), non il componente di presentazione.
function toneOfDelta(delta: number | null): AppComparisonTone {
  if (delta === null || delta === 0) return "neutral";
  return delta > 0 ? "positive" : "negative";
}

// Stato temporale della riga: un mese passato e' la riga standard, "closed"
// e' il mese chiuso per chiusura dichiarata.
function rowStateOf(row: MonthlyPerformanceRow): AppTableRowState {
  if (row.status === "current") return "current";
  if (row.closedByDeclaration) return "closed";
  if (row.status === "future") return "future";
  return "default";
}

function formatDateIt(date: string): string {
  return date.split("-").reverse().join("/");
}

// Le ultime righe aprono il tooltip verso l'alto: verso il basso verrebbe
// tagliato dal contenitore scrollabile della tabella.
function contextOf(row: MonthlyPerformanceRow): CellContext {
  return { placement: row.month > 6 ? "top" : "bottom", closedByDeclaration: row.closedByDeclaration };
}

const TOTAL_CONTEXT: CellContext = { placement: "top", closedByDeclaration: false };

// Tooltip di una cella numerica: allineato al bordo destro della cella, testo
// a sinistra (la cella e' allineata a destra).
function RowTooltip({ ctx, trigger, children }: { ctx: CellContext; trigger: ReactNode; children: ReactNode }) {
  return (
    <CellTooltip align="right" placement={ctx.placement} trigger={trigger}>
      <span className="block text-left">{children}</span>
    </CellTooltip>
  );
}

function NdCell({ ctx, reason }: { ctx: CellContext; reason: string }) {
  return (
    <RowTooltip ctx={ctx} trigger={<span className={`font-normal ${NEUTRAL}`}>{ctx.closedByDeclaration ? "—" : ND}</span>}>
      {ctx.closedByDeclaration ? CLOSURE_TOOLTIP : reason}
    </RowTooltip>
  );
}

// Delta % (dato principale) e, sotto, il valore di riferimento realmente
// usato dal calcolo - quello esposto dalla funzione pura, mai ricalcolato qui.
function ComparisonCell({
  ctx,
  comparison,
  title,
  referenceLabel,
}: {
  ctx: CellContext;
  comparison: MonthComparison;
  title: string;
  referenceLabel: string;
}) {
  if (comparison.delta === null) {
    return (
      <NdCell
        ctx={ctx}
        reason={`${title}: confronto non disponibile${
          comparison.unavailableReason ? ` — ${comparison.unavailableReason}` : ""
        }.${comparison.zeroNote ? ` ${comparison.zeroNote}` : ""}`}
      />
    );
  }

  const delta = formatDelta(comparison.current, comparison.reference);

  return (
    <RowTooltip
      ctx={ctx}
      trigger={
        <AppComparisonValue
          emphasis="delta"
          delta={delta.text}
          tone={toneOfDelta(comparison.delta)}
          reference={`vs ${formatCurrency(comparison.reference)}`}
        />
      }
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

function BudgetCell({
  ctx,
  budget,
  title,
  coverage,
}: {
  ctx: CellContext;
  budget: { minimo: number | null; realistico: number | null; sfidante: number | null };
  title: string;
  // Solo riga Totale: mesi con budget, quando non coprono l'intero anno.
  coverage?: { months: number; of: number } | null;
}) {
  const { minimo, realistico, sfidante } = budget;
  const hasAnyLevel = minimo !== null || realistico !== null || sfidante !== null;

  return (
    <RowTooltip
      ctx={ctx}
      trigger={
        <span className="block">
          <span className={`block leading-5 ${realistico === null ? `font-normal ${NEUTRAL}` : "text-[#2B2D2F]"}`}>
            {realistico === null ? ND : formatCurrency(realistico)}
          </span>
          {coverage && realistico !== null && (
            <span className={SUBLINE}>
              {coverage.months}/{coverage.of} mesi
            </span>
          )}
        </span>
      }
    >
      {hasAnyLevel ? (
        <>
          <span className="block font-semibold">{title}</span>
          <span className="block">Minimo: {formatCurrency(minimo)}</span>
          <span className="block">Realistico: {formatCurrency(realistico)}</span>
          <span className="block">Sfidante: {formatCurrency(sfidante)}</span>
          {coverage && (
            <span className="block">
              Budget presente per {coverage.months} mesi su {coverage.of}: somma dei soli mesi coperti, non un budget
              annuale completo.
            </span>
          )}
        </>
      ) : coverage ? (
        "Nessun budget inserito per questo anno."
      ) : (
        "Nessun budget inserito per questo mese."
      )}
    </RowTooltip>
  );
}

function VsBudgetCell({
  ctx,
  status,
  revenue,
  realistico,
  achievement,
  pacing,
  unavailableReason,
  partialMonths,
}: {
  ctx: CellContext;
  status: MonthStatus;
  // Lato corrente del confronto (per il Totale: revenue dei soli mesi con budget).
  revenue: number | null;
  realistico: number | null;
  achievement: number | null;
  pacing: PacingStatus;
  unavailableReason: string;
  // Solo riga Totale con budget parziale: mesi su cui e' calcolato il confronto.
  partialMonths?: number | null;
}) {
  const delta = formatDelta(revenue, realistico);
  if (revenue === null || realistico === null || delta.text === ND) {
    return <NdCell ctx={ctx} reason={unavailableReason} />;
  }

  const isClosed = status === "closed";

  return (
    <RowTooltip
      ctx={ctx}
      trigger={
        <AppComparisonValue
          emphasis="delta"
          // Periodo non concluso: avanzamento, non uno scostamento da colorare.
          tone={isClosed ? toneOfDelta(deltaPercent(revenue, realistico)) : "neutral"}
          delta={
            <span className="inline-flex items-center justify-end gap-2">
              {/* Periodo futuro: l'OTB crescera' ancora, nessun semaforo da consuntivo. */}
              {pacing && status !== "future" && (
                <span className={`h-2 w-2 shrink-0 rounded-full ${pacingDotClasses[pacing]}`} />
              )}
              <span>{delta.text}</span>
            </span>
          }
          note={partialMonths ? `su ${partialMonths} mesi` : undefined}
        />
      }
    >
      <span className="block font-semibold">{isClosed ? "Revenue" : "OTB"} vs Budget Realistico</span>
      <span className="block">
        {formatCurrency(revenue)} su {formatCurrency(realistico)} ({formatPercent(achievement)} del Realistico)
      </span>
      {pacing && <span className="block">{pacingLabels[pacing]}</span>}
      {partialMonths ? (
        <span className="block">
          Confronto sui soli {partialMonths} mesi con budget: revenue e budget degli stessi mesi, non dell’intero anno.
        </span>
      ) : null}
      {!isClosed && (
        <span className="block">
          Periodo non concluso: OTB a oggi sul budget pieno, non uno scostamento definitivo.
        </span>
      )}
    </RowTooltip>
  );
}

function KpiCell({
  ctx,
  hasData,
  muted,
  children,
}: {
  ctx: CellContext;
  hasData: boolean;
  muted: boolean;
  children: ReactNode;
}) {
  if (!hasData) return <NdCell ctx={ctx} reason="Nessun dato importato per questo periodo." />;
  return <span className={muted ? NEUTRAL : "text-[#2B2D2F]"}>{children}</span>;
}

export function MonthlyPerformanceTable({ year, rows, total }: MonthlyPerformanceTableProps) {
  return (
    <AppCard
      density="compact"
      title="Performance mensile"
      subtitle="Andamento mensile con confronti, budget e principali KPI"
    >
      {rows === null ? (
        <p className="text-sm text-[#6a6d70]">Caricamento...</p>
      ) : (
        <AppTable minWidthClassName="min-w-[1080px]">
            <thead>
              <AppTableRow state="header">
                <AppTableCell sticky>Mese {year}</AppTableCell>
                <AppTableCell numeric>
                  Revenue / OTB
                  <InfoTooltip text="Mese chiuso: revenue finale del mese. Mese in corso o futuro: OTB dell’intero mese all’ultimo snapshot disponibile." />
                </AppTableCell>
                <AppTableCell numeric>
                  vs SDLY
                  <InfoTooltip text="Mese già iniziato: produzione maturata fino alla data dell’ultimo snapshot contro gli stessi giorni dell’anno precedente. Mese futuro: OTB contro l’OTB dello stesso mese osservato alla stessa data dell’anno precedente. Sotto il delta, il valore dell’anno precedente usato nel confronto. Passa il mouse (o tocca) per l’intervallo confrontato." />
                </AppTableCell>
                <AppTableCell numeric>
                  vs Consuntivo LY
                  <InfoTooltip text="Intero mese contro il risultato finale dello stesso mese di calendario dell’anno precedente, riportato sotto il delta. ND se lo storico non copre tutti i giorni del mese (un giorno senza dati vale 0 solo se coperto da una chiusura registrata nel Budget)." />
                </AppTableCell>
                <AppTableCell numeric groupStart>
                  Budget
                  <InfoTooltip text="Revenue target dello scenario Realistico per il mese. Passa il mouse (o tocca) sul valore per Minimo, Realistico e Sfidante." />
                </AppTableCell>
                <AppTableCell numeric>
                  vs Budget
                  <InfoTooltip text="Scostamento del Revenue / OTB dal Budget Realistico del mese pieno. Per i mesi non conclusi è un avanzamento, non uno scostamento definitivo." />
                </AppTableCell>
                <AppTableCell numeric groupStart>
                  Occupazione
                </AppTableCell>
                <AppTableCell numeric>ADR</AppTableCell>
                <AppTableCell numeric>RevPAR</AppTableCell>
                <AppTableCell numeric>RN vendute</AppTableCell>
              </AppTableRow>
            </thead>
            <tbody>
              {rows.map((row) => {
                const ctx = contextOf(row);
                const isCurrent = row.status === "current";

                return (
                  <AppTableRow key={row.month} state={rowStateOf(row)}>
                    <AppTableCell sticky>
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <span className="font-semibold text-[#2B2D2F]">{MONTH_LABELS[row.month - 1]}</span>
                        {row.closedByDeclaration ? (
                          <CellTooltip
                            className="inline-flex"
                            placement={ctx.placement}
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
                    </AppTableCell>
                    <AppTableCell numeric className="font-semibold">
                      <KpiCell ctx={ctx} hasData={row.hasData} muted={false}>
                        {formatCurrency(row.revenue)}
                      </KpiCell>
                    </AppTableCell>
                    <AppTableCell numeric>
                      <ComparisonCell
                        ctx={ctx}
                        comparison={row.sdly}
                        title={row.sdly.mode === "production" ? "Produzione vs SDLY" : "OTB vs SDLY"}
                        referenceLabel="SDLY"
                      />
                    </AppTableCell>
                    <AppTableCell numeric>
                      <ComparisonCell
                        ctx={ctx}
                        comparison={row.consuntivoLy}
                        title={row.status === "closed" ? "Revenue vs Consuntivo LY" : "OTB vs Consuntivo LY"}
                        referenceLabel="Consuntivo LY"
                      />
                    </AppTableCell>
                    <AppTableCell numeric groupStart>
                      <BudgetCell ctx={ctx} budget={row.budget} title={`Budget ${MONTH_LABELS[row.month - 1]}`} />
                    </AppTableCell>
                    <AppTableCell numeric>
                      <VsBudgetCell
                        ctx={ctx}
                        status={row.status}
                        revenue={row.revenue}
                        realistico={row.budget.realistico}
                        achievement={row.budgetAchievement}
                        pacing={row.pacing}
                        unavailableReason={
                          row.budget.realistico === null
                            ? "Nessun Budget Realistico per questo mese."
                            : "Nessun dato importato per questo mese."
                        }
                      />
                    </AppTableCell>
                    <AppTableCell numeric groupStart className="text-[13px]">
                      <KpiCell ctx={ctx} hasData={row.hasData} muted>
                        {formatPercent(row.occupancy)}
                      </KpiCell>
                    </AppTableCell>
                    <AppTableCell numeric className="text-[13px]">
                      <KpiCell ctx={ctx} hasData={row.hasData} muted>
                        {formatCurrency(row.adr)}
                      </KpiCell>
                    </AppTableCell>
                    <AppTableCell numeric className="text-[13px]">
                      <KpiCell ctx={ctx} hasData={row.hasData} muted>
                        {formatCurrency(row.revPar)}
                      </KpiCell>
                    </AppTableCell>
                    <AppTableCell numeric className="text-[13px]">
                      <KpiCell ctx={ctx} hasData={row.hasData} muted>
                        {formatNumber(row.roomsSold)}
                      </KpiCell>
                    </AppTableCell>
                  </AppTableRow>
                );
              })}
            </tbody>
            {total && (
              <tfoot>
                {/* Somme annuali e KPI ricalcolati dalle somme; confronti con la semantica delle KPI card annuali. */}
                <AppTableRow state="total">
                  <AppTableCell sticky>
                    <span className="whitespace-nowrap text-[#2B2D2F]">Totale anno</span>
                    {total.hasData && total.monthsWithData < 12 && (
                      <p className="mt-0.5 whitespace-nowrap text-[11px] font-normal text-[#6a6d70]">
                        {total.monthsWithData}/12 mesi con dati
                      </p>
                    )}
                  </AppTableCell>
                  <AppTableCell numeric>
                    <KpiCell ctx={TOTAL_CONTEXT} hasData={total.hasData} muted={false}>
                      {formatCurrency(total.revenue)}
                    </KpiCell>
                  </AppTableCell>
                  <AppTableCell numeric>
                    <ComparisonCell
                      ctx={TOTAL_CONTEXT}
                      comparison={total.sdly}
                      title={
                        total.sdly.mode === "otb_asof"
                          ? "OTB vs SDLY"
                          : total.status === "current"
                            ? "Produzione YTD vs SDLY"
                            : "Produzione vs SDLY"
                      }
                      referenceLabel="SDLY"
                    />
                  </AppTableCell>
                  <AppTableCell numeric>
                    <ComparisonCell
                      ctx={TOTAL_CONTEXT}
                      comparison={total.consuntivoLy}
                      title={total.status === "closed" ? "Revenue vs Consuntivo LY" : "Revenue / OTB vs Consuntivo LY"}
                      referenceLabel="Consuntivo LY"
                    />
                  </AppTableCell>
                  <AppTableCell numeric groupStart>
                    <BudgetCell
                      ctx={TOTAL_CONTEXT}
                      budget={total.budget}
                      title={`Budget ${year}`}
                      coverage={total.budgetComplete ? null : { months: total.budgetMonths, of: 12 }}
                    />
                  </AppTableCell>
                  <AppTableCell numeric>
                    <VsBudgetCell
                      ctx={TOTAL_CONTEXT}
                      status={total.status}
                      revenue={total.budgetRevenue}
                      realistico={total.budget.realistico}
                      achievement={total.budgetAchievement}
                      pacing={total.pacing}
                      unavailableReason={
                        total.budget.realistico === null
                          ? "Nessun Budget Realistico per questo anno."
                          : "Nessun dato importato per i mesi con budget."
                      }
                      partialMonths={total.budgetComplete ? null : total.budgetMonths}
                    />
                  </AppTableCell>
                  <AppTableCell numeric groupStart>
                    <KpiCell ctx={TOTAL_CONTEXT} hasData={total.hasData} muted={false}>
                      {formatPercent(total.occupancy)}
                    </KpiCell>
                  </AppTableCell>
                  <AppTableCell numeric>
                    <KpiCell ctx={TOTAL_CONTEXT} hasData={total.hasData} muted={false}>
                      {formatCurrency(total.adr)}
                    </KpiCell>
                  </AppTableCell>
                  <AppTableCell numeric>
                    <KpiCell ctx={TOTAL_CONTEXT} hasData={total.hasData} muted={false}>
                      {formatCurrency(total.revPar)}
                    </KpiCell>
                  </AppTableCell>
                  <AppTableCell numeric>
                    <KpiCell ctx={TOTAL_CONTEXT} hasData={total.hasData} muted={false}>
                      {formatNumber(total.roomsSold)}
                    </KpiCell>
                  </AppTableCell>
                </AppTableRow>
              </tfoot>
            )}
        </AppTable>
      )}
    </AppCard>
  );
}

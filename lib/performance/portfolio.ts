import {
  BudgetRow,
  PacingStatus,
  adr,
  revPar,
  occupancy,
  deltaPercent,
  computePacingStatus,
} from "../performanceMetrics";

// Dati per struttura gia' risolti dalla Vista d'insieme (stessa forma di
// StructureRowData in app/(control)/performance/page.tsx): una struttura,
// un periodo, un solo snapshot per giorno gia' scelto da v_snapshot_latest.
// null = nessun dato nel periodo, MAI da confondere con 0.
export type PortfolioStructureInput = {
  monthRevenue: number | null;
  monthRoomsSold: number | null;
  monthRoomsAvailable: number | null;
  lastYearMonthRevenue: number | null;
  sdlyMonthRevenue: number | null;
  budgetsForMonth: BudgetRow[];
};

// Confronto omogeneo: actual e reference coprono SOLO le strutture che
// hanno entrambi i dati (es. LY 4/6 -> OTB di quelle 4 vs LY di quelle 4),
// mai l'OTB dell'intero portfolio contro un riferimento parziale.
export type PortfolioComparison = {
  actual: number;
  reference: number;
  variancePct: number | null;
  coverage: number;
};

export type BudgetLevel = BudgetRow["level"];

export type PortfolioPerformance = {
  totalStructures: number;
  includedStructures: number;
  revenue: number | null;
  roomsSold: number | null;
  roomsAvailable: number | null;
  adr: number | null;
  revpar: number | null;
  occupancy: number | null;
  lastYear: PortfolioComparison | null;
  sdly: PortfolioComparison | null;
  budget: Record<BudgetLevel, PortfolioComparison | null>;
  // Stessa regola di computePacingStatus per riga, applicata al
  // sottoinsieme di strutture con OTB + budget Minimo + Realistico.
  pacing: PacingStatus;
  pacingCoverage: number;
  partial: boolean;
};

function hasActual(row: PortfolioStructureInput): boolean {
  return row.monthRevenue !== null && row.monthRoomsSold !== null && row.monthRoomsAvailable !== null;
}

function budgetTarget(row: PortfolioStructureInput, level: BudgetLevel): number | null {
  const b = row.budgetsForMonth.find((x) => x.level === level);
  return b ? Number(b.revenue_target) : null;
}

function compareOn(
  rows: PortfolioStructureInput[],
  pickReference: (row: PortfolioStructureInput) => number | null
): PortfolioComparison | null {
  let actual = 0;
  let reference = 0;
  let coverage = 0;

  rows.forEach((row) => {
    const ref = pickReference(row);
    if (row.monthRevenue === null || ref === null) return;
    actual += row.monthRevenue;
    reference += ref;
    coverage += 1;
  });

  if (coverage === 0) return null;
  return { actual, reference, variancePct: deltaPercent(actual, reference), coverage };
}

// Totale portfolio: prima si sommano i dati base delle strutture con dati,
// poi si ricalcolano i KPI sui totali - mai media di ADR/RevPAR/Occupancy.
export function aggregatePortfolioPerformance(
  rows: PortfolioStructureInput[],
  options: { hasLoadError?: boolean } = {}
): PortfolioPerformance {
  const included = rows.filter(hasActual);

  const revenue = included.length > 0 ? included.reduce((sum, r) => sum + (r.monthRevenue as number), 0) : null;
  const roomsSold = included.length > 0 ? included.reduce((sum, r) => sum + (r.monthRoomsSold as number), 0) : null;
  const roomsAvailable =
    included.length > 0 ? included.reduce((sum, r) => sum + (r.monthRoomsAvailable as number), 0) : null;

  const pacingRows = included.filter(
    (r) => budgetTarget(r, "minimo") !== null && budgetTarget(r, "realistico") !== null
  );
  const pacingTargets = (level: BudgetLevel) => pacingRows.reduce((sum, r) => sum + (budgetTarget(r, level) as number), 0);
  const pacing =
    pacingRows.length > 0
      ? computePacingStatus(
          pacingRows.reduce((sum, r) => sum + (r.monthRevenue as number), 0),
          (["minimo", "realistico"] as const).map((level) => ({
            level,
            adr: 0,
            revenue_target: pacingTargets(level),
            room_nights_sold_target: 0,
            room_nights_available: 0,
            occupancy_pct_target: 0,
          }))
        )
      : null;

  return {
    totalStructures: rows.length,
    includedStructures: included.length,
    revenue,
    roomsSold,
    roomsAvailable,
    adr: adr(revenue, roomsSold),
    revpar: revPar(revenue, roomsAvailable),
    occupancy: occupancy(roomsSold, roomsAvailable),
    lastYear: compareOn(included, (r) => r.lastYearMonthRevenue),
    sdly: compareOn(included, (r) => r.sdlyMonthRevenue),
    budget: {
      minimo: compareOn(included, (r) => budgetTarget(r, "minimo")),
      realistico: compareOn(included, (r) => budgetTarget(r, "realistico")),
      sfidante: compareOn(included, (r) => budgetTarget(r, "sfidante")),
    },
    pacing,
    pacingCoverage: pacingRows.length,
    partial: Boolean(options.hasLoadError),
  };
}

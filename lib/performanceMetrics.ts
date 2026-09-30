export const ND = "ND";

export type SnapshotRow = {
  stay_date: string;
  revenue_total: number;
  rooms_sold: number;
  rooms_available: number;
  arrivals: number;
  presences: number;
  status: "otb" | "in_corso" | "consuntivo" | string;
};

export type BudgetRow = {
  level: "minimo" | "realistico" | "sfidante";
  adr: number;
  revenue_target: number;
  room_nights_sold_target: number;
  room_nights_available: number;
  occupancy_pct_target: number;
};

export type PacingStatus = "red" | "yellow" | "green" | null;

export function todayString(): string {
  return new Date().toISOString().split("T")[0];
}

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function sdlyDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y - 1, m - 1, d));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function monthRange(dateStr: string) {
  const [y, m] = dateStr.split("-").map(Number);
  const start = `${y}-${pad(m)}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${y}-${pad(m)}-${pad(lastDay)}`;
  return { start, end, year: y, month: m, daysInMonth: lastDay };
}

export function formatCurrency(value: number | null): string {
  if (value === null) return ND;
  // useGrouping esplicito: senza, alcuni browser (Chromium con questa
  // versione di dati it-IT) non raggruppano le migliaia sotto 10.000
  // ma lo fanno sopra - risultato incoerente tipo "4936 €" vs "12.355 €".
  return value.toLocaleString("it-IT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
    useGrouping: "always",
  });
}

export function formatSignedCurrency(value: number | null): string {
  if (value === null) return ND;
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatCurrency(value)}`;
}

export function formatCurrencyCents(value: number | null): string {
  if (value === null) return ND;
  return value.toLocaleString("it-IT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: "always",
  });
}

export function formatNumber(value: number | null, digits = 0): string {
  if (value === null) return ND;
  return value.toLocaleString("it-IT", { maximumFractionDigits: digits, useGrouping: "always" });
}

export function formatPercent(value: number | null): string {
  if (value === null) return ND;
  return `${(value * 100).toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`;
}

export function occupancy(sold: number | null, available: number | null): number | null {
  if (sold === null || available === null || available === 0) return null;
  return sold / available;
}

export function adr(revenue: number | null, roomsSold: number | null): number | null {
  if (revenue === null || roomsSold === null || roomsSold === 0) return null;
  return revenue / roomsSold;
}

export function revPar(revenue: number | null, roomsAvailable: number | null): number | null {
  if (revenue === null || roomsAvailable === null || roomsAvailable === 0) return null;
  return revenue / roomsAvailable;
}

export function los(roomsSold: number | null, arrivals: number | null): number | null {
  if (roomsSold === null || arrivals === null || arrivals === 0) return null;
  return roomsSold / arrivals;
}

// ============ RN / ADR TO GOAL ============
// Tre grandezze tenute separate, mai fuse in un solo numero:
//   - target teorico: RN che il budget del livello target prevedeva di
//     vendere ancora (% Occupazione target x Room night disponibili del
//     livello) - Room night gia' vendute. Informativo: NON dice quante
//     camere sono ancora vendibili.
//   - capacita' reale residua: somma di max(0, rooms_available -
//     rooms_sold) sui giorni da OGGI INCLUSO a fine periodo, dalle righe
//     giornaliere di v_snapshot_latest - mai stimata dal budget.
//   - ADR operativo: gap revenue / capacita' residua.
// Il layer deterministico NON giudica se l'ADR operativo sia realistico
// (RN teoriche > RN residue non significa "non raggiungibile": puo'
// bastare un prezzo piu' alto). L'unica conclusione certa e'
// "capacity_exhausted": gap > 0 e nessuna camera ancora vendibile.

export type GoalLevel = BudgetRow["level"];

const GOAL_LEVEL_ORDER: GoalLevel[] = ["minimo", "realistico", "sfidante"];

export const goalLevelLabels: Record<GoalLevel, string> = {
  minimo: "Budget Minimo",
  realistico: "Budget Realistico",
  sfidante: "Budget Sfidante",
};

export type DailyCapacityRow = {
  stayDate: string;
  roomsSold: number | null;
  roomsAvailable: number | null;
};

export type GoalProgress =
  | { status: "achieved"; level: GoalLevel }
  | {
      // gap > 0 e capacita' residua > 0: adrNeeded sempre finito.
      status: "pending";
      level: GoalLevel;
      gapRevenue: number;
      theoreticalRoomsNeeded: number | null;
      remainingRoomNights: number;
      adrNeeded: number;
    }
  | {
      // gap > 0, nessuna camera vendibile da oggi a fine periodo (periodo
      // passato o residuo tutto venduto/indisponibile).
      status: "capacity_exhausted";
      level: GoalLevel;
      gapRevenue: number;
      theoreticalRoomsNeeded: number | null;
      remainingRoomNights: 0;
    }
  | {
      // Mancano righe giornaliere nel residuo: la capacita' non e'
      // determinabile, mai stimata dal budget.
      status: "insufficient_data";
      level: GoalLevel;
      gapRevenue: number;
      theoreticalRoomsNeeded: number | null;
    };

function finiteOrNull(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}

// Primo livello (Minimo -> Realistico -> Sfidante) non ancora raggiunto in
// revenue; null se tutti i livelli presenti sono raggiunti.
export function selectGoalLevel(monthRevenue: number, budgets: BudgetRow[]): BudgetRow | null {
  for (const level of GOAL_LEVEL_ORDER) {
    const budget = budgets.find((b) => b.level === level);
    if (budget && monthRevenue < Number(budget.revenue_target)) return budget;
  }
  return null;
}

// Room night ancora vendibili da max(oggi, inizio periodo) a fine periodo,
// oggi incluso. 0 per un periodo passato; null se anche un solo giorno del
// residuo non ha una riga (o ha valori mancanti).
export function computeRemainingRoomNights(
  dailyRows: DailyCapacityRow[],
  periodStart: string,
  periodEnd: string,
  today: string
): number | null {
  const windowStart = today > periodStart ? today : periodStart;
  if (windowStart > periodEnd) return 0;

  const byDate = new Map(dailyRows.map((r) => [r.stayDate, r]));
  let remaining = 0;
  for (let day = windowStart; day <= periodEnd; day = shiftDate(day, 1)) {
    const row = byDate.get(day);
    if (!row || row.roomsAvailable === null || row.roomsSold === null) return null;
    const free = Number(row.roomsAvailable) - Number(row.roomsSold);
    if (!Number.isFinite(free)) return null;
    remaining += Math.max(0, free);
  }
  return remaining;
}

// null (ND) se manca l'OTB o il budget Minimo, come prima.
export function computeGoalProgress(params: {
  monthRevenue: number | null;
  roomsSold: number | null;
  budgets: BudgetRow[];
  dailyRows: DailyCapacityRow[];
  periodStart: string;
  periodEnd: string;
  today: string;
}): GoalProgress | null {
  const { monthRevenue, roomsSold, budgets, dailyRows, periodStart, periodEnd, today } = params;
  if (monthRevenue === null || !budgets.some((b) => b.level === "minimo")) return null;

  const target = selectGoalLevel(monthRevenue, budgets);
  if (target === null) {
    const highest = [...GOAL_LEVEL_ORDER].reverse().find((l) => budgets.some((b) => b.level === l))!;
    return { status: "achieved", level: highest };
  }

  const gapRevenue = Number(target.revenue_target) - monthRevenue;
  const theoretical =
    roomsSold === null
      ? null
      : finiteOrNull(Number(target.occupancy_pct_target) * Number(target.room_nights_available) - roomsSold);
  const theoreticalRoomsNeeded = theoretical === null ? null : Math.max(0, theoretical);

  const remaining = computeRemainingRoomNights(dailyRows, periodStart, periodEnd, today);
  if (remaining === null) {
    return { status: "insufficient_data", level: target.level, gapRevenue, theoreticalRoomsNeeded };
  }
  if (remaining === 0) {
    return { status: "capacity_exhausted", level: target.level, gapRevenue, theoreticalRoomsNeeded, remainingRoomNights: 0 };
  }

  return {
    status: "pending",
    level: target.level,
    gapRevenue,
    theoreticalRoomsNeeded,
    remainingRoomNights: remaining,
    adrNeeded: gapRevenue / remaining,
  };
}

export function computePacingStatus(
  monthRevenue: number | null,
  budgetsForMonth: BudgetRow[]
): PacingStatus {
  if (monthRevenue === null) return null;

  const minimo = budgetsForMonth.find((b) => b.level === "minimo");
  const realistico = budgetsForMonth.find((b) => b.level === "realistico");

  if (!minimo || !realistico) return null;

  if (monthRevenue < Number(minimo.revenue_target)) return "red";
  if (monthRevenue < Number(realistico.revenue_target)) return "yellow";
  return "green";
}

export function pacingDetail(monthRevenue: number | null, minimoTarget: number | null): string | null {
  if (monthRevenue === null || minimoTarget === null) return null;

  const diff = monthRevenue - minimoTarget;
  const diffFormatted = formatCurrency(Math.abs(diff));

  if (diff < 0) {
    return `Budget Minimo: ${formatCurrency(minimoTarget)} — mancano ${diffFormatted}`;
  }

  return `Budget Minimo: ${formatCurrency(minimoTarget)} — +${diffFormatted} sopra Minimo`;
}

export const pacingLabels: Record<Exclude<PacingStatus, null>, string> = {
  red: "Sotto Minimo",
  yellow: "Tra Minimo e Realistico",
  green: "Sopra Realistico",
};

export const pacingDotClasses: Record<Exclude<PacingStatus, null>, string> = {
  red: "bg-[#b6423f]",
  yellow: "bg-[#d6a729]",
  green: "bg-[#2f7d43]",
};

export function deltaPercent(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / previous;
}

export function formatDelta(current: number | null, previous: number | null) {
  const delta = deltaPercent(current, previous);

  if (delta === null) {
    return { text: ND, colorClass: "text-[#6a6d70]" };
  }

  const sign = delta > 0 ? "+" : "";
  const text = `${sign}${(delta * 100).toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`;
  const colorClass = delta > 0 ? "text-[#2f7d43]" : delta < 0 ? "text-[#8a3a3a]" : "text-[#6a6d70]";

  return { text, colorClass };
}

export function sumSnapshots(rows: SnapshotRow[]) {
  if (rows.length === 0) {
    return { revenue: null, roomsSold: null, roomsAvailable: null, arrivals: null, presences: null, daysWithData: 0 };
  }

  const totals = rows.reduce(
    (acc, row) => ({
      revenue: acc.revenue + Number(row.revenue_total),
      roomsSold: acc.roomsSold + Number(row.rooms_sold),
      roomsAvailable: acc.roomsAvailable + Number(row.rooms_available),
      arrivals: acc.arrivals + Number(row.arrivals),
      presences: acc.presences + Number(row.presences),
    }),
    { revenue: 0, roomsSold: 0, roomsAvailable: 0, arrivals: 0, presences: 0 }
  );

  return { ...totals, daysWithData: rows.length };
}

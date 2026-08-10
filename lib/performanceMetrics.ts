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

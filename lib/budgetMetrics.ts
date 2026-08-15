export type BudgetLevel = "minimo" | "realistico" | "sfidante";
export type BudgetStatus = "draft" | "pending" | "confirmed" | "rejected";

export const BUDGET_LEVELS: BudgetLevel[] = ["minimo", "realistico", "sfidante"];

export const budgetLevelLabels: Record<BudgetLevel, string> = {
  minimo: "Minimo",
  realistico: "Realistico",
  sfidante: "Sfidante",
};

export const MONTH_NAMES_IT = [
  "Gennaio",
  "Febbraio",
  "Marzo",
  "Aprile",
  "Maggio",
  "Giugno",
  "Luglio",
  "Agosto",
  "Settembre",
  "Ottobre",
  "Novembre",
  "Dicembre",
];

export type BudgetRow = {
  id: string;
  structure_id: string;
  season_year: number;
  month: number;
  level: BudgetLevel;
  adr: number | null;
  revenue_target: number | null;
  room_nights_sold_target: number | null;
  room_nights_available: number | null;
  occupancy_pct_target: number | null;
  status: BudgetStatus;
  valid_from: string;
  created_by: string;
  created_at: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
};

// Giorni reali del mese (28-31), mai un valore fisso - Date(year, month, 0)
// da' l'ultimo giorno del mese "month" (1-based) in locale, coerente col
// resto del progetto che usa questa costruzione per calcoli di calendario.
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

// RN.AV proposto = n_rooms x giorni di apertura nel mese. daysOpen di
// default e' daysInMonth (apertura piena) - un valore diverso arriva solo
// da un override esplicito in structure_opening_calendar.
export function proposedRoomNightsAvailable(nRooms: number, daysOpen: number): number {
  return nRooms * daysOpen;
}

// Produzione = adr x RN.S: unica formula non gia' coperta da
// lib/performanceMetrics.ts (revPar/occupancy/adr riusati direttamente da
// li' per le altre metriche derivate, sia lato budget che lato storico
// actual - stessa formula, stessi nomi, mai duplicata due volte).
export function computeRevenue(adr: number | null, roomNightsSold: number | null): number | null {
  if (adr === null || roomNightsSold === null) return null;
  return adr * roomNightsSold;
}

export type MetricSet = {
  adr: number | null;
  rns: number | null;
  rnav: number | null;
  revenue: number | null;
  revpar: number | null;
  occ: number | null;
};

export type MetricKey = keyof MetricSet;

export const METRIC_ORDER: MetricKey[] = ["adr", "rns", "rnav", "revpar", "occ", "revenue"];

export const metricLabels: Record<MetricKey, string> = {
  adr: "ADR",
  rns: "RN.S",
  rnav: "RN.AV",
  revpar: "RevPAR",
  occ: "% Occ.",
  revenue: "Produzione",
};

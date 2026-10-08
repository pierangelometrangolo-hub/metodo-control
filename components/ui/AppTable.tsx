"use client";

import { createContext, ReactNode, useContext } from "react";

// Stato di una riga. "current", "future" e "closed" sono stati TEMPORALI e
// restano neutri: i colori di performance (positivo, attenzione, critico)
// non si usano mai per dire "in corso" o "futuro". "total" e' la riga di
// sintesi. "header" e' la riga di intestazione.
export type AppTableRowState = "default" | "current" | "future" | "closed" | "total" | "header";

const RowStateContext = createContext<AppTableRowState>("default");

const rowClasses: Record<AppTableRowState, string> = {
  default: "border-b border-mc-border-subtle bg-mc-surface",
  current: "border-b border-mc-border-subtle bg-mc-temporal-current",
  future: "border-b border-mc-border-subtle bg-mc-surface",
  closed: "border-b border-mc-border-subtle bg-mc-surface",
  total: "border-t-2 border-mc-border-strong bg-mc-surface-summary font-semibold text-mc-text",
  header: "border-b border-mc-border bg-mc-surface-summary text-[12px] font-semibold text-mc-text-label",
};

// Sfondo della cella fissa: deve coincidere con quello della riga, altrimenti
// le celle che scorrono sotto resterebbero visibili.
const stickyBackground: Record<AppTableRowState, string> = {
  default: "bg-mc-surface",
  current: "bg-mc-temporal-current",
  future: "bg-mc-surface",
  closed: "bg-mc-surface",
  total: "bg-mc-surface-summary",
  header: "bg-mc-surface-summary",
};

const cellPadding: Record<AppTableRowState, string> = {
  default: "py-1",
  current: "py-1",
  future: "py-1",
  closed: "py-1",
  total: "py-2",
  header: "py-2",
};

// Filetto a sinistra sulla prima cella della riga in corso: segnala lo
// stato temporale senza usare un colore di performance.
const firstCellAccent: Partial<Record<AppTableRowState, string>> = {
  current: "first:shadow-[inset_3px_0_0_0_var(--color-teal)]",
};

type AppTableProps = {
  children: ReactNode;
  // Larghezza minima prima dello scroll orizzontale, es. "min-w-[1080px]".
  minWidthClassName?: string;
  className?: string;
};

export function AppTable({ children, minWidthClassName = "", className = "" }: AppTableProps) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className={`w-full border-collapse text-[13px] ${minWidthClassName}`}>{children}</table>
    </div>
  );
}

type AppTableRowProps = {
  children: ReactNode;
  state?: AppTableRowState;
  className?: string;
};

export function AppTableRow({ children, state = "default", className = "" }: AppTableRowProps) {
  return (
    <RowStateContext.Provider value={state}>
      <tr className={`align-middle ${rowClasses[state]} ${className}`}>{children}</tr>
    </RowStateContext.Provider>
  );
}

type AppTableCellProps = {
  children?: ReactNode;
  // Cella numerica: allineata a destra, cifre a larghezza fissa.
  numeric?: boolean;
  // Cella fissa a sinistra durante lo scroll orizzontale.
  sticky?: boolean;
  // Prima cella di un gruppo logico di colonne: separatore leggero a sinistra.
  groupStart?: boolean;
  className?: string;
};

// Rende <th> nella riga di intestazione, <td> nelle altre.
export function AppTableCell({
  children,
  numeric = false,
  sticky = false,
  groupStart = false,
  className = "",
}: AppTableCellProps) {
  const state = useContext(RowStateContext);
  const Tag = state === "header" ? "th" : "td";
  const classes = [
    cellPadding[state],
    "pr-4 first:pl-3 last:pr-3",
    groupStart ? "border-l border-mc-border-subtle pl-4" : "",
    firstCellAccent[state] ?? "",
    numeric ? "text-right tabular-nums" : "text-left",
    // hover/has: porta in primo piano la cella fissa quando un suo tooltip e' aperto.
    sticky ? `sticky left-0 z-[1] hover:z-20 has-[.opacity-100]:z-20 ${stickyBackground[state]}` : "",
    className,
  ];

  return <Tag className={classes.filter(Boolean).join(" ")}>{children}</Tag>;
}

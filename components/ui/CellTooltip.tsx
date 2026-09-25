"use client";

import { useEffect, useState } from "react";

type CellTooltipProps = {
  trigger: React.ReactNode;
  children: React.ReactNode;
  // Default invariato per i chiamanti esistenti (celle di tabella a piena
  // larghezza). Passare "inline-flex" per un trigger inline accanto ad
  // altro testo (es. un badge accanto a un'etichetta), non solo dentro una
  // cella di tabella.
  className?: string;
  // Default "bottom" invariato. "top" per celle in fondo a un contenitore
  // scrollabile (es. riga <tfoot> di una tabella in overflow-x-auto), dove
  // un tooltip aperto verso il basso verrebbe tagliato.
  placement?: "top" | "bottom";
  // Default "left" invariato. "right" per le ultime colonne di una tabella,
  // dove un tooltip largo 16rem allineato a sinistra uscirebbe dal bordo.
  align?: "left" | "right";
};

// Stesso pattern hover/tap di InfoTooltip, ma pensato per avvolgere il
// contenuto compatto di una cella (non una sola icona "i") dentro righe di
// tabella cliccabili: lo stopPropagation sul trigger evita che un tap per
// aprire il tooltip su mobile navighi anche verso il drill-down.
export function CellTooltip({
  trigger,
  children,
  className = "block w-full",
  placement = "bottom",
  align = "left",
}: CellTooltipProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    function handleClickOutside() {
      setOpen(false);
    }

    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [open]);

  return (
    <span className={`group relative cursor-help ${className}`}>
      <span
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        {trigger}
      </span>

      <span
        role="tooltip"
        className={`absolute ${align === "right" ? "right-0" : "left-0"} ${placement === "top" ? "bottom-full mb-2" : "top-full mt-2"} z-10 w-64 rounded-[10px] border border-[#e7dfd8] bg-white p-3 text-[11px] font-normal normal-case leading-5 text-[#2B2D2F] shadow-[0_8px_20px_rgba(43,45,47,0.14)] transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0 group-hover:opacity-100"
        }`}
      >
        {children}
      </span>
    </span>
  );
}

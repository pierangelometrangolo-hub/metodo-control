"use client";

import { useEffect, useState } from "react";

type CellTooltipProps = {
  trigger: React.ReactNode;
  children: React.ReactNode;
};

// Stesso pattern hover/tap di InfoTooltip, ma pensato per avvolgere il
// contenuto compatto di una cella (non una sola icona "i") dentro righe di
// tabella cliccabili: lo stopPropagation sul trigger evita che un tap per
// aprire il tooltip su mobile navighi anche verso il drill-down.
export function CellTooltip({ trigger, children }: CellTooltipProps) {
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
    <span className="group relative inline-block cursor-help">
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
        className={`absolute left-0 top-full z-10 mt-2 w-64 rounded-[10px] border border-[#e7dfd8] bg-white p-3 text-[11px] font-normal normal-case leading-5 text-[#2B2D2F] shadow-[0_8px_20px_rgba(43,45,47,0.14)] transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0 group-hover:opacity-100"
        }`}
      >
        {children}
      </span>
    </span>
  );
}

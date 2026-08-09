"use client";

import { useEffect, useState } from "react";

type InfoTooltipProps = {
  text: string;
};

export function InfoTooltip({ text }: InfoTooltipProps) {
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
    <span className="group relative ml-1 inline-flex align-middle">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-[#c7bfb6] text-[9px] font-bold normal-case text-[#6b625c] hover:border-[#017A92] hover:text-[#017A92]"
        aria-label="Informazioni"
      >
        i
      </button>

      <span
        role="tooltip"
        className={`absolute bottom-full left-1/2 z-10 mb-2 w-56 -translate-x-1/2 rounded-[10px] border border-[#e7dfd8] bg-white p-3 text-[11px] font-normal normal-case leading-4 text-[#2B2D2F] shadow-[0_8px_20px_rgba(43,45,47,0.14)] transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0 group-hover:opacity-100"
        }`}
      >
        {text}
      </span>
    </span>
  );
}

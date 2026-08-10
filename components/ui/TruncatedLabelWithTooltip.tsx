"use client";

import { useEffect, useState } from "react";

type TruncatedLabelWithTooltipProps = {
  text: string;
  widthClassName?: string;
};

export function TruncatedLabelWithTooltip({
  text,
  widthClassName = "w-36",
}: TruncatedLabelWithTooltipProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  return (
    // "relative" e la dimensione stanno sul contenitore ESTERNO, senza
    // overflow-hidden: il troncamento (truncate) sta solo sullo span
    // interno. Se stessero sullo stesso elemento, l'overflow:hidden di
    // "truncate" taglierebbe via anche il tooltip assoluto al suo interno.
    <span
      className={`group relative ${widthClassName} shrink-0 cursor-default`}
      onClick={(e) => {
        e.stopPropagation();
        setOpen((prev) => !prev);
      }}
    >
      <span className="block truncate text-sm text-[#2B2D2F]">{text}</span>
      <span
        role="tooltip"
        className={`absolute left-0 top-full z-20 mt-1 w-max max-w-[220px] rounded-[8px] border border-[#e7dfd8] bg-white px-2 py-1 text-[11px] normal-case leading-4 text-[#2B2D2F] shadow-[0_8px_20px_rgba(43,45,47,0.14)] transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0 group-hover:opacity-100"
        }`}
      >
        {text}
      </span>
    </span>
  );
}

"use client";

import { useEffect, useState } from "react";
import { pad } from "@/lib/performanceMetrics";

type CalendarProps = {
  value: string;
  onChange: (date: string) => void;
  highlightedDates: Set<string>;
  anomalyDates?: Set<string>;
  legendLabel?: string;
  // Modalita' intervallo: quando attiva, il click seleziona un range di
  // date invece di un giorno singolo. onChange resta inutilizzato in
  // questa modalita'.
  rangeMode?: boolean;
  rangeStart?: string | null;
  rangeEnd?: string | null;
  onRangeChange?: (start: string | null, end: string | null) => void;
};

const WEEKDAY_LABELS = ["L", "M", "M", "G", "V", "S", "D"];
export const MONTH_LABELS = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
];

function toDateString(y: number, m: number, d: number) {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

export function Calendar({
  value,
  onChange,
  highlightedDates,
  anomalyDates = new Set(),
  legendLabel = "giorni con un import reale registrato per questa struttura",
  rangeMode = false,
  rangeStart = null,
  rangeEnd = null,
  onRangeChange,
}: CalendarProps) {
  const [y, m] = value.split("-").map(Number);
  const [viewYear, setViewYear] = useState(y);
  const [viewMonth, setViewMonth] = useState(m - 1);

  // Il valore "value" puo' cambiare anche da un controllo esterno al
  // calendario (es. un filtro mese/anno altrove nella pagina), non solo
  // cliccando un giorno qui dentro: la vista deve seguirlo.
  useEffect(() => {
    const [nextYear, nextMonth] = value.split("-").map(Number);
    setViewYear(nextYear);
    setViewMonth(nextMonth - 1);
  }, [value]);

  const firstOfMonth = new Date(Date.UTC(viewYear, viewMonth, 1));
  const startWeekday = (firstOfMonth.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();

  const cells: (number | null)[] = [
    ...Array(startWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  function goToPrevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  }

  function goToNextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  }

  function handleDayClick(dateStr: string) {
    if (!rangeMode) {
      onChange(dateStr);
      return;
    }

    if (!onRangeChange) return;

    const pickingNewRange = !rangeStart || (rangeStart && rangeEnd);

    if (pickingNewRange) {
      onRangeChange(dateStr, null);
    } else {
      const start = dateStr < rangeStart! ? dateStr : rangeStart!;
      const end = dateStr < rangeStart! ? rangeStart! : dateStr;
      onRangeChange(start, end);
    }
  }

  return (
    <div className="w-full max-w-[280px] rounded-[14px] border border-[#e7dfd8] bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={goToPrevMonth}
          className="flex h-7 w-7 items-center justify-center rounded-full text-[#6a6d70] hover:bg-[#f8f6f2]"
        >
          ‹
        </button>
        <p className="text-[13px] font-semibold text-[#2B2D2F]">
          {MONTH_LABELS[viewMonth]} {viewYear}
        </p>
        <button
          type="button"
          onClick={goToNextMonth}
          className="flex h-7 w-7 items-center justify-center rounded-full text-[#6a6d70] hover:bg-[#f8f6f2]"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((label, i) => (
          <div key={i} className="text-center text-[10px] font-semibold uppercase text-[#a8a29c]">
            {label}
          </div>
        ))}

        {cells.map((day, i) => {
          if (day === null) return <div key={i} />;

          const dateStr = toDateString(viewYear, viewMonth, day);
          const isHighlighted = highlightedDates.has(dateStr);
          const hasAnomaly = anomalyDates.has(dateStr);

          const isSelected = rangeMode
            ? dateStr === rangeStart || dateStr === rangeEnd
            : dateStr === value;
          const isInRange =
            rangeMode && !!rangeStart && !!rangeEnd && dateStr > rangeStart && dateStr < rangeEnd;

          const titleParts = [
            isHighlighted ? "Estrazione BD presente per questa data" : null,
            hasAnomaly ? "Attenzione: camere vendute superiori alle disponibili (dato sorgente BD)" : null,
          ].filter(Boolean);

          return (
            <button
              key={i}
              type="button"
              onClick={() => handleDayClick(dateStr)}
              className={`relative flex h-8 w-8 flex-col items-center justify-center text-[12px] transition ${
                isSelected
                  ? "rounded-full bg-[#017A92] font-semibold text-white"
                  : isInRange
                    ? "rounded-none bg-[#e5f2f5] text-[#2B2D2F]"
                    : "rounded-full text-[#2B2D2F] hover:bg-[#f3f8fa]"
              }`}
              title={titleParts.length > 0 ? titleParts.join(" · ") : undefined}
            >
              {day}
              {isHighlighted && (
                <span
                  className={`absolute bottom-[3px] h-[4px] w-[4px] rounded-full ${
                    isSelected ? "bg-white" : "bg-[#017A92]"
                  }`}
                />
              )}
              {hasAnomaly && (
                <span className="absolute right-[1px] top-[1px] flex h-[10px] w-[10px] items-center justify-center rounded-full bg-[#b6423f] text-[7px] font-bold leading-none text-white">
                  !
                </span>
              )}
            </button>
          );
        })}
      </div>

      {rangeMode && (
        <p className="mt-3 text-[11px] leading-4 text-[#017A92]">
          {!rangeStart
            ? "Clicca il primo giorno dell'intervallo."
            : !rangeEnd
              ? "Ora clicca l'ultimo giorno dell'intervallo."
              : `Intervallo selezionato: ${rangeStart} → ${rangeEnd}`}
        </p>
      )}

      <p className="mt-3 text-[11px] leading-4 text-[#6a6d70]">
        <span className="mr-1 inline-block h-[4px] w-[4px] rounded-full bg-[#017A92] align-middle" />
        {legendLabel}
      </p>
      <p className="mt-1 text-[11px] leading-4 text-[#6a6d70]">
        <span className="mr-1 inline-flex h-[10px] w-[10px] items-center justify-center rounded-full bg-[#b6423f] align-middle text-[7px] font-bold leading-none text-white">
          !
        </span>
        camere vendute superiori alle disponibili (dato così come arriva da BD)
      </p>
    </div>
  );
}

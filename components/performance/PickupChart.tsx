"use client";

import { useState } from "react";

export type PickupPoint = {
  extractionDate: string;
  revenue: number;
};

type PickupChartProps = {
  points: PickupPoint[];
};

const WIDTH = 640;
const HEIGHT = 220;
const PADDING = { top: 16, right: 16, bottom: 28, left: 56 };
const LINE_COLOR = "#017A92";
const GRID_COLOR = "#e7dfd8";
const TEXT_COLOR = "#6a6d70";

function formatShortDate(dateStr: string) {
  const [, m, d] = dateStr.split("-");
  return `${d}/${m}`;
}

function formatCurrencyShort(value: number) {
  return value.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

export function PickupChart({ points }: PickupChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const sorted = [...points].sort((a, b) => a.extractionDate.localeCompare(b.extractionDate));
  const recent = sorted.slice(-8);

  if (recent.length < 2) {
    return (
      <p className="rounded-[12px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 py-6 text-center text-sm text-[#6a6d70]">
        Dato insufficiente per il grafico pickup: servono almeno 2 estrazioni diverse per questo giorno
        {recent.length === 1 ? " (al momento ne esiste solo 1)" : ""}.
      </p>
    );
  }

  const values = recent.map((p) => p.revenue);
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(...values) * 1.1 || 1;

  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;

  function xFor(index: number) {
    return PADDING.left + (index / (recent.length - 1)) * plotWidth;
  }

  function yFor(value: number) {
    const ratio = (value - minValue) / (maxValue - minValue || 1);
    return PADDING.top + plotHeight - ratio * plotHeight;
  }

  const linePath = recent.map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i)} ${yFor(p.revenue)}`).join(" ");

  const gridLines = [0, 0.5, 1].map((t) => minValue + t * (maxValue - minValue));

  const lastPoint = recent[recent.length - 1];

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label="Grafico pickup revenue">
        {gridLines.map((gv, i) => (
          <g key={i}>
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={yFor(gv)}
              y2={yFor(gv)}
              stroke={GRID_COLOR}
              strokeWidth={1}
            />
            <text x={PADDING.left - 8} y={yFor(gv) + 4} textAnchor="end" fontSize={10} fill={TEXT_COLOR}>
              {formatCurrencyShort(gv)}
            </text>
          </g>
        ))}

        <path d={linePath} fill="none" stroke={LINE_COLOR} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {recent.map((p, i) => (
          <g key={p.extractionDate}>
            <circle
              cx={xFor(i)}
              cy={yFor(p.revenue)}
              r={5}
              fill={LINE_COLOR}
              stroke="#ffffff"
              strokeWidth={2}
              onMouseEnter={() => setHoverIndex(i)}
              onMouseLeave={() => setHoverIndex(null)}
              style={{ cursor: "pointer" }}
            />
            <text x={xFor(i)} y={HEIGHT - 8} textAnchor="middle" fontSize={10} fill={TEXT_COLOR}>
              {formatShortDate(p.extractionDate)}
            </text>
          </g>
        ))}

        <text
          x={xFor(recent.length - 1)}
          y={yFor(lastPoint.revenue) - 12}
          textAnchor="end"
          fontSize={11}
          fontWeight={600}
          fill="#2B2D2F"
        >
          {formatCurrencyShort(lastPoint.revenue)}
        </text>
      </svg>

      {hoverIndex !== null && (
        <div
          className="pointer-events-none absolute rounded-[8px] border border-[#e7dfd8] bg-white px-2 py-1 text-[11px] text-[#2B2D2F] shadow-[0_4px_12px_rgba(43,45,47,0.12)]"
          style={{
            left: `${(xFor(hoverIndex) / WIDTH) * 100}%`,
            top: `${(yFor(recent[hoverIndex].revenue) / HEIGHT) * 100}%`,
            transform: "translate(-50%, -130%)",
          }}
        >
          <p className="font-semibold">{formatCurrencyShort(recent[hoverIndex].revenue)}</p>
          <p className="text-[#6a6d70]">estrazione del {recent[hoverIndex].extractionDate}</p>
        </div>
      )}
    </div>
  );
}

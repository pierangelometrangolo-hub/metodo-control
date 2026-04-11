"use client";

import { useMemo } from "react";
import { TrackingEntry } from "@/lib/tracking";

type TrackingStatsProps = {
  entries: TrackingEntry[];
  onOpenAnalysis?: (focus?: {
    type: "all" | "reference" | "activity" | "operator" | "area";
    value?: string;
  }) => void;
};

type OverviewCard = {
  label: string;
  value: string | number;
  note: string;
  focus?: {
    type: "all" | "reference" | "activity" | "operator" | "area";
    value?: string;
  };
};

export default function TrackingStats({
  entries,
  onOpenAnalysis,
}: TrackingStatsProps) {
  const today = new Date().toISOString().split("T")[0];

  const todayEntries = useMemo(() => {
    return entries.filter((entry) => entry.date === today);
  }, [entries, today]);

  const cards = useMemo<OverviewCard[]>(() => {
    const totalEntries = todayEntries.length;

    const totalMinutes = todayEntries.reduce(
      (sum, entry) => sum + entry.minutes,
      0
    );

    const referenceTotals = Object.entries(
      todayEntries.reduce<Record<string, number>>((acc, entry) => {
        acc[entry.referenceName] = (acc[entry.referenceName] || 0) + entry.minutes;
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1]);

    const activityTotals = Object.entries(
      todayEntries.reduce<Record<string, number>>((acc, entry) => {
        acc[entry.activity] = (acc[entry.activity] || 0) + entry.minutes;
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1]);

    const areaTotals = Object.entries(
      todayEntries.reduce<Record<string, number>>((acc, entry) => {
        acc[entry.macroArea] = (acc[entry.macroArea] || 0) + entry.minutes;
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1]);

    const topReference = referenceTotals[0]?.[0] ?? "—";
    const topActivity = activityTotals[0]?.[0] ?? "—";
    const topArea = areaTotals[0]?.[0] ?? "—";

    return [
      {
        label: "Totali",
        value: totalEntries,
        note: "Registrazioni inserite oggi",
        focus: { type: "all" },
      },
      {
        label: "Minuti",
        value: totalMinutes,
        note: "Tempo registrato oggi",
        focus: { type: "all" },
      },
      {
        label: "Top attività",
        value: formatActivity(topActivity),
        note: "Attività che pesa di più oggi",
        focus:
          topActivity !== "—"
            ? { type: "activity", value: topActivity }
            : { type: "all" },
      },
      {
        label: "Area prevalente",
        value: formatMacroArea(topArea),
        note: "Area che assorbe più tempo oggi",
        focus:
          topArea !== "—"
            ? { type: "area", value: topArea }
            : { type: "all" },
      },
      {
        label: "Top riferimento",
        value: topReference,
        note: "Maggiore assorbimento oggi",
        focus:
          topReference !== "—"
            ? { type: "reference", value: topReference }
            : { type: "all" },
      },
    ];
  }, [todayEntries]);

  return (
    <section className="space-y-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#017A92]">
          Overview del giorno
        </p>
        <p className="mt-1 text-sm leading-6 text-[#666666]">
          Lettura rapida di ciò che sta accadendo oggi. Clicca un riquadro per
          aprire il dettaglio nella sezione analisi.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        {cards.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => onOpenAnalysis?.(item.focus)}
            className="rounded-[20px] border border-[#e7dfd8] bg-white p-4 text-left transition shadow-[0_8px_20px_rgba(43,45,47,0.04)] hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(43,45,47,0.07)]"
          >
            <div className="mb-3 h-1.5 w-10 rounded-full bg-[#017A92]" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#017A92]">
              {item.label}
            </p>
            <p className="mt-3 break-words text-[28px] font-semibold leading-[1.05] tracking-[-0.03em] text-[#2B2D2F]">
              {item.value}
            </p>
            <p className="mt-3 text-sm leading-6 text-[#666666]">{item.note}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

function formatMacroArea(value: string) {
  switch (value) {
    case "consulenza":
      return "Consulenza";
    case "projects":
      return "Projects";
    case "commerciale":
      return "Commerciale";
    case "sales-marketing":
      return "Sales & Marketing";
    case "amministrazione-finance":
      return "Amministrazione & Finance";
    default:
      return value;
  }
}

function formatActivity(value: string) {
  switch (value) {
    case "call":
      return "Call";
    case "email":
      return "Email";
    case "whatsapp":
      return "WhatsApp";
    case "meeting":
      return "Meeting";
    case "follow up":
      return "Follow up";
    case "analisi":
      return "Analisi";
    case "reportistica":
      return "Reportistica";
    case "amministrazione":
      return "Amministrazione";
    case "organizzazione":
      return "Organizzazione";
    case "coordinamento":
      return "Coordinamento";
    default:
      return value;
  }
}
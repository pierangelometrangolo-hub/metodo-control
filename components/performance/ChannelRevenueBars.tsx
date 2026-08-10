"use client";

import { formatCurrency, ND } from "@/lib/performanceMetrics";
import { TruncatedLabelWithTooltip } from "@/components/ui/TruncatedLabelWithTooltip";

export type ChannelRevenueDatum = {
  channel: string;
  revenue: number;
};

type ChannelRevenueBarsProps = {
  data: ChannelRevenueDatum[];
};

const POSITIVE_COLOR = "#017A92";
const NEGATIVE_COLOR = "#b6423f";

// Loghi reali forniti in public/images/logos/. CRM e le due varianti di
// Booking Engine condividono booking-designer.png perché gestiti dallo
// stesso strumento (Booking Designer), non da un canale di vendita proprio.
const CHANNEL_LOGOS: Record<string, string> = {
  "Booking.com": "/images/logos/booking-com.png",
  Expedia: "/images/logos/expedia.png",
  CRM: "/images/logos/booking-designer.png",
  "Booking Engine": "/images/logos/booking-designer.png",
  "Booking Engine - Advance": "/images/logos/booking-designer.png",
};

// Fallback per canali senza logo disponibile (es. "Imperatore Travel"):
// colore pieno deterministico invece di uno spazio vuoto.
const FALLBACK_PALETTE = ["#8a6a1f", "#2f7d43", "#5c6bc0", "#8a3a3a", "#5f6368"];

function colorForChannel(channel: string): string {
  let hash = 0;
  for (let i = 0; i < channel.length; i++) {
    hash = (hash * 31 + channel.charCodeAt(i)) >>> 0;
  }
  return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length];
}

function formatPercent1(value: number) {
  return `${value.toLocaleString("it-IT", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
}

function ChannelBadge({ channel, leftPct }: { channel: string; leftPct: number }) {
  const logoSrc = CHANNEL_LOGOS[channel];

  return (
    <span
      className="absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full border-2 border-white bg-white shadow-[0_0_0_1px_rgba(43,45,47,0.12)]"
      style={{ left: `${leftPct}%` }}
      title={channel}
    >
      {logoSrc ? (
        // Loghi di marchi terzi (Booking.com/Expedia) o dello strumento
        // interno (Booking Designer): immagini statiche in public/, non
        // serve next/image per un'icona 24px a dimensione fissa.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoSrc} alt={channel} className="h-full w-full object-cover" />
      ) : (
        <span className="block h-full w-full" style={{ backgroundColor: colorForChannel(channel) }} />
      )}
    </span>
  );
}

export function ChannelRevenueBars({ data }: ChannelRevenueBarsProps) {
  if (data.length === 0) {
    return (
      <p className="rounded-[12px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 py-6 text-center text-sm text-[#6a6d70]">
        {ND} — nessun dato canale importato per questo periodo.
      </p>
    );
  }

  const sorted = [...data].sort((a, b) => b.revenue - a.revenue);
  const total = sorted.reduce((sum, row) => sum + row.revenue, 0);

  return (
    <div className="space-y-2">
      {sorted.map((row) => {
        const isNegative = row.revenue < 0;
        // Larghezza proporzionale alla quota sul TOTALE, non sul canale
        // massimo - altrimenti il canale più grande riempie sempre il
        // 100% della riga indipendentemente dalla sua reale percentuale.
        const barWidthPct =
          isNegative || total <= 0 ? 0 : Math.min(100, Math.max(2, (row.revenue / total) * 100));
        const percentOfTotal = total !== 0 ? (row.revenue / total) * 100 : 0;
        // Il badge segue la punta della barra, ma resta a un margine dai
        // bordi della corsia (che non ha overflow-hidden) cosi' il
        // cerchio da 24px non viene mai tagliato via a inizio/fine corsia.
        const badgeLeftPct = isNegative ? 4 : Math.min(Math.max(barWidthPct, 6), 94);

        return (
          <div key={row.channel} className="flex items-center gap-3">
            <TruncatedLabelWithTooltip text={row.channel} />

            <div className="relative h-6 flex-1 rounded-full bg-[#f0ece6]">
              {!isNegative && (
                <div
                  className="h-6 rounded-full"
                  style={{ width: `${barWidthPct}%`, backgroundColor: POSITIVE_COLOR }}
                />
              )}
              <ChannelBadge channel={row.channel} leftPct={badgeLeftPct} />
            </div>

            <span
              className={`w-24 shrink-0 text-right text-sm font-semibold tabular-nums ${
                isNegative ? "text-[#8a3a3a]" : "text-[#2B2D2F]"
              }`}
              style={isNegative ? { color: NEGATIVE_COLOR } : undefined}
            >
              {formatCurrency(row.revenue)}
            </span>

            <span className="w-16 shrink-0 text-right text-[12px] tabular-nums text-[#6a6d70]">
              {formatPercent1(percentOfTotal)}
            </span>
          </div>
        );
      })}

      <div className="flex items-center gap-3 border-t border-[#e7dfd8] pt-2">
        <span className="w-36 shrink-0 text-sm font-semibold text-[#2B2D2F]">Totale</span>
        <div className="flex-1" />
        <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums text-[#2B2D2F]">
          {formatCurrency(total)}
        </span>
        <span className="w-16 shrink-0 text-right text-[12px] tabular-nums text-[#6a6d70]">100,0%</span>
      </div>
    </div>
  );
}

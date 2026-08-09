import { formatCurrency, ND } from "@/lib/performanceMetrics";

export type ChannelRevenueDatum = {
  channel: string;
  revenue: number;
};

type ChannelRevenueBarsProps = {
  data: ChannelRevenueDatum[];
};

const POSITIVE_COLOR = "#017A92";
const NEGATIVE_COLOR = "#b6423f";

function formatPercent1(value: number) {
  return `${value.toLocaleString("it-IT", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
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
  const maxAbs = Math.max(...sorted.map((row) => Math.abs(row.revenue)), 1);

  return (
    <div className="space-y-2">
      {sorted.map((row) => {
        const isNegative = row.revenue < 0;
        const barWidthPct = isNegative ? 0 : Math.max(2, (row.revenue / maxAbs) * 100);
        const percentOfTotal = total !== 0 ? (row.revenue / total) * 100 : 0;

        return (
          <div key={row.channel} className="flex items-center gap-3">
            <span className="w-36 shrink-0 truncate text-sm text-[#2B2D2F]" title={row.channel}>
              {row.channel}
            </span>

            <div className="h-6 flex-1 overflow-hidden rounded-full bg-[#f0ece6]">
              {!isNegative && (
                <div
                  className="h-6 rounded-full"
                  style={{ width: `${barWidthPct}%`, backgroundColor: POSITIVE_COLOR }}
                />
              )}
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

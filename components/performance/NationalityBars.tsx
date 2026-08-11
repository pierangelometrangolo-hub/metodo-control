import { formatNumber, ND } from "@/lib/performanceMetrics";
import { flagForNationality } from "@/lib/nationalityFlags";
import { TruncatedLabelWithTooltip } from "@/components/ui/TruncatedLabelWithTooltip";

export type NationalityDatum = {
  nationality: string;
  presences: number;
};

type NationalityBarsProps = {
  data: NationalityDatum[];
};

const BAR_COLOR = "#017A92";
const OTHERS_LABEL = "Altri";

function formatPercent1(value: number) {
  return `${value.toLocaleString("it-IT", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
}

const OTHERS_ICON = "/images/logos/terra.jpg";

function NationalityBadge({ nationality, leftPct }: { nationality: string; leftPct: number }) {
  const isOthers = nationality === OTHERS_LABEL;
  const flag = isOthers ? null : flagForNationality(nationality);

  // "Altri" è un aggregato, non una nazione: niente bandiera, ma un'icona
  // "globo" dedicata (terra.jpg) invece di restare vuoto. Una nazionalità
  // non ancora mappata resta invece silenziosamente senza badge (mai
  // un'icona rotta) - in entrambi i casi lo spazio del badge resta
  // presente, per non spostare la formattazione delle colonne accanto.
  return (
    <span
      className="absolute top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-white text-[14px] leading-none shadow-[0_0_0_1px_rgba(43,45,47,0.12)]"
      style={{ left: `${leftPct}%` }}
      title={nationality}
    >
      {isOthers ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={OTHERS_ICON} alt={nationality} className="h-full w-full object-cover" />
      ) : (
        flag
      )}
    </span>
  );
}

export function NationalityBars({ data }: NationalityBarsProps) {
  if (data.length === 0) {
    return (
      <p className="rounded-[12px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 py-6 text-center text-sm text-[#6a6d70]">
        {ND} — nessun dato nazionalità importato per questo periodo.
      </p>
    );
  }

  const sorted = [...data].sort((a, b) => b.presences - a.presences);
  const top10 = sorted.slice(0, 10);
  const others = sorted.slice(10);
  const othersTotal = others.reduce((sum, row) => sum + row.presences, 0);

  const rows: NationalityDatum[] =
    othersTotal > 0 ? [...top10, { nationality: OTHERS_LABEL, presences: othersTotal }] : top10;

  const total = sorted.reduce((sum, row) => sum + row.presences, 0);

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const barWidthPct = total > 0 ? Math.min(100, Math.max(2, (row.presences / total) * 100)) : 0;
        const percentOfTotal = total !== 0 ? (row.presences / total) * 100 : 0;
        // Stesso fix di ChannelRevenueBars: il badge segue esattamente la
        // punta della barra, nessun pavimento minimo che lo stacchi dal
        // bordo reale quando la barra è piccola.
        const badgeLeftPct = Math.min(barWidthPct, 94);

        return (
          <div key={row.nationality} className="flex items-center gap-3">
            <TruncatedLabelWithTooltip text={row.nationality} />

            <div className="relative h-6 flex-1 rounded-full bg-[#f0ece6]">
              <div
                className="h-6 rounded-full"
                style={{ width: `${barWidthPct}%`, backgroundColor: BAR_COLOR }}
              />
              <NationalityBadge nationality={row.nationality} leftPct={badgeLeftPct} />
            </div>

            <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums text-[#2B2D2F]">
              {formatNumber(row.presences)}
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
        <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums text-[#2B2D2F]">
          {formatNumber(total)}
        </span>
        <span className="w-16 shrink-0 text-right text-[12px] tabular-nums text-[#6a6d70]">100,0%</span>
      </div>
    </div>
  );
}

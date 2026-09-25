"use client";

import { formatCurrency, formatDelta, ND } from "@/lib/performanceMetrics";
import { TruncatedLabelWithTooltip } from "@/components/ui/TruncatedLabelWithTooltip";
import { AppBadge } from "@/components/ui/AppBadge";
import { CellTooltip } from "@/components/ui/CellTooltip";

export type ChannelRevenueDatum = {
  channel: string;
  revenue: number;
};

export type ChannelCommissionInfo = {
  // commission_pct e' gia' definito come commissione/lordo*100 (stessa
  // formula usata dal form di import) - e' direttamente la % di incidenza
  // da mostrare, nessun ricalcolo separato serve.
  pct: number;
  source: "fattura" | "stima";
  sourceReference: string | null;
};

type ChannelRevenueBarsProps = {
  data: ChannelRevenueDatum[];
  // Solo per i canali con una riga in channel_commission_rates per il mese
  // corrente - i canali assenti da questa mappa non mostrano il breakdown
  // netto/commissione, mai un dato inventato.
  commissionRates?: Map<string, ChannelCommissionInfo>;
  // Stessa risoluzione di commissionRates ma per l'anno/mese precedente
  // (period_year/period_month traslati di uno, vedi page.tsx) - mappa
  // indipendente: un canale con tariffa 2026 non ha automaticamente una
  // tariffa 2025, e viceversa. Se il canale non e' in questa mappa la
  // barra LY resta lorda piena, mai un fallback sulla percentuale 2026.
  commissionRatesLy?: Map<string, ChannelCommissionInfo>;
  showNet?: boolean;
  // Stesso periodo dell'anno precedente (sdlyDate su periodStart/periodEnd),
  // gia' caricato dal chiamante - mai una nuova query qui dentro.
  compareData?: ChannelRevenueDatum[];
  showCompare?: boolean;
  // Etichette d'anno (es. "2026"/"2025"), calcolate dal chiamante da
  // periodStart - mai un anno fisso hardcoded qui dentro.
  currentYearLabel?: string;
  compareYearLabel?: string;
};

const POSITIVE_COLOR = "#017A92";
const NEGATIVE_COLOR = "#b6423f";
const NET_COLOR = "#017A92";
const COMMISSION_COLOR = "#e07a5f";
// Stessa famiglia cromatica (teal) della barra 2026 ma piu' tenue - "2025"
// deve restare un benchmark chiaro, non sparire: non cosi' pallido da
// sembrare disabilitato (richiesta esplicita), solo visibilmente secondario.
const LY_COLOR = "#4f97a6";

// Loghi reali forniti in public/images/logos/. CRM e le due varianti di
// Booking Engine condividono booking-designer.png perché gestiti dallo
// stesso strumento (Booking Designer), non da un canale di vendita proprio.
const CHANNEL_LOGOS: Record<string, string> = {
  "Booking.com": "/images/logos/booking-com.png",
  Expedia: "/images/logos/expedia.png",
  CRM: "/images/logos/booking-designer.png",
  "Booking Engine": "/images/logos/booking-designer.png",
  "Booking Engine - Advance": "/images/logos/booking-designer.png",
  "Imperatore Travel": "/images/logos/imperatore.png",
  SunHotels: "/images/logos/sunhotels.png",
  HotelBeds: "/images/logos/hotelbeds.jpg",
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

// Zero reale: un valore a 0 (o negativo, gestito a parte via isNegative)
// non deve mai produrre un frammento di barra - il pavimento minimo del 2%
// serve solo a rendere visibili valori positivi molto piccoli rispetto al
// totale, mai a simulare presenza dove non c'e' nessun valore.
function barWidthPctFor(value: number, total: number): number {
  if (value <= 0 || total <= 0) return 0;
  return Math.min(100, Math.max(2, (value / total) * 100));
}

// sizePx/soft: simmetria 2026/2025 (obiettivo 1) - il terminale sulla
// barra LY e' lo stesso, solo leggermente piu' piccolo (20px vs 24px) e
// piu' soft (opacita' ridotta), mai assente.
function ChannelBadge({
  channel,
  leftPct,
  sizePx = 24,
  soft = false,
}: {
  channel: string;
  leftPct: number;
  sizePx?: number;
  soft?: boolean;
}) {
  const logoSrc = CHANNEL_LOGOS[channel];

  return (
    <span
      className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full border-2 border-white bg-white shadow-[0_0_0_1px_rgba(43,45,47,0.12)] ${
        soft ? "opacity-80" : ""
      }`}
      style={{ left: `${leftPct}%`, width: sizePx, height: sizePx }}
      title={channel}
    >
      {logoSrc ? (
        // Loghi di marchi terzi (Booking.com/Expedia) o dello strumento
        // interno (Booking Designer): immagini statiche in public/, non
        // serve next/image per un'icona a dimensione fissa.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoSrc} alt={channel} className="h-full w-full object-cover" />
      ) : (
        <span className="block h-full w-full" style={{ backgroundColor: colorForChannel(channel) }} />
      )}
    </span>
  );
}

// Riga breakdown compatta sotto la barra annuale (obiettivo 2), mai numeri
// dentro la barra stessa. Nessuna tariffa nota per quel canale/anno ->
// lordo pieno invariato, testo esplicito "Commissione non disponibile",
// mai un netto inventato.
function formatGrossNetBreakdown(gross: number, info: ChannelCommissionInfo | undefined): string {
  if (!info) return `Lordo ${formatCurrency(gross)} · Commissione non disponibile`;
  const commission = gross * (info.pct / 100);
  const net = gross - commission;
  return `Lordo ${formatCurrency(gross)} · Netto ${formatCurrency(net)} · Comm. ${formatCurrency(commission)} (${formatPercent1(info.pct)})`;
}

// Variante per il Totale: aggregato su piu' canali con tariffe eventualmente
// diverse (o assenti per alcuni) - nessuna percentuale unica da mostrare,
// solo i tre importi gia' calcolati (mai un dato inventato).
function formatTotaleBreakdown(gross: number, net: number, commission: number): string {
  return `Lordo ${formatCurrency(gross)} · Netto ${formatCurrency(net)} · Comm. ${formatCurrency(commission)}`;
}

export function ChannelRevenueBars({
  data,
  commissionRates,
  commissionRatesLy,
  showNet = false,
  compareData,
  showCompare = false,
  currentYearLabel = "Corrente",
  compareYearLabel = "Anno prec.",
}: ChannelRevenueBarsProps) {
  if (data.length === 0) {
    return (
      <p className="rounded-[12px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 py-6 text-center text-sm text-[#6a6d70]">
        {ND} — nessun dato canale importato per questo periodo.
      </p>
    );
  }

  // Un array LY vuoto e' ambiguo tra "nessuna estrazione per quell'anno" e
  // "estrazione con zero canali" - sui dati reali BD la seconda casistica
  // non si verifica mai (esporta sempre almeno un canale con revenue), quindi
  // un array vuoto viene trattato come dataset assente (ND ovunque), mai
  // come "tutti i canali a zero". Nessuna nuova query: usa solo compareData
  // gia' caricato dal chiamante.
  const compareAvailable = showCompare && (compareData?.length ?? 0) > 0;
  const compareMap = new Map((compareData ?? []).map((d) => [d.channel, d.revenue]));

  // Un canale presente solo nel LY (oggi a zero revenue, es. cancellato) e'
  // informazione rilevante quanto uno nuovo - unione delle chiavi, non solo
  // i canali del periodo corrente, ma solo quando il dataset LY esiste
  // davvero (altrimenti l'unione non aggiungerebbe nulla di significativo).
  const currentMap = new Map(data.map((d) => [d.channel, d.revenue]));
  const channels = compareAvailable
    ? [...new Set([...data.map((d) => d.channel), ...(compareData ?? []).map((d) => d.channel)])]
    : data.map((d) => d.channel);

  const sorted = channels
    .map((channel) => ({ channel, revenue: currentMap.get(channel) ?? 0 }))
    .sort((a, b) => b.revenue - a.revenue);
  const total = sorted.reduce((sum, row) => sum + row.revenue, 0);
  const totalLy = compareAvailable ? [...compareMap.values()].reduce((sum, v) => sum + v, 0) : null;

  // Totale netto/commissione (solo anno corrente): somma dei net/commission
  // amount gia' calcolabili canale per canale con i dati esistenti - nessuna
  // nuova query, nessun dato inventato. Un canale senza commissione nota
  // contribuisce per intero al segmento "netto" visivo, stessa convenzione
  // gia' in uso riga per riga. Clamp difensivo: se esistessero righe a
  // revenue negativo (rettifiche), la somma netto+commissione dei soli
  // canali positivi potrebbe eccedere "total" (che le include in sottrazione)
  // - il clamp evita un overflow visivo della barra in quel caso limite.
  let totalNetAmount = 0;
  let totalCommissionAmount = 0;
  // Stessa aggregazione, con le tariffe LY reali (commissionRatesLy) invece
  // di quelle correnti - un canale senza tariffa 2025 nota contribuisce per
  // intero al "netto" visivo del Totale 2025, stessa convenzione riga per
  // riga, mai la % 2026 riusata qui.
  let totalLyNetAmount = 0;
  let totalLyCommissionAmount = 0;
  if (showNet) {
    sorted.forEach((row) => {
      if (row.revenue > 0) {
        const info = commissionRates?.get(row.channel);
        if (info) {
          const commission = row.revenue * (info.pct / 100);
          totalCommissionAmount += commission;
          totalNetAmount += row.revenue - commission;
        } else {
          totalNetAmount += row.revenue;
        }
      }

      if (compareAvailable) {
        const lyVal = compareMap.get(row.channel) ?? 0;
        if (lyVal > 0) {
          const lyInfo = commissionRatesLy?.get(row.channel);
          if (lyInfo) {
            const lyCommission = lyVal * (lyInfo.pct / 100);
            totalLyCommissionAmount += lyCommission;
            totalLyNetAmount += lyVal - lyCommission;
          } else {
            totalLyNetAmount += lyVal;
          }
        }
      }
    });
  }
  const showTotalNet = showNet && (totalNetAmount > 0 || totalCommissionAmount > 0);
  const totalNetSegmentPct = showTotalNet && total > 0 ? Math.min(100, (totalNetAmount / total) * 100) : 0;
  const totalCommissionSegmentPct =
    showTotalNet && total > 0
      ? Math.max(0, Math.min(100 - totalNetSegmentPct, (totalCommissionAmount / total) * 100))
      : 0;
  const totalLyBarWidthPct = totalLy !== null ? barWidthPctFor(totalLy, total) : 0;
  // Segmenti relativi a totalLy (non a "total"): la barra LY del Totale ha
  // gia' la sua larghezza propria (totalLyBarWidthPct, stessa scala del
  // 2026) - i due segmenti devono dividersi il 100% di QUELLA larghezza,
  // stessa tecnica gia' usata riga per riga.
  const showTotalLyNet = showNet && compareAvailable && (totalLyNetAmount > 0 || totalLyCommissionAmount > 0);
  const totalLyNetSegmentPct =
    showTotalLyNet && totalLy && totalLy > 0 ? Math.min(100, (totalLyNetAmount / totalLy) * 100) : 0;
  const totalLyCommissionSegmentPct =
    showTotalLyNet && totalLy && totalLy > 0
      ? Math.max(0, Math.min(100 - totalLyNetSegmentPct, (totalLyCommissionAmount / totalLy) * 100))
      : 0;

  return (
    <div className="space-y-3">
      {showNet && (
        <div className="flex items-center gap-4 text-[12px] text-[#6a6d70]">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: NET_COLOR }} />
            Netto
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COMMISSION_COLOR }} />
            Commissione
          </span>
        </div>
      )}

      {sorted.map((row) => {
        const isNegative = row.revenue < 0;
        // Larghezza proporzionale alla quota sul TOTALE, non sul canale
        // massimo - altrimenti il canale più grande riempie sempre il
        // 100% della riga indipendentemente dalla sua reale percentuale.
        const barWidthPct = isNegative ? 0 : barWidthPctFor(row.revenue, total);
        const percentOfTotal = total !== 0 ? (row.revenue / total) * 100 : 0;
        // Il badge segue esattamente la punta della barra (stessa
        // percentuale usata per la sua larghezza) - un pavimento minimo
        // separato lo staccava dalla barra quando questa era piccola.
        const badgeLeftPct = isNegative ? 4 : Math.min(barWidthPct, 94);

        const commissionInfo = commissionRates?.get(row.channel);
        // Nessun breakdown se il canale non ha una riga di commissione nota
        // per il periodo - mai un netto inventato per un canale senza dato.
        // netAmount + commissionAmount = row.revenue esattamente (la
        // seconda somma sempre il complementare della prima), quindi i due
        // segmenti sommati combaciano sempre con barWidthPct, nessuno
        // scarto visivo possibile.
        const showChannelNet = showNet && !isNegative && commissionInfo !== undefined && row.revenue > 0;
        const commissionAmount = showChannelNet ? row.revenue * (commissionInfo!.pct / 100) : 0;
        const netAmount = showChannelNet ? row.revenue - commissionAmount : 0;
        const netSegmentPct = showChannelNet ? (netAmount / row.revenue) * 100 : 0;
        const commissionSegmentPct = showChannelNet ? (commissionAmount / row.revenue) * 100 : 0;

        // compareAvailable=false -> dataset LY assente per l'intera
        // struttura/periodo (ND, nessuna barra). compareAvailable=true ma
        // il canale non e' nella mappa -> quel canale specifico non aveva
        // revenue nel LY (0 reale, non ND).
        const lyValue = compareAvailable ? (compareMap.get(row.channel) ?? 0) : null;
        const lyDelta = lyValue !== null ? formatDelta(row.revenue, lyValue) : null;
        // Stessa scala della barra 2026 (stesso denominatore "total"): un
        // canale che vale la meta' dell'anno scorso mostra una barra LY
        // esattamente meta' larga di quella 2026, comparabili a colpo
        // d'occhio.
        const lyBarWidthPct = lyValue !== null ? barWidthPctFor(lyValue, total) : 0;

        // Breakdown netto/commissione LY: simmetrico al 2026 ma con le
        // tariffe REALI dell'anno precedente (commissionRatesLy) - mai la
        // percentuale 2026 riusata qui. Canale senza tariffa 2025 nota ->
        // barra lorda piena, stessa regola gia' in uso per il 2026.
        const lyCommissionInfo = commissionRatesLy?.get(row.channel);
        const showLyChannelNet = showNet && lyValue !== null && lyValue > 0 && lyCommissionInfo !== undefined;
        const lyCommissionAmount = showLyChannelNet ? lyValue! * (lyCommissionInfo!.pct / 100) : 0;
        const lyNetAmount = showLyChannelNet ? lyValue! - lyCommissionAmount : 0;
        const lyNetSegmentPct = showLyChannelNet ? (lyNetAmount / lyValue!) * 100 : 0;
        const lyCommissionSegmentPct = showLyChannelNet ? (lyCommissionAmount / lyValue!) * 100 : 0;

        const stimaBadge = showChannelNet && commissionInfo!.source === "stima" && (
          <CellTooltip
            className="inline-flex shrink-0"
            trigger={
              <AppBadge variant="warning" className="whitespace-nowrap">
                Stima
              </AppBadge>
            }
          >
            {commissionInfo!.sourceReference || "Percentuale commissione stimata, non ancora da fattura."}
          </CellTooltip>
        );

        return (
          <div key={row.channel} className="space-y-1">
            {/* Nome canale: header strutturale sopra le due righe 2026/2025
                quando il confronto e' attivo (l'anno diventa parte della
                griglia, non piu' una nota sotto la barra) - altrimenti
                resta inline nella riga unica, comportamento identico a
                prima del confronto LY. */}
            {showCompare && (
              <div className="flex items-center gap-2">
                <TruncatedLabelWithTooltip text={row.channel} widthClassName="w-auto max-w-[240px]" />
                {stimaBadge}
              </div>
            )}

            <div className="flex items-center gap-3">
              {showCompare ? (
                <span className="w-14 shrink-0 text-[12px] font-semibold text-[#2B2D2F]">{currentYearLabel}</span>
              ) : (
                <>
                  <TruncatedLabelWithTooltip text={row.channel} />
                  {stimaBadge}
                </>
              )}

              <div className="relative h-6 flex-1 rounded-full bg-[#f0ece6]">
                {!isNegative &&
                  barWidthPct > 0 &&
                  (showChannelNet ? (
                    <div className="flex h-6" style={{ width: `${barWidthPct}%` }}>
                      <div
                        className="h-6 rounded-l-full"
                        style={{ width: `${netSegmentPct}%`, backgroundColor: NET_COLOR }}
                      />
                      <div
                        className="h-6 rounded-r-full"
                        style={{ width: `${commissionSegmentPct}%`, backgroundColor: COMMISSION_COLOR }}
                      />
                    </div>
                  ) : (
                    <div
                      className="h-6 rounded-full"
                      style={{ width: `${barWidthPct}%`, backgroundColor: POSITIVE_COLOR }}
                    />
                  ))}
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

              {/* Il delta vive sulla riga dell'anno CORRENTE, non su quella
                  LY - "78.198 € +5,1% vs 2025" si legge inequivocabilmente
                  come "il 2026 e' +5,1% rispetto al 2025", mentre metterlo
                  sulla riga 2025 poteva sembrare una variazione del 2025
                  stesso. lyValue===null (dataset LY assente) -> nessun
                  delta mostrato qui, resta solo "ND" sulla riga 2025 gia'
                  esistente. Senza confronto attivo: quota% invariata. */}
              {showCompare ? (
                lyValue !== null && (
                  <span className="shrink-0 whitespace-nowrap text-right text-[12px] tabular-nums">
                    <span className={lyDelta!.colorClass}>{lyDelta!.text}</span>{" "}
                    <span className="text-[#6a6d70]">vs {compareYearLabel}</span>
                  </span>
                )
              ) : (
                <span className="w-16 shrink-0 text-right text-[12px] tabular-nums text-[#6a6d70]">
                  {formatPercent1(percentOfTotal)}
                </span>
              )}
            </div>

            {/* Breakdown lordo/netto/commissione sotto la barra 2026, mai
                dentro la barra - compatto, un'unica riga di testo. */}
            {showNet && !isNegative && row.revenue > 0 && (
              <div className="flex items-center gap-3">
                <span className={showCompare ? "w-14 shrink-0" : "w-36 shrink-0"} />
                <span className="text-[11px] text-[#6a6d70]">
                  {formatGrossNetBreakdown(row.revenue, commissionInfo)}
                </span>
              </div>
            )}

            {/* Riga anno precedente: barra comparativa vera (stessa scala,
                piu' sottile h-5 vs h-6, colore piu' tenue ma solido) - non
                piu' un testo secondario. Se il dataset LY e' assente del
                tutto, nessuna barra: solo ND, come gia' definito. */}
            {showCompare &&
              (lyValue === null ? (
                <div className="flex items-center gap-3">
                  <span className="w-14 shrink-0 text-[12px] font-medium text-[#6a6d70]">{compareYearLabel}</span>
                  <div className="flex-1" />
                  <span className="shrink-0 text-right text-[12px] text-[#6a6d70]">{ND}</span>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <span className="w-14 shrink-0 text-[12px] font-medium text-[#6a6d70]">{compareYearLabel}</span>

                    <div className="relative h-5 flex-1 rounded-full bg-[#f0ece6]">
                      {lyBarWidthPct > 0 &&
                        (showLyChannelNet ? (
                          <div className="flex h-5" style={{ width: `${lyBarWidthPct}%` }}>
                            <div
                              className="h-5 rounded-l-full"
                              style={{ width: `${lyNetSegmentPct}%`, backgroundColor: NET_COLOR }}
                            />
                            <div
                              className="h-5 rounded-r-full"
                              style={{ width: `${lyCommissionSegmentPct}%`, backgroundColor: COMMISSION_COLOR }}
                            />
                          </div>
                        ) : (
                          <div
                            className="h-5 rounded-full"
                            style={{ width: `${lyBarWidthPct}%`, backgroundColor: LY_COLOR }}
                          />
                        ))}
                      {/* Simmetria con la barra 2026: stesso terminale/logo,
                          leggermente piu' piccolo (20px) e piu' soft
                          (opacita' ridotta) - mai assente. */}
                      <ChannelBadge
                        channel={row.channel}
                        leftPct={lyBarWidthPct > 0 ? Math.min(lyBarWidthPct, 94) : 4}
                        sizePx={20}
                        soft
                      />
                    </div>

                    {/* Nessun delta qui - vive sulla riga 2026 sopra (vedi
                        commento li'). Solo l'importo lordo LY. */}
                    <span className="w-24 shrink-0 text-right text-sm tabular-nums text-[#4a4f52]">
                      {formatCurrency(lyValue)}
                    </span>
                  </div>

                  {showNet && lyValue > 0 && (
                    <div className="flex items-center gap-3">
                      <span className="w-14 shrink-0" />
                      <span className="text-[11px] text-[#6a6d70]">
                        {formatGrossNetBreakdown(lyValue, lyCommissionInfo)}
                      </span>
                    </div>
                  )}
                </div>
              ))}
          </div>
        );
      })}

      {showCompare ? (
        <div className="space-y-1 border-t border-[#e7dfd8] pt-2">
          <p className="text-sm font-semibold text-[#2B2D2F]">Totale</p>

          <div className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-[12px] font-semibold text-[#2B2D2F]">{currentYearLabel}</span>

            <div className="relative h-6 flex-1 rounded-full bg-[#f0ece6]">
              {showTotalNet ? (
                <div className="flex h-6 w-full">
                  <div
                    className="h-6 rounded-l-full"
                    style={{ width: `${totalNetSegmentPct}%`, backgroundColor: NET_COLOR }}
                  />
                  <div
                    className="h-6 rounded-r-full"
                    style={{ width: `${totalCommissionSegmentPct}%`, backgroundColor: COMMISSION_COLOR }}
                  />
                </div>
              ) : (
                <div className="h-6 w-full rounded-full" style={{ backgroundColor: POSITIVE_COLOR }} />
              )}
            </div>

            <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums text-[#2B2D2F]">
              {formatCurrency(total)}
            </span>

            {/* Stessa regola dei canali: delta sulla riga 2026, mai su
                quella 2025, "100,0%" solo fuori dal confronto. */}
            {totalLy !== null && (
              <span className="shrink-0 whitespace-nowrap text-right text-[12px] tabular-nums">
                <span className={formatDelta(total, totalLy).colorClass}>{formatDelta(total, totalLy).text}</span>{" "}
                <span className="text-[#6a6d70]">vs {compareYearLabel}</span>
              </span>
            )}
          </div>

          {showTotalNet && (
            <div className="flex items-center gap-3">
              <span className="w-14 shrink-0" />
              <span className="text-[11px] text-[#6a6d70]">
                {formatTotaleBreakdown(total, totalNetAmount, totalCommissionAmount)}
              </span>
            </div>
          )}

          {totalLy === null ? (
            <div className="flex items-center gap-3">
              <span className="w-14 shrink-0 text-[12px] font-medium text-[#6a6d70]">{compareYearLabel}</span>
              <div className="flex-1" />
              <span className="shrink-0 text-right text-[12px] text-[#6a6d70]">{ND}</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <span className="w-14 shrink-0 text-[12px] font-medium text-[#6a6d70]">{compareYearLabel}</span>

                <div className="relative h-5 flex-1 rounded-full bg-[#f0ece6]">
                  {totalLyBarWidthPct > 0 &&
                    (showTotalLyNet ? (
                      <div className="flex h-5" style={{ width: `${totalLyBarWidthPct}%` }}>
                        <div
                          className="h-5 rounded-l-full"
                          style={{ width: `${totalLyNetSegmentPct}%`, backgroundColor: NET_COLOR }}
                        />
                        <div
                          className="h-5 rounded-r-full"
                          style={{ width: `${totalLyCommissionSegmentPct}%`, backgroundColor: COMMISSION_COLOR }}
                        />
                      </div>
                    ) : (
                      <div
                        className="h-5 rounded-full"
                        style={{ width: `${totalLyBarWidthPct}%`, backgroundColor: LY_COLOR }}
                      />
                    ))}
                </div>

                <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums text-[#4a4f52]">
                  {formatCurrency(totalLy)}
                </span>
              </div>

              {showTotalLyNet && (
                <div className="flex items-center gap-3">
                  <span className="w-14 shrink-0" />
                  <span className="text-[11px] text-[#6a6d70]">
                    {formatTotaleBreakdown(totalLy, totalLyNetAmount, totalLyCommissionAmount)}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3 border-t border-[#e7dfd8] pt-2">
          <span className="w-36 shrink-0 text-sm font-semibold text-[#2B2D2F]">Totale</span>
          <div className="flex-1" />
          <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums text-[#2B2D2F]">
            {formatCurrency(total)}
          </span>
          <span className="w-16 shrink-0 text-right text-[12px] tabular-nums text-[#6a6d70]">100,0%</span>
        </div>
      )}
    </div>
  );
}

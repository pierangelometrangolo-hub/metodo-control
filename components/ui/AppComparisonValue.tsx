import { ReactNode } from "react";

// Significato del delta, deciso dal chiamante: il componente e' solo
// presentazionale e non interpreta numeri.
export type AppComparisonTone = "positive" | "negative" | "neutral";

type AppComparisonValueProps = {
  // "value": dato economico in primo piano, delta sotto, riferimento per
  // ultimo (KPI, viste d'insieme). "delta": celle e colonne dedicate a un
  // confronto - delta in primo piano, riferimento sotto, nota per ultima.
  emphasis: "value" | "delta";
  // Valore corrente, gia' formattato. Usato solo con emphasis="value".
  value?: ReactNode;
  delta: ReactNode;
  tone?: AppComparisonTone;
  // Valore di riferimento gia' formattato, etichetta inclusa (es. "vs 1.200 €").
  reference?: ReactNode;
  // Periodo, data o copertura del confronto: il livello piu' discreto.
  note?: ReactNode;
  className?: string;
};

const toneClasses: Record<AppComparisonTone, string> = {
  positive: "text-mc-positive",
  negative: "text-mc-negative",
  neutral: "text-mc-text-secondary",
};

// Solo <span>: utilizzabile dentro celle di tabella, trigger di tooltip e card.
export function AppComparisonValue({
  emphasis,
  value,
  delta,
  tone = "neutral",
  reference,
  note,
  className = "",
}: AppComparisonValueProps) {
  if (emphasis === "value") {
    return (
      <span className={`block ${className}`}>
        <span className="block text-[24px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-mc-text sm:text-[26px]">
          {value}
        </span>
        {/* Delta e riferimento sulla stessa riga: a capo solo se non entrano. */}
        <span className="mt-2 flex flex-wrap items-baseline gap-x-2">
          <span className={`text-[14px] font-semibold leading-5 tabular-nums ${toneClasses[tone]}`}>{delta}</span>
          {reference !== undefined && (
            <span className="text-[12px] font-normal leading-4 text-mc-text-secondary">{reference}</span>
          )}
        </span>
        {note !== undefined && (
          <span className="mt-0.5 block text-[11px] font-normal leading-4 text-mc-text-tertiary">{note}</span>
        )}
      </span>
    );
  }

  return (
    <span className={`block ${className}`}>
      <span className={`block text-[13px] font-semibold leading-4 ${toneClasses[tone]}`}>{delta}</span>
      {reference !== undefined && (
        <span className="block whitespace-nowrap text-[10px] font-normal leading-3 text-mc-text-secondary">
          {reference}
        </span>
      )}
      {note !== undefined && (
        <span className="block whitespace-nowrap text-[10px] font-normal leading-3 text-mc-text-tertiary">{note}</span>
      )}
    </span>
  );
}

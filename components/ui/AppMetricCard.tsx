import { ReactNode } from "react";
import { AppComparisonTone, AppComparisonValue } from "@/components/ui/AppComparisonValue";

type AppMetricCardProps = {
  label: string;
  // Valore principale, gia' formattato.
  value: ReactNode;
  // Confronto opzionale sotto il valore: delta, poi riferimento, poi nota.
  comparison?: {
    delta: ReactNode;
    tone?: AppComparisonTone;
    reference?: ReactNode;
    note?: ReactNode;
  };
  className?: string;
};

// Card metrica non cliccabile: label, valore in evidenza e confronto.
// Per la tile cliccabile di navigazione resta KpiCard.
export function AppMetricCard({ label, value, comparison, className = "" }: AppMetricCardProps) {
  return (
    // h-full + altezza minima (non fissa): in griglia le card restano alte
    // uguali, ma crescono se un valore lungo o una nota vanno a capo.
    <div
      className={`flex h-full min-h-[104px] flex-col rounded-[8px] border border-mc-border bg-mc-surface px-3.5 py-3 ${className}`}
    >
      <p className="text-[12.5px] font-medium leading-4 text-mc-text-secondary">{label}</p>
      {comparison ? (
        <AppComparisonValue
          emphasis="value"
          className="mt-2"
          value={value}
          delta={comparison.delta}
          tone={comparison.tone}
          reference={comparison.reference}
          note={comparison.note}
        />
      ) : (
        <p className="mt-2 text-[24px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-mc-text sm:text-[26px]">
          {value}
        </p>
      )}
    </div>
  );
}

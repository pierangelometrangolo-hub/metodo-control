import { ReactNode } from "react";

type AppSegmentedControlProps<T extends string> = {
  options: readonly { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  // "track": opzioni dentro un'unica traccia (modalita' di un filtro).
  // "pills": pulsanti separati, attivo pieno (scelta tra viste o confronti).
  variant?: "track" | "pills";
  // Nome del gruppo per le tecnologie assistive.
  ariaLabel?: string;
  className?: string;
};

// Scelta esclusiva tra poche opzioni sullo stesso livello (es. modalita' di
// un filtro). Per navigare tra contenuti diversi restano le tab.
export function AppSegmentedControl<T extends string>({
  options,
  value,
  onChange,
  variant = "track",
  ariaLabel,
  className = "",
}: AppSegmentedControlProps<T>) {
  const pills = variant === "pills";

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`${
        pills ? "flex flex-wrap gap-1.5" : "inline-flex gap-0.5 rounded-[8px] bg-mc-surface-muted p-0.5"
      } ${className}`}
    >
      {options.map((option) => {
        const active = option.value === value;
        const stateClasses = pills
          ? active
            ? "bg-teal text-white"
            : "border border-mc-border bg-mc-surface text-mc-text hover:bg-mc-surface-subtle"
          : active
            ? "bg-mc-surface font-semibold text-mc-text shadow-[0_0_0_1px_var(--color-mc-border)]"
            : "text-mc-text-secondary hover:text-mc-text";

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`whitespace-nowrap px-3 text-[13px] transition ${
              pills ? "h-[34px] rounded-[7px] font-semibold" : "h-[30px] rounded-[6px] font-medium"
            } ${stateClasses}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

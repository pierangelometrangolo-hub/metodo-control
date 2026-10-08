import { ChangeEvent, ReactNode, useId } from "react";

type AppSelectProps = {
  value: string | number;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  // Elementi <option>.
  children: ReactNode;
  label?: string;
  disabled?: boolean;
  className?: string;
};

// Select nativo compatto con etichetta opzionale in linea.
export function AppSelect({ value, onChange, children, label, disabled = false, className = "" }: AppSelectProps) {
  const id = useId();

  return (
    <div className="flex items-center gap-2">
      {label && (
        <label htmlFor={id} className="text-[12.5px] font-medium text-mc-text-secondary">
          {label}
        </label>
      )}
      <select
        id={id}
        value={value}
        onChange={onChange}
        disabled={disabled}
        className={`h-[34px] rounded-[7px] border border-mc-border bg-mc-surface px-2.5 text-[13px] font-medium text-mc-text outline-none transition focus:border-teal disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      >
        {children}
      </select>
    </div>
  );
}

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
  // "prominent": per le pagine di dettaglio (una struttura, un cliente...).
  // Niente riquadro ne' logo: il titolo e' il soggetto della pagina, il
  // contesto sta sotto e i controlli a destra.
  variant?: "default" | "prominent";
};

// Banner di pagina compatto (riga singola) - sostituisce il vecchio hero a
// piena altezza che competeva visivamente con l'header globale sticky
// (components/Header.tsx). "eyebrow" resta nella firma per non rompere i
// chiamanti esistenti, ma non ha piu' una riga propria nel layout compatto:
// e' reso solo come prefisso sr-only del titolo, cosi' l'informazione
// resta disponibile per screen reader senza occupare spazio visivo.
export function PageHeader({
  eyebrow,
  title,
  description,
  children,
  variant = "default",
}: PageHeaderProps) {
  if (variant === "prominent") {
    return (
      <section className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h1 className="truncate text-[24px] font-semibold leading-tight tracking-[-0.015em] text-mc-text">
            {eyebrow && <span className="sr-only">{eyebrow} — </span>}
            {title}
          </h1>

          {description && <p className="mt-0.5 truncate text-[12.5px] leading-4 text-mc-text-secondary">{description}</p>}
        </div>

        {children && <div className="flex flex-wrap items-center gap-x-4 gap-y-1">{children}</div>}
      </section>
    );
  }

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[#e7dfd8] bg-white px-4 py-[10px]">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-[#e7dfd8]">
          <img
            src="/images/metodo-logo.png"
            alt=""
            aria-hidden="true"
            className="h-full w-full object-contain"
          />
        </span>

        <div className="min-w-0">
          <h1 className="truncate text-[16px] font-semibold leading-tight text-[#2B2D2F]">
            {eyebrow && <span className="sr-only">{eyebrow} — </span>}
            {title}
          </h1>

          {description && (
            <p className="truncate text-[11.5px] leading-tight text-[#6a6d70]">
              {description}
            </p>
          )}
        </div>
      </div>

      {children && (
        <div className="flex flex-wrap items-center gap-3">{children}</div>
      )}
    </section>
  );
}

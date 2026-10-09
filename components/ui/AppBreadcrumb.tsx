import Link from "next/link";
import { ChevronRight } from "lucide-react";

type AppBreadcrumbProps = {
  // Dal livello piu' alto alla pagina corrente; l'ultimo elemento e' la
  // pagina corrente e non e' un link.
  items: { label: string; href?: string }[];
  className?: string;
};

// Percorso contestuale delle pagine di dettaglio.
export function AppBreadcrumb({ items, className = "" }: AppBreadcrumbProps) {
  return (
    <nav aria-label="Percorso" className={className}>
      <ol className="flex flex-wrap items-center gap-1 text-[13px] text-mc-text-secondary">
        {items.map((item, index) => {
          const last = index === items.length - 1;

          return (
            <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-mc-text-tertiary" aria-hidden="true" />}
              {last ? (
                <span aria-current="page" className="truncate font-semibold text-mc-text">
                  {item.label}
                </span>
              ) : item.href ? (
                <Link href={item.href} className="truncate transition hover:text-mc-text">
                  {item.label}
                </Link>
              ) : (
                <span className="truncate">{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

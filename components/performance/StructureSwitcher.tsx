"use client";

import { KeyboardEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Search } from "lucide-react";
import { AppPopover } from "@/components/ui/AppPopover";

export type StructureSwitcherPeriod = {
  mode: "intervallo" | "mese" | "anno";
  // Periodo realmente mostrato nel Detail ("YYYY-MM-DD"), non i parametri
  // con cui si e' arrivati sulla pagina.
  start: string;
  end: string;
};

type StructureSwitcherProps = {
  structures: { id: string; name: string }[];
  currentId: string;
  currentName: string;
  period: StructureSwitcherPeriod;
};

// Parametri con cui il Detail di un'altra struttura si apre sullo stesso
// periodo: l'URL trasporta lo stato da una struttura all'altra, non e' la
// fonte del periodo durante l'uso della pagina.
export function detailPeriodQuery(period: StructureSwitcherPeriod): string {
  if (period.mode === "anno") return `?anno=${period.start.slice(0, 4)}`;
  if (period.mode === "mese") return `?mese=${period.start.slice(0, 7)}`;
  return `?dal=${period.start}&al=${period.end}`;
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// Il nome della struttura resta il titolo della pagina: il trigger eredita
// tipografia e peso dal titolo che lo contiene, con un chevron discreto.
// Lo spostamento a sinistra (per allineare il testo nonostante il padding
// dell'hover) e' relativo, non un margine negativo: un margine negativo
// riduce la larghezza calcolata del titolo e il nome verrebbe troncato
// anche quando c'e' spazio.
export function StructureSwitcher({ structures, currentId, currentName, period }: StructureSwitcherProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    return q ? structures.filter((s) => normalize(s.name).includes(q)) : structures;
  }, [structures, query]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setQuery("");
      setActiveIndex(Math.max(0, structures.findIndex((s) => s.id === currentId)));
    }
  }

  function select(id: string) {
    setOpen(false);
    if (id === currentId) return;
    router.push(`/performance/${id}${detailPeriodQuery(period)}`);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = filtered[activeIndex];
      if (target) select(target.id);
    }
  }

  return (
    <AppPopover
      open={open}
      onOpenChange={handleOpenChange}
      widthClassName="w-[300px]"
      trigger={
        <button
          type="button"
          aria-label={`${currentName} — cambia struttura`}
          className="group relative -left-1.5 inline-flex max-w-full items-center gap-1.5 rounded-[6px] px-1.5 text-left transition hover:bg-mc-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
        >
          <span className="truncate">{currentName}</span>
          <ChevronDown
            aria-hidden="true"
            className={`h-4 w-4 shrink-0 text-mc-text-tertiary transition group-hover:text-mc-text-secondary ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>
      }
    >
      <div className="px-3 pb-1.5 pt-2.5">
        <p className="text-[12px] font-medium leading-4 text-mc-text-secondary">Cambia struttura</p>
        <div className="relative mt-1.5">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mc-text-tertiary"
          />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Cerca struttura..."
            aria-label="Cerca struttura"
            role="combobox"
            aria-expanded="true"
            aria-controls="structure-switcher-list"
            aria-activedescendant={filtered[activeIndex] ? `structure-option-${filtered[activeIndex].id}` : undefined}
            className="h-[30px] w-full rounded-[6px] border border-mc-border bg-mc-surface-subtle pl-8 pr-2.5 text-[12.5px] text-mc-text outline-none transition placeholder:text-mc-text-tertiary focus:border-teal focus:bg-mc-surface"
          />
        </div>
      </div>

      <ul
        id="structure-switcher-list"
        role="listbox"
        aria-label="Strutture"
        className="max-h-[280px] overflow-y-auto border-t border-mc-border-subtle p-1"
      >
        {filtered.length === 0 && (
          <li className="px-2.5 py-2 text-[13px] text-mc-text-secondary">Nessuna struttura trovata</li>
        )}
        {filtered.map((structure, index) => {
          const current = structure.id === currentId;
          const active = index === activeIndex;

          return (
            <li
              key={structure.id}
              id={`structure-option-${structure.id}`}
              role="option"
              aria-selected={current}
              onClick={() => select(structure.id)}
              onMouseEnter={() => setActiveIndex(index)}
              className={`flex h-10 cursor-pointer items-center gap-2 rounded-[6px] px-2.5 text-[13.5px] transition sm:h-8 ${
                current ? "font-semibold text-teal" : "font-medium text-mc-text"
              } ${current ? "bg-mc-brand-subtle" : active ? "bg-mc-surface-summary" : ""} ${
                current && active ? "ring-1 ring-inset ring-teal/30" : ""
              }`}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {current && <Check aria-hidden="true" className="h-4 w-4" />}
              </span>
              <span className="truncate">{structure.name}</span>
            </li>
          );
        })}
      </ul>
    </AppPopover>
  );
}

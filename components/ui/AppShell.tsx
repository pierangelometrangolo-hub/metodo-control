"use client";

import { ComponentType, ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

type AppShellIcon = ComponentType<{ className?: string }>;

export type AppShellNavItem = {
  key: string;
  label: string;
  href: string;
  icon: AppShellIcon;
  // Link verso un sito esterno: nuova scheda, nessuno stato attivo.
  external?: boolean;
  // Solo per marchi che devono mantenere il proprio colore.
  iconClassName?: string;
};

export type AppShellNavGroup = {
  key: string;
  // Senza etichetta il gruppo e' separato solo da un filetto.
  label?: string;
  items: AppShellNavItem[];
};

export type AppShellAction = {
  key: string;
  label: string;
  icon: AppShellIcon;
  onClick: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
  // Riga di stato sotto l'azione (es. esito di un'attivazione).
  message?: string;
};

type AppShellProps = {
  brand: { name: string; logoSrc: string; href: string };
  // Navigazione gia' filtrata per l'utente: la shell non conosce moduli ne'
  // permessi, rende quello che riceve - una sola volta, in sidebar o drawer.
  groups: AppShellNavGroup[];
  // Azioni utility in fondo alla navigazione.
  actions?: AppShellAction[];
  children: ReactNode;
};

// Preferenza della sidebar desktop: "auto" segue la larghezza (compressa
// tra 1280 e 1439px, espansa da 1440px); "collapsed"/"expanded" sono una
// scelta dell'utente e valgono in entrambe le fasce. Sotto 1280px c'e' solo
// il drawer e la preferenza non ha effetto.
type SidebarPreference = "auto" | "collapsed" | "expanded";

const SIDEBAR_STORAGE_KEY = "mc-sidebar";
const SIDEBAR_CHANGE_EVENT = "mc-sidebar-change";

// Preferenza letta da localStorage come store esterno: sul server e durante
// l'hydration vale sempre "auto" (getServerSnapshot), poi React passa al
// valore salvato senza mismatch.
// Copia in memoria: se localStorage non e' disponibile (es. navigazione
// privata) la scelta vale almeno per la sessione corrente.
let memoryPreference: SidebarPreference = "auto";

function readSidebarPreference(): SidebarPreference {
  try {
    const saved = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    return saved === "collapsed" || saved === "expanded" ? saved : "auto";
  } catch {
    return memoryPreference;
  }
}

function subscribeSidebarPreference(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(SIDEBAR_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SIDEBAR_CHANGE_EVENT, onChange);
  };
}

const WIDE_QUERY = "(min-width: 1440px)";

function subscribeWide(onChange: () => void) {
  const media = window.matchMedia(WIDE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

// Lo stato compresso e' espresso in CSS sull'attributo data-sidebar del
// contenitore, cosi' server e primo render disegnano gia' la larghezza
// giusta per "auto" senza attendere JavaScript. Classi scritte per esteso:
// Tailwind le genera solo se le trova letteralmente nel sorgente.
const WHEN_COLLAPSED_HIDE = "[[data-sidebar=collapsed]_&]:hidden max-[1439px]:[[data-sidebar=auto]_&]:hidden";
const WHEN_COLLAPSED_SHOW =
  "hidden [[data-sidebar=collapsed]_&]:block max-[1439px]:[[data-sidebar=auto]_&]:block";
const WHEN_COLLAPSED_CENTER =
  "[[data-sidebar=collapsed]_&]:justify-center [[data-sidebar=collapsed]_&]:px-0 max-[1439px]:[[data-sidebar=auto]_&]:justify-center max-[1439px]:[[data-sidebar=auto]_&]:px-0";
const SIDEBAR_WIDTH = "w-[216px] [[data-sidebar=collapsed]_&]:w-16 max-[1439px]:[[data-sidebar=auto]_&]:w-16";
const MAIN_OFFSET =
  "xl:ml-[216px] xl:[[data-sidebar=collapsed]_&]:ml-16 xl:max-[1439px]:[[data-sidebar=auto]_&]:ml-16";

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const itemBase = `group relative flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2.5 text-[13.5px] transition focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal ${WHEN_COLLAPSED_CENTER}`;
const itemIdle = "font-medium text-mc-text-secondary hover:bg-mc-surface-summary hover:text-mc-text";

// Etichetta al passaggio per le voci senza testo visibile (sidebar
// compressa). Interna alla shell: non e' una primitive pubblica.
function ShellTooltip({ label, enabled, children }: { label: string; enabled: boolean; children: ReactNode }) {
  return (
    <TooltipPrimitive.Root delayDuration={150}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      {enabled && (
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side="right"
            sideOffset={8}
            className="z-50 rounded-[6px] bg-mc-text px-2 py-1 text-[12px] font-medium text-white shadow-[0_4px_12px_rgba(16,24,40,0.18)]"
          >
            {label}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      )}
    </TooltipPrimitive.Root>
  );
}

// Contenuto della navigazione: lo stesso nodo per sidebar desktop e drawer.
// Nel drawer (fuori dal contenitore con data-sidebar) e' sempre espanso.
function ShellNavigation({
  brand,
  groups,
  actions = [],
  onNavigate,
  tooltips = false,
  collapseControl,
}: Omit<AppShellProps, "children"> & {
  onNavigate?: () => void;
  // true quando le voci sono senza etichetta visibile (sidebar compressa).
  tooltips?: boolean;
  // Solo nella sidebar desktop.
  collapseControl?: { collapsed: boolean; onToggle: () => void };
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col overflow-x-hidden bg-mc-surface">
      <Link
        href={brand.href}
        onClick={onNavigate}
        aria-label={brand.name}
        className={`flex h-14 shrink-0 items-center gap-2.5 px-4 [[data-sidebar=collapsed]_&]:h-12 max-[1439px]:[[data-sidebar=auto]_&]:h-12 ${WHEN_COLLAPSED_CENTER}`}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-[6px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brand.logoSrc} alt="" className="h-full w-full object-cover" />
        </span>
        <span className={`truncate text-[14px] font-semibold text-mc-text ${WHEN_COLLAPSED_HIDE}`}>{brand.name}</span>
      </Link>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3">
        {groups.map((group, index) => (
          <div key={group.key}>
            {group.label ? (
              <>
                <p className={`px-2.5 pb-1 pt-4 text-[11px] font-medium text-mc-text-tertiary ${WHEN_COLLAPSED_HIDE}`}>
                  {group.label}
                </p>
                {/* Rail compressa: un solo filetto, tra i moduli e il primo
                    gruppo di link esterni; i gruppi esterni successivi
                    restano uniti. */}
                {!groups[index - 1]?.label && (
                  <div className={`mx-2 my-1.5 border-t border-mc-border-subtle ${WHEN_COLLAPSED_SHOW}`} />
                )}
              </>
            ) : index > 0 ? (
              // Gruppo interno senza titolo (es. amministrazione): filetto solo
              // nella sidebar espansa; nella rail resta coi moduli.
              <div className={`mx-2.5 my-2 border-t border-mc-border-subtle ${WHEN_COLLAPSED_HIDE}`} />
            ) : null}

            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const iconClasses = `h-[18px] w-[18px] shrink-0 ${item.iconClassName ?? ""}`;

                if (item.external) {
                  return (
                    <li key={item.key}>
                      <ShellTooltip label={item.label} enabled={tooltips}>
                        <a
                          href={item.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={onNavigate}
                          aria-label={item.label}
                          className={`${itemBase} ${itemIdle}`}
                        >
                          <Icon className={iconClasses} />
                          <span className={`truncate ${WHEN_COLLAPSED_HIDE}`}>{item.label}</span>
                          <ArrowUpRight
                            className={`absolute right-2 h-3.5 w-3.5 opacity-0 transition group-hover:opacity-60 ${WHEN_COLLAPSED_HIDE}`}
                          />
                        </a>
                      </ShellTooltip>
                    </li>
                  );
                }

                const active = isActivePath(pathname, item.href);

                return (
                  <li key={item.key}>
                    <ShellTooltip label={item.label} enabled={tooltips}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-label={item.label}
                        aria-current={active ? "page" : undefined}
                        className={`${itemBase} ${active ? "bg-mc-brand-subtle font-semibold text-teal" : itemIdle}`}
                      >
                        {active && <span className="absolute bottom-2 left-0 top-2 w-[2px] rounded-full bg-teal" />}
                        <Icon className={iconClasses} />
                        <span className={`truncate ${WHEN_COLLAPSED_HIDE}`}>{item.label}</span>
                      </Link>
                    </ShellTooltip>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {(actions.length > 0 || collapseControl) && (
        <div className="shrink-0 space-y-0.5 border-t border-mc-border px-2 py-2">
          {collapseControl && (
            // Comando di interfaccia, non una voce di modulo: piu' basso, testo
            // secondario a peso normale, icona piu' piccola ma piu' scura del testo.
            <ShellTooltip label="Espandi menu" enabled={tooltips}>
              <button
                type="button"
                onClick={collapseControl.onToggle}
                aria-label={collapseControl.collapsed ? "Espandi menu" : "Comprimi menu"}
                aria-expanded={!collapseControl.collapsed}
                className={`group mb-1 flex h-8 w-full items-center gap-2.5 rounded-[6px] px-2.5 text-[12.5px] font-normal text-mc-text-secondary transition hover:bg-mc-surface-summary hover:text-mc-text focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal ${WHEN_COLLAPSED_CENTER}`}
              >
                <PanelLeftClose
                  className={`h-4 w-4 shrink-0 text-mc-text-label group-hover:text-mc-text ${WHEN_COLLAPSED_HIDE}`}
                />
                <PanelLeftOpen
                  className={`h-4 w-4 shrink-0 text-mc-text-label group-hover:text-mc-text ${WHEN_COLLAPSED_SHOW}`}
                />
                <span className={`truncate ${WHEN_COLLAPSED_HIDE}`}>Comprimi menu</span>
              </button>
            </ShellTooltip>
          )}

          {actions.map((action) => {
            const Icon = action.icon;

            return (
              <div key={action.key}>
                <ShellTooltip label={action.label} enabled={tooltips}>
                  <button
                    type="button"
                    onClick={action.onClick}
                    disabled={action.disabled}
                    aria-label={action.label}
                    className={`${itemBase} font-medium disabled:cursor-not-allowed disabled:opacity-60 ${
                      action.tone === "danger"
                        ? "text-mc-negative hover:bg-mc-surface-summary"
                        : "text-mc-text-secondary hover:bg-mc-surface-summary hover:text-mc-text"
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    <span className={`truncate ${WHEN_COLLAPSED_HIDE}`}>{action.label}</span>
                  </button>
                </ShellTooltip>
                {action.message && (
                  <p className={`px-2.5 pb-1 text-[11px] leading-4 text-mc-text-tertiary ${WHEN_COLLAPSED_HIDE}`}>
                    {action.message}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Struttura dell'app: sotto 1280px barra superiore compatta e navigazione
// in un drawer da sinistra; da 1280px sidebar permanente, compressa (64px)
// o espansa (216px) secondo la preferenza.
export function AppShell({ brand, groups, actions, children }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Server e primo render partono sempre da "auto": nessuna differenza di
  // hydration. La preferenza salvata arriva subito dopo.
  const preference = useSyncExternalStore(subscribeSidebarPreference, readSidebarPreference, () => "auto" as const);
  // Fascia >=1440px, per sapere se "auto" e' compressa (tooltip, verso del
  // pulsante). Il disegno non dipende da qui: lo fa il CSS.
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE_QUERY).matches, () => false);
  // Le transizioni partono solo dopo il primo frame, cosi' il ripristino
  // della preferenza al caricamento non si anima.
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setAnimate(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const collapsed = preference === "collapsed" || (preference === "auto" && !wide);

  function toggleSidebar() {
    const next: SidebarPreference = collapsed ? "expanded" : "collapsed";
    memoryPreference = next;
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next);
    } catch {
      // Storage non disponibile: la scelta non viene salvata.
    }
    window.dispatchEvent(new Event(SIDEBAR_CHANGE_EVENT));
  }

  return (
    <TooltipPrimitive.Provider>
      <div data-sidebar={preference} className="min-h-screen bg-mc-page text-near-black">
        <header className="sticky top-0 z-40 flex h-[52px] items-center gap-2 bg-teal px-3 xl:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Apri il menu"
            className="flex h-9 w-9 items-center justify-center rounded-[8px] text-white transition hover:bg-white/15"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Link href={brand.href} className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={brand.logoSrc} alt="" className="h-full w-full object-cover" />
            </span>
            <span className="truncate text-[14px] font-semibold text-white">{brand.name}</span>
          </Link>
        </header>

        <aside
          className={`fixed inset-y-0 left-0 z-30 hidden border-r border-mc-border xl:block ${SIDEBAR_WIDTH} ${
            animate ? "transition-[width] duration-150 ease-out" : ""
          }`}
        >
          <ShellNavigation
            brand={brand}
            groups={groups}
            actions={actions}
            tooltips={collapsed}
            collapseControl={{ collapsed, onToggle: toggleSidebar }}
          />
        </aside>

        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent
            side="left"
            showCloseButton={false}
            className="w-[272px] gap-0 border-r border-mc-border bg-mc-surface p-0 sm:max-w-[272px]"
          >
            <SheetTitle className="sr-only">Navigazione</SheetTitle>
            <ShellNavigation
              brand={brand}
              groups={groups}
              actions={actions}
              onNavigate={() => setDrawerOpen(false)}
            />
          </SheetContent>
        </Sheet>

        <main
          className={`px-4 py-6 md:px-6 xl:px-8 ${MAIN_OFFSET} ${
            animate ? "transition-[margin] duration-150 ease-out" : ""
          }`}
        >
          <div className="mx-auto w-full max-w-[1600px]">{children}</div>
        </main>
      </div>
    </TooltipPrimitive.Provider>
  );
}

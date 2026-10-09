"use client";

import { ComponentType, ReactNode, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Menu } from "lucide-react";
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

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const itemBase = "group relative flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2.5 text-[13.5px] transition";
const itemIdle = "font-medium text-mc-text-secondary hover:bg-mc-surface-summary hover:text-mc-text";

// Contenuto della navigazione: lo stesso nodo per sidebar desktop e drawer.
function ShellNavigation({
  brand,
  groups,
  actions = [],
  onNavigate,
}: Omit<AppShellProps, "children"> & { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col bg-mc-surface">
      <Link href={brand.href} onClick={onNavigate} className="flex h-14 shrink-0 items-center gap-2.5 px-4">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-[6px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brand.logoSrc} alt="" className="h-full w-full object-cover" />
        </span>
        <span className="truncate text-[14px] font-semibold text-mc-text">{brand.name}</span>
      </Link>

      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {groups.map((group, index) => (
          <div key={group.key}>
            {group.label ? (
              <p className="px-2.5 pb-1 pt-4 text-[11px] font-medium text-mc-text-tertiary">{group.label}</p>
            ) : index > 0 ? (
              <div className="mx-2.5 my-2 border-t border-mc-border-subtle" />
            ) : null}

            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const iconClasses = `h-[18px] w-[18px] shrink-0 ${item.iconClassName ?? ""}`;

                if (item.external) {
                  return (
                    <li key={item.key}>
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={onNavigate}
                        className={`${itemBase} ${itemIdle}`}
                      >
                        <Icon className={iconClasses} />
                        <span className="truncate">{item.label}</span>
                        <ArrowUpRight className="absolute right-2 h-3.5 w-3.5 opacity-0 transition group-hover:opacity-60" />
                      </a>
                    </li>
                  );
                }

                const active = isActivePath(pathname, item.href);

                return (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={`${itemBase} ${active ? "bg-mc-brand-subtle font-semibold text-teal" : itemIdle}`}
                    >
                      {active && <span className="absolute bottom-2 left-0 top-2 w-[2px] rounded-full bg-teal" />}
                      <Icon className={iconClasses} />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {actions.length > 0 && (
        <div className="shrink-0 space-y-0.5 border-t border-mc-border px-2 py-2">
          {actions.map((action) => {
            const Icon = action.icon;

            return (
              <div key={action.key}>
                <button
                  type="button"
                  onClick={action.onClick}
                  disabled={action.disabled}
                  className={`${itemBase} font-medium disabled:cursor-not-allowed disabled:opacity-60 ${
                    action.tone === "danger"
                      ? "text-mc-negative hover:bg-mc-surface-summary"
                      : "text-mc-text-secondary hover:bg-mc-surface-summary hover:text-mc-text"
                  }`}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                  <span className="truncate">{action.label}</span>
                </button>
                {action.message && (
                  <p className="px-2.5 pb-1 text-[11px] leading-4 text-mc-text-tertiary">{action.message}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Struttura dell'app: da 1280px sidebar permanente a sinistra; sotto, barra
// superiore compatta e la stessa navigazione in un drawer da sinistra.
export function AppShell({ brand, groups, actions, children }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="min-h-screen bg-mc-page text-near-black">
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

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[216px] border-r border-mc-border xl:block">
        <ShellNavigation brand={brand} groups={groups} actions={actions} />
      </aside>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="w-[272px] gap-0 border-r border-mc-border bg-mc-surface p-0 sm:max-w-[272px]"
        >
          <SheetTitle className="sr-only">Navigazione</SheetTitle>
          <ShellNavigation brand={brand} groups={groups} actions={actions} onNavigate={() => setDrawerOpen(false)} />
        </SheetContent>
      </Sheet>

      <main className="px-4 py-6 md:px-6 xl:ml-[216px] xl:px-8">
        <div className="mx-auto w-full max-w-[1600px]">{children}</div>
      </main>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { tasks } from "../../lib/tasks";

export default function DashboardPage() {
  const [menuOpen, setMenuOpen] = useState(false);

  const today = new Date().toISOString().split("T")[0];

  const openTasks = tasks.filter((task) => task.status === "open");

  const overdueTasks = tasks.filter(
    (task) => task.status === "open" && task.dueDate < today
  );

  const dueTodayTasks = tasks.filter(
    (task) => task.status === "open" && task.dueDate === today
  );

  const overviewCards = [
    {
      title: "Task aperte",
      value: openTasks.length.toString(),
      note: "Task attualmente aperte",
      href: "/operations",
      active: true,
    },
    {
      title: "Task in ritardo",
      value: overdueTasks.length.toString(),
      note: "Richiedono attenzione",
      href: "/operations",
      alert: true,
    },
    {
      title: "In scadenza oggi",
      value: dueTodayTasks.length.toString(),
      note: "Da monitorare oggi",
      href: "/operations",
    },
    {
      title: "Tempo tracciato oggi",
      value: "5h 40m",
      note: "8 attività registrate",
      href: "/time-tracking",
    },
  ];

  const recentActivities = tasks.slice(0, 4).map((task) => ({
    title: task.title,
    meta: task.area,
    status: task.status === "completed" ? "Completata" : "Aperta",
  }));

  const quickAccess = [
    {
      title: "Operations",
      description: "Task manager, assegnazioni, priorità e controllo operativo.",
      href: "/operations",
    },
    {
      title: "Time Tracking",
      description: "Tempo reale, attività operative, marginalità e attività non tracciate.",
      href: "/time-tracking",
    },
    {
      title: "Performance",
      description: "KPI strutture, confronto storico, import dati e report.",
      href: "/performance",
    },
    {
      title: "CRM",
      description: "Contatti, clienti, relazioni e pipeline commerciale.",
      href: "/crm",
    },
    {
      title: "Finance",
      description: "Controllo economico, costi, ricavi e visione finanziaria.",
      href: "/finance",
    },
  ];

  const menuItems = [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Operations", href: "/operations" },
    { label: "Time Tracking", href: "/time-tracking" },
    { label: "Performance", href: "/performance" },
    { label: "CRM", href: "/crm" },
    { label: "Finance", href: "/finance" },
  ];

  return (
    <main className="min-h-screen bg-[#f5f3ef] px-6 py-8 text-[#2B2D2F] md:px-10">
      {menuOpen && (
        <div className="fixed inset-0 z-50 bg-black/25">
          <div className="absolute right-0 top-0 flex h-full w-full max-w-[340px] flex-col border-l border-[#e7dfd8] bg-white p-6 shadow-[0_12px_30px_rgba(43,45,47,0.10)]">
            <div className="mb-8 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#017A92]">
                  MeToDo Control
                </p>
                <h2 className="mt-2 text-2xl tracking-tight">Menu</h2>
              </div>

              <button
                onClick={() => setMenuOpen(false)}
                className="rounded-[12px] border border-[#e7dfd8] bg-[#fcfbf9] px-3 py-2 text-sm text-[#2B2D2F] transition hover:bg-[#f5f0ea]"
              >
                Chiudi
              </button>
            </div>

            <nav className="space-y-3">
              {menuItems.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-[18px] border border-[#ebe4dc] bg-[#fcfbf9] px-4 py-4 text-sm font-medium text-[#2B2D2F] transition hover:border-[#017A92] hover:bg-[#f3f8fa]"
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            <div className="mt-auto border-t border-[#e7dfd8] pt-6">
              <Link
                href="/"
                className="inline-flex rounded-[14px] border border-[#993333]/20 bg-[#993333]/8 px-4 py-3 text-sm font-semibold text-[#993333] transition hover:bg-[#993333]/12"
              >
                Logout
              </Link>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#017A92]">
              MeToDo Control
            </p>
          </div>

          <button
            onClick={() => setMenuOpen(true)}
            className="flex h-12 w-12 items-center justify-center rounded-[14px] border border-[#e7dfd8] bg-white shadow-[0_6px_16px_rgba(43,45,47,0.03)] transition hover:bg-[#fcfbf9]"
            aria-label="Apri menu"
          >
            <div className="flex flex-col gap-[4px]">
              <span className="block h-[2px] w-5 bg-[#2B2D2F]" />
              <span className="block h-[2px] w-5 bg-[#2B2D2F]" />
              <span className="block h-[2px] w-5 bg-[#2B2D2F]" />
            </div>
          </button>
        </div>

        <section className="overflow-hidden rounded-[24px] border border-[#e7dfd8] bg-white shadow-[0_12px_30px_rgba(43,45,47,0.05)]">
          <div className="grid md:grid-cols-[320px_1fr]">
            <div className="flex min-h-[260px] items-center justify-center bg-gradient-to-br from-[#2B2D2F] to-[#343739] p-8">
              <div className="flex h-[172px] w-[172px] items-center justify-center rounded-[20px] bg-white shadow-[0_12px_30px_rgba(43,45,47,0.12)]">
                <img
                  src="/images/metodo-logo.png"
                  alt="MeToDo logo"
                  className="h-[140px] w-auto object-contain"
                />
              </div>
            </div>

            <div className="p-8 md:p-10">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#017A92]">
                Dashboard
              </p>

              <h1 className="mt-3 text-5xl tracking-tight">Overview generale</h1>

              <p className="mt-4 max-w-3xl text-[17px] leading-8 text-[#555555]">
                Controllo sintetico del lavoro operativo e strategico con accesso rapido
                ai cinque ambienti principali del sistema.
              </p>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {overviewCards.map((card) => (
            <Link
              key={card.title}
              href={card.href}
              className={`rounded-[20px] border px-5 py-4 shadow-[0_6px_16px_rgba(43,45,47,0.03)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(43,45,47,0.05)] ${
                card.active
                  ? "border-[#017A92] bg-[#f3f8fa]"
                  : "border-[#e7dfd8] bg-white"
              }`}
            >
              <p
                className={`text-xs font-semibold uppercase tracking-[0.22em] ${
                  card.alert ? "text-[#993333]" : "text-[#017A92]"
                }`}
              >
                {card.title}
              </p>

              <p className="mt-4 text-4xl font-semibold leading-none text-[#2B2D2F]">
                {card.value}
              </p>

              <p className="mt-3 text-sm text-[#555555]">{card.note}</p>
            </Link>
          ))}
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.6fr_1fr]">
          <div className="rounded-[24px] border border-[#e7dfd8] bg-white p-6 shadow-[0_12px_30px_rgba(43,45,47,0.05)]">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-2xl text-[#2B2D2F]">Attività recenti</h2>
                <p className="mt-2 text-sm text-[#555555]">
                  Vista operativa compatta delle ultime attività registrate.
                </p>
              </div>

              <Link
                href="/operations"
                className="rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 py-2 text-sm font-medium text-[#2B2D2F] transition hover:bg-[#f7f3ee]"
              >
                Vai a Operations
              </Link>
            </div>

            <div className="space-y-4">
              {recentActivities.map((item, index) => (
                <div
                  key={index}
                  className="rounded-[18px] border border-[#ebe4dc] bg-[#fcfbf9] p-4 shadow-[0_6px_16px_rgba(43,45,47,0.03)]"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-[#2B2D2F]">
                        {item.title}
                      </h3>
                      <p className="mt-1 text-sm text-[#555555]">{item.meta}</p>
                    </div>

                    <span className="inline-flex w-fit rounded-full border border-[#dbe8eb] bg-[#f3f8fa] px-3 py-1 text-xs font-semibold text-[#017A92]">
                      {item.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[24px] border border-[#e7dfd8] bg-white p-6 shadow-[0_12px_30px_rgba(43,45,47,0.05)]">
            <div>
              <h2 className="text-2xl text-[#2B2D2F]">Focus del giorno</h2>
              <p className="mt-2 text-sm text-[#555555]">
                Priorità e segnali da leggere subito.
              </p>
            </div>

            <div className="mt-5 space-y-4">
              <div className="rounded-[18px] border border-[#ebe4dc] bg-[#fcfbf9] p-4">
                <span className="inline-flex rounded-full border border-[#dbe8eb] bg-[#f3f8fa] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#017A92]">
                  Ritardi
                </span>
                <p className="mt-3 text-sm leading-7 text-[#555555]">
                  Task in ritardo: {overdueTasks.length}
                </p>
              </div>

              <div className="rounded-[18px] border border-[#ebe4dc] bg-[#fcfbf9] p-4">
                <span className="inline-flex rounded-full border border-[#dbe8eb] bg-[#f3f8fa] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#017A92]">
                  Scadenze
                </span>
                <p className="mt-3 text-sm leading-7 text-[#555555]">
                  Task in scadenza oggi: {dueTodayTasks.length}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[24px] border border-[#e7dfd8] bg-white p-6 shadow-[0_12px_30px_rgba(43,45,47,0.05)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-2xl text-[#2B2D2F]">Accesso rapido</h2>
              <p className="mt-2 text-sm text-[#555555]">
                Entra velocemente nei cinque ambienti principali del gestionale.
              </p>
            </div>

            <div className="inline-flex rounded-full border border-[#dbe8eb] bg-[#f3f8fa] px-4 py-2 text-sm font-medium text-[#017A92]">
              Vista manageriale
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            {quickAccess.map((item) => (
              <Link
                key={item.title}
                href={item.href}
                className="rounded-[20px] border border-[#e7dfd8] bg-white p-5 shadow-[0_6px_16px_rgba(43,45,47,0.03)] transition hover:-translate-y-0.5 hover:border-[#017A92] hover:bg-[#f9fcfc]"
              >
                <div className="mb-4 h-1.5 w-12 rounded-full bg-[#017A92]" />
                <h3 className="text-lg font-semibold text-[#2B2D2F]">{item.title}</h3>
                <p className="mt-3 text-sm leading-7 text-[#555555]">
                  {item.description}
                </p>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type SupabaseTask = {
  id: string;
  titolo?: string | null;
  descrizione?: string | null;
  stato: "todo" | "in_progress" | "completed";
  priorita?: "low" | "medium" | "high" | null;
  due_date: string | null;
  created_at?: string | null;
  client_id?: string | null;
  owner_id?: string | null;
};

type RawTrackingEntry = Record<string, any>;
type RawProfile = Record<string, any>;
type RawClient = Record<string, any>;

export default function DashboardPage() {
  const [supabaseTasks, setSupabaseTasks] = useState<SupabaseTask[]>([]);
  const [trackingEntries, setTrackingEntries] = useState<RawTrackingEntry[]>([]);
  const [profiles, setProfiles] = useState<RawProfile[]>([]);
  const [clients, setClients] = useState<RawClient[]>([]);

  useEffect(() => {
    loadDashboardData();
  }, []);

  async function loadDashboardData() {
    const [
      { data: tasksData, error: tasksError },
      { data: trackingData, error: trackingError },
      { data: profilesData, error: profilesError },
      { data: clientsData, error: clientsError },
    ] = await Promise.all([
      supabase
        .from("tasks")
        .select("id, titolo, descrizione, stato, priorita, due_date, created_at, client_id, owner_id")
        .order("created_at", { ascending: false }),

      supabase
        .from("tracking")
        .select("*")
        .order("created_at", { ascending: false }),

      supabase
        .from("profiles")
        .select("*"),

      supabase
        .from("clients")
        .select("*"),
    ]);

    if (tasksError) {
      console.error("Errore lettura tasks:", tasksError);
    }

    if (trackingError) {
      console.error("Errore lettura tracking:", trackingError);
    } else {
      console.log("TRACKING RAW:", trackingData);
    }

    if (profilesError) {
      console.error("Errore lettura profiles:", profilesError);
    } else {
      console.log("PROFILES RAW:", profilesData);
    }

    if (clientsError) {
      console.error("Errore lettura clients:", clientsError);
    } else {
      console.log("CLIENTS RAW:", clientsData);
    }

    setSupabaseTasks((tasksData as SupabaseTask[]) || []);
    setTrackingEntries((trackingData as RawTrackingEntry[]) || []);
    setProfiles((profilesData as RawProfile[]) || []);
    setClients((clientsData as RawClient[]) || []);
  }

  const today = new Date().toISOString().split("T")[0];

  const profilesMap = useMemo(() => {
    return profiles.reduce<Record<string, string>>((acc, profile) => {
      const fullName =
        profile.name ||
        profile.full_name ||
        profile.display_name ||
        [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() ||
        profile.email ||
        "Operatore";

      if (profile.id) {
        acc[profile.id] = fullName;
      }

      return acc;
    }, {});
  }, [profiles]);

  const clientsMap = useMemo(() => {
    return clients.reduce<Record<string, string>>((acc, client) => {
      const clientName =
        client.name ||
        client.client_name ||
        client.nome ||
        "Cliente";

      if (client.id) {
        acc[client.id] = clientName;
      }

      return acc;
    }, {});
  }, [clients]);

  const openTasks = supabaseTasks.filter((task) => task.stato !== "completed");

  const overdueTasks = supabaseTasks.filter(
    (task) =>
      task.stato !== "completed" &&
      !!task.due_date &&
      task.due_date < today
  );

  const todayTasks = supabaseTasks.filter(
    (task) => task.stato !== "completed" && task.due_date === today
  );

  const highPriorityTasks = supabaseTasks.filter(
    (task) => task.stato !== "completed" && task.priorita === "high"
  );

  const todayTrackingEntries = trackingEntries.filter((entry) => {
    const entryDate = entry.date || entry.data || null;
    return entryDate === today;
  });

  const totalTrackedMinutesToday = todayTrackingEntries.reduce((total, entry) => {
    const minutes = entry.minutes ?? entry.minuti ?? 0;
    return total + Number(minutes);
  }, 0);

  const trackedHours = Math.floor(totalTrackedMinutesToday / 60);
  const trackedMinutes = totalTrackedMinutesToday % 60;

  const formattedTrackedTime =
    totalTrackedMinutesToday > 0
      ? `${trackedHours}h ${trackedMinutes}m`
      : "0h 0m";

  const areaMinutesMap = todayTrackingEntries.reduce<Record<string, number>>(
    (acc, entry) => {
      const areaName =
        entry.macro_area ||
        entry.macroArea ||
        (entry.client_id ? clientsMap[entry.client_id] : null) ||
        "Nessun dato";

      const minutes = Number(entry.minutes ?? entry.minuti ?? 0);

      acc[areaName] = (acc[areaName] || 0) + minutes;
      return acc;
    },
    {}
  );

  const operatorMinutesMap = todayTrackingEntries.reduce<Record<string, number>>(
    (acc, entry) => {
      const operatorId =
        entry.operator_id ||
        entry.owner_id ||
        entry.operator ||
        null;

      const operatorName =
        (operatorId ? profilesMap[operatorId] : null) ||
        entry.operator_name ||
        entry.nome_operatore ||
        "Nessun dato";

      const minutes = Number(entry.minutes ?? entry.minuti ?? 0);

      acc[operatorName] = (acc[operatorName] || 0) + minutes;
      return acc;
    },
    {}
  );

  const topTrackedAreaEntry = Object.entries(areaMinutesMap).sort(
    (a, b) => b[1] - a[1]
  )[0];

  const topOperatorEntry = Object.entries(operatorMinutesMap).sort(
    (a, b) => b[1] - a[1]
  )[0];

  const topTrackedArea = topTrackedAreaEntry
    ? {
        name: topTrackedAreaEntry[0],
        minutes: topTrackedAreaEntry[1],
      }
    : null;

  const topOperator = topOperatorEntry
    ? {
        name: topOperatorEntry[0],
        minutes: topOperatorEntry[1],
      }
    : null;

  const recentTaskActivities = supabaseTasks.slice(0, 2).map((task) => ({
    title: task.titolo || "Task senza titolo",
    meta:
      (task.client_id ? clientsMap[task.client_id] : null) ||
      "Operations",
    status:
      task.stato === "completed"
        ? "Completata"
        : task.stato === "in_progress"
        ? "In corso"
        : "Da fare",
    badgeVariant:
      task.stato === "completed"
        ? "border-[#d7e9df] bg-[#eef8f2] text-[#2c7a55]"
        : task.stato === "in_progress"
        ? "border-[#dbe8eb] bg-[#f3f8fa] text-[#017A92]"
        : "border-[#efe4cf] bg-[#fcf7ef] text-[#b0741a]",
  }));

  const recentTrackingActivities = todayTrackingEntries.slice(0, 2).map((entry) => {
    const activityName =
      entry.activity ||
      entry.attivita ||
      "Tracking registrato";

    const referenceName =
      entry.referenceName ||
      entry.reference_name ||
      (entry.client_id ? clientsMap[entry.client_id] : null) ||
      "";

    const operatorId =
      entry.operator_id ||
      entry.owner_id ||
      entry.operator ||
      null;

    const operatorName =
      (operatorId ? profilesMap[operatorId] : null) ||
      entry.operator_name ||
      entry.nome_operatore ||
      entry.macro_area ||
      entry.macroArea ||
      "Time Tracking";

    const minutes = Number(entry.minutes ?? entry.minuti ?? 0);

    return {
      title: referenceName ? `${activityName} • ${referenceName}` : activityName,
      meta: operatorName,
      status: `${minutes} min`,
      badgeVariant: "border-[#dbe8eb] bg-[#f3f8fa] text-[#017A92]",
    };
  });

  const recentActivities = [...recentTaskActivities, ...recentTrackingActivities].slice(
    0,
    4
  );

  const quickAccess = [
    {
      title: "Operations",
      description: "Task manager, assegnazioni, priorità e controllo operativo.",
      href: "/operations",
    },
    {
      title: "Time Tracking",
      description:
        "Tempo reale, attività operative, marginalità e attività non tracciate.",
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
    {
      title: "Projects",
      description:
        "Gestione progetti speciali, Puglia Destination Off e formazione.",
      href: "/projects",
    },
  ];

  const overviewCards = [
    {
      title: "Task aperte",
      value: openTasks.length.toString(),
      note: "Task reali da Supabase",
      href: "/operations",
      accent: "bg-[#017A92]",
      cardClass: "border-[#017A92] bg-[#f3f8fa]",
      labelClass: "text-[#017A92]",
      valueClass: "text-[#2B2D2F]",
    },
    {
      title: "Task in ritardo",
      value: overdueTasks.length.toString(),
      note: "Richiedono attenzione prioritaria",
      href: "/operations",
      accent: "bg-[#993333]",
      cardClass: "border-[#e7dfd8] bg-white",
      labelClass: "text-[#993333]",
      valueClass: "text-[#2B2D2F]",
    },
    {
      title: "Tempo tracciato oggi",
      value: formattedTrackedTime,
      note: `${todayTrackingEntries.length} attività registrate`,
      href: "/time-tracking",
      accent: "bg-[#017A92]",
      cardClass: "border-[#e7dfd8] bg-white",
      labelClass: "text-[#017A92]",
      valueClass: "text-[#2B2D2F]",
    },
    {
      title: "Task oggi",
      value: todayTasks.length.toString(),
      note: "Scadenze operative giornaliere",
      href: "/operations",
      accent: "bg-[#017A92]",
      cardClass: "border-[#e7dfd8] bg-white",
      labelClass: "text-[#017A92]",
      valueClass: "text-[#2B2D2F]",
    },
  ];

  return (
    <>
      <section className="overflow-hidden rounded-[24px] border border-[#e7dfd8] bg-white shadow-[0_12px_30px_rgba(43,45,47,0.05)]">
        <div className="grid md:grid-cols-[320px_1fr]">
          <div className="flex min-h-[260px] items-center justify-center bg-gradient-to-br from-[#017A92] to-[#2B2D2F] p-8">
            <div className="flex h-[140px] w-[140px] items-center justify-center rounded-[20px] border border-white/20 bg-white shadow-[0_12px_30px_rgba(43,45,47,0.12)]">
              <img
                src="/images/metodo-logo.png"
                alt="MeToDo logo"
                className="h-[92px] w-auto object-contain"
              />
            </div>
          </div>

          <div className="p-8 md:p-10">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#017A92]">
              Dashboard
            </p>

            <h1 className="mt-3 text-4xl tracking-tight text-[#2B2D2F] md:text-5xl">
              Overview generale
            </h1>

            <p className="mt-4 max-w-3xl text-sm leading-7 text-[#555555] md:text-[15px]">
              Snapshot sintetico di attività operative e tempo registrato, con
              accesso rapido agli ambienti principali del sistema.
            </p>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {overviewCards.map((card) => (
          <Link
            key={card.title}
            href={card.href}
            className={`rounded-[20px] border px-5 py-4 shadow-[0_6px_16px_rgba(43,45,47,0.03)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(43,45,47,0.05)] ${card.cardClass}`}
          >
            <div className={`mb-4 h-1.5 w-8 rounded-full ${card.accent}`} />

            <p
              className={`text-[11px] font-semibold uppercase tracking-[0.22em] ${card.labelClass}`}
            >
              {card.title}
            </p>

            <p className={`mt-4 text-4xl font-semibold leading-none ${card.valueClass}`}>
              {card.value}
            </p>

            <p className="mt-3 text-sm text-[#555555]">{card.note}</p>
          </Link>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="rounded-[24px] border border-[#e7dfd8] bg-white p-6 shadow-[0_12px_30px_rgba(43,45,47,0.05)]">
          <div className="mb-5 flex items-center justify-between gap-4">
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
                key={`${item.title}-${index}`}
                className="rounded-[18px] border border-[#ebe4dc] bg-[#fcfbf9] p-4 shadow-[0_6px_16px_rgba(43,45,47,0.03)]"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-[#2B2D2F]">
                      {item.title}
                    </h3>
                    <p className="mt-1 text-sm text-[#555555] capitalize">
                      {item.meta}
                    </p>
                  </div>

                  <span
                    className={`inline-flex w-fit rounded-full border px-3 py-1 text-xs font-semibold ${item.badgeVariant}`}
                  >
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
              Interpretazione sintetica delle priorità operative.
            </p>
          </div>

          <div className="mt-5 space-y-4">
            <div className="rounded-[18px] border border-[#d7e9df] bg-[#eef8f2] p-4">
              <span className="inline-flex rounded-full border border-[#d7e9df] bg-[#eef8f2] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2c7a55]">
                Priorità
              </span>
              <p className="mt-3 text-4xl font-semibold text-[#2B2D2F]">
                {highPriorityTasks.length}
              </p>
              <p className="mt-2 text-sm leading-6 text-[#555555]">
                Task aperte ad alta priorità da presidiare
              </p>
            </div>

            <div className="rounded-[18px] border border-[#dbe8eb] bg-[#f3f8fa] p-4">
              <span className="inline-flex rounded-full border border-[#dbe8eb] bg-[#f3f8fa] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#017A92]">
                Area più attiva
              </span>
              <p className="mt-3 text-2xl font-semibold text-[#2B2D2F] capitalize">
                {topTrackedArea ? topTrackedArea.name : "Nessun dato"}
              </p>
              <p className="mt-2 text-sm leading-6 text-[#555555]">
                {topTrackedArea
                  ? `${topTrackedArea.minutes} minuti registrati oggi`
                  : "Nessuna registrazione nella giornata"}
              </p>
            </div>

            <div className="rounded-[18px] border border-[#ebe4dc] bg-[#fcfbf9] p-4">
              <span className="inline-flex rounded-full border border-[#e7dfd8] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#555555]">
                Operatore
              </span>
              <p className="mt-3 text-2xl font-semibold text-[#2B2D2F]">
                {topOperator ? topOperator.name : "Nessun dato"}
              </p>
              <p className="mt-2 text-sm leading-6 text-[#555555]">
                {topOperator
                  ? `${topOperator.minutes} minuti registrati oggi`
                  : "Nessuna attività registrata"}
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
              Entra velocemente negli ambienti principali del gestionale.
            </p>
          </div>

          <div className="inline-flex rounded-full border border-[#dbe8eb] bg-[#f3f8fa] px-4 py-2 text-sm font-medium text-[#017A92]">
            Vista manageriale
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
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
    </>
  );
}
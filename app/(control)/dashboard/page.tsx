"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { KpiCard } from "@/components/ui/KpiCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { canViewModule } from "@/lib/permissions";
import { todayString, monthRange } from "@/lib/performanceMetrics";

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

type PerformanceSummary = {
  green: number;
  yellow: number;
  red: number;
};

export default function DashboardPage() {
  const [supabaseTasks, setSupabaseTasks] = useState<SupabaseTask[]>([]);
  const [trackingEntries, setTrackingEntries] = useState<RawTrackingEntry[]>([]);
  const [profiles, setProfiles] = useState<RawProfile[]>([]);
  const [clients, setClients] = useState<RawClient[]>([]);

  // Gate lato client (nasconde la card) - il gate che conta davvero e'
  // quello lato query in loadPerformanceSummary: v_snapshot_latest e
  // performance_daily_snapshot sono protette da RLS che richiede
  // fn_user_level_rank(auth.uid()) >= 2 (senior/master), quindi anche
  // aggirando questo stato un utente 'user' otterrebbe comunque righe
  // vuote, non dati reali.
  const [performanceAccess, setPerformanceAccess] = useState(false);
  const [performanceSummary, setPerformanceSummary] = useState<PerformanceSummary | null>(null);

  useEffect(() => {
    loadDashboardData();
    void loadPerformanceSummary();
  }, []);

  async function loadPerformanceSummary() {
    const allowed = await canViewModule("performance");
    setPerformanceAccess(allowed);

    if (!allowed) {
      setPerformanceSummary(null);
      return;
    }

    const { data: structuresData, error: structuresError } = await supabase
      .from("structures")
      .select("id");

    if (structuresError) {
      console.error("Errore lettura strutture per sintesi Performance:", structuresError);
      return;
    }

    const ids = (structuresData || []).map((s) => s.id as string);

    if (ids.length === 0) {
      setPerformanceSummary({ green: 0, yellow: 0, red: 0 });
      return;
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const { start: monthStart, end: monthEnd } = monthRange(todayString());

    const [monthRes, budgetsRes] = await Promise.all([
      // Query diretta su v_snapshot_latest, stessa fonte e stesso metodo
      // (somma dei giorni del mese) della tabella Strutture in
      // /performance - NON piu' fn_month_snapshot_asof: quella funzione
      // preferisce sempre la riga piu' recente di performance_monthly_snapshot
      // se esiste, corretto per un confronto SDLY su un mese chiuso (dove
      // quella riga e' per definizione il dato finale) ma sbagliato per il
      // mese in corso, dove puo' restare indietro di settimane rispetto ai
      // dati giornalieri (bug verificato: Sangiorgio Resort ago 2026,
      // 69.903 EUR dalla riga mensile piu' recente - ferma al 30/06 - contro
      // 89.657 EUR reali dalla somma giornaliera aggiornata al 10/08,
      // sufficiente a farlo classificare "sotto minimo" invece di "sopra
      // realistico"). v_snapshot_latest e' security invoker dalla stessa
      // migration che ha chiuso questo bypass, quindi la query diretta e'
      // sicura quanto la RPC: un utente 'user' riceve comunque 0 righe.
      supabase
        .from("v_snapshot_latest")
        .select("structure_id, revenue_total")
        .gte("stay_date", monthStart)
        .lte("stay_date", monthEnd)
        .in("structure_id", ids),
      supabase
        .from("v_budgets_current")
        .select("structure_id, level, revenue_target")
        .eq("season_year", year)
        .eq("month", month)
        .in("structure_id", ids),
    ]);

    if (monthRes.error) {
      console.error("Errore lettura sintesi Performance:", monthRes.error);
    }

    if (budgetsRes.error) {
      console.error("Errore lettura budget sintesi Performance:", budgetsRes.error);
    }

    const revenueByStructure = new Map<string, number>();
    (monthRes.data || []).forEach((r: { structure_id: string; revenue_total: number }) => {
      revenueByStructure.set(
        r.structure_id,
        (revenueByStructure.get(r.structure_id) ?? 0) + Number(r.revenue_total)
      );
    });

    const targetsByStructure = new Map<string, { minimo?: number; realistico?: number }>();
    (budgetsRes.data || []).forEach((row: { structure_id: string; level: string; revenue_target: number }) => {
      const entry = targetsByStructure.get(row.structure_id) || {};
      if (row.level === "minimo") entry.minimo = (entry.minimo ?? 0) + Number(row.revenue_target);
      if (row.level === "realistico") entry.realistico = (entry.realistico ?? 0) + Number(row.revenue_target);
      targetsByStructure.set(row.structure_id, entry);
    });

    // Stesse soglie di lib/performanceMetrics.ts#computePacingStatus (rosso
    // sotto Minimo, giallo tra Minimo e Realistico, verde sopra Realistico)
    // - qui replicate su valori scalari perche' non serve il resto
    // dell'oggetto BudgetRow, solo il conteggio per la card di sintesi.
    const counts: PerformanceSummary = { green: 0, yellow: 0, red: 0 };

    ids.forEach((id) => {
      const revenue = revenueByStructure.get(id);
      const targets = targetsByStructure.get(id);

      if (revenue === undefined || targets?.minimo === undefined || targets?.realistico === undefined) {
        return;
      }

      if (revenue < targets.minimo) counts.red += 1;
      else if (revenue < targets.realistico) counts.yellow += 1;
      else counts.green += 1;
    });

    setPerformanceSummary(counts);
  }

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
        .select("id, data, minuti, attivita, operator_id, client_id, created_at")
        .order("created_at", { ascending: false }),

      supabase
        .from("profiles")
        .select("id, email"),

      supabase
        .from("clients")
        .select("id, name"),
    ]);

    if (tasksError) {
      console.error("Errore lettura tasks:", tasksError);
    }

    if (trackingError) {
      console.error("Errore lettura tracking:", trackingError);
    }

    if (profilesError) {
      console.error("Errore lettura profiles:", profilesError);
    }

    if (clientsError) {
      console.error("Errore lettura clients:", clientsError);
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

  const overviewCards = [
    {
      title: "Task aperte",
      value: openTasks.length.toString(),
      note: "Task reali da Supabase",
      href: "/operations",
      active: true,
    },
    {
      title: "Task in ritardo",
      value: overdueTasks.length.toString(),
      note: "Richiedono attenzione prioritaria",
      href: "/operations",
      alert: overdueTasks.length > 0,
    },
    {
      title: "Tempo tracciato oggi",
      value: formattedTrackedTime,
      note: `${todayTrackingEntries.length} attività registrate`,
      href: "/time-tracking",
    },
    {
      title: "Task oggi",
      value: todayTasks.length.toString(),
      note: "Scadenze operative giornaliere",
      href: "/operations",
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Dashboard"
        title="Overview generale"
        description="Snapshot sintetico di attività operative e tempo registrato, con accesso rapido agli ambienti principali del sistema."
      />

      <section className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
        {overviewCards.map((card) => (
          <KpiCard
            key={card.title}
            title={card.title}
            value={card.value}
            note={card.note}
            href={card.href}
            active={card.active}
            alert={card.alert}
          />
        ))}
      </section>

      {performanceAccess && performanceSummary && (
        <section className="rounded-[24px] border border-[#e7dfd8] bg-white p-6 shadow-[0_12px_30px_rgba(43,45,47,0.05)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-2xl text-[#2B2D2F]">Sintesi Performance</h2>
              <p className="mt-2 text-sm text-[#555555]">
                Ritmo verso il budget del mese corrente, per tutte le strutture.
              </p>
            </div>

            <Link
              href="/performance"
              className="rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 py-2 text-sm font-medium text-[#2B2D2F] transition hover:bg-[#f7f3ee]"
            >
              Vai a Performance
            </Link>
          </div>

          <div className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
            <KpiCard
              title="Sopra Realistico"
              value={performanceSummary.green.toString()}
              note="Strutture sopra il budget Realistico del mese"
              href="/performance"
            />
            <KpiCard
              title="Tra Minimo e Realistico"
              value={performanceSummary.yellow.toString()}
              note="Strutture in linea, tra Minimo e Realistico"
              href="/performance"
            />
            <KpiCard
              title="Sotto Minimo"
              value={performanceSummary.red.toString()}
              note="Strutture sotto il budget Minimo del mese"
              href="/performance"
              alert={performanceSummary.red > 0}
            />
          </div>
        </section>
      )}

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
    </>
  );
}
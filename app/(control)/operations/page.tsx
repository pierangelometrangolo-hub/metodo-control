"use client";

import { useMemo, useState } from "react";
import { AppCard } from "@/components/ui/AppCard";
import { AppButton } from "@/components/ui/AppButton";
import { AppBadge } from "@/components/ui/AppBadge";
import { AppInput } from "@/components/ui/AppInput";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionHeader } from "@/components/ui/SectionHeader";

type TaskStatus = "Da fare" | "In corso" | "Completato";
type TaskPriority = "Bassa" | "Media" | "Alta";
type KpiFilter = "Totali" | "Da fare" | "In corso" | "Completate" | "In ritardo";

type Task = {
  id: number;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  owner: string;
  dueDate?: string;
  openedAt: string;
  closedAt?: string;
  archived: boolean;
};

const team = [
  "Pierangelo",
  "Alessandro",
  "Gianluca",
  "Giorgia",
  "Alessandra",
];

function formatDate(date?: string) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("it-IT");
}

function daysBetween(start?: string, end?: string) {
  if (!start || !end) return null;
  const startDate = new Date(start);
  const endDate = new Date(end);
  const diff = endDate.getTime() - startDate.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export default function OperationsPage() {
  const [tasks, setTasks] = useState<Task[]>([
    {
      id: 1,
      title: "Check camere VIP",
      status: "In corso",
      priority: "Alta",
      owner: "Giorgia",
      dueDate: "2026-04-11",
      openedAt: "2026-04-08",
      archived: false,
    },
    {
      id: 2,
      title: "Aggiornamento listino bar",
      status: "Da fare",
      priority: "Media",
      owner: "Gianluca",
      dueDate: "2026-04-12",
      openedAt: "2026-04-09",
      archived: false,
    },
    {
      id: 3,
      title: "Controllo colazioni",
      status: "Completato",
      priority: "Bassa",
      owner: "Pierangelo",
      dueDate: "2026-04-10",
      openedAt: "2026-04-07",
      closedAt: "2026-04-10",
      archived: true,
    },
  ]);

  const [newTask, setNewTask] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [newDueDate, setNewDueDate] = useState("");

  const [filterOwner, setFilterOwner] = useState("Tutti");
  const [filterStatus, setFilterStatus] = useState("Tutti");
  const [filterPriority, setFilterPriority] = useState("Tutte");
  const [searchTerm, setSearchTerm] = useState("");
  const [activeKpi, setActiveKpi] = useState<KpiFilter>("Totali");
  const [showArchivedOnly, setShowArchivedOnly] = useState(false);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const isLate = (task: Task) => {
    if (!task.dueDate || task.status === "Completato") return false;
    const due = new Date(task.dueDate);
    due.setHours(0, 0, 0, 0);
    return due < today;
  };

  const totalTasks = tasks.length;
  const todoTasks = tasks.filter((t) => t.status === "Da fare").length;
  const inProgressTasks = tasks.filter((t) => t.status === "In corso").length;
  const completedTasks = tasks.filter((t) => t.status === "Completato").length;
  const delayedTasks = tasks.filter((t) => isLate(t)).length;

  const sortedTasks = useMemo(() => {
    const priorityOrder: Record<TaskPriority, number> = {
      Alta: 0,
      Media: 1,
      Bassa: 2,
    };

    const statusOrder: Record<TaskStatus, number> = {
      "Da fare": 0,
      "In corso": 1,
      Completato: 2,
    };

    return [...tasks].sort((a, b) => {
      const archivedCompare = Number(a.archived) - Number(b.archived);
      if (archivedCompare !== 0) return archivedCompare;

      const priorityCompare = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityCompare !== 0) return priorityCompare;

      const statusCompare = statusOrder[a.status] - statusOrder[b.status];
      if (statusCompare !== 0) return statusCompare;

      return a.title.localeCompare(b.title);
    });
  }, [tasks]);

  const filteredTasks = sortedTasks.filter((task) => {
    const ownerMatch = filterOwner === "Tutti" || task.owner === filterOwner;
    const statusMatch = filterStatus === "Tutti" || task.status === filterStatus;
    const priorityMatch =
      filterPriority === "Tutte" || task.priority === filterPriority;

    const search = searchTerm.trim().toLowerCase();
    const searchMatch =
      search === "" ||
      task.title.toLowerCase().includes(search) ||
      task.owner.toLowerCase().includes(search);

    const archivedMatch = showArchivedOnly ? task.archived : true;

    const kpiMatch =
      activeKpi === "Totali"
        ? true
        : activeKpi === "Da fare"
        ? task.status === "Da fare"
        : activeKpi === "In corso"
        ? task.status === "In corso"
        : activeKpi === "Completate"
        ? task.status === "Completato"
        : isLate(task);

    return (
      ownerMatch &&
      statusMatch &&
      priorityMatch &&
      searchMatch &&
      archivedMatch &&
      kpiMatch
    );
  });

  const addTask = () => {
    if (!newTask.trim()) return;

    const isoToday = new Date().toISOString().split("T")[0];

    setTasks((prev) => [
      ...prev,
      {
        id: Date.now(),
        title: newTask.trim(),
        status: "Da fare",
        priority: "Media",
        owner: newOwner || "Non assegnato",
        dueDate: newDueDate || undefined,
        openedAt: isoToday,
        archived: false,
      },
    ]);

    setNewTask("");
    setNewOwner("");
    setNewDueDate("");
  };

  const getNextStatus = (status: TaskStatus): TaskStatus => {
    if (status === "Da fare") return "In corso";
    if (status === "In corso") return "Completato";
    return "Da fare";
  };

  const getNextPriority = (priority: TaskPriority): TaskPriority => {
    if (priority === "Bassa") return "Media";
    if (priority === "Media") return "Alta";
    return "Bassa";
  };

  const getNextOwner = (owner: string) => {
    const currentIndex = team.indexOf(owner);
    if (currentIndex === -1) return team[0];
    return team[(currentIndex + 1) % team.length];
  };

  const updateTask = (id: number, patch: Partial<Task>) => {
    setTasks((prev) =>
      prev.map((task) => (task.id === id ? { ...task, ...patch } : task))
    );
  };

  const resetFilters = () => {
    setFilterOwner("Tutti");
    setFilterStatus("Tutti");
    setFilterPriority("Tutte");
    setSearchTerm("");
    setActiveKpi("Totali");
    setShowArchivedOnly(false);
  };

  const closeTask = (task: Task) => {
    const confirmClose = window.confirm(
      `Vuoi chiudere definitivamente la task "${task.title}"?`
    );

    if (!confirmClose) return;

    const isoToday = new Date().toISOString().split("T")[0];

    updateTask(task.id, {
      status: "Completato",
      archived: true,
      closedAt: isoToday,
    });
  };

  const reopenTask = (task: Task) => {
    updateTask(task.id, {
      status: "Da fare",
      archived: false,
      closedAt: undefined,
    });
  };

  const kpis: { label: KpiFilter; value: number; note: string; alert?: boolean }[] = [
    { label: "Totali", value: totalTasks, note: "Visione completa" },
    { label: "Da fare", value: todoTasks, note: "Da avviare" },
    { label: "In corso", value: inProgressTasks, note: "Attività attive" },
    { label: "Completate", value: completedTasks, note: "Chiuse e archiviate" },
    { label: "In ritardo", value: delayedTasks, note: "Priorità alta", alert: true },
  ];

  const selectClassName =
    "h-11 w-full rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 text-sm text-[#2B2D2F] outline-none transition focus:border-[#017A92] focus:bg-white";

  const compactInputClassName =
    "h-9 w-full rounded-[12px] border border-[#e7dfd8] bg-[#fcfbf9] px-3 text-[13px] text-[#2B2D2F] outline-none transition focus:border-[#017A92] focus:bg-white";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="MeToDo Control"
        title="Operations"
        description="Controllo operativo delle attività in corso con visione chiara su priorità, stato di avanzamento, owner, tempi e storico."
      >
        <div className="flex flex-wrap gap-3">
          <div className="rounded-[16px] border border-[#dbe8eb] bg-[#f3f8fa] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#017A92]">
              Task attive
            </p>
            <p className="mt-1 text-[22px] font-semibold leading-none text-[#2B2D2F]">
              {totalTasks}
            </p>
          </div>

          <div className="rounded-[16px] border border-[#eccfcf] bg-[#fbeeee] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#993333]">
              Ritardi
            </p>
            <p className="mt-1 text-[22px] font-semibold leading-none text-[#2B2D2F]">
              {delayedTasks}
            </p>
          </div>
        </div>
      </PageHeader>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        {kpis.map((item) => {
          const isActive = activeKpi === item.label;

          return (
            <button
              key={item.label}
              onClick={() => setActiveKpi(item.label)}
              className={`rounded-[20px] border p-5 text-left transition ${
                isActive
                  ? item.alert
                    ? "border-[#993333] bg-[#fbeeee] shadow-[0_12px_30px_rgba(153,51,51,0.08)]"
                    : "border-[#017A92] bg-[linear-gradient(180deg,#f5fbfc_0%,#eef7f9_100%)] shadow-[0_12px_30px_rgba(1,122,146,0.10)]"
                  : "border-[#e7dfd8] bg-white shadow-[0_8px_20px_rgba(43,45,47,0.04)] hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(43,45,47,0.07)]"
              }`}
            >
              <div
                className={`mb-4 h-1.5 w-12 rounded-full ${
                  item.alert ? "bg-[#993333]" : "bg-[#017A92]"
                }`}
              />
              <p
                className={`text-[11px] font-semibold uppercase tracking-[0.28em] ${
                  item.alert ? "text-[#993333]" : "text-[#017A92]"
                }`}
              >
                {item.label}
              </p>
              <p className="mt-4 text-[38px] font-semibold leading-none tracking-[-0.03em] text-[#2B2D2F]">
                {item.value}
              </p>
              <p className="mt-3 text-sm leading-6 text-[#666666]">{item.note}</p>
            </button>
          );
        })}
      </section>

      <AppCard className="rounded-[24px] p-7">
        <SectionHeader
          title="Nuova task"
          description="Inserisci una nuova attività e assegnala subito al referente operativo."
          className="mb-6"
        />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1.1fr_1fr_auto] xl:items-end">
          <div>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              Attività
            </label>
            <AppInput
              placeholder="Es. Verifica setup rooftop"
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              Owner
            </label>
            <select
              value={newOwner}
              onChange={(e) => setNewOwner(e.target.value)}
              className={selectClassName}
            >
              <option value="">Seleziona owner</option>
              {team.map((member) => (
                <option key={member} value={member}>
                  {member}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              Scadenza
            </label>
            <input
              type="date"
              value={newDueDate}
              onChange={(e) => setNewDueDate(e.target.value)}
              className={selectClassName}
            />
          </div>

          <div className="xl:pb-[1px]">
            <AppButton onClick={addTask}>Aggiungi</AppButton>
          </div>
        </div>
      </AppCard>

      <AppCard className="rounded-[24px] p-7">
        <SectionHeader
          title="Task list"
          description="Vista operativa compatta con ricerca, filtri e storico."
          className="mb-6"
          action={
            <div className="flex flex-wrap gap-2">
              <AppButton
                variant="secondary"
                onClick={() => setShowArchivedOnly((prev) => !prev)}
              >
                {showArchivedOnly ? "Mostra tutte" : "Solo archiviate"}
              </AppButton>

              <AppButton variant="ghost" onClick={resetFilters}>
                Reset filtri
              </AppButton>
            </div>
          }
        />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_220px_220px_220px]">
          <div>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              Ricerca task
            </label>
            <AppInput
              placeholder="Cerca per titolo o owner"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              Filtra per owner
            </label>
            <select
              value={filterOwner}
              onChange={(e) => setFilterOwner(e.target.value)}
              className={selectClassName}
            >
              <option value="Tutti">Tutti</option>
              {team.map((member) => (
                <option key={member} value={member}>
                  {member}
                </option>
              ))}
              <option value="Non assegnato">Non assegnato</option>
            </select>
          </div>

          <div>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              Filtra per stato
            </label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className={selectClassName}
            >
              <option value="Tutti">Tutti</option>
              <option value="Da fare">Da fare</option>
              <option value="In corso">In corso</option>
              <option value="Completato">Completato</option>
            </select>
          </div>

          <div>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              Filtra per priorità
            </label>
            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
              className={selectClassName}
            >
              <option value="Tutte">Tutte</option>
              <option value="Alta">Alta</option>
              <option value="Media">Media</option>
              <option value="Bassa">Bassa</option>
            </select>
          </div>
        </div>

        <div className="mt-6 grid gap-3">
          {filteredTasks.length === 0 ? (
            <div className="rounded-[18px] border border-[#ebe4dc] bg-[#fcfbf9] p-5 text-sm leading-6 text-[#666666]">
              Nessuna task trovata con questi filtri.
            </div>
          ) : (
            filteredTasks.map((task) => {
              const late = isLate(task);
              const nextStatus = getNextStatus(task.status);
              const openDays = task.closedAt
                ? daysBetween(task.openedAt, task.closedAt)
                : null;

              return (
                <article
                  key={task.id}
                  className={`rounded-[18px] border p-4 shadow-[0_6px_16px_rgba(43,45,47,0.03)] ${
                    task.priority === "Alta"
                      ? "border-[#e7b3b3] bg-[#fff8f8]"
                      : late
                      ? "border-[#d9a7a7] bg-[#fffafa]"
                      : "border-[#ebe4dc] bg-[#fcfbf9]"
                  }`}
                >
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.9fr_180px_150px]">
                    <div>
                      <div className="mb-3 flex flex-wrap items-center gap-1.5">
                        <h3 className="font-serif text-[18px] leading-5 text-[#2B2D2F]">
                          {task.title}
                        </h3>

                        <AppBadge
                          variant={
                            task.status === "Completato"
                              ? "success"
                              : task.status === "In corso"
                              ? "neutral"
                              : "info"
                          }
                          className="px-2.5 py-0.5 text-[11px]"
                        >
                          {task.status}
                        </AppBadge>

                        <AppBadge
                          variant={
                            task.priority === "Alta"
                              ? "danger"
                              : task.priority === "Media"
                              ? "warning"
                              : "neutral"
                          }
                          className="px-2.5 py-0.5 text-[11px]"
                        >
                          {task.priority}
                        </AppBadge>

                        {late && (
                          <AppBadge
                            variant="danger"
                            className="px-2.5 py-0.5 text-[11px]"
                          >
                            In ritardo
                          </AppBadge>
                        )}

                        {task.archived && (
                          <AppBadge
                            variant="neutral"
                            className="px-2.5 py-0.5 text-[11px]"
                          >
                            Archiviata
                          </AppBadge>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-3 xl:grid-cols-5">
                        <div>
                          <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7a726c]">
                            Owner
                          </span>
                          <div className="mt-0.5 text-[13px] font-semibold text-[#2B2D2F]">
                            {task.owner}
                          </div>
                        </div>

                        <div>
                          <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7a726c]">
                            Scadenza
                          </span>
                          <div className="mt-0.5 text-[13px] font-semibold text-[#2B2D2F]">
                            {formatDate(task.dueDate)}
                          </div>
                        </div>

                        <div>
                          <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7a726c]">
                            Aperta il
                          </span>
                          <div className="mt-0.5 text-[13px] font-semibold text-[#2B2D2F]">
                            {formatDate(task.openedAt)}
                          </div>
                        </div>

                        <div>
                          <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7a726c]">
                            Chiusa il
                          </span>
                          <div className="mt-0.5 text-[13px] font-semibold text-[#2B2D2F]">
                            {formatDate(task.closedAt)}
                          </div>
                        </div>

                        <div>
                          <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7a726c]">
                            Giorni aperta
                          </span>
                          <div className="mt-0.5 text-[13px] font-semibold text-[#2B2D2F]">
                            {openDays ?? "—"}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                        Scadenza
                      </label>
                      <input
                        type="date"
                        value={task.dueDate || ""}
                        onChange={(e) =>
                          updateTask(task.id, {
                            dueDate: e.target.value || undefined,
                          })
                        }
                        className={compactInputClassName}
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      {!task.archived && (
                        <>
                          <AppButton
                            variant="secondary"
                            onClick={() =>
                              updateTask(task.id, {
                                status: nextStatus,
                                closedAt:
                                  nextStatus === "Completato"
                                    ? new Date().toISOString().split("T")[0]
                                    : undefined,
                              })
                            }
                            className="h-9 justify-start px-3 py-2 text-[12px]"
                          >
                            Stato: {nextStatus}
                          </AppButton>

                          <AppButton
                            variant="secondary"
                            onClick={() =>
                              updateTask(task.id, {
                                priority: getNextPriority(task.priority),
                              })
                            }
                            className="h-9 justify-start px-3 py-2 text-[12px]"
                          >
                            Priorità
                          </AppButton>

                          <AppButton
                            variant="secondary"
                            onClick={() =>
                              updateTask(task.id, {
                                owner: getNextOwner(task.owner),
                              })
                            }
                            className="h-9 justify-start px-3 py-2 text-[12px]"
                          >
                            Owner
                          </AppButton>

                          <button
                            onClick={() => closeTask(task)}
                            className="inline-flex h-9 items-center justify-start rounded-[14px] border border-[#d8aaaa] bg-[#f8eaea] px-3 py-2 text-[12px] font-semibold text-[#993333] transition hover:opacity-90"
                          >
                            Chiudi
                          </button>
                        </>
                      )}

                      {task.archived && (
                        <AppButton
                          variant="secondary"
                          onClick={() => reopenTask(task)}
                          className="h-9 justify-start px-3 py-2 text-[12px]"
                        >
                          Riapri task
                        </AppButton>
                      )}
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </AppCard>
    </div>
  );
}
"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { Noto_Serif, Open_Sans } from "next/font/google";

const notoSerif = Noto_Serif({
  subsets: ["latin"],
  weight: ["400", "700"],
});

const openSans = Open_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

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

export default function Operations() {
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

  const statusStyles: Record<TaskStatus, { bg: string; color: string; border: string }> = {
    "Da fare": {
      bg: "#f6fbfc",
      color: "#017A92",
      border: "#017A92",
    },
    "In corso": {
      bg: "#f4f1ed",
      color: "#2B2D2F",
      border: "#2B2D2F",
    },
    Completato: {
      bg: "#eef7f3",
      color: "#1f6b57",
      border: "#b9ddd1",
    },
  };

  const priorityStyles: Record<TaskPriority, { bg: string; color: string; border: string }> = {
    Bassa: {
      bg: "#f7f7f7",
      color: "#555555",
      border: "#dddddd",
    },
    Media: {
      bg: "#f3ece7",
      color: "#2B2D2F",
      border: "#d8cfc7",
    },
    Alta: {
      bg: "#f8eaea",
      color: "#993333",
      border: "#d8aaaa",
    },
  };

  const kpis: { label: KpiFilter; value: number }[] = [
    { label: "Totali", value: totalTasks },
    { label: "Da fare", value: todoTasks },
    { label: "In corso", value: inProgressTasks },
    { label: "Completate", value: completedTasks },
    { label: "In ritardo", value: delayedTasks },
  ];

  return (
    <main
      className={openSans.className}
      style={{
        minHeight: "100vh",
        backgroundColor: "#f5f3ef",
        color: "#2B2D2F",
        padding: "32px 20px 48px",
      }}
    >
      <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
        <section
          style={{
            background: "#ffffff",
            border: "1px solid #e7dfd8",
            borderRadius: "24px",
            overflow: "hidden",
            marginBottom: "24px",
            boxShadow: "0 12px 30px rgba(43,45,47,0.05)",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "320px 1fr",
              minHeight: "220px",
            }}
          >
            <div
              style={{
                background: "#2B2D2F",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "32px",
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: "170px",
                  height: "170px",
                }}
              >
                <Image
                  src="/images/metodo-logo.png"
                  alt="MeToDo logo"
                  fill
                  style={{ objectFit: "contain" }}
                  priority
                />
              </div>
            </div>

            <div
              style={{
                padding: "32px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: "18px",
              }}
            >
              <div>
                <p
                  style={{
                    margin: 0,
                    fontSize: "12px",
                    fontWeight: 700,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: "#017A92",
                  }}
                >
                  MeToDo Control
                </p>

                <h1
                  className={notoSerif.className}
                  style={{
                    margin: "10px 0 10px",
                    fontSize: "42px",
                    lineHeight: 1.05,
                    fontWeight: 700,
                    color: "#2B2D2F",
                  }}
                >
                  Operations
                </h1>

                <p
                  style={{
                    margin: 0,
                    maxWidth: "760px",
                    fontSize: "15px",
                    lineHeight: 1.7,
                    color: "#555555",
                  }}
                >
                  Controllo operativo delle attività in corso con visione chiara su
                  priorità, stato di avanzamento, owner, tempi e storico.
                </p>
              </div>

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "12px",
                }}
              >
                <div style={topBadgeStyle}>
                  <span style={topBadgeLabelStyle}>Task attive</span>
                  <strong style={topBadgeValueStyle}>{totalTasks}</strong>
                </div>

                <div style={topBadgeStyle}>
                  <span style={topBadgeLabelStyle}>Ritardi</span>
                  <strong style={topBadgeValueStyle}>{delayedTasks}</strong>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "16px",
            marginBottom: "24px",
          }}
        >
          {kpis.map((item) => {
            const isActive = activeKpi === item.label;

            return (
              <button
                key={item.label}
                onClick={() => setActiveKpi(item.label)}
                style={{
                  ...kpiCardStyle,
                  cursor: "pointer",
                  border: isActive ? "2px solid #017A92" : "1px solid #e7dfd8",
                  background: isActive ? "#f6fbfc" : "#ffffff",
                  textAlign: "left",
                }}
              >
                <p style={kpiLabelStyle}>{item.label}</p>
                <p style={kpiValueStyle}>{item.value}</p>
              </button>
            );
          })}
        </section>

        <section style={sectionCardStyle}>
          <div style={{ marginBottom: "18px" }}>
            <h2
              className={notoSerif.className}
              style={{
                margin: 0,
                fontSize: "28px",
                color: "#2B2D2F",
              }}
            >
              Nuova task
            </h2>
            <p
              style={{
                margin: "8px 0 0",
                fontSize: "14px",
                color: "#666666",
                lineHeight: 1.6,
              }}
            >
              Inserisci una nuova attività e assegnala subito al referente operativo.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1.1fr 1fr auto",
              gap: "12px",
              alignItems: "end",
            }}
          >
            <div>
              <label style={labelStyle}>Attività</label>
              <input
                type="text"
                placeholder="Es. Verifica setup rooftop"
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Owner</label>
              <select
                value={newOwner}
                onChange={(e) => setNewOwner(e.target.value)}
                style={inputStyle}
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
              <label style={labelStyle}>Scadenza</label>
              <input
                type="date"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                style={inputStyle}
              />
            </div>

            <button onClick={addTask} style={primaryButtonStyle}>
              Aggiungi
            </button>
          </div>
        </section>

        <section style={{ ...sectionCardStyle, marginTop: "24px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
              gap: "16px",
              flexWrap: "wrap",
              marginBottom: "20px",
            }}
          >
            <div>
              <h2
                className={notoSerif.className}
                style={{
                  margin: 0,
                  fontSize: "28px",
                  color: "#2B2D2F",
                }}
              >
                Task list
              </h2>
              <p
                style={{
                  margin: "8px 0 0",
                  fontSize: "14px",
                  color: "#666666",
                  lineHeight: 1.6,
                }}
              >
                Vista operativa compatta con ricerca, filtri e storico.
              </p>
            </div>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button
                onClick={() => setShowArchivedOnly((prev) => !prev)}
                style={{
                  ...secondaryButtonStyle,
                  background: showArchivedOnly ? "#f6fbfc" : "#ffffff",
                  border: showArchivedOnly ? "1px solid #017A92" : "1px solid #d8d0c8",
                  color: showArchivedOnly ? "#017A92" : "#2B2D2F",
                }}
              >
                {showArchivedOnly ? "Mostra tutte" : "Solo archiviate"}
              </button>

              <button onClick={resetFilters} style={secondaryButtonStyle}>
                Reset filtri
              </button>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 220px 220px 220px",
              gap: "12px",
              marginBottom: "18px",
            }}
          >
            <div>
              <label style={labelStyle}>Ricerca task</label>
              <input
                type="text"
                placeholder="Cerca per titolo o owner"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Filtra per owner</label>
              <select
                value={filterOwner}
                onChange={(e) => setFilterOwner(e.target.value)}
                style={inputStyle}
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
              <label style={labelStyle}>Filtra per stato</label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                style={inputStyle}
              >
                <option value="Tutti">Tutti</option>
                <option value="Da fare">Da fare</option>
                <option value="In corso">In corso</option>
                <option value="Completato">Completato</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Filtra per priorità</label>
              <select
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
                style={inputStyle}
              >
                <option value="Tutte">Tutte</option>
                <option value="Alta">Alta</option>
                <option value="Media">Media</option>
                <option value="Bassa">Bassa</option>
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gap: "12px" }}>
            {filteredTasks.length === 0 ? (
              <div
                style={{
                  background: "#fcfbf9",
                  border: "1px solid #ebe4dc",
                  borderRadius: "18px",
                  padding: "20px",
                  color: "#666666",
                }}
              >
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
                    style={{
                      background: task.priority === "Alta" ? "#fff8f8" : "#fcfbf9",
                      border:
                        task.priority === "Alta"
                          ? "1px solid #e7b3b3"
                          : late
                          ? "1px solid #d9a7a7"
                          : "1px solid #ebe4dc",
                      borderLeft:
                        task.priority === "Alta"
                          ? "5px solid #d64545"
                          : task.status === "In corso"
                          ? "5px solid #2B2D2F"
                          : task.status === "Completato"
                          ? "5px solid #1f6b57"
                          : "5px solid #017A92",
                      borderRadius: "18px",
                      padding: "16px",
                      boxShadow: "0 6px 16px rgba(43,45,47,0.03)",
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1.6fr 1fr auto",
                        gap: "16px",
                        alignItems: "start",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            flexWrap: "wrap",
                            marginBottom: "8px",
                          }}
                        >
                          <h3
                            className={notoSerif.className}
                            style={{
                              margin: 0,
                              fontSize: "18px",
                              lineHeight: 1.2,
                              color: "#2B2D2F",
                            }}
                          >
                            {task.title}
                          </h3>

                          <span
                            style={{
                              ...pillStyleCompact,
                              background: statusStyles[task.status].bg,
                              color: statusStyles[task.status].color,
                              border: `1px solid ${statusStyles[task.status].border}`,
                            }}
                          >
                            {task.status}
                          </span>

                          <span
                            style={{
                              ...pillStyleCompact,
                              background: priorityStyles[task.priority].bg,
                              color: priorityStyles[task.priority].color,
                              border: `1px solid ${priorityStyles[task.priority].border}`,
                            }}
                          >
                            Priorità {task.priority}
                          </span>

                          {late && (
                            <span
                              style={{
                                ...pillStyleCompact,
                                background: "#f8eaea",
                                color: "#993333",
                                border: "1px solid #d9a7a7",
                              }}
                            >
                              In ritardo
                            </span>
                          )}

                          {task.archived && (
                            <span
                              style={{
                                ...pillStyleCompact,
                                background: "#f1f5f9",
                                color: "#475569",
                                border: "1px solid #cbd5e1",
                              }}
                            >
                              Archiviata
                            </span>
                          )}
                        </div>

                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                            gap: "10px",
                          }}
                        >
                          <div>
                            <span style={metaLabelStyle}>Owner</span>
                            <div style={metaValueCompactStyle}>{task.owner}</div>
                          </div>

                          <div>
                            <span style={metaLabelStyle}>Scadenza</span>
                            <div style={metaValueCompactStyle}>
                              {formatDate(task.dueDate)}
                            </div>
                          </div>

                          <div>
                            <span style={metaLabelStyle}>Aperta il</span>
                            <div style={metaValueCompactStyle}>
                              {formatDate(task.openedAt)}
                            </div>
                          </div>

                          <div>
                            <span style={metaLabelStyle}>Chiusa il</span>
                            <div style={metaValueCompactStyle}>
                              {formatDate(task.closedAt)}
                            </div>
                          </div>

                          <div>
                            <span style={metaLabelStyle}>Giorni aperta</span>
                            <div style={metaValueCompactStyle}>
                              {openDays ?? "—"}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div>
                        <label style={labelStyle}>Modifica scadenza</label>
                        <input
                          type="date"
                          value={task.dueDate || ""}
                          onChange={(e) =>
                            updateTask(task.id, {
                              dueDate: e.target.value || undefined,
                            })
                          }
                          style={inputStyleCompact}
                        />
                      </div>

                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "8px",
                          minWidth: "150px",
                        }}
                      >
                        {!task.archived && (
                          <>
                            <button
                              onClick={() =>
                                updateTask(task.id, {
                                  status: nextStatus,
                                  closedAt:
                                    nextStatus === "Completato"
                                      ? new Date().toISOString().split("T")[0]
                                      : undefined,
                                })
                              }
                              style={secondaryButtonCompactStyle}
                            >
                              Stato: {nextStatus}
                            </button>

                            <button
                              onClick={() =>
                                updateTask(task.id, {
                                  priority: getNextPriority(task.priority),
                                })
                              }
                              style={secondaryButtonCompactStyle}
                            >
                              Cambia priorità
                            </button>

                            <button
                              onClick={() =>
                                updateTask(task.id, {
                                  owner: getNextOwner(task.owner),
                                })
                              }
                              style={secondaryButtonCompactStyle}
                            >
                              Cambia owner
                            </button>

                            <button
                              onClick={() => closeTask(task)}
                              style={dangerButtonCompactStyle}
                            >
                              Chiudi task
                            </button>
                          </>
                        )}

                        {task.archived && (
                          <button
                            onClick={() => reopenTask(task)}
                            style={secondaryButtonCompactStyle}
                          >
                            Riapri task
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

const sectionCardStyle: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #e7dfd8",
  borderRadius: "24px",
  padding: "24px",
  boxShadow: "0 12px 30px rgba(43,45,47,0.05)",
};

const kpiCardStyle: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #e7dfd8",
  borderRadius: "20px",
  padding: "18px 20px",
  boxShadow: "0 10px 24px rgba(43,45,47,0.04)",
};

const kpiLabelStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "#017A92",
};

const kpiValueStyle: React.CSSProperties = {
  margin: "10px 0 0",
  fontSize: "34px",
  lineHeight: 1,
  fontWeight: 700,
  color: "#2B2D2F",
};

const topBadgeStyle: React.CSSProperties = {
  background: "#f7fbfc",
  border: "1px solid #d8e8ec",
  borderRadius: "16px",
  padding: "12px 16px",
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  minWidth: "130px",
};

const topBadgeLabelStyle: React.CSSProperties = {
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  color: "#017A92",
  fontWeight: 700,
};

const topBadgeValueStyle: React.CSSProperties = {
  fontSize: "22px",
  color: "#2B2D2F",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: "8px",
  fontSize: "12px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "#6b625c",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "12px 14px",
  borderRadius: "14px",
  border: "1px solid #d8d0c8",
  background: "#fcfbf9",
  color: "#2B2D2F",
  fontSize: "14px",
  outline: "none",
};

const inputStyleCompact: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  borderRadius: "12px",
  border: "1px solid #d8d0c8",
  background: "#fcfbf9",
  color: "#2B2D2F",
  fontSize: "13px",
  outline: "none",
};

const primaryButtonStyle: React.CSSProperties = {
  height: "46px",
  padding: "0 18px",
  borderRadius: "14px",
  border: "none",
  background: "#017A92",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: "14px",
  border: "1px solid #d8d0c8",
  background: "#ffffff",
  color: "#2B2D2F",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryButtonCompactStyle: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: "12px",
  border: "1px solid #d8d0c8",
  background: "#ffffff",
  color: "#2B2D2F",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
  textAlign: "left",
};

const dangerButtonCompactStyle: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: "12px",
  border: "1px solid #d8aaaa",
  background: "#f8eaea",
  color: "#993333",
  fontSize: "12px",
  fontWeight: 700,
  cursor: "pointer",
  textAlign: "left",
};

const pillStyleCompact: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "5px 9px",
  borderRadius: "999px",
  fontSize: "11px",
  fontWeight: 700,
};

const metaLabelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: "3px",
  fontSize: "10px",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  color: "#7a726c",
  fontWeight: 700,
};

const metaValueCompactStyle: React.CSSProperties = {
  fontSize: "14px",
  color: "#2B2D2F",
  fontWeight: 600,
};
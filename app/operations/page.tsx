"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type TaskStatus = "Da fare" | "In corso" | "Completato";
type TaskPriority = "Bassa" | "Media" | "Alta";
type TeamMember =
  | "Pierangelo"
  | "Alessandro"
  | "Gianluca"
  | "Giorgia"
  | "Alessandra"
  | "Non assegnato";

type Task = {
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  owner: TeamMember;
  dueDate: string;
};

export default function OperationsPage() {
  const team: TeamMember[] = [
    "Pierangelo",
    "Alessandro",
    "Gianluca",
    "Giorgia",
    "Alessandra",
    "Non assegnato",
  ];

  const statuses: Array<"Tutti" | TaskStatus> = [
    "Tutti",
    "Da fare",
    "In corso",
    "Completato",
  ];

  const [tasks, setTasks] = useState<Task[]>([
    {
      title: "Check camere VIP",
      status: "In corso",
      priority: "Alta",
      owner: "Giorgia",
      dueDate: "2026-04-11",
    },
    {
      title: "Aggiornamento listino bar",
      status: "Da fare",
      priority: "Media",
      owner: "Gianluca",
      dueDate: "2026-04-12",
    },
    {
      title: "Controllo colazioni",
      status: "Completato",
      priority: "Bassa",
      owner: "Pierangelo",
      dueDate: "2026-04-10",
    },
  ]);

  const [newTask, setNewTask] = useState("");
  const [newOwner, setNewOwner] = useState<TeamMember | "">("");
  const [newDueDate, setNewDueDate] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<"Tutti" | TeamMember>("Tutti");
  const [statusFilter, setStatusFilter] = useState<"Tutti" | TaskStatus>("Tutti");

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const ownerMatch = ownerFilter === "Tutti" || task.owner === ownerFilter;
      const statusMatch = statusFilter === "Tutti" || task.status === statusFilter;
      return ownerMatch && statusMatch;
    });
  }, [tasks, ownerFilter, statusFilter]);

  const totalTasks = tasks.length;
  const todoTasks = tasks.filter((t) => t.status === "Da fare").length;
  const delayedTasks = tasks.filter(
    (t) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "Completato"
  ).length;

  function addTask() {
    if (!newTask.trim()) return;

    setTasks((prev) => [
      ...prev,
      {
        title: newTask,
        status: "Da fare",
        priority: "Media",
        owner: newOwner || "Non assegnato",
        dueDate: newDueDate || "",
      },
    ]);

    setNewTask("");
    setNewOwner("");
    setNewDueDate("");
  }

  function getNextStatus(current: TaskStatus): TaskStatus {
    if (current === "Da fare") return "In corso";
    if (current === "In corso") return "Completato";
    return "Da fare";
  }

  function getNextPriority(current: TaskPriority): TaskPriority {
    if (current === "Bassa") return "Media";
    if (current === "Media") return "Alta";
    return "Bassa";
  }

  function getNextOwner(current: TeamMember): TeamMember {
    const currentIndex = team.indexOf(current);
    const nextIndex = (currentIndex + 1) % team.length;
    return team[nextIndex];
  }

  function updateTask(taskIndex: number, updatedTask: Task) {
    setTasks((prev) => prev.map((task, index) => (index === taskIndex ? updatedTask : task)));
  }

  function getCardStyle(task: Task): React.CSSProperties {
    const isLate =
      !!task.dueDate && new Date(task.dueDate) < new Date() && task.status !== "Completato";

    const base = {
      padding: 20,
      borderRadius: 22,
      border: "1px solid rgba(255,255,255,0.08)",
      background: "#121212",
      marginBottom: 16,
    } satisfies React.CSSProperties;

    if (task.status === "Completato") {
      return {
        ...base,
        borderLeft: "6px solid #6fcf97",
        background: "rgba(111, 207, 151, 0.10)",
      };
    }

    if (task.status === "In corso") {
      return {
        ...base,
        borderLeft: "6px solid #f2c94c",
        background: "rgba(242, 201, 76, 0.10)",
      };
    }

    return {
      ...base,
      borderLeft: "6px solid #eb5757",
      background: "rgba(235, 87, 87, 0.10)",
      boxShadow: isLate ? "0 0 0 1px rgba(235, 87, 87, 0.28)" : "none",
    };
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0b0b0b",
        color: "#f5f5f5",
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <section
        style={{
          maxWidth: 1240,
          margin: "0 auto",
          padding: "40px 24px 80px",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
            marginBottom: 34,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 14,
                letterSpacing: "0.24em",
                textTransform: "uppercase",
                color: "#bdbdbd",
                marginBottom: 8,
              }}
            >
              MeToDo Control
            </div>
            <h1
              style={{
                margin: 0,
                fontSize: "clamp(30px, 5vw, 48px)",
                letterSpacing: "-0.05em",
              }}
            >
              Operations
            </h1>
          </div>

          <Link href="/" style={backLinkStyle}>
            Torna alla home
          </Link>
        </header>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 18,
            marginBottom: 26,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 16,
            }}
          >
            <StatCard label="Task totali" value={String(totalTasks)} />
            <StatCard label="Da fare" value={String(todoTasks)} />
            <StatCard
              label="In ritardo"
              value={String(delayedTasks)}
              alert={delayedTasks > 0}
            />
          </div>
        </div>

        <section
          style={{
            background: "#121212",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 24,
            padding: 24,
            marginBottom: 24,
          }}
        >
          <div style={eyebrowStyle}>Nuova attività</div>
          <h2 style={sectionTitleStyle}>Inserimento task</h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            <input
              type="text"
              placeholder="Nuova attività..."
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              style={inputStyle}
            />

            <select
              value={newOwner}
              onChange={(e) => setNewOwner(e.target.value as TeamMember | "")}
              style={inputStyle}
            >
              <option value="">Seleziona responsabile</option>
              {team
                .filter((member) => member !== "Non assegnato")
                .map((member) => (
                  <option key={member} value={member}>
                    {member}
                  </option>
                ))}
            </select>

            <input
              type="date"
              value={newDueDate}
              onChange={(e) => setNewDueDate(e.target.value)}
              style={inputStyle}
            />

            <button onClick={addTask} style={primaryButtonStyle}>
              Aggiungi task
            </button>
          </div>
        </section>

        <section
          style={{
            background: "#121212",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 24,
            padding: 24,
            marginBottom: 24,
          }}
        >
          <div style={eyebrowStyle}>Vista operativa</div>
          <h2 style={sectionTitleStyle}>Filtri</h2>

          <div style={{ marginBottom: 14, color: "#c9c9c9" }}>Per owner</div>
          <div style={chipRowStyle}>
            <Chip
              active={ownerFilter === "Tutti"}
              onClick={() => setOwnerFilter("Tutti")}
              label="Tutti"
            />
            {team
              .filter((member) => member !== "Non assegnato")
              .map((member) => (
                <Chip
                  key={member}
                  active={ownerFilter === member}
                  onClick={() => setOwnerFilter(member)}
                  label={member}
                />
              ))}
          </div>

          <div style={{ margin: "18px 0 14px", color: "#c9c9c9" }}>Per stato</div>
          <div style={chipRowStyle}>
            {statuses.map((status) => (
              <Chip
                key={status}
                active={statusFilter === status}
                onClick={() => setStatusFilter(status)}
                label={status}
              />
            ))}
          </div>
        </section>

        <section>
          <div style={eyebrowStyle}>Controllo</div>
          <h2 style={sectionTitleStyle}>Task list</h2>

          <div style={{ marginTop: 18 }}>
            {filteredTasks.length === 0 ? (
              <div
                style={{
                  background: "#121212",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 24,
                  padding: 24,
                  color: "#bdbdbd",
                }}
              >
                Nessun task trovato con i filtri selezionati.
              </div>
            ) : (
              filteredTasks.map((task) => {
                const originalIndex = tasks.findIndex(
                  (t) =>
                    t.title === task.title &&
                    t.owner === task.owner &&
                    t.priority === task.priority &&
                    t.status === task.status &&
                    t.dueDate === task.dueDate
                );

                const isLate =
                  !!task.dueDate &&
                  new Date(task.dueDate) < new Date() &&
                  task.status !== "Completato";

                return (
                  <div key={`${task.title}-${originalIndex}`} style={getCardStyle(task)}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 16,
                        alignItems: "flex-start",
                        flexWrap: "wrap",
                      }}
                    >
                      <div>
                        <strong
                          style={{
                            display: "block",
                            fontSize: 20,
                            marginBottom: 10,
                            letterSpacing: "-0.03em",
                          }}
                        >
                          {task.title}
                        </strong>

                        {isLate && (
                          <div
                            style={{
                              display: "inline-flex",
                              padding: "6px 10px",
                              borderRadius: 999,
                              background: "rgba(235, 87, 87, 0.14)",
                              color: "#ff8b8b",
                              fontSize: 12,
                              fontWeight: 700,
                              letterSpacing: "0.08em",
                              textTransform: "uppercase",
                              marginBottom: 10,
                            }}
                          >
                            In ritardo
                          </div>
                        )}
                      </div>

                      <div
                        style={{
                          color: "#c8c8c8",
                          fontSize: 14,
                        }}
                      >
                        Scadenza
                        <div style={{ marginTop: 6 }}>
                          <input
                            type="date"
                            value={task.dueDate || ""}
                            onChange={(e) =>
                              updateTask(originalIndex, {
                                ...task,
                                dueDate: e.target.value,
                              })
                            }
                            style={smallInputStyle}
                          />
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                        gap: 12,
                        marginTop: 16,
                        marginBottom: 16,
                      }}
                    >
                      <InfoBox label="Stato" value={task.status} />
                      <InfoBox label="Priorità" value={task.priority} />
                      <InfoBox label="Owner" value={task.owner} />
                    </div>

                    <div
                      style={{
                        display: "flex",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        onClick={() =>
                          updateTask(originalIndex, {
                            ...task,
                            status: getNextStatus(task.status),
                          })
                        }
                        style={actionButtonStyle}
                      >
                        Cambia stato
                      </button>

                      <button
                        onClick={() =>
                          updateTask(originalIndex, {
                            ...task,
                            priority: getNextPriority(task.priority),
                          })
                        }
                        style={actionButtonStyle}
                      >
                        Cambia priorità
                      </button>

                      <button
                        onClick={() =>
                          updateTask(originalIndex, {
                            ...task,
                            owner: getNextOwner(task.owner),
                          })
                        }
                        style={actionButtonStyle}
                      >
                        Cambia owner
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function StatCard({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div
      style={{
        background: alert ? "rgba(235, 87, 87, 0.10)" : "#121212",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 20,
        padding: 20,
      }}
    >
      <div style={{ color: "#a7a7a7", fontSize: 13, marginBottom: 10 }}>{label}</div>
      <div
        style={{
          fontSize: 30,
          fontWeight: 700,
          letterSpacing: "-0.04em",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "10px 14px",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.12)",
        background: active ? "#ffffff" : "transparent",
        color: active ? "#0b0b0b" : "#ffffff",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        borderRadius: 16,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.06)",
        padding: 14,
      }}
    >
      <div style={{ color: "#9a9a9a", fontSize: 12, marginBottom: 6 }}>{label}</div>
      <div style={{ fontWeight: 600 }}>{value}</div>
    </div>
  );
}

const eyebrowStyle: React.CSSProperties = {
  fontSize: 12,
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  color: "#8f8f8f",
};

const sectionTitleStyle: React.CSSProperties = {
  margin: "10px 0 18px",
  fontSize: 26,
  letterSpacing: "-0.03em",
};

const inputStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "#0f0f0f",
  color: "#ffffff",
};

const smallInputStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "#0f0f0f",
  color: "#ffffff",
};

const primaryButtonStyle: React.CSSProperties = {
  padding: "12px 16px",
  borderRadius: 14,
  border: "none",
  background: "#ffffff",
  color: "#0b0b0b",
  fontWeight: 600,
  cursor: "pointer",
};

const actionButtonStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "#0f0f0f",
  color: "#ffffff",
  cursor: "pointer",
};

const backLinkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "12px 16px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
  color: "#ffffff",
  textDecoration: "none",
};

const chipRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
};
"use client";

import { useState } from "react";

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

export default function Operations() {
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

  const filteredTasks = tasks.filter((task) => {
    const ownerMatch = ownerFilter === "Tutti" || task.owner === ownerFilter;
    const statusMatch = statusFilter === "Tutti" || task.status === statusFilter;
    return ownerMatch && statusMatch;
  });

  function getNextStatus(currentStatus: TaskStatus): TaskStatus {
    if (currentStatus === "Da fare") return "In corso";
    if (currentStatus === "In corso") return "Completato";
    return "Da fare";
  }

  function getNextPriority(currentPriority: TaskPriority): TaskPriority {
    if (currentPriority === "Bassa") return "Media";
    if (currentPriority === "Media") return "Alta";
    return "Bassa";
  }

  function getNextOwner(currentOwner: TeamMember): TeamMember {
    const currentIndex = team.indexOf(currentOwner);
    const nextIndex = (currentIndex + 1) % team.length;
    return team[nextIndex];
  }

  function getStatusStyles(status: TaskStatus) {
    if (status === "Completato") {
      return {
        borderColor: "green",
        backgroundColor: "#e8f5e9",
      };
    }

    if (status === "In corso") {
      return {
        borderColor: "orange",
        backgroundColor: "#fff3e0",
      };
    }

    return {
      borderColor: "red",
      backgroundColor: "#fdecea",
    };
  }

  function addTask() {
    if (!newTask.trim()) return;

    const taskToAdd: Task = {
      title: newTask,
      status: "Da fare",
      priority: "Media",
      owner: newOwner || "Non assegnato",
      dueDate: newDueDate || "",
    };

    setTasks([...tasks, taskToAdd]);
    setNewTask("");
    setNewOwner("");
    setNewDueDate("");
  }
const totalTasks = tasks.length;

const todoTasks = tasks.filter((t) => t.status === "Da fare").length;

const delayedTasks = tasks.filter(
  (t) =>
    t.dueDate &&
    new Date(t.dueDate) < new Date() &&
    t.status !== "Completato"
).length;
  return (
    <main style={{ padding: "40px", fontFamily: "Arial" }}>
      <h1>Operations</h1>
      <div style={{ display: "flex", gap: "20px", marginTop: "20px" }}>
  <div style={{ padding: "10px", border: "1px solid #ccc" }}>
    <strong>Totali:</strong> {totalTasks}
  </div>

  <div style={{ padding: "10px", border: "1px solid #ccc" }}>
    <strong>Da fare:</strong> {todoTasks}
  </div>

  <div
    style={{
      padding: "10px",
      border: "1px solid #ccc",
      backgroundColor: delayedTasks > 0 ? "#fdecea" : "transparent",
    }}
  >
    <strong>In ritardo:</strong> {delayedTasks}
  </div>
</div>
      <p>Gestione task e attività operative</p>

      <hr style={{ margin: "30px 0" }} />

      <h2>Nuovo Task</h2>

      <div
        style={{
          marginBottom: "20px",
          display: "flex",
          gap: "10px",
          flexWrap: "wrap",
        }}
      >
        <input
          type="text"
          placeholder="Nuova attività..."
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          style={{ padding: "10px" }}
        />

        <select
          value={newOwner}
          onChange={(e) => setNewOwner(e.target.value as TeamMember | "")}
          style={{ padding: "10px" }}
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
          style={{ padding: "10px" }}
        />

        <button onClick={addTask} style={{ padding: "10px 16px" }}>
          Aggiungi
        </button>
      </div>

      <h2>Filtri</h2>

      <div style={{ marginBottom: "15px" }}>
        <strong>Per owner:</strong>
      </div>

      <div
        style={{
          marginBottom: "20px",
          display: "flex",
          gap: "10px",
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={() => setOwnerFilter("Tutti")}
          style={{
            padding: "8px 12px",
            borderRadius: "6px",
            border: "1px solid #ccc",
            backgroundColor: ownerFilter === "Tutti" ? "#333" : "#fff",
            color: ownerFilter === "Tutti" ? "#fff" : "#000",
            cursor: "pointer",
          }}
        >
          Tutti
        </button>

        {team
          .filter((member) => member !== "Non assegnato")
          .map((member) => (
            <button
              key={member}
              onClick={() => setOwnerFilter(member)}
              style={{
                padding: "8px 12px",
                borderRadius: "6px",
                border: "1px solid #ccc",
                backgroundColor: ownerFilter === member ? "#333" : "#fff",
                color: ownerFilter === member ? "#fff" : "#000",
                cursor: "pointer",
              }}
            >
              {member}
            </button>
          ))}
      </div>

      <div style={{ marginBottom: "15px" }}>
        <strong>Per stato:</strong>
      </div>

      <div
        style={{
          marginBottom: "30px",
          display: "flex",
          gap: "10px",
          flexWrap: "wrap",
        }}
      >
        {statuses.map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            style={{
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid #ccc",
              backgroundColor: statusFilter === status ? "#333" : "#fff",
              color: statusFilter === status ? "#fff" : "#000",
              cursor: "pointer",
            }}
          >
            {status}
          </button>
        ))}
      </div>

      <h2>Task List</h2>

      <div style={{ marginTop: "20px" }}>
        {filteredTasks.map((task, index) => {
          const statusStyles = getStatusStyles(task.status);

          return (
            <div
              key={`${task.title}-${index}`}
              style={{
  padding: "15px",
  borderRadius: "8px",
  marginBottom: "12px",
  borderLeft: "6px solid",
  borderColor: statusStyles.borderColor,
  backgroundColor: statusStyles.backgroundColor,
  boxShadow:
    task.dueDate &&
    new Date(task.dueDate) < new Date() &&
    task.status !== "Completato"
      ? "0 0 10px red"
      : "none",
}}
            >
              <strong>{task.title}</strong>
              {task.dueDate &&
  new Date(task.dueDate) < new Date() &&
  task.status !== "Completato" && (
    <p style={{ color: "red", fontWeight: "bold" }}>
      IN RITARDO
    </p>
)}
              <p>Stato: {task.status}</p>
              <p>Priorità: {task.priority}</p>
              <p>Owner: {task.owner}</p>

              <div style={{ marginTop: "5px" }}>
                <label>Scadenza: </label>
                <input
                  type="date"
                  value={task.dueDate || ""}
                  onChange={(e) => {
                    const originalIndex = tasks.findIndex(
                      (t) =>
                        t.title === task.title &&
                        t.owner === task.owner &&
                        t.dueDate === task.dueDate
                    );

                    if (originalIndex === -1) return;

                    const updatedTasks = [...tasks];
                    updatedTasks[originalIndex].dueDate = e.target.value;
                    setTasks(updatedTasks);
                  }}
                  style={{ padding: "5px" }}
                />
              </div>

              <div
                style={{
                  marginTop: "10px",
                  display: "flex",
                  gap: "10px",
                  flexWrap: "wrap",
                }}
              >
                <button
                  onClick={() => {
                    const originalIndex = tasks.findIndex(
                      (t) =>
                        t.title === task.title &&
                        t.owner === task.owner &&
                        t.dueDate === task.dueDate
                    );

                    if (originalIndex === -1) return;

                    const updatedTasks = [...tasks];
                    updatedTasks[originalIndex].status = getNextStatus(task.status);
                    setTasks(updatedTasks);
                  }}
                  style={{ padding: "8px 12px", cursor: "pointer" }}
                >
                  Cambia stato
                </button>

                <button
                  onClick={() => {
                    const originalIndex = tasks.findIndex(
                      (t) =>
                        t.title === task.title &&
                        t.owner === task.owner &&
                        t.dueDate === task.dueDate
                    );

                    if (originalIndex === -1) return;

                    const updatedTasks = [...tasks];
                    updatedTasks[originalIndex].priority = getNextPriority(task.priority);
                    setTasks(updatedTasks);
                  }}
                  style={{ padding: "8px 12px", cursor: "pointer" }}
                >
                  Cambia priorità
                </button>

                <button
                  onClick={() => {
                    const originalIndex = tasks.findIndex(
                      (t) =>
                        t.title === task.title &&
                        t.owner === task.owner &&
                        t.dueDate === task.dueDate
                    );

                    if (originalIndex === -1) return;

                    const updatedTasks = [...tasks];
                    updatedTasks[originalIndex].owner = getNextOwner(task.owner);
                    setTasks(updatedTasks);
                  }}
                  style={{ padding: "8px 12px", cursor: "pointer" }}
                >
                  Cambia owner
                </button>
              </div>
            </div>
          );
        })}

        {filteredTasks.length === 0 && (
          <p>Nessun task trovato con i filtri selezionati.</p>
        )}
      </div>
    </main>
  );
}
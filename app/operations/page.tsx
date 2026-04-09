"use client";

import { useState } from "react";

export default function Operations() {
  const [tasks, setTasks] = useState([
    {
      title: "Check camere VIP",
      status: "In corso",
      priority: "Alta",
    },
    {
      title: "Aggiornamento listino bar",
      status: "Da fare",
      priority: "Media",
    },
    {
      title: "Controllo colazioni",
      status: "Completato",
      priority: "Bassa",
    },
  ]);

  return (
    <main style={{ padding: "40px", fontFamily: "Arial" }}>
      <h1>Operations</h1>
      <p>Gestione task e attività operative</p>

      <hr style={{ margin: "30px 0" }} />

      <h2>Task List</h2>

      <div style={{ marginTop: "20px" }}>
        {tasks.map((task, index) => {
          const nextStatus =
            task.status === "Da fare"
              ? "In corso"
              : task.status === "In corso"
              ? "Completato"
              : "Da fare";

          return (
            <div
              key={index}
              onClick={() => {
                const updatedTasks = [...tasks];
                updatedTasks[index].status = nextStatus;
                setTasks(updatedTasks);
              }}
              style={{
                padding: "15px",
                border: "1px solid #ccc",
                borderRadius: "8px",
                marginBottom: "10px",
                cursor: "pointer",
              }}
            >
              <strong>{task.title}</strong>
              <p>Stato: {task.status}</p>
              <p>Priorità: {task.priority}</p>
            </div>
          );
        })}
      </div>
    </main>
  );
}
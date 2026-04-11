export type TaskStatus = "open" | "completed";
export type TaskPriority = "low" | "medium" | "high";

export type TaskArea =
  | "Operations"
  | "Time Tracking"
  | "Performance"
  | "CRM + Finance";

export type Task = {
  id: number;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string;
  area: TaskArea;
};

export const tasks: Task[] = [
  {
    id: 1,
    title: "Verifica setup operativo Patria Palace",
    status: "open",
    priority: "high",
    dueDate: "2026-04-10",
    area: "Operations",
  },
  {
    id: 2,
    title: "Follow up cliente su attività aperte",
    status: "open",
    priority: "medium",
    dueDate: "2026-04-09",
    area: "CRM + Finance",
  },
  {
    id: 3,
    title: "Registrazione call operativa interna",
    status: "completed",
    priority: "low",
    dueDate: "2026-04-10",
    area: "Time Tracking",
  },
  {
    id: 4,
    title: "Aggiornamento controllo planning settimanale",
    status: "open",
    priority: "high",
    dueDate: "2026-04-11",
    area: "Operations",
  },
  {
    id: 5,
    title: "Analisi KPI struttura cliente",
    status: "open",
    priority: "high",
    dueDate: "2026-04-10",
    area: "Performance",
  },
  {
    id: 6,
    title: "Inserimento nuove attività formazione",
    status: "completed",
    priority: "medium",
    dueDate: "2026-04-08",
    area: "CRM + Finance",
  },
  {
    id: 7,
    title: "Controllo tempo attività non tracciate",
    status: "open",
    priority: "medium",
    dueDate: "2026-04-10",
    area: "Time Tracking",
  },
];
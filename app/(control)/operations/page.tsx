"use client";

import { Suspense, useEffect, useMemo, useState, type CSSProperties } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { Noto_Serif, Open_Sans } from "next/font/google";
import { supabase } from "@/lib/supabaseClient";

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
  id: string;
  title: string;
  macroarea: string;
  riferimento: string;
  attivita: string;
  status: TaskStatus;
  priority: TaskPriority;
  owner: string;
  ownerId?: string;
  clientId?: string;
  clientName?: string;
  dueDate?: string;
  openedAt: string;
  closedAt?: string;
  archived: boolean;
  notes: string;
};

type Profile = {
  id: string;
  nome: string | null;
  cognome: string | null;
  email: string | null;
  avatar_url: string | null;
};

type UserOption = {
  id: string;
  display_name: string;
  avatar_url: string | null;
};

type Client = {
  id: string;
  name: string;
};

type DbTask = {
  id: string;
  titolo: string;
  descrizione: string | null;
  macroarea: string | null;
  riferimento: string | null;
  attivita: string | null;
  stato: "todo" | "in_progress" | "completed";
  priorita: "low" | "medium" | "high";
  owner_id: string | null;
  client_id: string | null;
  created_by: string;
  opened_at: string;
  due_date: string | null;
  closed_at: string | null;
  closed_by: string | null;
  note: string | null;
  archived: boolean;
};

type TaskHistoryRow = {
  id: string;
  task_id: string;
  campo_modificato: string;
  valore_precedente: string | null;
  valore_nuovo: string | null;
  changed_at: string;
  changed_by: string | null;
};

type SubtaskType = {
  id: string;
  code: string;
  name: string;
  process_area: string | null;
  description: string | null;
  active: boolean;
};

type SubtaskDetailedRow = {
  subtask_id: string;
  task_id: string;
  task_title?: string | null;
  task_status?: string | null;
  type_id: string;
  subtask_code: string;
  subtask_name: string;
  process_area: string | null;
  subtask_type_description?: string | null;
  subtask_label: string | null;
  order_index: number;
  completed: boolean;
  owner_id: string | null;
  owner_display_name: string | null;
  nome?: string | null;
  cognome?: string | null;
  avatar_url: string | null;
  created_at?: string;
  updated_at?: string;
};

type TrackingModalData = {
  task: Task;
  subtask?: SubtaskDetailedRow;
};

const notoOwnerFallback = "Non assegnato";

const macroareaOptions = [
  "Consulenza",
  "Projects",
  "Commerciale",
  "Sales & Marketing",
  "Amministrazione & Finance",
  "IT",
];

const riferimentiByMacroarea: Record<string, string[]> = {
  Consulenza: [
    "Dimora De Belli",
    "Montecallini",
    "Palazzo Arco Cadura",
    "Palazzo Rollo",
    "San Giorgio Resort",
    "test test",
    "Villa Neviera",
  ],
  Projects: ["Puglia Destination Off", "Formazione"],
  Commerciale: [
    "Sviluppo commerciale",
    "Nuovi contatti",
    "Partnership",
    "Tour operator",
    "Agenzie viaggio",
  ],
  "Sales & Marketing": ["Social media", "Contenuti", "PR & Networking"],
  "Amministrazione & Finance": [
    "Amministrazione generale",
    "Controllo costi",
    "Reportistica",
    "Fatturazione",
    "Budget",
  ],
  IT: ["Sviluppo piattaforma", "Bug fixing", "Testing interno", "Integrazione Supabase", "Dashboard"],
};

const attivitaOptions = [
  "Call",
  "Email",
  "WhatsApp",
  "Meeting",
  "Follow up",
  "Analisi",
  "Reportistica",
  "Coordinamento",
  "On-boarding",
  "Organizzazione",
  "Sviluppo",
  "Testing",
  "Social media",
  "Contenuti",
  "PR & Networking",
  "Amministrazione",
];

function formatDate(date?: string) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("it-IT");
}

function formatDateTime(date?: string) {
  if (!date) return "—";
  return new Date(date).toLocaleString("it-IT");
}

function mapDbStatusToUi(status: DbTask["stato"]): TaskStatus {
  if (status === "todo") return "Da fare";
  if (status === "in_progress") return "In corso";
  return "Completato";
}

function mapUiStatusToDb(status: TaskStatus): DbTask["stato"] {
  if (status === "Da fare") return "todo";
  if (status === "In corso") return "in_progress";
  return "completed";
}

function mapDbPriorityToUi(priority: DbTask["priorita"]): TaskPriority {
  if (priority === "low") return "Bassa";
  if (priority === "medium") return "Media";
  return "Alta";
}

function mapUiPriorityToDb(priority: TaskPriority): DbTask["priorita"] {
  if (priority === "Bassa") return "low";
  if (priority === "Media") return "medium";
  return "high";
}

function getProfileDisplayName(profile?: Profile) {
  if (!profile) return notoOwnerFallback;

  const nome = profile.nome?.trim() || "";
  const cognome = profile.cognome?.trim() || "";

  if (!nome) return notoOwnerFallback;
  if (!cognome) return nome;

  return `${nome} ${cognome.charAt(0).toUpperCase()}.`;
}

function getShortTaskId(id: string) {
  return `#${id.slice(0, 8)}`;
}

async function sendAssignmentNotification(params: {
  eventType: "task_assigned" | "subtask_assigned";
  taskId: string;
  subtaskId?: string;
  assignedToUserId: string;
  assignedByUserId?: string;
  title: string;
  message: string;
  deepLink: string;
}) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) return;

  const response = await fetch("/api/notifications/send-assignment", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      event_type: params.eventType,
      task_id: params.taskId,
      subtask_id: params.subtaskId || null,
      assigned_to_user_id: params.assignedToUserId,
      assigned_by_user_id: params.assignedByUserId || null,
      title: params.title,
      message: params.message,
      deep_link: params.deepLink,
    }),
  });

  const responseBody = await response.text();

  if (!response.ok) {
    console.error("Errore invio notifica assignment:", {
      status: response.status,
      body: responseBody,
    });
    throw new Error(`Errore invio notifica assignment: ${response.status}`);
  }
}

function getOwnerDisplayNameById(
  ownerId: string | null | undefined,
  profilesMap: Record<string, Profile>
) {
  if (!ownerId) return notoOwnerFallback;
  return getProfileDisplayName(profilesMap[ownerId]);
}

function getClientNameById(
  clientId: string | null | undefined,
  clientsMap: Record<string, Client>
) {
  if (!clientId) return "—";
  return clientsMap[clientId]?.name || "—";
}

function getInitials(value?: string | null) {
  if (!value) return "👤";

  const clean = value.trim();
  if (!clean) return "👤";

  const parts = clean.split(" ").filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();

  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function mapDbTaskToUiTask(
  task: DbTask,
  profilesMap: Record<string, Profile>,
  clientsMap: Record<string, Client>
): Task {
  return {
    id: task.id,
    title: task.titolo,
    macroarea: task.macroarea || "Consulenza",
    riferimento: task.riferimento || getClientNameById(task.client_id, clientsMap),
    attivita: task.attivita || "Coordinamento",
    status: mapDbStatusToUi(task.stato),
    priority: mapDbPriorityToUi(task.priorita),
    owner: getOwnerDisplayNameById(task.owner_id, profilesMap),
    ownerId: task.owner_id || undefined,
    clientId: task.client_id || undefined,
    clientName: getClientNameById(task.client_id, clientsMap),
    dueDate: task.due_date || undefined,
    openedAt: task.opened_at?.split("T")[0] || "",
    closedAt: task.closed_at ? task.closed_at.split("T")[0] : undefined,
    archived: task.archived,
    notes: task.note || "",
  };
}

function renderHistoryValue(
  campo: string,
  value: string | null,
  profilesMap: Record<string, Profile>,
  clientsMap: Record<string, Client>
) {
  if (!value) return "—";

  if (campo === "stato") {
    if (value === "todo") return "Da fare";
    if (value === "in_progress") return "In corso";
    if (value === "completed") return "Completato";
  }

  if (campo === "priorita") {
    if (value === "low") return "Bassa";
    if (value === "medium") return "Media";
    if (value === "high") return "Alta";
  }

  if (campo === "owner_id" || campo === "closed_by") {
    return getProfileDisplayName(profilesMap[value]);
  }

  if (campo === "client_id") {
    return getClientNameById(value, clientsMap);
  }

  if (campo === "due_date" || campo === "closed_at") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return formatDate(value);
  }

  if (campo === "archived") {
    return value === "true" ? "Sì" : "No";
  }

  return value;
}

function renderHistoryFieldLabel(campo: string) {
  const labels: Record<string, string> = {
    titolo: "Titolo",
    macroarea: "Macroarea",
    riferimento: "Riferimento",
    attivita: "Attività",
    stato: "Stato",
    priorita: "Priorità",
    owner_id: "Owner",
    client_id: "Struttura",
    due_date: "Scadenza",
    closed_at: "Data chiusura",
    closed_by: "Chiuso da",
    archived: "Archiviata",
    note: "Note",
  };

  return labels[campo] || campo;
}

function buildLocalHistoryEntries(
  taskId: string,
  previousTask: Task,
  nextTask: Task,
  changedBy: string
): TaskHistoryRow[] {
  const now = new Date().toISOString();
  const entries: TaskHistoryRow[] = [];

  const addEntry = (campo: string, before: string | null, after: string | null) => {
    entries.push({
      id: crypto.randomUUID(),
      task_id: taskId,
      campo_modificato: campo,
      valore_precedente: before,
      valore_nuovo: after,
      changed_at: now,
      changed_by: changedBy,
    });
  };

  if (previousTask.title !== nextTask.title) addEntry("titolo", previousTask.title, nextTask.title);
  if (previousTask.macroarea !== nextTask.macroarea) addEntry("macroarea", previousTask.macroarea, nextTask.macroarea);
  if (previousTask.riferimento !== nextTask.riferimento) addEntry("riferimento", previousTask.riferimento, nextTask.riferimento);
  if (previousTask.attivita !== nextTask.attivita) addEntry("attivita", previousTask.attivita, nextTask.attivita);

  if (previousTask.status !== nextTask.status) {
    addEntry("stato", mapUiStatusToDb(previousTask.status), mapUiStatusToDb(nextTask.status));
  }

  if (previousTask.priority !== nextTask.priority) {
    addEntry("priorita", mapUiPriorityToDb(previousTask.priority), mapUiPriorityToDb(nextTask.priority));
  }

  if ((previousTask.ownerId || null) !== (nextTask.ownerId || null)) {
    addEntry("owner_id", previousTask.ownerId || null, nextTask.ownerId || null);
  }

  if ((previousTask.clientId || null) !== (nextTask.clientId || null)) {
    addEntry("client_id", previousTask.clientId || null, nextTask.clientId || null);
  }

  if ((previousTask.dueDate || null) !== (nextTask.dueDate || null)) {
    addEntry("due_date", previousTask.dueDate || null, nextTask.dueDate || null);
  }

  if ((previousTask.closedAt || null) !== (nextTask.closedAt || null)) {
    addEntry("closed_at", previousTask.closedAt || null, nextTask.closedAt || null);
  }

  if (previousTask.archived !== nextTask.archived) {
    addEntry("archived", String(previousTask.archived), String(nextTask.archived));
  }

  if ((previousTask.notes || "") !== (nextTask.notes || "")) {
    addEntry("note", previousTask.notes || null, nextTask.notes || null);
  }

  return entries;
}

function OperationsContent() {
  const searchParams = useSearchParams();
  const targetTaskId = searchParams.get("taskId");
  const targetSubtaskId = searchParams.get("subtaskId");

  const [tasks, setTasks] = useState<Task[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [subtaskTypes, setSubtaskTypes] = useState<SubtaskType[]>([]);
  const [subtasksByTask, setSubtasksByTask] = useState<Record<string, SubtaskDetailedRow[]>>({});
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [historyByTask, setHistoryByTask] = useState<Record<string, TaskHistoryRow[]>>({});
  const [expandedTaskIds, setExpandedTaskIds] = useState<string[]>([]);

  const [newTask, setNewTask] = useState("");
  const [newMacroarea, setNewMacroarea] = useState("Consulenza");
  const [newRiferimento, setNewRiferimento] = useState("");
  const [newAttivita, setNewAttivita] = useState("");
  const [newOwnerId, setNewOwnerId] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [newNotes, setNewNotes] = useState("");

  const [filterOwnerId, setFilterOwnerId] = useState("Tutti");
  const [filterStatus, setFilterStatus] = useState("Tutti");
  const [filterPriority, setFilterPriority] = useState("Tutte");
  const [searchTerm, setSearchTerm] = useState("");
  const [activeKpi, setActiveKpi] = useState<KpiFilter>("Totali");
  const [showArchivedOnly, setShowArchivedOnly] = useState(false);

  const [loading, setLoading] = useState(true);
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);

  const [trackingModalData, setTrackingModalData] = useState<TrackingModalData | null>(null);
  const [trackingDate, setTrackingDate] = useState(new Date().toISOString().split("T")[0]);
  const [trackingMinutes, setTrackingMinutes] = useState("");
  const [trackingNotes, setTrackingNotes] = useState("");
  const [savingTracking, setSavingTracking] = useState(false);

  const profilesMap = useMemo(() => {
    return profiles.reduce<Record<string, Profile>>((acc, profile) => {
      acc[profile.id] = profile;
      return acc;
    }, {});
  }, [profiles]);

  const clientsMap = useMemo(() => {
    return clients.reduce<Record<string, Client>>((acc, client) => {
      acc[client.id] = client;
      return acc;
    }, {});
  }, [clients]);

  const userOptions = useMemo<UserOption[]>(() => {
    return profiles
      .map((profile) => ({
        id: profile.id,
        display_name: getProfileDisplayName(profile),
        avatar_url: profile.avatar_url,
      }))
      .filter((profile) => profile.display_name !== notoOwnerFallback)
      .sort((a, b) => a.display_name.localeCompare(b.display_name, "it"));
  }, [profiles]);

  const newRiferimentiOptions = riferimentiByMacroarea[newMacroarea] || [];

  useEffect(() => {
    setNewRiferimento("");
  }, [newMacroarea]);

  useEffect(() => {
    void loadOperationsData();
  }, []);

    useEffect(() => {
    if (!targetTaskId || loading) return;

    setExpandedTaskIds((prev) =>
      prev.includes(targetTaskId) ? prev : [...prev, targetTaskId]
    );
  }, [targetTaskId, loading]);

  useEffect(() => {
    if (!targetTaskId || loading) return;

    const timer = window.setTimeout(() => {
      const subtaskTarget = targetSubtaskId
        ? document.getElementById(`subtask-${targetSubtaskId}`)
        : null;

      const taskTarget = document.getElementById(`task-${targetTaskId}`);

      const target = subtaskTarget || taskTarget;

      if (target) {
        target.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    }, 900);

    return () => window.clearTimeout(timer);
  }, [targetTaskId, targetSubtaskId, loading, expandedTaskIds, subtasksByTask]);

  function getClientIdFromRiferimento(riferimento: string) {
    const match = clients.find(
      (client) => client.name.trim().toLowerCase() === riferimento.trim().toLowerCase()
    );

    return match?.id || null;
  }

  async function persistTaskHistory(entries: TaskHistoryRow[]) {
    if (entries.length === 0) return true;

    const { error } = await supabase.from("task_history").insert(
      entries.map((entry) => ({
        task_id: entry.task_id,
        campo_modificato: entry.campo_modificato,
        valore_precedente: entry.valore_precedente,
        valore_nuovo: entry.valore_nuovo,
        changed_at: entry.changed_at,
        changed_by: entry.changed_by,
      }))
    );

    if (error) {
      console.error("Errore salvataggio storico task:", error.message);
      return false;
    }

    return true;
  }

  async function loadOperationsData() {
    setLoading(true);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        console.error("Errore recupero utente:", userError.message);
        return;
      }

      if (!user) {
        console.error("Utente non autenticato");
        return;
      }

      setCurrentUserId(user.id);

      const { data: profilesData, error: profilesError } = await supabase
        .from("profiles")
        .select("id, nome, cognome, email, avatar_url")
        .order("nome", { ascending: true });

      if (profilesError) {
        console.error("Errore recupero profili:", profilesError.message);
        return;
      }

      const safeProfiles = (profilesData as Profile[]) || [];
      setProfiles(safeProfiles);

      const { data: clientsData, error: clientsError } = await supabase
        .from("clients")
        .select("id, name")
        .eq("status", "active")
        .order("name", { ascending: true });

      if (clientsError) {
        console.error("Errore recupero strutture:", clientsError.message);
        setClients([]);
      } else {
        setClients((clientsData as Client[]) || []);
      }

      const nextProfilesMap = safeProfiles.reduce<Record<string, Profile>>((acc, profile) => {
        acc[profile.id] = profile;
        return acc;
      }, {});

      const nextClientsMap = ((clientsData as Client[]) || []).reduce<Record<string, Client>>(
        (acc, client) => {
          acc[client.id] = client;
          return acc;
        },
        {}
      );

      const { data: tasksData, error: tasksError } = await supabase
        .from("tasks")
        .select("*")
        .order("opened_at", { ascending: false });

      if (tasksError) {
        console.error("Errore recupero task:", tasksError.message);
        return;
      }

      const mappedTasks = ((tasksData as DbTask[]) || []).map((task) =>
        mapDbTaskToUiTask(task, nextProfilesMap, nextClientsMap)
      );

      setTasks(mappedTasks);

      const { data: historyData, error: historyError } = await supabase
        .from("task_history")
        .select("*")
        .order("changed_at", { ascending: false });

      if (historyError) {
        console.error("Errore recupero storico task:", historyError.message);
        setHistoryByTask({});
      } else {
        const groupedHistory = ((historyData as TaskHistoryRow[]) || []).reduce<
          Record<string, TaskHistoryRow[]>
        >((acc, row) => {
          if (!acc[row.task_id]) acc[row.task_id] = [];
          acc[row.task_id].push(row);
          return acc;
        }, {});
        setHistoryByTask(groupedHistory);
      }

      const { data: subtaskTypesData, error: subtaskTypesError } = await supabase
        .from("subtask_types")
        .select("id, code, name, process_area, description, active")
        .eq("active", true)
        .order("code", { ascending: true });

      if (subtaskTypesError) {
        console.error("Errore recupero tipi subtask:", subtaskTypesError.message);
        setSubtaskTypes([]);
      } else {
        setSubtaskTypes((subtaskTypesData as SubtaskType[]) || []);
      }

      const { data: subtasksData, error: subtasksError } = await supabase
        .from("v_subtasks_detailed")
        .select("*")
        .order("order_index", { ascending: true });

      if (subtasksError) {
        console.error("Errore recupero subtasks:", subtasksError.message);
        setSubtasksByTask({});
      } else {
        const groupedSubtasks = ((subtasksData as SubtaskDetailedRow[]) || []).reduce<
          Record<string, SubtaskDetailedRow[]>
        >((acc, row) => {
          if (!row.task_id || !row.subtask_id) return acc;
          if (!acc[row.task_id]) acc[row.task_id] = [];
          acc[row.task_id].push(row);
          return acc;
        }, {});

        Object.keys(groupedSubtasks).forEach((taskId) => {
          groupedSubtasks[taskId] = groupedSubtasks[taskId].sort(
            (a, b) => a.order_index - b.order_index
          );
        });

        setSubtasksByTask(groupedSubtasks);
      }
    } finally {
      setLoading(false);
    }
  }

  function openTrackingModal(task: Task, subtask?: SubtaskDetailedRow) {
    if (!task.id) {
      window.alert("Task non valida.");
      return;
    }

    setTrackingModalData({ task, subtask });
    setTrackingDate(new Date().toISOString().split("T")[0]);
    setTrackingMinutes("");
    setTrackingNotes("");
  }

  function closeTrackingModal() {
    if (savingTracking) return;

    setTrackingModalData(null);
    setTrackingDate(new Date().toISOString().split("T")[0]);
    setTrackingMinutes("");
    setTrackingNotes("");
  }

  async function submitTrackingEntry() {
    if (!trackingModalData) return;

    const minutesNumber = Number(trackingMinutes);

    if (!trackingModalData.task.id) {
      window.alert("Task obbligatoria.");
      return;
    }

    if (!currentUserId) {
      window.alert("Utente non autenticato.");
      return;
    }

    if (!trackingDate) {
      window.alert("Data obbligatoria.");
      return;
    }

    if (!Number.isFinite(minutesNumber) || minutesNumber <= 0) {
      window.alert("Inserisci minuti maggiori di zero.");
      return;
    }

    setSavingTracking(true);

    const riferimento =
      trackingModalData.task.riferimento ||
      trackingModalData.task.clientName ||
      trackingModalData.task.title;

    const attivita = trackingModalData.subtask
      ? trackingModalData.subtask.subtask_label || trackingModalData.subtask.subtask_name
      : trackingModalData.task.attivita || trackingModalData.task.title;

    const { error } = await supabase.from("tracking").insert({
      macroarea: trackingModalData.task.macroarea || "Operations",
      riferimento,
      client_id: trackingModalData.task.clientId || null,
      task_id: trackingModalData.task.id,
      subtask_id: trackingModalData.subtask?.subtask_id || null,
      operatore_id: currentUserId,
      data: trackingDate,
      minuti: minutesNumber,
      attivita,
      notes: trackingNotes.trim() || null,
    });

    if (error) {
      console.error("Errore registrazione tracking:", error.message);
      window.alert("Errore nella registrazione del tempo.");
      setSavingTracking(false);
      return;
    }

    setSavingTracking(false);
    closeTrackingModal();
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const isLate = (task: Task) => {
    if (!task.dueDate || task.archived || task.status === "Completato") return false;
    const due = new Date(task.dueDate);
    due.setHours(0, 0, 0, 0);
    return due < today;
  };

  const activeTasks = tasks.filter((task) => !task.archived);
  const archivedTasks = tasks.filter((task) => task.archived);

  const totalTasks = activeTasks.length;
  const todoTasks = activeTasks.filter((t) => t.status === "Da fare").length;
  const inProgressTasks = activeTasks.filter((t) => t.status === "In corso").length;
  const completedTasks = tasks.filter((t) => t.status === "Completato").length;
  const delayedTasks = activeTasks.filter((t) => isLate(t)).length;

  const baseTasks = showArchivedOnly ? archivedTasks : activeTasks;

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

    return [...baseTasks].sort((a, b) => {
      const priorityCompare = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityCompare !== 0) return priorityCompare;

      const statusCompare = statusOrder[a.status] - statusOrder[b.status];
      if (statusCompare !== 0) return statusCompare;

      return a.title.localeCompare(b.title, "it");
    });
  }, [baseTasks]);

  const filteredTasks = sortedTasks.filter((task) => {
    const ownerMatch = filterOwnerId === "Tutti" || (task.ownerId || "") === filterOwnerId;
    const statusMatch = filterStatus === "Tutti" || task.status === filterStatus;
    const priorityMatch = filterPriority === "Tutte" || task.priority === filterPriority;

    const search = searchTerm.trim().toLowerCase();
    const taskSubtasks = subtasksByTask[task.id] || [];

    const searchMatch =
      search === "" ||
      task.title.toLowerCase().includes(search) ||
      task.macroarea.toLowerCase().includes(search) ||
      task.riferimento.toLowerCase().includes(search) ||
      task.attivita.toLowerCase().includes(search) ||
      task.owner.toLowerCase().includes(search) ||
      (task.clientName || "").toLowerCase().includes(search) ||
      task.notes.toLowerCase().includes(search) ||
      task.id.toLowerCase().includes(search) ||
      getShortTaskId(task.id).toLowerCase().includes(search) ||
      taskSubtasks.some(
        (subtask) =>
          subtask.subtask_name.toLowerCase().includes(search) ||
          (subtask.subtask_label || "").toLowerCase().includes(search) ||
          (subtask.owner_display_name || "").toLowerCase().includes(search) ||
          subtask.subtask_code.toLowerCase().includes(search)
      );

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

    return ownerMatch && statusMatch && priorityMatch && searchMatch && kpiMatch;
  });

  async function addTask() {
    if (!newTask.trim() || !currentUserId) return;

    if (!newMacroarea || !newRiferimento || !newAttivita) {
      window.alert("Macroarea, riferimento e attività sono obbligatori.");
      return;
    }

    const ownerId = newOwnerId || currentUserId;
    const clientId = getClientIdFromRiferimento(newRiferimento);

    const { data, error } = await supabase
      .from("tasks")
      .insert({
        titolo: newTask.trim(),
        descrizione: null,
        macroarea: newMacroarea,
        riferimento: newRiferimento,
        attivita: newAttivita,
        stato: "todo",
        priorita: "medium",
        owner_id: ownerId,
        client_id: clientId,
        created_by: currentUserId,
        opened_at: new Date().toISOString(),
        due_date: newDueDate || null,
        closed_at: null,
        closed_by: null,
        note: newNotes.trim() || null,
        archived: false,
      })
      .select("*")
      .single();

    if (error) {
      console.error("Errore creazione task:", error.message);
      return;
    }

    console.log("task insert ok", { taskId: data.id, ownerId });

    const insertedTask = mapDbTaskToUiTask(data as DbTask, profilesMap, clientsMap);

    if (ownerId) {
      try {
        console.log("assignment notification start", {
          taskId: insertedTask.id,
          ownerId,
        });

        const clientName =
          insertedTask.clientName && insertedTask.clientName !== "—"
            ? insertedTask.clientName
            : null;

        await sendAssignmentNotification({
          eventType: "task_assigned",
          taskId: insertedTask.id,
          assignedToUserId: ownerId,
          assignedByUserId: currentUserId || undefined,
          title: "Nuova task assegnata",
          message: clientName
            ? `Ti è stata assegnata la task "${insertedTask.title}" per ${clientName}.`
            : `Ti è stata assegnata la task "${insertedTask.title}".`,
          deepLink: "/operations",
        });

        console.log("assignment notification success", {
          taskId: insertedTask.id,
          ownerId,
        });
      } catch (notificationError) {
        console.log("assignment notification error", notificationError);
        console.error("Errore notifica creazione task:", notificationError);
      }
    }

    setTasks((prev) => [insertedTask, ...prev]);

    setNewTask("");
    setNewMacroarea("Consulenza");
    setNewRiferimento("");
    setNewAttivita("");
    setNewOwnerId("");
    setNewDueDate("");
    setNewNotes("");
  }
    async function updateTask(id: string, patch: Partial<Task>) {
    const previousTasks = tasks;
    const previousHistory = historyByTask;

    const previousTask = tasks.find((task) => task.id === id);
    if (!previousTask) return;

    const nextOwnerId =
      patch.ownerId !== undefined ? patch.ownerId || undefined : previousTask.ownerId;

    const nextRiferimento =
      patch.riferimento !== undefined ? patch.riferimento : previousTask.riferimento;

    const nextClientId =
      patch.clientId !== undefined
        ? patch.clientId || undefined
        : getClientIdFromRiferimento(nextRiferimento) || previousTask.clientId;

    const nextTask: Task = {
      ...previousTask,
      ...patch,
      ownerId: nextOwnerId,
      owner: getOwnerDisplayNameById(nextOwnerId, profilesMap),
      clientId: nextClientId,
      clientName: getClientNameById(nextClientId, clientsMap),
    };

    const localHistoryEntries = buildLocalHistoryEntries(
      id,
      previousTask,
      nextTask,
      currentUserId
    );

    setTasks((prev) => prev.map((task) => (task.id === id ? nextTask : task)));

    if (localHistoryEntries.length > 0) {
      setHistoryByTask((prev) => ({
        ...prev,
        [id]: [...localHistoryEntries, ...(prev[id] || [])],
      }));
    }

    setSavingTaskId(id);

    const dbPatch: Record<string, string | boolean | null> = {};

    if (patch.title !== undefined) dbPatch.titolo = patch.title;
    if (patch.macroarea !== undefined) dbPatch.macroarea = patch.macroarea;
    if (patch.riferimento !== undefined) {
      dbPatch.riferimento = patch.riferimento;
      dbPatch.client_id = getClientIdFromRiferimento(patch.riferimento);
    }
    if (patch.attivita !== undefined) dbPatch.attivita = patch.attivita;
    if (patch.status !== undefined) dbPatch.stato = mapUiStatusToDb(patch.status);
    if (patch.priority !== undefined) dbPatch.priorita = mapUiPriorityToDb(patch.priority);
    if (patch.ownerId !== undefined) dbPatch.owner_id = patch.ownerId || null;
    if (patch.clientId !== undefined) dbPatch.client_id = patch.clientId || null;
    if (patch.dueDate !== undefined) dbPatch.due_date = patch.dueDate || null;
    if (patch.closedAt !== undefined) {
      dbPatch.closed_at = patch.closedAt ? new Date(patch.closedAt).toISOString() : null;
    }
    if (patch.archived !== undefined) dbPatch.archived = patch.archived;
    if (patch.notes !== undefined) dbPatch.note = patch.notes || null;

    const { error } = await supabase.from("tasks").update(dbPatch).eq("id", id);

    if (error) {
      console.error("Errore aggiornamento task:", error.message);
      setTasks(previousTasks);
      setHistoryByTask(previousHistory);
      setSavingTaskId(null);
      return;
    }

    console.log({ nextOwnerId, previousOwnerId: previousTask.ownerId });
    if (nextOwnerId && nextOwnerId !== previousTask.ownerId) {
      try {
        console.log("assignment notification start", {
          taskId: id,
          ownerId: nextOwnerId,
        });

        const clientName =
          nextTask.clientName && nextTask.clientName !== "—" ? nextTask.clientName : null;

        await sendAssignmentNotification({
          eventType: "task_assigned",
          taskId: id,
          assignedToUserId: nextOwnerId,
          assignedByUserId: currentUserId || undefined,
          title: "Nuova task assegnata",
          message: clientName
            ? `Ti è stata assegnata la task "${nextTask.title}" per ${clientName}.`
            : `Ti è stata assegnata la task "${nextTask.title}".`,
          deepLink: "/operations",
        });

        console.log("assignment notification success", {
          taskId: id,
          ownerId: nextOwnerId,
        });
      } catch (notificationError) {
        console.log("assignment notification error", notificationError);
        console.error("Errore notifica aggiornamento task:", notificationError);
      }
    }

    const historySaved = await persistTaskHistory(localHistoryEntries);

    if (!historySaved) {
      setTasks(previousTasks);
      setHistoryByTask(previousHistory);
      await loadOperationsData();
    }

    setSavingTaskId(null);
  }

  async function closeTask(task: Task) {
    const confirmClose = window.confirm(
      `Vuoi chiudere definitivamente la task "${task.title}"?`
    );

    if (!confirmClose) return;

    await updateTask(task.id, {
      status: "Completato",
      archived: true,
      closedAt: new Date().toISOString().split("T")[0],
    });

    const { error } = await supabase
      .from("tasks")
      .update({
        stato: "completed",
        archived: true,
        closed_at: new Date().toISOString(),
        closed_by: currentUserId,
      })
      .eq("id", task.id);

    if (error) {
      console.error("Errore chiusura task:", error.message);
      await loadOperationsData();
    }
  }

  async function reopenTask(task: Task) {
    await updateTask(task.id, {
      status: "Da fare",
      archived: false,
      closedAt: undefined,
    });

    const { error } = await supabase
      .from("tasks")
      .update({
        stato: "todo",
        archived: false,
        closed_at: null,
        closed_by: null,
      })
      .eq("id", task.id);

    if (error) {
      console.error("Errore riapertura task:", error.message);
      await loadOperationsData();
    }
  }

  async function deleteTask(task: Task) {
    const confirmDelete = window.confirm(
      `Eliminare la task "${task.title}"? Questa azione è prevista solo in fase test.`
    );

    if (!confirmDelete) return;

    const previousTasks = tasks;
    const previousHistory = historyByTask;
    const previousSubtasks = subtasksByTask;

    setTasks((prev) => prev.filter((item) => item.id !== task.id));
    setHistoryByTask((prev) => {
      const copy = { ...prev };
      delete copy[task.id];
      return copy;
    });
    setSubtasksByTask((prev) => {
      const copy = { ...prev };
      delete copy[task.id];
      return copy;
    });

    const { error } = await supabase.from("tasks").delete().eq("id", task.id);

    if (error) {
      console.error("Errore eliminazione task:", error.message);
      setTasks(previousTasks);
      setHistoryByTask(previousHistory);
      setSubtasksByTask(previousSubtasks);
    }
  }

  async function handleToggleSubtask(subtaskId: string, completed: boolean) {
    const previousSubtasks = subtasksByTask;

    setSubtasksByTask((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((taskId) => {
        next[taskId] = next[taskId].map((subtask) =>
          subtask.subtask_id === subtaskId ? { ...subtask, completed } : subtask
        );
      });
      return next;
    });

    const { error } = await supabase
      .from("subtasks")
      .update({ completed })
      .eq("id", subtaskId);

    if (error) {
      console.error("Errore aggiornamento subtask:", error.message);
      setSubtasksByTask(previousSubtasks);
    }
  }

  async function handleAssignSubtask(subtaskId: string, ownerId: string) {
    const previousSubtasks = subtasksByTask;
    const selectedUser = userOptions.find((user) => user.id === ownerId);

    setSubtasksByTask((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((taskId) => {
        next[taskId] = next[taskId].map((subtask) =>
          subtask.subtask_id === subtaskId
            ? {
                ...subtask,
                owner_id: ownerId || null,
                owner_display_name: selectedUser?.display_name || null,
                avatar_url: selectedUser?.avatar_url || null,
              }
            : subtask
        );
      });
      return next;
    });

    const { error } = await supabase
      .from("subtasks")
      .update({ owner_id: ownerId || null })
      .eq("id", subtaskId);

    if (error) {
      console.error("Errore assegnazione subtask:", error.message);
      setSubtasksByTask(previousSubtasks);
    }
  }

  async function handleAddManualSubtask(taskId: string, label: string, ownerId: string) {
    const cleanLabel = label.trim();
    if (!cleanLabel) return;

    const fallbackTypeId = subtaskTypes[0]?.id;

    if (!fallbackTypeId) {
      window.alert("Serve almeno un subtask_type attivo per creare subtask manuali.");
      return;
    }

    const currentSubtasks = subtasksByTask[taskId] || [];
    const nextOrder =
      currentSubtasks.length > 0
        ? Math.max(...currentSubtasks.map((subtask) => subtask.order_index)) + 1
        : 1;

    const { error } = await supabase.from("subtasks").insert({
      task_id: taskId,
      type_id: fallbackTypeId,
      label: cleanLabel,
      order_index: nextOrder,
      completed: false,
      owner_id: ownerId || null,
    });

    if (error) {
      console.error("Errore creazione subtask manuale:", error.message);
      window.alert("Errore nella creazione della subtask.");
      return;
    }

    const { data, error: refreshError } = await supabase
      .from("v_subtasks_detailed")
      .select("*")
      .eq("task_id", taskId)
      .order("order_index", { ascending: true });

    if (refreshError) {
      console.error("Errore refresh subtasks:", refreshError.message);
      return;
    }

    setSubtasksByTask((prev) => ({
      ...prev,
      [taskId]: ((data as SubtaskDetailedRow[]) || []).sort(
        (a, b) => a.order_index - b.order_index
      ),
    }));

    setExpandedTaskIds((prev) => (prev.includes(taskId) ? prev : [...prev, taskId]));
  }

  function toggleExpand(taskId: string) {
    setExpandedTaskIds((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
    );
  }

  const resetFilters = () => {
    setFilterOwnerId("Tutti");
    setFilterStatus("Tutti");
    setFilterPriority("Tutte");
    setSearchTerm("");
    setActiveKpi("Totali");
  };

  const statusStyles: Record<TaskStatus, { bg: string; color: string; border: string }> = {
    "Da fare": { bg: "#f6fbfc", color: "#017A92", border: "#017A92" },
    "In corso": { bg: "#f4f1ed", color: "#2B2D2F", border: "#2B2D2F" },
    Completato: { bg: "#eef7f3", color: "#1f6b57", border: "#b9ddd1" },
  };

  const priorityStyles: Record<TaskPriority, { bg: string; color: string; border: string }> = {
    Bassa: { bg: "#f7f7f7", color: "#555555", border: "#dddddd" },
    Media: { bg: "#f3ece7", color: "#2B2D2F", border: "#d8cfc7" },
    Alta: { bg: "#f8eaea", color: "#993333", border: "#d8aaaa" },
  };

  const kpis: { label: KpiFilter; value: number }[] = [
    { label: "Totali", value: totalTasks },
    { label: "Da fare", value: todoTasks },
    { label: "In corso", value: inProgressTasks },
    { label: "Completate", value: completedTasks },
    { label: "In ritardo", value: delayedTasks },
  ];

  return (
    <main className={openSans.className} style={mainStyle}>
      <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
        <section style={heroCardStyle}>
<div style={{ display: "grid", gridTemplateColumns: "1fr", minHeight: "240px" }}>            <div style={heroLogoAreaStyle}>
              <div style={logoBoxStyle}>
                <div style={{ position: "relative", width: "140px", height: "140px" }}>
                  <Image
                    src="/images/metodo-logo.png"
                    alt="Metodo logo"
                    fill
                    sizes="140px"
                    style={{ objectFit: "contain" }}
                    priority
                  />
                </div>
              </div>
            </div>

            <div style={heroContentStyle}>
              <div>
                <p style={eyebrowStyle}>Metodo Control</p>
                <h1 className={notoSerif.className} style={heroTitleStyle}>
                  Operations
                </h1>
                <p style={heroTextStyle}>
                  Controllo operativo delle attività in corso con visione chiara su priorità,
                  stato di avanzamento, owner, tempi e storico.
                </p>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
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

        <section style={kpiGridStyle}>
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
            <h2 className={notoSerif.className} style={sectionTitleStyle}>
              Nuova task
            </h2>
          </div>

          <div style={newTaskGridStyle}>
            <div>
              <label style={labelStyle}>Titolo</label>
              <input
                type="text"
                placeholder="Nuova task"
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Macroarea</label>
              <select value={newMacroarea} onChange={(e) => setNewMacroarea(e.target.value)} style={inputStyle}>
                {macroareaOptions.map((macroarea) => (
                  <option key={macroarea} value={macroarea}>
                    {macroarea}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Riferimento</label>
              <select value={newRiferimento} onChange={(e) => setNewRiferimento(e.target.value)} style={inputStyle}>
                <option value="">Seleziona riferimento</option>
                {newRiferimentiOptions.map((riferimento) => (
                  <option key={riferimento} value={riferimento}>
                    {riferimento}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Attività</label>
              <select value={newAttivita} onChange={(e) => setNewAttivita(e.target.value)} style={inputStyle}>
                <option value="">Seleziona attività</option>
                {attivitaOptions.map((attivita) => (
                  <option key={attivita} value={attivita}>
                    {attivita}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Owner</label>
              <select value={newOwnerId} onChange={(e) => setNewOwnerId(e.target.value)} style={inputStyle}>
                <option value="">Assegna a me</option>
                {userOptions.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.display_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Scadenza</label>
              <input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} style={inputStyle} />
            </div>

            <div style={{ gridColumn: "span 2" }}>
              <label style={labelStyle}>Note</label>
              <input type="text" placeholder="Nota rapida" value={newNotes} onChange={(e) => setNewNotes(e.target.value)} style={inputStyle} />
            </div>

            <button onClick={() => void addTask()} style={primaryButtonStyle}>
              Aggiungi
            </button>
          </div>
        </section>

        <section style={{ ...sectionCardStyle, marginTop: "20px" }}>
          <div style={listHeaderStyle}>
            <div>
              <h2 className={notoSerif.className} style={sectionTitleStyle}>
                {showArchivedOnly ? "Task archiviate" : "Task list"}
              </h2>
            </div>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button
                onClick={() => {
                  setShowArchivedOnly((prev) => !prev);
                  setActiveKpi("Totali");
                }}
                style={{
                  ...secondaryButtonStyle,
                  background: showArchivedOnly ? "#f6fbfc" : "#ffffff",
                  border: showArchivedOnly ? "1px solid #017A92" : "1px solid #d8d0c8",
                  color: showArchivedOnly ? "#017A92" : "#2B2D2F",
                }}
              >
                {showArchivedOnly ? "Mostra attive" : "Solo archiviate"}
              </button>

              <button onClick={resetFilters} style={secondaryButtonStyle}>
                Reset filtri
              </button>
            </div>
          </div>

          <div style={filtersGridStyle}>
            <div>
              <label style={labelStyle}>Ricerca</label>
              <input
                type="text"
                placeholder="Titolo, macroarea, riferimento, attività, owner, ID"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Owner</label>
              <select value={filterOwnerId} onChange={(e) => setFilterOwnerId(e.target.value)} style={inputStyle}>
                <option value="Tutti">Tutti</option>
                {userOptions.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.display_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Stato</label>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={inputStyle}>
                <option value="Tutti">Tutti</option>
                <option value="Da fare">Da fare</option>
                <option value="In corso">In corso</option>
                <option value="Completato">Completato</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Priorità</label>
              <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)} style={inputStyle}>
                <option value="Tutte">Tutte</option>
                <option value="Alta">Alta</option>
                <option value="Media">Media</option>
                <option value="Bassa">Bassa</option>
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gap: "8px" }}>
            {loading ? (
              <div style={emptyStateStyle}>Caricamento task in corso...</div>
            ) : filteredTasks.length === 0 ? (
              <div style={emptyStateStyle}>Nessuna task trovata con questi filtri.</div>
            ) : (
              filteredTasks.map((task) => (
                <CompactTaskRow
                  key={task.id}
                  task={task}
                  userOptions={userOptions}
                  subtasks={(subtasksByTask[task.id] || []).slice().sort((a, b) => a.order_index - b.order_index)}
                  isLate={isLate(task)}
                  isExpanded={expandedTaskIds.includes(task.id)}
                  isSaving={savingTaskId === task.id}
                  history={historyByTask[task.id] || []}
                  profilesMap={profilesMap}
                  clientsMap={clientsMap}
                  targetTaskId={targetTaskId}
                  targetSubtaskId={targetSubtaskId}
                  onToggleExpand={toggleExpand}
                  onUpdate={updateTask}
                  onClose={closeTask}
                  onReopen={reopenTask}
                  onDelete={deleteTask}
                  onToggleSubtask={handleToggleSubtask}
                  onAssignSubtask={handleAssignSubtask}
                  onAddManualSubtask={handleAddManualSubtask}
                  onOpenTracking={openTrackingModal}
                  statusStyles={statusStyles}
                  priorityStyles={priorityStyles}
                />
              ))
            )}
          </div>
        </section>
      </div>

      {trackingModalData ? (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle}>
            <div style={{ marginBottom: "16px" }}>
              <p style={modalEyebrowStyle}>Tracking Operations</p>
              <h2 className={notoSerif.className} style={modalTitleStyle}>
                Registra tempo
              </h2>
              <p style={modalDescriptionStyle}>
                {trackingModalData.task.macroarea} · {trackingModalData.task.riferimento} ·{" "}
                {trackingModalData.subtask
                  ? trackingModalData.subtask.subtask_label || trackingModalData.subtask.subtask_name
                  : trackingModalData.task.attivita}
              </p>
            </div>

            <div style={{ display: "grid", gap: "12px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={labelStyle}>Data</label>
                  <input type="date" value={trackingDate} onChange={(e) => setTrackingDate(e.target.value)} style={inputStyle} disabled={savingTracking} />
                </div>

                <div>
                  <label style={labelStyle}>Minuti</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={trackingMinutes}
                    onChange={(e) => setTrackingMinutes(e.target.value)}
                    placeholder="Es. 30"
                    style={inputStyle}
                    disabled={savingTracking}
                  />
                </div>
              </div>

              <div>
                <label style={labelStyle}>Note</label>
                <textarea
                  value={trackingNotes}
                  onChange={(e) => setTrackingNotes(e.target.value)}
                  placeholder="Note opzionali"
                  style={textareaStyle}
                  disabled={savingTracking}
                />
              </div>
            </div>

            <div style={modalActionsStyle}>
              <button type="button" onClick={closeTrackingModal} style={secondaryButtonStyle} disabled={savingTracking}>
                Annulla
              </button>

              <button type="button" onClick={() => void submitTrackingEntry()} style={primaryButtonStyle} disabled={savingTracking}>
                {savingTracking ? "Salvataggio..." : "Salva tempo"}
              </button>
            </div>
          </div>
        </div>
            ) : null}
    </main>
  );
}

export default function OperationsPage() {
  return (
    <Suspense fallback={null}>
      <OperationsContent />
    </Suspense>
  );
}

function CompactTaskRow({
  task,
  userOptions,
  subtasks,
  isLate,
  isExpanded,
  isSaving,
  history,
  profilesMap,
  clientsMap,
  targetTaskId,
  targetSubtaskId,
  onToggleExpand,
  onUpdate,
  onClose,
  onReopen,
  onDelete,
  onToggleSubtask,
  onAssignSubtask,
  onAddManualSubtask,
  onOpenTracking,
  statusStyles,
  priorityStyles,
}: {
  task: Task;
  userOptions: UserOption[];
  subtasks: SubtaskDetailedRow[];
  isLate: boolean;
  isExpanded: boolean;
  isSaving: boolean;
  history: TaskHistoryRow[];
  profilesMap: Record<string, Profile>;
  clientsMap: Record<string, Client>;
  targetTaskId: string | null;
  targetSubtaskId: string | null;
  onToggleExpand: (taskId: string) => void;
  onUpdate: (id: string, patch: Partial<Task>) => Promise<void>;
  onClose: (task: Task) => Promise<void>;
  onReopen: (task: Task) => Promise<void>;
  onDelete: (task: Task) => Promise<void>;
  onToggleSubtask: (subtaskId: string, completed: boolean) => Promise<void>;
  onAssignSubtask: (subtaskId: string, ownerId: string) => Promise<void>;
  onAddManualSubtask: (taskId: string, label: string, ownerId: string) => Promise<void>;
  onOpenTracking: (task: Task, subtask?: SubtaskDetailedRow) => void;
  statusStyles: Record<TaskStatus, { bg: string; color: string; border: string }>;
  priorityStyles: Record<TaskPriority, { bg: string; color: string; border: string }>;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [newSubtaskLabel, setNewSubtaskLabel] = useState("");
  const [newSubtaskOwnerId, setNewSubtaskOwnerId] = useState("");

  const isTargetTask = targetTaskId === task.id;

  return (
    <article id={`task-${task.id}`} style={taskRowCardStyle(task.priority, isSaving, isTargetTask)}>
      <div style={taskRowHeaderStyle}>
        <div style={{ minWidth: 0 }}>
          <div style={taskTitleStyle} title={task.title}>
            {task.title}
          </div>
          <div style={taskMetaInlineStyle}>
            <span>{getShortTaskId(task.id)}</span>
            <span>{task.macroarea}</span>
            <span>{task.riferimento}</span>
            <span>{task.attivita}</span>
            {isTargetTask ? <span style={{ color: "#017A92" }}>Aperta da Tracking</span> : null}
            {isSaving ? <span>Salvataggio...</span> : null}
          </div>
        </div>

        <div style={rowTextStyle} title={task.riferimento}>
          {task.riferimento || "—"}
        </div>

        <div>
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
        </div>

        <div>
          <span
            style={{
              ...pillStyleCompact,
              background: priorityStyles[task.priority].bg,
              color: priorityStyles[task.priority].color,
              border: `1px solid ${priorityStyles[task.priority].border}`,
            }}
          >
            {task.priority}
          </span>
        </div>

        <div style={rowTextStyle} title={task.owner}>
          {task.owner}
        </div>

        <button
          type="button"
          onClick={() => onToggleExpand(task.id)}
          style={expandButtonStyle}
          title={isExpanded ? "Chiudi dettagli" : "Apri dettagli"}
        >
          {isExpanded ? "▴" : "▾"}
        </button>
      </div>

      {isExpanded ? (
        <div style={expandedPanelStyle}>
          <div style={detailsGridStyle}>
            <InfoItem label="Macroarea" value={task.macroarea} />
            <InfoItem label="Riferimento" value={task.riferimento} />
            <InfoItem label="Attività" value={task.attivita} />
            <InfoItem label="Owner" value={task.owner} />
            <InfoItem label="Scadenza" value={formatDate(task.dueDate)} />
            <InfoItem label="Aperta" value={formatDate(task.openedAt)} />
          </div>

          {task.notes ? (
            <div style={{ marginBottom: "14px" }}>
              <span style={metaLabelStyle}>Note</span>
              <div style={{ fontSize: "12px", color: "#555555", lineHeight: 1.5 }}>
                {task.notes}
              </div>
            </div>
          ) : null}

          <div style={actionsRowStyle}>
            {!task.archived ? (
              <>
                <select
                  value={task.status}
                  onChange={(e) => {
                    const nextStatus = e.target.value as TaskStatus;
                    void onUpdate(task.id, {
                      status: nextStatus,
                      closedAt: nextStatus === "Completato" ? new Date().toISOString().split("T")[0] : undefined,
                    });
                  }}
                  style={selectCompactStyle}
                  disabled={isSaving}
                >
                  <option value="Da fare">Da fare</option>
                  <option value="In corso">In corso</option>
                  <option value="Completato">Completato</option>
                </select>

                <select
                  value={task.priority}
                  onChange={(e) => void onUpdate(task.id, { priority: e.target.value as TaskPriority })}
                  style={selectCompactStyle}
                  disabled={isSaving}
                >
                  <option value="Bassa">Bassa</option>
                  <option value="Media">Media</option>
                  <option value="Alta">Alta</option>
                </select>

                <select
                  value={task.ownerId || ""}
                  onChange={(e) => void onUpdate(task.id, { ownerId: e.target.value || undefined })}
                  style={selectCompactStyle}
                  disabled={isSaving}
                >
                  <option value="">Non assegnato</option>
                  {userOptions.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.display_name}
                    </option>
                  ))}
                </select>

                <input
                  type="date"
                  value={task.dueDate || ""}
                  onChange={(e) => void onUpdate(task.id, { dueDate: e.target.value || undefined })}
                  style={inputStyleCompact}
                  disabled={isSaving}
                />

                <button type="button" onClick={() => onOpenTracking(task)} style={trackingButtonCompactStyle} disabled={isSaving}>
                  Registra tempo
                </button>

                <button onClick={() => void onClose(task)} style={dangerButtonCompactStyle} disabled={isSaving}>
                  Chiudi
                </button>

                <button onClick={() => void onDelete(task)} style={ghostDangerButtonCompactStyle} disabled={isSaving}>
                  Elimina
                </button>
              </>
            ) : (
              <>
                <button onClick={() => void onReopen(task)} style={secondaryButtonCompactStyle} disabled={isSaving}>
                  Riapri
                </button>

                <button onClick={() => void onDelete(task)} style={ghostDangerButtonCompactStyle} disabled={isSaving}>
                  Elimina
                </button>
              </>
            )}

            {isLate ? <span style={latePillStyle}>Ritardo</span> : null}
            {task.archived ? <span style={archivedPillStyle}>Archiviata</span> : null}
          </div>

          <div style={{ marginBottom: "16px" }}>
            <div style={subsectionHeaderStyle}>
              <span>Subtask operative</span>
            </div>

            {!task.archived ? (
              <div style={newSubtaskGridStyle}>
                <div>
                  <label style={miniLabelStyle}>Nuova subtask</label>
                  <input
                    type="text"
                    value={newSubtaskLabel}
                    onChange={(e) => setNewSubtaskLabel(e.target.value)}
                    placeholder="Es. invio proposta, richiesta documenti, follow up..."
                    style={inputStyleCompactFull}
                    disabled={isSaving}
                  />
                </div>

                <div>
                  <label style={miniLabelStyle}>Owner</label>
                  <select
                    value={newSubtaskOwnerId}
                    onChange={(e) => setNewSubtaskOwnerId(e.target.value)}
                    style={inputStyleCompactFull}
                    disabled={isSaving}
                  >
                    <option value="">Non assegnato</option>
                    {userOptions.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.display_name}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={async () => {
                    await onAddManualSubtask(task.id, newSubtaskLabel, newSubtaskOwnerId);
                    setNewSubtaskLabel("");
                    setNewSubtaskOwnerId("");
                  }}
                  style={secondaryButtonCompactStyle}
                  disabled={isSaving}
                >
                  Aggiungi subtask
                </button>
              </div>
            ) : null}

            <SubtaskList
              task={task}
              subtasks={subtasks}
              users={userOptions}
              targetSubtaskId={targetSubtaskId}
              onToggle={(id, completed) => void onToggleSubtask(id, completed)}
              onAssign={(id, ownerId) => void onAssignSubtask(id, ownerId)}
              onOpenTracking={onOpenTracking}
            />
          </div>

          <div>
            <button type="button" onClick={() => setShowHistory((prev) => !prev)} style={historyToggleButtonStyle}>
              <span>Storico modifiche</span>
              <span>{showHistory ? "▴" : "▾"}</span>
            </button>

            {showHistory ? (
              <div style={{ marginTop: "10px" }}>
                {history.length === 0 ? (
                  <div style={historyEmptyStateStyle}>
                    Nessuna modifica registrata per questa task.
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: "8px" }}>
                    {history.map((row) => (
                      <div key={row.id} style={historyRowStyle}>
                        <div style={historyTopRowStyle}>
                          <strong style={{ color: "#2B2D2F", fontSize: "12px" }}>
                            {renderHistoryFieldLabel(row.campo_modificato)}
                          </strong>
                          <span style={{ color: "#77706a", fontSize: "11px" }}>
                            {formatDateTime(row.changed_at)}
                          </span>
                        </div>

                        <div style={{ marginTop: "6px", fontSize: "12px", color: "#555555" }}>
                          <span style={{ fontWeight: 700 }}>Prima:</span>{" "}
                          {renderHistoryValue(row.campo_modificato, row.valore_precedente, profilesMap, clientsMap)}
                        </div>

                        <div style={{ marginTop: "4px", fontSize: "12px", color: "#555555" }}>
                          <span style={{ fontWeight: 700 }}>Dopo:</span>{" "}
                          {renderHistoryValue(row.campo_modificato, row.valore_nuovo, profilesMap, clientsMap)}
                        </div>

                        <div style={{ marginTop: "6px", fontSize: "11px", color: "#8a8178" }}>
                          Modificato da:{" "}
                          {row.changed_by ? getProfileDisplayName(profilesMap[row.changed_by]) : "Sistema"}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span style={metaLabelStyle}>{label}</span>
      <div style={metaValueCompactStyle}>{value || "—"}</div>
    </div>
  );
}

function SubtaskList({
  task,
  subtasks,
  users,
  targetSubtaskId,
  onToggle,
  onAssign,
  onOpenTracking,
}: {
  task: Task;
  subtasks: SubtaskDetailedRow[];
  users: UserOption[];
  targetSubtaskId: string | null;
  onToggle: (id: string, completed: boolean) => void;
  onAssign: (id: string, ownerId: string) => void;
  onOpenTracking: (task: Task, subtask?: SubtaskDetailedRow) => void;
}) {
  if (subtasks.length === 0) {
    return <div style={historyEmptyStateStyle}>Nessuna subtask presente per questa task.</div>;
  }

  return (
    <div style={{ display: "grid", gap: "6px" }}>
      {subtasks.map((subtask) => {
        const subtaskId = subtask.subtask_id;
        const ownerName = subtask.owner_display_name || notoOwnerFallback;
        const isTargetSubtask = targetSubtaskId === subtaskId;

        return (
          <div
            id={`subtask-${subtaskId}`}
            key={`${subtask.task_id}-${subtaskId}-${subtask.order_index}`}
            style={subtaskRowStyleHighlighted(isTargetSubtask)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
              <input
                type="checkbox"
                checked={subtask.completed}
                onChange={(e) => onToggle(subtaskId, e.target.checked)}
              />

              <div style={{ minWidth: 0 }}>
                <div style={subtaskTitleStyle}>
                  <span>{subtask.subtask_label || subtask.subtask_name}</span>
                  <span style={{ fontSize: "11px", color: "#8a8178" }}>
                    {subtask.subtask_code}
                  </span>
                  {isTargetSubtask ? (
                    <span style={{ fontSize: "11px", color: "#017A92", fontWeight: 800 }}>
                      Focus da Tracking
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <div style={subtaskRightStyle}>
              <button type="button" onClick={() => onOpenTracking(task, subtask)} style={trackingButtonTinyStyle}>
                Registra tempo
              </button>

              <div style={avatarWrapStyle} title={ownerName}>
                {subtask.avatar_url ? (
                  <img src={subtask.avatar_url} alt={ownerName} style={avatarImgStyle} />
                ) : (
                  <div style={avatarFallbackStyle(subtask.owner_display_name)}>
                    {subtask.owner_display_name ? getInitials(subtask.owner_display_name) : "👤"}
                  </div>
                )}

                <span style={avatarNameStyle}>{ownerName}</span>
              </div>

              <select
                value={subtask.owner_id || ""}
                onChange={(e) => onAssign(subtaskId, e.target.value)}
                style={subtaskAssignSelectStyle}
              >
                <option value="">👤 Non assegnato</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.display_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const mainStyle: CSSProperties = {
  minHeight: "100vh",
  backgroundColor: "#f5f3ef",
  color: "#2B2D2F",
  padding: "32px 20px 40px",
};

const heroCardStyle: CSSProperties = {
  background: "#ffffff",
  border: "1px solid #e7dfd8",
  borderRadius: "24px",
  overflow: "hidden",
  marginBottom: "20px",
  boxShadow: "0 12px 30px rgba(43,45,47,0.05)",
};

const heroLogoAreaStyle: CSSProperties = {
  display: "flex",
  background: "linear-gradient(135deg, #0b8aa5 0%, #1f6f84 45%, #2B2D2F 100%)",
  alignItems: "center",
  justifyContent: "center",
  padding: "32px",
};

const logoBoxStyle: CSSProperties = {
  width: "170px",
  height: "170px",
  background: "#ffffff",
  borderRadius: "20px",
  boxShadow: "0 12px 30px rgba(43,45,47,0.12)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const heroContentStyle: CSSProperties = {
  padding: "32px",
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  gap: "18px",
};

const eyebrowStyle: CSSProperties = {
  margin: 0,
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "#017A92",
};

const heroTitleStyle: CSSProperties = {
  margin: "10px 0 10px",
  fontSize: "42px",
  lineHeight: 1.05,
  fontWeight: 700,
  color: "#2B2D2F",
};

const heroTextStyle: CSSProperties = {
  margin: 0,
  maxWidth: "760px",
  fontSize: "15px",
  lineHeight: 1.7,
  color: "#555555",
};

const kpiGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "16px",
  marginBottom: "20px",
};

const sectionCardStyle: CSSProperties = {
  background: "#ffffff",
  border: "1px solid #e7dfd8",
  borderRadius: "24px",
  padding: "20px",
  boxShadow: "0 12px 30px rgba(43,45,47,0.05)",
};

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "28px",
  color: "#2B2D2F",
};

const newTaskGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: "12px",
  alignItems: "end",
};

const filtersGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: "12px",
  marginBottom: "16px",
};

const listHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-end",
  gap: "16px",
  flexWrap: "wrap",
  marginBottom: "16px",
};

const kpiCardStyle: CSSProperties = {
  background: "#ffffff",
  border: "1px solid #e7dfd8",
  borderRadius: "20px",
  padding: "18px 20px",
  boxShadow: "0 10px 24px rgba(43,45,47,0.04)",
};

const kpiLabelStyle: CSSProperties = {
  margin: 0,
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "#017A92",
};

const kpiValueStyle: CSSProperties = {
  margin: "10px 0 0",
  fontSize: "34px",
  lineHeight: 1,
  fontWeight: 700,
  color: "#2B2D2F",
};

const topBadgeStyle: CSSProperties = {
  background: "#f7fbfc",
  border: "1px solid #d8e8ec",
  borderRadius: "16px",
  padding: "12px 16px",
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  minWidth: "130px",
};

const topBadgeLabelStyle: CSSProperties = {
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  color: "#017A92",
  fontWeight: 700,
};

const topBadgeValueStyle: CSSProperties = {
  fontSize: "22px",
  color: "#2B2D2F",
};

const labelStyle: CSSProperties = {
  display: "block",
  marginBottom: "8px",
  fontSize: "12px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "#6b625c",
};

const miniLabelStyle: CSSProperties = {
  display: "block",
  marginBottom: "6px",
  fontSize: "10px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "#6b625c",
};

const inputStyle: CSSProperties = {
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

const textareaStyle: CSSProperties = {
  width: "100%",
  minHeight: "92px",
  boxSizing: "border-box",
  padding: "12px 14px",
  borderRadius: "14px",
  border: "1px solid #d8d0c8",
  background: "#fcfbf9",
  color: "#2B2D2F",
  fontSize: "14px",
  outline: "none",
  resize: "vertical",
  fontFamily: "inherit",
};

const inputStyleCompact: CSSProperties = {
  boxSizing: "border-box",
  padding: "8px 10px",
  borderRadius: "10px",
  border: "1px solid #d8d0c8",
  background: "#fcfbf9",
  color: "#2B2D2F",
  fontSize: "12px",
  outline: "none",
};

const inputStyleCompactFull: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  borderRadius: "10px",
  border: "1px solid #d8d0c8",
  background: "#fcfbf9",
  color: "#2B2D2F",
  fontSize: "12px",
  outline: "none",
};

const selectCompactStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "10px",
  border: "1px solid #d8d0c8",
  background: "#ffffff",
  color: "#2B2D2F",
  fontSize: "11px",
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
  minWidth: "96px",
};

const primaryButtonStyle: CSSProperties = {
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

const secondaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: "14px",
  border: "1px solid #d8d0c8",
  background: "#ffffff",
  color: "#2B2D2F",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryButtonCompactStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "10px",
  border: "1px solid #d8d0c8",
  background: "#ffffff",
  color: "#2B2D2F",
  fontSize: "11px",
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const trackingButtonCompactStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "10px",
  border: "1px solid #017A92",
  background: "#f6fbfc",
  color: "#017A92",
  fontSize: "11px",
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const trackingButtonTinyStyle: CSSProperties = {
  padding: "6px 8px",
  borderRadius: "10px",
  border: "1px solid #017A92",
  background: "#f6fbfc",
  color: "#017A92",
  fontSize: "10px",
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const dangerButtonCompactStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "10px",
  border: "1px solid #d8aaaa",
  background: "#f8eaea",
  color: "#993333",
  fontSize: "11px",
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const ghostDangerButtonCompactStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "10px",
  border: "1px solid #ecd0d0",
  background: "#ffffff",
  color: "#993333",
  fontSize: "11px",
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const pillStyleCompact: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 8px",
  borderRadius: "999px",
  fontSize: "10px",
  fontWeight: 700,
};

const metaLabelStyle: CSSProperties = {
  display: "block",
  marginBottom: "2px",
  fontSize: "9px",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  color: "#7a726c",
  fontWeight: 700,
};

const metaValueCompactStyle: CSSProperties = {
  fontSize: "12px",
  color: "#2B2D2F",
  fontWeight: 600,
};

const expandButtonStyle: CSSProperties = {
  width: "36px",
  height: "36px",
  borderRadius: "10px",
  border: "1px solid #d8d0c8",
  background: "#ffffff",
  color: "#2B2D2F",
  fontSize: "14px",
  fontWeight: 700,
  cursor: "pointer",
};

const emptyStateStyle: CSSProperties = {
  background: "#fcfbf9",
  border: "1px solid #ebe4dc",
  borderRadius: "14px",
  padding: "16px",
  color: "#666666",
  fontSize: "14px",
};

const historyEmptyStateStyle: CSSProperties = {
  background: "#fcfbf9",
  border: "1px solid #ebe4dc",
  borderRadius: "12px",
  padding: "12px",
  color: "#666666",
  fontSize: "12px",
};

const historyRowStyle: CSSProperties = {
  background: "#fcfbf9",
  border: "1px solid #ebe4dc",
  borderRadius: "12px",
  padding: "10px 12px",
};

const historyTopRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
  flexWrap: "wrap",
};

const historyToggleButtonStyle: CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  padding: "10px 12px",
  borderRadius: "12px",
  border: "1px solid #e2d9d1",
  background: "#fcfbf9",
  color: "#2B2D2F",
  fontSize: "12px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  cursor: "pointer",
};

const subsectionHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
  marginBottom: "10px",
  fontSize: "12px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "#6b625c",
};

const subtaskAssignSelectStyle: CSSProperties = {
  padding: "6px 8px",
  borderRadius: "10px",
  border: "1px solid #d8d0c8",
  background: "#ffffff",
  color: "#2B2D2F",
  fontSize: "11px",
  fontWeight: 600,
  cursor: "pointer",
  width: "100%",
  maxWidth: "180px",
};

const modalOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(43,45,47,0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "20px",
  zIndex: 50,
};

const modalCardStyle: CSSProperties = {
  width: "100%",
  maxWidth: "560px",
  background: "#ffffff",
  border: "1px solid #e7dfd8",
  borderRadius: "24px",
  padding: "22px",
  boxShadow: "0 24px 60px rgba(43,45,47,0.22)",
};

const modalEyebrowStyle: CSSProperties = {
  margin: 0,
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "#017A92",
};

const modalTitleStyle: CSSProperties = {
  margin: "6px 0 6px",
  fontSize: "30px",
  color: "#2B2D2F",
};

const modalDescriptionStyle: CSSProperties = {
  margin: 0,
  fontSize: "13px",
  lineHeight: 1.5,
  color: "#666666",
};

const modalActionsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "10px",
  marginTop: "18px",
};

const taskRowCardStyle = (
  priority: TaskPriority,
  isSaving: boolean,
  isTargetTask = false
): CSSProperties => ({
  background: isTargetTask ? "#f6fbfc" : "#fcfbf9",
  border: isTargetTask ? "1px solid #017A92" : "1px solid #ebe4dc",
  borderLeft: priority === "Alta" ? "4px solid #d64545" : "4px solid #017A92",
  borderRadius: "14px",
  boxShadow: isTargetTask
    ? "0 10px 24px rgba(1,122,146,0.14)"
    : "0 4px 10px rgba(43,45,47,0.03)",
  overflow: "hidden",
  opacity: isSaving ? 0.72 : 1,
});

const taskRowHeaderStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: "8px",
  padding: "12px",
};

const taskTitleStyle: CSSProperties = {
  fontSize: "15px",
  fontWeight: 700,
  color: "#2B2D2F",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const taskMetaInlineStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
  marginTop: "4px",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  color: "#8a8178",
};

const rowTextStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 600,
  color: "#2B2D2F",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const expandedPanelStyle: CSSProperties = {
  borderTop: "1px solid #ebe4dc",
  background: "#ffffff",
  padding: "14px 16px 16px",
};

const detailsGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: "10px",
  marginBottom: "14px",
};

const actionsRowStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
  alignItems: "center",
  marginBottom: "16px",
};

const newSubtaskGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: "8px",
  alignItems: "end",
  marginBottom: "10px",
};

const latePillStyle: CSSProperties = {
  ...pillStyleCompact,
  background: "#f8eaea",
  color: "#993333",
  border: "1px solid #d9a7a7",
};

const archivedPillStyle: CSSProperties = {
  ...pillStyleCompact,
  background: "#f1f5f9",
  color: "#475569",
  border: "1px solid #cbd5e1",
};

const subtaskRowStyleHighlighted = (isHighlighted: boolean): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: "12px",
  alignItems: "center",
  background: isHighlighted ? "#f0f9ff" : "#fcfbf9",
  border: isHighlighted ? "1px solid #017A92" : "1px solid #ebe4dc",
  borderRadius: "12px",
  padding: "10px 12px",
  boxShadow: isHighlighted ? "0 8px 18px rgba(1,122,146,0.12)" : "none",
});

const subtaskTitleStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 700,
  color: "#2B2D2F",
  display: "flex",
  alignItems: "center",
  gap: "6px",
  flexWrap: "wrap",
};

const subtaskRightStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  flexWrap: "wrap",
  minWidth: 0,
  justifyContent: "flex-start",
};

const avatarWrapStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  minWidth: "110px",
  justifyContent: "flex-end",
};

const avatarImgStyle: CSSProperties = {
  width: "24px",
  height: "24px",
  borderRadius: "50%",
  objectFit: "cover",
  border: "1px solid #e2d9d1",
};

const avatarFallbackStyle = (hasOwner?: string | null): CSSProperties => ({
  width: "24px",
  height: "24px",
  borderRadius: "50%",
  background: hasOwner ? "#e7ecef" : "#efefef",
  color: "#2B2D2F",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "10px",
  fontWeight: 700,
  border: "1px solid #e2d9d1",
});

const avatarNameStyle: CSSProperties = {
  fontSize: "11px",
  fontWeight: 600,
  color: "#5e5751",
  maxWidth: "86px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

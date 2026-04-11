export const trackingAreas = [
  "consulenza",
  "projects",
  "commerciale",
  "sales-marketing",
  "amministrazione-finance",
] as const;

export type TrackingArea = (typeof trackingAreas)[number];

export const trackingOperators = [
  "Pierangelo",
  "Gianluca",
  "Alessandro",
  "Alessandra",
  "Giorgia",
] as const;

export type TrackingOperator = (typeof trackingOperators)[number];

export const consulenzaReferences = [
  "Villa Neviera",
  "Palazzo Arco Cadura",
  "Palazzo Rollo",
  "San Giorgio Resort",
  "Montecallini",
];

export const projectReferences = [
  "Puglia Destination Off",
  "Formazione",
];

export const commercialeReferences = [
  "Sviluppo commerciale",
  "Nuovi contatti",
  "Partnership",
];

export const salesMarketingReferences = [
  "Tour operator",
  "Agenzie viaggio",
  "Social media",
  "Contenuti",
  "PR & Networking",
];

export const adminFinanceReferences = [
  "Amministrazione generale",
  "Controllo costi",
  "Reportistica",
  "Fatturazione",
  "Budget",
];

export const referenceMap: Record<TrackingArea, string[]> = {
  consulenza: consulenzaReferences,
  projects: projectReferences,
  commerciale: commercialeReferences,
  "sales-marketing": salesMarketingReferences,
  "amministrazione-finance": adminFinanceReferences,
};

export const trackingActivities = [
  "call",
  "email",
  "whatsapp",
  "meeting",
  "follow up",
  "analisi",
  "reportistica",
  "amministrazione",
  "organizzazione",
  "coordinamento",
] as const;

export type TrackingActivity = (typeof trackingActivities)[number];

export type TrackingEditHistoryItem = {
  id: string;
  changedAt: string;
  field: "macroArea" | "referenceName" | "operator" | "date" | "activity" | "minutes" | "notes" | "taskId";
  previousValue: string;
  nextValue: string;
};

export type TrackingEntry = {
  id: string;
  macroArea: TrackingArea;
  referenceName: string;
  date: string;
  operator: TrackingOperator;
  activity: TrackingActivity;
  minutes: number;
  notes?: string;
  taskId?: string;
  createdAt: string;
  editHistory?: TrackingEditHistoryItem[];
};

export const mockTrackingEntries: TrackingEntry[] = [
  {
    id: "1",
    macroArea: "consulenza",
    referenceName: "Palazzo Rollo",
    date: "2026-04-11",
    operator: "Pierangelo",
    activity: "call",
    minutes: 25,
    notes: "Call operativa con la struttura",
    createdAt: "2026-04-11T09:00:00.000Z",
    editHistory: [],
  },
  {
    id: "2",
    macroArea: "projects",
    referenceName: "Puglia Destination Off",
    date: "2026-04-11",
    operator: "Pierangelo",
    activity: "organizzazione",
    minutes: 50,
    notes: "Allineamento attività progetto",
    createdAt: "2026-04-11T10:00:00.000Z",
    editHistory: [],
  },
  {
    id: "3",
    macroArea: "sales-marketing",
    referenceName: "Tour operator",
    date: "2026-04-10",
    operator: "Giorgia",
    activity: "meeting",
    minutes: 40,
    notes: "Incontro commerciale",
    createdAt: "2026-04-10T15:30:00.000Z",
    editHistory: [],
  },
];
export const trackingAreas = [
  "consulenza",
  "projects",
  "commerciale",
  "sales-marketing",
  "amministrazione-finance",
  "it",
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
  "Sviluppo piattaforma",
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

export const itReferences = [
  "Sviluppo piattaforma",
  "Bug fixing",
  "Testing interno",
  "Integrazione Supabase",
  "Dashboard",
];

export const referenceMap: Record<TrackingArea, string[]> = {
  consulenza: consulenzaReferences,
  projects: projectReferences,
  commerciale: commercialeReferences,
  "sales-marketing": salesMarketingReferences,
  "amministrazione-finance": adminFinanceReferences,
  it: itReferences,
};

export const activityMap: Record<TrackingArea, string[]> = {
  consulenza: [
    "call",
    "email",
    "whatsapp",
    "meeting",
    "follow up",
    "analisi",
    "reportistica",
    "coordinamento",
    "on-boarding",
  ],
  projects: [
    "meeting",
    "analisi",
    "organizzazione",
    "coordinamento",
    "reportistica",
    "sviluppo",
    "testing",
  ],
  commerciale: [
    "call",
    "email",
    "whatsapp",
    "meeting",
    "follow up",
    "analisi",
    "coordinamento",
  ],
  "sales-marketing": [
    "call",
    "email",
    "meeting",
    "follow up",
    "analisi",
    "social media",
    "contenuti",
    "PR & networking",
    "coordinamento",
  ],
  "amministrazione-finance": [
    "email",
    "meeting",
    "analisi",
    "reportistica",
    "amministrazione",
    "coordinamento",
  ],
  it: [
    "analisi",
    "sviluppo",
    "testing",
    "meeting",
    "coordinamento",
    "reportistica",
  ],
};

export const trackingActivities = Array.from(
  new Set(Object.values(activityMap).flat())
) as string[];

export type TrackingActivity = (typeof trackingActivities)[number];

export type TrackingEditHistoryField =
  | "macroArea"
  | "referenceName"
  | "operator"
  | "date"
  | "activity"
  | "minutes"
  | "notes"
  | "taskId"
  | "subtaskId"
  | "operatorId"
  | "clientId";

export type TrackingEditHistoryItem = {
  id: string;
  changedAt: string;
  field: TrackingEditHistoryField;
  previousValue: string;
  nextValue: string;
  changedBy?: string;
};

export type TrackingEntry = {
  id: string;
  macroArea: TrackingArea;
  referenceName: string;
  date: string;
  operator: TrackingOperator;
  operatorId?: string;
  clientId?: string;
  activity: TrackingActivity;
  minutes: number;
  notes?: string;
  taskId?: string;
  subtaskId?: string;
  createdAt: string;
  editHistory?: TrackingEditHistoryItem[];
};
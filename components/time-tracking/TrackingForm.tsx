"use client";

import { useEffect, useMemo, useState } from "react";
import { AppCard } from "@/components/ui/AppCard";
import { AppButton } from "@/components/ui/AppButton";
import { AppInput } from "@/components/ui/AppInput";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { supabase } from "@/lib/supabaseClient";
import {
  activityMap,
  referenceMap,
  trackingAreas,
  TrackingArea,
  TrackingEntry,
} from "@/lib/tracking";

type SelectOption = {
  id: string;
  label: string;
};

type TrackingFormProps = {
  onAddEntry: (entry: TrackingEntry) => void;
  operators: SelectOption[];
  clientReferences: SelectOption[];
};

type FormState = {
  macroArea: TrackingArea;
  referenceName: string;
  operator: string;
  date: string;
  activity: string;
  minutes: string;
  notes: string;
  taskId: string;
  subtaskId: string;
};

const selectClassName =
  "h-11 w-full rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 text-sm text-[#2B2D2F] outline-none transition focus:border-[#017A92] focus:bg-white";

export default function TrackingForm({
  onAddEntry,
  operators,
  clientReferences,
}: TrackingFormProps) {
  const [form, setForm] = useState<FormState>({
    macroArea: "consulenza",
    referenceName: "",
    operator: "",
    date: new Date().toISOString().split("T")[0],
    activity: "",
    minutes: "",
    notes: "",
    taskId: "",
    subtaskId: "",
  });

  const [isSaving, setIsSaving] = useState(false);

  const availableReferences = useMemo(() => {
    if (form.macroArea === "consulenza") {
      return clientReferences.length > 0
        ? clientReferences.map((item) => item.label)
        : referenceMap.consulenza;
    }

    return referenceMap[form.macroArea] ?? [];
  }, [form.macroArea, clientReferences]);

  const availableActivities = useMemo(() => {
    return activityMap[form.macroArea] ?? [];
  }, [form.macroArea]);

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      referenceName: "",
      activity: "",
    }));
  }, [form.macroArea]);

  function handleChange<K extends keyof FormState>(
    field: K,
    value: FormState[K]
  ) {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (isSaving) return;

    if (
      !form.referenceName ||
      !form.operator ||
      !form.activity ||
      !form.minutes.trim()
    ) {
      return;
    }

    const parsedMinutes = Number(form.minutes);

    if (Number.isNaN(parsedMinutes) || parsedMinutes <= 0) {
      return;
    }

    const operatorMatch = operators.find(
      (item) => item.label === form.operator
    );

    const clientMatch =
      form.macroArea === "consulenza"
        ? clientReferences.find((item) => item.label === form.referenceName)
        : undefined;

    const payload = {
      macroarea: form.macroArea,
      riferimento: form.referenceName,
      operatore_id: operatorMatch?.id || null,
      data: form.date,
      attivita: form.activity,
      minuti: parsedMinutes,
      notes: form.notes.trim() || null,
      task_id: form.taskId.trim() || null,
      subtask_id: form.subtaskId.trim() || null,
      client_id: clientMatch?.id || null,
    };

    setIsSaving(true);

    const { data, error } = await supabase
      .from("tracking")
      .insert(payload)
      .select("*")
      .single();

    setIsSaving(false);

    if (error || !data) {
      console.error("Errore inserimento tracking:", error?.message);
      return;
    }

    const newEntry: TrackingEntry = {
      id: data.id,
      macroArea: form.macroArea,
      referenceName: form.referenceName,
      operator: form.operator as TrackingEntry["operator"],
      operatorId: operatorMatch?.id,
      clientId: clientMatch?.id,
      date: form.date,
      activity: form.activity as TrackingEntry["activity"],
      minutes: parsedMinutes,
      notes: form.notes.trim() || undefined,
      taskId: form.taskId.trim() || undefined,
      subtaskId: form.subtaskId.trim() || undefined,
      createdAt: data.created_at || new Date().toISOString(),
      editHistory: [],
    };

    onAddEntry(newEntry);

    setForm((prev) => ({
      ...prev,
      referenceName: "",
      activity: "",
      minutes: "",
      notes: "",
      taskId: "",
      subtaskId: "",
    }));
  }

  return (
    <AppCard className="rounded-[24px] p-7">
      <SectionHeader
        title="Nuova registrazione"
        description="Inserisci una nuova attività e assegnala subito al riferimento operativo."
        className="mb-6"
      />

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_1.2fr_1fr]">
          <div>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              Macroarea
            </label>
            <select
              value={form.macroArea}
              onChange={(e) =>
                handleChange("macroArea", e.target.value as TrackingArea)
              }
              className={selectClassName}
            >
              {trackingAreas.map((area) => (
                <option key={area} value={area}>
                  {formatMacroArea(area)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              Riferimento
            </label>
            <select
              value={form.referenceName}
              onChange={(e) => handleChange("referenceName", e.target.value)}
              className={selectClassName}
            >
              <option value="">Seleziona riferimento</option>
              {availableReferences.map((reference) => (
                <option key={reference} value={reference}>
                  {reference}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              Operatore
            </label>
            <select
              value={form.operator}
              onChange={(e) => handleChange("operator", e.target.value)}
              className={selectClassName}
            >
              <option value="">Seleziona operatore</option>
              {operators.map((operator) => (
                <option key={operator.id} value={operator.label}>
                  {operator.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr_180px_auto] xl:items-end">
          <div>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              Data
            </label>
            <AppInput
              type="date"
              value={form.date}
              onChange={(e) => handleChange("date", e.target.value)}
            />
          </div>

          <div>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              Attività
            </label>
            <select
              value={form.activity}
              onChange={(e) => handleChange("activity", e.target.value)}
              className={selectClassName}
            >
              <option value="">Seleziona attività</option>
              {availableActivities.map((activity) => (
                <option key={activity} value={activity}>
                  {formatActivity(activity)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              Minuti
            </label>
            <AppInput
              type="number"
              placeholder="Es. 30"
              value={form.minutes}
              onChange={(e) => handleChange("minutes", e.target.value)}
            />
          </div>

          <div className="xl:pb-[1px]">
            <AppButton>
              {isSaving ? "Salvataggio..." : "Aggiungi"}
            </AppButton>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr_1fr]">
          <div>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              Note
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => handleChange("notes", e.target.value)}
              rows={3}
              placeholder="Descrizione rapida dell’attività svolta"
              className="w-full rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 py-3 text-sm text-[#2B2D2F] outline-none transition placeholder:text-[#8b8f94] focus:border-[#017A92] focus:bg-white"
            />
          </div>

          <div>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              Task ID
            </label>
            <AppInput
              placeholder="Facoltativo"
              value={form.taskId}
              onChange={(e) => handleChange("taskId", e.target.value)}
            />
          </div>

          <div>
            <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              Subtask ID
            </label>
            <AppInput
              placeholder="Facoltativo"
              value={form.subtaskId}
              onChange={(e) => handleChange("subtaskId", e.target.value)}
            />
          </div>
        </div>
      </form>
    </AppCard>
  );
}

function formatMacroArea(value: string) {
  switch (value) {
    case "consulenza":
      return "Consulenza";
    case "projects":
      return "Projects";
    case "commerciale":
      return "Commerciale";
    case "sales-marketing":
      return "Sales & Marketing";
    case "amministrazione-finance":
      return "Amministrazione & Finance";
    case "it":
      return "IT";
    default:
      return value;
  }
}

function formatActivity(value: string) {
  switch (value) {
    case "call":
      return "Call";
    case "email":
      return "Email";
    case "whatsapp":
      return "WhatsApp";
    case "meeting":
      return "Meeting";
    case "follow up":
      return "Follow up";
    case "analisi":
      return "Analisi";
    case "reportistica":
      return "Reportistica";
    case "amministrazione":
      return "Amministrazione";
    case "organizzazione":
      return "Organizzazione";
    case "coordinamento":
      return "Coordinamento";
    case "on-boarding":
      return "On-boarding";
    case "sviluppo":
      return "Sviluppo";
    case "testing":
      return "Testing";
    case "social media":
      return "Social media";
    case "contenuti":
      return "Contenuti";
    case "PR & networking":
      return "PR & Networking";
    default:
      return value;
  }
}
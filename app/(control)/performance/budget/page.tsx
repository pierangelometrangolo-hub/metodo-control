"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { PageHeader } from "@/components/ui/PageHeader";
import { AppCard } from "@/components/ui/AppCard";
import { AppButton } from "@/components/ui/AppButton";
import { AppInput } from "@/components/ui/AppInput";
import { AppBadge } from "@/components/ui/AppBadge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/lib/supabaseClient";
import { getUserLevelRank } from "@/lib/permissions";
import { adr as adrOf, occupancy, revPar, formatCurrency, formatNumber, formatPercent } from "@/lib/performanceMetrics";
import {
  BUDGET_LEVELS,
  BudgetLevel,
  BudgetRow,
  MONTH_NAMES_IT,
  METRIC_ORDER,
  MetricKey,
  MetricSet,
  budgetLevelLabels,
  computeRevenue,
  daysInMonth,
  metricLabels,
  proposedRoomNightsAvailable,
} from "@/lib/budgetMetrics";

const SENIOR_RANK = 2;

type StructureOption = { id: string; name: string; n_rooms: number | null };

type MonthForm = { adr: string; rns: string };

type OpeningOverride = { id: string; daysOpen: number };

type ActualMetrics = { revenue: number | null; rns: number | null; rnav: number | null };

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

// Un valore storico per un dato anno/mese e' "OTB" (On The Books, non
// ancora consuntivo chiuso) quando quell'anno e' l'anno reale corrente e
// il mese non e' ancora terminato - fn_month_snapshot_asof restituisce in
// quel caso lo stato delle prenotazioni ad oggi, non il risultato finale.
// Per anni passati (< anno corrente) e' sempre consuntivo chiuso.
function isOtbYearMonth(year: number, month: number): boolean {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  return year === currentYear && month >= currentMonth;
}

// Riga "attiva" per (mese, livello): una bozza/proposta in corso (draft o
// pending) ha priorita' su un budget gia' confermato - e' quella su cui si
// continua a lavorare. Se non c'e' nessuna riga non confermata, la riga
// confermata resta come base di partenza per una NUOVA proposta (mai un
// update distruttivo su una riga confermata).
function pickActiveRow(rows: BudgetRow[]): BudgetRow | null {
  const inProgress = rows
    .filter((r) => r.status === "draft" || r.status === "pending")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (inProgress) return inProgress;

  const confirmed = rows
    .filter((r) => r.status === "confirmed")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return confirmed || null;
}

function metricsFromBudgetInputs(adr: number | null, rns: number | null, rnav: number | null): MetricSet {
  const revenue = computeRevenue(adr, rns);
  return { adr, rns, rnav, revenue, revpar: revPar(revenue, rnav), occ: occupancy(rns, rnav) };
}

function metricsFromActual(actual: ActualMetrics | null): MetricSet {
  if (!actual) return { adr: null, rns: null, rnav: null, revenue: null, revpar: null, occ: null };
  const { revenue, rns, rnav } = actual;
  return { adr: adrOf(revenue, rns), rns, rnav, revenue, revpar: revPar(revenue, rnav), occ: occupancy(rns, rnav) };
}

// Converte un valore di input testuale (possibilmente assente, es. prima
// che il form sia stato popolato dal caricamento dati) in numero o null.
// Mai un accesso diretto a form[m].adr fuori da un optional chaining
// completo - un ternario con "?." solo sulla condizione e non sul ramo
// valore e' un bug facile da reintrodurre, centralizzato qui una volta
// sola.
function parseFormNumber(raw: string | undefined): number | null {
  const trimmed = (raw ?? "").trim();
  return trimmed === "" ? null : Number(trimmed);
}

function formatMetric(key: MetricKey, value: number | null): string {
  if (key === "adr" || key === "revpar" || key === "revenue") return formatCurrency(value);
  if (key === "occ") return formatPercent(value);
  return formatNumber(value);
}

export default function BudgetPage() {
  const router = useRouter();

  const [accessState, setAccessState] = useState<"checking" | "granted" | "denied">("checking");
  const [canManage, setCanManage] = useState(false);
  const [structures, setStructures] = useState<StructureOption[]>([]);
  const [selectedStructureId, setSelectedStructureId] = useState("");
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear() + 1);
  const [selectedLevel, setSelectedLevel] = useState<BudgetLevel>("realistico");

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionMessage, setActionMessage] = useState("");

  // Righe attive per livello/mese, cosi' come lette dal DB (non editate).
  const [budgetsByLevel, setBudgetsByLevel] = useState<Record<BudgetLevel, Record<number, BudgetRow | null>>>({
    minimo: {},
    realistico: {},
    sfidante: {},
  });

  // Form editabile: solo il livello attualmente selezionato. RN.AV e'
  // condiviso tra i 3 livelli (fatto strutturale, non di scenario), tenuto
  // separato dal form per-livello.
  const [form, setForm] = useState<Record<number, MonthForm>>({});
  const [rnavByMonth, setRnavByMonth] = useState<Record<number, string>>({});
  const [openingOverrides, setOpeningOverrides] = useState<Record<number, OpeningOverride | null>>({});

  const [lastYearByMonth, setLastYearByMonth] = useState<Record<number, ActualMetrics | null>>({});
  const [bestByMonth, setBestByMonth] = useState<Record<number, { metrics: ActualMetrics; year: number } | null>>({});
  const [structuresWithoutHistory, setStructuresWithoutHistory] = useState<Set<string>>(new Set());

  const [expandedColumns, setExpandedColumns] = useState<Set<MetricKey>>(new Set());
  const [dirty, setDirty] = useState(false);

  const [pendingGroups, setPendingGroups] = useState<
    { structureId: string; structureName: string; seasonYear: number; rows: BudgetRow[]; createdByName: string }[]
  >([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [reviewBusyKey, setReviewBusyKey] = useState<string | null>(null);

  useEffect(() => {
    void checkAccess();
  }, []);

  async function checkAccess() {
    const rank = await getUserLevelRank();

    if (rank === null || rank < SENIOR_RANK) {
      setAccessState("denied");
      router.replace("/dashboard");
      return;
    }

    setCanManage(true);
    setAccessState("granted");

    const {
      data: { user },
    } = await supabase.auth.getUser();
    setCurrentUserId(user?.id ?? null);

    const { data: structs, error } = await supabase.from("structures").select("id, name, n_rooms").order("name");
    if (error) {
      setLoadError(error.message);
      return;
    }
    setStructures((structs as StructureOption[]) || []);
    if (structs && structs.length > 0) setSelectedStructureId(structs[0].id);
  }

  const selectedStructure = useMemo(
    () => structures.find((s) => s.id === selectedStructureId) || null,
    [structures, selectedStructureId]
  );

  useEffect(() => {
    if (accessState === "granted" && selectedStructureId) void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessState, selectedStructureId, selectedYear]);

  useEffect(() => {
    if (accessState === "granted") void loadPendingGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessState]);

  function confirmDiscardIfDirty(): boolean {
    if (!dirty) return true;
    return window.confirm("Ci sono modifiche non salvate su questo livello: continuare e scartarle?");
  }

  async function loadAll() {
    setLoading(true);
    setLoadError("");
    setActionMessage("");

    const [budgetsRes, openingRes] = await Promise.all([
      supabase
        .from("budgets")
        .select("*")
        .eq("structure_id", selectedStructureId)
        .eq("season_year", selectedYear),
      supabase
        .from("structure_opening_calendar")
        .select("id, month, days_open")
        .eq("structure_id", selectedStructureId)
        .eq("season_year", selectedYear),
    ]);

    if (budgetsRes.error) setLoadError(budgetsRes.error.message);
    if (openingRes.error) setLoadError((prev) => prev || openingRes.error!.message);

    const allRows = (budgetsRes.data as BudgetRow[]) || [];
    const byLevel: Record<BudgetLevel, Record<number, BudgetRow | null>> = { minimo: {}, realistico: {}, sfidante: {} };

    for (const level of BUDGET_LEVELS) {
      for (let m = 1; m <= 12; m++) {
        const rowsForCell = allRows.filter((r) => r.level === level && r.month === m);
        byLevel[level][m] = pickActiveRow(rowsForCell);
      }
    }
    setBudgetsByLevel(byLevel);

    const overrides: Record<number, OpeningOverride | null> = {};
    for (let m = 1; m <= 12; m++) overrides[m] = null;
    ((openingRes.data as { id: string; month: number; days_open: number }[]) || []).forEach((r) => {
      overrides[r.month] = { id: r.id, daysOpen: r.days_open };
    });
    setOpeningOverrides(overrides);

    // Form editabile per il livello selezionato + RN.AV condiviso.
    const nRooms = structures.find((s) => s.id === selectedStructureId)?.n_rooms ?? 0;
    const nextForm: Record<number, MonthForm> = {};
    const nextRnav: Record<number, string> = {};
    for (let m = 1; m <= 12; m++) {
      const row = byLevel[selectedLevel][m];
      nextForm[m] = { adr: row?.adr != null ? String(row.adr) : "", rns: row?.room_nights_sold_target != null ? String(row.room_nights_sold_target) : "" };
      const override = overrides[m];
      const rnavDefault = proposedRoomNightsAvailable(nRooms, override ? override.daysOpen : daysInMonth(selectedYear, m));
      nextRnav[m] = String(row?.room_nights_available ?? rnavDefault);
    }
    setForm(nextForm);
    setRnavByMonth(nextRnav);
    setDirty(false);

    setLoading(false);

    void loadComparisonData();
  }

  // Ricostruisce il form (e RN.AV) quando cambia il livello selezionato,
  // senza rifare le query - i dati dei 3 livelli sono gia' in memoria.
  useEffect(() => {
    if (!selectedStructureId) return;
    const nRooms = structures.find((s) => s.id === selectedStructureId)?.n_rooms ?? 0;
    const nextForm: Record<number, MonthForm> = {};
    const nextRnav: Record<number, string> = {};
    for (let m = 1; m <= 12; m++) {
      const row = budgetsByLevel[selectedLevel][m];
      nextForm[m] = {
        adr: row?.adr != null ? String(row.adr) : "",
        rns: row?.room_nights_sold_target != null ? String(row.room_nights_sold_target) : "",
      };
      const override = openingOverrides[m];
      const rnavDefault = proposedRoomNightsAvailable(nRooms, override ? override.daysOpen : daysInMonth(selectedYear, m));
      nextRnav[m] = String(row?.room_nights_available ?? rnavDefault);
    }
    setForm(nextForm);
    setRnavByMonth(nextRnav);
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLevel]);

  async function loadComparisonData() {
    if (!selectedStructureId) return;

    const lookbackYears = [selectedYear - 1, selectedYear - 2, selectedYear - 3, selectedYear - 4, selectedYear - 5];

    const calls: PromiseLike<{ year: number; month: number; data: unknown }>[] = [];
    for (const year of lookbackYears) {
      for (let m = 1; m <= 12; m++) {
        const cutoff = year < Number(todayString().slice(0, 4)) ? `${year}-12-31` : todayString();
        calls.push(
          supabase
            .rpc("fn_month_snapshot_asof", {
              p_structure_ids: [selectedStructureId],
              p_period_year: year,
              p_period_month: m,
              p_cutoff_date: cutoff,
            })
            .then((res) => ({ year, month: m, data: res.data as unknown }))
        );
      }
    }

    const results = await Promise.all(calls);

    const byYearMonth = new Map<string, ActualMetrics>();
    results.forEach(({ year, month, data }) => {
      const row = (data as { revenue_total: number; rooms_sold: number; rooms_available: number }[] | null)?.[0];
      if (row) {
        byYearMonth.set(`${year}-${month}`, {
          revenue: Number(row.revenue_total),
          rns: Number(row.rooms_sold),
          rnav: Number(row.rooms_available),
        });
      }
    });

    const nextLastYear: Record<number, ActualMetrics | null> = {};
    const nextBest: Record<number, { metrics: ActualMetrics; year: number } | null> = {};
    let anyHistory = false;

    for (let m = 1; m <= 12; m++) {
      nextLastYear[m] = byYearMonth.get(`${selectedYear - 1}-${m}`) || null;

      let best: { metrics: ActualMetrics; year: number } | null = null;
      for (const year of lookbackYears) {
        const candidate = byYearMonth.get(`${year}-${m}`);
        if (candidate && candidate.revenue !== null) {
          if (!best || (best.metrics.revenue ?? -Infinity) < candidate.revenue) {
            best = { metrics: candidate, year };
          }
        }
      }
      nextBest[m] = best;
      if (nextLastYear[m] || best) anyHistory = true;
    }

    setLastYearByMonth(nextLastYear);
    setBestByMonth(nextBest);

    setStructuresWithoutHistory((prev) => {
      const next = new Set(prev);
      const structureName = structures.find((s) => s.id === selectedStructureId)?.name || selectedStructureId;
      if (anyHistory) next.delete(structureName);
      else next.add(structureName);
      return next;
    });
  }

  async function loadPendingGroups() {
    const { data, error } = await supabase.from("budgets").select("*").eq("status", "pending");
    if (error) return;

    const rows = (data as BudgetRow[]) || [];
    const byKey = new Map<string, BudgetRow[]>();
    rows.forEach((r) => {
      const key = `${r.structure_id}::${r.season_year}`;
      const list = byKey.get(key) || [];
      list.push(r);
      byKey.set(key, list);
    });

    const structIds = [...new Set(rows.map((r) => r.structure_id))];
    const creatorIds = [...new Set(rows.map((r) => r.created_by))];

    const [structRes, profileRes] = await Promise.all([
      structIds.length > 0
        ? supabase.from("structures").select("id, name").in("id", structIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      creatorIds.length > 0
        ? supabase.from("profiles").select("id, nome, cognome").in("id", creatorIds)
        : Promise.resolve({ data: [] as { id: string; nome: string | null; cognome: string | null }[] }),
    ]);

    const structNameById = new Map((structRes.data || []).map((s) => [s.id, s.name]));
    const profileById = new Map((profileRes.data || []).map((p) => [p.id, p]));

    const groups = Array.from(byKey.entries()).map(([key, groupRows]) => {
      const [structureId, seasonYearStr] = key.split("::");
      const creator = profileById.get(groupRows[0].created_by);
      return {
        structureId,
        structureName: structNameById.get(structureId) || structureId,
        seasonYear: Number(seasonYearStr),
        rows: groupRows,
        createdByName: creator ? `${creator.nome || ""} ${creator.cognome || ""}`.trim() || "ND" : "ND",
      };
    });

    groups.sort((a, b) => a.structureName.localeCompare(b.structureName) || a.seasonYear - b.seasonYear);
    setPendingGroups(groups);
  }

  function updateField(month: number, field: "adr" | "rns", value: string) {
    setForm((prev) => ({ ...prev, [month]: { ...prev[month], [field]: value } }));
    setDirty(true);
  }

  function updateRnav(month: number, value: string) {
    setRnavByMonth((prev) => ({ ...prev, [month]: value }));
    setDirty(true);
  }

  function toggleColumn(key: MetricKey) {
    setExpandedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function persistOpeningOverrides() {
    const nRooms = selectedStructure?.n_rooms ?? 0;
    if (nRooms <= 0) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    for (let m = 1; m <= 12; m++) {
      const rnavValue = Number(rnavByMonth[m]);
      if (Number.isNaN(rnavValue)) continue;

      const defaultDays = daysInMonth(selectedYear, m);
      const defaultRnav = proposedRoomNightsAvailable(nRooms, defaultDays);
      const existing = openingOverrides[m];

      if (rnavValue === defaultRnav) {
        if (existing) {
          await supabase.from("structure_opening_calendar").delete().eq("id", existing.id);
        }
        continue;
      }

      const impliedDaysOpen = Math.max(0, Math.min(31, Math.round(rnavValue / nRooms)));

      await supabase.from("structure_opening_calendar").upsert(
        {
          structure_id: selectedStructureId,
          season_year: selectedYear,
          month: m,
          days_open: impliedDaysOpen,
          created_by: user.id,
        },
        { onConflict: "structure_id,season_year,month" }
      );
    }
  }

  async function saveDraft() {
    setSaving(true);
    setActionMessage("");
    setLoadError("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setLoadError("Sessione non valida, rieffettua il login");
      setSaving(false);
      return;
    }

    await persistOpeningOverrides();

    for (let m = 1; m <= 12; m++) {
      const adrVal = parseFormNumber(form[m]?.adr);
      const rnsVal = parseFormNumber(form[m]?.rns);
      const rnavVal = parseFormNumber(rnavByMonth[m]);

      if (adrVal === null && rnsVal === null) continue; // mese non compilato, nessuna riga

      const revenue = computeRevenue(adrVal, rnsVal);
      const occ = occupancy(rnsVal, rnavVal);

      const existingRow = budgetsByLevel[selectedLevel][m];
      const isEditableInPlace = existingRow && (existingRow.status === "draft" || existingRow.status === "pending");

      const payload = {
        structure_id: selectedStructureId,
        season_year: selectedYear,
        month: m,
        level: selectedLevel,
        adr: adrVal,
        room_nights_sold_target: rnsVal,
        room_nights_available: rnavVal,
        revenue_target: revenue,
        occupancy_pct_target: occ,
      };

      if (isEditableInPlace) {
        const { error } = await supabase.from("budgets").update(payload).eq("id", existingRow!.id);
        if (error) setLoadError(error.message);
      } else {
        const { error } = await supabase.from("budgets").insert({
          ...payload,
          status: "draft",
          valid_from: todayString(),
          created_by: user.id,
        });
        if (error) setLoadError(error.message);
      }
    }

    setSaving(false);
    setDirty(false);
    // loadAll() azzera actionMessage all'inizio (serve a ripulire un
    // eventuale messaggio del giro precedente quando si cambia struttura/
    // anno) - il messaggio di questo salvataggio va quindi impostato DOPO
    // il reload, altrimenti sparisce subito senza che nessuno lo veda.
    await loadAll();
    setActionMessage("Bozza salvata.");
  }

  async function submitForReview() {
    if (dirty) {
      const shouldSave = window.confirm(
        "Ci sono modifiche non salvate su questo livello: salvarle come bozza prima di sottomettere?"
      );
      if (shouldSave) await saveDraft();
    }

    setSubmitting(true);
    setActionMessage("");
    setLoadError("");

    const { data: draftRows, error: fetchError } = await supabase
      .from("budgets")
      .select("id")
      .eq("structure_id", selectedStructureId)
      .eq("season_year", selectedYear)
      .eq("status", "draft");

    if (fetchError) {
      setLoadError(fetchError.message);
      setSubmitting(false);
      return;
    }

    if (!draftRows || draftRows.length === 0) {
      setActionMessage("Nessuna bozza da sottomettere per questa struttura/anno.");
      setSubmitting(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("budgets")
      .update({ status: "pending" })
      .in(
        "id",
        draftRows.map((r) => r.id)
      );

    if (updateError) {
      setLoadError(updateError.message);
      setSubmitting(false);
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session?.access_token && selectedStructure) {
      await fetch("/api/notifications/send-budget-review", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          structureId: selectedStructureId,
          structureName: selectedStructure.name,
          seasonYear: selectedYear,
        }),
      }).catch(() => {});
    }

    setSubmitting(false);
    await loadAll();
    await loadPendingGroups();
    setActionMessage(`${draftRows.length} righe sottomesse per revisione. Notifica inviata ai master.`);
  }

  async function handleConfirmGroup(group: (typeof pendingGroups)[number]) {
    if (currentUserId && group.rows.every((r) => r.created_by === currentUserId)) {
      window.alert("Non puoi confermare un budget che hai proposto tu stesso.");
      return;
    }

    const key = `${group.structureId}::${group.seasonYear}`;
    setReviewBusyKey(key);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setReviewBusyKey(null);
      return;
    }

    const { error } = await supabase
      .from("budgets")
      .update({ status: "confirmed", confirmed_by: user.id, confirmed_at: new Date().toISOString() })
      .in(
        "id",
        group.rows.map((r) => r.id)
      )
      .neq("created_by", user.id);

    setReviewBusyKey(null);

    if (error) {
      setLoadError(error.message);
      return;
    }

    await loadPendingGroups();
    if (group.structureId === selectedStructureId && group.seasonYear === selectedYear) await loadAll();
  }

  async function handleRejectGroup(group: (typeof pendingGroups)[number]) {
    const key = `${group.structureId}::${group.seasonYear}`;
    setReviewBusyKey(key);

    const { error } = await supabase
      .from("budgets")
      .update({ status: "rejected" })
      .in(
        "id",
        group.rows.map((r) => r.id)
      );

    setReviewBusyKey(null);

    if (error) {
      setLoadError(error.message);
      return;
    }

    await loadPendingGroups();
    if (group.structureId === selectedStructureId && group.seasonYear === selectedYear) await loadAll();
  }

  function handleExport() {
    const rows: Record<string, unknown>[] = [];

    for (const level of BUDGET_LEVELS) {
      for (let m = 1; m <= 12; m++) {
        const budgetRow = budgetsByLevel[level][m];
        const metrics =
          level === selectedLevel
            ? metricsFromBudgetInputs(
                parseFormNumber(form[m]?.adr),
                parseFormNumber(form[m]?.rns),
                parseFormNumber(rnavByMonth[m])
              )
            : metricsFromBudgetInputs(
                budgetRow?.adr ?? null,
                budgetRow?.room_nights_sold_target ?? null,
                budgetRow?.room_nights_available ?? null
              );

        rows.push({
          Struttura: selectedStructure?.name || "",
          Anno: selectedYear,
          Livello: budgetLevelLabels[level],
          Mese: MONTH_NAMES_IT[m - 1],
          ADR: metrics.adr,
          "RN.S": metrics.rns,
          "RN.AV": metrics.rnav,
          RevPAR: metrics.revpar,
          "% Occ": metrics.occ,
          Produzione: metrics.revenue,
        });
      }
    }

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Budget");
    XLSX.writeFile(workbook, `Budget_${selectedStructure?.name || "struttura"}_${selectedYear}.xlsx`);
  }

  if (accessState !== "granted") return null;

  const otherLevels = BUDGET_LEVELS.filter((l) => l !== selectedLevel);

  return (
    <div className="space-y-6">
      <Link href="/performance" className="text-sm font-medium text-[#017A92] hover:underline">
        ← Torna alla vista d'insieme Performance
      </Link>

      <PageHeader
        eyebrow="Performance"
        title="Budget"
        description="Inserimento e revisione del budget annuale — proposta, revisione, conferma."
      >
        {selectedStructureId && (
          <AppButton
            variant="ghost"
            href={`/performance/${selectedStructureId}?anno=${selectedYear}`}
          >
            Vai a Performance struttura →
          </AppButton>
        )}
      </PageHeader>

      <Tabs defaultValue="editor">
        <TabsList>
          <TabsTrigger value="editor">Pianifica budget</TabsTrigger>
          <TabsTrigger value="pending">
            In attesa di conferma{pendingGroups.length > 0 ? ` (${pendingGroups.length})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="editor" className="space-y-6">
          <AppCard title="Struttura, anno e livello">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                  Struttura
                </label>
                <Select
                  value={selectedStructureId}
                  onValueChange={(v) => {
                    if (!confirmDiscardIfDirty()) return;
                    setSelectedStructureId(v);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Seleziona struttura" />
                  </SelectTrigger>
                  <SelectContent>
                    {structures.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                  Anno
                </label>
                <AppInput
                  type="number"
                  value={String(selectedYear)}
                  onChange={(e) => {
                    if (!confirmDiscardIfDirty()) return;
                    setSelectedYear(Number(e.target.value) || selectedYear);
                  }}
                />
              </div>

              <div>
                <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                  Livello
                </label>
                <div className="flex gap-2">
                  {BUDGET_LEVELS.map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => {
                        if (!confirmDiscardIfDirty()) return;
                        setSelectedLevel(level);
                      }}
                      className={`rounded-[14px] px-4 py-2 text-sm font-semibold transition ${
                        selectedLevel === level
                          ? "bg-teal text-white"
                          : "border border-[#e7dfd8] bg-white text-[#2B2D2F] hover:bg-[#f8f6f2]"
                      }`}
                    >
                      {budgetLevelLabels[level]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </AppCard>

          <AppCard
            title={`Budget ${selectedYear} — ${budgetLevelLabels[selectedLevel]}`}
            subtitle="Clicca l'intestazione di una colonna per confrontarla con gli altri due livelli e con lo storico. ADR, RN.S e RN.AV sono editabili; RevPAR, % Occ. e Produzione sono calcolati."
            action={
              <div className="flex flex-wrap gap-2">
                <AppButton variant="secondary" onClick={handleExport} disabled={loading}>
                  Esporta Excel
                </AppButton>
                <AppButton variant="secondary" onClick={saveDraft} disabled={saving || loading}>
                  {saving ? "Salvataggio..." : "Salva bozza"}
                </AppButton>
                <AppButton onClick={submitForReview} disabled={submitting || loading}>
                  {submitting ? "Invio..." : "Sottometti per revisione ai Master"}
                </AppButton>
              </div>
            }
          >
            {loadError && <p className="mb-3 text-sm text-[#8a3a3a]">{loadError}</p>}
            {actionMessage && <p className="mb-3 text-sm text-[#2f7d43]">{actionMessage}</p>}

            {loading ? (
              <p className="text-sm text-[#6a6d70]">Caricamento...</p>
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[1100px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mese</TableHead>
                      {METRIC_ORDER.map((key) => (
                        <ColumnHeaderGroup
                          key={key}
                          metricKey={key}
                          expanded={expandedColumns.has(key)}
                          onToggle={() => toggleColumn(key)}
                          otherLevels={otherLevels}
                        />
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                      const currentMetrics = metricsFromBudgetInputs(
                        parseFormNumber(form[m]?.adr),
                        parseFormNumber(form[m]?.rns),
                        parseFormNumber(rnavByMonth[m])
                      );
                      const status = budgetsByLevel[selectedLevel][m]?.status;

                      const otherLevelMetrics = otherLevels.map((level) => {
                        const row = budgetsByLevel[level][m];
                        return metricsFromBudgetInputs(
                          row?.adr ?? null,
                          row?.room_nights_sold_target ?? null,
                          row?.room_nights_available ?? null
                        );
                      });

                      const lastYearMetrics = metricsFromActual(lastYearByMonth[m] || null);
                      const bestEntry = bestByMonth[m];
                      const bestMetrics = metricsFromActual(bestEntry?.metrics || null);
                      const lastYearIsOtb = isOtbYearMonth(selectedYear - 1, m);
                      const bestIsOtb = bestEntry ? isOtbYearMonth(bestEntry.year, m) : false;

                      return (
                        <TableRow key={m}>
                          <TableCell className="font-semibold text-[#2B2D2F]">
                            {MONTH_NAMES_IT[m - 1]}
                            {status && status !== "confirmed" && (
                              <AppBadge variant={status === "pending" ? "warning" : "neutral"} className="ml-2">
                                {status === "draft" ? "Bozza" : status === "pending" ? "In revisione" : status}
                              </AppBadge>
                            )}
                          </TableCell>

                          {METRIC_ORDER.map((key) => (
                            <MetricCellGroup
                              key={key}
                              metricKey={key}
                              expanded={expandedColumns.has(key)}
                              editable={key === "adr" || key === "rns" || key === "rnav"}
                              value={currentMetrics[key]}
                              rawInputValue={
                                key === "adr" ? form[m]?.adr ?? "" : key === "rns" ? form[m]?.rns ?? "" : key === "rnav" ? rnavByMonth[m] ?? "" : ""
                              }
                              onChange={
                                key === "adr"
                                  ? (v) => updateField(m, "adr", v)
                                  : key === "rns"
                                  ? (v) => updateField(m, "rns", v)
                                  : key === "rnav"
                                  ? (v) => updateRnav(m, v)
                                  : undefined
                              }
                              otherLevelValues={otherLevelMetrics.map((mm) => mm[key])}
                              lastYearValue={lastYearMetrics[key]}
                              lastYearIsOtb={lastYearIsOtb}
                              bestValue={bestMetrics[key]}
                              bestYear={bestEntry?.year ?? null}
                              bestIsOtb={bestIsOtb}
                            />
                          ))}
                        </TableRow>
                      );
                    })}

                    <TotalsRow
                      form={form}
                      rnavByMonth={rnavByMonth}
                      budgetsByLevel={budgetsByLevel}
                      otherLevels={otherLevels}
                      lastYearByMonth={lastYearByMonth}
                      bestByMonth={bestByMonth}
                      expandedColumns={expandedColumns}
                    />
                  </TableBody>
                </Table>
              </div>
            )}

            <p className="mt-4 flex items-center gap-2 text-[12px] text-[#6a6d70]">
              <span className="inline-block h-3 w-3 rounded-sm bg-[#fff3d6]" />
              Nelle colonne Storico anno prec. / Miglior storico: sfondo evidenziato = mese ancora in corso o
              futuro (dato OTB, prenotazioni ad oggi, non consuntivo chiuso).
            </p>

            {structuresWithoutHistory.size > 0 && (
              <p className="mt-2 text-[12px] text-[#6a6d70]">
                Nessuno storico sufficiente per il confronto su: {[...structuresWithoutHistory].join(", ")}.
              </p>
            )}
          </AppCard>
        </TabsContent>

        <TabsContent value="pending" className="space-y-4">
          <AppCard title="Budget in attesa di conferma">
            {pendingGroups.length === 0 ? (
              <p className="text-sm text-[#6a6d70]">Nessun budget in attesa di revisione.</p>
            ) : (
              <div className="space-y-3">
                {pendingGroups.map((group) => {
                  const key = `${group.structureId}::${group.seasonYear}`;
                  const isSelf = currentUserId && group.rows.every((r) => r.created_by === currentUserId);
                  return (
                    <div
                      key={key}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[#e7dfd8] bg-white p-4"
                    >
                      <div>
                        <p className="font-semibold text-[#2B2D2F]">
                          {group.structureName} — {group.seasonYear}
                        </p>
                        <p className="text-sm text-[#6a6d70]">
                          {group.rows.length} righe proposte da {group.createdByName}
                          {isSelf && " (tu — non puoi confermare la tua stessa proposta)"}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <AppButton
                          variant="secondary"
                          disabled={reviewBusyKey === key}
                          onClick={() => handleRejectGroup(group)}
                        >
                          Rifiuta
                        </AppButton>
                        <AppButton
                          disabled={Boolean(isSelf) || reviewBusyKey === key}
                          onClick={() => handleConfirmGroup(group)}
                        >
                          {reviewBusyKey === key ? "..." : "Conferma"}
                        </AppButton>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </AppCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ColumnHeaderGroup({
  metricKey,
  expanded,
  onToggle,
  otherLevels,
}: {
  metricKey: MetricKey;
  expanded: boolean;
  onToggle: () => void;
  otherLevels: BudgetLevel[];
}) {
  return (
    <>
      <TableHead>
        <button type="button" onClick={onToggle} className="flex items-center gap-1 font-semibold text-[#2B2D2F]">
          {metricLabels[metricKey]}
          <span className="text-[10px]">{expanded ? "▲" : "▼"}</span>
        </button>
      </TableHead>
      {expanded && (
        <>
          <TableHead className="text-[11px] text-[#6a6d70]">{budgetLevelLabels[otherLevels[0]]}</TableHead>
          <TableHead className="text-[11px] text-[#6a6d70]">{budgetLevelLabels[otherLevels[1]]}</TableHead>
          <TableHead className="text-[11px] text-[#6a6d70]">Storico anno prec.</TableHead>
          <TableHead className="text-[11px] text-[#6a6d70]">Miglior storico</TableHead>
        </>
      )}
    </>
  );
}

function MetricCellGroup({
  metricKey,
  expanded,
  editable,
  value,
  rawInputValue,
  onChange,
  otherLevelValues,
  lastYearValue,
  lastYearIsOtb,
  bestValue,
  bestYear,
  bestIsOtb,
}: {
  metricKey: MetricKey;
  expanded: boolean;
  editable: boolean;
  value: number | null;
  rawInputValue: string;
  onChange?: (value: string) => void;
  otherLevelValues: (number | null)[];
  lastYearValue: number | null;
  lastYearIsOtb: boolean;
  bestValue: number | null;
  bestYear: number | null;
  bestIsOtb: boolean;
}) {
  return (
    <>
      <TableCell>
        {editable ? (
          <input
            type="text"
            inputMode="decimal"
            value={rawInputValue}
            onChange={(e) => onChange?.(e.target.value)}
            className="h-9 w-24 rounded-[10px] border border-[#e7dfd8] bg-[#fcfbf9] px-2 text-sm text-[#2B2D2F] outline-none focus:border-[#017A92] focus:bg-white"
          />
        ) : (
          <span className="text-sm text-[#2B2D2F]">{formatMetric(metricKey, value)}</span>
        )}
      </TableCell>
      {expanded && (
        <>
          <TableCell className="text-[12px] text-[#6a6d70]">{formatMetric(metricKey, otherLevelValues[0])}</TableCell>
          <TableCell className="text-[12px] text-[#6a6d70]">{formatMetric(metricKey, otherLevelValues[1])}</TableCell>
          <TableCell
            className={`text-[12px] text-[#6a6d70] ${lastYearValue !== null && lastYearIsOtb ? "bg-[#fff3d6]" : ""}`}
          >
            {lastYearValue !== null ? formatMetric(metricKey, lastYearValue) : "—"}
          </TableCell>
          <TableCell
            className={`text-[12px] text-[#6a6d70] ${bestValue !== null && bestIsOtb ? "bg-[#fff3d6]" : ""}`}
          >
            {bestValue !== null ? `${formatMetric(metricKey, bestValue)}${bestYear ? ` (${bestYear})` : ""}` : "—"}
          </TableCell>
        </>
      )}
    </>
  );
}

function TotalsRow({
  form,
  rnavByMonth,
  budgetsByLevel,
  otherLevels,
  lastYearByMonth,
  bestByMonth,
  expandedColumns,
}: {
  form: Record<number, MonthForm>;
  rnavByMonth: Record<number, string>;
  budgetsByLevel: Record<BudgetLevel, Record<number, BudgetRow | null>>;
  otherLevels: BudgetLevel[];
  lastYearByMonth: Record<number, ActualMetrics | null>;
  bestByMonth: Record<number, { metrics: ActualMetrics; year: number } | null>;
  expandedColumns: Set<MetricKey>;
}) {
  function sumOrAvg(key: MetricKey, values: (number | null)[]): number | null {
    const nonNull = values.filter((v): v is number => v !== null);
    if (nonNull.length === 0) return null;
    const isAveraged = key === "adr" || key === "revpar" || key === "occ";
    const sum = nonNull.reduce((a, b) => a + b, 0);
    return isAveraged ? sum / nonNull.length : sum;
  }

  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  const currentByMonth = months.map((m) =>
    metricsFromBudgetInputs(
      parseFormNumber(form[m]?.adr),
      parseFormNumber(form[m]?.rns),
      parseFormNumber(rnavByMonth[m])
    )
  );

  const otherLevelsByMonth = otherLevels.map((level) =>
    months.map((m) => {
      const row = budgetsByLevel[level][m];
      return metricsFromBudgetInputs(row?.adr ?? null, row?.room_nights_sold_target ?? null, row?.room_nights_available ?? null);
    })
  );

  const lastYearByMonthMetrics = months.map((m) => metricsFromActual(lastYearByMonth[m] || null));
  const bestByMonthMetrics = months.map((m) => metricsFromActual(bestByMonth[m]?.metrics || null));

  return (
    <TableRow className="border-t-2 border-[#e7dfd8] font-semibold">
      <TableCell>Totale</TableCell>
      {METRIC_ORDER.map((key) => (
        <Fragment key={key}>
          <TableCell>{formatMetric(key, sumOrAvg(key, currentByMonth.map((c) => c[key])))}</TableCell>
          {expandedColumns.has(key) && (
            <>
              <TableCell className="text-[12px] font-normal text-[#6a6d70]">
                {formatMetric(key, sumOrAvg(key, otherLevelsByMonth[0].map((c) => c[key])))}
              </TableCell>
              <TableCell className="text-[12px] font-normal text-[#6a6d70]">
                {formatMetric(key, sumOrAvg(key, otherLevelsByMonth[1].map((c) => c[key])))}
              </TableCell>
              <TableCell className="text-[12px] font-normal text-[#6a6d70]">
                {formatMetric(key, sumOrAvg(key, lastYearByMonthMetrics.map((c) => c[key])))}
              </TableCell>
              <TableCell className="text-[12px] font-normal text-[#6a6d70]">
                {formatMetric(key, sumOrAvg(key, bestByMonthMetrics.map((c) => c[key])))}
              </TableCell>
            </>
          )}
        </Fragment>
      ))}
    </TableRow>
  );
}

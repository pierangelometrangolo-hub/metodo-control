"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { AppBadge } from "@/components/ui/AppBadge";
import { AppButton } from "@/components/ui/AppButton";
import { AppInput } from "@/components/ui/AppInput";
import { ClientAvatar } from "@/components/crm/ClientAvatar";
import { supabase } from "@/lib/supabaseClient";
import { canViewModule, getUserLevelRank } from "@/lib/permissions";
import {
  CrmBadgeStatus,
  CrmClient,
  TypeFlagKey,
  badgeStatusLabels,
  badgeStatusVariant,
  clientTypeLabels,
  consultantDisplayName,
  isExpiringWithinMonths,
  typeFlagLabels,
} from "@/lib/crm";

const SENIOR_RANK = 2;

const TYPE_FLAG_KEYS: TypeFlagKey[] = ["is_consulenza", "is_formazione", "is_eventi"];

type ClienteFornitoreFilter = "tutti" | "clienti" | "fornitori";
type StatusFilter = "tutti" | CrmBadgeStatus;

const CLIENTE_FORNITORE_OPTIONS: { value: ClienteFornitoreFilter; label: string }[] = [
  { value: "tutti", label: "Tutti" },
  { value: "clienti", label: "Solo Clienti" },
  { value: "fornitori", label: "Solo Fornitori" },
];

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "tutti", label: "Tutti" },
  { value: "attivo", label: "Attivo" },
  { value: "da_definire", label: "Da definire" },
  { value: "prospect", label: "Prospect" },
  { value: "ex_cliente", label: "Ex cliente" },
];

type ProfileLite = { id: string; nome: string | null; cognome: string | null };

type NewClientForm = {
  business_name: string;
  vat_number: string;
  fiscal_code: string;
  address: string;
  postal_code: string;
  sdi_code: string;
  pec: string;
  phone: string;
  email: string;
  website: string;
  cin: string;
  cis: string;
  notes: string;
  is_consulenza: boolean;
  is_formazione: boolean;
  is_eventi: boolean;
  is_fornitore: boolean;
};

const EMPTY_NEW_CLIENT_FORM: NewClientForm = {
  business_name: "",
  vat_number: "",
  fiscal_code: "",
  address: "",
  postal_code: "",
  sdi_code: "",
  pec: "",
  phone: "",
  email: "",
  website: "",
  cin: "",
  cis: "",
  notes: "",
  is_consulenza: false,
  is_formazione: false,
  is_eventi: false,
  is_fornitore: false,
};

export default function CrmListPage() {
  const router = useRouter();

  const [accessState, setAccessState] = useState<"checking" | "granted" | "denied">("checking");
  const [canManage, setCanManage] = useState(false);
  const [clients, setClients] = useState<CrmClient[]>([]);
  const [profilesById, setProfilesById] = useState<Map<string, ProfileLite>>(new Map());

  const [typeFilters, setTypeFilters] = useState<Set<TypeFlagKey>>(new Set());
  const [clienteFornitoreFilter, setClienteFornitoreFilter] = useState<ClienteFornitoreFilter>("tutti");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("tutti");

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [showNewClientForm, setShowNewClientForm] = useState(false);
  const [newClientForm, setNewClientForm] = useState<NewClientForm>(EMPTY_NEW_CLIENT_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  useEffect(() => {
    void checkAccess();
  }, []);

  useEffect(() => {
    if (accessState === "granted") void loadClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessState]);

  async function checkAccess() {
    const canView = await canViewModule("crm");

    if (!canView) {
      setAccessState("denied");
      router.replace("/dashboard");
      return;
    }

    const rank = await getUserLevelRank();
    setCanManage(rank !== null && rank >= SENIOR_RANK);
    setAccessState("granted");
  }

  async function loadClients() {
    setLoading(true);
    setLoadError("");

    const [clientsRes, profilesRes] = await Promise.all([
      supabase
        .from("v_crm_clients_badge")
        .select("*")
        .order("business_name", { ascending: true }),
      supabase.from("profiles").select("id, nome, cognome"),
    ]);

    if (clientsRes.error) setLoadError(clientsRes.error.message);
    if (profilesRes.error) setLoadError(profilesRes.error.message);

    setClients((clientsRes.data as CrmClient[]) || []);
    setProfilesById(new Map(((profilesRes.data as ProfileLite[]) || []).map((p) => [p.id, p])));
    setLoading(false);
  }

  function toggleTypeFilter(key: TypeFlagKey) {
    setTypeFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const activeCount = useMemo(
    () => clients.filter((c) => c.status === "attivo" && !c.is_fornitore).length,
    [clients]
  );

  const expiringCount = useMemo(
    () => clients.filter((c) => c.is_consulenza && isExpiringWithinMonths(c.contract_end_date, 6)).length,
    [clients]
  );

  const prospectCount = useMemo(() => clients.filter((c) => c.status === "prospect").length, [clients]);

  const filteredClients = useMemo(
    () =>
      clients.filter((c) => {
        const typeMatch = typeFilters.size === 0 || Array.from(typeFilters).some((key) => c[key]);
        const cfMatch =
          clienteFornitoreFilter === "tutti" ||
          (clienteFornitoreFilter === "fornitori" ? c.is_fornitore : !c.is_fornitore);
        const statusMatch = statusFilter === "tutti" || c.badge_status === statusFilter;
        return typeMatch && cfMatch && statusMatch;
      }),
    [clients, typeFilters, clienteFornitoreFilter, statusFilter]
  );

  async function handleCreateClient(e: React.FormEvent) {
    e.preventDefault();
    setCreateError("");

    if (!newClientForm.business_name.trim()) {
      setCreateError("La ragione sociale è obbligatoria");
      return;
    }

    if (!newClientForm.is_consulenza && !newClientForm.is_formazione && !newClientForm.is_eventi) {
      setCreateError("Seleziona almeno un tipo cliente");
      return;
    }

    setCreating(true);

    const { error } = await supabase.from("crm_clients").insert({
      business_name: newClientForm.business_name.trim(),
      vat_number: newClientForm.vat_number.trim() || null,
      fiscal_code: newClientForm.fiscal_code.trim() || null,
      address: newClientForm.address.trim() || null,
      postal_code: newClientForm.postal_code.trim() || null,
      sdi_code: newClientForm.sdi_code.trim() || null,
      pec: newClientForm.pec.trim() || null,
      phone: newClientForm.phone.trim() || null,
      email: newClientForm.email.trim() || null,
      website: newClientForm.website.trim() || null,
      cin: newClientForm.cin.trim() || null,
      cis: newClientForm.cis.trim() || null,
      notes: newClientForm.notes.trim() || null,
      is_consulenza: newClientForm.is_consulenza,
      is_formazione: newClientForm.is_formazione,
      is_eventi: newClientForm.is_eventi,
      is_fornitore: newClientForm.is_fornitore,
    });

    setCreating(false);

    if (error) {
      setCreateError(error.message);
      return;
    }

    setShowNewClientForm(false);
    setNewClientForm(EMPTY_NEW_CLIENT_FORM);
    await loadClients();
  }

  if (accessState !== "granted") {
    return null;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="CRM"
        title="Clienti"
        description="Anagrafica unificata dei clienti MeToDo — Consulenza, Formazione, Eventi."
      >
        {canManage && (
          <AppButton onClick={() => setShowNewClientForm(true)}>+ Nuovo cliente</AppButton>
        )}
      </PageHeader>

      <section className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
        <KpiCard title="Clienti attivi" value={activeCount.toString()} note="Esclusi i fornitori" href="/crm" active />
        <KpiCard
          title="In scadenza (6 mesi)"
          value={expiringCount.toString()}
          note="Contratti Consulenza in scadenza entro 6 mesi"
          href="/crm"
          alert={expiringCount > 0}
        />
        <KpiCard title="Prospect" value={prospectCount.toString()} note="Non ancora clienti attivi" href="/crm" />
      </section>

      <section className="rounded-[20px] border border-[#e7dfd8] bg-white p-6 shadow-[0_12px_30px_rgba(43,45,47,0.05)]">
        <div className="mb-5 space-y-4">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">Tipo</p>
            <div className="flex flex-wrap gap-2">
              {TYPE_FLAG_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleTypeFilter(key)}
                  className={`rounded-[14px] px-4 py-2 text-sm font-semibold transition ${
                    typeFilters.has(key)
                      ? "bg-teal text-white"
                      : "border border-[#e7dfd8] bg-white text-[#2B2D2F] hover:bg-[#f8f6f2]"
                  }`}
                >
                  {typeFlagLabels[key]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              Cliente / Fornitore
            </p>
            <div className="flex flex-wrap gap-2">
              {CLIENTE_FORNITORE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setClienteFornitoreFilter(opt.value)}
                  className={`rounded-[14px] px-4 py-2 text-sm font-semibold transition ${
                    clienteFornitoreFilter === opt.value
                      ? "bg-teal text-white"
                      : "border border-[#e7dfd8] bg-white text-[#2B2D2F] hover:bg-[#f8f6f2]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">Stato</p>
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setStatusFilter(opt.value)}
                  className={`rounded-[14px] px-4 py-2 text-sm font-semibold transition ${
                    statusFilter === opt.value
                      ? "bg-teal text-white"
                      : "border border-[#e7dfd8] bg-white text-[#2B2D2F] hover:bg-[#f8f6f2]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mb-5 flex flex-wrap items-center justify-between gap-4 border-t border-[#f0ece6] pt-5">
          <p className="text-sm text-[#555555]">
            {filteredClients.length} {filteredClients.length === 1 ? "cliente" : "clienti"}
          </p>
        </div>

        {loadError && <p className="mb-3 text-sm text-[#8a3a3a]">{loadError}</p>}

        {loading ? (
          <p className="text-sm text-[#6a6d70]">Caricamento...</p>
        ) : filteredClients.length === 0 ? (
          <p className="text-sm text-[#6a6d70]">Nessun cliente per questo filtro.</p>
        ) : (
          <div className="space-y-2">
            {filteredClients.map((client) => (
              <Link
                key={client.id}
                href={`/crm/${client.id}`}
                className="flex items-center gap-4 rounded-[16px] border border-[#e7dfd8] bg-white px-4 py-3 transition hover:-translate-y-0.5 hover:border-teal hover:shadow-[0_8px_20px_rgba(43,45,47,0.06)]"
              >
                <ClientAvatar businessName={client.business_name} />

                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-[#2B2D2F]">
                    {client.business_name}
                    {client.is_fornitore && (
                      <span className="ml-2 rounded-full border border-[#e7dfd8] bg-[#fcfbf9] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#6b625c]">
                        Fornitore
                      </span>
                    )}
                  </p>
                  <p className="truncate text-sm text-[#6a6d70]">
                    {clientTypeLabels(client)} · Consulente: {consultantDisplayName(client.assigned_consultant_id, profilesById)}
                  </p>
                </div>

                <AppBadge variant={badgeStatusVariant[client.badge_status]}>
                  {badgeStatusLabels[client.badge_status]}
                </AppBadge>
              </Link>
            ))}
          </div>
        )}
      </section>

      {showNewClientForm && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4"
          onClick={() => setShowNewClientForm(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[20px] border border-[#e7dfd8] bg-white p-6 shadow-[0_12px_30px_rgba(43,45,47,0.12)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-2xl text-[#2B2D2F]">Nuovo cliente</h2>

            <form onSubmit={handleCreateClient} className="mt-5 space-y-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <LabeledInput
                  label="Ragione sociale"
                  value={newClientForm.business_name}
                  onChange={(v) => setNewClientForm((f) => ({ ...f, business_name: v }))}
                />
                <LabeledInput
                  label="P.IVA"
                  value={newClientForm.vat_number}
                  onChange={(v) => setNewClientForm((f) => ({ ...f, vat_number: v }))}
                />
                <LabeledInput
                  label="Codice fiscale"
                  value={newClientForm.fiscal_code}
                  onChange={(v) => setNewClientForm((f) => ({ ...f, fiscal_code: v }))}
                />
                <LabeledInput
                  label="Indirizzo"
                  value={newClientForm.address}
                  onChange={(v) => setNewClientForm((f) => ({ ...f, address: v }))}
                />
                <LabeledInput
                  label="CAP"
                  value={newClientForm.postal_code}
                  onChange={(v) => setNewClientForm((f) => ({ ...f, postal_code: v }))}
                />
                <LabeledInput
                  label="Codice SDI"
                  value={newClientForm.sdi_code}
                  onChange={(v) => setNewClientForm((f) => ({ ...f, sdi_code: v }))}
                />
                <LabeledInput
                  label="PEC"
                  value={newClientForm.pec}
                  onChange={(v) => setNewClientForm((f) => ({ ...f, pec: v }))}
                />
                <LabeledInput
                  label="Telefono"
                  value={newClientForm.phone}
                  onChange={(v) => setNewClientForm((f) => ({ ...f, phone: v }))}
                />
                <LabeledInput
                  label="Email"
                  type="email"
                  value={newClientForm.email}
                  onChange={(v) => setNewClientForm((f) => ({ ...f, email: v }))}
                />
                <LabeledInput
                  label="Sito web"
                  value={newClientForm.website}
                  onChange={(v) => setNewClientForm((f) => ({ ...f, website: v }))}
                />
                <LabeledInput
                  label="CIN"
                  value={newClientForm.cin}
                  onChange={(v) => setNewClientForm((f) => ({ ...f, cin: v }))}
                />
                <LabeledInput
                  label="CIS"
                  value={newClientForm.cis}
                  onChange={(v) => setNewClientForm((f) => ({ ...f, cis: v }))}
                />
              </div>

              <div>
                <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                  Note
                </label>
                <textarea
                  value={newClientForm.notes}
                  onChange={(e) => setNewClientForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  className="w-full rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 py-3 text-sm text-[#2B2D2F] outline-none transition placeholder:text-[#8b8f94] focus:border-[#017A92] focus:bg-white"
                />
              </div>

              <div>
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">Tipo</p>
                <div className="flex flex-wrap gap-3">
                  {TYPE_FLAG_KEYS.map((key) => (
                    <label
                      key={key}
                      className="flex items-center gap-2 rounded-[12px] border border-[#e7dfd8] bg-[#fcfbf9] px-3 py-2 text-sm text-[#2B2D2F]"
                    >
                      <input
                        type="checkbox"
                        checked={newClientForm[key]}
                        onChange={(e) => setNewClientForm((f) => ({ ...f, [key]: e.target.checked }))}
                      />
                      {typeFlagLabels[key]}
                    </label>
                  ))}
                  <label className="flex items-center gap-2 rounded-[12px] border border-[#e7dfd8] bg-[#fcfbf9] px-3 py-2 text-sm text-[#2B2D2F]">
                    <input
                      type="checkbox"
                      checked={newClientForm.is_fornitore}
                      onChange={(e) => setNewClientForm((f) => ({ ...f, is_fornitore: e.target.checked }))}
                    />
                    Fornitore
                  </label>
                </div>
              </div>

              {createError && <p className="text-sm text-[#8a3a3a]">{createError}</p>}

              <div className="flex justify-end gap-2">
                <AppButton
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setShowNewClientForm(false);
                    setNewClientForm(EMPTY_NEW_CLIENT_FORM);
                    setCreateError("");
                  }}
                >
                  Annulla
                </AppButton>
                <AppButton type="submit" disabled={creating}>
                  {creating ? "Salvataggio..." : "Salva cliente"}
                </AppButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
        {label}
      </label>
      <AppInput type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { use as usePromise } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { AppCard } from "@/components/ui/AppCard";
import { AppBadge } from "@/components/ui/AppBadge";
import { AppButton } from "@/components/ui/AppButton";
import { AppInput } from "@/components/ui/AppInput";
import { ClientAvatar } from "@/components/crm/ClientAvatar";
import { supabase } from "@/lib/supabaseClient";
import { canViewModule, getUserLevelRank } from "@/lib/permissions";
import {
  CrmClient,
  CrmCommissionType,
  CrmContact,
  TypeFlagKey,
  badgeStatusLabels,
  badgeStatusVariant,
  clientTypeLabels,
  commissionFixedOverrideText,
  contractStatusLabels,
  typeFlagLabels,
} from "@/lib/crm";

const ND = "ND";
const SENIOR_RANK = 2;
const TYPE_FLAG_KEYS: TypeFlagKey[] = ["is_consulenza", "is_formazione", "is_eventi"];

// "YYYY-MM-DD" -> "DD/MM/YYYY" senza passare da Date (stessa convenzione
// gia' usata in Performance, mai estratta in una lib condivisa li' - stesso
// trattamento qui).
function formatDateIt(dateStr: string | null): string {
  if (!dateStr) return ND;
  return dateStr.split("-").reverse().join("/");
}

function nd(value: string | null | undefined): string {
  return value && value.trim() !== "" ? value : ND;
}

type NewContactForm = {
  name: string;
  role: string;
  phone: string;
  email: string;
};

const EMPTY_FORM: NewContactForm = { name: "", role: "", phone: "", email: "" };

type EditForm = {
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
  commission_type: "" | CrmCommissionType;
  commission_percentage: string;
  commission_fixed_amount: string;
  commission_fixed_months: string;
  commission_override_percentage: string;
  commission_override_threshold: string;
};

function clientToEditForm(c: CrmClient): EditForm {
  return {
    business_name: c.business_name,
    vat_number: c.vat_number || "",
    fiscal_code: c.fiscal_code || "",
    address: c.address || "",
    postal_code: c.postal_code || "",
    sdi_code: c.sdi_code || "",
    pec: c.pec || "",
    phone: c.phone || "",
    email: c.email || "",
    website: c.website || "",
    cin: c.cin || "",
    cis: c.cis || "",
    notes: c.notes || "",
    is_consulenza: c.is_consulenza,
    is_formazione: c.is_formazione,
    is_eventi: c.is_eventi,
    is_fornitore: c.is_fornitore,
    commission_type: c.commission_type || "",
    commission_percentage: c.commission_percentage != null ? String(c.commission_percentage) : "",
    commission_fixed_amount: c.commission_fixed_amount != null ? String(c.commission_fixed_amount) : "",
    commission_fixed_months: c.commission_fixed_months != null ? String(c.commission_fixed_months) : "",
    commission_override_percentage:
      c.commission_override_percentage != null ? String(c.commission_override_percentage) : "",
    commission_override_threshold:
      c.commission_override_threshold != null ? String(c.commission_override_threshold) : "",
  };
}

const NUMERIC_COMMISSION_FIELDS: { key: keyof EditForm; label: string }[] = [
  { key: "commission_percentage", label: "Percentuale commissione" },
  { key: "commission_fixed_amount", label: "Fisso mensile" },
  { key: "commission_fixed_months", label: "Numero mesi" },
  { key: "commission_override_percentage", label: "Percentuale override" },
  { key: "commission_override_threshold", label: "Soglia override" },
];

export default function CrmClientDetailPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = usePromise(params);
  const router = useRouter();

  const [accessState, setAccessState] = useState<"checking" | "granted" | "denied">("checking");
  const [canManage, setCanManage] = useState(false);
  const [client, setClient] = useState<CrmClient | null>(null);
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [structureName, setStructureName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<NewContactForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");

  useEffect(() => {
    void checkAccessAndLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkAccessAndLoad() {
    const canView = await canViewModule("crm");

    if (!canView) {
      setAccessState("denied");
      router.replace("/dashboard");
      return;
    }

    const rank = await getUserLevelRank();
    setCanManage(rank !== null && rank >= SENIOR_RANK);

    setAccessState("granted");
    await loadClient();
    await loadContacts();
  }

  async function loadClient() {
    setLoading(true);
    setLoadError("");

    const { data, error } = await supabase
      .from("v_crm_clients_badge")
      .select("*")
      .eq("id", clientId)
      .single();

    if (error || !data) {
      setLoadError(`Cliente non trovato: ${error?.message || ""}`);
      setLoading(false);
      return;
    }

    const clientData = data as CrmClient;
    setClient(clientData);
    setLoading(false);

    if (clientData.is_consulenza && clientData.structure_id) {
      const { data: structureData } = await supabase
        .from("structures")
        .select("name")
        .eq("id", clientData.structure_id)
        .single();
      setStructureName(structureData?.name ?? null);
    }
  }

  async function loadContacts() {
    const { data, error } = await supabase
      .from("crm_contacts")
      .select("*")
      .eq("client_id", clientId)
      .order("created_at", { ascending: true });

    if (error) {
      setLoadError(error.message);
      return;
    }

    setContacts((data as CrmContact[]) || []);
  }

  async function handleAddContact(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const { error } = await supabase.from("crm_contacts").insert({
      client_id: clientId,
      name: form.name.trim() || ND,
      role: form.role.trim() || ND,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
    });

    setSaving(false);

    if (error) {
      setLoadError(error.message);
      return;
    }

    setForm(EMPTY_FORM);
    setShowAddForm(false);
    await loadContacts();
  }

  async function handleDeleteContact(contact: CrmContact) {
    const confirmDelete = window.confirm(`Eliminare il referente "${contact.name}"?`);
    if (!confirmDelete) return;

    setDeletingId(contact.id);
    const { error } = await supabase.from("crm_contacts").delete().eq("id", contact.id);
    setDeletingId(null);

    if (error) {
      setLoadError(error.message);
      return;
    }

    await loadContacts();
  }

  function startEdit() {
    if (!client) return;
    setEditForm(clientToEditForm(client));
    setEditError("");
    setIsEditing(true);
  }

  function cancelEdit() {
    setIsEditing(false);
    setEditForm(null);
    setEditError("");
  }

  async function saveEdit() {
    if (!editForm) return;
    setEditError("");

    if (!editForm.business_name.trim()) {
      setEditError("La ragione sociale è obbligatoria");
      return;
    }

    if (!editForm.is_consulenza && !editForm.is_formazione && !editForm.is_eventi) {
      setEditError("Seleziona almeno un tipo cliente");
      return;
    }

    for (const { key, label } of NUMERIC_COMMISSION_FIELDS) {
      const raw = editForm[key] as string;
      if (raw.trim() !== "" && Number.isNaN(Number(raw.trim()))) {
        setEditError(`${label}: valore numerico non valido`);
        return;
      }
    }

    const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v.trim()));

    setSavingEdit(true);

    const { error } = await supabase
      .from("crm_clients")
      .update({
        business_name: editForm.business_name.trim(),
        vat_number: editForm.vat_number.trim() || null,
        fiscal_code: editForm.fiscal_code.trim() || null,
        address: editForm.address.trim() || null,
        postal_code: editForm.postal_code.trim() || null,
        sdi_code: editForm.sdi_code.trim() || null,
        pec: editForm.pec.trim() || null,
        phone: editForm.phone.trim() || null,
        email: editForm.email.trim() || null,
        website: editForm.website.trim() || null,
        cin: editForm.cin.trim() || null,
        cis: editForm.cis.trim() || null,
        notes: editForm.notes.trim() || null,
        is_consulenza: editForm.is_consulenza,
        is_formazione: editForm.is_formazione,
        is_eventi: editForm.is_eventi,
        is_fornitore: editForm.is_fornitore,
        commission_type: editForm.commission_type || null,
        commission_percentage: numOrNull(editForm.commission_percentage),
        commission_fixed_amount: numOrNull(editForm.commission_fixed_amount),
        commission_fixed_months: numOrNull(editForm.commission_fixed_months),
        commission_override_percentage: numOrNull(editForm.commission_override_percentage),
        commission_override_threshold: numOrNull(editForm.commission_override_threshold),
      })
      .eq("id", clientId);

    setSavingEdit(false);

    if (error) {
      setEditError(error.message);
      return;
    }

    setIsEditing(false);
    setEditForm(null);
    await loadClient();
  }

  if (accessState !== "granted") {
    return null;
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Link href="/crm" className="text-sm font-medium text-[#017A92] hover:underline">
          ← Torna all'elenco clienti
        </Link>
        <p className="text-sm text-[#6a6d70]">Caricamento...</p>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="space-y-6">
        <Link href="/crm" className="text-sm font-medium text-[#017A92] hover:underline">
          ← Torna all'elenco clienti
        </Link>
        <p className="text-sm text-[#8a3a3a]">{loadError || "Cliente non trovato."}</p>
      </div>
    );
  }

  const isConsulenza = client.is_consulenza;
  const showCommissioni = isEditing && editForm ? editForm.is_consulenza : isConsulenza;
  const address = client.address ? (client.postal_code ? `${client.address} (${client.postal_code})` : client.address) : null;

  return (
    <div className="space-y-6">
      <Link href="/crm" className="text-sm font-medium text-[#017A92] hover:underline">
        ← Torna all'elenco clienti
      </Link>

      <PageHeader
        eyebrow="CRM"
        title={client.business_name}
        description={`${clientTypeLabels(client)}${client.is_fornitore ? " · Fornitore" : ""} — stato ${badgeStatusLabels[client.badge_status].toLowerCase()}`}
      >
        <div className="flex items-center gap-3">
          <ClientAvatar businessName={client.business_name} size={32} />
          <AppBadge variant={badgeStatusVariant[client.badge_status]}>
            {badgeStatusLabels[client.badge_status]}
          </AppBadge>

          {canManage && !isEditing && (
            <AppButton variant="secondary" onClick={startEdit}>
              Modifica anagrafica
            </AppButton>
          )}

          {canManage && isEditing && (
            <>
              <AppButton variant="secondary" onClick={cancelEdit} disabled={savingEdit}>
                Annulla
              </AppButton>
              <AppButton onClick={saveEdit} disabled={savingEdit}>
                {savingEdit ? "Salvataggio..." : "Salva"}
              </AppButton>
            </>
          )}
        </div>
      </PageHeader>

      {loadError && <p className="text-sm text-[#8a3a3a]">{loadError}</p>}
      {isEditing && editError && <p className="text-sm text-[#8a3a3a]">{editError}</p>}

      {/* Blocco 1 - Dati di fatturazione */}
      <AppCard title="Dati di fatturazione" subtitle="Anagrafica e recapiti del cliente">
        {!isEditing || !editForm ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Ragione sociale" value={nd(client.business_name)} />
            <Field label="P.IVA / Codice Fiscale" value={nd(client.vat_number || client.fiscal_code)} />
            <Field label="Indirizzo" value={nd(address)} />
            <Field label="SDI / PEC" value={nd(client.sdi_code || client.pec)} />
            <Field label="Telefono" value={nd(client.phone)} />
            <Field label="Email" value={nd(client.email)} />
            <Field label="Sito web" value={nd(client.website)} />
            <Field label="CIN" value={nd(client.cin)} />
            <Field label="CIS" value={nd(client.cis)} />
            <div className="sm:col-span-2 lg:col-span-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">Note</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-[#2B2D2F]">{nd(client.notes)}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <EditField label="Ragione sociale" value={editForm.business_name} onChange={(v) => setEditForm((f) => f && { ...f, business_name: v })} />
              <EditField label="P.IVA" value={editForm.vat_number} onChange={(v) => setEditForm((f) => f && { ...f, vat_number: v })} />
              <EditField label="Codice fiscale" value={editForm.fiscal_code} onChange={(v) => setEditForm((f) => f && { ...f, fiscal_code: v })} />
              <EditField label="Indirizzo" value={editForm.address} onChange={(v) => setEditForm((f) => f && { ...f, address: v })} />
              <EditField label="CAP" value={editForm.postal_code} onChange={(v) => setEditForm((f) => f && { ...f, postal_code: v })} />
              <EditField label="Codice SDI" value={editForm.sdi_code} onChange={(v) => setEditForm((f) => f && { ...f, sdi_code: v })} />
              <EditField label="PEC" value={editForm.pec} onChange={(v) => setEditForm((f) => f && { ...f, pec: v })} />
              <EditField label="Telefono" value={editForm.phone} onChange={(v) => setEditForm((f) => f && { ...f, phone: v })} />
              <EditField label="Email" type="email" value={editForm.email} onChange={(v) => setEditForm((f) => f && { ...f, email: v })} />
              <EditField label="Sito web" value={editForm.website} onChange={(v) => setEditForm((f) => f && { ...f, website: v })} />
              <EditField label="CIN" value={editForm.cin} onChange={(v) => setEditForm((f) => f && { ...f, cin: v })} />
              <EditField label="CIS" value={editForm.cis} onChange={(v) => setEditForm((f) => f && { ...f, cis: v })} />
            </div>

            <div>
              <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                Note
              </label>
              <textarea
                value={editForm.notes}
                onChange={(e) => setEditForm((f) => f && { ...f, notes: e.target.value })}
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
                      checked={editForm[key]}
                      onChange={(e) => setEditForm((f) => f && { ...f, [key]: e.target.checked })}
                    />
                    {typeFlagLabels[key]}
                  </label>
                ))}
                <label className="flex items-center gap-2 rounded-[12px] border border-[#e7dfd8] bg-[#fcfbf9] px-3 py-2 text-sm text-[#2B2D2F]">
                  <input
                    type="checkbox"
                    checked={editForm.is_fornitore}
                    onChange={(e) => setEditForm((f) => f && { ...f, is_fornitore: e.target.checked })}
                  />
                  Fornitore
                </label>
              </div>
            </div>
          </div>
        )}
      </AppCard>

      {/* Blocco 2 - Contratto (solo Consulenza) */}
      {isConsulenza && (
        <AppCard
          title="Contratto"
          subtitle={client.badge_status === "da_definire" ? "Stato contratto da definire" : undefined}
          className={client.badge_status === "da_definire" ? "border-[#f0dfbf] bg-[#fff7eb]" : ""}
        >
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <Field
              label="Periodo"
              value={
                client.contract_start_date || client.contract_end_date
                  ? `${formatDateIt(client.contract_start_date)} – ${formatDateIt(client.contract_end_date)}`
                  : ND
              }
            />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">Stato contratto</p>
              <div className="mt-2">
                {client.contract_status ? (
                  <AppBadge variant={client.badge_status === "da_definire" ? "warning" : "success"}>
                    {contractStatusLabels[client.contract_status]}
                  </AppBadge>
                ) : (
                  <span className="text-[#2B2D2F]">{ND}</span>
                )}
              </div>
            </div>
            <Field
              label="Mesi di preavviso"
              value={client.contract_notice_months !== null ? String(client.contract_notice_months) : ND}
            />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">Documento contratto</p>
              <div className="mt-2">
                {client.contract_document_url ? (
                  <a
                    href={client.contract_document_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-[#017A92] hover:underline"
                  >
                    Apri documento →
                  </a>
                ) : (
                  <span className="text-[#2B2D2F]">{ND}</span>
                )}
              </div>
            </div>
          </div>
        </AppCard>
      )}

      {/* Blocco Commissioni - solo Consulenza, non renderizzato per gli altri tipi */}
      {showCommissioni && (
        <AppCard title="Commissioni" subtitle="Termini contrattuali, nessun calcolo automatico">
          {!isEditing || !editForm ? (
            <>
              {client.commission_type === "percentuale" && (
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  <Field
                    label="Percentuale"
                    value={client.commission_percentage !== null ? `${client.commission_percentage}%` : ND}
                  />
                </div>
              )}

              {client.commission_type === "fisso_piu_override" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
                    <Field
                      label="Fisso mensile"
                      value={client.commission_fixed_amount !== null ? `€${client.commission_fixed_amount}` : ND}
                    />
                    <Field
                      label="Numero mesi"
                      value={client.commission_fixed_months !== null ? String(client.commission_fixed_months) : ND}
                    />
                    <Field
                      label="Percentuale override"
                      value={client.commission_override_percentage !== null ? `${client.commission_override_percentage}%` : ND}
                    />
                    <Field
                      label="Soglia override"
                      value={client.commission_override_threshold !== null ? `€${client.commission_override_threshold}` : ND}
                    />
                  </div>
                  <p className="text-sm text-[#555555]">{commissionFixedOverrideText(client)}</p>
                </div>
              )}

              {!client.commission_type && <p className="text-sm text-[#6a6d70]">Termini commissionali non definiti.</p>}
            </>
          ) : (
            <div className="space-y-5">
              <div>
                <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                  Tipo commissione
                </label>
                <select
                  value={editForm.commission_type}
                  onChange={(e) =>
                    setEditForm((f) => f && { ...f, commission_type: e.target.value as EditForm["commission_type"] })
                  }
                  className="h-11 w-full rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 text-sm text-[#2B2D2F] outline-none transition focus:border-[#017A92] focus:bg-white sm:w-auto"
                >
                  <option value="">Non definito</option>
                  <option value="percentuale">Percentuale</option>
                  <option value="fisso_piu_override">Fisso + override</option>
                </select>
              </div>

              {editForm.commission_type === "percentuale" && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <EditField
                    label="Percentuale (%)"
                    value={editForm.commission_percentage}
                    onChange={(v) => setEditForm((f) => f && { ...f, commission_percentage: v })}
                  />
                </div>
              )}

              {editForm.commission_type === "fisso_piu_override" && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <EditField
                    label="Fisso mensile (€)"
                    value={editForm.commission_fixed_amount}
                    onChange={(v) => setEditForm((f) => f && { ...f, commission_fixed_amount: v })}
                  />
                  <EditField
                    label="Numero mesi"
                    value={editForm.commission_fixed_months}
                    onChange={(v) => setEditForm((f) => f && { ...f, commission_fixed_months: v })}
                  />
                  <EditField
                    label="Percentuale override (%)"
                    value={editForm.commission_override_percentage}
                    onChange={(v) => setEditForm((f) => f && { ...f, commission_override_percentage: v })}
                  />
                  <EditField
                    label="Soglia override (€)"
                    value={editForm.commission_override_threshold}
                    onChange={(v) => setEditForm((f) => f && { ...f, commission_override_threshold: v })}
                  />
                </div>
              )}
            </div>
          )}
        </AppCard>
      )}

      {/* Blocco 3 - Contatti */}
      <AppCard
        title="Contatti"
        subtitle={`${contacts.length} ${contacts.length === 1 ? "referente" : "referenti"}`}
        action={
          !showAddForm ? (
            <AppButton variant="secondary" onClick={() => setShowAddForm(true)}>
              + Aggiungi referente
            </AppButton>
          ) : undefined
        }
      >
        {showAddForm && (
          <form
            onSubmit={handleAddContact}
            className="mb-5 grid grid-cols-1 gap-3 rounded-[16px] border border-[#e7dfd8] bg-[#fcfbf9] p-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            <AppInput
              placeholder="Nome"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <AppInput
              placeholder="Ruolo (ND se vuoto)"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            />
            <AppInput
              placeholder="Telefono"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
            <AppInput
              placeholder="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />

            <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
              <AppButton type="submit" disabled={saving}>
                {saving ? "Salvataggio..." : "Salva referente"}
              </AppButton>
              <AppButton
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowAddForm(false);
                  setForm(EMPTY_FORM);
                }}
              >
                Annulla
              </AppButton>
            </div>
          </form>
        )}

        {contacts.length === 0 ? (
          <p className="text-sm text-[#6a6d70]">Nessun referente registrato.</p>
        ) : (
          <div className="space-y-2">
            {contacts.map((contact) => (
              <div
                key={contact.id}
                className="flex items-center justify-between gap-4 rounded-[14px] border border-[#e7dfd8] bg-white px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-[#2B2D2F]">
                    {contact.name} <span className="font-normal text-[#6a6d70]">· {contact.role}</span>
                  </p>
                  <p className="truncate text-sm text-[#6a6d70]">
                    {nd(contact.phone)} · {nd(contact.email)}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleDeleteContact(contact)}
                  disabled={deletingId === contact.id}
                  aria-label={`Elimina ${contact.name}`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#8a3a3a] transition hover:bg-[#fbeeee] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deletingId === contact.id ? "…" : "🗑"}
                </button>
              </div>
            ))}
          </div>
        )}

        {isConsulenza && client.structure_id && (
          <div className="mt-5 border-t border-[#e7dfd8] pt-5">
            <AppButton href={`/performance/${client.structure_id}`} variant="ghost">
              Vai alla scheda struttura in Performance{structureName ? ` — ${structureName}` : ""} →
            </AppButton>
          </div>
        )}
      </AppCard>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">{label}</p>
      <p className="mt-2 text-sm text-[#2B2D2F]">{value}</p>
    </div>
  );
}

function EditField({
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

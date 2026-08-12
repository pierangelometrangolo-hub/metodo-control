"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { AppBadge } from "@/components/ui/AppBadge";
import { ClientAvatar } from "@/components/crm/ClientAvatar";
import { supabase } from "@/lib/supabaseClient";
import { canViewModule } from "@/lib/permissions";
import {
  CrmClient,
  CrmClientType,
  clientTypeLabels,
  badgeStatusLabels,
  badgeStatusVariant,
  consultantDisplayName,
  isExpiringWithinMonths,
} from "@/lib/crm";

type TypeFilter = "tutti" | CrmClientType;

const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: "tutti", label: "Tutti" },
  { value: "consulenza", label: "Consulenza" },
  { value: "formazione", label: "Formazione" },
  { value: "pdo", label: "PDO" },
];

type ProfileLite = { id: string; nome: string | null; cognome: string | null };

export default function CrmListPage() {
  const router = useRouter();

  const [accessState, setAccessState] = useState<"checking" | "granted" | "denied">("checking");
  const [clients, setClients] = useState<CrmClient[]>([]);
  const [profilesById, setProfilesById] = useState<Map<string, ProfileLite>>(new Map());
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("tutti");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

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

  const activeCount = useMemo(() => clients.filter((c) => c.status === "attivo").length, [clients]);

  const expiringCount = useMemo(
    () =>
      clients.filter(
        (c) => c.client_type === "consulenza" && isExpiringWithinMonths(c.contract_end_date, 6)
      ).length,
    [clients]
  );

  const prospectCount = useMemo(() => clients.filter((c) => c.status === "prospect").length, [clients]);

  const filteredClients = useMemo(
    () => (typeFilter === "tutti" ? clients : clients.filter((c) => c.client_type === typeFilter)),
    [clients, typeFilter]
  );

  if (accessState !== "granted") {
    return null;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="CRM"
        title="Clienti"
        description="Anagrafica unificata dei clienti MeToDo — Consulenza, Formazione, PDO."
      />

      <section className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
        <KpiCard title="Clienti attivi" value={activeCount.toString()} note="Su tutti i tipi cliente" href="/crm" active />
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
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl text-[#2B2D2F]">Elenco clienti</h2>
            <p className="mt-2 text-sm text-[#555555]">
              {filteredClients.length} {filteredClients.length === 1 ? "cliente" : "clienti"}
              {typeFilter !== "tutti" ? ` · ${clientTypeLabels[typeFilter]}` : ""}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setTypeFilter(f.value)}
                className={`rounded-[14px] px-4 py-2 text-sm font-semibold transition ${
                  typeFilter === f.value
                    ? "bg-teal text-white"
                    : "border border-[#e7dfd8] bg-white text-[#2B2D2F] hover:bg-[#f8f6f2]"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
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
                  <p className="truncate font-semibold text-[#2B2D2F]">{client.business_name}</p>
                  <p className="truncate text-sm text-[#6a6d70]">
                    {clientTypeLabels[client.client_type]} · Consulente: {consultantDisplayName(client.assigned_consultant_id, profilesById)}
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
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { AppCard } from "@/components/ui/AppCard";
import { AppButton } from "@/components/ui/AppButton";
import { AppInput } from "@/components/ui/AppInput";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { supabase } from "@/lib/supabaseClient";
import { getUserLevelRank, UserLevel } from "@/lib/permissions";

const MASTER_RANK = 3;
const USER_LEVELS: UserLevel[] = ["user", "senior", "master"];

type ProfileRow = {
  id: string;
  nome: string | null;
  cognome: string | null;
  email: string | null;
  level: UserLevel;
  is_active: boolean;
};

type ModuleRow = {
  id: string;
  key: string;
  name: string;
  sort_order: number;
};

type LevelModuleAccessRow = {
  level: UserLevel;
  module_id: string;
  can_view: boolean;
};

type UserModuleOverrideRow = {
  user_id: string;
  module_id: string;
  can_view: boolean;
};

type CreateFormState = {
  nome: string;
  cognome: string;
  email: string;
  password: string;
  level: UserLevel;
};

const levelBadgeClasses: Record<UserLevel, string> = {
  user: "border-[#e7dfd8] bg-[#fcfbf9] text-[#2B2D2F]",
  senior: "border-[#dbe8eb] bg-[#f3f8fa] text-[#017A92]",
  master: "border-[#e9d8b0] bg-[#fbf3df] text-[#8a6a1f]",
};

async function getAccessToken() {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return session?.access_token || null;
}

export default function AdminUtentiPage() {
  const router = useRouter();

  const [accessState, setAccessState] = useState<"checking" | "granted" | "denied">(
    "checking"
  );

  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [levelDefaults, setLevelDefaults] = useState<
    Record<UserLevel, Record<string, boolean>>
  >({ user: {}, senior: {}, master: {} });
  const [userOverrides, setUserOverrides] = useState<
    Record<string, Record<string, boolean>>
  >({});

  const [createForm, setCreateForm] = useState<CreateFormState>({
    nome: "",
    cognome: "",
    email: "",
    password: "",
    level: "user",
  });
  const [createModuleChecks, setCreateModuleChecks] = useState<Record<string, boolean>>(
    {}
  );
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editModuleChecks, setEditModuleChecks] = useState<Record<string, boolean>>({});
  const [savingModules, setSavingModules] = useState(false);
  const [updatingLevelUserId, setUpdatingLevelUserId] = useState<string | null>(null);

  const visibleModules = useMemo(
    () => modules.filter((m) => m.key !== "admin_users"),
    [modules]
  );

  useEffect(() => {
    void checkAccessAndLoad();
  }, []);

  async function checkAccessAndLoad() {
    const rank = await getUserLevelRank();

    if (rank === null || rank < MASTER_RANK) {
      setAccessState("denied");
      router.replace("/dashboard");
      return;
    }

    setAccessState("granted");
    await loadData();
  }

  async function loadData() {
    const [
      { data: usersData, error: usersError },
      { data: modulesData, error: modulesError },
      { data: accessData, error: accessError },
      { data: overridesData, error: overridesError },
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, nome, cognome, email, level, is_active")
        .order("nome", { ascending: true }),
      supabase.from("modules").select("id, key, name, sort_order").order("sort_order"),
      supabase.from("level_module_access").select("level, module_id, can_view"),
      supabase.from("user_module_overrides").select("user_id, module_id, can_view"),
    ]);

    if (usersError) console.error("Errore recupero utenti:", usersError.message);
    if (modulesError) console.error("Errore recupero moduli:", modulesError.message);
    if (accessError) console.error("Errore recupero default livello:", accessError.message);
    if (overridesError) console.error("Errore recupero override:", overridesError.message);

    setUsers((usersData as ProfileRow[]) || []);
    setModules((modulesData as ModuleRow[]) || []);

    const defaults: Record<UserLevel, Record<string, boolean>> = {
      user: {},
      senior: {},
      master: {},
    };
    ((accessData as LevelModuleAccessRow[]) || []).forEach((row) => {
      defaults[row.level][row.module_id] = row.can_view;
    });
    setLevelDefaults(defaults);

    const overrides: Record<string, Record<string, boolean>> = {};
    ((overridesData as UserModuleOverrideRow[]) || []).forEach((row) => {
      if (!overrides[row.user_id]) overrides[row.user_id] = {};
      overrides[row.user_id][row.module_id] = row.can_view;
    });
    setUserOverrides(overrides);
  }

  function defaultsForLevel(level: UserLevel, moduleList: ModuleRow[]) {
    const checks: Record<string, boolean> = {};
    moduleList.forEach((m) => {
      checks[m.id] = levelDefaults[level]?.[m.id] ?? false;
    });
    return checks;
  }

  function handleCreateLevelChange(level: UserLevel) {
    setCreateForm((prev) => ({ ...prev, level }));
    setCreateModuleChecks(defaultsForLevel(level, visibleModules));
  }

  useEffect(() => {
    if (visibleModules.length > 0 && Object.keys(createModuleChecks).length === 0) {
      setCreateModuleChecks(defaultsForLevel(createForm.level, visibleModules));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleModules]);

  async function handleCreateSubmit(event: React.FormEvent) {
    event.preventDefault();
    setCreateError("");

    if (!createForm.nome || !createForm.email || !createForm.password) {
      setCreateError("Nome, email e password sono obbligatori");
      return;
    }

    const defaults = defaultsForLevel(createForm.level, visibleModules);
    const moduleOverrides = visibleModules
      .filter((m) => createModuleChecks[m.id] !== defaults[m.id])
      .map((m) => ({ moduleKey: m.key, canView: createModuleChecks[m.id] }));

    setCreating(true);

    const token = await getAccessToken();
    if (!token) {
      setCreateError("Sessione non valida, rieffettua il login");
      setCreating(false);
      return;
    }

    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        nome: createForm.nome,
        cognome: createForm.cognome || undefined,
        email: createForm.email,
        password: createForm.password,
        level: createForm.level,
        moduleOverrides,
      }),
    });

    const body = await response.json();
    setCreating(false);

    if (!response.ok) {
      setCreateError(body.error || "Creazione utente fallita");
      return;
    }

    setCreateForm({ nome: "", cognome: "", email: "", password: "", level: "user" });
    setCreateModuleChecks(defaultsForLevel("user", visibleModules));
    await loadData();
  }

  async function handleLevelChange(user: ProfileRow, newLevel: UserLevel) {
    if (newLevel === user.level) return;

    setUpdatingLevelUserId(user.id);
    const token = await getAccessToken();

    if (!token) {
      setUpdatingLevelUserId(null);
      return;
    }

    const response = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ level: newLevel }),
    });

    setUpdatingLevelUserId(null);

    if (!response.ok) {
      const body = await response.json();
      console.error("Errore aggiornamento livello utente:", body.error);
      return;
    }

    await loadData();
  }

  async function handleToggleActive(user: ProfileRow) {
    const token = await getAccessToken();
    if (!token) return;

    const response = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ isActive: !user.is_active }),
    });

    if (!response.ok) {
      const body = await response.json();
      console.error("Errore aggiornamento stato utente:", body.error);
      return;
    }

    await loadData();
  }

  function openModuleEditor(user: ProfileRow) {
    const defaults = defaultsForLevel(user.level, visibleModules);
    const overrides = userOverrides[user.id] || {};

    const checks: Record<string, boolean> = {};
    visibleModules.forEach((m) => {
      checks[m.id] = overrides[m.id] !== undefined ? overrides[m.id] : defaults[m.id];
    });

    setEditingUserId(user.id);
    setEditModuleChecks(checks);
  }

  async function handleSaveModuleOverrides() {
    if (!editingUserId) return;

    const overrides = visibleModules.map((m) => ({
      moduleKey: m.key,
      canView: editModuleChecks[m.id],
    }));

    setSavingModules(true);
    const token = await getAccessToken();

    if (!token) {
      setSavingModules(false);
      return;
    }

    const response = await fetch(`/api/admin/users/${editingUserId}/modules`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ overrides }),
    });

    setSavingModules(false);

    if (!response.ok) {
      const body = await response.json();
      console.error("Errore aggiornamento override moduli:", body.error);
      return;
    }

    setEditingUserId(null);
    await loadData();
  }

  if (accessState !== "granted") {
    return null;
  }

  const editingUser = users.find((u) => u.id === editingUserId) || null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Amministrazione"
        title="Gestione Utenti"
        description="Crea utenti, gestisci livello, stato e visibilità dei moduli."
      />

      <AppCard title="Utenti" subtitle={`${users.length} profili`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[#e7dfd8] text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                <th className="pb-3 pr-4">Nome</th>
                <th className="pb-3 pr-4">Email</th>
                <th className="pb-3 pr-4">Livello</th>
                <th className="pb-3 pr-4">Stato</th>
                <th className="pb-3">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-[#f0ece6] last:border-0">
                  <td className="py-3 pr-4 text-[#2B2D2F]">
                    {user.nome} {user.cognome || ""}
                  </td>
                  <td className="py-3 pr-4 text-[#5f6368]">{user.email}</td>
                  <td className="py-3 pr-4">
                    <select
                      value={user.level}
                      disabled={updatingLevelUserId === user.id}
                      onChange={(e) =>
                        handleLevelChange(user, e.target.value as UserLevel)
                      }
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold outline-none disabled:cursor-not-allowed disabled:opacity-60 ${levelBadgeClasses[user.level]}`}
                    >
                      {USER_LEVELS.map((level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                        user.is_active
                          ? "border-[#cfe3d3] bg-[#f2f8f3] text-[#2f7d43]"
                          : "border-[#e7dfd8] bg-[#fcfbf9] text-[#8a3a3a]"
                      }`}
                    >
                      {user.is_active ? "Attivo" : "Disattivo"}
                    </span>
                  </td>
                  <td className="py-3">
                    <div className="flex gap-2">
                      <AppButton variant="secondary" onClick={() => openModuleEditor(user)}>
                        Moduli
                      </AppButton>
                      <AppButton
                        variant={user.is_active ? "secondary" : "primary"}
                        onClick={() => handleToggleActive(user)}
                      >
                        {user.is_active ? "Disattiva" : "Attiva"}
                      </AppButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AppCard>

      <AppCard title="Crea utente">
        <form className="space-y-5" onSubmit={handleCreateSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                Nome
              </label>
              <AppInput
                value={createForm.nome}
                onChange={(e) =>
                  setCreateForm((prev) => ({ ...prev, nome: e.target.value }))
                }
              />
            </div>

            <div>
              <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                Cognome
              </label>
              <AppInput
                value={createForm.cognome}
                onChange={(e) =>
                  setCreateForm((prev) => ({ ...prev, cognome: e.target.value }))
                }
              />
            </div>

            <div>
              <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                Email
              </label>
              <AppInput
                type="email"
                value={createForm.email}
                onChange={(e) =>
                  setCreateForm((prev) => ({ ...prev, email: e.target.value }))
                }
              />
            </div>

            <div>
              <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                Password temporanea
              </label>
              <AppInput
                type="password"
                value={createForm.password}
                onChange={(e) =>
                  setCreateForm((prev) => ({ ...prev, password: e.target.value }))
                }
              />
            </div>

            <div>
              <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
                Livello
              </label>
              <select
                value={createForm.level}
                onChange={(e) => handleCreateLevelChange(e.target.value as UserLevel)}
                className="h-11 w-full rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 text-sm text-[#2B2D2F] outline-none transition focus:border-[#017A92] focus:bg-white"
              >
                {USER_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b625c]">
              Moduli visibili
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {visibleModules.map((m) => (
                <label
                  key={m.id}
                  className="flex items-center gap-2 rounded-[12px] border border-[#e7dfd8] bg-[#fcfbf9] px-3 py-2 text-sm text-[#2B2D2F]"
                >
                  <input
                    type="checkbox"
                    checked={createModuleChecks[m.id] ?? false}
                    onChange={(e) =>
                      setCreateModuleChecks((prev) => ({
                        ...prev,
                        [m.id]: e.target.checked,
                      }))
                    }
                  />
                  {m.name}
                </label>
              ))}
            </div>
          </div>

          {createError && <p className="text-sm text-[#8a3a3a]">{createError}</p>}

          <AppButton variant="primary" disabled={creating}>
            {creating ? "Creazione in corso..." : "Crea utente"}
          </AppButton>
        </form>
      </AppCard>

      {editingUser && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4"
          onClick={() => setEditingUserId(null)}
        >
          <div
            className="w-full max-w-lg rounded-[20px] border border-[#e7dfd8] bg-white p-6 shadow-[0_12px_30px_rgba(43,45,47,0.12)]"
            onClick={(e) => e.stopPropagation()}
          >
            <SectionHeader
              title={`Moduli — ${editingUser.nome || editingUser.email}`}
              description="Le eccezioni evidenziate differiscono dal default del livello."
            />

            <div className="mt-5 grid gap-2">
              {visibleModules.map((m) => {
                const isOverride = userOverrides[editingUserId!]?.[m.id] !== undefined;

                return (
                  <label
                    key={m.id}
                    className={`flex items-center gap-2 rounded-[12px] border px-3 py-2 text-sm text-[#2B2D2F] ${
                      isOverride
                        ? "border-[#017A92] bg-[#f3f8fa]"
                        : "border-[#e7dfd8] bg-[#fcfbf9]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={editModuleChecks[m.id] ?? false}
                      onChange={(e) =>
                        setEditModuleChecks((prev) => ({
                          ...prev,
                          [m.id]: e.target.checked,
                        }))
                      }
                    />
                    {m.name}
                    {isOverride && (
                      <span className="ml-auto text-[10px] font-semibold uppercase tracking-[0.08em] text-[#017A92]">
                        Eccezione
                      </span>
                    )}
                  </label>
                );
              })}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <AppButton variant="secondary" onClick={() => setEditingUserId(null)}>
                Annulla
              </AppButton>
              <AppButton variant="primary" onClick={handleSaveModuleOverrides}>
                {savingModules ? "Salvataggio..." : "Salva"}
              </AppButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

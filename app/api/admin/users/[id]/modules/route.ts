import { NextResponse } from "next/server";
import { requireMasterUser } from "@/lib/adminAuth";

type ModuleOverrideInput = {
  moduleKey: string;
  canView: boolean;
};

type UpdateModulesBody = {
  overrides: ModuleOverrideInput[];
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMasterUser(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  const { supabaseAdmin } = auth;

  let body: UpdateModulesBody;
  try {
    body = (await request.json()) as UpdateModulesBody;
  } catch {
    return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
  }

  if (!Array.isArray(body.overrides) || body.overrides.length === 0) {
    return NextResponse.json(
      { error: "overrides deve essere un array non vuoto di {moduleKey, canView}" },
      { status: 400 }
    );
  }

  const { data: targetProfile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("level")
    .eq("id", id)
    .single();

  if (profileError || !targetProfile) {
    return NextResponse.json({ error: "Utente non trovato" }, { status: 404 });
  }

  const userLevel = targetProfile.level as string;
  const moduleKeys = body.overrides.map((o) => o.moduleKey);

  const { data: modules, error: modulesError } = await supabaseAdmin
    .from("modules")
    .select("id, key, level_module_access(can_view)")
    .eq("level_module_access.level", userLevel)
    .in("key", moduleKeys);

  if (modulesError) {
    return NextResponse.json({ error: modulesError.message }, { status: 500 });
  }

  type ModuleWithDefault = {
    id: string;
    key: string;
    level_module_access: { can_view: boolean }[];
  };

  const moduleByKey = new Map(
    ((modules as ModuleWithDefault[]) || []).map((m) => [
      m.key,
      { id: m.id, defaultCanView: m.level_module_access[0]?.can_view ?? false },
    ])
  );

  const unknownKeys = moduleKeys.filter((key) => !moduleByKey.has(key));
  if (unknownKeys.length > 0) {
    return NextResponse.json(
      { error: `moduleKey sconosciuti: ${unknownKeys.join(", ")}` },
      { status: 400 }
    );
  }

  const rowsToUpsert: { user_id: string; module_id: string; can_view: boolean }[] = [];
  const moduleIdsToClear: string[] = [];

  for (const override of body.overrides) {
    const moduleInfo = moduleByKey.get(override.moduleKey)!;

    if (override.canView === moduleInfo.defaultCanView) {
      moduleIdsToClear.push(moduleInfo.id);
    } else {
      rowsToUpsert.push({
        user_id: id,
        module_id: moduleInfo.id,
        can_view: override.canView,
      });
    }
  }

  if (rowsToUpsert.length > 0) {
    const { error: upsertError } = await supabaseAdmin
      .from("user_module_overrides")
      .upsert(rowsToUpsert, { onConflict: "user_id,module_id" });

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }
  }

  if (moduleIdsToClear.length > 0) {
    const { error: deleteError } = await supabaseAdmin
      .from("user_module_overrides")
      .delete()
      .eq("user_id", id)
      .in("module_id", moduleIdsToClear);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}

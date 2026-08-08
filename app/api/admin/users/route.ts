import { NextResponse } from "next/server";
import { requireMasterUser } from "@/lib/adminAuth";
import type { UserLevel } from "@/lib/permissions";

type ModuleOverrideInput = {
  moduleKey: string;
  canView: boolean;
};

type CreateUserBody = {
  nome: string;
  cognome?: string;
  email: string;
  password: string;
  level: UserLevel;
  moduleOverrides?: ModuleOverrideInput[];
};

const VALID_LEVELS: UserLevel[] = ["user", "senior", "master"];

export async function POST(request: Request) {
  const auth = await requireMasterUser(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: CreateUserBody;
  try {
    body = (await request.json()) as CreateUserBody;
  } catch {
    return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
  }

  if (!body.nome || !body.email || !body.password || !body.level) {
    return NextResponse.json(
      { error: "Campi obbligatori mancanti: nome, email, password, level" },
      { status: 400 }
    );
  }

  if (!VALID_LEVELS.includes(body.level)) {
    return NextResponse.json(
      { error: `level non valido, valori ammessi: ${VALID_LEVELS.join(", ")}` },
      { status: 400 }
    );
  }

  const { supabaseAdmin } = auth;

  const { data: createdUser, error: createUserError } =
    await supabaseAdmin.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
    });

  if (createUserError || !createdUser?.user?.id) {
    return NextResponse.json(
      { error: createUserError?.message || "Creazione utente fallita" },
      { status: 400 }
    );
  }

  const newUserId = createdUser.user.id;

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .upsert(
      {
        id: newUserId,
        nome: body.nome,
        cognome: body.cognome || null,
        email: body.email,
        level: body.level,
      },
      { onConflict: "id" }
    )
    .select("id, nome, cognome, email, level, is_active")
    .single();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const overrides = body.moduleOverrides || [];

  if (overrides.length > 0) {
    const moduleKeys = overrides.map((o) => o.moduleKey);

    const { data: modules, error: modulesError } = await supabaseAdmin
      .from("modules")
      .select("id, key")
      .in("key", moduleKeys);

    if (modulesError) {
      return NextResponse.json({ error: modulesError.message }, { status: 500 });
    }

    const moduleIdByKey = new Map(
      (modules || []).map((m: { id: string; key: string }) => [m.key, m.id])
    );

    const unknownKeys = moduleKeys.filter((key) => !moduleIdByKey.has(key));
    if (unknownKeys.length > 0) {
      return NextResponse.json(
        { error: `moduleKey sconosciuti: ${unknownKeys.join(", ")}` },
        { status: 400 }
      );
    }

    const overrideRows = overrides.map((o) => ({
      user_id: newUserId,
      module_id: moduleIdByKey.get(o.moduleKey),
      can_view: o.canView,
    }));

    const { error: overridesError } = await supabaseAdmin
      .from("user_module_overrides")
      .insert(overrideRows);

    if (overridesError) {
      return NextResponse.json({ error: overridesError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ profile }, { status: 201 });
}

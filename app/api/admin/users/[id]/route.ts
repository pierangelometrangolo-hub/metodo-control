import { NextResponse } from "next/server";
import { requireMasterUser } from "@/lib/adminAuth";
import type { UserLevel } from "@/lib/permissions";

type UpdateUserBody = {
  level?: UserLevel;
  isActive?: boolean;
};

const VALID_LEVELS: UserLevel[] = ["user", "senior", "master"];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMasterUser(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;

  let body: UpdateUserBody;
  try {
    body = (await request.json()) as UpdateUserBody;
  } catch {
    return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
  }

  if (body.level !== undefined && !VALID_LEVELS.includes(body.level)) {
    return NextResponse.json(
      { error: `level non valido, valori ammessi: ${VALID_LEVELS.join(", ")}` },
      { status: 400 }
    );
  }

  const patch: { level?: UserLevel; is_active?: boolean } = {};
  if (body.level !== undefined) patch.level = body.level;
  if (body.isActive !== undefined) patch.is_active = body.isActive;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "Nessun campo da aggiornare (level e/o isActive)" },
      { status: 400 }
    );
  }

  // Nota: un cambio di level NON cancella automaticamente eventuali
  // user_module_overrides esistenti per questo utente. Comportamento
  // esplicitamente richiesto: nessuna pulizia automatica senza conferma.
  const { data: profile, error } = await auth.supabaseAdmin
    .from("profiles")
    .update(patch)
    .eq("id", id)
    .select("id, nome, cognome, email, level, is_active")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ profile });
}

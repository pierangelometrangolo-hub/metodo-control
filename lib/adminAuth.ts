import { createClient, SupabaseClient } from "@supabase/supabase-js";

const MASTER_RANK = 3;

export type RequireMasterUserResult =
  | { ok: true; userId: string; supabaseAdmin: SupabaseClient }
  | { ok: false; status: number; error: string };

export async function requireMasterUser(
  request: Request
): Promise<RequireMasterUserResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return { ok: false, status: 500, error: "Configurazione Supabase mancante" };
  }

  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return { ok: false, status: 401, error: "Authorization header mancante" };
  }

  const token = authorization.replace(/^Bearer\s+/i, "");
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user?.id) {
    return { ok: false, status: 401, error: "Utente non autenticato" };
  }

  const { data: userLevelRank, error: rankError } = await supabase.rpc(
    "fn_user_level_rank",
    { p_user_id: user.id }
  );

  if (rankError || userLevelRank == null || userLevelRank < MASTER_RANK) {
    return {
      ok: false,
      status: 403,
      error: "Permesso negato: richiesto livello master",
    };
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

  return { ok: true, userId: user.id, supabaseAdmin };
}

import { supabase } from "@/lib/supabaseClient";

export type UserLevel = "user" | "senior" | "master";

const moduleAccessCache = new Map<string, boolean>();
const userLevelRankCache = new Map<string, number>();

export async function canViewModule(moduleKey: string): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return false;

  const cacheKey = `${user.id}::${moduleKey}`;

  const cached = moduleAccessCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const { data, error } = await supabase.rpc("fn_user_can_view_module", {
    p_user_id: user.id,
    p_module_key: moduleKey,
  });

  if (error) {
    console.error("Errore verifica permesso modulo:", error.message);
    return false;
  }

  const userCanView = data === true;
  moduleAccessCache.set(cacheKey, userCanView);

  return userCanView;
}

export async function getUserLevelRank(): Promise<number | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const cached = userLevelRankCache.get(user.id);
  if (cached !== undefined) return cached;

  const { data, error } = await supabase.rpc("fn_user_level_rank", {
    p_user_id: user.id,
  });

  if (error || data == null) {
    console.error("Errore verifica rank utente:", error?.message);
    return null;
  }

  const userLevelRank = data as number;
  userLevelRankCache.set(user.id, userLevelRank);

  return userLevelRank;
}

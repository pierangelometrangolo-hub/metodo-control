<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type RegisterNotificationPayload = {
  onesignal_player_id?: string | null;
=======
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type RegisterPayload = {
  onesignal_player_id: string;
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
  onesignal_subscription_id?: string | null;
  external_user_id?: string | null;
  permission?: "default" | "denied" | "granted";
  is_active?: boolean;
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
  device_info?: unknown;
};

function jsonError(error: string, details: unknown, status: number) {
  return NextResponse.json({ error, details }, { status });
}

function errorDetails(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return error;
=======
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
  device_info?: Record<string, unknown>;
};

function getServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Missing Supabase server env vars");
  }

  return createClient(url, serviceRoleKey);
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
}

export async function POST(request: Request) {
  try {
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return jsonError(
        "Configurazione Supabase mancante",
        {
          hasUrl: Boolean(supabaseUrl),
          hasAnonKey: Boolean(supabaseAnonKey),
        },
        500
      );
    }

    const authorization = request.headers.get("authorization");

    if (!authorization) {
      return jsonError("Authorization header mancante", null, 401);
    }

    const token = authorization.replace(/^Bearer\s+/i, "");
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user?.id) {
      return jsonError("Utente non autenticato", userError?.message || null, 401);
    }

    let payload: RegisterNotificationPayload;

    try {
      payload = (await request.json()) as RegisterNotificationPayload;
    } catch (error) {
      return jsonError("Body JSON non valido", errorDetails(error), 400);
    }

    if (!payload.onesignal_player_id) {
      return jsonError("onesignal_player_id mancante", payload, 400);
    }

    if (payload.external_user_id && payload.external_user_id !== user.id) {
      return jsonError(
        "external_user_id non corrisponde all'utente autenticato",
        { external_user_id: payload.external_user_id, user_id: user.id },
        403
      );
    }

    const subscriptionRow = {
      user_id: user.id,
      onesignal_player_id: payload.onesignal_player_id,
      onesignal_subscription_id: payload.onesignal_subscription_id || null,
      permission: payload.permission || "default",
      is_active: Boolean(payload.is_active),
      device_info: payload.device_info || null,
    };

    const { data, error } = await supabase
      .from("user_push_subscriptions")
      .upsert(subscriptionRow, {
        onConflict: "user_id,onesignal_player_id",
      })
      .select()
      .single();

    if (error) {
      return jsonError("Errore salvataggio subscription", error, 500);
    }

    return NextResponse.json({ ok: true, subscription: data }, { status: 200 });
  } catch (error) {
    return jsonError("Errore inatteso register notifications", errorDetails(error), 500);
=======
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
    const authHeader = request.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();

    const supabaseServer = getServerSupabaseClient();

    let userId: string | null = null;

    if (token) {
      const {
        data: { user },
      } = await supabaseServer.auth.getUser(token);
      userId = user?.id || null;
    }

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as RegisterPayload;

    if (!body.onesignal_player_id) {
      return NextResponse.json({ error: "onesignal_player_id is required" }, { status: 400 });
    }

    const upsertPayload = {
      user_id: userId,
      profile_id: userId,
      provider: "onesignal",
      onesignal_player_id: body.onesignal_player_id,
      onesignal_subscription_id: body.onesignal_subscription_id || null,
      external_user_id: body.external_user_id || userId,
      device_info: body.device_info || {},
      permission: body.permission || "default",
      is_active: body.is_active ?? true,
      last_seen_at: new Date().toISOString(),
    };

    const { error } = await supabaseServer
      .from("user_push_subscriptions")
      .upsert(upsertPayload, { onConflict: "onesignal_player_id" });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
  }
}

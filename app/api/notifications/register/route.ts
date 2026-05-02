import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type RegisterNotificationPayload = {
  onesignal_player_id?: string | null;
  onesignal_subscription_id?: string | null;
  external_user_id?: string | null;
  permission?: "default" | "denied" | "granted";
  is_active?: boolean;
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
}

export async function POST(request: Request) {
  try {
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
  }
}

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type BudgetReviewPayload = {
  structureId?: string;
  structureName?: string;
  seasonYear?: number;
};

function jsonError(error: string, details: unknown, status: number) {
  return NextResponse.json({ error, details }, { status });
}

function errorDetails(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}

// Notifica broadcast a TUTTI i master (nessun concetto di "master
// responsabile per struttura" in questo schema, stesso principio gia'
// confermato per Import/Commissioni: non inventare una segmentazione che
// non esiste). Stesso pattern gia' in uso in send-assignment/route.ts
// (supabaseAdmin per il lookup cross-utente delle subscription, REST API
// OneSignal con header "Authorization: Key ...") - non riusa pero' la
// tabella notification_events, il cui event_type ha un CHECK constraint
// chiuso pensato solo per assignment di task/subtask (verificato con un
// insert di prova, respinto da notification_events_event_type_check) -
// estenderlo sarebbe fuori scope qui, quindi la notifica viene inviata e
// basta, senza un log strutturato a DB.
export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const oneSignalAppId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
    const oneSignalRestApiKey = process.env.ONESIGNAL_REST_API_KEY;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      return jsonError(
        "Configurazione Supabase mancante",
        {
          hasUrl: Boolean(supabaseUrl),
          hasAnonKey: Boolean(supabaseAnonKey),
          hasServiceRoleKey: Boolean(supabaseServiceRoleKey),
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
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    // Service role: serve a leggere profili/subscription di utenti diversi
    // da chi sta sottomettendo la proposta (i master destinatari), oltre
    // a verificare il livello di chi chiama senza fidarsi del client.
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user?.id) {
      return jsonError("Utente non autenticato", userError?.message || null, 401);
    }

    const { data: rankData, error: rankError } = await supabaseAdmin.rpc("fn_user_level_rank", {
      p_user_id: user.id,
    });

    if (rankError || rankData === null || Number(rankData) < 2) {
      return jsonError("Permesso negato: richiesto livello senior/master", null, 403);
    }

    let payload: BudgetReviewPayload;
    try {
      payload = (await request.json()) as BudgetReviewPayload;
    } catch (error) {
      return jsonError("Body JSON non valido", errorDetails(error), 400);
    }

    if (!payload.structureId || !payload.structureName || !payload.seasonYear) {
      return jsonError("Payload incompleto: structureId, structureName, seasonYear richiesti", payload, 400);
    }

    const { data: masters, error: mastersError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("level", "master");

    if (mastersError) {
      return jsonError("Errore lettura master", mastersError, 500);
    }

    const masterIds = (masters || []).map((m: { id: string }) => m.id);

    if (masterIds.length === 0) {
      return NextResponse.json({ ok: false, status: "skipped", reason: "no masters found" }, { status: 200 });
    }

    const { data: subscriptions, error: subscriptionsError } = await supabaseAdmin
      .from("user_push_subscriptions")
      .select("onesignal_player_id")
      .in("user_id", masterIds)
      .eq("is_active", true);

    if (subscriptionsError) {
      return jsonError("Errore lettura subscription push", subscriptionsError, 500);
    }

    const subscriptionIds = ((subscriptions as { onesignal_player_id: string | null }[]) || [])
      .map((s) => s.onesignal_player_id)
      .filter((id): id is string => Boolean(id));

    if (subscriptionIds.length === 0) {
      return NextResponse.json(
        { ok: false, status: "skipped", reason: "no active master subscriptions" },
        { status: 200 }
      );
    }

    if (!oneSignalAppId || !oneSignalRestApiKey) {
      return jsonError(
        "Configurazione OneSignal mancante",
        { hasAppId: Boolean(oneSignalAppId), hasRestApiKey: Boolean(oneSignalRestApiKey) },
        500
      );
    }

    const deepLink = `/performance/budget?struttura=${payload.structureId}&anno=${payload.seasonYear}`;
    const title = "Budget da revisionare";
    const message = `${payload.structureName}: budget ${payload.seasonYear} sottomesso per revisione.`;

    const oneSignalResponse = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${oneSignalRestApiKey}`,
      },
      body: JSON.stringify({
        app_id: oneSignalAppId,
        include_subscription_ids: subscriptionIds,
        headings: { it: title, en: title },
        contents: { it: message, en: message },
        url: appUrl ? new URL(deepLink, appUrl).toString() : deepLink,
        data: {
          eventType: "budget_submitted_for_review",
          structureId: payload.structureId,
          seasonYear: payload.seasonYear,
        },
      }),
    });

    const oneSignalResponseText = await oneSignalResponse.text();
    let oneSignalResponseBody: unknown = oneSignalResponseText;
    try {
      oneSignalResponseBody = JSON.parse(oneSignalResponseText);
    } catch {
      oneSignalResponseBody = oneSignalResponseText;
    }

    if (!oneSignalResponse.ok) {
      return NextResponse.json(
        { ok: false, status: "failed", details: { oneSignalStatus: oneSignalResponse.status, oneSignalResponseBody } },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { ok: true, status: "sent", recipientCount: subscriptionIds.length },
      { status: 200 }
    );
  } catch (error) {
    return jsonError("Errore inatteso send budget review notification", errorDetails(error), 500);
  }
}

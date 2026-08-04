import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type AssignmentNotificationPayload = {
  eventType?: "task_assigned" | "subtask_assigned";
  event_type?: "task_assigned" | "subtask_assigned";
  taskId?: string | null;
  task_id?: string | null;
  subtaskId?: string | null;
  subtask_id?: string | null;
  assignedToUserId?: string | null;
  assigned_to_user_id?: string | null;
  title?: string | null;
  message?: string | null;
  deepLink?: string | null;
  deep_link?: string | null;
};

type PushSubscriptionRow = {
  onesignal_player_id: string | null;
  onesignal_subscription_id: string | null;
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

function normalizePayload(payload: AssignmentNotificationPayload) {
  return {
    eventType: payload.eventType || payload.event_type,
    taskId: payload.taskId || payload.task_id,
    subtaskId: payload.subtaskId || payload.subtask_id || null,
    assignedToUserId: payload.assignedToUserId || payload.assigned_to_user_id,
    title: payload.title,
    message: payload.message,
    deepLink: payload.deepLink || payload.deep_link,
  };
}

function buildEventRow(params: {
  eventType: string;
  taskId: string;
  subtaskId: string | null;
  assignedToUserId: string;
  assignedByUserId: string;
  title: string;
  message: string;
  deepLink: string;
  status: "sent" | "failed" | "skipped";
  details: unknown;
}) {
  return {
    event_type: params.eventType,
    task_id: params.taskId,
    subtask_id: params.subtaskId,
    assigned_to_user_id: params.assignedToUserId,
    assigned_by_user_id: params.assignedByUserId,
    title: params.title,
    message: params.message,
    deep_link: params.deepLink,
    status: params.status,
    payload: params.details ?? {},
  };
}

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const oneSignalAppId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
    const oneSignalRestApiKey = process.env.ONESIGNAL_REST_API_KEY;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;

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

    let rawPayload: AssignmentNotificationPayload;

    try {
      rawPayload = (await request.json()) as AssignmentNotificationPayload;
    } catch (error) {
      return jsonError("Body JSON non valido", errorDetails(error), 400);
    }

    const payload = normalizePayload(rawPayload);

    if (
      !payload.eventType ||
      !payload.taskId ||
      !payload.assignedToUserId ||
      !payload.title ||
      !payload.message ||
      !payload.deepLink
    ) {
      return jsonError("Payload notifica assignment incompleto", rawPayload, 400);
    }

    const { data: subscriptions, error: subscriptionsError } = await supabase
      .from("user_push_subscriptions")
      .select("onesignal_player_id, onesignal_subscription_id")
      .eq("user_id", payload.assignedToUserId)
      .eq("is_active", true);

    if (subscriptionsError) {
      return jsonError("Errore lettura subscription push", subscriptionsError, 500);
    }

    const subscriptionIds = ((subscriptions as PushSubscriptionRow[]) || [])
      .map((subscription) => subscription.onesignal_player_id)
      .filter((subscriptionId): subscriptionId is string => Boolean(subscriptionId));

    if (subscriptionIds.length === 0) {
      const skippedDetails = { reason: "no active subscriptions" };

      const { error: eventError } = await supabase.from("notification_events").insert(
        buildEventRow({
          eventType: payload.eventType,
          taskId: payload.taskId,
          subtaskId: payload.subtaskId,
          assignedToUserId: payload.assignedToUserId,
          assignedByUserId: user.id,
          title: payload.title,
          message: payload.message,
          deepLink: payload.deepLink,
          status: "skipped",
          details: skippedDetails,
        })
      );

      if (eventError) {
        return jsonError("Errore salvataggio evento notifica skipped", eventError, 500);
      }

      return NextResponse.json(
        { ok: false, status: "skipped", reason: "no active subscriptions" },
        { status: 200 }
      );
    }

    if (!oneSignalAppId || !oneSignalRestApiKey) {
      const failedDetails = {
        reason: "missing OneSignal configuration",
        hasAppId: Boolean(oneSignalAppId),
        hasRestApiKey: Boolean(oneSignalRestApiKey),
      };

      await supabase.from("notification_events").insert(
        buildEventRow({
          eventType: payload.eventType,
          taskId: payload.taskId,
          subtaskId: payload.subtaskId,
          assignedToUserId: payload.assignedToUserId,
          assignedByUserId: user.id,
          title: payload.title,
          message: payload.message,
          deepLink: payload.deepLink,
          status: "failed",
          details: failedDetails,
        })
      );

      return jsonError("Configurazione OneSignal mancante", failedDetails, 500);
    }

    const oneSignalResponse = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${oneSignalRestApiKey}`,
      },
      body: JSON.stringify({
        app_id: oneSignalAppId,
        include_subscription_ids: subscriptionIds,
        headings: { it: payload.title, en: payload.title },
        contents: { it: payload.message, en: payload.message },
        url: appUrl ? new URL(payload.deepLink, appUrl).toString() : payload.deepLink,
        data: {
          eventType: payload.eventType,
          taskId: payload.taskId,
          subtaskId: payload.subtaskId,
          assignedToUserId: payload.assignedToUserId,
        },
      }),
    });

    const oneSignalResponseText = await oneSignalResponse.text();
    let oneSignalResponseBody: unknown = oneSignalResponseText;

    if (oneSignalResponseText) {
      try {
        oneSignalResponseBody = JSON.parse(oneSignalResponseText);
      } catch {
        oneSignalResponseBody = oneSignalResponseText;
      }
    }

    const eventStatus = oneSignalResponse.ok ? "sent" : "failed";
    const eventDetails = {
      oneSignalStatus: oneSignalResponse.status,
      oneSignalBody: oneSignalResponseBody,
      subscriptionIds,
    };

    const { error: eventError } = await supabase.from("notification_events").insert(
      buildEventRow({
        eventType: payload.eventType,
        taskId: payload.taskId,
        subtaskId: payload.subtaskId,
        assignedToUserId: payload.assignedToUserId,
        assignedByUserId: user.id,
        title: payload.title,
        message: payload.message,
        deepLink: payload.deepLink,
        status: eventStatus,
        details: eventDetails,
      })
    );

    if (eventError) {
      return jsonError("Errore salvataggio evento notifica", eventError, 500);
    }

    if (!oneSignalResponse.ok) {
      return NextResponse.json(
        {
          ok: false,
          status: "failed",
          details: eventDetails,
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        status: "sent",
        details: eventDetails,
      },
      { status: 200 }
    );
  } catch (error) {
    return jsonError("Errore inatteso send assignment notification", errorDetails(error), 500);
  }
}

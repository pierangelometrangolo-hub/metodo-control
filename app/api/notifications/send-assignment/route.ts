import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type AssignmentType = "task_assigned" | "subtask_assigned";

type SendAssignmentPayload = {
  event_type: AssignmentType;
  task_id: string;
  subtask_id?: string;
  assigned_to_user_id: string;
  assigned_by_user_id?: string;
  title: string;
  message: string;
  deep_link: string;
};

function getServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Missing Supabase server env vars");
  }

  return createClient(url, serviceRoleKey);
}

export async function POST(request: Request) {
  const supabaseServer = getServerSupabaseClient();
  const onesignalApiBaseUrl = process.env.ONESIGNAL_API_BASE_URL || "https://api.onesignal.com";
  const onesignalAppId = process.env.ONESIGNAL_APP_ID;
  const onesignalApiKey = process.env.ONESIGNAL_REST_API_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";

  try {
    const authHeader = request.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const {
      data: { user },
    } = await supabaseServer.auth.getUser(token);

    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!onesignalAppId || !onesignalApiKey) {
      return NextResponse.json({ error: "Missing OneSignal env vars" }, { status: 500 });
    }

    const body = (await request.json()) as SendAssignmentPayload;

    if (!body.assigned_to_user_id || !body.task_id || !body.event_type || !body.deep_link) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const { data: subscriptions, error: subscriptionsError } = await supabaseServer
      .from("user_push_subscriptions")
      .select("onesignal_player_id")
      .eq("user_id", body.assigned_to_user_id)
      .eq("is_active", true);

    if (subscriptionsError) {
      return NextResponse.json({ error: subscriptionsError.message }, { status: 500 });
    }

    const includeAliases = (subscriptions || [])
      .map((row) => row.onesignal_player_id)
      .filter(Boolean);

    if (includeAliases.length === 0) {
      await supabaseServer.from("notification_events").insert({
        event_type: body.event_type,
        task_id: body.task_id,
        subtask_id: body.subtask_id || null,
        assigned_to_user_id: body.assigned_to_user_id,
        assigned_by_user_id: body.assigned_by_user_id || user.id,
        title: body.title,
        message: body.message,
        deep_link: body.deep_link,
        payload: body,
        provider: "onesignal",
        status: "failed",
        error_message: "No active push subscriptions",
      });

      return NextResponse.json({ ok: true, skipped: true });
    }

    const deepLinkUrl = body.deep_link.startsWith("http") ? body.deep_link : `${appUrl}${body.deep_link}`;

    const onesignalPayload = {
      app_id: onesignalAppId,
      include_subscription_ids: includeAliases,
      headings: { en: body.title, it: body.title },
      contents: { en: body.message, it: body.message },
      url: deepLinkUrl,
      web_push_topic: body.event_type,
      data: {
        eventType: body.event_type,
        taskId: body.task_id,
        subtaskId: body.subtask_id || null,
        deepLink: body.deep_link,
      },
    };

    const oneSignalResponse = await fetch(`${onesignalApiBaseUrl}/notifications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${onesignalApiKey}`,
      },
      body: JSON.stringify(onesignalPayload),
    });

    const responseData = await oneSignalResponse.json();

    await supabaseServer.from("notification_events").insert({
      event_type: body.event_type,
      task_id: body.task_id,
      subtask_id: body.subtask_id || null,
      assigned_to_user_id: body.assigned_to_user_id,
      assigned_by_user_id: body.assigned_by_user_id || user.id,
      title: body.title,
      message: body.message,
      deep_link: body.deep_link,
      payload: body,
      provider: "onesignal",
      status: oneSignalResponse.ok ? "sent" : "failed",
      provider_response: responseData,
      error_message: oneSignalResponse.ok ? null : JSON.stringify(responseData),
      sent_at: oneSignalResponse.ok ? new Date().toISOString() : null,
    });

    if (!oneSignalResponse.ok) {
      return NextResponse.json({ error: responseData }, { status: 502 });
    }

    return NextResponse.json({ ok: true, response: responseData });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

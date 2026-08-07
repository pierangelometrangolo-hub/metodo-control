import { supabase } from "@/lib/supabaseClient";

declare global {
  interface Window {
    OneSignalDeferred?: Array<(OneSignal: OneSignalClient) => void>;
    OneSignal?: OneSignalClient;
    __oneSignalInitialized?: boolean;
  }
}

export type OneSignalSubscription = {
  id?: string | null;
  token?: string | null;
  optedIn?: boolean;
  optIn?: () => Promise<void>;
};

export type OneSignalUser = {
  addAlias?: (label: string, id: string) => Promise<void>;
  PushSubscription?: OneSignalSubscription;
};

export type OneSignalNotificationClickEvent = {
  notification?: {
    launchURL?: string | null;
    url?: string | null;
    additionalData?: Record<string, unknown> | null;
  };
  result?: {
    url?: string | null;
  };
};

export type OneSignalNotifications = {
  permission?: "default" | "denied" | "granted";
  requestPermission?: () => Promise<void>;
  addEventListener?: (
    event: "click",
    listener: (event: OneSignalNotificationClickEvent) => void
  ) => void;
  removeEventListener?: (
    event: "click",
    listener: (event: OneSignalNotificationClickEvent) => void
  ) => void;
};

export type OneSignalClient = {
  init: (params: {
    appId: string;
    allowLocalhostAsSecureOrigin?: boolean;
    notificationClickHandlerMatch?: "exact" | "origin";
    notificationClickHandlerAction?: "navigate" | "focus";
  }) => Promise<void>;
  User?: OneSignalUser;
  user?: OneSignalUser;
  Notifications?: OneSignalNotifications;
  notifications?: OneSignalNotifications;
};

export type ActivatePushResult =
  | { ok: true; playerId: string }
  | {
      ok: false;
      reason:
        | "no-window"
        | "no-app-id"
        | "sdk-error"
        | "no-user"
        | "permission-denied"
        | "no-subscription"
        | "no-session"
        | "register-error"
        | "unexpected-error";
      detail?: string;
    };

function getErrorMessage(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof error.message === "string"
        ? error.message
        : null;

  try {
    const json = JSON.stringify(error);
    return message || json || String(error);
  } catch {
    return message || String(error);
  }
}

function getAvailableMethodNames(value: unknown) {
  if (!value || typeof value !== "object") return "nessuno";

  const methodNames = new Set<string>();
  let current: object | null = value;

  while (current && current !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      const item = descriptor?.value;

      if (typeof item === "function") {
        methodNames.add(key);
      }
    }

    current = Object.getPrototypeOf(current);
  }

  return Array.from(methodNames).sort().join(", ") || "nessuno";
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function getPermissionFromOneSignal(
  oneSignal: OneSignalClient
): "default" | "denied" | "granted" {
  return oneSignal.Notifications?.permission || oneSignal.notifications?.permission || "default";
}

export function getNotificationPermission(): "default" | "denied" | "granted" {
  if (typeof Notification === "undefined") return "default";
  return Notification.permission;
}

function getOneSignalInstance(
  onDebug: (message: string) => void,
  timeoutMs = 10000
): Promise<OneSignalClient> {
  if (window.OneSignal) {
    onDebug("OneSignal disponibile su window");
    return Promise.resolve(window.OneSignal);
  }

  onDebug("OneSignal assente, uso deferred");

  return new Promise<OneSignalClient>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      onDebug("timeout attesa OneSignal SDK");
      reject(new Error("Timeout attesa OneSignal SDK"));
    }, timeoutMs);

    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push((oneSignal) => {
      window.clearTimeout(timer);
      onDebug("OneSignal deferred risolto");
      resolve(oneSignal);
    });
  });
}

async function ensureOneSignalInitialized(oneSignal: OneSignalClient, appId: string) {
  if (window.__oneSignalInitialized) {
    console.log("[pushNotifications] OneSignal già inizializzato");
    return;
  }

  // match "origin" invece del default "exact": l'URL della notifica ha
  // sempre una query string diversa (taskId/subtaskId), quindi con "exact"
  // il match contro una tab già aperta fallisce quasi sempre. action
  // "focus" lascia al service worker solo il compito di portare la finestra
  // in primo piano — la navigazione vera e propria la fa il click handler
  // client-side (vedi registerNotificationClickHandler), per evitare che
  // le due navigazioni corrano in parallelo.
  await oneSignal.init({
    appId,
    notificationClickHandlerMatch: "origin",
    notificationClickHandlerAction: "focus",
  });
  window.__oneSignalInitialized = true;
  console.log("[pushNotifications] OneSignal init ok");
}

function resolveNotificationClickUrl(event: OneSignalNotificationClickEvent): string | null {
  return event.notification?.launchURL || event.notification?.url || event.result?.url || null;
}

function toRelativePath(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/**
 * Registra il listener per il click su una notifica mentre l'app è già
 * aperta in foreground (il service worker, con action "focus", non naviga
 * la finestra da solo). onNavigate riceve il path relativo (es.
 * "/operations?taskId=...") da passare a router.push(). Restituisce una
 * funzione di cleanup da chiamare all'unmount.
 */
export function registerNotificationClickHandler(onNavigate: (path: string) => void): () => void {
  let cancelled = false;
  let attachedOneSignal: OneSignalClient | null = null;

  const listener = (event: OneSignalNotificationClickEvent) => {
    console.log("[pushNotifications] notification click event", event);

    const rawUrl = resolveNotificationClickUrl(event);

    if (!rawUrl) {
      console.log("[pushNotifications] notification click senza url utilizzabile");
      return;
    }

    onNavigate(toRelativePath(rawUrl));
  };

  getOneSignalInstance(() => {}, 10000)
    .then((oneSignal) => {
      if (cancelled) return;

      const notifications = oneSignal.Notifications || oneSignal.notifications;

      if (!notifications?.addEventListener) {
        console.log(
          "[pushNotifications] addEventListener('click') non disponibile su questo SDK"
        );
        return;
      }

      attachedOneSignal = oneSignal;
      notifications.addEventListener("click", listener);
    })
    .catch((error) => {
      console.error("[pushNotifications] impossibile registrare il click handler:", error);
    });

  return () => {
    cancelled = true;
    const notifications = attachedOneSignal?.Notifications || attachedOneSignal?.notifications;
    notifications?.removeEventListener?.("click", listener);
  };
}

async function waitForSubscriptionId(
  oneSignal: OneSignalClient,
  onDebug: (message: string) => void,
  timeoutMs = 20000
) {
  const start = Date.now();
  onDebug("attesa subscription id iniziata");

  while (Date.now() - start < timeoutMs) {
    const subscription = oneSignal.User?.PushSubscription;
    const playerId = subscription?.id || null;
    const token = subscription?.token || null;
    const optedIn = subscription?.optedIn;

    onDebug(
      `retry subscription id=${playerId || "null"} token=${token || "null"} optedIn=${String(optedIn)}`
    );

    if (playerId) {
      return {
        playerId,
        token,
        optedIn: Boolean(subscription?.optedIn),
      };
    }

    await wait(500);
  }

  onDebug("timeout subscription id");
  return null;
}

/**
 * Esegue il flusso completo di attivazione/refresh della subscription OneSignal.
 * requestPermission=true mostra il prompt di sistema (bottone/banner);
 * requestPermission=false riusa il permesso già concesso per un refresh silenzioso.
 */
export async function activatePushNotifications({
  requestPermission,
  onDebug = () => {},
}: {
  requestPermission: boolean;
  onDebug?: (message: string) => void;
}): Promise<ActivatePushResult> {
  try {
    if (typeof window === "undefined") {
      onDebug("controllo window fallito");
      return { ok: false, reason: "no-window" };
    }

    const oneSignalAppId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;

    if (!oneSignalAppId) {
      onDebug("app id mancante");
      console.log("[pushNotifications] App ID OneSignal mancante");
      return { ok: false, reason: "no-app-id" };
    }

    onDebug("app id presente");

    const oneSignal = await getOneSignalInstance(onDebug, 10000);
    onDebug("OneSignal trovato");

    try {
      await ensureOneSignalInitialized(oneSignal, oneSignalAppId);
      onDebug("OneSignal init ok");
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      onDebug(`OneSignal init fallito: ${errorMessage}`);
      return { ok: false, reason: "sdk-error", detail: errorMessage };
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.id) {
      onDebug("user Supabase non trovato");
      return { ok: false, reason: "no-user" };
    }
    onDebug("user Supabase trovato");

    const oneSignalUser = oneSignal.User || oneSignal.user;
    try {
      if (oneSignalUser?.addAlias) {
        onDebug("addAlias avviato");
        await oneSignalUser.addAlias("external_id", user.id);
        onDebug("addAlias completato");
      } else {
        onDebug("addAlias non disponibile, continuo");
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      onDebug(`addAlias fallito, continuo: ${errorMessage}`);
    }

    const permissionBeforeDebug = getPermissionFromOneSignal(oneSignal);
    console.log("[pushNotifications] permission corrente:", permissionBeforeDebug);

    if (requestPermission) {
      onDebug("request permission avviata");
      await (oneSignal.Notifications?.requestPermission?.() ||
        oneSignal.notifications?.requestPermission?.() ||
        Promise.resolve());
      onDebug("request permission completata");
      await wait(1000);
    }

    const notificationPermission = getNotificationPermission();
    const oneSignalPermission = getPermissionFromOneSignal(oneSignal);
    const permissionGranted =
      notificationPermission === "granted" || oneSignalPermission === "granted";

    onDebug(`Notification.permission = ${notificationPermission}`);
    onDebug(`OneSignal permission = ${oneSignalPermission}`);

    if (!permissionGranted) {
      onDebug("subscription finale: permission non granted");
      return { ok: false, reason: "permission-denied" };
    }

    const subscription = oneSignal.User?.PushSubscription;
    const subscriptionMethods = getAvailableMethodNames(subscription);
    onDebug(`metodi disponibili della subscription: ${subscriptionMethods}`);

    if (subscription?.optIn) {
      onDebug("optIn avviato");
      await subscription.optIn();
      onDebug("optIn completato");
    } else {
      onDebug("optIn non disponibile");
    }

    await wait(2000);

    onDebug("subscription finale avviata");
    const subscriptionData = await waitForSubscriptionId(oneSignal, onDebug, 20000);

    if (!subscriptionData?.playerId) {
      onDebug("subscription non creata dopo optIn");
      return { ok: false, reason: "no-subscription" };
    }

    onDebug("subscription finale: trovata");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      onDebug("token sessione assente: skip register");
      return { ok: false, reason: "no-session" };
    }

    const payload = {
      onesignal_player_id: subscriptionData.playerId,
      onesignal_subscription_id: subscriptionData.token,
      external_user_id: user.id,
      permission:
        notificationPermission === "granted" ? notificationPermission : oneSignalPermission,
      is_active: subscriptionData.optedIn,
      device_info: {
        userAgent: navigator.userAgent,
        language: navigator.language,
        platform: navigator.platform,
      },
    };

    const response = await fetch("/api/notifications/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let responseBody: unknown = null;

    if (responseText) {
      try {
        responseBody = JSON.parse(responseText);
      } catch (error) {
        responseBody = {
          parseError: error instanceof Error ? error.message : String(error),
          raw: responseText,
        };
      }
    }

    const registerBodyText = responseText || JSON.stringify(responseBody);
    onDebug(`register body: ${registerBodyText}`);

    if (!response.ok) {
      onDebug(`register errore status: ${response.status} body: ${registerBodyText}`);
      return { ok: false, reason: "register-error", detail: registerBodyText };
    }

    const registerResult =
      responseBody && typeof responseBody === "object"
        ? (responseBody as { ok?: unknown })
        : null;

    if (registerResult?.ok === true) {
      onDebug("notifiche attivate correttamente");
      return { ok: true, playerId: subscriptionData.playerId };
    }

    onDebug(`register errore body: ${registerBodyText}`);
    return { ok: false, reason: "register-error", detail: registerBodyText };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    onDebug(`errore reale: ${errorMessage}`);
    console.error("[pushNotifications] errore globale attivazione notifiche:", error);
    return { ok: false, reason: "unexpected-error", detail: errorMessage };
  } finally {
    onDebug("fine attivazione notifiche");
  }
}

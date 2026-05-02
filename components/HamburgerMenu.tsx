"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

declare global {
  interface Window {
    OneSignalDeferred?: Array<(OneSignal: OneSignalClient) => void>;
    OneSignal?: OneSignalClient;
    __oneSignalInitialized?: boolean;
  }
}

type OneSignalSubscription = {
  id?: string | null;
  token?: string | null;
  optedIn?: boolean;
  optIn?: () => Promise<void>;
};

type OneSignalUser = {
  addAlias?: (label: string, id: string) => Promise<void>;
  PushSubscription?: OneSignalSubscription;
};

type OneSignalNotifications = {
  permission?: "default" | "denied" | "granted";
  requestPermission?: () => Promise<void>;
};

type OneSignalClient = {
  init: (params: { appId: string; allowLocalhostAsSecureOrigin?: boolean }) => Promise<void>;
  User?: OneSignalUser;
  user?: OneSignalUser;
  Notifications?: OneSignalNotifications;
  notifications?: OneSignalNotifications;
};

const menuItems = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Operations", href: "/operations" },
  { label: "Time Tracking", href: "/time-tracking" },
  { label: "Performance", href: "/performance" },
  { label: "CRM", href: "/crm" },
  { label: "Finance", href: "/finance" },
  { label: "Projects", href: "/projects" },
];

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function getPermissionFromOneSignal(oneSignal: OneSignalClient): "default" | "denied" | "granted" {
  return (
    oneSignal.Notifications?.permission ||
    oneSignal.notifications?.permission ||
    "default"
  );
}

function getNotificationPermission(): "default" | "denied" | "granted" {
  if (typeof Notification === "undefined") return "default";
  return Notification.permission;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

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

async function ensureOneSignalInitialized(oneSignal: OneSignalClient, appId: string) {
  if (window.__oneSignalInitialized) {
    console.log("[HamburgerMenu] OneSignal già inizializzato");
    return;
  }

  await oneSignal.init({ appId });
  window.__oneSignalInitialized = true;
  console.log("[HamburgerMenu] OneSignal init ok");
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

    onDebug(`retry subscription id=${playerId || "null"} token=${token || "null"} optedIn=${String(optedIn)}`);

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

export default function HamburgerMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [activatingNotifications, setActivatingNotifications] = useState(false);
  const [notificationDebugMessage, setNotificationDebugMessage] = useState("");
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!menuOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  async function getOneSignalInstance(timeoutMs = 10000): Promise<OneSignalClient> {
    if (window.OneSignal) {
      setNotificationDebugMessage("OneSignal già presente su window");
      console.log("[HamburgerMenu] OneSignal disponibile su window");
      return window.OneSignal;
    }

    setNotificationDebugMessage("OneSignal assente, uso deferred");
    console.log("[HamburgerMenu] OneSignal non ancora su window, uso OneSignalDeferred fallback");

    return new Promise<OneSignalClient>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        setNotificationDebugMessage("timeout attesa OneSignal SDK");
        reject(new Error("Timeout attesa OneSignal SDK"));
      }, timeoutMs);

      window.OneSignalDeferred = window.OneSignalDeferred || [];
      window.OneSignalDeferred.push((oneSignal) => {
        window.clearTimeout(timer);
        setNotificationDebugMessage("OneSignal deferred risolto");
        resolve(oneSignal);
      });
    });
  }

  async function handleEnableNotifications() {
    if (activatingNotifications) return;

    setActivatingNotifications(true);
    setNotificationDebugMessage("avvio click");

    try {
      if (typeof window === "undefined") {
        setNotificationDebugMessage("controllo window fallito");
        console.log("[HamburgerMenu] window non disponibile");
        return;
      }
      setNotificationDebugMessage("controllo window ok");

      const oneSignalAppId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;

      if (!oneSignalAppId) {
        setNotificationDebugMessage("app id mancante");
        console.log("[HamburgerMenu] App ID OneSignal mancante");
        window.alert(
          "Non è stato possibile attivare le notifiche. Riprova dal browser o verifica le impostazioni iPhone."
        );
        return;
      }

      setNotificationDebugMessage("app id presente");
      console.log("[HamburgerMenu] avvio attivazione notifiche");

      const oneSignal = await getOneSignalInstance(10000);
      setNotificationDebugMessage("OneSignal trovato");

      try {
        await ensureOneSignalInitialized(oneSignal, oneSignalAppId);
        setNotificationDebugMessage("OneSignal init ok");
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        setNotificationDebugMessage(`OneSignal init fallito: ${errorMessage}`);
        throw error;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user?.id) {
        setNotificationDebugMessage("user Supabase non trovato");
        console.log("[HamburgerMenu] utente non autenticato");
        return;
      }
      setNotificationDebugMessage("user Supabase trovato");

      const oneSignalUser = oneSignal.User || oneSignal.user;
      try {
        if (oneSignalUser?.addAlias) {
          setNotificationDebugMessage("addAlias avviato");
          await oneSignalUser.addAlias("external_id", user.id);
          setNotificationDebugMessage("addAlias completato");
          console.log("[HamburgerMenu] alias utente impostato");
        } else {
          setNotificationDebugMessage("addAlias non disponibile, continuo");
          console.log("[HamburgerMenu] addAlias non disponibile");
        }
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        setNotificationDebugMessage(`addAlias fallito, continuo: ${errorMessage}`);
        console.log("[HamburgerMenu] addAlias fallito, continuo", error);
      }

      const permissionBefore = getPermissionFromOneSignal(oneSignal);
      console.log("[HamburgerMenu] permission corrente:", permissionBefore);

      setNotificationDebugMessage("request permission avviata");
      await (oneSignal.Notifications?.requestPermission?.() ||
        oneSignal.notifications?.requestPermission?.() ||
        Promise.resolve());
      setNotificationDebugMessage("request permission completata");
      console.log("[HamburgerMenu] prompt mostrato/chiuso");

      await wait(1000);

      const notificationPermission = getNotificationPermission();
      const oneSignalPermission = getPermissionFromOneSignal(oneSignal);
      const permissionGranted =
        notificationPermission === "granted" || oneSignalPermission === "granted";

      setNotificationDebugMessage(`Notification.permission = ${notificationPermission}`);
      console.log("[HamburgerMenu] Notification.permission =", notificationPermission);

      setNotificationDebugMessage(`OneSignal permission = ${oneSignalPermission}`);
      console.log("[HamburgerMenu] OneSignal permission =", oneSignalPermission);

      if (!permissionGranted) {
        setNotificationDebugMessage("subscription finale: permission non granted");
        console.log("[HamburgerMenu] permesso non granted, skip register");
        return;
      }

      const subscription = oneSignal.User?.PushSubscription;
      const subscriptionPresent = Boolean(subscription);
      const subscriptionMethods = getAvailableMethodNames(subscription);
      const subscriptionBeforeOptInDebug = `id/token/optedIn prima di optIn id=${
        subscription?.id || "null"
      } token=${subscription?.token || "null"} optedIn=${String(subscription?.optedIn)}`;

      setNotificationDebugMessage(`subscription object presente ${subscriptionPresent ? "sì" : "no"}`);
      console.log(
        "[HamburgerMenu] subscription object presente",
        subscriptionPresent ? "sì" : "no"
      );

      setNotificationDebugMessage(`metodi disponibili della subscription: ${subscriptionMethods}`);
      console.log("[HamburgerMenu] metodi disponibili della subscription:", subscriptionMethods);

      setNotificationDebugMessage(subscriptionBeforeOptInDebug);
      console.log("[HamburgerMenu]", subscriptionBeforeOptInDebug);

      setNotificationDebugMessage(`optIn disponibile ${subscription?.optIn ? "sì" : "no"}`);
      console.log("[HamburgerMenu] optIn disponibile", subscription?.optIn ? "sì" : "no");

      if (subscription?.optIn) {
        setNotificationDebugMessage("optIn avviato");
        await subscription.optIn();
        setNotificationDebugMessage("optIn completato");
      } else {
        setNotificationDebugMessage("optIn non disponibile");
      }

      await wait(2000);

      const subscriptionAfterOptIn = oneSignal.User?.PushSubscription;
      const subscriptionAfterOptInDebug = `stato subscription dopo optIn id=${
        subscriptionAfterOptIn?.id || "null"
      } token=${subscriptionAfterOptIn?.token || "null"} optedIn=${String(
        subscriptionAfterOptIn?.optedIn
      )}`;

      setNotificationDebugMessage(subscriptionAfterOptInDebug);
      console.log("[HamburgerMenu]", subscriptionAfterOptInDebug);

      setNotificationDebugMessage("subscription finale avviata");
      const subscriptionData = await waitForSubscriptionId(
        oneSignal,
        (message) => {
          setNotificationDebugMessage(message);
          console.log("[HamburgerMenu]", message);
        },
        20000
      );

      if (!subscriptionData?.playerId) {
        setNotificationDebugMessage("subscription non creata dopo optIn");
        console.log("[HamburgerMenu] subscription id non ottenuto entro timeout");
        window.alert(
          "Non è stato possibile attivare le notifiche. Riprova dal browser o verifica le impostazioni iPhone."
        );
        return;
      }

      setNotificationDebugMessage("subscription finale: trovata");
      console.log("[HamburgerMenu] subscription id recuperato:", subscriptionData.playerId);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        console.log("[HamburgerMenu] token sessione assente: skip register");
        return;
      }

      const payload = {
        onesignal_player_id: subscriptionData.playerId,
        onesignal_subscription_id: subscriptionData.token,
        external_user_id: user.id,
        permission: notificationPermission === "granted" ? notificationPermission : oneSignalPermission,
        is_active: subscriptionData.optedIn,
        device_info: {
          userAgent: navigator.userAgent,
          language: navigator.language,
          platform: navigator.platform,
        },
      };

      const payloadText = JSON.stringify(payload);
      setNotificationDebugMessage(`register payload: ${payloadText}`);
      console.log("[HamburgerMenu] register payload", payload);

      const response = await fetch("/api/notifications/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });

      setNotificationDebugMessage(
        `register response status=${response.status} ok=${response.ok} statusText=${response.statusText}`
      );
      console.log("[HamburgerMenu] risposta register", {
        status: response.status,
        ok: response.ok,
        statusText: response.statusText,
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
      setNotificationDebugMessage(`register body: ${registerBodyText}`);
      console.log("[HamburgerMenu] register body", responseBody);

      if (!response.ok) {
        setNotificationDebugMessage(
          `register errore status: ${response.status} body: ${registerBodyText}`
        );
        window.alert(`Errore attivazione notifiche: ${registerBodyText}`);
        return;
      }

      const registerResult =
        responseBody && typeof responseBody === "object"
          ? (responseBody as { ok?: unknown })
          : null;

      if (registerResult?.ok === true) {
        setNotificationDebugMessage("notifiche attivate correttamente");
        return;
      }

      setNotificationDebugMessage(`register errore body: ${registerBodyText}`);
      window.alert(`Errore attivazione notifiche: ${registerBodyText}`);
      return;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      setNotificationDebugMessage(`errore reale: ${errorMessage}`);
      console.error("[HamburgerMenu] errore globale attivazione notifiche:", error);
      return;
    } finally {
      console.log("[HamburgerMenu] fine attivazione notifiche");
      setActivatingNotifications(false);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);

    const { error } = await supabase.auth.signOut();

    setLoggingOut(false);
    setMenuOpen(false);

    if (error) {
      console.error("Errore logout:", error.message);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center justify-end">
        <button
          onClick={() => setMenuOpen(true)}
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#e7dfd8] bg-white text-[#2B2D2F] transition hover:bg-[#f8f6f2]"
        >
          <div className="flex flex-col gap-[4px]">
            <span className="block h-[2px] w-5 bg-current" />
            <span className="block h-[2px] w-5 bg-current" />
            <span className="block h-[2px] w-5 bg-current" />
          </div>
        </button>
      </div>

      <div
        className={`fixed inset-0 z-50 bg-black/30 backdrop-blur-[1px] transition-opacity duration-200 ${
          menuOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setMenuOpen(false)}
      />

      <aside
        className={`fixed right-0 top-0 z-[60] flex h-screen w-[300px] flex-col border-l border-[#e7dfd8] bg-[#f5f3ef] transform transition-transform duration-300 ${
          menuOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-[#e7dfd8] px-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#017A92]">
              MeToDo Control
            </p>
            <h2 className="text-sm font-semibold text-[#2B2D2F]">Navigation</h2>
          </div>

          <button
            onClick={() => setMenuOpen(false)}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#e7dfd8] bg-white text-[#6a6d70] hover:bg-[#f8f6f2]"
          >
            ✕
          </button>
        </div>

        <nav className="flex-1 px-3 py-4">
          <ul className="space-y-1">
            {menuItems.map((item) => {
              const isActive = isActivePath(pathname, item.href);

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    className={[
                      "flex h-11 items-center rounded-lg px-3 text-sm transition",
                      isActive
                        ? "border border-[#e7dfd8] bg-white text-[#017A92]"
                        : "text-[#4f5254] hover:bg-white",
                    ].join(" ")}
                  >
                    <span
                      className={`mr-2 h-[14px] w-[2px] rounded-full ${
                        isActive ? "bg-[#017A92]" : "bg-transparent"
                      }`}
                    />

                    <span className={isActive ? "font-semibold" : "font-medium"}>
                      {item.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="space-y-2 border-t border-[#e7dfd8] px-3 py-3">
          <button
            type="button"
            onClick={handleEnableNotifications}
            disabled={activatingNotifications}
            className="flex h-11 w-full items-center rounded-lg border border-[#dbe8eb] bg-[#f3f8fa] px-3 text-sm font-medium text-[#017A92] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {activatingNotifications ? "Attivazione in corso..." : "Attiva notifiche"}
          </button>

          <p className="px-1 text-[11px] leading-4 text-[#6a6d70]">{notificationDebugMessage}</p>

          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="flex h-11 w-full items-center rounded-lg px-3 text-sm font-medium text-[#8a3a3a] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loggingOut ? "Logout in corso..." : "Logout"}
          </button>
        </div>
      </aside>
    </>
  );
}

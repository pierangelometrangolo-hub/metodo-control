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

type OneSignalUser = {
  addAlias?: (label: string, id: string) => Promise<void>;
};

type OneSignalSubscription = {
  id?: string | null;
  token?: string | null;
  optedIn?: boolean;
};

type OneSignalNotifications = {
  permission?: "default" | "denied" | "granted";
  requestPermission?: () => Promise<void>;
};

type OneSignalClient = {
  init: (params: { appId: string; allowLocalhostAsSecureOrigin?: boolean }) => Promise<void>;
  User?: OneSignalUser;
  user?: OneSignalUser;
  UserPushSubscription?: OneSignalSubscription;
  userPushSubscription?: OneSignalSubscription;
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
    Notification.permission ||
    "default"
  );
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function getOneSignalInstance(timeoutMs = 10000): Promise<OneSignalClient> {
  if (window.OneSignal) {
    console.log("[HamburgerMenu] OneSignal disponibile su window");
    return window.OneSignal;
  }

  console.log("[HamburgerMenu] OneSignal non ancora su window, uso OneSignalDeferred fallback");

  return new Promise<OneSignalClient>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error("Timeout attesa OneSignal SDK"));
    }, timeoutMs);

    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push((oneSignal) => {
      window.clearTimeout(timer);
      resolve(oneSignal);
    });
  });
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

async function waitForSubscriptionId(oneSignal: OneSignalClient, timeoutMs = 10000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const subscription = oneSignal.UserPushSubscription || oneSignal.userPushSubscription;
    const playerId = subscription?.id || null;

    if (playerId) {
      return {
        playerId,
        token: subscription?.token || null,
        optedIn: Boolean(subscription?.optedIn),
      };
    }

    console.log("[HamburgerMenu] subscription id non disponibile, retry...");
    await wait(500);
  }

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
        setNotificationDebugMessage("OneSignal init fallito");
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
      if (oneSignalUser?.addAlias) {
        await oneSignalUser.addAlias("external_id", user.id);
        console.log("[HamburgerMenu] alias utente impostato");
      }

      const permissionBefore = getPermissionFromOneSignal(oneSignal);
      console.log("[HamburgerMenu] permission corrente:", permissionBefore);

      setNotificationDebugMessage("request permission avviata");
      await (oneSignal.Notifications?.requestPermission?.() ||
        oneSignal.notifications?.requestPermission?.() ||
        Promise.resolve());
      console.log("[HamburgerMenu] prompt mostrato/chiuso");

      const permissionAfter = getPermissionFromOneSignal(oneSignal);
      setNotificationDebugMessage(`permission dopo prompt: ${permissionAfter}`);
      console.log("[HamburgerMenu] permission dopo prompt:", permissionAfter);

      if (permissionAfter !== "granted") {
        console.log("[HamburgerMenu] permesso non granted, skip register");
        return;
      }

      const subscriptionData = await waitForSubscriptionId(oneSignal, 10000);

      if (!subscriptionData?.playerId) {
        setNotificationDebugMessage("subscription non trovata");
        console.log("[HamburgerMenu] subscription id non ottenuto entro timeout");
        window.alert(
          "Non è stato possibile attivare le notifiche. Riprova dal browser o verifica le impostazioni iPhone."
        );
        return;
      }

      setNotificationDebugMessage("subscription trovata");
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
        permission: permissionAfter,
        is_active: subscriptionData.optedIn,
        device_info: {
          userAgent: navigator.userAgent,
          language: navigator.language,
          platform: navigator.platform,
        },
      };

      setNotificationDebugMessage("chiamata register avviata");
      console.log("[HamburgerMenu] chiamata register eseguita", payload);

      const response = await fetch("/api/notifications/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });

      const responseBody = await response.json().catch(() => null);
      setNotificationDebugMessage(`risposta register status: ${response.status}`);
      console.log("[HamburgerMenu] risposta register", {
        status: response.status,
        body: responseBody,
      });
    } catch (error) {
      console.error("[HamburgerMenu] errore globale attivazione notifiche:", error);
      window.alert(
        "Non è stato possibile attivare le notifiche. Riprova dal browser o verifica le impostazioni iPhone."
      );
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
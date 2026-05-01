"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

declare global {
  interface Window {
    OneSignalDeferred?: Array<(OneSignal: OneSignalClient) => void>;
    OneSignal?: OneSignalClient;
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

export default function HamburgerMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [activatingNotifications, setActivatingNotifications] = useState(false);
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
    try {
      setActivatingNotifications(true);
      const oneSignalAppId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;

      if (!oneSignalAppId || typeof window === "undefined") {
        console.log("[HamburgerMenu] App ID OneSignal mancante");
        return;
      }

      console.log("[HamburgerMenu] avvio attivazione notifiche");

      window.OneSignalDeferred = window.OneSignalDeferred || [];

      window.OneSignalDeferred.push(async (OneSignal) => {
        try {
          await OneSignal.init({ appId: oneSignalAppId });
          console.log("[HamburgerMenu] OneSignal init ok");

          const {
            data: { user },
          } = await supabase.auth.getUser();

          if (!user?.id) {
            console.log("[HamburgerMenu] utente non autenticato");
            return;
          }

          const oneSignalUser = OneSignal.User || OneSignal.user;
          if (oneSignalUser?.addAlias) {
            await oneSignalUser.addAlias("external_id", user.id);
          }

          const permissionBefore = getPermissionFromOneSignal(OneSignal);
          console.log("[HamburgerMenu] permission corrente:", permissionBefore);

          await (OneSignal.Notifications?.requestPermission?.() || OneSignal.notifications?.requestPermission?.());
          console.log("[HamburgerMenu] prompt mostrato");

          const permissionAfter = getPermissionFromOneSignal(OneSignal);
          console.log("[HamburgerMenu] permission dopo prompt:", permissionAfter);

          const subscription = OneSignal.UserPushSubscription || OneSignal.userPushSubscription;
          const playerId = subscription?.id || null;

          console.log("[HamburgerMenu] subscription id recuperato:", playerId);

          if (!playerId) {
            console.log("[HamburgerMenu] subscription id assente: skip register");
            return;
          }

          const {
            data: { session },
          } = await supabase.auth.getSession();

          if (!session?.access_token) {
            console.log("[HamburgerMenu] token sessione assente: skip register");
            return;
          }

          const payload = {
            onesignal_player_id: playerId,
            onesignal_subscription_id: subscription?.token || null,
            external_user_id: user.id,
            permission: permissionAfter,
            is_active: Boolean(subscription?.optedIn),
            device_info: {
              userAgent: navigator.userAgent,
              language: navigator.language,
              platform: navigator.platform,
            },
          };

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
          console.log("[HamburgerMenu] risposta register", {
            status: response.status,
            body: responseBody,
          });
        } catch (error) {
          console.error("[HamburgerMenu] errore attivazione notifiche:", error);
        } finally {
          setActivatingNotifications(false);
        }
      });
    } catch (error) {
      console.error("[HamburgerMenu] errore globale attivazione notifiche:", error);
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
            <h2 className="text-sm font-semibold text-[#2B2D2F]">
              Navigation
            </h2>
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

        <div className="border-t border-[#e7dfd8] px-3 py-3 space-y-2">
          <button
            type="button"
            onClick={handleEnableNotifications}
            disabled={activatingNotifications}
            className="flex h-11 w-full items-center rounded-lg border border-[#dbe8eb] bg-[#f3f8fa] px-3 text-sm font-medium text-[#017A92] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {activatingNotifications ? "Attivazione in corso..." : "Attiva notifiche"}
          </button>

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
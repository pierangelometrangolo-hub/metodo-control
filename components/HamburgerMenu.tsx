"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/lib/supabaseClient";
import { activatePushNotifications } from "@/lib/pushNotifications";
import { getUserLevelRank } from "@/lib/permissions";

const MASTER_RANK = 3;

const menuItems = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Operations", href: "/operations" },
  { label: "Time Tracking", href: "/time-tracking" },
  { label: "Performance", href: "/performance" },
  { label: "CRM", href: "/crm" },
  { label: "Finance", href: "/finance" },
  { label: "Projects", href: "/projects" },
];

const adminMenuItem = { label: "Gestione Utenti", href: "/admin/utenti" };

// Passo 2: nuove sezioni statiche in coda alla nav, non legate a permessi
// (link esterni diretti, uguali per ogni utente).
const extranetLinks = [
  { label: "Booking.com Extranet", href: "https://admin.booking.com/" },
  { label: "Expedia Partner Central", href: "https://apps.expediapartnercentral.com/" },
  { label: "Booking Designer", href: "https://bms.bookingdesigner.com/index.php" },
];

const communicationLinks = [
  { label: "Gmail", href: "https://mail.google.com/" },
  { label: "WhatsApp aziendale", href: "https://web.whatsapp.com/" },
];

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function HamburgerMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [activatingNotifications, setActivatingNotifications] = useState(false);
  const [notificationDebugMessage, setNotificationDebugMessage] = useState("");
  const [isMasterUser, setIsMasterUser] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    void getUserLevelRank().then((rank) => setIsMasterUser(rank !== null && rank >= MASTER_RANK));
  }, []);

  const visibleMenuItems = isMasterUser ? [...menuItems, adminMenuItem] : menuItems;

  async function handleEnableNotifications() {
    if (activatingNotifications) return;

    setActivatingNotifications(true);
    setNotificationDebugMessage("avvio click");

    const result = await activatePushNotifications({
      requestPermission: true,
      onDebug: setNotificationDebugMessage,
    });

    setActivatingNotifications(false);

    if (result.ok) {
      return;
    }

    if (result.reason === "no-app-id" || result.reason === "no-subscription") {
      window.alert(
        "Non è stato possibile attivare le notifiche. Riprova dal browser o verifica le impostazioni iPhone."
      );
      return;
    }

    if (result.reason === "register-error") {
      window.alert(`Errore attivazione notifiche: ${result.detail ?? ""}`);
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
    <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        aria-label="Apri il menu"
        className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#e7dfd8] bg-white text-[#2B2D2F] transition hover:bg-[#f8f6f2]"
      >
        <Menu className="h-5 w-5" />
      </button>

      <SheetContent
        side="right"
        className="w-[300px] border-l border-[#e7dfd8] bg-[#f5f3ef] p-0 sm:max-w-[300px]"
      >
        <div className="flex h-16 items-center border-b border-[#e7dfd8] px-5">
          <div>
            <p className="text-teal text-[10px] font-semibold uppercase tracking-[0.18em]">
              MeToDo Control
            </p>
            <SheetTitle className="text-sm font-semibold text-[#2B2D2F]">Navigation</SheetTitle>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {visibleMenuItems.map((item) => {
              const isActive = isActivePath(pathname, item.href);

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    className={[
                      "flex h-11 items-center rounded-lg px-3 text-sm transition",
                      isActive
                        ? "text-teal border border-[#e7dfd8] bg-white"
                        : "text-[#4f5254] hover:bg-white",
                    ].join(" ")}
                  >
                    <span
                      className={`bg-teal mr-2 h-[14px] w-[2px] rounded-full ${isActive ? "" : "bg-transparent"}`}
                    />
                    <span className={isActive ? "font-semibold" : "font-medium"}>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>

          <p className="mb-2 mt-6 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6a6d70]">
            Extranet
          </p>
          <ul className="space-y-1">
            {extranetLinks.map((item) => (
              <li key={item.label}>
                <a
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-11 items-center rounded-lg px-3 text-sm font-medium text-[#4f5254] transition hover:bg-white"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>

          <p className="mb-2 mt-6 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6a6d70]">
            Comunicazioni
          </p>
          <ul className="space-y-1">
            {communicationLinks.map((item) => (
              <li key={item.label}>
                <a
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-11 items-center rounded-lg px-3 text-sm font-medium text-[#4f5254] transition hover:bg-white"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="space-y-2 border-t border-[#e7dfd8] px-3 py-3">
          <button
            type="button"
            onClick={handleEnableNotifications}
            disabled={activatingNotifications}
            className="text-teal flex h-11 w-full items-center rounded-lg border border-[#dbe8eb] bg-[#f3f8fa] px-3 text-sm font-medium transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
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
      </SheetContent>
    </Sheet>
  );
}

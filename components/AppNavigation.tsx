"use client";

import { ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, ChartNoAxesCombined, Clock, LayoutDashboard, ListChecks, LogOut, ShieldCheck, Users } from "lucide-react";
import { SiGmail, SiWhatsapp } from "react-icons/si";
import { AppShell, AppShellAction, AppShellNavGroup } from "@/components/ui/AppShell";
import { supabase } from "@/lib/supabaseClient";
import { activatePushNotifications } from "@/lib/pushNotifications";
import { getUserLevelRank } from "@/lib/permissions";

const MASTER_RANK = 3;

// Loghi reali gia' presenti in public/images/logos/ (stessi usati in
// ChannelRevenueBars per "Canali di vendita" in Performance): booking-com
// e' gia' un'icona quadrata autonoma, expedia-mark/booking-designer-mark
// sono ritagli del solo marchio, leggibili a dimensione icona.
function LogoIcon({ src, className }: { src: string; className?: string }) {
  return (
    <span className={`block overflow-hidden rounded-[4px] ${className ?? ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="h-full w-full object-cover" />
    </span>
  );
}

function BookingComIcon({ className }: { className?: string }) {
  return <LogoIcon src="/images/logos/booking-com.png" className={className} />;
}

function ExpediaIcon({ className }: { className?: string }) {
  return <LogoIcon src="/images/logos/expedia-mark.png" className={className} />;
}

function BookingDesignerIcon({ className }: { className?: string }) {
  return <LogoIcon src="/images/logos/booking-designer-mark.png" className={className} />;
}

// Unico elenco delle voci di MeToDo Control, per sidebar desktop e drawer.
// Un modulo entra qui solo quando ha una pagina reale (Finance e Projects
// non ne hanno ancora).
const moduleGroup: AppShellNavGroup = {
  key: "modules",
  items: [
    { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { key: "operations", label: "Operations", href: "/operations", icon: ListChecks },
    { key: "time-tracking", label: "Time Tracking", href: "/time-tracking", icon: Clock },
    { key: "performance", label: "Performance", href: "/performance", icon: ChartNoAxesCombined },
    { key: "crm", label: "CRM", href: "/crm", icon: Users },
  ],
};

const adminGroup: AppShellNavGroup = {
  key: "admin",
  items: [{ key: "users", label: "Gestione Utenti", href: "/admin/utenti", icon: ShieldCheck }],
};

const externalGroups: AppShellNavGroup[] = [
  {
    key: "extranet",
    label: "Extranet",
    items: [
      { key: "booking", label: "Booking.com", href: "https://admin.booking.com/", icon: BookingComIcon, external: true },
      {
        key: "expedia",
        label: "Expedia",
        href: "https://apps.expediapartnercentral.com/",
        icon: ExpediaIcon,
        external: true,
      },
      {
        key: "booking-designer",
        label: "Booking Designer",
        href: "https://bms.bookingdesigner.com/index.php",
        icon: BookingDesignerIcon,
        external: true,
      },
    ],
  },
  {
    key: "communications",
    label: "Comunicazioni",
    items: [
      { key: "gmail", label: "Gmail", href: "https://mail.google.com/", icon: SiGmail, external: true },
      {
        key: "whatsapp",
        label: "WhatsApp aziendale",
        href: "https://web.whatsapp.com/",
        icon: SiWhatsapp,
        external: true,
        // Il monogramma WhatsApp in monotono perde leggibilita': resta il
        // verde di brand originale.
        iconClassName: "text-[#25D366]",
      },
    ],
  },
];

export default function AppNavigation({ children }: { children: ReactNode }) {
  const [loggingOut, setLoggingOut] = useState(false);
  const [activatingNotifications, setActivatingNotifications] = useState(false);
  const [notificationDebugMessage, setNotificationDebugMessage] = useState("");
  const [isMasterUser, setIsMasterUser] = useState(false);
  const router = useRouter();

  useEffect(() => {
    void getUserLevelRank().then((rank) => setIsMasterUser(rank !== null && rank >= MASTER_RANK));
  }, []);

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

    if (error) {
      console.error("Errore logout:", error.message);
      return;
    }

    router.push("/");
    router.refresh();
  }

  const groups = [moduleGroup, ...(isMasterUser ? [adminGroup] : []), ...externalGroups];

  const actions: AppShellAction[] = [
    {
      key: "notifications",
      label: activatingNotifications ? "Attivazione in corso..." : "Attiva notifiche",
      icon: Bell,
      onClick: handleEnableNotifications,
      disabled: activatingNotifications,
      message: notificationDebugMessage || undefined,
    },
    {
      key: "logout",
      label: loggingOut ? "Logout in corso..." : "Logout",
      icon: LogOut,
      onClick: handleLogout,
      tone: "danger",
      disabled: loggingOut,
    },
  ];

  return (
    <AppShell
      brand={{ name: "MeToDo Control", logoSrc: "/images/metodo-logo.png", href: "/dashboard" }}
      groups={groups}
      actions={actions}
    >
      {children}
    </AppShell>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { Home, CalendarCheck, Bell } from "lucide-react";
import { SiBookingdotcom, SiExpedia, SiGmail, SiWhatsapp } from "react-icons/si";
import HamburgerMenu from "@/components/HamburgerMenu";
import { activatePushNotifications } from "@/lib/pushNotifications";

const BOOKING_DESIGNER_URL = "https://bms.bookingdesigner.com/index.php";

type HeaderIconProps = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  external?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  // Override solo del colore/size dell'icona (non del bottone che la
  // contiene) - serve per l'eccezione WhatsApp: mantenere il verde di
  // brand invece del monotono bianco usato da tutte le altre icone header.
  iconClassName?: string;
};

function HeaderIcon({
  label,
  icon: Icon,
  href,
  external,
  onClick,
  disabled,
  className = "",
  iconClassName = "",
}: HeaderIconProps) {
  const classes = `flex h-9 w-9 items-center justify-center rounded-lg text-white/90 transition hover:bg-white/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 ${className}`;

  if (href) {
    return (
      <Link
        href={href}
        title={label}
        aria-label={label}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
        className={classes}
      >
        <Icon className={`h-5 w-5 ${iconClassName}`} />
      </Link>
    );
  }

  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled} className={classes}>
      <Icon className={`h-5 w-5 ${iconClassName}`} />
    </button>
  );
}

export function Header() {
  const [activatingNotifications, setActivatingNotifications] = useState(false);

  async function handleNotificationsClick() {
    if (activatingNotifications) return;

    setActivatingNotifications(true);
    const result = await activatePushNotifications({ requestPermission: true });
    setActivatingNotifications(false);

    if (result.ok) return;

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

  return (
    <header className="bg-teal sticky top-0 z-40">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 md:px-6">
        <Link href="/dashboard" className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/metodo-logo.png" alt="MeToDo Control" className="h-full w-full object-cover" />
          </span>
          <span className="hidden truncate text-sm font-semibold tracking-wide text-white md:inline">
            MeToDo Control
          </span>
        </Link>

        <div className="flex shrink-0 items-center gap-1">
          <HeaderIcon href="/dashboard" label="Home" icon={Home} className="hidden md:flex" />

          {/* Extranet: su desktop vivono qui (icone dirette in barra); su
              mobile l'header resta collassato, restano raggiungibili solo
              dal drawer HamburgerMenu (sezione Extranet, nascosta li' solo
              da md in su - vedi HamburgerMenu.tsx). */}
          <HeaderIcon
            href="https://admin.booking.com/"
            label="Booking.com Extranet"
            icon={SiBookingdotcom}
            external
            className="hidden md:flex"
          />
          <HeaderIcon
            href="https://apps.expediapartnercentral.com/"
            label="Expedia Partner Central"
            icon={SiExpedia}
            external
            className="hidden md:flex"
          />
          <HeaderIcon
            href={BOOKING_DESIGNER_URL}
            label="Booking Designer"
            icon={CalendarCheck}
            external
            className="hidden md:flex"
          />
          <HeaderIcon
            href="https://mail.google.com/"
            label="Gmail"
            icon={SiGmail}
            external
            className="hidden md:flex"
          />
          <HeaderIcon
            href="https://web.whatsapp.com/"
            label="WhatsApp Business"
            icon={SiWhatsapp}
            external
            className="hidden md:flex"
            // Eccezione esplicita (vedi commento su iconClassName): il
            // monogramma WhatsApp in monotono bianco perde leggibilita',
            // qui resta il verde di brand originale.
            iconClassName="text-[#25D366]"
          />
          <HeaderIcon
            label="Notifiche"
            icon={Bell}
            onClick={handleNotificationsClick}
            disabled={activatingNotifications}
          />
          <HamburgerMenu />
        </div>
      </div>
    </header>
  );
}

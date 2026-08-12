"use client";

import { useState } from "react";
import Link from "next/link";
import { Home, Bell } from "lucide-react";
import { SiGmail, SiWhatsapp } from "react-icons/si";
import HamburgerMenu from "@/components/HamburgerMenu";
import { activatePushNotifications } from "@/lib/pushNotifications";

const BOOKING_DESIGNER_URL = "https://bms.bookingdesigner.com/index.php";

// Loghi reali gia' presenti in public/images/logos/ (stessi usati in
// ChannelRevenueBars per "Canali di vendita" in Performance) - booking-com
// e' gia' un'icona quadrata autonoma, expedia-mark/booking-designer-mark
// sono ritagli generati dai file originali (expedia.png/booking-designer.png
// includono anche il wordmark sotto al simbolo, illeggibile a 20px: qui
// viene ritagliato solo il marchio) per essere leggibili a dimensione
// header senza dover chiedere un nuovo asset.
function LogoIcon({ src, className }: { src: string; className?: string }) {
  return (
    <span className={`block overflow-hidden rounded-[6px] ${className ?? ""}`}>
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

// Il logo Booking Designer e' bicolore (bianco + antracite) su fondo teal
// pensato apposta per stare su una barra teal piena, come questa - a
// differenza di Booking.com/Expedia/Gmail non va ricolorato in monotono.
function BookingDesignerIcon({ className }: { className?: string }) {
  return <LogoIcon src="/images/logos/booking-designer-mark.png" className={className} />;
}

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
            icon={BookingComIcon}
            external
            className="hidden md:flex"
          />
          <HeaderIcon
            href="https://apps.expediapartnercentral.com/"
            label="Expedia Partner Central"
            icon={ExpediaIcon}
            external
            className="hidden md:flex"
          />
          <HeaderIcon
            href={BOOKING_DESIGNER_URL}
            label="Booking Designer"
            icon={BookingDesignerIcon}
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

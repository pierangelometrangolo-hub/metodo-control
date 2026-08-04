"use client";

import { useEffect, useState } from "react";
import { activatePushNotifications, getNotificationPermission } from "@/lib/pushNotifications";

const DISMISS_KEY = "push-banner-dismissed";

export default function PushNotificationBanner() {
  const [visible, setVisible] = useState(false);
  const [activating, setActivating] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;

    const permission = getNotificationPermission();

    if (permission === "granted") {
      void activatePushNotifications({ requestPermission: false }).then((result) => {
        if (!result.ok) {
          console.error(
            "[PushNotificationBanner] refresh silenzioso fallito:",
            result.reason,
            result.detail
          );
        }
      });
      return;
    }

    if (permission === "default" && !window.sessionStorage.getItem(DISMISS_KEY)) {
      setVisible(true);
    }
  }, []);

  function handleDismiss() {
    window.sessionStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  }

  async function handleActivate() {
    if (activating) return;

    setActivating(true);
    setStatusMessage("");

    const result = await activatePushNotifications({
      requestPermission: true,
      onDebug: setStatusMessage,
    });

    setActivating(false);

    if (result.ok) {
      setVisible(false);
      return;
    }

    setStatusMessage("Non è stato possibile attivare le notifiche. Riprova più tardi o dal menu.");
  }

  if (!visible) return null;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[#dbe8eb] bg-[#f3f8fa] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex-1">
        <p className="text-sm font-semibold text-[#017A92]">Attiva le notifiche</p>
        <p className="mt-1 text-[13px] leading-5 text-[#4f5254]">
          Ricevi un avviso quando ti viene assegnata una task o una subtask, così non perdi
          nessun aggiornamento.
        </p>
        {statusMessage && <p className="mt-1 text-[11px] text-[#6a6d70]">{statusMessage}</p>}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleActivate}
          disabled={activating}
          className="h-10 rounded-lg bg-[#017A92] px-4 text-sm font-medium text-white transition hover:bg-[#016578] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {activating ? "Attivazione..." : "Attiva"}
        </button>

        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Chiudi"
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#dbe8eb] bg-white text-[#6a6d70] transition hover:bg-[#f8f6f2]"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

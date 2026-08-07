"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { registerNotificationClickHandler } from "@/lib/pushNotifications";

/**
 * Gestisce il click su una notifica push mentre l'app è già aperta in
 * foreground. Il service worker OneSignal (configurato con action "focus")
 * porta la finestra in primo piano ma non la naviga da solo: qui si
 * intercetta l'evento e si usa il router Next.js per aggiornare i
 * searchParams della SPA, così la logica già esistente in operations/page.tsx
 * (scroll/evidenziazione/"elemento non disponibile") scatta senza reload.
 */
export default function PushNotificationClickHandler() {
  const router = useRouter();

  useEffect(() => {
    const unregister = registerNotificationClickHandler((path) => {
      router.push(path);
    });

    return unregister;
  }, [router]);

  return null;
}

"use client";

import { useEffect } from "react";

export default function PushBootstrap() {
  useEffect(() => {
    const oneSignalAppId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;

    if (!oneSignalAppId || typeof window === "undefined") {
      return;
    }

    const scriptId = "onesignal-sdk";

    if (!document.getElementById(scriptId)) {
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
      script.defer = true;
      script.onload = () => {
        console.log("[PushBootstrap] SDK caricato");
      };
      document.head.appendChild(script);
    } else {
      console.log("[PushBootstrap] SDK già presente");
    }

    window.OneSignalDeferred = window.OneSignalDeferred || [];

    window.OneSignalDeferred.push(async (OneSignal) => {
      try {
        await OneSignal.init({ appId: oneSignalAppId });
        console.log("[PushBootstrap] OneSignal init ok (preload)");
      } catch (error) {
        console.error("[PushBootstrap] init preload error:", error);
      }
    });
  }, []);

  return null;
}
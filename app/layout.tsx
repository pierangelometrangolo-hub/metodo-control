import type { Metadata, Viewport } from "next";
import { Geist_Mono, Open_Sans, Noto_Serif } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { cn } from "@/lib/utils";

// Open Sans e' il font principale di UI/testo in tutta l'app. Noto Serif e'
// disponibile solo per elementi editoriali occasionali (mai in header o
// dashboard) - vedi @theme in globals.css per --font-sans/--font-serif.
const openSans = Open_Sans({ subsets: ["latin"], variable: "--font-sans" });
const notoSerif = Noto_Serif({ subsets: ["latin"], variable: "--font-serif" });

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: "#017A92",
};

export const metadata: Metadata = {
  title: {
    default: "Metodo Control",
    template: "%s | Metodo Control",
  },
  description: "Piattaforma di controllo operativo MeToDo",
  applicationName: "MeToDo Control",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/pwa-192x192.png", type: "image/png", sizes: "192x192" },
      { url: "/icons/pwa-512x512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/favicon.ico"],
  },
  appleWebApp: {
    capable: true,
    title: "MeToDo Control",
    statusBarStyle: "default",
    startupImage: ["/icons/apple-touch-icon.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="it"
      className={cn(
        "h-full",
        "antialiased",
        openSans.variable,
        notoSerif.variable,
        geistMono.variable,
        "font-sans"
      )}
    >
      <body className="min-h-full flex flex-col">
        <Script id="onesignal-init" strategy="beforeInteractive">
          {`
            window.OneSignalDeferred = window.OneSignalDeferred || [];
          `}
        </Script>
        <Script
          src="https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js"
          strategy="afterInteractive"
        />
        <Script id="service-worker-registration" strategy="afterInteractive">
          {`
            if ("serviceWorker" in navigator) {
              window.addEventListener("load", () => {
                navigator.serviceWorker.register("/sw.js")
                  .then(() => console.log("SW registered"))
                  .catch(err => console.log("SW error", err));
              });
            }
          `}
        </Script>
        {children}
      </body>
    </html>
  );
}

import { Header } from "@/components/Header";
import PushNotificationBanner from "../../components/notifications/PushNotificationBanner";
import PushNotificationClickHandler from "../../components/notifications/PushNotificationClickHandler";

export default function ControlLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Header />

      <main className="min-h-screen bg-[#f5f3ef] px-6 py-8 text-[#2B2D2F] md:px-10">
        <div className="mx-auto max-w-7xl space-y-6">
          <PushNotificationBanner />
          <PushNotificationClickHandler />

          {children}
        </div>
      </main>
    </>
  );
}

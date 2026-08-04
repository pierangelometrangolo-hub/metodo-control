import HamburgerMenu from "../../components/HamburgerMenu";
import PushNotificationBanner from "../../components/notifications/PushNotificationBanner";

export default function ControlLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[#f5f3ef] px-6 py-8 text-[#2B2D2F] md:px-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center justify-end">
          <HamburgerMenu />
        </div>

        <PushNotificationBanner />

        {children}
      </div>
    </main>
  );
}
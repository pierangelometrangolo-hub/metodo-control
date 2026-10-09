import AppNavigation from "@/components/AppNavigation";
import PushNotificationBanner from "../../components/notifications/PushNotificationBanner";
import PushNotificationClickHandler from "../../components/notifications/PushNotificationClickHandler";

export default function ControlLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppNavigation>
      <div className="space-y-6">
        <PushNotificationBanner />
        <PushNotificationClickHandler />

        {children}
      </div>
    </AppNavigation>
  );
}

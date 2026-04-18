import { useMemo } from "react";
import { useLocation } from "react-router-dom";

import DriverAlertsPanel from "@/components/role/driver/DriverAlertsPanel";
import DriverNotificationsPanel from "@/components/role/driver/DriverNotificationsPanel";
import DriverOverviewPanel from "@/components/role/driver/DriverOverviewPanel";
import DriverRoutesPanel from "@/components/role/driver/DriverRoutesPanel";
import DriverShiftsPanel from "@/components/role/driver/DriverShiftsPanel";
import DriverStopsPanel from "@/components/role/driver/DriverStopsPanel";
import RoleDashboardLayout from "@/components/role/RoleDashboardLayout";
import RoleSectionPlaceholderCard from "@/components/role/RoleSectionPlaceholderCard";
import {
  DRIVER_DASHBOARD_NAV_ITEMS,
  type DashboardNavItem,
} from "@/lib/roleRouting";
import type { LoginResponse, UserSummaryResponse } from "@/types/auth";

type DriverDashboardPageProps = {
  user: UserSummaryResponse;
  session: LoginResponse;
  onLogout: () => void;
  apiBaseUrl: string;
};

function DriverDashboardPage({
  user,
  session,
  onLogout,
  apiBaseUrl,
}: DriverDashboardPageProps) {
  const location = useLocation();

  const activeNavItem = useMemo<DashboardNavItem>(() => {
    return (
      DRIVER_DASHBOARD_NAV_ITEMS.find(
        (item) => item.path === location.pathname,
      ) ?? DRIVER_DASHBOARD_NAV_ITEMS[0]
    );
  }, [location.pathname]);

  const isOverview = activeNavItem.key === "overview";
  const isMyRoutes = activeNavItem.key === "my-routes";
  const isMyStops = activeNavItem.key === "my-stops";
  const isMyShifts = activeNavItem.key === "my-shifts";
  const isAlerts = activeNavItem.key === "alerts";
  const isNotifications = activeNavItem.key === "notifications";

  return (
    <RoleDashboardLayout
      title="Driver Dashboard"
      subtitle={`Signed in as ${user.full_name} (${user.email})`}
      user={user}
      session={session}
      onLogout={onLogout}
      navigationItems={DRIVER_DASHBOARD_NAV_ITEMS}
    >
      {isOverview ? (
        <DriverOverviewPanel
          accessToken={session.access_token}
          apiBaseUrl={apiBaseUrl}
          userId={session.user_id}
        />
      ) : isMyRoutes ? (
        <DriverRoutesPanel
          accessToken={session.access_token}
          apiBaseUrl={apiBaseUrl}
        />
      ) : isMyStops ? (
        <DriverStopsPanel
          accessToken={session.access_token}
          apiBaseUrl={apiBaseUrl}
        />
      ) : isMyShifts ? (
        <DriverShiftsPanel
          accessToken={session.access_token}
          apiBaseUrl={apiBaseUrl}
        />
      ) : isAlerts ? (
        <DriverAlertsPanel
          accessToken={session.access_token}
          apiBaseUrl={apiBaseUrl}
          userId={session.user_id}
        />
      ) : isNotifications ? (
        <DriverNotificationsPanel
          accessToken={session.access_token}
          apiBaseUrl={apiBaseUrl}
        />
      ) : (
        <RoleSectionPlaceholderCard
          sectionLabel={`Driver: ${activeNavItem.label}`}
          message="This driver module route is available in navigation now and will be wired to actual screens incrementally."
        />
      )}
    </RoleDashboardLayout>
  );
}

export default DriverDashboardPage;

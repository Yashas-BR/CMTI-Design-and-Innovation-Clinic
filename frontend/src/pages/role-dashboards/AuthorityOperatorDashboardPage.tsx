import OperatorOverviewPanel from "@/components/role/OperatorOverviewPanel";
import OperatorAlertsPanel from "@/components/role/operator/OperatorAlertsPanel";
import OperatorAnalyticsPanel from "@/components/role/operator/OperatorAnalyticsPanel";
import OperatorDriversPanel from "@/components/role/operator/OperatorDriversPanel";
import OperatorMasterDataPanel from "@/components/role/operator/OperatorMasterDataPanel";
import OperatorNavigationMapCard from "@/components/role/operator/OperatorNavigationMapCard";
import OperatorNotificationsPanel from "@/components/role/operator/OperatorNotificationsPanel";
import OperatorOperationsPanel from "@/components/role/operator/OperatorOperationsPanel";
import OperatorRealtimePanel from "@/components/role/operator/OperatorRealtimePanel";
import RoleDashboardLayout from "@/components/role/RoleDashboardLayout";
import RoleSectionPlaceholderCard from "@/components/role/RoleSectionPlaceholderCard";
import {
  OPERATOR_DASHBOARD_NAV_ITEMS,
  type DashboardNavItem,
} from "@/lib/roleRouting";
import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import type { LoginResponse, UserSummaryResponse } from "@/types/auth";

type AuthorityOperatorDashboardPageProps = {
  user: UserSummaryResponse;
  session: LoginResponse;
  onLogout: () => void;
  apiBaseUrl: string;
};

function AuthorityOperatorDashboardPage({
  user,
  session,
  onLogout,
  apiBaseUrl,
}: AuthorityOperatorDashboardPageProps) {
  const location = useLocation();

  const activeNavItem = useMemo<DashboardNavItem>(() => {
    return (
      OPERATOR_DASHBOARD_NAV_ITEMS.find(
        (item) => item.path === location.pathname,
      ) ?? OPERATOR_DASHBOARD_NAV_ITEMS[0]
    );
  }, [location.pathname]);

  const isOverview = activeNavItem.key === "overview";
  const isDrivers = activeNavItem.key === "drivers";
  const isMasterData = activeNavItem.key === "master-data";
  const isOperations = activeNavItem.key === "operations";
  const isAssignments = activeNavItem.key === "assignments";
  const isAlerts = activeNavItem.key === "alerts";
  const isAnalytics = activeNavItem.key === "analytics";
  const isNotifications = activeNavItem.key === "notifications";
  const isRealtime = activeNavItem.key === "realtime";

  return (
    <RoleDashboardLayout
      title="Authority Operator Dashboard"
      subtitle={`Signed in as ${user.full_name} (${user.email})`}
      user={user}
      session={session}
      onLogout={onLogout}
      navigationItems={OPERATOR_DASHBOARD_NAV_ITEMS}
      belowNavigationContent={
        isOverview ? (
          <OperatorNavigationMapCard
            accessToken={session.access_token}
            apiBaseUrl={apiBaseUrl}
          />
        ) : null
      }
    >
      {isOverview ? (
        <OperatorOverviewPanel
          accessToken={session.access_token}
          apiBaseUrl={apiBaseUrl}
        />
      ) : isDrivers ? (
        <OperatorDriversPanel
          accessToken={session.access_token}
          apiBaseUrl={apiBaseUrl}
        />
      ) : isMasterData ? (
        <OperatorMasterDataPanel
          accessToken={session.access_token}
          apiBaseUrl={apiBaseUrl}
        />
      ) : isOperations ? (
        <OperatorOperationsPanel
          accessToken={session.access_token}
          apiBaseUrl={apiBaseUrl}
          initialTab="overview"
        />
      ) : isAssignments ? (
        <OperatorOperationsPanel
          accessToken={session.access_token}
          apiBaseUrl={apiBaseUrl}
          initialTab="assignments"
        />
      ) : isAlerts ? (
        <OperatorAlertsPanel
          accessToken={session.access_token}
          apiBaseUrl={apiBaseUrl}
        />
      ) : isAnalytics ? (
        <OperatorAnalyticsPanel
          accessToken={session.access_token}
          apiBaseUrl={apiBaseUrl}
        />
      ) : isNotifications ? (
        <OperatorNotificationsPanel
          accessToken={session.access_token}
          apiBaseUrl={apiBaseUrl}
        />
      ) : isRealtime ? (
        <OperatorRealtimePanel
          accessToken={session.access_token}
          apiBaseUrl={apiBaseUrl}
        />
      ) : (
        <RoleSectionPlaceholderCard
          sectionLabel={`Operator: ${activeNavItem.label}`}
          message="This operator module route is ready for navigation and will be connected as each page is implemented."
        />
      )}
    </RoleDashboardLayout>
  );
}

export default AuthorityOperatorDashboardPage;

import AdminSimulatorPanel from "@/components/role/admin/AdminSimulatorPanel";
import RoleDashboardLayout from "@/components/role/RoleDashboardLayout";
import RoleSectionPlaceholderCard from "@/components/role/RoleSectionPlaceholderCard";
import { getApiBaseUrl } from "@/lib/authApi";
import {
  ADMIN_DASHBOARD_NAV_ITEMS,
  type DashboardNavItem,
} from "@/lib/roleRouting";
import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import type { LoginResponse, UserSummaryResponse } from "@/types/auth";

type AuthorityAdminDashboardPageProps = {
  user: UserSummaryResponse;
  session: LoginResponse;
  onLogout: () => void;
};

function AuthorityAdminDashboardPage({
  user,
  session,
  onLogout,
}: AuthorityAdminDashboardPageProps) {
  const location = useLocation();
  const apiBaseUrl = getApiBaseUrl();

  const activeNavItem = useMemo<DashboardNavItem>(() => {
    return (
      ADMIN_DASHBOARD_NAV_ITEMS.find(
        (item) => item.path === location.pathname,
      ) ?? ADMIN_DASHBOARD_NAV_ITEMS[0]
    );
  }, [location.pathname]);

  const isOverview = activeNavItem.key === "overview";
  const isSimulator = activeNavItem.key === "simulator";

  return (
    <RoleDashboardLayout
      title="Authority Admin Dashboard"
      subtitle={`Signed in as ${user.full_name} (${user.email})`}
      user={user}
      session={session}
      onLogout={onLogout}
      navigationItems={ADMIN_DASHBOARD_NAV_ITEMS}
    >
      {isOverview || isSimulator ? (
        <AdminSimulatorPanel
          accessToken={session.access_token}
          apiBaseUrl={apiBaseUrl}
        />
      ) : (
        <RoleSectionPlaceholderCard
          sectionLabel={`Admin: ${activeNavItem.label}`}
          message="This admin module is added for role-based navigation now and will be connected to backend flows next."
        />
      )}
    </RoleDashboardLayout>
  );
}

export default AuthorityAdminDashboardPage;

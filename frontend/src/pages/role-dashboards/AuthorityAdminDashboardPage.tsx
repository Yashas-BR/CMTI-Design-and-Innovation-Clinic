import RoleDashboardLayout from "@/components/role/RoleDashboardLayout";
import RoleSectionPlaceholderCard from "@/components/role/RoleSectionPlaceholderCard";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

  const activeNavItem = useMemo<DashboardNavItem>(() => {
    return (
      ADMIN_DASHBOARD_NAV_ITEMS.find(
        (item) => item.path === location.pathname,
      ) ?? ADMIN_DASHBOARD_NAV_ITEMS[0]
    );
  }, [location.pathname]);

  const isOverview = activeNavItem.key === "overview";

  return (
    <RoleDashboardLayout
      title="Authority Admin Dashboard"
      subtitle={`Signed in as ${user.full_name} (${user.email})`}
      user={user}
      session={session}
      onLogout={onLogout}
      navigationItems={ADMIN_DASHBOARD_NAV_ITEMS}
    >
      {isOverview ? (
        <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
          <CardHeader>
            <CardTitle>Admin Controls Planned Last</CardTitle>
            <CardDescription>
              Admin module is reserved for hackathon fake-data control utilities
              and will be integrated in the final stage.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-slate-700">
            Continue active implementation under the operator dashboard for core
            product workflows.
          </CardContent>
        </Card>
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

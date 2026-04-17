import { Truck } from "lucide-react";
import { useMemo } from "react";
import { useLocation } from "react-router-dom";

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
  DRIVER_DASHBOARD_NAV_ITEMS,
  type DashboardNavItem,
} from "@/lib/roleRouting";
import type { LoginResponse, UserSummaryResponse } from "@/types/auth";

type DriverDashboardPageProps = {
  user: UserSummaryResponse;
  session: LoginResponse;
  onLogout: () => void;
};

function DriverDashboardPage({
  user,
  session,
  onLogout,
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
        <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl text-slate-900">
              <Truck className="h-5 w-5 text-sky-700" />
              Driver Route Active
            </CardTitle>
            <CardDescription>
              Driver-specific workflows stay isolated under this route.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-slate-700">
            Next modules for route assignments, stops, and shift operations
            should be implemented in this dashboard.
          </CardContent>
        </Card>
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

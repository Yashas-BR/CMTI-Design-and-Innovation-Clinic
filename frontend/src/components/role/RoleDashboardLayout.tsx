import { CircleUserRound, LogOut } from "lucide-react";
import { NavLink } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { type DashboardNavItem, roleLabel } from "@/lib/roleRouting";
import type { LoginResponse, UserSummaryResponse } from "@/types/auth";

type RoleDashboardLayoutProps = {
  title: string;
  subtitle: string;
  user: UserSummaryResponse;
  session: LoginResponse;
  onLogout: () => void;
  navigationItems: DashboardNavItem[];
  belowNavigationContent?: React.ReactNode;
  children: React.ReactNode;
};

function RoleDashboardLayout({
  title,
  subtitle,
  user,
  session,
  onLogout,
  navigationItems,
  belowNavigationContent,
  children,
}: RoleDashboardLayoutProps) {
  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_10%_15%,#cffafe_0%,#effcf7_42%,#f8fafc_100%)] px-4 py-8 sm:px-6 sm:py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-2xl text-slate-900">
                <CircleUserRound className="h-5 w-5 text-cyan-700" />
                {title}
              </CardTitle>
              <CardDescription className="mt-1 text-sm text-slate-600">
                {subtitle}
              </CardDescription>
            </div>
            <Button variant="outline" onClick={onLogout}>
              <LogOut className="h-4 w-4" />
              Logout
            </Button>
          </CardHeader>

          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Organization
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {session.org_id}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                User ID
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {session.user_id}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Roles
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {user.role_keys.map((roleKey) => (
                  <Badge key={String(roleKey)} variant="secondary">
                    {roleLabel(roleKey)}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
          <CardHeader>
            <CardTitle className="text-lg">Role Navigation</CardTitle>
            <CardDescription>
              Choose a section for this role. Modules will be aligned page by
              page.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 text-sm">
            {navigationItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  isActive
                    ? "rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 font-medium text-cyan-800"
                    : "rounded-full border bg-white px-3 py-1 text-slate-700 hover:bg-slate-50"
                }
              >
                {item.label}
              </NavLink>
            ))}
          </CardContent>
        </Card>

        {belowNavigationContent}

        {children}
      </div>
    </main>
  );
}

export default RoleDashboardLayout;

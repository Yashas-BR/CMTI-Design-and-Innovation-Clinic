import { useMemo, useState } from "react";
import { CircleUserRound, LogOut, Shield, Truck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  CreateDriverRequest,
  LoginResponse,
  UserSummaryResponse,
} from "@/types/auth";

type AuthWorkspacePageProps = {
  user: UserSummaryResponse;
  session: LoginResponse;
  onLogout: () => void;
  onCreateDriver: (
    payload: CreateDriverRequest,
  ) => Promise<UserSummaryResponse>;
};

function roleLabel(role: string): string {
  if (role === "authority_admin") {
    return "Authority Admin";
  }
  if (role === "authority_operator") {
    return "Authority Operator";
  }
  if (role === "driver") {
    return "Driver";
  }
  return role;
}

function AuthWorkspacePage({
  user,
  session,
  onLogout,
  onCreateDriver,
}: AuthWorkspacePageProps) {
  const [driverName, setDriverName] = useState("");
  const [driverEmail, setDriverEmail] = useState("");
  const [driverPassword, setDriverPassword] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [isCreatingDriver, setIsCreatingDriver] = useState(false);
  const [driverCreateError, setDriverCreateError] = useState("");
  const [driverCreateNotice, setDriverCreateNotice] = useState("");

  const isAuthorityUser = useMemo(() => {
    return (
      user.role_keys.includes("authority_admin") ||
      user.role_keys.includes("authority_operator")
    );
  }, [user.role_keys]);

  const isDriver = useMemo(
    () => user.role_keys.includes("driver"),
    [user.role_keys],
  );

  const canCreateDriver = useMemo(() => {
    return (
      driverName.trim().length > 0 &&
      driverEmail.trim().length > 0 &&
      driverPassword.length >= 8 &&
      !isCreatingDriver
    );
  }, [driverEmail, driverName, driverPassword, isCreatingDriver]);

  const handleCreateDriver = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    if (!canCreateDriver) {
      return;
    }

    setIsCreatingDriver(true);
    setDriverCreateError("");
    setDriverCreateNotice("");

    try {
      const created = await onCreateDriver({
        full_name: driverName.trim(),
        email: driverEmail.trim(),
        password: driverPassword,
        phone: driverPhone.trim() || null,
      });

      setDriverCreateNotice(
        `Driver created: ${created.full_name} (${created.email})`,
      );
      setDriverName("");
      setDriverEmail("");
      setDriverPassword("");
      setDriverPhone("");
    } catch (error) {
      if (error instanceof Error) {
        setDriverCreateError(error.message);
      } else {
        setDriverCreateError("Failed to create driver");
      }
    } finally {
      setIsCreatingDriver(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_10%_15%,#cffafe_0%,#effcf7_42%,#f8fafc_100%)] px-4 py-8 sm:px-6 sm:py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-2xl text-slate-900">
                <CircleUserRound className="h-5 w-5 text-cyan-700" />
                Auth Session Workspace
              </CardTitle>
              <CardDescription className="mt-1 text-sm text-slate-600">
                Signed in as {user.full_name} ({user.email})
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
                  <Badge key={roleKey} variant="secondary">
                    {roleLabel(roleKey)}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {isAuthorityUser && (
          <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl text-slate-900">
                <Shield className="h-5 w-5 text-emerald-700" />
                Authority Action: Create Driver
              </CardTitle>
              <CardDescription>
                Uses POST /api/v1/auth/drivers and follows the backend auth
                model constraints.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={handleCreateDriver}
                className="grid gap-4 sm:grid-cols-2"
              >
                <div className="space-y-2">
                  <Label htmlFor="driver-name">Full name</Label>
                  <Input
                    id="driver-name"
                    value={driverName}
                    onChange={(event) => setDriverName(event.target.value)}
                    disabled={isCreatingDriver}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="driver-email">Email</Label>
                  <Input
                    id="driver-email"
                    type="email"
                    value={driverEmail}
                    onChange={(event) => setDriverEmail(event.target.value)}
                    disabled={isCreatingDriver}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="driver-password">Temporary password</Label>
                  <Input
                    id="driver-password"
                    type="password"
                    value={driverPassword}
                    onChange={(event) => setDriverPassword(event.target.value)}
                    disabled={isCreatingDriver}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="driver-phone">Phone (optional)</Label>
                  <Input
                    id="driver-phone"
                    value={driverPhone}
                    onChange={(event) => setDriverPhone(event.target.value)}
                    disabled={isCreatingDriver}
                  />
                </div>

                <div className="sm:col-span-2">
                  {driverCreateError && (
                    <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {driverCreateError}
                    </p>
                  )}
                  {driverCreateNotice && (
                    <p className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                      {driverCreateNotice}
                    </p>
                  )}

                  <Button type="submit" disabled={!canCreateDriver}>
                    {isCreatingDriver ? "Creating driver..." : "Create driver"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {isDriver && (
          <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl text-slate-900">
                <Truck className="h-5 w-5 text-sky-700" />
                Driver Access Ready
              </CardTitle>
              <CardDescription>
                Driver authentication is active. Next pages to wire will use
                this same session model for shifts, route assignments, and stop
                workflows.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </main>
  );
}

export default AuthWorkspacePage;

import { useMemo, useState } from "react";
import { Shield } from "lucide-react";

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
import type { CreateDriverRequest, UserSummaryResponse } from "@/types/auth";

type CreateDriverCardProps = {
  title: string;
  description: string;
  onCreateDriver: (
    payload: CreateDriverRequest,
  ) => Promise<UserSummaryResponse>;
};

function CreateDriverCard({
  title,
  description,
  onCreateDriver,
}: CreateDriverCardProps) {
  const [driverName, setDriverName] = useState("");
  const [driverEmail, setDriverEmail] = useState("");
  const [driverPassword, setDriverPassword] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [isCreatingDriver, setIsCreatingDriver] = useState(false);
  const [driverCreateError, setDriverCreateError] = useState("");
  const [driverCreateNotice, setDriverCreateNotice] = useState("");

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
    <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl text-slate-900">
          <Shield className="h-5 w-5 text-emerald-700" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
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
  );
}

export default CreateDriverCard;

import { useMemo, useState } from "react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  CreateDriverFormPayload,
  DepotItem,
} from "@/components/role/operator/types";

type DriverCreateFormCardProps = {
  depots: DepotItem[];
  isSubmitting: boolean;
  errorMessage: string;
  noticeMessage: string;
  onCreate: (payload: CreateDriverFormPayload) => Promise<void>;
};

function DriverCreateFormCard({
  depots,
  isSubmitting,
  errorMessage,
  noticeMessage,
  onCreate,
}: DriverCreateFormCardProps) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [employmentStatus, setEmploymentStatus] = useState("full_time");
  const [licenseNo, setLicenseNo] = useState("");
  const [licenseExpiry, setLicenseExpiry] = useState("");
  const [homeDepotId, setHomeDepotId] = useState("__none__");

  const canSubmit = useMemo(() => {
    return (
      fullName.trim().length > 0 &&
      email.trim().length > 0 &&
      password.length >= 8 &&
      employmentStatus.trim().length > 0 &&
      !isSubmitting
    );
  }, [email, employmentStatus, fullName, isSubmitting, password]);

  const clearForm = () => {
    setFullName("");
    setEmail("");
    setPassword("");
    setPhone("");
    setEmploymentStatus("full_time");
    setLicenseNo("");
    setLicenseExpiry("");
    setHomeDepotId("__none__");
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    await onCreate({
      full_name: fullName.trim(),
      email: email.trim(),
      password,
      phone: phone.trim(),
      employment_status: employmentStatus,
      license_no: licenseNo.trim(),
      license_expiry: licenseExpiry,
      home_depot_id: homeDepotId,
    });

    clearForm();
  };

  return (
    <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
      <CardHeader>
        <CardTitle>Create Driver</CardTitle>
        <CardDescription>
          Create a driver user and attach profile details in a single workflow.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="driver-full-name">Full Name</Label>
            <Input
              id="driver-full-name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              disabled={isSubmitting}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="driver-email">Email</Label>
            <Input
              id="driver-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={isSubmitting}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="driver-password">Temporary Password</Label>
            <Input
              id="driver-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={isSubmitting}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="driver-phone">Phone</Label>
            <Input
              id="driver-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              disabled={isSubmitting}
              placeholder="Optional"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="driver-employment-status">Employment Status</Label>
            <Select
              value={employmentStatus}
              onValueChange={setEmploymentStatus}
              disabled={isSubmitting}
            >
              <SelectTrigger id="driver-employment-status">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full_time">Full Time</SelectItem>
                <SelectItem value="contract">Contract</SelectItem>
                <SelectItem value="part_time">Part Time</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="driver-home-depot">Home Depot</Label>
            <Select
              value={homeDepotId}
              onValueChange={setHomeDepotId}
              disabled={isSubmitting}
            >
              <SelectTrigger id="driver-home-depot">
                <SelectValue placeholder="Select depot" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No home depot</SelectItem>
                {depots.map((depot) => (
                  <SelectItem key={depot.id} value={String(depot.id)}>
                    {depot.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="driver-license-no">License Number</Label>
            <Input
              id="driver-license-no"
              value={licenseNo}
              onChange={(event) => setLicenseNo(event.target.value)}
              disabled={isSubmitting}
              placeholder="Optional"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="driver-license-expiry">License Expiry</Label>
            <Input
              id="driver-license-expiry"
              type="date"
              value={licenseExpiry}
              onChange={(event) => setLicenseExpiry(event.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div className="sm:col-span-2 space-y-3">
            {errorMessage ? (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {errorMessage}
              </p>
            ) : null}

            {noticeMessage ? (
              <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {noticeMessage}
              </p>
            ) : null}

            <Button type="submit" disabled={!canSubmit}>
              {isSubmitting ? "Creating..." : "Create Driver"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default DriverCreateFormCard;

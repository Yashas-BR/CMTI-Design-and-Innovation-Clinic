import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { RefreshCw } from "lucide-react";

import DriverCreateFormCard from "@/components/role/operator/DriverCreateFormCard";
import DriverManagementTable from "@/components/role/operator/DriverManagementTable";
import type {
  CreateDriverFormPayload,
  DepotItem,
  DriverProfile,
  DriverProfileFormPayload,
  DriverRow,
  DriverUser,
} from "@/components/role/operator/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { extractApiErrorMessage } from "@/lib/authApi";

type OperatorDriversPanelProps = {
  accessToken: string;
  apiBaseUrl: string;
};

type UserListResponse = {
  total: number;
  items: DriverUser[];
};

type DriverProfileListResponse = {
  total: number;
  items: DriverProfile[];
};

type DepotListResponse = {
  total: number;
  items: DepotItem[];
};

const DEFAULT_PROFILE_FORM: DriverProfileFormPayload = {
  employment_status: "full_time",
  license_no: "",
  license_expiry: "",
  home_depot_id: "__none__",
};

const LIST_LIMIT = 100;

function OperatorDriversPanel({
  accessToken,
  apiBaseUrl,
}: OperatorDriversPanelProps) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DriverRow[]>([]);
  const [depots, setDepots] = useState<DepotItem[]>([]);
  const [searchText, setSearchText] = useState("");

  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createNotice, setCreateNotice] = useState("");

  const [deactivatingUserId, setDeactivatingUserId] = useState<number | null>(
    null,
  );

  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [selectedRow, setSelectedRow] = useState<DriverRow | null>(null);

  const [profileForm, setProfileForm] =
    useState<DriverProfileFormPayload>(DEFAULT_PROFILE_FORM);
  const [passwordForm, setPasswordForm] = useState("");

  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${accessToken}` }),
    [accessToken],
  );

  const fetchDrivers = useCallback(async () => {
    setLoading(true);

    try {
      const [usersRes, profilesRes, depotsRes] = await Promise.all([
        axios.get<UserListResponse>(`${apiBaseUrl}/users`, {
          headers,
          params: {
            role: "driver",
            limit: LIST_LIMIT,
            offset: 0,
          },
        }),
        axios.get<DriverProfileListResponse>(
          `${apiBaseUrl}/master-data/driver-profiles`,
          {
            headers,
            params: {
              limit: LIST_LIMIT,
              offset: 0,
            },
          },
        ),
        axios.get<DepotListResponse>(`${apiBaseUrl}/master-data/depots`, {
          headers,
          params: {
            limit: LIST_LIMIT,
            offset: 0,
          },
        }),
      ]);

      const profileByUser = new Map<number, DriverProfile>();
      for (const profile of profilesRes.data.items) {
        profileByUser.set(profile.user_id, profile);
      }

      const depotNameById = new Map<number, string>();
      for (const depot of depotsRes.data.items) {
        depotNameById.set(depot.id, depot.name);
      }

      const nextRows: DriverRow[] = usersRes.data.items
        .map((user) => {
          const profile = profileByUser.get(user.id) ?? null;
          const homeDepotName =
            profile?.home_depot_id != null
              ? (depotNameById.get(profile.home_depot_id) ?? null)
              : null;

          return {
            user,
            profile,
            homeDepotName,
          };
        })
        .sort((left, right) =>
          left.user.full_name.localeCompare(right.user.full_name),
        );

      setRows(nextRows);
      setDepots(depotsRes.data.items);
      setActionError("");
    } catch (error) {
      setRows([]);
      setDepots([]);
      setActionError(
        extractApiErrorMessage(error, "Failed to load drivers data."),
      );
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, headers]);

  const filteredRows = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) {
      return rows;
    }

    return rows.filter((row) => {
      const text =
        `${row.user.full_name} ${row.user.email} ${row.homeDepotName ?? ""}`.toLowerCase();
      return text.includes(query);
    });
  }, [rows, searchText]);

  const createDriverWithProfile = async (payload: CreateDriverFormPayload) => {
    setCreateSubmitting(true);
    setCreateError("");
    setCreateNotice("");

    try {
      const createRes = await axios.post<DriverUser>(
        `${apiBaseUrl}/auth/drivers`,
        {
          full_name: payload.full_name,
          email: payload.email,
          password: payload.password,
          phone: payload.phone.trim() || null,
        },
        { headers },
      );

      try {
        await axios.post(
          `${apiBaseUrl}/master-data/driver-profiles`,
          {
            user_id: createRes.data.id,
            employment_status: payload.employment_status,
            license_no: payload.license_no.trim() || null,
            license_expiry: payload.license_expiry || null,
            home_depot_id:
              payload.home_depot_id === "__none__"
                ? null
                : Number.parseInt(payload.home_depot_id, 10),
          },
          { headers },
        );
        setCreateNotice("Driver and profile created successfully.");
      } catch (profileError) {
        setCreateError(
          `Driver created but profile setup failed: ${extractApiErrorMessage(profileError, "profile create failed")}`,
        );
      }

      await fetchDrivers();
    } catch (error) {
      setCreateError(extractApiErrorMessage(error, "Failed to create driver."));
      throw error;
    } finally {
      setCreateSubmitting(false);
    }
  };

  const openProfileDialog = (row: DriverRow) => {
    setSelectedRow(row);
    setProfileForm({
      employment_status: row.profile?.employment_status ?? "full_time",
      license_no: row.profile?.license_no ?? "",
      license_expiry: row.profile?.license_expiry ?? "",
      home_depot_id:
        row.profile?.home_depot_id != null
          ? String(row.profile.home_depot_id)
          : "__none__",
    });
    setActionError("");
    setActionNotice("");
    setProfileDialogOpen(true);
  };

  const openPasswordDialog = (row: DriverRow) => {
    setSelectedRow(row);
    setPasswordForm("");
    setActionError("");
    setActionNotice("");
    setPasswordDialogOpen(true);
  };

  const saveProfile = async () => {
    if (!selectedRow) {
      return;
    }

    setActionSubmitting(true);
    setActionError("");
    setActionNotice("");

    try {
      const payload = {
        employment_status: profileForm.employment_status,
        license_no: profileForm.license_no.trim() || null,
        license_expiry: profileForm.license_expiry || null,
        home_depot_id:
          profileForm.home_depot_id === "__none__"
            ? null
            : Number.parseInt(profileForm.home_depot_id, 10),
      };

      if (selectedRow.profile) {
        await axios.patch(
          `${apiBaseUrl}/master-data/driver-profiles/${selectedRow.profile.id}`,
          payload,
          { headers },
        );
      } else {
        await axios.post(
          `${apiBaseUrl}/master-data/driver-profiles`,
          {
            user_id: selectedRow.user.id,
            ...payload,
          },
          { headers },
        );
      }

      setActionNotice("Driver profile saved.");
      setProfileDialogOpen(false);
      await fetchDrivers();
    } catch (error) {
      setActionError(
        extractApiErrorMessage(error, "Failed to save driver profile."),
      );
    } finally {
      setActionSubmitting(false);
    }
  };

  const resetPassword = async () => {
    if (!selectedRow || passwordForm.length < 8) {
      return;
    }

    setActionSubmitting(true);
    setActionError("");
    setActionNotice("");

    try {
      await axios.post(
        `${apiBaseUrl}/users/${selectedRow.user.id}/password/reset`,
        { new_password: passwordForm },
        { headers },
      );
      setActionNotice("Driver password reset successfully.");
      setPasswordDialogOpen(false);
    } catch (error) {
      setActionError(
        extractApiErrorMessage(error, "Failed to reset password."),
      );
    } finally {
      setActionSubmitting(false);
    }
  };

  const deactivateDriver = async (row: DriverRow) => {
    const confirmed = window.confirm(
      `Deactivate driver ${row.user.full_name}? They will not be able to login.`,
    );
    if (!confirmed) {
      return;
    }

    setDeactivatingUserId(row.user.id);
    setActionError("");
    setActionNotice("");

    try {
      await axios.post(
        `${apiBaseUrl}/users/${row.user.id}/deactivate`,
        {},
        { headers },
      );
      setActionNotice(`${row.user.full_name} has been deactivated.`);
      await fetchDrivers();
    } catch (error) {
      setActionError(
        extractApiErrorMessage(error, "Failed to deactivate driver."),
      );
    } finally {
      setDeactivatingUserId(null);
    }
  };

  useEffect(() => {
    void fetchDrivers();
  }, [fetchDrivers]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-52 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <DriverCreateFormCard
        depots={depots}
        isSubmitting={createSubmitting}
        errorMessage={createError}
        noticeMessage={createNotice}
        onCreate={createDriverWithProfile}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-sm">
          <Input
            placeholder="Search by name, email or depot"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
        </div>
        <Button variant="outline" onClick={() => void fetchDrivers()}>
          <RefreshCw className="mr-1 h-4 w-4" />
          Refresh Drivers
        </Button>
      </div>

      {actionError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </p>
      ) : null}

      {actionNotice ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {actionNotice}
        </p>
      ) : null}

      <DriverManagementTable
        rows={filteredRows}
        isRefreshing={loading}
        deactivatingUserId={deactivatingUserId}
        onEditProfile={openProfileDialog}
        onResetPassword={openPasswordDialog}
        onDeactivate={deactivateDriver}
      />

      <Dialog open={profileDialogOpen} onOpenChange={setProfileDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Driver Profile</DialogTitle>
            <DialogDescription>
              Edit profile details for {selectedRow?.user.full_name ?? "driver"}
              .
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="edit-employment-status">Employment Status</Label>
              <Select
                value={profileForm.employment_status}
                onValueChange={(value) =>
                  setProfileForm((prev) => ({
                    ...prev,
                    employment_status: value,
                  }))
                }
              >
                <SelectTrigger id="edit-employment-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_time">Full Time</SelectItem>
                  <SelectItem value="contract">Contract</SelectItem>
                  <SelectItem value="part_time">Part Time</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-home-depot">Home Depot</Label>
              <Select
                value={profileForm.home_depot_id}
                onValueChange={(value) =>
                  setProfileForm((prev) => ({ ...prev, home_depot_id: value }))
                }
              >
                <SelectTrigger id="edit-home-depot">
                  <SelectValue />
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
              <Label htmlFor="edit-license-no">License Number</Label>
              <Input
                id="edit-license-no"
                value={profileForm.license_no}
                onChange={(event) =>
                  setProfileForm((prev) => ({
                    ...prev,
                    license_no: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-license-expiry">License Expiry</Label>
              <Input
                id="edit-license-expiry"
                type="date"
                value={profileForm.license_expiry}
                onChange={(event) =>
                  setProfileForm((prev) => ({
                    ...prev,
                    license_expiry: event.target.value,
                  }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setProfileDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void saveProfile()}
              disabled={actionSubmitting}
            >
              {actionSubmitting ? "Saving..." : "Save Profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Driver Password</DialogTitle>
            <DialogDescription>
              Set a new password for {selectedRow?.user.full_name ?? "driver"}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="new-driver-password">New Password</Label>
            <Input
              id="new-driver-password"
              type="password"
              value={passwordForm}
              onChange={(event) => setPasswordForm(event.target.value)}
              placeholder="Minimum 8 characters"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPasswordDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void resetPassword()}
              disabled={actionSubmitting || passwordForm.length < 8}
            >
              {actionSubmitting ? "Updating..." : "Reset Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default OperatorDriversPanel;

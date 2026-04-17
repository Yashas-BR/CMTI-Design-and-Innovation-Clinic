import { KeyRound, PencilLine, UserX } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DriverRow } from "@/components/role/operator/types";

type DriverManagementTableProps = {
  rows: DriverRow[];
  isRefreshing: boolean;
  deactivatingUserId: number | null;
  onEditProfile: (row: DriverRow) => void;
  onResetPassword: (row: DriverRow) => void;
  onDeactivate: (row: DriverRow) => Promise<void>;
};

function DriverManagementTable({
  rows,
  isRefreshing,
  deactivatingUserId,
  onEditProfile,
  onResetPassword,
  onDeactivate,
}: DriverManagementTableProps) {
  return (
    <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Driver Directory</CardTitle>
          <CardDescription>
            Read and manage all drivers including profile, password reset, and
            deactivation.
          </CardDescription>
        </div>
        <Badge variant="secondary">
          {isRefreshing ? "Refreshing..." : `${rows.length} Drivers`}
        </Badge>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            No drivers found yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Employment</TableHead>
                  <TableHead>Depot</TableHead>
                  <TableHead>License</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const profile = row.profile;
                  const isDeactivating = deactivatingUserId === row.user.id;

                  return (
                    <TableRow key={row.user.id}>
                      <TableCell className="font-medium">
                        {row.user.full_name}
                      </TableCell>
                      <TableCell>{row.user.email}</TableCell>
                      <TableCell>
                        <Badge
                          className={
                            row.user.is_active
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-red-200 bg-red-50 text-red-700"
                          }
                        >
                          {row.user.is_active ? "active" : "inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {profile?.employment_status ?? "n/a"}
                      </TableCell>
                      <TableCell>{row.homeDepotName ?? "n/a"}</TableCell>
                      <TableCell>{profile?.license_no ?? "n/a"}</TableCell>
                      <TableCell>
                        {new Date(row.user.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onEditProfile(row)}
                          >
                            <PencilLine className="mr-1 h-4 w-4" />
                            Profile
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onResetPassword(row)}
                          >
                            <KeyRound className="mr-1 h-4 w-4" />
                            Password
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={!row.user.is_active || isDeactivating}
                            onClick={() => void onDeactivate(row)}
                          >
                            <UserX className="mr-1 h-4 w-4" />
                            {isDeactivating ? "Deactivating..." : "Deactivate"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default DriverManagementTable;

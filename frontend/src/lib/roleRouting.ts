import type { RoleKey } from "@/types/auth";

export const LOGIN_PATH = "/login";
export const ADMIN_DASHBOARD_PATH = "/dashboard/admin";
export const OPERATOR_DASHBOARD_PATH = "/dashboard/operator";
export const DRIVER_DASHBOARD_PATH = "/dashboard/driver";

export type DashboardNavItem = {
  key: string;
  label: string;
  path: string;
};

export const ADMIN_DASHBOARD_NAV_ITEMS: DashboardNavItem[] = [
  { key: "overview", label: "Overview", path: ADMIN_DASHBOARD_PATH },
  {
    key: "simulator",
    label: "Device Simulator",
    path: `${ADMIN_DASHBOARD_PATH}/simulator`,
  },
  { key: "users", label: "Users", path: `${ADMIN_DASHBOARD_PATH}/users` },
  {
    key: "master-data",
    label: "Master Data",
    path: `${ADMIN_DASHBOARD_PATH}/master-data`,
  },
  {
    key: "operations",
    label: "Operations",
    path: `${ADMIN_DASHBOARD_PATH}/operations`,
  },
  {
    key: "analytics",
    label: "Analytics",
    path: `${ADMIN_DASHBOARD_PATH}/analytics`,
  },
  { key: "alerts", label: "Alerts", path: `${ADMIN_DASHBOARD_PATH}/alerts` },
  {
    key: "realtime",
    label: "Realtime",
    path: `${ADMIN_DASHBOARD_PATH}/realtime`,
  },
];

export const OPERATOR_DASHBOARD_NAV_ITEMS: DashboardNavItem[] = [
  { key: "overview", label: "Overview", path: OPERATOR_DASHBOARD_PATH },
  {
    key: "drivers",
    label: "Drivers",
    path: `${OPERATOR_DASHBOARD_PATH}/drivers`,
  },
  {
    key: "master-data",
    label: "Master Data",
    path: `${OPERATOR_DASHBOARD_PATH}/master-data`,
  },
  {
    key: "operations",
    label: "Operations",
    path: `${OPERATOR_DASHBOARD_PATH}/operations`,
  },
  {
    key: "assignments",
    label: "Assignments",
    path: `${OPERATOR_DASHBOARD_PATH}/assignments`,
  },
  {
    key: "alerts",
    label: "Alerts",
    path: `${OPERATOR_DASHBOARD_PATH}/alerts`,
  },
  {
    key: "realtime",
    label: "Realtime",
    path: `${OPERATOR_DASHBOARD_PATH}/realtime`,
  },
  {
    key: "notifications",
    label: "Notifications",
    path: `${OPERATOR_DASHBOARD_PATH}/notifications`,
  },
];

export const DRIVER_DASHBOARD_NAV_ITEMS: DashboardNavItem[] = [
  { key: "overview", label: "Overview", path: DRIVER_DASHBOARD_PATH },
  {
    key: "my-routes",
    label: "My Routes",
    path: `${DRIVER_DASHBOARD_PATH}/my-routes`,
  },
  {
    key: "my-stops",
    label: "My Stops",
    path: `${DRIVER_DASHBOARD_PATH}/my-stops`,
  },
  {
    key: "my-shifts",
    label: "My Shifts",
    path: `${DRIVER_DASHBOARD_PATH}/my-shifts`,
  },
  {
    key: "alerts",
    label: "Alerts",
    path: `${DRIVER_DASHBOARD_PATH}/alerts`,
  },
  {
    key: "notifications",
    label: "Notifications",
    path: `${DRIVER_DASHBOARD_PATH}/notifications`,
  },
];

export function hasAnyRole(
  userRoleKeys: RoleKey[],
  requiredRoles: RoleKey[],
): boolean {
  return requiredRoles.some((role) => userRoleKeys.includes(role));
}

export function getPreferredDashboardPath(userRoleKeys: RoleKey[]): string {
  if (userRoleKeys.includes("authority_admin")) {
    return ADMIN_DASHBOARD_PATH;
  }

  if (userRoleKeys.includes("authority_operator")) {
    return OPERATOR_DASHBOARD_PATH;
  }

  if (userRoleKeys.includes("driver")) {
    return DRIVER_DASHBOARD_PATH;
  }

  return LOGIN_PATH;
}

export function roleLabel(role: RoleKey): string {
  if (role === "authority_admin") {
    return "Authority Admin";
  }
  if (role === "authority_operator") {
    return "Authority Operator";
  }
  if (role === "driver") {
    return "Driver";
  }
  return String(role);
}

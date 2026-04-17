export type DashboardTab = 'monitoring' | 'priority' | 'route'

export type TableCell = string | number | boolean | null

export type DataRow = Record<string, TableCell>

export type DriverAssignment = Record<string, string[]>

export type DashboardData = {
  total_bins: number
  full_bins: number
  avg_fill: number
  urgent_bins: number
  rows: DataRow[]
  driver_assignment?: DriverAssignment
}

export type PriorityData = {
  queue: DataRow[]
}

export type RouteStop = {
  Stop: number | string
  Bin_ID: string
  Priority: number
  'Distance_from_Depot(km)': number
}

export type RouteData = {
  plan: RouteStop[]
}

export type DashboardControls = {
  seed: number
  base_fill_rate: number
  priority_threshold: number
}

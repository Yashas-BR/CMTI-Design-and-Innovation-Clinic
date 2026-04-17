import { useEffect, useState } from 'react'
import axios from 'axios'
import { Download, LogOut, Route, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import Tabs from '@/components/Tabs'
import DataTable from '@/components/DataTable'
import FillChart from '@/components/FillChart'
import MetricsRow from '@/components/MetricsRow'
import type {
  DashboardControls,
  DashboardData,
  DashboardTab,
  PriorityData,
  RouteData,
} from '@/types/dashboard'

type DashboardPageProps = {
  user: {
    username: string
    role: string
  }
  onLogout: () => void
  apiUrl: string
  token: string
}

function DashboardPage({ user, onLogout, apiUrl, token }: DashboardPageProps) {
  const [activeTab, setActiveTab] = useState<DashboardTab>('monitoring')
  const [data, setData] = useState<DashboardData | null>(null)
  const [priority, setPriority] = useState<PriorityData | null>(null)
  const [route, setRoute] = useState<RouteData | null>(null)
  const [loading, setLoading] = useState(true)
  const [controls, setControls] = useState<DashboardControls>({
    seed: 42,
    base_fill_rate: 3,
    priority_threshold: 70,
  })

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const params = {
          seed: controls.seed,
          base_fill_rate: controls.base_fill_rate,
          priority_threshold: controls.priority_threshold,
        }

        const [dashboardResponse, priorityResponse, routeResponse] = await Promise.all([
          axios.get<DashboardData>(`${apiUrl}/dashboard/data`, {
            headers: { Authorization: `Bearer ${token}` },
            params,
          }),
          axios.get<PriorityData>(`${apiUrl}/dashboard/priority`, {
            headers: { Authorization: `Bearer ${token}` },
            params,
          }),
          axios.get<RouteData>(`${apiUrl}/dashboard/route`, {
            headers: { Authorization: `Bearer ${token}` },
            params,
          }),
        ])

        setData(dashboardResponse.data)
        setPriority(priorityResponse.data)
        setRoute(routeResponse.data)
      } catch {
        setData(null)
        setPriority(null)
        setRoute(null)
      } finally {
        setLoading(false)
      }
    }

    void fetchData()
  }, [apiUrl, controls, token])

  const updateControl = (key: keyof DashboardControls, value: number) => {
    if (Number.isNaN(value)) {
      return
    }

    setControls((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#ecfeff_0%,#f0fdfa_45%,#f8fafc_100%)] px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl border border-white/70 bg-white/70 p-6 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold text-slate-900 md:text-3xl">
                InfraSense Smart Waste Operations
              </h1>
              <p className="text-sm text-slate-600">
                Real-time monitoring and optimized collection routing for municipal teams.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <div className="rounded-xl border bg-white/70 px-3 py-2 text-slate-700">
                {user.username} ({user.role})
              </div>
              <Button variant="outline" onClick={onLogout}>
                <LogOut className="mr-1 h-4 w-4" />
                Logout
              </Button>
            </div>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          {user.role === 'Authority' ? (
            <Card className="h-fit border-white/70 bg-white/75 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <SlidersHorizontal className="h-4 w-4" />
                  Simulation Controls
                </CardTitle>
                <CardDescription>Adjust the scenario to compare routing outcomes.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="seed">Scenario Seed</Label>
                  <Input
                    id="seed"
                    type="number"
                    min={1}
                    max={999}
                    value={controls.seed}
                    onChange={(event) => updateControl('seed', Number.parseInt(event.target.value, 10))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fill-rate">Fill Rate (%/hour)</Label>
                  <Input
                    id="fill-rate"
                    type="number"
                    min={0.5}
                    max={8}
                    step={0.5}
                    value={controls.base_fill_rate}
                    onChange={(event) => updateControl('base_fill_rate', Number.parseFloat(event.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="threshold">Priority Threshold</Label>
                  <Input
                    id="threshold"
                    type="number"
                    min={40}
                    max={95}
                    step={1}
                    value={controls.priority_threshold}
                    onChange={(event) => updateControl('priority_threshold', Number.parseFloat(event.target.value))}
                  />
                </div>
              </CardContent>
            </Card>
          ) : null}

          <section className="space-y-5">
            {loading || !data || !priority || !route ? (
              <div className="space-y-4">
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-80 w-full" />
              </div>
            ) : (
              <>
                <MetricsRow data={data} />

                {user.role === 'Authority' && data.driver_assignment ? (
                  <Card className="border-white/70 bg-white/75 shadow-sm">
                    <CardHeader>
                      <CardTitle>Driver Assignment Matrix</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-hidden rounded-xl border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Driver</TableHead>
                              <TableHead>Assigned Bins</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {Object.entries(data.driver_assignment).map(([driver, bins]) => (
                              <TableRow key={driver}>
                                <TableCell className="font-medium">{driver}</TableCell>
                                <TableCell>{bins.join(', ')}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                ) : null}

                <Separator />

                <Tabs
                  activeTab={activeTab}
                  onChangeTab={setActiveTab}
                  monitoring={(
                    <>
                      <h2 className="text-lg font-semibold">Live Bin Monitoring</h2>
                      <DataTable rows={data.rows} emptyMessage="No monitoring data available." />
                      <FillChart rows={data.rows} />
                    </>
                  )}
                  priority={(
                    <>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <h2 className="text-lg font-semibold">Priority Dispatch Queue</h2>
                        {user.role === 'Authority' ? (
                          <Button
                            variant="outline"
                            onClick={() => {
                              window.open(
                                `${apiUrl}/dashboard/export?seed=${controls.seed}&base_fill_rate=${controls.base_fill_rate}`,
                                '_blank',
                                'noopener,noreferrer',
                              )
                            }}
                          >
                            <Download className="mr-1 h-4 w-4" />
                            Export CSV
                          </Button>
                        ) : null}
                      </div>
                      <DataTable rows={priority.queue} emptyMessage="Priority queue is currently empty." />
                    </>
                  )}
                  route={(
                    <Card className="border-white/70 bg-white/75 shadow-sm">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Route className="h-4 w-4" />
                          Recommended Collection Order
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {route.plan?.length ? (
                          <div className="overflow-hidden rounded-xl border">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Stop</TableHead>
                                  <TableHead>Bin ID</TableHead>
                                  <TableHead>Priority</TableHead>
                                  <TableHead>Distance (km)</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {route.plan.map((stop) => (
                                  <TableRow key={`${stop.Stop}-${stop.Bin_ID}`}>
                                    <TableCell>{stop.Stop}</TableCell>
                                    <TableCell>{stop.Bin_ID}</TableCell>
                                    <TableCell>{stop.Priority.toFixed(2)}</TableCell>
                                    <TableCell>{stop['Distance_from_Depot(km)'].toFixed(2)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        ) : (
                          <p className="rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground">
                            No bins have crossed the threshold yet. Continue monitoring to trigger a route.
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  )}
                />
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}

export default DashboardPage

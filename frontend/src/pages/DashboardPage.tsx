import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import { Download, LogOut, MapPinned, Pencil, Plus, RefreshCw, Route, SlidersHorizontal, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tabs as UiTabs,
  TabsContent as UiTabsContent,
  TabsList as UiTabsList,
  TabsTrigger as UiTabsTrigger,
} from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import DashboardTabs from '@/components/Tabs'
import DataTable from '@/components/DataTable'
import BinMap from '@/components/BinMap'
import FillChart from '@/components/FillChart'
import MetricsRow from '@/components/MetricsRow'
import type {
  BinDefinition,
  DashboardControls,
  DashboardData,
  DashboardTab,
  PriorityData,
  RouteData,
} from '@/types/dashboard'

type BinFormState = {
  bin_id: string
  ward: string
  location: string
  latitude: string
  longitude: string
}

type EditBinFormState = {
  ward: string
  location: string
  latitude: string
  longitude: string
}

type BinActionTab = 'add' | 'delete'

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
  const isAdmin = user.role === 'Authority'
  const isOperator = user.role === 'Operator'

  const [activeTab, setActiveTab] = useState<DashboardTab>('monitoring')
  const [data, setData] = useState<DashboardData | null>(null)
  const [priority, setPriority] = useState<PriorityData | null>(null)
  const [route, setRoute] = useState<RouteData | null>(null)
  const [bins, setBins] = useState<BinDefinition[]>([])
  const [binsLoading, setBinsLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [binDialogOpen, setBinDialogOpen] = useState(false)
  const [binActionTab, setBinActionTab] = useState<BinActionTab>('add')
  const [deleteCandidateBinId, setDeleteCandidateBinId] = useState('')
  const [selectedWardFilter, setSelectedWardFilter] = useState('all')
  const [binIdSearch, setBinIdSearch] = useState('')
  const [editBinDialogOpen, setEditBinDialogOpen] = useState(false)
  const [activeBinId, setActiveBinId] = useState<string | null>(null)
  const [binSubmitting, setBinSubmitting] = useState(false)
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [deleteBinId, setDeleteBinId] = useState<string | null>(null)
  const [binError, setBinError] = useState('')
  const [editError, setEditError] = useState('')
  const [selectedPoint, setSelectedPoint] = useState<[number, number] | null>(null)
  const [binForm, setBinForm] = useState<BinFormState>({
    bin_id: '',
    ward: 'Ward-New',
    location: '',
    latitude: '',
    longitude: '',
  })
  const [controls, setControls] = useState<DashboardControls>({
    seed: 42,
    base_fill_rate: 3,
    priority_threshold: 70,
  })
  const [editBinForm, setEditBinForm] = useState<EditBinFormState>({
    ward: '',
    location: '',
    latitude: '',
    longitude: '',
  })
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [controlsSaving, setControlsSaving] = useState(false)
  const [controlsError, setControlsError] = useState('')
  const [controlsNotice, setControlsNotice] = useState('')

  const fetchDashboardData = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true)
    } else {
      setRefreshing(true)
    }

    try {
      const [dashboardResponse, priorityResponse, routeResponse] = await Promise.all([
        axios.get<DashboardData>(`${apiUrl}/dashboard/data`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get<PriorityData>(`${apiUrl}/dashboard/priority`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get<RouteData>(`${apiUrl}/dashboard/route`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ])

      setData(dashboardResponse.data)
      setPriority(priorityResponse.data)
      setRoute(routeResponse.data)
      setLastUpdatedAt(new Date())
    } catch {
      if (!silent) {
        setData(null)
        setPriority(null)
        setRoute(null)
      }
    } finally {
      if (!silent) {
        setLoading(false)
      } else {
        setRefreshing(false)
      }
    }
  }, [apiUrl, token])

  const fetchSimulationControls = useCallback(async () => {
    try {
      const response = await axios.get<DashboardControls>(`${apiUrl}/dashboard/controls`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setControls(response.data)
    } catch {
      setControlsError('Unable to load simulation controls')
    }
  }, [apiUrl, token])

  const fetchBins = useCallback(async () => {
    if (!isAdmin) {
      setBins([])
      return
    }

    setBinsLoading(true)
    try {
      const response = await axios.get<{ bins: BinDefinition[] }>(`${apiUrl}/dashboard/bins`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setBins(response.data.bins)
    } catch {
      setBins([])
    } finally {
      setBinsLoading(false)
    }
  }, [apiUrl, isAdmin, token])

  useEffect(() => {
    void fetchSimulationControls()
    void fetchDashboardData()
  }, [fetchDashboardData, fetchSimulationControls])

  useEffect(() => {
    void fetchBins()
  }, [fetchBins])

  useEffect(() => {
    if (!autoRefreshEnabled) {
      return
    }

    const intervalId = window.setInterval(() => {
      if (binDialogOpen || editBinDialogOpen) {
        return
      }

      void fetchDashboardData(true)
      if (isAdmin) {
        void fetchBins()
      }
    }, 20000)

    return () => window.clearInterval(intervalId)
  }, [autoRefreshEnabled, binDialogOpen, editBinDialogOpen, fetchBins, fetchDashboardData, isAdmin])

  const resetBinForm = () => {
    setBinError('')
    setSelectedPoint(null)
    setBinForm({
      bin_id: '',
      ward: 'Ward-New',
      location: '',
      latitude: '',
      longitude: '',
    })
  }

  const openAddBinDialog = () => {
    resetBinForm()
    setBinActionTab('add')
    setDeleteCandidateBinId('')
    setBinDialogOpen(true)
    void fetchBins()
  }

  const handleApplyControls = async () => {
    setControlsSaving(true)
    setControlsError('')
    setControlsNotice('')

    try {
      await axios.put(
        `${apiUrl}/dashboard/controls`,
        {
          seed: controls.seed,
          base_fill_rate: controls.base_fill_rate,
          priority_threshold: controls.priority_threshold,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      )
      setControlsNotice('Simulation controls applied by operator')
      await fetchDashboardData()
      if (isAdmin) {
        await fetchBins()
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        setControlsError((error.response?.data as { error?: string })?.error ?? 'Failed to apply controls')
      } else {
        setControlsError('Failed to apply controls')
      }
    } finally {
      setControlsSaving(false)
    }
  }

  const handleMapPick = (latitude: number, longitude: number) => {
    setSelectedPoint([latitude, longitude])
    setBinForm((prev) => ({
      ...prev,
      latitude: latitude.toFixed(6),
      longitude: longitude.toFixed(6),
    }))
  }

  const handleBinFieldChange = (field: keyof BinFormState, value: string) => {
    setBinForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleAddBin = async () => {
    setBinSubmitting(true)
    setBinError('')

    try {
      await axios.post(
        `${apiUrl}/dashboard/bins`,
        {
          bin_id: binForm.bin_id.trim(),
          ward: binForm.ward.trim(),
          location: binForm.location.trim(),
          latitude: Number(binForm.latitude),
          longitude: Number(binForm.longitude),
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      )

      setBinDialogOpen(false)
      resetBinForm()
      await fetchDashboardData()
      await fetchBins()
    } catch (error) {
      if (axios.isAxiosError(error)) {
        setBinError((error.response?.data as { error?: string })?.error ?? 'Failed to add bin')
      } else {
        setBinError('Failed to add bin')
      }
    } finally {
      setBinSubmitting(false)
    }
  }

  const openEditBinDialog = (bin: BinDefinition) => {
    setActiveBinId(bin.Bin_ID)
    setEditError('')
    setEditBinForm({
      ward: bin.Ward,
      location: bin.Location,
      latitude: `${bin.Latitude}`,
      longitude: `${bin.Longitude}`,
    })
    setEditBinDialogOpen(true)
  }

  const handleEditBinFieldChange = (field: keyof EditBinFormState, value: string) => {
    setEditBinForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleUpdateBin = async () => {
    if (!activeBinId) {
      return
    }

    setEditSubmitting(true)
    setEditError('')
    try {
      await axios.put(
        `${apiUrl}/dashboard/bins/${encodeURIComponent(activeBinId)}`,
        {
          ward: editBinForm.ward.trim(),
          location: editBinForm.location.trim(),
          latitude: Number(editBinForm.latitude),
          longitude: Number(editBinForm.longitude),
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      )
      setEditBinDialogOpen(false)
      setActiveBinId(null)
      await fetchDashboardData()
      await fetchBins()
    } catch (error) {
      if (axios.isAxiosError(error)) {
        setEditError((error.response?.data as { error?: string })?.error ?? 'Failed to update bin')
      } else {
        setEditError('Failed to update bin')
      }
    } finally {
      setEditSubmitting(false)
    }
  }

  const handleDeleteBin = async (binId: string, showConfirm = true) => {
    if (!binId) {
      return
    }

    if (showConfirm) {
      const confirmed = window.confirm(`Delete bin ${binId}? This cannot be undone.`)
      if (!confirmed) {
        return
      }
    }

    setDeleteBinId(binId)
    try {
      await axios.delete(`${apiUrl}/dashboard/bins/${encodeURIComponent(binId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (deleteCandidateBinId === binId) {
        setDeleteCandidateBinId('')
      }
      await fetchDashboardData()
      await fetchBins()
    } finally {
      setDeleteBinId(null)
    }
  }

  const wardFilters = Array.from(new Set(bins.map((bin) => bin.Ward))).sort((left, right) =>
    left.localeCompare(right),
  )

  const normalizedBinIdSearch = binIdSearch.trim().toLowerCase()

  const filteredBins = bins.filter((bin) => {
    const wardMatches = selectedWardFilter === 'all' || bin.Ward === selectedWardFilter
    const idMatches =
      normalizedBinIdSearch.length === 0 ||
      bin.Bin_ID.toLowerCase().includes(normalizedBinIdSearch)

    return wardMatches && idMatches
  })

  const updateControl = (key: keyof DashboardControls, value: number) => {
    if (Number.isNaN(value)) {
      return
    }

    setControls((prev) => ({ ...prev, [key]: value }))
  }

  const lastUpdatedLabel = lastUpdatedAt
    ? lastUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : 'Waiting for first update'

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
                Last update: {lastUpdatedLabel}
              </div>
              <Button
                variant={autoRefreshEnabled ? 'secondary' : 'outline'}
                onClick={() => setAutoRefreshEnabled((prev) => !prev)}
              >
                Auto refresh: {autoRefreshEnabled ? 'On' : 'Off'}
              </Button>
              <Button variant="outline" onClick={() => void fetchDashboardData(true)} disabled={refreshing}>
                <RefreshCw className="mr-1 h-4 w-4" />
                {refreshing ? 'Refreshing...' : 'Refresh now'}
              </Button>
              <div className="rounded-xl border bg-white/70 px-3 py-2 text-slate-700">
                {user.username} ({user.role})
              </div>
              {isAdmin ? (
                <Button variant="outline" onClick={openAddBinDialog}>
                  <Plus className="mr-1 h-4 w-4" />
                  Update Bin
                </Button>
              ) : null}
              <Button variant="outline" onClick={onLogout}>
                <LogOut className="mr-1 h-4 w-4" />
                Logout
              </Button>
            </div>
          </div>
        </header>

        {isAdmin ? (
          <Dialog
            open={binDialogOpen}
            onOpenChange={(open) => {
              setBinDialogOpen(open)
              if (!open) {
                resetBinForm()
              }
            }}
          >
            <DialogContent className="h-[90vh] w-[96vw] max-w-[calc(100vw-1.5rem)] overflow-y-auto sm:w-[95vw] sm:!max-w-[1300px]">
              <DialogHeader>
                <DialogTitle>Update Bin Registry</DialogTitle>
                <DialogDescription>
                  Manage bins from one place with separate add and delete actions.
                </DialogDescription>
              </DialogHeader>

              <UiTabs value={binActionTab} onValueChange={(value) => setBinActionTab(value as BinActionTab)}>
                <UiTabsList className="grid w-full grid-cols-2">
                  <UiTabsTrigger value="add">Add Bin</UiTabsTrigger>
                  <UiTabsTrigger value="delete">Delete Bin</UiTabsTrigger>
                </UiTabsList>

                <UiTabsContent value="add" className="mt-5 space-y-5">
                  <div className="grid gap-6 md:grid-cols-[0.8fr_1.2fr]">
                    <div className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="bin-id">Bin ID</Label>
                          <Input
                            id="bin-id"
                            value={binForm.bin_id}
                            onChange={(event) => handleBinFieldChange('bin_id', event.target.value)}
                            placeholder="Optional, auto-generates if empty"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="ward">Ward</Label>
                          <Input
                            id="ward"
                            value={binForm.ward}
                            onChange={(event) => handleBinFieldChange('ward', event.target.value)}
                            placeholder="Ward name"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="location">Location label</Label>
                        <Input
                          id="location"
                          value={binForm.location}
                          onChange={(event) => handleBinFieldChange('location', event.target.value)}
                          placeholder="Market junction, lane, landmark"
                        />
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="latitude">Latitude</Label>
                          <Input
                            id="latitude"
                            type="number"
                            step="0.000001"
                            value={binForm.latitude}
                            onChange={(event) => handleBinFieldChange('latitude', event.target.value)}
                            placeholder="12.971600"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="longitude">Longitude</Label>
                          <Input
                            id="longitude"
                            type="number"
                            step="0.000001"
                            value={binForm.longitude}
                            onChange={(event) => handleBinFieldChange('longitude', event.target.value)}
                            placeholder="77.594600"
                          />
                        </div>
                      </div>

                      {binError ? (
                        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                          {binError}
                        </p>
                      ) : null}

                      <p className="text-sm text-muted-foreground">
                        Selected coordinate:
                        {selectedPoint
                          ? ` ${selectedPoint[0].toFixed(6)}, ${selectedPoint[1].toFixed(6)}`
                          : ' click the map to set it.'}
                      </p>
                    </div>

                    <BinMap
                      rows={data?.rows ?? []}
                      title="Click the map to place a new bin"
                      heightClassName="h-[360px] sm:h-[460px] lg:h-[620px]"
                      onMapClick={handleMapPick}
                      selectedPoint={selectedPoint}
                    />
                  </div>

                  <DialogFooter>
                    <Button variant="outline" onClick={() => setBinDialogOpen(false)}>
                      Close
                    </Button>
                    <Button onClick={handleAddBin} disabled={binSubmitting}>
                      <MapPinned className="mr-1 h-4 w-4" />
                      {binSubmitting ? 'Saving...' : 'Save bin'}
                    </Button>
                  </DialogFooter>
                </UiTabsContent>

                <UiTabsContent value="delete" className="mt-5 space-y-5">
                  <div className="space-y-3">
                    <Label htmlFor="delete-bin">Select bin to delete</Label>
                    <Select value={deleteCandidateBinId} onValueChange={setDeleteCandidateBinId}>
                      <SelectTrigger id="delete-bin">
                        <SelectValue placeholder="Choose a bin" />
                      </SelectTrigger>
                      <SelectContent>
                        {bins.map((bin) => (
                          <SelectItem key={`delete-option-${bin.Bin_ID}`} value={bin.Bin_ID}>
                            {bin.Bin_ID} - {bin.Location}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-sm text-muted-foreground">
                      Deleting a bin permanently removes it from the registry and driver assignment lists.
                    </p>
                  </div>

                  <DialogFooter>
                    <Button variant="outline" onClick={() => setBinDialogOpen(false)}>
                      Close
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => void handleDeleteBin(deleteCandidateBinId, true)}
                      disabled={!deleteCandidateBinId || deleteBinId === deleteCandidateBinId}
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      {deleteBinId === deleteCandidateBinId ? 'Deleting...' : 'Delete selected bin'}
                    </Button>
                  </DialogFooter>
                </UiTabsContent>
              </UiTabs>
            </DialogContent>
          </Dialog>
        ) : null}

        {isAdmin ? (
          <Dialog
            open={editBinDialogOpen}
            onOpenChange={(open) => {
              setEditBinDialogOpen(open)
              if (!open) {
                setActiveBinId(null)
                setEditError('')
              }
            }}
          >
            <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Edit bin {activeBinId ?? ''}</DialogTitle>
                <DialogDescription>
                  Update the location label and coordinates for this dustbin.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-ward">Ward</Label>
                  <Input
                    id="edit-ward"
                    value={editBinForm.ward}
                    onChange={(event) => handleEditBinFieldChange('ward', event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-location">Location label</Label>
                  <Input
                    id="edit-location"
                    value={editBinForm.location}
                    onChange={(event) => handleEditBinFieldChange('location', event.target.value)}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="edit-latitude">Latitude</Label>
                    <Input
                      id="edit-latitude"
                      type="number"
                      step="0.000001"
                      value={editBinForm.latitude}
                      onChange={(event) => handleEditBinFieldChange('latitude', event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-longitude">Longitude</Label>
                    <Input
                      id="edit-longitude"
                      type="number"
                      step="0.000001"
                      value={editBinForm.longitude}
                      onChange={(event) => handleEditBinFieldChange('longitude', event.target.value)}
                    />
                  </div>
                </div>
                {editError ? (
                  <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {editError}
                  </p>
                ) : null}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setEditBinDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleUpdateBin} disabled={editSubmitting || !activeBinId}>
                  {editSubmitting ? 'Saving...' : 'Save changes'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}

        <div className={isOperator ? 'grid gap-6 lg:grid-cols-[300px_1fr]' : 'grid gap-6'}>
          {isOperator ? (
            <Card className="h-fit border-white/70 bg-white/75 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <SlidersHorizontal className="h-4 w-4" />
                  Operator Simulation Controls
                </CardTitle>
                <CardDescription>Only operator can update synthetic simulation settings.</CardDescription>
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
                    max={80}
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
                {controlsError ? (
                  <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {controlsError}
                  </p>
                ) : null}
                {controlsNotice ? (
                  <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                    {controlsNotice}
                  </p>
                ) : null}
                <Button onClick={handleApplyControls} disabled={controlsSaving} className="w-full">
                  {controlsSaving ? 'Applying...' : 'Apply controls'}
                </Button>
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

                {isAdmin && data.driver_assignment ? (
                  <Card className="border-white/70 bg-white/75 shadow-sm">
                    <CardHeader>
                      <CardTitle>Driver Assignment Matrix</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto rounded-xl border">
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

                <DashboardTabs
                  activeTab={activeTab}
                  onChangeTab={setActiveTab}
                  monitoring={(
                    <>
                      <h2 className="text-lg font-semibold">Live Bin Monitoring</h2>
                      <BinMap rows={data.rows} title="Dustbin Locations & Fill Status" />
                      {isAdmin ? (
                        <Card className="border-white/70 bg-white/75 shadow-sm">
                          <CardHeader>
                            <CardTitle>Bin Registry Management</CardTitle>
                            <CardDescription>
                              Full registry with ward filter, plus edit and delete actions.
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-5">
                            <div className="grid gap-3 md:grid-cols-2">
                              <div className="grid gap-3 sm:max-w-xs">
                                <Label htmlFor="ward-filter">Filter by ward</Label>
                                <Select value={selectedWardFilter} onValueChange={setSelectedWardFilter}>
                                  <SelectTrigger id="ward-filter">
                                    <SelectValue placeholder="Select ward" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="all">All wards</SelectItem>
                                    {wardFilters.map((ward) => (
                                      <SelectItem key={`ward-filter-${ward}`} value={ward}>
                                        {ward}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="grid gap-3 sm:max-w-xs">
                                <Label htmlFor="bin-id-filter">Search by Bin ID</Label>
                                <Input
                                  id="bin-id-filter"
                                  value={binIdSearch}
                                  onChange={(event) => setBinIdSearch(event.target.value)}
                                  placeholder="e.g. B12"
                                />
                              </div>
                            </div>

                            <div className="max-h-[332px] overflow-auto rounded-xl border">
                              <Table>
                                <TableHeader className="sticky top-0 z-10 bg-white/95 backdrop-blur">
                                  <TableRow>
                                    <TableHead>Bin ID</TableHead>
                                    <TableHead>Ward</TableHead>
                                    <TableHead>Location</TableHead>
                                    <TableHead>Latitude</TableHead>
                                    <TableHead>Longitude</TableHead>
                                    <TableHead>Actions</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {binsLoading ? (
                                    <TableRow>
                                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                                        Loading bins...
                                      </TableCell>
                                    </TableRow>
                                  ) : filteredBins.length === 0 ? (
                                    <TableRow>
                                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                                        No bins found for the selected filters.
                                      </TableCell>
                                    </TableRow>
                                  ) : (
                                    filteredBins.map((bin) => (
                                      <TableRow key={bin.Bin_ID} className="h-14">
                                        <TableCell className="font-medium">{bin.Bin_ID}</TableCell>
                                        <TableCell>{bin.Ward}</TableCell>
                                        <TableCell>{bin.Location}</TableCell>
                                        <TableCell>{bin.Latitude.toFixed(6)}</TableCell>
                                        <TableCell>{bin.Longitude.toFixed(6)}</TableCell>
                                        <TableCell>
                                          <div className="flex gap-2">
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={() => openEditBinDialog(bin)}
                                            >
                                              <Pencil className="mr-1 h-3.5 w-3.5" />
                                              Edit
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant="destructive"
                                              onClick={() => handleDeleteBin(bin.Bin_ID)}
                                              disabled={deleteBinId === bin.Bin_ID}
                                            >
                                              <Trash2 className="mr-1 h-3.5 w-3.5" />
                                              {deleteBinId === bin.Bin_ID ? 'Deleting...' : 'Delete'}
                                            </Button>
                                          </div>
                                        </TableCell>
                                      </TableRow>
                                    ))
                                  )}
                                </TableBody>
                              </Table>
                            </div>
                          </CardContent>
                        </Card>
                      ) : null}
                      <DataTable rows={data.rows} emptyMessage="No monitoring data available." />
                      <FillChart rows={data.rows} />
                    </>
                  )}
                  priority={(
                    <>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <h2 className="text-lg font-semibold">Priority Dispatch Queue</h2>
                        {isAdmin || isOperator ? (
                          <Button
                            variant="outline"
                            onClick={() => {
                              window.open(`${apiUrl}/dashboard/export`, '_blank', 'noopener,noreferrer')
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
                    <div className="space-y-4">
                      <BinMap rows={data.rows} routeStops={route.plan} title="Dispatch Route on Map" />
                      <Card className="border-white/70 bg-white/75 shadow-sm">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <Route className="h-4 w-4" />
                            Recommended Collection Order
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          {route.plan?.length ? (
                            <div className="overflow-x-auto rounded-xl border">
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
                    </div>
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

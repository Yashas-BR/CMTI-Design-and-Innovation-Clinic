import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import { Download, LogOut, MapPinned, Plus, RefreshCw, Route, SlidersHorizontal, Trash2 } from 'lucide-react'
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
  CollectionCenter,
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

type BinActionTab = 'add' | 'delete'
type CenterActionTab = 'add' | 'delete'

type CenterFormState = {
  center_id: string
  name: string
  ward: string
  address: string
  latitude: string
  longitude: string
}

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
  const [collectionCenters, setCollectionCenters] = useState<CollectionCenter[]>([])
  const [, setBinsLoading] = useState(false)
  const [, setCentersLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [binDialogOpen, setBinDialogOpen] = useState(false)
  const [centerDialogOpen, setCenterDialogOpen] = useState(false)
  const [binActionTab, setBinActionTab] = useState<BinActionTab>('add')
  const [centerActionTab, setCenterActionTab] = useState<CenterActionTab>('add')
  const [deleteCandidateBinId, setDeleteCandidateBinId] = useState('')
  const [deleteCandidateCenterId, setDeleteCandidateCenterId] = useState('')
  const [locationSearch, setLocationSearch] = useState('')
  const [locationSortOrder, setLocationSortOrder] = useState<'asc' | 'desc'>('asc')
  const [binSubmitting, setBinSubmitting] = useState(false)
  const [deleteBinId, setDeleteBinId] = useState<string | null>(null)
  const [centerSubmitting, setCenterSubmitting] = useState(false)
  const [deleteCenterId, setDeleteCenterId] = useState<string | null>(null)
  const [binError, setBinError] = useState('')
  const [centerError, setCenterError] = useState('')
  const [selectedPoint, setSelectedPoint] = useState<[number, number] | null>(null)
  const [centerSelectedPoint, setCenterSelectedPoint] = useState<[number, number] | null>(null)
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
  const [centerForm, setCenterForm] = useState<CenterFormState>({
    center_id: '',
    name: '',
    ward: '',
    address: '',
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

  const fetchCollectionCenters = useCallback(async () => {
    setCentersLoading(true)
    try {
      const response = await axios.get<{ centers: CollectionCenter[] }>(`${apiUrl}/dashboard/collection-centers`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setCollectionCenters(response.data.centers)
    } catch {
      setCollectionCenters([])
    } finally {
      setCentersLoading(false)
    }
  }, [apiUrl, token])

  useEffect(() => {
    void fetchSimulationControls()
    void fetchDashboardData()
  }, [fetchDashboardData, fetchSimulationControls])

  useEffect(() => {
    void fetchBins()
  }, [fetchBins])

  useEffect(() => {
    void fetchCollectionCenters()
  }, [fetchCollectionCenters])

  useEffect(() => {
    if (!autoRefreshEnabled) {
      return
    }

    const intervalId = window.setInterval(() => {
      if (binDialogOpen || centerDialogOpen) {
        return
      }

      void fetchDashboardData(true)
      if (isAdmin) {
        void fetchBins()
      }
      void fetchCollectionCenters()
    }, 20000)

    return () => window.clearInterval(intervalId)
  }, [
    autoRefreshEnabled,
    binDialogOpen,
    centerDialogOpen,
    fetchBins,
    fetchCollectionCenters,
    fetchDashboardData,
    isAdmin,
  ])

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

  const openCollectionCenterDialog = () => {
    resetCenterForm()
    setCenterActionTab('add')
    setDeleteCandidateCenterId('')
    setCenterDialogOpen(true)
    void fetchCollectionCenters()
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

  const handleCenterFieldChange = (field: keyof CenterFormState, value: string) => {
    setCenterForm((prev) => ({ ...prev, [field]: value }))
  }

  const resetCenterForm = () => {
    setCenterError('')
    setCenterSelectedPoint(null)
    setCenterForm({
      center_id: '',
      name: '',
      ward: '',
      address: '',
      latitude: '',
      longitude: '',
    })
  }

  const handleAddCollectionCenter = async () => {
    setCenterSubmitting(true)
    setCenterError('')

    try {
      await axios.post(
        `${apiUrl}/dashboard/collection-centers`,
        {
          center_id: centerForm.center_id.trim(),
          name: centerForm.name.trim(),
          ward: centerForm.ward.trim(),
          address: centerForm.address.trim(),
          latitude: Number(centerForm.latitude),
          longitude: Number(centerForm.longitude),
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      )

      resetCenterForm()
      await fetchCollectionCenters()
    } catch (error) {
      if (axios.isAxiosError(error)) {
        setCenterError((error.response?.data as { error?: string })?.error ?? 'Failed to add collection center')
      } else {
        setCenterError('Failed to add collection center')
      }
    } finally {
      setCenterSubmitting(false)
    }
  }

  const handleCenterMapPick = (latitude: number, longitude: number) => {
    setCenterSelectedPoint([latitude, longitude])
    setCenterForm((prev) => ({
      ...prev,
      latitude: latitude.toFixed(6),
      longitude: longitude.toFixed(6),
    }))
  }

  const handleDeleteCollectionCenter = async (centerId: string, showConfirm = true) => {
    if (!centerId) {
      return
    }

    if (showConfirm) {
      const confirmed = window.confirm(`Delete collection center ${centerId}? This cannot be undone.`)
      if (!confirmed) {
        return
      }
    }

    setDeleteCenterId(centerId)
    try {
      await axios.delete(`${apiUrl}/dashboard/collection-centers/${encodeURIComponent(centerId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      await fetchCollectionCenters()
    } catch {
      setCenterError('Failed to delete collection center')
    } finally {
      setDeleteCenterId(null)
    }
  }

  const normalizedLocationSearch = locationSearch.trim().toLowerCase()

  const registryRows = [...(data?.rows ?? [])]
    .filter((row) => String(row.Location ?? '').toLowerCase().includes(normalizedLocationSearch))
    .sort((left, right) => {
      const leftLocation = String(left.Location ?? '')
      const rightLocation = String(right.Location ?? '')
      return locationSortOrder === 'asc'
        ? leftLocation.localeCompare(rightLocation)
        : rightLocation.localeCompare(leftLocation)
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
              {isAdmin ? (
                <Button variant="outline" onClick={openCollectionCenterDialog}>
                  <Plus className="mr-1 h-4 w-4" />
                  Update Collection Center
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
            open={centerDialogOpen}
            onOpenChange={(open) => {
              setCenterDialogOpen(open)
              if (!open) {
                resetCenterForm()
                setDeleteCandidateCenterId('')
              }
            }}
          >
            <DialogContent className="h-[90vh] w-[96vw] max-w-[calc(100vw-1.5rem)] overflow-y-auto sm:w-[95vw] sm:!max-w-[1300px]">
              <DialogHeader>
                <DialogTitle>Update Collection Centers</DialogTitle>
                <DialogDescription>
                  Manage collection centers from one place with separate add and delete actions.
                </DialogDescription>
              </DialogHeader>

              <UiTabs value={centerActionTab} onValueChange={(value) => setCenterActionTab(value as CenterActionTab)}>
                <UiTabsList className="grid w-full grid-cols-2">
                  <UiTabsTrigger value="add">Add Center</UiTabsTrigger>
                  <UiTabsTrigger value="delete">Delete Center</UiTabsTrigger>
                </UiTabsList>

                <UiTabsContent value="add" className="mt-5 space-y-5">
                  <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
                    <div className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="center-id">Center ID</Label>
                          <Input
                            id="center-id"
                            value={centerForm.center_id}
                            onChange={(event) => handleCenterFieldChange('center_id', event.target.value)}
                            placeholder="Optional, auto-generates"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="center-name">Center Name</Label>
                          <Input
                            id="center-name"
                            value={centerForm.name}
                            onChange={(event) => handleCenterFieldChange('name', event.target.value)}
                            placeholder="Collection hub name"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="center-ward">Ward</Label>
                          <Input
                            id="center-ward"
                            value={centerForm.ward}
                            onChange={(event) => handleCenterFieldChange('ward', event.target.value)}
                            placeholder="Ward name"
                          />
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                          <Label htmlFor="center-address">Address</Label>
                          <Input
                            id="center-address"
                            value={centerForm.address}
                            onChange={(event) => handleCenterFieldChange('address', event.target.value)}
                            placeholder="Street, landmark"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="center-latitude">Latitude</Label>
                          <Input
                            id="center-latitude"
                            type="number"
                            step="0.000001"
                            value={centerForm.latitude}
                            onChange={(event) => handleCenterFieldChange('latitude', event.target.value)}
                            placeholder="12.971900"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="center-longitude">Longitude</Label>
                          <Input
                            id="center-longitude"
                            type="number"
                            step="0.000001"
                            value={centerForm.longitude}
                            onChange={(event) => handleCenterFieldChange('longitude', event.target.value)}
                            placeholder="77.593800"
                          />
                        </div>
                      </div>

                      <p className="text-sm text-muted-foreground">
                        Selected coordinate:
                        {centerSelectedPoint
                          ? ` ${centerSelectedPoint[0].toFixed(6)}, ${centerSelectedPoint[1].toFixed(6)}`
                          : ' click the map to set it.'}
                      </p>
                    </div>

                    <BinMap
                      rows={data?.rows ?? []}
                      collectionCenters={collectionCenters}
                      title="Click the map to place a collection center"
                      heightClassName="h-[360px] sm:h-[460px]"
                      onMapClick={handleCenterMapPick}
                      selectedPoint={centerSelectedPoint}
                    />
                  </div>

                  {centerError ? (
                    <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {centerError}
                    </p>
                  ) : null}

                  <DialogFooter>
                    <Button variant="outline" onClick={() => setCenterDialogOpen(false)}>
                      Close
                    </Button>
                    <Button onClick={handleAddCollectionCenter} disabled={centerSubmitting}>
                      <MapPinned className="mr-1 h-4 w-4" />
                      {centerSubmitting ? 'Saving...' : 'Save center'}
                    </Button>
                  </DialogFooter>
                </UiTabsContent>

                <UiTabsContent value="delete" className="mt-5 space-y-5">
                  <div className="space-y-3">
                    <Label htmlFor="delete-center">Select collection center to delete</Label>
                    <Select value={deleteCandidateCenterId} onValueChange={setDeleteCandidateCenterId}>
                      <SelectTrigger id="delete-center">
                        <SelectValue placeholder="Choose a collection center" />
                      </SelectTrigger>
                      <SelectContent>
                        {collectionCenters.map((center) => (
                          <SelectItem key={`delete-center-${center.Center_ID}`} value={center.Center_ID}>
                            {center.Center_ID} - {center.Name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-sm text-muted-foreground">
                      Deleting a collection center permanently removes it from the registry.
                    </p>
                  </div>

                  <DialogFooter>
                    <Button variant="outline" onClick={() => setCenterDialogOpen(false)}>
                      Close
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => void handleDeleteCollectionCenter(deleteCandidateCenterId, true)}
                      disabled={!deleteCandidateCenterId || deleteCenterId === deleteCandidateCenterId}
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      {deleteCenterId === deleteCandidateCenterId ? 'Deleting...' : 'Delete selected center'}
                    </Button>
                  </DialogFooter>
                </UiTabsContent>
              </UiTabs>
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
                      <BinMap rows={data.rows} collectionCenters={collectionCenters} title="Dustbin Locations & Fill Status" />
                      {isAdmin ? (
                        <Card className="border-white/70 bg-white/75 shadow-sm">
                          <CardHeader>
                            <CardTitle className="flex items-center justify-between gap-3">
                              <span>Bin Registry Management</span>
                              <Button variant="outline" onClick={openCollectionCenterDialog}>
                                <Plus className="mr-1 h-4 w-4" />
                                Update Collection Center
                              </Button>
                            </CardTitle>
                            <CardDescription>
                              Detailed registry view for management. Search and sort by location here.
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-5">
                            <div className="grid gap-3 md:grid-cols-2">
                              <div className="grid gap-3 sm:max-w-xs">
                                <Label htmlFor="location-search">Search by Location</Label>
                                <Input
                                  id="location-search"
                                  value={locationSearch}
                                  onChange={(event) => setLocationSearch(event.target.value)}
                                  placeholder="e.g. Central Ward"
                                />
                              </div>

                              <div className="grid gap-3 sm:max-w-xs">
                                <Label htmlFor="location-sort">Sort by Location</Label>
                                <Select value={locationSortOrder} onValueChange={(value) => setLocationSortOrder(value as 'asc' | 'desc')}>
                                  <SelectTrigger id="location-sort">
                                    <SelectValue placeholder="Sort order" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="asc">A to Z</SelectItem>
                                    <SelectItem value="desc">Z to A</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>

                            <DataTable rows={registryRows} emptyMessage="No bins found for the selected filters." />
                          </CardContent>
                        </Card>
                      ) : (
                        <DataTable rows={data.rows} emptyMessage="No monitoring data available." />
                      )}
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

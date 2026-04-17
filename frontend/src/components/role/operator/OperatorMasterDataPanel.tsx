import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Building2, Map, RefreshCw, User } from "lucide-react";

import BinsManagementPanel from "@/components/role/operator/master-data/BinsManagementPanel";
import DepotsManagementPanel from "@/components/role/operator/master-data/DepotsManagementPanel";
import DevicesManagementPanel from "@/components/role/operator/master-data/DevicesManagementPanel";
import ServiceAreasManagementPanel from "@/components/role/operator/master-data/ServiceAreasManagementPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { extractApiErrorMessage } from "@/lib/authApi";

type OperatorMasterDataPanelProps = {
  accessToken: string;
  apiBaseUrl: string;
};

type ListMetaResponse = {
  total: number;
  limit: number;
  offset: number;
  items: unknown[];
};

type MasterDataSummary = {
  depotsTotal: number;
  depotsActive: number;
  depotsInactive: number;
  serviceAreasTotal: number;
  driverProfilesTotal: number;
};

const LIST_LIMIT = 100;

function OperatorMasterDataPanel({
  accessToken,
  apiBaseUrl,
}: OperatorMasterDataPanelProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const [summary, setSummary] = useState<MasterDataSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState("");

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${accessToken}` }),
    [accessToken],
  );

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError("");

    try {
      const [
        depotsTotalRes,
        depotsActiveRes,
        serviceAreasRes,
        driverProfilesRes,
      ] = await Promise.all([
        axios.get<ListMetaResponse>(`${apiBaseUrl}/master-data/depots`, {
          headers,
          params: { limit: 1, offset: 0 },
        }),
        axios.get<ListMetaResponse>(`${apiBaseUrl}/master-data/depots`, {
          headers,
          params: { limit: 1, offset: 0, is_active: true },
        }),
        axios.get<ListMetaResponse>(`${apiBaseUrl}/master-data/service-areas`, {
          headers,
          params: { limit: 1, offset: 0 },
        }),
        axios.get<ListMetaResponse>(
          `${apiBaseUrl}/master-data/driver-profiles`,
          {
            headers,
            params: { limit: 1, offset: 0 },
          },
        ),
      ]);

      const depotsTotal = depotsTotalRes.data.total;
      const depotsActive = depotsActiveRes.data.total;

      setSummary({
        depotsTotal,
        depotsActive,
        depotsInactive: Math.max(depotsTotal - depotsActive, 0),
        serviceAreasTotal: serviceAreasRes.data.total,
        driverProfilesTotal: driverProfilesRes.data.total,
      });
    } catch (error) {
      setSummary(null);
      setSummaryError(
        extractApiErrorMessage(error, "Failed to load master data summary."),
      );
    } finally {
      setSummaryLoading(false);
    }
  }, [apiBaseUrl, headers]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5">
      <TabsList>
        <TabsTrigger value="overview">Master Data Overview</TabsTrigger>
        <TabsTrigger value="depots">Depots</TabsTrigger>
        <TabsTrigger value="service-areas">Service Areas</TabsTrigger>
        <TabsTrigger value="bins">Bins</TabsTrigger>
        <TabsTrigger value="devices">Devices</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="space-y-5">
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => void loadSummary()}>
            <RefreshCw className="mr-1 h-4 w-4" />
            Refresh Summary
          </Button>
        </div>

        {summaryError ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {summaryError}
          </p>
        ) : null}

        {summaryLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-36 w-full" />
          </div>
        ) : summary ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
              <CardHeader>
                <CardDescription className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Depots
                </CardDescription>
                <CardTitle className="text-2xl">
                  {summary.depotsTotal}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-slate-600">
                <div className="flex items-center justify-between">
                  <span>Active</span>
                  <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
                    {summary.depotsActive}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span>Inactive</span>
                  <Badge className="border-red-200 bg-red-50 text-red-700">
                    {summary.depotsInactive}
                  </Badge>
                </div>
                <Button
                  variant="outline"
                  className="mt-2 w-full"
                  onClick={() => setActiveTab("depots")}
                >
                  Open Depot Management
                </Button>
              </CardContent>
            </Card>

            <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
              <CardHeader>
                <CardDescription className="flex items-center gap-2">
                  <Map className="h-4 w-4" />
                  Service Areas
                </CardDescription>
                <CardTitle className="text-2xl">
                  {summary.serviceAreasTotal}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-slate-600">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setActiveTab("service-areas")}
                >
                  Open Service Areas
                </Button>
              </CardContent>
            </Card>

            <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
              <CardHeader>
                <CardDescription className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Driver Profiles
                </CardDescription>
                <CardTitle className="text-2xl">
                  {summary.driverProfilesTotal}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-slate-600">
                Driver profile data is currently managed in Drivers and
                reflected here as master-data volume.
              </CardContent>
            </Card>
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Pagination for master-data list APIs is capped at {LIST_LIMIT}; this
          panel keeps list requests within that limit.
        </p>
      </TabsContent>

      <TabsContent value="depots" className="space-y-4">
        <DepotsManagementPanel
          accessToken={accessToken}
          apiBaseUrl={apiBaseUrl}
          onDataChanged={loadSummary}
        />
      </TabsContent>

      <TabsContent value="service-areas" className="space-y-4">
        <ServiceAreasManagementPanel
          accessToken={accessToken}
          apiBaseUrl={apiBaseUrl}
          onDataChanged={loadSummary}
        />
      </TabsContent>

      <TabsContent value="bins" className="space-y-4">
        <BinsManagementPanel
          accessToken={accessToken}
          apiBaseUrl={apiBaseUrl}
        />
      </TabsContent>

      <TabsContent value="devices" className="space-y-4">
        <DevicesManagementPanel
          accessToken={accessToken}
          apiBaseUrl={apiBaseUrl}
        />
      </TabsContent>
    </Tabs>
  );
}

export default OperatorMasterDataPanel;

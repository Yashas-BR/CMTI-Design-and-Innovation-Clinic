import { useEffect, useMemo, useState } from "react";
import axios from "axios";

import BinMap from "@/components/BinMap";
import type { BinRecord, DepotRecord } from "@/components/role/operator/types";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { extractApiErrorMessage } from "@/lib/authApi";
import type { CollectionCenter, DataRow } from "@/types/dashboard";

type OperatorNavigationMapCardProps = {
  accessToken: string;
  apiBaseUrl: string;
};

type ListResponse<T> = {
  total: number;
  limit: number;
  offset: number;
  items: T[];
};

type ListQueryParams = Record<string, string | number | boolean>;

type TelemetryLatest = {
  bin_code: string;
  current_fill_pct: number | null;
  current_alert_level: string | null;
};

const LIST_LIMIT = 100;

async function fetchAllPaginatedItems<T>(
  url: string,
  headers: { Authorization: string },
  params: ListQueryParams = {},
): Promise<T[]> {
  const allItems: T[] = [];
  let offset = 0;

  while (true) {
    const response = await axios.get<ListResponse<T>>(url, {
      headers,
      params: {
        ...params,
        limit: LIST_LIMIT,
        offset,
      },
    });

    allItems.push(...response.data.items);

    if (
      response.data.items.length === 0 ||
      allItems.length >= response.data.total
    ) {
      break;
    }

    offset += LIST_LIMIT;
  }

  return allItems;
}

function mapStatusFromAlertLevel(
  level: string | null,
): "high" | "medium" | "low" {
  const normalized = (level ?? "").toUpperCase();
  if (normalized === "RED") {
    return "high";
  }
  if (normalized === "YELLOW") {
    return "medium";
  }
  return "low";
}

function OperatorNavigationMapCard({
  accessToken,
  apiBaseUrl,
}: OperatorNavigationMapCardProps) {
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [bins, setBins] = useState<BinRecord[]>([]);
  const [depots, setDepots] = useState<DepotRecord[]>([]);
  const [liveByBinCode, setLiveByBinCode] = useState<
    Record<string, { fill: number; status: "high" | "medium" | "low" }>
  >({});

  useEffect(() => {
    const headers = { Authorization: `Bearer ${accessToken}` };

    async function fetchNavigationMapData() {
      setLoading(true);
      setErrorMessage("");

      try {
        const [bins, depots] = await Promise.all([
          fetchAllPaginatedItems<BinRecord>(`${apiBaseUrl}/bins`, headers, {
            is_active: true,
          }),
          fetchAllPaginatedItems<DepotRecord>(
            `${apiBaseUrl}/master-data/depots`,
            headers,
            { is_active: true },
          ),
        ]);

        const nextBins = bins;
        setBins(nextBins);
        setDepots(depots);
        setLoading(false);

        // Load live fill/status in the background so the map renders immediately.
        const latestResults = await Promise.allSettled(
          nextBins.map((bin) =>
            axios.get<TelemetryLatest>(
              `${apiBaseUrl}/telemetry/bins/${bin.bin_code}/latest`,
              { headers },
            ),
          ),
        );

        const nextLiveByBinCode: Record<
          string,
          { fill: number; status: "high" | "medium" | "low" }
        > = {};

        for (const result of latestResults) {
          if (result.status !== "fulfilled") {
            continue;
          }

          const latest = result.value.data;
          nextLiveByBinCode[latest.bin_code] = {
            fill:
              typeof latest.current_fill_pct === "number" &&
              Number.isFinite(latest.current_fill_pct)
                ? latest.current_fill_pct
                : 0,
            status: mapStatusFromAlertLevel(latest.current_alert_level),
          };
        }

        setLiveByBinCode(nextLiveByBinCode);
      } catch (error) {
        setBins([]);
        setDepots([]);
        setLiveByBinCode({});
        setErrorMessage(
          extractApiErrorMessage(
            error,
            "Failed to load interactive bin and depot map.",
          ),
        );
      } finally {
        setLoading(false);
      }
    }

    void fetchNavigationMapData();
  }, [accessToken, apiBaseUrl]);

  const rows = useMemo<DataRow[]>(() => {
    return bins
      .filter((bin) => bin.latitude != null && bin.longitude != null)
      .map((bin) => {
        const live = liveByBinCode[bin.bin_code];
        return {
          Bin_ID: bin.bin_code,
          Latitude: bin.latitude ?? 0,
          Longitude: bin.longitude ?? 0,
          Location: bin.address_line ?? bin.display_name ?? bin.bin_code,
          Ward: bin.area_id != null ? String(bin.area_id) : "n/a",
          "Fill%": live?.fill ?? 0,
          Status: live?.status ?? "low",
          Priority: 0,
        };
      });
  }, [bins, liveByBinCode]);

  const collectionCenters = useMemo<CollectionCenter[]>(() => {
    return depots
      .filter((depot) => depot.latitude != null && depot.longitude != null)
      .map((depot) => ({
        Center_ID: String(depot.id),
        Name: depot.name,
        Ward: "Depot",
        Latitude: depot.latitude ?? 0,
        Longitude: depot.longitude ?? 0,
        Address: depot.address ?? "",
      }));
  }, [depots]);

  if (loading) {
    return <Skeleton className="h-105 w-full" />;
  }

  return (
    <div className="space-y-2">
      <BinMap
        rows={rows}
        collectionCenters={collectionCenters}
        title="Interactive Bin & Depot Map"
        heightClassName="h-[380px]"
        scrollWheelZoom
      />

      {rows.length === 0 && collectionCenters.length === 0 ? (
        <Card className="border-slate-200 bg-slate-50 shadow-sm">
          <CardContent className="pt-4 text-sm text-slate-700">
            Map rendered with default view. Add bin or depot coordinates to
            display markers.
          </CardContent>
        </Card>
      ) : null}

      {errorMessage ? (
        <Card className="border-amber-200 bg-amber-50 shadow-sm">
          <CardContent className="pt-4 text-sm text-amber-800">
            {errorMessage}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default OperatorNavigationMapCard;

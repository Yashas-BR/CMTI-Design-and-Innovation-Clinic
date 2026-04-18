import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { BellRing, RefreshCw, Signal, Wifi, WifiOff } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import BinMap from "@/components/BinMap";
import type { BinRecord, DeviceRecord } from "@/components/role/operator/types";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { extractApiErrorMessage, refreshLoginSession } from "@/lib/authApi";
import { loadStoredSession, saveStoredSession } from "@/lib/authStorage";
import type { DataRow } from "@/types/dashboard";

type OperatorRealtimePanelProps = {
  accessToken: string;
  apiBaseUrl: string;
};

type ListResponse<T> = {
  total: number;
  limit: number;
  offset: number;
  items: T[];
};

type TelemetryLiveSummary = {
  total_bins: number;
  bins_with_state: number;
  red_bins: number;
  yellow_bins: number;
  overflow_imminent_bins: number;
  offline_bins: number;
  open_alerts: number;
};

type TelemetryLatest = {
  bin_code: string;
  last_measured_at: string | null;
  current_fill_pct: number | null;
  current_fill_rate_pct_per_min: number | null;
  current_ttf_min: number | null;
  current_priority_score: number | null;
  current_alert_level: string | null;
  overflow_imminent: boolean;
  device_connectivity_state: string;
  queued_count: number;
};

type TelemetryHistoryPoint = {
  measured_at: string;
  fill_pct: number | null;
  fill_rate_pct_per_min: number | null;
  ttf_min: number | null;
  priority_score: number | null;
  alert_level: string | null;
  overflow_imminent: boolean;
  queued: boolean;
};

type TelemetryHistoryResponse = {
  bin_code: string;
  items: TelemetryHistoryPoint[];
};

type RealtimeBinUpdateEvent = {
  event: "bin_current_state_updated";
  org_id: number;
  bin_id: number;
  bin_code: string;
  last_measured_at: string | null;
  current_fill_pct: number | null;
  current_fill_rate_pct_per_min: number | null;
  current_ttf_min: number | null;
  current_priority_score: number | null;
  current_alert_level: string | null;
  overflow_imminent: boolean;
  device_connectivity_state: string | null;
  queued_count: number;
  updated_at: string | null;
};

type LiveState = {
  last_measured_at: string | null;
  current_fill_pct: number | null;
  current_fill_rate_pct_per_min: number | null;
  current_ttf_min: number | null;
  current_priority_score: number | null;
  current_alert_level: string | null;
  overflow_imminent: boolean;
  device_connectivity_state: string | null;
  queued_count: number;
  updated_at: string | null;
};

type EventLogItem = {
  id: string;
  received_at: string;
  payload: RealtimeBinUpdateEvent;
};

const LIST_LIMIT = 100;

function isUnauthorizedError(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 401;
}

function buildBinCodeCandidates(binCode: string): string[] {
  const normalized = binCode.trim();
  if (!normalized) {
    return [];
  }

  const candidates = [normalized];
  const separatorSwaps = [
    normalized.replace(/-/g, "_"),
    normalized.replace(/_/g, "-"),
  ];

  for (const candidate of separatorSwaps) {
    if (candidate && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  }

  return candidates;
}

function normalizeBinCodeForMatch(binCode: string): string {
  return binCode.trim().replace(/-/g, "_").toUpperCase();
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "n/a";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function levelClass(level: string | null): string {
  const value = (level ?? "").toUpperCase();
  if (value === "RED") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (value === "YELLOW") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (value === "GREEN") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function mapStatusFromAlertLevel(level: string | null): string {
  const value = (level ?? "").toUpperCase();
  if (value === "RED") {
    return "high";
  }
  if (value === "YELLOW") {
    return "medium";
  }
  return "low";
}

function connectivityClass(connectivity: string | null): string {
  const value = (connectivity ?? "").toLowerCase();
  if (value === "online") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (value === "offline") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function asNumber(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function computeDelta(
  current: number | null,
  previous: number | null,
): number | null {
  if (current == null || previous == null) {
    return null;
  }
  return current - previous;
}

function formatDelta(delta: number | null, digits = 2): string {
  if (delta == null) {
    return "n/a";
  }
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(digits)}`;
}

function deltaClass(delta: number | null, positiveIsGood: boolean): string {
  if (delta == null || Math.abs(delta) < 0.0001) {
    return "text-slate-500";
  }

  const isPositive = delta > 0;
  if ((positiveIsGood && isPositive) || (!positiveIsGood && !isPositive)) {
    return "font-medium text-emerald-700";
  }
  return "font-medium text-red-700";
}

function OperatorRealtimePanel({
  accessToken,
  apiBaseUrl,
}: OperatorRealtimePanelProps) {
  const [activeAccessToken, setActiveAccessToken] = useState(accessToken);
  const [loading, setLoading] = useState(true);
  const [wsState, setWsState] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");

  const [bins, setBins] = useState<BinRecord[]>([]);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [summary, setSummary] = useState<TelemetryLiveSummary | null>(null);

  const [liveByBinCode, setLiveByBinCode] = useState<Record<string, LiveState>>(
    {},
  );
  const [eventLog, setEventLog] = useState<EventLogItem[]>([]);

  const [searchText, setSearchText] = useState("");
  const [connectivityFilter, setConnectivityFilter] = useState("all");
  const [levelFilter, setLevelFilter] = useState("all");

  const [selectedBinCode, setSelectedBinCode] = useState<string | null>(null);
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const [historyLimit, setHistoryLimit] = useState("120");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyPoints, setHistoryPoints] = useState<TelemetryHistoryPoint[]>(
    [],
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const refreshInFlightRef = useRef<Promise<string | null> | null>(null);
  const seenPolledEventKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setActiveAccessToken(accessToken);
  }, [accessToken]);

  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    const refreshTask = (async () => {
      try {
        const storedSession = loadStoredSession();
        if (!storedSession?.refresh_token) {
          return null;
        }

        const refreshedSession = await refreshLoginSession({
          refresh_token: storedSession.refresh_token,
        });
        saveStoredSession(refreshedSession);
        setActiveAccessToken(refreshedSession.access_token);
        return refreshedSession.access_token;
      } catch {
        return null;
      } finally {
        refreshInFlightRef.current = null;
      }
    })();

    refreshInFlightRef.current = refreshTask;
    return refreshTask;
  }, []);

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${activeAccessToken}` }),
    [activeAccessToken],
  );

  const deviceByBinId = useMemo(() => {
    const map = new Map<number, DeviceRecord>();
    for (const device of devices) {
      if (!map.has(device.bin_id)) {
        map.set(device.bin_id, device);
      }
    }
    return map;
  }, [devices]);

  const fetchSummary = useCallback(async () => {
    const getSummary = async (token: string) =>
      axios.get<TelemetryLiveSummary>(`${apiBaseUrl}/telemetry/live/summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });

    try {
      const response = await getSummary(activeAccessToken);
      setSummary(response.data);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        const refreshedToken = await refreshAccessToken();
        if (refreshedToken) {
          try {
            const response = await getSummary(refreshedToken);
            setSummary(response.data);
            return;
          } catch {
            // Fall through to null summary when retry fails.
          }
        }
      }
      setSummary(null);
    }
  }, [activeAccessToken, apiBaseUrl, refreshAccessToken]);

  const fetchSelectedBinHistory = useCallback(async () => {
    if (!selectedBinCode) {
      return;
    }

    setHistoryLoading(true);
    setHistoryError("");

    try {
      const parsedLimit = Number.parseInt(historyLimit, 10);
      const safeLimit = Number.isFinite(parsedLimit) ? parsedLimit : 120;
      const historyCodeCandidates = buildBinCodeCandidates(selectedBinCode);

      let response: TelemetryHistoryResponse | null = null;
      let lastError: unknown = null;

      for (const codeCandidate of historyCodeCandidates) {
        try {
          const candidateResponse = await axios.get<TelemetryHistoryResponse>(
            `${apiBaseUrl}/telemetry/bins/${encodeURIComponent(codeCandidate)}/history`,
            {
              headers,
              params: { limit: safeLimit },
            },
          );
          response = candidateResponse.data;
          break;
        } catch (error) {
          lastError = error;
          if (
            !axios.isAxiosError(error) ||
            error.response?.status !== 404 ||
            !String(error.response?.data?.detail ?? "")
              .toLowerCase()
              .includes("bin not found")
          ) {
            throw error;
          }
        }
      }

      if (response == null) {
        throw lastError;
      }

      setHistoryPoints(response.items);
      const responseCode = normalizeBinCodeForMatch(response.bin_code);
      const resolvedCode =
        bins.find(
          (bin) => normalizeBinCodeForMatch(bin.bin_code) === responseCode,
        )?.bin_code ?? response.bin_code;

      if (resolvedCode !== selectedBinCode) {
        setSelectedBinCode(resolvedCode);
      }
    } catch (error) {
      setHistoryPoints([]);
      setHistoryError(
        extractApiErrorMessage(
          error,
          `Failed to load telemetry history for ${selectedBinCode}.`,
        ),
      );
    } finally {
      setHistoryLoading(false);
    }
  }, [apiBaseUrl, bins, headers, historyLimit, selectedBinCode]);

  const fetchBootstrapData = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    try {
      const [binsResponse, devicesResponse, summaryResponse] =
        await Promise.all([
          axios.get<ListResponse<BinRecord>>(`${apiBaseUrl}/bins`, {
            headers,
            params: { limit: LIST_LIMIT, offset: 0, is_active: true },
          }),
          axios.get<ListResponse<DeviceRecord>>(`${apiBaseUrl}/devices`, {
            headers,
            params: { limit: LIST_LIMIT, offset: 0 },
          }),
          axios.get<TelemetryLiveSummary>(
            `${apiBaseUrl}/telemetry/live/summary`,
            {
              headers,
            },
          ),
        ]);

      const nextBins = binsResponse.data.items;
      setBins(nextBins);
      setDevices(devicesResponse.data.items);
      setSummary(summaryResponse.data);

      // Only pre-select the first bin on the very first load, not on re-fetches
      // triggered by user interactions. Using a functional update on selectedBinCode
      // so we don't need it in the dependency array.
      setSelectedBinCode((current) =>
        current == null && nextBins.length > 0 ? nextBins[0].bin_code : current,
      );

      const latestResults = await Promise.allSettled(
        nextBins.map((bin) =>
          axios.get<TelemetryLatest>(
            `${apiBaseUrl}/telemetry/bins/${bin.bin_code}/latest`,
            {
              headers,
            },
          ),
        ),
      );

      const nextLiveByBinCode: Record<string, LiveState> = {};
      for (const result of latestResults) {
        if (result.status !== "fulfilled") {
          continue;
        }
        const latest = result.value.data;
        nextLiveByBinCode[latest.bin_code] = {
          last_measured_at: latest.last_measured_at,
          current_fill_pct: latest.current_fill_pct,
          current_fill_rate_pct_per_min: latest.current_fill_rate_pct_per_min,
          current_ttf_min: latest.current_ttf_min,
          current_priority_score: latest.current_priority_score,
          current_alert_level: latest.current_alert_level,
          overflow_imminent: latest.overflow_imminent,
          device_connectivity_state: latest.device_connectivity_state,
          queued_count: latest.queued_count,
          updated_at: latest.last_measured_at,
        };
      }
      setLiveByBinCode(nextLiveByBinCode);
      setNoticeMessage(
        "Realtime dashboard initialized from current telemetry state.",
      );
    } catch (error) {
      setBins([]);
      setDevices([]);
      setSummary(null);
      setLiveByBinCode({});
      setErrorMessage(
        extractApiErrorMessage(
          error,
          "Failed to initialize realtime dashboard.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, headers]);

  useEffect(() => {
    void fetchBootstrapData();
  }, [fetchBootstrapData]);

  useEffect(() => {
    if (!drilldownOpen || !selectedBinCode) {
      return;
    }
    void fetchSelectedBinHistory();
  }, [drilldownOpen, fetchSelectedBinHistory, selectedBinCode]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchSummary();
    }, 20000);

    return () => {
      window.clearInterval(timer);
    };
  }, [fetchSummary]);

  const pollSelectedBinTelemetry = useCallback(async () => {
    if (!selectedBinCode) {
      return;
    }

    const codeCandidates = buildBinCodeCandidates(selectedBinCode);
    let response: TelemetryLatest | null = null;

    for (const codeCandidate of codeCandidates) {
      try {
        const candidateResponse = await axios.get<TelemetryLatest>(
          `${apiBaseUrl}/telemetry/bins/${encodeURIComponent(codeCandidate)}/latest`,
          {
            headers,
          },
        );
        response = candidateResponse.data;
        break;
      } catch (error) {
        if (
          !axios.isAxiosError(error) ||
          error.response?.status !== 404 ||
          !String(error.response?.data?.detail ?? "")
            .toLowerCase()
            .includes("bin not found")
        ) {
          throw error;
        }
      }
    }

    if (response == null) {
      return;
    }

    const responseCode = normalizeBinCodeForMatch(response.bin_code);
    const resolvedCode =
      bins.find(
        (bin) => normalizeBinCodeForMatch(bin.bin_code) === responseCode,
      )?.bin_code ?? response.bin_code;
    const resolvedBin =
      bins.find((bin) => bin.bin_code === resolvedCode) ??
      bins.find(
        (bin) => normalizeBinCodeForMatch(bin.bin_code) === responseCode,
      ) ??
      null;

    if (resolvedCode !== selectedBinCode) {
      setSelectedBinCode(resolvedCode);
    }

    setLiveByBinCode((previous) => {
      const current = previous[resolvedCode];
      return {
        ...previous,
        [resolvedCode]: {
          last_measured_at: response.last_measured_at,
          current_fill_pct: response.current_fill_pct,
          current_fill_rate_pct_per_min: response.current_fill_rate_pct_per_min,
          current_ttf_min: response.current_ttf_min,
          current_priority_score: response.current_priority_score,
          current_alert_level: response.current_alert_level,
          overflow_imminent: response.overflow_imminent,
          device_connectivity_state:
            response.device_connectivity_state ??
            current?.device_connectivity_state ??
            "unknown",
          queued_count: response.queued_count,
          updated_at: response.last_measured_at,
        },
      };
    });

    const eventKey = [
      resolvedCode,
      response.last_measured_at ?? "n",
      response.current_fill_pct ?? "n",
      response.current_priority_score ?? "n",
      response.current_alert_level ?? "n",
      response.overflow_imminent ? 1 : 0,
      response.queued_count,
    ].join("|");

    if (seenPolledEventKeysRef.current.has(eventKey)) {
      return;
    }
    seenPolledEventKeysRef.current.add(eventKey);

    const payload: RealtimeBinUpdateEvent = {
      event: "bin_current_state_updated",
      org_id: 0,
      bin_id: resolvedBin?.id ?? 0,
      bin_code: resolvedCode,
      last_measured_at: response.last_measured_at,
      current_fill_pct: response.current_fill_pct,
      current_fill_rate_pct_per_min: response.current_fill_rate_pct_per_min,
      current_ttf_min: response.current_ttf_min,
      current_priority_score: response.current_priority_score,
      current_alert_level: response.current_alert_level,
      overflow_imminent: response.overflow_imminent,
      device_connectivity_state: response.device_connectivity_state,
      queued_count: response.queued_count,
      updated_at: response.last_measured_at,
    };

    setEventLog((previous) =>
      [
        {
          id: `${payload.bin_code}-${payload.last_measured_at ?? "n"}`,
          received_at: payload.last_measured_at ?? new Date().toISOString(),
          payload,
        },
        ...previous,
      ].slice(0, 120),
    );
  }, [apiBaseUrl, bins, headers, selectedBinCode]);

  useEffect(() => {
    let disposed = false;

    const poll = async () => {
      if (disposed) {
        return;
      }

      if (document.visibilityState !== "visible") {
        return;
      }

      try {
        setWsState((previous) =>
          previous === "connected" ? previous : "connecting",
        );
        await pollSelectedBinTelemetry();
        if (!disposed) {
          setWsState("connected");
        }
      } catch {
        if (!disposed) {
          setWsState("disconnected");
        }
      }
    };

    setNoticeMessage(
      "Realtime feed mode: polling telemetry service for latest MQTT-ingested data.",
    );

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 15000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [pollSelectedBinTelemetry]);

  const selectedBinEventLog = useMemo(() => {
    if (!selectedBinCode) {
      return eventLog;
    }
    const selectedCode = normalizeBinCodeForMatch(selectedBinCode);
    return eventLog.filter(
      (item) =>
        normalizeBinCodeForMatch(item.payload.bin_code) === selectedCode,
    );
  }, [eventLog, selectedBinCode]);

  const filteredBins = useMemo(() => {
    const query = searchText.trim().toLowerCase();

    return bins.filter((bin) => {
      const live = liveByBinCode[bin.bin_code];
      const connectivity = (
        live?.device_connectivity_state ?? "unknown"
      ).toLowerCase();
      const level = (live?.current_alert_level ?? "unknown").toLowerCase();

      const connectivityOk =
        connectivityFilter === "all" || connectivity === connectivityFilter;
      const levelOk = levelFilter === "all" || level === levelFilter;

      if (!connectivityOk || !levelOk) {
        return false;
      }

      if (!query) {
        return true;
      }

      const text =
        `${bin.bin_code} ${bin.display_name ?? ""} ${bin.address_line ?? ""}`.toLowerCase();
      return text.includes(query);
    });
  }, [bins, connectivityFilter, levelFilter, liveByBinCode, searchText]);

  const selectedBin = useMemo(() => {
    if (!selectedBinCode) {
      return null;
    }
    const selectedCode = normalizeBinCodeForMatch(selectedBinCode);
    return (
      bins.find(
        (bin) => normalizeBinCodeForMatch(bin.bin_code) === selectedCode,
      ) ?? null
    );
  }, [bins, selectedBinCode]);

  const selectedLive = selectedBin ? liveByBinCode[selectedBin.bin_code] : null;
  const selectedDevice =
    selectedBin != null ? (deviceByBinId.get(selectedBin.id) ?? null) : null;

  const selectedBinHistoryAsc = useMemo(() => {
    return [...historyPoints].sort(
      (left, right) =>
        new Date(left.measured_at).getTime() -
        new Date(right.measured_at).getTime(),
    );
  }, [historyPoints]);

  const selectedBinHistorySeries = useMemo(() => {
    return selectedBinHistoryAsc.map((point) => {
      const priority = asNumber(point.priority_score);
      return {
        measured_at: point.measured_at,
        fill_pct: asNumber(point.fill_pct),
        priority_pct: priority != null ? priority * 100 : null,
      };
    });
  }, [selectedBinHistoryAsc]);

  const selectedBinHistoryDiffRows = useMemo(() => {
    return selectedBinHistoryAsc.map((point, index) => {
      const previous = index > 0 ? selectedBinHistoryAsc[index - 1] : null;

      const fillDelta = computeDelta(
        asNumber(point.fill_pct),
        asNumber(previous?.fill_pct),
      );
      const priorityDelta = computeDelta(
        asNumber(point.priority_score),
        asNumber(previous?.priority_score),
      );
      const ttfDelta = computeDelta(
        asNumber(point.ttf_min),
        asNumber(previous?.ttf_min),
      );

      const alertChanged =
        previous != null && previous.alert_level !== point.alert_level;
      const overflowChanged =
        previous != null &&
        previous.overflow_imminent !== point.overflow_imminent;
      const queuedChanged =
        previous != null && previous.queued !== point.queued;

      const hasNumericChange =
        (fillDelta != null && Math.abs(fillDelta) > 0.0001) ||
        (priorityDelta != null && Math.abs(priorityDelta) > 0.0001) ||
        (ttfDelta != null && Math.abs(ttfDelta) > 0.0001);

      return {
        point,
        fillDelta,
        priorityDelta,
        ttfDelta,
        alertChanged,
        overflowChanged,
        queuedChanged,
        hasAnyChange:
          hasNumericChange || alertChanged || overflowChanged || queuedChanged,
      };
    });
  }, [selectedBinHistoryAsc]);

  const mapRows = useMemo<DataRow[]>(() => {
    return filteredBins.map((bin) => {
      const live = liveByBinCode[bin.bin_code];
      return {
        Bin_ID: bin.bin_code,
        Latitude: bin.latitude ?? 0,
        Longitude: bin.longitude ?? 0,
        Location: bin.address_line ?? bin.display_name ?? bin.bin_code,
        Ward: bin.area_id != null ? String(bin.area_id) : "n/a",
        "Fill%": live?.current_fill_pct ?? 0,
        Status: mapStatusFromAlertLevel(live?.current_alert_level ?? null),
        Priority: live?.current_priority_score ?? 0,
      };
    });
  }, [filteredBins, liveByBinCode]);

  const topPriorityData = useMemo(() => {
    return bins
      .map((bin) => {
        const live = liveByBinCode[bin.bin_code];
        return {
          bin_code: bin.bin_code,
          priority: live?.current_priority_score ?? 0,
          fill: live?.current_fill_pct ?? 0,
        };
      })
      .sort((left, right) => right.priority - left.priority)
      .slice(0, 10);
  }, [bins, liveByBinCode]);

  const connectivityPieData = useMemo(() => {
    let online = 0;
    let offline = 0;
    let unknown = 0;

    for (const bin of bins) {
      const state = (
        liveByBinCode[bin.bin_code]?.device_connectivity_state ?? ""
      ).toLowerCase();
      if (state === "online") {
        online += 1;
      } else if (state === "offline") {
        offline += 1;
      } else {
        unknown += 1;
      }
    }

    return [
      { name: "online", value: online, color: "#10b981" },
      { name: "offline", value: offline, color: "#ef4444" },
      { name: "unknown", value: unknown, color: "#94a3b8" },
    ];
  }, [bins, liveByBinCode]);

  const localSummary = useMemo(() => {
    const binsWithState = bins.filter(
      (bin) => liveByBinCode[bin.bin_code] != null,
    ).length;
    const redBins = bins.filter(
      (bin) =>
        (
          liveByBinCode[bin.bin_code]?.current_alert_level ?? ""
        ).toUpperCase() === "RED",
    ).length;
    const yellowBins = bins.filter(
      (bin) =>
        (
          liveByBinCode[bin.bin_code]?.current_alert_level ?? ""
        ).toUpperCase() === "YELLOW",
    ).length;
    const overflowBins = bins.filter(
      (bin) => liveByBinCode[bin.bin_code]?.overflow_imminent === true,
    ).length;
    const offlineBins = bins.filter(
      (bin) =>
        (
          liveByBinCode[bin.bin_code]?.device_connectivity_state ?? ""
        ).toLowerCase() === "offline",
    ).length;

    return {
      total_bins: bins.length,
      bins_with_state: binsWithState,
      red_bins: redBins,
      yellow_bins: yellowBins,
      overflow_imminent_bins: overflowBins,
      offline_bins: offlineBins,
    };
  }, [bins, liveByBinCode]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Signal className="h-5 w-5 text-cyan-700" />
              Realtime MQTT Telemetry Dashboard
            </CardTitle>
            <CardDescription>
              Live bin current-state updates pulled from telemetry service
              snapshots populated by MQTT ingestion.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              className={
                wsState === "connected"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : wsState === "connecting"
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : "border-red-200 bg-red-50 text-red-700"
              }
            >
              {wsState === "connected" ? (
                <Wifi className="mr-1 h-4 w-4" />
              ) : (
                <WifiOff className="mr-1 h-4 w-4" />
              )}
              {wsState}
            </Badge>
            <Button variant="outline" onClick={() => void fetchBootstrapData()}>
              <RefreshCw className="mr-1 h-4 w-4" />
              Re-sync
            </Button>
          </div>
        </CardHeader>
      </Card>

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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription>Total Bins</CardDescription>
            <CardTitle className="text-2xl">
              {summary?.total_bins ?? localSummary.total_bins}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-600">
            With live state:{" "}
            {summary?.bins_with_state ?? localSummary.bins_with_state}
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <BellRing className="h-4 w-4" />
              Alert-Level Bins
            </CardDescription>
            <CardTitle className="text-2xl">
              {(summary?.red_bins ?? localSummary.red_bins) +
                (summary?.yellow_bins ?? localSummary.yellow_bins)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-600">
            Red: {summary?.red_bins ?? localSummary.red_bins}, Yellow:{" "}
            {summary?.yellow_bins ?? localSummary.yellow_bins}
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription>Overflow Imminent</CardDescription>
            <CardTitle className="text-2xl">
              {summary?.overflow_imminent_bins ??
                localSummary.overflow_imminent_bins}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-600">
            Open alerts: {summary?.open_alerts ?? "n/a"}
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription>Offline Devices</CardDescription>
            <CardTitle className="text-2xl">
              {summary?.offline_bins ?? localSummary.offline_bins}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-600">
            Event log count: {eventLog.length}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
          <CardHeader>
            <CardTitle>Top Priority Live Bins</CardTitle>
            <CardDescription>
              Highest current priority scores from latest realtime state.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={topPriorityData}
                  margin={{ top: 12, right: 12, left: 2, bottom: 24 }}
                >
                  <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="bin_code"
                    angle={-20}
                    textAnchor="end"
                    interval={0}
                    height={56}
                  />
                  <YAxis />
                  <Tooltip
                    formatter={(value) =>
                      Number(value ?? 0).toLocaleString(undefined, {
                        maximumFractionDigits: 3,
                      })
                    }
                  />
                  <Bar
                    dataKey="priority"
                    fill="#0ea5e9"
                    radius={[8, 8, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
          <CardHeader>
            <CardTitle>Connectivity Distribution</CardTitle>
            <CardDescription>
              Online/offline visibility from latest per-bin state.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={connectivityPieData}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={98}
                    cx="50%"
                    cy="50%"
                    label
                  >
                    {connectivityPieData.map((item) => (
                      <Cell key={item.name} fill={item.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) =>
                      Number(value ?? 0).toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })
                    }
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <BinMap rows={mapRows} title="Live Bin Status Map" />

        <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
          <CardHeader>
            <CardTitle>Live Event Stream</CardTitle>
            <CardDescription>
              Most recent telemetry updates recorded after MQTT ingestion and
              state transitions.
              {selectedBinCode
                ? ` Showing selected bin events for ${selectedBinCode}.`
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selectedBinEventLog.length === 0 ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {selectedBinCode
                  ? `Waiting for live updates for ${selectedBinCode}.`
                  : "Waiting for live updates."}
              </p>
            ) : (
              <div className="max-h-120 space-y-2 overflow-y-auto pr-1">
                {selectedBinEventLog.slice(0, 30).map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border bg-slate-50 p-2.5 text-xs"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="font-medium text-slate-900">
                        {item.payload.bin_code}
                      </p>
                      <span className="text-slate-500">
                        {formatDateTime(item.received_at)}
                      </span>
                    </div>
                    <p className="text-slate-700">
                      Fill:{" "}
                      {item.payload.current_fill_pct != null
                        ? item.payload.current_fill_pct.toFixed(1)
                        : "n/a"}
                      %{" | "}
                      Priority:{" "}
                      {item.payload.current_priority_score != null
                        ? item.payload.current_priority_score.toFixed(3)
                        : "n/a"}
                    </p>
                    <p className="text-slate-600">
                      Alert: {item.payload.current_alert_level ?? "unknown"}
                      {" | "}
                      Connectivity:{" "}
                      {item.payload.device_connectivity_state ?? "unknown"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Realtime Bin + Device Table</CardTitle>
            <CardDescription>
              Unified bin telemetry and associated device MQTT identity.
            </CardDescription>
          </div>
          <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-3">
            <Input
              placeholder="Search bin code/name"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
            />
            <Select
              value={connectivityFilter}
              onValueChange={setConnectivityFilter}
            >
              <SelectTrigger>
                <SelectValue placeholder="Connectivity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All connectivity</SelectItem>
                <SelectItem value="online">online</SelectItem>
                <SelectItem value="offline">offline</SelectItem>
                <SelectItem value="unknown">unknown</SelectItem>
              </SelectContent>
            </Select>
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Alert level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All levels</SelectItem>
                <SelectItem value="green">green</SelectItem>
                <SelectItem value="yellow">yellow</SelectItem>
                <SelectItem value="red">red</SelectItem>
                <SelectItem value="unknown">unknown</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {filteredBins.length === 0 ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              No bins match current filter.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bin</TableHead>
                  <TableHead>Fill</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Alert</TableHead>
                  <TableHead>Connectivity</TableHead>
                  <TableHead>MQTT Client</TableHead>
                  <TableHead>Last Update</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBins.map((bin) => {
                  const live = liveByBinCode[bin.bin_code];
                  const device = deviceByBinId.get(bin.id);
                  return (
                    <TableRow key={bin.id}>
                      <TableCell className="font-medium">
                        {bin.bin_code}
                      </TableCell>
                      <TableCell>
                        {live?.current_fill_pct != null
                          ? `${live.current_fill_pct.toFixed(1)}%`
                          : "n/a"}
                      </TableCell>
                      <TableCell>
                        {live?.current_priority_score != null
                          ? live.current_priority_score.toFixed(3)
                          : "n/a"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={levelClass(
                            live?.current_alert_level ?? null,
                          )}
                        >
                          {live?.current_alert_level ?? "unknown"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={connectivityClass(
                            live?.device_connectivity_state ?? null,
                          )}
                        >
                          {live?.device_connectivity_state ?? "unknown"}
                        </Badge>
                      </TableCell>
                      <TableCell>{device?.mqtt_client_id ?? "n/a"}</TableCell>
                      <TableCell>
                        {formatDateTime(
                          live?.updated_at ?? live?.last_measured_at ?? null,
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedBinCode(bin.bin_code)}
                          >
                            Inspect
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => {
                              setSelectedBinCode(bin.bin_code);
                              setDrilldownOpen(true);
                            }}
                          >
                            Drilldown
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
        <CardHeader>
          <CardTitle>Selected Bin Realtime Detail</CardTitle>
          <CardDescription>
            Deep view for one bin including telemetry trend indicators and
            device identity.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!selectedBin ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              Select a bin from table to inspect live details.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border bg-slate-50 p-3 text-sm">
                <p className="text-slate-500">Bin</p>
                <p className="font-semibold text-slate-900">
                  {selectedBin.bin_code}
                </p>
                <p className="text-xs text-slate-600">
                  {selectedBin.display_name ?? "n/a"}
                </p>
              </div>
              <div className="rounded-lg border bg-slate-50 p-3 text-sm">
                <p className="text-slate-500">Current Fill</p>
                <p className="font-semibold text-slate-900">
                  {selectedLive?.current_fill_pct != null
                    ? `${selectedLive.current_fill_pct.toFixed(1)}%`
                    : "n/a"}
                </p>
                <p className="text-xs text-slate-600">
                  Rate:{" "}
                  {selectedLive?.current_fill_rate_pct_per_min != null
                    ? `${selectedLive.current_fill_rate_pct_per_min.toFixed(3)} %/min`
                    : "n/a"}
                </p>
              </div>
              <div className="rounded-lg border bg-slate-50 p-3 text-sm">
                <p className="text-slate-500">Time To Full</p>
                <p className="font-semibold text-slate-900">
                  {selectedLive?.current_ttf_min != null
                    ? `${selectedLive.current_ttf_min.toFixed(1)} min`
                    : "n/a"}
                </p>
                <p className="text-xs text-slate-600">
                  Queued: {selectedLive?.queued_count ?? "n/a"}
                </p>
              </div>
              <div className="rounded-lg border bg-slate-50 p-3 text-sm">
                <p className="text-slate-500">Device</p>
                <p className="font-semibold text-slate-900">
                  {selectedDevice?.device_uid ?? "n/a"}
                </p>
                <p className="text-xs text-slate-600">
                  MQTT: {selectedDevice?.mqtt_client_id ?? "n/a"}
                </p>
              </div>
              <div className="rounded-lg border bg-slate-50 p-3 text-sm sm:col-span-2">
                <p className="text-slate-500">Last Measurement</p>
                <p className="font-semibold text-slate-900">
                  {formatDateTime(selectedLive?.last_measured_at ?? null)}
                </p>
              </div>
              <div className="rounded-lg border bg-slate-50 p-3 text-sm">
                <p className="text-slate-500">Alert Level</p>
                <Badge
                  className={levelClass(
                    selectedLive?.current_alert_level ?? null,
                  )}
                >
                  {selectedLive?.current_alert_level ?? "unknown"}
                </Badge>
              </div>
              <div className="rounded-lg border bg-slate-50 p-3 text-sm">
                <p className="text-slate-500">Connectivity</p>
                <Badge
                  className={connectivityClass(
                    selectedLive?.device_connectivity_state ?? null,
                  )}
                >
                  {selectedLive?.device_connectivity_state ?? "unknown"}
                </Badge>
              </div>
              <div className="rounded-lg border bg-slate-50 p-3 text-sm sm:col-span-2 lg:col-span-4">
                <Button
                  variant="outline"
                  onClick={() => setDrilldownOpen(true)}
                >
                  Open Bin Drilldown
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={drilldownOpen} onOpenChange={setDrilldownOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>
              Bin Drilldown: {selectedBin?.bin_code ?? "No bin selected"}
            </DialogTitle>
            <DialogDescription>
              Mini trend history from telemetry endpoint with per-event diff
              highlighting.
            </DialogDescription>
          </DialogHeader>

          {!selectedBin ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              Select a bin first, then open drilldown.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border bg-slate-50 p-3 text-sm">
                  <p className="text-slate-500">Bin</p>
                  <p className="font-semibold text-slate-900">
                    {selectedBin.bin_code}
                  </p>
                  <p className="text-xs text-slate-600">
                    {selectedBin.display_name ?? "n/a"}
                  </p>
                </div>
                <div className="rounded-lg border bg-slate-50 p-3 text-sm">
                  <p className="text-slate-500">Current Fill</p>
                  <p className="font-semibold text-slate-900">
                    {selectedLive?.current_fill_pct != null
                      ? `${selectedLive.current_fill_pct.toFixed(1)}%`
                      : "n/a"}
                  </p>
                  <p className="text-xs text-slate-600">
                    Last:{" "}
                    {formatDateTime(selectedLive?.last_measured_at ?? null)}
                  </p>
                </div>
                <div className="rounded-lg border bg-slate-50 p-3 text-sm">
                  <p className="text-slate-500">TTF</p>
                  <p className="font-semibold text-slate-900">
                    {selectedLive?.current_ttf_min != null
                      ? `${selectedLive.current_ttf_min.toFixed(1)} min`
                      : "n/a"}
                  </p>
                </div>
                <div className="rounded-lg border bg-slate-50 p-3 text-sm">
                  <p className="text-slate-500">Device</p>
                  <p className="font-semibold text-slate-900">
                    {selectedDevice?.device_uid ?? "n/a"}
                  </p>
                  <p className="text-xs text-slate-600">
                    MQTT: {selectedDevice?.mqtt_client_id ?? "n/a"}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex w-full max-w-sm items-center gap-2">
                  <Select value={historyLimit} onValueChange={setHistoryLimit}>
                    <SelectTrigger>
                      <SelectValue placeholder="History points" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">Last 30 points</SelectItem>
                      <SelectItem value="120">Last 120 points</SelectItem>
                      <SelectItem value="300">Last 300 points</SelectItem>
                      <SelectItem value="1000">Last 1000 points</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="outline"
                  onClick={() => void fetchSelectedBinHistory()}
                >
                  <RefreshCw className="mr-1 h-4 w-4" />
                  Refresh History
                </Button>
              </div>

              {historyError ? (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {historyError}
                </p>
              ) : null}

              {historyLoading ? (
                <Skeleton className="h-72 w-full" />
              ) : selectedBinHistorySeries.length === 0 ? (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  No telemetry history available for this bin.
                </p>
              ) : (
                <>
                  <Card className="border-white/80 bg-white/85 shadow-sm">
                    <CardHeader>
                      <CardTitle>Mini Trend</CardTitle>
                      <CardDescription>
                        Fill % and priority (scaled to %) over recent telemetry
                        points.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="h-60 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart
                            data={selectedBinHistorySeries}
                            margin={{ top: 12, right: 12, left: 2, bottom: 18 }}
                          >
                            <CartesianGrid
                              strokeDasharray="4 4"
                              stroke="#e2e8f0"
                            />
                            <XAxis
                              dataKey="measured_at"
                              tickFormatter={(value) => {
                                const date = new Date(value as string);
                                return Number.isNaN(date.getTime())
                                  ? "-"
                                  : date.toLocaleTimeString();
                              }}
                              minTickGap={26}
                            />
                            <YAxis />
                            <Tooltip
                              labelFormatter={(value) =>
                                formatDateTime(value as string)
                              }
                              formatter={(value) =>
                                Number(value ?? 0).toLocaleString(undefined, {
                                  maximumFractionDigits: 2,
                                })
                              }
                            />
                            <Line
                              type="monotone"
                              dataKey="fill_pct"
                              stroke="#0ea5e9"
                              dot={false}
                              strokeWidth={2}
                            />
                            <Line
                              type="monotone"
                              dataKey="priority_pct"
                              stroke="#f97316"
                              dot={false}
                              strokeWidth={2}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-white/80 bg-white/85 shadow-sm">
                    <CardHeader>
                      <CardTitle>Per-Event Diffs</CardTitle>
                      <CardDescription>
                        Consecutive telemetry deltas and status transitions.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="max-h-96 overflow-y-auto rounded-lg border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Measured At</TableHead>
                              <TableHead>Fill %</TableHead>
                              <TableHead>Δ Fill</TableHead>
                              <TableHead>Priority</TableHead>
                              <TableHead>Δ Priority</TableHead>
                              <TableHead>TTF</TableHead>
                              <TableHead>Δ TTF</TableHead>
                              <TableHead>Transition</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {selectedBinHistoryDiffRows
                              .slice()
                              .reverse()
                              .map((row) => {
                                const transitionText = row.alertChanged
                                  ? "alert changed"
                                  : row.overflowChanged
                                    ? "overflow changed"
                                    : row.queuedChanged
                                      ? "queue changed"
                                      : "-";

                                return (
                                  <TableRow
                                    key={row.point.measured_at}
                                    className={
                                      row.hasAnyChange
                                        ? "bg-cyan-50/35"
                                        : undefined
                                    }
                                  >
                                    <TableCell>
                                      {formatDateTime(row.point.measured_at)}
                                    </TableCell>
                                    <TableCell>
                                      {row.point.fill_pct != null
                                        ? row.point.fill_pct.toFixed(1)
                                        : "n/a"}
                                    </TableCell>
                                    <TableCell
                                      className={deltaClass(
                                        row.fillDelta,
                                        false,
                                      )}
                                    >
                                      {formatDelta(row.fillDelta, 1)}
                                    </TableCell>
                                    <TableCell>
                                      {row.point.priority_score != null
                                        ? row.point.priority_score.toFixed(3)
                                        : "n/a"}
                                    </TableCell>
                                    <TableCell
                                      className={deltaClass(
                                        row.priorityDelta,
                                        false,
                                      )}
                                    >
                                      {formatDelta(row.priorityDelta, 3)}
                                    </TableCell>
                                    <TableCell>
                                      {row.point.ttf_min != null
                                        ? row.point.ttf_min.toFixed(1)
                                        : "n/a"}
                                    </TableCell>
                                    <TableCell
                                      className={deltaClass(row.ttfDelta, true)}
                                    >
                                      {formatDelta(row.ttfDelta, 1)}
                                    </TableCell>
                                    <TableCell>
                                      <span
                                        className={
                                          row.hasAnyChange
                                            ? "font-medium text-cyan-700"
                                            : "text-slate-500"
                                        }
                                      >
                                        {transitionText}
                                      </span>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          )}

          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>

      <p className="text-xs text-muted-foreground">
        Realtime stream source: telemetry history polling endpoint
        /api/v1/telemetry/bins/{"{"}bin_code{"}"}/history with MQTT-driven bin
        telemetry events.
      </p>
    </div>
  );
}

export default OperatorRealtimePanel;

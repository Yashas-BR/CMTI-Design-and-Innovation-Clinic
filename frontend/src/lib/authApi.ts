import axios from "axios";

import type {
  CreateDriverRequest,
  LoginRequest,
  LoginResponse,
  TokenRefreshRequest,
  UserSummaryResponse,
} from "@/types/auth";

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

const DEFAULT_API_BASE_URL = "http://localhost:8000/api/v1";
const API_BASE_URL = normalizeBaseUrl(
  import.meta.env.VITE_API_BASE_URL ??
    import.meta.env.VITE_API_URL ??
    DEFAULT_API_BASE_URL,
);

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

export function extractApiErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string" && detail.trim().length > 0) {
      return detail;
    }

    const message = error.response?.data?.message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }

  return fallback;
}

export async function loginWithPassword(
  payload: LoginRequest,
): Promise<LoginResponse> {
  const response = await axios.post<LoginResponse>(
    `${API_BASE_URL}/auth/login`,
    payload,
  );
  return response.data;
}

export async function refreshLoginSession(
  payload: TokenRefreshRequest,
): Promise<LoginResponse> {
  const response = await axios.post<LoginResponse>(
    `${API_BASE_URL}/auth/refresh`,
    payload,
  );
  return response.data;
}

export async function fetchCurrentUser(
  accessToken: string,
): Promise<UserSummaryResponse> {
  const response = await axios.get<UserSummaryResponse>(
    `${API_BASE_URL}/auth/me`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  return response.data;
}

export async function createDriverUser(
  accessToken: string,
  payload: CreateDriverRequest,
): Promise<UserSummaryResponse> {
  const response = await axios.post<UserSummaryResponse>(
    `${API_BASE_URL}/auth/drivers`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  return response.data;
}

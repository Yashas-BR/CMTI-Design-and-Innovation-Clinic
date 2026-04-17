export type RoleKey =
  | "authority_admin"
  | "authority_operator"
  | "driver"
  | string;

export type LoginRequest = {
  email: string;
  password: string;
};

export type TokenRefreshRequest = {
  refresh_token: string;
};

export type LoginResponse = {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
  expires_in_seconds: number;
  role_keys: RoleKey[];
  user_id: number;
  org_id: number;
};

export type UserSummaryResponse = {
  id: number;
  org_id: number;
  full_name: string;
  email: string;
  phone: string | null;
  status: string;
  is_active: boolean;
  role_keys: RoleKey[];
  created_at: string;
  updated_at: string;
};

export type CreateDriverRequest = {
  full_name: string;
  email: string;
  password: string;
  phone?: string | null;
};

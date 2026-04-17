import { useEffect, useState } from "react";
import axios from "axios";
import { Navigate, Route, Routes } from "react-router-dom";

import { Skeleton } from "@/components/ui/skeleton";
import {
  extractApiErrorMessage,
  fetchCurrentUser,
  getApiBaseUrl,
  loginWithPassword,
  refreshLoginSession,
} from "@/lib/authApi";
import {
  clearStoredSession,
  loadStoredSession,
  saveStoredSession,
} from "@/lib/authStorage";
import {
  ADMIN_DASHBOARD_PATH,
  DRIVER_DASHBOARD_PATH,
  getPreferredDashboardPath,
  hasAnyRole,
  LOGIN_PATH,
  OPERATOR_DASHBOARD_PATH,
} from "@/lib/roleRouting";
import LoginPage from "@/pages/LoginPage";
import AuthorityAdminDashboardPage from "@/pages/role-dashboards/AuthorityAdminDashboardPage";
import AuthorityOperatorDashboardPage from "@/pages/role-dashboards/AuthorityOperatorDashboardPage";
import DriverDashboardPage from "@/pages/role-dashboards/DriverDashboardPage";
import type { LoginResponse, UserSummaryResponse } from "@/types/auth";

type ProtectedRoleRouteProps = {
  session: LoginResponse | null;
  user: UserSummaryResponse | null;
  requiredRoles: string[];
  children: React.ReactNode;
};

function ProtectedRoleRoute({
  session,
  user,
  requiredRoles,
  children,
}: ProtectedRoleRouteProps) {
  if (!session || !user) {
    return <Navigate to={LOGIN_PATH} replace />;
  }

  if (!hasAnyRole(user.role_keys, requiredRoles)) {
    return <Navigate to={getPreferredDashboardPath(user.role_keys)} replace />;
  }

  return <>{children}</>;
}

function App() {
  const [booting, setBooting] = useState(true);
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [session, setSession] = useState<LoginResponse | null>(null);
  const [user, setUser] = useState<UserSummaryResponse | null>(null);

  const apiBaseUrl = getApiBaseUrl();

  const resetAuthState = () => {
    clearStoredSession();
    setSession(null);
    setUser(null);
  };

  const refreshSessionAndFetchUser = async (
    currentSession: LoginResponse,
  ): Promise<{ session: LoginResponse; user: UserSummaryResponse }> => {
    const refreshed = await refreshLoginSession({
      refresh_token: currentSession.refresh_token,
    });
    const me = await fetchCurrentUser(refreshed.access_token);
    return { session: refreshed, user: me };
  };

  useEffect(() => {
    const bootstrap = async () => {
      const stored = loadStoredSession();
      if (!stored) {
        setBooting(false);
        return;
      }

      try {
        const me = await fetchCurrentUser(stored.access_token);
        setSession(stored);
        setUser(me);
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 401) {
          try {
            const refreshedPayload = await refreshSessionAndFetchUser(stored);
            saveStoredSession(refreshedPayload.session);
            setSession(refreshedPayload.session);
            setUser(refreshedPayload.user);
          } catch {
            resetAuthState();
          }
        } else {
          resetAuthState();
        }
      } finally {
        setBooting(false);
      }
    };

    void bootstrap();
  }, []);

  const handleLogin = async (email: string, password: string) => {
    setIsSubmittingLogin(true);
    setLoginError("");

    try {
      const loginPayload = await loginWithPassword({ email, password });
      const me = await fetchCurrentUser(loginPayload.access_token);
      saveStoredSession(loginPayload);
      setSession(loginPayload);
      setUser(me);
    } catch (error) {
      setLoginError(extractApiErrorMessage(error, "Login failed"));
      resetAuthState();
    } finally {
      setIsSubmittingLogin(false);
    }
  };

  const handleLogout = () => {
    setLoginError("");
    resetAuthState();
  };

  if (booting) {
    return (
      <main className="min-h-screen bg-linear-to-b from-emerald-50 via-cyan-50 to-sky-100 px-6 py-12">
        <div className="mx-auto max-w-5xl space-y-4">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      </main>
    );
  }
  const preferredDashboard = user
    ? getPreferredDashboardPath(user.role_keys)
    : LOGIN_PATH;

  return (
    <Routes>
      <Route
        path={LOGIN_PATH}
        element={
          session && user ? (
            <Navigate to={preferredDashboard} replace />
          ) : (
            <LoginPage
              onLogin={handleLogin}
              isSubmitting={isSubmittingLogin}
              errorMessage={loginError}
              apiBaseUrl={apiBaseUrl}
            />
          )
        }
      />

      <Route
        path={ADMIN_DASHBOARD_PATH}
        element={
          <ProtectedRoleRoute
            session={session}
            user={user}
            requiredRoles={["authority_admin"]}
          >
            <AuthorityAdminDashboardPage
              user={user as UserSummaryResponse}
              session={session as LoginResponse}
              onLogout={handleLogout}
            />
          </ProtectedRoleRoute>
        }
      />

      <Route
        path={`${ADMIN_DASHBOARD_PATH}/:section`}
        element={
          <ProtectedRoleRoute
            session={session}
            user={user}
            requiredRoles={["authority_admin"]}
          >
            <AuthorityAdminDashboardPage
              user={user as UserSummaryResponse}
              session={session as LoginResponse}
              onLogout={handleLogout}
            />
          </ProtectedRoleRoute>
        }
      />

      <Route
        path={OPERATOR_DASHBOARD_PATH}
        element={
          <ProtectedRoleRoute
            session={session}
            user={user}
            requiredRoles={["authority_operator"]}
          >
            <AuthorityOperatorDashboardPage
              user={user as UserSummaryResponse}
              session={session as LoginResponse}
              onLogout={handleLogout}
              apiBaseUrl={apiBaseUrl}
            />
          </ProtectedRoleRoute>
        }
      />

      <Route
        path={`${OPERATOR_DASHBOARD_PATH}/:section`}
        element={
          <ProtectedRoleRoute
            session={session}
            user={user}
            requiredRoles={["authority_operator"]}
          >
            <AuthorityOperatorDashboardPage
              user={user as UserSummaryResponse}
              session={session as LoginResponse}
              onLogout={handleLogout}
              apiBaseUrl={apiBaseUrl}
            />
          </ProtectedRoleRoute>
        }
      />

      <Route
        path={DRIVER_DASHBOARD_PATH}
        element={
          <ProtectedRoleRoute
            session={session}
            user={user}
            requiredRoles={["driver"]}
          >
            <DriverDashboardPage
              user={user as UserSummaryResponse}
              session={session as LoginResponse}
              onLogout={handleLogout}
            />
          </ProtectedRoleRoute>
        }
      />

      <Route
        path={`${DRIVER_DASHBOARD_PATH}/:section`}
        element={
          <ProtectedRoleRoute
            session={session}
            user={user}
            requiredRoles={["driver"]}
          >
            <DriverDashboardPage
              user={user as UserSummaryResponse}
              session={session as LoginResponse}
              onLogout={handleLogout}
            />
          </ProtectedRoleRoute>
        }
      />

      <Route
        path="/"
        element={
          <Navigate
            to={session && user ? preferredDashboard : LOGIN_PATH}
            replace
          />
        }
      />

      <Route
        path="*"
        element={
          <Navigate
            to={session && user ? preferredDashboard : LOGIN_PATH}
            replace
          />
        }
      />
    </Routes>
  );
}

export default App;

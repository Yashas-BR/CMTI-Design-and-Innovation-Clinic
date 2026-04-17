import { useMemo, useState } from "react";
import { LockKeyhole, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type LoginPageProps = {
  onLogin: (email: string, password: string) => Promise<void>;
  isSubmitting: boolean;
  errorMessage: string;
  apiBaseUrl: string;
};

function LoginPage({
  onLogin,
  isSubmitting,
  errorMessage,
  apiBaseUrl,
}: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const canSubmit = useMemo(() => {
    return email.trim().length > 3 && password.length > 0 && !isSubmitting;
  }, [email, isSubmitting, password]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onLogin(email.trim(), password);
  };

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_20%_20%,#c7f9f1_0%,#eafdf8_36%,#eff8ff_65%,#f8fafc_100%)] px-4 py-10 sm:py-14">
      <div className="absolute -left-24 top-8 h-80 w-80 rounded-full bg-emerald-200/30 blur-3xl" />
      <div className="absolute -right-32 bottom-0 h-96 w-96 rounded-full bg-cyan-200/35 blur-3xl" />

      <div className="relative mx-auto grid w-full max-w-6xl gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="space-y-6 rounded-3xl border border-white/70 bg-white/70 p-6 shadow-xl backdrop-blur sm:p-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
            <ShieldCheck className="h-3.5 w-3.5" />
            Backend-Aligned Auth Gateway
          </div>

          <h1 className="text-3xl font-semibold leading-tight text-slate-900 sm:text-4xl">
            Smart Waste Dashboard Access
          </h1>

          <p className="max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
            Sign in using your organization credentials. This frontend is wired
            to the FastAPI auth model: bearer access token, refresh token
            rotation, organization scoping, and strict role-based access.
          </p>

          <div className="grid gap-3 text-sm text-slate-700 sm:grid-cols-3">
            <div className="rounded-2xl border border-emerald-100 bg-white/80 p-4">
              <p className="font-semibold text-slate-900">authority_admin</p>
              <p className="mt-1 text-xs text-slate-600">
                Full authority administration
              </p>
            </div>
            <div className="rounded-2xl border border-cyan-100 bg-white/80 p-4">
              <p className="font-semibold text-slate-900">authority_operator</p>
              <p className="mt-1 text-xs text-slate-600">
                Operational authority access
              </p>
            </div>
            <div className="rounded-2xl border border-sky-100 bg-white/80 p-4">
              <p className="font-semibold text-slate-900">driver</p>
              <p className="mt-1 text-xs text-slate-600">
                Driver-scoped workflow access
              </p>
            </div>
          </div>
        </section>

        <Card className="border-white/80 bg-white/80 shadow-xl backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl text-slate-900">
              <LockKeyhole className="h-5 w-5 text-emerald-700" />
              Sign In
            </CardTitle>
            <CardDescription>
              Endpoint base:{" "}
              <span className="font-medium text-slate-700">{apiBaseUrl}</span>
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="user@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={isSubmitting}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={isSubmitting}
                  required
                />
              </div>

              {errorMessage && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {errorMessage}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={!canSubmit}>
                {isSubmitting ? "Signing in..." : "Sign In"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

export default LoginPage;

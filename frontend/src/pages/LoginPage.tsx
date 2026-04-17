import { useState } from 'react'
import axios from 'axios'
import { ShieldCheck, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type LoginPageProps = {
  onLogin: (token: string, username: string, role: string) => void
  apiUrl: string
  authError: string
}

function LoginPage({ onLogin, apiUrl, authError }: LoginPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleRole, setGoogleRole] = useState('Driver')

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await axios.post<{ token: string; username: string; role: string }>(
        `${apiUrl}/auth/login`,
        {
          username,
          password,
        },
      )
      onLogin(response.data.token, response.data.username, response.data.role)
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError((err.response?.data as { error?: string })?.error ?? 'Login failed')
      } else {
        setError('Login failed')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setError('')
    setLoading(true)

    try {
      const response = await axios.post<{ auth_url?: string }>(`${apiUrl}/auth/google/url`, {
        role: googleRole,
      })

      const authUrl = response.data.auth_url
      if (!authUrl) {
        setError('Google sign-in URL was not returned by backend.')
        setLoading(false)
        return
      }

      window.location.href = authUrl
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError((err.response?.data as { error?: string })?.error ?? 'Google sign-in is not configured yet.')
      } else {
        setError('Google sign-in is not configured yet.')
      }
      setLoading(false)
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_15%_20%,#ccfbf1_0%,#f0fdfa_36%,#ecfeff_63%,#f8fafc_100%)] px-4 py-12">
      <div className="absolute -left-28 top-20 h-80 w-80 rounded-full bg-emerald-200/35 blur-3xl" />
      <div className="absolute -right-24 bottom-10 h-96 w-96 rounded-full bg-sky-200/40 blur-3xl" />

      <div className="relative mx-auto grid max-w-5xl items-center gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="space-y-5 rounded-3xl border border-white/60 bg-white/50 p-8 shadow-xl backdrop-blur">
          <div className="inline-flex items-center gap-2 rounded-full border bg-white/80 px-3 py-1 text-xs font-medium text-emerald-800">
            <Sparkles className="h-3.5 w-3.5" />
            Smart Bin Fill Collection Routing
          </div>
          <h1 className="text-4xl font-semibold leading-tight text-slate-900">
            Calm oversight for faster, cleaner waste collection.
          </h1>
          <p className="max-w-xl text-sm leading-6 text-slate-600">
            Monitor fill levels, prioritize critical bins, and generate optimized routes from a
            single operations dashboard built for municipal teams.
          </p>
          <div className="grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
            <div className="rounded-2xl border bg-white/70 p-4">Real-time bin health with clear priority indicators.</div>
            <div className="rounded-2xl border bg-white/70 p-4">Dispatch planning tuned to distance and urgency.</div>
          </div>
        </section>

        <Card className="border-white/70 bg-white/75 shadow-xl backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <ShieldCheck className="h-5 w-5 text-emerald-700" />
              InfraSense Login
            </CardTitle>
            <CardDescription>Secure access to your smart waste operations console.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs defaultValue="credentials" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="credentials">Credentials</TabsTrigger>
                <TabsTrigger value="google">Google Sign-In</TabsTrigger>
              </TabsList>

              <TabsContent value="credentials" className="mt-4 space-y-4">
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="username">Username</Label>
                    <Input
                      id="username"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder="Enter username"
                      disabled={loading}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Enter password"
                      disabled={loading}
                    />
                  </div>

                  {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
                  {authError && (
                    <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      Google login error: {authError}
                    </p>
                  )}

                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? 'Logging in...' : 'Login'}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="google" className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label>Sign in as</Label>
                  <Select value={googleRole} onValueChange={setGoogleRole} disabled={loading}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Authority">Authority</SelectItem>
                      <SelectItem value="Driver">Driver</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
                {authError && (
                  <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    Google login error: {authError}
                  </p>
                )}

                <Button type="button" className="w-full" onClick={handleGoogleSignIn} disabled={loading}>
                  {loading ? 'Redirecting to Google...' : 'Continue with Google'}
                </Button>

                <p className="text-xs leading-5 text-muted-foreground">
                  Configure backend Google OAuth environment variables:
                  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.
                </p>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

export default LoginPage

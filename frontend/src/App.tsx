import { useEffect, useState } from 'react'
import axios from 'axios'
import LoginPage from '@/pages/LoginPage'
import DashboardPage from '@/pages/DashboardPage'
import { Skeleton } from '@/components/ui/skeleton'

type User = {
  username: string
  role: string
}

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api'

function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'))
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const tokenFromQuery = params.get('token')
    const errorFromQuery = params.get('error')

    if (tokenFromQuery) {
      localStorage.setItem('token', tokenFromQuery)
      setToken(tokenFromQuery)
      window.history.replaceState({}, document.title, window.location.pathname)
    }

    if (errorFromQuery) {
      setAuthError(errorFromQuery.replaceAll('_', ' '))
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }, [])

  useEffect(() => {
    if (!token) {
      setLoading(false)
      return
    }

    const verifyToken = async () => {
      try {
        const response = await axios.post<User>(
          `${API_URL}/auth/verify`,
          {},
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        )
        setUser(response.data)
      } catch {
        localStorage.removeItem('token')
        setToken(null)
      } finally {
        setLoading(false)
      }
    }

    void verifyToken()
  }, [token])

  const handleLogin = (nextToken: string, username: string, role: string) => {
    localStorage.setItem('token', nextToken)
    setToken(nextToken)
    setUser({ username, role })
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    setToken(null)
    setUser(null)
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-emerald-50 via-teal-50 to-cyan-100 px-6 py-12">
        <div className="mx-auto max-w-5xl space-y-4">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      </main>
    )
  }

  if (!token || !user) {
    return <LoginPage onLogin={handleLogin} apiUrl={API_URL} authError={authError} />
  }

  return (
    <DashboardPage user={user} onLogout={handleLogout} apiUrl={API_URL} token={token} />
  )
}

export default App

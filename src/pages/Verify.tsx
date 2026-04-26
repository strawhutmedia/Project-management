import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'

export default function Verify() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const token = params.get('token')
    if (!token) {
      setError('Missing token')
      return
    }
    ;(async () => {
      try {
        await api.verify(token)
        await refresh()
        navigate('/', { replace: true })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'verification failed')
      }
    })()
  }, [params, navigate, refresh])

  return (
    <div className="min-h-screen flex items-center justify-center px-5 text-center">
      {error ? (
        <div className="space-y-3">
          <h1 className="font-display text-3xl text-urgent">Sign-in failed</h1>
          <p className="text-muted text-sm">{error}</p>
          <a href="/login" className="inline-block text-stage-mastering underline">
            Try again
          </a>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-3xl">✨</div>
          <p className="text-muted">Signing you in…</p>
        </div>
      )}
    </div>
  )
}

// Dedicated per-show outreach page. This is where you actually work
// on a show's guest campaign — template editor, prospects, sentence
// generator, send button. Reached from the outreach hub.
//
// Route: /admin/outreach/shows/:projectId

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type ApiProject } from '../api'
import { useAuth } from '../auth'
import OutreachSection from '../components/OutreachSection'

export default function OutreachShowPage() {
  const { projectId } = useParams()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [project, setProject] = useState<ApiProject | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isAdmin || !projectId) return
    let cancelled = false
    api.project(projectId).then((r) => {
      if (cancelled) return
      if (r.project.kind !== 'podcast') {
        setError('Guest outreach is only available for podcast shows.')
        return
      }
      setProject(r.project)
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'failed to load show')
    })
    return () => { cancelled = true }
  }, [projectId, isAdmin])

  if (!isAdmin) {
    return (
      <div className="text-muted text-sm">
        Admins only. <Link to="/" className="underline">Back to dashboard</Link>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-3">
        <p className="text-urgent text-sm">{error}</p>
        <Link to="/admin/outreach" className="text-sm underline text-muted hover:text-text">
          ← Back to outreach hub
        </Link>
      </div>
    )
  }

  if (!project) return <p className="text-muted text-sm">Loading…</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link
          to="/admin/outreach"
          className="text-[11px] uppercase tracking-wider text-muted hover:text-text border border-line rounded-full px-2.5 py-1"
        >
          ← All shows
        </Link>
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted font-bold">
          Guest outreach
        </div>
      </div>
      <div>
        <h1 className="text-3xl font-bold">{project.name}</h1>
        {project.subtitle && <p className="text-sm text-muted mt-1">{project.subtitle}</p>}
      </div>

      <OutreachSection projectId={project.id} />
    </div>
  )
}

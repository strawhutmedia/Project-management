import { Link, Navigate, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api, type ApiProject } from '../api'
import { useAuth } from '../auth'
import Stripboard from '../components/Stripboard'

export default function StripboardPage() {
  const { projectId } = useParams()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [project, setProject] = useState<ApiProject | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) return
    api.project(projectId)
      .then(({ project }) => setProject(project))
      .catch((err) => setError(err instanceof Error ? err.message : 'failed to load'))
  }, [projectId])

  // Stripboard only exists for film projects, so anytime this page is
  // mounted we want the light paper theme. Effect runs above the early
  // returns to keep React's hook order stable.
  useEffect(() => {
    if (project?.kind === 'film') {
      document.body.setAttribute('data-theme', 'film')
      return () => { document.body.removeAttribute('data-theme') }
    }
  }, [project?.kind])

  if (error) {
    return (
      <div className="text-muted">
        {error}.{' '}
        <Link to="/" className="underline">Back to dashboard</Link>
      </div>
    )
  }
  if (!project) return <p className="text-muted text-sm">Loading…</p>

  if (project.kind !== 'film') {
    return <Navigate to={`/projects/${project.id}`} replace />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-sm">
        <Link
          to={`/projects/${project.id}`}
          className="text-muted hover:text-text transition"
        >
          ← {project.name}
        </Link>
      </div>
      <Stripboard projectId={project.id} isAdmin={isAdmin} projectName={project.name} />
    </div>
  )
}

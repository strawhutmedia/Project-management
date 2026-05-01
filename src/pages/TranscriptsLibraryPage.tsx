// Project-wide transcripts library. Read-only summary of every transcript
// in the project, grouped by episode. Per-episode editing happens on the
// episode (song) page; this page is just a fast browse + jump-in.
import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { api, type ApiProject, type ApiTranscript } from '../api'

export default function TranscriptsLibraryPage() {
  const { projectId } = useParams()
  const [project, setProject] = useState<ApiProject | null>(null)
  const [transcripts, setTranscripts] = useState<ApiTranscript[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) return
    Promise.all([api.project(projectId), api.transcripts(projectId)])
      .then(([{ project }, { transcripts }]) => {
        setProject(project)
        setTranscripts(transcripts)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'failed to load'))
  }, [projectId])

  if (error) {
    return (
      <div className="text-muted">
        {error}.{' '}
        <Link to="/" className="underline">Back to dashboard</Link>
      </div>
    )
  }
  if (!project || !transcripts) return <p className="text-muted text-sm">Loading…</p>
  if (project.kind !== 'podcast') {
    return <Navigate to={`/projects/${project.id}`} replace />
  }

  // Group transcripts by song (episode), with an "Unassigned" bucket for any
  // legacy ones that aren't tied to an episode.
  const songsById = new Map(project.songs.map((s) => [s.id, s]))
  const grouped = new Map<string | null, ApiTranscript[]>()
  for (const t of transcripts) {
    const key = t.songId ?? null
    const arr = grouped.get(key) ?? []
    arr.push(t)
    grouped.set(key, arr)
  }
  const orderedKeys: Array<string | null> = [
    ...project.songs.map((s) => s.id).filter((id) => grouped.has(id)),
    ...(grouped.has(null) ? [null] : []),
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-sm flex-wrap">
        <Link to={`/projects/${project.id}`} className="text-muted hover:text-text">
          ← {project.name}
        </Link>
      </div>

      <header className="rounded-2xl border border-line bg-panel/60 p-5">
        <div className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">📝 Transcripts</div>
        <h1 className="font-display text-3xl mt-1">All transcripts</h1>
        <p className="text-[11px] text-muted/80 mt-2">
          {transcripts.length} total · grouped by episode. Tap into an episode to add a new one or
          edit an existing transcript.
        </p>
      </header>

      {transcripts.length === 0 ? (
        <p className="text-muted/70 text-sm italic py-8 text-center border border-dashed border-line/60 rounded-2xl">
          No transcripts yet. Open an episode to start one.
        </p>
      ) : (
        <div className="space-y-4">
          {orderedKeys.map((songId) => {
            const ts = grouped.get(songId) ?? []
            const song = songId ? songsById.get(songId) : null
            return (
              <section key={String(songId)} className="rounded-2xl border border-line bg-panel/40 p-4 space-y-2">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  {song ? (
                    <Link
                      to={`/projects/${project.id}/songs/${song.id}`}
                      className="text-sm font-bold hover:text-stage-mastering"
                    >
                      🎙️ {song.title}
                      {song.subtitle && <span className="text-muted font-normal"> · {song.subtitle}</span>}
                    </Link>
                  ) : (
                    <span className="text-sm font-bold text-muted">⚠ Unassigned (no episode)</span>
                  )}
                  <span className="text-[10px] uppercase tracking-wider text-muted">
                    {ts.length} {ts.length === 1 ? 'transcript' : 'transcripts'}
                  </span>
                </div>
                <ul className="space-y-1">
                  {ts.map((t) => (
                    <li key={t.id}>
                      <Link
                        to={`/projects/${project.id}/transcripts/${t.id}`}
                        className="flex items-center gap-3 text-xs text-text hover:bg-ink/40 rounded-lg px-2 py-1.5"
                      >
                        <span className="flex-1 truncate">{t.fileName}</span>
                        <span className={`text-[10px] uppercase tracking-wider font-bold shrink-0 ${
                          t.status === 'done' ? 'text-stage-stems' :
                          t.status === 'failed' ? 'text-urgent' :
                          'text-stage-mastering'
                        }`}>
                          {t.status === 'transcribing' ? 'Transcribing…' : t.status}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

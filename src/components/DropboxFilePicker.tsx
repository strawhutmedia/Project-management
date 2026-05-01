// File-mode Dropbox picker for transcription. Mirrors DropboxFolderPicker
// but shows files alongside folders, with extension filtering.
import { useEffect, useState } from 'react'
import { api, type ApiDropboxEntry } from '../api'

type Props = {
  initialPath?: string
  acceptExtensions?: string[]
  title?: string
  onSelect: (path: string, name: string, size?: number) => void
  onCancel: () => void
}

const MEDIA_EXT = ['.mp4', '.m4a', '.mp3', '.mov', '.wav', '.webm', '.ogg', '.flac', '.aac']

export default function DropboxFilePicker({
  initialPath = '',
  acceptExtensions = MEDIA_EXT,
  title = 'Pick a file',
  onSelect,
  onCancel,
}: Props) {
  const [currentPath, setCurrentPath] = useState(initialPath || '')
  const [entries, setEntries] = useState<ApiDropboxEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load(path: string) {
    setEntries(null)
    setError(null)
    try {
      const apiPath = path === '' || path === '/' ? '/' : path
      const { entries } = await api.dropboxList(apiPath)
      setEntries(entries)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed'
      if (msg === 'not_connected') {
        setError("Dropbox isn't connected. Admin can connect from Settings.")
      } else if (msg.startsWith('not_found')) {
        setError("This folder doesn't exist in Dropbox.")
      } else {
        setError(msg)
      }
      setEntries([])
    }
  }

  useEffect(() => { void load(currentPath) }, [currentPath])

  function navigateUp() {
    if (!currentPath || currentPath === '/' || currentPath === '') return
    const parent = currentPath.replace(/\/[^/]+\/?$/, '')
    setCurrentPath(parent || '')
  }

  function isAcceptedFile(name: string): boolean {
    const lower = name.toLowerCase()
    return acceptExtensions.some((ext) => lower.endsWith(ext))
  }

  const folders = (entries ?? []).filter((e) => e.type === 'folder')
  const files = (entries ?? []).filter((e) => e.type === 'file' && isAcceptedFile(e.name))

  const displayPath = currentPath || '/ (Dropbox root)'

  function fmtSize(bytes: number | undefined): string {
    if (!bytes) return ''
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
    if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`
    return `${bytes} B`
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/80 backdrop-blur-sm p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-panel/95 backdrop-blur-md shadow-2xl flex flex-col max-h-[85dvh]">
        <div className="flex items-center justify-between p-5 border-b border-line">
          <h2 className="font-display text-2xl">{title}</h2>
          <button onClick={onCancel} className="text-muted hover:text-text text-xl leading-none">
            ✕
          </button>
        </div>

        <div className="px-5 py-3 border-b border-line flex items-center justify-between gap-2 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-muted font-bold mb-0.5">Current</div>
            <div className="text-sm font-mono break-all">{displayPath}</div>
          </div>
          {currentPath && (
            <button
              onClick={navigateUp}
              className="text-[11px] uppercase tracking-wider text-stage-stems border border-stage-stems/40 rounded-full px-2.5 py-1 hover:bg-stage-stems/10"
            >
              ← Up
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {error ? (
            <p className="text-sm text-muted py-6 text-center border border-dashed border-line rounded-xl">{error}</p>
          ) : !entries ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : folders.length === 0 && files.length === 0 ? (
            <p className="text-sm text-muted text-center py-6">
              No folders or media files here. Accepted: {acceptExtensions.join(', ')}
            </p>
          ) : (
            <>
              {folders.map((e) => (
                <button
                  key={e.path}
                  onClick={() => setCurrentPath(e.path)}
                  className="w-full text-left text-sm flex items-center gap-2 rounded-lg border border-line bg-ink/30 px-3 py-2 hover:bg-ink/60"
                >
                  <span>📁</span>
                  <span className="flex-1 truncate">{e.name}</span>
                  <span className="text-muted text-xs">→</span>
                </button>
              ))}
              {files.map((e) => (
                <button
                  key={e.path}
                  onClick={() => onSelect(e.path, e.name, e.size)}
                  className="w-full text-left text-sm flex items-center gap-2 rounded-lg border border-line bg-stage-mastering/5 hover:bg-stage-mastering/15 px-3 py-2 transition"
                >
                  <span>🎬</span>
                  <span className="flex-1 truncate">{e.name}</span>
                  <span className="text-muted text-xs font-mono">{fmtSize(e.size)}</span>
                </button>
              ))}
            </>
          )}
        </div>

        <div className="flex gap-2 p-5 border-t border-line">
          <button
            onClick={onCancel}
            className="flex-1 rounded-xl border border-line text-muted hover:text-text font-bold uppercase tracking-wider text-xs px-4 py-2.5"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

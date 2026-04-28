import { useEffect, useState } from 'react'
import { api, type ApiDropboxEntry } from '../api'

type Props = {
  initialPath?: string
  onSelect: (path: string) => void
  onCancel: () => void
}

export default function DropboxFolderPicker({ initialPath = '', onSelect, onCancel }: Props) {
  const [currentPath, setCurrentPath] = useState(initialPath || '')
  const [entries, setEntries] = useState<ApiDropboxEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  async function load(path: string) {
    setEntries(null)
    setError(null)
    try {
      const apiPath = path === '' || path === '/' ? '/' : path
      const { entries } = await api.dropboxList(apiPath)
      setEntries(entries.filter((e) => e.type === 'folder'))
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

  useEffect(() => {
    void load(currentPath)
  }, [currentPath])

  function navigateUp() {
    if (!currentPath || currentPath === '/' || currentPath === '') return
    const parent = currentPath.replace(/\/[^/]+\/?$/, '')
    setCurrentPath(parent || '')
  }

  async function createSubfolder() {
    const name = newFolderName.trim()
    if (!name) return
    const path = `${(currentPath || '').replace(/\/$/, '')}/${name}`
    setCreating(true)
    try {
      await api.dropboxCreateFolder(path)
      setNewFolderName('')
      setShowNewFolder(false)
      await load(currentPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create folder')
    } finally {
      setCreating(false)
    }
  }

  const displayPath = currentPath || '/ (Dropbox root)'

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/80 backdrop-blur-sm p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-panel/95 backdrop-blur-md shadow-2xl flex flex-col max-h-[85dvh]">
        <div className="flex items-center justify-between p-5 border-b border-line">
          <h2 className="font-display text-2xl">Pick a folder</h2>
          <button onClick={onCancel} className="text-muted hover:text-text text-xl leading-none">
            ✕
          </button>
        </div>

        <div className="px-5 py-3 border-b border-line flex items-center justify-between gap-2 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-muted font-bold mb-0.5">
              Current
            </div>
            <div className="text-sm font-mono break-all">{displayPath}</div>
          </div>
          <div className="flex gap-1.5">
            {currentPath && (
              <button
                onClick={navigateUp}
                className="text-[11px] uppercase tracking-wider text-stage-stems border border-stage-stems/40 rounded-full px-2.5 py-1 hover:bg-stage-stems/10"
              >
                ← Up
              </button>
            )}
            <button
              onClick={() => setShowNewFolder((v) => !v)}
              className="text-[11px] uppercase tracking-wider text-stage-tracking border border-stage-tracking/40 rounded-full px-2.5 py-1 hover:bg-stage-tracking/10"
            >
              + New
            </button>
          </div>
        </div>

        {showNewFolder && (
          <div className="px-5 py-3 border-b border-line flex items-center gap-2">
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createSubfolder()
                if (e.key === 'Escape') setShowNewFolder(false)
              }}
              placeholder="New folder name"
              autoFocus
              className="flex-1 rounded-lg bg-ink/40 border border-line text-text px-2 py-1.5 outline-none text-sm focus:border-stage-mastering"
            />
            <button
              onClick={() => void createSubfolder()}
              disabled={!newFolderName.trim() || creating}
              className="rounded-lg bg-stage-tracking/20 border border-stage-tracking/40 text-stage-tracking font-bold text-xs px-3 py-1.5 disabled:opacity-50"
            >
              {creating ? '…' : 'Create'}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3">
          {error ? (
            <p className="text-sm text-muted py-6 text-center border border-dashed border-line rounded-xl">
              {error}
            </p>
          ) : !entries ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted text-center py-6">
              No subfolders here. Use "Select this folder" below or "+ New" to create one.
            </p>
          ) : (
            <ul className="space-y-1">
              {entries.map((e) => (
                <li key={e.path}>
                  <button
                    onClick={() => setCurrentPath(e.path)}
                    className="w-full text-left text-sm flex items-center gap-2 rounded-lg border border-line bg-ink/30 px-3 py-2 hover:bg-ink/60"
                  >
                    <span>📁</span>
                    <span className="flex-1 truncate">{e.name}</span>
                    <span className="text-muted text-xs">→</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex gap-2 p-5 border-t border-line">
          <button
            onClick={onCancel}
            className="flex-1 rounded-xl border border-line text-muted hover:text-text font-bold uppercase tracking-wider text-xs px-4 py-2.5"
          >
            Cancel
          </button>
          <button
            onClick={() => onSelect(currentPath)}
            className="flex-1 rounded-xl bg-gradient-to-r from-stage-stems to-stage-mixing text-white font-bold uppercase tracking-wider text-xs px-4 py-2.5"
          >
            Select this folder
          </button>
        </div>
      </div>
    </div>
  )
}

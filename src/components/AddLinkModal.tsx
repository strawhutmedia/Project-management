import { useEffect, useState } from 'react'
import { api, type ApiDropboxEntry } from '../api'

type Props = {
  songId: string
  songFolder: string | null
  onClose: () => void
  onAdded: () => void
}

export default function AddLinkModal({ songId, songFolder, onClose, onAdded }: Props) {
  const [tab, setTab] = useState<'dropbox' | 'url'>(songFolder ? 'dropbox' : 'url')
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Dropbox tab state
  const [currentPath, setCurrentPath] = useState(songFolder ?? '')
  const [entries, setEntries] = useState<ApiDropboxEntry[] | null>(null)
  const [dbError, setDbError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<ApiDropboxEntry | null>(null)
  const [resolvingShare, setResolvingShare] = useState(false)

  useEffect(() => {
    if (tab !== 'dropbox' || !currentPath) return
    setEntries(null)
    setDbError(null)
    api
      .dropboxList(currentPath)
      .then(({ entries }) => setEntries(entries))
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'failed'
        setDbError(msg.startsWith('not_found') ? "Folder doesn't exist." : msg)
        setEntries([])
      })
  }, [tab, currentPath])

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      let finalUrl = url.trim()
      let finalLabel = label.trim()

      if (tab === 'dropbox') {
        if (!selectedFile) {
          setError('Pick a file first')
          setSubmitting(false)
          return
        }
        if (!finalLabel) finalLabel = selectedFile.name
        setResolvingShare(true)
        const { url: shareUrl } = await api.dropboxShareLink(selectedFile.path)
        finalUrl = shareUrl
        setResolvingShare(false)
      } else {
        if (!finalUrl) {
          setError('URL required')
          setSubmitting(false)
          return
        }
        if (!finalLabel) finalLabel = 'Link'
      }

      await api.addLink(songId, { label: finalLabel, url: finalUrl })
      onAdded()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setSubmitting(false)
      setResolvingShare(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/80 backdrop-blur-sm p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-panel/95 backdrop-blur-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-line">
          <h2 className="font-display text-2xl">Add link</h2>
          <button onClick={onClose} className="text-muted hover:text-text text-xl leading-none">
            ✕
          </button>
        </div>

        <div className="flex border-b border-line">
          <TabBtn active={tab === 'dropbox'} onClick={() => setTab('dropbox')} disabled={!songFolder}>
            📦 From Dropbox
          </TabBtn>
          <TabBtn active={tab === 'url'} onClick={() => setTab('url')}>
            🔗 Paste URL
          </TabBtn>
        </div>

        <div className="p-5 space-y-4 max-h-[55dvh] overflow-y-auto">
          {tab === 'dropbox' ? (
            <DropboxPicker
              currentPath={currentPath}
              setCurrentPath={setCurrentPath}
              entries={entries}
              error={dbError}
              selected={selectedFile}
              setSelected={setSelectedFile}
              rootPath={songFolder ?? ''}
            />
          ) : (
            <div className="space-y-3">
              <Field label="URL">
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://www.dropbox.com/... or https://wetransfer.com/..."
                  className="w-full rounded-xl bg-ink/40 border border-line text-text px-3 py-2.5 outline-none focus:border-stage-mastering text-sm"
                />
              </Field>
            </div>
          )}

          <Field label="Label">
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={
                tab === 'dropbox'
                  ? selectedFile?.name ?? 'Rough mix v1'
                  : 'Reference track'
              }
              className="w-full rounded-xl bg-ink/40 border border-line text-text px-3 py-2.5 outline-none focus:border-stage-mastering text-sm"
            />
          </Field>

          {error && <p className="text-urgent text-sm">{error}</p>}
        </div>

        <div className="flex gap-2 p-5 border-t border-line">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-line text-muted hover:text-text font-bold uppercase tracking-wider text-xs px-4 py-2.5"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || (tab === 'dropbox' && !selectedFile) || (tab === 'url' && !url.trim())}
            className="flex-1 rounded-xl bg-gradient-to-r from-stage-stems to-stage-mixing text-white font-bold uppercase tracking-wider text-xs px-4 py-2.5 disabled:opacity-50"
          >
            {submitting ? (resolvingShare ? 'Linking…' : 'Adding…') : 'Add link'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TabBtn({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 px-4 py-3 text-sm font-bold uppercase tracking-wider transition ${
        active
          ? 'text-stage-mastering border-b-2 border-stage-mastering'
          : 'text-muted hover:text-text'
      } ${disabled ? 'opacity-30 cursor-not-allowed' : ''}`}
    >
      {children}
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-[0.2em] text-muted font-bold mb-1.5">
        {label}
      </label>
      {children}
    </div>
  )
}

function DropboxPicker({
  currentPath,
  setCurrentPath,
  entries,
  error,
  selected,
  setSelected,
  rootPath,
}: {
  currentPath: string
  setCurrentPath: (p: string) => void
  entries: ApiDropboxEntry[] | null
  error: string | null
  selected: ApiDropboxEntry | null
  setSelected: (e: ApiDropboxEntry | null) => void
  rootPath: string
}) {
  if (!rootPath) {
    return (
      <p className="text-sm text-muted">
        No Dropbox folder set for this song. Set one first by editing the folder path on the song.
      </p>
    )
  }

  const atRoot = currentPath === rootPath
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px] text-muted">
        <span className="font-mono break-all">{currentPath}</span>
        {!atRoot && (
          <button
            onClick={() => {
              const parent = currentPath.replace(/\/[^/]+\/?$/, '')
              setCurrentPath(parent || rootPath)
              setSelected(null)
            }}
            className="text-stage-stems hover:underline whitespace-nowrap ml-2"
          >
            ← Up
          </button>
        )}
      </div>

      {error ? (
        <p className="text-sm text-muted py-4 text-center border border-dashed border-line rounded-xl">
          {error}
        </p>
      ) : !entries ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted py-4 text-center">Folder is empty.</p>
      ) : (
        <ul className="space-y-1.5">
          {entries.map((e) => (
            <li key={e.path}>
              {e.type === 'folder' ? (
                <button
                  onClick={() => {
                    setCurrentPath(e.path)
                    setSelected(null)
                  }}
                  className="w-full text-left text-sm flex items-center gap-2 rounded-lg border border-line bg-ink/30 px-3 py-2 hover:bg-ink/60"
                >
                  <span>📁</span>
                  <span className="flex-1 truncate">{e.name}</span>
                  <span className="text-muted text-xs">→</span>
                </button>
              ) : (
                <button
                  onClick={() => setSelected(e)}
                  className={`w-full text-left text-sm flex items-center gap-2 rounded-lg border px-3 py-2 transition ${
                    selected?.path === e.path
                      ? 'border-stage-mastering bg-stage-mastering/10'
                      : 'border-line bg-ink/30 hover:bg-ink/60'
                  }`}
                >
                  <span>{fileEmoji(e.name)}</span>
                  <span className="flex-1 truncate">{e.name}</span>
                  {selected?.path === e.path && (
                    <span className="text-stage-mastering text-xs">✓ selected</span>
                  )}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function fileEmoji(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['wav', 'mp3', 'aiff', 'flac', 'm4a', 'ogg'].includes(ext)) return '🎵'
  if (['mp4', 'mov', 'webm', 'avi'].includes(ext)) return '🎬'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return '🖼️'
  if (['pdf'].includes(ext)) return '📄'
  if (['doc', 'docx', 'txt', 'md'].includes(ext)) return '📝'
  if (['zip', 'rar', '7z'].includes(ext)) return '📦'
  return '📄'
}

// Per-show "brand assets" Dropbox folder. Admin picks a folder in
// Dropbox that already contains curated images for the show (guest
// headshots, logos, BTS photos, etc.). Slate lists the contents here
// so the team has them handy, and the social-plan generator passes
// the filename list to Claude so image_direction can reference real
// assets instead of describing photos to shoot from scratch.
import { useEffect, useState } from 'react'
import { api, type ApiProject } from '../api'
import DropboxFolderPicker from './DropboxFolderPicker'

type Asset = { name: string; dropboxPath: string; size: number | null; modified: string | null }

export default function BrandAssetsCard({
  project,
  onSaved,
}: {
  project: ApiProject
  onSaved: () => void | Promise<void>
}) {
  const folder = project.brandAssetsFolder ?? null
  const [picking, setPicking] = useState(false)
  const [assets, setAssets] = useState<Asset[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    if (!folder) { setAssets(null); return }
    setError(null)
    try {
      const r = await api.listBrandAssets(project.id)
      if (r.error) setError(r.error)
      setAssets(r.assets)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }
  useEffect(() => { void load() }, [folder, project.id])

  async function saveFolder(next: string | null) {
    setBusy(true); setError(null)
    try {
      await api.updateProject(project.id, { brandAssetsFolder: next })
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
      setPicking(false)
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-panel/60 p-6 space-y-4">
      <div>
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted font-bold">🖼 Brand Assets</h2>
        <p className="text-[11px] text-muted/80 mt-1 max-w-xl">
          Point Slate at a Dropbox folder that already holds this show's curated images —
          guest headshots, logos, BTS photos. Claude will reference these filenames in
          generated photo concepts so the team uses real assets, not invented shoot
          directions.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap text-[11px] font-mono">
        <span className="text-muted/70">Folder:</span>
        {folder ? (
          <>
            <span className="text-text break-all">{folder}</span>
            <button
              onClick={() => setPicking(true)}
              disabled={busy}
              className="text-[10px] uppercase tracking-wider font-bold text-stage-stems border border-stage-stems/40 rounded-full px-2 py-0.5 hover:bg-stage-stems/10"
            >
              📁 Change
            </button>
            <button
              onClick={() => void saveFolder(null)}
              disabled={busy}
              className="text-[10px] uppercase tracking-wider font-bold text-muted hover:text-urgent"
            >
              ✕ Clear
            </button>
          </>
        ) : (
          <>
            <em className="text-muted/60 not-italic">— not set —</em>
            <button
              onClick={() => setPicking(true)}
              disabled={busy}
              className="text-[10px] uppercase tracking-wider font-bold text-stage-stems border border-stage-stems/40 rounded-full px-2 py-0.5 hover:bg-stage-stems/10"
            >
              📁 Pick folder
            </button>
          </>
        )}
      </div>

      {error && <p className="text-urgent text-xs">{error}</p>}

      {folder && assets && (
        assets.length === 0 ? (
          <p className="text-muted/70 text-xs italic">
            No images in that folder yet. Drop JPGs/PNGs/WebPs into Dropbox at the path above
            and they'll show up here.
          </p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {assets.map((a) => (
              <div
                key={a.dropboxPath}
                className="aspect-square rounded-lg overflow-hidden bg-ink/60 border border-line/40 relative group"
                title={a.name}
              >
                <img
                  src={`/api/integrations/dropbox/file?path=${encodeURIComponent(a.dropboxPath)}`}
                  alt={a.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-x-0 bottom-0 bg-ink/80 text-[9px] text-text/90 px-1.5 py-0.5 truncate opacity-0 group-hover:opacity-100 transition">
                  {a.name}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {picking && (
        <DropboxFolderPicker
          initialPath={folder ?? ''}
          onCancel={() => setPicking(false)}
          onSelect={(p) => void saveFolder(p)}
        />
      )}
    </section>
  )
}

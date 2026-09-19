import { useEffect, useState } from 'react'
import { useAuth } from '../auth'
import { qaApi, type ApiQaBotLogEntry } from '../api'

// Admin-only home of the edit-machine Premiere bot: presence, activity log,
// and the one-paste installer. Deliberately OFF the QA page — Ryan
// (2026-09-19): the team uploads footage and approves; none of the
// technical machinery belongs on their sheet.

const card = 'rounded-2xl border border-line bg-panel/60'
const btnGhost =
  'inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-bold text-muted hover:text-text hover:border-stage-mixing/50 transition'

const fmtWhen = (iso: string | null): string => {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const BOT_LEVEL_CLS: Record<ApiQaBotLogEntry['level'], string> = {
  ok: 'text-stage-mixing',
  error: 'text-urgent',
  warn: 'text-stage-tracking',
  info: 'text-muted',
}

// The bot polls Slate every 60s, so a last-seen older than 5 minutes means
// the PC/task is down.
function botPresence(lastSeen: string | null): { label: string; cls: string } {
  if (!lastSeen) return { label: 'never connected', cls: 'border-line text-muted' }
  const ageMs = Date.now() - new Date(lastSeen).getTime()
  if (ageMs < 5 * 60 * 1000) return { label: 'edit PC online', cls: 'border-stage-mixing/50 text-stage-mixing' }
  return { label: `edit PC off — last seen ${fmtWhen(lastSeen)}`, cls: 'border-urgent/50 text-urgent' }
}

export default function EditBotPage() {
  const { user } = useAuth()
  const [log, setLog] = useState<ApiQaBotLogEntry[] | null>(null)
  const [lastSeen, setLastSeen] = useState<string | null>(null)
  const [installCmd, setInstallCmd] = useState<string | null>(null)
  const [installBusy, setInstallBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    const pull = async () => {
      try {
        const { log, botLastSeen } = await qaApi.botLog(50)
        if (alive) { setLog(log); setLastSeen(botLastSeen) }
      } catch { /* best-effort */ }
    }
    void pull()
    const t = setInterval(() => void pull(), 30_000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const mintInstall = async () => {
    setInstallBusy(true)
    try {
      const { command } = await qaApi.botSetupLink()
      setInstallCmd(command)
    } catch {
      setInstallCmd(null)
      window.alert("Couldn't create the install command — check that QA_SERVICE_TOKEN is set on Railway.")
    } finally {
      setInstallBusy(false)
    }
  }
  const copyInstall = async () => {
    if (!installCmd) return
    try {
      await navigator.clipboard.writeText(installCmd)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard blocked — the command is selectable */ }
  }

  if (user?.role !== 'admin') {
    return (
      <div className={`${card} p-8 text-center`}>
        <div className="text-3xl mb-2">🤖</div>
        <div className="font-bold">Edit bot is admin-only</div>
        <div className="text-sm text-muted mt-1">Nothing for you here — episodes assemble on their own after QA approval.</div>
      </div>
    )
  }

  const presence = botPresence(lastSeen)
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl">🤖 Edit bot</h1>
        <p className="text-sm text-muted mt-1">
          The machine that turns a QA approval into a Premiere project. It polls Slate every 60 seconds,
          holds while a human is in Premiere or RAM is tight, and reports everything here.
        </p>
      </div>

      <div className={`${card} p-4 flex items-center gap-3 flex-wrap`}>
        <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${presence.cls}`}>
          {presence.label}
        </span>
        {presence.label !== 'edit PC online' && (
          <button onClick={() => void mintInstall()} disabled={installBusy} className={btnGhost}>
            {installBusy ? 'Preparing…' : '⚙️ Install / repair on the edit PC (one paste)'}
          </button>
        )}
      </div>

      {installCmd && (
        <div className={`${card} p-4 space-y-2`}>
          <div className="text-xs text-text/90 font-bold">
            On the edit PC: open PowerShell (any window), paste this, hit Enter. Click <span className="text-stage-tracking">Yes</span> when
            Windows asks — the install continues in a new window and asks once for the editbot password. Works for 30 minutes.
          </div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-ink/60 px-2 py-1.5 text-[11px] select-all">
              {installCmd}
            </code>
            <button onClick={() => void copyInstall()} className={btnGhost}>{copied ? '✓ Copied' : 'Copy'}</button>
          </div>
        </div>
      )}

      <div className={`${card} p-4`}>
        <div className="text-[11px] uppercase tracking-wider font-bold text-muted mb-2">Activity</div>
        {(log ?? []).length === 0 && <div className="text-xs text-muted">Nothing logged by the bot yet.</div>}
        <div className="space-y-1 max-h-[32rem] overflow-y-auto">
          {(log ?? []).map((e, i) => (
            <div key={`${e.ts}-${i}`} className="flex items-start gap-2 text-xs">
              <span className="shrink-0 text-[11px] text-muted w-32">{fmtWhen(e.ts)}</span>
              <span className={`min-w-0 flex-1 ${BOT_LEVEL_CLS[e.level] ?? 'text-muted'}`}>{e.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

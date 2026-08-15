import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'

/**
 * Phone-as-remote for the teleprompter — a public, no-login, no-app page.
 * Open /r (type the 4-letter code) or scan the QR the prompter shows, which
 * lands you on /r/CODE. Big thumb buttons relay play/pause + speed to the
 * iPad running the prompter.
 */

type Conn = 'connecting' | 'connected' | 'notfound' | 'error'

export default function RemotePage() {
  const { code: codeParam } = useParams()
  const [code, setCode] = useState<string>((codeParam || '').toUpperCase())
  const [entered, setEntered] = useState<boolean>(Boolean(codeParam))
  const [conn, setConn] = useState<Conn>('connecting')
  const [flash, setFlash] = useState<string | null>(null)

  // Poll the pairing status so the operator knows the link is live.
  useEffect(() => {
    if (!entered || !code) return
    let alive = true
    const check = async () => {
      try {
        const { connected } = await api.teleprompterRemoteStatus(code)
        if (!alive) return
        setConn(connected ? 'connected' : 'notfound')
      } catch {
        if (alive) setConn('error')
      }
    }
    void check()
    const iv = setInterval(check, 4000)
    return () => {
      alive = false
      clearInterval(iv)
    }
  }, [entered, code])

  const send = useCallback(
    async (action: string, label: string) => {
      if (!code) return
      setFlash(label)
      window.setTimeout(() => setFlash(null), 350)
      try {
        if (navigator.vibrate) navigator.vibrate(12)
      } catch {
        /* ignore */
      }
      try {
        await api.teleprompterRemoteCmd(code, action)
        setConn('connected')
      } catch (e) {
        setConn(e instanceof Error && e.message.includes('no_channel') ? 'notfound' : 'error')
      }
    },
    [code],
  )

  if (!entered) {
    return <CodeEntry onSubmit={(c) => { setCode(c); setEntered(true); setConn('connecting') }} />
  }

  return (
    <div className="min-h-screen bg-ink text-text flex flex-col px-5 py-6 max-w-md mx-auto select-none">
      <header className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted">Teleprompter</p>
          <h1 className="font-display text-2xl">Remote · <span className="text-rainbow">{code}</span></h1>
        </div>
        <StatusDot conn={conn} />
      </header>

      {conn === 'notfound' && (
        <div className="rounded-xl border border-urgent/40 bg-urgent/10 text-sm px-4 py-3 mb-4">
          No prompter is listening on <b>{code}</b>. On the iPad, open the teleprompter → “📱 Phone remote” and make
          sure the code matches.{' '}
          <button className="underline" onClick={() => setEntered(false)}>
            Change code
          </button>
        </div>
      )}

      {/* Big play/pause */}
      <button
        onClick={() => send('playpause', '⏯')}
        className="w-full rounded-3xl bg-gradient-to-r from-stage-producing to-stage-mastering text-white font-black py-10 text-3xl uppercase tracking-wider active:scale-[0.98] transition shadow-lg mb-4"
      >
        ▶ / ❚❚ Play&nbsp;·&nbsp;Pause
      </button>

      {/* Speed */}
      <p className="text-[11px] uppercase tracking-wider text-muted mb-1 text-center">Speed</p>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <RemoteBtn onClick={() => send('slower', 'Slower')}>▼ Slower</RemoteBtn>
        <RemoteBtn onClick={() => send('faster', 'Faster')}>▲ Faster</RemoteBtn>
      </div>

      {/* Font size */}
      <p className="text-[11px] uppercase tracking-wider text-muted mb-1 text-center">Text size</p>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <RemoteBtn onClick={() => send('smaller', 'Smaller')}>A− Smaller</RemoteBtn>
        <RemoteBtn onClick={() => send('bigger', 'Bigger')}>A+ Bigger</RemoteBtn>
      </div>

      {/* Restart / start */}
      <div className="grid grid-cols-2 gap-3 mt-auto">
        <RemoteBtn onClick={() => send('restart', 'Restart')}>↺ Restart</RemoteBtn>
        <RemoteBtn onClick={() => send('start', 'To top')}>⤒ From top</RemoteBtn>
      </div>

      <div className="h-10 mt-4 grid place-items-center">
        {flash && <span className="text-stage-mastering text-sm">Sent: {flash}</span>}
      </div>

      <p className="text-[10px] text-muted text-center">
        Keep this page open while you record. No app needed.
      </p>
    </div>
  )
}

function CodeEntry({ onSubmit }: { onSubmit: (code: string) => void }) {
  const [val, setVal] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  const clean = val.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6)
  return (
    <div className="min-h-screen bg-ink text-text flex items-center justify-center px-6">
      <div className="w-full max-w-xs text-center">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted mb-1">Teleprompter</p>
        <h1 className="font-display text-4xl text-rainbow mb-2">Remote</h1>
        <p className="text-sm text-muted mb-5">
          Enter the code shown on the teleprompter (iPad → “📱 Phone remote”).
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (clean.length >= 4) onSubmit(clean)
          }}
        >
          <input
            ref={ref}
            value={clean}
            onChange={(e) => setVal(e.target.value)}
            placeholder="ABCD"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="w-full text-center tracking-[0.4em] text-3xl font-mono rounded-2xl bg-panel/60 border border-line px-4 py-4 outline-none focus:border-stage-mastering uppercase"
          />
          <button
            type="submit"
            disabled={clean.length < 4}
            className="mt-4 w-full rounded-2xl bg-gradient-to-r from-stage-producing to-stage-mastering text-white font-bold uppercase tracking-wider py-4 disabled:opacity-40"
          >
            Connect
          </button>
        </form>
      </div>
    </div>
  )
}

function StatusDot({ conn }: { conn: Conn }) {
  const map: Record<Conn, { c: string; t: string }> = {
    connecting: { c: 'bg-amber-400', t: 'Connecting…' },
    connected: { c: 'bg-emerald-400', t: 'Connected' },
    notfound: { c: 'bg-urgent', t: 'Not found' },
    error: { c: 'bg-urgent', t: 'Offline' },
  }
  const { c, t } = map[conn]
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2.5 w-2.5 rounded-full ${c}`} />
      <span className="text-[11px] text-muted">{t}</span>
    </div>
  )
}

function RemoteBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-2xl bg-panel/70 border border-line text-text font-bold py-6 text-lg active:scale-[0.97] active:bg-panel transition"
    >
      {children}
    </button>
  )
}

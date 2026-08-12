import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Slate Teleprompter — a standalone, full-screen prompter that lives at
 * /prompter (no login). Built for live podcast recording: write or paste a
 * script, hit run, and it scrolls hands-free. Device-adaptive — big touch
 * controls and tap-zones on an iPad, keyboard shortcuts on a computer.
 *
 * Sessions + settings persist to localStorage on THIS device, so each iPad /
 * laptop keeps its own library. No backend involved.
 */

// ---------------------------------------------------------------------------
// Fonts, colors, persistence
// ---------------------------------------------------------------------------

const FONTS: Record<string, { label: string; stack: string }> = {
  sans: { label: 'Sans', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
  serif: { label: 'Serif', stack: 'Georgia, "Times New Roman", Times, serif' },
  mono: { label: 'Mono', stack: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
  condensed: { label: 'Condensed', stack: '"Arial Narrow", "Roboto Condensed", "Liberation Sans Narrow", sans-serif' },
}

// The only text colors we offer — kept deliberately small so the toolbar
// stays clean and anyone can use it at a glance.
const TEXT_COLORS: Array<{ key: string; hex: string; ring: string }> = [
  { key: 'White', hex: '#ffffff', ring: '#ffffff' },
  { key: 'Black', hex: '#000000', ring: '#000000' },
  { key: 'Red', hex: '#ef4444', ring: '#ef4444' },
  { key: 'Yellow', hex: '#facc15', ring: '#facc15' },
  { key: 'Green', hex: '#22c55e', ring: '#22c55e' },
  { key: 'Blue', hex: '#3b82f6', ring: '#3b82f6' },
]

const HIGHLIGHT_BG = '#ffe066'
const HIGHLIGHT_FG = '#1a1a1a'

const STORE_KEY = 'slate.prompter.v2'
const LEGACY_KEY = 'slate.prompter.v1'

type Script = {
  id: string
  name: string // user-given; '' means "use the date"
  html: string
  createdAt: number
  updatedAt: number
}

type Settings = {
  speed: number // 1..100 (maps to px/sec)
  fontSize: number // px
  lineHeight: number // unitless
  maxWidth: number // percent of viewport width (40..100)
  align: 'left' | 'center'
  fontFamily: keyof typeof FONTS
  background: 'black' | 'white'
  mirrorX: boolean // horizontal flip (beam-splitter glass)
  flipY: boolean // vertical flip (overhead rig)
  countdown: boolean // 3-2-1 before scroll starts
  showGuide: boolean // eye-line marker
}

type Store = {
  scripts: Script[]
  currentId: string | null
  settings: Settings
}

const DEFAULT_SETTINGS: Settings = {
  speed: 28,
  fontSize: 64,
  lineHeight: 1.45,
  maxWidth: 82,
  align: 'center',
  fontFamily: 'sans',
  background: 'black',
  mirrorX: false,
  flipY: false,
  countdown: true,
  showGuide: true,
}

const SAMPLE_HTML =
  '<div>Welcome back to the show.</div><div><br></div>' +
  "<div>Today we're talking about something I've wanted to dig into for a long time — and I think you're going to love where this goes.</div><div><br></div>" +
  '<div>Before we jump in: if you\'re enjoying the podcast, the single best thing you can do is share this episode with one friend. That\'s it. One friend.</div><div><br></div>' +
  "<div>Alright. Let's get into it.</div>"

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function textToHtml(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.trim() ? `<div>${escapeHtml(line)}</div>` : '<div><br></div>'))
    .join('')
}

function htmlToText(html: string): string {
  const d = document.createElement('div')
  d.innerHTML = html
  // block boundaries should read as spaces for word-counting
  return (d.textContent || '').replace(/ /g, ' ')
}

function wordCount(html: string): number {
  return htmlToText(html).trim().split(/\s+/).filter(Boolean).length
}

function formatDate(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return 'Session'
  }
}

function scriptTitle(s: Script): string {
  return s.name.trim() || formatDate(s.createdAt)
}

function loadStore(): Store {
  // Current-format store
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Store
      return {
        scripts: Array.isArray(parsed.scripts) ? parsed.scripts : [],
        currentId: parsed.currentId ?? null,
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
      }
    }
  } catch {
    /* fall through */
  }

  // Migrate a v1 store (plain-text scripts) if present
  try {
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const old = JSON.parse(legacy) as {
        scripts?: Array<{ id: string; title?: string; text?: string; updatedAt?: number }>
        settings?: Partial<Settings>
      }
      const scripts: Script[] = (old.scripts || []).map((s) => ({
        id: s.id || uid(),
        name: '',
        html: textToHtml(s.text || ''),
        createdAt: s.updatedAt || Date.now(),
        updatedAt: s.updatedAt || Date.now(),
      }))
      if (scripts.length) {
        return {
          scripts,
          currentId: scripts[0].id,
          settings: { ...DEFAULT_SETTINGS, ...(old.settings || {}) },
        }
      }
    }
  } catch {
    /* fall through */
  }

  const first: Script = { id: uid(), name: '', html: SAMPLE_HTML, createdAt: Date.now(), updatedAt: Date.now() }
  return { scripts: [first], currentId: first.id, settings: { ...DEFAULT_SETTINGS } }
}

function saveStore(store: Store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store))
  } catch {
    /* storage full / private mode — best effort */
  }
}

// speed (1..100) → pixels per second, gently scaled by font size
function pxPerSecond(speed: number, fontSize: number): number {
  const base = speed * 1.9
  return base * (fontSize / 64) * 0.85 + base * 0.15
}

function formatClock(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export default function PrompterPage() {
  const [store, setStore] = useState<Store>(() => loadStore())
  const [mode, setMode] = useState<'edit' | 'run'>('edit')

  useEffect(() => {
    saveStore(store)
  }, [store])

  const current = useMemo(
    () => store.scripts.find((s) => s.id === store.currentId) ?? store.scripts[0] ?? null,
    [store.scripts, store.currentId],
  )
  const settings = store.settings

  const setSettings = useCallback((patch: Partial<Settings>) => {
    setStore((s) => ({ ...s, settings: { ...s.settings, ...patch } }))
  }, [])

  const updateCurrentHtml = useCallback((html: string) => {
    setStore((s) => {
      if (!s.currentId) return s
      return {
        ...s,
        scripts: s.scripts.map((sc) => (sc.id === s.currentId ? { ...sc, html, updatedAt: Date.now() } : sc)),
      }
    })
  }, [])

  const renameCurrent = useCallback((name: string) => {
    setStore((s) => {
      if (!s.currentId) return s
      return {
        ...s,
        scripts: s.scripts.map((sc) => (sc.id === s.currentId ? { ...sc, name } : sc)),
      }
    })
  }, [])

  const newScript = useCallback(() => {
    setStore((s) => {
      const now = Date.now()
      const sc: Script = { id: uid(), name: '', html: '', createdAt: now, updatedAt: now }
      return { ...s, scripts: [sc, ...s.scripts], currentId: sc.id }
    })
  }, [])

  const selectScript = useCallback((id: string) => {
    setStore((s) => ({ ...s, currentId: id }))
  }, [])

  const deleteScript = useCallback((id: string) => {
    setStore((s) => {
      const scripts = s.scripts.filter((sc) => sc.id !== id)
      const currentId = s.currentId === id ? scripts[0]?.id ?? null : s.currentId
      return { ...s, scripts, currentId }
    })
  }, [])

  if (mode === 'run' && current) {
    return <Runner script={current} settings={settings} setSettings={setSettings} onExit={() => setMode('edit')} />
  }

  return (
    <Editor
      store={store}
      current={current}
      settings={settings}
      setSettings={setSettings}
      onHtml={updateCurrentHtml}
      onRename={renameCurrent}
      onNew={newScript}
      onSelect={selectScript}
      onDelete={deleteScript}
      onRun={() => current && wordCount(current.html) > 0 && setMode('run')}
    />
  )
}

// ---------------------------------------------------------------------------
// Editor / setup screen
// ---------------------------------------------------------------------------

function Editor(props: {
  store: Store
  current: Script | null
  settings: Settings
  setSettings: (p: Partial<Settings>) => void
  onHtml: (html: string) => void
  onRename: (name: string) => void
  onNew: () => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onRun: () => void
}) {
  const { store, current, settings, setSettings, onHtml, onRename, onNew, onSelect, onDelete, onRun } = props
  const canRun = Boolean(current && wordCount(current.html) > 0)

  return (
    <div className="min-h-screen px-4 sm:px-6 py-6 max-w-5xl mx-auto">
      <header className="flex items-center justify-between gap-3 mb-6">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted mb-1">Straw Hut Media</p>
          <h1 className="font-display text-4xl sm:text-5xl leading-none">
            <span className="text-rainbow">Teleprompter</span>
          </h1>
        </div>
        <a href="/" className="text-xs text-muted hover:text-text border border-line rounded-lg px-3 py-2 whitespace-nowrap">
          ← Slate
        </a>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
        {/* Script editor */}
        <div className="order-2 lg:order-1">
          {/* Session name */}
          <div className="flex items-center gap-2 mb-2">
            <input
              value={current?.name ?? ''}
              onChange={(e) => onRename(e.target.value)}
              placeholder={current ? formatDate(current.createdAt) : 'Session name'}
              className="flex-1 rounded-xl bg-panel/60 border border-line text-text px-3 py-2 text-sm outline-none focus:border-stage-mastering"
            />
            <span className="text-[11px] text-muted whitespace-nowrap">
              {current ? `${wordCount(current.html)} words` : ''}
            </span>
          </div>

          {current && (
            <RichEditor
              key={current.id}
              initialHtml={current.html}
              onChange={onHtml}
              background={settings.background}
              fontStack={FONTS[settings.fontFamily].stack}
            />
          )}

          <div className="mt-4">
            <SettingsPanel settings={settings} setSettings={setSettings} />
          </div>

          <button
            onClick={() => {
              // Request OS fullscreen straight from this click gesture so the
              // prompter opens edge-to-edge — no Mac dock, no menu-bar clock.
              try {
                const el = document.documentElement as any
                if (!(document as any).fullscreenElement && el.requestFullscreen) {
                  void el.requestFullscreen().catch(() => {})
                }
              } catch {
                /* ignore — the runner retries and offers a manual toggle */
              }
              onRun()
            }}
            disabled={!canRun}
            className="mt-5 w-full rounded-2xl bg-gradient-to-r from-stage-producing to-stage-mastering text-white font-bold uppercase tracking-wider text-base px-4 py-4 disabled:opacity-40"
          >
            ▶ Start prompter
          </button>
          <p className="mt-2 text-center text-[11px] text-muted">
            Opens full screen (hides the Mac dock &amp; clock). Tap the screen or hit space to play / pause · Esc to exit.
          </p>
        </div>

        {/* Library */}
        <div className="order-1 lg:order-2">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs uppercase tracking-wider text-muted">Saved sessions</label>
            <button onClick={onNew} className="text-xs text-stage-mastering hover:underline">
              + New
            </button>
          </div>
          <div className="space-y-2 max-h-[40vh] lg:max-h-[70vh] overflow-y-auto pr-1">
            {store.scripts.length === 0 && <p className="text-xs text-muted py-4 text-center">No sessions yet.</p>}
            {store.scripts.map((sc) => {
              const active = sc.id === current?.id
              return (
                <div
                  key={sc.id}
                  className={`group rounded-xl border px-3 py-2.5 cursor-pointer transition ${
                    active ? 'border-stage-mastering bg-stage-mastering/10' : 'border-line bg-panel/40 hover:border-line/80'
                  }`}
                  onClick={() => onSelect(sc.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-text truncate">{scriptTitle(sc)}</p>
                      <p className="text-[10px] text-muted mt-0.5">
                        {sc.name.trim() ? formatDate(sc.createdAt) : `${wordCount(sc.html)} words`}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm('Delete this session from this device?')) onDelete(sc.id)
                      }}
                      className="opacity-0 group-hover:opacity-100 text-muted hover:text-urgent text-xs shrink-0"
                      title="Delete"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          <p className="mt-3 text-[10px] text-muted leading-relaxed">
            Sessions save on this device only. Add <span className="text-text">/prompter</span> to your home screen for a
            one-tap launch.
          </p>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rich text editor (Bold / Italic / Highlight / colors)
// ---------------------------------------------------------------------------

function RichEditor({
  initialHtml,
  onChange,
  background,
  fontStack,
}: {
  initialHtml: string
  onChange: (html: string) => void
  background: 'black' | 'white'
  fontStack: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  // Seed the editable div once (keyed by script id from the parent, so a new
  // script remounts this and reseeds). We deliberately never write innerHTML
  // back from state afterward — that would fight the caret.
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = initialHtml
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sync = useCallback(() => {
    if (ref.current) onChange(ref.current.innerHTML)
  }, [onChange])

  const exec = useCallback(
    (cmd: string, value?: string) => {
      try {
        document.execCommand('styleWithCSS', false, 'true')
        document.execCommand(cmd, false, value)
      } catch {
        /* execCommand is deprecated but still universally supported */
      }
      sync()
    },
    [sync],
  )

  const highlight = useCallback(() => {
    try {
      document.execCommand('styleWithCSS', false, 'true')
      document.execCommand('hiliteColor', false, HIGHLIGHT_BG)
      document.execCommand('foreColor', false, HIGHLIGHT_FG)
    } catch {
      /* ignore */
    }
    sync()
  }, [sync])

  const isDark = background === 'black'
  const bg = isDark ? '#000000' : '#ffffff'
  const fg = isDark ? '#ffffff' : '#111111'

  // Keep the toolbar from stealing the selection when clicked.
  const hold = (e: React.MouseEvent) => e.preventDefault()

  return (
    <div className="rounded-2xl border border-line overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-2 bg-panel/70 border-b border-line">
        <TbBtn onMouseDown={hold} onClick={() => exec('bold')} title="Bold">
          <span className="font-bold">B</span>
        </TbBtn>
        <TbBtn onMouseDown={hold} onClick={() => exec('italic')} title="Italic">
          <span className="italic font-serif">I</span>
        </TbBtn>
        <TbBtn onMouseDown={hold} onClick={highlight} title="Highlight">
          <span className="px-1 rounded" style={{ background: HIGHLIGHT_BG, color: HIGHLIGHT_FG }}>
            H
          </span>
        </TbBtn>

        <span className="w-px h-5 bg-line mx-1" />

        {TEXT_COLORS.map((c) => (
          <button
            key={c.key}
            onMouseDown={hold}
            onClick={() => exec('foreColor', c.hex)}
            title={c.key}
            className="h-6 w-6 rounded-full border border-line grid place-items-center"
            style={{ background: c.hex }}
          >
            {/* white swatch needs a visible outline on dark UI */}
            {c.key === 'White' && <span className="h-4 w-4 rounded-full border border-line" />}
          </button>
        ))}

        <span className="w-px h-5 bg-line mx-1" />

        <TbBtn onMouseDown={hold} onClick={() => exec('removeFormat')} title="Clear formatting">
          <span className="text-[11px]">Clear</span>
        </TbBtn>
      </div>

      {/* Editable area — mirrors the chosen screen so it's what-you-see */}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={sync}
        onBlur={sync}
        onPaste={(e) => {
          // Paste as plain text so pasted styles can't dirty the script.
          e.preventDefault()
          const text = e.clipboardData.getData('text/plain')
          document.execCommand('insertText', false, text)
          sync()
        }}
        data-empty-text="Write or paste your script here…"
        className="prompter-editable px-4 py-4 h-[40vh] lg:h-[46vh] overflow-y-auto outline-none leading-relaxed text-[16px]"
        style={{ background: bg, color: fg, fontFamily: fontStack }}
      />
    </div>
  )
}

function TbBtn({
  children,
  onClick,
  onMouseDown,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  onMouseDown: (e: React.MouseEvent) => void
  title: string
}) {
  return (
    <button
      onClick={onClick}
      onMouseDown={onMouseDown}
      title={title}
      className="min-w-7 h-7 px-2 rounded-lg bg-ink/40 hover:bg-ink/70 text-text text-sm grid place-items-center border border-line"
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------

function SettingsPanel({ settings, setSettings }: { settings: Settings; setSettings: (p: Partial<Settings>) => void }) {
  return (
    <div className="rounded-2xl border border-line bg-panel/40 p-4">
      <p className="text-xs uppercase tracking-wider text-muted mb-3">Look & feel</p>
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
        <Slider label="Scroll speed" value={settings.speed} min={4} max={100} step={1} onChange={(v) => setSettings({ speed: v })} />
        <Slider label="Font size" value={settings.fontSize} min={28} max={140} step={2} suffix="px" onChange={(v) => setSettings({ fontSize: v })} />
        <Slider label="Line spacing" value={settings.lineHeight} min={1.1} max={2.2} step={0.05} onChange={(v) => setSettings({ lineHeight: v })} />
        <Slider label="Text width" value={settings.maxWidth} min={40} max={100} step={1} suffix="%" onChange={(v) => setSettings({ maxWidth: v })} />
      </div>

      {/* Font + screen */}
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4 mt-4">
        <div>
          <p className="text-[11px] text-muted mb-1.5">Font</p>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(FONTS) as Array<keyof typeof FONTS>).map((k) => (
              <button
                key={k}
                onClick={() => setSettings({ fontFamily: k })}
                style={{ fontFamily: FONTS[k].stack }}
                className={`text-xs rounded-lg px-3 py-2 border transition ${
                  settings.fontFamily === k ? 'border-stage-mastering bg-stage-mastering/15 text-text' : 'border-line bg-panel/40 text-muted hover:text-text'
                }`}
              >
                {FONTS[k].label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[11px] text-muted mb-1.5">Screen</p>
          <div className="flex gap-1.5">
            <button
              onClick={() => setSettings({ background: 'black' })}
              className={`flex-1 text-xs rounded-lg px-3 py-2 border transition ${
                settings.background === 'black' ? 'border-stage-mastering ring-1 ring-stage-mastering' : 'border-line'
              }`}
              style={{ background: '#000', color: '#fff' }}
            >
              Black
            </button>
            <button
              onClick={() => setSettings({ background: 'white' })}
              className={`flex-1 text-xs rounded-lg px-3 py-2 border transition ${
                settings.background === 'white' ? 'border-stage-mastering ring-1 ring-stage-mastering' : 'border-line'
              }`}
              style={{ background: '#fff', color: '#111' }}
            >
              White
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        <Toggle label="Align center" on={settings.align === 'center'} onClick={() => setSettings({ align: settings.align === 'center' ? 'left' : 'center' })} />
        <Toggle label="Mirror ↔" on={settings.mirrorX} onClick={() => setSettings({ mirrorX: !settings.mirrorX })} hint="For glass teleprompters" />
        <Toggle label="Flip ↕" on={settings.flipY} onClick={() => setSettings({ flipY: !settings.flipY })} hint="For overhead rigs" />
        <Toggle label="Countdown" on={settings.countdown} onClick={() => setSettings({ countdown: !settings.countdown })} />
        <Toggle label="Eye-line guide" on={settings.showGuide} onClick={() => setSettings({ showGuide: !settings.showGuide })} />
      </div>
    </div>
  )
}

function Slider(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (v: number) => void
}) {
  const { label, value, min, max, step, suffix, onChange } = props
  return (
    <label className="block">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-muted">{label}</span>
        <span className="text-[11px] text-text tabular-nums">
          {Number.isInteger(value) ? value : value.toFixed(2)}
          {suffix || ''}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-stage-mastering"
      />
    </label>
  )
}

function Toggle({ label, on, onClick, hint }: { label: string; on: boolean; onClick: () => void; hint?: string }) {
  return (
    <button
      onClick={onClick}
      title={hint}
      className={`text-xs rounded-lg px-3 py-2 border transition ${
        on ? 'border-stage-mastering bg-stage-mastering/15 text-text' : 'border-line bg-panel/40 text-muted hover:text-text'
      }`}
    >
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Runner / fullscreen scrolling view
// ---------------------------------------------------------------------------

function Runner({
  script,
  settings,
  setSettings,
  onExit,
}: {
  script: Script
  settings: Settings
  setSettings: (p: Partial<Settings>) => void
  onExit: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [progress, setProgress] = useState(0)
  const [remaining, setRemaining] = useState(0)
  const [isFs, setIsFs] = useState(false)

  const isTouch = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches, [])

  // Track real (OS-level) fullscreen so the button reflects state. On macOS
  // this is what hides the dock and the menu-bar clock.
  useEffect(() => {
    const on = () => setIsFs(Boolean((document as any).fullscreenElement))
    document.addEventListener('fullscreenchange', on)
    on()
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])

  // Entering the runner is a user gesture (the Start button), so try to go
  // fullscreen immediately for a true edge-to-edge prompter. Best-effort —
  // iOS Safari doesn't grant element fullscreen; the immersive layout covers
  // that case, plus Add-to-Home-Screen.
  useEffect(() => {
    try {
      const el = document.documentElement as any
      if (!(document as any).fullscreenElement && el.requestFullscreen) {
        void el.requestFullscreen().catch(() => {})
      }
    } catch {
      /* ignore */
    }
  }, [])

  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef<number | null>(null)
  const accRef = useRef(0)
  const hideTimer = useRef<number | null>(null)
  const wakeLockRef = useRef<any>(null)

  const speedRef = useRef(settings.speed)
  const fontRef = useRef(settings.fontSize)
  useEffect(() => {
    speedRef.current = settings.speed
    fontRef.current = settings.fontSize
  }, [settings.speed, settings.fontSize])

  // Screen wake lock — don't let the iPad sleep mid-read.
  useEffect(() => {
    let released = false
    async function acquire() {
      try {
        const nav = navigator as any
        if (nav.wakeLock?.request) wakeLockRef.current = await nav.wakeLock.request('screen')
      } catch {
        /* unsupported / denied */
      }
    }
    void acquire()
    const onVis = () => {
      if (document.visibilityState === 'visible' && !released) void acquire()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      released = true
      document.removeEventListener('visibilitychange', onVis)
      try {
        wakeLockRef.current?.release?.()
      } catch {
        /* ignore */
      }
      wakeLockRef.current = null
    }
  }, [])

  const tick = useCallback((ts: number) => {
    const el = scrollRef.current
    if (!el) return
    if (lastTsRef.current == null) lastTsRef.current = ts
    const dt = (ts - lastTsRef.current) / 1000
    lastTsRef.current = ts

    const pps = pxPerSecond(speedRef.current, fontRef.current)
    accRef.current += pps * dt
    if (accRef.current >= 1) {
      const step = Math.floor(accRef.current)
      accRef.current -= step
      el.scrollTop += step
    }

    const max = el.scrollHeight - el.clientHeight
    setProgress(max > 0 ? Math.min(1, el.scrollTop / max) : 0)
    setRemaining(pps > 0 ? Math.max(0, (max - el.scrollTop) / pps) : 0)

    if (el.scrollTop >= max - 1) {
      setPlaying(false)
      return
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  useEffect(() => {
    if (playing) {
      lastTsRef.current = null
      rafRef.current = requestAnimationFrame(tick)
      return () => {
        if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      }
    }
  }, [playing, tick])

  const revealControls = useCallback(() => {
    setShowControls(true)
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setShowControls(false), 2600)
  }, [])

  useEffect(() => {
    if (playing) revealControls()
    else {
      setShowControls(true)
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
    }
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
    }
  }, [playing, revealControls])

  const startCountdown = useCallback(() => {
    setCountdown(3)
    let n = 3
    const iv = window.setInterval(() => {
      n -= 1
      if (n <= 0) {
        window.clearInterval(iv)
        setCountdown(null)
        setPlaying(true)
      } else {
        setCountdown(n)
      }
    }, 700)
  }, [])

  const togglePlay = useCallback(() => {
    if (countdown != null) return
    if (playing) setPlaying(false)
    else if (settings.countdown && scrollRef.current && scrollRef.current.scrollTop < 2) startCountdown()
    else setPlaying(true)
  }, [playing, countdown, settings.countdown, startCountdown])

  const restart = useCallback(() => {
    setPlaying(false)
    setCountdown(null)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    setProgress(0)
  }, [])

  const jump = useCallback((deltaPx: number) => {
    const el = scrollRef.current
    if (el) el.scrollTop = Math.max(0, el.scrollTop + deltaPx)
  }, [])

  const toggleFullscreen = useCallback(() => {
    const d = document as any
    if (!d.fullscreenElement && document.documentElement.requestFullscreen) {
      void document.documentElement.requestFullscreen().catch(() => {})
    } else if (d.exitFullscreen) {
      void d.exitFullscreen().catch(() => {})
    }
  }, [])

  // Leaving the prompter should also drop out of OS fullscreen.
  const handleExit = useCallback(() => {
    try {
      const d = document as any
      if (d.fullscreenElement && d.exitFullscreen) void d.exitFullscreen().catch(() => {})
    } catch {
      /* ignore */
    }
    onExit()
  }, [onExit])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case ' ':
        case 'Spacebar':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowUp':
          e.preventDefault()
          setSettings({ speed: Math.min(100, settings.speed + 2) })
          break
        case 'ArrowDown':
          e.preventDefault()
          setSettings({ speed: Math.max(1, settings.speed - 2) })
          break
        case 'ArrowRight':
          e.preventDefault()
          setSettings({ fontSize: Math.min(160, settings.fontSize + 4) })
          break
        case 'ArrowLeft':
          e.preventDefault()
          setSettings({ fontSize: Math.max(20, settings.fontSize - 4) })
          break
        case 'PageDown':
          e.preventDefault()
          jump(window.innerHeight * 0.6)
          break
        case 'PageUp':
          e.preventDefault()
          jump(-window.innerHeight * 0.6)
          break
        case 'm':
        case 'M':
          setSettings({ mirrorX: !settings.mirrorX })
          break
        case 'r':
        case 'R':
          restart()
          break
        case 'f':
        case 'F':
          toggleFullscreen()
          break
        case 'Escape':
          handleExit()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settings, setSettings, togglePlay, restart, jump, toggleFullscreen, handleExit])

  const transform = `${settings.mirrorX ? 'scaleX(-1)' : ''} ${settings.flipY ? 'scaleY(-1)' : ''}`.trim()

  const isDark = settings.background === 'black'
  const bg = isDark ? '#000000' : '#ffffff'
  const fg = isDark ? '#ffffff' : '#111111'
  const fadeRgb = isDark ? '0,0,0' : '255,255,255'

  return (
    <div className="fixed inset-0 overflow-hidden select-none" style={{ background: bg, color: fg }}>
      {/* Scrolling text (the only thing that gets mirrored/flipped) */}
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-y-scroll no-scrollbar"
        style={{ transform: transform || undefined }}
        onWheel={() => {
          if (playing) setPlaying(false)
        }}
      >
        <div
          className="mx-auto"
          style={{ maxWidth: `${settings.maxWidth}%`, paddingTop: '46vh', paddingBottom: '80vh', paddingLeft: '4vw', paddingRight: '4vw' }}
        >
          <div
            style={{
              fontSize: `${settings.fontSize}px`,
              lineHeight: settings.lineHeight,
              textAlign: settings.align,
              fontFamily: FONTS[settings.fontFamily].stack,
              fontWeight: 600,
              wordBreak: 'break-word',
            }}
            dangerouslySetInnerHTML={{ __html: script.html }}
          />
        </div>
      </div>

      {/* Eye-line guide + edge fades (NOT mirrored — drawn on top) */}
      {settings.showGuide && (
        <div className="pointer-events-none absolute inset-x-0" style={{ top: '46vh' }}>
          <div className="mx-auto h-[2px] bg-stage-mastering/70" style={{ width: '92%' }} />
          <div className="flex justify-between px-2 -mt-2 text-stage-mastering/80">
            <span>▶</span>
            <span className="rotate-180">▶</span>
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[22vh]" style={{ background: `linear-gradient(to bottom, rgba(${fadeRgb},0.85), transparent)` }} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[22vh]" style={{ background: `linear-gradient(to top, rgba(${fadeRgb},0.85), transparent)` }} />

      {/* Tap layer — toggles play/pause and reveals controls */}
      <div
        className="absolute inset-0"
        onClick={() => {
          togglePlay()
          revealControls()
        }}
        onMouseMove={revealControls}
      />

      {/* Countdown */}
      {countdown != null && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="text-[22vw] font-black tabular-nums leading-none" style={{ color: fg, opacity: 0.9 }}>
            {countdown}
          </div>
        </div>
      )}

      {/* Progress bar */}
      <div className="absolute top-0 left-0 right-0 h-1" style={{ background: `rgba(${isDark ? '255,255,255' : '0,0,0'},0.12)` }}>
        <div className="h-full bar-rainbow" style={{ width: `${progress * 100}%` }} />
      </div>

      {/* Control bar (always dark for a consistent, readable affordance) */}
      <div className={`absolute inset-x-0 bottom-0 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="mx-auto max-w-3xl m-3 rounded-2xl bg-black/80 backdrop-blur border border-white/10 px-3 py-2.5 text-white">
          <div className="flex items-center justify-between gap-2">
            <button onClick={handleExit} className="text-xs sm:text-sm text-white/70 hover:text-white px-2 py-2">
              ✕ Exit
            </button>

            <div className="flex items-center gap-1.5 sm:gap-2">
              <CtrlBtn onClick={() => setSettings({ speed: Math.max(1, settings.speed - 2) })} label="Slower">
                −
              </CtrlBtn>
              <div className="text-center min-w-[52px]">
                <div className="text-[9px] uppercase tracking-wider text-white/40">Speed</div>
                <div className="text-sm tabular-nums">{settings.speed}</div>
              </div>
              <CtrlBtn onClick={() => setSettings({ speed: Math.min(100, settings.speed + 2) })} label="Faster">
                +
              </CtrlBtn>

              <button
                onClick={togglePlay}
                className="mx-1 sm:mx-2 h-14 w-14 rounded-full bg-gradient-to-r from-stage-producing to-stage-mastering text-white text-2xl grid place-items-center shadow-lg"
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? '❚❚' : '▶'}
              </button>

              <CtrlBtn onClick={() => setSettings({ fontSize: Math.max(20, settings.fontSize - 4) })} label="Smaller">
                A−
              </CtrlBtn>
              <div className="text-center min-w-[52px]">
                <div className="text-[9px] uppercase tracking-wider text-white/40">Size</div>
                <div className="text-sm tabular-nums">{settings.fontSize}</div>
              </div>
              <CtrlBtn onClick={() => setSettings({ fontSize: Math.min(160, settings.fontSize + 4) })} label="Bigger">
                A+
              </CtrlBtn>
            </div>

            <button onClick={restart} className="text-xs sm:text-sm text-white/70 hover:text-white px-2 py-2" title="Restart">
              ↺
            </button>
          </div>

          {/* Secondary row */}
          <div className="flex items-center justify-center gap-2 mt-2 flex-wrap">
            <MiniToggle on={settings.background === 'white'} onClick={() => setSettings({ background: settings.background === 'white' ? 'black' : 'white' })}>
              {settings.background === 'white' ? '○ White' : '● Black'}
            </MiniToggle>
            <MiniToggle on={settings.mirrorX} onClick={() => setSettings({ mirrorX: !settings.mirrorX })}>
              Mirror ↔
            </MiniToggle>
            <MiniToggle on={settings.flipY} onClick={() => setSettings({ flipY: !settings.flipY })}>
              Flip ↕
            </MiniToggle>
            <button
              onClick={toggleFullscreen}
              className={`text-[11px] rounded-lg px-2.5 py-1.5 border transition ${
                isFs ? 'border-stage-mastering bg-stage-mastering/20 text-white' : 'border-white/15 text-white/70 hover:text-white'
              }`}
              title="Hide the Mac dock and menu bar"
            >
              {isFs ? '⤢ Exit full screen' : '⤢ Full screen'}
            </button>
            <span className="text-[11px] text-white/40 tabular-nums px-1">{formatClock(remaining)} left</span>
          </div>

          {!isTouch && showControls && (
            <p className="text-center text-[10px] text-white/30 mt-1.5">
              Space play/pause · ↑↓ speed · ←→ size · M mirror · R restart · F fullscreen · Esc exit
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function CtrlBtn({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="h-11 w-11 rounded-xl bg-white/10 hover:bg-white/20 text-lg grid place-items-center active:scale-95 transition"
    >
      {children}
    </button>
  )
}

function MiniToggle({ children, on, onClick }: { children: React.ReactNode; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`text-[11px] rounded-lg px-2.5 py-1.5 border transition ${
        on ? 'border-stage-mastering bg-stage-mastering/20 text-white' : 'border-white/15 text-white/70 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

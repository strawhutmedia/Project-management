import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Slate Teleprompter — a standalone, full-screen prompter that lives at
 * /prompter (no login). Built for live podcast recording: paste a script,
 * hit run, and it scrolls hands-free. Device-adaptive — big touch controls
 * and tap-zones on an iPad, keyboard shortcuts on a computer.
 *
 * Everything (scripts + settings) persists to localStorage on THIS device,
 * so each iPad / laptop keeps its own library. No backend involved.
 */

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const STORE_KEY = 'slate.prompter.v1'

type Script = {
  id: string
  title: string
  text: string
  updatedAt: number
}

type Settings = {
  speed: number // 1..100 (maps to px/sec)
  fontSize: number // px
  lineHeight: number // unitless
  maxWidth: number // percent of viewport width (40..100)
  align: 'left' | 'center'
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
  mirrorX: false,
  flipY: false,
  countdown: true,
  showGuide: true,
}

const SAMPLE = `Welcome back to the show.

Today we're talking about something I've wanted to dig into for a long time — and I think you're going to love where this goes.

Before we jump in: if you're enjoying the podcast, the single best thing you can do is share this episode with one friend. That's it. One friend.

Alright. Let's get into it.`

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

function titleFromText(text: string): string {
  const first = text.split('\n').map((l) => l.trim()).find(Boolean)
  if (!first) return 'Untitled script'
  return first.length > 48 ? first.slice(0, 46) + '…' : first
}

function loadStore(): Store {
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
    // corrupt / unavailable — fall through to a fresh store
  }
  const first: Script = { id: uid(), title: titleFromText(SAMPLE), text: SAMPLE, updatedAt: Date.now() }
  return { scripts: [first], currentId: first.id, settings: { ...DEFAULT_SETTINGS } }
}

function saveStore(store: Store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store))
  } catch {
    // storage full / private mode — best effort, nothing we can do
  }
}

// speed (1..100) → pixels per second
function pxPerSecond(speed: number, fontSize: number): number {
  // scale a little with font size so bigger text doesn't feel like it's flying
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
// Component
// ---------------------------------------------------------------------------

export default function PrompterPage() {
  const [store, setStore] = useState<Store>(() => loadStore())
  const [mode, setMode] = useState<'edit' | 'run'>('edit')

  // Persist on every change.
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

  // -- script library ops ---------------------------------------------------
  const updateCurrentText = useCallback((text: string) => {
    setStore((s) => {
      if (!s.currentId) return s
      return {
        ...s,
        scripts: s.scripts.map((sc) =>
          sc.id === s.currentId ? { ...sc, text, title: titleFromText(text), updatedAt: Date.now() } : sc,
        ),
      }
    })
  }, [])

  const newScript = useCallback(() => {
    setStore((s) => {
      const sc: Script = { id: uid(), title: 'Untitled script', text: '', updatedAt: Date.now() }
      return { ...s, scripts: [sc, ...s.scripts], currentId: sc.id }
    })
  }, [])

  const selectScript = useCallback((id: string) => {
    setStore((s) => ({ ...s, currentId: id }))
  }, [])

  const deleteScript = useCallback((id: string) => {
    setStore((s) => {
      const scripts = s.scripts.filter((sc) => sc.id !== id)
      const currentId = s.currentId === id ? (scripts[0]?.id ?? null) : s.currentId
      return { ...s, scripts, currentId }
    })
  }, [])

  if (mode === 'run' && current) {
    return (
      <Runner
        script={current}
        settings={settings}
        setSettings={setSettings}
        onExit={() => setMode('edit')}
      />
    )
  }

  return (
    <Editor
      store={store}
      current={current}
      settings={settings}
      setSettings={setSettings}
      onText={updateCurrentText}
      onNew={newScript}
      onSelect={selectScript}
      onDelete={deleteScript}
      onRun={() => current && current.text.trim() && setMode('run')}
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
  onText: (t: string) => void
  onNew: () => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onRun: () => void
}) {
  const { store, current, settings, setSettings, onText, onNew, onSelect, onDelete, onRun } = props
  const canRun = Boolean(current && current.text.trim())

  return (
    <div className="min-h-screen px-4 sm:px-6 py-6 max-w-5xl mx-auto">
      <header className="flex items-center justify-between gap-3 mb-6">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted mb-1">Straw Hut Media</p>
          <h1 className="font-display text-4xl sm:text-5xl leading-none">
            <span className="text-rainbow">Teleprompter</span>
          </h1>
        </div>
        <a
          href="/"
          className="text-xs text-muted hover:text-text border border-line rounded-lg px-3 py-2 whitespace-nowrap"
        >
          ← Slate
        </a>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
        {/* Script editor */}
        <div className="order-2 lg:order-1">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs uppercase tracking-wider text-muted">Script</label>
            <span className="text-[11px] text-muted">
              {current ? `${current.text.trim().split(/\s+/).filter(Boolean).length} words` : ''}
            </span>
          </div>
          <textarea
            value={current?.text ?? ''}
            onChange={(e) => onText(e.target.value)}
            placeholder="Paste or type your script here…"
            className="w-full h-[46vh] lg:h-[52vh] rounded-2xl bg-panel/60 border border-line text-text px-4 py-4 outline-none focus:border-stage-mastering resize-none leading-relaxed text-[15px]"
            spellCheck={false}
          />

          <div className="mt-4">
            <SettingsPanel settings={settings} setSettings={setSettings} />
          </div>

          <button
            onClick={onRun}
            disabled={!canRun}
            className="mt-5 w-full rounded-2xl bg-gradient-to-r from-stage-producing to-stage-mastering text-white font-bold uppercase tracking-wider text-base px-4 py-4 disabled:opacity-40"
          >
            ▶ Start prompter
          </button>
          <p className="mt-2 text-center text-[11px] text-muted">
            Fullscreen scroll. Tap the screen or hit space to play / pause.
          </p>
        </div>

        {/* Library */}
        <div className="order-1 lg:order-2">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs uppercase tracking-wider text-muted">On this device</label>
            <button onClick={onNew} className="text-xs text-stage-mastering hover:underline">
              + New
            </button>
          </div>
          <div className="space-y-2 max-h-[40vh] lg:max-h-[70vh] overflow-y-auto pr-1">
            {store.scripts.length === 0 && (
              <p className="text-xs text-muted py-4 text-center">No scripts yet.</p>
            )}
            {store.scripts.map((sc) => {
              const active = sc.id === current?.id
              return (
                <div
                  key={sc.id}
                  className={`group rounded-xl border px-3 py-2.5 cursor-pointer transition ${
                    active
                      ? 'border-stage-mastering bg-stage-mastering/10'
                      : 'border-line bg-panel/40 hover:border-line/80'
                  }`}
                  onClick={() => onSelect(sc.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-text truncate">{sc.title || 'Untitled'}</p>
                      <p className="text-[10px] text-muted mt-0.5">
                        {sc.text.trim().split(/\s+/).filter(Boolean).length} words
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm('Delete this script from this device?')) onDelete(sc.id)
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
            Scripts are saved on this device only. Add <span className="text-text">/prompter</span> to your
            home screen for a one-tap launch.
          </p>
        </div>
      </div>
    </div>
  )
}

function SettingsPanel({
  settings,
  setSettings,
}: {
  settings: Settings
  setSettings: (p: Partial<Settings>) => void
}) {
  return (
    <div className="rounded-2xl border border-line bg-panel/40 p-4">
      <p className="text-xs uppercase tracking-wider text-muted mb-3">Look & feel</p>
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
        <Slider
          label="Scroll speed"
          value={settings.speed}
          min={4}
          max={100}
          step={1}
          onChange={(v) => setSettings({ speed: v })}
        />
        <Slider
          label="Font size"
          value={settings.fontSize}
          min={28}
          max={140}
          step={2}
          suffix="px"
          onChange={(v) => setSettings({ fontSize: v })}
        />
        <Slider
          label="Line spacing"
          value={settings.lineHeight}
          min={1.1}
          max={2.2}
          step={0.05}
          onChange={(v) => setSettings({ lineHeight: v })}
        />
        <Slider
          label="Text width"
          value={settings.maxWidth}
          min={40}
          max={100}
          step={1}
          suffix="%"
          onChange={(v) => setSettings({ maxWidth: v })}
        />
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        <Toggle
          label="Align center"
          on={settings.align === 'center'}
          onClick={() => setSettings({ align: settings.align === 'center' ? 'left' : 'center' })}
        />
        <Toggle
          label="Mirror ↔"
          on={settings.mirrorX}
          onClick={() => setSettings({ mirrorX: !settings.mirrorX })}
          hint="For glass teleprompters"
        />
        <Toggle
          label="Flip ↕"
          on={settings.flipY}
          onClick={() => setSettings({ flipY: !settings.flipY })}
          hint="For overhead rigs"
        />
        <Toggle
          label="Countdown"
          on={settings.countdown}
          onClick={() => setSettings({ countdown: !settings.countdown })}
        />
        <Toggle
          label="Eye-line guide"
          on={settings.showGuide}
          onClick={() => setSettings({ showGuide: !settings.showGuide })}
        />
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

function Toggle({
  label,
  on,
  onClick,
  hint,
}: {
  label: string
  on: boolean
  onClick: () => void
  hint?: string
}) {
  return (
    <button
      onClick={onClick}
      title={hint}
      className={`text-xs rounded-lg px-3 py-2 border transition ${
        on
          ? 'border-stage-mastering bg-stage-mastering/15 text-text'
          : 'border-line bg-panel/40 text-muted hover:text-text'
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

  // coarse pointer ⇒ treat as touch device (iPad / tablet)
  const isTouch = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches,
    [],
  )

  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef<number | null>(null)
  const accRef = useRef(0)
  const hideTimer = useRef<number | null>(null)
  const wakeLockRef = useRef<any>(null)

  // Keep a live handle on the numbers the rAF loop needs, without re-creating
  // the loop on every keystroke.
  const speedRef = useRef(settings.speed)
  const fontRef = useRef(settings.fontSize)
  useEffect(() => {
    speedRef.current = settings.speed
    fontRef.current = settings.fontSize
  }, [settings.speed, settings.fontSize])

  // --- screen wake lock (don't let the iPad sleep mid-read) ----------------
  useEffect(() => {
    let released = false
    async function acquire() {
      try {
        const nav = navigator as any
        if (nav.wakeLock?.request) {
          wakeLockRef.current = await nav.wakeLock.request('screen')
        }
      } catch {
        // unsupported or denied — fine, the show goes on
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

  // --- the scroll loop -----------------------------------------------------
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

  // --- controls auto-hide while playing ------------------------------------
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

  // --- play / pause with optional countdown --------------------------------
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
    if (playing) {
      setPlaying(false)
    } else if (settings.countdown && scrollRef.current && scrollRef.current.scrollTop < 2) {
      startCountdown()
    } else {
      setPlaying(true)
    }
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

  // --- keyboard (computer) -------------------------------------------------
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
          onExit()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settings, setSettings, togglePlay, restart, jump, toggleFullscreen, onExit])

  const transform = `${settings.mirrorX ? 'scaleX(-1)' : ''} ${settings.flipY ? 'scaleY(-1)' : ''}`.trim()

  return (
    <div className="fixed inset-0 bg-black text-white overflow-hidden select-none">
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
          style={{
            maxWidth: `${settings.maxWidth}%`,
            paddingTop: '46vh',
            paddingBottom: '80vh',
            paddingLeft: '4vw',
            paddingRight: '4vw',
          }}
        >
          <div
            style={{
              fontSize: `${settings.fontSize}px`,
              lineHeight: settings.lineHeight,
              textAlign: settings.align,
              whiteSpace: 'pre-wrap',
              fontWeight: 600,
              wordBreak: 'break-word',
            }}
          >
            {script.text}
          </div>
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
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[22vh]"
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.85), transparent)' }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[22vh]"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)' }}
      />

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
          <div className="text-[22vw] font-black text-white/90 tabular-nums leading-none">
            {countdown}
          </div>
        </div>
      )}

      {/* Progress bar */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-white/10">
        <div className="h-full bar-rainbow" style={{ width: `${progress * 100}%` }} />
      </div>

      {/* Control bar */}
      <div
        className={`absolute inset-x-0 bottom-0 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="mx-auto max-w-3xl m-3 rounded-2xl bg-black/70 backdrop-blur border border-white/10 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={onExit}
              className="text-xs sm:text-sm text-white/70 hover:text-white px-2 py-2"
            >
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

            <button
              onClick={restart}
              className="text-xs sm:text-sm text-white/70 hover:text-white px-2 py-2"
              title="Restart"
            >
              ↺
            </button>
          </div>

          {/* Secondary row */}
          <div className="flex items-center justify-center gap-2 mt-2 flex-wrap">
            <MiniToggle on={settings.mirrorX} onClick={() => setSettings({ mirrorX: !settings.mirrorX })}>
              Mirror ↔
            </MiniToggle>
            <MiniToggle on={settings.flipY} onClick={() => setSettings({ flipY: !settings.flipY })}>
              Flip ↕
            </MiniToggle>
            <button
              onClick={toggleFullscreen}
              className="text-[11px] rounded-lg px-2.5 py-1.5 border border-white/15 text-white/70 hover:text-white"
            >
              ⤢ Fullscreen
            </button>
            <span className="text-[11px] text-white/40 tabular-nums px-1">
              {formatClock(remaining)} left
            </span>
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

function CtrlBtn({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode
  onClick: () => void
  label: string
}) {
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

function MiniToggle({
  children,
  on,
  onClick,
}: {
  children: React.ReactNode
  on: boolean
  onClick: () => void
}) {
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

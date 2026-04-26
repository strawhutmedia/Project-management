import { Link, Outlet } from 'react-router-dom'

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-line/60 backdrop-blur-md bg-ink/70 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-5 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-baseline gap-3">
            <span className="text-[10px] uppercase tracking-[0.25em] text-muted">
              Straw Hut Media presents
            </span>
            <span className="font-display text-3xl text-text">SLATE</span>
          </Link>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted bg-panel/60 border border-line rounded-full px-2.5 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-stage-mixing" />
              Demo mode
            </span>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-stage-producing to-stage-mastering grid place-items-center text-xs font-semibold">
              R
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-5 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-line/60 mt-12">
        <div className="max-w-6xl mx-auto px-5 py-6 text-xs text-muted flex items-center justify-between">
          <span>A Straw Hut Media tool.</span>
          <span className="opacity-70">v0.1 · preview build</span>
        </div>
      </footer>
    </div>
  )
}

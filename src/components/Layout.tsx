import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../auth'
import NotificationsBell from './NotificationsBell'

const PICKED_SESSION_KEY = 'slate.dashboard.workspacePicked'

export default function Layout() {
  const { user, logout } = useAuth()
  const initial = (user?.display_name || user?.name || '?').charAt(0).toUpperCase()
  const [menuOpen, setMenuOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const navigate = useNavigate()

  // The teleprompter is a podcast-side tool, so it only appears in the nav
  // when the podcast workspace is active. (The /prompter URL itself is always
  // reachable directly.)
  let isPodcastWorkspace = false
  try {
    isPodcastWorkspace = window.localStorage.getItem('slate.dashboard.kindTab') === 'podcast'
  } catch {
    /* ignore */
  }

  function switchWorkspace() {
    try { window.sessionStorage.removeItem(PICKED_SESSION_KEY) } catch {}
    navigate('/')
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-line/60 backdrop-blur-md bg-ink/70 sticky top-0 z-30">
        <div className="rainbow-strip" />
        <div className="max-w-6xl mx-auto px-5 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-baseline gap-3">
            <span className="text-[10px] uppercase tracking-[0.25em] text-muted hidden sm:inline">
              Straw Hut Media presents
            </span>
            <span className="font-display text-3xl text-rainbow">SLATE</span>
          </Link>

          <div className="flex items-center gap-2">
            <button
              onClick={switchWorkspace}
              className="hidden sm:inline-flex items-center gap-1 text-[11px] uppercase tracking-wider font-bold px-2.5 py-1 rounded-full border border-line text-muted hover:text-text transition"
              title="Switch between Podcasts / Music / Films"
            >
              ↻ Switch
            </button>
            <NavLink
              to="/scheduler"
              className={({ isActive }) =>
                `hidden sm:inline-flex items-center gap-1 text-[11px] uppercase tracking-wider font-bold px-2.5 py-1 rounded-full border transition ${
                  isActive
                    ? 'text-stage-mastering bg-stage-mastering/10 border-stage-mastering/40'
                    : 'text-muted border-line hover:text-text hover:border-line'
                }`
              }
            >
              📅 Scheduler
            </NavLink>

            {user?.role === 'admin' && (
              <NavLink
                to="/admin/outreach"
                className={({ isActive }) =>
                  `hidden sm:inline-flex items-center gap-1 text-[11px] uppercase tracking-wider font-bold px-2.5 py-1 rounded-full border transition ${
                    isActive
                      ? 'text-stage-mastering bg-stage-mastering/10 border-stage-mastering/40'
                      : 'text-muted border-line hover:text-text hover:border-line'
                  }`
                }
              >
                ✉ Outreach
              </NavLink>
            )}

            {user?.role === 'admin' && (
              <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-stage-mastering bg-stage-mastering/10 border border-stage-mastering/40 rounded-full px-2.5 py-1 font-bold">
                Super Admin
              </span>
            )}

            <NotificationsBell />

            {/* Hamburger — top-level navigation (Switch, Scheduler,
                Outreach, Domains). Separate from the profile avatar
                because clicking your own face to find "Scheduler"
                doesn't make sense. Icon-based label on all screen
                sizes so mobile users have a clear jump-to. */}
            <div className="relative">
              <button
                onClick={() => { setNavOpen((v) => !v); setMenuOpen(false) }}
                className="w-9 h-9 rounded-full border border-line hover:border-stage-mastering/60 grid place-items-center text-text text-lg"
                title="Menu"
                aria-label="Open menu"
              >
                ☰
              </button>
              {navOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setNavOpen(false)}
                  />
                  <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-line bg-panel/95 backdrop-blur-md shadow-2xl z-20 overflow-hidden">
                    <button
                      onClick={() => { setNavOpen(false); switchWorkspace() }}
                      className="block w-full text-left px-4 py-2.5 text-sm text-text hover:bg-line/40"
                    >
                      ↻ Switch workspace
                    </button>
                    <NavMenuLink to="/scheduler" onClick={() => setNavOpen(false)}>
                      📅 Scheduler
                    </NavMenuLink>
                    {isPodcastWorkspace && (
                      <NavMenuLink to="/prompter" onClick={() => setNavOpen(false)}>
                        🎬 Teleprompter
                      </NavMenuLink>
                    )}
                    {user?.role === 'admin' && (
                      <>
                        <NavMenuLink to="/admin/outreach" onClick={() => setNavOpen(false)}>
                          ✉ Outreach
                        </NavMenuLink>
                        <NavMenuLink to="/admin/outreach/domains" onClick={() => setNavOpen(false)}>
                          📡 Sending domains
                        </NavMenuLink>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="relative">
              <button
                onClick={() => { setMenuOpen((v) => !v); setNavOpen(false) }}
                className="w-9 h-9 rounded-full bg-gradient-to-br from-stage-producing via-stage-mastering to-stage-tracking grid place-items-center text-xs font-bold shadow-[0_0_20px_-4px_rgba(244,114,182,0.6)]"
                title={user?.display_name || user?.name}
                aria-label="Profile"
              >
                {initial}
              </button>
              {menuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-line bg-panel/95 backdrop-blur-md shadow-2xl z-20 overflow-hidden">
                    <div className="p-3 border-b border-line">
                      <div className="text-sm font-bold">
                        {user?.display_name || user?.name}
                      </div>
                      <div className="text-[11px] text-muted truncate">{user?.email}</div>
                    </div>
                    <NavMenuLink to="/profile" onClick={() => setMenuOpen(false)}>
                      👤 Profile
                    </NavMenuLink>
                    <NavMenuLink to="/settings" onClick={() => setMenuOpen(false)}>
                      ⚙️ Settings
                    </NavMenuLink>
                    <button
                      onClick={() => {
                        setMenuOpen(false)
                        void logout()
                      }}
                      className="block w-full text-left px-4 py-2.5 text-sm text-urgent hover:bg-urgent/10 border-t border-line"
                    >
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-5 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-line/60 mt-12">
        <div className="rainbow-strip" />
        <div className="max-w-6xl mx-auto px-5 py-6 text-xs text-muted flex items-center justify-between">
          <span>A Straw Hut Media tool.</span>
          <span className="opacity-70">v0.3 · {user?.email}</span>
        </div>
      </footer>
    </div>
  )
}

function NavMenuLink({ to, onClick, children }: { to: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `block px-4 py-2.5 text-sm hover:bg-line/40 ${isActive ? 'text-stage-mastering font-semibold' : 'text-text'}`
      }
    >
      {children}
    </NavLink>
  )
}

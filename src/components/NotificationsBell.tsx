import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type ApiNotification } from '../api'

const KIND_ICON: Record<string, string> = {
  mention: '💬',
  assigned_task: '📝',
  assigned_song_role: '🎚️',
  due_soon: '⏰',
  overdue: '🚨',
}

export default function NotificationsBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<ApiNotification[]>([])
  const [unread, setUnread] = useState(0)
  const navigate = useNavigate()

  async function load() {
    try {
      const { notifications, unreadCount } = await api.notifications()
      setItems(notifications)
      setUnread(unreadCount)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 30 * 1000)
    return () => clearInterval(t)
  }, [])

  async function openItem(n: ApiNotification) {
    if (!n.readAt) {
      void api.notificationRead(n.id).then(load).catch(() => {})
    }
    setOpen(false)
    if (n.link) navigate(n.link)
  }

  async function markAll() {
    await api.notificationsReadAll()
    await load()
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative w-9 h-9 rounded-full grid place-items-center text-lg hover:bg-line/40 transition"
        title="Notifications"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-urgent text-white text-[10px] font-bold grid place-items-center px-1 border-2 border-ink">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 sm:w-96 max-h-[70dvh] flex flex-col rounded-2xl border border-line bg-panel/95 backdrop-blur-md shadow-2xl z-20 overflow-hidden">
            <div className="flex items-center justify-between p-3 border-b border-line">
              <span className="font-bold text-sm">Notifications</span>
              {unread > 0 && (
                <button
                  onClick={() => void markAll()}
                  className="text-[11px] uppercase tracking-wider text-stage-stems hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="overflow-y-auto flex-1">
              {items.length === 0 ? (
                <p className="text-sm text-muted text-center py-8 px-4">
                  Nothing yet. You'll see @mentions, assignments, and reminders here.
                </p>
              ) : (
                <ul>
                  {items.map((n) => {
                    const isUnread = !n.readAt
                    return (
                      <li key={n.id}>
                        <button
                          onClick={() => void openItem(n)}
                          className={`w-full text-left px-4 py-3 border-b border-line/60 hover:bg-line/20 transition ${
                            isUnread ? 'bg-stage-mastering/5' : ''
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <span className="text-lg leading-tight shrink-0">
                              {KIND_ICON[n.kind] ?? '🔔'}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline gap-2">
                                <span className={`text-sm ${isUnread ? 'font-bold' : ''}`}>
                                  {n.title}
                                </span>
                                {isUnread && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-stage-mastering shrink-0" />
                                )}
                              </div>
                              <p className="text-[12px] text-muted line-clamp-2 mt-0.5">{n.body}</p>
                              <p className="text-[10px] text-muted/60 mt-1">
                                {new Date(n.createdAt).toLocaleString()}
                              </p>
                            </div>
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

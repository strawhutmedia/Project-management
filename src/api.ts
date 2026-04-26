export type Stage =
  | 'writing'
  | 'tracking'
  | 'overdubs'
  | 'producing'
  | 'stems'
  | 'mixing'
  | 'mastering'
  | 'done'

export type ApiUser = {
  id: string
  email: string
  name: string
  role: 'admin' | 'user'
  timezone: string
}

export type ApiTask = {
  id: string
  title: string
  stage: Stage
  done: boolean
  dueAt?: string | null
}

export type ApiSong = {
  id: string
  title: string
  subtitle?: string | null
  stage: Stage
  tasks: ApiTask[]
  comments: unknown[]
  links: unknown[]
}

export type ApiProject = {
  id: string
  name: string
  subtitle?: string | null
  kind: 'album' | 'podcast' | 'film'
  songs: ApiSong[]
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'unknown' }))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  me: () => request<{ user: ApiUser | null }>('/api/me'),
  requestLogin: (email: string) =>
    request<{ ok: true }>('/api/auth/request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  verify: (token: string) =>
    request<{ ok: true; user: ApiUser }>('/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  projects: () => request<{ projects: ApiProject[] }>('/api/projects'),
  project: (id: string) => request<{ project: ApiProject }>(`/api/projects/${id}`),
}

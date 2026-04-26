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
  display_name: string | null
  role: 'admin' | 'user'
  timezone: string
}

export type ApiComment = {
  id: string
  body: string
  createdAt: string
  authorId: string
  authorName: string
}

export type ApiSongDetail = {
  id: string
  projectId: string
  projectName: string
  projectRoot: string | null
  title: string
  subtitle?: string | null
  stage: Stage
  dropboxFolder: string | null
  tasks: ApiTaskFull[]
  comments: ApiComment[]
}

export type ApiTaskFull = {
  id: string
  title: string
  stage: Stage
  done: boolean
  dueAt?: string | null
  assigneeId?: string | null
  assigneeName?: string | null
}

export type ApiDropboxStatus = {
  configured: boolean
  connected: boolean
  accountName?: string | null
}

export type ApiDropboxEntry = {
  type: 'file' | 'folder'
  name: string
  path: string
  size?: number
  modified?: string
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
  updateMe: (patch: { name?: string; displayName?: string; timezone?: string }) =>
    request<{ user: ApiUser }>('/api/me', { method: 'PATCH', body: JSON.stringify(patch) }),
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
  song: (id: string) => request<{ song: ApiSongDetail }>(`/api/songs/${id}`),
  updateSong: (id: string, patch: { stage?: Stage; title?: string; subtitle?: string; dropboxFolder?: string }) =>
    request<{ ok: true }>(`/api/songs/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  addTask: (songId: string, body: { title: string; stage?: Stage; dueAt?: string; assigneeId?: string }) =>
    request<{ task: ApiTaskFull }>(`/api/songs/${songId}/tasks`, { method: 'POST', body: JSON.stringify(body) }),
  updateTask: (taskId: string, patch: { title?: string; done?: boolean; dueAt?: string | null; assigneeId?: string | null; stage?: Stage }) =>
    request<{ ok: true }>(`/api/songs/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteTask: (taskId: string) =>
    request<{ ok: true }>(`/api/songs/tasks/${taskId}`, { method: 'DELETE' }),
  addComment: (songId: string, body: string) =>
    request<{ comment: ApiComment }>(`/api/songs/${songId}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
  deleteComment: (commentId: string) =>
    request<{ ok: true }>(`/api/songs/comments/${commentId}`, { method: 'DELETE' }),
  dropboxStatus: () => request<ApiDropboxStatus>('/api/integrations/dropbox/status'),
  dropboxDisconnect: () => request<{ ok: true }>('/api/integrations/dropbox/disconnect', { method: 'POST' }),
  dropboxList: (path: string) =>
    request<{ entries: ApiDropboxEntry[] }>(`/api/integrations/dropbox/list?path=${encodeURIComponent(path)}`),
  dropboxCreateFolder: (path: string) =>
    request<{ ok: true }>('/api/integrations/dropbox/create-folder', { method: 'POST', body: JSON.stringify({ path }) }),
}

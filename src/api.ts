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

export type ApiLink = {
  id: string
  label: string
  url: string
  createdAt: string
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
  producerId: string | null
  producerName: string | null
  mixerId: string | null
  mixerName: string | null
  tasks: ApiTaskFull[]
  comments: ApiComment[]
  links: ApiLink[]
}

export type ApiMember = {
  id: string
  email: string
  name: string
  display_name: string | null
  role: 'admin' | 'user'
}

export type ApiNotification = {
  id: string
  kind: string
  title: string
  body: string
  link: string | null
  songId: string | null
  taskId: string | null
  readAt: string | null
  createdAt: string
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

export type ApiAdminUser = {
  id: string
  email: string
  name: string
  display_name: string | null
  role: 'admin' | 'user'
  timezone: string
  created_at: string
  projects: Array<{ id: string; name: string }>
  songs: Array<{ id: string; title: string; subtitle: string | null; projectId: string; projectName: string }>
}

export type ApiAdminProject = {
  id: string
  name: string
  songs: Array<{ id: string; title: string; subtitle: string | null }>
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
  dropboxFolder?: string | null
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
  updateSong: (id: string, patch: { stage?: Stage; title?: string; subtitle?: string; dropboxFolder?: string; producerId?: string | null; mixerId?: string | null }) =>
    request<{ ok: true }>(`/api/songs/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  projectMembers: (projectId: string) =>
    request<{ members: ApiMember[] }>(`/api/projects/${projectId}/members`),
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
  dropboxShareLink: (path: string) =>
    request<{ url: string }>('/api/integrations/dropbox/share-link', { method: 'POST', body: JSON.stringify({ path }) }),
  dropboxUpload: async (folderPath: string, file: File): Promise<{ ok: true; path: string }> => {
    const res = await fetch('/api/integrations/dropbox/upload', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Folder-Path': folderPath,
        'X-File-Name': encodeURIComponent(file.name),
      },
      body: file,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'unknown' }))
      throw new Error(body.error ?? `HTTP ${res.status}`)
    }
    return res.json() as Promise<{ ok: true; path: string }>
  },
  // Project edit
  updateProject: (id: string, patch: { name?: string; subtitle?: string; dropboxFolder?: string }) =>
    request<{ ok: true }>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  // Links
  addLink: (songId: string, body: { label: string; url: string }) =>
    request<{ link: ApiLink }>(`/api/songs/${songId}/links`, { method: 'POST', body: JSON.stringify(body) }),
  updateLink: (linkId: string, patch: { label?: string; url?: string }) =>
    request<{ ok: true }>(`/api/songs/links/${linkId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteLink: (linkId: string) =>
    request<{ ok: true }>(`/api/songs/links/${linkId}`, { method: 'DELETE' }),
  // Admin
  adminUsers: () => request<{ users: ApiAdminUser[] }>('/api/admin/users'),
  adminProjects: () => request<{ projects: ApiAdminProject[] }>('/api/admin/projects'),
  adminInviteUser: (body: {
    email: string
    name: string
    displayName?: string
    role?: 'admin' | 'user'
    timezone?: string
    projectIds?: string[]
    songIds?: string[]
  }) => request<{ user: ApiAdminUser }>('/api/admin/users', { method: 'POST', body: JSON.stringify(body) }),
  adminDeleteUser: (id: string) =>
    request<{ ok: true }>(`/api/admin/users/${id}`, { method: 'DELETE' }),
  adminUpdateUser: (id: string, patch: { displayName?: string; name?: string; role?: 'admin' | 'user'; timezone?: string }) =>
    request<{ ok: true }>(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  adminGrantProject: (userId: string, projectId: string) =>
    request<{ ok: true }>(`/api/admin/users/${userId}/projects/${projectId}`, { method: 'POST' }),
  adminRevokeProject: (userId: string, projectId: string) =>
    request<{ ok: true }>(`/api/admin/users/${userId}/projects/${projectId}`, { method: 'DELETE' }),
  adminGrantSong: (userId: string, songId: string) =>
    request<{ ok: true }>(`/api/admin/users/${userId}/songs/${songId}`, { method: 'POST' }),
  adminRevokeSong: (userId: string, songId: string) =>
    request<{ ok: true }>(`/api/admin/users/${userId}/songs/${songId}`, { method: 'DELETE' }),
  // Notifications
  notifications: () => request<{ notifications: ApiNotification[]; unreadCount: number }>('/api/notifications'),
  notificationRead: (id: string) =>
    request<{ ok: true }>(`/api/notifications/${id}/read`, { method: 'POST' }),
  notificationsReadAll: () =>
    request<{ ok: true }>('/api/notifications/read-all', { method: 'POST' }),
}

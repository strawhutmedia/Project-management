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
  role: 'admin' | 'user' | 'viewer'
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

export type ApiStageOwner = { id: string; name: string } | null

export type ApiSongDetail = {
  id: string
  projectId: string
  projectName: string
  projectKind: 'album' | 'podcast' | 'film'
  projectRoot: string | null
  projectStageLabels?: Partial<Record<Stage, { label?: string; icon?: string }>>
  title: string
  subtitle?: string | null
  stage: Stage
  dropboxFolder: string | null
  stageOwners: Record<Stage, ApiStageOwner>
  stageOwnerFromDefault?: Partial<Record<Stage, boolean>>
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
  role: 'admin' | 'user' | 'viewer'
  // Per-project role on the project this member list was fetched for.
  // 'admin' for super admins (auto-access); explicit role for everyone else.
  project_role: 'admin' | 'user' | 'viewer' | null
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
  // Workspace default starting folder for file/folder pickers.
  pickerStartPath?: string | null
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
  email: string | null
  name: string
  display_name: string | null
  role: 'admin' | 'user' | 'viewer'
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

export type BudgetCategory = 'above_line' | 'production' | 'post' | 'other'

export type ApiBudgetLineItem = {
  id: string
  code: string | null
  description: string
  amt: number
  units: string | null
  x: number
  rate: number
  vendor: string | null
  datedAt: string | null
  notes: string | null
  position: number
  total: number
}

export type ApiBudgetAccount = {
  id: string
  code: string
  name: string
  category: BudgetCategory
  position: number
  lineItems: ApiBudgetLineItem[]
}

export type ApiBudget = {
  id: string
  currency: string
  shootDays: number
  bondPct: number
  contingencyPct: number
  productionTarget: number | null
  postTarget: number | null
  marketingTarget: number | null
  adminTarget: number | null
  totalTarget: number | null
  accounts: ApiBudgetAccount[]
}

export type ApiTranscriptBlock = {
  id: string
  speaker: string
  start: number
  end: number
  text: string
  words: Array<{ word: string; start: number; end: number }>
}

export type ApiTranscript = {
  id: string
  projectId: string
  songId: string | null
  dropboxPath: string
  fileName: string
  fileSizeBytes: number | null
  durationSeconds: number | null
  status: 'queued' | 'transcribing' | 'done' | 'failed'
  language: string
  startOffsetMs: number
  frameRate: number
  dropFrame: boolean
  error: string | null
  createdAt: string
  updatedAt: string
  // Only present in single-transcript responses, not list responses
  editedBlocks?: ApiTranscriptBlock[]
}

export type ApiShootDay = {
  id: string
  number: number
  isBreak: boolean
  shootDate: string | null
  notes: string | null
}

export type ApiScene = {
  id: string
  number: string
  scriptPosition: number
  slug: string
  intExt: string | null
  location: string | null
  locationTag: string | null
  timeOfDay: string | null
  page: number | null
  pageEighths: number
  characters: string[]
  notes: string | null
  shootDayId: string | null
  dayPosition: number
  locationStatus: 'unset' | 'free' | 'paid'
}

export type ApiStripboard = {
  days: ApiShootDay[]
  scenes: ApiScene[]
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
  channelsSubfolder?: string | null
  defaultOwners?: Record<string, { id: string; name: string } | null>
  stageLabels?: Partial<Record<Stage, { label?: string; icon?: string }>>
  filmPhase?: 'pre' | 'production' | 'post' | 'wrapped'
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
  updateSong: (id: string, patch: {
    stage?: Stage
    title?: string
    subtitle?: string
    dropboxFolder?: string
    writerId?: string | null
    trackerId?: string | null
    overdubId?: string | null
    producerId?: string | null
    stemsId?: string | null
    mixerId?: string | null
    masterId?: string | null
  }) =>
    request<{ ok: true }>(`/api/songs/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  projectMembers: (projectId: string) =>
    request<{ members: ApiMember[] }>(`/api/projects/${projectId}/members`),
  addProjectMember: (projectId: string, body: { userId: string; role: 'admin' | 'user' | 'viewer' }) =>
    request<{ ok: true }>(`/api/projects/${projectId}/members`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  setProjectMemberRole: (projectId: string, userId: string, role: 'admin' | 'user' | 'viewer') =>
    request<{ ok: true }>(`/api/projects/${projectId}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),
  removeProjectMember: (projectId: string, userId: string) =>
    request<{ ok: true }>(`/api/projects/${projectId}/members/${userId}`, { method: 'DELETE' }),
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
  setDropboxPickerStart: (path: string) =>
    request<{ ok: true; pickerStartPath: string }>('/api/integrations/dropbox/picker-start', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  dropboxDisconnect: () => request<{ ok: true }>('/api/integrations/dropbox/disconnect', { method: 'POST' }),
  dropboxList: (path: string, scopeSongId?: string) => {
    const qs = new URLSearchParams({ path })
    if (scopeSongId) qs.set('scopeSongId', scopeSongId)
    return request<{ entries: ApiDropboxEntry[] }>(`/api/integrations/dropbox/list?${qs.toString()}`)
  },
  dropboxCreateFolder: (path: string, scopeSongId?: string) =>
    request<{ ok: true }>('/api/integrations/dropbox/create-folder', {
      method: 'POST',
      body: JSON.stringify({ path, scopeSongId }),
    }),
  dropboxShareLink: (path: string) =>
    request<{ url: string }>('/api/integrations/dropbox/share-link', { method: 'POST', body: JSON.stringify({ path }) }),
  dropboxUpload: async (folderPath: string, file: File, scopeSongId?: string): Promise<{ ok: true; path: string }> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'X-Folder-Path': folderPath,
      'X-File-Name': encodeURIComponent(file.name),
    }
    if (scopeSongId) headers['X-Scope-Song-Id'] = scopeSongId
    const res = await fetch('/api/integrations/dropbox/upload', {
      method: 'POST',
      credentials: 'include',
      headers,
      body: file,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'unknown' }))
      throw new Error(body.error ?? `HTTP ${res.status}`)
    }
    return res.json() as Promise<{ ok: true; path: string }>
  },
  // Project edit
  updateProject: (id: string, patch: { name?: string; subtitle?: string; dropboxFolder?: string; channelsSubfolder?: string | null; defaultOwners?: Record<string, string>; filmPhase?: 'pre' | 'production' | 'post' | 'wrapped' }) =>
    request<{ ok: true }>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  addSong: (projectId: string, body: { title: string; subtitle?: string }) =>
    request<{ song: { id: string; title: string } }>(`/api/projects/${projectId}/songs`, { method: 'POST', body: JSON.stringify(body) }),
  createProject: (body: { name: string; subtitle?: string; kind?: 'album' | 'podcast' | 'film'; dropboxFolder?: string }) =>
    request<{ project: ApiProject }>('/api/projects', { method: 'POST', body: JSON.stringify(body) }),
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
    role?: 'admin' | 'user' | 'viewer'
    timezone?: string
    projectIds?: string[]
    songIds?: string[]
  }) => request<{ user: ApiAdminUser }>('/api/admin/users', { method: 'POST', body: JSON.stringify(body) }),
  adminDeleteUser: (id: string) =>
    request<{ ok: true }>(`/api/admin/users/${id}`, { method: 'DELETE' }),
  adminUpdateUser: (id: string, patch: { displayName?: string; name?: string; role?: 'admin' | 'user' | 'viewer'; timezone?: string; email?: string }) =>
    request<{ ok: true }>(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  adminGrantProject: (userId: string, projectId: string) =>
    request<{ ok: true }>(`/api/admin/users/${userId}/projects/${projectId}`, { method: 'POST' }),
  adminRevokeProject: (userId: string, projectId: string) =>
    request<{ ok: true }>(`/api/admin/users/${userId}/projects/${projectId}`, { method: 'DELETE' }),
  adminGrantSong: (userId: string, songId: string) =>
    request<{ ok: true }>(`/api/admin/users/${userId}/songs/${songId}`, { method: 'POST' }),
  adminRevokeSong: (userId: string, songId: string) =>
    request<{ ok: true }>(`/api/admin/users/${userId}/songs/${songId}`, { method: 'DELETE' }),
  // Budgets
  budget: (projectId: string) =>
    request<{ budget: ApiBudget }>(`/api/budgets/projects/${projectId}`),
  createBudget: (projectId: string, body: {
    shootDays?: number
    currency?: string
    template?: 'studiobinder' | 'blank'
    productionTarget?: number | null
    postTarget?: number | null
    marketingTarget?: number | null
    adminTarget?: number | null
    totalTarget?: number | null
  }) =>
    request<{ budget: { id: string }; created: boolean }>(`/api/budgets/projects/${projectId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateBudget: (budgetId: string, patch: {
    currency?: string
    shootDays?: number
    bondPct?: number
    contingencyPct?: number
    productionTarget?: number | null
    postTarget?: number | null
    marketingTarget?: number | null
    adminTarget?: number | null
    totalTarget?: number | null
  }) =>
    request<{ ok: true }>(`/api/budgets/${budgetId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  addBudgetItem: (accountId: string, body: {
    code?: string
    description: string
    amt?: number
    units?: string
    x?: number
    rate?: number
    vendor?: string
    datedAt?: string
    notes?: string
  }) => request<{ id: string }>(`/api/budgets/accounts/${accountId}/items`, { method: 'POST', body: JSON.stringify(body) }),
  updateBudgetItem: (itemId: string, patch: Partial<{
    code: string
    description: string
    amt: number
    units: string
    x: number
    rate: number
    vendor: string
    datedAt: string | null
    notes: string
  }>) => request<{ ok: true }>(`/api/budgets/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteBudgetItem: (itemId: string) =>
    request<{ ok: true }>(`/api/budgets/items/${itemId}`, { method: 'DELETE' }),
  // Stripboard
  stripboard: (projectId: string) =>
    request<ApiStripboard>(`/api/stripboard/projects/${projectId}`),
  importFdx: (projectId: string, xml: string) =>
    request<{ ok: true; count: number }>(`/api/stripboard/projects/${projectId}/import-fdx`, {
      method: 'POST',
      body: JSON.stringify({ xml }),
    }),
  createShootDay: (projectId: string, body: { number: number; isBreak?: boolean; shootDate?: string }) =>
    request<{ id: string }>(`/api/stripboard/projects/${projectId}/days`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateScene: (sceneId: string, patch: { shootDayId?: string | null; dayPosition?: number; locationStatus?: 'unset' | 'free' | 'paid'; notes?: string }) =>
    request<{ ok: true }>(`/api/stripboard/scenes/${sceneId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  applyBiyaSchedule: (projectId: string) =>
    request<{ ok: true; assigned: number; missing: string[] }>(
      `/api/stripboard/projects/${projectId}/apply-biya-schedule`,
      { method: 'POST' },
    ),
  // Transcripts
  transcripts: (projectId: string) =>
    request<{ transcripts: ApiTranscript[] }>(`/api/transcripts?projectId=${projectId}`),
  transcript: (id: string) =>
    request<{ transcript: ApiTranscript }>(`/api/transcripts/${id}`),
  startTranscript: (body: { projectId: string; dropboxPath: string; songId?: string | null; language?: string }) =>
    request<{ transcript: ApiTranscript }>('/api/transcripts', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateTranscript: (id: string, patch: {
    editedBlocks?: ApiTranscriptBlock[]
    startOffsetMs?: number
    frameRate?: number
    dropFrame?: boolean
  }) =>
    request<{ transcript: ApiTranscript }>(`/api/transcripts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteTranscript: (id: string) =>
    request<{ ok: true }>(`/api/transcripts/${id}`, { method: 'DELETE' }),
  transcriptSrtUrl: (id: string) => `/api/transcripts/${id}/srt`,
  transcriptVttUrl: (id: string) => `/api/transcripts/${id}/vtt`,
  transcriptTxtUrl: (id: string) => `/api/transcripts/${id}/txt`,
  transcriptMediaUrl: (id: string) =>
    request<{ url: string; fileName: string }>(`/api/transcripts/${id}/media-url`),

  // Notifications
  notifications: () => request<{ notifications: ApiNotification[]; unreadCount: number }>('/api/notifications'),
  notificationRead: (id: string) =>
    request<{ ok: true }>(`/api/notifications/${id}/read`, { method: 'POST' }),
  notificationsReadAll: () =>
    request<{ ok: true }>('/api/notifications/read-all', { method: 'POST' }),
}

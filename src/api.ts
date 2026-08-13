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
  projectCoverArtUrl?: string | null
  projectRoot: string | null
  projectStageLabels?: Partial<Record<Stage, { label?: string; icon?: string }>>
  title: string
  subtitle?: string | null
  stage: Stage
  // Public release date (YYYY-MM-DD). Surfaced for podcast episodes.
  releaseDate?: string | null
  // Upload-and-go pipeline state for podcasts.
  processingState?: 'processing' | 'ready' | 'posted' | null
  sourceFilePath?: string | null
  autopipelineStartedAt?: string | null
  autopipelineReadyAt?: string | null
  autopipelineError?: string | null
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

export type ApiEpisodeCut = {
  id: string
  songId: string
  label: string
  description: string | null
  dropboxPath: string | null
  url: string | null
  durationMs: number | null
  status: 'in_review' | 'needs_changes' | 'approved' | 'superseded'
  uploadedBy: string | null
  uploadedByName: string | null
  uploadedAt: string
  position: number
  noteCount: number
  unresolvedCount: number
}

export type ApiCutNote = {
  id: string
  cutId: string
  authorUserId: string | null
  authorName: string | null
  content: string
  timestampMs: number | null
  resolved: boolean
  resolvedAt: string | null
  resolvedBy: string | null
  createdAt: string
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
  // Scope-set version the current token was minted with. When
  // needsReconnect is true, the UI shows a "reconnect to grant new
  // permissions" banner.
  scopeVersion?: number
  needsReconnect?: boolean
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

export type ApiShowBrief = {
  business_description?: string | null
  niche?: string | null
  target_audience?: string | null
  competitors?: string | null
  growth_goals?: string | null
  current_metrics?: string | null
  monetization_current?: string | null
  constraints?: string | null
  notes?: string | null
}

export type StrategyKind =
  | 'strategy' | 'audience' | 'authority' | 'pillars'
  | 'calendar' | 'post' | 'monetization'

export type ApiStrategyDocument = {
  id: string
  kind: StrategyKind
  content: Record<string, unknown>
  input_context: string | null
  status: 'generating' | 'generated' | 'failed'
  error: string | null
  input_tokens: number
  output_tokens: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export type ApiAdminProject = {
  id: string
  name: string
  kind: 'album' | 'podcast' | 'film'
  songs: Array<{ id: string; title: string; subtitle: string | null }>
}

export type BudgetCategory = 'above_line' | 'production' | 'post' | 'other'

export type ApiLocation = {
  id: string
  tag: string
  name: string
  parentId: string | null
  position: number
  sceneCount: number
  intExt: string | null
  dayNumbers: number[]
  rooms: { name: string; sceneCount: number; dayNumbers: number[] }[]
  isGroup: boolean
}

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
  sceneId: string | null
  sceneNumber: string | null
  spansAllShootDays?: boolean
  shootDayId?: string | null
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
  castPayrollPct: number
  crewPayrollPct: number
  castPerDiemDaily: number
  crewPerDiemDaily: number
  castPerDiemHeadcount: number
  crewPerDiemHeadcount: number
  homeLocationTag: string | null
  hotelCastNightly: number
  hotelCrewNightly: number
  hotelContingencyPct: number
  mileageRatePerMi: number
  travelDays: number
  awayDaysCount: number
  autoDayCosts: number
  autoFringes: number
  autoPerDiem: number
  autoHotels: number
  autoMileage: number
  autoCrewDiscount: number
  sumOfDayBudgets: number
  daysWithCost: number
  shootDayCount: number
  runOfShootDayCount: number
  productionTarget: number | null
  postTarget: number | null
  marketingTarget: number | null
  adminTarget: number | null
  totalTarget: number | null
  accounts: ApiBudgetAccount[]
}

export type SocialItemStatus = 'idea' | 'drafted' | 'selected' | 'rejected' | 'scheduled' | 'posted'

// Optional still-frame + video-clip fields populated by the
// auto-pipeline after Claude returns timecoded suggestions. Stills
// are 5 thumbnails sampled around the moment; clip is the actual mp4
// cut at the [start - end] range. UI proxies via the Dropbox file
// route.
export type StillFields = {
  still_paths?: string[]
  still_center_s?: number
  still_window_s?: number
  still_version?: number
  clip_dropbox_path?: string | null
  clip_start_s?: number
  clip_end_s?: number
  clip_duration_s?: number
  clip_version?: number
}

export type ApiSocialItem =
  | { id: string; kind: 'text_post'; status: SocialItemStatus; ai_text: string; text: string; pushed_to_scheduler_at?: string | null }
  | ({ id: string; kind: 'story_concept'; status: SocialItemStatus; assignee_user_id: string | null; medium: 'video' | 'photo'; description: string; caption: string; suggested_clip: string; image_direction: string; pushed_to_scheduler_at?: string | null } & StillFields)
  | ({ id: string; kind: 'reel_concept'; status: SocialItemStatus; assignee_user_id: string | null; hook: string; talking_points: string[]; suggested_clip: string; pushed_to_scheduler_at?: string | null } & StillFields)
  | ({ id: string; kind: 'photo_concept'; status: SocialItemStatus; assignee_user_id: string | null; image_direction: string; caption: string; vibe: string; pushed_to_scheduler_at?: string | null } & StillFields)

export type ApiSocialPlan = {
  id: string
  projectId: string
  songId: string
  transcriptId: string | null
  items: ApiSocialItem[]
  status: 'generating' | 'generated' | 'failed'
  error: string | null
  usage: {
    inputTokens: number | null
    outputTokens: number | null
    cacheReadTokens: number | null
    cacheCreateTokens: number | null
  }
  createdAt: string
  updatedAt: string
}

export type SchedulerSlotKind = 'text_post' | 'photo_concept' | 'reel_concept' | 'story_concept'

export type ApiSchedulerItem = {
  planId: string
  itemId: string
  projectId: string
  projectName: string
  songId: string | null
  songTitle: string | null
  projectCoverArtUrl: string | null
  item: ApiSocialItem
}

export type ApiSchedulerSlot = {
  id: string
  kind: SchedulerSlotKind
  index: number
  scheduledTime: string // "HH:MM" Pacific time
  platforms: string[]
  status: 'planned' | 'posted' | 'skipped'
  item: ApiSchedulerItem | null
}

export type ApiSchedulerDay = {
  date: string // YYYY-MM-DD
  slots: ApiSchedulerSlot[]
}

export type ApiSchedulerResponse = {
  days: ApiSchedulerDay[]
  backlog: ApiSchedulerItem[]
}

export type ApiShowChatMessage = {
  id: string
  projectId: string
  role: 'user' | 'assistant'
  authorUserId: string | null
  authorDisplayName: string | null
  content: string
  model: 'sonnet' | 'opus' | null
  inputTokens: number | null
  outputTokens: number | null
  createdAt: string
}

export type ApiBrandProfile = {
  brandVoice: string
  examplePosts: string[]
  postingTimes: {
    text: string[]
    photo: string[]
    reel: string[]
    story: string[]
  }
  weeklyCadence: {
    text: number
    photo: number
    reel: number
    story: number
  }
  defaultAssignees: {
    story_video: string | null
    story_photo: string | null
    reel_concept: string | null
    photo_concept: string | null
  }
  reasoning: string
}

export type ApiPodcastSearchResult = {
  itunesId: number | null
  title: string
  artist: string | null
  feedUrl: string
  artworkUrl: string | null
  trackCount: number | null
  genre: string | null
}

export type ApiClipCaption = { startSeconds: number; endSeconds: number; text: string }

export type ApiClip = {
  id: string
  title: string | null
  durationSeconds: number | null
  startSeconds: number | null
  endSeconds: number | null
  dropboxPath: string | null
  vertical: boolean
  captioned: boolean
  captions: ApiClipCaption[]
}

export type ClipJobOptions = {
  prompt?: string | null
  clipCount?: number | null
}

export type ApiClipJob = {
  id: string
  projectId: string
  songId: string | null
  dropboxPath: string
  fileName: string
  status: 'queued' | 'processing' | 'done' | 'failed'
  error: string | null
  createdAt: string
  updatedAt: string
  options?: ClipJobOptions | null
  clips: ApiClip[]
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
  isTravel: boolean
  shootDate: string | null
  notes: string | null
  locationTag?: string | null
  travelFrom?: string | null
  travelTo?: string | null
  travelMiles?: number | null
  travelHours?: number | null
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
  actionText: string | null
  breakdownRunAt: string | null
  producerNoteSuggestion: string | null
  shootDayId: string | null
  dayPosition: number
  locationStatus: 'unset' | 'free' | 'paid'
  budgetTotal: number
  budgetItemCount: number
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
  // YYYY-MM-DD. Only surfaced in the podcast UI today; null for music/films.
  releaseDate?: string | null
  // Upload-and-go status for podcast episodes. Null for music/films.
  processingState?: 'processing' | 'ready' | 'posted' | null
  autopipelineError?: string | null
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
  socialsBrandVoice?: string | null
  socialsVocabulary?: string | null
  socialsExamplePosts?: string[]
  socialsDefaultAssignees?: Partial<Record<'story_video' | 'story_photo' | 'reel_concept' | 'photo_concept', string>>
  rssFeedUrl?: string | null
  coverArtUrl?: string | null
  brandAssetsFolder?: string | null
  brandProfile?: ApiBrandProfile | null
  brandProfileAt?: string | null
  // Guest-outreach one-sheet fields.
  slug?: string | null
  heroTagline?: string | null
  guestPitch?: string | null
  contactEmail?: string | null
  brandHex?: string | null
  oneSheetPublished?: boolean
  notableGuests?: string | null
  notableTopics?: string | null
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
    // When the server includes a `detail` field, fold it into the
    // thrown message so the UI shows the real reason (e.g. an Anthropic
    // 400 validation message) instead of an opaque code like
    // "generation_failed".
    const code = body.error ?? `HTTP ${res.status}`
    const msg = body.detail ? `${code}: ${body.detail}` : code
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

// Server-shape mirror of the carousel deck Claude returns. The
// renderer (src/lib/carouselDeckImage.ts) adapts these flat slide
// objects into its discriminated-union SlideSpec[].
export type ApiCarouselDeckSlide = {
  kind: 'cover' | 'thesis' | 'callout' | 'brand-callout' | 'finale' | 'quote'
  title?: string
  eyebrow?: string
  headline?: string
  accent?: string
  accentSecondary?: string
  body?: string
  brandLabel?: string
  diagramLayout?: 'two-circle' | 'three-stage' | 'none'
  diagramNodeAIcon?: string
  diagramNodeALabel?: string
  diagramNodeASub?: string
  diagramNodeBIcon?: string
  diagramNodeBLabel?: string
  diagramNodeBSub?: string
  diagramMidpointLabel?: string
  diagramMidpointSub?: string
  trait1Icon?: string
  trait1Word?: string
  trait2Icon?: string
  trait2Word?: string
  trait3Icon?: string
  trait3Word?: string
  bodyParagraphs?: string[]
  finalLine?: string
  lessonHeadline?: string
  lessonBody?: string
  tagline?: string
  quoteText?: string
  quoteSpeaker?: string
  needsHostPhoto?: boolean
  needsBrandLogo?: boolean
  needsCollageImage?: boolean
  assetHint?: string
}

export type ApiCarouselAssetRequest = {
  slot: 'host_photo' | 'show_logo' | 'platform_icons' | 'brand_logo' | 'collage_image'
  description: string
  slide_index: number
}

export type ApiCarouselDeckResult = {
  deck: {
    slides: ApiCarouselDeckSlide[]
    asset_requests: ApiCarouselAssetRequest[]
  }
  usage: {
    inputTokens: number
    outputTokens: number
    cacheCreationInputTokens: number
    cacheReadInputTokens: number
  }
}

export type ApiRolodexContact = {
  id: string
  email: string
  name: string
  full_name: string | null
  recipient_type: string | null
  client_name: string | null
  context: string | null
  tags: string[]
  notes: string | null
  source: string
  source_show: string | null
  created_at: string
  updated_at: string
}

export type ApiOutreachTemplate = {
  project_id: string
  subject: string
  body: string
  from_name: string | null
  reply_to: string | null
  location: string | null
  followup_subject: string | null
  followup_body: string | null
  updated_at: string
}

export type ApiFollowupEligible = {
  id: string
  name: string
  email: string
  sentAt: string
  openCount: number
  opened: boolean
  batchLabel: string | null
}

export type ApiFollowupPreview = {
  templateReady: boolean
  minDays: number
  eligible: ApiFollowupEligible[]
  followupQueued: number
  followupSent: number
}

export type ApiOutreachProspect = {
  id: string
  project_id: string
  name: string
  full_name: string | null
  email: string | null
  recipient_type: 'person' | 'agent' | 'manager' | 'other'
  client_name: string | null
  context: string | null
  unique_sentence: string | null
  unique_sentence_generated_at: string | null
  status: 'needs_email' | 'ready' | 'queued' | 'sent' | 'replied' | 'bounced' | 'opted_out' | 'failed'
  email_check_status: 'unchecked' | 'valid' | 'risky' | 'invalid'
  email_checked_at: string | null
  email_check_detail: string | null
  sent_at: string | null
  replied_at: string | null
  bounced_at: string | null
  open_count: number
  first_opened_at: string | null
  last_opened_at: string | null
  batch_label: string | null
  sending_domain_id: string | null
  created_at: string
  updated_at: string
}

export type ApiSendingDomain = {
  id: string
  name: string
  status: 'pending' | 'verifying' | 'verified' | 'failed' | 'paused'
  active: boolean
  resend_id: string | null
  primary_show_id: string | null
  primary_show_name: string | null
  warmup_start_date: string | null
  health_score: number | null
  bounce_rate: number | null
  complaint_rate: number | null
  reply_rate: number | null
  last_computed_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type ApiTeleprompterSession = {
  id: string
  name: string
  html: string
  createdAt: string
  updatedAt: string
  createdByName: string | null
  updatedByName: string | null
}

// ── Contractor invoicing (admin payroll tool) ──
export type ApiInvoiceLineItem = {
  desc: string
  hours: number
  rateCents: number
  amountCents: number
}

export type ApiContractor = {
  id: string
  name: string
  email: string
  hourlyRateCents: number
  payMethod: 'ACH' | 'Check' | 'Other'
  address: string
  notes: string
  archived: boolean
  createdAt: string
  updatedAt: string
}

export type ApiInvoice = {
  id: string
  number: string
  contractorId: string | null
  contractorName: string
  contractorEmail: string
  contractorAddress: string
  payMethod: string
  period: string
  issueDate: string
  lineItems: ApiInvoiceLineItem[]
  totalCents: number
  notes: string
  status: 'draft' | 'unpaid' | 'paid'
  paidAt: string | null
  createdAt: string
  updatedAt: string
}

export type ApiInvoiceSettings = {
  companyName: string
  companyEmail: string
  companyAddress: string
  logoDataUrl: string | null
  invoicePrefix: string
  nextNumber: number
}

export type ContractorInput = {
  name: string
  email?: string
  hourlyRateCents?: number
  payMethod?: 'ACH' | 'Check' | 'Other'
  address?: string
  notes?: string
  archived?: boolean
}

export type InvoiceInput = {
  contractorId?: string | null
  contractorName?: string
  contractorEmail?: string
  contractorAddress?: string
  payMethod?: string
  period?: string
  issueDate?: string
  number?: string
  notes?: string
  status?: 'draft' | 'unpaid' | 'paid'
  lineItems: Array<{ desc: string; hours: number; rateCents: number }>
}

export const api = {
  me: () => request<{ user: ApiUser | null }>('/api/me'),

  // Contractor invoicing
  invoiceSettings: () => request<{ settings: ApiInvoiceSettings }>('/api/invoicing/settings'),
  updateInvoiceSettings: (patch: Partial<ApiInvoiceSettings> & { logoDataUrl?: string | null }) =>
    request<{ settings: ApiInvoiceSettings }>('/api/invoicing/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
  contractors: () => request<{ contractors: ApiContractor[] }>('/api/invoicing/contractors'),
  createContractor: (body: ContractorInput) =>
    request<{ contractor: ApiContractor }>('/api/invoicing/contractors', { method: 'POST', body: JSON.stringify(body) }),
  updateContractor: (id: string, body: Partial<ContractorInput>) =>
    request<{ contractor: ApiContractor }>(`/api/invoicing/contractors/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteContractor: (id: string) =>
    request<{ ok: true }>(`/api/invoicing/contractors/${id}`, { method: 'DELETE' }),
  invoices: () => request<{ invoices: ApiInvoice[] }>('/api/invoicing/invoices'),
  invoice: (id: string) => request<{ invoice: ApiInvoice }>(`/api/invoicing/invoices/${id}`),
  createInvoice: (body: InvoiceInput) =>
    request<{ invoice: ApiInvoice }>('/api/invoicing/invoices', { method: 'POST', body: JSON.stringify(body) }),
  updateInvoice: (id: string, body: Partial<InvoiceInput>) =>
    request<{ invoice: ApiInvoice }>(`/api/invoicing/invoices/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteInvoice: (id: string) =>
    request<{ ok: true }>(`/api/invoicing/invoices/${id}`, { method: 'DELETE' }),
  invoicePdfUrl: (id: string) => `/api/invoicing/invoices/${id}/pdf`,
  emailInvoice: (id: string, to?: string) =>
    request<{ ok: true; sentTo: string }>(`/api/invoicing/invoices/${id}/email`, {
      method: 'POST',
      body: JSON.stringify(to ? { to } : {}),
    }),

  // Teleprompter — shared sessions for the podcast team.
  teleprompterList: () => request<{ sessions: ApiTeleprompterSession[] }>('/api/teleprompter'),
  teleprompterCreate: (body: { name: string; html: string }) =>
    request<{ session: ApiTeleprompterSession }>('/api/teleprompter', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  teleprompterUpdate: (id: string, body: { name: string; html: string }) =>
    request<{ ok: true; updatedAt: string }>(`/api/teleprompter/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  teleprompterDelete: (id: string) =>
    request<{ ok: true }>(`/api/teleprompter/${id}`, { method: 'DELETE' }),
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
    releaseDate?: string | null
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
  dropboxVerifyScopes: () =>
    request<{ ok: true; hasWrite: boolean; scopeVersion: number }>(
      '/api/integrations/dropbox/verify-scopes', { method: 'POST' },
    ),
  setDropboxPickerStart: (path: string) =>
    request<{ ok: true; pickerStartPath: string }>('/api/integrations/dropbox/picker-start', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  dropboxDisconnect: () => request<{ ok: true }>('/api/integrations/dropbox/disconnect', { method: 'POST' }),
  dropboxList: (path: string, opts?: { scopeSongId?: string; scopeProjectId?: string }) => {
    const qs = new URLSearchParams({ path })
    if (opts?.scopeSongId) qs.set('scopeSongId', opts.scopeSongId)
    if (opts?.scopeProjectId) qs.set('scopeProjectId', opts.scopeProjectId)
    return request<{ entries: ApiDropboxEntry[] }>(`/api/integrations/dropbox/list?${qs.toString()}`)
  },
  dropboxCreateFolder: (path: string, opts?: { scopeSongId?: string; scopeProjectId?: string }) =>
    request<{ ok: true }>('/api/integrations/dropbox/create-folder', {
      method: 'POST',
      body: JSON.stringify({ path, scopeSongId: opts?.scopeSongId, scopeProjectId: opts?.scopeProjectId }),
    }),
  dropboxShareLink: (path: string, opts?: { scopeSongId?: string; scopeProjectId?: string }) =>
    request<{ url: string }>('/api/integrations/dropbox/share-link', {
      method: 'POST',
      body: JSON.stringify({ path, scopeSongId: opts?.scopeSongId, scopeProjectId: opts?.scopeProjectId }),
    }),
  dropboxUpload: async (folderPath: string, file: File, opts?: { scopeSongId?: string; scopeProjectId?: string }): Promise<{ ok: true; path: string }> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'X-Folder-Path': folderPath,
      'X-File-Name': encodeURIComponent(file.name),
    }
    if (opts?.scopeSongId) headers['X-Scope-Song-Id'] = opts.scopeSongId
    if (opts?.scopeProjectId) headers['X-Scope-Project-Id'] = opts.scopeProjectId
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
  updateProject: (id: string, patch: { name?: string; subtitle?: string; dropboxFolder?: string; channelsSubfolder?: string | null; defaultOwners?: Record<string, string>; filmPhase?: 'pre' | 'production' | 'post' | 'wrapped'; socialsBrandVoice?: string | null; socialsVocabulary?: string | null; socialsExamplePosts?: string[]; socialsDefaultAssignees?: Partial<Record<'story_video' | 'story_photo' | 'reel_concept' | 'photo_concept', string>>; rssFeedUrl?: string | null; coverArtUrl?: string | null; brandAssetsFolder?: string | null }) =>
    request<{ ok: true }>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  uploadPodcastEpisode: (projectId: string, body: { dropboxPath: string; title?: string; releaseDate?: string | null }) =>
    request<{ episode: { id: string; title: string; processingState: 'processing' | 'ready' | 'posted' } }>(
      `/api/projects/${projectId}/episodes/from-file`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
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
  adminUpdateUserAccess: (id: string, body: { projectIds: string[]; songIds: string[] }) =>
    request<{ ok: true }>(`/api/admin/users/${id}/access`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
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
    castPayrollPct?: number
    crewPayrollPct?: number
    castPerDiemDaily?: number
    crewPerDiemDaily?: number
    castPerDiemHeadcount?: number
    crewPerDiemHeadcount?: number
    homeLocationTag?: string | null
    hotelCastNightly?: number
    hotelCrewNightly?: number
    hotelContingencyPct?: number
    travelDays?: number
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
    sceneId?: string | null
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
    sceneId: string | null
    shootDayId: string | null
    spansAllShootDays: boolean
    outfitNumber: string | null
  }>) => request<{ ok: true }>(`/api/budgets/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteBudgetItem: (itemId: string) =>
    request<{ ok: true }>(`/api/budgets/items/${itemId}`, { method: 'DELETE' }),
  presenceHeartbeat: (projectId: string, section?: string) =>
    request<{ ok: true }>(`/api/projects/${projectId}/presence/heartbeat`, {
      method: 'POST', body: JSON.stringify({ section: section ?? null }),
    }),
  claimRow: (projectId: string, rowType: string, rowId: string) =>
    request<{ ok: true }>(`/api/projects/${projectId}/presence/claim`, {
      method: 'POST', body: JSON.stringify({ rowType, rowId }),
    }),
  releaseRow: (projectId: string, rowType: string, rowId: string) =>
    request<{ ok: true }>(`/api/projects/${projectId}/presence/release`, {
      method: 'POST', body: JSON.stringify({ rowType, rowId }),
    }),
  projectClaims: (projectId: string) =>
    request<{ claims: Array<{ rowType: string; rowId: string; userId: string; displayName: string | null }> }>(
      `/api/projects/${projectId}/presence/claims`,
    ),
  projectPresence: (projectId: string) =>
    request<{
      presence: Array<{
        userId: string
        displayName: string | null
        email: string
        lastSeenAt: string
        currentSection: string | null
      }>
    }>(`/api/projects/${projectId}/presence`),
  dayBudgetItems: (shootDayId: string) =>
    request<{
      items: Array<{ id: string; accountId: string; code: string | null; description: string; amt: number; units: string | null; x: number; rate: number; vendor: string | null; datedAt: string | null; notes: string | null; position: number; total: number; spansAllShootDays: boolean; isSource: boolean; sourceShootDayId: string | null; sourceShootDayNumber: number | null }>
      scenes: Array<{ id: string; number: string; slug: string | null; itemCount: number; total: number }>
      sceneLineItems: Array<{ sceneNumber: string; sceneSlug: string | null; description: string; code: string | null; total: number }>
      wardrobe: Array<{ id: string; sceneNumber: string; description: string; notes: string | null; outfitNumber: string | null; total: number }>
      fringes: {
        castPayrollPct: number; crewPayrollPct: number
        castPerDiemPerDay: number; crewPerDiemPerDay: number
        castHotelPerDay: number; crewHotelPerDay: number
        castPerDiemDaily: number; crewPerDiemDaily: number
        castHeadcount: number; crewHeadcount: number
        hotelCastNightly: number; hotelCrewNightly: number
        hotelContingencyPct: number
        dayHotelCost: number; needsHotels: boolean
        dayLocationTag: string | null; homeLocationTag: string | null
        dayMileage: number; mileageRate: number; travelMiles: number
        billableMiles: number; studioZoneMi: number
        travelFrom: string | null; travelTo: string | null
        isTravel: boolean; mileageHeadcount: number
        travelHours: number | null; crewTravelMultiplier: number
      }
    }>(
      `/api/budgets/shoot-days/${shootDayId}/items`,
    ),
  quickAddDayCost: (shootDayId: string, body: { description: string; cost: number; code?: string; vendor?: string }) =>
    request<{ ok: true; id: string }>(
      `/api/budgets/shoot-days/${shootDayId}/quick-add`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  autoAddCastForDay: (shootDayId: string) =>
    request<{ ok: true; added: number; characters?: string[]; message?: string }>(
      `/api/budgets/shoot-days/${shootDayId}/auto-add-cast`,
      { method: 'POST' },
    ),
  clusterWardrobe: (projectId: string) =>
    request<{ ok: true; characters: number; outfitsCreated: number; itemsConsolidated: number }>(
      `/api/budgets/projects/${projectId}/cluster-wardrobe`,
      { method: 'POST' },
    ),
  consolidateWardrobe: (projectId: string) =>
    request<{ ok: true; charactersFound: number; consolidated: number }>(
      `/api/budgets/projects/${projectId}/consolidate-wardrobe`,
      { method: 'POST' },
    ),
  populateCastFromScript: (projectId: string) =>
    request<{ ok: true; count: number }>(
      `/api/budgets/projects/${projectId}/populate-cast-from-script`,
      { method: 'POST' },
    ),
  resetBudgetPrices: (projectId: string, keepCategories: BudgetCategory[]) =>
    request<{ ok: true; zeroed: number; keptCategories: string[] }>(
      `/api/budgets/projects/${projectId}/reset-prices`,
      { method: 'POST', body: JSON.stringify({ keepCategories }) },
    ),
  sceneBudgetItems: (sceneId: string) =>
    request<{
      items: Array<{
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
        resourceType: string | null
        resourceKey: string | null
        sceneUsageCount: number
        isSceneOnly: boolean
      }>
    }>(`/api/budgets/scenes/${sceneId}/items`),
  promoteItemToShared: (itemId: string, body: { sceneId: string; kind: 'LOCATION' | 'CHARACTER' }) =>
    request<{ ok: true; resourceType: string; resourceKey: string }>(
      `/api/budgets/items/${itemId}/promote-to-shared`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  // Locations
  locations: (projectId: string) =>
    request<{ locations: ApiLocation[] }>(`/api/locations/projects/${projectId}`),
  createLocation: (projectId: string, name: string) =>
    request<{ ok: true; id: string }>(`/api/locations/projects/${projectId}`, {
      method: 'POST', body: JSON.stringify({ name }),
    }),
  updateLocation: (id: string, patch: { parentId?: string | null; name?: string; position?: number }) =>
    request<{ ok: true }>(`/api/locations/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteLocation: (id: string) =>
    request<{ ok: true }>(`/api/locations/${id}`, { method: 'DELETE' }),
  // Stripboard
  stripboard: (projectId: string) =>
    request<ApiStripboard>(`/api/stripboard/projects/${projectId}`),
  importFdx: (projectId: string, xml: string, fileName?: string) =>
    request<{ ok: true; count: number; breakdownStarted?: boolean }>(`/api/stripboard/projects/${projectId}/import-fdx`, {
      method: 'POST',
      body: JSON.stringify({ xml, fileName }),
    }),
  sceneBreakdown: (sceneId: string) =>
    request<{ ok: true; itemsCreated: number; itemsSuggested: number }>(
      `/api/stripboard/scenes/${sceneId}/breakdown`,
      { method: 'POST' },
    ),
  reanalyzeAllScenes: (projectId: string) =>
    request<{ ok: true; sceneCount: number; started: true }>(
      `/api/stripboard/projects/${projectId}/reanalyze-all`,
      { method: 'POST' },
    ),
  proposeAutoSchedule: (projectId: string, body: { shootDays: number; maxPagesPerDay: number; useOpus?: boolean; notes?: string }) =>
    request<{
      ok: true
      proposal: {
        shootDays: Array<{
          number: number
          isBreak: boolean
          sceneNumbers: string[]
          notes: string
          warnings: string[]
          pagesTotal: number
          locations: string[]
        }>
        summary: string
        unscheduled: string[]
        warnings: string[]
      }
    }>(`/api/stripboard/projects/${projectId}/auto-schedule/propose`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  applyAutoSchedule: (projectId: string, proposal: unknown) =>
    request<{ ok: true; snapshotId: string }>(
      `/api/stripboard/projects/${projectId}/auto-schedule/apply`,
      { method: 'POST', body: JSON.stringify({ proposal }) },
    ),
  breakdownProgress: (projectId: string) =>
    request<{
      totalScenes: number
      withActionText: number
      withBreakdown: number
      isRunning: boolean
      isStale: boolean
      lastRunAt: string | null
    }>(`/api/stripboard/projects/${projectId}/breakdown-progress`),
  scheduleSnapshots: (projectId: string) =>
    request<{
      snapshots: Array<{
        id: string
        name: string
        description: string | null
        createdAt: string
        sceneCount: number
        shootDayCount: number
      }>
    }>(`/api/stripboard/projects/${projectId}/schedule-snapshots`),
  saveScheduleSnapshot: (projectId: string, body: { name: string; description?: string }) =>
    request<{ ok: true; id: string }>(
      `/api/stripboard/projects/${projectId}/schedule-snapshots`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  restoreScheduleSnapshot: (snapshotId: string) =>
    request<{ ok: true }>(`/api/stripboard/snapshots/${snapshotId}/restore`, { method: 'POST' }),
  deleteScheduleSnapshot: (snapshotId: string) =>
    request<{ ok: true }>(`/api/stripboard/snapshots/${snapshotId}`, { method: 'DELETE' }),
  scriptArchive: (projectId: string) =>
    request<{
      archive: null | {
        id: string
        fileName: string | null
        byteSize: number
        sceneCount: number
        uploadedAt: string
      }
    }>(`/api/stripboard/projects/${projectId}/script-archive`),
  scriptDiff: (projectId: string) =>
    request<{
      diff: null | {
        added: Array<{ number: string; slug: string; location: string | null; timeOfDay: string | null; intExt: string | null; characters: string[]; pageEighths: number }>
        removed: Array<{ number: string; slug: string; location: string | null; pageEighths: number }>
        changed: Array<{
          number: string
          changes: string[]
          before: { slug: string; location: string | null; timeOfDay: string | null; pageEighths: number; characters: string[]; actionTextLen: number }
          after: { slug: string; location: string | null; timeOfDay: string | null; pageEighths: number; characters: string[]; actionTextLen: number }
        }>
        unchanged: number
      }
      uploadId?: string
      uploadedAt?: string
      fileName?: string | null
      reviewedAt?: string | null
    }>(`/api/stripboard/projects/${projectId}/script-diff`),
  markScriptDiffReviewed: (projectId: string) =>
    request<{ ok: true }>(
      `/api/stripboard/projects/${projectId}/script-diff/mark-reviewed`,
      { method: 'POST' },
    ),
  reparseArchivedScript: (projectId: string) =>
    request<{ ok: true; sceneCount: number; archivedAt: string; fileName: string | null }>(
      `/api/stripboard/projects/${projectId}/reparse-archived`,
      { method: 'POST' },
    ),
  scriptArchiveDownloadUrl: (projectId: string) =>
    `/api/stripboard/projects/${projectId}/script-archive/download`,
  createShootDay: (projectId: string, body: { number: number; isBreak?: boolean; shootDate?: string }) =>
    request<{ id: string }>(`/api/stripboard/projects/${projectId}/days`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateShootDay: (shootDayId: string, patch: { locationTag?: string | null; shootDate?: string | null; notes?: string; isBreak?: boolean; travelFrom?: string | null; travelTo?: string | null; travelMiles?: number | null; travelHours?: number | null }) =>
    request<{ ok: true }>(`/api/stripboard/shoot-days/${shootDayId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  updateScene: (sceneId: string, patch: { shootDayId?: string | null; dayPosition?: number; locationStatus?: 'unset' | 'free' | 'paid'; notes?: string; producerNoteSuggestion?: string | null }) =>
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
  transcriptClaudePass: (id: string) =>
    request<{
      summary: string
      speakerCount: number
      speakers: Array<{ original: string; name: string; confidence: 'high' | 'medium' | 'low' }>
      vocabularyChangesApplied: number
      suggestedChanges: Array<{ from: string; to: string; reason: string }>
      correctedBlocks: ApiTranscriptBlock[]
    }>(`/api/transcripts/${id}/claude-pass`, { method: 'POST' }),
  // Socials (Claude-generated daily content plans)
  socialPlans: (songId: string) =>
    request<{ plans: ApiSocialPlan[] }>(`/api/socials?songId=${songId}`),
  socialPlan: (id: string) =>
    request<{ plan: ApiSocialPlan }>(`/api/socials/${id}`),
  generateSocialPlan: (songId: string) =>
    request<{ plan: ApiSocialPlan }>('/api/socials', {
      method: 'POST',
      body: JSON.stringify({ songId }),
    }),
  updateSocialItem: (planId: string, itemId: string, patch: Record<string, unknown>) =>
    request<{ plan: ApiSocialPlan }>(`/api/socials/${planId}`, {
      method: 'PATCH',
      body: JSON.stringify({ itemId, patch }),
    }),
  deleteSocialPlan: (id: string) =>
    request<{ ok: true }>(`/api/socials/${id}`, { method: 'DELETE' }),
  regenerateSocialItem: (planId: string, itemId: string) =>
    request<{ ok: true; item: ApiSocialItem }>(`/api/socials/${planId}/regenerate-item`, {
      method: 'POST',
      body: JSON.stringify({ itemId }),
    }),
  regenerateStills: (planId: string, itemId: string, shiftSeconds = 5) =>
    request<{ ok: true; item: ApiSocialItem }>(`/api/socials/${planId}/regenerate-stills`, {
      method: 'POST',
      body: JSON.stringify({ itemId, shiftSeconds }),
    }),
  showBrief: (projectId: string) =>
    request<{ brief: ApiShowBrief | null }>(`/api/show-brief/projects/${projectId}`),
  saveShowBrief: (projectId: string, brief: ApiShowBrief) =>
    request<{ ok: true }>(`/api/show-brief/projects/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify(brief),
    }),
  socialStrategyDocs: (projectId: string) =>
    request<{ documents: Record<string, ApiStrategyDocument | undefined> }>(
      `/api/social-strategy/projects/${projectId}`,
    ),
  generateSocialStrategyDoc: (projectId: string, kind: StrategyKind, inputContext?: string) =>
    request<{ document: ApiStrategyDocument }>(
      `/api/social-strategy/projects/${projectId}/${kind}`,
      { method: 'POST', body: JSON.stringify({ inputContext }) },
    ),
  updateSocialStrategyDoc: (projectId: string, kind: StrategyKind, content: unknown) =>
    request<{ ok: true }>(
      `/api/social-strategy/projects/${projectId}/${kind}`,
      { method: 'PATCH', body: JSON.stringify({ content }) },
    ),
  deleteSocialStrategyDoc: (projectId: string, kind: StrategyKind) =>
    request<{ ok: true }>(
      `/api/social-strategy/projects/${projectId}/${kind}`,
      { method: 'DELETE' },
    ),
  generateCarouselDeck: (body: {
    transcript: string
    showName: string
    hostName?: string
    presetKey: string
    episodeTitle?: string
    episodeNumber?: number
    // When present, the server loads the show's strategy docs and
    // feeds them to Claude so the deck aligns with the strategy.
    projectId?: string
  }) =>
    request<ApiCarouselDeckResult>('/api/carousel/preview', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  // Auto-derived carousel design for a show (palette + wordmark from its cover
  // art). refresh=true re-derives (e.g. after the cover changes).
  getCarouselPreset: (projectId: string, refresh = false) =>
    request<{
      preset: {
        key: string; displayName: string
        logo: { name1: string; name2: string; weight?: 'black' | 'bold' }
        palette: { primary: string; secondary: string; bg: string; ink: string; inkDim: string }
      } | null
      source?: string; reason?: string
    }>(`/api/carousel/preset/${projectId}${refresh ? '?refresh=1' : ''}`),
  // The /api/integrations/dropbox/file proxy 302-redirects to a fresh
  // 4hr temp link. <img src> works directly with this.
  dropboxFileUrl: (path: string) => `/api/integrations/dropbox/file?path=${encodeURIComponent(path)}`,
  socialTextPostsTxtUrl: (planId: string) => `/api/socials/${planId}/text-posts.txt`,
  importPodcastRss: (projectId: string, rssFeedUrl: string) =>
    request<{ rssFeedUrl: string; coverArtUrl: string | null; title: string | null; description: string | null }>(
      `/api/projects/${projectId}/import-rss`,
      { method: 'POST', body: JSON.stringify({ rssFeedUrl }) },
    ),
  searchPodcasts: (q: string) =>
    request<{ results: ApiPodcastSearchResult[] }>(`/api/podcasts/search?q=${encodeURIComponent(q)}`),

  // Per-show chat — see server/routes/show_chat.ts
  showChat: (projectId: string) =>
    request<{
      messages: ApiShowChatMessage[]
      dailyCapCents: number
      spentCents24h: number
    }>(`/api/projects/${projectId}/chat`),
  showChatSend: (projectId: string, body: { content: string; useOpus?: boolean }) =>
    request<{
      userMessage: ApiShowChatMessage
      assistantMessage: ApiShowChatMessage
      spentCents24h: number
      dailyCapCents: number
    }>(`/api/projects/${projectId}/chat`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  showChatDelete: (projectId: string, messageId: string) =>
    request<{ ok: true }>(`/api/projects/${projectId}/chat/${messageId}`, {
      method: 'DELETE',
    }),
  listBrandAssets: (projectId: string) =>
    request<{ folder: string | null; error?: string; assets: Array<{ name: string; dropboxPath: string; size: number | null; modified: string | null }> }>(
      `/api/projects/${projectId}/brand-assets`,
    ),
  generateBrandProfile: (projectId: string) =>
    request<{ profile: ApiBrandProfile; generatedAt: string }>(`/api/projects/${projectId}/brand-profile`, { method: 'POST' }),

  // Social content scheduler
  scheduler: (from: string, to: string) =>
    request<ApiSchedulerResponse>(`/api/scheduler?from=${from}&to=${to}`),
  updateSchedulerSlot: (slotId: string, patch: {
    planId?: string | null
    itemId?: string | null
    scheduledTime?: string
    platforms?: string[]
    status?: 'planned' | 'posted' | 'skipped'
  }) => request<{ ok: true }>(`/api/scheduler/slots/${slotId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  }),
  pushToScheduler: (planId: string, itemId: string) =>
    request<{ ok: true }>('/api/scheduler/push', {
      method: 'POST',
      body: JSON.stringify({ planId, itemId }),
    }),
  unpushFromScheduler: (planId: string, itemId: string) =>
    request<{ ok: true }>('/api/scheduler/unpush', {
      method: 'POST',
      body: JSON.stringify({ planId, itemId }),
    }),
  createSchedulerItem: (body: {
    projectId: string
    kind: SchedulerSlotKind
    fields: Record<string, unknown>
  }) => request<{ ok: true; planId: string; itemId: string }>('/api/scheduler/items', {
    method: 'POST',
    body: JSON.stringify(body),
  }),

  // Clips (Slate ffmpeg cutter)
  clipJobs: (songId: string) =>
    request<{ jobs: ApiClipJob[] }>(`/api/clips?songId=${songId}`),
  clipJob: (id: string) =>
    request<{ job: ApiClipJob }>(`/api/clips/${id}`),
  startClipJob: (body: { projectId: string; songId: string; dropboxPath: string; options?: ClipJobOptions }) =>
    request<{ job: ApiClipJob }>('/api/clips', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteClipJob: (id: string) =>
    request<{ ok: true }>(`/api/clips/${id}`, { method: 'DELETE' }),
  // Fresh (short-lived) Dropbox link to play / download one clip.
  clipLink: (clipId: string) =>
    request<{ url: string }>(`/api/clips/clip/${clipId}/link`),
  // Edit a clip's captions (fix spellings) → re-burns onto the clean clip.
  editClipCaptions: (clipId: string, captions: ApiClipCaption[]) =>
    request<{ clip: ApiClip }>(`/api/clips/clip/${clipId}/captions`, {
      method: 'PATCH',
      body: JSON.stringify({ captions }),
    }),

  transcriptSrtUrl: (id: string) => `/api/transcripts/${id}/srt`,
  transcriptVttUrl: (id: string) => `/api/transcripts/${id}/vtt`,
  transcriptTxtUrl: (id: string) => `/api/transcripts/${id}/txt`,
  transcriptMediaUrl: (id: string) =>
    request<{ url: string; fileName: string }>(`/api/transcripts/${id}/media-url`),

  // Episode cuts + per-cut notes
  episodeCuts: (songId: string) =>
    request<{ cuts: ApiEpisodeCut[] }>(`/api/songs/${songId}/cuts`),
  createEpisodeCut: (songId: string, body: { label: string; description?: string; dropboxPath?: string; url?: string; durationMs?: number }) =>
    request<{ ok: true; id: string }>(`/api/songs/${songId}/cuts`, {
      method: 'POST', body: JSON.stringify(body),
    }),
  updateEpisodeCut: (cutId: string, patch: Partial<{ label: string; description: string | null; dropboxPath: string | null; url: string | null; durationMs: number | null; status: 'in_review' | 'needs_changes' | 'approved' | 'superseded' }>) =>
    request<{ ok: true }>(`/api/cuts/${cutId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteEpisodeCut: (cutId: string) =>
    request<{ ok: true }>(`/api/cuts/${cutId}`, { method: 'DELETE' }),
  cutNotes: (cutId: string) =>
    request<{ notes: ApiCutNote[] }>(`/api/cuts/${cutId}/notes`),
  createCutNote: (cutId: string, body: { content: string; timestampMs?: number | null }) =>
    request<{ ok: true; id: string }>(`/api/cuts/${cutId}/notes`, {
      method: 'POST', body: JSON.stringify(body),
    }),
  updateCutNote: (noteId: string, patch: { resolved?: boolean; content?: string }) =>
    request<{ ok: true }>(`/api/notes/${noteId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteCutNote: (noteId: string) =>
    request<{ ok: true }>(`/api/notes/${noteId}`, { method: 'DELETE' }),

  // Guest outreach — per-show template + prospects
  oneSheetStatus: (projectId: string) =>
    request<{
      approvedAt: string | null
      editedSinceApproval: boolean
      history: Array<{ id: string; approvedAt: string; approvedByName: string | null }>
    }>(`/api/outreach/projects/${projectId}/one-sheet/status`),
  approveOneSheet: (projectId: string) =>
    request<{ ok: true; approvedAt: string }>(
      `/api/outreach/projects/${projectId}/one-sheet/approve`, { method: 'POST' },
    ),
  restoreOneSheet: (projectId: string, approvalId: string) =>
    request<{ ok: true }>(
      `/api/outreach/projects/${projectId}/one-sheet/restore/${approvalId}`, { method: 'POST' },
    ),
  testOpenStatus: (projectId: string) =>
    request<{ test: { to: string; openCount: number; lastOpenedAt: string | null; sentAt: string | null } | null }>(
      `/api/outreach/projects/${projectId}/test-open-status`,
    ),
  enableOpenTracking: () =>
    request<{ ok: true; results: Array<{ domain: string; ok: boolean; detail?: string }> }>(
      `/api/outreach/enable-open-tracking`, { method: 'POST' },
    ),
  getRolodex: () =>
    request<{ contacts: ApiRolodexContact[] }>(`/api/outreach/rolodex`),
  addRolodexBulk: (contacts: Array<{
    name: string; email: string; fullName?: string;
    recipientType?: 'person' | 'agent' | 'manager' | 'other'; clientName?: string;
    context?: string; notes?: string;
  }>) =>
    request<{ ok: true; added: number; skipped: number }>(`/api/outreach/rolodex/bulk`, {
      method: 'POST', body: JSON.stringify({ contacts }),
    }),
  deleteRolodexContact: (id: string) =>
    request<{ ok: true }>(`/api/outreach/rolodex/${id}`, { method: 'DELETE' }),
  importRolodexToProject: (projectId: string, contactIds: string[]) =>
    request<{ ok: true; imported: number; dupes: number }>(
      `/api/outreach/projects/${projectId}/rolodex-import`,
      { method: 'POST', body: JSON.stringify({ contactIds }) },
    ),
  outreachTemplate: (projectId: string) =>
    request<{ template: ApiOutreachTemplate | null }>(`/api/outreach/projects/${projectId}/template`),
  saveOutreachTemplate: (projectId: string, body: { subject: string; body: string; fromName?: string; replyTo?: string; location?: string }) =>
    request<{ ok: true }>(`/api/outreach/projects/${projectId}/template`, {
      method: 'PUT', body: JSON.stringify(body),
    }),
  saveFollowupTemplate: (projectId: string, body: { subject: string; body: string }) =>
    request<{ ok: true }>(`/api/outreach/projects/${projectId}/followup-template`, {
      method: 'PUT', body: JSON.stringify(body),
    }),
  followupPreview: (projectId: string, minDays?: number) =>
    request<ApiFollowupPreview>(
      `/api/outreach/projects/${projectId}/followup/preview${minDays != null ? `?minDays=${minDays}` : ''}`,
    ),
  sendFollowupCampaign: (
    projectId: string,
    opts?: { prospectIds?: string[]; minDays?: number; startPreset?: 'now' | '5am_pt'; startAt?: string },
  ) =>
    request<{ ok: true; queued: number; scheduled: boolean; startAt: string; firstAt: string; lastAt: string }>(
      `/api/outreach/projects/${projectId}/followup/send`,
      { method: 'POST', body: JSON.stringify({
        prospectIds: opts?.prospectIds ?? null,
        minDays: opts?.minDays ?? null,
        startPreset: opts?.startPreset ?? 'now',
        startAt: opts?.startAt ?? null,
      }) },
    ),
  testSendFollowup: (projectId: string, to: string) =>
    request<{ ok: true; from: string; to: string; subject: string; previewName: string }>(
      `/api/outreach/projects/${projectId}/followup/test-send`,
      { method: 'POST', body: JSON.stringify({ to }) },
    ),
  outreachProspects: (projectId: string) =>
    request<{ prospects: ApiOutreachProspect[] }>(`/api/outreach/projects/${projectId}/prospects`),
  addOutreachProspect: (projectId: string, body: {
    name: string; fullName?: string; email?: string;
    recipientType?: 'person' | 'agent' | 'manager' | 'other';
    clientName?: string; context?: string;
  }) =>
    request<{ prospect: ApiOutreachProspect }>(`/api/outreach/projects/${projectId}/prospects`, {
      method: 'POST', body: JSON.stringify(body),
    }),
  generateUniqueSentence: (prospectId: string) =>
    request<{ ok: true; sentence: string }>(`/api/outreach/prospects/${prospectId}/generate-sentence`, {
      method: 'POST', body: JSON.stringify({}),
    }),
  generateAllUniqueSentences: (projectId: string, overwrite = false) =>
    request<{ ok: true; generated: number; failed: number; insufficientContext: number }>(
      `/api/outreach/projects/${projectId}/generate-all-sentences`,
      { method: 'POST', body: JSON.stringify({ overwrite }) },
    ),
  syncRssCovers: () =>
    request<{ ok: true; synced: number; skipped: number }>(
      '/api/outreach/sync-rss-covers', { method: 'POST', body: JSON.stringify({}) },
    ),
  autoPopulateOneSheet: (projectId: string) =>
    request<{ ok: true; url: string | null; heroTagline: string; guestPitch: string; notableGuests: string; notableTopics: string; brandHex: string }>(
      `/api/outreach/projects/${projectId}/auto-populate-one-sheet`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  verifyOutreachEmails: (projectId: string) =>
    request<{ ok: true; checked: number; valid: number; risky: number; invalid: number }>(
      `/api/outreach/projects/${projectId}/verify-emails`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  sendOutreachCampaign: (
    projectId: string,
    opts?: { prospectIds?: string[]; startPreset?: 'now' | '5am_pt'; startAt?: string },
  ) =>
    request<{
      ok: true; queued: number; scheduled: boolean; startAt: string;
      estimatedMinutes: number; firstAt: string; lastAt: string;
      domainsUsed: number; perDomain: number[];
    }>(
      `/api/outreach/projects/${projectId}/send-campaign`,
      { method: 'POST', body: JSON.stringify({
        prospectIds: opts?.prospectIds ?? null,
        startPreset: opts?.startPreset ?? 'now',
        startAt: opts?.startAt ?? null,
      }) },
    ),
  testSendOutreach: (projectId: string, to: string, prospectId?: string) =>
    request<{ ok: true; from: string; to: string; subject: string; previewName: string }>(
      `/api/outreach/projects/${projectId}/test-send`,
      { method: 'POST', body: JSON.stringify({ to, prospectId }) },
    ),
  bulkImportProspects: (projectId: string, rows: Array<{
    name: string; fullName?: string; email?: string;
    recipientType?: 'person' | 'agent' | 'manager' | 'other';
    clientName?: string; context?: string;
  }>, batchLabel?: string) =>
    request<{ imported: number; failed: number; duplicates: number; batchLabel: string; results: Array<{ row: number; ok: boolean; error?: string; id?: string }> }>(
      `/api/outreach/projects/${projectId}/prospects/bulk`,
      { method: 'POST', body: JSON.stringify({ rows, batchLabel }) },
    ),
  updateOutreachProspect: (id: string, patch: Partial<{
    name: string; fullName: string | null; email: string | null;
    recipientType: 'person' | 'agent' | 'manager' | 'other';
    clientName: string | null; context: string | null;
    uniqueSentence: string | null; status: string;
  }>) =>
    request<{ ok: true }>(`/api/outreach/prospects/${id}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    }),
  deleteOutreachProspect: (id: string) =>
    request<{ ok: true }>(`/api/outreach/prospects/${id}`, { method: 'DELETE' }),
  clearAllOutreachProspects: (projectId: string, keepSent = false) =>
    request<{ ok: true; deleted: number }>(
      `/api/outreach/projects/${projectId}/prospects${keepSent ? '?keep=sent' : ''}`,
      { method: 'DELETE' },
    ),

  // Guest outreach — sending-domain pool
  outreachDomains: () =>
    request<{ domains: ApiSendingDomain[] }>('/api/admin/outreach/domains'),
  addOutreachDomain: (body: { name: string; notes?: string; primaryShowId?: string }) =>
    request<{ domain: ApiSendingDomain }>('/api/admin/outreach/domains', {
      method: 'POST', body: JSON.stringify(body),
    }),
  updateOutreachDomain: (id: string, patch: {
    active?: boolean; status?: string; notes?: string | null;
    primaryShowId?: string | null; resendId?: string | null;
  }) =>
    request<{ ok: true }>(`/api/admin/outreach/domains/${id}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    }),
  deleteOutreachDomain: (id: string) =>
    request<{ ok: true }>(`/api/admin/outreach/domains/${id}`, { method: 'DELETE' }),
  syncOutreachDomainsWithResend: () =>
    request<{
      ok: true;
      resendDomainsSeen: Array<{ name: string; status: string; region: string | null }>;
      changes: Array<{
        name: string;
        before: { status: string; resend_id: string | null };
        after: { status: string; resend_id: string | null };
        resendVisibility: 'visible' | 'missing';
        resendStatus: string | null;
        action: 'updated' | 'unchanged' | 'missing_in_resend';
      }>;
    }>('/api/admin/outreach/domains/sync-with-resend', { method: 'POST' }),

  // Notifications
  notifications: () => request<{ notifications: ApiNotification[]; unreadCount: number }>('/api/notifications'),
  notificationRead: (id: string) =>
    request<{ ok: true }>(`/api/notifications/${id}/read`, { method: 'POST' }),
  notificationsReadAll: () =>
    request<{ ok: true }>('/api/notifications/read-all', { method: 'POST' }),
}

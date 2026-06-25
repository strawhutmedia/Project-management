// Publish a project's parsed script + breakdown + schedule to the status
// branch as `projects/<slug>/script.json`. Lets Claude read the full
// material during a chat session via the GitHub MCP tools — no manual
// "share" step. Called automatically:
//   - after an .fdx upload (so Claude sees the script immediately)
//   - after the per-project breakdown finishes (so Claude sees Claude's
//     own suggestions and any prices the producer has attached)
//
// Idempotent — overwrites on each call.
import { pool } from './db'
import { writeStatusFile, statusReportingEnabled } from './github'
import { logError, logInfo } from './diag'

// Debounced publish queue. When a producer is rapidly editing budget
// prices or shuffling scenes, we don't want a GitHub write per
// keystroke. markProjectDirty schedules a publish 30 seconds out;
// subsequent calls within that window reset the timer so only ONE
// publish fires after the producer pauses. Per-project — different
// projects don't interfere.
const pendingPublishes = new Map<string, NodeJS.Timeout>()
const DEBOUNCE_MS = 30_000

export function markProjectDirty(projectId: string): void {
  const existing = pendingPublishes.get(projectId)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    pendingPublishes.delete(projectId)
    void publishProjectScript(projectId).catch((err) => {
      logError('debounced publish failed', {
        projectId,
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }, DEBOUNCE_MS)
  pendingPublishes.set(projectId, timer)
}

export async function publishProjectScript(projectId: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  if (!statusReportingEnabled()) {
    logInfo('publishProjectScript: skipped, no GITHUB_TOKEN', { projectId })
    return { ok: false, error: 'no_github_token' }
  }
  try {
    const proj = await pool.query<{ name: string }>(
      `SELECT name FROM projects WHERE id = $1`, [projectId],
    )
    if (proj.rows.length === 0) return { ok: false, error: 'not_found' }
    const projectName = proj.rows[0].name
    const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

    const projMeta = await pool.query<{
      name: string; subtitle: string | null; kind: string;
      dropbox_folder: string | null; channels_subfolder: string | null;
      film_phase: string | null; cover_art_url: string | null;
      socials_brand_voice: string | null; socials_vocabulary: string | null;
      rss_feed_url: string | null; brand_assets_folder: string | null;
      created_by: string | null; created_at: string;
    }>(
      `SELECT name, subtitle, kind, dropbox_folder, channels_subfolder,
              film_phase, cover_art_url, socials_brand_voice, socials_vocabulary,
              rss_feed_url, brand_assets_folder, created_by, created_at
       FROM projects WHERE id = $1`,
      [projectId],
    )
    const members = await pool.query<{
      user_id: string; display_name: string | null; email: string | null; role: string; project_role: string | null;
    }>(
      `SELECT m.user_id, u.display_name, u.email, u.role, m.role AS project_role
       FROM project_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.project_id = $1
       ORDER BY u.display_name`,
      [projectId],
    )
    const scenes = await pool.query(
      `SELECT id, number, script_position, slug, int_ext, location, location_tag,
              time_of_day, page, page_eighths, characters, action_text, notes,
              breakdown_run_at, producer_note_suggestion, shoot_day_id, day_position
       FROM scenes WHERE project_id = $1 ORDER BY script_position ASC`,
      [projectId],
    )
    const items = await pool.query(
      `SELECT li.id, li.scene_id, li.code, li.description, li.amt, li.x, li.rate,
              li.units, li.notes, li.vendor, li.dated_at,
              li.resource_type, li.resource_key,
              a.name AS account_name, a.category
       FROM budget_line_items li
       JOIN budget_accounts a ON a.id = li.account_id
       JOIN budgets b ON b.id = a.budget_id
       WHERE b.project_id = $1
       ORDER BY li.scene_id NULLS LAST, li.position ASC`,
      [projectId],
    )
    const days = await pool.query(
      `SELECT id, number, is_break, shoot_date, notes FROM shoot_days
       WHERE project_id = $1 ORDER BY number ASC`,
      [projectId],
    )
    const songs = await pool.query(
      `SELECT id, title, subtitle, stage, position, dropbox_folder,
              release_date, processing_state, created_at
       FROM songs WHERE project_id = $1 ORDER BY position ASC, created_at ASC`,
      [projectId],
    )
    const songIds = songs.rows.map((s: { id: string }) => s.id)
    const tasksRes = songIds.length > 0 ? await pool.query(
      `SELECT id, song_id, title, stage, done, due_at, assignee_id, created_at
       FROM tasks WHERE song_id = ANY($1) ORDER BY created_at ASC`,
      [songIds],
    ) : { rows: [] as Array<{
      id: string; song_id: string; title: string; stage: string; done: boolean;
      due_at: string | null; assignee_id: string | null; created_at: string;
    }> }
    const commentsRes = songIds.length > 0 ? await pool.query(
      `SELECT c.id, c.song_id, c.body, c.created_at,
              u.display_name AS author_name, c.author_id
       FROM comments c
       LEFT JOIN users u ON u.id = c.author_id
       WHERE c.song_id = ANY($1) ORDER BY c.created_at ASC`,
      [songIds],
    ) : { rows: [] as Array<{
      id: string; song_id: string; body: string; created_at: string;
      author_name: string | null; author_id: string | null;
    }> }
    const linksRes = songIds.length > 0 ? await pool.query(
      `SELECT id, song_id, label, url, created_at
       FROM links WHERE song_id = ANY($1) ORDER BY created_at ASC`,
      [songIds],
    ) : { rows: [] as Array<{
      id: string; song_id: string; label: string; url: string; created_at: string;
    }> }
    const cutsRes = songIds.length > 0 ? await pool.query(
      `SELECT c.id, c.song_id, c.label, c.description, c.dropbox_path, c.url,
              c.duration_ms, c.status, c.uploaded_at,
              u.display_name AS uploaded_by_name
       FROM episode_cuts c
       LEFT JOIN users u ON u.id = c.uploaded_by
       WHERE c.song_id = ANY($1) ORDER BY c.uploaded_at DESC`,
      [songIds],
    ) : { rows: [] as Array<{
      id: string; song_id: string; label: string; description: string | null;
      dropbox_path: string | null; url: string | null; duration_ms: number | null;
      status: string; uploaded_at: string; uploaded_by_name: string | null;
    }> }
    const cutIds = cutsRes.rows.map((c) => c.id)
    const cutNotesRes = cutIds.length > 0 ? await pool.query(
      `SELECT n.id, n.cut_id, n.content, n.timestamp_ms, n.resolved,
              n.created_at, u.display_name AS author_name
       FROM cut_notes n LEFT JOIN users u ON u.id = n.author_user_id
       WHERE n.cut_id = ANY($1) ORDER BY n.created_at ASC`,
      [cutIds],
    ) : { rows: [] as Array<{
      id: string; cut_id: string; content: string; timestamp_ms: number | null;
      resolved: boolean; created_at: string; author_name: string | null;
    }> }
    const snapshotsRes = await pool.query<{
      id: string; name: string; description: string | null;
      created_at: string; scene_count: number; shoot_day_count: number;
    }>(
      `SELECT id, name, description, created_at, scene_count, shoot_day_count
       FROM schedule_snapshots WHERE project_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [projectId],
    )
    const showChatRes = await pool.query<{
      id: string; role: string; content: string; created_at: string;
      author_name: string | null; model: string | null;
    }>(
      `SELECT m.id, m.role, m.content, m.created_at, u.display_name AS author_name, m.model
       FROM show_chat_messages m
       LEFT JOIN users u ON u.id = m.author_user_id
       WHERE m.project_id = $1
       ORDER BY m.created_at DESC LIMIT 50`,
      [projectId],
    )

    const itemsByScene = new Map<string, unknown[]>()
    const projectLevelItems: unknown[] = []
    for (const it of items.rows) {
      const out = {
        id: it.id,
        category: it.code,
        description: it.description,
        amt: Number(it.amt),
        x: Number(it.x),
        rate: Number(it.rate),
        total: Number(it.amt) * Number(it.x) * Number(it.rate),
        notes: it.notes,
        vendor: it.vendor,
        datedAt: it.dated_at,
        account: it.account_name,
        accountCategory: it.category,
      }
      if (it.scene_id) {
        const arr = itemsByScene.get(it.scene_id) ?? []
        arr.push(out); itemsByScene.set(it.scene_id, arr)
      } else {
        projectLevelItems.push(out)
      }
    }

    // Group child rows by their parent so the dump nests naturally.
    const tasksBySong = new Map<string, unknown[]>()
    for (const t of tasksRes.rows) {
      const arr = tasksBySong.get(t.song_id) ?? []
      arr.push({
        id: t.id, title: t.title, stage: t.stage, done: t.done,
        dueAt: t.due_at, assigneeId: t.assignee_id, createdAt: t.created_at,
      })
      tasksBySong.set(t.song_id, arr)
    }
    const commentsBySong = new Map<string, unknown[]>()
    for (const c of commentsRes.rows) {
      const arr = commentsBySong.get(c.song_id) ?? []
      arr.push({
        id: c.id, content: c.body, authorName: c.author_name,
        authorId: c.author_id, createdAt: c.created_at,
      })
      commentsBySong.set(c.song_id, arr)
    }
    const linksBySong = new Map<string, unknown[]>()
    for (const l of linksRes.rows) {
      const arr = linksBySong.get(l.song_id) ?? []
      arr.push({ id: l.id, label: l.label, url: l.url, createdAt: l.created_at })
      linksBySong.set(l.song_id, arr)
    }
    const notesByCut = new Map<string, unknown[]>()
    for (const n of cutNotesRes.rows) {
      const arr = notesByCut.get(n.cut_id) ?? []
      arr.push({
        id: n.id, content: n.content, timestampMs: n.timestamp_ms,
        resolved: n.resolved, authorName: n.author_name, createdAt: n.created_at,
      })
      notesByCut.set(n.cut_id, arr)
    }
    const cutsBySong = new Map<string, unknown[]>()
    for (const c of cutsRes.rows) {
      const arr = cutsBySong.get(c.song_id) ?? []
      arr.push({
        id: c.id, label: c.label, description: c.description,
        dropboxPath: c.dropbox_path, url: c.url, durationMs: c.duration_ms,
        status: c.status, uploadedAt: c.uploaded_at, uploadedByName: c.uploaded_by_name,
        notes: notesByCut.get(c.id) ?? [],
      })
      cutsBySong.set(c.song_id, arr)
    }

    const pm = projMeta.rows[0]
    const dump = {
      project: {
        id: projectId,
        name: projectName,
        subtitle: pm?.subtitle ?? null,
        kind: pm?.kind ?? null,
        filmPhase: pm?.film_phase ?? null,
        dropboxFolder: pm?.dropbox_folder ?? null,
        channelsSubfolder: pm?.channels_subfolder ?? null,
        coverArtUrl: pm?.cover_art_url ?? null,
        brandAssetsFolder: pm?.brand_assets_folder ?? null,
        socialsBrandVoice: pm?.socials_brand_voice ?? null,
        socialsVocabulary: pm?.socials_vocabulary ?? null,
        rssFeedUrl: pm?.rss_feed_url ?? null,
        createdAt: pm?.created_at ?? null,
      },
      publishedAt: new Date().toISOString(),
      counts: {
        scenes: scenes.rows.length,
        lineItems: items.rows.length,
        sceneLevelItems: items.rows.filter((r) => r.scene_id).length,
        projectLevelItems: projectLevelItems.length,
        shootDays: days.rows.length,
        songs: songs.rows.length,
        tasks: tasksRes.rows.length,
        comments: commentsRes.rows.length,
        links: linksRes.rows.length,
        cuts: cutsRes.rows.length,
        cutNotes: cutNotesRes.rows.length,
        snapshots: snapshotsRes.rows.length,
        showChatMessages: showChatRes.rows.length,
      },
      members: members.rows.map((m) => ({
        userId: m.user_id, displayName: m.display_name, email: m.email,
        role: m.role, projectRole: m.project_role,
      })),
      shootDays: days.rows.map((d) => ({
        id: d.id, number: d.number, isBreak: d.is_break, shootDate: d.shoot_date,
        notes: (d as { notes: string | null }).notes,
      })),
      scenes: scenes.rows.map((s) => ({
        id: s.id,
        number: s.number,
        scriptPosition: s.script_position,
        slug: s.slug,
        intExt: s.int_ext,
        location: s.location,
        timeOfDay: s.time_of_day,
        page: s.page,
        pageEighths: s.page_eighths,
        characters: s.characters,
        shootDayId: s.shoot_day_id,
        dayPosition: s.day_position,
        breakdownRunAt: s.breakdown_run_at,
        producerNoteSuggestion: s.producer_note_suggestion,
        notes: s.notes,
        actionText: s.action_text,
        breakdownItems: itemsByScene.get(s.id) ?? [],
      })),
      projectLevelItems,
      songs: songs.rows.map((s) => ({
        id: s.id,
        title: s.title,
        subtitle: s.subtitle,
        stage: s.stage,
        position: s.position,
        dropboxFolder: s.dropbox_folder,
        releaseDate: s.release_date,
        processingState: s.processing_state,
        createdAt: s.created_at,
        tasks: tasksBySong.get(s.id) ?? [],
        comments: commentsBySong.get(s.id) ?? [],
        links: linksBySong.get(s.id) ?? [],
        cuts: cutsBySong.get(s.id) ?? [],
      })),
      scheduleSnapshots: snapshotsRes.rows.map((s) => ({
        id: s.id, name: s.name, description: s.description,
        createdAt: s.created_at, sceneCount: s.scene_count, shootDayCount: s.shoot_day_count,
      })),
      showChatRecent: showChatRes.rows.reverse().map((m) => ({
        id: m.id, role: m.role, content: m.content,
        authorName: m.author_name, model: m.model, createdAt: m.created_at,
      })),
    }
    const filePath = `projects/${slug}/script.json`
    const json = JSON.stringify(dump, null, 2)
    const result = await writeStatusFile(filePath, json, `script: publish ${projectName}`)
    if (!result.ok) {
      logError('publishProjectScript: github write failed', { projectId, error: result.error })
      return { ok: false, error: result.error }
    }
    logInfo('publishProjectScript: ok', { projectId, projectName, path: filePath, bytes: json.length, scenes: scenes.rows.length })
    return { ok: true, path: filePath }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logError('publishProjectScript: failed', { projectId, error: msg })
    return { ok: false, error: msg }
  }
}

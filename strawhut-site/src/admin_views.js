// Admin UI views — mirrors the capabilities of the old ASP.NET admin
// (dashboard counts, manage shows, add show) but feed-driven and simpler.

import { esc, formatDate } from './util.js';

const FONT =
  '<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">';

function adminLayout({ title, active, body, stats }) {
  const nav = [
    ['/admin', '📊 Dashboard'],
    ['/admin/analytics', '📈 Traffic'],
    ['/admin/shows', '🎙️ Shows'],
    ['/admin/shows/new', '➕ Add Show'],
    ['/admin/announcements', '📣 Announcements'],
    ['/admin/press', '📰 Press'],
    ['/admin/landing', '🎯 Landing Pages'],
    ['/admin/members', '👥 Members'],
  ]
    .map(
      ([href, label]) =>
        `<a href="${href}"${active === href ? ' class="active"' : ''}>${esc(label)}</a>`
    )
    .join('');
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Straw Hut Admin</title>${FONT}
<link rel="stylesheet" href="/styles.css"></head>
<body class="admin-body"><div class="admin-shell">
  <aside class="admin-side">
    <div class="brand">Straw Hut<span class="dot" style="color:var(--accent)">.</span></div>
    <nav class="admin-nav">${nav}</nav>
    <div style="margin-top:auto;padding:16px 8px;color:var(--muted);font-size:0.8rem">
      <a href="/" style="color:var(--muted)">← View site</a><br>
      <a href="/admin/logout" style="color:var(--muted)">Log out</a>
    </div>
  </aside>
  <main class="admin-main">${body}</main>
</div></body></html>`;
}

export function loginPage({ error } = {}) {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Admin Login · Straw Hut</title>${FONT}<link rel="stylesheet" href="/styles.css"></head>
<body class="admin-body"><div class="login-wrap"><div class="panel login-card">
  <div class="brand" style="margin-bottom:20px">Straw Hut<span class="dot" style="color:var(--accent)">.</span> Admin</div>
  ${error ? `<div class="flash err">${esc(error)}</div>` : ''}
  <form method="post" action="/admin/login">
    <div class="field"><label>Password</label>
      <input type="password" name="password" autofocus required></div>
    <button class="btn btn-primary" type="submit" style="width:100%">Log in</button>
  </form>
</div></div></body></html>`;
}

export function dashboardPage({ stats, shows, flash }) {
  const recent = shows
    .slice(0, 8)
    .map(
      (s) => `<tr>
      <td><img class="mini-art" src="${esc(s.image_url || '')}" alt=""></td>
      <td>${esc(s.title)}</td>
      <td>${s.episode_count ?? '—'}</td>
      <td>${s.last_synced ? esc(formatDate(s.last_synced)) : 'never'}</td>
      <td class="actions"><a class="btn btn-sm" href="/${esc(s.slug)}" target="_blank">View</a></td>
    </tr>`
    )
    .join('');
  const body = `
    <h1>Dashboard</h1>
    ${flash ? `<div class="flash ${flash.type}">${esc(flash.msg)}</div>` : ''}
    <div class="stat-row">
      <div class="stat blue"><div class="n">${stats.shows}</div><div class="l">Shows</div></div>
      <div class="stat green"><div class="n">${stats.episodes}</div><div class="l">Episodes</div></div>
      <div class="stat orange"><div class="n">${stats.subscribers ?? 0}</div><div class="l">Members</div></div>
    </div>
    <div class="panel">
      <h2>Quick add a podcast</h2>
      <form method="post" action="/admin/shows">
        <div class="field">
          <label>Podcast RSS feed URL</label>
          <input type="url" name="feed_url" placeholder="https://feeds.megaphone.fm/… or any podcast RSS" required>
          <div class="hint">Paste ANY podcast's RSS feed — Megaphone, Apple, Spotify, Libsyn, Buzzsprout, etc. We'll pull the artwork, description, and every episode automatically.</div>
        </div>
        <button class="btn btn-primary" type="submit">Add show</button>
      </form>
    </div>
    <div class="panel">
      <h2>Recent shows</h2>
      <table class="admin-table"><thead><tr><th></th><th>Show</th><th>Episodes</th><th>Last synced</th><th></th></tr></thead>
      <tbody>${recent || '<tr><td colspan="5" style="color:var(--muted)">No shows yet.</td></tr>'}</tbody></table>
    </div>`;
  return adminLayout({ title: 'Dashboard', active: '/admin', body });
}

export function showsAdminPage({ shows, flash }) {
  const rows = shows
    .map(
      (s) => `<tr>
      <td><img class="mini-art" src="${esc(s.image_url || '')}" alt=""></td>
      <td>${esc(s.title)}<br><span class="pill">/${esc(s.slug)}</span></td>
      <td>${s.episode_count ?? '—'}</td>
      <td>${s.show_type === 'partnered' ? '<span class="pill">Partner</span>' : '<span class="pill on">Original</span>'}${s.featured ? ' <span class="pill on">Featured</span>' : ''}</td>
      <td class="actions">
        <a class="btn btn-sm" href="/${esc(s.slug)}" target="_blank">View</a>
        <a class="btn btn-sm" href="/admin/shows/${esc(s.id)}/episodes">Episodes</a>
        <form method="post" action="/admin/shows/${esc(s.id)}/sync" style="display:inline"><button class="btn btn-sm">Sync</button></form>
        <form method="post" action="/admin/shows/${esc(s.id)}/youtube" style="display:inline"><button class="btn btn-sm" title="Find & link this show's YouTube videos">🎬 Video</button></form>
        <form method="post" action="/admin/shows/${esc(s.id)}/type" style="display:inline"><button class="btn btn-sm">${s.show_type === 'partnered' ? '→ Original' : '→ Partner'}</button></form>
        <form method="post" action="/admin/shows/${esc(s.id)}/feature" style="display:inline"><button class="btn btn-sm">${s.featured ? 'Unfeature' : 'Feature'}</button></form>
        <form method="post" action="/admin/shows/${esc(s.id)}/delete" style="display:inline" onsubmit="return confirm('Delete ${esc(s.title)}? This removes its pages.')"><button class="btn btn-sm btn-danger">Delete</button></form>
      </td>
    </tr>`
    )
    .join('');
  const body = `
    <h1>Shows</h1>
    ${flash ? `<div class="flash ${flash.type}">${esc(flash.msg)}</div>` : ''}
    <div style="margin-bottom:18px"><a class="btn btn-primary" href="/admin/shows/new">➕ Add show</a>
      <form method="post" action="/admin/import" style="display:inline;margin-left:8px" onsubmit="return confirm('Import every show from strawhutmedia.com? This runs in the background.')"><button class="btn">⬇ Import all shows from strawhutmedia.com</button></form>
      <form method="post" action="/admin/sync-all" style="display:inline;margin-left:8px"><button class="btn">🔄 Sync all feeds</button></form>
      <form method="post" action="/admin/youtube-match" style="display:inline;margin-left:8px" onsubmit="return confirm('Find and link YouTube videos for all shows? Runs in the background.')"><button class="btn">🎬 Match YouTube videos (all)</button></form>
    </div>
    <div class="panel">
      <table class="admin-table"><thead><tr><th></th><th>Show</th><th>Episodes</th><th>Type</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="color:var(--muted)">No shows yet.</td></tr>'}</tbody></table>
    </div>`;
  return adminLayout({ title: 'Shows', active: '/admin/shows', body });
}

export function newShowPage({ flash, values = {} } = {}) {
  const body = `
    <h1>Add a show</h1>
    ${flash ? `<div class="flash ${flash.type}">${esc(flash.msg)}</div>` : ''}
    <div class="panel">
      <form method="post" action="/admin/shows">
        <div class="field">
          <label>Podcast RSS feed URL *</label>
          <input type="url" name="feed_url" value="${esc(values.feed_url || '')}" placeholder="https://feeds.megaphone.fm/…" required>
          <div class="hint">Any standard podcast RSS feed. Everything else is pulled from the feed automatically.</div>
        </div>
        <div class="field">
          <label>Show type</label>
          <select name="show_type" style="width:100%;padding:12px 14px;border-radius:10px;border:1px solid var(--border);background:var(--bg-2);color:var(--text);font-family:inherit;font-size:0.95rem">
            <option value="original"${values.show_type === 'partnered' ? '' : ' selected'}>Original Show (Straw Hut Media production)</option>
            <option value="partnered"${values.show_type === 'partnered' ? ' selected' : ''}>Partner Show</option>
          </select>
        </div>
        <div class="field"><label>Spotify URL (optional)</label>
          <input type="url" name="spotify_url" value="${esc(values.spotify_url || '')}" placeholder="https://open.spotify.com/show/…"></div>
        <div class="field"><label>Apple Podcasts URL (optional)</label>
          <input type="url" name="apple_url" value="${esc(values.apple_url || '')}" placeholder="https://podcasts.apple.com/…"></div>
        <div class="field checkbox"><input type="checkbox" name="featured" id="featured" ${values.featured ? 'checked' : ''}><label for="featured" style="margin:0">Feature on homepage</label></div>
        <button class="btn btn-primary" type="submit">Add show &amp; pull episodes</button>
      </form>
    </div>`;
  return adminLayout({ title: 'Add Show', active: '/admin/shows/new', body });
}

export function announcementsPage({ announcements, subscriberCount, mailReady, flash }) {
  const rows = announcements
    .map(
      (a) => `<tr>
      <td>${esc(a.subject)}</td>
      <td>${a.sent ? `<span class="pill on">Sent (${a.sent_count})</span>` : '<span class="pill">Draft</span>'}</td>
      <td>${esc(formatDate(a.created_at))}</td>
      <td class="actions">
        ${a.sent ? '' : `<form method="post" action="/admin/announcements/${esc(a.id)}/send" style="display:inline" onsubmit="return confirm('Send “${esc(a.subject)}” to ${subscriberCount} members now?')"><button class="btn btn-sm btn-primary">Send to ${subscriberCount}</button></form>`}
        <form method="post" action="/admin/announcements/${esc(a.id)}/delete" style="display:inline" onsubmit="return confirm('Delete this announcement?')"><button class="btn btn-sm btn-danger">Delete</button></form>
      </td>
    </tr>`
    )
    .join('');
  const body = `
    <h1>Announcements</h1>
    ${flash ? `<div class="flash ${flash.type}">${esc(flash.msg)}</div>` : ''}
    ${mailReady ? '' : '<div class="flash err">Email sending is not configured yet — set <b>RESEND_API_KEY</b> on the server to send blasts. You can still draft announcements.</div>'}
    <div class="panel">
      <h2>New announcement</h2>
      <form method="post" action="/admin/announcements">
        <div class="field"><label>Subject</label><input type="text" name="subject" required placeholder="What's new at Straw Hut Media?!"></div>
        <div class="field"><label>Message (HTML allowed)</label>
          <textarea name="body_html" rows="7" required style="width:100%;padding:12px 14px;border-radius:10px;border:1px solid var(--border);background:var(--bg-2);color:var(--text);font-family:inherit;font-size:0.95rem" placeholder="Write your announcement… You can use {{unsubscribe}} for the unsubscribe link."></textarea>
        </div>
        <button class="btn btn-primary" type="submit">Save draft</button>
        <span style="color:var(--muted);margin-left:10px;font-size:0.9rem">Then click “Send” below. ${subscriberCount} members will receive it.</span>
      </form>
    </div>
    <div class="panel">
      <h2>Sent &amp; drafts</h2>
      <table class="admin-table"><thead><tr><th>Subject</th><th>Status</th><th>Created</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" style="color:var(--muted)">No announcements yet.</td></tr>'}</tbody></table>
    </div>`;
  return adminLayout({ title: 'Announcements', active: '/admin/announcements', body });
}

export function pressAdminPage({ items, flash }) {
  const rows = items
    .map(
      (p) => `<tr>
      <td>${esc(p.source || '—')}</td>
      <td><a href="${esc(p.url)}" target="_blank">${esc(p.title)}</a></td>
      <td>${p.published_at ? esc(formatDate(p.published_at)) : '—'}</td>
      <td class="actions"><form method="post" action="/admin/press/${esc(p.id)}/delete" style="display:inline"><button class="btn btn-sm btn-danger">Remove</button></form></td>
    </tr>`
    )
    .join('');
  const body = `
    <h1>Press</h1>
    ${flash ? `<div class="flash ${flash.type}">${esc(flash.msg)}</div>` : ''}
    <div style="margin-bottom:16px">
      <form method="post" action="/admin/press/refresh" style="display:inline"><button class="btn btn-primary">🔄 Refresh mentions from Google News</button></form>
      <span style="color:var(--muted);margin-left:10px;font-size:0.9rem">${items.length} mentions</span>
    </div>
    <div class="panel">
      <h2>Add a press item manually</h2>
      <form method="post" action="/admin/press">
        <div class="field"><label>Headline</label><input type="text" name="title" required></div>
        <div class="field"><label>URL</label><input type="url" name="url" required></div>
        <div class="field"><label>Outlet</label><input type="text" name="source" placeholder="e.g. Variety"></div>
        <button class="btn" type="submit">Add</button>
      </form>
    </div>
    <div class="panel">
      <table class="admin-table"><thead><tr><th>Outlet</th><th>Headline</th><th>Date</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" style="color:var(--muted)">No press yet — click “Refresh mentions”.</td></tr>'}</tbody></table>
    </div>`;
  return adminLayout({ title: 'Press', active: '/admin/press', body });
}

export function episodesAdminPage({ show, episodes, total, pageNum, perPage, flash }) {
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const rows = episodes
    .map(
      (e) => `<tr>
      <td><img class="mini-art" src="${esc(e.image_url || show.image_url || '')}" alt=""></td>
      <td>${esc(e.title)}${e.youtube_id ? ' <span class="pill on">▶ video</span>' : ''}</td>
      <td>${e.published_at ? esc(formatDate(e.published_at)) : '—'}</td>
      <td class="actions">
        <a class="btn btn-sm" href="/${esc(show.slug)}/${esc(e.slug)}" target="_blank">View</a>
        <a class="btn btn-sm btn-primary" href="/admin/episodes/${esc(e.id)}/edit">Edit</a>
      </td>
    </tr>`
    )
    .join('');
  const pager = pageCount > 1
    ? `<div style="margin-top:14px">${pageNum > 1 ? `<a class="btn btn-sm" href="/admin/shows/${esc(show.id)}/episodes?page=${pageNum - 1}">← Newer</a> ` : ''}<span class="pill">Page ${pageNum} of ${pageCount}</span>${pageNum < pageCount ? ` <a class="btn btn-sm" href="/admin/shows/${esc(show.id)}/episodes?page=${pageNum + 1}">Older →</a>` : ''}</div>`
    : '';
  const body = `
    <h1>Episodes — ${esc(show.title)}</h1>
    ${flash ? `<div class="flash ${flash.type}">${esc(flash.msg)}</div>` : ''}
    <div style="margin-bottom:14px"><a class="btn btn-sm" href="/admin/shows">← All shows</a> <span style="color:var(--muted);margin-left:8px">${total} episodes</span></div>
    <div class="panel">
      <table class="admin-table"><thead><tr><th></th><th>Episode</th><th>Date</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>
      ${pager}
    </div>`;
  return adminLayout({ title: `Episodes — ${show.title}`, active: '/admin/shows', body });
}

export function episodeEditPage({ show, episode, flash }) {
  const e = episode;
  const ta = 'width:100%;padding:12px 14px;border-radius:10px;border:1px solid var(--border);background:var(--bg-2);color:var(--text);font-family:inherit;font-size:0.95rem';
  const body = `
    <h1>Edit episode</h1>
    ${flash ? `<div class="flash ${flash.type}">${esc(flash.msg)}</div>` : ''}
    <div style="margin-bottom:14px"><a class="btn btn-sm" href="/admin/shows/${esc(show.id)}/episodes">← ${esc(show.title)} episodes</a>
      <a class="btn btn-sm" href="/${esc(show.slug)}/${esc(e.slug)}" target="_blank">View page ↗</a></div>
    <div class="panel">
      <form method="post" action="/admin/episodes/${esc(e.id)}">
        <div class="field"><label>Title</label><input type="text" name="title" value="${esc(e.title || '')}" style="${ta}"></div>
        <div class="field"><label>YouTube video ID or URL <span style="color:var(--muted)">(paste a link to add/replace the video; clear to remove)</span></label>
          <input type="text" name="youtube_id" value="${esc(e.youtube_id || '')}" style="${ta}" placeholder="e.g. dQw4w9WgXcQ or https://youtu.be/dQw4w9WgXcQ"></div>
        <div class="field"><label>Cover image URL</label><input type="url" name="image_url" value="${esc(e.image_url || '')}" style="${ta}"></div>
        <div class="field"><label>Show notes / description (HTML)</label><textarea name="description" rows="10" style="${ta}">${esc(e.description || '')}</textarea></div>
        <div class="hint" style="margin-bottom:14px">Manual edits stick — feed re-syncs won't overwrite them.</div>
        <button class="btn btn-primary" type="submit">Save episode</button>
      </form>
    </div>`;
  return adminLayout({ title: 'Edit Episode', active: '/admin/shows', body });
}

export function landingsAdminPage({ landings, flash }) {
  const rows = landings
    .map(
      (l) => `<tr>
      <td>${esc(l.title || l.headline || l.slug)}</td>
      <td><a href="/lp/${esc(l.slug)}" target="_blank">/lp/${esc(l.slug)}</a></td>
      <td>${l.indexable ? '<span class="pill on">Indexed</span>' : '<span class="pill">Hidden</span>'}</td>
      <td class="actions">
        <a class="btn btn-sm" href="/admin/landing/${esc(l.id)}/edit">Edit</a>
        <form method="post" action="/admin/landing/${esc(l.id)}/delete" style="display:inline" onsubmit="return confirm('Delete this landing page?')"><button class="btn btn-sm btn-danger">Delete</button></form>
      </td>
    </tr>`
    )
    .join('');
  const body = `
    <h1>Landing Pages</h1>
    ${flash ? `<div class="flash ${flash.type}">${esc(flash.msg)}</div>` : ''}
    <p style="color:var(--muted);max-width:640px;margin-top:-8px">Standalone, unlisted pages for Google Ads traffic — like an episode page you can fully customize. Not linked from the site; hidden from search by default.</p>
    <div style="margin:14px 0"><a class="btn btn-primary" href="/admin/landing/new">➕ New landing page</a></div>
    <div class="panel">
      <table class="admin-table"><thead><tr><th>Name</th><th>URL</th><th>Search</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" style="color:var(--muted)">No landing pages yet.</td></tr>'}</tbody></table>
    </div>`;
  return adminLayout({ title: 'Landing Pages', active: '/admin/landing', body });
}

export function landingFormPage({ flash, values = {}, isEdit = false, actionId } = {}) {
  const v = values;
  const ta = 'width:100%;padding:12px 14px;border-radius:10px;border:1px solid var(--border);background:var(--bg-2);color:var(--text);font-family:inherit;font-size:0.95rem';
  const body = `
    <h1>${isEdit ? 'Edit' : 'New'} landing page</h1>
    ${flash ? `<div class="flash ${flash.type}">${esc(flash.msg)}</div>` : ''}
    <div class="panel">
      <form method="post" action="${isEdit ? '/admin/landing/' + esc(actionId) : '/admin/landing'}">
        <div class="field"><label>Internal name *</label><input type="text" name="title" value="${esc(v.title || '')}" required placeholder="e.g. Brandi – July cocaine episode ad"></div>
        <div class="field"><label>URL slug</label><input type="text" name="slug" value="${esc(v.slug || '')}" placeholder="auto from name if blank — page will be /lp/your-slug"></div>
        <div class="field"><label>Link to an episode (optional)</label>
          <input type="text" name="episode_url" value="${esc(v.episode_url || '')}" placeholder="paste the episode URL, e.g. https://…/brandi-glanville-unfiltered/some-episode">
          <div class="hint">If set, the page uses that episode's audio/video player. Leave blank for a standalone page.</div>
        </div>
        <div class="field"><label>Headline</label><input type="text" name="headline" value="${esc(v.headline || '')}" placeholder="defaults to the episode title"></div>
        <div class="field"><label>Subhead</label><input type="text" name="subhead" value="${esc(v.subhead || '')}"></div>
        <div class="field"><label>Custom photo URL</label><input type="url" name="hero_image_url" value="${esc(v.hero_image_url || '')}" placeholder="https://… (defaults to episode/show art)"></div>
        <div class="field"><label>Body copy (HTML allowed)</label><textarea name="body_html" rows="6" style="${ta}" placeholder="Your ad-matched marketing copy. Defaults to the episode notes.">${esc(v.body_html || '')}</textarea></div>
        <div class="field"><label>Button label</label><input type="text" name="cta_label" value="${esc(v.cta_label || '')}" placeholder="e.g. Listen now"></div>
        <div class="field"><label>Button link</label><input type="url" name="cta_url" value="${esc(v.cta_url || '')}" placeholder="https://… (Apple/Spotify/subscribe link)"></div>
        <div class="field"><label>Google Ads / GA measurement ID (optional)</label><input type="text" name="gtag_id" value="${esc(v.gtag_id || '')}" placeholder="AW-XXXXXXXXX or G-XXXXXXXX"></div>
        <div class="field checkbox"><input type="checkbox" name="indexable" id="idx" ${v.indexable ? 'checked' : ''}><label for="idx" style="margin:0">Allow search engines to index this page (off = hidden, recommended for ad pages)</label></div>
        <button class="btn btn-primary" type="submit">${isEdit ? 'Save changes' : 'Create landing page'}</button>
      </form>
    </div>`;
  return adminLayout({ title: isEdit ? 'Edit Landing Page' : 'New Landing Page', active: '/admin/landing', body });
}

export function membersPage({ subscribers, flash }) {
  const rows = subscribers
    .map(
      (s) => `<tr>
      <td>${esc(s.email)}</td>
      <td>${esc(s.name || '—')}</td>
      <td>${esc(formatDate(s.created_at))}</td>
      <td class="actions"><form method="post" action="/admin/members/${esc(s.id)}/delete" style="display:inline" onsubmit="return confirm('Remove ${esc(s.email)}?')"><button class="btn btn-sm btn-danger">Remove</button></form></td>
    </tr>`
    )
    .join('');
  const csv = 'data:text/csv;charset=utf-8,' + encodeURIComponent(
    'email,name,joined\n' + subscribers.map((s) => `${s.email},"${(s.name || '').replace(/"/g, '""')}",${s.created_at}`).join('\n')
  );
  const body = `
    <h1>Members</h1>
    ${flash ? `<div class="flash ${flash.type}">${esc(flash.msg)}</div>` : ''}
    <div style="margin-bottom:16px"><a class="btn btn-sm" href="${csv}" download="strawhut-members.csv">⬇ Export CSV</a>
      <span style="color:var(--muted);margin-left:10px;font-size:0.9rem">${subscribers.length} members collected via the site's “Get updates” form.</span></div>
    <div class="panel">
      <table class="admin-table"><thead><tr><th>Email</th><th>Name</th><th>Joined</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" style="color:var(--muted)">No members yet. The signup form on the homepage will collect them.</td></tr>'}</tbody></table>
    </div>`;
  return adminLayout({ title: 'Members', active: '/admin/members', body });
}

/** Traffic dashboard: totals, week-over-week change, and the most-visited pages. */
export function analyticsPage({ stats, days }) {
  const { total, previous, top, daily } = stats;
  const delta = previous > 0 ? Math.round(((total - previous) / previous) * 100) : null;
  const max = Math.max(1, ...daily.map((d) => d.hits));
  const bars = daily
    .map((d) => {
      const label = new Date(d.day).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
      return `<div class="tv-bar" title="${esc(label)}: ${d.hits}">
        <div class="tv-fill" style="height:${Math.round((d.hits / max) * 100)}%"></div>
        <span class="tv-x">${esc(label.split(' ')[0])}</span></div>`;
    })
    .join('');
  const rows = top.length
    ? top
        .map(
          (r) => `<tr><td><a href="${esc(r.path)}" target="_blank" rel="noopener">${esc(r.path)}</a></td>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${r.hits.toLocaleString()}</td>
        <td style="width:38%"><div class="tv-track"><div class="tv-meter" style="width:${Math.round((r.hits / top[0].hits) * 100)}%"></div></div></td></tr>`
        )
        .join('')
    : '<tr><td colspan="3" style="color:var(--muted)">No visits recorded yet — counting starts from the moment this deployed.</td></tr>';
  const opts = [7, 14, 30, 90]
    .map((d) => `<a class="btn btn-sm${d === days ? ' btn-primary' : ''}" href="/admin/analytics?days=${d}">${d}d</a>`)
    .join(' ');
  const body = `
  <div class="admin-head"><h1>Traffic</h1><div>${opts}
    <form method="post" action="/admin/analytics/send-digest" style="display:inline;margin-left:10px">
      <button class="btn btn-sm" type="submit">Email me this now</button></form></div></div>
  <div class="tv-cards">
    <div class="tv-card"><div class="tv-num">${total.toLocaleString()}</div><div class="tv-lab">page views · last ${days} days</div></div>
    <div class="tv-card"><div class="tv-num">${previous.toLocaleString()}</div><div class="tv-lab">previous ${days} days</div></div>
    <div class="tv-card"><div class="tv-num" style="color:${delta === null ? 'var(--muted)' : delta >= 0 ? 'var(--accent)' : '#ff8080'}">${
      delta === null ? '—' : (delta >= 0 ? '+' : '') + delta + '%'
    }</div><div class="tv-lab">change</div></div>
    <div class="tv-card"><div class="tv-num">${top.length}</div><div class="tv-lab">pages visited</div></div>
  </div>
  ${daily.length ? `<div class="panel" style="margin-bottom:20px"><div class="tv-chart">${bars}</div></div>` : ''}
  <div class="panel">
    <h2 style="margin-top:0;font-size:1.05rem">Most visited pages</h2>
    <table class="admin-table"><thead><tr><th>Page</th><th style="text-align:right">Views</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>
  </div>
  <p style="color:var(--muted);font-size:0.85rem;margin-top:14px">
    Counted first-party in our own database — no cookies, no personal data, and unaffected by ad blockers.
    Known bots are excluded. A weekly summary is emailed every Monday.</p>`;
  return adminLayout({ title: 'Traffic', active: '/admin/analytics', body });
}

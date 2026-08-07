// Admin UI views — mirrors the capabilities of the old ASP.NET admin
// (dashboard counts, manage shows, add show) but feed-driven and simpler.

import { esc, formatDate } from './util.js';

const FONT =
  '<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">';

function adminLayout({ title, active, body, stats }) {
  const nav = [
    ['/admin', '📊 Dashboard'],
    ['/admin/shows', '🎙️ Shows'],
    ['/admin/shows/new', '➕ Add Show'],
    ['/admin/announcements', '📣 Announcements'],
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

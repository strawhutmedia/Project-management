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
      <div class="stat orange"><div class="n">${shows.filter((s) => s.featured).length}</div><div class="l">Featured</div></div>
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
      <form method="post" action="/admin/sync-all" style="display:inline;margin-left:8px"><button class="btn">🔄 Sync all feeds</button></form>
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

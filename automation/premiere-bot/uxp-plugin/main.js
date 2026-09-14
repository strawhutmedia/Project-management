/*
 * Straw Hut Edit Bot — UXP panel for Adobe Premiere Pro.
 *
 * v0.0.1 is deliberately a PROBE. It does not touch footage or build a
 * project yet. Its whole job is to prove the bridge works and report the
 * real scripting surface of THIS Premiere build back to Slate's bot-log,
 * so Claude can write the assembly against facts instead of guessing
 * method names. Once the probe comes back, main.js gains the real
 * "Build from job.json" action (import + bins + place clips at the
 * per-camera waveform offsets computed by poll.mjs).
 *
 * Config: put a bridge.local.json next to this file (gitignored):
 *   { "slateBase": "https://slate.strawhutmedia.com", "token": "<QA_SERVICE_TOKEN>" }
 * The token is the SAME read-only QA_SERVICE_TOKEN the bot already has in
 * its .env. Without it, the probe still runs and prints to the panel; it
 * just can't post to Slate.
 */

const uxp = require("uxp");

const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");

function setStatus(s) { statusEl.textContent = s; }
function log(s) {
  logEl.textContent += "\n" + s;
  logEl.scrollTop = logEl.scrollHeight;
}
function clear() { logEl.textContent = ""; }

async function loadConfig() {
  const cfg = { slateBase: "https://slate.strawhutmedia.com", token: "" };
  try {
    const fs = uxp.storage.localFileSystem;
    const folder = await fs.getPluginFolder();
    const entry = await folder.getEntry("bridge.local.json");
    const raw = await entry.read();
    const parsed = JSON.parse(raw);
    if (parsed.slateBase) cfg.slateBase = String(parsed.slateBase);
    if (parsed.token) cfg.token = String(parsed.token);
  } catch (e) {
    // no config file — probe still prints locally
  }
  return cfg;
}

async function postToSlate(level, message, data) {
  const cfg = await loadConfig();
  if (!cfg.token) {
    log("(no bridge.local.json token — printed locally only, not sent to Slate)");
    return false;
  }
  try {
    const res = await fetch(cfg.slateBase + "/api/qa/bot-log", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-qa-token": cfg.token },
      body: JSON.stringify({ source: "uxp-plugin", level, message, data }),
    });
    if (res.ok) { log("→ sent to Slate bot-log (" + res.status + ")"); return true; }
    log("→ Slate rejected: HTTP " + res.status);
    return false;
  } catch (e) {
    log("→ post failed: " + String(e && e.message ? e.message : e));
    return false;
  }
}

// Enumerate a value's callable/enumerable surface without invoking anything.
function describe(v) {
  const out = {};
  if (typeof v === "function") {
    out.kind = "class/function";
    try {
      out.static = Object.getOwnPropertyNames(v)
        .filter((n) => !["length", "name", "prototype"].includes(n));
    } catch (e) { out.static = "err:" + String(e); }
    try {
      out.methods = v.prototype
        ? Object.getOwnPropertyNames(v.prototype).filter((n) => n !== "constructor")
        : [];
    } catch (e) { out.methods = "err:" + String(e); }
  } else if (v && typeof v === "object") {
    out.kind = "object";
    try { out.keys = Object.keys(v); } catch (e) { out.keys = "err:" + String(e); }
  } else {
    out.kind = typeof v;
  }
  return out;
}

async function probe() {
  clear();
  setStatus("Probing…");
  const report = { at: new Date().toISOString(), ok: false, top: [], surface: {} };

  let ppro;
  try {
    ppro = require("premierepro");
  } catch (e) {
    setStatus("FAILED to load premierepro module");
    log("require('premierepro') threw: " + String(e && e.message ? e.message : e));
    report.error = "require premierepro failed: " + String(e);
    await postToSlate("error", "UXP probe: premierepro module not available", report);
    return;
  }

  report.ok = true;
  try { report.top = Object.keys(ppro); } catch (e) { report.top = ["err:" + String(e)]; }
  log("premierepro loaded. Top-level keys:");
  log("  " + (report.top.join(", ") || "(none enumerable)"));

  for (const k of report.top) {
    try { report.surface[k] = describe(ppro[k]); }
    catch (e) { report.surface[k] = { kind: "err", err: String(e) }; }
  }

  // Try to read the active project name — a live sanity check.
  try {
    let proj = null;
    if (ppro.Project && typeof ppro.Project.getActiveProject === "function") {
      proj = await ppro.Project.getActiveProject();
    } else if (ppro.app && ppro.app.project) {
      proj = ppro.app.project;
    }
    report.activeProject = proj ? (proj.name || proj.path || "(unnamed)") : null;
    log("Active project: " + (report.activeProject || "none open"));
  } catch (e) {
    report.activeProjectError = String(e && e.message ? e.message : e);
    log("Active project check errored: " + report.activeProjectError);
  }

  // Print the surface locally, compactly.
  log("\nAPI surface:");
  for (const k of report.top) {
    const d = report.surface[k];
    if (d.kind === "class/function") {
      const m = Array.isArray(d.methods) ? d.methods.length : "?";
      const s = Array.isArray(d.static) ? d.static.length : "?";
      log("  " + k + "  [class]  " + s + " static, " + m + " methods");
    } else if (d.kind === "object") {
      log("  " + k + "  [object]  {" + (Array.isArray(d.keys) ? d.keys.join(", ") : d.keys) + "}");
    } else {
      log("  " + k + "  [" + d.kind + "]");
    }
  }

  setStatus("Probe complete. Sending to Slate…");
  await postToSlate("ok", "UXP API probe (Premiere " + (report.activeProject !== undefined ? "live" : "?") + ")", report);
  setStatus("Done.");
}

async function showActive() {
  clear();
  setStatus("");
  try {
    const ppro = require("premierepro");
    let proj = null;
    if (ppro.Project && typeof ppro.Project.getActiveProject === "function") {
      proj = await ppro.Project.getActiveProject();
    } else if (ppro.app && ppro.app.project) {
      proj = ppro.app.project;
    }
    if (!proj) { log("No project open."); return; }
    log("name: " + (proj.name || "(unnamed)"));
    log("path: " + (proj.path || "(no path)"));
  } catch (e) {
    log("error: " + String(e && e.message ? e.message : e));
  }
}

document.getElementById("probe").addEventListener("click", probe);
document.getElementById("active").addEventListener("click", showActive);

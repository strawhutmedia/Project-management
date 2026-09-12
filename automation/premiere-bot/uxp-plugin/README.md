# Straw Hut Edit Bot — Premiere UXP plugin

This is the **bridge** that lets code actually drive Adobe Premiere Pro.
`poll.mjs` (Node) does the heavy lifting outside Premiere — reads the
Dropbox footage, computes each camera's waveform offset against the Zoom
`MASTER.WAV`, and writes a `job.json`. This plugin runs **inside** Premiere
and executes the Premiere half — import, bins, sequences, and placing each
clip at its computed offset. Two halves, one file passed between them.

## v0.0.1 is a probe (on purpose)

Premiere's UXP scripting surface differs by version, and the online docs
don't list method names reliably. So the first version does ONE thing:
loads inside Premiere, enumerates the real `require("premierepro")` API,
and POSTs it to Slate's bot-log. Claude reads that and writes the real
assembly against facts — no guessing, no screenshots.

## Install (one time)

1. Pull this branch on the edit PC so this folder exists on disk.
2. Create `bridge.local.json` next to `manifest.json` (gitignored):
   ```json
   { "slateBase": "https://slate.strawhutmedia.com", "token": "PASTE_QA_SERVICE_TOKEN" }
   ```
   Use the same `QA_SERVICE_TOKEN` already in `../.env`.
3. Open **Adobe UXP Developer Tools** → **Add Plugin** → select this
   folder's `manifest.json`.
4. Premiere Pro must be running. In the plugin's row, click **•••  → Load**.
   The panel opens inside Premiere (Window → Extensions or the panel dock).
5. Click **Probe Premiere API → send to Slate**. Confirm the panel prints
   the API surface and "sent to Slate bot-log (200)".

That's it. After the probe lands, the assembly build ships as a plugin
update — reload it the same way (UXP DevTool → ••• → Reload).

## Boundaries

Same locked-down rules as the rest of premiere-bot (see `../CLAUDE.md`):
this plugin only touches Premiere and the Dropbox footage, only talks to
`slate.strawhutmedia.com`, never sends mail, never deletes footage,
never edits creatively. It assembles the skeleton; humans edit.

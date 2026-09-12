# Premiere Bot — Claude Code on the edit machine

A locked-down Claude Code setup for the studio edit machine. It watches
Slate's QA board and, when a recording is **QA approved**, drafts the
Adobe Premiere project for that episode from the footage in the synced
Dropbox folder — and does nothing else.

Security posture (non-negotiable, per Ryan):
- Runs under a dedicated **Standard (non-admin) OS account**.
- The OS app allowlist limits that account to Adobe Creative Cloud apps
  (+ Terminal/Dropbox/Finder needed to operate).
- Claude Code's own permissions (`.claude/settings.json` here) allow only:
  reading/writing inside Dropbox + this folder, talking to
  slate.strawhutmedia.com, and opening Adobe Premiere. Web browsing tools
  are denied outright.
- The only credential on the machine is `QA_SERVICE_TOKEN`, which is
  **read-only**: it can list approved QA recordings and nothing else.

## One-time setup on the machine

1. **Create the account** (macOS): System Settings → Users & Groups →
   Add User → **Standard** → name it `editbot`. Log into it.
2. **Lock the account down**: System Settings → Screen Time (enable for
   this account) → App Limits → allow only the Adobe apps, Terminal,
   Dropbox, and Finder. (Windows equivalent: a Standard user + AppLocker /
   Family Safety app allowlist.)
3. **Sign in to Dropbox** on that account and make the podcast recordings
   folder available offline (the bot reads footage from the local sync).
4. **Sign in to Adobe Creative Cloud** and install Premiere Pro.
5. **Install Claude Code** (Terminal):
   `curl -fsSL https://claude.ai/install.sh | bash`
   then run `claude` once and sign in with the Claude account.
   (Windows PowerShell: `irm https://claude.ai/install.ps1 | iex`)
6. **Copy this folder** to the machine as `~/premiere-bot`
   (download it from GitHub or AirDrop it — the machine doesn't need git
   or repo access).
7. **Create `~/premiere-bot/.env`** from `.env.example` and paste in the
   `QA_SERVICE_TOKEN` value (Ryan has it; it's set on Railway, never
   committed to this repo).
8. **Teach it the house style** (once): open Terminal in `~/premiere-bot`,
   run `claude`, and walk through how a Premiere project is built here —
   with a finished episode's project + folder open as the reference.
   That session's job is to write `PREMIERE.md` (the conventions:
   bins, sequences, naming, multicam setup, what goes where).
9. **Start the watcher**: `node poll.mjs`. It checks Slate every 5
   minutes; each newly approved recording kicks off one headless Claude
   run that builds the project draft per `PREMIERE.md` and posts a
   desktop notification when it's ready. Keep it running in a Terminal
   tab (a launchd/Task Scheduler entry can come later once it's proven).

## What one run does

1. Reads the approved recording from Slate (title, show, record date,
   and — crucially — the **Dropbox path** picked in the QA form).
2. Resolves that path in the local Dropbox sync.
3. Builds the Premiere project draft for the episode per `PREMIERE.md`,
   inside the episode's folder.
4. Notifies, and stops. A human opens Premiere and edits — the bot
   drafts projects, it does not edit or publish anything.

Until `PREMIERE.md` is written (step 8), runs stop at step 2 and just
report what they found — deliberately.

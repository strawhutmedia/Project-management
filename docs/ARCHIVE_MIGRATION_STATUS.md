# Dropbox → AWS Archive migration — status & handoff

_Last updated: 2026-09-18. This is the living
handoff for the storage-migration project. A future session touching storage,
Dropbox deletions, the UGREENs, or the archive should read this whole file
first._

## Dashboard snapshot — 2026-09-18 08:36 PT (from Ryan's screenshot; nothing broken)

- **RHINO**: 13.277 TiB, 100% uploaded, "Finished — 11,782 files. Ready to
  verify." 1 rclone error auto-retried during the run — run the verify pass
  (`rclone check --one-way`) before calling the drive safe.
- **RECOVERY**: 11.977 TiB, 100% uploaded, 12,508 files, ready to verify.
  Same single auto-retried error note.
- **PODCASTS**: 28.089 of 32.032 TiB (~88%), live at ~45 MiB/s, ETA ~1 day.
  (The "PODCASTS ~done" note further down predates this; the real total is
  32 TiB.)
- **HENRI**: 60.434 GiB, finished, 2 files. Consistent with the Henri
  Recordings wave-2 top-up (only the missing ~7% of 926 GiB, not a re-send)
  — verify by basename+size before counting Henri as covered.
- **DROPBOX-WAVE1**: auto-paused "waiting its turn" (progress kept,
  mid-HeartBreakers). **Auto-queue is OFF**, so nothing will restart it when
  PODCASTS finishes — Ryan must either re-enable Auto-queue or hit Resume.
  Asked Ryan 2026-09-18 whether the off switch was deliberate.

## In-app verification — the "Verify against vault" button (2026-09-18, PR #80)

Ryan (verbatim intent): *"There should be a button — I don't want to have to
paste shit in terminal or PowerShell."* So verification now runs INSIDE Slate:
the Railway service already holds archive S3 read keys (`ARCHIVE_ACCESS_KEY_ID`
/ `ARCHIVE_SECRET_ACCESS_KEY` — different names from the tools'
`ARCHIVE_AWS_*`, confirmed present in Railway env), so the server compares
census vs vault itself. **A cloud session no longer needs Ryan's key paste for
wave-1/drive verification — read the button's results instead** (persisted in
`storage_verify_runs`, latest per row in `GET /api/storage/transfers`, and
each run logs a `storage verify` line that lands in the status branch's
`recentLog`). Ryan pasting keys is still the fallback for ad-hoc ledger work.

- Storage-page rows RHINO / RECOVERY / DROPBOX-WAVE1 get a
  **🔍 Verify against vault** button (`POST /api/storage/transfers/:name/verify`,
  admin): drive rows check every census file (tier 1 exact mapped path+size,
  tier 2 basename+size — Ryan's approved rule); DROPBOX-WAVE1 re-runs the
  wave-1 per-target check (tier 1 only, same as `wave1-verify.mjs`) and shows
  per-folder verdicts incl. `VERIFIED — DELETABLE`. Mapping/matching logic is
  a port of `ledger2.mjs`/`wave1-verify.mjs` — keep them in sync.
- The scary "N errors — auto-retrying" badge is now honest: it expands to show
  the actual rclone ERROR lines when they're still inside the stored log tail
  (`errorLines` on the transfers API), and says to run Verify when they've
  scrolled out. Context: rclone's `Errors:` stats counter is cumulative and
  does NOT un-count an operation that succeeded on retry — "1 error" on a
  finished run can mean zero missing files. Verify is the only truth.
- Verify runs are audits, kept forever in `storage_verify_runs`
  (migration `156`).

## ⚡ IF YOU ARE THE NEXT SESSION — DO THIS FIRST, UNPROMPTED

Wave 1 was still uploading when the last session archived. This work is
yours to resume without Ryan asking. In order:
1. Ask Ryan for the archive AWS key pair with the exact copy-paste ask in
   CLAUDE.md's archive section (he runs one grep on RED and pastes two
   values). Export them as `ARCHIVE_AWS_ACCESS_KEY_ID` /
   `ARCHIVE_AWS_SECRET_ACCESS_KEY`.
2. `cd tools/archive && node fetch-inventory.mjs
   _INVENTORY/inventory-DROPBOX-TEAM.csv inventory-DROPBOX-TEAM.csv`, then
   `node wave1-verify.mjs`.
3. Every target reporting `VERIFIED — DELETABLE` that is not yet in the
   deletion log below: delete that folder from Dropbox (folder-level, via
   the Dropbox connector — team paths are `/Straw Hut Team Folder/<group>`,
   personal ones `ns:1531957776//<name>`), per Ryan's standing approval
   quoted under "Ryan's standing rules". Update the deletion log in this
   file afterwards.
4. Report the running freed-space total to Ryan and schedule your own
   periodic check-ins until wave 1 is done (ends with `Ryan Tillotson/Old
   Dbox`), then move to "Big picture / what's next".

## The system (what exists and where)

- **Vault**: S3 `strawhut-master-archive`, us-west-2, Glacier Deep Archive,
  versioning on. ONE tree mirroring Dropbox: `1_PODCASTS / 2_CLIENTS /
  3_COURSES / 4_SOCIAL / 5_MARKETING`, plus `Ryan Tillotson/` for his
  personal-space folders (mirrors Dropbox exactly — never invent new roots).
  `_INVENTORY/` holds census files + `wave1.sh` as STANDARD storage class
  (readable without restore). ~65 TB / ~70k objects as of this writing.
- **NAS boxes**: RED = UGREEN DXP4800 Plus, 192.168.1.122 (PC 2's primary);
  BLUE = DXP4800, 192.168.1.104 (PC 1's). User `strawhutmedia`. rclone runs in
  Docker; config at `/volume1/rclone-config/rclone.conf` with `[archive]` (S3)
  and, on RED, `[dropbox]` (OAuth token) remotes.
- **Slate dashboard**: ☰ → Storage on slate.strawhutmedia.com. Server code
  `server/routes/storage.ts` (+ public registrations in `server/index.ts`),
  UI `src/pages/StoragePage.tsx`. An `archive-reporter` container on each box
  tails `/volume1/rclone-config/*.log` (row name = log filename minus `.log`,
  RED tails 20 KB, BLUE still 4 KB — upgrade pending) and POSTs to
  `POST /api/storage/transfer-report/:name` (token header `X-Storage-Token`,
  value lives in the reporter/commander container commands on the NAS and in
  the `storage_transfer_*` flow — treat as semi-secret). An
  `archive-commander` container polls `GET /api/storage/agent/commands` and
  docker stop/starts containers via `/volume1/rclone-config/containers.map`
  (format `NAME=container-name`, one per line) for the Pause/Resume buttons.
- **Transfer jobs** are throwaway rclone containers writing `--log-file
  /data/<ROWNAME>.log`. Always `copy` (never sync/move), always
  `--ignore-existing`, `--s3-no-check-bucket`, exclude `.DS_Store`,
  `Thumbs.db`, and NAS `#recycle` trees (a 239 GiB `1_PODCASTS/#recycle`
  mistake is already in the vault — cleanup via console someday; NAS keys
  can't delete).
- **Dropbox facts**: team = "Straw Hut", root (team space) namespace id
  `3230198179`, Ryan's home namespace `1531957776`. rclone defaults to home —
  ALWAYS pass `--dropbox-root-namespace 3230198179` for full-team scans or
  team-folder copies. Paths from team root: `Straw Hut Team Folder/…` and
  member folders like `Ryan Tillotson/…`. Dropbox Business trash keeps
  deleted files ~180 days (deletes are recoverable; deleted files don't count
  against quota).

## Ryan's standing rules (verbatim intent — do not loosen)

1. Delete a Dropbox folder ONLY if every file is confirmed copied — his words:
   "if you can confirm it is in archive, Red, Blue, Recovery or RHINO then
   YES". Verify by exact path+size (tier 1) or basename+size (tier 2) before
   any delete; folder-level deletes, never partial.
2. Untouched for over a year (per-file modtimes; the team census has them).
3. Never lose the folder structure; copies go to the same tree.
4. Nothing is ever deleted before its copy is confirmed. Uncertain → upload
   from Dropbox anyway (duplicates cost pennies; `--ignore-existing` protects).
5. Muhammad (Tayyab) never uses PowerShell/terminal — terminal is Ryan-only
   setup work.
6. UGREEN future: media lives on RED/BLUE until ~30 TB, then prune oldest
   FOLDERS to 15 TB — pruning plan automatic, final DELETE always a human.

## Deletion log (all verified pre-delete, all in Dropbox trash ~180 days)

Sept 16: 02_Nike 132 GiB, Revised 01 95, Revised 01 (1) 95 (vault-verified);
Michelle 149 (RED copy; PODCASTS upload carries it to vault); Meadow Linn 49
(RED CLIENTS; landed in vault Sept 17); Partners in Possibility 1.2 (RED).
Sept 17: Hollywood Horror Stories 58, The Inside Track 63, Brandi Glanville
(client) 66, Poopies 72, Murder Room 22, It's a Racquet 14, Website 11,
PurchasedMaterials 33, Decks & Marketing 7.5, Newsletter 6.5, History. Rated
R. 4.2, Virgo Sisters 7.8, Salt and Flickers 85, HeartBreakers (podcast) 137,
Straw Hut Ads 133, Podcast Primer Pro 163, Rainbow Media 310.
**Running total ≈ 1.7 TB freed.**

## Wave 1 (in flight at archive time)

`_INVENTORY/wave1.sh` (also in RED at `/volume1/rclone-config/wave1.sh`) runs
in container `dropbox-wave1` on RED, streaming ~3.1 TB of old
(untouched >1 yr), Dropbox-only folders straight to the vault, sequentially,
dashboard row **DROPBOX-WAVE1**. Completed & deleted: through Rainbow Media
(see log). Remaining at archive time: 4_SOCIAL/HeartBreakers (334 GiB, ~30%
done), then Ryan Tillotson/{You Are U, Indy Automous challenge podcast, Ryan
Personal Photos, Straw Hut General's files, Don't Be Alone with Jay Kogen
(1)(2)(3), Camera Uploads (1), Videos, Shaping Freedom Podcast, Apps 434 GiB,
Old Dbox 636 GiB}. When each folder verifies 100%, it qualifies for deletion
under the standing rules above. Throughput 15–65 GiB/h depending on what else
RED is uploading.

**To resume the loop**: run `tools/archive/wave1-verify.mjs` (see below),
delete folders that report `VERIFIED — DELETABLE` via the Dropbox connector
(paths `/Straw Hut Team Folder/<group>` or, for personal, delete
`ns:1531957776//<folder>` — the member-space paths), report totals to Ryan.
The wave logs `=== WAVE1 COMPLETE` in `/data/DROPBOX-WAVE1.log` when done.

## Tools (in `tools/archive/` of this repo)

Node scripts using the repo's own `@aws-sdk/client-s3`. They need env vars
`ARCHIVE_AWS_ACCESS_KEY_ID` / `ARCHIVE_AWS_SECRET_ACCESS_KEY` (the archive
key pair — S3 read/write, NO delete permission). **A fresh session doesn't
have them: ask Ryan.** He can re-paste the pair, or read it off RED with
`sudo grep -A4 '\[archive\]' /volume1/rclone-config/rclone.conf` (prints only
to his screen; have him paste the two values).

- `check-inventory.mjs` — list `_INVENTORY/` (census arrivals).
- `fetch-inventory.mjs <key> <outfile>` — download a census file.
- `ledger2.mjs` — THE deletion ledger: vault ∪ RED ∪ BLUE ∪ RHINO ∪ RECOVERY
  vs the timestamped team census (`inventory-DROPBOX-TEAM.csv`, format
  `SIZE;TIMESTAMP;PATH`), verdict per folder incl. the 1-year gate. Fetch the
  inventories first.
- `wave1-verify.mjs` — per-folder exact path+size verification of every
  wave-1 target against the vault.
- `wave1.sh` — the exact script running on RED (reference copy).

Census files in `_INVENTORY/`: inventory-RED.txt, -BLUE.txt (format
`SIZE ROOT/path`, roots map PODCASTS→1_PODCASTS, CLIENTS→2_CLIENTS),
-RHINO.txt, -RECOVERY.txt (drive listings), -DROPBOX.csv (home namespace,
`SIZE;PATH`), -DROPBOX-TEAM.csv (full team space, `SIZE;TIMESTAMP;PATH`).
Re-generate after major changes by re-running the scan container on RED
(see wave1.sh / git history of this doc for the docker run shapes; always
`sudo -v` first — PowerShell pastes get eaten by password prompts, and
prefer "short paste that downloads a script from `_INVENTORY`" over long
heredocs, which mangle).

## Big picture / what's next (priority order)

1. **Finish wave 1** → verify → delete → report (per the loop above).
2. **Wave 2 candidates**: LEDGER2.json (regenerate with ledger2.mjs) — next
   tier is old-but-partially-covered folders needing top-ups, notably
   **Henri Recordings** (926 GiB, 92.6% covered; becomes >1 yr on
   2026-10-24 — upload only its missing ~7%, do NOT re-send the covered 860
   GiB, match by basename+size against the vault) and **BOLO** (83%
   covered, but touched 2026-06). The huge active shows (Seen On The Screen
   13.9 TB, Naked Lunch 9.5 TB, String and Tell 7.8 TB…) are NOT deletable
   under the rules — they shrink only as episodes age past a year / wrap.
3. **RED/BLUE/RHINO/RECOVERY uploads**: PODCASTS ~done, CLIENTS resumed
   Sept 17, RHINO/RECOVERY finishing; verify each with `rclone check
   --one-way` before telling Ryan a drive is safe to swap/wipe. HDD queue
   after RHINO+RECOVERY: Rabbit, SHM #1, Octopus, Lion, Stork, Hippo —
   build the auto-slot watcher BEFORE the first swap.
4. **BLUE reporter** still tails 4 KB (RED is 20 KB) — replace BLUE's
   archive-reporter with the 20 KB `tail -c 20000` variant when convenient.
5. **Frozen until Ryan's explicit go**: the full client build (Explorer
   send-to-archive/per-file cloud icons/restore/share/prune UI), the
   30→15 TB prune cycle, duplicate-content sweep, WICKED PODCAST vs Wicked
   merge, Muhammad's no-terminal mapped-drive workflow.
6. Dropbox subscription: do NOT reduce quota until the vault verifiably
   holds everything; renewal June 23 2027 (~$2,784/yr).

## Where this session's ops history lives

Slate dashboard rows + `storage_transfer_reports` table hold transfer
history; the Dropbox trash holds every deleted folder for ~180 days; this
doc + git history of `tools/archive/` are the written record. The paused
scheduled check-in routines (Wave-1 progress checks, trigger ids trig_…)
were bound to the archived session — a new session should just run
`wave1-verify.mjs` and set up its own check-ins.

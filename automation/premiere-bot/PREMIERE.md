# Premiere project conventions — Straw Hut podcast episode

How the bot builds a Premiere project for one episode. Confirmed with Ryan
(Sept 2026). Source media lives in the episode's Dropbox folder (the
`dropboxPath` on the approved QA record).

## Naming & location
- Project file: named after the episode's folder — usually the **guest
  name** (the last path segment of `dropboxPath`).
- Save the `.prproj` **inside that same episode folder**.

## Bin structure
- `Media` (parent bin)
  - `Video` — all video clips
  - `Audio` — all standalone audio files (the separate recorder / audio SD
    card). THIS is the "good audio."
- `Cuts` — all sequences live here (multicam source sequence + `uncut`).

Import every video file into `Media/Video` and every standalone audio file
into `Media/Audio`.

## Sync method (confirmed) — per-camera waveform offset
- No matching timecode. The Zoom recorder (H6 / L12 etc.) is the master
  reference; its tracks share one start.
- Compute an INDEPENDENT offset for each camera by cross-correlating that
  camera's embedded scratch audio against the recorder's MASTER.WAV.
- This one method covers both shooting modes with no special-casing:
  - ATEM switcher: all cameras start together → offsets come out equal.
  - Canon R5C manual start/stop: each camera starts at a different time →
    each gets its own offset.
- A camera split into `...01.mp4`, `...02.mp4` (file-size spanning) is ONE
  continuous take — join per camera. (Open edge case for later: a camera
  manually stopped and restarted mid-episode, which makes a real gap, not
  a size-split span.)
- Real example folder inspected (Ep190_RyanT): recorder subfolder
  `180421_205013` with TRACK03/04.WAV (mics) + MASTER.WAV (mix); cameras
  CAM 1 / CAM 3 / CAM 4 (no CAM 2), each spanned 01+02 → 3-angle multicam.

## The "good audio" rule (important)
- **Good audio** = the standalone files in the `Audio` bin.
- **Scratch audio** = the audio baked into the video clips (camera mic).
- The final cut uses the good audio only; the scratch is never used in the
  finished layout.

## Build steps
1. Select all clips in `Video` + all clips in `Audio` → **Create
   Multi-Camera Source Sequence**, **synchronize by Audio**. Let it
   process. Put the resulting multicam source sequence in `Cuts`.
2. Open the multicam sequence. Confirm the audio starts *before* the video.
   If the video starts first, trim the head off the video so audio and
   video begin at the same point. Slide the whole thing to the far left of
   the timeline, keeping everything in sync.
3. New sequence named **`uncut`** (in `Cuts`). Drag one video clip into it
   so the sequence inherits the footage's settings, then delete that clip
   back out — `uncut` now matches the video format, empty.
4. Drag the multicam sequence into `uncut`; delete the audio it brought in.
5. Back in the multicam sequence, select **only the good audio** (the
   standalone Audio-bin tracks — never the camera scratch), copy it.
6. Paste it into `uncut` so the good audio sits on an audio track with the
   multicam video on the video track **above** it.

## v1 scope (until Premiere scripting reach is confirmed)
Do the deterministic scaffolding and STOP before the interactive multicam
sync if scripting can't drive it:
- create the project (named per above), build the `Media/Video`,
  `Media/Audio`, `Cuts` bins, import + sort every file into the right bin,
  create the empty `uncut` sequence.
- Then report clearly what's set up and what the human still needs to do
  (the multicam sync + the good-audio paste), rather than guessing.
Once confirmed scriptable, steps 1–6 run end to end.

## Later (not yet specified)
Specific effects on the audio tracks + the master track — Ryan will walk
through / screenshot these. Do not invent effects until then.

## Phase 2 idea (after assembly is proven) — transcript-driven rough cut
Uses Premiere's OWN built-in transcription (Text-Based Editing) — no
Deepgram, no AutoEdit, no extra subscription; it's included in the Adobe
plan Straw Hut already pays for.
- Silence removal + filler-word removal: Premiere already does both in the
  app; the human uses them today. Automating them depends on whether
  Premiere exposes Text-Based Editing to scripting (uncertain).
- Take selection via VERBAL CUES (Ryan's point): people usually announce
  the keeper — "that was better", "use that one", "one more time",
  "sorry, again". Reading the transcript for those markers picks the
  keeper with high confidence. Automatable subset.
- Boundary: takes with NO verbal cue (a silently better delivery) still
  need a human ear — do not guess those.
Do NOT start Phase 2 until the assembly (sync + multicam + good audio) is
proven working end to end.

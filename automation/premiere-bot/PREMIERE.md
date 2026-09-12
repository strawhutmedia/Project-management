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

# Promo / social-clip cutting notes — READ THIS BEFORE CUTTING

This is Ryan's brief to Claude (the cutter). Read it before cutting any Straw
Hut promo or social clip, and let it drive the editing decisions — pacing,
motion, text, what to keep. This is a **living list**: Ryan drops notes to
Claude in chat, Claude appends them here. Newest notes on top.

This is the SOCIAL-CLIP / PROMO bucket — short-form vertical, hook-first,
built to hold attention. It is SEPARATE from the podcast episode assembly
(`../premiere-bot/PREMIERE.md`); do not mix the two.

## Guardrails (advisor notes, always apply)
- Steal the craft, not the hype. Viral-numbers claims in "how to go viral"
  ads (194 → 1.3M views, "$1000 per 1M views") are outliers dressed as
  typical — the same trap as the Podbooster performance-claim rule. Use the
  techniques; never promise the outcome.
- Brand stays Straw Hut: real voice, no clickbait, no fake urgency.

## Notes

### 2026-09-18
- **Check the episode's PROMO MOMENTS in Slate before hunting on your own.**
  Every QA recording now carries a "Promo moments" list — separate entries the
  crew/producer called out while shooting ("guest cracks up telling the
  tour-bus story", "~20 min in"). They ride along on
  `GET /api/qa/approved` as `promoMoments` (`description`, `approxTime`,
  `calledOutBy`). Cut those first — they're the moments someone in the room
  already knew were good — then add your own finds.

### 2026-09-17
- **Keep the frame alive — motion during the story.** Don't leave a clip as
  a static talking head. Add movement: punch-in zooms on emphasis, subtle
  push/parallax, motion titles, b-roll cutaways, cut on the beat. Goal is the
  "animated / designed" feel of the Higgsfield-style promo Ryan flagged.
  (The literal one-prompt AI motion is Higgsfield's own product; approximate
  the *look* with these moves unless we adopt such a tool.)
- **Kinetic captions.** Big animated word-by-word text, the keyword of each
  phrase highlighted (color pop / scale) as it's spoken. This is a default on
  every clip, not an option.

<!-- Add new dated notes above this line. Keep each note concrete enough to
     act on while cutting (what to do, when, why). -->

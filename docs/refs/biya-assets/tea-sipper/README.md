# TEA SIPPER — screen prop (BIYA / "Back In Your Arms")

Fictional celebrity-gossip site. First appears **Sc 16** — Sawyer reads the
Kendrick/Wright divorce story on her tablet. Built to hold up when the camera
lingers, and to look alive if the shot pans or scrolls.

## Files
- `article-kendrick-wright-divorce.html` — **the hero shot.** The divorce story,
  headline verbatim from the script.
- `index.html` — homepage behind it (lead story + river + trending + ads).

Both are fully self-contained (no internet needed on set) and lock to a light
theme so a tablet in dark mode won't invert them.

## For the art dept — dropping in real photos
Every photo is a styled duotone placeholder. To swap in a real still, set a
`background-image` on the element marked `data-photo-slot` (hero on the article,
lead on the homepage) or on any `.photo` box:

```css
.photo[data-photo-slot="hero"]{
  background-image:url("kendrick-wright-premiere.jpg");
}
```

The pink/black duotone overlay and the "TEA SIPPER" corner mark stay on top, so
any photo instantly matches the site's look. Remove the `.subject` label div
once a real image is in.

## Continuity notes
- **Timeline:** in Sc 16 the *affair* is NOT public yet — this story is the
  "amicable split, cracks showing" version. The affair angle surfaces later on
  the Google results (Sc 38). Keep them consistent.
- Filler stories use **fictional** celebrities on purpose, so nothing needs
  E&O clearance.
- The "Visit Beautiful Solvang" house ad is a deliberate tie-in to the Solvang
  tourism ad in Sc 15 (podcast player) and Sc 19 (Instagram).

## Copy still to lock with the director
- Reporter byline ("Danni Vale"), outlet voice, the pull-quote wording.
- Whether the paparazzi caption references a real in-world event (XenoSouls S5
  premiere) or something else.

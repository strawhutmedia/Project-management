# Straw Hut Media — Audience Targeting & Paid-Ads Playbook

**Purpose.** This is the institutional knowledge for how Straw Hut builds paid
advertising audiences and targets them — distilled from the Podbooster download
engine and our paid-strategy decisions. **Any session building the multi-platform
ad tool in Slate (Meta + TikTok + YouTube) for the movie, or for self-promotion,
should read this first and follow the same philosophy.** It is platform-agnostic
principles + platform-specific recipes.

Owner: Ryan (ryan@strawhutmedia.com). Money rules are non-negotiable — see §9.

---

## 0. The two jobs are different — don't confuse them

- **Podbooster** drives *podcast downloads* (Google Display → landing page →
  counted IAB download). Purpose-built, keep it as-is.
- **This tool** drives *awareness and purchases* for the network, shows, and the
  **movie** — video-first, on Meta (FB+IG), TikTok, and YouTube.

A movie is **not** a download. The goal is trailer views → warm audience →
purchase/rent (or ticket / stream). Everything below serves that funnel.

---

## 1. Core philosophy (carried over from Podbooster)

1. **Reach first, restrict never.** Targeting signals should *guide* the
   platform's bidding ML, not *gate* who can see the ad. In Google/Meta terms:
   run audiences in **observation / signal mode**, not exclusive targeting.
   Over-restricting a niche audience = near-zero delivery. We learned this the
   hard way on Podbooster (campaigns got zero impressions when a dimension was
   left in targeting-only mode). Let the algorithm find buyers inside a broad
   pool that your signals *point at*.
2. **The creative is the targeting.** Especially on TikTok and Meta Advantage+,
   the algorithm reads who engages with a creative and finds more of them. A
   great hook out-targets any manual audience. Budget for **many creatives**,
   not many manual audiences.
3. **First-party data is the flywheel.** Your pixel + email list + video
   viewers + site visitors are worth more than any interest target. Everything
   we do should *feed* these audiences (this is the core argument for landing
   pages — see §7).
4. **Deliver the goal, spend as little as possible, keep the data honest.**
   Start small, kill losers fast, pour budget into winners. Never report a
   number we can't defend.

---

## 2. The audience ladder (build in this order, warm → cold)

Value density is highest at the top. Spend disproportionately retargeting warm
audiences; use cold only to *fill the top of the funnel*.

1. **Retargeting (warmest):** people who already touched us — site/landing-page
   visitors, trailer/video viewers (25%/50%/75% watched), email openers/clickers,
   social engagers, past buyers. **Highest ROI. Never skip.**
2. **Lookalikes / similar audiences:** 1–3% lookalikes seeded from the best
   first-party source (purchasers > 75% video viewers > site visitors > email
   list). This is how you scale a warm audience to cold reach that still converts.
3. **Interest / custom-intent (cold, guided):** fans of comparable titles,
   actors, directors, genres; in-market for "movies/rentals"; keyword/URL custom
   intent on YouTube. Use as *signals*, kept broad.
4. **Broad / Advantage+ (cold, algorithm-led):** minimal targeting, let the
   platform optimize on the conversion event + creative. Works best once the
   pixel has learned from real conversions.

---

## 3. Meta (Facebook + Instagram) — one system, two placements

FB and IG are the **same** Meta campaign; the FB / IG checkboxes in the tool are
just **placement toggles**. One Meta Marketing API integration covers both.

- **Custom Audiences:** website (pixel) visitors, video viewers, IG/FB engagers,
  email-list upload (hashed), past purchasers.
- **Lookalikes:** 1% (tightest) → 3% → 5% from the strongest source above.
- **Advantage+ Audience:** feed it your audiences as *suggestions*, let it expand.
  This is the modern default — don't hard-restrict.
- **Detailed targeting (cold):** interests = comparable films/franchises, the
  cast, the director, genre communities, film-fan behaviors. Keep it broad enough
  that the ML has room.
- **Placements:** Advantage+ placements (auto) unless you have a reason to pin.
  Deliver vertical 9:16 for Reels/Stories + 1:1/4:5 for feed.
- **Objective:** Awareness/Video Views for the top funnel; Sales/Conversions
  (Purchase event on the landing page) for the bottom.

## 4. TikTok — creative-led, separate API

- **Custom Audiences:** pixel visitors, video engagement (viewers, profile
  visitors, followers), list upload.
- **Lookalikes:** from pixel/engagement sources.
- **Interest & behavior + hashtag/creator targeting**, kept broad.
- **Spark Ads / creator-style native video is king.** Polished trailer cutdowns
  underperform native, hook-first, first-1.5-seconds content. Test volume.
- **Objective:** Video Views / Reach top funnel; Web Conversions (pixel Purchase)
  bottom funnel. TikTok converts worse to off-platform *purchase* than Meta —
  weight it toward **awareness + retargeting fuel**, not last-click sales.

## 5. YouTube / Google (add for the movie — trailer pre-roll is elite for film)

- **Custom intent:** searches + competitor/genre keywords + URLs (comparable
  film sites, review sites, "where to watch <similar movie>").
- **In-market:** Movies, Movie Tickets, specific genres.
- **Affinity / similar audiences** + **remarketing lists** (site + viewers).
- Video ads are watched *on YouTube itself* — no app-switch friction — which is
  why film trailers perform here. Strong for awareness AND consideration.

## 6. Movie-specific audience seeds (starter list)

- Fans of **comparable films/franchises** (pick 5–10 true comps), the **cast**,
  the **director**, and adjacent creators.
- **Genre in-market** + film-festival / cinephile / physical-media interests.
- **Geo**: national for streaming/VOD; tight geo around venues/dates for any
  theatrical or festival run.
- **Retarget trailer viewers HARD** — 50%+ video viewers are your highest-intent
  cold-to-warm converters. Sequence them into the "Where to Watch" creative.

---

## 7. Landing page vs. direct retailer link — **use a landing page**

For the movie (and any purchasable title), **send paid traffic to our own
"Where to Watch" landing page**, not straight to Apple/Amazon/Tubi/YouTube. Why:

- **You keep the pixel.** A direct retailer link gives us *zero* data — we can't
  retarget the ~95% who don't buy on the first click, can't build lookalikes,
  can't measure. The landing page is what makes §2's flywheel spin. This alone
  wins the argument.
- **Buyer chooses their native platform.** People purchase where their payment
  is already set up. Offering all options (Apple / Amazon / YouTube / Tubi)
  captures each person instead of losing the ones who don't use the one you
  forced them to.
- **You can steer to the most profitable option.** Order/feature the highest-
  margin platform first (note: Tubi is ad-supported/free — a different economics
  from Apple/Amazon TVOD rentals; the page lets us route intent accordingly).
- **Attribution + optimization.** Per-platform click tracking tells us what
  converts, so we optimize spend.
- **Warmth.** Trailer + synopsis + social proof + "Where to Watch" primes the
  purchase better than a cold retailer product page.

The one cost is a single extra click (some drop-off). It's **massively**
outweighed, because most film purchases don't happen on first exposure — they
happen after **retargeting**, which is impossible without our pixel and page.

**Reuse what we already have:** this is the exact strawhut-site / Podbooster
landing-page + tracking pattern. Build the movie page the same way (pixels via
`src/tracking.js`, `shmTrack()` events for each retailer click), so retailer
clicks become conversion + retargeting signals.

Direct links are acceptable **only** for deep-funnel retargeting audiences you
want to shave friction for — and even then, a page usually still wins.

---

## 8. Funnel blueprint (assemble the above)

1. **Top — Awareness:** broad + 1–3% lookalikes, objective = Video Views, best
   trailer-hook creatives on Meta + TikTok (+ YouTube for the movie).
2. **Mid — Consideration:** retarget 25–75% video viewers + page visitors with a
   stronger "Where to Watch" creative → landing page.
3. **Bottom — Conversion:** retarget landing-page visitors who didn't click a
   retailer; objective = Purchase (pixel event). Sequence, don't blast.
4. **Feed it back:** every stage grows the first-party audiences that seed the
   next campaign.

---

## 9. Money & safety rules (NON-NEGOTIABLE — same spirit as Podbooster)

- **Never launch spend or raise a budget without Ryan's explicit, per-action
  approval.** The tool must put a human on every launch. No autonomous spend, ever.
- **Set a daily budget cap and honor it.** One budget field, applied per selected
  platform. Start small (test), scale only proven winners.
- **Kill losers fast; scale winners.** Don't let a dud creative/audience burn.
- **Keep data honest** — report real spend, real conversions, real CPMs/CPAs.
- **Never touch a campaign in a way that hurts platform reputation/learning**
  without reason (no thrash pause/re-enable, no mid-learning bidding whiplash).

---

## 10. Tool UX (as specified by Ryan)

- One **daily budget** input.
- **Checkboxes: Facebook, Instagram, TikTok** (add **YouTube** for the movie).
  FB + IG map to placement toggles inside a single Meta campaign; TikTok (and
  YouTube) are parallel campaigns at the same budget.
- One **Launch** action → creates the campaigns simultaneously, all pointed at
  the same landing page + creative set, with the audiences built per §2–6.
- Lives in **Slate** as the "Marketing / Ads" module (internal ops hub), reused
  for both self-promotion and the movie. Podbooster stays download-only.
- Requires connected Meta Business + TikTok Business (+ Google Ads) ad accounts
  and their Marketing-API app approvals — flag these to Ryan before building.

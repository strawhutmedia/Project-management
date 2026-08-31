# Movie Promotion — measurement & delivery design

**Companion to [`AUDIENCE_TARGETING_PLAYBOOK.md`](./AUDIENCE_TARGETING_PLAYBOOK.md).**
That document covers audiences, platforms and funnel. This one covers the part
it doesn't: **how you count a purchase you cannot see**, plus the platform
constraints and landing-page facts already verified.

Read the playbook first. Where the two disagree, the playbook wins on strategy;
this document wins on the specific technical facts below, which were checked
against vendor documentation rather than inferred.

Owner: Ryan. Money rules are the playbook's §9 — non-negotiable.

**Scope split (settled):** movie promotion lives in **Slate** as the
Marketing/Ads module. **Podbooster stays podcast-download-only.** Prior movie
schema work on the Podbooster branch `claude/slate-movies-xoe197` is superseded
by this document; it is kept only as reference for the counting design below.

First title: **That Friend** (`thatfriendmovie.com`), releasing on premium VOD.
Not to be confused with **Back In Your Arms**, a separate film still in
pre-production.

---

## 1. The thing that makes this different from Podbooster

Podbooster can *prove* a download: audio bytes move through a page we serve, and
Megaphone independently confirms the same event. The two numbers can be
reconciled, which is what makes Rule 3 enforceable.

A film purchase happens inside Apple, Amazon or Fandango. **No pixel, no
postback, no click ID ever comes back.** Nothing we can install tells us whether
a rental happened.

So the conversion this tool counts is the **verified storefront handoff** — a
real human, bot-filtered and de-duplicated, clicking through from our page to a
storefront. That is an honest, defensible number.

**It is not a sale, and nothing in the UI, API, email or export may label it as
one.** Actual units arrive later, in aggregate, from the distributor's royalty
report, and get reconciled against handoffs in the same window (§4).

### The three defences a handoff must pass to count

Ported from `routes/track.js` in Podbooster, which has these hardened:

1. **Client-side human-interaction proof** before the outbound click fires.
2. **Server-side page-view cross-reference** — a matching page-view row for the
   same `ip_hash` and title within 30 minutes.
3. **Server-side bot filter + 24h dedup** on (`ip_hash`, title, storefront).

**Handoffs must never exceed page views.** If they do, a defence has been
bypassed and fixing it comes before anything else.

---

## 2. Proposed schema (Postgres)

Deliberately *proposed*, not migrated. The playbook's scope is Meta + TikTok +
YouTube, broader than this, so the session building the tool should own the final
shape. Next free migration number is **124**.

```sql
-- One row per film.
create table movie_titles (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid references projects(id),   -- the kind='film' project
  title              text not null,
  slug               text unique not null,           -- drives the watch-page URL
  logline            text,
  synopsis           text,
  runtime_minutes    int,
  rating             text,
  trailer_youtube_id text,
  release_date       date,
  preorder_date      date,
  -- pre_release | preorder | released
  release_status     text not null default 'pre_release',
  -- ISO-3166 alpha-2 codes we hold rights in. Geo targeting is clamped to
  -- this so we never buy clicks where the film cannot legally be sold.
  territories        text[],
  created_at         timestamptz not null default now()
);

-- Where to buy or watch it. One row per platform per country.
-- Exactly one is_primary per (title, country) — a single dominant CTA.
-- Note `is_transactional`: Tubi and other AVOD are free, which is a different
-- economic animal from an Apple/Amazon rental. See §5.
create table movie_storefronts (
  id               bigserial primary key,
  movie_title_id   uuid not null references movie_titles(id),
  platform         text not null,      -- appletv|amazon|fandango|googletv|tubi
  url              text not null,
  country          text not null default 'US',
  is_transactional boolean not null default true,
  is_primary       boolean not null default false,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

-- Campaigns are NOT scoped to one title: one campaign may promote several
-- (a slate push, a double feature), so this is a join, not an FK.
create table movie_campaigns (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  platform              text not null,      -- meta|tiktok|google
  -- awareness | consideration | conversion  (playbook §8)
  funnel_stage          text not null default 'awareness',
  status                text not null default 'draft',
  external_campaign_id  text,               -- id in Meta/TikTok/Google
  daily_budget_cents    int,
  budget_envelope_cents int not null,       -- HARD cap, see below
  spent_cents           int not null default 0,
  spend_synced_at       timestamptz,
  starts_on             date,
  ends_on               date,
  approved_by           uuid references users(id),
  approved_at           timestamptz,        -- nothing launches while null
  last_error            text,
  created_at            timestamptz not null default now()
);

create table movie_campaign_titles (
  movie_campaign_id uuid not null references movie_campaigns(id),
  movie_title_id    uuid not null references movie_titles(id),
  primary key (movie_campaign_id, movie_title_id)
);

create table movie_page_views (
  id                bigserial primary key,
  movie_title_id    uuid not null references movie_titles(id),
  movie_campaign_id uuid references movie_campaigns(id),
  gclid             text,
  utm_source        text,
  utm_medium        text,
  utm_campaign      text,
  referrer          text,
  ip_hash           text,
  user_agent        text,
  country           text,
  created_at        timestamptz not null default now()
);

-- THE conversion. counted = true only when all three defences in §1 pass.
create table movie_handoffs (
  id                  bigserial primary key,
  movie_title_id      uuid not null references movie_titles(id),
  movie_campaign_id   uuid references movie_campaigns(id),
  movie_storefront_id bigint references movie_storefronts(id),
  platform            text,
  gclid               text,
  utm_source          text,
  utm_medium          text,
  utm_campaign        text,
  ip_hash             text,
  user_agent          text,
  country             text,
  counted             boolean not null default false,
  reject_reason       text,
  created_at          timestamptz not null default now()
);

-- Ground truth, ingested from the distributor report. Title, platform,
-- country and period only — the storefronts do not report per-click and we
-- will not invent it.
create table movie_royalty_lines (
  id               bigserial primary key,
  movie_title_id   uuid not null references movie_titles(id),
  platform         text not null,
  country          text,
  transaction_type text,               -- rental | purchase
  units            int not null default 0,
  gross_cents      bigint not null default 0,
  net_cents        bigint not null default 0,
  period_start     date not null,
  period_end       date not null,
  source_file      text,
  created_at       timestamptz not null default now()
);

create index on movie_page_views (movie_title_id, created_at);
create index on movie_page_views (ip_hash, created_at);
create index on movie_handoffs   (movie_title_id, created_at);
create index on movie_handoffs   (movie_campaign_id, created_at);
create index on movie_handoffs   (ip_hash, movie_title_id, created_at);
create index on movie_royalty_lines (movie_title_id, period_start, period_end);
```

### Two schema decisions worth not rediscovering

**Every measurement row carries both `movie_campaign_id` and
`movie_title_id`.** A campaign can span titles, but a handoff always belongs to
exactly one title, because the viewer clicked through to one specific film.
Per-campaign rollups read one column, per-title rollups the other. Get it
backwards and you can either attribute a sale to a film or total a campaign, but
not both.

**`budget_envelope_cents` is a hard cap and `approved_at` gates every launch.**
This implements the playbook's §9. Note the failure mode being avoided:
Podbooster's service-promo path has *no* spend-cap enforcement — its goal poller
has no reference to those campaigns, and Google Ads API v24 removed campaign end
dates on create, so its "total budget" is arithmetic in the UI rather than a
control. Fine for a self-promo test, not fine for a P&A budget. **Build the
envelope and its poller before the launcher, not after.**

---

## 3. Landing pages — already built

Live in the **ThatFriend repo**, branch `claude/slate-movies-xoe197`, not in
Slate. They are static pages on the film's own domain, which is where they
belong.

| URL | Shows | Campaign |
|---|---|---|
| `thatfriendmovie.com/getnow` | all storefronts, chooser | main |
| `thatfriendmovie.com/getnow/amazon` | Prime Video only | Amazon, TV-only |
| `thatfriendmovie.com/getnow/apple` | Apple TV only | Apple, TV-only |

All three share `getnow/getnow.js`, where the `STOREFRONTS` array is the single
place purchase URLs live — one edit updates every ad destination.

Design constraints these encode, each for a reason:

- **No `auth.js`.** `index.html` and `about.html` on that site are behind a
  client-side password gate. An ad pointed at either would be disapproved by
  Google (destination must be publicly reachable) and would show a customer a
  login wall. Never put the gate on an ad destination.
- **Standalone, linking nowhere.** Same pattern as that site's `social.html`: no
  nav, not linked from anywhere, reachable only by URL.
- **Real content** — laurel, logline, cast, synopsis — so Google does not read
  the destination as a thin page existing only to bounce visitors elsewhere.
- **Single dominant CTA**, alternatives secondary. Four equal buttons is choice
  paralysis and leaves nothing to optimise against.
- **They already fire tracking**: the site carries GA4 `G-4641ZWTYSX`, GTM
  `GTM-W7RCZNFN` and Meta Pixel `26252798684369358`. Every outbound click fires
  a `storefront_handoff` event and passes `utm_*`, `gclid`, `gbraid`, `wbraid`
  and `fbclid` through to the storefront.

### Why single-storefront pages and not direct retailer links

This matters because the instinct is to skip the page for TV traffic.

Google's **destination mismatch** policy explicitly lists *"redirects from the
final URL take the user to a different domain"* as a violation — so routing
`thatfriendmovie.com/amazon` → `amazon.com` is the named prohibited pattern, not
a way around it. There is an exception for manufacturers redirecting to a
pre-approved list of retailer destinations, but it requires **prior approval**
from Google.

The stronger reason is the playbook's own §7: a direct retailer link yields zero
data, so you cannot retarget the ~95% who don't buy on first click. Since most
film purchases happen after retargeting, a direct link forfeits the flywheel.

---

## 4. Reconciliation — the honest cost-per-purchase

Ingest the distributor/aggregator report into `movie_royalty_lines` (CSV upload
is fine; Filmhub-style dashboards update regularly). Then compare units in a
window against **counted** handoffs in the same window.

Output is always an **estimate with a stated range, explicitly labelled as
one**. Never an attributed number, because attribution does not exist here.

After the first title this yields the two numbers nobody can supply in advance:
the real page-visit → handoff rate, and the real handoff → purchase rate. Those
turn every future campaign from a guess into a calculation.

---

## 5. Platform constraints verified against vendor docs

These were checked, not inferred, and two of them contradict assumptions the
playbook makes.

### Google / YouTube

- **Video campaigns cannot be created via the Google Ads API.** It is read-only
  for `advertising_channel_type = 'VIDEO'` — fetch and report only. Google's docs
  point to Demand Gen or Performance Max instead. **The launcher can only build
  Demand Gen.** Cheap CPV trailer-view campaigns must be created by hand in the
  UI; the tool can still read and report on them.
- **Demand Gen has no observation mode.** The playbook's §1.1 — "run audiences
  in observation / signal mode, not exclusive targeting" — relies on
  `targetingSetting.targetRestrictions`, which is a *Display* construct. On
  Demand Gen, audiences genuinely restrict. **§1.1 needs a per-platform
  translation, not a single rule.** Meta's Advantage+ Audience is the closest
  true equivalent to what §1.1 describes.
- Demand Gen specifics: `DEMAND_GEN` channel type, no subtype; cannot use a
  shared budget; bidding limited to maximize clicks, target CPA, maximize
  conversions or target ROAS; ad group takes no type; geo and language criteria
  go at **ad group** level; `contains_eu_political_advertising` must be declared.
  Ad formats: `DemandGenMultiAssetAdInfo`, `DemandGenCarouselAdInfo`,
  `DemandGenVideoResponsiveAdInfo`.
- **Google Ads will not accept an MP4 for a video ad.** It references
  YouTube-hosted video by ID only. Every cut must be uploaded to the film's
  channel — **unlisted, not private**; private is unusable as an ad — and the
  11-character ID recorded.
- **Link the YouTube channel to the ad account.** Required for trailer-viewer
  remarketing, which the playbook's §6 correctly calls the highest-intent
  audience available. Also: never mark a cut "Made for Kids" — it disables
  personalised advertising and remarketing on that video.
- **Never delete or re-upload a YouTube video whose ID is live in a campaign.**
  Deleting stops every ad using it; re-uploading mints a new ID and orphans the
  campaign.
- Demand Gen video responsive ads require a 1:1 logo asset. Expect this to be
  the first-attempt validation failure.

### Connected TV

- **CTV ads are not clickable.** No cursor, no browser. The interaction model is
  a **QR code plus a "send to phone" button** — on skippable in-stream both
  appear from the start of the skippable period; on non-skippable they reveal
  after 5 seconds. The viewer scans, and the page opens **on their phone**.
- Therefore **every ad destination must be phone-first.** The `/getnow` pages are.
- **Device targeting must include TV screens** or the QR never appears at all.
- Google's own caveat: *"Not all TVs can support the player resizing that allows
  QRs to appear."*
- Shoppable CTV needs a Google Merchant Center product feed — retail
  infrastructure for goods you sell yourself. A rental on Apple's storefront does
  not fit. Skip it.
- CTV is the most expensive inventory available: roughly **$16.20 CPM** and
  **$0.038 CPV**, against a **$3.53** blended CPM and **$0.025** CPV. It is the
  last channel to add, not the first.

### Benchmarks for sizing (2026)

YouTube CPV $0.024–0.026 (mobile $0.022, desktop $0.029, CTV $0.038). Blended
CPM $3.53; in-stream $11.42; Shorts $4.85; CTV $16.20. Average CTR 0.65%, view
rate ~31.8%. Entertainment sits at the cheap end of the CPM range, roughly $1–8.

---

## 6. The economics, stated plainly

A rental nets roughly **$3.50** after the platform's ~30% and an aggregator's
15–20%. At realistic conversion rates a purchase costs **$15–22** to acquire.
First-year domestic TVOD for a mid-performing independent feature totals
**$1,000–10,000**.

**Cold direct-response advertising to VOD rentals does not break even, at any
budget.** That is arithmetic, not pessimism, and the tool must never imply
otherwise.

What the spend legitimately buys:

1. **Storefront chart placement.** Concentrated day-one volume can land the film
   on a New Releases row, which delivers impressions nobody paid for. iTunes
   ranks by transactions, Fandango by revenue — so pre-orders compound.
2. **An owned audience.** An email signup costs $1–3 against $15–22 for a
   purchase, and the list persists into the next release. This is the playbook's
   §1.3 flywheel and it is the highest-return line in any plan.
3. **Evidence for the licensing deal.** Recoupment on a feature comes from the
   SVOD/AVOD deal that follows, and those are priced on demonstrable demand. A
   documented audience, a real list and trailer-engagement numbers are worth more
   to recoupment than the rentals the ads directly drive.

### One windowing question that outranks the tool

If **Tubi** (or any AVOD) carries the film in the same window as the Apple and
Amazon transactional window, the buy page is competing against free and TVOD
revenue collapses. That decides whether Tubi belongs on `/getnow` at all, or only
after the transactional window closes. Answer it before listing Tubi —
`movie_storefronts.is_transactional` exists so the page can behave differently,
but the *window* is a distribution decision, not a page-design one.

---

## 7. Build order

1. **Handoff tracking endpoint** + `movie_page_views` / `movie_handoffs`, with
   all three defences. Port the bot filter from Podbooster's `routes/track.js`;
   do not reinvent it.
2. **Budget envelope + spend poller.** Before the launcher. Not negotiable.
3. **Meta integration** — the playbook's §3, and the platform where purchase
   conversion actually works.
4. **Google/Demand Gen** — per the constraints in §5.
5. **TikTok** — the playbook's §4 rightly weights it toward awareness and
   retargeting fuel rather than last-click sales.
6. **Royalty reconciliation** — §4.

## 8. Prerequisites that are not code

These gate everything and none of them is fast. The playbook's §10 flags them;
they are the critical path, not the build.

- **Meta Marketing API** app review.
- **TikTok Marketing API** app review.
- **Google Ads developer token.**
- A **separate Google Ads account** from Podbooster's (`8911555848`).
  Podbooster's account-settings autofix rewrites *account-level* URL settings —
  its own code calls a malformed account-level tracking template the root cause
  of a 2026 funnel collapse — and its watcher appends negatives tuned for
  podcast-industry B2B. Customer ID is already a parameter, so this is config.
- **YouTube channel linked** to that ad account.
- Storefront URLs, territories, final logline, runtime, rating, and the billed
  cast in **confirmed spelling and contractual billing order**.

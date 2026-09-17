# Movie Promotion — where it lives

**Moved. The build lives in the `Podbooster` repo, at `MOVIES.md`.**

## The rule

**Split by capability, not by subject. Slate plans. Podbooster spends.**

Podbooster is the paid-media engine for everything Straw Hut advertises —
podcasts and films alike. It already holds the Google Ads client, spend-cap
enforcement, self-healing, the learned negative placements and countries, the
policy-hardened ad-copy generator, and the landing-page tracking discipline. A
second ad engine here would mean two Meta integrations, two spend-cap systems,
and two sets of learned exclusions that never share what they learn.

Slate owns planning, scheduling, budgets and the film's production record.

## What stays in Slate

[`AUDIENCE_TARGETING_PLAYBOOK.md`](./AUDIENCE_TARGETING_PLAYBOOK.md) — audience
and platform strategy. That is planning material, not engine code, so it belongs
here. Podbooster's `MOVIES.md` reads it as the strategy input.

Note its **§0 and §10 are out of date**: they place the ad tool in Slate and say
Podbooster stays download-only. Both are superseded by the rule above. Everything
else in it — the audience ladder, the platform recipes, the funnel blueprint, the
money rules — stands unchanged.

## What moved to Podbooster

`MOVIES.md` in that repo carries the build: the `film_*` schema, the verified
storefront-handoff counting discipline, royalty reconciliation, the Google Ads
and connected-TV constraints checked against vendor docs, the economics, and the
open questions.

## Landing pages

Neither repo. They are static pages on the film's own domain, in the
`ThatFriend` repo: `thatfriendmovie.com/getnow`, `/getnow/amazon`,
`/getnow/apple`.

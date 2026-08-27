# Handoff — Storefront visual redesign, round 2 (theme revert + real bugs)

Written 2026-08-27, end of the session that followed
[`handoff-2026-08-27-storefront-visual.md`](handoff-2026-08-27-storefront-visual.md).
That doc's own "what's next" was cart/checkout's stale visual language —
this session's first pass folded that into the same redesign push, then the
rest of the session was driven by the user reviewing the live site and
reporting specific, real bugs one at a time. Every fix below was verified
against the actual deployed site, not just locally — see "The alias bug"
below for why that distinction mattered a lot this session.

## Where things stand

- **Committed, pushed, and deployed** — six commits on `main`, all live on
  `shop-paddletogo.vercel.app`: `91f88b7` (nav/hero/cards/FAQ/cart-drawer
  redesign), `2051d03` (real FAQ content + animated accordion), `2fe8d80`
  (accordion motion smoothing), `cf99c19` (related-products brand
  priority), `5c7c88c` (sticky-image overlap structural fix), `36a8dc0`
  (desktop-only hero photo).
- All 64 tests pass throughout. Every fix in this doc was verified with a
  direct `getBoundingClientRect`/computed-style check against the live
  production site after deploying, not just visually.

## The alias bug (read this first if things seem to "not take effect")

`shop-paddletogo.vercel.app` is a **custom alias that does not
automatically follow new deployments** on this project — Vercel's GitHub
integration builds and deploys `main` fine, but the alias itself has to be
manually re-pointed at the new deployment every time:

```bash
cd /Users/majaneandaloc/Projects/ptg-admin-hub
npx vercel ls 2>&1 | sed -n '1,8p'          # find the newest Ready/Production deployment
npx vercel alias set <that-deployment-url> shop-paddletogo.vercel.app
```

`npx vercel` works without a global install (already authenticated as
`andalocjannah-2826`; `.vercel/project.json` links to
`prj_wR3uw8W0OobBYWW2tH4CGAvMpIkV` / org `team_Xg7tuI7GVhjxPhuCnMgY6qH1`).
This session lost real time to this: several rounds of "I fixed X" were
met with "it still looks the same" because the user was looking at a
deployment from hours earlier while a correctly-fixed build sat unaliased.
**Do this after every push to this project, without being asked.**

## What changed this session

### Theme reverted from navy back to green (settled brand constraint)

An earlier pass in this session drifted the palette to navy; the user
caught it immediately — `PRODUCT.md` already recorded forest/teal as a
**settled brand commitment, not open for redesign**. Reverted for good;
`--forest #123d36` / `--teal #0b7775` are the only accent colors anywhere
in `public.css` now.

### Nav: solid always, no transparent-over-hero

The redesign's first attempt made the nav transparent over the hero and
solid-on-scroll (logo/color swapping between states). The user reported it
as "weird, especially on scroll" — root cause was real: the transparency
toggle and its logo-filter swap were gated behind a `min-width` **screen
breakpoint**, which is the wrong signal for "does this device have a
mouse," and separately the hero's negative-margin offset to sit under the
nav didn't match at every breakpoint. Fixed by making the nav **solid
green gradient always** — no transparency state to desync in the first
place. Shop (with a real-brand dropdown) and FAQs sit left of the logo,
search/cart right, per explicit direction.

### Hero: fixed a real collision with the banner's own baked-in content

The real banner photo (`ptg-court-banner-v2.png`) has the PTG
logo/wordmark and social handles baked into the image itself, positioned
right-of-center. An early hero layout pinned the headline to the bottom
with a top-down scrim, which visually collided with that baked-in content
depending on crop. Fixed: text anchored left, scrim fades left-to-right
instead of top-to-bottom, image `object-position: left center`. Also
dropped a floating "N models · N colours" stat card in the hero corner —
flagged by the project's `impeccable` design skill as a banned
"hero-metric" pattern, and the user separately called it "out of place and
messy" before that skill flag came up.

### Removed decorative eyebrow/kicker labels

The `impeccable` skill (discovered project-locally this session,
`.claude/skills/impeccable/`) flags small-caps "eyebrow" labels above a
heading as a banned pattern categorically, not a style preference. Removed
them everywhere they were purely decorative (SHOP, CURRENT LINE-UP,
FEATURED PADDLE, ABOUT PADDLE TO GO, COMPARE, YOUR ORDER, the checkout's
50%-deposit kicker, the order-confirmation kicker) — kept the one that
carries real information (brand name above a product's title, which is
attribution, not a vague eyebrow).

### Product cards

- **Portrait images (3:4), not square** — the user pointed at Selkirk
  Asia's own product cards as reference. Measured their actual card/image
  dimensions via DevTools computed styles (257×341px ≈ 0.75 aspect) rather
  than copying any of their code/assets/copy, then applied that ratio
  originally. Also added an 8px inset padding around card images (same
  measurement-driven origin) instead of the image touching the card's
  rounded corners edge-to-edge.
- **Compare moved onto the photo** as a small pill, bottom-right — frees
  the card body, matches the same reference.
- **Quick-add (+) is hover/focus-only, unconditionally** — an earlier
  version gated the hover-reveal behind `(hover:hover) and (pointer:fine)`
  so touch devices always showed it; the user explicitly wants it
  hover-only everywhere, so that device-capability exception was removed.
  A tap still opens the product page either way.

### Grid pagination and layout

- **Fixed odd-card centering bugs, twice.** First bug: a rule meant to
  center a lone *third* card in a 2-up row was also firing when a filter
  returned **exactly one result total** — fixed with `:not(:first-child)`.
  Second bug: the same rule was leaking into 3-and-4-column desktop widths
  via a base-rule-plus-override pattern instead of being scoped outright —
  rewrote it as a single rule inside `@media(max-width:639px)` so it can
  never apply above the 2-up mobile grid where it actually makes sense.
- **"Load More" pagination is mobile-only** (`useMinWidth` hook, <640px) —
  desktop shows the full remaining catalog at once, no button. On mobile it
  always trims to end on a full even pair right before the button, never a
  lone stranded card. Styled as plain stacked uppercase text + chevron
  (no border/box), per a reference the user provided.
- **Opening scroll-row** (`ScrollRow` component) ahead of the featured
  band: 3 paddles on mobile, **5** on desktop. Started at 4 on desktop, but
  the user caught that 4 items exactly filled the visible width with
  nothing left to scroll to — the arrow buttons rendered but did nothing.
  Bumped to 5, verified `scrollWidth > clientWidth` afterward (real
  overflow now exists).

### FAQ page (new)

New `/faq` route. Content is the user's own real 8-question copy verbatim
(authenticity, on-hand vs. pre-order, the 50% deposit + arrival-QC flow,
2–3 week ETA, payment methods — pulled live from the existing
`PAYMENT_METHODS` list rather than hardcoded, so it stays correct if that
list changes — shipping via LBC COP, custom requests, defect handling).
Linked from the desktop nav (left of the logo, next to Shop) and the
mobile drawer.

### Accordion: generalized, then had its motion fixed twice

The product page's Details/Technology sections were an always-open static
card; converted to a real accordion and reused for the FAQ page
(`Accordion` component now takes `items: [{title, body}]` where `body` is
caller-provided content — a `<dl>` for specs, a `<p>` for FAQ answers).
Two real motion bugs found and fixed after the user called it "weird" and
"not smooth":
1. Sibling accordion items had no `layout` animation, so the instant a
   panel above them opened/closed they teleported to their new position —
   this was most of the "weird" feeling.
2. The height/opacity transition used the app's default spring physics
   (`spring` from `lib/motion.js`), which has no fixed settle time and
   reads as an uneven, faintly wobbly reveal on a coarse property like
   height. Replaced with `ACCORDION_EASE`, a fixed 280ms duration+ease
   defined at the top of `PublicCatalog.jsx`, used for both the panel and
   the items' `layout="position"`.

### "You may also like" — two separate real bugs

1. **Wrong ranking logic.** It led with a category match, but almost every
   product shares one category ("Paddle"), so category barely affected the
   ordering and the list read as arbitrary ("random paddles"). Swapped to
   lead with **same-brand** matches (genuinely related), category is only
   a fallback to fill the row when a brand doesn't have enough listings on
   its own. Verified: Selkirk Omni Clay now surfaces other Selkirk
   Boomstik paddles instead of an unrelated brand mix.
2. **Structural overlap bug**, found from a screenshot the user sent twice
   before the real cause was clear: the product page's sticky image
   (`.public-product-backdrop`, `position: sticky`) was staying pinned well
   past where its two-column layout ended, overlapping the "You may also
   like" section while scrolling down. The section had been made
   full-width via `grid-column: 1/-1` on a grid item inside the same
   `.public-product-stage` grid as the sticky image — that doesn't reliably
   bound a sticky sibling's containing block. Measured it directly
   (`getBoundingClientRect` at a fixed scroll depth) to confirm the overlap
   before touching anything. Real fix: `.public-related` is now a sibling
   of `.public-product-stage` entirely, not nested/grid-item inside it —
   removes the ambiguity outright rather than patching around it. Has its
   own width/centering class (`.public-related-standalone`) to still line
   up visually with the stage above it.

### Desktop-only hero photo

A newer real Facebook header photo the user supplied
(`public/images/ptg-hero-desktop.png`) now shows on desktop (≥960px) via a
plain `<picture>`/`<source media="(min-width:960px)">` swap — no JS
breakpoint check, no flash of the wrong image. Mobile keeps the original
`ptg-court-banner-v2.png` untouched.

## What's next

1. **Product photography** is still entirely absent — every catalog item
   shows "Photo coming soon." Carried over from every prior handoff; still
   true, still not this session's job to fabricate.
2. **Color-swatch merge was explicitly discussed and declined for now.**
   The user confirmed almost every catalog listing is a genuinely distinct
   product (not color variants of one model) — the one real exception is
   Sypik Triton 5 (Jade Mist / Olive Dust), which the data model already
   supports via `product.choices` and the existing product-page variant
   picker. No new "swatches on the grid card" feature was built; if this
   comes up again, the grouping data already exists, only the card UI
   would need it.
3. **Re-verify the layout-glitch screenshot doesn't recur elsewhere.** The
   fix (moving `.public-related` outside the sticky grid) addressed the
   *product page* instance specifically. If a similar sticky-element
   overlap ever gets reported on another page, don't assume the same fix
   pattern applies blindly — measure it the same way this session did
   (`getBoundingClientRect` at a real scroll depth) before changing CSS.
4. Nothing else is a known open item — cart/checkout's visual language
   (flagged as "what's next" in the prior handoff) was folded into this
   session's first redesign commit (`91f88b7`) and is no longer stale.

## Known non-issues (carried forward, still true)

Everything already listed as a known non-issue in the prior handoffs still
applies (admin login cold-start slowness, stray banner files already
cleaned up).

## Things to never re-do

Everything in the prior handoffs' "never re-do" lists still applies (no
fabricated visual content, no guessing a redesign direction cold, no
unauthenticated query endpoint, no secrets in chat). Add from this
session:

- **Don't skip the alias sync after a push.** Covered above — this is not
  optional busywork, it's the difference between the user seeing your fix
  and seeing nothing change.
- **Don't trust a screenshot of "weirdness" as a rendering artifact until
  you've tried to reproduce it directly.** The sticky-image overlap looked
  at first like a one-frame page-transition glitch (breakpoints seemed
  internally consistent on paper) — it wasn't; it was a real, reproducible
  CSS containing-block issue, findable by scrolling to a fixed depth and
  reading `getBoundingClientRect`. When a report doesn't match your
  theoretical read of the CSS, measure the live DOM before concluding it's
  unreproducible.
- **Don't gate a hover-only interaction, or any "does this device have a
  mouse" decision, behind a screen-width breakpoint.** Use
  `(hover:hover) and (pointer:fine)` — a real desktop window can be
  narrower than any layout breakpoint and still have a mouse.
- **Don't use a spring transition for height/auto animations.** It has no
  fixed settle time and reads as wobbly on a coarse property; use a fixed
  duration+ease for accordion-style reveals instead (see
  `ACCORDION_EASE`).
- **When researching a competitor site for layout inspiration, measure
  with DevTools (computed styles, `getBoundingClientRect`) and describe
  patterns in your own words — never copy their actual HTML/CSS/JS or
  reproduce their copy/assets.** This was a real friction point earlier in
  the session; the resolution both sides landed on was "inspect and
  measure, then build original" — keep doing that, not literal scraping.

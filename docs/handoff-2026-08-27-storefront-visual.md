# Handoff — Storefront visual redesign (continuation)

Written 2026-08-27, end of the session that followed
[`handoff-2026-08-27.md`](handoff-2026-08-27.md) (backend migration + the
first storefront routing rewire). That doc is still accurate for the
backend/API/routing story — this one picks up from "the storefront looks
awkward" and covers everything visual that changed since, plus exactly
what's left for cart/checkout.

## Where things stand

- **Committed and pushed**: commit `2bcb9c0` on `main`, already on
  [github.com/jnh-0005/ptg-admin-hub](https://github.com/jnh-0005/ptg-admin-hub).
- **Not deployed**: none of this is live on `ptg-admin-hub.vercel.app` yet.
  Deploying is outward-facing — confirm with the user before running
  `npx vercel --prod --yes`.
- Build passes, all 35 tests pass, verified live in-browser at mobile
  (375px), tablet (768px), and desktop (1280px).

## What changed this session

All of it is scoped to **browse** — the shop landing page and the product
detail page (`src/pages/PublicCatalog.jsx`, `src/public.css`). **Cart and
checkout were explicitly left untouched** (see "What's next" below) — they
still use the visual language from the previous rewire (bordered white
cards, the old step-number checkout), just now rendered in Poppins since
that font is applied at the `.public-shell` level, not per-page.

### Design direction

Arrived at through several rounds of the user sharing concrete visual
references (a Dribbble/Behance concept, an e-commerce app mockup, then their
own real PTG assets) rather than me guessing — worth preserving that pattern
for future rounds: ask for or point at a reference before building, especially
after a build attempt gets "I don't like it."

- **Palette**: kept the existing forest/teal tokens (`--forest #123d36`,
  `--teal #0b7775`) — this was a settled brand commitment from before this
  session, never revisited.
- **Font**: storefront now uses **Poppins** (`@fontsource/poppins`, weights
  400/500/600/700/800), scoped to `.public-shell` only. The admin console
  keeps **Schibsted Grotesk** — this was a deliberate scope decision, not an
  oversight. If a future request says "the site's font" ambiguously, ask
  which surface.
- **Hero**: full-bleed real court banner
  (`public/images/ptg-court-banner-v2.png` — the user's own asset, sent
  directly, not generated) with the tagline **overlaid on the image** (not
  below it — an earlier attempt moved it below and got corrected). Floating
  white stat card top-right shows a real live count (`products.length`,
  never hardcoded). No fabricated imagery anywhere.
- **"How it works" section is gone.** Replaced with a continuous
  auto-scrolling brand-logo marquee (`LogoMarquee` component, built from
  scratch — no npm dependency), driven by the **live catalog's actual
  brands** (`brands.filter(...)` inside `Shop()`), not a hardcoded list.
- **Real brand logos**, not fabricated marks: Sypik, RPM, Joola, Selkirk,
  Wika, Kamito, Honolulu, Franklin, Zocker — all background-removed from
  files the user supplied (`public/images/brands/*.png`), via a one-off
  Python/Pillow script (chroma-key + snap-to-white, see git history if this
  needs redoing for a new brand). **A brand with no logo file falls back to
  its plain name in the marquee** (`BRAND_LOGOS` map in
  `PublicCatalog.jsx`) — this is intentional, not a bug, and matches the
  project's no-fabrication rule in `PRODUCT.md`.
- **Product grid**: airy cards, no border box, a circular quick-add "+"
  button that adds directly to cart when a product has only one purchasable
  choice, otherwise routes to the product page to pick a colour.
- **Product page**: dark studio backdrop (gradient, not a fake photo — no
  per-product photography exists yet) with an overlaid rounded white info
  sheet. No star ratings, no review counts — none exist, so none are shown.
- **Scroll-reveal micro-animations**: a small `Reveal` wrapper component
  (`framer-motion`'s `whileInView`, once-only, respects
  `prefers-reduced-motion`) applied to hero/marquee/grid elements. Plus a
  "back to top" button that appears after ~1 screen of scroll.
- **Fixed a real responsive bug**: the old "how it works" step cards had
  their grid-column count and card visual style split across two different
  breakpoints (640px and 960px), producing a broken half-migrated layout in
  between. General lesson for any future breakpoint work in this file:
  structural layout changes (flex→grid, column count) and their matching
  visual style should always land at the *same* breakpoint, never two.

### New tooling in the repo

- **`impeccable` skill**, installed project-locally
  (`.claude/skills/impeccable/`, `.impeccable/config.json`). A design-focused
  Claude Code skill (`npx impeccable install` / `init` / `new-work`). It
  wrote `PRODUCT.md` at repo root during this session — durable product
  truth (users, positioning, constraints, brand commitments, evidence on
  hand), kept separate from visual decisions. Worth reading before any
  future storefront design work; it already captures the "never fabricate"
  rules referenced throughout this doc so they don't need re-explaining.
- `.impeccable/config.json` records `buildPath: "code"` (no image-generation
  tool available in this harness, so this project builds code-first, not
  comp-first — not a preference, just what's available).

## What's next — cart & checkout

The user's own words: "let's continue the checkout flows and everything."
Scope explicitly deferred earlier ("landing/browse first, hold cart/checkout
for later") — this is that later.

Current state of `/cart` and `/checkout` (`CartPage`, `CheckoutPage` in
`PublicCatalog.jsx`): functionally complete and correct (50% deposit math,
non-refundable acknowledgment, receipt compression via `compactProof()`,
real order submission to `/api/v1/orders`) — **only the visual language is
stale**. They still use:
- `.public-cart-line` — bordered white rows with a border-radius box per
  line item (the pre-redesign card style).
- The numbered-step checkout (`Step` component, `.public-step` /
  `.public-step-num`) — same visual pattern as the old "how it works"
  section that just got replaced. Worth deciding whether checkout keeps
  numbered steps (it's a real multi-field form, so numbered steps may still
  be the right call there, unlike the static 3-item explainer) or moves to
  something else — ask the user rather than assuming either way.
- Order summary sidebar (`.public-order-summary`) — plain bordered card,
  never restyled to match the new editorial language.

Suggested approach for the next session: **do the same thing that worked
here** — ask the user for a concrete reference or let them react to a first
attempt quickly, rather than guessing at a full redesign up front. This
session's actual working pattern was: build something small, show it, let
them correct direction, repeat — not a single big up-front redesign.

## Known non-issues (don't re-investigate)

- **Admin login was slow to load once this session**, on both local and
  production. Investigated: no bug found in `AuthGate.jsx` / `store.jsx` /
  `folkdb.js` (none of which were touched this session), and it affected the
  untouched production site too. Self-resolved. Almost certainly a cold
  start (Vercel serverless function + Supabase connection pool waking from
  idle) — not a regression from this session's work. Only worth digging into
  Vercel function logs if it starts happening consistently.
- **Two stray banner files were deleted** this session
  (`ptg-court-banner.png`, `ptg-court-banner-clean.png`) — both were
  superseded by `ptg-court-banner-v2.png` and confirmed unreferenced
  anywhere in code before removal. Not a data-loss concern, just repo
  hygiene.

## Things to never re-do (carried forward, still true)

Everything in the original handoff's "Things to never re-do" section still
applies (no unauthenticated `/api/query`-style endpoint, no
`DATABASE_URL`/password in chat, no SQLite-dialect fixes outside
`api/_db.js`). Add to that list from this session:

- **Don't fabricate visual content** to fill a gap — no fake product photos,
  fake reviews/ratings, fake stock counts, or logo marks guessed from
  memory. If an asset doesn't exist, either ask the user for it or fall back
  to honest text/placeholder treatment (see `BRAND_LOGOS` fallback pattern
  above for the reference implementation of "fall back honestly").
- **Don't guess a redesign direction cold.** This session burned several
  rounds on visual attempts the user didn't like before shifting to
  reference-driven iteration. Ask for or point at a concrete example first.

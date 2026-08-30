# Handoff — 50/50 unification, stock-on-Paid, PageSpeed, phantom cleanup round 2

Written 2026-08-31, end of the session that followed
[`handoff-2026-08-30-preorder-tiers-and-storefront-fixes.md`](handoff-2026-08-30-preorder-tiers-and-storefront-fixes.md).
That doc closed with the new 25%-in-transit tier live and verified. This
session opened by **reversing that decision** per direction — in-transit and
plain pre-order now pay the identical 50/50 — then grew into a real business
rule change (stock moves on Paid, not just Completed), a PageSpeed pass, and
a second round of the phantom-duplicate-product bug class, twice. Everything
below is committed, pushed, and deployed; nothing is pending review.

## Where things stand

- **Committed and deployed**: `main` is at `3eb8313`, live on
  `ptg-admin-hub.vercel.app` and aliased to `shop-paddletogo.vercel.app`
  (re-synced after every one of this session's pushes — still not automatic,
  see prior handoffs — there were 12 this session).
- All 78 tests pass (`npm test`) — up from 75 at the start of this session
  (new coverage for the Paid-stock-decrement change and its floor-at-zero
  fix).
- One real end-to-end test order was placed against production to verify the
  whole checkout → admin → Paid → stock lifecycle, then deleted and its
  stock corrected back by hand afterward — see "Full lifecycle test" below.
  No test data left in production.

## What changed this session

### Reversed last session's 25% in-transit tier — now 50/50, same as normal pre-order

Direct instruction: in-transit and from-scratch pre-order should be the
**same** process — 50% now to reserve, the other 50% due in full once the
paddle is physically on hand, before it ships. The three-part 25/25/50 idea
from the previous session is gone.

- `api/v1/_shared.js`: `buildOrder()` always assigns `payment_requirement:
  "deposit"` at the 0.5 ratio now, regardless of whether a line claimed
  in-transit batch stock. `deposit_25` is never assigned to a new order
  again.
- `calc.js`: `IN_TRANSIT_DEPOSIT_RATIO` / `deposit_25` / their labels and
  help text are kept, but now explicitly marked legacy-only in comments —
  they still compute and display correctly for any order already placed at
  the old 25% rate (nothing rewrites history), but nothing new can ever be
  assigned that value.
- Storefront copy (product page note, cart banner, checkout banner, FAQ) all
  rewritten to describe one unified 50/50 process instead of a 25%-vs-50%
  split.
- **In-transit paddles get a "Reserve" button instead of "Pre-order".**
  Once that piece's batch line is fully claimed (remaining hits 0 — the
  storefront API already stops returning `in_transit` for it, no new logic
  needed), every dependent bit of UI including this button falls straight
  back to "Pre-order" on its own.

### Stock now moves the instant an order is marked Paid, not only Completed

Direct instruction: a 50% deposit is non-refundable, so the paddle is sold
the moment payment is verified — not only once it's later fulfilled/handed
over.

- `calc.js`: new `STOCK_COMMITTED_STATUSES = ["Paid", "Completed"]` /
  `isStockCommitted()` — the one place that decides "has this order's stock
  moved."
- `data.js`'s `saveOrder()` now decrements on the first time an order
  reaches either status, never decrements twice on Paid→Completed, and
  restocks correctly if a Paid order is later cancelled or reverted.
  `deleteOrder()`'s restock-on-delete check generalized the same way.
- The admin edit form's "this takes N units out of stock" confirmation gate
  (previously Completed-only) now also fires when picking "Paid" from the
  status dropdown, with correct wording either way.

**Found and fixed the same session, live**: the stock-update SQL had a
`MAX(0, quantity + ?)` floor that silently ate the very decrement this
change relies on — every current SKU sits at 0 on-hand (nothing is
genuinely in stock right now), so marking anything Paid read 0 (not −1)
instead. The real consequence: once a batch is later Received and adds its
quantity, the total would overcount by exactly the paddles already sold via
Paid deposits placed ahead of that receipt. Removed the floor — quantity
now goes genuinely negative to say "sold, not yet physically on hand,"
same as any other true negative already gets a real minus sign in this app,
never a clamp. Also caught and fixed a second bug in the same pass: the
"Approve payment" confirm dialog still said "it does not touch stock" —
stale copy from before this change.

### Full order lifecycle verified live end-to-end

Placed a real reservation through the actual checkout (in-transit paddle,
payment proof attached, terms accepted) → confirmed it synced instantly to
Orders with correct amounts → confirmed the storefront flipped
Reserve→Pre-order the moment it was claimed → clicked "Approve payment" in
admin → confirmed the stock movement log recorded the real `-1` → deleted
the order and confirmed both the order list and the storefront reverted
correctly. This is what surfaced the floor-at-zero bug above (a phantom `+1`
appeared after deleting the Paid test order — traced directly to the clamp,
fixed, then manually corrected the live row back to 0 before the code fix
shipped).

### PageSpeed audit: mobile Performance 67 → 90, SEO 92 → 100, Accessibility 92 → 100

Run at the user's request against `shop-paddletogo.vercel.app`.

- **Images were ~90% of the problem.** Converted the two hero photos and
  all 8 brand-marquee logos (+ the nav logo) from PNG to WebP via `npx
  sharp-cli` (no Homebrew/cwebp/imagemagick on this machine — sharp-cli
  downloads on demand). The two hero photos went ~1.2 MB → ~30 KB each at
  their native resolution, essentially lossless-looking because the dark
  hero scrim already flattens most of the photo's real detail. Every logo
  was also being served at its full original pixel size and squished down
  by CSS (RPM's logo: 1752×361 file shown at 245×50) — resized to roughly
  3–4× actual display size instead. `ptg-logo-header.png` was kept as the
  original full-resolution PNG on purpose — the PNG invoice export
  (`invoice.js`/`Invoice.jsx`) still needs it at print quality; only the
  storefront's own `<img>` tags point at the new small WebP.
- Added explicit `width`/`height` on every image touched (the "no explicit
  dimensions" diagnostic).
- Added a real `public/robots.txt` — there wasn't one, so the URL fell
  through the SPA's catch-all rewrite and served the **admin login page's**
  HTML, which is what Lighthouse's "35 errors" actually was.
- Accessibility: both `role="list"` regions on the page had `role="listitem"`
  children nested a DOM level too deep to register as valid (Lighthouse's
  `aria-required-children` check walks the DOM, not the accessibility tree)
  — restructured `LogoLoop.jsx` so the pair are real parent/direct-child.
  Measured every real interactive element's `getBoundingClientRect` on a
  mobile viewport (not guessed from CSS) and found 5 genuine sub-24px touch
  targets (category/brand filter pills, the search input, the nav logo
  link, footer links, the Compare pill sitting exactly on the boundary) —
  all fixed with padding/min-size.

LCP dropped from 9.5s to 2.9s. Verified every fix live via a second
PageSpeed run against production, not just locally.

### Editorial band: copy rewrite + a real mobile crop bug

- Copy: "Sourced direct, held for you." → "Trusted brands, brought closer
  to you.", with copy about sourcing from trusted brands instead of import-
  batch mechanics (user-provided text).
- **Mobile bug, from a user screenshot**: the section's photo is the same
  wide source as the hero, with its logo lockup baked into the right ~30%
  of the frame. A mobile 16:10 crop against that ~2.7:1 source only ever
  shows ~59% of the width, and the default centered crop cut the address
  line off entirely. Set `object-position: right` on that specific image
  (opposite of the hero's own `left`, which is deliberately positioned to
  hide the same lockup behind the hero's own h1 text) — verified the whole
  lockup is now fully in frame on a real mobile viewport.

### Technology spec section: fixed for every paddle that was missing it

Not a data gap — a matching bug. `specFor()` required an *exact* match on
the full product name, but the spec data (`PADDLE_SPECS`) was written for
bare model names without colour suffixes. Every colourway PTG stocks is its
own separate product name ("Sypik Triton 5 Jade Mist" as a literal name, not
a variant of "Sypik Triton 5"), so those bare keys matched nothing — every
Sypik colourway, both RPM models, Kamito Dominus, and Bread and Butter Loco
Tan were silently missing the whole Technology accordion, while Kamito
Alpha X / Zocker Aspire (no colour in the name at the time) and every
Selkirk colourway (already prefix-matched) had it. Rewrote `PADDLE_SPECS` as
an ordered `{prefix, spec}` list and `specFor()` to prefix-match
consistently, the same way Selkirk already did. No new research was
actually needed — the specs were already there, just unreachable. Verified
programmatically against the full live catalog: every real paddle resolves
a spec now, only the actual accessory (the Selkirk case) correctly resolves
none.

### FAQ + arrival-estimate copy

- "Do you offer shipping?": now names the real couriers (LBC, J&T Express)
  instead of the stale "LBC COP" line, and states outright that
  cash-on-delivery/cash-on-pickup isn't offered right now — the balance is
  settled once the paddle is on hand, before it ships (direction).
- "When will my pre-order arrive?": 2–3 weeks → 7–14 days (direction).
- That 7–14 day estimate now also shows on the product page and checkout
  for a normal pre-order, not just the FAQ. In-transit paddles get their
  own "usually within 7 days, barring delays" line — but ONLY as a fallback
  when the batch has no real `ships_in` date set, so it can never
  contradict a batch that does have a genuine, more specific ETA.

### Phantom duplicate products, round 2 — three more, one self-inflicted mid-session

Same bug class as the six fixed last session (`seedCatalog()` re-inserting a
`PADDLES`/`ADDONS` entry whose name no longer matches the live catalog, the
moment `INIT_VERSION` gets bumped for any reason).

1. **"Selkirk Boomstick Jacksock Red Case" (PTG-BSJ-CASE)** — reported by
   the user ("keeps coming back" after deleting it). The real product is
   named "Selkirk Red Leather Case" (PTG-BSJ-CASE-2), a genuinely different
   name, not a mis-spelling. Removed the `ADDONS` entry outright (now an
   empty array) and bumped `INIT_VERSION` to `.2` per this file's own
   stated rule.
2. **That very bump immediately caused two more**, caught before the user
   ever saw them via a full audit right after: "Zocker Aspire" had been
   renamed live to "Zocker Aspire Neptune" and "Kamito Dominus" to "Kamito
   Dominus Indigo" sometime after their seed entries were written — same
   shape as the "Boomstick Jacksock" rename fix from last session. Renamed
   both `PADDLES` entries to their real current names with the old spelling
   kept as an alias, bumped `INIT_VERSION` to `.3`, and this time
   cross-checked **every** remaining `PADDLES` entry against a live
   inventory dump programmatically before shipping — all six now match by
   name or alias, confirmed in code, not just by inspection.

All three phantom rows were deleted from production directly (via the
authenticated `/api/query` endpoint, matching `deleteProduct()`'s exact SQL)
and confirmed gone from both the admin Inventory list and the live
storefront catalog API afterward.

### Kamito Alpha X: real product, wrong data link — not a phantom this time

User reported it's genuinely in transit but the storefront wasn't showing
it. Different root cause from the above: the batch line (`batch_items` row)
for this paddle had `variant_id = NULL`, pointing at the bare product, while
the product's real sellable unit is its "Rose Pink" colour variant — the
batch line predates that variant being added and was orphaned when it was.
Since the storefront reads `in_transit` per-variant once a product has
variants, the product-level batch data never reached the customer-facing
unit. Fixed by pointing the batch line at the real variant id directly (one
`UPDATE batch_items SET variant_id = ...`). Per the user's explicit
follow-up instruction, the product is now named **"Kamito Alpha X Rose
Pink"** on both admin and storefront (not reverted to the bare name this
session's first instinct suggested) — verified live: shows "In transit" and
a working "Reserve Rose Pink" button.

### Checkout: every required field now shows a visible asterisk

Native `required` HTML validation was already wired up and already blocking
submission on every field (confirmed live earlier this session) — nothing
ever showed the shopper *which* fields were required before they hit
submit and got stopped. Added a red `*` after the label text on all ten
required fields (Full name, Email, Phone, Facebook link, and the six
shipping-address fields shown once "Shipping" is selected). The label text
had to move into a wrapping `<span>` to do this without the asterisk
becoming its own line — `.public-step-body label` is `display:grid` with
label-text and input as its two rows, so a bare second child would drop to
a new row of its own.

## Known non-issues (don't re-investigate)

Everything already listed in prior handoffs still applies. Add from this
session:

- **The Browser-pane `computer` click tool timed out repeatedly this
  session** (30s timeout, "pane may be stuck") on otherwise-normal clicks —
  the click had usually still registered underneath the timeout, or could
  be worked around with a direct `element.click()` via `javascript_tool`.
  Not a site bug; a tool flakiness pattern worth trying the JS-click
  fallback for immediately rather than retrying the same click repeatedly.
- **`get_page_text` on this app returns the full page's `innerText`
  regardless of scroll position** — don't rely on scrolling first to
  "reveal" different text in a text-only read; use it right after the
  content you need actually exists in the DOM (e.g. after clicking an
  accordion open), or screenshot instead when scroll position genuinely
  matters.
- **This project's Vercel deployment does not automatically alias
  `shop-paddletogo.vercel.app`** — restated from every prior handoff
  because it bit this session too, repeatedly: after every push, `npx
  vercel ls` for the newest Ready/Production deployment, then `npx vercel
  alias set <url> shop-paddletogo.vercel.app`. Do this without being asked,
  every time.

## What's next

1. **Product photography** — still the long-standing open item; unchanged
   this session.
2. **True background removal**, if the user decides they want it — still
   deferred.
3. **The pre-order cutoff date** (`settings.preorder_cutoff_date`, set from
   the Orders page) reflects whatever the user last set it to on production
   — this session didn't touch it, unlike last session which explicitly
   cleared it after testing.
4. No other known open bugs as of this session's end.

## Things to never re-do

Everything in the prior handoffs' "never re-do" lists still applies, with
one now **superseded** — flag it if you see it repeated:

- **SUPERSEDED**: last session's handoff said "don't treat
  `payment_requirement` as binary anywhere new" because it had three real
  values. That's still literally true (`deposit_25` still exists for
  historical orders), but **no new order is ever assigned `deposit_25`
  again** as of this session — every new order is `deposit` at 50%,
  in-transit or not. Don't resurrect the 25% tier for new orders without a
  fresh, explicit instruction to do so.
- **Don't bump `INIT_VERSION` without auditing every `PADDLES`/`ADDONS`
  entry against a live inventory query first** — restated with real teeth
  this time: this session's very own bump (to fix one confirmed phantom)
  immediately created two more from stale renames nobody had caught yet.
  The audit script used this session (compare every entry's name+aliases
  against a full live `SELECT name FROM inventory`) takes under a minute —
  run it before every single bump, no exceptions, even when the bump looks
  unrelated to `PADDLES`.
- **Don't assume a batch line's `product_id` alone means it applies to
  every colour of that product.** Once a product has variants, a batch
  line with `variant_id = NULL` only ever matches a no-variant purchase —
  which may not exist. If a product gains its first colour variant after a
  batch line was already created for it, that line silently orphans. Check
  `variant_id` on batch lines for any product that later gained colours.
- **Don't leave a stock-update SQL statement with a floor/clamp without
  checking what it silently discards.** The exact bug this session found:
  `MAX(0, quantity + ?)` looked like harmless safety, but it ate the one
  piece of information (the negative delta) that made the Paid-before-
  Received accounting correct. When something now legitimately needs to go
  negative (a real state, not an error), a floor isn't a safety net, it's
  data loss.

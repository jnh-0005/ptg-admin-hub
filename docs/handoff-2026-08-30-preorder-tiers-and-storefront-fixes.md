# Handoff — pre-order/in-transit tiers, storefront fixes, brand removal

Written 2026-08-30, end of the session that followed
[`handoff-2026-08-29-order-stock-sync-and-photos.md`](handoff-2026-08-29-order-stock-sync-and-photos.md).
That doc closed out a photo-pipeline pass with nothing pending. This session
started with a batch of storefront bug reports, then grew into a real new
feature (a second, lower-risk pre-order tier for stock already in transit)
plus a global pre-order-cutoff setting, on top of dropping two discontinued
brands. Everything below is committed, pushed, and deployed; nothing is
pending review.

## Where things stand

- **Committed and deployed**: `main` is at `8391989`, live on
  `ptg-admin-hub.vercel.app` and aliased to `shop-paddletogo.vercel.app`
  (re-synced after every one of this session's 14 pushes — still not
  automatic, see prior handoffs).
- All 75 tests pass (`npm test -- --run`) — up from 74 at the start of this
  session (one new suite replacing the removed batch-derived preorder tests,
  see below).
- No test data left in production — the one real test order placed to verify
  the in-transit checkout flow end-to-end was deleted afterward, confirmed
  the claimed stock reverted correctly.

## What changed this session

### Storefront routing and layout bugs

- **"You may also like" links went nowhere.** `ProductCard`'s links used
  relative paths (`paddle/${id}`) — correct from the shop grid (a top-level
  route) but wrong when the same card renders inside a product detail page
  (nested under `paddle/:id`), where the relative link stacked onto the
  current URL (`/paddle/21/paddle/22`) instead of resolving from the site
  root. Fixed by making all such links absolute.
- **Product photo overflowing its frame.** The desktop backdrop forces a
  square via `aspect-ratio`, but `.public-product-image`'s `height:100%`
  doesn't resolve against a parent whose height comes only from
  `aspect-ratio` — a real CSS quirk, not a typo. The image box silently fell
  back to the photo's actual 4:5 ratio and spilled uncropped past the
  backdrop into whatever came after it. Fixed with `position:absolute;
  inset:0` instead of percentage sizing.
- **Backdrop forced a square, but every photo is 4:5.** Once the overflow
  bug above was fixed, the square correctly letterboxed every photo with the
  dark backdrop showing as bars on both sides — because nothing in the
  catalog is actually square. Changed the desktop backdrop to
  `aspect-ratio:4/5` to match the real photo standard; verified this is a
  strict improvement for all 20 photographed products at the time.
- **Spacing**: added breathing room above "You may also like" and between
  the product grid and the footer, both previously flush against their
  neighboring divider.
- **Hero banner's own logo/social block clipped at desktop widths.** The
  banner image (`ptg-court-banner-v2.png`) carries its "PADDLE TO GO" logo
  and Facebook/Instagram/location text baked into its right half;
  `object-position:left` cropped that block off past the viewport's right
  edge on real desktop widths (confirmed clipped at 1440px). Scoped a
  `>=960px`-only override to `object-position:50% center` (several
  iterations — 80%, 95%, back down — tuned live against real widths before
  landing on centered) so mobile is untouched and desktop shows the whole
  block with margin on both sides.
- **Hero subtitle rewritten.** "Pick your model and colour, then hold it
  with a 50% deposit" named a specific percentage that's no longer
  universally true now that in-transit orders exist at 25%. Replaced with
  shop-focused copy (user-provided): "From everyday favorites to
  limited-edition releases, find your next paddle at Paddle To Go."

### Photo standardization: closed the CORS gap for good

A pasted hosted photo URL only got the white 4:5 treatment before if its
source host happened to send the `Access-Control-Allow-Origin` header a
cross-origin canvas read needs — otherwise it silently fell back to storing
the raw, wrong-sized link. Built `api/photo-fetch.js`: a same-origin proxy
that fetches the image server-side (never subject to CORS) and relays the
bytes, with a size cap, content-type check, and an SSRF guard against
internal/loopback hosts. `compactImageFromUrl` now tries the direct
cross-origin load first (no extra hop when it already works) and falls back
to this proxy — so what's left after both attempts is a genuine fetch
failure, never "this host doesn't support it."

Used this to standardize every non-conforming photo in the live catalog: the
two transparent-background Selkirk Omni photos left over from an earlier
session (Canyon Clay, Chalk), plus 6 photos that had only ever been raw
hosted links (RPM V2, RPM Q2, Honolulu J6CR Crystal Blue, all 5 Sypik Triton
5 colors). Full catalog scan afterward: 20/20 photographed products, 0
issues (correct 4:5 ratio, no transparency, no raw hosted URLs left).

### Franklin and Joola dropped — no longer sold

Removed the three products (Franklin C45 ALW, Joola V Persus, Joola IV) from
production directly (confirmed no order history referenced them first), and
the code-side half: both brands out of the `PADDLES` seed list (so they
can't silently reappear on a cold start, same class of bug as the Sypik
Triton 5 fix from the prior session), out of `BRAND_LOGOS` /
`KNOWN_BRANDS`, and their logo image files deleted. Storefront's brand
filter and product grid needed no other change — both are already fully
derived from live inventory.

### In-transit stock: a real third tier between in-stock and pre-order

The user's actual workflow: paddles are ordered ahead of any customer
demand, and once a batch is genuinely **In Transit** (money already paid to
the supplier, not just Planned or Ordered — see `BATCH_STATUSES`), that
stock is lower-risk to reserve than a from-scratch pre-order. Built as a
real third payment tier, not just a cosmetic label:

- `api/v1/_shared.js`: `inTransitInfoMaps()` — scoped to batch status
  `'In Transit'`, computes REMAINING quantity per batch line
  (`batch_items.quantity` minus units already claimed by non-cancelled
  orders against that exact batch/product/variant). A line only qualifies
  while remaining > 0; once fully claimed, demand falls back to the
  ordinary pre-order tier automatically — no phantom badge.
- `buildOrder()` re-checks eligibility server-side per line (never trusts
  the client) and only claims a batch when its remaining fully covers the
  requested quantity. Cart-wide, one claimed line puts the WHOLE order at
  the 25% rate (`payment_requirement = 'deposit_25'`) rather than prorating
  a mixed cart — same simplification pattern the existing `hasPreorder` flag
  already used. `order_items` now carries `batch_id` so the remaining-
  quantity math stays accurate as orders land.
- `calc.js`: `deposit_25` is a first-class `payment_requirement` value
  alongside `deposit` (50%) and `full`, with its own ratio
  (`IN_TRANSIT_DEPOSIT_RATIO = 0.25`), label, help text, and deposit math —
  every existing consumer (Orders.jsx's manual order form, Payments.jsx,
  invoice.js) picked it up for free through the existing
  `PAYMENT_REQUIREMENTS`-driven UI, except two spots that had "50%"
  hardcoded in plain text (order detail's "Deposit due · 50% of billed" line
  and its reserve note, Payments.jsx's "This meets the 50% deposit"
  confirmation) — found live-testing, both fixed to read the real
  requirement.
- Storefront: a solid-fill "In transit" pill outranks the plain "Pre-order"
  badge on cards/PDP/compare; the PDP note names the real remaining count
  and 25% deposit instead of the generic 50% restock note; cart and
  checkout each carry their own in-transit banner and correctly-computed
  deposit math, threaded through every spot that used to assume a flat 50%
  applied to every order (PDP deposit preview, cart summary, checkout ×2,
  submit-button label).

Verified end-to-end against the real "Sept Stock In Transit" batch already
in production: placed a genuine test reservation for Kamito Alpha X via the
live checkout (bypassing the file-upload UI limitation by POSTing directly
to `/api/v1/orders`, exactly what the checkout form sends), confirmed
`payment_requirement: "deposit_25"`, exact deposit/balance math, the admin's
order and payment views reading "25% deposit — in transit" with zero extra
admin code, and the claimed unit correctly dropping remaining to 0 and the
item falling back out of "in transit". Deleted the test order and confirmed
remaining reverted to 1. Also fixed a real crash found in the same pass: an
unguarded `choice.inTransit` read where `choice` can legitimately be `null`
(the surrounding code already used `choice?.preorder` for exactly that
reason) — this was live and reachable on every out-of-stock PDP for a few
minutes before the fix shipped.

### Pre-order cutoff: one global round date, not a batch field

A plain pre-order (nothing in transit) exists before any batch does — the
previous model had this backwards, deriving pre-order ETA/cutoff from
whatever batch happened to exist for a product. Per direction: pre-orders
are collected continuously across every out-of-stock paddle, and a batch
only gets placed with the supplier after a cutoff date passes, covering
whoever pre-ordered in that window.

- New `settings.preorder_cutoff_date` — the one global round date, in the
  existing single-row `settings` table alongside `php_to_vnd_rate` etc.
  (bumped `INIT_VERSION` so this reaches the already-initialized production
  database — see the incident below).
- `api/v1/_shared.js`: replaced `preorderInfoMaps()` (derived ETA from any
  Planned/Ordered/In Transit batch) with `activePreorderCutoff()` — reads
  the one global date; a date already in the past folds into "no cutoff
  set" exactly like `null` (per direction: never show a stale deadline). In
  transit still outranks plain pre-order whenever both would apply.
- Removed the old **per-batch** "Pre-order cutoff date" field from the
  Batch form and its "Next pre-order cutoff" banner (per direction) — the
  column is kept (existing values on old batches aren't wiped) but no
  longer shown or written from the form.
- **New "Pre-order cutoff · `<date>`" / "No pre-order cutoff set" control on
  the Orders page header** — the one place this date is set, per explicit
  direction, not Batches. Opens a small tray with a date field, a Save, and
  a one-tap "Close the round now" to clear it without opening a new one.
- Storefront copy rewritten so in-transit and plain pre-order read as two
  genuinely different tiers instead of one merged fallback chain: in-transit
  shows its own batch's real ETA (no "order by" — it's already shipped);
  plain pre-order shows "Pre-order open until `<date>`" / "Order by `<date>`
  for this round" (no ETA — unknown until a batch is actually placed), or
  the existing generic note when no round is currently open.

Verified live: set a real cutoff via the new Orders control, confirmed the
storefront picked it up on every out-of-stock item not already in transit,
confirmed the in-transit items were unaffected, then cleared it back to "No
pre-order cutoff set" afterward — the actual date is the user's call to make
when ready, not something to leave live from testing.

### Self-inflicted incident: 6 phantom duplicate products, found and fixed same session

Bumping `INIT_VERSION` for the new settings column (a genuinely required
step — see prior handoffs' documented rule) had a side effect nobody had
hit before: it made `seedCatalog()` actually run again for the first time in
a long while, which surfaced a **pre-existing, dormant** bug — six
`PADDLES` entries (Selkirk Omni Clay, Selkirk Boomstick Clay, Selkirk Omni
Hydro-Cosmic, Honolulu J6CR, RPM Q2, RPM V2) whose names/aliases had never
actually matched the real catalog, which now only carries these
per-colour or full-model-name. Same bug class as the Sypik Triton 5 fix
already in this file, just never triggered because nothing had bumped
`INIT_VERSION` since these entries were added.

Caught within minutes by noticing the live product count had jumped from 24
to 30. Removed all six from `PADDLES` outright (no correct alias exists —
there is no real "just Clay" or "just J6CR" product to alias onto), and
manually deleted the six phantom rows from production via the admin's real
delete-product flow. Confirmed clean: 24 products, matching the
pre-incident count.

## Known non-issues (don't re-investigate)

Everything already listed as a known non-issue in the prior handoffs still
applies. Add from this session:

- **The Browser-pane screenshot tool renders garbled/scaled output at
  oversized custom viewports** (seen at 1920px width — a vertically-stacked
  "wrapped every few pixels" render). This is a tool artifact, not a real
  site bug — confirmed by checking actual DOM measurements
  (`getBoundingClientRect`) at the same width, which were correct. Stick to
  the `desktop`/`tablet`/`mobile` presets or realistic custom widths
  (1000–1440px) for visual verification; don't chase a screenshot that looks
  broken at 1920px without cross-checking the DOM first.
- **The Browser pane can't drive native OS file pickers** (already
  documented in memory for this machine) — confirmed again this session:
  setting `input.files` via a synthetic `DataTransfer` did not work either.
  To verify a flow gated behind a required file upload (like the storefront
  checkout's payment-proof step), POST directly to the same API endpoint the
  form's `fetch` call uses, with the same payload shape — don't fight the
  file input.
- **A relative React Router `<Link to="paddle/...">` resolves differently
  depending on which route renders the component it's in** — the shop grid
  (top-level route) and a product detail page (nested under `paddle/:id`)
  are different containing routes even though they render the identical
  `ProductCard`. Any shared component reused across routes at different
  nesting depths needs absolute links, not relative ones.

## What's next

1. **Product photography** — still the long-standing open item from every
   prior handoff, though narrower now: every currently-photographed product
   is fully standardized (20/20, confirmed this session). What's left is
   coverage — several SKUs still show "Photo coming soon".
2. **True background removal**, if the user decides they want it — still
   deferred, needs a real AI segmentation API.
3. **The pre-order cutoff date is currently unset** ("No pre-order cutoff
   set" on Orders) — cleared after this session's live testing. Set the
   real one via the new Orders-page control whenever the next pre-order
   round should open.
4. No other known open bugs as of this session's end.

## Things to never re-do

Everything in the prior handoffs' "never re-do" lists still applies. Add
from this session:

- **Don't bump `INIT_VERSION` without expecting `seedCatalog()` to actually
  run** — it's not a no-op version bump, it forces the full slow-path setup
  (and both seeders) to run again on the next cold start. If `PADDLES` has
  accumulated any stale/dormant entries since the last bump (check for bare
  names with no real per-colour match in the live catalog), they WILL get
  inserted as phantoms the moment `INIT_VERSION` changes for any reason —
  audit `PADDLES` for exactly this before bumping, don't wait to catch it
  live in production again.
- **Don't add a new `PADDLES` entry with an alias and assume that's
  sufficient** — the alias only helps if it's a name the ledger actually
  once held. Verify the alias (and the canonical `name`) against a live
  catalog query, not just against memory of what the product used to be
  called.
- **Don't treat `payment_requirement` as binary (`deposit`/`full`)
  anywhere new.** It's now three values (`deposit`, `deposit_25`, `full`).
  `requirementOf()` and the `PAYMENT_REQUIREMENTS`-driven UI already handle
  all three, but any NEW hardcoded "50%" string (in copy, not math) will
  silently be wrong for a quarter of orders now. Grep for `"50%"` before
  adding customer- or admin-facing payment copy.
- **Don't derive pre-order messaging from batch data.** That's exactly the
  model this session replaced — a batch means real committed stock
  (in-transit tier), not a pre-order promise. The pre-order cutoff is
  `settings.preorder_cutoff_date`, set from Orders, full stop.

# Handoff — order/stock sync bugs, admin performance, photo pipeline

Written 2026-08-29, end of the session that followed
[`handoff-2026-08-27-storefront-visual-fixes.md`](handoff-2026-08-27-storefront-visual-fixes.md).
That doc closed out a visual-redesign pass with nothing pending. This
session was driven by the user testing real workflows in production and
reporting concrete breakage one at a time — most of it real, some of it
working-as-designed but confusing. Everything below is committed, pushed,
and deployed; nothing is pending review.

## Where things stand

- **Committed and deployed**: `main` is at `e9f6905`, live on
  `ptg-admin-hub.vercel.app` and aliased to `shop-paddletogo.vercel.app`
  (re-synced after every one of this session's 13 pushes — still not
  automatic, see prior handoffs).
- All 74 tests pass (`npm test -- --run`) — up from 64 at the start of this
  session. New coverage: two regression tests for the order id-collision
  bug, two for the stock-completion atomicity fix, three for
  `translateDialect`'s `MAX`→`GREATEST` rule, two for `saveOrder`'s
  completion behavior, and three for `publicPhoto()`'s inline-image
  acceptance.
- No test orders or test products left in production this time — every
  scratch product/order created for verification was deleted or cleaned up
  as part of this session (see each section below).

## What changed this session

### Order rejection on a variant/product id collision

`createOrder`'s inventory-matching query (`api/v1/_shared.js`) merged
`product_id` and `variant_id` into one shared-number lookup. Since both
spaces are small sequential integers, a variant could collide with an
unrelated product's id (Jade Mist was variant id 1; Franklin C45 ALW was
product id 1) — the wrong row could silently win and reject a valid,
in-stock item as `item_unavailable`. Fixed by keeping the two id spaces in
separate keyed maps end-to-end. Found live while placing the session's
first test order — this was a real, reproducible bug affecting real
customers, not a testing artifact.

### Stock never actually moved when an order was completed (two bugs, stacked)

The user reported "I completed an order and paid, but stock didn't
decrease" — twice, on two different orders. Root-caused as **two separate
bugs**, both real:

1. **Non-atomic completion.** `saveOrder` wrote the order's new status as
   its own separate db call, then resynced items, then applied the stock
   delta as yet another separate call. If anything after the status write
   failed, the order was left permanently stuck reporting "Completed" with
   stock never decremented — and unrecoverable by retrying "Complete
   order" again, because the retry would see the order already Completed
   and compute a zero net delta (the same diff-based logic that correctly
   stops a re-save from double-deducting). Fixed by committing the status
   change, item resync, and resulting stock/freebie movement all in one
   `dbBatch()` call — a real transaction (`runStatements` in `api/_db.js`
   wraps every batch in `BEGIN`/`COMMIT`/`ROLLBACK`).
2. **The actual SQL was invalid Postgres, found via the fix above.** Once
   completion was atomic, it started failing *every time* with `function
   max(integer, integer) does not exist`. The stock-floor UPDATE used
   SQLite's two-argument `MAX(a, b)` scalar form
   (`quantity = MAX(0, quantity + ?)`) — valid SQLite, but Postgres's
   `MAX()`/`MIN()` are aggregates only, one argument. **This means stock
   had likely never successfully decremented on any completed order since
   this app moved to Postgres**, admin-created or storefront-originated.
   Fixed by adding a `MAX(a,b)`→`GREATEST(a,b)` (and `MIN`→`LEAST`) rule to
   `translateDialect()` in `api/_db.js` — the existing, established place
   every SQLite/Postgres gap in this codebase gets fixed, rather than
   patching the three call sites directly.

Also added server-side error logging (`api/query.js` now `console.error`s
before returning a 400) — the client only ever showed a generic "database
error" toast before this, which is what made bug #2 invisible until Vercel
function logs were actually read.

Verified end-to-end multiple times: placed real orders, walked them through
Verify Payment → Complete order in the admin, confirmed via the live
`/api/v1/catalog` response and the admin Inventory screen that stock
genuinely dropped to zero and the storefront correctly flipped the
variant to "Pre-order."

### The bare "Sypik Triton 5" catalog seed kept coming back after deletion

Deleting it from Inventory never stuck — it reappeared under a new
auto-suffixed SKU (`PTG-TR5-2`, then `-3`) every time. Cause:
`seedCatalog()` (`src/lib/schema.js`) runs on every cold start with no
gate that actually skips it (`SEED_KEY`/`app_meta` was written but never
read back), and re-inserts any `PADDLES`/`ADDONS` entry whose name/alias
doesn't exactly match something already in inventory. The user's real
Sypik Triton 5 line is only ever carried per-colour ("...Jade Mist",
"...Olive Dust", etc.), so the standalone `{ name: "Sypik Triton 5", sku:
"PTG-TR5" }` seed entry never matched any of those and kept getting
recreated. Removed the entry outright rather than deleting the row again.

### Admin-wide slowness — the real cause, not any one screen

The user reported every page load and every save feeling slow. Root cause:
`initDb()` (`src/lib/schema.js`) ran its **entire first-time setup on
nearly every request** — 17 `CREATE TABLE IF NOT EXISTS` statements, a
column-existence check *per table* (~a dozen tables) for 59 tracked
columns, ~23 backfill `UPDATE`s, plus both seeders — 25-40+ sequential
round trips, chunked 10-at-a-time through `runBatch()`. Critically,
`initDb()` runs as **client-side JS in the browser** (bundled via
`data.js`), so every one of those round trips was a real browser→Vercel
HTTP request over the user's own connection, on every page load, not just
internal server latency.

Fixed with a version-stamped fast path: one cheap `SELECT` against
`app_meta.init_version` up front; if it matches the current
`INIT_VERSION` constant, skip straight past all of the above. A brand-new
database, or one on an older version, still runs full setup once, then
stamps itself. **`INIT_VERSION` must be bumped whenever
`LEGACY_TABLES`/`NEW_TABLES`/`ADDED_COLUMNS`/`PADDLES`/`ADDONS` actually
change**, or a new migration/seed entry silently never reaches an
already-initialized database — documented inline at the constant.
Verified live: Inventory went from the 7-9s waits seen constantly earlier
this session to near-instant.

### An uploaded storefront photo never reached the public site

Pasting a hosted URL worked; using "Take or choose a photo" (upload)
didn't, even after approval. Cause: two different URL validators
disagreed. The admin's own `safePhotoUrl` (`src/lib/storefront.js`)
accepts a `data:image/...` URI — what an uploaded photo becomes after
`compactImage()` resizes it — and showed it as approved/live. But
`publicPhoto()` in `api/v1/_shared.js`, the function that actually builds
what `/api/v1/catalog` returns, only ever accepted `https://`, `/images/`,
or `/assets/` — it silently dropped every `data:` URI. Fixed by adding the
same inline-image acceptance (with the same size cap) to `publicPhoto()`.
All previously-uploaded-and-approved photos started working immediately
without re-uploading, confirmed live for "Selkirk Omni Hydro."

### Storefront photo pipeline: standard size, white background, both paths

Per explicit request: every stored photo now goes through one shared
compositor (`compactImageElement()` in `StorefrontPhotos.jsx`) regardless
of how it arrives:
- **Standard frame**: Instagram's own 4:5 portrait ratio (1080×1350 scaled
  down through the existing size ladder to fit the storage cap), not the
  previous arbitrary-aspect-ratio canvas.
- **Transparent → white**: white is painted first, so any alpha
  transparency in the source becomes plain white automatically.
- **Fit, never cropped**: the source is scaled to fit inside the frame and
  centered.
- **Hosted URLs get it too now**, not just uploads — at save time, a
  pasted URL is fetched via a `crossOrigin: "anonymous"` `Image` and run
  through the identical compositor (`compactImageFromUrl`). Many
  third-party hosts don't send the CORS header this needs; that's treated
  as "can't standardize this one automatically," not an error — falls back
  to storing the original link untouched, exactly as before. Both
  branches verified live: a non-CORS host correctly fell back (raw URL,
  70 chars stored); a CORS-friendly host (Wikimedia, tested) correctly
  produced a real composited `data:image/webp;...` payload (14,023 chars).

**Explicitly out of scope, per direction**: true background *removal* —
cutting an existing photographed background out from behind the subject —
needs real subject segmentation (an AI service), which plain canvas code
can't do. The user chose "size + transparent-to-white only, for now" when
asked; if this comes up again, it's a new API integration with a real
per-image cost, not a quick addition.

### Storefront: plain white page background

`.public-shell`'s background was `--paper` (`#f5f7f6`, off-white).
Switched just the page background to `--surface` (pure white). `--paper`
itself is untouched everywhere else it's used (product sheet, deposit
box, upload dropzone) — that's the intentional subtle panel-vs-page
contrast, not the page background itself.

### Product photo cropping on both mobile and desktop (two-part fix)

1. **`object-fit`**: the product detail hero shared `object-fit: cover`
   with grid-card thumbnails, cropping the real photo to fill a fixed
   square. Split into its own rule using `object-fit: contain` so the
   whole photo always shows — grid cards/cart thumbnails unaffected (kept
   `cover`, correct for a uniform tile grid).
2. **Sizing** (found after the first fix alone didn't satisfy the report):
   `.public-product-image`'s box was hard-capped at `width: min(72%,
   320px)` regardless of viewport. On a wide desktop column this stranded
   the actual photo as a small box surrounded by a large area of plain
   gradient — looked like cropping/shrinking even though `contain` was
   working correctly. The same cap existed on mobile too (reported
   separately as "still cropped" after the desktop-only first attempt).
   Fixed by making the box fill its backdrop (`width/height: 100%`, no
   forced `aspect-ratio` on the box itself, since the backdrop is a tall
   rectangle on mobile and only square from the `≥960px` breakpoint).
   Verified via computed-style checks on both a real mobile viewport and a
   1400px desktop width: the photo box now exactly matches its backdrop's
   rect in both cases.

### Category and brand sync — confirmed already automatic, no code needed

Two separate requests ("add an Accessories category," "test brand
add/remove sync") turned out to need zero code changes — both are already
fully data-driven:
- **Brand** is derived from a product's name (first word, with known
  multi-word exceptions like "Bread and Butter") — never a stored field.
- **Category** is a free-text field already surfaced generically in the
  storefront's filter row, computed live from whatever values exist.

Both verified live by creating/renaming/deleting real test products and
watching the storefront filter row update on its own, cache lag aside
(~30-60s from the poll interval + `/api/v1/catalog`'s CDN cache). Along
the way, cleaned up a genuine duplicate product ("Selkirk Leather Red
Case" vs. the correctly-named "Selkirk Red Leather Case") that existed
from earlier admin edits.

## Known non-issues (don't re-investigate)

Everything already listed as a known non-issue in the prior handoffs still
applies. Add from this session:

- **The admin's own list-thumbnail crop (`Thumb` component,
  `StorefrontPhotos.jsx`) is a small square icon for scanning a list —
  it is not, and was never meant to be, a preview of the storefront's own
  framing.** Two stale comments claiming otherwise were corrected this
  session. The storefront itself shows the saved photo via `object-fit:
  contain`, uncropped, at whatever 4:5-ish shape it was saved in.
- **`/api/v1/catalog`'s 60s CDN cache** (documented in the prior handoff)
  bit this session too, more than once — a photo/category/product change
  can take up to a minute to show on the live storefront even though the
  database write succeeded instantly. Always re-check with a cache-busting
  query param or wait it out before concluding a fix didn't work.
- **Admin cold-start page loads still take a few seconds**, even after the
  `initDb()` performance fix — that remaining latency is normal Vercel
  serverless cold-start compute time, not query overhead. The fix
  eliminated the *self-inflicted* 25-40 extra round trips on top of that,
  it didn't eliminate cold starts themselves (not fixable from this
  codebase).

## What's next

1. **Product photography** — still the long-standing open item from every
   prior handoff. Real progress this session (several colours now have
   real uploaded photos, standardized and confirmed live), but most SKUs
   still show "Photo coming soon."
2. **True background removal**, if the user decides they want it after
   all — would need a real AI segmentation API (cost + new server-side
   integration), explicitly deferred this session, not started.
3. No other known open bugs as of this session's end.

## Things to never re-do

Everything in the prior handoffs' "never re-do" lists still applies. Add
from this session:

- **Don't assume a photo/category/product change "isn't syncing" without
  checking the `/api/v1/catalog` cache first.** Bypass with a
  `?_=<timestamp>` query param or wait ~60s — several "it's not working"
  reports this session turned out to be this cache, not a real bug.
- **Don't add a stock-floor `MAX(0, ...)`/`MIN(cap, ...)` UPDATE anywhere
  without checking it goes through `translateDialect()`.** SQLite's
  two-argument `MAX`/`MIN` silently doesn't exist in Postgres — the rule
  is there now, but a new call site written to bypass `db()`/`dbBatch()`
  (going straight to a raw client) would skip it.
- **Don't add a new `PADDLES`/`ADDONS` seed entry (or change an existing
  one's `name`/`aliases`) without checking it actually matches something
  real in inventory, or intending for `seedCatalog()` to keep recreating
  it forever.** That's exactly the bug this session fixed for "Sypik
  Triton 5."
- **Don't touch `LEGACY_TABLES`/`NEW_TABLES`/`ADDED_COLUMNS`/`PADDLES`/
  `ADDONS` in `schema.js` without bumping `INIT_VERSION` in the same
  change.** Skipping this means the new migration/seed silently never
  reaches a database that's already past the fast-path check.
- **Don't assume "Verify Payment" or "Reserved"/"Paid" status means stock
  moved.** Only the explicit "Complete order" action does that, by
  design — confirmed working correctly now, but still a real two-step
  process worth remembering when testing.

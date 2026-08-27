# Handoff — order sync, payment approval, pre-order ETAs

Written 2026-08-27, end of the session that followed
[`handoff-2026-08-27-storefront-workflows.md`](handoff-2026-08-27-storefront-workflows.md)
(checkout/compare/pre-order/storefront domain). That doc's "what's next"
listed the link-color specificity audit and durable idempotency storage as
top priorities — this session closed both, then kept going: a real
transaction boundary, an explicit payment-approval step, live-computed
"awaiting stock" sorting in the admin, and per-batch pre-order ETAs/cutoff
dates on the storefront. Everything below is committed and deployed;
nothing is pending review. **Next up, per the user: a storefront design
revision** — not started yet, this doc is the handoff into that work.

## Where things stand

- **Committed and deployed**: `main` is at `e6a23b7`, live on
  `ptg-admin-hub.vercel.app` and aliased to `shop-paddletogo.vercel.app`
  (re-synced after every push this session — see "storefront alias" in the
  prior handoff for why that step still isn't automatic).
- Build passes, all 64 tests pass (`npm test -- --run`) — up from 38 at the
  start of this session; new coverage is almost entirely in
  `api/v1/_shared.test.js`, `api/_db.test.js`, and a new
  `src/lib/data.sql-shape.test.js`.
- One real order sits in production as a live proof-of-sync test:
  `WEB-MTB9O64T` (Franklin C45 ALW, pre-order, Reserved), customer name
  `"TEST ORDER - sync verification (safe to cancel)"`. **Still there** —
  cancel or delete it from the admin whenever convenient, it was never
  cleaned up.

## What changed this session

### Link-color CSS specificity audit (closed out)

The prior handoff flagged this as open and confirmed `.public-cart-link`
was already silently affected. Swept every remaining bare-class `<a>`/
`<Link>` selector in `public.css` that loses the specificity fight against
`.public-shell a{color:inherit}`: `.public-cart-link`, `.public-back-link`,
`.public-secondary-link`, `.public-hero-cta`, `.public-product-back`,
`.public-state-link`, and `.public-quick-add` (which renders as **both** a
`<button>` and a `<Link>`, so it needed
`button.public-quick-add,a.public-quick-add`). Same fix pattern throughout:
qualify the selector with its element type, never touch the shared reset.
No more open instances of this bug class as of this session.

### Durable idempotency for `POST /api/v1/orders`

The `api_idempotency` table existed in `schema.js`/`_db.js` (scaffolded, per
`NO_ID_RETURNING`) but was never wired up — the `Idempotency-Key` header was
validated for shape and then discarded. `createOrder` (`api/v1/_shared.js`)
now claims the key via `INSERT ... ON CONFLICT (idempotency_key) DO
NOTHING` before touching inventory or `orders`, so two concurrent requests
for one key can never both create an order:
- Key already succeeded → replays the cached `201`.
- Key still in flight → `409 request_in_progress`.
- Request failed validation/availability → claim is released immediately,
  same key is retryable once fixed.

### Order + line-items now one real transaction

`createOrder` used to write the order row via `db.query()` then its line
items via a separate `db.batch()` — two independent transactions, with a
real window where the process dying between them could commit an order
with zero line items. Added `FIRST_INSERT_ID` (`api/_db.js`): a sentinel a
caller can put in a later statement's `args` inside one `db.batch()` call,
resolved to the row id the batch's **first** INSERT produced (not a
running previous-statement pointer — every line item references the order,
never a chain of dependent inserts). `createOrder` now sends the order
insert and every line-item insert as one batch, one transaction, rolled
back whole on any failure. This is now part of the documented adapter
contract in `docs/storefront-api-v1.md`, not just something the concrete
Postgres adapter happens to do.

### Explicit "Approve payment" step (admin)

Next to "View payment proof" in the order detail tray: an **"Approve
payment"** button (confirmed via the same `ConfirmTray` pattern as
"Complete order") that marks the order `Paid` once the operator has
actually checked the proof. A "Payment verified" chip replaces the button
once an order is `Paid` or `Completed`. Deliberately does **not** touch
stock — `Paid` and `Completed` stay two separate real-world events (money
received vs. a paddle actually leaving the shelf); stock still only moves
on `Completed`, unchanged from before, in `saveOrder`/`setOrderStatus`
(`src/lib/data.js`) — that logic (decrement on first completion, only the
diff on re-completion, put stock back on revert or delete) was already
solid and needed no changes.

### "Awaiting stock" surfaced in the Orders list (admin)

A **live** read — not a snapshot from when the order came in — of whether
any line on an open order (`Reserved`/`Pending`/`Paid`, never
`Completed`/`Cancelled`) currently sits at zero on hand:
- An "Awaiting stock" filter chip (shows only when relevant).
- A clay "Awaiting stock" badge on the order card and in the detail tray.
- Orders needing restock stably sort to the top of whatever's visible,
  newest-first within each group.

Restocking a paddle clears the badge on its own — same rule the storefront
uses to decide pre-order vs. in-stock (`lineOutOfStock` in `Orders.jsx`
mirrors `createOrder`'s `available > 0` check).

### Per-batch pre-order ETAs and cutoff dates

Real batch data now reaches the storefront wherever a pre-order shows up —
**never a fabricated range**, matching the project's standing rule against
inventing business-process data:

- **Schema**: new `batches.preorder_cutoff_date` column, additive,
  alongside the existing `expected_arrival`. Cutoff genuinely varies per
  batch (per the user), so it's a per-batch field, not one global setting.
- **Admin Batches screen**: a "Pre-order cutoff date" field per batch
  (`BatchTray`), shown on the batch card, plus a "Next pre-order cutoff"
  chip in the header beside Compare — soonest upcoming cutoff across every
  batch still open for pre-orders (`status` not `Received`/`Cancelled`).
- **`publicCatalog()`** (`api/v1/_shared.js`) attaches a `preorder` object
  (`ships_in`, `ready_date`, `cutoff_date`) to any `unavailable` product or
  variant, sourced from whichever open batch carries it in `batch_items`,
  picking the soonest `expected_arrival` when more than one qualifies.
  `ships_in` is computed from that real date (`"Ships in ~N weeks"`); a
  product/variant or batch with nothing real on file gets `preorder: null`.
  Documented in `docs/storefront-api-v1.md`.
- **Storefront**: a compact ships-in note on catalog cards; an "Estimated
  ready" + "Order by" line on the product page beside "Add to compare"; a
  pre-order banner at the top of Cart and Checkout when the cart has ≥1
  pre-order line (itemized, each line's own real ETA); the checkout submit
  button reads **"Place pre-order"** when the cart has one, **"Place
  order"** otherwise.
- Cart lines snapshot `isPreorder`/`preorder` at add-to-cart time — same as
  price/photo already did, not re-checked live while sitting in the cart.
- `/api/v1/catalog` has a pre-existing 60s CDN cache
  (`cache-control: public, max-age=60`, intentional) — a fresh deploy can
  take up to a minute to show through on that endpoint specifically. Not a
  bug, just worth remembering when verifying a catalog-facing change right
  after a deploy.

### Bug found and fixed: new-batch creation was broken

While adding `preorder_cutoff_date`, found `saveBatch()`'s **new**-batch
`INSERT` had one more value in its `VALUES` tuple than its column list had
columns (28 vs 27) — invalid SQL, Postgres rejects it outright ("INSERT has
more expressions than target columns"). This meant **creating a brand-new
batch had never actually worked** in this app; only editing an existing
batch (`UPDATE`, which was correctly shaped) succeeded. Fixed as part of
the same edit. Added `src/lib/data.sql-shape.test.js`: a static-analysis
regression test that parses every `INSERT INTO <table> (...) VALUES (...)`
in `data.js` and asserts column count matches `VALUES`-tuple arity,
table by table — there's no live-db test harness for `data.js` (it talks to
Postgres through `folkdb`'s fetch transport), so this is a text-level guard
rather than a behavioral one. **Worth testing "New batch" for real in the
admin** to confirm the fix holds against production Postgres, not just the
static check.

## Known non-issues (don't re-investigate)

Everything already listed as a known non-issue in the three prior handoff
docs still applies (admin login cold-start slowness, the two deleted stray
banner files, the two self-inflicted Supabase-Vercel env-var outages).

## What's next

1. **Storefront design revision** — the user's next request, not started.
   This doc is the handoff into it.
2. **Product photography** — still nothing approved for any paddle
   (`StorefrontPhotos.jsx` queue exists, unused). Carried over from the
   first two handoffs; still true.
3. **Verify "New batch" for real** against production Postgres now that
   the INSERT is fixed — the static test can't prove the live DB accepts
   it, only that the SQL shape is internally consistent.
4. **Clean up the `WEB-MTB9O64T` test order** in the admin whenever
   convenient — cancel or delete it (not done automatically, per this
   session's own "never permanently delete production data unasked" rule).
5. Durable idempotency storage and the order/line-items transaction
   boundary — both closed this session — were the last two items on
   `docs/storefront-api-v1.md`'s mounting checklist; that doc's checklist
   is now fully done.

## Things to never re-do

Everything in the prior three handoffs' "never re-do" lists still applies
(no unauthenticated `/api/query`-style endpoint, no `DATABASE_URL`/password
in chat, no SQLite-dialect fixes outside `api/_db.js`, no fabricated visual
content or business-process data, no guessing a redesign direction cold,
no removing a CSS reset to fix a specificity bug, no running a Vercel
security/protection-setting change unattended, don't forget the storefront
alias after a deploy). Add from this session:

- **Don't decrement stock on payment approval.** `Paid` and `Completed`
  are deliberately two different moments — money received vs. a paddle
  actually leaving the shelf. If a future session is asked to "make
  approving payment also take stock," that's a real design change to
  confirm explicitly, not an oversight to quietly fix.
- **Don't treat "awaiting stock" or "pre-order" as something to store and
  keep in sync.** Both are live reads off current inventory quantity,
  computed the same way (`quantity <= 0`) in the admin (`Orders.jsx`) and
  the storefront API (`createOrder`'s `available` check) independently.
  Keep it that way — a stored flag would drift the moment someone
  restocks, and the whole point was that it clears itself.
- **Don't write a raw INSERT/UPDATE by hand in `data.js` without running
  the tests.** `data.sql-shape.test.js` now catches a column/VALUES arity
  mismatch automatically — the bug it caught had shipped silently for who
  knows how long because nothing checked this before.

# paddle to go storefront api v1

## hosting constraint

The portal is a Vite + React app compiled as a static bundle by folk. The existing `__folkdata/query` endpoint is an app-internal database transport and is not a safe public API. Static Vite output cannot execute the `api/v1/*.js` handlers by itself. The handlers in this change are the contract and reference implementation, but they must be mounted on a server-side function or edge runtime before any public URL is advertised.

Do not expose `/__folkdata/query`, admin routes, or the database transport to the storefront.

## routes

`GET /api/v1/catalog`

Requires `Authorization: Bearer <PTG_STOREFRONT_API_KEY>`. Returns only active, non-archived products, customer prices, `available` or `unavailable` state, active variants, and approved storefront photos. It never returns quantities, costs, payments, batches, orders, settings, or SQL.

An `unavailable` product or variant carries a `preorder` object (`null` on anything `available`):

```json
"preorder": {"ships_in": "Ships in ~3 weeks", "ready_date": "2026-09-20", "cutoff_date": "2026-09-05"}
```

Sourced from whichever open batch (not yet `Received` or `Cancelled`) carries that product/variant in `batch_items`, picking the soonest `expected_arrival` when more than one qualifies. `ships_in` is computed honestly from that real date, never a fabricated range; `cutoff_date` is the batch's own `preorder_cutoff_date` (set per batch in the admin Batches screen, since it genuinely varies by shipment). Any field with nothing real on file is `null`, and `preorder` itself is `null` whenever nothing on the matching batch(es) has either date set — never a guess.

`OPTIONS /api/v1/catalog`

CORS preflight. Only origins listed in `STOREFRONT_ORIGINS` are echoed. The default is a non-production placeholder and must be replaced.

`POST /api/v1/orders`

Requires the same bearer key and an `Idempotency-Key` matching `[A-Za-z0-9._-]{8,100}`. Accepts a bounded JSON body:

```json
{
  "customer": {"name":"buyer", "email":"buyer@example.com", "phone":"+63...", "address":"delivery address", "facebook":"Facebook name or profile link", "recipient":"recipient name, recipient phone"},
  "fulfillment_method":"shipping",
  "shipping_fee_php":200,
  "items":[{"variant_id":12,"quantity":1}],
  "acknowledgment":true,
  "payment_proof_url":"https://..."
}
```

`customer.facebook` and `customer.recipient` are optional and additive — neither has a dedicated `orders` column, so when present they're appended to `orders.notes` (the same free-text field fulfilment context already lands in), not silently dropped. An older client that never sends them still gets the original note text unchanged.

The server validates fields, re-reads active inventory, rejects stale or duplicate lines, uses database prices rather than client prices, calculates the total and exact 50% deposit, and creates a `Pending` order plus order items. It does not decrement stock. It does not accept payment credentials. The acknowledgment is stored with the order. Response is `201` with order number, status, totals, deposit, and balance only.

Zero on-hand quantity is a pre-order, not a rejection — PTG imports every paddle in batches, so nothing in the catalog is ever unbuyable. A line is only capped against real, counted stock when `quantity > 0` for that product/variant; a pre-order line (`quantity = 0`) has no live count to exceed and always passes. `item_unavailable` now only fires for a genuinely gone product (archived, deleted, or an inactive variant), or for exceeding real stock on a line that has some.

## configuration

Set server-side secrets in the function runtime, never in Vite `VITE_*` variables and never in source control:

`PTG_STOREFRONT_API_KEY`: randomly generated secret, at least 32 characters

`STOREFRONT_ORIGINS`: comma-separated exact HTTPS storefront origins, for example `https://shop.example.com`

`PTG_API_RATE_LIMIT`: optional requests per minute per forwarded client address. Defaults are 60 for catalog and 10 for order creation.

The current in-memory rate limiter is a basic protection for a single function instance. A production multi-instance deployment should replace it with the host's shared rate-limit primitive.

The `Idempotency-Key` header is now backed by durable storage: `POST /api/v1/orders` claims the key in the `api_idempotency` table (an `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`, so two concurrent requests for the same key can never both create an order) before touching inventory or `orders`. A repeat request for a key that already produced an order replays the cached `201` response instead of re-creating it; a repeat request for a key that's still mid-flight gets `409 request_in_progress`; a key whose request failed validation or availability has its claim released immediately, so the same key can be retried once the request is fixed.

The order insert and its line-item inserts are now one `db.batch()` call, one real transaction — not the order insert followed by a separate batch call, which used to leave a window where the process could die after the order committed but before any line existed. Line items reference the order row's id via `FIRST_INSERT_ID` (see the adapter contract note below), since that id doesn't exist yet when the statement list is built.

## error shape

All errors use:

```json
{"error":{"code":"item_unavailable","message":"one or more selected items are no longer available"}}
```

Clients should handle `401`, `409`, `422`, `429`, and `503` without displaying internal details.

## mounting checklist

1. Put the handlers behind a server-side runtime that can access the existing shared SQLite database through a trusted server adapter.
2. Pass an adapter with `query(sql, args)` and `batch(statements)` to the handlers. Do not pass the browser `folkdb` transport directly to an untrusted request. `batch(statements)` must run every statement in one real transaction and must resolve `FIRST_INSERT_ID` (exported by `api/_db.js`) when it appears in a later statement's `args`, substituting the row id the batch's *first* INSERT produced — not a running previous-statement pointer. `createOrder` relies on this to put an order insert and its dependent line-item inserts in one atomic call.
3. Keep the API origin separate from the admin UI origin if possible.
4. Set the two secrets in the runtime secret manager and configure the exact storefront origin.
5. Durable idempotency storage and a real transaction boundary around the order-plus-line-items insert are both done (see above).
6. Run the test suite and an external security review before deployment.

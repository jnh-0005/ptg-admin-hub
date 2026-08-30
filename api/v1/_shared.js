// FIRST_INSERT_ID is part of the db adapter contract now (see api/_db.js
// and docs/storefront-api-v1.md's "mounting checklist"), not just the
// concrete Postgres adapter's business — any adapter passed to these
// handlers must resolve it inside db.batch() the same way.
import { FIRST_INSERT_ID } from "../_db.js";

const DEFAULT_ORIGIN = "https://storefront.example";
// Proof-of-payment is an inline compressed image (see compactProof in
// PublicCatalog.jsx), not a hosted URL — it can legitimately run up to the
// same 150,000-char cap that compactProof enforces client-side. The body
// limit has to be comfortably above that plus the rest of the order fields.
const MAX_PROOF_URL_CHARS = 150_000;
const MAX_BODY_BYTES = 200_000;
const rateState = new Map();

export function apiError(status, code, message, details) {
  return json(status, { error: { code, message, ...(details ? { details } : {}) } });
}

export function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export function corsHeaders(request, env = {}) {
  const requested = request.headers.get("origin");
  const configured = String(env.STOREFRONT_ORIGINS || "").split(",").map((x) => x.trim()).filter(Boolean);
  const allowlist = configured.length ? configured : [DEFAULT_ORIGIN];
  const headers = { vary: "Origin" };
  if (requested && allowlist.includes(requested)) {
    headers["access-control-allow-origin"] = requested;
    headers["access-control-allow-methods"] = "GET, POST, OPTIONS";
    headers["access-control-allow-headers"] = "content-type, authorization, idempotency-key";
    headers["access-control-max-age"] = "600";
  }
  return headers;
}

export function options(request, env) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export function requireApiKey(request, env) {
  const expected = String(env.PTG_STOREFRONT_API_KEY || "");
  if (!expected || expected.length < 32) return apiError(503, "api_not_configured", "storefront api is not configured");
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (provided.length !== expected.length || !constantTimeEqual(provided, expected)) {
    return apiError(401, "unauthorized", "a valid storefront api key is required");
  }
  return null;
}

function constantTimeEqual(a, b) {
  let result = a.length ^ b.length;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return result === 0;
}

export function rateLimit(request, env, limit = 20, windowMs = 60_000) {
  const key = `${request.headers.get("x-forwarded-for") || "unknown"}:${request.url}`;
  const now = Date.now();
  const prior = rateState.get(key) || { count: 0, reset: now + windowMs };
  if (now > prior.reset) { prior.count = 0; prior.reset = now + windowMs; }
  prior.count += 1;
  rateState.set(key, prior);
  return prior.count > Number(env.PTG_API_RATE_LIMIT || limit)
    ? apiError(429, "rate_limited", "too many requests", { retry_after_seconds: Math.ceil((prior.reset - now) / 1000) })
    : null;
}

export async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) throw new Error("body_too_large");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new Error("body_too_large");
  return JSON.parse(text || "{}");
}

export function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "")); }
export function cleanText(value, max) { return String(value || "").trim().replace(/[<>]/g, "").slice(0, max); }
export function positiveInt(value) { return Number.isInteger(value) && value > 0 && value <= 20; }

// Matches src/lib/storefront.js's INLINE_IMAGE_RE exactly — a photo taken or
// picked in the admin's "Manage storefront photos" screen goes through that
// file's compactImage(), which stores it as a data: URI, not a hosted URL.
// This function used to only accept https://, /images/, or /assets/, so an
// uploaded (rather than pasted-URL) photo passed admin approval — safePhotoUrl
// there accepts the same data: shape — but publicCatalog() below silently
// dropped it before it ever reached the storefront API response.
const INLINE_IMAGE_RE = /^data:image\/(?:webp|jpeg|jpg|png);base64,[a-z0-9+/=]+$/i;
const MAX_INLINE_PHOTO_CHARS = 160_000;

export function publicPhoto(row) {
  const value = String(row.photo_url || "").trim();
  if (INLINE_IMAGE_RE.test(value)) return value.length <= MAX_INLINE_PHOTO_CHARS ? value : null;
  return /^(https:\/\/|\/images\/|\/assets\/)[^\s<>"']+$/i.test(value) ? value : null;
}

/**
 * "Ships in ~N weeks", computed honestly from a real expected_arrival date
 * an operator entered — never a fabricated range. A date in the past or
 * today reads as "Shipping soon" rather than "~0 weeks".
 */
export function shipsInText(expectedArrival) {
  const arrival = new Date(`${expectedArrival}T00:00:00Z`);
  if (Number.isNaN(arrival.getTime())) return null;
  const days = Math.ceil((arrival - Date.now()) / 86_400_000);
  if (days <= 0) return "Shipping soon";
  const weeks = Math.max(1, Math.round(days / 7));
  return `Ships in ~${weeks} week${weeks === 1 ? "" : "s"}`;
}

/**
 * The ONE global pre-order round date (settings.preorder_cutoff_date — see
 * schema.js for why this isn't batch-scoped): a plain pre-order exists
 * before any batch does, so every out-of-stock item not already covered by
 * an in-transit batch shares this single "order by" date, set from the
 * Orders page. A date already in the past reads exactly like no date at
 * all — a forgotten stale cutoff never shows on the storefront as if today
 * were still the deadline.
 */
async function activePreorderCutoff(db) {
  const { rows } = await db.query(`SELECT preorder_cutoff_date FROM settings WHERE id = 1`);
  const cutoff = rows[0]?.preorder_cutoff_date || null;
  if (!cutoff) return null;
  const todayStr = new Date().toISOString().slice(0, 10);
  return cutoff >= todayStr ? cutoff : null;
}

/**
 * Distinct from activePreorderCutoff above: this is specifically stock the
 * owner has already committed real money to and that's physically moving
 * (batch status "In Transit" — see BATCH_STATUSES in src/lib/calc.js), not a
 * batch merely "Planned" or "Ordered", and not the plain pre-order round. A
 * customer reserving this carries less risk than a from-scratch pre-order,
 * so the storefront offers it at a lower deposit (see IN_TRANSIT_DEPOSIT_RATIO)
 * with its own messaging and pill.
 *
 * "Remaining" is the batch line's quantity minus whatever's already been
 * claimed by other orders against that exact batch (order_items.batch_id) —
 * reserving one is buying it, so it comes straight off what's left to offer.
 * Cancelled orders don't hold a claim. Only batch lines with remaining > 0
 * are returned; once a line is fully claimed, further demand falls back to
 * the ordinary pre-order round (activePreorderCutoff), not a phantom
 * 0-in-transit badge.
 */
async function inTransitInfoMaps(db) {
  // order_items.inventory_id is always the parent product id, even for a
  // variant line (see buildOrder below) — a plain "oi.inventory_id =
  // bi.product_id" match would also catch that product's OTHER colours'
  // order lines against a product-level (no-variant) batch item. The two
  // branches below are deliberately exclusive: a variant batch line only
  // ever matches order lines for that exact variant, a product-level batch
  // line only ever matches order lines with no variant at all.
  const rows = await db.query(`SELECT bi.id AS batch_item_id, bi.batch_id, bi.product_id, bi.variant_id, bi.quantity,
      b.expected_arrival, b.preorder_cutoff_date,
      COALESCE((
        SELECT SUM(oi.quantity) FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE oi.batch_id = bi.batch_id
          AND o.status <> 'Cancelled'
          AND (
            (bi.variant_id IS NOT NULL AND oi.variant_id = bi.variant_id)
            OR (bi.variant_id IS NULL AND oi.inventory_id = bi.product_id AND oi.variant_id IS NULL)
          )
      ), 0) AS claimed
    FROM batch_items bi
    JOIN batches b ON b.id = bi.batch_id
    WHERE b.status = 'In Transit'`);
  const byVariant = new Map();
  const byProduct = new Map();
  for (const row of rows.rows) {
    const remaining = Number(row.quantity || 0) - Number(row.claimed || 0);
    if (remaining <= 0) continue;
    const info = {
      remaining,
      batch_id: row.batch_id,
      ships_in: row.expected_arrival ? shipsInText(row.expected_arrival) : null,
      ready_date: row.expected_arrival || null,
      cutoff_date: row.preorder_cutoff_date || null,
    };
    const map = row.variant_id ? byVariant : byProduct;
    const key = row.variant_id || row.product_id;
    const existing = map.get(key);
    if (!existing || (info.ready_date && (!existing.ready_date || info.ready_date < existing.ready_date))) {
      map.set(key, info);
    }
  }
  return { byVariant, byProduct };
}

export async function publicCatalog(db) {
  const products = await db.query(`SELECT i.id, i.name, i.sku, i.category, i.sell_price, i.photo_url,
    CASE WHEN COALESCE(i.quantity, 0) > 0 THEN 'available' ELSE 'unavailable' END AS availability
    FROM inventory i
    WHERE COALESCE(i.notes, '') NOT LIKE '[archived]%'
      AND COALESCE(i.category, '') <> 'Add-on'
    ORDER BY i.name COLLATE NOCASE`);
  const variants = await db.query(`SELECT v.id, v.inventory_id, v.color, v.sku, v.selling_price_php, v.photo_url,
    CASE WHEN COALESCE(v.quantity, 0) > 0 THEN 'available' ELSE 'unavailable' END AS availability
    FROM inventory_variants v WHERE v.active = 1 ORDER BY v.color COLLATE NOCASE`);
  const photos = await db.query(`SELECT identity_type, identity_key, photo_url FROM storefront_photos
    WHERE active = 1 AND approval_status IN ('approved', 'published')`);
  const photoMap = new Map(photos.rows.map((p) => [`${p.identity_type}:${p.identity_key}`, publicPhoto(p)]));
  const cutoff = await activePreorderCutoff(db);
  const inTransit = await inTransitInfoMaps(db);
  // In transit always outranks the plain pre-order round — it's real,
  // already-paid-for stock, not a promise to open a batch once the cutoff
  // arrives. An item only gets the generic preorder object when it's
  // unavailable, NOT covered by an in-transit batch, and a round is
  // currently open (activePreorderCutoff already folds "no cutoff set" and
  // "cutoff already passed" into the same null).
  const items = products.rows.map((p) => {
    const productInTransit = p.availability === "unavailable" ? inTransit.byProduct.get(p.id) || null : null;
    return {
      id: p.id, name: p.name, sku: p.sku || null, category: p.category || null,
      price_php: Number(p.sell_price || 0), availability: p.availability,
      photo_url: photoMap.get(`model:${p.name}`) || photoMap.get(`brand:${String(p.name).split(/\s+/)[0]}`) || publicPhoto(p),
      preorder: p.availability === "unavailable" && !productInTransit && cutoff ? { cutoff_date: cutoff } : null,
      in_transit: productInTransit,
      variants: variants.rows.filter((v) => Number(v.inventory_id) === Number(p.id)).map((v) => {
        const variantInTransit = v.availability === "unavailable" ? inTransit.byVariant.get(v.id) || null : null;
        return {
          id: v.id, color: v.color, sku: v.sku || null, price_php: Number(v.selling_price_php || p.sell_price || 0),
          availability: v.availability, photo_url: photoMap.get(`model:${p.name}::${v.color}`) || publicPhoto(v),
          preorder: v.availability === "unavailable" && !variantInTransit && cutoff ? { cutoff_date: cutoff } : null,
          in_transit: variantInTransit,
        };
      }),
    };
  });
  return { version: "v1", currency: "PHP", products: items };
}

/**
 * Durable replay protection for POST /api/v1/orders, backed by the
 * `api_idempotency` table (src/lib/schema.js) — that table and its
 * NO_ID_RETURNING entry (api/_db.js) were already scaffolded for exactly
 * this and never wired up; this is the wiring.
 *
 * Claim-then-fill, not read-then-write: the INSERT ... ON CONFLICT DO
 * NOTHING is the atomic step. Two requests racing on the same key can both
 * reach this function, but only one can affect a row on that INSERT — the
 * loser sees affectedRows === 0 and never runs buildOrder, so it can never
 * produce a second order for one key. The winner fills the row with the
 * real response after buildOrder succeeds, or deletes its own claim on a
 * validation/availability failure so the same key can be retried once the
 * request is fixed — only a genuine success is ever cached.
 */
export async function createOrder(db, body, idempotencyKey) {
  const claim = await db.query(
    `INSERT INTO api_idempotency (idempotency_key, endpoint) VALUES (?, 'orders') ON CONFLICT (idempotency_key) DO NOTHING`,
    [idempotencyKey],
  );
  if (!claim.affectedRows) {
    const existing = await db.query(
      `SELECT response_json FROM api_idempotency WHERE idempotency_key = ? AND endpoint = 'orders'`,
      [idempotencyKey],
    );
    const cached = existing.rows[0]?.response_json;
    if (cached) return json(201, JSON.parse(cached));
    // Claimed by another in-flight request (or an interrupted one that never
    // reached a terminal state) — never fabricate a second order for this
    // key. The client's own retry logic should back off and try again.
    return apiError(409, "request_in_progress", "a request with this idempotency-key is already being processed");
  }
  const response = await buildOrder(db, body);
  if (response.status === 201) {
    const text = await response.clone().text();
    await db.query(`UPDATE api_idempotency SET response_json = ? WHERE idempotency_key = ?`, [text, idempotencyKey]);
  } else {
    await db.query(`DELETE FROM api_idempotency WHERE idempotency_key = ?`, [idempotencyKey]);
  }
  return response;
}

async function buildOrder(db, body) {
  const errors = [];
  const customer = body?.customer || {};
  if (!cleanText(customer.name, 120)) errors.push("customer.name is required");
  if (!validEmail(customer.email)) errors.push("customer.email must be valid");
  if (!cleanText(customer.phone, 40)) errors.push("customer.phone is required");
  // Pickup orders arrange details after review, same as the admin app's own
  // checkout — an address is only meaningful (and required) for shipping.
  if (body?.fulfillment_method === "shipping" && !cleanText(customer.address, 500)) {
    errors.push("customer.address is required for shipping");
  }
  if (!Array.isArray(body?.items) || body.items.length < 1 || body.items.length > 5) errors.push("items must contain 1 to 5 lines");
  if (body?.acknowledgment !== true) errors.push("acknowledgment must be accepted");
  if (!["pickup", "shipping"].includes(body?.fulfillment_method)) errors.push("fulfillment_method must be pickup or shipping");
  if (errors.length) return apiError(422, "validation_error", "request validation failed", errors);

  const requestedIds = body.items.map((x) => Number(x.variant_id || x.product_id));
  if (requestedIds.some((x) => !Number.isInteger(x) || x <= 0) || new Set(requestedIds).size !== requestedIds.length) {
    return apiError(422, "validation_error", "each item needs a unique positive product_id or variant_id");
  }
  // product_id and variant_id are separate id spaces that both happen to be
  // small sequential integers, so the same number (e.g. 1) routinely names
  // both a real product and an unrelated variant. Keep every requested id in
  // whichever space it was actually sent under, and query/key each space
  // separately below — merging them into one shared-number lookup let an
  // unrelated row silently win and reject a perfectly valid, in-stock item.
  const productIds = body.items.filter((x) => !x.variant_id).map((x) => Number(x.product_id));
  const variantIds = body.items.filter((x) => x.variant_id).map((x) => Number(x.variant_id));
  // inventory has no `active` column in this schema — archived products are
  // marked with a `[archived]` prefix in `notes` instead (see schema.js),
  // the same rule publicCatalog() above already applies.
  const rows = await db.query(`SELECT i.id AS product_id, i.name, i.unit_cost, i.sell_price, i.quantity AS product_quantity,
    v.id AS variant_id, v.color, v.active AS variant_active, v.quantity AS variant_quantity, v.selling_price_php
    FROM inventory i LEFT JOIN inventory_variants v ON v.inventory_id = i.id
    WHERE COALESCE(i.notes, '') NOT LIKE '[archived]%' AND COALESCE(i.category, '') <> 'Add-on'
      AND (i.id IN (${productIds.length ? productIds.map(() => "?").join(",") : "NULL"}) OR v.id IN (${variantIds.length ? variantIds.map(() => "?").join(",") : "NULL"}))`, [...productIds, ...variantIds]);
  const productSet = new Set(productIds);
  const variantSet = new Set(variantIds);
  const byProductId = new Map();
  const byVariantId = new Map();
  for (const row of rows.rows) {
    if (row.variant_id != null && variantSet.has(Number(row.variant_id))) byVariantId.set(Number(row.variant_id), row);
    if (row.variant_id == null && productSet.has(Number(row.product_id))) byProductId.set(Number(row.product_id), row);
  }
  // Re-checked server-side, never trusted from the client: whether any
  // requested line can actually be claimed against real in-transit stock.
  // A line only gets the in-transit batch_id (and the order its 25% rate)
  // when the matched batch line has enough REMAINING quantity to cover the
  // whole request — a partial match still falls back to the ordinary
  // pre-order path for that line rather than silently short-claiming it.
  const { byVariant: inTransitByVariant, byProduct: inTransitByProduct } = await inTransitInfoMaps(db);

  const lines = [];
  for (const input of body.items) {
    const row = input.variant_id ? byVariantId.get(Number(input.variant_id)) : byProductId.get(Number(input.product_id));
    if (!row || (input.variant_id && row.variant_active !== 1)) return apiError(409, "item_unavailable", "one or more selected items are no longer available");
    if (!positiveInt(input.quantity)) return apiError(422, "validation_error", "quantity must be an integer from 1 to 20");
    const available = input.variant_id ? Number(row.variant_quantity || 0) : Number(row.product_quantity || 0);
    // Zero on hand is a pre-order, not a dead end — PTG imports every paddle
    // in batches, so nothing in the catalog is ever truly unbuyable. Only cap
    // an order line against real, counted stock when there is real stock to
    // exceed; a pre-order line has no live quantity to check against.
    if (available > 0 && available < input.quantity) return apiError(409, "item_unavailable", "one or more selected items are no longer available");
    const unit = Math.max(0, Number(input.variant_id ? row.selling_price_php || row.sell_price : row.sell_price || 0));
    const inTransitInfo = input.variant_id ? inTransitByVariant.get(Number(input.variant_id)) : inTransitByProduct.get(Number(row.product_id));
    const claimsInTransit = available <= 0 && inTransitInfo && inTransitInfo.remaining >= input.quantity;
    lines.push({
      product_id: row.product_id,
      variant_id: row.variant_id || null,
      name: row.name + (row.color ? ` (${row.color})` : ""),
      quantity: input.quantity,
      unit,
      cost: Math.max(0, Number(row.unit_cost || 0)),
      batch_id: claimsInTransit ? inTransitInfo.batch_id : null,
    });
  }
  const subtotal = lines.reduce((sum, line) => sum + line.unit * line.quantity, 0);
  const shipping = body.fulfillment_method === "shipping" ? Math.max(0, Number(body.shipping_fee_php || 0)) : 0;
  if (!Number.isFinite(shipping) || shipping > 10000) return apiError(422, "validation_error", "shipping_fee_php is invalid");
  const total = Math.round((subtotal + shipping) * 100) / 100;
  // Whole order gets the in-transit rate if ANY line claimed real in-transit
  // stock — same cart-wide-flag pattern the storefront already uses for
  // "hasPreorder" rather than prorating a mixed cart line by line.
  const hasInTransit = lines.some((line) => line.batch_id != null);
  const paymentRequirement = hasInTransit ? "deposit_25" : "deposit";
  const depositRatio = hasInTransit ? 0.25 : 0.5;
  const deposit = Math.round(total * depositRatio * 100) / 100;
  const orderNumber = `WEB-${Date.now().toString(36).toUpperCase()}`;
  // payment_proof_url is a real column the admin's order detail view reads
  // directly (per docs/storefront-api-v1.md) — it must not be buried inside
  // `notes` as JSON, or "view payment proof" in the admin app shows nothing.
  const proofUrl = cleanText(body.payment_proof_url, MAX_PROOF_URL_CHARS) || null;
  const isShipping = body.fulfillment_method === "shipping";
  // The storefront collects a Facebook name/profile link and (for shipping)
  // a recipient — neither has a dedicated orders column, so they land in
  // notes, the same free-text field the admin already reads for fulfilment
  // context. Purely additive: an old client that never sends these fields
  // still gets the original two-sentence note.
  const noteParts = [isShipping ? "Shipping fee to be confirmed by Paddle To Go." : "Customer selected pickup."];
  const facebookContact = cleanText(customer.facebook, 200);
  if (facebookContact) noteParts.push(`Facebook: ${facebookContact}`);
  const recipient = cleanText(customer.recipient, 200);
  if (isShipping && recipient) noteParts.push(`Recipient: ${recipient}`);
  const note = noteParts.join(" ");
  const shippingAddress = isShipping ? cleanText(customer.address, 500) || null : null;
  // Order insert and its line-item inserts go in ONE db.batch() call, not
  // query() then batch() — that used to be two separate transactions with a
  // real window between them where the process could die after the order
  // committed but before any line existed. FIRST_INSERT_ID (api/_db.js) lets
  // every line-item statement reference the order row's id even though it
  // doesn't exist yet when this array is built; the concrete adapter
  // resolves it from the batch's own first INSERT before running the rest.
  const [orderResult] = await db.batch([
    {
      sql: `INSERT INTO orders (order_number, order_date, customer_name, customer, customer_email, customer_phone, shipping_address, channel, status, payment_requirement, shipping_income_php, notes, sale_total, product_cost, shipping_cost, profit, order_type, fulfillment_method, payment_proof_url, acknowledgment)
        VALUES (?, CURRENT_DATE, ?, ?, ?, ?, ?, 'Storefront', 'Pending', ?, ?, ?, ?, ?, ?, ?, 'Batch', ?, ?, ?)`,
      args: [orderNumber, cleanText(customer.name, 120), cleanText(customer.name, 120), cleanText(customer.email, 200), cleanText(customer.phone, 40), shippingAddress, paymentRequirement, shipping, note, total, lines.reduce((s, l) => s + l.cost * l.quantity, 0), shipping, 0, body.fulfillment_method, proofUrl, "Customer accepted non-refundable/non-cancellable acknowledgment"],
    },
    ...lines.map((line) => ({
      sql: `INSERT INTO order_items (order_id, inventory_id, variant_id, product_name, quantity, unit_price, unit_cost, batch_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [FIRST_INSERT_ID, line.product_id, line.variant_id, line.name, line.quantity, line.unit, line.cost, line.batch_id],
    })),
  ]);
  const orderId = orderResult.lastInsertId;
  return json(201, { version: "v1", order: { id: orderId, order_number: orderNumber, status: "Pending", subtotal_php: subtotal, shipping_php: shipping, total_php: total, deposit_php: deposit, balance_php: Math.round((total - deposit) * 100) / 100, payment_requirement: paymentRequirement } });
}

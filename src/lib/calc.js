/**
 * Every peso figure in the app comes from this file. Nothing recomputes profit
 * inline anywhere else.
 *
 * The chain, in the order it happens:
 *   VND Cost  →  PHP Supplier Cost (÷ rate)  →  + Combined Shipping Allocation
 *   →  Landed Cost  →  Selling Price − Landed Cost = Actual Profit
 *
 * PTG extension: freebies handed out with an order are a real cost, so they are
 * subtracted from profit exactly like landed cost is.
 */

import { DEPOSIT_RATIO } from "./depositRatio";

export const DEFAULT_SETTINGS = {
  php_to_vnd_rate: 416,
  default_shipping_php: 200,
  default_markup_percent: 15,
  desired_profit_margin_percent: 20,
};

export const DEFAULT_BATCH_SHIPPING = 200;
/**
 * THE INTERNATIONAL RATE HAS NO DEFAULT, ON PURPOSE. Every batch is quoted
 * separately by the supplier, so a new batch starts blank and a historical one
 * keeps whatever it was saved with. Nothing in the app fills this in.
 */
export const DEFAULT_INTL_RATE_VND_PER_KG = 0;
/**
 * A HELPER PLACEHOLDER ONLY, never a value. It appears as greyed example text
 * in the rate field so the operator can see the shape of the figure expected,
 * and it is never written, never defaulted to, and never used in any maths.
 */
export const EXAMPLE_INTL_RATE_VND_PER_KG = 30000;
export const INTL_QUOTE_BASIS = {
  PER_KG: "per_kg",
  FLAT_TOTAL: "flat_total",
};

export const INTL_SHIPPING_METHODS = ["per_kg", "total_batch", "per_item", "manual"];
export const BATCH_ALLOCATION_METHODS = ["equal_per_item", "by_weight", "manual_per_product"];

/**
 * Deposit orders reserve stock at half the billed total. Lives in its own
 * leaf module (see depositRatio.js, imported above) so the storefront can
 * import just this constant without pulling in the rest of this file's
 * admin pricing logic — re-exported here so every existing admin import of
 * it from calc.js still works unchanged.
 */
export { DEPOSIT_RATIO };

/**
 * LEGACY ONLY, as of the 2026-08-30 revision. In-transit stock used to carry
 * a lower deposit than a from-scratch pre-order (real money already on the
 * way meant less risk). That distinction is retired: reserving in-transit
 * stock now costs the same 50% as a normal pre-order (DEPOSIT_RATIO), with
 * the balance due once the paddle is on hand, in full, before it ships.
 *
 * This constant and the `deposit_25` requirement stay wired up so any order
 * already recorded at 25% keeps computing and displaying exactly what it did
 * when it was placed — nothing rewrites history. No new order is ever
 * assigned `deposit_25`; see buildOrder in api/v1/_shared.js.
 */
export const IN_TRANSIT_DEPOSIT_RATIO = 0.25;

const DEPOSIT_RATIO_BY_REQUIREMENT = {
  deposit: DEPOSIT_RATIO,
  deposit_25: IN_TRANSIT_DEPOSIT_RATIO,
};

export const DEPOSIT_RESERVE_NOTE =
  "Stock is reserved upon receipt of the 50% deposit. Without the deposit, stock may be sold to immediate full-payment buyers.";

/** Legacy only — shown in Orders.jsx solely for an order actually placed at the old 25% rate. */
export const IN_TRANSIT_DEPOSIT_RESERVE_NOTE =
  "Stock is reserved upon receipt of the 25% deposit. This batch is already in transit — the balance is due once it's on hand.";

/* ------------------------------------------------------------- primitives */

export const M = (v, fallback = 0) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

export const int = (v, fallback = 0) => {
  const n = Math.round(M(v, fallback));
  return Number.isFinite(n) ? n : fallback;
};

const PHP2 = new Intl.NumberFormat("en-PH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const PHP0 = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 });
const PLAIN0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** ₱ with a true minus sign, so a negative never reads as a hyphenated code. */
export function php(value, { decimals = 2, sign = false } = {}) {
  const n = M(value);
  const body = decimals === 0 ? PHP0.format(Math.abs(n)) : PHP2.format(Math.abs(n));
  const prefix = n < 0 ? "−" : sign && n > 0 ? "+" : "";
  return `${prefix}₱${body}`;
}

/** Compact ₱ for hero figures, where ₱1,284,000.00 would never fit. */
export function phpShort(value) {
  const n = M(value);
  const abs = Math.abs(n);
  const sign = n < 0 ? "−₱" : "₱";
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 2)}M`;
  if (abs >= 1e4) return `${sign}${(abs / 1e3).toFixed(abs >= 1e5 ? 0 : 1)}k`;
  return `${sign}${PHP0.format(Math.round(abs))}`;
}

export function vnd(value) {
  return `${PLAIN0.format(Math.round(M(value)))}₫`;
}

export function pct(value, decimals = 1) {
  const n = M(value);
  return `${n < 0 ? "−" : ""}${Math.abs(n).toFixed(decimals)}%`;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function formatDate(value) {
  if (!value) return "—";
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateShort(value) {
  if (!value) return "—";
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** The single conversion. A zero or missing rate yields 0, never Infinity. */
export function vndToPhp(amountVnd, rate) {
  const r = M(rate, DEFAULT_SETTINGS.php_to_vnd_rate);
  return r <= 0 ? 0 : M(amountVnd) / r;
}

/* ------------------------------------------------------------ vocabularies */

export const BATCH_STATUSES = ["Planned", "Ordered", "In Transit", "Received", "Cancelled"];
export const ORDER_STATUSES = ["Pending", "Reserved", "Paid", "Completed", "Cancelled"];

/**
 * A 50% deposit is non-refundable, so the moment an order is marked "Paid"
 * (payment verified — see verifyPayment in Orders.jsx) that stock is sold:
 * it belongs to the customer, whether or not the paddle has physically left
 * the shelf yet. Stock moves the instant an order FIRST reaches either of
 * these statuses, not only on "Completed" (fulfilment) — see saveOrder in
 * src/lib/data.js, the one place that actually moves quantity_on_hand.
 */
export const STOCK_COMMITTED_STATUSES = ["Paid", "Completed"];
export const isStockCommitted = (status) => STOCK_COMMITTED_STATUSES.includes(status);

/**
 * Stock movement vocabulary. `sign` is the direction the movement pushes stock,
 * so a type never has to be interpreted twice.
 */
export const MOVEMENT_TYPES = {
  Receipt: { sign: 1, label: "Receipt", tone: "teal", note: "Batch received" },
  Sale: { sign: -1, label: "Sale", tone: "cobalt", note: "Order completed" },
  Return: { sign: 1, label: "Return", tone: "plum", note: "Came back in" },
  Adjustment: { sign: 0, label: "Adjustment", tone: "gray", note: "Manual count" },
  Correction: { sign: 0, label: "Correction", tone: "clay", note: "Fixing a mistake" },
};

export const MOVEMENT_FILTERS = ["All", "Receipt", "Sale", "Adjustment", "Return", "Correction"];

export const movementMeta = (type) =>
  MOVEMENT_TYPES[type] || { sign: 0, label: type || "Movement", tone: "gray", note: "" };

/** Where an order physically is, separate from whether it is paid. */
export const FULFILLMENT_STATUSES = [
  "Not shipped",
  "Packed",
  "Shipped",
  "In transit",
  "Out for delivery",
  "Delivered",
  "Returned",
];

export const TONE_FOR_FULFILLMENT = {
  "Not shipped": "gray",
  Packed: "plum",
  Shipped: "cobalt",
  "In transit": "cobalt",
  "Out for delivery": "cobalt",
  Delivered: "teal",
  Returned: "clay",
};

export const CARRIERS = ["J&T Express", "LBC", "Flash Express", "Ninja Van", "GrabExpress", "2GO", "Other"];
export const PAYMENT_STATUSES = ["Received", "Pending", "Refunded"];
export const PAYMENT_METHODS = ["GCash", "Bank transfer", "Cash", "Maya", "Other"];
export const CHANNELS = [
  "Facebook",
  "Shopee",
  "Lazada",
  "Instagram",
  "Walk-in",
  "Referral",
  "Other",
];

export const PAYMENT_REQUIREMENTS = ["deposit", "deposit_25", "full"];

export const REQUIREMENT_LABEL = {
  deposit: "50% deposit to reserve",
  // Legacy label — see IN_TRANSIT_DEPOSIT_RATIO. Only ever shown for an order
  // that was actually placed at the old 25% rate.
  deposit_25: "25% deposit — in transit (legacy)",
  full: "Full payment",
};

export const REQUIREMENT_HELP = {
  deposit:
    "50% of the billed total is due now to reserve the stock. The balance is due before completion.",
  // Legacy help text — see IN_TRANSIT_DEPOSIT_RATIO. Only ever shown for an
  // order that was actually placed at the old 25% rate.
  deposit_25:
    "25% of the billed total is due now — this order was placed under the old in-transit rate. The balance is due once it's on hand.",
  full: "The full billed total is due now.",
};

export const requirementOf = (order) => {
  if (order?.payment_requirement === "full") return "full";
  if (order?.payment_requirement === "deposit_25") return "deposit_25";
  return "deposit";
};

export const requirementLabelOf = (order) => REQUIREMENT_LABEL[requirementOf(order)];

/**
 * A deposit order is never "Pending", it is "Reserved" once logged; a full
 * payment order is never "Reserved". This keeps the two vocabularies honest.
 */
export function normaliseOrderStatus(status, requirement) {
  // "full" is the only requirement with a different vocabulary — deposit and
  // deposit_25 (in-transit) both fold into "deposit" here: reserved-not-
  // pending applies the same way regardless of which deposit percentage.
  const req = requirement === "full" ? "full" : "deposit";
  if (req === "deposit" && status === "Pending") return "Reserved";
  if (req === "full" && status === "Reserved") return "Pending";
  return status;
}

export function statusesFor(requirement) {
  const open = requirement === "full" ? "Pending" : "Reserved";
  return ORDER_STATUSES.filter((s) => s === open || (s !== "Pending" && s !== "Reserved"));
}

export const TONE_FOR_STATUS = {
  Planned: "plum",
  Ordered: "cobalt",
  "In Transit": "clay",
  Received: "teal",
  Cancelled: "gray",
  Pending: "clay",
  Reserved: "plum",
  Paid: "cobalt",
  Completed: "teal",
  Refunded: "gray",
};

/* ------------------------------------------------------------------ stock */

export function stockState(product) {
  const qty = M(product?.quantity_on_hand);
  const reorder = M(product?.reorder_level);
  if (qty <= 0) return { key: "out", label: "Out of stock", tone: "clay" };
  if (qty <= reorder) return { key: "low", label: "Low stock", tone: "clay" };
  if (qty <= reorder * 2) return { key: "watch", label: "Getting low", tone: "plum" };
  return { key: "ok", label: "In stock", tone: "teal" };
}

/* --------------------------------------------------------------- variants */

/**
 * A STOCK UNIT is the thing that actually has a quantity: a base paddle when it
 * carries no colours, or one colour variant when it does. Every line, movement
 * and landed cost is keyed by this, so the two cases never need branching twice.
 *
 * The key is the raw product id when there is no variant, which is exactly what
 * the pre-variant maps used, so every existing lookup keeps working untouched.
 */
export const unitKey = (productId, variantId) =>
  variantId ? `${productId}:${variantId}` : productId;

/** A variant's own value, falling back to its parent paddle where it is unset. */
export function variantValue(variant, product, field) {
  const own = M(variant?.[field]);
  if (own > 0) return own;
  if (field === "selling_price_php") return M(product?.selling_price_php);
  if (field === "source_cost_vnd") return M(product?.source_cost_vnd);
  return own;
}

/**
 * The photograph for one stock unit: the colour's own shot when it has one,
 * otherwise the paddle's. Returns null when neither exists, which is a designed
 * placeholder on the invoice rather than a broken image.
 */
export function unitPhoto(product, variant) {
  const own = String(variant?.photo_url || "").trim();
  if (own) return own;
  const parent = String(product?.photo_url || "").trim();
  return parent || null;
}

/** Every sellable unit in the ledger, flattened, base paddles and colours alike. */
export function stockUnits(products, variantsByProduct) {
  const out = [];
  for (const product of products || []) {
    const variants = (variantsByProduct?.get(product.id) || []).filter((v) => v.active);
    if (!variants.length) {
      out.push({
        key: unitKey(product.id, null),
        product,
        variant: null,
        product_id: product.id,
        variant_id: null,
        name: product.name,
        color: null,
        sku: product.sku,
        quantity_on_hand: M(product.quantity_on_hand),
        reorder_level: M(product.reorder_level),
        source_cost_vnd: M(product.source_cost_vnd),
        selling_price_php: product.selling_price_php,
        photo_url: unitPhoto(product, null),
      });
      continue;
    }
    for (const variant of variants) {
      out.push({
        key: unitKey(product.id, variant.id),
        product,
        variant,
        product_id: product.id,
        variant_id: variant.id,
        name: product.name,
        color: variant.color,
        sku: variant.sku || product.sku,
        quantity_on_hand: M(variant.quantity),
        reorder_level: M(variant.reorder_level),
        source_cost_vnd: variantValue(variant, product, "source_cost_vnd"),
        selling_price_php: variantValue(variant, product, "selling_price_php") || null,
        photo_url: unitPhoto(product, variant),
      });
    }
  }
  return out;
}

/** "Selkirk Omni Clay · Midnight" — one label for a unit, used everywhere. */
export const unitLabel = (name, color) => (color ? `${name} · ${color}` : name);

/* ----------------------------------------------------------- consumables */

/**
 * THE THREE CONSUMABLES PTG BUYS WITH A BATCH.
 *
 * A cover and an edge tape are bought BY THE PIECE; overgrips are bought BY THE
 * PACK, and one pack is sixty pieces. Everything downstream — received pieces,
 * per-piece cost, freebie stock — derives from those two facts, so `pieces` is
 * the only number the rest of the app ever has to reason about.
 *
 * Each one stocks exactly one freebie, matched by name, and one paddle given
 * the standard kit consumes exactly one piece of each.
 */
export const OVERGRIPS_PER_PACK = 60;

export const CONSUMABLES = [
  {
    key: "cover",
    label: "Paddle Covers",
    singular: "Paddle Cover",
    buyUnit: "piece",
    buyUnitPlural: "pieces",
    piecesPerUnit: 1,
    perPaddle: 1,
    freebie: "Paddle Cover",
  },
  {
    key: "overgrip",
    label: "Overgrips",
    singular: "Overgrip",
    buyUnit: "pack",
    buyUnitPlural: "packs",
    piecesPerUnit: OVERGRIPS_PER_PACK,
    perPaddle: 1,
    freebie: "Overgrip",
  },
  {
    key: "edge_tape",
    label: "Edge Tapes",
    singular: "Edge Tape",
    buyUnit: "piece",
    buyUnitPlural: "pieces",
    piecesPerUnit: 1,
    perPaddle: 1,
    freebie: "Edge Tape",
  },
];

export const consumableMeta = (key) =>
  CONSUMABLES.find((c) => c.key === key) || {
    key,
    label: key || "Consumable",
    singular: key || "Consumable",
    buyUnit: "piece",
    buyUnitPlural: "pieces",
    piecesPerUnit: 1,
    perPaddle: 1,
    freebie: null,
  };

const normName = (s) => String(s || "").trim().toLowerCase();

/** The freebie row each consumable stocks, matched by name. */
export function consumableFreebie(freebies, key) {
  const meta = consumableMeta(key);
  if (!meta.freebie) return null;
  return (freebies || []).find((f) => normName(f.name) === normName(meta.freebie)) || null;
}

/**
 * One consumable purchase line: what was bought, what it cost, and the two
 * figures that fall out of it — pieces received, and cost per piece.
 */
export function consumableLine(row) {
  const meta = consumableMeta(row?.consumable_key);
  const purchaseQty = Math.max(0, M(row?.purchase_quantity));
  const unitCost = Math.max(0, M(row?.unit_cost_php));
  const pieces = Math.round(purchaseQty * meta.piecesPerUnit);
  const totalCost = purchaseQty * unitCost;
  return {
    ...row,
    key: meta.key,
    meta,
    purchaseQty,
    unitCost,
    pieces,
    totalCost,
    perPiece: pieces > 0 ? totalCost / pieces : 0,
    bought: purchaseQty > 0,
  };
}

/** Every consumable on one batch, plus what they cost the batch in total. */
export function consumableMath(rows) {
  const lines = (rows || []).map(consumableLine).filter((l) => l.purchaseQty > 0 || l.unitCost > 0);
  const totalCost = lines.reduce((s, l) => s + l.totalCost, 0);
  const pieces = lines.reduce((s, l) => s + l.pieces, 0);
  const byKey = new Map(lines.map((l) => [l.key, l]));
  return {
    lines,
    byKey,
    totalCost,
    pieces,
    count: lines.filter((l) => l.bought).length,
    any: lines.some((l) => l.bought),
  };
}

/**
 * THE STANDARD FREEBIE KIT: one cover, one edge tape and one overgrip piece per
 * paddle. `paddles` is how many paddles the kit is being worked out for, so the
 * same function answers "what does this order need" and "what can we cover".
 */
export function freebieKit(freebies, paddles = 0) {
  const wanted = Math.max(0, int(paddles));
  const items = CONSUMABLES.map((meta) => {
    const freebie = consumableFreebie(freebies, meta.key);
    const stock = freebie ? Math.max(0, int(freebie.quantity)) : 0;
    const required = wanted * meta.perPaddle;
    return {
      key: meta.key,
      meta,
      freebie,
      configured: !!freebie && !!freebie.active,
      present: !!freebie,
      unitCost: freebie ? Math.max(0, M(freebie.unit_cost)) : 0,
      stock,
      required,
      shortfall: Math.max(0, required - stock),
      covers: meta.perPaddle > 0 ? Math.floor(stock / meta.perPaddle) : 0,
    };
  });

  const usable = items.filter((i) => i.configured);
  return {
    items,
    usable,
    configured: usable.length > 0,
    complete: usable.length === CONSUMABLES.length,
    costPerPaddle: usable.reduce((s, i) => s + i.unitCost * i.meta.perPaddle, 0),
    // How many whole kits the shelf can actually cover right now.
    kitsAvailable: usable.length ? Math.min(...usable.map((i) => i.covers)) : 0,
    short: usable.filter((i) => i.shortfall > 0),
    enough: usable.every((i) => i.shortfall <= 0),
  };
}

/* ------------------------------------------------------ batch profitability */

/**
 * ALLOCATION AT CENT PRECISION, WITH A DETERMINISTIC REMAINDER.
 *
 * A total split by weight almost never divides into whole centavos, so the naive
 * `total × share` per line silently loses or invents money. This works entirely
 * in integer centavos: every line takes its floor, and the leftover centavos are
 * handed out one at a time to the lines with the largest dropped fraction,
 * breaking ties by index. The result is stable for a given input — the same
 * batch always allocates identically — and `sum(allocations) === total` exactly,
 * which is what `allocationReconciles` downstream asserts.
 */
export function allocateRounded(total, lines, weightFn) {
  const totalCents = Math.round(M(total) * 100);
  const basis = (lines || []).map((line, i) => Math.max(0, M(weightFn(line, i))));
  const sum = basis.reduce((s, n) => s + n, 0);
  if (!sum || !totalCents) return basis.map(() => 0);
  const raw = basis.map((n) => (totalCents * n) / sum);
  const cents = raw.map(Math.floor);
  let remainder = totalCents - cents.reduce((s, n) => s + n, 0);
  raw
    .map((n, i) => ({ i, frac: n - Math.floor(n) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
    // A line with no basis is never handed a stray centavo: it carries no share.
    .filter(({ i }) => basis[i] > 0)
    .forEach(({ i }) => {
      if (remainder > 0) {
        cents[i] += 1;
        remainder -= 1;
      }
    });
  return cents.map((n) => n / 100);
}

/** Two peso figures that agree to the centavo. */
export const sameMoney = (a, b) => Math.abs(M(a) - M(b)) < 0.005;

/**
 * What a whole batch is worth. Product revenue is every unit at its standard
 * selling price; the cost is the batch's full landed cost, consumables included.
 * Customer shipping never appears here — it is order income, not batch revenue.
 */

export function batchProfitability(math, priceByKey) {
  const lines = (math?.lines || []).map((l) => {
    const price = M(priceByKey?.get?.(l.unit_key) ?? priceByKey?.get?.(l.product_id));
    const lineRevenue = price * l.qty;
    // Per-unit economics on the batch line: what the unit will land at, what it
    // is expected to sell for, and the gap between them. Consumables are NOT in
    // `landedPerUnit` on purpose — a giveaway is costed on the order it goes out
    // on, never twice.
    const expectedProfitPerUnit = price > 0 ? price - l.landedPerUnit : null;
    const expectedLineProfit = expectedProfitPerUnit === null ? null : expectedProfitPerUnit * l.qty;
    return {
      ...l,
      price,
      lineRevenue,
      priced: price > 0,
      expectedProfitPerUnit,
      expectedLineProfit,
      expectedMargin: price > 0 ? ((price - l.landedPerUnit) / price) * 100 : null,
    };
  });
  const productRevenue = lines.reduce((s, l) => s + l.lineRevenue, 0);
  const landedCost = M(math?.landedTotalPhp, M(math?.totalPhp));
  const profit = productRevenue - landedCost;
  return {
    lines,
    productRevenue,
    landedCost,
    profit,
    margin: productRevenue > 0 ? (profit / productRevenue) * 100 : 0,
    // The sum of the per-line expectations. It differs from `profit` by exactly
    // the consumable spend, which is a batch cost and not a paddle cost.
    expectedLineProfit: lines.reduce((s, l) => s + M(l.expectedLineProfit), 0),
    unpriced: lines.filter((l) => !l.priced).length,
    priceable: lines.some((l) => l.priced),
  };
}

/* ------------------------------------------------------------ batch maths */

/**
 * BATCH SHIPPING IS TWO LEGS, AND IT IS ALLOCATED, NEVER CHARGED PER PADDLE.
 *
 * Leg 1 is the Vietnam → Manila international freight (payable = the actual
 * invoice where one landed, otherwise the discounted quote); leg 2 is the
 * Manila → CDO domestic leg. The two sum to `shipping`, and only then is it
 * divided across every paddle unit in the batch:
 *
 *   by WEIGHT SHARE (unit_weight_kg × qty) when the weights are USABLE, meaning
 *   every line actually being shipped carries one,
 *   by QUANTITY SHARE as a transparent fallback whenever they are not.
 *
 * Weight is "usable" only when it covers the whole batch. A part-weighed batch
 * allocated by weight would hand ₱0 of freight to every line whose weight was
 * left blank, quietly under-costing those paddles and over-costing the weighed
 * ones, so a single missing weight drops the whole batch back to quantity and
 * `linesMissingWeight` says how many are responsible.
 *
 * `allocationBasis` says which, every time, in the UI. EACH LEG is divided
 * through `allocateRounded` on that basis and the combined figure is their SUM,
 * so a line's two legs always add up to the combined allocation printed beside
 * them, and both legs and the combined total add back up to the batch to the
 * centavo — `allocationReconciles` is that assertion, exposed so the batch tray
 * can show the operator it holds.
 */
export function batchMath(batch, items, rate, consumables) {
  const domesticShipping = Math.max(0, M(batch?.local_shipping_php ?? batch?.domestic_shipping_php ?? batch?.shipping_php));
  const quoteBasis = batch?.intl_quote_basis === "flat_total" ? "flat_total" : "per_kg";
  const intlRate = Math.max(0, M(batch?.intl_rate_vnd_per_kg));
  const combinedWeightKg = Math.max(0, M(batch?.intl_combined_weight_kg));
  const intlGrossInputVnd = Math.max(0, M(batch?.intl_gross_vnd));
  const intlDiscountMode = batch?.intl_discount_mode === "percent" ? "percent" : "fixed";
  const intlDiscountValue = Math.max(0, M(batch?.intl_discount_value));
  const kit = consumableMath(consumables);

  const lines = (items || []).map((l) => {
    const unitWeightKg = Math.max(0, M(l.unit_weight_kg));
    const enteredChargeableWeightKg = Math.max(0, M(l.chargeable_weight_kg));
    return {
      ...l,
      qty: Math.max(0, M(l.quantity)),
      unitVnd: Math.max(0, M(l.unit_cost_vnd)),
      unitWeightKg,
      chargeableWeightKg: enteredChargeableWeightKg || unitWeightKg,
      unit_key: unitKey(l.product_id, l.variant_id),
    };
  });

  const unitCount = lines.reduce((s, l) => s + l.qty, 0);
  const totalWeightKg = lines.reduce((s, l) => s + l.unitWeightKg * l.qty, 0);
  const totalChargeableWeightKg = lines.reduce((s, l) => s + l.chargeableWeightKg * l.qty, 0);
  // Only the lines that actually ship can carry freight, so only they are asked
  // for a weight. A shipped line without one makes the weights unusable.
  const shippedLines = lines.filter((l) => l.qty > 0);
  const linesMissingWeight = shippedLines.filter((l) => l.chargeableWeightKg <= 0).length;
  const weightAllocatable = totalChargeableWeightKg > 0 && linesMissingWeight === 0;
  const allocationMethod = batch?.shipping_allocation_method || (weightAllocatable ? "by_weight" : "equal_per_item");
  const allocationBasis = allocationMethod === "by_weight" && weightAllocatable ? "weight" : "units";
  // The per-kg quote weighs the shipment the operator entered, and falls back to
  // the batch's own line weights when they left it blank, so the figure the
  // supplier quoted is never invented from thin air.
  const quoteWeightKg = combinedWeightKg > 0 ? combinedWeightKg : totalWeightKg;
  const quoteWeightSource = combinedWeightKg > 0 ? "entered" : totalWeightKg > 0 ? "lines" : "none";
  const grossByWeightVnd = quoteWeightKg * intlRate;
  const grossFreightVnd = quoteBasis === "flat_total" ? intlGrossInputVnd : grossByWeightVnd;
  // Whether the operator has actually given this batch a quote yet. A blank rate
  // is a real, sayable state — it is NOT ₱0 of freight, it is "not quoted".
  const quoteEntered = quoteBasis === "flat_total" ? intlGrossInputVnd > 0 : intlRate > 0;
  const discountBaseVnd = grossFreightVnd;
  const discountVnd = Math.min(
    discountBaseVnd,
    intlDiscountMode === "percent" ? discountBaseVnd * Math.min(100, intlDiscountValue) / 100 : intlDiscountValue,
  );
  const discountedFreightVnd = Math.max(0, discountBaseVnd - discountVnd);
  const quotedPhp = vndToPhp(discountedFreightVnd, rate);
  const actualPhp = batch?.intl_actual_paid_php !== null && batch?.intl_actual_paid_php !== undefined && String(batch.intl_actual_paid_php).trim() !== ""
    ? Math.max(0, M(batch.intl_actual_paid_php))
    : null;
  const payablePhp = actualPhp ?? quotedPhp;
  const intlMethod = batch?.intl_shipping_method || (quoteBasis === "flat_total" ? "total_batch" : "per_kg");
  const perItemIntl = Math.max(0, M(batch?.intl_rate_php_per_item)) * unitCount;
  const manualIntl = lines.reduce((s, l) => s + Math.max(0, M(l.intl_allocation_php)), 0);
  const methodIntl = intlMethod === "per_item" ? perItemIntl : intlMethod === "manual" ? manualIntl : payablePhp;
  const shipping = domesticShipping + methodIntl;
  const other = Math.max(0, M(batch?.other_costs_php ?? batch?.other_cost_php));

  const allocationWeights = lines.map((l) => (weightAllocatable ? l.chargeableWeightKg * l.qty : l.qty));
  const allocationBasisTotal = allocationWeights.reduce((s, n) => s + n, 0);
  const intlAllocations = intlMethod === "manual"
    ? lines.map((l) => Math.max(0, M(l.intl_allocation_php)))
    : allocateRounded(methodIntl, lines, (_l, i) => allocationWeights[i]);
  const domesticAllocations = allocateRounded(domesticShipping, lines, (_l, i) => allocationWeights[i]);
  // The combined figure is the SUM OF THE TWO LEGS, never a third independent
  // division of their total: rounding each of three splits separately lets the
  // legs printed under a line disagree by a centavo with the combined figure
  // printed on it, which is precisely the audit the operator is doing.
  const shippingAllocations = lines.map(
    (_l, i) => (intlAllocations[i] || 0) + (domesticAllocations[i] || 0),
  );
  const otherAllocations = lines.some((l) => M(l.other_allocation_php) > 0)
    ? lines.map((l) => Math.max(0, M(l.other_allocation_php)))
    : allocateRounded(other, lines, (l) => l.qty);
  const priced = lines.map((l, index) => {
    const sourcePhpPerUnit = vndToPhp(l.unitVnd, rate);
    const allocationShare =
      allocationBasisTotal > 0 ? allocationWeights[index] / allocationBasisTotal : 0;
    const lineShipping = shippingAllocations[index] || 0;
    const lineOther = otherAllocations[index] || 0;
    const landedPerUnit = sourcePhpPerUnit + (l.qty > 0 ? lineShipping / l.qty : 0) + (l.qty > 0 ? lineOther / l.qty : 0);
    return {
      ...l,
      shipPerUnit: l.qty > 0 ? lineShipping / l.qty : 0,
      intlShipPerUnit: l.qty > 0 ? (intlAllocations[index] || 0) / l.qty : 0,
      domesticShipPerUnit: l.qty > 0 ? (domesticAllocations[index] || 0) / l.qty : 0,
      otherPerUnit: l.qty > 0 ? lineOther / l.qty : 0,
      allocShipping: lineShipping,
      allocIntlShipping: intlAllocations[index] || 0,
      allocDomesticShipping: domesticAllocations[index] || 0,
      allocOther: lineOther,
      weight: allocationShare,
      sourcePhpPerUnit,
      landedPerUnit,
      lineSourcePhp: sourcePhpPerUnit * l.qty,
      lineTotalPhp: landedPerUnit * l.qty,
    };
  });

  const goodsPhp = priced.reduce((s, l) => s + l.lineSourcePhp, 0);
  const goodsVnd = priced.reduce((s, l) => s + l.unitVnd * l.qty, 0);
  const allocatedShippingTotal = priced.reduce((s, l) => s + l.allocShipping, 0);
  const allocatedIntlTotal = priced.reduce((s, l) => s + l.allocIntlShipping, 0);
  const allocatedDomesticTotal = priced.reduce((s, l) => s + l.allocDomesticShipping, 0);
  const allocatedOtherTotal = priced.reduce((s, l) => s + l.allocOther, 0);

  return {
    lines: priced,
    goodsVnd,
    goodsPhp,
    shipping,
    domesticShipping,
    intlRate,
    quoteBasis,
    combinedWeightKg,
    // The weight the quote was actually priced on, and where it came from, so
    // the tray can say "your 6.40 kg" or "the lines' 6.40 kg" truthfully.
    quoteWeightKg,
    quoteWeightSource,
    quoteEntered,
    intlDiscountMode,
    intlDiscountValue,
    grossIntlVnd: grossFreightVnd,
    grossIntlVndByWeight: grossByWeightVnd,
    intlDiscountVnd: discountVnd,
    discountedIntlVnd: discountedFreightVnd,
    intlQuotedPhp: quotedPhp,
    intlActualPhp: actualPhp,
    intlPayablePhp: payablePhp,
    intlVariancePhp: actualPhp === null ? null : actualPhp - quotedPhp,
    allocationBasis,
    totalWeightKg,
    totalChargeableWeightKg,
    actualWeightKg: Math.max(0, M(batch?.actual_weight_kg ?? totalWeightKg)),
    chargeableWeightKg: Math.max(0, M(batch?.chargeable_weight_kg ?? totalChargeableWeightKg)),
    intlShippingMethod: intlMethod,
    allocationMethod,
    // How many shipped lines are missing a weight — the reason a batch that has
    // some weights still allocates by quantity.
    linesMissingWeight,
    other,
    shipPerUnit: unitCount > 0 ? shipping / unitCount : 0,
    otherPerUnit: unitCount > 0 ? other / unitCount : 0,
    allocPerUnit: unitCount > 0 ? (shipping + other) / unitCount : 0,
    // Paddle landed cost, the figure every order line is costed against. It is
    // deliberately free of consumables: a cover is costed on the ORDER that
    // gives it away, so folding it in here would charge it twice.
    totalPhp: goodsPhp + shipping + other,
    // The batch's own landed cost, which DOES carry the consumables it bought.
    consumables: kit,
    consumableCost: kit.totalCost,
    consumablePieces: kit.pieces,
    landedTotalPhp: goodsPhp + shipping + other + kit.totalCost,
    unitCount,
    allocatable: unitCount > 0,
    allocatedShippingTotal,
    allocatedIntlTotal,
    allocatedDomesticTotal,
    allocatedOtherTotal,
    // Proof the split lost nothing, leg by leg as well as combined.
    // `allocateRounded` guarantees it, and the batch tray states it, so the
    // operator never has to take it on trust.
    allocationRemainder: shipping - allocatedShippingTotal,
    allocationReconciles:
      sameMoney(allocatedShippingTotal, unitCount > 0 ? shipping : 0) &&
      sameMoney(allocatedIntlTotal, unitCount > 0 ? methodIntl : 0) &&
      sameMoney(allocatedDomesticTotal, unitCount > 0 ? domesticShipping : 0),
  };
}

/**
 * The landed cost each STOCK UNIT carries right now. The most recent
 * non-cancelled batch that contained the unit wins; a unit never batched falls
 * back to its own source cost with no allocation.
 *
 * Keys are `unitKey(product_id, variant_id)`, which for a paddle without
 * colours is just the product id, so every pre-variant lookup still resolves.
 */
export function landedCostMap(products, batches, batchItems, rate, variantsByProduct) {
  const itemsByBatch = new Map();
  for (const item of batchItems || []) {
    if (!itemsByBatch.has(item.batch_id)) itemsByBatch.set(item.batch_id, []);
    itemsByBatch.get(item.batch_id).push(item);
  }

  const fromBatch = new Map();
  const ordered = [...(batches || [])]
    .filter((b) => b.status !== "Cancelled")
    .sort((a, b) => M(a.id) - M(b.id));

  for (const batch of ordered) {
    const items = itemsByBatch.get(batch.id) || [];
    if (!items.length) continue;
    const math = batchMath(batch, items, rate);
    for (const line of math.lines) {
      if (line.qty <= 0) continue;
      const hit = {
        landedPerUnit: line.landedPerUnit,
        supplierPhp: line.sourcePhpPerUnit,
        sourceVnd: line.unitVnd,
        // The one figure landed cost is built from: both freight legs plus this
        // line's share of any other batch cost.
        shipPerUnit: line.shipPerUnit + line.otherPerUnit,
        intlShipPerUnit: line.intlShipPerUnit,
        domesticShipPerUnit: line.domesticShipPerUnit,
        otherPerUnit: line.otherPerUnit,
        allocationBasis: math.allocationBasis,
        batchShipping: math.shipping + math.other,
        intlShipping: math.intlPayablePhp,
        domesticShipping: math.domesticShipping,
        batchQty: math.unitCount,
        batchId: batch.id,
        batchName: batch.batch_name,
      };
      fromBatch.set(line.unit_key, hit);
      // A colour-specific batch line also stands in for the base paddle, so an
      // order line that never picked a colour still costs what the batch paid.
      if (line.variant_id && !fromBatch.has(line.product_id))
        fromBatch.set(line.product_id, hit);
    }
  }

  const fallback = (sourceVnd) => ({
    landedPerUnit: vndToPhp(sourceVnd, rate),
    supplierPhp: vndToPhp(sourceVnd, rate),
    sourceVnd: M(sourceVnd),
    shipPerUnit: 0,
    intlShipPerUnit: 0,
    domesticShipPerUnit: 0,
    otherPerUnit: 0,
    allocationBasis: null,
    batchShipping: 0,
    batchQty: 0,
    batchId: null,
    batchName: null,
    source: "product",
  });

  const map = new Map();
  for (const product of products || []) {
    const hit = fromBatch.get(product.id);
    map.set(product.id, hit ? { ...hit, source: "batch" } : fallback(product.source_cost_vnd));

    for (const variant of variantsByProduct?.get(product.id) || []) {
      const key = unitKey(product.id, variant.id);
      const vHit = fromBatch.get(key);
      map.set(
        key,
        vHit
          ? { ...vHit, source: "batch" }
          : fallback(variantValue(variant, product, "source_cost_vnd")),
      );
    }
  }
  return map;
}

/**
 * THE AUDIT NOTE UNDER "Combined Shipping Allocation", WRITTEN ONCE.
 *
 * The allocation row is the one figure an operator cannot check in their head,
 * so wherever it appears it shows its working: the two legs it is made of, the
 * basis it was divided on, and where the figures came from. Written here rather
 * than at each call site so a paddle, a colour and a batch line can never
 * explain the same number three different ways.
 *
 * Returns null when there is nothing truthful to say — the caller then states
 * plainly that no batch has costed this unit yet, rather than implying a split
 * that never happened.
 */
export function allocationNote(source, { basis, context } = {}) {
  if (!source) return null;
  const intl = M(source.intlShipPerUnit);
  const domestic = M(source.domesticShipPerUnit);
  const other = M(source.otherPerUnit);
  const legs = [];
  if (intl > 0) legs.push(`VN→MNL ${php(intl)}`);
  if (domestic > 0) legs.push(`MNL→CDO ${php(domestic)}`);
  if (other > 0) legs.push(`other ${php(other)}`);
  // Both legs at zero is a real, sayable state: the batch carried no freight.
  if (!legs.length) legs.push("no freight on the batch");

  const how = (basis ?? source.allocationBasis) === "weight" ? "by weight" : "by units";
  return [legs.join(" + "), how, context].filter(Boolean).join(" · ");
}

/**
 * One unit's economics, used by the identical six-row breakdown that appears in
 * the product tray, the batch line, and Settings.
 */
/**
 * THE SUGGESTED MINIMUM SAFE SELLING PRICE. Advisory, never applied: nothing in
 * the app writes this back over a real selling price.
 *
 *   floor = (landed cost + any freebie cost that is actually included)
 *           ÷ (1 − target margin ÷ 100)
 *
 * The freebie term is opt-in on purpose. A paddle sold bare costs its landed
 * cost; a paddle sold with the standard kit costs that plus the kit, and the two
 * floors are genuinely different, so the caller says which question it is asking.
 */
export function minimumSafePrice(landedCost, desiredMarginPercent = DEFAULT_SETTINGS.desired_profit_margin_percent, freebieCost = 0) {
  const cost = Math.max(0, M(landedCost)) + Math.max(0, M(freebieCost));
  const margin = Math.min(99.99, Math.max(0, M(desiredMarginPercent)));
  return cost / (1 - margin / 100);
}

export function unitMath({ sourceVnd, rate, shipAllocPerUnit = 0, sellingPrice, desiredMarginPercent = DEFAULT_SETTINGS.desired_profit_margin_percent, freebieCost = 0 } = {}) {
  const cost = Math.max(0, M(sourceVnd));
  const r = M(rate);
  const alloc = Math.max(0, M(shipAllocPerUnit));

  const rateOk = Number.isFinite(r) && r > 0;
  const hasVnd = cost > 0;
  const hasPrice =
    sellingPrice != null && String(sellingPrice).trim() !== "" && M(sellingPrice) > 0;

  const price = hasPrice ? M(sellingPrice) : null;
  const supplierPhp = rateOk && hasVnd ? cost / r : null;
  const landed = supplierPhp === null ? null : supplierPhp + alloc;
  const gift = Math.max(0, M(freebieCost));
  // Profit is on the landed cost alone. The freebie only ever moves the advisory
  // floor, so switching the kit on never rewrites the profit already shown.
  const profit = landed === null || price === null ? null : price - landed;
  const safePrice = landed === null ? null : minimumSafePrice(landed, desiredMarginPercent, gift);

  return {
    vndCost: cost,
    rate: r,
    rateOk,
    hasVnd,
    hasPrice,
    supplierPhp,
    alloc,
    landed,
    price,
    profit,
    freebieCost: gift,
    desiredMarginPercent: M(desiredMarginPercent, DEFAULT_SETTINGS.desired_profit_margin_percent),
    minimumSafePrice: safePrice,
    // Advisory only. True when a real price sits under the suggested floor; the
    // price itself is never touched.
    belowSafePrice: safePrice !== null && price !== null && price < safePrice - 0.005,
    shortOfSafePrice: safePrice !== null && price !== null ? Math.max(0, safePrice - price) : null,
    margin: profit !== null && price ? (profit / price) * 100 : null,
    blockedBy: !rateOk ? "rate" : !hasVnd ? "cost" : !hasPrice ? "price" : null,
  };
}

/* ------------------------------------------------------------ order maths */

/**
 * Everything one order is worth.
 *
 * Product revenue is items − discount. Customer shipping is income that counts
 * toward the balance they owe, and NEVER toward product revenue or profit.
 * Freebies handed out are a real cost, so they come off profit alongside the
 * landed cost of the paddles.
 */
export function orderMath(order, items, landedMap, paid = 0, freebies = []) {
  const lines = (items || []).map((line) => {
    const qty = Math.max(0, M(line.quantity));
    const price = M(line.sale_price_php);
    const key = unitKey(line.product_id, line.variant_id);
    // A colour variant costs what its own batch line cost; without one it falls
    // straight back to the paddle, so a line that predates variants is unchanged.
    const estLanded = M(
      (landedMap?.get(key) || landedMap?.get(line.product_id))?.landedPerUnit,
    );
    const hasActual =
      line.actual_landed_cost_php !== null &&
      line.actual_landed_cost_php !== undefined &&
      line.actual_landed_cost_php !== "" &&
      M(line.actual_landed_cost_php) > 0;
    const actualLanded = hasActual ? M(line.actual_landed_cost_php) : estLanded;
    return {
      ...line,
      unit_key: key,
      qty,
      price,
      estLanded,
      actualLanded,
      hasActual,
      lineRevenue: price * qty,
      lineEstCost: estLanded * qty,
      lineActualCost: actualLanded * qty,
    };
  });

  const gifts = (freebies || []).map((f) => {
    const qty = Math.max(0, M(f.quantity));
    const unitCost = Math.max(0, M(f.unit_cost));
    return { ...f, qty, unitCost, lineCost: unitCost * qty };
  });
  const freebieCost = gifts.reduce((s, f) => s + f.lineCost, 0);
  const freebieCount = gifts.reduce((s, f) => s + f.qty, 0);

  const itemsRevenue = lines.reduce((s, l) => s + l.lineRevenue, 0);
  const shippingIncome = Math.max(0, M(order?.shipping_income_php));
  const discount = Math.max(0, M(order?.discount_php));
  const productRevenue = Math.max(0, itemsRevenue - discount);
  const billedTotal = productRevenue + shippingIncome;

  const requirement = requirementOf(order);
  const isDeposit = requirement === "deposit" || requirement === "deposit_25";
  const depositDue = billedTotal * (DEPOSIT_RATIO_BY_REQUIREMENT[requirement] ?? DEPOSIT_RATIO);
  const dueNow = isDeposit ? depositDue : billedTotal;

  const amountPaid = Math.max(0, M(paid));
  const balanceDue = Math.max(0, billedTotal - amountPaid);
  const dueNowOutstanding = Math.max(0, dueNow - amountPaid);

  const estCost = lines.reduce((s, l) => s + l.lineEstCost, 0) + freebieCost;
  const actualCost = lines.reduce((s, l) => s + l.lineActualCost, 0) + freebieCost;
  const estProfit = productRevenue - estCost;
  const actualProfit = productRevenue - actualCost;

  return {
    lines,
    freebies: gifts,
    freebieCost,
    freebieCount,
    unitCount: lines.reduce((s, l) => s + l.qty, 0),
    itemsRevenue,
    shippingIncome,
    discount,
    productRevenue,
    billedTotal,
    paymentRequirement: requirement,
    paymentRequirementLabel: REQUIREMENT_LABEL[requirement],
    isDeposit,
    depositDue,
    dueNow,
    amountPaid,
    balanceDue,
    dueNowOutstanding,
    depositMet: isDeposit ? dueNowOutstanding <= 0.005 && dueNow > 0.005 : false,
    settledUp: balanceDue <= 0.005 && billedTotal > 0.005,
    revenue: billedTotal,
    estCost,
    actualCost,
    estProfit,
    actualProfit,
    estMargin: productRevenue > 0 ? (estProfit / productRevenue) * 100 : 0,
    actualMargin: productRevenue > 0 ? (actualProfit / productRevenue) * 100 : 0,
    hasAnyActual: lines.some((l) => l.hasActual),
  };
}

export const isLiveOrder = (order) => order?.status !== "Cancelled";

export const isOpenOrder = (order) =>
  order?.status === "Pending" || order?.status === "Reserved" || order?.status === "Paid";

/** Only money that actually landed counts toward what an order has been paid. */
export function paidFor(payments, orderId) {
  return (payments || [])
    .filter((p) => p.order_id === orderId && p.status === "Received")
    .reduce((s, p) => s + M(p.amount_php), 0);
}

/* ---------------------------------------------------------------- rollups */

export function deriveAll({
  products,
  variants = [],
  batches,
  batchItems,
  batchConsumables = [],
  freebies = [],
  orders,
  orderItems,
  orderFreebies,
  payments,
  settings,
}) {
  const rate = M(settings?.php_to_vnd_rate, DEFAULT_SETTINGS.php_to_vnd_rate);
  const variantsByProduct = new Map();
  for (const v of variants || []) {
    if (!variantsByProduct.has(v.inventory_id)) variantsByProduct.set(v.inventory_id, []);
    variantsByProduct.get(v.inventory_id).push(v);
  }
  const variantsById = new Map((variants || []).map((v) => [v.id, v]));

  const landedMap = landedCostMap(products, batches, batchItems, rate, variantsByProduct);
  const units = stockUnits(products, variantsByProduct);
  const unitByKey = new Map(units.map((u) => [u.key, u]));

  const itemsByOrder = new Map();
  for (const item of orderItems || []) {
    if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, []);
    itemsByOrder.get(item.order_id).push(item);
  }

  const freebiesByOrder = new Map();
  for (const f of orderFreebies || []) {
    if (!freebiesByOrder.has(f.order_id)) freebiesByOrder.set(f.order_id, []);
    freebiesByOrder.get(f.order_id).push(f);
  }

  // Consumables bought per batch, and what the whole ledger has spent on them.
  const consumablesByBatch = new Map();
  for (const c of batchConsumables || []) {
    if (!consumablesByBatch.has(c.batch_id)) consumablesByBatch.set(c.batch_id, []);
    consumablesByBatch.get(c.batch_id).push(c);
  }
  let consumableSpend = 0;
  let consumablePieces = 0;
  for (const [batchId, rows] of consumablesByBatch) {
    const b = (batches || []).find((x) => x.id === batchId);
    if (b?.status === "Cancelled") continue;
    const m = consumableMath(rows);
    consumableSpend += m.totalCost;
    if (b?.status === "Received") consumablePieces += m.pieces;
  }

  // The standard freebie kit as it stands right now: what one paddle costs in
  // giveaways, and how many paddles the shelf can actually cover.
  const kit = freebieKit(freebies, 0);

  // Stock and its value are counted on STOCK UNITS, so a paddle with colours is
  // counted once per colour and never double-counted against its base row.
  const inventoryValue = units.reduce(
    (s, u) => s + Math.max(0, u.quantity_on_hand) * M(landedMap.get(u.key)?.landedPerUnit),
    0,
  );
  const unitsOnHand = units.reduce((s, u) => s + Math.max(0, u.quantity_on_hand), 0);

  let sales = 0;
  let shippingCollected = 0;
  let estProfit = 0;
  let actualProfit = 0;
  let productCost = 0;
  let freebieCost = 0;
  let freebieCount = 0;
  let discounts = 0;
  let openOrders = 0;
  let unpaid = 0;
  let depositsOutstanding = 0;
  let awaitingDeposit = 0;

  /** Profitability per stock unit, so a colour that loses money is visible. */
  const byUnit = new Map();
  const bump = (key, patch) => {
    const row = byUnit.get(key) || {
      key,
      units: 0,
      revenue: 0,
      cost: 0,
      freebieCost: 0,
      orders: 0,
      profit: 0,
    };
    row.units += patch.units;
    row.revenue += patch.revenue;
    row.cost += patch.cost;
    row.freebieCost += patch.freebieCost;
    row.orders += 1;
    row.profit = row.revenue - row.cost - row.freebieCost;
    byUnit.set(key, row);
  };

  for (const order of orders || []) {
    if (!isLiveOrder(order)) continue;
    const math = orderMath(
      order,
      itemsByOrder.get(order.id) || [],
      landedMap,
      paidFor(payments, order.id),
      freebiesByOrder.get(order.id) || [],
    );
    sales += math.productRevenue;
    shippingCollected += math.shippingIncome;
    estProfit += math.estProfit;
    actualProfit += math.actualProfit;
    productCost += math.actualCost - math.freebieCost;
    freebieCost += math.freebieCost;
    freebieCount += math.freebieCount;
    discounts += math.discount;
    if (isOpenOrder(order)) openOrders += 1;
    if (math.balanceDue > 0.005) unpaid += math.balanceDue;
    if (math.isDeposit && order.status !== "Completed" && math.dueNowOutstanding > 0.005) {
      depositsOutstanding += math.dueNowOutstanding;
      awaitingDeposit += 1;
    }

    // A freebie belongs to the whole order, so its cost is split across the
    // units on it by quantity: it lands on the colour it was given away with.
    const orderUnits = math.unitCount || 1;
    for (const line of math.lines) {
      if (!line.product_id) continue;
      bump(line.unit_key, {
        units: line.qty,
        revenue: line.lineRevenue,
        cost: line.lineActualCost,
        freebieCost: math.freebieCost * (line.qty / orderUnits),
      });
    }
  }

  const unitProfit = [...byUnit.values()]
    .map((row) => {
      const unit = unitByKey.get(row.key);
      const variant = row.key !== unit?.key ? null : unit?.variant;
      return {
        ...row,
        product_id: unit?.product_id ?? row.key,
        variant_id: unit?.variant_id ?? null,
        name: unit?.name || "Removed paddle",
        color: unit?.color || variant?.color || null,
        sku: unit?.sku || null,
        onHand: unit ? unit.quantity_on_hand : 0,
        margin: row.revenue > 0 ? ((row.revenue - row.cost - row.freebieCost) / row.revenue) * 100 : 0,
      };
    })
    .sort((a, b) => b.profit - a.profit);

  const lowStock = units.filter((u) => {
    const key = stockState(u).key;
    return key === "low" || key === "out";
  });

  const received = (payments || [])
    .filter((p) => p.status === "Received")
    .reduce((s, p) => s + M(p.amount_php), 0);
  const pendingPay = (payments || [])
    .filter((p) => p.status === "Pending")
    .reduce((s, p) => s + M(p.amount_php), 0);

  return {
      variants: variants || [],
    rate,
    landedMap,
    consumablesByBatch,
    consumableSpend,
    consumablePieces,
    kit,
    variantsByProduct,
    variantsById,
    units,
    unitByKey,
    unitProfit,
    itemsByOrder,
    freebiesByOrder,
    inventoryValue,
    unitsOnHand,
    sales,
    shippingCollected,
    productCost,
    discounts,
    estProfit,
    actualProfit,
    profitDelta: actualProfit - estProfit,
    freebieCost,
    freebieCount,
    openOrders,
    unpaid,
    depositsOutstanding,
    awaitingDeposit,
    lowStock,
    lowStockCount: lowStock.length,
    received,
    pendingPay,
    totalPayments: received + pendingPay,
    margin: sales > 0 ? (actualProfit / sales) * 100 : 0,
  };
}

/* -------------------------------------------------------------- validation */

/** Errors live next to their field, never in a summary at the top. */
export function validate(rules, values) {
  const errors = {};
  for (const [key, rule] of Object.entries(rules)) {
    const value = values[key];
    if (rule.required && (value == null || String(value).trim() === "")) {
      errors[key] = rule.label ? `${rule.label} is required` : "Required";
      continue;
    }
    if (rule.nonNegative && String(value ?? "").trim() !== "") {
      const n = parseFloat(value);
      if (!Number.isFinite(n)) errors[key] = "Enter a number";
      else if (n < 0) errors[key] = "Cannot be negative";
    }
    if (rule.positive && String(value ?? "").trim() !== "") {
      const n = parseFloat(value);
      if (!Number.isFinite(n)) errors[key] = "Enter a number";
      else if (n <= 0) errors[key] = "Must be more than 0";
    }
  }
  return errors;
}

import {
  M,
  int,
  orderMath,
  vndToPhp,
  DEFAULT_SETTINGS,
  normaliseOrderStatus,
  landedCostMap,
  unitKey,
  consumableLine,
  consumableMeta,
  isStockCommitted,
} from "./calc";
import { db, dbBatch, initDb } from "./schema";
import { approvalStateOf, safePhotoUrl } from "./storefront";

/**
 * Every write in the app lives here. Reads normalise the legacy column names
 * into the shape the console speaks:
 *
 *   inventory.quantity   → product.quantity_on_hand
 *   inventory.sell_price → product.selling_price_php
 *
 * Writes go the other way and keep BOTH shapes correct, because the folk chat
 * agent reads the original columns.
 */

const round2 = (n) => Math.round((M(n) + Number.EPSILON) * 100) / 100;

/**
 * A product photograph is a plain URL the customer invoice renders. Only http,
 * https and data URLs are stored, so a typo can never become a javascript: link
 * in an <img src>. Anything else is kept out and the invoice falls back to its
 * placeholder, which is a designed state rather than a broken image.
 *
 * ONE IMPLEMENTATION, in `storefront.js`, because the public shop needs the
 * same guarantee and must not import this file (it would pull in the whole
 * write layer, and `schema.js` with it).
 */

/* ------------------------------------------------------------- archiving */

export const ARCHIVE_TAG = "[archived]";
export const isArchived = (p) => String(p?.notes || "").startsWith(ARCHIVE_TAG);
export const cleanNotes = (p) => String(p?.notes || "").replace(ARCHIVE_TAG, "").trim();

/* ------------------------------------------------------------------ read */

function toProduct(row) {
  return {
    ...row,
    quantity_on_hand: int(row.quantity),
    selling_price_php: M(row.sell_price) > 0 ? M(row.sell_price) : null,
    source_cost_vnd: M(row.source_cost_vnd),
    reorder_level: int(row.reorder_level, 2),
    photo_url: safePhotoUrl(row.photo_url),
  };
}

function toOrder(row) {
  return {
    ...row,
    customer_name: row.customer_name ?? row.customer ?? null,
    customer_email: row.customer_email ?? null,
    customer_phone: row.customer_phone ?? null,
    shipping_address: row.shipping_address ?? null,
    order_number: row.order_number || `PB-${String(row.id).padStart(3, "0")}`,
    order_date: row.order_date || String(row.created_at || "").slice(0, 10),
    shipping_income_php: M(row.shipping_income_php),
    discount_php: M(row.discount_php),
  };
}

function toOrderItem(row) {
  return {
    ...row,
    product_id: row.inventory_id,
    sale_price_php: M(row.unit_price),
    actual_landed_cost_php: M(row.unit_cost),
  };
}

/**
 * A storefront photo row, with the two derived facts every screen needs: the
 * shot that is WAITING (never mixed into `photo_url`, so an approved photo
 * keeps showing while its replacement is in the queue) and the state the desk
 * speaks. `active` still decides alone what the shop shows.
 */
function toStorefrontPhoto(row) {
  const pendingUrl = safePhotoUrl(row.pending_photo_url);
  return {
    ...row,
    active: int(row.active),
    photo_url: safePhotoUrl(row.photo_url),
    pending_photo_url: pendingUrl,
    pending: !!pendingUrl,
    state: approvalStateOf(row),
  };
}

function toVariant(row) {
  return {
    ...row,
    quantity: int(row.quantity),
    reorder_level: int(row.reorder_level),
    selling_price_php: M(row.selling_price_php),
    source_cost_vnd: M(row.source_cost_vnd),
    active: row.active == null ? 1 : int(row.active),
    photo_url: safePhotoUrl(row.photo_url),
  };
}


export async function loadAll() {
  await initDb();
  const res = await dbBatch([
    { sql: "SELECT * FROM settings WHERE id = 1" },
    { sql: "SELECT * FROM inventory ORDER BY name COLLATE NOCASE ASC" },
    { sql: "SELECT * FROM freebies ORDER BY name COLLATE NOCASE ASC" },
    { sql: "SELECT * FROM batches ORDER BY id DESC" },
    { sql: "SELECT * FROM batch_items ORDER BY id ASC" },
    { sql: "SELECT * FROM orders ORDER BY id DESC" },
    { sql: "SELECT * FROM order_items ORDER BY id ASC" },
    { sql: "SELECT * FROM order_freebies ORDER BY id ASC" },
    { sql: "SELECT * FROM payments ORDER BY payment_date DESC, id DESC" },
    { sql: "SELECT * FROM inventory_variants ORDER BY inventory_id ASC, id ASC" },
    { sql: "SELECT * FROM stock_movements ORDER BY id DESC LIMIT 400" },
    { sql: "SELECT * FROM order_tracking ORDER BY id ASC" },
    { sql: "SELECT * FROM batch_consumables ORDER BY batch_id ASC, id ASC" },
    { sql: "SELECT * FROM storefront_photos ORDER BY identity_type ASC, identity_key COLLATE NOCASE ASC" },
    { sql: "SELECT * FROM ad_spend ORDER BY spend_date DESC, id DESC" },
  ]);

  const s = res[0].rows[0] || { ...DEFAULT_SETTINGS };
  const orders = res[5].rows.map(toOrder);
  orders.sort((a, b) => {
    const d = String(b.order_date || "").localeCompare(String(a.order_date || ""));
    return d !== 0 ? d : M(b.id) - M(a.id);
  });

  return {
    settings: {
      php_to_vnd_rate: M(s.php_to_vnd_rate, DEFAULT_SETTINGS.php_to_vnd_rate),
      default_shipping_php: M(s.default_shipping_php, DEFAULT_SETTINGS.default_shipping_php),
      default_markup_percent: M(s.default_markup_percent, DEFAULT_SETTINGS.default_markup_percent),
      desired_profit_margin_percent: M(s.desired_profit_margin_percent, DEFAULT_SETTINGS.desired_profit_margin_percent),
      preorder_cutoff_date: s.preorder_cutoff_date || null,
      updated_at: s.updated_at,
    },
    products: res[1].rows.map(toProduct),
    freebies: res[2].rows,
    batches: res[3].rows,
    batchItems: res[4].rows,
    orders,
    orderItems: res[6].rows.map(toOrderItem),
    orderFreebies: res[7].rows,
    payments: res[8].rows,
    variants: res[9].rows.map(toVariant),
    movements: res[10].rows,
    tracking: res[11].rows,
    batchConsumables: res[12].rows,
    // Fifteen statements go out as 10 + 5 and come back concatenated in the
    // order they were written, so this positional read stays correct.
    storefrontPhotos: res[13].rows.map(toStorefrontPhoto),
    adSpend: res[14].rows,
  };
}

/* -------------------------------------------------------------- settings */

export async function saveSettings(values) {
  await db(
    `UPDATE settings
        SET php_to_vnd_rate = ?, default_shipping_php = ?, default_markup_percent = ?, desired_profit_margin_percent = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1`,
    [M(values.php_to_vnd_rate), M(values.default_shipping_php), M(values.default_markup_percent), M(values.desired_profit_margin_percent, DEFAULT_SETTINGS.desired_profit_margin_percent)],
  );
}

/**
 * The one global pre-order round date, set from the Orders page — see the
 * comment on settings.preorder_cutoff_date in schema.js for why this is
 * separate from any batch. `date` is a plain "YYYY-MM-DD" string or null to
 * close the current round without opening a new one.
 */
export async function setPreorderCutoffDate(date) {
  await db(`UPDATE settings SET preorder_cutoff_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`, [date || null]);
}

export async function resetSettings() {
  const { rows } = await db("SELECT default_markup_percent FROM settings WHERE id = 1");
  return saveSettings({
    ...DEFAULT_SETTINGS,
    default_markup_percent: M(rows[0]?.default_markup_percent, DEFAULT_SETTINGS.default_markup_percent),
  });
}

/* -------------------------------------------------------------- products */

/** unit_cost mirrors source_cost_vnd in ₱, so the legacy column stays true. */
async function currentRate() {
  const { rows } = await db("SELECT php_to_vnd_rate FROM settings WHERE id = 1");
  return M(rows[0]?.php_to_vnd_rate, DEFAULT_SETTINGS.php_to_vnd_rate);
}

function productArgs(p, rate) {
  const vndCost = Math.max(0, M(p.source_cost_vnd));
  return [
    String(p.sku).trim(),
    String(p.name).trim(),
    p.category?.trim() || null,
    p.variant?.trim() || null,
    vndCost,
    round2(vndToPhp(vndCost, rate)),
    Math.max(0, int(p.quantity_on_hand)),
    Math.max(0, int(p.reorder_level)),
    p.notes?.trim() || null,
    safePhotoUrl(p.photo_url),
  ];
}

export async function createProduct(p) {
  const rate = await currentRate();
  const price =
    p.selling_price_php !== undefined && String(p.selling_price_php).trim() !== ""
      ? Math.max(0, M(p.selling_price_php))
      : 0;
  const res = await db(
    `INSERT INTO inventory (sku, name, category, variant, source_cost_vnd, unit_cost, quantity, reorder_level, notes, photo_url, sell_price)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [...productArgs(p, rate), price],
  );
}

export async function updateProduct(id, p) {
  const rate = await currentRate();
  await db(
    `UPDATE inventory
        SET sku = ?, name = ?, category = ?, variant = ?, source_cost_vnd = ?, unit_cost = ?,
            quantity = ?, reorder_level = ?, notes = ?, photo_url = ?
      WHERE id = ?`,
    [...productArgs(p, rate), id],
  );
  if (p.selling_price_php !== undefined) await setProductPrice(id, p.selling_price_php);
}

export async function setProductPrice(id, price) {
  const value =
    price == null || String(price).trim() === "" ? 0 : Math.max(0, M(price));
  await db("UPDATE inventory SET sell_price = ? WHERE id = ?", [value, id]);
}

/**
 * A manual count. It writes the new quantity AND the movement that explains it,
 * so the history never has a gap the adjust tray caused.
 */
export async function setProductQuantity(id, quantity, { before, type = "Adjustment", notes } = {}) {
  const next = Math.max(0, int(quantity));
  const prior = before === undefined ? await currentQuantity({ product_id: id }) : int(before);
  await db("UPDATE inventory SET quantity = ? WHERE id = ?", [next, id]);
  if (next !== prior) {
    await logMovements([
      {
        inventory_id: id,
        variant_id: null,
        movement_type: type,
        quantity: next - prior,
        reference_type: "manual",
        reference_id: null,
        notes: notes || `Set to ${next} from ${prior}`,
      },
    ]);
  }
}

export async function setVariantQuantity(
  variant,
  quantity,
  { type = "Adjustment", notes } = {},
) {
  const next = Math.max(0, int(quantity));
  const prior = int(variant.quantity);
  await db("UPDATE inventory_variants SET quantity = ? WHERE id = ?", [next, variant.id]);
  if (next !== prior) {
    await logMovements([
      {
        inventory_id: variant.inventory_id,
        variant_id: variant.id,
        movement_type: type,
        quantity: next - prior,
        reference_type: "manual",
        reference_id: null,
        notes: notes || `${variant.color} set to ${next} from ${prior}`,
      },
    ]);
  }
}

async function currentQuantity({ product_id, variant_id }) {
  if (variant_id) {
    const { rows } = await db("SELECT quantity FROM inventory_variants WHERE id = ?", [variant_id]);
    return int(rows[0]?.quantity);
  }
  const { rows } = await db("SELECT quantity FROM inventory WHERE id = ?", [product_id]);
  return int(rows[0]?.quantity);
}

/* -------------------------------------------------------------- variants */

/**
 * Colour variants are first-class rows in `inventory_variants`. A paddle with no
 * variant rows keeps behaving exactly as it always did: its own quantity, its
 * own price. The moment it has one active colour, the colours own the stock.
 */
export async function saveVariant(productId, variant) {
  const args = [
    productId,
    String(variant.color).trim(),
    variant.sku?.trim() || null,
    Math.max(0, int(variant.quantity)),
    Math.max(0, int(variant.reorder_level)),
    Math.max(0, M(variant.selling_price_php)),
    Math.max(0, M(variant.source_cost_vnd)),
    variant.active ? 1 : 0,
    safePhotoUrl(variant.photo_url),
  ];

  if (variant.id) {
    const prior = await currentQuantity({ variant_id: variant.id });
    await db(
      `UPDATE inventory_variants
          SET inventory_id = ?, color = ?, sku = ?, quantity = ?, reorder_level = ?,
              selling_price_php = ?, source_cost_vnd = ?, active = ?, photo_url = ?
        WHERE id = ?`,
      [...args, variant.id],
    );
    const next = Math.max(0, int(variant.quantity));
    if (next !== prior) {
      await logMovements([
        {
          inventory_id: productId,
          variant_id: variant.id,
          movement_type: "Correction",
          quantity: next - prior,
          reference_type: "variant",
          reference_id: variant.id,
          notes: `${variant.color} edited to ${next} on hand`,
        },
      ]);
    }
    return variant.id;
  }

  const res = await db(
    `INSERT INTO inventory_variants (inventory_id, color, sku, quantity, reorder_level, selling_price_php, source_cost_vnd, active, photo_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args,
  );
  const opening = Math.max(0, int(variant.quantity));
  if (opening > 0) {
    await logMovements([
      {
        inventory_id: productId,
        variant_id: res.lastInsertId,
        movement_type: "Adjustment",
        quantity: opening,
        reference_type: "variant",
        reference_id: res.lastInsertId,
        notes: `${variant.color} opening count`,
      },
    ]);
  }
  return res.lastInsertId;
}

export async function setVariantActive(id, active) {
  await db("UPDATE inventory_variants SET active = ? WHERE id = ?", [active ? 1 : 0, id]);
}

/**
 * Deleting a colour nulls the FK on historical lines and movements rather than
 * removing them, exactly like deleting a paddle does, so the books stay honest.
 */
export async function deleteVariant(id) {
  await dbBatch([
    { sql: "UPDATE order_items SET variant_id = NULL WHERE variant_id = ?", args: [id] },
    { sql: "UPDATE batch_items SET variant_id = NULL WHERE variant_id = ?", args: [id] },
    { sql: "UPDATE stock_movements SET variant_id = NULL WHERE variant_id = ?", args: [id] },
    { sql: "DELETE FROM inventory_variants WHERE id = ?", args: [id] },
  ]);
}

export async function setArchived(product, archived) {
  const bare = cleanNotes(product);
  const next = archived ? `${ARCHIVE_TAG} ${bare}`.trim() : bare || null;
  await db("UPDATE inventory SET notes = ? WHERE id = ?", [next, product.id]);
}

/**
 * Deleting a paddle nulls the FK on historical order lines rather than removing
 * them, so past orders keep the costs they recorded and the books stay honest.
 * Batch lines go, because a batch line without a product has no meaning.
 */
export async function deleteProduct(id) {
  await dbBatch([
    { sql: "UPDATE order_items SET inventory_id = NULL, variant_id = NULL WHERE inventory_id = ?", args: [id] },
    { sql: "UPDATE stock_movements SET inventory_id = NULL, variant_id = NULL WHERE inventory_id = ?", args: [id] },
    { sql: "DELETE FROM batch_items WHERE product_id = ?", args: [id] },
    { sql: "DELETE FROM inventory_variants WHERE inventory_id = ?", args: [id] },
    { sql: "DELETE FROM inventory WHERE id = ?", args: [id] },
  ]);
}

/* -------------------------------------------------------------- freebies */

export async function saveFreebie(freebie) {
  const args = [
    String(freebie.name).trim(),
    Math.max(0, M(freebie.unit_cost)),
    Math.max(0, int(freebie.quantity)),
    freebie.active ? 1 : 0,
  ];
  if (freebie.id) {
    await db(
      "UPDATE freebies SET name = ?, unit_cost = ?, quantity = ?, active = ? WHERE id = ?",
      [...args, freebie.id],
    );
    return freebie.id;
  }
  const res = await db(
    "INSERT INTO freebies (name, unit_cost, quantity, active) VALUES (?, ?, ?, ?)",
    args,
  );
  return res.lastInsertId;
}

export async function setFreebieActive(id, active) {
  await db("UPDATE freebies SET active = ? WHERE id = ?", [active ? 1 : 0, id]);
}

export async function deleteFreebie(id) {
  await dbBatch([
    { sql: "UPDATE order_freebies SET freebie_id = NULL WHERE freebie_id = ?", args: [id] },
    { sql: "UPDATE batch_consumables SET freebie_id = NULL WHERE freebie_id = ?", args: [id] },
    { sql: "DELETE FROM freebies WHERE id = ?", args: [id] },
  ]);
}

/* ---------------------------------------------------- storefront photos */

/**
 * THE PHOTO DESK'S ONLY THREE WRITES, AND EACH ONE IS EXACTLY ONE STATEMENT
 * AGAINST `storefront_photos` ALONE.
 *
 * Nothing here touches a quantity, a cost, a price, an order, a movement or an
 * inventory photo. That is the whole guarantee of this system: re-photographing
 * the shop can never disturb the business.
 */

/**
 * A NEW OR CHANGED PHOTO IS A PROPOSAL. It lands in `pending_photo_url` with
 * `approval_status = 'pending'`, so a paddle that is already live keeps showing
 * its approved photo to customers while the replacement waits. A first photo
 * for an identity has nothing to keep showing, so it lands in both columns with
 * `active = 0` — off the shop until somebody approves it.
 *
 * `ON CONFLICT ... DO UPDATE` is what revives a previously removed mapping
 * rather than colliding with the UNIQUE(identity_type, identity_key) index.
 */
export async function saveStorefrontPhoto({ identityType, identityKey, photoUrl, sourceLabel }) {
  const url = safePhotoUrl(photoUrl);
  if (!url) throw new Error("That photo address is not one the shop can store.");
  const type = identityType === "brand" ? "brand" : "model";
  const key = String(identityKey || "").trim();
  if (!key) throw new Error("Pick what this photo is for first.");
  const label = String(sourceLabel || "").trim() || null;

  await db(
    `INSERT INTO storefront_photos
       (identity_type, identity_key, photo_url, pending_photo_url, source_label, active, approval_status, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 'pending', CURRENT_TIMESTAMP)
     ON CONFLICT(identity_type, identity_key) DO UPDATE SET
       pending_photo_url = excluded.pending_photo_url,
       source_label = excluded.source_label,
       approval_status = 'pending',
       updated_at = CURRENT_TIMESTAMP`,
    [type, key, url, url, label],
  );
}

/**
 * APPROVAL IS THE MOMENT A PHOTO BECOMES PUBLIC, and it PROMOTES the waiting
 * shot into `photo_url` rather than flipping a flag on a photo nobody looked
 * at. `COALESCE` means approving a row whose pending shot was already promoted
 * is harmless rather than blanking it.
 */
export async function approveStorefrontPhoto(id) {
  await db(
    `UPDATE storefront_photos
        SET photo_url = COALESCE(NULLIF(trim(pending_photo_url), ''), photo_url),
            pending_photo_url = NULL,
            approval_status = 'approved',
            active = 1,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [id],
  );
}

/**
 * REMOVING SETS `active = 0`, IT NEVER DELETES. The shop stops using the photo
 * immediately while the record of what was mapped survives, and clearing
 * `pending_photo_url` is what stops a discarded upload sitting in the queue
 * forever.
 */
export async function removeStorefrontPhoto(id) {
  await db(
    `UPDATE storefront_photos
        SET active = 0,
            pending_photo_url = NULL,
            approval_status = 'removed',
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [id],
  );
}

/* --------------------------------------------------------- stock movement */


/**
 * Diff two line sets into net per-STOCK-UNIT deltas, so nothing double-counts.
 * A unit is a colour variant where one was picked, and the base paddle where
 * none was, which is why the delta is keyed on both ids rather than product id.
 */
function stockDelta(before, after, sign = 1) {
  const delta = new Map();
  const add = (line, direction) => {
    if (!line.product_id) return;
    const key = unitKey(line.product_id, line.variant_id);
    const entry = delta.get(key) || {
      product_id: line.product_id,
      variant_id: line.variant_id ?? null,
      n: 0,
    };
    entry.n += M(line.quantity) * sign * direction;
    delta.set(key, entry);
  };
  for (const l of before || []) add(l, -1);
  for (const l of after || []) add(l, 1);
  return [...delta.values()].filter((d) => d.n !== 0);
}

/**
 * Pure builder, no I/O — lets a caller fold these UPDATEs into a larger
 * dbBatch() call it controls (saveOrder does, below) instead of always
 * running them as their own separate transaction.
 *
 * NO FLOOR AT ZERO, ON PURPOSE. A paddle marked Paid before its batch is
 * physically Received is a real, sayable state now (see
 * STOCK_COMMITTED_STATUSES in calc.js): it's sold, but not yet on the
 * shelf, and on-hand goes negative to say exactly that — the same way a
 * negative peso figure gets a true minus sign rather than being clamped to
 * ₱0. Receiving the batch afterwards ADDS its quantity on top (see the
 * "first" branch in saveBatch below), which nets out to the correct total
 * ONLY if this never silently ate the pre-sale as zero. A floor here would
 * make the batch's eventual on-hand total overcount by however many units
 * were already Paid for ahead of receipt — stock the storefront would then
 * offer to a second buyer that's already spoken for.
 */
function stockUpdateStatements(deltas) {
  return (deltas || []).map((d) =>
    d.variant_id
      ? {
          sql: "UPDATE inventory_variants SET quantity = quantity + ? WHERE id = ?",
          args: [Math.round(d.n), d.variant_id],
        }
      : {
          sql: "UPDATE inventory SET quantity = quantity + ? WHERE id = ?",
          args: [Math.round(d.n), d.product_id],
        },
  );
}

async function applyStock(deltas) {
  const statements = stockUpdateStatements(deltas);
  if (!statements.length) return;
  await dbBatch(statements);
}

// Pure builder — see stockUpdateStatements above for why this is split out.
function movementInsertStatements(rows) {
  const clean = (rows || []).filter((r) => Math.round(M(r.quantity)) !== 0);
  return clean.map((r) => ({
    sql: `INSERT INTO stock_movements (inventory_id, variant_id, batch_id, movement_type, quantity, reference_type, reference_id, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      r.inventory_id ?? null,
      r.variant_id ?? null,
      r.batch_id ?? null,
      r.movement_type,
      Math.round(M(r.quantity)),
      r.reference_type ?? null,
      r.reference_id ?? null,
      r.notes?.trim() || null,
    ],
  }));
}

/**
 * THE AUDIT TRAIL. Every stock change in the app funnels through here, and it
 * only ever records the NET delta a save produced, which is why re-saving a
 * received batch or a completed order never writes a second receipt.
 */
export async function logMovements(rows) {
  const statements = movementInsertStatements(rows);
  if (!statements.length) return;
  await dbBatch(statements);
}

/** Apply a set of deltas and record what they were, in one go. */
async function applyAndLog(deltas, { movement_type, reference_type, reference_id, notes }) {
  if (!deltas.length) return;
  await applyStock(deltas);
  await logMovements(
    deltas.map((d) => ({
      inventory_id: d.product_id,
      variant_id: d.variant_id,
      movement_type,
      quantity: d.n,
      reference_type,
      reference_id,
      notes,
      batch_id: reference_type === "batch" ? reference_id : d.batch_id ?? null,
    })),
  );
}

function freebieDelta(before, after) {
  const delta = new Map();
  for (const f of before || [])
    if (f.freebie_id) delta.set(f.freebie_id, (delta.get(f.freebie_id) || 0) + M(f.quantity));
  for (const f of after || [])
    if (f.freebie_id) delta.set(f.freebie_id, (delta.get(f.freebie_id) || 0) - M(f.quantity));
  return [...delta.entries()].filter(([, n]) => n !== 0);
}

// Pure builder — see stockUpdateStatements above for why this is split out,
// and for why there's no floor at zero: a freebie given away on a Paid
// order ahead of its own batch's consumables actually arriving is the same
// real pre-sold state a paddle can be in.
function freebieStockUpdateStatements(deltas) {
  return (deltas || []).map(([id, n]) => ({
    sql: "UPDATE freebies SET quantity = quantity + ? WHERE id = ?",
    args: [Math.round(n), id],
  }));
}

async function applyFreebieStock(deltas, { reference_id, notes, movement_type } = {}) {
  if (!deltas.length) return;
  await dbBatch(freebieStockUpdateStatements(deltas));
  // Freebie stock leaves an audit trail too, tagged so it is filterable apart
  // from paddles: inventory_id is null because a freebie is not an inventory row.
  await logMovements(
    deltas.map(([id, n]) => ({
      inventory_id: null,
      variant_id: null,
      movement_type: movement_type || (n < 0 ? "Sale" : "Return"),
      quantity: n,
      reference_type: "freebie",
      reference_id: reference_id ?? id,
      notes,
    })),
  );
}

/* --------------------------------------------------------------- batches */

/**
 * Consumables received are pieces ON THE FREEBIE SHELF: a pack of overgrips is
 * sixty of them. This diffs two purchase sets into net piece deltas per freebie,
 * exactly like stockDelta does for paddles, so re-saving a received batch never
 * stocks the shelf twice.
 */
function consumableDelta(before, after) {
  const delta = new Map();
  const add = (rows, direction) => {
    for (const row of rows || []) {
      const line = consumableLine(row);
      if (!row.freebie_id || line.pieces === 0) continue;
      delta.set(row.freebie_id, (delta.get(row.freebie_id) || 0) + line.pieces * direction);
    }
  };
  add(before, -1);
  add(after, 1);
  return [...delta.entries()].filter(([, n]) => n !== 0);
}

export async function saveBatch({ id, batchRow, items, consumables }) {
  let priorStatus = null;
  let priorItems = [];
  let priorConsumables = [];

  if (id) {
    const [statusRes, itemsRes, consRes] = await dbBatch([
      { sql: "SELECT status FROM batches WHERE id = ?", args: [id] },
      {
        sql: "SELECT product_id, variant_id, quantity FROM batch_items WHERE batch_id = ?",
        args: [id],
      },
      { sql: "SELECT * FROM batch_consumables WHERE batch_id = ?", args: [id] },
    ]);
    priorStatus = statusRes.rows[0]?.status ?? null;
    priorItems = itemsRes.rows;
    priorConsumables = consRes.rows;
  }

    const args = [
    String(batchRow.batch_name).trim(),
    batchRow.batch_id?.trim() || null,
    batchRow.supplier?.trim() || null,
    batchRow.order_date || null,
    batchRow.expected_arrival || null,
    Math.max(0, M(batchRow.local_shipping_php ?? batchRow.domestic_shipping_php ?? batchRow.shipping_php)),
    Math.max(0, M(batchRow.local_shipping_php ?? batchRow.domestic_shipping_php ?? batchRow.shipping_php)),
    Math.max(0, M(batchRow.other_costs_php ?? batchRow.other_cost_php)),
    batchRow.currency?.trim() || "VND",
    Math.max(0, M(batchRow.exchange_rate)),
    Math.max(0, M(batchRow.actual_weight_kg)),
    Math.max(0, M(batchRow.chargeable_weight_kg)),
    batchRow.intl_shipping_method || "per_kg",
    batchRow.shipping_allocation_method || "equal_per_item",
    Math.max(0, M(batchRow.local_shipping_php ?? batchRow.domestic_shipping_php ?? batchRow.shipping_php)),
    Math.max(0, M(batchRow.other_costs_php ?? batchRow.other_cost_php)),
    // The quote is per batch and has NO defaults: a blank field stores 0, which
    // reads back as "not quoted", and no other batch's figures are touched.
    batchRow.intl_quote_basis === "flat_total" ? "flat_total" : "per_kg",
    Math.max(0, M(batchRow.intl_combined_weight_kg)),
    Math.max(0, M(batchRow.intl_rate_vnd_per_kg)),
    Math.max(0, M(batchRow.intl_gross_vnd)),
    batchRow.intl_discount_mode === "percent" ? "percent" : "fixed",
    Math.max(0, M(batchRow.intl_discount_value)),
    batchRow.intl_actual_paid_php === "" || batchRow.intl_actual_paid_php == null ? null : Math.max(0, M(batchRow.intl_actual_paid_php)),
    batchRow.status,
    batchRow.notes?.trim() || null,
    batchRow.carrier?.trim() || null,
    batchRow.tracking_number?.trim() || null,
    batchRow.preorder_cutoff_date || null,
  ];

  let batchId = id;
  if (id) {
    await db(
      `UPDATE batches SET batch_name = ?, batch_id = ?, supplier = ?, order_date = ?, expected_arrival = ?,
              shipping_php = ?, domestic_shipping_php = ?, other_cost_php = ?, currency = ?, exchange_rate = ?, actual_weight_kg = ?, chargeable_weight_kg = ?, intl_shipping_method = ?, shipping_allocation_method = ?, local_shipping_php = ?, other_costs_php = ?, intl_quote_basis = ?, intl_combined_weight_kg = ?, intl_rate_vnd_per_kg = ?, intl_gross_vnd = ?, intl_discount_mode = ?, intl_discount_value = ?, intl_actual_paid_php = ?, status = ?, notes = ?, carrier = ?, tracking_number = ?, preorder_cutoff_date = ?
        WHERE id = ?`,
      [...args, id],
    );
  } else {
    const res = await db(
      // NOTE: this VALUES list previously had one more `?` than the column
      // list had columns (28 placeholders, 27 columns) — a pre-existing bug
      // that would make Postgres reject every brand-new batch insert
      // ("INSERT has more expressions than target columns"). Fixed here
      // while adding preorder_cutoff_date, since it touches this exact line:
      // placeholder count now matches column count (28 and 28) exactly.
      `INSERT INTO batches (batch_name, batch_id, supplier, order_date, expected_arrival, shipping_php, domestic_shipping_php, other_cost_php, currency, exchange_rate, actual_weight_kg, chargeable_weight_kg, intl_shipping_method, shipping_allocation_method, local_shipping_php, other_costs_php, intl_quote_basis, intl_combined_weight_kg, intl_rate_vnd_per_kg, intl_gross_vnd, intl_discount_mode, intl_discount_value, intl_actual_paid_php, status, notes, carrier, tracking_number, preorder_cutoff_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...args],
    );
    batchId = res.lastInsertId;
  }

  await db("DELETE FROM batch_items WHERE batch_id = ?", [batchId]);

  const lines = (items || []).filter((l) => l.product_id && M(l.quantity) > 0);
  if (lines.length) {
    await dbBatch(
      lines.map((l) => ({
        sql: "INSERT INTO batch_items (batch_id, product_id, variant_id, quantity, unit_cost_vnd, unit_weight_kg, chargeable_weight_kg, intl_shipping_method, intl_allocation_php, local_allocation_php, other_allocation_php, currency, exchange_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: [
          batchId,
          l.product_id,
          l.variant_id ?? null,
          Math.max(1, int(l.quantity)),
          Math.max(0, M(l.unit_cost_vnd)),
          Math.max(0, M(l.unit_weight_kg)),
          Math.max(0, M(l.chargeable_weight_kg ?? l.unit_weight_kg)),
          l.intl_shipping_method || batchRow.intl_shipping_method || "per_kg",
          Math.max(0, M(l.intl_allocation_php)),
          Math.max(0, M(l.local_allocation_php)),
          Math.max(0, M(l.other_allocation_php)),
          l.currency || batchRow.currency || "VND",
          Math.max(0, M(l.exchange_rate ?? batchRow.exchange_rate)),
        ],
      })),
    );
  }

  // Consumables bought with this batch. Only lines with something on them are
  // stored, so an untouched consumable never becomes a zero-cost row.
  await db("DELETE FROM batch_consumables WHERE batch_id = ?", [batchId]);
  const consumableRows = (consumables || [])
    .filter((c) => M(c.purchase_quantity) > 0 || M(c.unit_cost_php) > 0)
    .map((c) => {
      const meta = consumableMeta(c.consumable_key);
      return {
        batch_id: batchId,
        consumable_key: meta.key,
        purchase_quantity: Math.max(0, M(c.purchase_quantity)),
        unit_cost_php: Math.max(0, M(c.unit_cost_php)),
        pieces_per_unit: meta.piecesPerUnit,
        freebie_id: c.freebie_id ?? null,
      };
    });
  if (consumableRows.length) {
    await dbBatch(
      consumableRows.map((c) => ({
        sql: `INSERT INTO batch_consumables (batch_id, consumable_key, purchase_quantity, unit_cost_php, pieces_per_unit, freebie_id)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          c.batch_id,
          c.consumable_key,
          c.purchase_quantity,
          c.unit_cost_php,
          c.pieces_per_unit,
          c.freebie_id,
        ],
      })),
    );
  }

  // Receiving adds stock; un-receiving takes it back; re-saving a received
  // batch only applies the DIFFERENCE, so it never adds, or logs, twice.
  const wasReceived = priorStatus === "Received";
  const isReceived = batchRow.status === "Received";
  const name = String(batchRow.batch_name || "").trim();
  const first = !wasReceived && isReceived;
  let deltas = [];
  let consumableDeltas = [];
  if (first) {
    deltas = stockDelta([], lines, 1);
    consumableDeltas = consumableDelta([], consumableRows);
  } else if (wasReceived && !isReceived) {
    deltas = stockDelta(priorItems, [], 1);
    consumableDeltas = consumableDelta(priorConsumables, []);
  } else if (wasReceived && isReceived) {
    deltas = stockDelta(priorItems, lines, 1);
    consumableDeltas = consumableDelta(priorConsumables, consumableRows);
  }

  await applyAndLog(deltas, {
    movement_type: first ? "Receipt" : "Correction",
    reference_type: "batch",
    reference_id: batchId,
    notes: first ? `Received ${name}` : `${name} adjusted after receipt`,
  });

  // Receiving a batch stocks the freebie shelf with the pieces it bought, AND
  // refreshes each freebie's unit cost to what this batch actually paid per
  // piece, so a giveaway is always costed at the real number.
  await applyFreebieStock(consumableDeltas, {
    reference_id: batchId,
    movement_type: first ? "Receipt" : "Correction",
    notes: first ? `Consumables received with ${name}` : `${name} consumables adjusted`,
  });
  // A received batch's per-piece cost is the truth about what a giveaway costs,
  // so editing the procurement figures on one re-prices the freebie too. Only a
  // received batch may do it: a planned one has not paid for anything yet.
  if (isReceived) await refreshFreebieCosts(consumableRows);

  return {
    batchId,
    stockApplied: first,
    consumablesApplied: consumableDeltas.reduce((s, [, n]) => s + n, 0),
    consumablesFirst: first,
  };
}

/** The derived per-piece cost becomes the freebie's unit cost on receipt. */
async function refreshFreebieCosts(rows) {
  const updates = (rows || [])
    .map(consumableLine)
    .filter((l) => l.freebie_id && l.pieces > 0 && l.totalCost > 0)
    .map((l) => ({
      sql: "UPDATE freebies SET unit_cost = ? WHERE id = ?",
      args: [round2(l.perPiece), l.freebie_id],
    }));
  if (updates.length) await dbBatch(updates);
}

export async function deleteBatch(batch) {
  if (batch.status === "Received") {
    const [itemsRes, consRes] = await dbBatch([
      {
        sql: "SELECT product_id, variant_id, quantity FROM batch_items WHERE batch_id = ?",
        args: [batch.id],
      },
      { sql: "SELECT * FROM batch_consumables WHERE batch_id = ?", args: [batch.id] },
    ]);
    await applyAndLog(stockDelta(itemsRes.rows, [], 1), {
      movement_type: "Correction",
      reference_type: "batch",
      reference_id: batch.id,
      notes: `${batch.batch_name} deleted, receipt reversed`,
    });
    // The consumable pieces it put on the freebie shelf come back off with it.
    await applyFreebieStock(consumableDelta(consRes.rows, []), {
      reference_id: batch.id,
      movement_type: "Correction",
      notes: `${batch.batch_name} deleted, consumables reversed`,
    });
  }
  await dbBatch([
    { sql: "DELETE FROM batch_consumables WHERE batch_id = ?", args: [batch.id] },
    { sql: "DELETE FROM batch_items WHERE batch_id = ?", args: [batch.id] },
    { sql: "DELETE FROM batches WHERE id = ?", args: [batch.id] },
  ]);
}

/* ---------------------------------------------------------------- orders */

export async function nextOrderNumber() {
  const { rows } = await db("SELECT order_number FROM orders");
  const prefix = `PB-${new Date().getFullYear()}-`;
  let max = 0;
  for (const r of rows) {
    const m = String(r.order_number || "").match(/^PB-\d{4}-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

/**
 * Writes the order, its lines, its freebies, refreshes the legacy money
 * columns, and moves stock exactly once the order first becomes Paid or
 * Completed (see STOCK_COMMITTED_STATUSES in calc.js) — a 50% deposit is
 * non-refundable, so the paddle is sold the moment payment is verified,
 * not only once it's actually handed over.
 */
export async function saveOrder({ id, orderRow, items, freebies }) {
  let priorStatus = null;
  let priorItems = [];
  let priorFreebies = [];

  if (id) {
    const [statusRes, itemsRes, freeRes] = await dbBatch([
      { sql: "SELECT status FROM orders WHERE id = ?", args: [id] },
      {
        sql: "SELECT inventory_id AS product_id, variant_id, quantity FROM order_items WHERE order_id = ?",
        args: [id],
      },
      { sql: "SELECT freebie_id, quantity FROM order_freebies WHERE order_id = ?", args: [id] },
    ]);
    priorStatus = statusRes.rows[0]?.status ?? null;
    priorItems = itemsRes.rows;
    priorFreebies = freeRes.rows;
  }

  const requirement = orderRow.payment_requirement === "full" ? "full" : "deposit";
  const status = normaliseOrderStatus(orderRow.status, requirement);

  const lines = (items || []).filter((l) => l.product_id && M(l.quantity) > 0).map((l) => ({ ...l }));
  const gifts = (freebies || []).filter((f) => M(f.quantity) > 0);

  // Recompute the legacy money columns from the same numbers the UI shows.
  const [productsRes, batchesRes, batchItemsRes, settingsRes, variantsRes, inTransitClaimsRes] = await dbBatch([
    { sql: "SELECT id, source_cost_vnd, quantity FROM inventory" },
    { sql: "SELECT * FROM batches" },
    { sql: "SELECT * FROM batch_items" },
    { sql: "SELECT php_to_vnd_rate FROM settings WHERE id = 1" },
    { sql: "SELECT * FROM inventory_variants" },
    // Same shape as inTransitInfoMaps in api/v1/_shared.js — kept as a
    // parallel query rather than a shared import because this file runs in
    // the browser (over the admin's own __folkdata/query transport) while
    // _shared.js runs server-side in the storefront API's Vercel functions;
    // there's no runtime the two could share the function from. See the
    // batch_id note below for why this exists at all.
    {
      sql: `SELECT oi.batch_id, oi.variant_id, oi.inventory_id, SUM(oi.quantity) AS claimed
            FROM order_items oi JOIN orders o ON o.id = oi.order_id
            WHERE oi.batch_id IS NOT NULL AND o.status <> 'Cancelled' AND oi.order_id <> ?
            GROUP BY oi.batch_id, oi.variant_id, oi.inventory_id`,
      args: [id || -1],
    },
  ]);
  const rate = M(settingsRes.rows[0]?.php_to_vnd_rate, DEFAULT_SETTINGS.php_to_vnd_rate);
  const variantsByProduct = new Map();
  for (const v of variantsRes.rows) {
    if (!variantsByProduct.has(v.inventory_id)) variantsByProduct.set(v.inventory_id, []);
    variantsByProduct.get(v.inventory_id).push(v);
  }
  const landed = landedCostMap(
    productsRes.rows,
    batchesRes.rows,
    batchItemsRes.rows,
    rate,
    variantsByProduct,
  );

  // Claim any zero-on-hand line against a real in-transit batch, the same
  // way the storefront checkout already does (buildOrder in
  // api/v1/_shared.js) — without this, an order placed here for a paddle
  // that's already fully claimed via the admin never showed up against that
  // batch's REMAINING count, so the storefront kept offering the same
  // "in transit" stock as if this reservation had never happened. A line
  // only claims when the matched batch line has enough remaining to cover
  // the whole line — a partial match falls back to no claim, same rule as
  // the storefront's own no-partial-claim behaviour.
  const claimedByKey = new Map();
  for (const c of inTransitClaimsRes.rows) {
    const key =
      c.variant_id != null ? `${c.batch_id}:v:${c.variant_id}` : `${c.batch_id}:p:${c.inventory_id}`;
    claimedByKey.set(key, (claimedByKey.get(key) || 0) + M(c.claimed));
  }
  const inTransitBatchIds = new Set(
    batchesRes.rows.filter((b) => b.status === "In Transit").map((b) => b.id),
  );
  const batchById = new Map(batchesRes.rows.map((b) => [b.id, b]));
  const inTransitByVariant = new Map();
  const inTransitByProduct = new Map();
  for (const bi of batchItemsRes.rows) {
    if (!inTransitBatchIds.has(bi.batch_id)) continue;
    const key = bi.variant_id != null ? `${bi.batch_id}:v:${bi.variant_id}` : `${bi.batch_id}:p:${bi.product_id}`;
    const remaining = M(bi.quantity) - (claimedByKey.get(key) || 0);
    if (remaining <= 0) continue;
    const map = bi.variant_id != null ? inTransitByVariant : inTransitByProduct;
    const mapKey = bi.variant_id != null ? bi.variant_id : bi.product_id;
    const readyDate = batchById.get(bi.batch_id)?.expected_arrival || null;
    const existing = map.get(mapKey);
    if (!existing || (readyDate && (!existing.readyDate || readyDate < existing.readyDate))) {
      map.set(mapKey, { batchId: bi.batch_id, remaining, readyDate });
    }
  }
  const productQuantityById = new Map(productsRes.rows.map((p) => [p.id, M(p.quantity)]));
  const variantById = new Map(variantsRes.rows.map((v) => [v.id, v]));
  for (const l of lines) {
    const onHand = l.variant_id
      ? M(variantById.get(l.variant_id)?.quantity)
      : M(productQuantityById.get(l.product_id));
    if (onHand > 0) continue;
    const info = l.variant_id ? inTransitByVariant.get(l.variant_id) : inTransitByProduct.get(l.product_id);
    if (info && info.remaining >= M(l.quantity)) l.batch_id = info.batchId;
  }
  const math = orderMath(
    { ...orderRow, payment_requirement: requirement },
    lines.map((l) => ({
      product_id: l.product_id,
      variant_id: l.variant_id ?? null,
      quantity: l.quantity,
      sale_price_php: l.sale_price_php,
      actual_landed_cost_php: l.actual_landed_cost_php,
    })),
    landed,
    0,
    gifts.map((f) => ({ quantity: f.quantity, unit_cost: f.unit_cost })),
  );

  const args = [
    String(orderRow.order_number).trim(),
    orderRow.order_date,
    orderRow.customer_name?.trim() || null,
    orderRow.customer_name?.trim() || null,
    orderRow.customer_email?.trim() || null,
    orderRow.customer_phone?.trim() || null,
    orderRow.shipping_address?.trim() || null,
    orderRow.channel?.trim() || null,
    status,
    requirement,
    Math.max(0, M(orderRow.shipping_income_php)),
    Math.max(0, M(orderRow.discount_php)),
    orderRow.notes?.trim() || null,
    orderRow.carrier?.trim() || null,
    orderRow.tracking_number?.trim() || null,
    orderRow.fulfillment_status || "Not shipped",
    orderRow.shipped_date || null,
    // legacy money mirror
    round2(math.billedTotal),
    round2(math.actualCost - math.freebieCost),
    round2(math.shippingIncome),
    round2(math.freebieCost),
    round2(math.actualProfit),
    lines.length > 1 ? "Batch" : "Individual",
  ];

  // "Committed" = Paid or Completed (see STOCK_COMMITTED_STATUSES) — a 50%
  // deposit is non-refundable, so the stock is sold the instant payment is
  // verified, whichever of the two committed statuses that happens to be.
  const wasCommitted = isStockCommitted(priorStatus);
  const isCommitted = isStockCommitted(status);
  const label = String(orderRow.order_number || "").trim();
  const first = !wasCommitted && isCommitted;

  let deltas = [];
  let freebieDeltas = [];
  if (first) {
    deltas = stockDelta([], lines, -1);
    freebieDeltas = freebieDelta([], gifts);
  } else if (wasCommitted && !isCommitted) {
    deltas = stockDelta(priorItems, [], -1);
    freebieDeltas = freebieDelta(priorFreebies, []);
  } else if (wasCommitted && isCommitted) {
    // Re-saving an already-committed order (Paid<->Completed, or editing its
    // lines while either) only moves the DIFFERENCE, so a paddle is never
    // deducted twice and the ledger never grows a phantom second sale.
    deltas = stockDelta(priorItems, lines, -1);
    freebieDeltas = freebieDelta(priorFreebies, gifts);
  }

  // Everything below rides in ONE dbBatch() call per branch — a real
  // transaction (see runStatements in api/_db.js) — together with the
  // order row's own UPDATE/INSERT. This used to be several separate
  // sequential awaits: the order row (with its new status) committed on
  // its own, THEN items were resynced, THEN stock moved. If a later step
  // failed for any reason, the order was left permanently stuck reporting
  // "Completed" with stock never decremented — and unrecoverable by simply
  // retrying "Complete order" again, because the retry would then already
  // read priorStatus === "Completed" and compute a zero net delta against
  // itself (see `first` above). Committing the status change and its stock
  // consequence together means a failure anywhere rolls the whole
  // transition back, so a retry sees the true prior state and applies the
  // real delta instead of silently doing nothing.
  const itemAndStockStatements = (orderId) => [
    { sql: "DELETE FROM order_items WHERE order_id = ?", args: [orderId] },
    { sql: "DELETE FROM order_freebies WHERE order_id = ?", args: [orderId] },
    ...lines.map((l) => ({
      sql: `INSERT INTO order_items (order_id, inventory_id, variant_id, product_name, quantity, unit_price, unit_cost, batch_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        orderId,
        l.product_id,
        l.variant_id ?? null,
        l.product_name || "Paddle",
        Math.max(1, int(l.quantity)),
        Math.max(0, M(l.sale_price_php)),
        Math.max(0, M(l.actual_landed_cost_php)),
        l.batch_id ?? null,
      ],
    })),
    ...gifts.map((f) => ({
      sql: `INSERT INTO order_freebies (order_id, freebie_id, freebie_name, quantity, unit_cost)
            VALUES (?, ?, ?, ?, ?)`,
      args: [
        orderId,
        f.freebie_id ?? null,
        f.freebie_name,
        Math.max(1, int(f.quantity)),
        Math.max(0, M(f.unit_cost)),
      ],
    })),
    ...stockUpdateStatements(deltas),
    ...movementInsertStatements(
      deltas.map((d) => ({
        inventory_id: d.product_id,
        variant_id: d.variant_id,
        movement_type: first ? "Sale" : "Correction",
        quantity: d.n,
        reference_type: "order",
        reference_id: orderId,
        notes: first ? `Sold on ${label}` : `${label} edited while paid/completed`,
      })),
    ),
    ...freebieStockUpdateStatements(freebieDeltas),
    ...movementInsertStatements(
      freebieDeltas.map(([, n]) => ({
        inventory_id: null,
        variant_id: null,
        movement_type: n < 0 ? "Sale" : "Return",
        quantity: n,
        reference_type: "freebie",
        reference_id: orderId,
        notes: first ? `Freebies given on ${label}` : `${label} freebies adjusted`,
      })),
    ),
  ];

  let orderId = id;
  if (id) {
    await dbBatch([
      {
        sql: `UPDATE orders SET order_number = ?, order_date = ?, customer_name = ?, customer = ?, customer_email = ?, customer_phone = ?, shipping_address = ?, channel = ?, status = ?,
              payment_requirement = ?, shipping_income_php = ?, discount_php = ?, notes = ?,
              carrier = ?, tracking_number = ?, fulfillment_status = ?, shipped_date = ?,
              sale_total = ?, product_cost = ?, shipping_cost = ?, freebie_cost = ?, profit = ?, order_type = ?
          WHERE id = ?`,
        args: [...args, id],
      },
      ...itemAndStockStatements(id),
    ]);
  } else {
    // A brand-new order can't join the batch above — its id doesn't exist
    // until this INSERT runs, and every later statement needs it. Its own
    // status write is a single INSERT (nothing to partially commit within
    // it), so the one real atomicity gap here is narrower than the update
    // path above: only reachable if a new order is created already
    // Completed in the same save AND the second batch below then fails.
    const res = await db(
      `INSERT INTO orders (order_number, order_date, customer_name, customer, customer_email, customer_phone, shipping_address, channel, status,
              payment_requirement, shipping_income_php, discount_php, notes,
              carrier, tracking_number, fulfillment_status, shipped_date,
              sale_total, product_cost, shipping_cost, freebie_cost, profit, order_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args,
    );
    orderId = res.lastInsertId;
    await dbBatch(itemAndStockStatements(orderId));
  }

  return { orderId, status, stockApplied: first };
}

/* ------------------------------------------------------------- fulfilment */

/**
 * A tracking event is append-only history. Saving one also lifts the order's own
 * carrier / number / status to the latest event, so the card can show where a
 * parcel is without reading the whole timeline.
 */
export async function saveTrackingEvent({ id, orderId, event }) {
  const args = [
    orderId,
    event.status,
    event.tracking_number?.trim() || null,
    event.carrier?.trim() || null,
    event.location?.trim() || null,
    event.event_date || null,
    event.notes?.trim() || null,
  ];

  if (id) {
    await db(
      `UPDATE order_tracking SET order_id = ?, status = ?, tracking_number = ?, carrier = ?,
              location = ?, event_date = ?, notes = ? WHERE id = ?`,
      [...args, id],
    );
  } else {
    await db(
      `INSERT INTO order_tracking (order_id, status, tracking_number, carrier, location, event_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args,
    );
  }

  const { rows } = await db(
    `SELECT status, carrier, tracking_number, event_date FROM order_tracking
      WHERE order_id = ? ORDER BY COALESCE(event_date, date(created_at)) DESC, id DESC LIMIT 1`,
    [orderId],
  );
  const latest = rows[0];
  if (latest) {
    await db(
      `UPDATE orders SET fulfillment_status = ?, carrier = COALESCE(?, carrier),
              tracking_number = COALESCE(?, tracking_number),
              shipped_date = COALESCE(shipped_date, ?)
        WHERE id = ?`,
      [
        latest.status,
        latest.carrier || null,
        latest.tracking_number || null,
        latest.status === "Shipped" ? latest.event_date : null,
        orderId,
      ],
    );
  }
}

export async function deleteTrackingEvent(id) {
  await db("DELETE FROM order_tracking WHERE id = ?", [id]);
}

export async function setOrderStatus(order, status) {
  const [itemsRes, freeRes] = await dbBatch([
    { sql: "SELECT * FROM order_items WHERE order_id = ?", args: [order.id] },
    { sql: "SELECT * FROM order_freebies WHERE order_id = ?", args: [order.id] },
  ]);
  return saveOrder({
    id: order.id,
    orderRow: { ...order, status },
    items: itemsRes.rows.map((r) => ({
      product_id: r.inventory_id,
      variant_id: r.variant_id ?? null,
      product_name: r.product_name,
      quantity: r.quantity,
      sale_price_php: r.unit_price,
      actual_landed_cost_php: r.unit_cost,
    })),
    freebies: freeRes.rows.map((r) => ({
      freebie_id: r.freebie_id,
      freebie_name: r.freebie_name,
      quantity: r.quantity,
      unit_cost: r.unit_cost,
    })),
  });
}

export async function deleteOrder(order) {
  if (isStockCommitted(order.status)) {
    const [itemsRes, freeRes] = await dbBatch([
      {
        sql: "SELECT inventory_id AS product_id, variant_id, quantity FROM order_items WHERE order_id = ?",
        args: [order.id],
      },
      { sql: "SELECT freebie_id, quantity FROM order_freebies WHERE order_id = ?", args: [order.id] },
    ]);
    await applyAndLog(stockDelta(itemsRes.rows, [], -1), {
      movement_type: "Return",
      reference_type: "order",
      reference_id: order.id,
      notes: `${order.order_number} deleted, stock put back`,
    });
    await applyFreebieStock(freebieDelta(freeRes.rows, []), {
      reference_id: order.id,
      notes: `${order.order_number} deleted, freebies put back`,
    });
  }
  await dbBatch([
    { sql: "UPDATE payments SET order_id = NULL WHERE order_id = ?", args: [order.id] },
    { sql: "DELETE FROM order_tracking WHERE order_id = ?", args: [order.id] },
    { sql: "DELETE FROM order_items WHERE order_id = ?", args: [order.id] },
    { sql: "DELETE FROM order_freebies WHERE order_id = ?", args: [order.id] },
    { sql: "DELETE FROM orders WHERE id = ?", args: [order.id] },
  ]);
}

/* -------------------------------------------------------------- payments */

export async function savePayment({ id, payment }) {
  const args = [
    payment.order_id || null,
    payment.payment_date,
    Math.max(0, M(payment.amount_php)),
    payment.method?.trim() || null,
    payment.status,
    payment.reference?.trim() || null,
    payment.notes?.trim() || null,
  ];
  if (id) {
    await db(
      `UPDATE payments SET order_id = ?, payment_date = ?, amount_php = ?, method = ?, status = ?, reference = ?, notes = ?
        WHERE id = ?`,
      [...args, id],
    );
    return id;
  }
  const res = await db(
    `INSERT INTO payments (order_id, payment_date, amount_php, method, status, reference, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args,
  );
  return res.lastInsertId;
}

export async function deletePayment(id) {
  await db("DELETE FROM payments WHERE id = ?", [id]);
}

/* -------------------------------------------------------------- ad spend */

export async function saveAdSpend({ id, entry }) {
  const args = [entry.spend_date, Math.max(0, M(entry.amount_php)), entry.note?.trim() || null];
  if (id) {
    await db("UPDATE ad_spend SET spend_date = ?, amount_php = ?, note = ? WHERE id = ?", [...args, id]);
    return id;
  }
  const res = await db(
    "INSERT INTO ad_spend (spend_date, amount_php, note) VALUES (?, ?, ?)",
    args,
  );
  return res.lastInsertId;
}

export async function deleteAdSpend(id) {
  await db("DELETE FROM ad_spend WHERE id = ?", [id]);
}

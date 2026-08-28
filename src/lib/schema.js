import { query, batch } from "./folkdb";
import { DEFAULT_SETTINGS, M } from "./calc";

/**
 * SCHEMA RULES FOR THIS APP
 * =========================
 * `inventory`, `freebies`, `orders`, `order_items` and `order_freebies` already
 * exist and are also written to by the folk chat agent. Nothing here may rename
 * a table or restructure a column. Everything below is strictly ADDITIVE:
 * `CREATE TABLE IF NOT EXISTS` for the tables that are new, and
 * `ALTER TABLE ... ADD COLUMN` for the columns the ops console needs.
 *
 * The legacy columns are kept and kept CORRECT: every order write also refreshes
 * `orders.sale_total / product_cost / shipping_cost / freebie_cost / profit` and
 * `orders.customer`, so a chat message reading the old shape still sees the
 * truth. Existing columns are reused wherever they already mean the right thing:
 *
 *   inventory.quantity      → quantity on hand
 *   inventory.sell_price    → standard selling price (₱)
 *   inventory.unit_cost     → PHP supplier cost mirror of source_cost_vnd
 *   order_items.inventory_id→ product_id
 *   order_items.unit_price  → sale_price_php
 *   order_items.unit_cost   → actual_landed_cost_php
 */

const NEW_TABLES = [
  `CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), php_to_vnd_rate REAL NOT NULL DEFAULT 416, default_shipping_php REAL NOT NULL DEFAULT 200, default_markup_percent REAL NOT NULL DEFAULT 15, desired_profit_margin_percent REAL NOT NULL DEFAULT 20, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS batches (id INTEGER PRIMARY KEY AUTOINCREMENT, batch_name TEXT NOT NULL, supplier TEXT, order_date TEXT, expected_arrival TEXT, shipping_php REAL DEFAULT 200, other_cost_php REAL DEFAULT 0, status TEXT NOT NULL DEFAULT 'Planned', notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS batch_items (id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INTEGER NOT NULL, product_id INTEGER NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, unit_cost_vnd REAL NOT NULL DEFAULT 0, FOREIGN KEY(batch_id) REFERENCES batches(id), FOREIGN KEY(product_id) REFERENCES inventory(id))`,
  `CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER, payment_date TEXT NOT NULL, amount_php REAL NOT NULL DEFAULT 0, method TEXT, status TEXT NOT NULL DEFAULT 'Received', reference TEXT, notes TEXT, FOREIGN KEY(order_id) REFERENCES orders(id))`,
  `CREATE TABLE IF NOT EXISTS batch_consumables (id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INTEGER NOT NULL, consumable_key TEXT NOT NULL, purchase_quantity REAL NOT NULL DEFAULT 0, unit_cost_php REAL NOT NULL DEFAULT 0, pieces_per_unit INTEGER NOT NULL DEFAULT 1, freebie_id INTEGER, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(batch_id) REFERENCES batches(id))`,
  `CREATE TABLE IF NOT EXISTS api_idempotency (idempotency_key TEXT PRIMARY KEY, endpoint TEXT NOT NULL, response_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)`,
  /*
    THE SHOP'S OWN PHOTOS, AND THEY ARE NOT INVENTORY. This table exists so the
    buyer-facing line-up can be re-photographed without a single inventory
    write: nothing that touches it changes a quantity, a cost, a price, an
    order or a movement. The console and the invoice keep reading
    `inventory.photo_url` exactly as before.

    DDL matches the live table verbatim, including the CHECK constraint that
    allows only 'model' and 'brand' — a colour is a 'model' row with '::' in
    its key. Never restructure it.
  */
  `CREATE TABLE IF NOT EXISTS storefront_photos (id INTEGER PRIMARY KEY AUTOINCREMENT, identity_type TEXT NOT NULL CHECK(identity_type IN ('model','brand')), identity_key TEXT NOT NULL, photo_url TEXT NOT NULL, source_label TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, approval_status TEXT, pending_photo_url TEXT, UNIQUE(identity_type, identity_key))`,
  // The three tables the folk chat agent also writes to. Exact DDL, verbatim.
  `CREATE TABLE IF NOT EXISTS inventory_variants (id INTEGER PRIMARY KEY AUTOINCREMENT, inventory_id INTEGER NOT NULL, color TEXT NOT NULL, sku TEXT, quantity INTEGER NOT NULL DEFAULT 0, reorder_level INTEGER NOT NULL DEFAULT 0, selling_price_php REAL NOT NULL DEFAULT 0, source_cost_vnd REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(inventory_id) REFERENCES inventory(id))`,
  `CREATE TABLE IF NOT EXISTS stock_movements (id INTEGER PRIMARY KEY AUTOINCREMENT, inventory_id INTEGER, variant_id INTEGER, movement_type TEXT NOT NULL, quantity INTEGER NOT NULL, reference_type TEXT, reference_id INTEGER, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(inventory_id) REFERENCES inventory(id), FOREIGN KEY(variant_id) REFERENCES inventory_variants(id))`,
  `CREATE TABLE IF NOT EXISTS order_tracking (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, status TEXT NOT NULL, tracking_number TEXT, carrier TEXT, location TEXT, event_date TEXT, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(order_id) REFERENCES orders(id))`,
];

/** Safety net only: folk already created these, this covers a cold start. */
const LEGACY_TABLES = [
  `CREATE TABLE IF NOT EXISTS inventory (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, sku TEXT, quantity INTEGER NOT NULL DEFAULT 0, unit_cost REAL NOT NULL DEFAULT 0, sell_price REAL NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS freebies (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, unit_cost REAL NOT NULL DEFAULT 0, quantity INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, order_type TEXT NOT NULL, customer TEXT, status TEXT NOT NULL DEFAULT 'Pending', sale_total REAL NOT NULL DEFAULT 0, product_cost REAL NOT NULL DEFAULT 0, shipping_cost REAL NOT NULL DEFAULT 0, freebie_cost REAL NOT NULL DEFAULT 0, profit REAL NOT NULL DEFAULT 0, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, inventory_id INTEGER, product_name TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, unit_price REAL NOT NULL DEFAULT 0, unit_cost REAL NOT NULL DEFAULT 0, FOREIGN KEY(order_id) REFERENCES orders(id), FOREIGN KEY(inventory_id) REFERENCES inventory(id))`,
  `CREATE TABLE IF NOT EXISTS order_freebies (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, freebie_id INTEGER, freebie_name TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, unit_cost REAL NOT NULL DEFAULT 0, FOREIGN KEY(order_id) REFERENCES orders(id), FOREIGN KEY(freebie_id) REFERENCES freebies(id))`,
];

/** Columns the console needs that the original five tables did not carry. */
const ADDED_COLUMNS = [
  ["settings", "desired_profit_margin_percent", "REAL NOT NULL DEFAULT 20"],
  ["inventory", "category", "TEXT"],
  ["inventory", "variant", "TEXT"],
  ["inventory", "source_cost_vnd", "REAL DEFAULT 0"],
  ["inventory", "reorder_level", "INTEGER NOT NULL DEFAULT 2"],
  ["inventory", "notes", "TEXT"],
  // The product photograph the customer invoice shows, on the paddle and on
  // each colour. Additive only: nothing reads it except the invoice.
  ["inventory", "photo_url", "TEXT"],
  ["inventory_variants", "photo_url", "TEXT"],
  ["orders", "order_number", "TEXT"],
  ["orders", "order_date", "TEXT"],
  ["orders", "customer_name", "TEXT"],
  ["orders", "customer_email", "TEXT"],
  ["orders", "customer_phone", "TEXT"],
  ["orders", "shipping_address", "TEXT"],
  ["orders", "channel", "TEXT"],
  ["orders", "shipping_income_php", "REAL DEFAULT 0"],
  ["orders", "discount_php", "REAL DEFAULT 0"],
  ["orders", "payment_requirement", "TEXT"],
  ["orders", "fulfillment_method", "TEXT"],
  ["orders", "payment_proof_url", "TEXT"],
  ["orders", "acknowledgment", "TEXT"],
  // Fulfilment on the order itself, so the latest carrier/number is one read.
  ["orders", "carrier", "TEXT"],
  ["orders", "tracking_number", "TEXT"],
  ["orders", "fulfillment_status", "TEXT"],
  ["orders", "shipped_date", "TEXT"],
  // Colour variants, first-class on every line that can carry one.
  ["order_items", "variant_id", "INTEGER"],
  ["batch_items", "variant_id", "INTEGER"],
  ["batch_items", "unit_weight_kg", "REAL DEFAULT 0"],
  ["batch_items", "chargeable_weight_kg", "REAL DEFAULT 0"],
  ["batch_items", "intl_shipping_method", "TEXT DEFAULT 'per_kg'"],
  ["batch_items", "intl_allocation_php", "REAL DEFAULT 0"],
  ["batch_items", "local_allocation_php", "REAL DEFAULT 0"],
  ["batch_items", "other_allocation_php", "REAL DEFAULT 0"],
  ["batch_items", "currency", "TEXT DEFAULT 'VND'"],
  ["batch_items", "exchange_rate", "REAL DEFAULT 0"],
  ["batches", "batch_id", "TEXT"],
  ["batches", "currency", "TEXT DEFAULT 'VND'"],
  ["batches", "exchange_rate", "REAL DEFAULT 0"],
  ["batches", "actual_weight_kg", "REAL DEFAULT 0"],
  ["batches", "chargeable_weight_kg", "REAL DEFAULT 0"],
  ["batches", "intl_shipping_method", "TEXT DEFAULT 'per_kg'"],
  ["batches", "shipping_allocation_method", "TEXT DEFAULT 'equal_per_item'"],
  ["batches", "local_shipping_php", "REAL DEFAULT 0"],
  ["batches", "other_costs_php", "REAL DEFAULT 0"],
  ["stock_movements", "batch_id", "INTEGER"],
  ["order_items", "batch_id", "INTEGER"],
  // Batch shipment tracking, mirroring the order side.
  ["batches", "carrier", "TEXT"],
  ["batches", "tracking_number", "TEXT"],
  // Flexible per-batch supplier quote inputs. Existing batch values are preserved.
  ["batches", "intl_quote_basis", "TEXT DEFAULT 'per_kg'"],
  ["batches", "intl_combined_weight_kg", "REAL DEFAULT 0"],
  ["batches", "intl_rate_vnd_per_kg", "REAL DEFAULT 0"],
  ["batches", "intl_gross_vnd", "REAL DEFAULT 0"],
  ["batches", "intl_discount_mode", "TEXT DEFAULT 'fixed'"],
  ["batches", "intl_discount_value", "REAL DEFAULT 0"],
  ["batches", "intl_actual_paid_php", "REAL"],
  ["batches", "domestic_shipping_php", "REAL DEFAULT 0"],
  // The pre-order order-cutoff date for this batch — when it varies per
  // shipment. Purely additive, read by the storefront (publicCatalog) to
  // show a real "order by" date on any paddle sourced from this batch;
  // `expected_arrival` (already existed) is what "Ships in ~N weeks" is
  // computed from. Neither is required — a batch with neither set just
  // shows the existing generic pre-order note, never a guessed date.
  ["batches", "preorder_cutoff_date", "TEXT"],
  /*
    A NEW PHOTO IS A PROPOSAL UNTIL SOMEBODY APPROVES IT. `pending_photo_url`
    holds the waiting shot APART from `photo_url`, so re-photographing a live
    paddle never blanks its card while it waits — the customer keeps seeing the
    approved photo until the pending one is promoted. `approval_status`
    (pending | approved | removed) only records WHY a row is off the shop;
    `active` still decides alone what the shop shows.
  */
  ["storefront_photos", "approval_status", "TEXT"],
  ["storefront_photos", "pending_photo_url", "TEXT"],
];

async function columnsOf(table) {
  const { rows } = await query(`PRAGMA table_info(${table})`);
  return new Set(rows.map((r) => String(r.name).toLowerCase()));
}

/**
 * The standard PTG line. Seeded only where a paddle of that name is NOT already
 * in the ledger, and a price is written only where none exists, so a real
 * catalog is never overwritten.
 *
 * THE `name` IS THE BRANDED CANONICAL SPELLING THE LEDGER ACTUALLY HOLDS, AND
 * EVERY OLDER NO-BRAND SPELLING IS AN `alias`. That distinction is the whole
 * reason the redundant duplicate rows existed at all.
 *
 * The seeder matches a catalog entry against the ledger by NAME (through
 * `namesOf`, so any alias counts as a match) and inserts only when nothing
 * matched. When these entries were still named `Boomstick Clay` / `J6CR` /
 * `Omni Hydro-Cosmic` and the ledger had been re-spelled to
 * `Selkirk Boomstick Clay` / `Honolulu J6CR` / `Selkirk Omni Hydro-Cosmic`,
 * NOTHING matched — so every page load inserted a second, no-brand copy of a
 * paddle that was already there. That is where the duplicates came from, and
 * deleting them from the database alone does not stop it: the very next load
 * writes them straight back. Recording the branded name as canonical and the
 * old spelling as an alias is what actually ends it, and it does so without a
 * single write to a row that survived the cleanup.
 *
 * KEEP BOTH SPELLINGS. The alias is not decoration: `standardFor()` and
 * `isAddon()` resolve through the same list, so dropping it would strand any
 * historical order line, movement or storefront identity still written against
 * the old name. Adding a brand word to a `name` here means moving the previous
 * spelling into `aliases`, never replacing it.
 */
const PADDLES = [
  { name: "Franklin C45 ALW", sku: "PTG-C45", price: 11500 },
  { name: "Kamito Alpha X", sku: "PTG-KAX", price: 8900 },
  { name: "Selkirk Omni Clay", sku: "PTG-SOC", price: 18900 },
  { name: "Selkirk Boomstick Clay", sku: "PTG-BSC", price: 18900, aliases: ["Boomstick Clay"] },
  {
    name: "Selkirk Omni Hydro-Cosmic",
    sku: "PTG-OHC",
    price: 18500,
    aliases: ["Omni Hydro-Cosmic"],
  },
  { name: "Kamito Dominus", sku: "PTG-KDM", price: 6900 },
  {
    name: "Selkirk Boomstick Jacksock",
    sku: "PTG-BSJ",
    price: 16500,
    aliases: ["Boomstick Jacksock"],
  },
  { name: "Selkirk Boomstick US", sku: "PTG-BSU", price: 15900, aliases: ["Boomstick US"] },
  { name: "Honolulu J2CR Crystal", sku: "PTG-J2CR", price: 13500, aliases: ["J2CR Crystal"] },
  { name: "Honolulu J6CR", sku: "PTG-J6CR", price: 15000, aliases: ["J6CR"] },
  { name: "RPM Q2", sku: "PTG-RQ2", price: 11900 },
  { name: "RPM V2", sku: "PTG-RV2", price: 12900 },
  { name: "Zocker Aspire", sku: "PTG-ZAS", price: 8900 },
  // No bare "Sypik Triton 5" entry — the real catalog only ever carries this
  // paddle per-colour ("Sypik Triton 5 Jade Mist", "...Olive Dust", etc.),
  // so a standalone "Sypik Triton 5" seed row never matched any of those
  // names and kept getting recreated by seedCatalog() every cold start,
  // no matter how many times it was deleted from Inventory. Removed
  // outright rather than deleted again.
  { name: "Joola V Persus", sku: "PTG-JVP", price: 15000 },
  { name: "Joola IV", sku: "PTG-JIV", price: 13500 },
];

export const ADDON_CATEGORY = "Add-on";

const ADDONS = [
  {
    name: "Selkirk Boomstick Jacksock Red Case",
    sku: "PTG-BSJ-CASE",
    price: 1100,
    category: ADDON_CATEGORY,
    aliases: ["Boomstick Jacksock red case"],
  },
];

export const CATALOG = [...PADDLES, ...ADDONS];

export const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const namesOf = (item) => [item.name, ...(item.aliases || [])];

const addonNames = new Set(ADDONS.flatMap(namesOf).map(norm));
export const isAddon = (product) =>
  product?.category === ADDON_CATEGORY || addonNames.has(norm(product?.name));

const paddleByName = new Map(PADDLES.flatMap((p) => namesOf(p).map((n) => [norm(n), p])));
export const standardFor = (name) => paddleByName.get(norm(name)) || null;

/**
 * The three freebies PTG actually hands out. Seeded ONLY when the table is
 * empty, so a real catalog is never touched. Costs are in ₱ and stay editable.
 */
const SEED_FREEBIES = [
  { name: "Paddle Cover", unit_cost: 150 },
  { name: "Edge Tape", unit_cost: 60 },
  { name: "Overgrip", unit_cost: 80 },
];

let ready = null;

/**
 * THE DATABASE ACCEPTS AT MOST 10 STATEMENTS PER REQUEST, so nothing in this
 * file may call `batch()` directly. This is the ONLY batch path here: it slices
 * any list into requests of 10 or fewer, sends them sequentially, and
 * concatenates the results in the order the caller wrote them — so `res[13]` is
 * still the fourteenth statement. Every read and write goes through it,
 * including the migrations below, which is what makes the cap impossible to
 * exceed by adding one more statement to an existing list.
 */
const BATCH_LIMIT = 10;

async function runBatch(statements) {
  const out = [];
  for (let i = 0; i < statements.length; i += BATCH_LIMIT) {
    out.push(...(await batch(statements.slice(i, i + BATCH_LIMIT))));
  }
  return out;
}

// Bump this whenever LEGACY_TABLES/NEW_TABLES/ADDED_COLUMNS/PADDLES/ADDONS
// change, so the fast path below correctly falls through and re-runs setup
// on databases stamped with an older version. Forgetting to bump it means a
// new column or seed entry silently never reaches an already-initialized
// database.
const INIT_VERSION = "2026-08-28.1";

export function initDb() {
  if (!ready) {
    ready = (async () => {
      // Fast path: skip CREATE TABLE, migrate() (which alone does a round
      // trip per table just to check its columns, every single call), and
      // both seeders entirely once this database is already at the current
      // version -- one cheap SELECT instead. Before this, initDb() paid
      // 25-40+ sequential Postgres round trips on EVERY cold start (which on
      // Vercel is most requests for a low-traffic app), which is what made
      // every page load and every click-to-save in the admin feel slow --
      // not any one screen, the shared init path every page runs first.
      try {
        const { rows } = await query("SELECT value FROM app_meta WHERE key = 'init_version'");
        if (rows[0]?.value === INIT_VERSION) return;
      } catch {
        // app_meta itself doesn't exist yet on a brand-new database --
        // fall through to full setup, which creates it.
      }

      await runBatch([...LEGACY_TABLES, ...NEW_TABLES].map((sql) => ({ sql })));

      await migrate();

      await query(
        `INSERT OR IGNORE INTO settings (id, php_to_vnd_rate, default_shipping_php, default_markup_percent, desired_profit_margin_percent)
         VALUES (1, ?, ?, ?, ?)`,
        [
          DEFAULT_SETTINGS.php_to_vnd_rate,
          DEFAULT_SETTINGS.default_shipping_php,
          DEFAULT_SETTINGS.default_markup_percent,
          DEFAULT_SETTINGS.desired_profit_margin_percent,
        ],
      );

      await seedFreebies();
      await seedCatalog();

      await query("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)", [
        "init_version",
        INIT_VERSION,
      ]);
    })().catch((err) => {
      // Let the next caller retry instead of caching a failed init forever.
      ready = null;
      throw err;
    });
  }
  return ready;
}

async function migrate() {
  const seen = new Map();
  for (const [table, column, type] of ADDED_COLUMNS) {
    if (!seen.has(table)) seen.set(table, await columnsOf(table));
    if (seen.get(table).has(column.toLowerCase())) continue;
    await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    seen.get(table).add(column.toLowerCase());
  }

  // Backfill the shape the console reads from, without disturbing any value.
  await runBatch([
    { sql: "UPDATE orders SET payment_requirement = 'deposit' WHERE payment_requirement IS NULL" },
    { sql: "UPDATE orders SET customer_name = customer WHERE customer_name IS NULL AND customer IS NOT NULL" },
    { sql: "UPDATE orders SET order_date = date(created_at) WHERE order_date IS NULL" },
    {
      sql: `UPDATE orders SET order_number = 'PB-' || substr('000' || id, -3)
              WHERE order_number IS NULL OR trim(order_number) = ''`,
    },
    { sql: "UPDATE orders SET shipping_income_php = 0 WHERE shipping_income_php IS NULL" },
    { sql: "UPDATE orders SET discount_php = 0 WHERE discount_php IS NULL" },
    { sql: "UPDATE inventory SET source_cost_vnd = 0 WHERE source_cost_vnd IS NULL" },
    { sql: "UPDATE inventory SET reorder_level = 2 WHERE reorder_level IS NULL" },
    { sql: "UPDATE orders SET fulfillment_status = 'Not shipped' WHERE fulfillment_status IS NULL" },
  ]);
  // Backfill only missing quote METADATA, and only where it is NULL. Every
  // statement below writes a neutral zero or a shape flag, never a freight
  // figure and never a rate: a historical batch keeps exactly the basis, rate
  // and amounts it was saved with, and a new batch starts with no rate at all.
  // Fourteen statements, so `runBatch` splits it into 10 + 4. Each one is an
  // idempotent guarded UPDATE, so the split never leaves a half-migrated row.
  await runBatch([
    { sql: "UPDATE batches SET intl_quote_basis = CASE WHEN COALESCE(intl_gross_vnd, 0) > 0 THEN 'flat_total' ELSE 'per_kg' END WHERE intl_quote_basis IS NULL OR trim(intl_quote_basis) = ''" },
    { sql: "UPDATE batches SET intl_combined_weight_kg = 0 WHERE intl_combined_weight_kg IS NULL" },
    { sql: "UPDATE batches SET intl_rate_vnd_per_kg = 0 WHERE intl_rate_vnd_per_kg IS NULL" },
    { sql: "UPDATE batches SET intl_discount_mode = 'fixed' WHERE intl_discount_mode IS NULL OR trim(intl_discount_mode) = ''" },
    { sql: "UPDATE batches SET intl_discount_value = 0 WHERE intl_discount_value IS NULL" },
    { sql: "UPDATE batches SET domestic_shipping_php = shipping_php WHERE domestic_shipping_php IS NULL OR domestic_shipping_php = 0" },
    { sql: "UPDATE batches SET other_cost_php = 0 WHERE other_cost_php IS NULL" },
    { sql: "UPDATE batches SET local_shipping_php = domestic_shipping_php WHERE local_shipping_php IS NULL OR local_shipping_php = 0" },
    { sql: "UPDATE batches SET other_costs_php = other_cost_php WHERE other_costs_php IS NULL OR other_costs_php = 0" },
    { sql: "UPDATE batch_items SET unit_weight_kg = 0 WHERE unit_weight_kg IS NULL" },
    // The pricing-safety setting. A settings row written before the column
    // existed lands on the safe 20% default rather than a 0% floor, which would
    // read as "any price is fine".
    {
      sql: `UPDATE settings SET desired_profit_margin_percent = ?
              WHERE desired_profit_margin_percent IS NULL
                 OR desired_profit_margin_percent <= 0
                 OR desired_profit_margin_percent >= 100`,
      args: [DEFAULT_SETTINGS.desired_profit_margin_percent],
    },
    /*
      A ROW WRITTEN BEFORE APPROVAL EXISTED IS BACKFILLED FROM ITS `active`
      FLAG, because that is precisely the queue the desk showed before the
      column existed and an upgrade must not empty the operator's queue: live
      means approved, inactive means pending with its own photo copied across
      so the desk has something to show against the Approve button.
    */
    { sql: "UPDATE storefront_photos SET approval_status = 'approved' WHERE approval_status IS NULL AND active = 1" },
    { sql: "UPDATE storefront_photos SET approval_status = 'pending' WHERE approval_status IS NULL AND active <> 1" },
    {
      sql: `UPDATE storefront_photos SET pending_photo_url = photo_url
              WHERE approval_status = 'pending'
                AND (pending_photo_url IS NULL OR trim(pending_photo_url) = '')`,
    },
  ]);
}

async function seedFreebies() {
  const { rows } = await query("SELECT COUNT(*) AS n FROM freebies");
  if (Number(rows[0]?.n ?? 0) !== 0) return;
  await runBatch(
    SEED_FREEBIES.map((f) => ({
      sql: "INSERT INTO freebies (name, unit_cost, quantity, active) VALUES (?, ?, 0, 1)",
      args: [f.name, f.unit_cost],
    })),
  );
}

const SEED_KEY = "catalog_seed_v1";

async function seedCatalog() {
  const { rows: products } = await query("SELECT id, sku, name, sell_price FROM inventory");
  const byName = new Map(products.map((p) => [norm(p.name), p]));
  const takenSkus = new Set(products.map((p) => String(p.sku || "").toUpperCase()));

  const uniqueSku = (base) => {
    let candidate = base;
    let n = 2;
    while (takenSkus.has(candidate.toUpperCase())) candidate = `${base}-${n++}`;
    takenSkus.add(candidate.toUpperCase());
    return candidate;
  };

  const pending = [];
  for (const item of CATALOG) {
    let row = null;
    for (const alias of namesOf(item)) {
      row = byName.get(norm(alias));
      if (row) break;
    }
    if (!row) {
      pending.push({
        sql: `INSERT INTO inventory (sku, name, category, variant, source_cost_vnd, quantity, reorder_level, notes, unit_cost, sell_price)
              VALUES (?, ?, ?, NULL, 0, 0, ?, NULL, 0, ?)`,
        args: [
          uniqueSku(item.sku),
          item.name,
          item.category || "Paddle",
          item.category === ADDON_CATEGORY ? 0 : 2,
          item.price,
        ],
      });
    } else if (!(M(row.sell_price) > 0)) {
      // Only fills a gap: an edited price is never overwritten.
      pending.push({
        sql: "UPDATE inventory SET sell_price = ? WHERE id = ? AND (sell_price IS NULL OR sell_price <= 0)",
        args: [item.price, row.id],
      });
    }
  }

  await runBatch(pending);

  await query("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)", [
    SEED_KEY,
    new Date().toISOString(),
  ]);
}

/** Every read/write goes through these, so the schema is guaranteed to exist. */
export async function db(sql, args = []) {
  await initDb();
  return query(sql, args);
}

export async function dbBatch(statements) {
  await initDb();
  return runBatch(statements);
}

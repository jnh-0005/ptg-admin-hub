import { describe, expect, it } from "vitest";
import { corsHeaders, createOrder, publicCatalog, publicPhoto, requireApiKey, positiveInt, shipsInText, validEmail } from "./_shared.js";
import { FIRST_INSERT_ID } from "../_db.js";

const DAY_MS = 86_400_000;
const isoDate = (offsetDays) => new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);

const BASE_ORDER_BODY = {
  customer: { name: "Buyer", email: "buyer@example.com", phone: "+639170000000" },
  fulfillment_method: "pickup",
  items: [{ product_id: 1, quantity: 1 }],
  acknowledgment: true,
  payment_proof_url: "data:image/webp;base64,AA==",
};

/**
 * Minimal fake db adapter: canned rows for the one SELECT createOrder runs
 * against inventory, a fake insert id, a no-op batch, and an in-memory
 * simulation of the `api_idempotency` table so the claim/fill/release cycle
 * in createOrder() can be exercised without a real database. `orderInserts`
 * lets a test assert how many times the order-insert path actually ran.
 */
function fakeDb(productQuantity, { idempotency = new Map(), orderInserts = { count: 0 } } = {}) {
  return {
    async query(sql, args = []) {
      if (/api_idempotency/i.test(sql)) {
        if (/^\s*INSERT/i.test(sql)) {
          const [key] = args;
          if (idempotency.has(key)) return { rows: [], affectedRows: 0 };
          idempotency.set(key, null);
          return { rows: [], affectedRows: 1 };
        }
        if (/^\s*SELECT/i.test(sql)) {
          const [key] = args;
          const cached = idempotency.get(key);
          return { rows: cached ? [{ response_json: cached }] : [] };
        }
        if (/^\s*UPDATE/i.test(sql)) {
          const [responseJson, key] = args; // matches `SET response_json = ? WHERE idempotency_key = ?`
          idempotency.set(key, responseJson);
          return { affectedRows: 1 };
        }
        if (/^\s*DELETE/i.test(sql)) {
          const [key] = args;
          idempotency.delete(key);
          return { affectedRows: 1 };
        }
      }
      if (/^\s*SELECT/i.test(sql)) {
        return {
          rows: [
            {
              product_id: 1,
              name: "Sypik Triton 5",
              unit_cost: 0,
              sell_price: 9800,
              product_quantity: productQuantity,
              variant_id: null,
              color: null,
              variant_active: null,
              variant_quantity: null,
              selling_price_php: null,
            },
          ],
        };
      }
      orderInserts.count += 1;
      return { lastInsertId: 1 };
    },
    // Mirrors api/_db.js's real FIRST_INSERT_ID resolution: only the
    // batch's first statement's own lastInsertId is available to the rest —
    // this is what lets a test catch a regression back to two separate
    // db.query()/db.batch() calls (the pre-fix, non-atomic shape) reaching
    // into this fake, since that shape never passes FIRST_INSERT_ID at all.
    async batch(statements) {
      orderInserts.count += 1;
      let firstInsertId = null;
      return statements.map((stmt, i) => {
        for (const arg of stmt.args) {
          if (arg === FIRST_INSERT_ID && firstInsertId === null) {
            throw new Error("FIRST_INSERT_ID referenced before the batch's first insert produced an id");
          }
        }
        if (i === 0) firstInsertId = 1; // simulate the order insert producing id 1
        return { lastInsertId: firstInsertId };
      });
    },
  };
}
let nextKey = 0;
const idempotencyKey = () => `test-key-${(nextKey += 1)}`;

describe("storefront api security helpers", () => {
  it("requires a long server-side bearer key", () => {
    const request = new Request("https://api.example/api/v1/catalog", { headers: { authorization: "Bearer wrong" } });
    expect(requireApiKey(request, { PTG_STOREFRONT_API_KEY: "a".repeat(32) }).status).toBe(401);
    expect(requireApiKey(new Request(request, { headers: { authorization: `Bearer ${"a".repeat(32)}` } }), { PTG_STOREFRONT_API_KEY: "a".repeat(32) })).toBeNull();
  });
  it("only echoes configured cors origins", () => {
    expect(corsHeaders(new Request("https://api.example", { headers: { origin: "https://shop.example" } }), { STOREFRONT_ORIGINS: "https://shop.example" })["access-control-allow-origin"]).toBe("https://shop.example");
    expect(corsHeaders(new Request("https://api.example", { headers: { origin: "https://evil.example" } }), { STOREFRONT_ORIGINS: "https://shop.example" })["access-control-allow-origin"]).toBeUndefined();
  });
  it("keeps validation and photo output bounded", () => {
    expect(validEmail("buyer@example.com")).toBe(true);
    expect(validEmail("not-an-email")).toBe(false);
    expect(positiveInt(1)).toBe(true);
    expect(positiveInt(0)).toBe(false);
    expect(publicPhoto({ photo_url: "javascript:alert(1)" })).toBeNull();
    expect(publicPhoto({ photo_url: "https://cdn.example/paddle.webp" })).toBe("https://cdn.example/paddle.webp");
  });

  // Real bug: a photo taken/picked in the admin's "Manage storefront photos"
  // screen (as opposed to a pasted hosted URL) is stored as a data: URI by
  // src/lib/storefront.js's compactImage() — the admin's own safePhotoUrl
  // accepts that shape and marks it approved, but publicPhoto() only ever
  // accepted https://, /images/, or /assets/, so an uploaded photo silently
  // never reached the storefront even after approval.
  it("accepts an inline data: URI the same shape compactImage() produces", () => {
    const inline = "data:image/webp;base64," + "A".repeat(200);
    expect(publicPhoto({ photo_url: inline })).toBe(inline);
  });

  it("still rejects a data: URI that isn't a real inline image (e.g. an SVG XSS payload)", () => {
    expect(publicPhoto({ photo_url: "data:image/svg+xml;base64,PHNjcmlwdD4=" })).toBeNull();
    expect(publicPhoto({ photo_url: "data:text/html;base64,PHNjcmlwdD4=" })).toBeNull();
  });

  it("rejects an inline photo over the size cap", () => {
    const tooLong = "data:image/webp;base64," + "A".repeat(200_000);
    expect(publicPhoto({ photo_url: tooLong })).toBeNull();
  });
});

describe("createOrder pre-order rule", () => {
  it("allows ordering a paddle with zero stock on hand — every paddle is a pre-order until restocked", async () => {
    const res = await createOrder(fakeDb(0), { ...BASE_ORDER_BODY, items: [{ product_id: 1, quantity: 3 }] }, idempotencyKey());
    expect(res.status).toBe(201);
  });

  it("still caps an order against real stock once a product has some", async () => {
    const res = await createOrder(fakeDb(2), { ...BASE_ORDER_BODY, items: [{ product_id: 1, quantity: 5 }] }, idempotencyKey());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("item_unavailable");
  });

  it("allows an order within real stock once a product has some", async () => {
    const res = await createOrder(fakeDb(2), { ...BASE_ORDER_BODY, items: [{ product_id: 1, quantity: 2 }] }, idempotencyKey());
    expect(res.status).toBe(201);
  });
});

describe("createOrder id-space collision", () => {
  // product_id and variant_id are separate id spaces that both happen to be
  // small sequential integers, so a variant can share its numeric id with an
  // unrelated product (e.g. variant id 1 == some other product's id 1). The
  // query joins inventory to inventory_variants and can return rows for both
  // matches in one result set; the lookup must keep them in separate keyed
  // maps, or the wrong row can silently win and reject (or misprice) a
  // perfectly valid, in-stock item.
  function collidingDb(variantQuantity) {
    return {
      async query(sql, args = []) {
        if (/api_idempotency/i.test(sql)) {
          if (/^\s*INSERT/i.test(sql)) return { rows: [], affectedRows: 1 };
          if (/^\s*SELECT/i.test(sql)) return { rows: [] };
          if (/^\s*UPDATE/i.test(sql) || /^\s*DELETE/i.test(sql)) return { affectedRows: 1 };
        }
        if (/^\s*SELECT/i.test(sql)) {
          return {
            rows: [
              // Unrelated product whose id (1) collides with the requested variant_id below.
              { product_id: 1, name: "Franklin C45 ALW", unit_cost: 0, sell_price: 12500, product_quantity: 5, variant_id: null, color: null, variant_active: null, variant_quantity: null, selling_price_php: null },
              // The actually-requested variant, on a different product (14).
              { product_id: 14, name: "Sypik Triton 5", unit_cost: 0, sell_price: 9800, product_quantity: 0, variant_id: 1, color: "Jade Mist", variant_active: 1, variant_quantity: variantQuantity, selling_price_php: 9800 },
            ],
          };
        }
        return { lastInsertId: 1 };
      },
      async batch(statements) {
        let firstInsertId = null;
        return statements.map((stmt, i) => { if (i === 0) firstInsertId = 1; return { lastInsertId: firstInsertId }; });
      },
    };
  }

  it("orders the requested variant, not an unrelated product whose id happens to match", async () => {
    const res = await createOrder(collidingDb(3), { ...BASE_ORDER_BODY, items: [{ variant_id: 1, quantity: 1 }] }, idempotencyKey());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.order.total_php).toBe(9800); // Sypik Triton 5's price, not Franklin's 12500
  });

  it("still rejects a genuinely inactive variant that happens to share an id with another product", async () => {
    const db = collidingDb(3);
    const originalQuery = db.query.bind(db);
    db.query = async (sql, args) => {
      const result = await originalQuery(sql, args);
      if (Array.isArray(result.rows) && result.rows.some((r) => r.variant_id === 1)) {
        result.rows = result.rows.map((r) => (r.variant_id === 1 ? { ...r, variant_active: 0 } : r));
      }
      return result;
    };
    const res = await createOrder(db, { ...BASE_ORDER_BODY, items: [{ variant_id: 1, quantity: 1 }] }, idempotencyKey());
    expect(res.status).toBe(409);
  });
});

describe("createOrder idempotency", () => {
  it("replays the cached response instead of creating a second order for the same key", async () => {
    const idempotency = new Map();
    const orderInserts = { count: 0 };
    const key = idempotencyKey();
    const first = await createOrder(fakeDb(0, { idempotency, orderInserts }), BASE_ORDER_BODY, key);
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const second = await createOrder(fakeDb(0, { idempotency, orderInserts }), BASE_ORDER_BODY, key);
    expect(second.status).toBe(201);
    const secondBody = await second.json();
    expect(secondBody).toEqual(firstBody);
    // Exactly one INSERT INTO orders ran across both calls — the replay never
    // touched order creation at all.
    expect(orderInserts.count).toBe(1);
  });

  it("rejects a second request for a key that is still in flight, without creating an order", async () => {
    const idempotency = new Map();
    const key = idempotencyKey();
    idempotency.set(key, null); // simulates another request's claim, not yet filled
    const res = await createOrder(fakeDb(0, { idempotency }), BASE_ORDER_BODY, key);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("request_in_progress");
  });

  it("releases the claim on a failed order so the same key can be retried after the request is fixed", async () => {
    const idempotency = new Map();
    const key = idempotencyKey();
    const first = await createOrder(fakeDb(2, { idempotency }), { ...BASE_ORDER_BODY, items: [{ product_id: 1, quantity: 5 }] }, key);
    expect(first.status).toBe(409); // real stock exceeded → item_unavailable, not the idempotency 409
    const firstBody = await first.json();
    expect(firstBody.error.code).toBe("item_unavailable");
    expect(idempotency.has(key)).toBe(false); // claim was released, not left dangling

    const retry = await createOrder(fakeDb(0, { idempotency }), { ...BASE_ORDER_BODY, items: [{ product_id: 1, quantity: 1 }] }, key);
    expect(retry.status).toBe(201);
  });
});

describe("shipsInText", () => {
  it("rounds a real future expected_arrival to whole weeks", () => {
    expect(shipsInText(isoDate(21))).toBe("Ships in ~3 weeks");
    expect(shipsInText(isoDate(7))).toBe("Ships in ~1 week");
  });
  it("never reports a negative or zero week count", () => {
    expect(shipsInText(isoDate(-5))).toBe("Shipping soon");
    expect(shipsInText(isoDate(0))).toBe("Shipping soon");
  });
  it("returns null for a missing or invalid date rather than guessing", () => {
    expect(shipsInText(null)).toBeNull();
    expect(shipsInText("not-a-date")).toBeNull();
  });
});

describe("publicCatalog preorder info", () => {
  /** Routes each query by table name, like the fakeDb above but for the read side. */
  function catalogDb({ products, variants, photos = [], batchRows = [] }) {
    return {
      async query(sql) {
        if (/FROM inventory_variants/i.test(sql)) return { rows: variants };
        if (/FROM inventory i/i.test(sql)) return { rows: products };
        if (/FROM storefront_photos/i.test(sql)) return { rows: photos };
        if (/FROM batch_items/i.test(sql)) return { rows: batchRows };
        return { rows: [] };
      },
    };
  }

  it("attaches preorder info only to unavailable products/variants, never in-stock ones", async () => {
    const catalog = await publicCatalog(
      catalogDb({
        products: [{ id: 1, name: "Franklin C45 ALW", sku: "PTG-C45", category: "Paddle", sell_price: 12500, photo_url: null, availability: "unavailable" }],
        variants: [],
        batchRows: [{ product_id: 1, variant_id: null, expected_arrival: isoDate(21), preorder_cutoff_date: isoDate(5) }],
      }),
    );
    const [product] = catalog.products;
    expect(product.availability).toBe("unavailable");
    expect(product.preorder).toEqual({ ships_in: "Ships in ~3 weeks", ready_date: isoDate(21), cutoff_date: isoDate(5) });
  });

  it("picks the soonest-arriving open batch when more than one carries the item", async () => {
    const catalog = await publicCatalog(
      catalogDb({
        products: [{ id: 1, name: "Franklin C45 ALW", sku: "PTG-C45", category: "Paddle", sell_price: 12500, photo_url: null, availability: "unavailable" }],
        variants: [{ id: 10, inventory_id: 1, color: "Red", sku: null, selling_price_php: 0, photo_url: null, availability: "unavailable" }],
        batchRows: [
          { product_id: 1, variant_id: 10, expected_arrival: isoDate(40), preorder_cutoff_date: null },
          { product_id: 1, variant_id: 10, expected_arrival: isoDate(10), preorder_cutoff_date: null },
        ],
      }),
    );
    expect(catalog.products[0].variants[0].preorder.ready_date).toBe(isoDate(10));
  });

  it("gives no preorder info when nothing real is on file, never a guess", async () => {
    const catalog = await publicCatalog(
      catalogDb({
        products: [{ id: 1, name: "Franklin C45 ALW", sku: "PTG-C45", category: "Paddle", sell_price: 12500, photo_url: null, availability: "unavailable" }],
        variants: [],
        batchRows: [{ product_id: 1, variant_id: null, expected_arrival: null, preorder_cutoff_date: null }],
      }),
    );
    expect(catalog.products[0].preorder).toBeNull();
  });

  it("never attaches preorder info to an item that's actually in stock", async () => {
    const catalog = await publicCatalog(
      catalogDb({
        products: [{ id: 1, name: "Franklin C45 ALW", sku: "PTG-C45", category: "Paddle", sell_price: 12500, photo_url: null, availability: "available" }],
        variants: [],
        batchRows: [{ product_id: 1, variant_id: null, expected_arrival: isoDate(21), preorder_cutoff_date: null }],
      }),
    );
    expect(catalog.products[0].preorder).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { corsHeaders, createOrder, publicPhoto, requireApiKey, positiveInt, validEmail } from "./_shared.js";

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
    async batch() {
      return [{}];
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

import { describe, expect, it } from "vitest";
import { corsHeaders, createOrder, publicPhoto, requireApiKey, positiveInt, validEmail } from "./_shared.js";

const BASE_ORDER_BODY = {
  customer: { name: "Buyer", email: "buyer@example.com", phone: "+639170000000" },
  fulfillment_method: "pickup",
  items: [{ product_id: 1, quantity: 1 }],
  acknowledgment: true,
  payment_proof_url: "data:image/webp;base64,AA==",
};

/** Minimal fake db adapter: canned rows for the one SELECT createOrder runs, a fake insert id, and a no-op batch. */
function fakeDb(productQuantity) {
  return {
    async query(sql) {
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
      return { lastInsertId: 1 };
    },
    async batch() {
      return [{}];
    },
  };
}

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
    const res = await createOrder(fakeDb(0), { ...BASE_ORDER_BODY, items: [{ product_id: 1, quantity: 3 }] });
    expect(res.status).toBe(201);
  });

  it("still caps an order against real stock once a product has some", async () => {
    const res = await createOrder(fakeDb(2), { ...BASE_ORDER_BODY, items: [{ product_id: 1, quantity: 5 }] });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("item_unavailable");
  });

  it("allows an order within real stock once a product has some", async () => {
    const res = await createOrder(fakeDb(2), { ...BASE_ORDER_BODY, items: [{ product_id: 1, quantity: 2 }] });
    expect(res.status).toBe(201);
  });
});

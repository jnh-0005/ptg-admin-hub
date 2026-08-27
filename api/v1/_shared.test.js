import { describe, expect, it } from "vitest";
import { corsHeaders, publicPhoto, requireApiKey, positiveInt, validEmail } from "./_shared.js";

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

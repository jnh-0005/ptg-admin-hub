/**
 * api/v1/catalog.js and api/v1/orders.js are written against the plain Fetch
 * standard (Request in, Response out) per docs/storefront-api-v1.md, not
 * Vercel's Node.js (req, res) convention. Node 18+ has global Request/
 * Response/Headers, so this just bridges the two shapes rather than
 * rewriting the handlers.
 */
export function nodeToWeb(req) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(", "));
    else if (typeof value === "string") headers.set(key, value);
  }

  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
    headers.set("content-length", String(Buffer.byteLength(body)));
  }

  return new Request(url, { method: req.method, headers, body });
}

export async function webToNode(webResponse, res) {
  res.status(webResponse.status);
  webResponse.headers.forEach((value, key) => {
    // Node sets these itself; forwarding them again can throw.
    if (key === "content-length" || key === "connection") return;
    res.setHeader(key, value);
  });
  const text = await webResponse.text();
  res.end(text);
}

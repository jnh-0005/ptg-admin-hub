import { corsHeaders, json, options, rateLimit, readJson, createOrder } from "./_shared.js";
import { nodeToWeb, webToNode } from "./_node-adapter.js";
import { webDbAdapter } from "../_db.js";

// No requireApiKey here — see catalog.js for why a bearer key baked into the
// public bundle wouldn't be a real boundary for a same-origin storefront.
// createOrder() below is the actual boundary: it re-reads live prices and
// availability server-side, ignores anything the client claims about cost,
// and can only ever INSERT a new Pending order — never read, modify, or
// delete existing data. Idempotency-Key + rate limiting handle abuse.
export async function POST(request, env, db) {
  const headers = corsHeaders(request, env);
  const limited = rateLimit(request, env, 10);
  if (limited) return withHeaders(limited, headers);
  const idempotency = String(request.headers.get("idempotency-key") || "").trim();
  if (!/^[A-Za-z0-9._-]{8,100}$/.test(idempotency)) return withHeaders(json(400, { error: { code: "idempotency_key_required", message: "a valid idempotency-key header is required" } }), headers);
  try {
    const body = await readJson(request);
    const response = await createOrder(db, body, idempotency);
    return withHeaders(response, headers);
  } catch (error) {
    const status = error.message === "body_too_large" ? 413 : 400;
    return withHeaders(json(status, { error: { code: status === 413 ? "body_too_large" : "invalid_json", message: status === 413 ? "request body is too large" : "request body must be valid json" } }), headers);
  }
}

export function OPTIONS(request, env) { return options(request, env); }
function withHeaders(response, headers) { Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value)); return response; }

export default async function handler(req, res) {
  const request = nodeToWeb(req);
  const env = process.env;
  const response = req.method === "OPTIONS" ? OPTIONS(request, env) : await POST(request, env, webDbAdapter());
  await webToNode(response, res);
}

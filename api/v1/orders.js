import { corsHeaders, json, options, rateLimit, requireApiKey, readJson, createOrder } from "./_shared.js";

export async function POST(request, env, db) {
  const headers = corsHeaders(request, env);
  const limited = rateLimit(request, env, 10);
  if (limited) return withHeaders(limited, headers);
  const auth = requireApiKey(request, env);
  if (auth) return withHeaders(auth, headers);
  const idempotency = String(request.headers.get("idempotency-key") || "").trim();
  if (!/^[A-Za-z0-9._-]{8,100}$/.test(idempotency)) return withHeaders(json(400, { error: { code: "idempotency_key_required", message: "a valid idempotency-key header is required" } }), headers);
  try {
    const body = await readJson(request);
    const response = await createOrder(db, body);
    return withHeaders(response, headers);
  } catch (error) {
    const status = error.message === "body_too_large" ? 413 : 400;
    return withHeaders(json(status, { error: { code: status === 413 ? "body_too_large" : "invalid_json", message: status === 413 ? "request body is too large" : "request body must be valid json" } }), headers);
  }
}

export function OPTIONS(request, env) { return options(request, env); }
function withHeaders(response, headers) { Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value)); return response; }

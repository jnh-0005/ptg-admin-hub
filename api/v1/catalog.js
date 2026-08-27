import { corsHeaders, json, options, rateLimit, requireApiKey, publicCatalog } from "./_shared.js";

export async function GET(request, env, db) {
  const headers = corsHeaders(request, env);
  const limited = rateLimit(request, env, 60);
  if (limited) return withHeaders(limited, headers);
  const auth = requireApiKey(request, env);
  if (auth) return withHeaders(auth, headers);
  try {
    return withHeaders(json(200, await publicCatalog(db), { "cache-control": "public, max-age=60" }), headers);
  } catch {
    return withHeaders(json(503, { error: { code: "catalog_unavailable", message: "catalog temporarily unavailable" } }), headers);
  }
}

export function OPTIONS(request, env) { return options(request, env); }
function withHeaders(response, headers) { Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value)); return response; }

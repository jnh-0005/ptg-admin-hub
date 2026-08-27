import { corsHeaders, json, options, rateLimit, publicCatalog } from "./_shared.js";
import { nodeToWeb, webToNode } from "./_node-adapter.js";
import { webDbAdapter } from "../_db.js";

// No requireApiKey here on purpose: this storefront and this API share one
// origin (no separate storefront domain), so a bearer key would have to be
// baked into the public client bundle anyway — it would gate nothing a
// browser devtools Network tab couldn't defeat in ten seconds. publicCatalog()
// itself is the real boundary: it only ever returns customer-safe fields
// (see _shared.js), and rateLimit below is the actual abuse guard.
export async function GET(request, env, db) {
  const headers = corsHeaders(request, env);
  const limited = rateLimit(request, env, 60);
  if (limited) return withHeaders(limited, headers);
  try {
    return withHeaders(json(200, await publicCatalog(db), { "cache-control": "public, max-age=60" }), headers);
  } catch (err) {
    console.error("catalog_unavailable:", err);
    return withHeaders(json(503, { error: { code: "catalog_unavailable", message: "catalog temporarily unavailable" } }), headers);
  }
}

export function OPTIONS(request, env) { return options(request, env); }
function withHeaders(response, headers) { Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value)); return response; }

export default async function handler(req, res) {
  const request = nodeToWeb(req);
  const env = process.env;
  const response = req.method === "OPTIONS" ? OPTIONS(request, env) : await GET(request, env, webDbAdapter());
  await webToNode(response, res);
}

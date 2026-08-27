import { createClient } from "@supabase/supabase-js";

let client;

function getClient() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY are not set");
    }
    client = createClient(url, anonKey);
  }
  return client;
}

/**
 * Every request to /api/query must carry a live Supabase session — this is
 * the only thing standing between the internet and the whole ledger, since
 * the database itself has no other access control in front of it.
 */
export async function requireUser(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw new Error("missing bearer token");

  const { data, error } = await getClient().auth.getUser(token);
  if (error || !data?.user) throw new Error("invalid session");
  return data.user;
}

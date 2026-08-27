import { runStatements } from "./_db.js";
import { requireUser } from "./_auth.js";

/**
 * Stands in for folk's __folkdata/query transport, backed by Supabase
 * Postgres instead of a hosted SQLite file. Same statements/results
 * contract as src/lib/folkdb.js expects, gated behind a Supabase-authenticated
 * session — unlike the original transport, which had none.
 */
export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  try {
    await requireUser(req);
  } catch (err) {
    console.error("unauthorized:", err);
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const { statements } = req.body || {};
  if (!Array.isArray(statements) || statements.length === 0 || statements.length > 10) {
    res.status(400).json({ error: "statements must be an array of 1 to 10 entries" });
    return;
  }
  for (const s of statements) {
    if (typeof s?.sql !== "string" || !s.sql.trim()) {
      res.status(400).json({ error: "each statement needs a sql string" });
      return;
    }
  }

  try {
    const results = await runStatements(statements);
    res.status(200).json({ results });
  } catch (err) {
    res.status(400).json({ error: err.message || "database error" });
  }
}

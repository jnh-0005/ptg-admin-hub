/**
 * folkdb, shared SQLite database for this app, hosted by folk.
 *
 * Every visitor of this app talks to the SAME database, so data written by
 * one person is visible to everyone (guestbooks, RSVPs, leaderboards...).
 * The endpoint lives on this app's own origin, no API keys, no CORS.
 *
 * Usage:
 *   import { query, batch } from "./lib/folkdb";
 *   await query("CREATE TABLE IF NOT EXISTS entries (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)");
 *   await query("INSERT INTO entries (name, note) VALUES (?, ?)", ["alice", "hi!"]);
 *   const { rows } = await query("SELECT * FROM entries ORDER BY id DESC");
 *   // rows are objects keyed by column name: [{ id: 1, name: "alice", ... }]
 */

// Resolves correctly on both <slug>.folk.com/ and /apphost/<slug>/
// because the served index.html always carries a <base href> tag.
const ENDPOINT = new URL("__folkdata/query", document.baseURI).toString();

async function send(statements) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ statements }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `database request failed (${res.status})`);
  }
  return data.results.map((r) => {
    if (!r.ok) throw new Error(r.error || "database error");
    const rows = r.rows.map((row) =>
      Object.fromEntries(r.cols.map((c, i) => [c, row[i]])),
    );
    return {
      rows,
      affectedRows: r.affected_row_count,
      lastInsertId: r.last_insert_rowid,
    };
  });
}

/**
 * Run one SQL statement. Use `?` placeholders with `args` for any value that
 * comes from user input, never string-interpolate values into the SQL.
 * Returns { rows, affectedRows, lastInsertId }.
 */
export async function query(sql, args = []) {
  const [result] = await send([{ sql, args }]);
  return result;
}

/**
 * Run several statements in one round trip (max 10). Each entry is
 * { sql, args? }. Returns an array of results in the same order.
 */
export async function batch(statements) {
  return send(statements);
}

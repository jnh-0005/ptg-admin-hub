/**
 * Database transport for this app, backed by Supabase Postgres through the
 * /api/query serverless function (api/query.js). Originally this posted to
 * folk's hosted __folkdata/query endpoint; the query/batch contract below is
 * unchanged so nothing above this file needed to know the backend moved.
 *
 * Every request carries the signed-in operator's Supabase session token —
 * the API rejects anything without one, since this is the only access
 * control the database has.
 */
import { supabase } from "./supabaseAuth";

const ENDPOINT = "/api/query";

async function send(statements) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify({ statements }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) await supabase.auth.signOut();
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
 * Run several statements in one round trip (max 10), inside one transaction.
 * Each entry is { sql, args? }. Returns an array of results in the same order.
 */
export async function batch(statements) {
  return send(statements);
}

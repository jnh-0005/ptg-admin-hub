import pg from "pg";

let pool;

/**
 * One pooled Postgres connection for this function's lifetime. Use the
 * Supabase "Transaction pooler" (port 6543) connection string in
 * DATABASE_URL — Vercel functions are short-lived and many of them can run
 * at once, so a direct (port 5432) connection string will exhaust Postgres's
 * connection limit under real traffic.
 */
function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    pool = new pg.Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}

/**
 * `?` -> `$1, $2, ...`, the way this app's SQLite-shaped queries expect,
 * skipping anything inside a single-quoted string literal.
 */
function convertPlaceholders(sql) {
  let out = "";
  let n = 0;
  let inString = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") inString = !inString;
    if (ch === "?" && !inString) {
      n += 1;
      out += `$${n}`;
    } else {
      out += ch;
    }
  }
  return out;
}

// Tables whose primary key isn't `id` (or that never need lastInsertId).
// Auto-RETURNING is skipped for these.
const NO_ID_RETURNING = new Set(["app_meta", "api_idempotency"]);

// Conflict targets for the two INSERT OR IGNORE/REPLACE call sites this app
// has (src/lib/schema.js). Hardcoded because there are exactly two, both
// known — not a generic SQL parser.
const CONFLICT_TARGET = { settings: "id", app_meta: "key" };

/**
 * This app's SQL was written for SQLite (folk's hosted transport). Every
 * construct here that Postgres doesn't understand was found by auditing the
 * full source tree (schema.js, data.js, PublicCatalog.jsx) — this is a
 * closed, enumerated list, not a generic dialect converter. Anything not
 * matched here is assumed to already be portable SQL.
 */
export function translateDialect(sql) {
  let out = sql;

  // id INTEGER PRIMARY KEY AUTOINCREMENT -> id SERIAL PRIMARY KEY
  out = out.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, "SERIAL PRIMARY KEY");

  // Every CURRENT_TIMESTAMP in this app targets a TEXT column (default value
  // or assignment) — Postgres needs the timestamptz cast to text explicitly.
  out = out.replace(/CURRENT_TIMESTAMP(?!::)/gi, "CURRENT_TIMESTAMP::text");

  // date(created_at) — created_at is TEXT here, needs an explicit cast for
  // Postgres to resolve which date() overload applies.
  out = out.replace(/\bdate\(created_at\)/gi, "date(created_at::timestamptz)");

  // SQLite's case-insensitive ORDER BY collation; only ever wraps a single
  // bare column reference in this codebase.
  out = out.replace(/(\w+)\s+COLLATE\s+NOCASE/gi, "LOWER($1)");

  // The one legacy order-number backfill using SQLite's negative substr().
  out = out.replace(/substr\('000' \|\| id, -3\)/gi, "RIGHT('000' || id::text, 3)");

  // Postgres requires WHERE to be boolean; SQLite treats bare 0/1 as false/true.
  out = out.replace(/\bWHERE\s+0\b/gi, "WHERE FALSE");
  out = out.replace(/\bWHERE\s+1\b/gi, "WHERE TRUE");

  // INSERT OR IGNORE INTO settings (...) -> INSERT INTO settings (...) ON CONFLICT (id) DO NOTHING
  if (/^\s*INSERT OR IGNORE INTO settings\b/i.test(sql)) {
    out = out.replace(/INSERT OR IGNORE INTO/i, "INSERT INTO");
    out += ` ON CONFLICT (${CONFLICT_TARGET.settings}) DO NOTHING`;
  }

  // INSERT OR REPLACE INTO app_meta (key, value) VALUES (...) -> upsert on key
  const replaceMatch = sql.match(/INSERT OR REPLACE INTO (\w+)\s*\(([^)]+)\)/i);
  if (replaceMatch) {
    const [, table, colsRaw] = replaceMatch;
    const cols = colsRaw.split(",").map((c) => c.trim());
    const pk = CONFLICT_TARGET[table] || cols[0];
    const updates = cols
      .filter((c) => c !== pk)
      .map((c) => `${c} = EXCLUDED.${c}`)
      .join(", ");
    out = out.replace(/INSERT OR REPLACE INTO/i, "INSERT INTO");
    out += ` ON CONFLICT (${pk}) DO UPDATE SET ${updates}`;
  }

  return out;
}

const PRAGMA_TABLE_INFO = /^\s*PRAGMA\s+table_info\((\w+)\)\s*;?\s*$/i;

async function execOne(client, { sql, args = [] }) {
  const pragma = PRAGMA_TABLE_INFO.exec(sql.trim());

  let finalSql;
  let finalArgs;
  if (pragma) {
    finalSql =
      "SELECT column_name AS name FROM information_schema.columns " +
      "WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position";
    finalArgs = [pragma[1]];
  } else {
    let translated = translateDialect(sql);
    const insertMatch = /^\s*INSERT\s+INTO\s+(\w+)/i.exec(translated);
    if (
      insertMatch &&
      !/\bRETURNING\b/i.test(translated) &&
      !NO_ID_RETURNING.has(insertMatch[1].toLowerCase())
    ) {
      translated += " RETURNING id";
    }
    finalSql = convertPlaceholders(translated);
    finalArgs = args;
  }

  const result = await client.query(finalSql, finalArgs);
  const cols = (result.fields || []).map((f) => f.name);
  const rows = result.rows.map((row) => cols.map((c) => row[c]));
  const lastRow = result.rows[result.rows.length - 1];

  return {
    ok: true,
    cols,
    rows,
    affected_row_count: result.rowCount ?? 0,
    last_insert_rowid: lastRow && "id" in lastRow ? lastRow.id : null,
  };
}

/**
 * Runs every statement in one transaction — a real ACID boundary the
 * original folk-hosted transport never had (the project handoff flagged
 * this as an open item). Any single statement failing rolls back the whole
 * batch instead of leaving a half-written order.
 */
export async function runStatements(statements) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const results = [];
    for (const stmt of statements) {
      results.push(await execOne(client, stmt));
    }
    await client.query("COMMIT");
    return results;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

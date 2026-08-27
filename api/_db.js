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

  // Same problem, same fix: api/v1/_shared.js writes CURRENT_DATE into the
  // TEXT order_date column.
  out = out.replace(/CURRENT_DATE(?!::)/gi, "CURRENT_DATE::text");

  // date(created_at) — created_at is TEXT here, needs an explicit cast for
  // Postgres to resolve which date() overload applies.
  out = out.replace(/\bdate\(created_at\)/gi, "date(created_at::timestamptz)");

  // SQLite's case-insensitive ORDER BY collation, wrapping either a bare
  // column (name COLLATE NOCASE) or an alias-qualified one (i.name COLLATE
  // NOCASE) — the latter appears in api/v1/_shared.js's joined queries.
  // \w+ alone would only grab "name" and leave a stray "i." in front of the
  // LOWER(...) call, producing invalid SQL.
  out = out.replace(/((?:\w+\.)?\w+)\s+COLLATE\s+NOCASE/gi, "LOWER($1)");

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
 * batch instead of leaving a half-written order. That guarantee only covers
 * statements passed to a single `db.batch()` call, though — see
 * FIRST_INSERT_ID below for how a caller gets an order-insert-then-
 * dependent-line-inserts sequence into one such call.
 */
/**
 * Placeholder a caller can put in a later statement's `args` inside one
 * `db.batch()` call to mean "the row id the batch's first INSERT
 * generated." Needed because order line items depend on the order row's id,
 * but that id doesn't exist until the order INSERT itself runs — without
 * this, the order insert and its line inserts would have to be two separate
 * `runStatements` calls (two separate transactions), which is exactly the
 * gap the ACID-boundary comment above used to overstate: it was true of any
 * one batch call, but createOrder (api/v1/_shared.js) used to make two,
 * leaving a real window where an order could commit with zero line items if
 * the process died between them. Resolved only against the FIRST insert in
 * the batch (not a running "previous statement" pointer), because that's
 * the one dependency this app actually has — an order id, referenced by
 * every one of its line items, never a chain of inserts each depending on
 * the one before it.
 */
export const FIRST_INSERT_ID = Symbol("db.first-insert-id");

/**
 * The `db.query(sql, args)` / `db.batch(statements)` shape api/v1/_shared.js
 * expects — rows as objects keyed by column name, same as folkdb.js gives
 * the browser. Thin wrapper over runStatements so the v1 handlers (written
 * against that contract, per docs/storefront-api-v1.md) can run unmodified.
 */
export function webDbAdapter() {
  const toObjectRows = (result) => ({
    rows: result.rows.map((row) => Object.fromEntries(result.cols.map((c, i) => [c, row[i]]))),
    lastInsertId: result.last_insert_rowid,
    affectedRows: result.affected_row_count,
  });
  return {
    async query(sql, args = []) {
      const [result] = await runStatements([{ sql, args }]);
      return toObjectRows(result);
    },
    async batch(statements) {
      const results = await runStatements(statements);
      return results.map(toObjectRows);
    },
  };
}

export async function runStatements(statements) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const results = [];
    let firstInsertId = null;
    for (const stmt of statements) {
      const args = (stmt.args || []).map((a) => (a === FIRST_INSERT_ID ? firstInsertId : a));
      const result = await execOne(client, { sql: stmt.sql, args });
      if (firstInsertId === null && result.last_insert_rowid != null) firstInsertId = result.last_insert_rowid;
      results.push(result);
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

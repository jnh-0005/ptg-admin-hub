import { describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = "postgres://fake-for-tests";

// A fake pg.Pool: every "INSERT" returns a fresh incrementing id via a fake
// RETURNING id, everything else (BEGIN/COMMIT/ROLLBACK/other) returns
// nothing. Records every statement so tests can assert what runStatements
// actually sent to the "database".
const queries = [];
let nextFakeId = 0;
vi.mock("pg", () => ({
  default: {
    Pool: class {
      async connect() {
        return {
          async query(sql, args) {
            queries.push({ sql, args });
            if (/^\s*INSERT/i.test(sql)) {
              nextFakeId += 1;
              return { rows: [{ id: nextFakeId }], fields: [{ name: "id" }], rowCount: 1 };
            }
            return { rows: [], fields: [], rowCount: 0 };
          },
          release() {},
        };
      }
    },
  },
}));

const { translateDialect, runStatements, FIRST_INSERT_ID } = await import("./_db.js");

describe("SQLite -> Postgres dialect translation", () => {
  it("turns AUTOINCREMENT primary keys into SERIAL", () => {
    expect(translateDialect("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)")).toBe(
      "CREATE TABLE t (id SERIAL PRIMARY KEY, name TEXT)",
    );
  });

  it("casts CURRENT_TIMESTAMP for TEXT columns, in DDL defaults and assignments", () => {
    expect(translateDialect("created_at TEXT DEFAULT CURRENT_TIMESTAMP")).toBe(
      "created_at TEXT DEFAULT CURRENT_TIMESTAMP::text",
    );
    expect(translateDialect("UPDATE x SET updated_at = CURRENT_TIMESTAMP WHERE id = ?")).toBe(
      "UPDATE x SET updated_at = CURRENT_TIMESTAMP::text WHERE id = ?",
    );
    // Already cast — must not double-cast.
    expect(translateDialect("CURRENT_TIMESTAMP::text")).toBe("CURRENT_TIMESTAMP::text");
  });

  it("casts CURRENT_DATE the same way, for the same reason", () => {
    expect(translateDialect("INSERT INTO orders (order_date) VALUES (CURRENT_DATE)")).toBe(
      "INSERT INTO orders (order_date) VALUES (CURRENT_DATE::text)",
    );
  });

  it("casts date(created_at) since created_at is stored as TEXT", () => {
    expect(translateDialect("SELECT date(created_at) FROM orders")).toBe(
      "SELECT date(created_at::timestamptz) FROM orders",
    );
  });

  it("replaces SQLite's NOCASE collation with LOWER()", () => {
    expect(translateDialect("SELECT * FROM inventory ORDER BY name COLLATE NOCASE")).toBe(
      "SELECT * FROM inventory ORDER BY LOWER(name)",
    );
    expect(translateDialect("ORDER BY identity_type ASC, identity_key COLLATE NOCASE ASC")).toBe(
      "ORDER BY identity_type ASC, LOWER(identity_key) ASC",
    );
  });

  it("keeps a table alias intact on a qualified column (i.name COLLATE NOCASE)", () => {
    expect(translateDialect("SELECT * FROM inventory i ORDER BY i.name COLLATE NOCASE")).toBe(
      "SELECT * FROM inventory i ORDER BY LOWER(i.name)",
    );
  });

  it("rewrites the legacy order-number substr backfill", () => {
    expect(
      translateDialect("UPDATE orders SET order_number = 'PB-' || substr('000' || id, -3)"),
    ).toBe("UPDATE orders SET order_number = 'PB-' || RIGHT('000' || id::text, 3)");
  });

  it("turns bare WHERE 0 / WHERE 1 into proper booleans", () => {
    expect(translateDialect("SELECT NULL WHERE 0")).toBe("SELECT NULL WHERE FALSE");
    expect(translateDialect("SELECT NULL WHERE 1")).toBe("SELECT NULL WHERE TRUE");
  });

  it("turns INSERT OR IGNORE INTO settings into an ON CONFLICT DO NOTHING upsert", () => {
    const sql = "INSERT OR IGNORE INTO settings (id, php_to_vnd_rate) VALUES (1, ?)";
    expect(translateDialect(sql)).toBe(
      "INSERT INTO settings (id, php_to_vnd_rate) VALUES (1, ?) ON CONFLICT (id) DO NOTHING",
    );
  });

  it("turns INSERT OR REPLACE INTO app_meta into an ON CONFLICT DO UPDATE upsert", () => {
    const sql = "INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)";
    expect(translateDialect(sql)).toBe(
      "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    );
  });

  it("leaves ordinary portable SQL untouched", () => {
    const sql = "SELECT id, name FROM inventory WHERE quantity > ? ORDER BY id DESC LIMIT 10";
    expect(translateDialect(sql)).toBe(sql);
  });
});

describe("runStatements / FIRST_INSERT_ID", () => {
  it("resolves FIRST_INSERT_ID to the batch's first insert id, in every later statement", async () => {
    queries.length = 0;
    const results = await runStatements([
      { sql: "INSERT INTO orders (a) VALUES (?)", args: [1] },
      { sql: "INSERT INTO order_items (order_id) VALUES (?)", args: [FIRST_INSERT_ID] },
      { sql: "INSERT INTO order_items (order_id) VALUES (?)", args: [FIRST_INSERT_ID] },
    ]);
    const orderId = results[0].last_insert_rowid;
    // Each order_items row got its own new id (order id + 1, + 2, ...) from
    // the fake, proving FIRST_INSERT_ID is NOT "the previous statement's id"
    // — if it were, the second order_items insert would have received the
    // first order_items row's id instead of the order's.
    expect(results[1].last_insert_rowid).toBe(orderId + 1);
    expect(results[2].last_insert_rowid).toBe(orderId + 2);
    const itemQueries = queries.filter((q) => q.sql.includes("order_items"));
    expect(itemQueries[0].args).toEqual([orderId]);
    expect(itemQueries[1].args).toEqual([orderId]);
  });

  it("rolls back the whole batch when a later statement fails, never committing a partial order", async () => {
    queries.length = 0;
    const client = {
      calls: [],
      async query(sql) {
        client.calls.push(sql);
        if (/^\s*INSERT INTO order_items/i.test(sql)) throw new Error("simulated failure");
        if (/^\s*INSERT/i.test(sql)) return { rows: [{ id: 999 }], fields: [{ name: "id" }], rowCount: 1 };
        return { rows: [], fields: [], rowCount: 0 };
      },
      release: vi.fn(),
    };
    const pg = await import("pg");
    const originalConnect = pg.default.Pool.prototype.connect;
    pg.default.Pool.prototype.connect = async () => client;
    try {
      await expect(
        runStatements([
          { sql: "INSERT INTO orders (a) VALUES (?)", args: [1] },
          { sql: "INSERT INTO order_items (order_id) VALUES (?)", args: [FIRST_INSERT_ID] },
        ]),
      ).rejects.toThrow("simulated failure");
      expect(client.calls).toContain("ROLLBACK");
      expect(client.calls).not.toContain("COMMIT");
    } finally {
      pg.default.Pool.prototype.connect = originalConnect;
    }
  });
});

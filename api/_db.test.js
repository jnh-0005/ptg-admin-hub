import { describe, expect, it } from "vitest";
import { translateDialect } from "./_db.js";

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

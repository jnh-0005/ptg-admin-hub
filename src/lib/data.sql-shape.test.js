import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Guards against the exact bug found and fixed in saveBatch()'s new-batch
 * INSERT: a VALUES clause with one more entry than the column list had
 * columns (28 values, 27 columns) — invalid SQL Postgres rejects outright
 * ("INSERT has more expressions than target columns"), which meant creating
 * a brand-new batch had never actually worked. There's no live-db test
 * harness for data.js (it talks to Postgres through folkdb's fetch
 * transport), so this checks the SQL text itself: every `INSERT INTO
 * <table> (cols) VALUES (...)` in the file must have exactly as many
 * comma-separated values in its VALUES tuple as it has columns — a value
 * can be a `?` placeholder or a literal (`0`, `'pending'`,
 * `CURRENT_TIMESTAMP`), both count.
 */
const source = readFileSync(fileURLToPath(new URL("./data.js", import.meta.url)), "utf8");

function findInsertStatements(text) {
  const found = [];
  const re = /INSERT INTO (\w+)\s*\(([^)]+)\)\s*(?:\r?\n\s*)?VALUES\s*\(([^)]+)\)/g;
  let match;
  while ((match = re.exec(text))) {
    const [, table, colsRaw, valsRaw] = match;
    found.push({
      table,
      columnCount: colsRaw.split(",").length,
      valueCount: valsRaw.split(",").length,
    });
  }
  return found;
}

describe("data.js INSERT statements: column count matches VALUES tuple arity", () => {
  const statements = findInsertStatements(source);

  it("found at least the known INSERT statements (sanity check the parser itself)", () => {
    expect(statements.length).toBeGreaterThanOrEqual(5);
  });

  for (const { table, columnCount, valueCount } of statements) {
    it(`INSERT INTO ${table}: ${columnCount} columns, ${valueCount} values`, () => {
      expect(valueCount).toBe(columnCount);
    });
  }
});

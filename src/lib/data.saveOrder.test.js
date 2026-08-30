import { describe, expect, it, vi } from "vitest";

/**
 * Regression test for a real bug: completing an order (Reserved -> Paid ->
 * Completed) used to write the order's new status as its own separate db
 * write, then resync order_items, then apply the resulting stock delta as
 * YET ANOTHER separate write. If anything after the status write failed,
 * the order was left permanently stuck reporting "Completed" with stock
 * never moved — and unrecoverable by retrying "Complete order" again,
 * because the retry would then already read the order as Completed and
 * compute a zero net delta against itself. Reproduced live: a Sypik
 * Triton 5 (Jade Mist) with exactly 1 unit on hand stayed at quantity 1
 * after being marked Completed.
 *
 * As of the 2026-08-30 "50% deposit is non-refundable" revision, stock
 * moves the instant an order FIRST becomes Paid OR Completed (see
 * STOCK_COMMITTED_STATUSES in calc.js) — not only on Completed. These
 * tests assert that both entry points move stock exactly once, in the
 * same transaction as the status write, and that a later Paid<->Completed
 * transition (already committed either way) never re-moves it.
 *
 * There's no live-db harness for data.js (see data.sql-shape.test.js) — it
 * talks to Postgres through schema.js's db()/dbBatch(). This test mocks
 * that module so it can assert the actual shape of what saveOrder sends:
 * the order's status UPDATE and the resulting stock UPDATE must land in the
 * SAME dbBatch() call (a real transaction — see runStatements in
 * api/_db.js), not two separate ones.
 */

const dbBatchCalls = [];
let priorStatus = "Reserved";

function rowsFor(sql) {
  if (/SELECT status FROM orders/i.test(sql)) return [{ status: priorStatus }];
  if (/SELECT inventory_id AS product_id, variant_id, quantity FROM order_items/i.test(sql)) {
    return [{ product_id: 14, variant_id: 1, quantity: 1 }];
  }
  if (/SELECT freebie_id, quantity FROM order_freebies/i.test(sql)) return [];
  if (/SELECT id, source_cost_vnd FROM inventory/i.test(sql)) return [{ id: 14, source_cost_vnd: 0 }];
  if (/SELECT \* FROM batches/i.test(sql)) return [];
  if (/SELECT \* FROM batch_items/i.test(sql)) return [];
  if (/SELECT php_to_vnd_rate FROM settings/i.test(sql)) return [{ php_to_vnd_rate: 416 }];
  if (/SELECT \* FROM inventory_variants/i.test(sql)) {
    return [{ id: 1, inventory_id: 14, color: "Jade Mist", quantity: 1, active: 1, selling_price_php: 9800, source_cost_vnd: 0 }];
  }
  return [];
}

vi.mock("./schema", () => ({
  db: vi.fn(async () => ({ lastInsertId: 1 })),
  dbBatch: vi.fn(async (statements) => {
    dbBatchCalls.push(statements);
    return statements.map((s) => ({ rows: rowsFor(s.sql), lastInsertId: 1, affectedRows: 1 }));
  }),
  initDb: vi.fn(async () => {}),
}));

const { saveOrder } = await import("./data.js");

const baseOrder = (status) => ({
  id: 1,
  orderRow: {
    order_number: "PB-2026-001",
    order_date: "2026-08-28",
    status,
    payment_requirement: "deposit",
    channel: "Storefront",
  },
  items: [
    {
      product_id: 14,
      variant_id: 1,
      product_name: "Sypik Triton 5 (Jade Mist)",
      quantity: 1,
      sale_price_php: 9800,
      actual_landed_cost_php: 0,
    },
  ],
  freebies: [],
});

function findStatusBatch() {
  return dbBatchCalls.find((statements) => statements.some((s) => /UPDATE orders SET/i.test(s.sql)));
}

describe("saveOrder: stock moves on Paid, not only on Completed", () => {
  it("decrements stock the moment an order first becomes Paid (deposit verified, non-refundable)", async () => {
    priorStatus = "Reserved";
    dbBatchCalls.length = 0;
    const result = await saveOrder(baseOrder("Paid"));

    const statusBatch = findStatusBatch();
    expect(statusBatch).toBeDefined();

    const stockUpdate = statusBatch.find(
      (s) => /UPDATE inventory_variants SET quantity/i.test(s.sql) && s.args.includes(1),
    );
    expect(stockUpdate).toBeDefined();
    expect(stockUpdate.args[0]).toBe(-1); // one unit sold, decremented by 1

    const orderUpdate = statusBatch.find((s) => /UPDATE orders SET/i.test(s.sql));
    expect(orderUpdate.args).toContain("Paid");
    expect(result.stockApplied).toBe(true);
  });

  it("commits the order's status change and the resulting stock decrement in one transaction (Reserved -> Completed)", async () => {
    priorStatus = "Reserved";
    dbBatchCalls.length = 0;
    const result = await saveOrder(baseOrder("Completed"));

    // Find the one dbBatch call that carries the order's own status write —
    // the stock UPDATE for variant 1 must be in that SAME array.
    const completionBatch = findStatusBatch();
    expect(completionBatch).toBeDefined();

    const stockUpdate = completionBatch.find(
      (s) => /UPDATE inventory_variants SET quantity/i.test(s.sql) && s.args.includes(1),
    );
    expect(stockUpdate).toBeDefined();
    expect(stockUpdate.args[0]).toBe(-1); // one unit sold, decremented by 1

    const orderUpdate = completionBatch.find((s) => /UPDATE orders SET/i.test(s.sql));
    expect(orderUpdate.args).toContain("Completed");
    expect(result.stockApplied).toBe(true);
  });

  it("does not re-decrement stock moving Paid -> Completed (already committed either way)", async () => {
    priorStatus = "Paid";
    dbBatchCalls.length = 0;
    const result = await saveOrder(baseOrder("Completed"));

    const anyStockWrite = dbBatchCalls
      .flat()
      .some((s) => /UPDATE inventory_variants SET quantity|UPDATE inventory SET quantity/i.test(s.sql));
    expect(anyStockWrite).toBe(false);
    expect(result.stockApplied).toBe(false);
  });

  it("does not touch stock for a status change that never enters a committed status (e.g. Pending -> Reserved)", async () => {
    priorStatus = "Pending";
    dbBatchCalls.length = 0;
    const result = await saveOrder(baseOrder("Reserved"));

    const anyStockWrite = dbBatchCalls
      .flat()
      .some((s) => /UPDATE inventory_variants SET quantity|UPDATE inventory SET quantity/i.test(s.sql));
    expect(anyStockWrite).toBe(false);
    expect(result.stockApplied).toBe(false);
  });
});

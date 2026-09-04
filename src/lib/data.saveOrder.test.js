import { afterEach, describe, expect, it, vi } from "vitest";

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
// Overridable per test — defaults reproduce the original fixture (1 unit
// on hand, no in-transit batch, no existing claims against one).
let variantQuantity = 1;
let batchScenario = null; // { batches, batchItems, claims }

function rowsFor(sql) {
  if (/SELECT status FROM orders/i.test(sql)) return [{ status: priorStatus }];
  if (/SELECT inventory_id AS product_id, variant_id, quantity FROM order_items/i.test(sql)) {
    return [{ product_id: 14, variant_id: 1, quantity: 1 }];
  }
  if (/SELECT freebie_id, quantity FROM order_freebies/i.test(sql)) return [];
  if (/SELECT id, source_cost_vnd, quantity FROM inventory/i.test(sql)) return [{ id: 14, source_cost_vnd: 0, quantity: 0 }];
  // The claims query, checked first — it also matches the file's own doc
  // comment text "SELECT oi.batch_id" if tested loosely, so anchor on a
  // fragment only that query's SQL contains.
  if (/FROM order_items oi JOIN orders o/i.test(sql)) return batchScenario?.claims || [];
  if (/SELECT \* FROM batches/i.test(sql)) return batchScenario?.batches || [];
  if (/SELECT \* FROM batch_items/i.test(sql)) return batchScenario?.batchItems || [];
  if (/SELECT php_to_vnd_rate FROM settings/i.test(sql)) return [{ php_to_vnd_rate: 416 }];
  if (/SELECT \* FROM inventory_variants/i.test(sql)) {
    return [
      {
        id: 1,
        inventory_id: 14,
        color: "Jade Mist",
        quantity: variantQuantity,
        active: 1,
        selling_price_php: 9800,
        source_cost_vnd: 0,
      },
    ];
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

afterEach(() => {
  variantQuantity = 1;
  batchScenario = null;
});

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

  /**
   * Regression test for a real bug caught live in this session: a pre-order
   * or in-transit colour normally sits at 0 on hand until its batch is
   * physically Received. Marking it Paid BEFORE that receipt (the whole
   * point of paying a deposit ahead of stock arriving) must decrement past
   * zero, not get floored at it — a floor here silently drops the pre-sale,
   * so when the batch is later Received and adds its quantity, the total
   * overcounts by exactly the paddles already sold, and the storefront
   * would offer them to a second buyer. Verified live: Sypik Triton 5
   * (Jade Mist) at 0 on hand read 0 (not -1) after Paid, then read 1 (not
   * 0) after the order was deleted and its stock restored — a unit that
   * was never physically on the shelf.
   */
  it("decrements past zero rather than flooring at it, so a batch Received afterwards nets out correctly", async () => {
    priorStatus = "Reserved";
    dbBatchCalls.length = 0;
    await saveOrder(baseOrder("Paid"));

    const statusBatch = findStatusBatch();
    const stockUpdate = statusBatch.find(
      (s) => /UPDATE inventory_variants SET quantity/i.test(s.sql) && s.args.includes(1),
    );
    expect(stockUpdate.sql).not.toMatch(/MAX\(0/i);
    expect(stockUpdate.sql).toMatch(/quantity\s*=\s*quantity\s*\+\s*\?/i);
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

/**
 * Regression test for a real bug caught live: reserving an in-transit
 * paddle by creating the order directly in the admin (rather than through
 * the storefront checkout) never wrote order_items.batch_id, so the
 * storefront's own "remaining in transit" count (inTransitInfoMaps in
 * api/v1/_shared.js) never saw that reservation — it kept showing the same
 * in-transit stock as available to a second buyer instead of falling back
 * to a plain pre-order once fully claimed. saveOrder now computes the same
 * claim the storefront checkout's buildOrder already does.
 */
function findOrderItemInsert() {
  return dbBatchCalls.flat().find((s) => /INSERT INTO order_items/i.test(s.sql));
}

describe("saveOrder: claims in-transit stock the same way the storefront checkout does", () => {
  it("sets batch_id on a zero-on-hand line when a real in-transit batch has enough remaining", async () => {
    priorStatus = "Pending";
    variantQuantity = 0;
    batchScenario = {
      batches: [{ id: 55, status: "In Transit", expected_arrival: "2026-09-15" }],
      batchItems: [{ batch_id: 55, product_id: 14, variant_id: 1, quantity: 3 }],
      claims: [],
    };
    dbBatchCalls.length = 0;
    await saveOrder(baseOrder("Reserved"));

    const insert = findOrderItemInsert();
    expect(insert).toBeDefined();
    expect(insert.args.at(-1)).toBe(55); // batch_id is the last column
  });

  it("does not claim when the in-transit batch is already fully claimed by other orders", async () => {
    priorStatus = "Pending";
    variantQuantity = 0;
    batchScenario = {
      batches: [{ id: 55, status: "In Transit", expected_arrival: "2026-09-15" }],
      batchItems: [{ batch_id: 55, product_id: 14, variant_id: 1, quantity: 3 }],
      // Some OTHER order already claimed all 3 — this order's own id (1) is
      // excluded from the claims query itself, so this row represents a
      // different order, not double-counting this one.
      claims: [{ batch_id: 55, variant_id: 1, inventory_id: 14, claimed: 3 }],
    };
    dbBatchCalls.length = 0;
    await saveOrder(baseOrder("Reserved"));

    const insert = findOrderItemInsert();
    expect(insert.args.at(-1)).toBeNull();
  });

  it("does not claim when the line already has real stock on hand", async () => {
    priorStatus = "Pending";
    variantQuantity = 1; // real stock — not a zero-on-hand reservation
    batchScenario = {
      batches: [{ id: 55, status: "In Transit", expected_arrival: "2026-09-15" }],
      batchItems: [{ batch_id: 55, product_id: 14, variant_id: 1, quantity: 3 }],
      claims: [],
    };
    dbBatchCalls.length = 0;
    await saveOrder(baseOrder("Reserved"));

    const insert = findOrderItemInsert();
    expect(insert.args.at(-1)).toBeNull();
  });
});

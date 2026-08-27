import { describe, expect, it } from "vitest";
import {
  allocateRounded,
  batchMath,
  consumableLine,
  freebieKit,
  minimumSafePrice,
  orderMath,
  sameMoney,
  unitMath,
  vndToPhp,
} from "./calc.js";

describe("vndToPhp", () => {
  it("converts at the given rate", () => {
    expect(vndToPhp(41600, 416)).toBe(100);
  });
  it("never divides by zero — an explicit non-positive rate yields 0", () => {
    expect(vndToPhp(41600, 0)).toBe(0);
    expect(vndToPhp(41600, -5)).toBe(0);
  });

  it("a missing rate (null/undefined) falls back to the default rate, not 0 — every real caller pre-resolves rate from settings before this is called, so this only matters if that changes", () => {
    expect(vndToPhp(41600, null)).toBe(100); // 41600 / 416 default
  });
});

describe("allocateRounded — centavo-precise allocation", () => {
  it("splits a total that doesn't divide evenly, and the sum always equals the total", () => {
    // 100.00 across weights 1,1,1 -> 33.34 + 33.33 + 33.33 (or some permutation),
    // but the sum must be EXACTLY 100.00, never 99.99 or 100.01.
    const lines = [{}, {}, {}];
    const out = allocateRounded(100, lines, () => 1);
    const sum = out.reduce((s, n) => s + n, 0);
    expect(Math.round(sum * 100)).toBe(10000);
    expect(out).toHaveLength(3);
  });

  it("gives zero share to a line with no basis", () => {
    const lines = [{ w: 1 }, { w: 0 }, { w: 1 }];
    const out = allocateRounded(100, lines, (l) => l.w);
    expect(out[1]).toBe(0);
    expect(sameMoney(out[0] + out[1] + out[2], 100)).toBe(true);
  });

  it("returns all zeros when the total or the weight sum is zero", () => {
    expect(allocateRounded(0, [{}, {}], () => 1)).toEqual([0, 0]);
    expect(allocateRounded(100, [{}, {}], () => 0)).toEqual([0, 0]);
  });

  it("is deterministic for the same input", () => {
    const lines = [{ w: 3 }, { w: 7 }, { w: 5 }];
    const a = allocateRounded(101.51, lines, (l) => l.w);
    const b = allocateRounded(101.51, lines, (l) => l.w);
    expect(a).toEqual(b);
  });
});

describe("orderMath — the deposit/balance/profit formulas from the project handoff", () => {
  const landedMap = new Map([[1, { landedPerUnit: 200 }]]);

  it("items revenue = sum(price x qty); product revenue = max(items - discount, 0)", () => {
    const order = { discount_php: 50, shipping_income_php: 0, payment_requirement: "deposit" };
    const items = [{ product_id: 1, quantity: 2, sale_price_php: 500 }];
    const m = orderMath(order, items, landedMap, 0, []);
    expect(m.itemsRevenue).toBe(1000);
    expect(m.productRevenue).toBe(950);
  });

  it("discount can never push product revenue below zero", () => {
    const order = { discount_php: 999999, shipping_income_php: 0 };
    const items = [{ product_id: 1, quantity: 1, sale_price_php: 500 }];
    const m = orderMath(order, items, landedMap, 0, []);
    expect(m.productRevenue).toBe(0);
  });

  it("billed total = product revenue + customer shipping; deposit = 50% of billed total", () => {
    const order = { discount_php: 0, shipping_income_php: 200, payment_requirement: "deposit" };
    const items = [{ product_id: 1, quantity: 1, sale_price_php: 1000 }];
    const m = orderMath(order, items, landedMap, 0, []);
    expect(m.billedTotal).toBe(1200);
    expect(m.depositDue).toBe(600);
    expect(m.dueNow).toBe(600);
  });

  it("full-payment orders owe the whole billed total now, not a deposit", () => {
    const order = { discount_php: 0, shipping_income_php: 0, payment_requirement: "full" };
    const items = [{ product_id: 1, quantity: 1, sale_price_php: 1000 }];
    const m = orderMath(order, items, landedMap, 0, []);
    expect(m.dueNow).toBe(1000);
    expect(m.isDeposit).toBe(false);
  });

  it("balance due = max(billed total - received payments, 0), never negative", () => {
    const order = { discount_php: 0, shipping_income_php: 0 };
    const items = [{ product_id: 1, quantity: 1, sale_price_php: 1000 }];
    expect(orderMath(order, items, landedMap, 400, []).balanceDue).toBe(600);
    expect(orderMath(order, items, landedMap, 5000, []).balanceDue).toBe(0);
  });

  it("profit = product revenue - landed product cost - freebie cost; shipping never touches it", () => {
    const order = { discount_php: 0, shipping_income_php: 500 };
    const items = [{ product_id: 1, quantity: 1, sale_price_php: 1000 }];
    const freebies = [{ quantity: 1, unit_cost: 50 }];
    const m = orderMath(order, items, landedMap, 0, freebies);
    // productRevenue 1000, landed cost 200, freebie cost 50 -> profit 750.
    // The 500 shipping income must NOT appear in either productRevenue or profit.
    expect(m.productRevenue).toBe(1000);
    expect(m.freebieCost).toBe(50);
    expect(m.actualProfit).toBe(750);
    expect(m.billedTotal).toBe(1500);
  });

  it("an order-line's own actual_landed_cost_php overrides the batch-derived estimate", () => {
    const order = { discount_php: 0, shipping_income_php: 0 };
    const items = [
      { product_id: 1, quantity: 1, sale_price_php: 1000, actual_landed_cost_php: 300 },
    ];
    const m = orderMath(order, items, landedMap, 0, []);
    expect(m.lines[0].estLanded).toBe(200); // from landedMap
    expect(m.lines[0].actualLanded).toBe(300); // overridden
    expect(m.actualProfit).toBe(700);
    expect(m.estProfit).toBe(800);
  });
});

describe("minimumSafePrice — the advisory price floor", () => {
  it("floor = (landed cost + included freebie cost) / (1 - margin/100)", () => {
    // landed 100, 20% margin -> 100 / 0.8 = 125
    expect(minimumSafePrice(100, 20, 0)).toBeCloseTo(125, 5);
    // with a 20 freebie folded in: 120 / 0.8 = 150
    expect(minimumSafePrice(100, 20, 20)).toBeCloseTo(150, 5);
  });

  it("is advisory only via unitMath.belowSafePrice, and never mutates the real price", () => {
    const cheap = unitMath({ sourceVnd: 41600, rate: 416, shipAllocPerUnit: 0, sellingPrice: 50, desiredMarginPercent: 20 });
    expect(cheap.price).toBe(50); // untouched
    expect(cheap.belowSafePrice).toBe(true);

    const fair = unitMath({ sourceVnd: 41600, rate: 416, shipAllocPerUnit: 0, sellingPrice: 200, desiredMarginPercent: 20 });
    expect(fair.belowSafePrice).toBe(false);
  });
});

describe("freebieKit — consumable-to-freebie conversion", () => {
  it("converts an overgrip pack into 60 pieces, per the documented rule", () => {
    const line = consumableLine({ consumable_key: "overgrip", purchase_quantity: 2, unit_cost_php: 80 });
    expect(line.pieces).toBe(120); // 2 packs x 60 pieces
    expect(line.totalCost).toBe(160);
  });

  it("covers falls out of stock / per-paddle requirement", () => {
    const freebies = [
      { name: "Paddle Cover", quantity: 10, active: 1, unit_cost: 150 },
      { name: "Overgrip", quantity: 120, active: 1, unit_cost: 80 },
      { name: "Edge Tape", quantity: 5, active: 1, unit_cost: 60 },
    ];
    const kit = freebieKit(freebies, 5);
    // Edge Tape only has 5 in stock and 5 are wanted -> exactly covers, no shortfall.
    const edgeTape = kit.items.find((i) => i.key === "edge_tape");
    expect(edgeTape.shortfall).toBe(0);
    expect(kit.kitsAvailable).toBe(5); // bottlenecked by the scarcest consumable
  });
});

describe("batchMath — freight allocation basis and reconciliation", () => {
  const batch = {
    local_shipping_php: 300,
    intl_quote_basis: "flat_total",
    intl_gross_vnd: 4160000, // 10,000 PHP worth at rate 416
    intl_actual_paid_php: 10000,
  };

  it("allocates by weight only when every shipped line has a positive weight", () => {
    const items = [
      { product_id: 1, quantity: 2, unit_cost_vnd: 100000, unit_weight_kg: 1 },
      { product_id: 2, quantity: 1, unit_cost_vnd: 100000, unit_weight_kg: 2 },
    ];
    const math = batchMath(batch, items, 416, []);
    expect(math.allocationBasis).toBe("weight");
    expect(math.allocationReconciles).toBe(true);
  });

  it("falls back to per-unit allocation when any shipped line is missing a weight", () => {
    const items = [
      { product_id: 1, quantity: 2, unit_cost_vnd: 100000, unit_weight_kg: 1 },
      { product_id: 2, quantity: 1, unit_cost_vnd: 100000, unit_weight_kg: 0 },
    ];
    const math = batchMath(batch, items, 416, []);
    expect(math.allocationBasis).toBe("units");
    expect(math.linesMissingWeight).toBe(1);
    expect(math.allocationReconciles).toBe(true);
  });

  it("every line's two shipping legs sum to exactly its combined allocation", () => {
    const items = [
      { product_id: 1, quantity: 3, unit_cost_vnd: 100000, unit_weight_kg: 1.5 },
      { product_id: 2, quantity: 2, unit_cost_vnd: 150000, unit_weight_kg: 0.7 },
    ];
    const math = batchMath(batch, items, 416, []);
    for (const line of math.lines) {
      expect(sameMoney(line.allocIntlShipping + line.allocDomesticShipping, line.allocShipping)).toBe(true);
    }
  });
});

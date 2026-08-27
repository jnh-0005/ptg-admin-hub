import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Boat,
  ClockCounterClockwise,
  Gift,
  Package,
  Plus,
  Question,
  Receipt,
  TrendUp,
  Wallet,
  Warning,
} from "@phosphor-icons/react";
import clsx from "clsx";

import Tray, { useOrigin } from "../components/Tray";
import {
  Chip,
  EmptyState,
  FilterChips,
  RollingNumber,
  Section,
  StatCard,
  StockDots,
  listChild,
  listParent,
} from "../components/ui";
import { useStore } from "../lib/store";
import {
  M,
  OVERGRIPS_PER_PACK,
  TONE_FOR_STATUS,
  formatDateShort,
  isLiveOrder,
  movementMeta,
  orderMath,
  pct,
  php,
  phpShort,
  unitLabel,
} from "../lib/calc";
import { spring } from "../lib/motion";

export default function Dashboard() {
  const navigate = useNavigate();
  const { products, orders, batches, payments, settings, derived, freebies, movements, productsById } =
    useStore();
  const [explainOpen, setExplainOpen] = useState(false);
  const [profitSort, setProfitSort] = useState("best");
  const [origin, captureOrigin] = useOrigin();
  const d = derived;

  const activity = useMemo(() => {
    const rows = [];
    for (const o of orders) {
      rows.push({
        id: `o-${o.id}`,
        when: o.order_date,
        icon: Receipt,
        tone: TONE_FOR_STATUS[o.status] || "gray",
        title: `${o.order_number}${o.customer_name ? ` · ${o.customer_name}` : ""}`,
        meta: o.status,
        amount: php(
          orderMath(
            o,
            d.itemsByOrder.get(o.id) || [],
            d.landedMap,
            0,
            d.freebiesByOrder.get(o.id) || [],
          ).revenue,
          { decimals: 0 },
        ),
        to: "/orders",
      });
    }
    for (const p of payments) {
      rows.push({
        id: `p-${p.id}`,
        when: p.payment_date,
        icon: Wallet,
        tone: p.status === "Received" ? "teal" : "clay",
        title: p.method || "Payment",
        meta: p.status,
        amount: php(p.amount_php, { decimals: 0 }),
        to: "/payments",
      });
    }
    for (const b of batches) {
      rows.push({
        id: `b-${b.id}`,
        when: b.expected_arrival || b.order_date || String(b.created_at || "").slice(0, 10),
        icon: Boat,
        tone: TONE_FOR_STATUS[b.status] || "gray",
        title: b.batch_name,
        meta: b.status,
        amount: null,
        to: "/batches",
      });
    }
    // Stock movements belong in the feed too: they are how stock actually moved.
    for (const m of movements.slice(0, 8)) {
      const meta = movementMeta(m.movement_type);
      const product = productsById.get(m.inventory_id);
      const variant = d.variantsById.get(m.variant_id);
      rows.push({
        id: `m-${m.id}`,
        when: String(m.created_at || "").slice(0, 10),
        icon: ClockCounterClockwise,
        tone: meta.tone,
        title:
          m.reference_type === "freebie"
            ? "Freebie stock"
            : unitLabel(product?.name || "Removed paddle", variant?.color),
        meta: meta.label,
        amount: `${M(m.quantity) > 0 ? "+" : "−"}${Math.abs(M(m.quantity))}`,
        to: "/inventory",
      });
    }
    return rows
      .filter((r) => r.when)
      .sort((a, b) => String(b.when).localeCompare(String(a.when)))
      .slice(0, 8);
  }, [orders, payments, batches, movements, productsById, d]);

  /* The rarest moment in the app gets the biggest budget: first run. */
  if (products.length === 0 && orders.length === 0 && batches.length === 0) {
    return <FirstRun onAdd={() => navigate("/inventory")} freebieCount={freebies.length} />;
  }

  const liveOrders = orders.filter(isLiveOrder).length;

  return (
    <motion.div variants={listParent} initial="hidden" animate="shown">
      <motion.header variants={listChild} className="mb-4 hidden lg:block">
        <h1 className="text-[26px] font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-0.5 text-eta text-ink-2">Everything the ledger knows, as of right now.</p>
      </motion.header>

      <motion.div variants={listParent} className="grid grid-cols-2 gap-2.5">
        <StatCard
          label="Inventory value"
          value={phpShort(d.inventoryValue)}
          sub={`${d.unitsOnHand} unit${d.unitsOnHand === 1 ? "" : "s"} at landed cost`}
          icon={Package}
          onClick={() => navigate("/inventory")}
        />
        <StatCard
          label="Paddle sales"
          value={phpShort(d.sales)}
          sub={
            d.shippingCollected > 0
              ? `Excludes ${phpShort(d.shippingCollected)} customer shipping`
              : `${liveOrders} live order${liveOrders === 1 ? "" : "s"}`
          }
          icon={TrendUp}
          onClick={() => navigate("/orders")}
        />
        <StatCard
          label="Open orders"
          value={d.openOrders}
          sub={
            d.awaitingDeposit > 0
              ? `${d.awaitingDeposit} awaiting a deposit`
              : "Reserved, pending or paid, not yet completed"
          }
          icon={Receipt}
          onClick={() => navigate("/orders")}
        />
        <StatCard
          label="Unpaid balance"
          value={phpShort(d.unpaid)}
          tone={d.unpaid > 0 ? "clay" : "ink"}
          sub="Across live orders"
          icon={Wallet}
          onClick={() => navigate("/payments")}
        />
      </motion.div>

      <Section title="Profit">
        <motion.div variants={listChild} className="card p-3.5 sm:p-4">
          <div className="mb-3.5 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[15px] font-semibold">Estimated against actual</p>
              <p className="mt-0.5 break-words text-micro leading-snug text-ink-3">
                Actual uses the landed cost you typed per line, where you typed one. Freebies come
                off both.
              </p>
            </div>
            <button
              type="button"
              onClick={(e) => {
                captureOrigin(e);
                setExplainOpen(true);
              }}
              aria-label="How landed cost is worked out"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink-2
                         transition-transform duration-150 active:scale-90 active:bg-paper"
            >
              <Question size={16} />
            </button>
          </div>

          <ProfitBars est={d.estProfit} actual={d.actualProfit} />

          {/* Every figure that makes up profit, named, in the order it applies. */}
          <dl className="mt-4 space-y-1.5 border-t border-line-soft pt-3 text-eta">
            <div className="flex items-baseline justify-between gap-2 xs:gap-3">
              <dt className="min-w-0 break-words text-ink-3">Product revenue</dt>
              <dd className="num shrink-0 whitespace-nowrap font-semibold">
                <RollingNumber value={php(d.sales, { decimals: 0 })} />
              </dd>
            </div>
            {d.discounts > 0 && (
              <div className="flex items-baseline justify-between gap-2 xs:gap-3">
                <dt className="min-w-0 break-words text-ink-3">
                  Discounts <span className="text-ink-4">· already off revenue</span>
                </dt>
                <dd className="num shrink-0 whitespace-nowrap text-ink-3">
                  −{php(d.discounts, { decimals: 0 })}
                </dd>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-2 xs:gap-3">
              <dt className="min-w-0 break-words text-ink-3">Product landed cost</dt>
              <dd className="num shrink-0 whitespace-nowrap text-ink-2">
                −{php(d.productCost, { decimals: 0 })}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2 xs:gap-3">
              <dt className="min-w-0 break-words text-plum">
                Freebie cost <span className="text-ink-4">· never revenue</span>
              </dt>
              <dd className="num shrink-0 whitespace-nowrap text-plum">
                −{php(d.freebieCost, { decimals: 0 })}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2 border-t border-line pt-1.5 text-[15px] font-semibold xs:gap-3">
              <dt className="min-w-0">Actual profit</dt>
              <dd
                className={clsx(
                  "num shrink-0 whitespace-nowrap",
                  d.actualProfit < 0 ? "text-clay" : "text-teal",
                )}
              >
                <RollingNumber value={php(d.actualProfit, { decimals: 0 })} />
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2 border-t border-line-soft pt-1.5 xs:gap-3">
              <dt className="min-w-0 break-words text-ink-3">
                Customer shipping collected{" "}
                <span className="text-ink-4">· outside profit</span>
              </dt>
              <dd className="num shrink-0 whitespace-nowrap text-ink-3">
                {php(d.shippingCollected, { decimals: 0 })}
              </dd>
            </div>
            {/* Bought on batches, costed on the orders they go out on. */}
            {d.consumableSpend > 0 && (
              <div className="flex items-baseline justify-between gap-2 xs:gap-3">
                <dt className="min-w-0 break-words text-ink-3">
                  Consumables bought on batches{" "}
                  <span className="text-ink-4">· in batch cost</span>
                </dt>
                <dd className="num shrink-0 whitespace-nowrap text-ink-3">
                  {php(d.consumableSpend, { decimals: 0 })}
                </dd>
              </div>
            )}
          </dl>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-line-soft pt-3">
            <span className="shrink-0 text-eta text-ink-2">Difference</span>
            <span className="flex min-w-0 flex-wrap items-baseline justify-end gap-x-2 gap-y-1">
              <span
                className={clsx(
                  "num whitespace-nowrap text-[15px] font-semibold",
                  d.profitDelta > 0.005
                    ? "text-teal"
                    : d.profitDelta < -0.005
                      ? "text-clay"
                      : "text-ink-3",
                )}
              >
                {php(d.profitDelta, { decimals: 0, sign: true })}
              </span>
              <Chip tone={d.margin >= 0 ? "cobalt" : "clay"}>{pct(d.margin)} margin</Chip>
            </span>
          </div>

          {d.freebieCost > 0 && (
            <div className="mt-2.5 flex items-center gap-2 rounded-md bg-plum-wash px-2.5 py-2">
              <Gift size={15} weight="fill" className="shrink-0 text-plum" />
              <p className="min-w-0 break-words text-micro leading-snug text-plum">
                <span className="num font-semibold">{php(d.freebieCost, { decimals: 0 })}</span> of
                freebies given away across {d.freebieCount} item
                {d.freebieCount === 1 ? "" : "s"}, already deducted above.
              </p>
            </div>
          )}
        </motion.div>
      </Section>

      {d.lowStockCount > 0 && (
        <Section title="Needs restocking">
          <motion.button
            variants={listChild}
            type="button"
            onClick={() => navigate("/inventory")}
            className="card w-full p-3.5 text-left transition-transform duration-150 active:scale-[0.99] sm:p-4"
          >
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-clay-wash text-clay">
                <Warning size={17} weight="fill" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-balance break-words text-[15px] font-semibold">
                  <RollingNumber value={d.lowStockCount} className="mr-1" />
                  {d.lowStockCount === 1 ? "item is" : "items are"} at or below the reorder line
                </p>
              </div>
              <ArrowRight size={16} className="shrink-0 text-ink-3" />
            </div>
            <ul className="mt-3 space-y-2">
              {d.lowStock.slice(0, 3).map((u) => (
                <li key={u.key} className="flex items-center gap-2 xs:gap-3">
                  <span className="min-w-0 flex-1 truncate text-eta text-ink-2">
                    {unitLabel(u.name, u.color)}
                  </span>
                  <StockDots
                    quantity={u.quantity_on_hand}
                    reorder={u.reorder_level}
                    holes={8}
                  />
                  <span className="num shrink-0 whitespace-nowrap text-right text-eta text-ink-2">
                    {u.quantity_on_hand}/{u.reorder_level}
                  </span>
                </li>
              ))}
            </ul>
            {d.lowStockCount > 3 && (
              <p className="mt-2.5 text-micro text-ink-3">and {d.lowStockCount - 3} more</p>
            )}
          </motion.button>
        </Section>
      )}

      {d.unitProfit.length > 0 && (
        <Section title="What actually earns">
          <motion.div variants={listChild} className="card overflow-hidden">
            <div className="border-b border-line-soft px-3.5 py-3">
              <p className="text-[15px] font-semibold">Profit by paddle and colour</p>
              <p className="mt-0.5 break-words text-micro leading-snug text-ink-3">
                Revenue less landed cost less the freebies given away with it, per unit sold.
              </p>
            </div>
            <div className="px-3.5 pt-2.5">
              <FilterChips
                options={[
                  { value: "best", label: "Best first" },
                  { value: "worst", label: "Losing money" },
                  { value: "volume", label: "Most sold" },
                ]}
                value={profitSort}
                onChange={setProfitSort}
                idPrefix="prof"
              />
            </div>
            <UnitProfitList rows={d.unitProfit} sort={profitSort} />
          </motion.div>
        </Section>
      )}

      <Section title="Recent activity">
        {activity.length === 0 ? (
          <motion.div variants={listChild}>
            <EmptyState
              icon={<Receipt size={22} />}
              title="Nothing has happened yet"
              body="Orders, payments and batches show up here as soon as you log them."
            />
          </motion.div>
        ) : (
          <motion.ul variants={listParent} className="card divide-y divide-line-soft overflow-hidden">
            {activity.map((row) => (
              <motion.li key={row.id} variants={listChild}>
                <button
                  type="button"
                  onClick={() => navigate(row.to)}
                  className="flex w-full items-center gap-2.5 px-3 py-3 text-left transition-colors duration-150 active:bg-paper xs:gap-3 xs:px-3.5"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-paper text-ink-2">
                    <row.icon size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-eta font-medium">{row.title}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                      <Chip tone={row.tone}>{row.meta}</Chip>
                      <span className="num whitespace-nowrap text-micro text-ink-3">
                        {formatDateShort(row.when)}
                      </span>
                    </span>
                  </span>
                  {row.amount && (
                    <span className="num shrink-0 whitespace-nowrap text-eta font-medium">
                      {row.amount}
                    </span>
                  )}
                </button>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </Section>

      <ExplainTray
        open={explainOpen}
        onClose={() => setExplainOpen(false)}
        origin={origin}
        rate={settings.php_to_vnd_rate}
      />
    </motion.div>
  );
}

/* --------------------------------------------------------------- sub-parts */

/**
 * Profitability per STOCK UNIT, so a colour that quietly loses money is visible
 * rather than averaged away by the paddle it sits under. Negative profit turns
 * clay with no announcement, exactly like the order card does.
 */
function UnitProfitList({ rows, sort }) {
  const sorted = useMemo(() => {
    const list = [...rows];
    if (sort === "worst") return list.filter((r) => r.profit < 0).sort((a, b) => a.profit - b.profit);
    if (sort === "volume") return list.sort((a, b) => b.units - a.units);
    return list.sort((a, b) => b.profit - a.profit);
  }, [rows, sort]);

  const scale = Math.max(...sorted.map((r) => Math.abs(r.profit)), 1);
  const visible = sorted.slice(0, 6);

  if (visible.length === 0) {
    return (
      <div className="px-3.5 py-6 text-center">
        <TrendUp size={22} className="mx-auto mb-2 text-ink-4" />
        <p className="text-eta text-ink-3">
          Nothing is losing money. Every paddle and colour you have sold is in the black.
        </p>
      </div>
    );
  }

  return (
    <motion.ul variants={listParent} initial="hidden" animate="shown" className="mt-1">
      {visible.map((row) => (
        <motion.li
          key={row.key}
          layout
          variants={listChild}
          transition={spring}
          className="border-t border-line-soft px-3.5 py-2.5 first:border-t-0"
        >
          <div className="flex items-baseline justify-between gap-2 xs:gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-eta font-medium">
                {unitLabel(row.name, row.color)}
              </p>
              <p className="num mt-0.5 truncate text-micro text-ink-3">
                {row.units} sold · {php(row.revenue, { decimals: 0 })} in ·{" "}
                {row.onHand} on hand
              </p>
            </div>
            <p
              className={clsx(
                "num shrink-0 whitespace-nowrap text-[15px] font-semibold",
                row.profit < 0 ? "text-clay" : "text-teal",
              )}
            >
              {php(row.profit, { decimals: 0 })}
            </p>
          </div>

          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line-soft">
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: Math.min(1, Math.abs(row.profit) / scale) }}
                transition={spring}
                style={{ originX: 0 }}
                className={clsx(
                  "h-full rounded-full",
                  row.profit < 0 ? "bg-clay" : "bg-cobalt",
                )}
              />
            </div>
            <span className="num shrink-0 whitespace-nowrap text-micro text-ink-3">
              {pct(row.margin)}
            </span>
          </div>

          {row.freebieCost > 0.5 && (
            <p className="num mt-1 text-micro text-plum">
              −{php(row.freebieCost, { decimals: 0 })} of freebies, already taken off
            </p>
          )}
        </motion.li>
      ))}

      {sorted.length > visible.length && (
        <li className="border-t border-line-soft px-3.5 py-2.5 text-micro text-ink-3">
          and {sorted.length - visible.length} more
        </li>
      )}
    </motion.ul>
  );
}

function ProfitBars({ est, actual }) {
  const scale = Math.max(Math.abs(est), Math.abs(actual), 1);
  const bars = [
    { key: "est", label: "Estimated", value: est, cls: "bg-ink-4" },
    { key: "act", label: "Actual", value: actual, cls: "bg-cobalt" },
  ];
  return (
    <div className="space-y-3">
      {bars.map((bar) => (
        <div key={bar.key}>
          <div className="flex items-baseline justify-between gap-2 xs:gap-3">
            <span className="min-w-0 truncate text-eta text-ink-2">{bar.label}</span>
            <span
              className={clsx(
                "num shrink-0 whitespace-nowrap text-[15px] font-semibold",
                bar.value < 0 && "text-clay",
              )}
            >
              <RollingNumber value={php(bar.value, { decimals: 0 })} />
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line-soft">
            <motion.div
              initial={{ scaleX: 0 }}
              animate={{ scaleX: Math.min(1, Math.abs(bar.value) / scale) }}
              transition={{ ...spring, delay: bar.key === "act" ? 0.08 : 0 }}
              style={{ originX: 0 }}
              className={clsx("h-full rounded-full", bar.value < 0 ? "bg-clay" : bar.cls)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The whole page is replaced on first run, because it happens exactly once.
 * Step two is pre-marked done: the freebies catalog seeds itself.
 */
function FirstRun({ onAdd, freebieCount }) {
  const steps = [
    {
      n: 1,
      t: "Add your paddles",
      d: "Supplier cost in dong and the price you sell it at. The standard line comes pre-priced, and every price stays editable.",
      done: false,
    },
    {
      n: 2,
      t: "Freebies are ready",
      d: `Paddle Cover, Edge Tape and Overgrip are already in the catalog with editable costs. ${freebieCount} of them, waiting in Settings.`,
      done: freebieCount > 0,
    },
    {
      n: 3,
      t: "Log a batch, then orders",
      d: "Batch shipping splits evenly across every item. Completing an order takes the stock out; payments settle the balance.",
      done: false,
    },
  ];

  return (
    <motion.div variants={listParent} initial="hidden" animate="shown">
      <motion.div
        variants={listChild}
        className="overflow-hidden rounded-lg border border-line bg-surface shadow-card"
      >
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-paper sm:aspect-[16/9]">
          <motion.img
            src="/images/kit-flatlay.webp"
            alt=""
            initial={{ scale: 1.06, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ ...spring, damping: 30 }}
            className="h-full w-full object-cover"
          />
        </div>
        <div className="p-4 sm:p-5">
          <p className="eyebrow">Welcome</p>
          <h1 className="mt-1.5 text-balance text-[21px] font-semibold leading-tight tracking-tight xs:text-[24px]">
            Your ledger is empty, and that is the right place to start.
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
            Add the paddles you resell first. Everything else, batches, orders, freebies and
            payments, hangs off them, and every peso figure comes from their source cost in dong.
          </p>
          <button type="button" className="btn-primary mt-4 w-full sm:w-auto" onClick={onAdd}>
            <Plus size={17} weight="bold" />
            Add your first paddle
          </button>
        </div>
      </motion.div>

      <motion.ol variants={listParent} className="mt-4 space-y-2">
        {steps.map((step) => (
          <motion.li key={step.n} variants={listChild} className="card flex gap-3 p-3.5">
            <span
              className={clsx(
                "num grid h-7 w-7 shrink-0 place-items-center rounded-full text-eta font-semibold",
                step.done ? "bg-teal-wash text-teal" : "bg-cobalt-wash text-cobalt",
              )}
            >
              {step.done ? "✓" : step.n}
            </span>
            <span className="min-w-0">
              <span className="block break-words text-eta font-semibold">{step.t}</span>
              <span className="mt-0.5 block break-words text-micro leading-relaxed text-ink-3">
                {step.d}
              </span>
            </span>
          </motion.li>
        ))}
      </motion.ol>
    </motion.div>
  );
}

function ExplainTray({ open, onClose, origin, rate }) {
  const steps = [
    ["VND Cost", "what the supplier charges, in dong"],
    ["PHP Supplier Cost", `÷ ${Math.round(M(rate)).toLocaleString()}, the exchange rate`],
    ["Combined Shipping Allocation", "the batch's own Vietnam→Manila quote + its Manila→CDO cost, allocated by usable weight or units"],
    ["Landed Cost", "supplier cost + that allocation"],
    ["Standard Selling Price", "set per paddle, editable, never moves with shipping"],
    ["Freebie Cost", "what you threw in, straight off the profit"],
    ["Actual Profit", "selling price − landed cost − freebies"],
  ];

  return (
    <Tray
      open={open}
      onClose={onClose}
      origin={origin}
      title="How landed cost is worked out"
      subtitle="One rule, applied everywhere"
    >
      <div className="space-y-3.5 pb-2 pt-1">
        <div className="rounded-md border border-line bg-paper p-3">
          <p className="eyebrow mb-1.5">The order it happens in</p>
          <ol className="mt-1 space-y-1 text-eta leading-relaxed text-ink-2">
            {steps.map(([label, note], i) => (
              <li key={label} className="flex gap-2">
                <span className="num shrink-0 text-ink-4">{i + 1}</span>
                <span className="min-w-0 break-words">
                  <span className="font-medium text-ink">{label}</span>
                  <span className="text-ink-3"> — {note}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div className="rounded-md border border-cobalt/25 bg-cobalt-wash p-3">
          <p className="eyebrow mb-1.5 !text-cobalt">Shipping is a batch cost</p>
          <p className="text-eta leading-relaxed text-ink-2">
            Manila to CDO is charged once per <em>batch</em>, not once per paddle. A{" "}
            <span className="num font-medium text-ink">₱200</span> batch of{" "}
            <span className="num font-medium text-ink">16</span> paddles adds{" "}
            <span className="num font-medium text-ink">₱12.50</span> to each one. It is never ₱200 a
            paddle.
          </p>
        </div>

        <div className="rounded-md border border-line bg-paper p-3">
          <p className="eyebrow mb-1.5">Freebies are a real cost</p>
          <p className="text-eta leading-relaxed text-ink-2">
            A cover, tape or grip thrown in adds nothing to revenue, so its full cost comes off
            profit on that order and in every rollup. Completing the order takes it out of freebie
            stock.
          </p>
        </div>

        <div className="rounded-md border border-plum/25 bg-plum-wash p-3">
          <p className="eyebrow mb-1.5 !text-plum">Consumables are a batch cost</p>
          <p className="text-eta leading-relaxed text-ink-2">
            Covers and edge tapes are bought by the piece, overgrips by the pack of{" "}
            <span className="num font-medium text-ink">{OVERGRIPS_PER_PACK}</span>. What a batch
            pays for them is part of <em>that batch's</em> landed cost and batch profit. Receiving
            the batch puts the pieces on the freebie shelf at their real per-piece cost, and giving
            one away costs the order it went out on.
          </p>
        </div>

        <div className="rounded-md border border-line bg-paper p-3">
          <p className="eyebrow mb-1.5">Customer shipping is separate</p>
          <p className="text-eta leading-relaxed text-ink-2">
            What a customer pays for delivery after a sale counts toward their balance, so payments
            settle correctly, and never toward product revenue or product profit.
          </p>
        </div>

        <div className="rounded-md border border-line bg-paper p-3">
          <p className="eyebrow mb-1.5">Estimated against actual</p>
          <p className="text-eta leading-relaxed text-ink-2">
            Estimated uses the landed cost the batch worked out. Actual prefers what you actually
            paid, typed on the order line. Leave it blank and the two match.
          </p>
        </div>

        <div className="rounded-md border border-line bg-paper p-3">
          <p className="eyebrow mb-1.5">A colour costs itself</p>
          <p className="text-eta leading-relaxed text-ink-2">
            Where a paddle carries colours, each one holds its own stock, cost and price, and it is
            the colour that gets batched, sold and counted. A colour that leaves its cost or price
            blank simply uses the paddle's. A paddle without colours works exactly as it always has.
          </p>
        </div>

        <p className="px-1 text-micro leading-relaxed text-ink-3">
          Change the rate in Settings and every figure in the app recalculates, including these.
        </p>
      </div>
    </Tray>
  );
}

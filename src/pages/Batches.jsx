import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Boat, Gift, Plus, Scales, Trash, Truck, X } from "@phosphor-icons/react";
import confetti from "canvas-confetti";
import { toast } from "sonner";
import clsx from "clsx";

import Tray, { ConfirmTray, MorphLabel, useOrigin, useSticky } from "../components/Tray";
import { ProductPicker } from "../components/Pickers";
import {
  CalcRows,
  Chip,
  EmptyState,
  Field,
  FilterChips,
  Input,
  RollingNumber,
  SegmentedPills,
  Select,
  ShippingNote,
  listChild,
  listParent,
} from "../components/ui";
import { useStore } from "../lib/store";
import {
  BATCH_STATUSES,
  CARRIERS,
  CONSUMABLES,
  DEFAULT_BATCH_SHIPPING,
  EXAMPLE_INTL_RATE_VND_PER_KG,
  M,
  OVERGRIPS_PER_PACK,
  TONE_FOR_STATUS,
  allocationNote,
  batchMath,
  batchProfitability,
  consumableFreebie,
  consumableLine,
  formatDateShort,
  freebieKit,
  pct,
  php,
  today,
  unitKey,
  unitLabel,
  unitMath,
  validate,
  vnd,
} from "../lib/calc";
import { CONFETTI_COLORS, haptic, spring } from "../lib/motion";

const RULES = {
  batch_name: { required: true, label: "Batch name" },
  local_shipping_php: { nonNegative: true, label: "Domestic shipping" },
  other_costs_php: { nonNegative: true, label: "Other batch costs" },
  exchange_rate: { nonNegative: true, label: "Exchange rate" },
  actual_weight_kg: { nonNegative: true, label: "Actual shipment weight" },
  chargeable_weight_kg: { nonNegative: true, label: "Chargeable weight" },
  // The quote fields are all OPTIONAL — a batch may genuinely have no
  // international leg yet — but a figure that IS entered has to be a number.
  intl_rate_vnd_per_kg: { nonNegative: true, label: "Rate" },
  intl_combined_weight_kg: { nonNegative: true, label: "Weight" },
  intl_gross_vnd: { nonNegative: true, label: "Flat quote" },
  intl_discount_value: { nonNegative: true, label: "Discount" },
  intl_actual_paid_php: { nonNegative: true, label: "Actual PHP paid" },
};

export default function Batches() {
  const { batches, batchItems, products, settings, commit, productsById, derived, freebies } =
    useStore();
  const [filter, setFilter] = useState("All");
  const [editing, setEditing] = useState(null); // "new" | batch
  const [deleting, setDeleting] = useState(null);
  const [comparing, setComparing] = useState(null);
  const [comparisonPickerOpen, setComparisonPickerOpen] = useState(false);
  const [origin, captureOrigin] = useOrigin();
  const [comparisonOrigin, captureComparisonOrigin] = useOrigin();

  const rate = settings.php_to_vnd_rate;

  const itemsByBatch = useMemo(() => {
    const map = new Map();
    for (const item of batchItems) {
      if (!map.has(item.batch_id)) map.set(item.batch_id, []);
      map.get(item.batch_id).push(item);
    }
    return map;
  }, [batchItems]);

  const visible = useMemo(
    () => (filter === "All" ? batches : batches.filter((b) => b.status === filter)),
    [batches, filter],
  );

  const inTransit = useMemo(
    () => batches.filter((b) => b.status === "Ordered" || b.status === "In Transit").length,
    [batches],
  );

  /**
   * The soonest still-relevant pre-order cutoff, across every batch that can
   * still take pre-orders (not yet Received or Cancelled). Cutoff genuinely
   * varies per batch, so this is a live read across all of them, not a
   * single setting — it just surfaces whichever one is coming up next.
   */
  const nextCutoff = useMemo(() => {
    const todayStr = today();
    return batches
      .filter((b) => b.status !== "Received" && b.status !== "Cancelled")
      .filter((b) => b.preorder_cutoff_date && b.preorder_cutoff_date >= todayStr)
      .sort((a, b) => a.preorder_cutoff_date.localeCompare(b.preorder_cutoff_date))[0];
  }, [batches]);

  const stickyEditing = useSticky(editing);
  const stickyDeleting = useSticky(deleting);

  return (
    <motion.div variants={listParent} initial="hidden" animate="shown">
      <motion.header variants={listChild} className="mb-3 flex items-end justify-between gap-3">
        <div className="hidden min-w-0 lg:block">
          <h1 className="text-[26px] font-semibold tracking-tight">Batches</h1>
          <p className="mt-0.5 text-eta text-ink-2">
            {inTransit > 0 ? `${inTransit} on the way` : "Nothing in transit"}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
          {/*
            A placeholder at a glance: the soonest pre-order cutoff across
            every batch still taking pre-orders, since cutoff varies per
            batch and there's no single setting for it. Shows even with
            nothing set yet, as a nudge to fill one in on a batch below.
          */}
          {batches.length > 0 && (
            <Chip tone={nextCutoff ? "clay" : "gray"} dot={!!nextCutoff}>
              {nextCutoff
                ? `Next pre-order cutoff · ${formatDateShort(nextCutoff.preorder_cutoff_date)}`
                : "No pre-order cutoff set"}
            </Chip>
          )}
          <button
            type="button"
            className="btn-quiet"
            disabled={products.length === 0 || batches.length === 0}
            onClick={(e) => {
              captureComparisonOrigin(e);
              setComparisonPickerOpen(true);
            }}
          >
            <Scales size={17} />
            Compare
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={products.length === 0}
            onClick={(e) => {
              captureOrigin(e);
              setEditing("new");
            }}
          >
            <Plus size={17} weight="bold" />
            New batch
          </button>
        </div>
      </motion.header>

      {batches.length === 0 ? (
        <motion.div variants={listChild}>
          <EmptyState
            icon={<Boat size={22} />}
            title="No batches yet"
            body={
              products.length === 0
                ? "Add a paddle in Inventory first. A batch is a shipment of paddles you already track."
                : "A batch is one shipment. Log what you ordered and what freight cost, and it works out landed cost per unit for you."
            }
            action={
              products.length > 0 && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={(e) => {
                    captureOrigin(e);
                    setEditing("new");
                  }}
                >
                  <Plus size={17} weight="bold" />
                  New batch
                </button>
              )
            }
          />
        </motion.div>
      ) : (
        <>
          <motion.div variants={listChild}>
            <FilterChips
              options={["All", ...BATCH_STATUSES]}
              value={filter}
              onChange={setFilter}
              idPrefix="bat"
            />
          </motion.div>

          <AnimatePresence initial={false}>
            {comparing && (
              <SupplierComparison
                unit={comparing}
                batches={batches}
                batchItems={batchItems}
                consumablesByBatch={derived.consumablesByBatch}
                productsById={productsById}
                variantsById={derived.variantsById}
                rate={rate}
                onChange={(e) => {
                  captureComparisonOrigin(e);
                  setComparisonPickerOpen(true);
                }}
                onClose={() => setComparing(null)}
              />
            )}
          </AnimatePresence>

          <motion.div variants={listChild} className="mt-3 space-y-2.5">
            {visible.length === 0 ? (
              <EmptyState
                icon={<Boat size={22} />}
                title={`No ${filter.toLowerCase()} batches`}
                body="Change the filter to see the rest of your shipments."
                action={
                  <button type="button" className="btn-quiet" onClick={() => setFilter("All")}>
                    Show all
                  </button>
                }
              />
            ) : (
              <AnimatePresence initial={false}>
                {visible.map((batch) => (
                  <BatchCard
                    key={batch.id}
                    batch={batch}
                    items={itemsByBatch.get(batch.id) || []}
                    consumables={derived.consumablesByBatch.get(batch.id) || []}
                    rate={rate}
                    productsById={productsById}
                    variantsById={derived.variantsById}
                    onOpen={(e) => {
                      captureOrigin(e);
                      setEditing(batch);
                    }}
                  />
                ))}
              </AnimatePresence>
            )}
          </motion.div>
        </>
      )}

      <BatchTray
        key={stickyEditing === "new" ? "new" : (stickyEditing?.id ?? "closed")}
        open={!!editing}
        batch={stickyEditing === "new" ? null : stickyEditing}
        items={
          stickyEditing && stickyEditing !== "new" ? itemsByBatch.get(stickyEditing.id) || [] : []
        }
        consumables={
          stickyEditing && stickyEditing !== "new"
            ? derived.consumablesByBatch.get(stickyEditing.id) || []
            : []
        }
        origin={origin}
        onClose={() => setEditing(null)}
        onDelete={(b) => setDeleting(b)}
        onSave={(payload) => commit((db) => db.saveBatch(payload))}
      />

      <ProductPicker
        open={comparisonPickerOpen}
        origin={comparisonOrigin}
        title="Compare suppliers"
        subtitle="Choose one paddle or colour to compare across past batches"
        onClose={() => setComparisonPickerOpen(false)}
        onPick={(unit) => {
          setComparing(unit);
          setComparisonPickerOpen(false);
        }}
      />

      <ConfirmTray
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete ${stickyDeleting?.batch_name || ""}?`}
        body={
          stickyDeleting?.status === "Received"
            ? "This batch already added its paddles to your stock. Deleting it takes those units back off, and the landed costs it produced disappear."
            : "The batch and all of its lines go for good. Nothing else is touched."
        }
        confirmLabel="Delete batch"
        onConfirm={async () => {
          await commit((db) => db.deleteBatch(stickyDeleting));
          toast("Batch deleted");
        }}
      />
    </motion.div>
  );
}

/* ------------------------------------------------------------------- card */

function BatchCard({ batch, items, consumables, rate, productsById, variantsById, onOpen }) {
  const batchRate = M(batch.exchange_rate) > 0 ? M(batch.exchange_rate) : rate;
  const math = batchMath(batch, items, batchRate, consumables);
  const tracked = batch.tracking_number || batch.carrier;
  return (
    <motion.button
      layout
      variants={listChild}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={spring}
      type="button"
      onClick={onOpen}
      whileTap={{ scale: 0.99 }}
      className="card w-full min-w-0 p-3 text-left transition-colors duration-150 active:bg-paper xs:p-3.5"
    >
      <div className="flex items-start justify-between gap-2 xs:gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-tight">{batch.batch_name}</p>
          <p className="mt-0.5 break-words text-micro text-ink-3">
            {batch.supplier || "No supplier"}
            {batch.expected_arrival ? ` · arrives ${formatDateShort(batch.expected_arrival)}` : ""}
            {batch.preorder_cutoff_date ? ` · order by ${formatDateShort(batch.preorder_cutoff_date)}` : ""}
          </p>
        </div>
        <Chip tone={TONE_FOR_STATUS[batch.status] || "gray"} dot>
          {batch.status}
        </Chip>
      </div>

      <div className="mt-2 grid grid-cols-3 items-end gap-2 border-t border-line-soft pt-2.5 xs:gap-3">
        <div className="min-w-0">
          <p className="eyebrow break-words">Total qty</p>
          <p className="num mt-0.5 truncate text-[15px] font-medium">{math.unitCount}</p>
        </div>
        <div className="min-w-0 text-right">
          <p className="eyebrow break-words">Total weight</p>
          <p className="num mt-0.5 truncate text-eta text-ink-2">{math.totalWeightKg.toFixed(2)} kg</p>
        </div>
        <div className="min-w-0 text-right">
          <p className="eyebrow break-words">Total shipping</p>
          <p className="num mt-0.5 truncate text-eta text-ink-2">{php(math.shipping, { decimals: 0 })}</p>
        </div>
      </div>

      {/* What the batch bought alongside the paddles, in the freebies' own colour. */}
      {math.consumables.any && (
        <div className="mt-2 space-y-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-plum">
            <Gift size={13} weight="fill" className="shrink-0" />
            <span className="num">{math.consumablePieces} pieces</span>
            <span className="min-w-0 truncate text-ink-3">
              of consumables ·{" "}
              <span className="num">{php(math.consumableCost, { decimals: 0 })}</span> in the landed
              cost
            </span>
          </p>
          {/* Whether those pieces are actually on the shelf yet. */}
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 pl-[21px] text-micro text-ink-3">
            {math.consumables.lines
              .filter((l) => l.bought)
              .map((l) => (
                <span key={l.key} className="whitespace-nowrap">
                  {l.meta.singular} <span className="num text-ink-2">×{l.pieces}</span>
                  <span className="num text-ink-4"> @ {php(l.perPiece)}</span>
                </span>
              ))}
            <span
              className={clsx(
                "whitespace-nowrap font-semibold",
                batch.status === "Received" ? "text-teal" : "text-ink-4",
              )}
            >
              {batch.status === "Received" ? "on the shelf" : "on receipt"}
            </span>
          </p>
        </div>
      )}

      {items.length > 0 && (
        <p className="mt-2 line-clamp-2 break-words text-micro text-ink-3">
          {items
            .slice(0, 3)
            .map((i) =>
              `${unitLabel(
                productsById.get(i.product_id)?.name || "—",
                variantsById?.get(i.variant_id)?.color,
              )} ×${i.quantity}`,
            )
            .join(", ")}
          {items.length > 3 ? ` +${items.length - 3} more` : ""}
        </p>
      )}

      {/* Where the shipment is, without opening the tray. */}
      {tracked && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line-soft pt-2 text-micro text-ink-3">
          <Truck size={13} className="shrink-0 text-ink-4" />
          <span className="min-w-0 truncate">{batch.carrier || "In transit"}</span>
          {batch.tracking_number && (
            <span className="num min-w-0 truncate text-ink-2">{batch.tracking_number}</span>
          )}
        </p>
      )}
    </motion.button>
  );
}

/* ------------------------------------------------ supplier comparison */

function SupplierComparison({
  unit,
  batches,
  batchItems,
  consumablesByBatch,
  productsById,
  variantsById,
  rate,
  onChange,
  onClose,
}) {
  const rows = useMemo(() => {
    const wanted = unitKey(unit.product_id, unit.variant_id);
    return batches
      .filter((batch) => batch.status !== "Cancelled")
      .flatMap((batch) => {
        const items = batchItems.filter((item) => item.batch_id === batch.id);
        const batchRate = M(batch.exchange_rate) > 0 ? M(batch.exchange_rate) : rate;
        const math = batchMath(
          batch,
          items,
          batchRate,
          consumablesByBatch.get(batch.id) || [],
        );
        return math.lines
          .filter((line) => line.unit_key === wanted && line.qty > 0)
          .map((line) => {
            const product = productsById.get(line.product_id);
            const variant = variantsById.get(line.variant_id);
            const sellingPrice =
              M(variant?.selling_price_php) > 0
                ? M(variant.selling_price_php)
                : M(product?.selling_price_php);
            const expectedProfit = sellingPrice > 0 ? sellingPrice - line.landedPerUnit : null;
            return {
              id: `${batch.id}-${line.id ?? line.unit_key}`,
              batch,
              line,
              sellingPrice,
              expectedProfit,
              margin:
                expectedProfit !== null && sellingPrice > 0
                  ? (expectedProfit / sellingPrice) * 100
                  : null,
            };
          });
      })
      .sort((a, b) => M(b.batch.id) - M(a.batch.id));
  }, [unit, batches, batchItems, consumablesByBatch, productsById, variantsById, rate]);

  const lowestLanded = rows.length ? Math.min(...rows.map((row) => row.line.landedPerUnit)) : null;
  const priced = rows.filter((row) => row.expectedProfit !== null);
  const highestProfit = priced.length
    ? Math.max(...priced.map((row) => row.expectedProfit))
    : null;
  const bestId = [...priced].sort(
    (a, b) =>
      b.margin - a.margin ||
      b.expectedProfit - a.expectedProfit ||
      a.line.landedPerUnit - b.line.landedPerUnit ||
      M(b.batch.id) - M(a.batch.id),
  )[0]?.id;

  return (
    <motion.section
      layout
      initial={{ opacity: 0, height: 0, y: -6 }}
      animate={{ opacity: 1, height: "auto", y: 0 }}
      exit={{ opacity: 0, height: 0, y: -6 }}
      transition={spring}
      className="mt-3 overflow-hidden"
    >
      <div className="card p-3 xs:p-3.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Supplier comparison</p>
            <p className="mt-1 truncate text-[15px] font-semibold">
              {unitLabel(unit.name, unit.color)}
            </p>
            <p className="num mt-0.5 text-micro text-ink-3">{unit.sku}</p>
          </div>
          <button type="button" className="btn-quiet" onClick={onChange}>
            Change
          </button>
          <button
            type="button"
            aria-label="Close supplier comparison"
            onClick={onClose}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-ink-3 active:scale-90 active:bg-line-soft"
          >
            <X size={16} />
          </button>
        </div>

        {rows.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              icon={<Scales size={20} />}
              title="No supplier history yet"
              body="This paddle or colour has not appeared in a saved batch."
            />
          </div>
        ) : (
          <motion.div variants={listParent} initial="hidden" animate="shown" className="mt-3 space-y-2">
            {rows.map((row) => {
              const lowest = Math.abs(row.line.landedPerUnit - lowestLanded) < 0.005;
              const highest =
                row.expectedProfit !== null &&
                Math.abs(row.expectedProfit - highestProfit) < 0.005;
              return (
                <motion.article
                  layout
                  variants={listChild}
                  key={row.id}
                  className={clsx(
                    "rounded-md border p-2.5",
                    row.id === bestId ? "border-cobalt/30 bg-cobalt-wash" : "border-line bg-paper",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-eta font-semibold">
                        {row.batch.supplier || "No supplier"}
                      </p>
                      <p className="num mt-0.5 text-micro text-ink-3">
                        {row.batch.batch_id || row.batch.batch_name}
                        {row.batch.order_date ? ` · ${formatDateShort(row.batch.order_date)}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                      {row.id === bestId && <Chip tone="cobalt">Best supplier</Chip>}
                      {lowest && <Chip tone="teal">Lowest landed</Chip>}
                      {highest && <Chip tone="teal">Highest profit</Chip>}
                    </div>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-line-soft pt-2 text-micro">
                    <CompareFigure label="Supplier price" value={php(row.line.sourcePhpPerUnit)} />
                    <CompareFigure label="International" value={php(row.line.intlShipPerUnit)} />
                    <CompareFigure label="Local" value={php(row.line.domesticShipPerUnit)} />
                    <CompareFigure label="Other" value={php(row.line.otherPerUnit)} />
                    <CompareFigure label="Landed cost" value={php(row.line.landedPerUnit)} strong />
                    <CompareFigure
                      label="Fixed selling price"
                      value={row.sellingPrice > 0 ? php(row.sellingPrice, { decimals: 0 }) : "not set"}
                    />
                    <CompareFigure
                      label="Expected profit"
                      value={row.expectedProfit === null ? "needs a price" : php(row.expectedProfit)}
                      tone={row.expectedProfit < 0 ? "clay" : "teal"}
                    />
                    <CompareFigure
                      label="Margin"
                      value={row.margin === null ? "—" : pct(row.margin)}
                      tone={row.margin < 0 ? "clay" : "teal"}
                    />
                  </dl>
                </motion.article>
              );
            })}
          </motion.div>
        )}
      </div>
    </motion.section>
  );
}

function CompareFigure({ label, value, strong = false, tone }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-ink-3">{label}</dt>
      <dd
        className={clsx(
          "num mt-0.5 truncate",
          strong && "font-semibold",
          tone === "teal" && "text-teal",
          tone === "clay" && "text-clay",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * A stored quote figure as the field should show it. Nothing about the supplier
 * quote has a default, so an absent or zero figure is an EMPTY field the
 * operator is invited to fill, never a 0 presented as if it were quoted. A
 * historical batch's own saved figure comes back through untouched.
 */
const quoteFigure = (value) =>
  value == null || String(value).trim() === "" || M(value) === 0 ? "" : String(value);

/* ------------------------------------------------------------------- tray */

function BatchTray({ open, batch, items, consumables, origin, onClose, onSave, onDelete }) {
  const { settings, productsById, derived, freebies } = useStore();
  const rate = settings.php_to_vnd_rate;
  const desiredMarginPercent = settings.desired_profit_margin_percent;

  const [form, setForm] = useState(() => ({
    batch_name: batch?.batch_name ?? "",
    batch_id: batch?.batch_id ?? "",
    supplier: batch?.supplier ?? "",
    order_date: batch?.order_date ?? today(),
    expected_arrival: batch?.expected_arrival ?? "",
    preorder_cutoff_date: batch?.preorder_cutoff_date ?? "",
    local_shipping_php: String(batch?.local_shipping_php ?? batch?.domestic_shipping_php ?? batch?.shipping_php ?? settings.default_shipping_php ?? DEFAULT_BATCH_SHIPPING),
    other_costs_php: String(batch?.other_costs_php ?? batch?.other_cost_php ?? 0),
    currency: batch?.currency ?? "VND",
    exchange_rate: String(M(batch?.exchange_rate) > 0 ? M(batch.exchange_rate) : rate),
    actual_weight_kg: String(batch?.actual_weight_kg ?? ""),
    chargeable_weight_kg: String(batch?.chargeable_weight_kg ?? ""),
    intl_shipping_method: batch?.intl_shipping_method ?? "per_kg",
    shipping_allocation_method: batch?.shipping_allocation_method ?? "equal_per_item",
    intl_quote_basis: batch?.intl_quote_basis ?? "per_kg",
    // A stored zero means this batch was never quoted, so it shows as BLANK
    // rather than a literal 0 — and a historical batch that does carry a figure
    // keeps exactly the figure it was saved with.
    intl_combined_weight_kg: quoteFigure(batch?.intl_combined_weight_kg),
    intl_rate_vnd_per_kg: quoteFigure(batch?.intl_rate_vnd_per_kg),
    intl_gross_vnd: quoteFigure(batch?.intl_gross_vnd),
    intl_discount_mode: batch?.intl_discount_mode ?? "fixed",
    intl_discount_value: quoteFigure(batch?.intl_discount_value),
    intl_actual_paid_php: batch?.intl_actual_paid_php == null ? "" : String(batch.intl_actual_paid_php),
    status: batch?.status ?? "Planned",
    carrier: batch?.carrier ?? "",
    tracking_number: batch?.tracking_number ?? "",
    notes: batch?.notes ?? "",
  }));

  const [lines, setLines] = useState(() =>
    (items || []).map((l) => ({
      key: `k${l.id}`,
      product_id: l.product_id,
      variant_id: l.variant_id ?? null,
      quantity: M(l.quantity, 1),
      unit_cost_vnd: String(l.unit_cost_vnd ?? 0),
      unit_weight_kg: String(l.unit_weight_kg ?? ""),
      chargeable_weight_kg: String(l.chargeable_weight_kg ?? l.unit_weight_kg ?? ""),
      intl_allocation_php: M(l.intl_allocation_php),
      local_allocation_php: M(l.local_allocation_php),
      other_allocation_php: M(l.other_allocation_php),
      currency: l.currency || batch?.currency || "VND",
      exchange_rate:
        M(l.exchange_rate) > 0
          ? M(l.exchange_rate)
          : M(batch?.exchange_rate) > 0
            ? M(batch.exchange_rate)
            : rate,
    })),
  );

  /**
   * One editable row per consumable, always all three, because "we bought no
   * covers this time" is itself information. A stored row fills its own numbers.
   */
  const [supplies, setSupplies] = useState(() =>
    CONSUMABLES.map((meta) => {
      const stored = (consumables || []).find((c) => c.consumable_key === meta.key);
      return {
        key: meta.key,
        purchase_quantity: stored ? String(M(stored.purchase_quantity)) : "",
        unit_cost_php: stored ? String(M(stored.unit_cost_php)) : "",
      };
    }),
  );

  const [errors, setErrors] = useState({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerOrigin, capturePickerOrigin] = useOrigin();
  const [saving, setSaving] = useState(false);
  const [confirmReceive, setConfirmReceive] = useState(false);

  const alreadyReceived = batch?.status === "Received";
  const effectiveRate = M(form.exchange_rate) > 0 ? M(form.exchange_rate) : rate;

  const set = (key) => (e) => {
    const value = e?.target ? e.target.value : e;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  /** The consumable rows in the shape calc speaks, with their freebie attached. */
  const supplyRows = useMemo(
    () =>
      supplies.map((s) => ({
        consumable_key: s.key,
        purchase_quantity: M(s.purchase_quantity),
        unit_cost_php: M(s.unit_cost_php),
        freebie_id: consumableFreebie(freebies, s.key)?.id ?? null,
      })),
    [supplies, freebies],
  );

  const math = useMemo(
    () =>
      batchMath(
        {
          local_shipping_php: form.local_shipping_php,
          other_costs_php: form.other_costs_php,
          actual_weight_kg: form.actual_weight_kg,
          chargeable_weight_kg: form.chargeable_weight_kg,
          intl_shipping_method: form.intl_shipping_method,
          shipping_allocation_method: form.shipping_allocation_method,
          intl_quote_basis: form.intl_quote_basis,
          intl_combined_weight_kg: form.intl_combined_weight_kg,
          intl_rate_vnd_per_kg: form.intl_rate_vnd_per_kg,
          intl_gross_vnd: form.intl_gross_vnd,
          intl_discount_mode: form.intl_discount_mode,
          intl_discount_value: form.intl_discount_value,
          intl_actual_paid_php: form.intl_actual_paid_php,
        },
        lines.map((l) => ({
          ...l,
          quantity: M(l.quantity),
          unit_cost_vnd: M(l.unit_cost_vnd),
          unit_weight_kg: M(l.unit_weight_kg),
        })),
        effectiveRate,
        supplyRows,
      ),
    [form.local_shipping_php, form.other_costs_php, form.actual_weight_kg, form.chargeable_weight_kg, form.intl_shipping_method, form.shipping_allocation_method, form.intl_quote_basis, form.intl_combined_weight_kg, form.intl_rate_vnd_per_kg, form.intl_gross_vnd, form.intl_discount_mode, form.intl_discount_value, form.intl_actual_paid_php, effectiveRate, lines, supplyRows],
  );

  // "Fixed or percent?" is only a question once a discount exists, so the pills
  // stay out of sight until the operator types one.
  const discountEntered = String(form.intl_discount_value ?? "").trim() !== "" && M(form.intl_discount_value) > 0;

  /** Every unit at its standard selling price, against the full landed cost. */
  const priceByKey = useMemo(() => {
    const map = new Map();
    for (const line of lines) {
      const product = productsById.get(line.product_id);
      const variant = derived.variantsById.get(line.variant_id);
      const price =
        M(variant?.selling_price_php) > 0
          ? M(variant.selling_price_php)
          : M(product?.selling_price_php);
      map.set(unitKey(line.product_id, line.variant_id), price);
    }
    return map;
  }, [lines, productsById, derived.variantsById]);

  const profit = useMemo(() => batchProfitability(math, priceByKey), [math, priceByKey]);

  const labelFor = (line) =>
    unitLabel(
      productsById.get(line.product_id)?.name || "Removed paddle",
      derived.variantsById.get(line.variant_id)?.color,
    );

  // The standard kit — one cover, one edge tape, one overgrip piece per paddle —
  // measured against this batch's quantity, so a shortfall is visible here.
  const kit = useMemo(() => freebieKit(freebies, math.unitCount), [freebies, math.unitCount]);
  const freebiePerUnit = kit.costPerPaddle;

  const persist = async (status = form.status) => {
    const found = validate(RULES, form);
    if (!lines.length) found.lines = "Add at least one paddle";
    if (Object.keys(found).length) {
      setErrors(found);
      haptic([12, 40, 12]);
      return;
    }
    setSaving(true);
    try {
      const result = await onSave({
        id: batch?.id,
        batchRow: { ...form, status },
        items: lines.map((l, index) => ({
          product_id: l.product_id,
          variant_id: l.variant_id ?? null,
          quantity: M(l.quantity),
          unit_cost_vnd: M(l.unit_cost_vnd),
          unit_weight_kg: M(l.unit_weight_kg),
          chargeable_weight_kg: M(l.chargeable_weight_kg) || M(l.unit_weight_kg),
          intl_shipping_method: form.intl_shipping_method,
          intl_allocation_php: M(math.lines[index]?.allocIntlShipping),
          local_allocation_php: M(math.lines[index]?.allocDomesticShipping),
          other_allocation_php: M(math.lines[index]?.allocOther),
          currency: form.currency,
          exchange_rate: effectiveRate,
        })),
        consumables: supplyRows,
      });
      haptic(12);
      if (result?.stockApplied) {
        // Receiving is a finishing moment, so it gets the burst.
        confetti({
          particleCount: 55,
          spread: 58,
          startVelocity: 30,
          ticks: 110,
          origin: { y: 0.65 },
          colors: CONFETTI_COLORS,
          disableForReducedMotion: true,
        });
        toast.success(
          `${math.unitCount} unit${math.unitCount === 1 ? "" : "s"} added to stock${
            result.consumablesApplied > 0
              ? `, ${result.consumablesApplied} consumable pieces on the shelf`
              : ""
          }`,
        );
      } else {
        // Editing a received batch moves the shelf by the DIFFERENCE, and that
        // correction is worth saying out loud rather than silently applying.
        const moved = M(result?.consumablesApplied);
        toast.success(
          moved !== 0
            ? `Batch updated · ${moved > 0 ? "+" : "−"}${Math.abs(moved)} consumable piece${
                Math.abs(moved) === 1 ? "" : "s"
              } on the shelf`
            : batch
              ? "Batch updated"
              : "Batch created",
        );
      }
      onClose();
    } catch {
      toast.error("Could not save the batch. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const submit = () => {
    if (form.status === "Received" && !alreadyReceived) {
      const found = validate(RULES, form);
      if (!lines.length) found.lines = "Add at least one paddle";
      if (Object.keys(found).length) {
        setErrors(found);
        haptic([12, 40, 12]);
        return;
      }
      setConfirmReceive(true);
      return;
    }
    persist();
  };

  return (
    <>
      <Tray
        open={open}
        onClose={onClose}
        origin={origin}
        wide
        title={batch ? "Edit batch" : "New batch"}
        subtitle={
          math.allocatable
            ? `${math.unitCount} item${math.unitCount === 1 ? "" : "s"} · ${php(math.allocPerUnit)} shipping each`
            : "Add batch shipping and what came in it, the rest works itself out"
        }
        footer={
          <div className="flex gap-2">
            <button type="button" className="btn-quiet flex-1" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary flex-[1.6]"
              disabled={saving}
              onClick={submit}
            >
              <MorphLabel>
                {saving
                  ? "Saving…"
                  : form.status === "Received" && !alreadyReceived
                    ? "Receive batch"
                    : batch
                      ? "Save changes"
                      : "Save batch"}
              </MorphLabel>
            </button>
          </div>
        }
      >
        <div className="space-y-3 pt-1">
          <Field label="Batch name" error={errors.batch_name} required>
            <Input
              value={form.batch_name}
              onChange={set("batch_name")}
              error={errors.batch_name}
              placeholder="March restock"
              data-autofocus
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
            <Field label="Supplier">
              <Input value={form.supplier} onChange={set("supplier")} placeholder="Hanoi supplier" />
            </Field>
            <Field label="Status">
              <Select value={form.status} onChange={set("status")}>
                {BATCH_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 xs:grid-cols-3">
            <Field label="Batch ID">
              <Input value={form.batch_id} onChange={set("batch_id")} placeholder="Supplier reference" />
            </Field>
            <Field label="Currency">
              <Select value={form.currency} onChange={set("currency")}>
                <option value="VND">VND</option>
                <option value="PHP">PHP</option>
              </Select>
            </Field>
            <Field label="Exchange rate" hint="per ₱1">
              <Input numeric value={form.exchange_rate} onChange={set("exchange_rate")} />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
            <Field label="Ordered on">
              <Input type="date" value={form.order_date || ""} onChange={set("order_date")} />
            </Field>
            <Field label="Expected arrival">
              <Input
                type="date"
                value={form.expected_arrival || ""}
                onChange={set("expected_arrival")}
              />
            </Field>
          </div>

          {/*
            Pre-order cutoff varies per batch, so it lives here, not as a
            single global setting. Both this and expected arrival are
            optional — the storefront only shows an "order by" / "ships in"
            note on a paddle when the relevant batch actually has the date,
            never a guess.
          */}
          <Field
            label="Pre-order cutoff date"
            hint="Shown on the storefront for any paddle sourced from this batch — the last day to order before it ships without them."
          >
            <Input
              type="date"
              value={form.preorder_cutoff_date || ""}
              onChange={set("preorder_cutoff_date")}
            />
          </Field>

          {/* Shipment tracking, revealed only once the batch has actually left. */}
          <AnimatePresence initial={false}>
            {form.status !== "Planned" && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={spring}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
                  <Field label="Carrier">
                    <Select value={form.carrier} onChange={set("carrier")}>
                      <option value="">Not set</option>
                      {CARRIERS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Tracking number">
                    <Input
                      value={form.tracking_number}
                      onChange={set("tracking_number")}
                      placeholder="JT0012345678"
                      autoCapitalize="characters"
                    />
                  </Field>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div>
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 px-0.5">
              <span className="eyebrow">Paddles in this batch</span>
              {errors.lines && (
                <span className="min-w-0 break-words text-micro text-clay">{errors.lines}</span>
              )}
            </div>

            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {lines.map((line, index) => {
                  const product = productsById.get(line.product_id);
                  const variant = derived.variantsById.get(line.variant_id);
                  const allocLine = math.lines[index];
                  const profitLine = profit.lines[index];
                  const unit = unitMath({
                    sourceVnd: line.unit_cost_vnd,
                    rate: effectiveRate,
                    shipAllocPerUnit:
                      M(allocLine?.shipPerUnit) + M(allocLine?.otherPerUnit),
                    // A colour prices itself where it differs, and falls back to
                    // the paddle where it does not.
                    sellingPrice:
                      M(variant?.selling_price_php) > 0
                        ? variant.selling_price_php
                        : product?.selling_price_php,
                    desiredMarginPercent,
                  });
                  return (
                    <motion.div
                      key={line.key}
                      layout
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                      transition={spring}
                      className="overflow-hidden rounded-md border border-line bg-paper p-2 xs:p-2.5"
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-eta font-medium">
                            {product?.name || "Removed paddle"}
                          </p>
                          <p className="num mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 truncate text-micro text-ink-3">
                            <span>{variant?.sku || product?.sku}</span>
                            {variant && <Chip tone="gray">{variant.color}</Chip>}
                          </p>
                        </div>
                        <button
                          type="button"
                          aria-label={`Remove ${labelFor(line)}`}
                          onClick={() => {
                            setLines((prev) => prev.filter((l) => l.key !== line.key));
                            haptic(8);
                          }}
                          className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-3
                                     transition-transform duration-150 active:scale-90 active:bg-line-soft"
                        >
                          <X size={15} />
                        </button>
                      </div>

                      <div className="mt-2 grid grid-cols-2 gap-2 xs:grid-cols-4">
                        <label className="block min-w-0">
                          <span className="mb-1 block truncate text-micro text-ink-3">Quantity</span>
                          <Input
                            numeric
                            value={line.quantity}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((l) =>
                                  l.key === line.key ? { ...l, quantity: e.target.value } : l,
                                ),
                              )
                            }
                            className="!min-h-[40px] !py-1.5"
                          />
                        </label>
                        <label className="block min-w-0">
                          <span className="mb-1 block truncate text-micro text-ink-3">Unit cost ₫</span>
                          <Input
                            numeric
                            value={line.unit_cost_vnd}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((l) =>
                                  l.key === line.key ? { ...l, unit_cost_vnd: e.target.value } : l,
                                ),
                              )
                            }
                            className="!min-h-[40px] !py-1.5"
                          />
                        </label>
                        <label className="block min-w-0">
                          <span className="mb-1 block truncate text-micro text-ink-3">Weight kg</span>
                          <Input
                            numeric
                            value={line.unit_weight_kg}
                            placeholder="0"
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((l) =>
                                  l.key === line.key ? { ...l, unit_weight_kg: e.target.value } : l,
                                ),
                              )
                            }
                            className="!min-h-[40px] !py-1.5"
                          />
                        </label>
                        <label className="block min-w-0">
                          <span className="mb-1 block truncate text-micro text-ink-3">Chargeable kg</span>
                          <Input
                            numeric
                            value={line.chargeable_weight_kg}
                            placeholder={line.unit_weight_kg || "0"}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((l) =>
                                  l.key === line.key
                                    ? { ...l, chargeable_weight_kg: e.target.value }
                                    : l,
                                ),
                              )
                            }
                            className="!min-h-[40px] !py-1.5"
                          />
                        </label>
                      </div>

                      <div className="mt-2 border-t border-line pt-2">
                        <CalcRows
                          dense
                          rows={[
                            {
                              label: "VND Cost",
                              value: unit.hasVnd ? unit.vndCost : null,
                              display: vnd(unit.vndCost),
                              placeholder: "add a cost",
                            },
                            {
                              label: "PHP Supplier Cost",
                              value: unit.supplierPhp,
                              display: php(unit.supplierPhp),
                              roll: true,
                              placeholder: "set a rate",
                            },
                            {
                              label: "Combined Shipping Allocation",
                              value: math.allocatable ? unit.alloc : null,
                              display: php(unit.alloc),
                              accent: true,
                              roll: true,
                              note: math.allocatable
                                ? allocationNote(allocLine, {
                                    basis: math.allocationBasis,
                                    context:
                                      math.allocationBasis === "weight"
                                        ? `${(M(allocLine?.chargeableWeightKg) * M(allocLine?.qty)).toFixed(2)} kg of ${math.totalChargeableWeightKg.toFixed(2)} kg`
                                        : `${M(allocLine?.qty)} of ${math.unitCount} units`,
                                  })
                                : undefined,
                              placeholder: "add a quantity",
                            },
                            {
                              label: "Landed Cost",
                              value: unit.landed,
                              display: php(unit.landed),
                              rule: true,
                              strong: true,
                              roll: true,
                            },
                            {
                              label: "Standard Selling Price",
                              value: unit.price,
                              display: php(unit.price, { decimals: 0 }),
                              placeholder: "not set",
                            },
                            {
                              label: "Actual Profit",
                              value: unit.profit,
                              display: php(unit.profit),
                              rule: true,
                              strong: true,
                              roll: true,
                              tone: unit.profit !== null && unit.profit < 0 ? "clay" : "teal",
                              placeholder: "needs a price",
                            },
                          ]}
                        />

                        {/* The line as a whole, not just one unit of it: what
                            the quantity carries in shipping, and what the line
                            is expected to make. */}
                        <dl className="mt-2 space-y-1 border-t border-line pt-2 text-micro">
                          <div className="flex items-baseline justify-between gap-2">
                            <dt className="min-w-0 break-words text-ink-3">
                              Line shipping allocation
                              <span className="num ml-1 text-ink-4">
                                × {M(allocLine?.qty)}
                              </span>
                            </dt>
                            <dd className="num shrink-0 whitespace-nowrap text-cobalt">
                              <RollingNumber value={php(M(allocLine?.allocShipping))} />
                            </dd>
                          </div>
                          <div className="flex items-baseline justify-between gap-2">
                            <dt className="min-w-0 break-words text-ink-3">
                              Expected profit on this line
                            </dt>
                            <dd
                              className={clsx(
                                "num shrink-0 whitespace-nowrap font-medium",
                                profitLine?.expectedLineProfit == null
                                  ? "text-ink-4"
                                  : profitLine.expectedLineProfit < 0
                                    ? "text-clay"
                                    : "text-teal",
                              )}
                            >
                              {profitLine?.expectedLineProfit == null ? (
                                "needs a price"
                              ) : (
                                <>
                                  <RollingNumber
                                    value={php(profitLine.expectedLineProfit, { decimals: 0 })}
                                  />
                                  <span className="ml-1 font-normal text-ink-4">
                                    {pct(M(profitLine.expectedMargin))}
                                  </span>
                                </>
                              )}
                            </dd>
                          </div>
                          {/* Silent unless this line would sell below the floor. */}
                          <AnimatePresence initial={false}>
                            {unit.belowSafePrice && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={spring}
                                className="overflow-hidden"
                              >
                                <div className="flex items-baseline justify-between gap-2 pt-0.5">
                                  <dt className="min-w-0 break-words text-clay">
                                    Under the safe floor
                                  </dt>
                                  <dd className="num shrink-0 whitespace-nowrap text-clay">
                                    {php(unit.minimumSafePrice, { decimals: 0 })}
                                  </dd>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </dl>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              <button
                type="button"
                onClick={(e) => {
                  capturePickerOrigin(e);
                  setPickerOpen(true);
                  setErrors((prev) => ({ ...prev, lines: undefined }));
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-line
                           bg-surface py-2.5 text-eta font-medium text-ink-2 transition-[transform,background-color]
                           duration-150 active:scale-[0.99] active:bg-paper"
              >
                <Plus size={15} weight="bold" />
                Add a paddle
              </button>
            </div>
          </div>

          {/* ------------------------------------------------ consumables */}
          <div>
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 px-0.5">
              <span className="eyebrow">
                Consumables bought
                {/* The stem stays, only the fate of the pieces morphs. */}
                <span className="ml-1.5 normal-case tracking-normal text-ink-4">
                  <MorphLabel>
                    {alreadyReceived ? "· on the shelf" : "· on receipt"}
                  </MorphLabel>
                </span>
              </span>
              <AnimatePresence initial={false}>
                {math.consumableCost > 0 && (
                  <motion.span
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={spring}
                    className="num shrink-0 whitespace-nowrap text-micro font-semibold text-plum"
                  >
                    <RollingNumber value={php(math.consumableCost, { decimals: 0 })} />
                  </motion.span>
                )}
              </AnimatePresence>
            </div>

            <div className="space-y-2">
              {supplies.map((supply) => {
                const line = consumableLine({
                  consumable_key: supply.key,
                  purchase_quantity: supply.purchase_quantity,
                  unit_cost_php: supply.unit_cost_php,
                });
                const meta = line.meta;
                const freebie = consumableFreebie(freebies, supply.key);
                const patch = (patchValues) =>
                  setSupplies((prev) =>
                    prev.map((s) => (s.key === supply.key ? { ...s, ...patchValues } : s)),
                  );
                return (
                  <motion.div
                    key={supply.key}
                    layout
                    transition={spring}
                    className="overflow-hidden rounded-md border border-plum/25 bg-plum-wash p-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-eta font-medium">{meta.label}</p>
                        <p className="mt-0.5 break-words text-micro text-ink-3">
                          bought by the {meta.buyUnit}
                          {meta.piecesPerUnit > 1
                            ? ` · 1 pack = ${meta.piecesPerUnit} pieces`
                            : ""}
                        </p>
                      </div>
                      <Chip
                        tone={!freebie ? "gray" : alreadyReceived && line.pieces > 0 ? "teal" : "plum"}
                      >
                        {!freebie
                          ? "no freebie"
                          : alreadyReceived && line.pieces > 0
                            ? `${M(freebie.quantity)} on shelf · received`
                            : `${M(freebie.quantity)} on shelf`}
                      </Chip>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <label className="block min-w-0">
                        <span className="mb-1 block truncate text-micro text-ink-3">
                          {meta.buyUnitPlural} bought
                        </span>
                        <Input
                          numeric
                          value={supply.purchase_quantity}
                          placeholder="0"
                          onChange={(e) => patch({ purchase_quantity: e.target.value })}
                          className="!min-h-[40px] !py-1.5"
                        />
                      </label>
                      <label className="block min-w-0">
                        <span className="mb-1 block truncate text-micro text-ink-3">
                          Cost per {meta.buyUnit} ₱
                        </span>
                        <Input
                          numeric
                          value={supply.unit_cost_php}
                          placeholder="0"
                          onChange={(e) => patch({ unit_cost_php: e.target.value })}
                          className="!min-h-[40px] !py-1.5"
                        />
                      </label>
                    </div>

                    {/* The two derived figures grow in the moment they exist. */}
                    <AnimatePresence initial={false}>
                      {line.pieces > 0 && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={spring}
                          className="overflow-hidden"
                        >
                          <dl className="mt-2 space-y-1 border-t border-plum/20 pt-2 text-micro">
                            <div className="flex items-baseline justify-between gap-2">
                              <dt className="min-w-0 break-words text-ink-3">
                                Pieces received
                                {meta.piecesPerUnit > 1 && (
                                  <span className="num text-ink-4">
                                    {" "}
                                    · {line.purchaseQty} × {meta.piecesPerUnit}
                                  </span>
                                )}
                              </dt>
                              <dd className="num shrink-0 whitespace-nowrap font-semibold">
                                <RollingNumber value={line.pieces} />
                              </dd>
                            </div>
                            <div className="flex items-baseline justify-between gap-2">
                              <dt className="min-w-0 break-words text-ink-3">Cost per piece</dt>
                              <dd className="num shrink-0 whitespace-nowrap font-semibold text-plum">
                                <RollingNumber value={php(line.perPiece)} />
                              </dd>
                            </div>
                            {/* A received batch re-prices the freebie, so the
                                change to that number shows itself here first. */}
                            <AnimatePresence initial={false}>
                              {alreadyReceived &&
                                freebie &&
                                Math.abs(M(freebie.unit_cost) - line.perPiece) >= 0.01 && (
                                  <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={spring}
                                    className="overflow-hidden"
                                  >
                                    <div className="flex items-baseline justify-between gap-2 pt-1">
                                      <dt className="min-w-0 break-words text-ink-3">
                                        {meta.singular} is costed at{" "}
                                        <span className="num text-ink-4">
                                          {php(M(freebie.unit_cost))}
                                        </span>
                                      </dt>
                                      <dd className="shrink-0 whitespace-nowrap text-cobalt">
                                        saving re-prices it
                                      </dd>
                                    </div>
                                  </motion.div>
                                )}
                            </AnimatePresence>
                            <div className="flex items-baseline justify-between gap-2 border-t border-plum/20 pt-1 font-semibold text-plum">
                              <dt className="min-w-0 break-words">In this batch's landed cost</dt>
                              <dd className="num shrink-0 whitespace-nowrap">
                                <RollingNumber value={php(line.totalCost)} />
                              </dd>
                            </div>
                          </dl>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>

            <p className="mt-2 break-words px-0.5 text-micro leading-relaxed text-ink-3">
              Overgrips come by the pack, {OVERGRIPS_PER_PACK} pieces each; covers and edge tapes
              come by the piece. Receiving this batch puts the pieces on the freebie shelf and sets
              each freebie's cost to what this batch actually paid per piece.
            </p>
          </div>

          <div className="rounded-md border border-cobalt/25 bg-cobalt-wash p-2.5 xs:p-3">
            <p className="eyebrow !text-cobalt">Vietnam → Philippines supplier quote</p>
            <p className="mt-1 break-words text-micro leading-relaxed text-cobalt/80">
              Every batch is quoted on its own. Nothing is filled in for you, and saving a batch
              never re-rates the ones already saved.
            </p>

            <div className="mt-2.5 space-y-3">
              <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
                <Field label="Actual shipment weight" hint="optional kg">
                  <Input numeric value={form.actual_weight_kg} onChange={set("actual_weight_kg")} placeholder="scale weight" />
                </Field>
                <Field label="Chargeable weight" hint="optional kg">
                  <Input numeric value={form.chargeable_weight_kg} onChange={set("chargeable_weight_kg")} placeholder="courier weight" />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
                <Field label="International shipping method">
                  <Select value={form.intl_shipping_method} onChange={set("intl_shipping_method")}>
                    <option value="per_kg">Per kg quote</option>
                    <option value="total_batch">Whole batch quote</option>
                    <option value="per_item">Per item</option>
                    <option value="manual">Manual line allocation</option>
                  </Select>
                </Field>
                <Field label="Allocation method">
                  <Select value={form.shipping_allocation_method} onChange={set("shipping_allocation_method")}>
                    <option value="equal_per_item">By units</option>
                    <option value="by_weight">By weight</option>
                  </Select>
                </Field>
              </div>

              {/* The basis first: it decides which fields are even relevant. */}
              <Field group label="How the supplier quoted it" hint="per batch">
                <SegmentedPills
                  idPrefix="quote-basis"
                  label="Quote basis"
                  value={form.intl_quote_basis}
                  onChange={set("intl_quote_basis")}
                  options={[
                    { value: "per_kg", label: "Rate per kg" },
                    { value: "flat_total", label: "Flat total" },
                  ]}
                />
              </Field>

              {/* Only the fields that basis actually needs. The container's own
                  height TRAVELS via layout while the outgoing set is popped out
                  of flow, so the form reads as one thing changing shape rather
                  than two forms trading places. */}
              {/* `relative` because popLayout takes the outgoing set out of flow. */}
              <motion.div layout transition={spring} className="relative">
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.div
                    key={form.intl_quote_basis}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={spring}
                    className="w-full"
                  >
                    {form.intl_quote_basis === "per_kg" ? (
                      <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
                        <Field label="Rate" hint="₫ per kg" error={errors.intl_rate_vnd_per_kg}>
                          <Input
                            numeric
                            value={form.intl_rate_vnd_per_kg}
                            onChange={set("intl_rate_vnd_per_kg")}
                            error={errors.intl_rate_vnd_per_kg}
                            placeholder={`e.g. ${EXAMPLE_INTL_RATE_VND_PER_KG.toLocaleString()}`}
                            aria-label="Supplier rate in VND per kilogram"
                          />
                        </Field>
                        <Field
                          label="Combined shipment weight"
                          hint="kg"
                          error={errors.intl_combined_weight_kg}
                        >
                          <Input
                            numeric
                            value={form.intl_combined_weight_kg}
                            onChange={set("intl_combined_weight_kg")}
                            error={errors.intl_combined_weight_kg}
                            placeholder={
                              math.totalWeightKg > 0
                                ? `${math.totalWeightKg.toFixed(2)} from the lines`
                                : "kg on the quote"
                            }
                            aria-label="Combined shipment weight in kilograms"
                          />
                        </Field>
                      </div>
                    ) : (
                      <Field label="Flat quote total" hint="₫ total" error={errors.intl_gross_vnd}>
                        <Input
                          numeric
                          value={form.intl_gross_vnd}
                          onChange={set("intl_gross_vnd")}
                          error={errors.intl_gross_vnd}
                          placeholder={`e.g. ${(EXAMPLE_INTL_RATE_VND_PER_KG * 6).toLocaleString()}`}
                          aria-label="Flat supplier quote total in VND"
                        />
                      </Field>
                    )}
                  </motion.div>
                </AnimatePresence>
              </motion.div>

              <Field
                label="Supplier discount"
                hint={
                  discountEntered
                    ? form.intl_discount_mode === "percent"
                      ? "optional %"
                      : "optional ₫"
                    : "optional"
                }
                error={errors.intl_discount_value}
              >
                <Input
                  numeric
                  value={form.intl_discount_value}
                  onChange={set("intl_discount_value")}
                  error={errors.intl_discount_value}
                  placeholder="none"
                  aria-label="Supplier discount amount"
                />
              </Field>

              {/* "Fixed or percent?" is only a question once a discount exists,
                  so the pills GROW IN under the amount the moment one is typed. */}
              <AnimatePresence initial={false}>
                {discountEntered && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={spring}
                    className="overflow-hidden"
                  >
                    <Field group label="That discount is" hint="₫ or %" className="pt-0.5">
                      <SegmentedPills
                        idPrefix="discount-mode"
                        label="Discount type"
                        value={form.intl_discount_mode}
                        onChange={set("intl_discount_mode")}
                        options={[
                          { value: "fixed", label: "₫ off" },
                          { value: "percent", label: "% off" },
                        ]}
                      />
                    </Field>
                  </motion.div>
                )}
              </AnimatePresence>

              <Field
                label="Actually paid"
                hint="optional ₱"
                error={errors.intl_actual_paid_php}
              >
                <Input
                  numeric
                  value={form.intl_actual_paid_php}
                  onChange={set("intl_actual_paid_php")}
                  error={errors.intl_actual_paid_php}
                  placeholder="uses the quote"
                  aria-label="Actual international freight paid in PHP"
                />
              </Field>
            </div>

            {/* The quote's working. Until a figure is entered this says so
                plainly rather than printing a row of ₱0.00 as if it were real. */}
            <AnimatePresence initial={false} mode="wait">
              {math.quoteEntered ? (
                <motion.dl
                  key="quote-figures"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={spring}
                  className="mt-3 overflow-hidden border-t border-cobalt/20 text-eta"
                >
                  <div className="space-y-1.5 pt-2">
                    <div className="flex justify-between gap-2 xs:gap-3">
                      <dt className="min-w-0 break-words text-ink-2">
                        Gross quote
                        {math.quoteBasis === "per_kg" && (
                          <span className="num text-ink-4">
                            {" "}
                            · {math.quoteWeightKg.toFixed(2)} kg ×{" "}
                            {Math.round(math.intlRate).toLocaleString()}₫
                            {math.quoteWeightSource === "lines" ? " from the lines" : ""}
                          </span>
                        )}
                      </dt>
                      <dd className="num shrink-0 whitespace-nowrap">{vnd(math.grossIntlVnd)}</dd>
                    </div>
                    <AnimatePresence initial={false}>
                      {math.intlDiscountVnd > 0 && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={spring}
                          className="overflow-hidden"
                        >
                          <div className="flex justify-between gap-2 xs:gap-3">
                            <dt className="min-w-0 break-words text-ink-2">
                              Supplier discount
                              <span className="num text-ink-4">
                                {" "}
                                ·{" "}
                                {math.intlDiscountMode === "percent"
                                  ? pct(math.intlDiscountValue, 0)
                                  : "fixed"}
                              </span>
                            </dt>
                            <dd className="num shrink-0 whitespace-nowrap text-teal">
                              −{vnd(math.intlDiscountVnd)}
                            </dd>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <div className="flex justify-between gap-2 xs:gap-3">
                      <dt className="min-w-0 break-words text-ink-2">Net quote</dt>
                      <dd className="num shrink-0 whitespace-nowrap">
                        {vnd(math.discountedIntlVnd)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2 border-t border-cobalt/20 pt-1.5 font-semibold xs:gap-3">
                      <dt className="min-w-0 break-words text-ink-2">
                        Converted quote{" "}
                        <span className="num font-normal text-ink-4">
                          ÷ {Math.round(effectiveRate).toLocaleString()}₫
                        </span>
                      </dt>
                      <dd className="num shrink-0 whitespace-nowrap">
                        <RollingNumber value={php(math.intlQuotedPhp)} />
                      </dd>
                    </div>
                    <AnimatePresence initial={false}>
                      {math.intlActualPhp !== null && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={spring}
                          className="overflow-hidden"
                        >
                          <div className="space-y-1.5 pt-1.5">
                            <div className="flex justify-between gap-2 xs:gap-3">
                              <dt className="min-w-0 break-words text-ink-2">
                                Actual PHP paid{" "}
                                <span className="text-ink-4">· Wise fee included</span>
                              </dt>
                              <dd className="num shrink-0 whitespace-nowrap">
                                <RollingNumber value={php(math.intlActualPhp)} />
                              </dd>
                            </div>
                            <div className="flex justify-between gap-2 xs:gap-3">
                              <dt className="min-w-0 break-words text-ink-2">Variance vs quote</dt>
                              <dd
                                className={clsx(
                                  "num shrink-0 whitespace-nowrap font-semibold",
                                  math.intlVariancePhp > 0.005
                                    ? "text-clay"
                                    : math.intlVariancePhp < -0.005
                                      ? "text-teal"
                                      : "text-ink-3",
                                )}
                              >
                                {php(math.intlVariancePhp, { sign: true })}
                              </dd>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <div className="flex items-baseline justify-between gap-2 border-t border-cobalt/20 pt-1.5 text-[15px] font-semibold text-cobalt xs:gap-3">
                      <dt className="min-w-0 break-words">
                        Vietnam→Manila payable{" "}
                        {/* Which figure this is MORPHS the moment an actual paid
                            amount lands, because the number beside it is
                            changing meaning. */}
                        <MorphLabel className="font-normal text-cobalt/70">
                          {math.intlActualPhp !== null ? "· actual paid" : "· quoted"}
                        </MorphLabel>
                      </dt>
                      <dd className="num shrink-0 whitespace-nowrap">
                        <RollingNumber value={php(math.intlPayablePhp)} />
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-2 xs:gap-3">
                      <dt className="min-w-0 break-words text-ink-2">Margin</dt>
                      <dd className={clsx("num shrink-0 whitespace-nowrap", profit.margin < 0 ? "text-clay" : "text-teal")}>
                        {pct(profit.margin)}
                      </dd>
                    </div>
                  </div>
                </motion.dl>
              ) : (
                <motion.p
                  key="quote-empty"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={spring}
                  className="mt-3 overflow-hidden break-words border-t border-cobalt/20 text-micro leading-relaxed text-ink-3"
                >
                  <span className="block pt-2">
                    No international quote on this batch yet, so only Manila→CDO is allocated.
                    {form.intl_quote_basis === "per_kg"
                      ? " Enter the rate the supplier gave you for this shipment."
                      : " Enter the flat total the supplier gave you for this shipment."}
                  </span>
                </motion.p>
              )}
            </AnimatePresence>

            {/* The second leg stays its own manual peso figure, never derived. */}
            <div className="mt-3 border-t border-cobalt/20 pt-2.5">
              <p className="eyebrow !text-cobalt">Manila → CDO domestic leg</p>
              <div className="mt-2 grid grid-cols-1 gap-3 xs:grid-cols-2">
                <Field label="Domestic shipping" hint="manual ₱" error={errors.local_shipping_php}>
                  <Input numeric value={form.local_shipping_php} onChange={set("local_shipping_php")} error={errors.local_shipping_php} />
                </Field>
                <Field label="Other batch costs" hint="₱" error={errors.other_costs_php}>
                  <Input numeric value={form.other_costs_php} onChange={set("other_costs_php")} error={errors.other_costs_php} />
                </Field>
              </div>
              <p className="mt-2 break-words text-micro leading-relaxed text-cobalt/80">
                A separate manual peso figure, never derived from the supplier quote. Both legs are
                added together and allocated below.
              </p>
            </div>
          </div>

          <div className="rounded-md border border-cobalt/25 bg-cobalt-wash p-2.5 xs:p-3">
            <p className="eyebrow !text-cobalt">Combined shipping allocation</p>
            <dl className="mt-2 space-y-1.5 text-eta">
              {/* The two legs, then their sum — the combined figure is never
                  asserted without the parts it was made of sitting above it. */}
              <div className="flex justify-between gap-2 xs:gap-3">
                <dt className="min-w-0 break-words text-ink-2">
                  Vietnam→Manila{" "}
                  <MorphLabel className="text-ink-4">
                    {math.intlActualPhp !== null
                      ? "· actual paid"
                      : math.quoteEntered
                        ? "· quoted"
                        : "· not quoted yet"}
                  </MorphLabel>
                </dt>
                <dd className="num shrink-0 whitespace-nowrap">
                  <RollingNumber value={php(math.intlPayablePhp)} />
                </dd>
              </div>
              <div className="flex justify-between gap-2 xs:gap-3">
                <dt className="min-w-0 break-words text-ink-2">
                  Manila→CDO <span className="text-ink-4">· entered</span>
                </dt>
                <dd className="num shrink-0 whitespace-nowrap">
                  <RollingNumber value={php(math.domesticShipping)} />
                </dd>
              </div>
              <div className="flex justify-between gap-2 border-t border-cobalt/20 pt-1.5 font-semibold xs:gap-3">
                <dt className="min-w-0 break-words text-ink-2">
                  Total batch shipping{" "}
                  <span className="font-normal text-ink-4">· both legs</span>
                </dt>
                <dd className="num shrink-0 whitespace-nowrap">
                  <RollingNumber value={php(math.shipping)} />
                </dd>
              </div>
              {math.other > 0 && (
                <div className="flex justify-between gap-2 xs:gap-3">
                  <dt className="min-w-0 break-words text-ink-2">Other batch costs</dt>
                  <dd className="num shrink-0 whitespace-nowrap">{php(math.other)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-2 xs:gap-3">
                <dt className="min-w-0 break-words text-ink-2">Total quantity in batch</dt>
                <dd className="num shrink-0 whitespace-nowrap">
                  <RollingNumber value={math.unitCount} />
                </dd>
              </div>
              <div className="flex justify-between gap-2 xs:gap-3">
                <dt className="min-w-0 break-words text-ink-2">
                  Average per paddle unit
                </dt>
                <dd className="num shrink-0 whitespace-nowrap">
                  <RollingNumber value={php(math.shipPerUnit)} />
                </dd>
              </div>
              <div className="flex justify-between gap-2 xs:gap-3">
                <dt className="min-w-0 break-words text-ink-2">Exchange rate</dt>
                <dd className="num shrink-0 whitespace-nowrap">
                  {Math.round(effectiveRate).toLocaleString()}₫ / ₱1
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2 border-t border-cobalt/20 pt-1.5 text-[15px] font-semibold text-cobalt xs:gap-3">
                <dt className="min-w-0 break-words">Shipping allocation basis</dt>
                <dd className="num shrink-0 whitespace-nowrap">{math.allocationBasis === "weight" ? "By weight" : "By units"}</dd>
              </div>
              {/* Proof the split lost nothing. Only shown once there is a split. */}
              {math.allocatable && math.shipping > 0 && (
                <div className="flex items-baseline justify-between gap-2 xs:gap-3">
                  <dt className="min-w-0 break-words text-ink-2">
                    Allocated across the lines
                    <span className="num ml-1 text-ink-4">
                      {php(math.allocatedIntlTotal)} + {php(math.allocatedDomesticTotal)}
                    </span>
                  </dt>
                  <dd
                    className={clsx(
                      "num shrink-0 whitespace-nowrap",
                      math.allocationReconciles ? "text-teal" : "text-clay",
                    )}
                  >
                    {php(math.allocatedShippingTotal)}
                    <span className="ml-1 font-normal">
                      {math.allocationReconciles ? "· balances" : "· off by " + php(math.allocationRemainder)}
                    </span>
                  </dd>
                </div>
              )}
            </dl>
            <p className="mt-2 break-words text-micro leading-relaxed text-cobalt/80">
              {math.allocationBasis === "weight"
                ? `Each leg is allocated by the line's chargeable weight share across ${math.totalChargeableWeightKg.toFixed(2)} kg, rounded to the centavo, and a line's combined figure is its two legs added together — so the lines add back up to ${php(math.shipping)} exactly.`
                : `With no usable weights, each leg is allocated by quantity as a transparent fallback, rounded to the centavo, and a line's combined figure is its two legs added together — so the lines add back up to ${php(math.shipping)} exactly.`}
            </p>
          </div>

          <div className="rounded-md border border-line bg-paper p-2.5 xs:p-3">
            <p className="eyebrow mb-2">Batch landed cost</p>
            <dl className="space-y-1.5 text-eta">
              <div className="flex justify-between gap-2 xs:gap-3">
                <dt className="shrink-0 text-ink-3">Product cost</dt>
                <dd className="num min-w-0 break-words text-right">
                  {vnd(math.goodsVnd)} <span className="text-ink-3">·</span> {php(math.goodsPhp)}
                </dd>
              </div>
              <div className="flex justify-between gap-2 xs:gap-3">
                <dt className="min-w-0 break-words text-ink-3">International allocation</dt>
                <dd className="num shrink-0 whitespace-nowrap">{php(math.intlPayablePhp)}</dd>
              </div>
              <div className="flex justify-between gap-2 xs:gap-3">
                <dt className="min-w-0 break-words text-ink-3">Local allocation</dt>
                <dd className="num shrink-0 whitespace-nowrap">{php(math.domesticShipping)}</dd>
              </div>
              <div className="flex justify-between gap-2 xs:gap-3">
                <dt className="min-w-0 break-words text-ink-3">Other allocation</dt>
                <dd className="num shrink-0 whitespace-nowrap">{php(math.other)}</dd>
              </div>
              <AnimatePresence initial={false}>
                {math.consumableCost > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={spring}
                    className="overflow-hidden"
                  >
                    <div className="flex justify-between gap-2 xs:gap-3">
                      <dt className="min-w-0 break-words text-plum">
                        Consumables{" "}
                        <span className="num text-ink-4">· {math.consumablePieces} pieces</span>
                      </dt>
                      <dd className="num shrink-0 whitespace-nowrap text-plum">
                        <RollingNumber value={php(math.consumableCost)} />
                      </dd>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="flex justify-between gap-2 border-t border-line pt-1.5 text-[15px] font-semibold xs:gap-3">
                <dt className="min-w-0">Batch landed cost</dt>
                <dd className="num shrink-0 whitespace-nowrap">
                  <RollingNumber value={php(math.landedTotalPhp)} />
                </dd>
              </div>
              <div className="flex justify-between gap-2 xs:gap-3">
                <dt className="min-w-0 break-words text-ink-3">Total units</dt>
                <dd className="num shrink-0 whitespace-nowrap">{math.unitCount}</dd>
              </div>
              <div className="flex justify-between gap-2 xs:gap-3">
                <dt className="min-w-0 break-words text-ink-3">Average landed cost</dt>
                <dd className="num shrink-0 whitespace-nowrap">
                  {php(math.unitCount > 0 ? math.landedTotalPhp / math.unitCount : 0)}
                </dd>
              </div>
            </dl>
          </div>

          {/* ------------------------------------------ batch profitability */}
          <AnimatePresence initial={false}>
            {math.allocatable && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={spring}
                className="overflow-hidden"
              >
                <div className="rounded-md border border-cobalt/25 bg-cobalt-wash p-2.5 xs:p-3">
                  <p className="eyebrow !text-cobalt">Batch profitability</p>
                  <dl className="mt-2 space-y-1.5 text-eta">
                    <div className="flex justify-between gap-2 xs:gap-3">
                      <dt className="min-w-0 break-words text-ink-2">
                        Expected sales{" "}
                        <span className="text-ink-4">· at standard prices</span>
                      </dt>
                      <dd className="num shrink-0 whitespace-nowrap">
                        <RollingNumber value={php(profit.productRevenue, { decimals: 0 })} />
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2 xs:gap-3">
                      <dt className="min-w-0 break-words text-ink-2">
                        Batch landed cost{" "}
                        <span className="text-ink-4">· consumables included</span>
                      </dt>
                      <dd className="num shrink-0 whitespace-nowrap">
                        −{php(profit.landedCost, { decimals: 0 })}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-2 border-t border-cobalt/20 pt-1.5 text-[15px] font-semibold text-cobalt xs:gap-3">
                      <dt className="min-w-0 break-words">Expected profit</dt>
                      <dd
                        className={clsx(
                          "num shrink-0 whitespace-nowrap",
                          profit.profit < 0 && "!text-clay",
                        )}
                      >
                        <RollingNumber value={php(profit.profit, { decimals: 0 })} />
                        <span className="ml-1 font-normal opacity-70">
                          {pct(profit.margin)}
                        </span>
                      </dd>
                    </div>
                    {/* The same figure per paddle, which is the one an operator
                        can hold against a single selling price. */}
                    {math.unitCount > 0 && (
                      <div className="flex items-baseline justify-between gap-2 xs:gap-3">
                        <dt className="min-w-0 break-words text-ink-2">
                          Expected profit per unit
                        </dt>
                        <dd
                          className={clsx(
                            "num shrink-0 whitespace-nowrap",
                            profit.profit < 0 ? "text-clay" : "text-teal",
                          )}
                        >
                          <RollingNumber
                            value={php(profit.profit / math.unitCount, { decimals: 0 })}
                          />
                        </dd>
                      </div>
                    )}
                  </dl>
                  <p className="mt-2 break-words text-micro leading-relaxed text-cobalt/80">
                    {profit.unpriced > 0
                      ? `${profit.unpriced} line${profit.unpriced === 1 ? " has" : "s have"} no standard selling price yet, so this is the profit on the rest. Customer shipping is never counted here — it is order income, not batch revenue.`
                      : "Every unit at its standard selling price, against everything this batch cost to land. Customer shipping is never counted here — it is order income, not batch revenue."}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* What throwing the standard freebies in would cost this whole batch. */}
          <AnimatePresence initial={false}>
            {math.allocatable && freebiePerUnit > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={spring}
                className="overflow-hidden"
              >
                <div className="rounded-md border border-plum/25 bg-plum-wash p-2.5 xs:p-3">
                  <p className="eyebrow !text-plum">If every unit ships with the freebie kit</p>
                  <dl className="mt-2 space-y-1.5 text-eta">
                    {kit.usable.map((item) => (
                      <div key={item.key} className="flex justify-between gap-2 xs:gap-3">
                        <dt className="min-w-0 break-words text-ink-2">
                          {item.meta.singular}{" "}
                          <span className="num text-ink-4">
                            · {item.stock} on shelf, needs {item.required}
                          </span>
                        </dt>
                        <dd
                          className={clsx(
                            "num shrink-0 whitespace-nowrap",
                            item.shortfall > 0 ? "text-clay" : "text-plum",
                          )}
                        >
                          −{php(item.unitCost * item.required, { decimals: 0 })}
                        </dd>
                      </div>
                    ))}
                    <div className="flex items-baseline justify-between gap-2 border-t border-plum/20 pt-1.5 font-semibold text-plum xs:gap-3">
                      <dt className="min-w-0 break-words">
                        Across {math.unitCount} unit{math.unitCount === 1 ? "" : "s"} ·{" "}
                        <span className="num">{php(freebiePerUnit)}</span> each
                      </dt>
                      <dd className="num shrink-0 whitespace-nowrap">
                        <RollingNumber value={`−${php(freebiePerUnit * math.unitCount)}`} />
                      </dd>
                    </div>
                  </dl>

                  {/* The shortfall says itself, nothing announces it. */}
                  <AnimatePresence initial={false}>
                    {kit.short.length > 0 && (
                      <motion.p
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={spring}
                        className="overflow-hidden"
                      >
                        <span className="mt-2 block break-words rounded-md bg-clay-wash px-2.5 py-2 text-micro leading-relaxed text-clay">
                          Short by{" "}
                          {kit.short
                            .map((i) => `${i.shortfall} ${i.meta.singular.toLowerCase()}`)
                            .join(", ")}
                          . Buy them above and receiving this batch puts them on the shelf.
                        </span>
                      </motion.p>
                    )}
                  </AnimatePresence>

                  <p className="mt-2 break-words text-micro leading-relaxed text-plum/80">
                    A projection, not a charge. Freebies are only ever costed on the order they are
                    actually given away on, where they come straight off that order's profit.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <ShippingNote />

          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={set("notes")}
              rows={2}
              placeholder="Tracking number, courier, anything worth remembering"
              className="field resize-none"
            />
          </Field>

          {batch && (
            <div className="border-t border-line-soft pt-3">
              <button
                type="button"
                className="btn-quiet w-full !text-clay"
                onClick={() => onDelete(batch)}
              >
                <Trash size={16} />
                Delete batch
              </button>
            </div>
          )}
        </div>
      </Tray>

      {/* Nested inside the batch tray, so it carries a back arrow. */}
      <ProductPicker
        open={pickerOpen}
        origin={pickerOrigin}
        exclude={lines.map((l) => unitKey(l.product_id, l.variant_id))}
        onClose={() => setPickerOpen(false)}
        onBack={() => setPickerOpen(false)}
        onPick={(unit) => {
          setLines((prev) => [
            ...prev,
            {
              key: `k${Date.now()}-${unit.key}`,
              product_id: unit.product_id,
              variant_id: unit.variant_id,
              quantity: 1,
              unit_cost_vnd: String(M(unit.source_cost_vnd)),
              unit_weight_kg: "",
              chargeable_weight_kg: "",
              intl_allocation_php: 0,
              local_allocation_php: 0,
              other_allocation_php: 0,
              currency: form.currency,
              exchange_rate: effectiveRate,
            },
          ]);
          setPickerOpen(false);
        }}
      />

      <ConfirmTray
        open={confirmReceive}
        onClose={() => setConfirmReceive(false)}
        title="Mark this batch received?"
        body={`This adds ${math.unitCount} unit${math.unitCount === 1 ? "" : "s"} to your stock on hand${
          math.consumablePieces > 0
            ? ` and ${math.consumablePieces} consumable piece${math.consumablePieces === 1 ? "" : "s"} to the freebie shelf`
            : ""
        }. Saving it again later will not add them twice.`}
        confirmLabel="Receive it"
        tone="primary"
        onConfirm={() => persist("Received")}
      />
    </>
  );
}

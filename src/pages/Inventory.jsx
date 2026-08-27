import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "react-router-dom";
import {
  Archive,
  ArrowCounterClockwise,
  CaretRight,
  ClockCounterClockwise,
  ImageSquare,
  Package,
  Palette,
  PencilSimple,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import confetti from "canvas-confetti";
import { toast } from "sonner";
import clsx from "clsx";

import Tray, { ConfirmTray, MorphLabel, useOrigin, useSticky } from "../components/Tray";
import {
  CalcRows,
  Chip,
  EmptyState,
  Field,
  FilterChips,
  Input,
  PhotoField,
  RollingNumber,
  SafeFloorPanel,
  SearchInput,
  ShippingNote,
  StockDots,
  Stepper,
  listChild,
  listParent,
} from "../components/ui";
import { useStore } from "../lib/store";
import { ARCHIVE_TAG, cleanNotes, isArchived } from "../lib/data";
import { standardFor, isAddon } from "../lib/schema";
import {
  M,
  MOVEMENT_FILTERS,
  allocationNote,
  formatDateShort,
  freebieKit,
  movementMeta,
  php,
  pct,
  stockState,
  unitLabel,
  unitMath,
  validate,
  variantValue,
  vnd,
  vndToPhp,
} from "../lib/calc";
import { CONFETTI_COLORS, haptic, spring } from "../lib/motion";

const BLANK = {
  sku: "",
  name: "",
  category: "",
  variant: "",
  source_cost_vnd: "",
  selling_price_php: "",
  quantity_on_hand: "0",
  reorder_level: "2",
  photo_url: "",
  notes: "",
};

const RULES = {
  sku: { required: true, label: "SKU" },
  name: { required: true, label: "Name" },
  source_cost_vnd: { nonNegative: true },
  selling_price_php: { nonNegative: true },
  quantity_on_hand: { nonNegative: true },
  reorder_level: { nonNegative: true },
};

const VARIANT_RULES = {
  color: { required: true, label: "Colour" },
  quantity: { nonNegative: true },
  reorder_level: { nonNegative: true },
  selling_price_php: { nonNegative: true },
  source_cost_vnd: { nonNegative: true },
};

export default function Inventory() {
  const { products, settings, commit, derived, orderItems, batchItems, movements, freebies } =
    useStore();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [editing, setEditing] = useState(null); // "new" | product
  const [adjusting, setAdjusting] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [origin, captureOrigin] = useOrigin();
  const [historyOrigin, captureHistoryOrigin] = useOrigin();

  const rate = settings.php_to_vnd_rate;
  const desiredMarginPercent = settings.desired_profit_margin_percent;
  // What one paddle's standard freebie kit costs right now, so the suggested
  // floor can optionally price the giveaway in.
  const kitCost = useMemo(() => freebieKit(freebies, 0).costPerPaddle, [freebies]);
  const active = useMemo(() => products.filter((p) => !isArchived(p)), [products]);
  const archived = useMemo(() => products.filter(isArchived), [products]);
  const variantsOf = (id) => derived.variantsByProduct.get(id) || [];

  const categories = useMemo(
    () => [...new Set(active.map((p) => p.category).filter(Boolean))].sort(),
    [active],
  );

  const filterOptions = useMemo(
    () => [
      { value: "All", label: "All" },
      { value: "Low", label: "Low stock" },
      { value: "Out", label: "Out" },
      { value: "Colours", label: "Has colours" },
      ...categories.map((c) => ({ value: `cat:${c}`, label: c })),
      ...(archived.length ? [{ value: "Archived", label: "Archived" }] : []),
    ],
    [categories, archived.length],
  );

  /**
   * A paddle with colours holds its stock in the colours, so its headline count
   * is their sum. Without colours nothing changes: it is still its own quantity.
   */
  const rowsFor = (p) => {
    const colours = variantsOf(p.id).filter((v) => v.active);
    if (!colours.length) return { onHand: M(p.quantity_on_hand), reorder: M(p.reorder_level) };
    return {
      onHand: colours.reduce((s, v) => s + M(v.quantity), 0),
      reorder: colours.reduce((s, v) => s + M(v.reorder_level), 0),
    };
  };

  const visible = useMemo(() => {
    const pool = filter === "Archived" ? archived : active;
    const q = search.trim().toLowerCase();
    return pool.filter((p) => {
      const colours = variantsOf(p.id);
      if (
        q &&
        !`${p.sku} ${p.name} ${p.category || ""} ${p.variant || ""} ${colours
          .map((v) => v.color)
          .join(" ")} ${cleanNotes(p)}`
          .toLowerCase()
          .includes(q)
      )
        return false;
      const totals = rowsFor(p);
      const state = stockState({
        quantity_on_hand: totals.onHand,
        reorder_level: totals.reorder,
      });
      if (filter === "Low") return state.key === "low";
      if (filter === "Out") return state.key === "out";
      if (filter === "Colours") return colours.length > 0;
      if (filter.startsWith("cat:")) return p.category === filter.slice(4);
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, archived, search, filter, derived.variantsByProduct]);

  const usageOf = (id) =>
    orderItems.filter((l) => l.product_id === id).length +
    batchItems.filter((l) => l.product_id === id).length;

  const stickyEditing = useSticky(editing);
  const stickyConfirm = useSticky(confirm);
  const stickyAdjust = useSticky(adjusting);

  return (
    <motion.div variants={listParent} initial="hidden" animate="shown">
      <motion.header variants={listChild} className="mb-3 flex items-end justify-between gap-2">
        <div className="hidden min-w-0 lg:block">
          <h1 className="text-[26px] font-semibold tracking-tight">Inventory</h1>
          <p className="mt-0.5 text-eta text-ink-2">
            {active.length} paddle{active.length === 1 ? "" : "s"} on the books
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            aria-label="Stock movement history"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-line bg-surface text-ink-2
                       transition-transform duration-150 active:scale-90 active:bg-paper"
            onClick={(e) => {
              captureHistoryOrigin(e);
              setHistoryOpen(true);
            }}
          >
            <ClockCounterClockwise size={17} />
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={(e) => {
              captureOrigin(e);
              setEditing("new");
            }}
          >
            <Plus size={17} weight="bold" />
            Add paddle
          </button>
        </div>
      </motion.header>

      {active.length === 0 && archived.length === 0 ? (
        <motion.div variants={listChild}>
          <EmptyState
            icon={<Package size={22} />}
            title="No paddles yet"
            body="Add the first one and the dashboard, batches and orders all start working from it."
            action={
              <button
                type="button"
                className="btn-primary"
                onClick={(e) => {
                  captureOrigin(e);
                  setEditing("new");
                }}
              >
                <Plus size={17} weight="bold" />
                Add paddle
              </button>
            }
          />
        </motion.div>
      ) : (
        <>
          <motion.div variants={listChild} className="space-y-2.5">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search SKU, name, colour"
            />
            <FilterChips
              options={filterOptions}
              value={filter}
              onChange={setFilter}
              idPrefix="inv"
            />
          </motion.div>

          <motion.div variants={listChild} className="mt-3">
            {visible.length === 0 ? (
              <EmptyState
                icon={<Package size={22} />}
                title="Nothing matches"
                body={
                  search
                    ? `No paddle matches “${search}”. Try a shorter search, or clear the filter.`
                    : "No paddle sits in this filter right now."
                }
                action={
                  <button
                    type="button"
                    className="btn-quiet"
                    onClick={() => {
                      setSearch("");
                      setFilter("All");
                    }}
                  >
                    Clear filters
                  </button>
                }
              />
            ) : (
              <motion.ul
                variants={listParent}
                initial="hidden"
                animate="shown"
                className="card overflow-hidden"
              >
                <AnimatePresence initial={false}>
                  {visible.map((p) => (
                    <ProductRow
                      key={p.id}
                      product={p}
                      rate={rate}
                      landed={derived.landedMap.get(p.id)}
                      desiredMarginPercent={desiredMarginPercent}
                      colours={variantsOf(p.id)}
                      totals={rowsFor(p)}
                      onEdit={(e) => {
                        captureOrigin(e);
                        setEditing(p);
                      }}
                      onAdjust={(e) => {
                        captureOrigin(e);
                        setAdjusting(p);
                      }}
                    />
                  ))}
                </AnimatePresence>
              </motion.ul>
            )}
          </motion.div>
        </>
      )}

      <ProductTray
        key={stickyEditing === "new" ? "new" : (stickyEditing?.id ?? "closed")}
        open={!!editing}
        product={stickyEditing === "new" ? null : stickyEditing}
        colours={
          stickyEditing && stickyEditing !== "new" ? variantsOf(stickyEditing.id) : []
        }
        origin={origin}
        rate={rate}
        landed={
          stickyEditing && stickyEditing !== "new"
            ? derived.landedMap.get(stickyEditing.id)
            : null
        }
        desiredMarginPercent={desiredMarginPercent}
        kitCost={kitCost}
        isFirst={products.length === 0}
        onClose={() => setEditing(null)}
        onArchive={(p) => setConfirm({ kind: isArchived(p) ? "restore" : "archive", product: p })}
        onDelete={(p) => setConfirm({ kind: "delete", product: p, uses: usageOf(p.id) })}
        onSave={async (values, id) => {
          await commit(async (db) => {
            if (id) await db.updateProduct(id, values);
            else await db.createProduct(values);
          });
        }}
      />

      <AdjustTray
        key={adjusting?.id ?? "adj-closed"}
        open={!!adjusting}
        product={stickyAdjust}
        colours={stickyAdjust ? variantsOf(stickyAdjust.id).filter((v) => v.active) : []}
        origin={origin}
        onClose={() => setAdjusting(null)}
        onSave={async ({ qty, variant }) => {
          if (variant) {
            await commit((db) => db.setVariantQuantity(variant, qty));
            toast.success(`${unitLabel(stickyAdjust.name, variant.color)} set to ${qty} on hand`);
          } else {
            await commit((db) =>
              db.setProductQuantity(stickyAdjust.id, qty, {
                before: M(stickyAdjust.quantity_on_hand),
              }),
            );
            toast.success(`${stickyAdjust.name} set to ${qty} on hand`);
          }
        }}
      />

      <MovementsTray
        open={historyOpen}
        origin={historyOrigin}
        onClose={() => setHistoryOpen(false)}
        movements={movements}
      />

      <ConfirmTray
        open={confirm?.kind === "archive"}
        onClose={() => setConfirm(null)}
        title={`Archive ${stickyConfirm?.product?.name || ""}?`}
        body="It drops out of your active list and the product pickers, colours included, but its order and batch history stays exactly as it is. You can bring it back any time."
        confirmLabel="Archive it"
        onConfirm={async () => {
          await commit((db) => db.setArchived(stickyConfirm.product, true));
          toast(`${stickyConfirm.product.name} archived`);
        }}
      />

      <ConfirmTray
        open={confirm?.kind === "restore"}
        onClose={() => setConfirm(null)}
        title={`Bring ${stickyConfirm?.product?.name || ""} back?`}
        body="It returns to your active inventory and shows up in the product pickers again."
        confirmLabel="Restore it"
        tone="primary"
        onConfirm={async () => {
          await commit((db) => db.setArchived(stickyConfirm.product, false));
          toast.success(`${stickyConfirm.product.name} restored`);
        }}
      />

      <ConfirmTray
        open={confirm?.kind === "delete"}
        onClose={() => setConfirm(null)}
        title={`Delete ${stickyConfirm?.product?.name || ""} for good?`}
        body={
          stickyConfirm?.uses
            ? `This paddle appears on ${stickyConfirm.uses} order or batch line. Its order lines keep their recorded costs, but the paddle and every colour under it are gone. Archiving keeps everything intact instead.`
            : "This cannot be undone, and it takes every colour with it. If you only want it out of the way, archive it instead."
        }
        confirmLabel="Delete forever"
        onConfirm={async () => {
          await commit((db) => db.deleteProduct(stickyConfirm.product.id));
          toast("Paddle deleted");
        }}
      />
    </motion.div>
  );
}

/* -------------------------------------------------------------------- row */

function ProductRow({
  product,
  rate,
  landed,
  colours = [],
  totals,
  onEdit,
  onAdjust,
  desiredMarginPercent,
}) {
  const live = colours.filter((v) => v.active);
  const stock = stockState({
    quantity_on_hand: totals.onHand,
    reorder_level: totals.reorder,
  });
  const supplierPhp = vndToPhp(product.source_cost_vnd, rate);
  const archived = isArchived(product);
  const math = unitMath({
    sourceVnd: product.source_cost_vnd,
    rate,
    shipAllocPerUnit: M(landed?.shipPerUnit),
    sellingPrice: product.selling_price_php,
    desiredMarginPercent,
  });
  const addon = isAddon(product);

  return (
    <motion.li
      layout
      variants={listChild}
      exit={{ opacity: 0, height: 0 }}
      transition={spring}
      className={clsx("border-b border-line-soft last:border-b-0", archived && "opacity-60")}
    >
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={onEdit}
          className="min-w-0 flex-1 px-3 py-3 text-left transition-colors duration-150 active:bg-paper xs:px-3.5"
        >
          <div className="flex items-baseline gap-2">
            <span className="num shrink-0 text-micro text-ink-3">{product.sku}</span>
            {product.category && (
              <span className="truncate text-micro text-ink-4">{product.category}</span>
            )}
          </div>

          <p className="mt-0.5 truncate text-[15px] font-medium leading-tight">
            {product.name}
            {product.variant && (
              <span className="font-normal text-ink-3"> · {product.variant}</span>
            )}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 xs:gap-x-2.5">
            <Chip tone={archived ? "gray" : stock.tone} dot>
              {archived ? "Archived" : stock.label}
            </Chip>
            {addon && <Chip tone="plum">Add-on</Chip>}
            <span className="num whitespace-nowrap text-micro text-ink-3">
              {vnd(product.source_cost_vnd)} → {php(supplierPhp)}
            </span>
          </div>

          {/* Colours stay a quiet summary here; the detail lives in the tray. */}
          {live.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {live.slice(0, 4).map((v) => {
                const vState = stockState({
                  quantity_on_hand: M(v.quantity),
                  reorder_level: M(v.reorder_level),
                });
                return (
                  <span
                    key={v.id}
                    className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2 py-[3px] text-micro"
                  >
                    <span
                      aria-hidden="true"
                      className={clsx(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        vState.key === "ok" ? "bg-lime" : vState.tone === "clay" ? "bg-clay" : "bg-plum",
                      )}
                    />
                    <span className="max-w-[9ch] truncate text-ink-2">{v.color}</span>
                    <span className="num text-ink-3">{M(v.quantity)}</span>
                  </span>
                );
              })}
              {live.length > 4 && (
                <span className="text-micro text-ink-3">+{live.length - 4} more</span>
              )}
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <StockDots
              quantity={totals.onHand}
              reorder={totals.reorder}
              holes={10}
              animate={false}
            />
            <span className="num min-w-0 break-words text-micro text-ink-3">
              {math.alloc > 0 && (
                <>
                  <span className="text-cobalt">+{php(math.alloc)} ship</span>
                  {" · "}
                </>
              )}
              landed {math.landed === null ? "—" : php(math.landed)} · sells{" "}
              {math.price === null ? (
                <span className="text-ink-4">no price set</span>
              ) : (
                php(math.price, { decimals: 0 })
              )}
            </span>
          </div>

          {math.profit !== null && (
            <p className="num mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 break-words text-micro text-ink-3">
              <span>
                actual profit{" "}
                <span
                  className={clsx("font-medium", math.profit < 0 ? "text-clay" : "text-teal")}
                >
                  {php(math.profit)}
                </span>
                {math.margin !== null && (
                  <span className="text-ink-4"> · {pct(math.margin)}</span>
                )}
              </span>
              {/* The floor stays silent until the price actually sits under it. */}
              {math.belowSafePrice && (
                <span className="whitespace-nowrap text-clay">
                  under the {php(math.minimumSafePrice, { decimals: 0 })} floor
                </span>
              )}
            </p>
          )}

          {cleanNotes(product) && (
            <p className="wrap-any mt-1.5 line-clamp-2 text-micro italic text-ink-3">
              {cleanNotes(product)}
            </p>
          )}
        </button>

        <button
          type="button"
          onClick={onAdjust}
          aria-label={`Adjust quantity for ${product.name}`}
          className="flex w-[64px] shrink-0 flex-col items-center justify-center gap-0.5 border-l border-line-soft
                     px-1 transition-colors duration-150 active:bg-paper xs:w-[74px]"
        >
          <span className="num text-[19px] font-semibold leading-none">
            <RollingNumber value={totals.onHand} />
          </span>
          <span className="text-[10px] uppercase tracking-wide text-ink-3">
            {live.length > 0 ? "total" : "on hand"}
          </span>
        </button>
      </div>
    </motion.li>
  );
}

/* -------------------------------------------------------------- product tray */

function ProductTray({
  open,
  product,
  colours = [],
  origin,
  rate,
  landed,
  desiredMarginPercent,
  kitCost = 0,
  isFirst,
  onClose,
  onSave,
  onArchive,
  onDelete,
}) {
  const { commit } = useStore();
  const [form, setForm] = useState(() =>
    product
      ? {
          sku: product.sku ?? "",
          name: product.name ?? "",
          category: product.category ?? "",
          variant: product.variant ?? "",
          source_cost_vnd: String(product.source_cost_vnd ?? ""),
          selling_price_php:
            product.selling_price_php == null ? "" : String(product.selling_price_php),
          quantity_on_hand: String(product.quantity_on_hand ?? 0),
          reorder_level: String(product.reorder_level ?? 0),
          photo_url: product.photo_url ?? "",
          notes: cleanNotes(product),
        }
      : BLANK,
  );
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [editingColour, setEditingColour] = useState(null); // "new" | variant
  const [deletingColour, setDeletingColour] = useState(null);
  const [colourOrigin, captureColourOrigin] = useOrigin();

  const set = (key) => (e) => {
    const value = e?.target ? e.target.value : e;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const supplierPhp = vndToPhp(form.source_cost_vnd, rate);
  const alloc = M(landed?.shipPerUnit);
  // The freebie kit is opt-in on the floor, and the choice is local to the tray:
  // it changes what is being asked, never what is stored.
  const [withKit, setWithKit] = useState(false);
  const math = unitMath({
    sourceVnd: form.source_cost_vnd,
    rate,
    shipAllocPerUnit: alloc,
    sellingPrice: form.selling_price_php,
    desiredMarginPercent,
    freebieCost: withKit ? kitCost : 0,
  });
  const standard = standardFor(form.name);
  const currentPrice =
    product && product.selling_price_php != null ? M(product.selling_price_php) : null;
  const hasColours = colours.length > 0;
  const colourTotal = colours.filter((v) => v.active).reduce((s, v) => s + M(v.quantity), 0);

  const save = async () => {
    const found = validate(
      {
        ...RULES,
        selling_price_php: { nonNegative: true, required: !!standard, label: "Selling price" },
      },
      form,
    );
    if (Object.keys(found).length) {
      setErrors(found);
      haptic([12, 40, 12]);
      return;
    }
    setSaving(true);
    try {
      const prefix = product && isArchived(product) ? `${ARCHIVE_TAG} ` : "";
      await onSave({ ...form, notes: `${prefix}${form.notes}`.trim() }, product?.id);
      haptic(12);
      if (isFirst && !product) {
        // Tier 3: the ledger's very first paddle happens exactly once.
        confetti({
          particleCount: 70,
          spread: 62,
          startVelocity: 34,
          ticks: 130,
          origin: { y: 0.62 },
          colors: CONFETTI_COLORS,
          disableForReducedMotion: true,
        });
        toast.success("Your ledger has its first paddle");
      } else {
        toast.success(product ? "Paddle updated" : "Paddle added");
      }
      onClose();
    } catch (e) {
      if (String(e?.message || "").toLowerCase().includes("unique")) {
        setErrors({ sku: "That SKU is already taken" });
      } else {
        toast.error("Could not save. Check your connection and try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  const stickyColour = useSticky(editingColour);
  const stickyDeleting = useSticky(deletingColour);

  return (
    <>
      <Tray
        open={open}
        onClose={onClose}
        origin={origin}
        wide
        title={product ? "Edit paddle" : "Add a paddle"}
        subtitle={
          product ? product.sku : "Cost in dong, a selling price, and the rest works itself out"
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
              onClick={save}
            >
              <MorphLabel>
                {saving ? "Saving…" : product ? "Save changes" : "Save paddle"}
              </MorphLabel>
            </button>
          </div>
        }
      >
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
            <Field label="SKU" error={errors.sku} required>
              <Input
                value={form.sku}
                onChange={set("sku")}
                error={errors.sku}
                placeholder="PTG-001"
                autoCapitalize="characters"
                data-autofocus
              />
            </Field>
            <Field label="Category">
              <Input value={form.category} onChange={set("category")} placeholder="Paddle" />
            </Field>
          </div>

          <Field label="Name" error={errors.name} required>
            <Input
              value={form.name}
              onChange={set("name")}
              error={errors.name}
              placeholder="Selkirk Omni Clay"
            />
          </Field>

          <Field label="Spec" hint="weight, grip, anything not a colour">
            <Input value={form.variant} onChange={set("variant")} placeholder="8.0oz / 4⅛ grip" />
          </Field>

          <Field
            label="Source cost"
            hint={`₱1 = ${Math.round(M(rate)).toLocaleString()}₫`}
            error={errors.source_cost_vnd}
          >
            <div className="relative">
              <Input
                numeric
                value={form.source_cost_vnd}
                onChange={set("source_cost_vnd")}
                error={errors.source_cost_vnd}
                placeholder="0"
                className="pr-10"
              />
              <span className="num pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-eta text-ink-3">
                ₫
              </span>
            </div>
          </Field>

          {/* The conversion appears the moment there is something to convert. */}
          <AnimatePresence initial={false}>
            {M(form.source_cost_vnd) > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={spring}
                className="overflow-hidden"
              >
                <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-paper px-3 py-2.5">
                  <span className="min-w-0 truncate text-micro text-ink-3">PHP supplier cost</span>
                  <span className="num shrink-0 whitespace-nowrap text-[15px] font-semibold">
                    <RollingNumber value={php(supplierPhp)} />
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <Field
            label="Selling price"
            hint={currentPrice === null ? "₱, optional" : `now ₱${currentPrice.toLocaleString()}`}
            error={errors.selling_price_php}
            required={!!standard}
          >
            <div className="relative">
              <Input
                numeric
                value={form.selling_price_php}
                onChange={set("selling_price_php")}
                error={errors.selling_price_php}
                placeholder={standard ? String(standard.price) : "0"}
                className="pr-10"
              />
              <span className="num pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-eta text-ink-3">
                ₱
              </span>
            </div>
          </Field>

          <p className="px-1 text-micro leading-relaxed text-ink-3">
            This is the standard price this paddle sells at, and you can change it here whenever you
            like. It prefills each new order line, and any single order can still be sold at a
            different price.
          </p>

          <AnimatePresence initial={false}>
            {standard && M(form.selling_price_php) !== standard.price && (
              <motion.button
                type="button"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={spring}
                onClick={() => {
                  set("selling_price_php")(String(standard.price));
                  haptic(8);
                }}
                className="block w-full overflow-hidden text-left"
              >
                <span className="block break-words px-1 py-0.5 text-micro text-cobalt">
                  Back to the standard price, ₱{standard.price.toLocaleString()}
                </span>
              </motion.button>
            )}
          </AnimatePresence>

          <div className="overflow-hidden rounded-md border border-line bg-paper p-2.5 xs:p-3">
            <p className="eyebrow mb-2">The calculation</p>
            <CalcRows
              rows={[
                {
                  label: "VND Cost",
                  value: math.hasVnd ? math.vndCost : null,
                  display: vnd(math.vndCost),
                  placeholder: "not set",
                },
                {
                  label: "PHP Supplier Cost",
                  value: math.hasVnd ? math.supplierPhp : null,
                  display: php(math.supplierPhp),
                  roll: true,
                  note: `÷ ${Math.round(M(rate)).toLocaleString()}`,
                },
                {
                  label: "Combined Shipping Allocation",
                  value: math.hasVnd ? math.alloc : null,
                  display: php(math.alloc),
                  accent: true,
                  roll: true,
                  note: landed?.batchQty
                    ? allocationNote(landed, { context: landed.batchName || "batch" })
                    : "no batch yet",
                },
                {
                  label: "Landed Cost",
                  value: math.hasVnd ? math.landed : null,
                  display: php(math.landed),
                  rule: true,
                  strong: true,
                  roll: true,
                },
                {
                  label: "Standard Selling Price",
                  value: math.price,
                  display: php(math.price, { decimals: 0 }),
                  placeholder: "set one above",
                },
                {
                  label: "Actual Profit",
                  value: math.hasVnd ? math.profit : null,
                  display: php(math.profit),
                  rule: true,
                  strong: true,
                  roll: true,
                  tone: math.profit !== null && math.profit < 0 ? "clay" : "teal",
                  placeholder:
                    math.blockedBy === "price"
                      ? "needs a price"
                      : math.blockedBy === "cost"
                        ? "needs a cost"
                        : "—",
                },
              ]}
            />
            <ShippingNote className="mt-2.5" />
          </div>

          {/* Pricing safety sits under the calculation it reads from, so the
              floor is next to the landed cost it comes out of. */}
          <SafeFloorPanel
            math={math}
            kitCost={kitCost}
            includeKit={withKit}
            onToggleKit={setWithKit}
          />

          {/* ------------------------------------------------------ colours */}
          <div>
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 px-0.5">
              <span className="eyebrow">Colours</span>
              {hasColours && (
                <span className="num shrink-0 text-micro text-ink-3">
                  {colourTotal} on hand across {colours.length}
                </span>
              )}
            </div>

            {!product ? (
              <p className="rounded-md border border-dashed border-line bg-paper px-3 py-3 text-micro leading-relaxed text-ink-3">
                Save this paddle first, then colours can be added under it. Until then it keeps a
                single stock count of its own, which is all most paddles need.
              </p>
            ) : (
              <div className="space-y-2">
                <AnimatePresence initial={false}>
                  {colours.map((v) => (
                    <ColourRow
                      key={v.id}
                      variant={v}
                      product={product}
                      rate={rate}
                      landed={landed}
                      desiredMarginPercent={desiredMarginPercent}
                      onEdit={(e) => {
                        captureColourOrigin(e);
                        setEditingColour(v);
                      }}
                      onDelete={() => setDeletingColour(v)}
                      onToggle={() =>
                        commit((db) => db.setVariantActive(v.id, !v.active))
                      }
                    />
                  ))}
                </AnimatePresence>

                <button
                  type="button"
                  onClick={(e) => {
                    captureColourOrigin(e);
                    setEditingColour("new");
                  }}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-line
                             bg-surface py-2.5 text-eta font-medium text-ink-2 transition-[transform,background-color]
                             duration-150 active:scale-[0.99] active:bg-paper"
                >
                  <Palette size={15} weight="bold" />
                  Add a colour
                </button>

                <p className="px-1 text-micro leading-relaxed text-ink-3">
                  {hasColours
                    ? "With colours, each one carries its own stock, price and reorder line, and the paddle's headline count is their total. Orders and batches pick a colour."
                    : "Optional. A paddle without colours keeps one stock count, exactly as it works now."}
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="On hand"
              hint={hasColours ? "held by colours" : undefined}
              error={errors.quantity_on_hand}
            >
              <Input
                numeric
                value={form.quantity_on_hand}
                onChange={set("quantity_on_hand")}
                error={errors.quantity_on_hand}
                disabled={hasColours}
                className={hasColours ? "opacity-55" : undefined}
              />
            </Field>
            <Field label="Reorder at" error={errors.reorder_level}>
              <Input
                numeric
                value={form.reorder_level}
                onChange={set("reorder_level")}
                error={errors.reorder_level}
              />
            </Field>
          </div>

          <PhotoField
            label="Photo"
            value={form.photo_url}
            onChange={set("photo_url")}
            placeholder="https://…/omni-clay.jpg"
          />

          {/*
            THE TWO PHOTO SYSTEMS, TOLD APART WHERE THEY COULD BE CONFUSED. The
            field above is the INVENTORY photo the invoice prints; the shop has
            its own, approved separately, and this is the door to it from the
            paddle it is about — so "which paddle" is already answered when the
            desk opens.
          */}
          {product && (
            <Link
              to={`/storefront-photos?model=${encodeURIComponent(product.name)}`}
              onClick={() => haptic(6)}
              className="flex items-center gap-2.5 rounded-md border border-line bg-paper px-3 py-2.5 transition-colors duration-150 active:bg-line-soft"
            >
              <ImageSquare size={18} className="shrink-0 text-cobalt" />
              <span className="min-w-0 flex-1">
                <span className="block text-eta font-medium">Manage storefront photos</span>
                <span className="mt-0.5 block text-micro leading-relaxed text-ink-3">
                  The buyer-facing shot, approved separately. Never changes the photo above.
                </span>
              </span>
              <CaretRight size={15} className="shrink-0 text-ink-4" />
            </Link>
          )}

          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={set("notes")}
              rows={2}
              placeholder="Supplier quirks, grip size, anything you will forget"
              className="field resize-none"
            />
          </Field>

          {product && (
            <div className="flex gap-2 border-t border-line-soft pt-3">
              <button type="button" className="btn-quiet flex-1" onClick={() => onArchive(product)}>
                {isArchived(product) ? (
                  <ArrowCounterClockwise size={16} />
                ) : (
                  <Archive size={16} />
                )}
                {isArchived(product) ? "Restore" : "Archive"}
              </button>
              <button
                type="button"
                className="btn-quiet flex-1 !text-clay"
                onClick={() => onDelete(product)}
              >
                <Trash size={16} />
                Delete
              </button>
            </div>
          )}
        </div>
      </Tray>

      {/* Nested inside the paddle tray, so it carries a back arrow. */}
      <VariantTray
        key={stickyColour === "new" ? "new-colour" : (stickyColour?.id ?? "c-closed")}
        open={!!editingColour}
        variant={stickyColour === "new" ? null : stickyColour}
        product={product}
        rate={rate}
        landed={landed}
        desiredMarginPercent={desiredMarginPercent}
        kitCost={kitCost}
        origin={colourOrigin}
        onClose={() => setEditingColour(null)}
        onBack={() => setEditingColour(null)}
        onSave={async (values) => {
          await commit((db) => db.saveVariant(product.id, values));
        }}
      />

      <ConfirmTray
        open={!!deletingColour}
        onClose={() => setDeletingColour(null)}
        title={`Delete ${stickyDeleting?.color || "this colour"}?`}
        body="Past orders and batches keep the costs they recorded, they just stop pointing at this colour. Switching it off instead keeps it listed here and out of new orders."
        confirmLabel="Delete colour"
        onConfirm={async () => {
          await commit((db) => db.deleteVariant(stickyDeleting.id));
          toast("Colour deleted");
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------- colour row */

function ColourRow({
  variant,
  product,
  rate,
  landed,
  onEdit,
  onDelete,
  onToggle,
  desiredMarginPercent,
}) {
  // Optimistic: the switch moves under the finger, and re-syncs when the write
  // lands, exactly like the freebie switch in Settings.
  const [pending, setPending] = useState(null);
  const active = pending === null ? !!variant.active : pending;
  const stock = stockState({
    quantity_on_hand: M(variant.quantity),
    reorder_level: M(variant.reorder_level),
  });
  const math = unitMath({
    sourceVnd: variantValue(variant, product, "source_cost_vnd"),
    rate,
    shipAllocPerUnit: M(landed?.shipPerUnit),
    sellingPrice: variantValue(variant, product, "selling_price_php"),
    desiredMarginPercent,
  });

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -16, height: 0, marginBottom: 0 }}
      transition={spring}
      className={clsx(
        "overflow-hidden rounded-md border border-line bg-paper p-2.5",
        !active && "opacity-60",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={active}
          aria-label={`${active ? "Switch off" : "Switch on"} ${variant.color}`}
          onClick={() => {
            haptic(8);
            setPending(!active);
            Promise.resolve(onToggle()).catch(() => setPending(null));
          }}
          className={clsx(
            "relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors duration-150",
            active ? "bg-cobalt" : "bg-line",
          )}
        >
          <motion.span
            layout
            transition={spring}
            className={clsx(
              "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm",
              active ? "left-[18px]" : "left-0.5",
            )}
          />
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-eta font-medium">{variant.color}</p>
          <p className="num mt-0.5 truncate text-micro text-ink-3">
            {variant.sku || product?.sku}
            {M(variant.selling_price_php) > 0
              ? ` · sells ${php(variant.selling_price_php, { decimals: 0 })}`
              : " · uses the paddle price"}
          </p>
        </div>

        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${variant.color}`}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-3 transition-transform duration-150 active:scale-90 active:bg-line-soft"
        >
          <PencilSimple size={15} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${variant.color}`}
          className="-mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-3 transition-transform duration-150 active:scale-90 active:bg-line-soft"
        >
          <Trash size={15} />
        </button>
      </div>

      <div className="mt-2 border-t border-line pt-2">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <StockDots
            quantity={M(variant.quantity)}
            reorder={M(variant.reorder_level)}
            holes={8}
            animate={false}
          />
          <Chip tone={stock.tone}>{M(variant.quantity)} on hand</Chip>
        </div>

        {/* This colour's own economics: supplier cost, its slice of the batch
            shipping, what it lands at, and what that leaves. */}
        <p className="num mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 break-words text-micro text-ink-3">
          <span>{php(math.supplierPhp, { decimals: 0 })} cost</span>
          {math.alloc > 0 && <span className="text-cobalt">+{php(math.alloc)} ship</span>}
          <span>= {math.landed === null ? "—" : php(math.landed, { decimals: 0 })} landed</span>
          {math.profit !== null && (
            <span>
              profit{" "}
              <span className={clsx("font-medium", math.profit < 0 ? "text-clay" : "text-teal")}>
                {php(math.profit, { decimals: 0 })}
              </span>
              {math.margin !== null && <span className="text-ink-4"> · {pct(math.margin)}</span>}
            </span>
          )}
        </p>

        {math.minimumSafePrice !== null && (
          <p
            className={clsx(
              "num mt-1 break-words text-micro",
              math.belowSafePrice ? "text-clay" : "text-ink-4",
            )}
          >
            safe floor {php(math.minimumSafePrice, { decimals: 0 })}
            {math.belowSafePrice && " · this colour sells under it"}
          </p>
        )}
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------ variant tray */

function VariantTray({
  open,
  variant,
  product,
  rate,
  landed,
  desiredMarginPercent,
  kitCost = 0,
  origin,
  onClose,
  onBack,
  onSave,
}) {
  const [form, setForm] = useState(() => ({
    color: variant?.color ?? "",
    sku: variant?.sku ?? "",
    quantity: String(variant?.quantity ?? 0),
    reorder_level: String(variant?.reorder_level ?? product?.reorder_level ?? 2),
    selling_price_php:
      variant && M(variant.selling_price_php) > 0 ? String(variant.selling_price_php) : "",
    source_cost_vnd:
      variant && M(variant.source_cost_vnd) > 0 ? String(variant.source_cost_vnd) : "",
    photo_url: variant?.photo_url ?? "",
    active: variant ? !!variant.active : true,
  }));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => {
    const value = e?.target ? e.target.value : e;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  // Blank cost or price means "same as the paddle", so a colour only carries
  // what actually differs about it.
  const effectiveVnd =
    String(form.source_cost_vnd).trim() === ""
      ? M(product?.source_cost_vnd)
      : M(form.source_cost_vnd);
  const effectivePrice =
    String(form.selling_price_php).trim() === ""
      ? M(product?.selling_price_php)
      : M(form.selling_price_php);

  const [withKit, setWithKit] = useState(false);
  const math = unitMath({
    sourceVnd: effectiveVnd,
    rate,
    shipAllocPerUnit: M(landed?.shipPerUnit),
    sellingPrice: effectivePrice,
    desiredMarginPercent,
    freebieCost: withKit ? kitCost : 0,
  });

  const save = async () => {
    const found = validate(VARIANT_RULES, form);
    if (Object.keys(found).length) {
      setErrors(found);
      haptic([12, 40, 12]);
      return;
    }
    setSaving(true);
    try {
      await onSave({ ...form, id: variant?.id });
      haptic(12);
      toast.success(variant ? `${form.color} updated` : `${form.color} added`);
      onClose();
    } catch {
      toast.error("Could not save the colour. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Tray
      open={open}
      onClose={onClose}
      onBack={onBack}
      origin={origin}
      title={variant ? "Edit colour" : "Add a colour"}
      subtitle={product?.name}
      footer={
        <button type="button" className="btn-primary w-full" disabled={saving} onClick={save}>
          <MorphLabel>
            {saving ? "Saving colour…" : variant ? "Save colour" : "Add colour"}
          </MorphLabel>
        </button>
      }
    >
      <div className="space-y-3 pt-1">
        <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
          <Field label="Colour" error={errors.color} required>
            <Input
              value={form.color}
              onChange={set("color")}
              error={errors.color}
              placeholder="Midnight blue"
              data-autofocus
            />
          </Field>
          <Field label="SKU" hint="optional">
            <Input
              value={form.sku}
              onChange={set("sku")}
              placeholder={product ? `${product.sku}-BLU` : "PTG-001-BLU"}
              autoCapitalize="characters"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="On hand" error={errors.quantity}>
            <Input
              numeric
              value={form.quantity}
              onChange={set("quantity")}
              error={errors.quantity}
            />
          </Field>
          <Field label="Reorder at" error={errors.reorder_level}>
            <Input
              numeric
              value={form.reorder_level}
              onChange={set("reorder_level")}
              error={errors.reorder_level}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
          <Field
            label="Source cost"
            hint={M(product?.source_cost_vnd) > 0 ? "blank = same as paddle" : "₫"}
            error={errors.source_cost_vnd}
          >
            <Input
              numeric
              value={form.source_cost_vnd}
              onChange={set("source_cost_vnd")}
              error={errors.source_cost_vnd}
              placeholder={String(Math.round(M(product?.source_cost_vnd)) || 0)}
            />
          </Field>
          <Field
            label="Selling price"
            hint={M(product?.selling_price_php) > 0 ? "blank = same as paddle" : "₱"}
            error={errors.selling_price_php}
          >
            <Input
              numeric
              value={form.selling_price_php}
              onChange={set("selling_price_php")}
              error={errors.selling_price_php}
              placeholder={String(Math.round(M(product?.selling_price_php)) || 0)}
            />
          </Field>
        </div>

        <PhotoField
          label="Photo"
          hint={product?.photo_url ? "blank = the paddle's photo" : "optional, shown on the invoice"}
          value={form.photo_url}
          onChange={set("photo_url")}
          fallback={product?.photo_url || null}
          placeholder={`https://…/${String(form.color || "colour").toLowerCase().replace(/\s+/g, "-")}.jpg`}
        />

        {/* The same six rows as everywhere else, for this colour alone. */}
        <div className="overflow-hidden rounded-md border border-line bg-paper p-2.5 xs:p-3">
          <p className="eyebrow mb-2">This colour</p>
          <CalcRows
            dense
            rows={[
              {
                label: "VND Cost",
                value: math.hasVnd ? math.vndCost : null,
                display: vnd(math.vndCost),
                placeholder: "not set",
              },
              {
                label: "PHP Supplier Cost",
                value: math.supplierPhp,
                display: php(math.supplierPhp),
                roll: true,
                note: `÷ ${Math.round(M(rate)).toLocaleString()}`,
              },
              {
                label: "Combined Shipping Allocation",
                value: math.hasVnd ? math.alloc : null,
                display: php(math.alloc),
                accent: true,
                roll: true,
                note: landed?.batchQty
                  ? allocationNote(landed, { context: landed.batchName || "batch" })
                  : "no batch yet",
              },
              {
                label: "Landed Cost",
                value: math.landed,
                display: php(math.landed),
                rule: true,
                strong: true,
                roll: true,
              },
              {
                label: "Standard Selling Price",
                value: math.price,
                display: php(math.price, { decimals: 0 }),
                placeholder: "set one above",
              },
              {
                label: "Actual Profit",
                value: math.profit,
                display: php(math.profit),
                rule: true,
                strong: true,
                roll: true,
                tone: math.profit !== null && math.profit < 0 ? "clay" : "teal",
                placeholder: "needs a price",
              },
            ]}
          />
        </div>

        <SafeFloorPanel
          dense
          math={math}
          kitCost={kitCost}
          includeKit={withKit}
          onToggleKit={setWithKit}
        />

        <button
          type="button"
          role="switch"
          aria-checked={form.active}
          onClick={() => {
            set("active")(!form.active);
            haptic(8);
          }}
          className="flex w-full items-center gap-3 rounded-md border border-line bg-surface px-3 py-2.5 text-left"
        >
          <span
            className={clsx(
              "relative h-6 w-10 shrink-0 rounded-full transition-colors duration-150",
              form.active ? "bg-cobalt" : "bg-line",
            )}
          >
            <motion.span
              layout
              transition={spring}
              className={clsx(
                "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm",
                form.active ? "left-[18px]" : "left-0.5",
              )}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-eta font-medium">
              {form.active ? "Sellable on new orders" : "Hidden from new orders"}
            </span>
            <span className="mt-0.5 block break-words text-micro leading-snug text-ink-3">
              Switching it off keeps its stock and every past order exactly as they are.
            </span>
          </span>
        </button>
      </div>
    </Tray>
  );
}

/* --------------------------------------------------------------- adjust tray */

function AdjustTray({ open, product, colours = [], origin, onClose, onSave }) {
  const [target, setTarget] = useState(colours[0]?.id ?? null);
  const variant = colours.find((v) => v.id === target) || null;
  const start = variant ? M(variant.quantity) : M(product?.quantity_on_hand);
  const [values, setValues] = useState({});
  const key = variant ? `v${variant.id}` : "base";
  const value = values[key] ?? start;
  const [saving, setSaving] = useState(false);
  const delta = value - start;

  const setValue = (n) => setValues((prev) => ({ ...prev, [key]: n }));

  return (
    <Tray
      open={open}
      onClose={onClose}
      origin={origin}
      title="Adjust stock"
      subtitle={variant ? unitLabel(product?.name, variant.color) : product?.name}
      footer={
        <button
          type="button"
          className="btn-primary w-full"
          disabled={saving || delta === 0}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave({ qty: value, variant });
              onClose();
            } finally {
              setSaving(false);
            }
          }}
        >
          {/* Label morphs with the number rather than swapping wholesale. */}
          <MorphLabel>
            {saving ? "Saving…" : delta === 0 ? "No change yet" : `Set to ${value} on hand`}
          </MorphLabel>
        </button>
      }
    >
      <div className="pb-2 pt-2">
        {colours.length > 0 && (
          <div className="mb-3">
            <p className="eyebrow mb-1.5 px-0.5">Which colour</p>
            <FilterChips
              options={colours.map((v) => ({ value: v.id, label: v.color }))}
              value={target}
              onChange={setTarget}
              idPrefix="adj"
            />
          </div>
        )}

        <div className="flex flex-col items-center gap-3 overflow-hidden rounded-md border border-line bg-paper px-3 py-5">
          <Stepper value={value} onChange={setValue} min={0} />
          <StockDots
            quantity={value}
            reorder={variant ? M(variant.reorder_level) : M(product?.reorder_level)}
            holes={12}
          />
          <p className="text-center text-micro text-ink-3">
            {delta === 0 ? (
              `Was ${start}, unchanged`
            ) : (
              <span className={delta > 0 ? "text-teal" : "text-clay"}>
                {delta > 0 ? "+" : "−"}
                {Math.abs(delta)} from {start}
              </span>
            )}
          </p>
        </div>
        <p className="mt-3 px-1 text-micro leading-relaxed text-ink-3">
          Use this for counts and corrections. It writes an Adjustment to the movement history, and
          receiving a batch or completing an order already moves stock on its own.
        </p>
      </div>
    </Tray>
  );
}

/* ------------------------------------------------------------- movements */

/**
 * The audit trail. Every receipt, sale, adjustment, return and correction the
 * app has written, newest first, filterable by type.
 */
function MovementsTray({ open, origin, onClose, movements = [] }) {
  const { productsById, derived, freebiesById } = useStore();
  const [filter, setFilter] = useState("All");

  const rows = useMemo(
    () => (filter === "All" ? movements : movements.filter((m) => m.movement_type === filter)),
    [movements, filter],
  );

  /** A movement names the exact thing it moved: paddle, colour, or freebie. */
  const describe = (m) => {
    if (m.reference_type === "freebie") {
      const freebie = freebiesById.get(m.reference_id);
      return freebie ? `${freebie.name} · freebie stock` : "Freebie stock";
    }
    const product = productsById.get(m.inventory_id);
    const variant = derived.variantsById.get(m.variant_id);
    if (!product) return "Removed paddle";
    return unitLabel(product.name, variant?.color);
  };

  /** What the movement counted, so "+120" is never a bare number. */
  const unitsOf = (m) => (m.reference_type === "freebie" ? "pieces" : "units");

  return (
    <Tray
      open={open}
      onClose={onClose}
      origin={origin}
      wide
      title="Stock movements"
      subtitle={`${movements.length} recorded, newest first`}
    >
      <div className="pb-2 pt-1">
        <FilterChips
          options={MOVEMENT_FILTERS}
          value={filter}
          onChange={setFilter}
          idPrefix="mov"
        />

        {rows.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              icon={<ClockCounterClockwise size={20} />}
              title={
                movements.length === 0 ? "Nothing has moved yet" : `No ${filter.toLowerCase()}s`
              }
              body={
                movements.length === 0
                  ? "Receive a batch, complete an order or adjust a count, and every one of them lands here with its reason."
                  : "Change the filter to see the rest of the history."
              }
              action={
                movements.length > 0 && (
                  <button type="button" className="btn-quiet" onClick={() => setFilter("All")}>
                    Show all
                  </button>
                )
              }
            />
          </div>
        ) : (
          <motion.ul
            variants={listParent}
            initial="hidden"
            animate="shown"
            className="mt-3 divide-y divide-line-soft overflow-hidden rounded-md border border-line"
          >
            {rows.map((m) => {
              const meta = movementMeta(m.movement_type);
              const qty = M(m.quantity);
              return (
                <motion.li
                  key={m.id}
                  variants={listChild}
                  className="flex items-start gap-2.5 px-3 py-2.5 xs:gap-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-eta font-medium">{describe(m)}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Chip tone={meta.tone}>{meta.label}</Chip>
                      <span className="num whitespace-nowrap text-micro text-ink-3">
                        {formatDateShort(String(m.created_at || "").slice(0, 10))}
                      </span>
                      {m.reference_type && (
                        <span className="text-micro text-ink-4">via {m.reference_type}</span>
                      )}
                      <span className="num text-micro text-ink-4">
                        {Math.abs(qty)} {unitsOf(m)}
                      </span>
                    </span>
                    {m.notes && (
                      <span className="wrap-any mt-1 block text-micro italic text-ink-3">
                        {m.notes}
                      </span>
                    )}
                  </span>
                  <span
                    className={clsx(
                      "num shrink-0 whitespace-nowrap text-[15px] font-semibold",
                      qty > 0 ? "text-teal" : "text-clay",
                    )}
                  >
                    {qty > 0 ? "+" : "−"}
                    {Math.abs(qty)}
                  </span>
                </motion.li>
              );
            })}
          </motion.ul>
        )}

        <p className="mt-3 px-1 text-micro leading-relaxed text-ink-3">
          Only the net change each save produced is recorded, so re-saving a received batch or a
          completed order never writes a second movement. Paddles move in units against a colour
          where they carry one; consumables move in pieces against the freebie they stock, so a
          pack of overgrips lands as sixty.
        </p>
      </div>
    </Tray>
  );
}

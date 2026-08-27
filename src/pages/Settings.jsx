import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "react-router-dom";
import {
  ArrowCounterClockwise,
  ArrowSquareOut,
  Database,
  Gift,
  ImageSquare,
  Info,
  PencilSimple,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import clsx from "clsx";

import Tray, { ConfirmTray, MorphLabel, useOrigin, useSticky } from "../components/Tray";
import {
  CalcRows,
  Chip,
  Field,
  Input,
  RollingNumber,
  SafeFloorPanel,
  Section,
  ShippingNote,
  listChild,
  listParent,
} from "../components/ui";
import { useStore } from "../lib/store";
import { isArchived } from "../lib/data";
import {
  DEFAULT_BATCH_SHIPPING,
  DEFAULT_SETTINGS,
  M,
  OVERGRIPS_PER_PACK,
  freebieKit,
  php,
  stockUnits,
  stockState,
  unitMath,
  validate,
} from "../lib/calc";
import { PUBLIC_CATALOG_PATH, PUBLIC_SHOP_PATH } from "../lib/storefront";
import { haptic, spring } from "../lib/motion";

/** The reference figure the whole calculation is checked against. */
const REFERENCE = {
  name: "Selkirk Omni Clay",
  vnd: 6_900_000,
  rate: 416,
  batchShipping: 200,
  batchQty: 16,
  alloc: 12.5,
  price: 18900,
  expect: { supplier: 16586.54, landed: 16599.04, profit: 2300.96 },
};

const RULES = {
  php_to_vnd_rate: { required: true, label: "Rate", positive: true },
  default_shipping_php: { required: true, label: "Shipping", nonNegative: true },
  desired_profit_margin_percent: { required: true, label: "Target margin", nonNegative: true },
};

const FREEBIE_RULES = {
  name: { required: true, label: "Name" },
  unit_cost: { nonNegative: true },
  quantity: { nonNegative: true },
};

export default function Settings() {
  const { settings, commit, products, freebies, derived } = useStore();

  // The catalog tray is intentionally derived from the same active inventory and
  // colour variants rendered by Stock. It must never compare against a separate
  // seeded catalog, which is how stale missing-record rows appeared.
  const audit = useMemo(() => {
    const active = products.filter((product) => !isArchived(product));
    const entries = stockUnits(active, derived.variantsByProduct).map((unit) => ({
      key: unit.key,
      name: unit.color ? `${unit.name} · ${unit.color}` : unit.name,
      sku: unit.sku,
      quantity: unit.quantity_on_hand,
      price: M(unit.selling_price_php) > 0 ? M(unit.selling_price_php) : null,
      state: stockState(unit),
    }));
    const priced = entries.filter((entry) => entry.price != null);
    return {
      entries,
      stored: priced.length,
      total: entries.length,
      complete: entries.length > 0 && priced.length === entries.length,
    };
  }, [products, derived.variantsByProduct]);

  const [form, setForm] = useState(() => ({
    php_to_vnd_rate: String(settings.php_to_vnd_rate),
    default_shipping_php: String(settings.default_shipping_php),
    desired_profit_margin_percent: String(settings.desired_profit_margin_percent),
  }));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetOrigin, captureResetOrigin] = useOrigin();
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditOrigin, captureAuditOrigin] = useOrigin();

  const [editingFreebie, setEditingFreebie] = useState(null); // "new" | freebie
  const [deletingFreebie, setDeletingFreebie] = useState(null);
  const [freebieOrigin, captureFreebieOrigin] = useOrigin();

  useEffect(() => {
    setForm({
      php_to_vnd_rate: String(settings.php_to_vnd_rate),
      default_shipping_php: String(settings.default_shipping_php),
    desired_profit_margin_percent: String(settings.desired_profit_margin_percent),
    });
  }, [settings]);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const dirty =
    M(form.php_to_vnd_rate) !== settings.php_to_vnd_rate ||
    M(form.default_shipping_php) !== settings.default_shipping_php ||
    M(form.desired_profit_margin_percent) !== settings.desired_profit_margin_percent;

  const atDefaults =
    settings.php_to_vnd_rate === DEFAULT_SETTINGS.php_to_vnd_rate &&
    settings.default_shipping_php === DEFAULT_SETTINGS.default_shipping_php;

  /** A live preview against a real paddle where one exists, an example if not. */
  const preview = useMemo(() => {
    const rate = M(form.php_to_vnd_rate);
    const sample =
      products.find((p) => M(p.source_cost_vnd) > 0 && M(p.selling_price_php) > 0) ||
      products.find((p) => M(p.source_cost_vnd) > 0);
    const sourceVnd = sample ? M(sample.source_cost_vnd) : REFERENCE.vnd;
    const alloc =
      M(form.default_shipping_php) > 0 ? M(form.default_shipping_php) / REFERENCE.batchQty : 0;
    return {
      name: sample?.name || `${REFERENCE.name}, as an example`,
      isReal: !!sample,
      calc: unitMath({
        sourceVnd,
        rate,
        shipAllocPerUnit: alloc,
        sellingPrice: sample ? sample.selling_price_php : REFERENCE.price,
        // The live form value, so the floor moves as the target margin is typed.
        desiredMarginPercent: M(form.desired_profit_margin_percent),
      }),
    };
  }, [form, products]);

  const verification = useMemo(() => {
    const calc = unitMath({
      sourceVnd: REFERENCE.vnd,
      rate: REFERENCE.rate,
      shipAllocPerUnit: REFERENCE.alloc,
      sellingPrice: REFERENCE.price,
    });
    const near = (a, b) => Math.abs(M(a) - M(b)) < 0.005;
    return {
      calc,
      passes:
        near(calc.supplierPhp, REFERENCE.expect.supplier) &&
        near(calc.landed, REFERENCE.expect.landed) &&
        near(calc.profit, REFERENCE.expect.profit),
    };
  }, []);

  const save = async () => {
    const found = validate(RULES, form);
    if (Object.keys(found).length) {
      setErrors(found);
      haptic([12, 40, 12]);
      return;
    }
    setSaving(true);
    try {
      await commit((db) =>
        db.saveSettings({
          php_to_vnd_rate: M(form.php_to_vnd_rate),
          default_shipping_php: M(form.default_shipping_php),
          default_markup_percent: settings.default_markup_percent,
          desired_profit_margin_percent: M(form.desired_profit_margin_percent),
        }),
      );
      haptic(12);
      toast.success("Settings saved, every figure recalculated");
    } catch {
      toast.error("Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const stickyFreebie = useSticky(editingFreebie);
  const stickyDeleting = useSticky(deletingFreebie);
  const activeFreebies = freebies.filter((f) => f.active).length;
  const kit = useMemo(() => freebieKit(freebies, 0), [freebies]);

  return (
    <motion.div variants={listParent} initial="hidden" animate="shown">
      <motion.header variants={listChild} className="mb-3 hidden lg:block">
        <h1 className="text-[26px] font-semibold tracking-tight">Settings</h1>
        <p className="mt-0.5 text-eta text-ink-2">
          Two numbers and a freebie catalog, and every figure in the app follows them.
        </p>
      </motion.header>

      <motion.div variants={listChild} className="card p-3.5 sm:p-4">
        <div className="space-y-3">
          <Field
            label="PHP to VND rate"
            hint={`default ${DEFAULT_SETTINGS.php_to_vnd_rate}`}
            error={errors.php_to_vnd_rate}
            required
          >
            <div className="relative">
              <Input
                numeric
                value={form.php_to_vnd_rate}
                onChange={set("php_to_vnd_rate")}
                error={errors.php_to_vnd_rate}
                className="pr-24 !text-[17px] !font-semibold"
              />
              <span className="num pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 whitespace-nowrap text-micro text-ink-3">
                ₫ per ₱1
              </span>
            </div>
          </Field>

          <Field
            label="Default batch shipping"
            hint={`₱${DEFAULT_BATCH_SHIPPING} per batch`}
            error={errors.default_shipping_php}
            required
          >
            <div className="relative">
              <Input
                numeric
                value={form.default_shipping_php}
                onChange={set("default_shipping_php")}
                error={errors.default_shipping_php}
                className="pr-28"
              />
              <span className="num pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 whitespace-nowrap text-micro text-ink-3">
                per batch
              </span>
            </div>
          </Field>
          <Field
            label="Desired profit margin"
            hint="used only for the suggested safe floor"
            error={errors.desired_profit_margin_percent}
            required
          >
            <div className="relative">
              <Input numeric value={form.desired_profit_margin_percent} onChange={set("desired_profit_margin_percent")} error={errors.desired_profit_margin_percent} className="pr-12" />
              <span className="num pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-micro text-ink-3">%</span>
            </div>
          </Field>
        </div>

        <div className="mt-3.5 overflow-hidden rounded-md border border-line bg-paper p-2.5 xs:p-3">
          <p className="eyebrow mb-2">What that does</p>
          <p className="truncate text-eta font-medium">{preview.name}</p>
          <div className="mt-2">
            <CalcRows
              dense
              rows={[
                {
                  label: "VND Cost",
                  value: preview.calc.hasVnd ? preview.calc.vndCost : null,
                  display: `${Math.round(preview.calc.vndCost).toLocaleString()}₫`,
                },
                {
                  label: "PHP Supplier Cost",
                  value: preview.calc.supplierPhp,
                  display: php(preview.calc.supplierPhp),
                  roll: true,
                  placeholder: "rate must be above 0",
                },
                {
                  label: "Combined Shipping Allocation",
                  value: preview.calc.alloc,
                  display: php(preview.calc.alloc),
                  accent: true,
                  roll: true,
                  // Honest about what this preview actually divides. There is no
                  // batch here, so there is no international leg to show — the
                  // international leg is quoted per batch, and the real two-leg
                  // split is stated on the batch itself.
                  note: `default shipping ÷ ${REFERENCE.batchQty} · a real batch adds its own VN→MNL quote`,
                },
                {
                  label: "Landed Cost",
                  value: preview.calc.landed,
                  display: php(preview.calc.landed),
                  rule: true,
                  strong: true,
                  roll: true,
                },
                {
                  label: "Standard Selling Price",
                  value: preview.calc.price,
                  display: php(preview.calc.price, { decimals: 0 }),
                  placeholder: "not set",
                },
                {
                  label: "Actual Profit",
                  value: preview.calc.profit,
                  display: php(preview.calc.profit),
                  rule: true,
                  strong: true,
                  roll: true,
                  tone:
                    preview.calc.profit !== null && preview.calc.profit < 0 ? "clay" : "teal",
                  placeholder: "needs a selling price",
                },
              ]}
            />
          </div>
          {!preview.isReal && (
            <p className="mt-2 text-micro text-ink-3">
              An example, because no paddle carries both a cost and a selling price yet.
            </p>
          )}
          <ShippingNote className="mt-2.5" />
        </div>

        {/* The target margin explains itself: the floor it implies, against the
            same paddle the calculation above just walked through. */}
        <SafeFloorPanel dense math={preview.calc} className="mt-2.5" />

        {/* Save only exists once something has actually changed. */}
        <AnimatePresence initial={false}>
          {dirty && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={spring}
              className="overflow-hidden"
            >
              <button
                type="button"
                className="btn-primary mt-3.5 w-full"
                disabled={saving}
                onClick={save}
              >
                <MorphLabel>{saving ? "Saving…" : "Save settings"}</MorphLabel>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* --------------------------------------------------------- freebies */}
      <Section
        title="Freebie catalog"
        action={
          <button
            type="button"
            className="btn-quiet !min-h-[36px] !py-1.5 !text-eta"
            onClick={(e) => {
              captureFreebieOrigin(e);
              setEditingFreebie("new");
            }}
          >
            <Plus size={15} weight="bold" />
            Add freebie
          </button>
        }
      >
        <motion.div variants={listChild} className="card overflow-hidden">
          <div className="flex items-start justify-between gap-2 border-b border-line-soft px-3.5 py-3 xs:gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold">What you throw in</p>
              <p className="num mt-0.5 break-words text-micro text-ink-3">
                <RollingNumber value={activeFreebies} /> of {freebies.length} active ·{" "}
                {php(derived.freebieCost, { decimals: 0 })} given away so far
              </p>
            </div>
            <Chip tone={activeFreebies > 0 ? "plum" : "gray"} dot>
              {activeFreebies > 0 ? "In use" : "All off"}
            </Chip>
          </div>

          <ul>
            <AnimatePresence initial={false}>
              {freebies.map((freebie) => (
                <FreebieRow
                  key={freebie.id}
                  freebie={freebie}
                  onEdit={(e) => {
                    captureFreebieOrigin(e);
                    setEditingFreebie(freebie);
                  }}
                  onDelete={() => setDeletingFreebie(freebie)}
                  onToggle={() =>
                    commit((db) => db.setFreebieActive(freebie.id, !freebie.active))
                  }
                />
              ))}
            </AnimatePresence>
            {freebies.length === 0 && (
              <li className="px-3.5 py-6 text-center">
                <Gift size={22} className="mx-auto mb-2 text-ink-4" />
                <p className="text-eta text-ink-3">
                  No freebies yet. Add a cover, tape or grip and it becomes available on every
                  order.
                </p>
              </li>
            )}
          </ul>

          {/* The kit as one figure: how many paddles the shelf can actually cover. */}
          <div className="border-t border-line-soft px-3.5 py-3">
            <div className="flex items-baseline justify-between gap-2 xs:gap-3">
              <span className="eyebrow min-w-0 break-words">The standard kit</span>
              <span className="num shrink-0 whitespace-nowrap text-micro font-semibold text-plum">
                {php(kit.costPerPaddle)} per paddle
              </span>
            </div>
            <dl className="mt-2 space-y-1.5 text-eta">
              {kit.items.map((item) => (
                <div key={item.key} className="flex items-baseline justify-between gap-2 xs:gap-3">
                  <dt className="min-w-0 break-words text-ink-3">
                    {item.meta.singular}
                    {!item.present && <span className="text-clay"> · not in the catalog</span>}
                    {item.present && !item.configured && (
                      <span className="text-ink-4"> · switched off</span>
                    )}
                  </dt>
                  <dd className="num shrink-0 whitespace-nowrap">
                    <span className={clsx(item.stock > 0 ? "text-ink" : "text-clay")}>
                      {item.stock}
                    </span>{" "}
                    <span className="text-ink-3">pieces</span>
                  </dd>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-2 border-t border-line pt-1.5 font-semibold xs:gap-3">
                <dt className="min-w-0 break-words">Complete kits on the shelf</dt>
                <dd
                  className={clsx(
                    "num shrink-0 whitespace-nowrap",
                    kit.kitsAvailable > 0 ? "text-plum" : "text-clay",
                  )}
                >
                  <RollingNumber value={kit.kitsAvailable} />
                </dd>
              </div>
            </dl>
            <p className="mt-2 break-words text-micro leading-relaxed text-ink-3">
              One cover, one edge tape and one overgrip piece per paddle. Buy them on a batch —
              covers and edge tapes by the piece, overgrips by the pack of {OVERGRIPS_PER_PACK} —
              and receiving that batch stocks the shelf and sets each cost to what it actually paid
              per piece.
            </p>
          </div>

          <p className="border-t border-line-soft px-3.5 py-3 text-micro leading-relaxed text-ink-3">
            A freebie adds nothing to revenue, so its full cost comes off the profit of any order it
            appears on, and off every rollup. Switch one off to keep its history while hiding it from
            new orders.
          </p>
        </motion.div>
      </Section>

      {/* ----------------------------------------------------- verification */}
      <Section title="Verification">
        <motion.div variants={listChild} className="card p-3.5 sm:p-4">
          <div className="flex items-start justify-between gap-2 xs:gap-3">
            <div className="min-w-0 flex-1">
              <p className="break-words text-[15px] font-semibold">{REFERENCE.name}</p>
              <p className="num mt-0.5 break-words text-micro text-ink-3">
                {REFERENCE.vnd.toLocaleString()}₫ · rate {REFERENCE.rate} · ₱
                {REFERENCE.batchShipping} ÷ {REFERENCE.batchQty} items
              </p>
            </div>
            <Chip tone={verification.passes ? "teal" : "clay"} dot>
              {verification.passes ? "Checks out" : "Mismatch"}
            </Chip>
          </div>

          <div className="mt-3 border-t border-line-soft pt-3">
            <CalcRows
              rows={[
                {
                  label: "VND Cost",
                  value: verification.calc.vndCost,
                  display: `${REFERENCE.vnd.toLocaleString()}₫`,
                },
                {
                  label: "PHP Supplier Cost",
                  value: verification.calc.supplierPhp,
                  display: php(verification.calc.supplierPhp),
                  note: `÷ ${REFERENCE.rate}`,
                },
                {
                  label: "Combined Shipping Allocation",
                  value: verification.calc.alloc,
                  display: php(verification.calc.alloc),
                  accent: true,
                  note: `₱${REFERENCE.batchShipping} ÷ ${REFERENCE.batchQty} units`,
                },
                {
                  label: "Landed Cost",
                  value: verification.calc.landed,
                  display: php(verification.calc.landed),
                  rule: true,
                  strong: true,
                },
                {
                  label: "Standard Selling Price",
                  value: verification.calc.price,
                  display: php(verification.calc.price, { decimals: 0 }),
                },
                {
                  label: "Actual Profit",
                  value: verification.calc.profit,
                  display: php(verification.calc.profit),
                  rule: true,
                  strong: true,
                  tone: "teal",
                },
              ]}
            />
          </div>

          <p className="mt-3 border-t border-line-soft pt-3 text-micro leading-relaxed text-ink-3">
            {verification.passes ? (
              <>
                Run through the same function every screen uses, this lands on{" "}
                <span className="num font-medium text-ink">₱16,586.54</span> supplier cost,{" "}
                <span className="num font-medium text-ink">₱16,599.04</span> landed and{" "}
                <span className="num font-medium text-ink">₱2,300.96</span> profit. The ₱12.50 comes
                from the batch, not a ₱200 charge per paddle.
              </>
            ) : (
              "The live calculation no longer matches the reference figures. Check the allocation rule in src/lib/calc.js."
            )}
          </p>
        </motion.div>
      </Section>

      {/* -------------------------------------------------------- storefront */}
      {/*
        THE STOREFRONT'S TWO DOORS, TOGETHER. The photo desk is not in the
        bottom bar, so this is where a phone reaches it — and the shop link
        beside it is the real route, never an invented short URL.
      */}
      <Section title="Storefront">
        <motion.div variants={listChild} className="card p-3.5 sm:p-4">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-cobalt-wash text-cobalt">
              <ImageSquare size={18} weight="fill" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold">The public shop</p>
              <p className="mt-0.5 break-words text-micro leading-relaxed text-ink-3">
                Buyers see the paddles, colours, prices and whether a paddle is in stock — never a
                unit count, a cost or a profit. Only photos you have approved reach it.
              </p>
            </div>
          </div>

          <div className="mt-3 grid gap-2 border-t border-line-soft pt-3 xs:grid-cols-2">
            <Link to="/storefront-photos" className="btn-quiet w-full" onClick={() => haptic(6)}>
              <ImageSquare size={16} />
              Storefront photos
            </Link>
            <a
              href={PUBLIC_SHOP_PATH}
              target="_blank"
              rel="noreferrer"
              className="btn-quiet w-full"
            >
              <ArrowSquareOut size={16} />
              View storefront
            </a>
          </div>

          <p className="num mt-2.5 break-all text-micro text-ink-4">{PUBLIC_CATALOG_PATH}</p>
        </motion.div>
      </Section>

      {/* ---------------------------------------------------------- catalog */}
      <Section title="Catalog">
        <motion.div variants={listChild} className="card p-3.5 sm:p-4">
          <div className="flex items-start justify-between gap-2 xs:gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold">Standard line</p>
              <p className="num mt-0.5 break-words text-micro text-ink-3">
                <RollingNumber value={audit?.stored ?? 0} /> of {audit?.total ?? 0} stored with a
                selling price
              </p>
            </div>
            <Chip tone={audit?.complete ? "teal" : "clay"} dot>
              {audit?.complete ? "All saved" : "Incomplete"}
            </Chip>
          </div>

          <p className="mt-3 border-t border-line-soft pt-3 text-micro leading-relaxed text-ink-3">
            {audit?.entries.length
              ? "This list is the live active inventory shown on Stock, including active colour variants. Archived and stale catalog rows are not included."
              : "No active inventory is stored yet."}
          </p>

          <button
            type="button"
            className="btn-quiet mt-3 w-full"
            disabled={!audit}
            onClick={(e) => {
              captureAuditOrigin(e);
              setAuditOpen(true);
              haptic(8);
            }}
          >
            <Database size={16} />
            See what is stored
          </button>
        </motion.div>
      </Section>

      {/* ------------------------------------------------------- how it works */}
      <Section title="How this is used">
        <motion.ul variants={listParent} className="card divide-y divide-line-soft overflow-hidden">
          {[
            {
              t: "The rate converts every supplier cost",
              d: "Supplier costs are stored in dong. Every peso figure divides by this rate, so changing it moves landed cost and actual profit together.",
            },
            {
              t: "Batch shipping is allocated, never charged per paddle",
              d: "Manila to CDO is one cost for the whole batch. It is divided by the total quantity in that batch, so each paddle carries an equal slice.",
            },
            {
              t: "Selling prices are set by you, not calculated",
              d: "Each paddle carries its own standard selling price, editable any time in Inventory. It never moves on its own when shipping, the rate or landed cost change. A single order line can still be sold at a different price without touching the standard.",
            },
            {
              t: "Freebies are a cost, never revenue",
              d: "A cover, tape or grip thrown in has a unit cost you set here. That cost comes off the profit of the order it appears on, and completing the order takes it out of freebie stock.",
            },
            {
              t: "Consumables are bought on a batch, given away on an order",
              d: `Covers and edge tapes are bought by the piece, overgrips by the pack of ${OVERGRIPS_PER_PACK}. Their full purchase cost is part of that batch's landed cost and batch profit. Receiving the batch puts the pieces on the freebie shelf; giving one away costs the order it went out on, never the batch twice.`,
            },
            {
              t: "Customer shipping is excluded from profit",
              d: "Delivery a customer pays after a sale counts toward their balance for payment tracking, and never toward product revenue or profit.",
            },
          ].map((row) => (
            <motion.li key={row.t} variants={listChild} className="flex gap-3 px-3 py-3 xs:px-3.5">
              <Info size={16} className="mt-0.5 shrink-0 text-ink-4" />
              <div className="min-w-0">
                <p className="break-words text-eta font-medium">{row.t}</p>
                <p className="mt-0.5 break-words text-micro leading-relaxed text-ink-3">{row.d}</p>
              </div>
            </motion.li>
          ))}
        </motion.ul>
      </Section>

      <Section title="Reset">
        <motion.div variants={listChild} className="card p-3.5">
          <p className="break-words text-eta text-ink-2">
            Put both back to{" "}
            <span className="num font-medium text-ink">
              {DEFAULT_SETTINGS.php_to_vnd_rate}₫ and ₱{DEFAULT_SETTINGS.default_shipping_php} a
              batch
            </span>
            . Your paddles, their selling prices, freebies, orders and payments are untouched.
          </p>
          <button
            type="button"
            className="btn-quiet mt-3 w-full"
            disabled={atDefaults}
            onClick={(e) => {
              captureResetOrigin(e);
              setConfirmReset(true);
            }}
          >
            <ArrowCounterClockwise size={16} />
            {atDefaults ? "Already at defaults" : "Reset to defaults"}
          </button>
        </motion.div>
      </Section>

      <motion.p variants={listChild} className="mt-6 px-1 text-center text-micro text-ink-4">
        PTG Admin Portal · every change saves to the shared ledger
      </motion.p>

      <CatalogTray
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        origin={auditOrigin}
        audit={audit}
      />

      <FreebieTray
        key={stickyFreebie === "new" ? "new-freebie" : (stickyFreebie?.id ?? "f-closed")}
        open={!!editingFreebie}
        freebie={stickyFreebie === "new" ? null : stickyFreebie}
        origin={freebieOrigin}
        onClose={() => setEditingFreebie(null)}
        onSave={(values) => commit((db) => db.saveFreebie(values))}
      />

      <ConfirmTray
        open={!!deletingFreebie}
        onClose={() => setDeletingFreebie(null)}
        title={`Delete ${stickyDeleting?.name || ""}?`}
        body="Past orders keep the freebie cost they recorded, so your books stay right. It just disappears from the picker. Switching it off keeps it listed here instead."
        confirmLabel="Delete freebie"
        onConfirm={async () => {
          await commit((db) => db.deleteFreebie(stickyDeleting.id));
          toast("Freebie deleted");
        }}
      />

      <ConfirmTray
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        origin={resetOrigin}
        title="Reset both settings?"
        body={`The rate goes back to ${DEFAULT_SETTINGS.php_to_vnd_rate}₫ and batch shipping to ₱${DEFAULT_SETTINGS.default_shipping_php}. Your selling prices are not touched.`}
        confirmLabel="Reset them"
        onConfirm={async () => {
          await commit((db) => db.resetSettings());
          toast.success("Settings back to defaults");
        }}
      />
    </motion.div>
  );
}

/* --------------------------------------------------------------- freebies */

function FreebieRow({ freebie, onEdit, onDelete, onToggle }) {
  // Optimistic: the switch moves under the finger, not after a round trip, and
  // re-syncs the moment the real value comes back.
  const [pending, setPending] = useState(null);
  const active = pending === null ? !!freebie.active : pending;
  useEffect(() => {
    setPending(null);
  }, [freebie.active]);

  return (
    <motion.li
      layout
      variants={listChild}
      exit={{ opacity: 0, x: -16, height: 0 }}
      transition={spring}
      className={clsx(
        "flex items-center gap-2 border-b border-line-soft px-3 py-2.5 last:border-b-0 xs:px-3.5",
        !active && "opacity-60",
      )}
    >
      {/* The switch moves under the finger and stays put, no round-trip wait. */}
      <button
        type="button"
        role="switch"
        aria-checked={active}
        aria-label={`${active ? "Switch off" : "Switch on"} ${freebie.name}`}
        onClick={() => {
          haptic(8);
          setPending(!active);
          Promise.resolve(onToggle()).catch(() => setPending(null));
        }}
        className={clsx(
          "relative h-6 w-10 shrink-0 rounded-full transition-colors duration-150",
          active ? "bg-plum" : "bg-line",
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
        <p className="truncate text-eta font-medium">{freebie.name}</p>
        <p className="num mt-0.5 truncate text-micro text-ink-3">
          {php(freebie.unit_cost)} each · {M(freebie.quantity)} in stock
        </p>
      </div>

      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${freebie.name}`}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-ink-3 transition-transform duration-150 active:scale-90 active:bg-paper"
      >
        <PencilSimple size={16} />
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${freebie.name}`}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-ink-3 transition-transform duration-150 active:scale-90 active:bg-paper"
      >
        <Trash size={16} />
      </button>
    </motion.li>
  );
}

function FreebieTray({ open, freebie, origin, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    name: freebie?.name ?? "",
    unit_cost: String(freebie?.unit_cost ?? ""),
    quantity: String(freebie?.quantity ?? 0),
    active: freebie ? !!freebie.active : true,
  }));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => {
    const value = e?.target ? e.target.value : e;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const save = async () => {
    const found = validate(FREEBIE_RULES, form);
    if (Object.keys(found).length) {
      setErrors(found);
      haptic([12, 40, 12]);
      return;
    }
    setSaving(true);
    try {
      await onSave({ ...form, id: freebie?.id });
      haptic(12);
      toast.success(freebie ? "Freebie updated" : "Freebie added");
      onClose();
    } catch {
      toast.error("Could not save the freebie. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Tray
      open={open}
      onClose={onClose}
      origin={origin}
      title={freebie ? "Edit freebie" : "Add a freebie"}
      subtitle="What it costs you, every time you throw one in"
      footer={
        <div className="flex gap-2">
          <button type="button" className="btn-quiet flex-1" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary flex-[1.6]" disabled={saving} onClick={save}>
            <MorphLabel>
              {saving ? "Saving…" : freebie ? "Save changes" : "Add freebie"}
            </MorphLabel>
          </button>
        </div>
      }
    >
      <div className="space-y-3 pt-1">
        <Field label="Name" error={errors.name} required>
          <Input
            value={form.name}
            onChange={set("name")}
            error={errors.name}
            placeholder="Paddle Cover"
            data-autofocus
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Unit cost" hint="₱" error={errors.unit_cost}>
            <Input
              numeric
              value={form.unit_cost}
              onChange={set("unit_cost")}
              error={errors.unit_cost}
              placeholder="0"
            />
          </Field>
          <Field label="In stock" error={errors.quantity}>
            <Input
              numeric
              value={form.quantity}
              onChange={set("quantity")}
              error={errors.quantity}
            />
          </Field>
        </div>

        {/* The impact line appears the moment there is a cost to state. */}
        <AnimatePresence initial={false}>
          {M(form.unit_cost) > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={spring}
              className="overflow-hidden"
            >
              <div className="flex items-center justify-between gap-2 rounded-md border border-plum/25 bg-plum-wash px-3 py-2.5">
                <span className="min-w-0 text-micro text-ink-3">Off the profit, each time</span>
                <span className="num shrink-0 whitespace-nowrap text-[15px] font-semibold text-plum">
                  <RollingNumber value={`−${php(form.unit_cost)}`} />
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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
              form.active ? "bg-plum" : "bg-line",
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
              {form.active ? "Offered on new orders" : "Hidden from new orders"}
            </span>
            <span className="mt-0.5 block break-words text-micro leading-snug text-ink-3">
              Switching it off keeps every past order exactly as it is.
            </span>
          </span>
        </button>
      </div>
    </Tray>
  );
}

/* ---------------------------------------------------------- catalog audit */

function CatalogTray({ open, onClose, origin, audit }) {
  return (
    <Tray
      open={open}
      onClose={onClose}
      origin={origin}
      title="What is stored"
      subtitle={audit ? `${audit.stored} of ${audit.total} with a selling price` : "Checking…"}
    >
      <ul className="divide-y divide-line-soft pb-2 pt-1">
        {(audit?.entries || []).map((entry) => (
          <li key={entry.key} className="flex items-baseline justify-between gap-2 py-2 xs:gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-eta font-medium">{entry.name}</p>
              <p className="num mt-0.5 truncate text-micro text-ink-4">
                {entry.sku} · {entry.state.label} · {entry.quantity} on hand
              </p>
            </div>
            <div className="max-w-[45%] shrink-0 text-right">
              <p className={clsx("num whitespace-nowrap text-eta font-semibold", entry.price == null ? "text-ink-4" : "text-ink")}>
                {entry.price == null ? "No price" : php(entry.price, { decimals: 0 })}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <p className="border-t border-line pt-3 text-micro leading-relaxed text-ink-3">
        Prices and stock states are read directly from the active Stock records. Edit Inventory or a
        colour variant there and this view updates from the same source on the next refresh.
      </p>
    </Tray>
  );
}

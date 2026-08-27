import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { MagnifyingGlass } from "@phosphor-icons/react";
import clsx from "clsx";
import { spring, listChild, listParent, haptic } from "../lib/motion";
import { M, pct } from "../lib/calc";

/* ------------------------------------------------------------ RollingNumber */

/**
 * Money counts to its new value instead of snapping. Tier-1 delight: it is
 * touched every session, so it stays to a single vertical roll of the whole
 * figure and nothing bigger.
 */
export function RollingNumber({ value, className, direction = "auto" }) {
  const reduce = useReducedMotion();
  const text = String(value ?? "");
  const previous = useRef(text);
  // The true minus sign is folded back to a hyphen first, so "−₱2,334.62"
  // reads as negative and the roll goes the way the figure actually moved.
  const numeric = (s) =>
    parseFloat(String(s).replace(/[−–—]/g, "-").replace(/[^\d.-]/g, "")) || 0;
  const up =
    direction === "auto" ? numeric(text) >= numeric(previous.current) : direction === "up";

  useEffect(() => {
    previous.current = text;
  }, [text]);

  if (reduce) return <span className={clsx("num", className)}>{text}</span>;

  /**
   * ONE ATOMIC STRING PER LAYER, STACKED IN A SINGLE GRID CELL.
   *
   * The already-formatted value is never split into glyphs and never re-enters
   * the inline flow mid-roll: the outgoing and incoming values are two whole
   * strings sharing `col-start-1 row-start-1`, so they can only ever pass each
   * other VERTICALLY. Nothing sits beside anything, which is what used to
   * render ₱16,8658 or crowd ₱500.00 into ₱5000.
   *
   * The grid track sizes to the wider of the two, so the box never collapses
   * mid-transition and neither value is clipped into a malformed figure —
   * which is exactly what an absolutely-positioned exit layer did before.
   * `whitespace-nowrap` keeps one value on one line: a currency figure is a
   * single token and must never wrap between its digits.
   */
  return (
    <span className={clsx("num inline-grid overflow-hidden", className)}>
      <span className="sr-only">{text}</span>
      <AnimatePresence initial={false}>
        <motion.span
          key={text}
          aria-hidden="true"
          initial={{ y: up ? "0.9em" : "-0.9em", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: up ? "-0.9em" : "0.9em", opacity: 0 }}
          transition={spring}
          className="col-start-1 row-start-1 whitespace-nowrap"
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/* -------------------------------------------------------------- StockDots */

/**
 * THE SIGNATURE ELEMENT. Stock on hand read as a row of dots against the
 * reorder line: filled dots are units you have, the ringed dot is where the
 * reorder level sits. Lime while healthy, clay the moment it drops to or below
 * the line — nothing announces it, you just see the row turn red.
 */
export function StockDots({ quantity = 0, reorder = 0, holes = 10, className, animate = true }) {
  const reduce = useReducedMotion();
  const scale = Math.max(reorder * 3, quantity, holes, 1);
  const filled = Math.round(Math.min(1, quantity / scale) * holes);
  const mark = Math.round(Math.min(1, (reorder || 0) / scale) * holes);
  const low = quantity <= reorder;

  return (
    <span
      className={clsx("inline-flex shrink-0 items-center gap-[2px] xs:gap-[3px]", className)}
      role="img"
      aria-label={`${quantity} on hand, reorder at ${reorder}`}
    >
      {Array.from({ length: holes }).map((_, i) => {
        const isFilled = i < filled;
        const isMark = i === Math.max(0, mark - 1) && reorder > 0;
        return (
          <motion.span
            key={i}
            initial={animate && !reduce ? { scale: 0.2, opacity: 0 } : false}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ ...spring, delay: reduce ? 0 : i * 0.018 }}
            className={clsx(
              "block h-[7px] w-[7px] rounded-full",
              isFilled ? (low ? "bg-clay" : "bg-lime") : "bg-line",
              isMark && !isFilled && "ring-1 ring-inset ring-ink-4",
            )}
          />
        );
      })}
    </span>
  );
}

/* --------------------------------------------------------- CalcRows (the six) */

/**
 * The identical six-row breakdown that appears in the product tray, on a batch
 * line and in Settings. One component, so the calculation is explained the same
 * way everywhere it is shown.
 */
export function CalcRows({ rows, className, dense = false }) {
  return (
    <dl className={clsx("space-y-1.5", dense ? "text-micro" : "text-eta", className)}>
      {rows.map((row) => {
        if (row.hidden) return null;
        const blank = row.value === null || row.value === undefined;
        return (
          <div
            key={row.label}
            className={clsx(
              "flex items-baseline justify-between gap-2 xs:gap-3",
              row.rule && "border-t border-line pt-1.5",
              row.strong && "font-semibold",
            )}
          >
            <dt className={clsx("min-w-0 flex-1", row.strong ? "text-ink" : "text-ink-3")}>
              <span className={clsx("break-words", row.accent && "text-cobalt")}>{row.label}</span>
              {row.note && (
                <span className="ml-1.5 break-words text-micro text-ink-4">{row.note}</span>
              )}
            </dt>
            <dd
              className={clsx(
                "num shrink-0 whitespace-nowrap text-right tabular-nums",
                row.strong && !dense && "text-[15px]",
                row.accent && "text-cobalt",
                row.tone === "clay" && "!text-clay",
                row.tone === "teal" && "!text-teal",
                blank && "!text-ink-4",
              )}
            >
              {blank ? (
                row.placeholder || "—"
              ) : row.roll ? (
                <RollingNumber value={row.display} />
              ) : (
                row.display
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/* ------------------------------------------------------------- SafeFloor */

/**
 * THE PRICING SAFETY PANEL. Advisory, and it says so: it shows the margin the
 * current price actually earns, and the suggested minimum safe price the target
 * margin implies. It never writes anything — there is deliberately no "apply"
 * button, because a floor that silently moves a price is not a floor.
 *
 * The freebie term is a switch rather than an assumption. Off, the floor is the
 * one for a paddle sold bare; on, it carries the standard kit, and the kit row
 * GROWS IN the moment it becomes part of the answer. The whole panel turns clay
 * when the real price sits under the floor — nothing announces it, you just see
 * the figure go red.
 */
export function SafeFloorPanel({
  math,
  kitCost = 0,
  includeKit = false,
  onToggleKit,
  className,
  dense = false,
}) {
  const reduce = useReducedMotion();
  const t = reduce ? { duration: 0.001 } : spring;
  const below = math?.belowSafePrice;
  const hasFloor = math?.minimumSafePrice !== null && math?.minimumSafePrice !== undefined;
  const fmt = (n) =>
    `₱${Math.round(M(n)).toLocaleString("en-PH")}`;

  return (
    <div
      className={clsx(
        "overflow-hidden rounded-md border p-2.5 xs:p-3",
        below ? "border-clay/30 bg-clay-wash" : "border-line bg-paper",
        className,
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <p className={clsx("eyebrow", below && "!text-clay")}>Pricing safety</p>
        <span className="num shrink-0 text-micro text-ink-3">
          target {pct(M(math?.desiredMarginPercent), 0)}
        </span>
      </div>

      <dl className={clsx("mt-2 space-y-1.5", dense ? "text-micro" : "text-eta")}>
        <div className="flex items-baseline justify-between gap-2 xs:gap-3">
          <dt className="min-w-0 break-words text-ink-3">Margin at this price</dt>
          <dd
            className={clsx(
              "num shrink-0 whitespace-nowrap",
              math?.margin === null || math?.margin === undefined
                ? "text-ink-4"
                : math.margin < 0
                  ? "text-clay"
                  : "text-ink",
            )}
          >
            {math?.margin === null || math?.margin === undefined ? "—" : pct(math.margin)}
          </dd>
        </div>

        {/* The freebie only enters the floor once it is actually selected. */}
        <AnimatePresence initial={false}>
          {includeKit && kitCost > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={t}
              className="overflow-hidden"
            >
              <div className="flex items-baseline justify-between gap-2 pt-0.5 xs:gap-3">
                <dt className="min-w-0 break-words text-plum">Freebie kit in the floor</dt>
                <dd className="num shrink-0 whitespace-nowrap text-plum">{fmt(kitCost)}</dd>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div
          className={clsx(
            "flex items-baseline justify-between gap-2 border-t pt-1.5 font-semibold xs:gap-3",
            below ? "border-clay/25" : "border-line",
          )}
        >
          <dt className="min-w-0 break-words">Suggested minimum safe price</dt>
          <dd
            className={clsx(
              "num shrink-0 whitespace-nowrap",
              !dense && "text-[15px]",
              below ? "text-clay" : hasFloor ? "text-ink" : "text-ink-4",
            )}
          >
            {hasFloor ? <RollingNumber value={fmt(math.minimumSafePrice)} /> : "needs a cost"}
          </dd>
        </div>
      </dl>

      {/* The kit switch, and only where there is a kit to switch on. */}
      {onToggleKit && kitCost > 0 && (
        <button
          type="button"
          role="switch"
          aria-checked={includeKit}
          onClick={() => {
            onToggleKit(!includeKit);
            haptic(6);
          }}
          className="mt-2.5 flex w-full items-center gap-2.5 rounded-md border border-line bg-surface px-2.5 py-2 text-left
                     transition-transform duration-150 active:scale-[0.99]"
        >
          <span
            className={clsx(
              "relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150",
              includeKit ? "bg-plum" : "bg-line",
            )}
          >
            <motion.span
              layout
              transition={t}
              className={clsx(
                "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm",
                includeKit ? "left-[18px]" : "left-0.5",
              )}
            />
          </span>
          <span className="min-w-0 flex-1 break-words text-micro leading-snug text-ink-2">
            {includeKit
              ? `Sold with the standard freebie kit, ${fmt(kitCost)} a paddle.`
              : "Sold bare. Switch on to price in the standard freebie kit."}
          </span>
        </button>
      )}

      <p
        className={clsx(
          "mt-2 break-words text-micro leading-relaxed",
          below ? "text-clay" : "text-ink-3",
        )}
      >
        {below
          ? `This price is ${fmt(math.shortOfSafePrice)} under the floor for a ${pct(M(math.desiredMarginPercent), 0)} margin. It is only a suggestion — nothing here changes the price you sell at.`
          : "A suggestion only, worked out from landed cost ÷ (1 − target margin). Your selling price is never changed by it."}
      </p>
    </div>
  );
}

/** The one rule that has to be repeated wherever profit is shown. */
export function ShippingNote({ className, children }) {
  return (
    <p className={clsx("flex gap-1.5 px-0.5 text-micro leading-relaxed text-ink-3", className)}>
      <span aria-hidden="true" className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink-4" />
      <span>
        {children ||
          "Shipping the customer pays is separate. It is tracked against what they owe, and never counted in product revenue or profit."}
      </span>
    </p>
  );
}

/* -------------------------------------------------------------------- Chip */

const TONES = {
  cobalt: "bg-cobalt-wash text-cobalt",
  lime: "bg-lime-wash text-lime-deep",
  clay: "bg-clay-wash text-clay",
  teal: "bg-teal-wash text-teal",
  plum: "bg-plum-wash text-plum",
  gray: "bg-paper text-ink-3",
};

export function Chip({ tone = "gray", children, className, dot = false }) {
  return (
    <span
      className={clsx(
        "inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full px-2 py-[3px] text-eyebrow font-semibold",
        TONES[tone] || TONES.gray,
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" />}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ inputs */

/**
 * `group` renders the wrapper as a plain div instead of a label, for a field
 * whose control is a set of BUTTONS (`SegmentedPills`) rather than one input —
 * a label may not contain interactive controls of its own.
 */
export function Field({ label, hint, error, children, className, required, group = false }) {
  const Wrap = group ? "div" : "label";
  return (
    <Wrap className={clsx("field-wrap block min-w-0", className)}>
      <span className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <span className="min-w-0 break-words text-eta font-medium text-ink-2">
          {label}
          {required && <span className="ml-0.5 text-clay">*</span>}
        </span>
        {hint && <span className="num shrink-0 text-micro text-ink-3">{hint}</span>}
      </span>
      {children}
      {/* The error grows in next to its own field, never in a summary. */}
      <AnimatePresence initial={false}>
        {error && (
          <motion.span
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring}
            className="block overflow-hidden text-micro text-clay"
          >
            <span className="block pt-1">{error}</span>
          </motion.span>
        )}
      </AnimatePresence>
    </Wrap>
  );
}

export function Input({ error, numeric, className, ...rest }) {
  return (
    <input
      {...rest}
      inputMode={numeric ? "decimal" : rest.inputMode}
      className={clsx("field", numeric && "num", error && "field-err", className)}
    />
  );
}

export function Select({ error, className, children, ...rest }) {
  return (
    <div className="field-wrap relative w-full min-w-0 max-w-full">
      <select {...rest} className={clsx("field appearance-none pr-9", error && "field-err", className)}>
        {children}
      </select>
      <svg
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3"
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        aria-hidden="true"
      >
        <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/**
 * A product photograph, stored as a plain URL and shown on the customer
 * invoice. The preview GROWS IN the moment there is something to preview and
 * collapses when the field is cleared, so the field explains itself without
 * ever occupying space it has not earned.
 */
export function PhotoField({ label = "Photo", hint, value, onChange, placeholder, fallback }) {
  const reduce = useReducedMotion();
  const [broken, setBroken] = useState(false);
  const url = String(value || "").trim();
  const valid = /^(https?:\/\/|data:image\/)/i.test(url);
  const shown = valid ? url : fallback || null;

  useEffect(() => {
    setBroken(false);
  }, [shown]);

  return (
    <div className="field-wrap min-w-0">
      <Field
        label={label}
        hint={hint ?? "optional, shown on the invoice"}
        error={url && !valid ? "Needs to start with https://" : undefined}
      >
        <Input
          type="url"
          inputMode="url"
          value={value}
          onChange={onChange}
          error={url && !valid}
          placeholder={placeholder || "https://…/paddle.jpg"}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </Field>

      <AnimatePresence initial={false}>
        {shown && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={reduce ? { duration: 0.001 } : spring}
            className="overflow-hidden"
          >
            <div className="mt-2 flex items-center gap-3 rounded-md border border-line bg-paper p-2.5">
              <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-sm border border-line bg-surface">
                {broken ? (
                  <span className="text-micro text-ink-4">—</span>
                ) : (
                  <img
                    src={shown}
                    alt=""
                    onError={() => setBroken(true)}
                    className="h-full w-full object-cover"
                  />
                )}
              </span>
              <span className="min-w-0 flex-1 text-micro leading-relaxed text-ink-3">
                {broken
                  ? "That link did not load. The invoice will fall back to its placeholder."
                  : valid
                    ? "This is the photo the invoice will show for this line."
                    : "No photo of its own, so the invoice uses the paddle's."}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = "Search" }) {
  return (
    <div className="field-wrap relative w-full min-w-0 max-w-full">
      <MagnifyingGlass
        size={16}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="field pl-9"
      />
    </div>
  );
}

/**
 * Filter chips. The dark pill TRAVELS between options via layoutId rather than
 * repainting, so the selection reads as one thing moving.
 */
export function FilterChips({ options, value, onChange, idPrefix = "f" }) {
  return (
    <div className="tab-scroll -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 lg:-mx-8 lg:px-8">
      {options.map((option) => {
        const val = typeof option === "string" ? option : option.value;
        const label = typeof option === "string" ? option : option.label;
        const active = val === value;
        return (
          <button
            key={val}
            type="button"
            onClick={() => {
              onChange(val);
              haptic(6);
            }}
            aria-pressed={active}
            className={clsx(
              "relative shrink-0 rounded-full px-3 py-1.5 text-eta font-medium transition-colors duration-150",
              active ? "text-white" : "text-ink-2 hover:text-ink",
            )}
          >
            {active && (
              <motion.span
                layoutId={`${idPrefix}-pill`}
                transition={spring}
                className="absolute inset-0 rounded-full bg-ink"
              />
            )}
            <span className="relative z-10 whitespace-nowrap">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The same travelling pill as `FilterChips`, sized to sit INSIDE a form as a
 * field control rather than above a page as a filter. Full-width segments on a
 * track, thumb-sized on a phone, and the pill travels between them via
 * `layoutId` rather than repainting — so switching the basis of a quote reads as
 * one selection moving, not two buttons changing colour.
 */
export function SegmentedPills({ options, value, onChange, idPrefix = "seg", label }) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex w-full min-w-0 gap-1 rounded-sm border border-line bg-surface p-1"
    >
      {options.map((option) => {
        const val = typeof option === "string" ? option : option.value;
        const text = typeof option === "string" ? option : option.label;
        const active = val === value;
        return (
          <button
            key={val}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => {
              if (active) return;
              onChange(val);
              haptic(8);
            }}
            className={clsx(
              "relative min-h-[36px] flex-1 shrink basis-0 rounded-[4px] px-1.5 text-eta font-medium",
              "transition-[color,transform] duration-150 active:scale-[0.97]",
              active ? "text-white" : "text-ink-2",
            )}
          >
            {active && (
              <motion.span
                layoutId={`${idPrefix}-pill`}
                transition={spring}
                className="absolute inset-0 rounded-[4px] bg-ink"
              />
            )}
            <span className="relative z-10 block truncate">{text}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Stepper({ value, onChange, min = 0, max = 9999, label = "Quantity" }) {
  const set = (n) => {
    const next = Math.min(max, Math.max(min, n));
    if (next !== value) {
      onChange(next);
      haptic(6);
    }
  };
  return (
    <div className="inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-surface p-1">
      <button
        type="button"
        aria-label={`Decrease ${label.toLowerCase()}`}
        onClick={() => set(value - 1)}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-sm text-ink transition-transform duration-150 active:scale-90 active:bg-paper"
      >
        <span className="text-[18px] leading-none">−</span>
      </button>
      <span className="num min-w-[3ch] shrink-0 text-center text-[15px] font-medium tabular-nums">
        <RollingNumber value={value} />
      </span>
      <button
        type="button"
        aria-label={`Increase ${label.toLowerCase()}`}
        onClick={() => set(value + 1)}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-sm text-ink transition-transform duration-150 active:scale-90 active:bg-paper"
      >
        <span className="text-[18px] leading-none">+</span>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ chrome */

export function Section({ title, action, children, className }) {
  return (
    <section className={clsx("mt-6 first:mt-0", className)}>
      {(title || action) && (
        <div className="mb-2 flex items-end justify-between gap-2 px-1 xs:gap-3">
          {title && <h2 className="eyebrow min-w-0 break-words">{title}</h2>}
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Empty gets the same care as the happy path: an icon, a reason, a way out. */
export function EmptyState({ icon, title, body, action, className }) {
  const reduce = useReducedMotion();
  const t = reduce ? { duration: 0.001 } : spring;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={t}
      className={clsx(
        "flex flex-col items-center rounded-lg border border-dashed border-line bg-surface px-4 py-9 text-center sm:px-6 sm:py-10",
        className,
      )}
    >
      {icon && (
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ ...t, delay: reduce ? 0 : 0.05 }}
          className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-paper text-ink-3"
        >
          {icon}
        </motion.div>
      )}
      <h3 className="max-w-full text-balance break-words text-[16px] font-semibold">{title}</h3>
      {body && (
        <p className="mt-1 max-w-[34ch] break-words text-eta leading-relaxed text-ink-3">{body}</p>
      )}
      {action && <div className="mt-4 flex w-full max-w-[18rem] justify-center">{action}</div>}
    </motion.div>
  );
}

/** Loading is a shaped skeleton of the real thing, never a spinner. */
export function Skeleton({ className }) {
  const reduce = useReducedMotion();
  return (
    <div className={clsx("relative overflow-hidden rounded-md bg-line-soft", className)}>
      {!reduce && (
        <motion.div
          initial={{ x: "-100%" }}
          animate={{ x: "100%" }}
          transition={{ repeat: Infinity, duration: 1.4, ease: "linear" }}
          className="absolute inset-0 bg-white/55"
        />
      )}
    </div>
  );
}

/** A KPI tile. Its figure rolls, and it can be a shortcut to the page behind it. */
export function StatCard({ label, value, sub, tone = "ink", icon: Icon, onClick, span }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-1.5">
        <p className="eyebrow min-w-0 break-words">{label}</p>
        {Icon && <Icon size={15} className="mt-px shrink-0 text-ink-4" />}
      </div>
      <p
        className={clsx(
          "mt-1.5 truncate text-[19px] font-semibold leading-none tracking-tight xs:text-[22px]",
          tone === "clay" && "text-clay",
          tone === "teal" && "text-teal",
          tone === "cobalt" && "text-cobalt",
        )}
      >
        <RollingNumber value={value} />
      </p>
      {sub && <p className="mt-1.5 break-words text-micro leading-snug text-ink-3">{sub}</p>}
    </>
  );

  const shell = clsx(
    "card flex h-full min-w-0 flex-col px-3 py-3 text-left transition-[transform,box-shadow] duration-150",
    onClick && "active:scale-[0.98] active:bg-paper",
  );

  return (
    <motion.div variants={listChild} className={clsx("min-w-0", span === 2 && "col-span-2")}>
      {onClick ? (
        <button type="button" onClick={onClick} className={clsx(shell, "w-full")}>
          {body}
        </button>
      ) : (
        <div className={shell}>{body}</div>
      )}
    </motion.div>
  );
}

export { listParent, listChild, M };

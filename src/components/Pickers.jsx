import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Package, Gift } from "@phosphor-icons/react";
import Tray from "./Tray";
import { Chip, EmptyState, SearchInput, listChild, listParent } from "./ui";
import { useStore } from "../lib/store";
import { isArchived } from "../lib/data";
import { M, php, vnd, vndToPhp, stockState, stockUnits } from "../lib/calc";
import { haptic } from "../lib/motion";

/**
 * Nested inside the order / batch tray, so it carries a BACK arrow and is
 * deliberately shorter than the form that opened it.
 *
 * It lists STOCK UNITS, not products: a paddle with colour variants appears once
 * per colour, and a paddle without them appears exactly as it always did. The
 * colour rides in a quiet gray chip rather than a swatch, because the palette
 * has exactly one structural accent and a paddle colour is not it.
 */
export function ProductPicker({
  open,
  onClose,
  onBack,
  onPick,
  origin,
  exclude = [],
  title = "Choose a paddle",
  subtitle = "Tap one to add it as a line",
}) {
  const { products, settings, derived } = useStore();
  const [search, setSearch] = useState("");
  const rate = settings.php_to_vnd_rate;

  const excluded = useMemo(() => new Set(exclude), [exclude]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    const live = products.filter((p) => !isArchived(p));
    return stockUnits(live, derived.variantsByProduct)
      .filter((u) => !excluded.has(u.key))
      .filter((u) =>
        q
          ? `${u.sku} ${u.name} ${u.color || ""} ${u.product.category || ""}`
              .toLowerCase()
              .includes(q)
          : true,
      );
  }, [products, derived.variantsByProduct, search, excluded]);

  const total = useMemo(
    () => stockUnits(products.filter((p) => !isArchived(p)), derived.variantsByProduct).length,
    [products, derived.variantsByProduct],
  );

  return (
    <Tray
      open={open}
      onClose={onClose}
      onBack={onBack}
      origin={origin}
      title={title}
      subtitle={subtitle}
    >
      <div className="pt-1">
        <SearchInput value={search} onChange={setSearch} placeholder="Search paddles and colours" />

        {matches.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              icon={<Package size={20} />}
              title={total === 0 ? "No paddles to pick" : "Nothing matches"}
              body={
                total === 0
                  ? "Add a paddle in Inventory first, then it will show up here."
                  : "Every paddle and colour is either already on this list or filtered out by your search."
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
            {matches.map((u) => {
              const stock = stockState(u);
              return (
                <motion.li key={u.key} variants={listChild}>
                  <button
                    type="button"
                    onClick={() => {
                      haptic(8);
                      onPick(u);
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150 active:bg-paper"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="num shrink-0 text-micro text-ink-3">{u.sku}</span>
                        <span className="min-w-0 truncate text-eta font-medium">{u.name}</span>
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                        {u.color ? (
                          <Chip tone="gray">{u.color}</Chip>
                        ) : (
                          <Chip tone="gray">No colours</Chip>
                        )}
                        <Chip tone={stock.tone}>{u.quantity_on_hand} on hand</Chip>
                        <span className="num whitespace-nowrap text-micro text-ink-3">
                          {vnd(u.source_cost_vnd)} · {php(vndToPhp(u.source_cost_vnd, rate))}
                        </span>
                        {M(u.selling_price_php) > 0 && (
                          <span className="num whitespace-nowrap text-micro font-medium text-ink-2">
                            sells {php(u.selling_price_php, { decimals: 0 })}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </motion.li>
              );
            })}
          </motion.ul>
        )}
      </div>
    </Tray>
  );
}

/** The PTG extension: what gets thrown in with an order, and what it costs. */
export function FreebiePicker({ open, onClose, onBack, onPick, origin, exclude = [] }) {
  const { freebies } = useStore();

  const available = useMemo(
    () => freebies.filter((f) => f.active && !exclude.includes(f.id)),
    [freebies, exclude],
  );

  return (
    <Tray
      open={open}
      onClose={onClose}
      onBack={onBack}
      origin={origin}
      title="Add a freebie"
      subtitle="Its cost comes straight off this order's profit"
    >
      <div className="pt-1 pb-2">
        {available.length === 0 ? (
          <EmptyState
            icon={<Gift size={20} />}
            title={freebies.length === 0 ? "No freebies yet" : "Nothing left to add"}
            body={
              freebies.length === 0
                ? "Add covers, tape and grips in Settings, then they show up here."
                : "Every active freebie is already on this order, or switched off in Settings."
            }
          />
        ) : (
          <motion.ul
            variants={listParent}
            initial="hidden"
            animate="shown"
            className="divide-y divide-line-soft overflow-hidden rounded-md border border-line"
          >
            {available.map((f) => (
              <motion.li key={f.id} variants={listChild}>
                <button
                  type="button"
                  onClick={() => {
                    haptic(8);
                    onPick(f);
                  }}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150 active:bg-paper"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-eta font-medium">{f.name}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Chip tone={M(f.quantity) > 0 ? "teal" : "clay"}>
                        {M(f.quantity)} pieces on shelf
                      </Chip>
                      <span className="num whitespace-nowrap text-micro text-ink-3">
                        {php(f.unit_cost)} each
                      </span>
                      {M(f.quantity) <= 0 && (
                        <span className="whitespace-nowrap text-micro text-clay">
                          none left, buy some on a batch
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </motion.li>
            ))}
          </motion.ul>
        )}
        <p className="mt-3 px-1 text-micro leading-relaxed text-ink-3">
          A freebie is a giveaway, so it adds nothing to revenue and its full cost comes off
          profit. Completing the order takes the pieces off the freebie shelf, which is stocked by
          the consumables a batch buys.
        </p>
      </div>
    </Tray>
  );
}

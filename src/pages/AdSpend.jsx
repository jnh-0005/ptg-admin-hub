import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Megaphone, Plus, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";

import Tray, { ConfirmTray, MorphLabel, useOrigin, useSticky } from "../components/Tray";
import { EmptyState, Field, Input, RollingNumber, Section, listChild, listParent } from "../components/ui";
import { useStore } from "../lib/store";
import { M, formatDateShort, php, phpShort, today, validate } from "../lib/calc";
import { haptic, spring } from "../lib/motion";

const RULES = {
  spend_date: { required: true, label: "Date" },
  amount_php: { required: true, label: "Amount", positive: true },
};

/** This calendar month, in the same YYYY-MM-DD-prefix terms spend_date is stored in. */
const thisMonthPrefix = () => today().slice(0, 7);

/**
 * PROMOTION MONEY, TRACKED, NOT COSTED. Every other figure in this app
 * (Dashboard's "Actual profit", a batch's landed cost) is something a
 * SPECIFIC order or paddle caused — ad spend isn't attributable to any one
 * sale the way a paddle's supplier cost is, so it deliberately stays its
 * own running total here rather than being folded into product profit. See
 * the plan this was built from: a place to see what promotion is costing,
 * side by side with profit, not subtracted from it.
 */
export default function AdSpend() {
  const { adSpend, commit } = useStore();
  const [editing, setEditing] = useState(null); // "new" | entry
  const [deleting, setDeleting] = useState(null);
  const [origin, captureOrigin] = useOrigin();

  const stickyEditing = useSticky(editing);
  const stickyDeleting = useSticky(deleting);

  const monthPrefix = thisMonthPrefix();
  const totals = useMemo(() => {
    let month = 0;
    let allTime = 0;
    for (const row of adSpend) {
      const amount = M(row.amount_php);
      allTime += amount;
      if (String(row.spend_date || "").startsWith(monthPrefix)) month += amount;
    }
    return { month, allTime };
  }, [adSpend, monthPrefix]);

  /* Newest first, grouped under a month header so a running log still reads
     as "how much did I spend in September" at a glance. */
  const groups = useMemo(() => {
    const sorted = [...adSpend].sort((a, b) => {
      const d = String(b.spend_date || "").localeCompare(String(a.spend_date || ""));
      return d !== 0 ? d : b.id - a.id;
    });
    const byMonth = new Map();
    for (const row of sorted) {
      const key = String(row.spend_date || "").slice(0, 7) || "Undated";
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key).push(row);
    }
    return [...byMonth.entries()].map(([key, rows]) => ({
      key,
      label: key === "Undated" ? "Undated" : formatMonth(key),
      rows,
      subtotal: rows.reduce((s, r) => s + M(r.amount_php), 0),
    }));
  }, [adSpend]);

  return (
    <motion.div variants={listParent} initial="hidden" animate="shown">
      <motion.header variants={listChild} className="mb-3 flex items-end justify-between gap-3">
        <div className="hidden min-w-0 lg:block">
          <h1 className="text-[26px] font-semibold tracking-tight">Ad spend</h1>
          <p className="mt-0.5 text-eta text-ink-2">
            {php(totals.month, { decimals: 0 })} spent this month
          </p>
        </div>
        <button
          type="button"
          className="btn-primary ml-auto"
          onClick={(e) => {
            captureOrigin(e);
            setEditing("new");
          }}
        >
          <Plus size={17} weight="bold" />
          Log spend
        </button>
      </motion.header>

      <motion.div variants={listParent} className="grid grid-cols-2 gap-1.5 xs:gap-2">
        {[
          { label: "This month", value: totals.month },
          { label: "All time", value: totals.allTime },
        ].map((stat) => (
          <motion.div
            key={stat.label}
            variants={listChild}
            className="card min-w-0 px-2 py-2.5 xs:px-2.5"
          >
            <p className="eyebrow truncate">{stat.label}</p>
            <p className="num mt-1 truncate text-[15px] font-semibold leading-none tracking-tight xs:text-[17px]">
              <RollingNumber value={phpShort(stat.value)} />
            </p>
          </motion.div>
        ))}
      </motion.div>

      <Section title="Spend log">
        {adSpend.length === 0 ? (
          <motion.div variants={listChild}>
            <EmptyState
              icon={<Megaphone size={22} />}
              title="No ad spend logged"
              body="Log what you put into Facebook/Instagram boosts and campaigns here, so it's on record alongside everything else — this doesn't touch product profit, it's just kept for your own reference."
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
                  Log spend
                </button>
              }
            />
          </motion.div>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="mb-3 last:mb-0">
              <div className="mb-1.5 flex items-baseline justify-between px-0.5">
                <p className="eyebrow">{group.label}</p>
                <p className="num text-micro font-semibold text-ink-3">
                  {php(group.subtotal, { decimals: 0 })}
                </p>
              </div>
              <motion.ul variants={listParent} className="card overflow-hidden">
                <AnimatePresence initial={false}>
                  {group.rows.map((row) => (
                    <motion.li
                      key={row.id}
                      layout
                      variants={listChild}
                      exit={{ opacity: 0, height: 0 }}
                      transition={spring}
                      className="border-b border-line-soft last:border-b-0"
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          captureOrigin(e);
                          setEditing(row);
                        }}
                        className="flex w-full items-center gap-2.5 px-3 py-3 text-left transition-colors duration-150 active:bg-paper xs:gap-3 xs:px-3.5"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-eta font-medium">
                            {row.note || "Ad spend"}
                          </span>
                          <span className="num mt-0.5 block truncate text-micro text-ink-3">
                            {formatDateShort(row.spend_date)}
                          </span>
                        </span>
                        <span className="num shrink-0 whitespace-nowrap text-[15px] font-semibold">
                          {php(row.amount_php, { decimals: 0 })}
                        </span>
                      </button>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </motion.ul>
            </div>
          ))
        )}
      </Section>

      <AdSpendTray
        key={stickyEditing === "new" ? "new" : (stickyEditing?.id ?? "closed")}
        open={!!editing}
        entry={stickyEditing && stickyEditing !== "new" ? stickyEditing : null}
        origin={origin}
        onClose={() => setEditing(null)}
        onDelete={(row) => setDeleting(row)}
        onSave={(payload) => commit((db) => db.saveAdSpend(payload))}
      />

      <ConfirmTray
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete this entry?"
        body={`${php(M(stickyDeleting?.amount_php), { decimals: 0 })} comes off your ad spend total. This can't be undone.`}
        confirmLabel="Delete entry"
        onConfirm={async () => {
          await commit((db) => db.deleteAdSpend(stickyDeleting.id));
          toast("Ad spend entry deleted");
        }}
      />
    </motion.div>
  );
}

function formatMonth(yyyyMm) {
  const [year, month] = yyyyMm.split("-").map(Number);
  if (!year || !month) return yyyyMm;
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/* ------------------------------------------------------------------- tray */

function AdSpendTray({ open, entry, origin, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(() => ({
    spend_date: entry?.spend_date ?? today(),
    amount_php: entry ? String(entry.amount_php ?? "") : "",
    note: entry?.note ?? "",
  }));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => {
    const value = e?.target ? e.target.value : e;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const save = async () => {
    const found = validate(RULES, form);
    if (Object.keys(found).length) {
      setErrors(found);
      haptic([12, 40, 12]);
      return;
    }
    setSaving(true);
    try {
      await onSave({ id: entry?.id, entry: form });
      haptic(12);
      toast.success(entry ? "Ad spend updated" : "Ad spend logged");
      onClose();
    } catch {
      toast.error("Could not save this entry. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Tray
      open={open}
      onClose={onClose}
      origin={origin}
      title={entry ? "Edit ad spend" : "Log ad spend"}
      subtitle="Facebook/Instagram promotion, tracked on its own"
      footer={
        <div className="flex gap-2">
          <button type="button" className="btn-quiet flex-1" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary flex-[1.6]" disabled={saving} onClick={save}>
            <MorphLabel>{saving ? "Saving…" : entry ? "Save changes" : "Save entry"}</MorphLabel>
          </button>
        </div>
      }
    >
      <div className="space-y-3 pt-1">
        <Field label="Amount" hint="₱" error={errors.amount_php} required>
          <Input
            numeric
            value={form.amount_php}
            onChange={set("amount_php")}
            error={errors.amount_php}
            placeholder="0.00"
            className="!text-[19px] !font-semibold"
            data-autofocus
          />
        </Field>

        <Field label="Date" error={errors.spend_date} required>
          <Input type="date" value={form.spend_date} onChange={set("spend_date")} error={errors.spend_date} />
        </Field>

        <Field label="Note" hint="optional">
          <textarea
            value={form.note}
            onChange={set("note")}
            rows={2}
            placeholder="What this was for — a boosted post, a campaign, a product it promoted"
            className="field resize-none"
          />
        </Field>

        {entry && (
          <div className="border-t border-line-soft pt-3">
            <button
              type="button"
              className="btn-quiet w-full !text-clay"
              onClick={() => onDelete(entry)}
            >
              <Trash size={16} />
              Delete entry
            </button>
          </div>
        )}
      </div>
    </Tray>
  );
}

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, Trash, Wallet } from "@phosphor-icons/react";
import { toast } from "sonner";
import clsx from "clsx";

import Tray, { ConfirmTray, MorphLabel, useOrigin, useSticky } from "../components/Tray";
import {
  Chip,
  EmptyState,
  Field,
  FilterChips,
  Input,
  RollingNumber,
  Section,
  Select,
  listChild,
  listParent,
} from "../components/ui";
import { useStore } from "../lib/store";
import {
  DEPOSIT_RESERVE_NOTE,
  M,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  formatDateShort,
  isLiveOrder,
  orderMath,
  paidFor,
  php,
  phpShort,
  today,
  validate,
} from "../lib/calc";
import { haptic, spring } from "../lib/motion";

const RULES = {
  payment_date: { required: true, label: "Date" },
  amount_php: { required: true, label: "Amount", positive: true },
};

export default function Payments() {
  const { payments, orders, derived, commit, ordersById } = useStore();
  const [filter, setFilter] = useState("All");
  const [editing, setEditing] = useState(null); // "new" | payment | { prefill }
  const [deleting, setDeleting] = useState(null);
  const [origin, captureOrigin] = useOrigin();

  const visible = useMemo(
    () => (filter === "All" ? payments : payments.filter((p) => p.status === filter)),
    [payments, filter],
  );

  const stickyEditing = useSticky(editing);
  const stickyDeleting = useSticky(deleting);

  /* Deposits first, then biggest balance: what to chase, in order. */
  const owing = useMemo(() => {
    const rows = [];
    for (const order of orders) {
      if (!isLiveOrder(order)) continue;
      const math = orderMath(
        order,
        derived.itemsByOrder.get(order.id) || [],
        derived.landedMap,
        paidFor(payments, order.id),
        derived.freebiesByOrder.get(order.id) || [],
      );
      if (math.balanceDue > 0.005) rows.push({ order, math });
    }
    return rows.sort((a, b) => {
      const aDep = a.math.dueNowOutstanding > 0.005 ? 1 : 0;
      const bDep = b.math.dueNowOutstanding > 0.005 ? 1 : 0;
      return aDep !== bDep ? bDep - aDep : b.math.balanceDue - a.math.balanceDue;
    });
  }, [orders, payments, derived]);

  return (
    <motion.div variants={listParent} initial="hidden" animate="shown">
      <motion.header variants={listChild} className="mb-3 flex items-end justify-between gap-3">
        <div className="hidden min-w-0 lg:block">
          <h1 className="text-[26px] font-semibold tracking-tight">Payments</h1>
          <p className="mt-0.5 text-eta text-ink-2">
            {php(derived.received, { decimals: 0 })} received
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
          Record payment
        </button>
      </motion.header>

      <motion.div variants={listParent} className="grid grid-cols-3 gap-1.5 xs:gap-2">
        {[
          { label: "Received", value: derived.received, tone: "teal" },
          {
            label: "Pending",
            value: derived.pendingPay,
            tone: derived.pendingPay > 0 ? "clay" : "ink",
          },
          { label: "Total", value: derived.totalPayments, tone: "ink" },
        ].map((stat) => (
          <motion.div
            key={stat.label}
            variants={listChild}
            className="card min-w-0 px-2 py-2.5 xs:px-2.5"
          >
            <p className="eyebrow truncate">{stat.label}</p>
            <p
              className={clsx(
                "mt-1 truncate text-[15px] font-semibold leading-none tracking-tight xs:text-[17px]",
                stat.tone === "teal" && "text-teal",
                stat.tone === "clay" && "text-clay",
              )}
            >
              <RollingNumber value={phpShort(stat.value)} />
            </p>
          </motion.div>
        ))}
      </motion.div>

      <AnimatePresence initial={false}>
        {derived.awaitingDeposit > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring}
            className="overflow-hidden"
          >
            <div className="mt-2 flex items-center gap-2.5 rounded-lg border border-cobalt/25 bg-cobalt-wash p-2.5 xs:p-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-cobalt/10 text-cobalt">
                <Wallet size={16} weight="fill" />
              </span>
              <p className="min-w-0 break-words text-micro leading-relaxed text-cobalt">
                <span className="num font-semibold">
                  {php(derived.depositsOutstanding, { decimals: 0 })}
                </span>{" "}
                of deposits still to collect across {derived.awaitingDeposit} order
                {derived.awaitingDeposit === 1 ? "" : "s"}. Until a deposit lands, that stock is not
                reserved.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Section title="Still owing">
        {owing.length === 0 ? (
          <motion.div variants={listChild}>
            <div className="card flex items-center gap-3 p-3.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-teal-wash text-teal">
                <Wallet size={16} weight="fill" />
              </span>
              <p className="min-w-0 break-words text-eta text-ink-2">
                {orders.length === 0
                  ? "No orders yet, so nothing can be owed."
                  : "Every live order is fully settled."}
              </p>
            </div>
          </motion.div>
        ) : (
          <motion.ul variants={listParent} className="card overflow-hidden">
            {owing.map(({ order, math }) => {
              const needsDeposit = math.isDeposit && math.dueNowOutstanding > 0.005;
              const settleAmount = needsDeposit ? math.dueNowOutstanding : math.balanceDue;
              return (
                <motion.li
                  key={order.id}
                  layout
                  variants={listChild}
                  transition={spring}
                  className="border-b border-line-soft px-3 py-3 last:border-b-0 xs:px-3.5"
                >
                  <div className="flex items-start justify-between gap-2 xs:gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-eta font-medium">
                        {order.customer_name || "Walk-in customer"}
                      </p>
                      <p className="num mt-0.5 break-words text-micro text-ink-3">
                        {order.order_number} · {formatDateShort(order.order_date)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="num whitespace-nowrap text-eta font-semibold text-clay">
                        {php(math.balanceDue, { decimals: 0 })}
                      </p>
                      <p className="num whitespace-nowrap text-micro text-ink-3">
                        of {php(math.billedTotal, { decimals: 0 })}
                      </p>
                    </div>
                  </div>

                  <p
                    className={clsx(
                      "mt-1.5 break-words text-micro font-medium",
                      needsDeposit ? "text-cobalt" : "text-ink-3",
                    )}
                  >
                    {math.paymentRequirementLabel}
                    {needsDeposit ? (
                      <>
                        {" · "}
                        <span className="num">
                          {php(math.dueNowOutstanding, { decimals: 0 })}
                        </span>{" "}
                        deposit still due
                      </>
                    ) : math.isDeposit ? (
                      " · deposit received, balance remaining"
                    ) : (
                      " · due now"
                    )}
                  </p>

                  <div className="mt-2 flex items-center gap-2.5">
                    <div className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line-soft">
                      <motion.div
                        initial={{ scaleX: 0 }}
                        animate={{
                          scaleX:
                            math.billedTotal > 0
                              ? Math.min(1, math.amountPaid / math.billedTotal)
                              : 0,
                        }}
                        transition={spring}
                        style={{ originX: 0 }}
                        className="h-full rounded-full bg-teal"
                      />
                      {math.isDeposit && math.billedTotal > 0 && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-cobalt"
                        />
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        captureOrigin(e);
                        setEditing({
                          prefill: {
                            order_id: order.id,
                            amount_php: settleAmount.toFixed(2),
                          },
                        });
                      }}
                      className="shrink-0 rounded-full border border-line bg-surface px-2.5 py-1 text-micro font-medium
                                 text-cobalt transition-transform duration-150 active:scale-95 active:bg-paper"
                    >
                      {/* Deposit → Settle share nothing, so the label morphs. */}
                      <MorphLabel>{needsDeposit ? "Deposit" : "Settle"}</MorphLabel>
                    </button>
                  </div>
                </motion.li>
              );
            })}
          </motion.ul>
        )}
      </Section>

      <Section title="Payment log">
        {payments.length === 0 ? (
          <motion.div variants={listChild}>
            <EmptyState
              icon={<Wallet size={22} />}
              title="No payments recorded"
              body="Log money as it lands, against an order or on its own. The summaries above build from these."
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
                  Record payment
                </button>
              }
            />
          </motion.div>
        ) : (
          <>
            <motion.div variants={listChild} className="mb-2">
              <FilterChips
                options={["All", ...PAYMENT_STATUSES]}
                value={filter}
                onChange={setFilter}
                idPrefix="pay"
              />
            </motion.div>

            {visible.length === 0 ? (
              <motion.div variants={listChild}>
                <EmptyState
                  icon={<Wallet size={22} />}
                  title={`No ${filter.toLowerCase()} payments`}
                  body="Change the filter to see the rest."
                  action={
                    <button type="button" className="btn-quiet" onClick={() => setFilter("All")}>
                      Show all
                    </button>
                  }
                />
              </motion.div>
            ) : (
              <motion.ul variants={listParent} className="card overflow-hidden">
                <AnimatePresence initial={false}>
                  {visible.map((payment) => {
                    const order = payment.order_id ? ordersById.get(payment.order_id) : null;
                    return (
                      <motion.li
                        key={payment.id}
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
                            setEditing(payment);
                          }}
                          className="flex w-full items-center gap-2.5 px-3 py-3 text-left transition-colors duration-150 active:bg-paper xs:gap-3 xs:px-3.5"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="min-w-0 truncate text-eta font-medium">
                                {payment.method || "Payment"}
                              </span>
                              <Chip
                                tone={
                                  payment.status === "Received"
                                    ? "teal"
                                    : payment.status === "Pending"
                                      ? "clay"
                                      : "gray"
                                }
                              >
                                {payment.status}
                              </Chip>
                            </span>
                            <span className="num mt-0.5 block truncate text-micro text-ink-3">
                              {formatDateShort(payment.payment_date)}
                              {order ? ` · ${order.order_number}` : " · standalone"}
                              {payment.reference ? ` · ${payment.reference}` : ""}
                            </span>
                          </span>
                          <span
                            className={clsx(
                              "num shrink-0 whitespace-nowrap text-[15px] font-semibold",
                              payment.status === "Refunded" && "text-ink-3 line-through",
                            )}
                          >
                            {php(payment.amount_php, { decimals: 0 })}
                          </span>
                        </button>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </motion.ul>
            )}
          </>
        )}
      </Section>

      <PaymentTray
        key={
          stickyEditing === "new"
            ? "new"
            : (stickyEditing?.id ?? `pre-${stickyEditing?.prefill?.order_id ?? "closed"}`)
        }
        open={!!editing}
        payment={stickyEditing && stickyEditing !== "new" && stickyEditing.id ? stickyEditing : null}
        prefill={stickyEditing?.prefill}
        origin={origin}
        onClose={() => setEditing(null)}
        onDelete={(p) => setDeleting(p)}
        onSave={(payload) => commit((db) => db.savePayment(payload))}
      />

      <ConfirmTray
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete this payment?"
        body={`${php(M(stickyDeleting?.amount_php), { decimals: 0 })} comes back off your received total, and any order it settled goes back to owing.`}
        confirmLabel="Delete payment"
        onConfirm={async () => {
          await commit((db) => db.deletePayment(stickyDeleting.id));
          toast("Payment deleted");
        }}
      />
    </motion.div>
  );
}

/* ------------------------------------------------------------------- tray */

function PaymentTray({ open, payment, prefill, origin, onClose, onSave, onDelete }) {
  const { orders, derived, payments } = useStore();

  const [form, setForm] = useState(() => ({
    order_id: payment?.order_id ?? prefill?.order_id ?? "",
    payment_date: payment?.payment_date ?? today(),
    amount_php: payment ? String(payment.amount_php ?? "") : (prefill?.amount_php ?? ""),
    method: payment?.method ?? "GCash",
    status: payment?.status ?? "Received",
    reference: payment?.reference ?? "",
    notes: payment?.notes ?? "",
  }));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => {
    const value = e?.target ? e.target.value : e;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const order = form.order_id ? orders.find((o) => o.id === M(form.order_id)) : null;

  /* What this order owed BEFORE this payment, so editing does not double-count. */
  const math = useMemo(() => {
    if (!order) return null;
    const paidExcludingThis =
      paidFor(payments, order.id) -
      (payment?.status === "Received" ? M(payment.amount_php) : 0);
    return orderMath(
      order,
      derived.itemsByOrder.get(order.id) || [],
      derived.landedMap,
      paidExcludingThis,
      derived.freebiesByOrder.get(order.id) || [],
    );
  }, [order, derived, payments, payment]);

  const save = async () => {
    const found = validate(RULES, form);
    if (Object.keys(found).length) {
      setErrors(found);
      haptic([12, 40, 12]);
      return;
    }
    setSaving(true);
    try {
      await onSave({
        id: payment?.id,
        payment: { ...form, order_id: form.order_id ? M(form.order_id) : null },
      });
      haptic(12);
      toast.success(payment ? "Payment updated" : "Payment recorded");
      onClose();
    } catch {
      toast.error("Could not save the payment. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Tray
      open={open}
      onClose={onClose}
      origin={origin}
      title={payment ? "Edit payment" : "Record a payment"}
      subtitle={order ? `Against ${order.order_number}` : "Against an order, or standalone"}
      footer={
        <div className="flex gap-2">
          <button type="button" className="btn-quiet flex-1" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary flex-[1.6]" disabled={saving} onClick={save}>
            <MorphLabel>
              {saving ? "Saving…" : payment ? "Save changes" : "Save payment"}
            </MorphLabel>
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

        <Field label="Order">
          <Select value={form.order_id} onChange={set("order_id")}>
            <option value="">Standalone, no order</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.order_number} · {o.customer_name || "Walk-in"}
              </option>
            ))}
          </Select>
        </Field>

        {/* The balance appears the moment an order is chosen, and moves as you type. */}
        <AnimatePresence initial={false}>
          {math && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={spring}
              className="overflow-hidden"
            >
              <div className="rounded-md border border-line bg-paper p-2.5 xs:p-3">
                <div className="flex items-baseline justify-between gap-2 xs:gap-3">
                  <span className="eyebrow min-w-0 break-words">
                    {math.paymentRequirementLabel}
                  </span>
                  <span className="num shrink-0 whitespace-nowrap text-micro font-semibold text-cobalt">
                    {php(math.dueNow, { decimals: 0 })} due now
                  </span>
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-2 text-eta xs:gap-3">
                  <span className="min-w-0 text-ink-3">Owing before this</span>
                  <span className="num shrink-0 whitespace-nowrap font-semibold">
                    {php(math.balanceDue)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-baseline justify-between gap-2 text-eta xs:gap-3">
                  <span className="min-w-0 text-ink-3">After this payment</span>
                  <span
                    className={clsx(
                      "num shrink-0 whitespace-nowrap font-semibold",
                      math.balanceDue - M(form.amount_php) > 0.005 ? "text-clay" : "text-teal",
                    )}
                  >
                    <RollingNumber
                      value={php(Math.max(0, math.balanceDue - M(form.amount_php)))}
                    />
                  </span>
                </div>

                <AnimatePresence initial={false}>
                  {math.isDeposit && math.dueNowOutstanding > 0.005 && (
                    <motion.p
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={spring}
                      className="overflow-hidden break-words text-micro leading-relaxed"
                    >
                      <span className="block pt-2">
                        {M(form.amount_php) + 0.005 >= math.dueNowOutstanding &&
                        M(form.amount_php) > 0 ? (
                          <span className="text-teal">
                            This meets the 50% deposit, so the stock is reserved.
                          </span>
                        ) : (
                          <span className="text-ink-3">
                            <span className="num text-cobalt">
                              {php(math.dueNowOutstanding, { decimals: 0 })}
                            </span>{" "}
                            {DEPOSIT_RESERVE_NOTE}
                          </span>
                        )}
                      </span>
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
          <Field label="Date" error={errors.payment_date} required>
            <Input
              type="date"
              value={form.payment_date}
              onChange={set("payment_date")}
              error={errors.payment_date}
            />
          </Field>
          <Field label="Method">
            <Select value={form.method} onChange={set("method")}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
          <Field label="Status">
            <Select value={form.status} onChange={set("status")}>
              {PAYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reference">
            <Input value={form.reference} onChange={set("reference")} placeholder="Txn ID" />
          </Field>
        </div>

        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={set("notes")}
            rows={2}
            placeholder="Anything worth remembering about this one"
            className="field resize-none"
          />
        </Field>

        {payment && (
          <div className="border-t border-line-soft pt-3">
            <button
              type="button"
              className="btn-quiet w-full !text-clay"
              onClick={() => onDelete(payment)}
            >
              <Trash size={16} />
              Delete payment
            </button>
          </div>
        )}
      </div>
    </Tray>
  );
}

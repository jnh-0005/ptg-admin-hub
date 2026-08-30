import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle,
  DownloadSimple,
  Gift,
  MapPin,
  PencilSimple,
  Plus,
  Receipt,
  ShareNetwork,
  ShieldCheck,
  Trash,
  Truck,
  Wallet,
  Warning,
  X,
} from "@phosphor-icons/react";
import confetti from "canvas-confetti";
import { toast } from "sonner";
import clsx from "clsx";

import Tray, { ConfirmTray, MorphLabel, useOrigin, useSticky } from "../components/Tray";
import { FreebiePicker, ProductPicker } from "../components/Pickers";
import InvoiceDoc from "../components/Invoice";
import {
  INVOICE_WIDTH,
  invoiceModel,
  saveInvoicePng,
  shareInvoicePng,
} from "../lib/invoice";
import {
  Chip,
  EmptyState,
  Field,
  FilterChips,
  Input,
  RollingNumber,
  Select,
  ShippingNote,
  listChild,
  listParent,
} from "../components/ui";
import { useStore } from "../lib/store";
import {
  CARRIERS,
  CHANNELS,
  DEPOSIT_RESERVE_NOTE,
  IN_TRANSIT_DEPOSIT_RESERVE_NOTE,
  FULFILLMENT_STATUSES,
  M,
  ORDER_STATUSES,
  PAYMENT_REQUIREMENTS,
  REQUIREMENT_HELP,
  REQUIREMENT_LABEL,
  TONE_FOR_FULFILLMENT,
  TONE_FOR_STATUS,
  formatDate,
  formatDateShort,
  freebieKit,
  normaliseOrderStatus,
  orderMath,
  paidFor,
  pct,
  php,
  requirementOf,
  statusesFor,
  today,
  unitKey,
  unitLabel,
  validate,
} from "../lib/calc";
import { CONFETTI_COLORS, haptic, spring } from "../lib/motion";

const RULES = {
  order_number: { required: true, label: "Order number" },
  order_date: { required: true, label: "Date" },
  shipping_income_php: { nonNegative: true },
  discount_php: { nonNegative: true },
};

/**
 * True when a line's product/colour currently sits at zero on hand — the
 * same rule the storefront API uses to decide "pre-order" vs "in stock"
 * (api/v1/_shared.js's createOrder). A deleted product/variant reads as
 * out of stock too, since there is nothing to hand over either way.
 */
function lineOutOfStock(item, productsById, variantsById) {
  if (item.variant_id) {
    const variant = variantsById.get(item.variant_id);
    return !variant || M(variant.quantity) <= 0;
  }
  const product = productsById.get(item.product_id);
  return !product || M(product.quantity_on_hand) <= 0;
}

/**
 * "Awaiting stock" is a live read, not a snapshot of what was true when the
 * order came in — restocking a paddle clears this on its own, no separate
 * status to flip. Only open orders count: a Completed order already took
 * its units out of stock (possibly down to zero itself), which says nothing
 * about whether it's still waiting on anything.
 */
function orderNeedsRestock(order, items, productsById, variantsById) {
  if (order.status === "Completed" || order.status === "Cancelled") return false;
  return items.some((item) => lineOutOfStock(item, productsById, variantsById));
}

export default function Orders() {
  const { orders, products, derived, commit, payments, productsById } = useStore();
  const [filter, setFilter] = useState("All");
  const [editing, setEditing] = useState(null); // "new" | order
  const [detail, setDetail] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [origin, captureOrigin] = useOrigin();

  const restockNeeded = useMemo(() => {
    const ids = new Set();
    for (const order of orders) {
      const items = derived.itemsByOrder.get(order.id) || [];
      if (orderNeedsRestock(order, items, productsById, derived.variantsById)) ids.add(order.id);
    }
    return ids;
  }, [orders, derived.itemsByOrder, derived.variantsById, productsById]);

  const filterOptions = useMemo(
    () => [
      "All",
      ...ORDER_STATUSES,
      ...(restockNeeded.size ? [{ value: "Preorder", label: "Awaiting stock" }] : []),
    ],
    [restockNeeded.size],
  );

  const visible = useMemo(() => {
    const base =
      filter === "All"
        ? orders
        : filter === "Preorder"
          ? orders.filter((o) => restockNeeded.has(o.id))
          : orders.filter((o) => o.status === filter);
    if (filter === "Preorder") return base;
    // Stable sort: orders waiting on a restock float to the top of whatever's
    // visible, newest-first within each group — so which orders can't move
    // yet is a glance, not a hunt through every card.
    return [...base].sort((a, b) => Number(restockNeeded.has(b.id)) - Number(restockNeeded.has(a.id)));
  }, [orders, filter, restockNeeded]);

  const stickyEditing = useSticky(editing);
  const stickyDetail = useSticky(detail);
  const stickyDeleting = useSticky(deleting);

  return (
    <motion.div variants={listParent} initial="hidden" animate="shown">
      <motion.header variants={listChild} className="mb-3 flex items-end justify-between gap-3">
        <div className="hidden min-w-0 lg:block">
          <h1 className="text-[26px] font-semibold tracking-tight">Orders</h1>
          <p className="mt-0.5 text-eta text-ink-2">
            {derived.openOrders} open · {php(derived.sales, { decimals: 0 })} in sales
          </p>
        </div>
        <button
          type="button"
          className="btn-primary ml-auto"
          disabled={products.length === 0}
          onClick={(e) => {
            captureOrigin(e);
            setEditing("new");
          }}
        >
          <Plus size={17} weight="bold" />
          New order
        </button>
      </motion.header>

      {orders.length === 0 ? (
        <motion.div variants={listChild}>
          <EmptyState
            icon={<Receipt size={22} />}
            title="No orders yet"
            body={
              products.length === 0
                ? "Add a paddle in Inventory first, then you can sell it here."
                : "Log your first sale. Mark it completed when it ships and the stock, freebies included, comes off automatically."
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
                  New order
                </button>
              )
            }
          />
        </motion.div>
      ) : (
        <>
          <motion.div variants={listChild}>
            <FilterChips
              options={filterOptions}
              value={filter}
              onChange={setFilter}
              idPrefix="ord"
            />
          </motion.div>

          <motion.div variants={listChild} className="mt-3 space-y-2.5">
            {visible.length === 0 ? (
              <EmptyState
                icon={<Receipt size={22} />}
                title={filter === "Preorder" ? "Nothing waiting on stock" : `No ${filter.toLowerCase()} orders`}
                body="Change the filter to see the rest."
                action={
                  <button type="button" className="btn-quiet" onClick={() => setFilter("All")}>
                    Show all
                  </button>
                }
              />
            ) : (
              <AnimatePresence initial={false}>
                {visible.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    needsRestock={restockNeeded.has(order.id)}
                    math={orderMath(
                      order,
                      derived.itemsByOrder.get(order.id) || [],
                      derived.landedMap,
                      paidFor(payments, order.id),
                      derived.freebiesByOrder.get(order.id) || [],
                    )}
                    onOpen={(e) => {
                      captureOrigin(e);
                      setDetail(order);
                    }}
                  />
                ))}
              </AnimatePresence>
            )}
          </motion.div>
        </>
      )}

      <OrderDetailTray
        key={stickyDetail?.id ?? "det-closed"}
        open={!!detail}
        order={stickyDetail}
        origin={origin}
        onClose={() => setDetail(null)}
        onEdit={() => {
          const target = detail;
          setDetail(null);
          // Let the detail tray finish leaving before the form arrives.
          setTimeout(() => setEditing(target), 120);
        }}
      />

      <OrderTray
        key={stickyEditing === "new" ? "new" : (stickyEditing?.id ?? "closed")}
        open={!!editing}
        order={stickyEditing === "new" ? null : stickyEditing}
        items={
          stickyEditing && stickyEditing !== "new"
            ? derived.itemsByOrder.get(stickyEditing.id) || []
            : []
        }
        freebies={
          stickyEditing && stickyEditing !== "new"
            ? derived.freebiesByOrder.get(stickyEditing.id) || []
            : []
        }
        origin={origin}
        onClose={() => setEditing(null)}
        onDelete={(o) => setDeleting(o)}
        onSave={(payload) => commit((db) => db.saveOrder(payload))}
      />

      <ConfirmTray
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete ${stickyDeleting?.order_number || ""}?`}
        body={
          stickyDeleting?.status === "Completed"
            ? "This order already took its paddles and freebies out of stock. Deleting it puts them back and removes its revenue from your totals. Any payments against it become standalone."
            : "The order, its lines and its freebies go for good. Any payments against it become standalone."
        }
        confirmLabel="Delete order"
        onConfirm={async () => {
          await commit((db) => db.deleteOrder(stickyDeleting));
          toast("Order deleted");
        }}
      />
    </motion.div>
  );
}

/* ------------------------------------------------------------------- card */

function PaymentStrip({ math, className }) {
  const owesDeposit = math.dueNowOutstanding > 0.005;
  const owes = math.balanceDue > 0.005;
  const amount = owesDeposit ? math.dueNowOutstanding : owes ? math.balanceDue : math.billedTotal;
  const label = owesDeposit
    ? math.isDeposit
      ? "Deposit due"
      : "Due now"
    : owes
      ? math.depositMet
        ? "Deposit met · balance"
        : "Balance due"
      : "Settled";

  return (
    <div
      className={clsx(
        "flex items-baseline justify-between gap-2 rounded-md px-2 py-1.5 xs:gap-3",
        owesDeposit ? "bg-cobalt-wash text-cobalt" : "bg-teal-wash text-teal",
        className,
      )}
    >
      <span className="min-w-0 break-words text-micro font-semibold">
        {math.paymentRequirementLabel}
      </span>
      <span className="shrink-0 whitespace-nowrap text-micro">
        <span className="opacity-70">{label} </span>
        <span className="num font-semibold">{php(amount, { decimals: 0 })}</span>
      </span>
    </div>
  );
}

function OrderCard({ order, math, needsRestock, onOpen }) {
  const owing = math.balanceDue;
  return (
    <motion.div
      layout
      variants={listChild}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={spring}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(e);
        }
      }}
      className="card w-full min-w-0 cursor-pointer p-3 text-left transition-colors duration-150 active:bg-paper xs:p-3.5"
    >
      <div className="flex items-start justify-between gap-2 xs:gap-3">
        <div className="min-w-0 flex-1">
          <p className="num truncate text-micro text-ink-3">{order.order_number}</p>
          <p className="mt-0.5 truncate text-[15px] font-semibold leading-tight">
            {order.customer_name || "Walk-in customer"}
          </p>
          <p className="mt-0.5 break-words text-micro text-ink-3">
            {formatDateShort(order.order_date)}
            {order.channel ? ` · ${order.channel}` : ""} · {math.unitCount} unit
            {math.unitCount === 1 ? "" : "s"}
            {math.freebieCount > 0 ? ` · ${math.freebieCount} free` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Chip tone={TONE_FOR_STATUS[order.status] || "gray"} dot>
            {order.status}
          </Chip>
          {/* A live read of current stock, not what was true when this order
              came in — see orderNeedsRestock above. Only ever shows on an
              order that hasn't shipped yet. */}
          {needsRestock && (
            <Chip tone="clay" dot>
              Awaiting stock
            </Chip>
          )}
        </div>
      </div>

      <PaymentStrip math={math} className="mt-2" />

      <div className="mt-3 grid min-w-0 grid-cols-3 items-end gap-2 border-t border-line-soft pt-2.5 xs:gap-3">
        <div className="min-w-0">
          <p className="eyebrow break-words">Billed</p>
          <p className="num mt-0.5 truncate text-[15px] font-semibold">
            {php(math.billedTotal, { decimals: 0 })}
          </p>
        </div>
        <div className="min-w-0 text-right">
          <p className="eyebrow break-words">Profit</p>
          {/* The one figure that silently turns red the moment an order loses money. */}
          <p
            className={clsx(
              "num mt-0.5 truncate text-[15px] font-semibold",
              math.actualProfit < 0 ? "text-clay" : "text-teal",
            )}
          >
            {php(math.actualProfit, { decimals: 0 })}
          </p>
        </div>
        <div className="min-w-0 text-right">
          <p className="eyebrow break-words">{owing > 0.005 ? "Owing" : "Settled"}</p>
          <p
            className={clsx(
              "num mt-0.5 truncate text-eta",
              owing > 0.005 ? "text-clay" : "text-ink-3",
            )}
          >
            {owing > 0.005 ? php(owing, { decimals: 0 }) : "—"}
          </p>
        </div>
      </div>

      {math.freebieCost > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-micro text-plum">
          <Gift size={13} weight="fill" className="shrink-0" />
          <span className="num">{php(math.freebieCost, { decimals: 0 })}</span>
          <span className="text-ink-3">in freebies, already off the profit</span>
        </p>
      )}

      {/* Where the parcel is, only once it has actually gone somewhere. */}
      {order.fulfillment_status && order.fulfillment_status !== "Not shipped" && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line-soft pt-2 text-micro text-ink-3">
          <Truck size={13} className="shrink-0 text-ink-4" />
          <Chip tone={TONE_FOR_FULFILLMENT[order.fulfillment_status] || "gray"}>
            {order.fulfillment_status}
          </Chip>
          {order.carrier && <span className="min-w-0 truncate">{order.carrier}</span>}
          {order.tracking_number && (
            <span className="num min-w-0 truncate text-ink-2">{order.tracking_number}</span>
          )}
        </p>
      )}
    </motion.div>
  );
}

/* ----------------------------------------------------------- detail tray */

function OrderDetailTray({ open, order, origin, onClose, onEdit }) {
  const { derived, payments, commit, productsById, trackingByOrder } = useStore();
  const navigate = useNavigate();
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [confirmVerifyPayment, setConfirmVerifyPayment] = useState(false);
  const [verifyingPayment, setVerifyingPayment] = useState(false);
  const [trackingEvent, setTrackingEvent] = useState(null); // "new" | event
  const [deletingEvent, setDeletingEvent] = useState(null);
  const [trackOrigin, captureTrackOrigin] = useOrigin();
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceOrigin, captureInvoiceOrigin] = useOrigin();

  const events = order ? trackingByOrder.get(order.id) || [] : [];
  const stickyEvent = useSticky(trackingEvent);
  const stickyDeletingEvent = useSticky(deletingEvent);

  const items = order ? derived.itemsByOrder.get(order.id) || [] : [];
  const gifts = order ? derived.freebiesByOrder.get(order.id) || [] : [];
  const paid = order ? paidFor(payments, order.id) : 0;
  const math = useMemo(
    () => orderMath(order, items, derived.landedMap, paid, gifts),
    [order, items, derived.landedMap, paid, gifts],
  );

  if (!order) return null;
  const owing = math.balanceDue;
  const needsRestock = orderNeedsRestock(order, items, productsById, derived.variantsById);

  const complete = async () => {
    setCompleting(true);
    try {
      await commit((db) => db.setOrderStatus(order, "Completed"));
      haptic([10, 30, 18]);
      // Tier 3, the ONE big moment: confetti on FINISHING, never on saving.
      confetti({
        particleCount: 80,
        spread: 66,
        startVelocity: 36,
        ticks: 140,
        origin: { y: 0.6 },
        colors: CONFETTI_COLORS,
        disableForReducedMotion: true,
      });
      toast.success(`${order.order_number} completed, stock updated`);
      onClose();
    } catch {
      toast.error("Could not complete the order. Try again.");
    } finally {
      setCompleting(false);
    }
  };

  const paymentVerified = order.status === "Paid" || order.status === "Completed";

  /**
   * The explicit "I looked at the proof, the money is actually in the
   * account" step — separate from "Complete order". This only moves status
   * to Paid; it never touches stock. Stock still only moves when the order
   * is Completed (fulfilled), same as before — payment being verified and a
   * paddle actually leaving the shelf are two different real-world events,
   * and a pre-order can sit Paid for a while before there's anything to
   * hand over.
   */
  const verifyPayment = async () => {
    setVerifyingPayment(true);
    try {
      await commit((db) => db.setOrderStatus(order, "Paid"));
      haptic([10, 24]);
      toast.success(`${order.order_number} marked paid — payment verified`);
    } catch {
      toast.error("Could not mark the payment verified. Try again.");
    } finally {
      setVerifyingPayment(false);
    }
  };

  return (
    <>
      <Tray
        open={open}
        onClose={onClose}
        origin={origin}
        wide
        title={order.customer_name || "Walk-in customer"}
        subtitle={`${order.order_number} · ${formatDate(order.order_date)}`}
        footer={
          <div className="grid min-w-0 grid-cols-2 gap-2">
            <button type="button" className="btn-quiet min-w-0" onClick={onEdit}>
              <PencilSimple size={16} />
              <span>Edit</span>
            </button>
            {order.status !== "Completed" && order.status !== "Cancelled" ? (
              <button
                type="button"
                className="btn-primary min-w-0"
                disabled={completing}
                onClick={() => setConfirmComplete(true)}
              >
                <CheckCircle size={17} weight="fill" />
                <MorphLabel>{completing ? "Completing…" : "Complete order"}</MorphLabel>
              </button>
            ) : (
              <button
                type="button"
                className="btn-quiet min-w-0"
                onClick={() => {
                  onClose();
                  navigate("/payments");
                }}
              >
                <Wallet size={16} />
                <span>See payments</span>
              </button>
            )}
          </div>
        }
      >
        <div className="space-y-3 pt-1">
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <Chip tone={TONE_FOR_STATUS[order.status] || "gray"} dot>
              {order.status}
            </Chip>
            {needsRestock && (
              <Chip tone="clay" dot>
                Awaiting stock — not fulfillable yet
              </Chip>
            )}
            {order.channel && <Chip tone="gray">{order.channel}</Chip>}
            <Chip tone="cobalt">{math.paymentRequirementLabel}</Chip>
            {/* Deposit met is its own state: the stock is reserved. */}
            {math.isDeposit &&
              (math.depositMet ? (
                <Chip tone="teal" dot>
                  Deposit met · reserved
                </Chip>
              ) : (
                <Chip tone="plum" dot>
                  Awaiting deposit
                </Chip>
              ))}
            {owing > 0.005 ? (
              <Chip tone="clay">{php(owing, { decimals: 0 })} owing</Chip>
            ) : (
              <Chip tone="teal">Fully paid</Chip>
            )}
          </div>

          {(order.customer_phone || order.customer_email || order.shipping_address) && (
            <div className="rounded-md border border-line bg-surface p-2.5 xs:p-3">
              <p className="eyebrow">Customer details</p>
              <div className="mt-1.5 space-y-1 text-eta text-ink-2">
                {order.customer_phone && <p className="num">{order.customer_phone}</p>}
                {order.customer_email && <p className="break-all">{order.customer_email}</p>}
                {order.shipping_address && <p className="whitespace-pre-wrap break-words">{order.shipping_address}</p>}
              </div>
            </div>
          )}

          {(order.fulfillment_method || order.acknowledgment || order.payment_proof_url) && (
            <div className="rounded-md border border-line bg-surface p-2.5 xs:p-3">
              <p className="eyebrow">Storefront checkout</p>
              <div className="mt-1.5 space-y-1.5 text-eta text-ink-2">
                {order.fulfillment_method && <p>{order.fulfillment_method}</p>}
                {order.acknowledgment && <p>Terms acknowledged</p>}
                {order.payment_proof_url && (
                  <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
                    <a
                      href={order.payment_proof_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-10 items-center font-medium text-cobalt underline decoration-cobalt/25 underline-offset-2"
                    >
                      View payment proof
                    </a>
                    {paymentVerified ? (
                      <Chip tone="teal" dot>
                        Payment verified
                      </Chip>
                    ) : (
                      order.status !== "Cancelled" && (
                        <button
                          type="button"
                          className="btn-quiet min-h-9 shrink-0 px-3 text-eta"
                          disabled={verifyingPayment}
                          onClick={() => setConfirmVerifyPayment(true)}
                        >
                          <ShieldCheck size={15} weight="fill" />
                          <span>{verifyingPayment ? "Verifying…" : "Approve payment"}</span>
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <ul className="divide-y divide-line-soft overflow-hidden rounded-md border border-line">
            {math.lines.length === 0 && (
              <li className="px-3 py-4 text-center text-eta text-ink-3">
                No lines on this order
              </li>
            )}
            {math.lines.map((line) => {
              const product = productsById.get(line.product_id);
              const variant = derived.variantsById.get(line.variant_id);
              return (
                <li key={line.id} className="px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2 xs:gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-eta font-medium">
                        {product?.name || line.product_name || "Removed paddle"}
                      </p>
                      <p className="num mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-ink-3">
                        {variant ? (
                          <Chip tone="gray">{variant.color}</Chip>
                        ) : (
                          product && <Chip tone="gray">No colour</Chip>
                        )}
                        <span className="whitespace-nowrap">
                          {line.qty} × {php(line.price)}
                        </span>
                      </p>
                    </div>
                    <p className="num shrink-0 whitespace-nowrap text-eta font-semibold">
                      {php(line.lineRevenue)}
                    </p>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t border-line-soft pt-1.5">
                    <span className="shrink-0 text-micro text-ink-3">
                      Landed {line.hasActual ? "actual" : "estimated"}
                    </span>
                    <span className="num min-w-0 text-right text-micro text-ink-2">
                      {php(line.actualLanded)} each
                      {line.hasActual && (
                        <span className="text-ink-3"> · est {php(line.estLanded)}</span>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>

          {math.freebies.length > 0 && (
            <div className="overflow-hidden rounded-md border border-plum/25 bg-plum-wash">
              <div className="flex items-baseline justify-between gap-2 px-3 pt-2.5">
                <span className="eyebrow !text-plum">Thrown in</span>
                <span className="num shrink-0 whitespace-nowrap text-micro font-semibold text-plum">
                  −{php(math.freebieCost)}
                </span>
              </div>
              <ul className="mt-1.5 divide-y divide-plum/15 px-3 pb-2.5">
                {math.freebies.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-baseline justify-between gap-2 py-1.5 text-eta"
                  >
                    <span className="min-w-0 truncate text-ink-2">{f.freebie_name}</span>
                    <span className="num shrink-0 whitespace-nowrap text-micro text-ink-3">
                      {f.qty} × {php(f.unitCost)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-md border border-line bg-paper p-2.5 xs:p-3">
            <dl className="space-y-1.5 text-eta">
              <div className="flex justify-between gap-2 xs:gap-3">
                <dt className="min-w-0 text-ink-3">Paddles</dt>
                <dd className="num shrink-0 whitespace-nowrap">{php(math.itemsRevenue)}</dd>
              </div>
              {math.discount > 0 && (
                <div className="flex justify-between gap-2 xs:gap-3">
                  <dt className="min-w-0 text-ink-3">Discount</dt>
                  <dd className="num shrink-0 whitespace-nowrap text-clay">
                    −{php(math.discount)}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-2 border-t border-line pt-1.5 font-semibold xs:gap-3">
                <dt className="min-w-0">Product revenue</dt>
                <dd className="num shrink-0 whitespace-nowrap">{php(math.productRevenue)}</dd>
              </div>
              {math.shippingIncome > 0 && (
                <div className="flex justify-between gap-2 pt-0.5 xs:gap-3">
                  <dt className="min-w-0 break-words text-ink-3">
                    Customer shipping{" "}
                    <span className="text-ink-4">· excluded from profit</span>
                  </dt>
                  <dd className="num shrink-0 whitespace-nowrap text-ink-3">
                    {php(math.shippingIncome)}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-2 border-t border-line pt-1.5 text-[15px] font-semibold xs:gap-3">
                <dt className="min-w-0">Total billed</dt>
                <dd className="num shrink-0 whitespace-nowrap">{php(math.billedTotal)}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-md border border-line bg-surface p-2.5 xs:p-3">
            <div className="flex items-baseline justify-between gap-2 xs:gap-3">
              <span className="eyebrow min-w-0 break-words">Payment requirement</span>
              <span className="shrink-0 whitespace-nowrap text-micro font-semibold text-cobalt">
                {math.paymentRequirementLabel}
              </span>
            </div>
            <dl className="mt-2 space-y-1.5 text-eta">
              <div className="flex justify-between gap-2 xs:gap-3">
                <dt className="min-w-0 break-words text-ink-3">
                  {math.isDeposit ? "Deposit due" : "Amount due now"}
                  {math.isDeposit && (
                    <span className="text-ink-4"> · {math.paymentRequirement === "deposit_25" ? "25" : "50"}% of billed</span>
                  )}
                </dt>
                <dd className="num shrink-0 whitespace-nowrap font-semibold">{php(math.dueNow)}</dd>
              </div>
              <div className="flex justify-between gap-2 xs:gap-3">
                <dt className="min-w-0 text-ink-3">Amount paid</dt>
                <dd className="num shrink-0 whitespace-nowrap text-teal">{php(math.amountPaid)}</dd>
              </div>
              <div className="flex justify-between gap-2 border-t border-line pt-1.5 font-semibold xs:gap-3">
                <dt className="min-w-0">Balance due</dt>
                <dd
                  className={clsx(
                    "num shrink-0 whitespace-nowrap",
                    math.balanceDue > 0.005 ? "text-clay" : "text-teal",
                  )}
                >
                  {php(math.balanceDue)}
                </dd>
              </div>
            </dl>
            {math.isDeposit && (
              <p className="mt-2 break-words border-t border-line-soft pt-2 text-micro leading-relaxed text-ink-3">
                {math.dueNowOutstanding > 0.005
                  ? `${php(math.dueNowOutstanding, { decimals: 0 })} of the deposit is still to collect. ${
                      math.paymentRequirement === "deposit_25" ? IN_TRANSIT_DEPOSIT_RESERVE_NOTE : DEPOSIT_RESERVE_NOTE
                    }`
                  : math.paymentRequirement === "deposit_25"
                    ? "Deposit received, so the stock is reserved. The balance is due once it's on hand."
                    : "Deposit received, so the stock is reserved. The balance is due before completion."}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2 xs:grid-cols-2">
            <div className="min-w-0 rounded-md border border-line bg-surface p-3">
              <p className="eyebrow break-words">Estimated profit</p>
              <p
                className={clsx(
                  "num mt-1 truncate text-[17px] font-semibold",
                  math.estProfit < 0 && "text-clay",
                )}
              >
                {php(math.estProfit, { decimals: 0 })}
              </p>
              <p className="num mt-0.5 break-words text-micro text-ink-3">
                {pct(math.estMargin)} · cost {php(math.estCost, { decimals: 0 })}
              </p>
            </div>
            <div className="min-w-0 rounded-md border border-cobalt/25 bg-cobalt-wash p-3">
              <p className="eyebrow break-words !text-cobalt">Actual profit</p>
              <p
                className={clsx(
                  "num mt-1 truncate text-[17px] font-semibold text-cobalt",
                  math.actualProfit < 0 && "!text-clay",
                )}
              >
                {php(math.actualProfit, { decimals: 0 })}
              </p>
              <p className="num mt-0.5 break-words text-micro text-cobalt/70">
                {pct(math.actualMargin)} · cost {php(math.actualCost, { decimals: 0 })}
              </p>
            </div>
          </div>

          {math.freebieCost > 0 && (
            <p className="px-1 text-micro leading-relaxed text-ink-3">
              Both figures already have {php(math.freebieCost)} of freebies taken off.
            </p>
          )}

          {!math.hasAnyActual && (
            <p className="px-1 text-micro leading-relaxed text-ink-3">
              No actual landed costs typed on this order yet, so both figures match. Add them per
              line when you edit.
            </p>
          )}

          <ShippingNote />

          <div className="rounded-md border border-line bg-paper p-2.5 xs:p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="eyebrow min-w-0 break-words">Paid so far</span>
              <span className="num shrink-0 whitespace-nowrap text-eta font-semibold">
                {php(paid)}
              </span>
            </div>
            <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-line">
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{
                  scaleX: math.billedTotal > 0 ? Math.min(1, math.amountPaid / math.billedTotal) : 0,
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
            <p className="mt-1.5 break-words text-micro text-ink-3">
              {math.isDeposit && math.dueNowOutstanding > 0.005
                ? `${php(math.dueNowOutstanding)} to reach the deposit · ${php(owing)} owing in total`
                : owing > 0.005
                  ? `${php(owing)} still owing`
                  : "Nothing outstanding"}
            </p>
          </div>

          {/* ------------------------------------------------ fulfilment */}
          <div className="rounded-md border border-line bg-surface p-2.5 xs:p-3">
            <div className="flex items-start justify-between gap-2 xs:gap-3">
              <div className="min-w-0 flex-1">
                <p className="eyebrow break-words">Delivery</p>
                <p className="mt-1 break-words text-eta text-ink-2">
                  {order.carrier || "No carrier yet"}
                  {order.tracking_number && (
                    <span className="num text-ink"> · {order.tracking_number}</span>
                  )}
                </p>
              </div>
              <Chip tone={TONE_FOR_FULFILLMENT[order.fulfillment_status] || "gray"} dot>
                {order.fulfillment_status || "Not shipped"}
              </Chip>
            </div>

            {/* The timeline: each event travels in, oldest at the top. */}
            {events.length > 0 && (
              <motion.ol
                variants={listParent}
                initial="hidden"
                animate="shown"
                className="mt-3 border-t border-line-soft pt-3"
              >
                <AnimatePresence initial={false}>
                  {events.map((event, i) => (
                    <motion.li
                      key={event.id}
                      layout
                      variants={listChild}
                      exit={{ opacity: 0, x: -16, height: 0 }}
                      transition={spring}
                      className="relative flex gap-3 pb-3 last:pb-0"
                    >
                      {/* One continuous rail, so the events read as a journey. */}
                      <span className="relative flex w-3 shrink-0 justify-center">
                        {i < events.length - 1 && (
                          <span
                            aria-hidden="true"
                            className="absolute top-3 bottom-[-12px] w-px bg-line"
                          />
                        )}
                        <span
                          aria-hidden="true"
                          className={clsx(
                            "relative mt-1.5 h-2 w-2 shrink-0 rounded-full",
                            i === events.length - 1 ? "bg-cobalt" : "bg-ink-4",
                          )}
                        />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                          <span className="min-w-0 truncate text-eta font-medium">
                            {event.status}
                          </span>
                          <span className="num shrink-0 whitespace-nowrap text-micro text-ink-3">
                            {formatDateShort(event.event_date) || "—"}
                          </span>
                        </span>
                        {(event.location || event.carrier) && (
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-micro text-ink-3">
                            {event.location && (
                              <>
                                <MapPin size={11} className="shrink-0" />
                                <span className="min-w-0 break-words">{event.location}</span>
                              </>
                            )}
                            {event.carrier && (
                              <span className="min-w-0 break-words text-ink-4">
                                · {event.carrier}
                              </span>
                            )}
                          </span>
                        )}
                        {event.notes && (
                          <span className="wrap-any mt-0.5 block text-micro italic text-ink-3">
                            {event.notes}
                          </span>
                        )}
                      </span>

                      <button
                        type="button"
                        onClick={() => setDeletingEvent(event)}
                        aria-label={`Delete the ${event.status} event`}
                        className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-4
                                   transition-transform duration-150 active:scale-90 active:bg-paper"
                      >
                        <Trash size={14} />
                      </button>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </motion.ol>
            )}

            <button
              type="button"
              onClick={(e) => {
                captureTrackOrigin(e);
                setTrackingEvent("new");
              }}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-line
                         bg-paper py-2.5 text-eta font-medium text-ink-2 transition-[transform,background-color]
                         duration-150 active:scale-[0.99] active:bg-line-soft"
            >
              <Truck size={15} weight="bold" />
              {events.length === 0 ? "Add the first tracking event" : "Add a tracking event"}
            </button>

            {events.length === 0 && (
              <p className="mt-2 px-0.5 text-micro leading-relaxed text-ink-3">
                Nothing logged yet. Add where the parcel is and the newest event becomes this
                order's delivery status everywhere it shows.
              </p>
            )}
          </div>

          {order.notes && (
            <p className="wrap-any rounded-md border border-line bg-surface p-3 text-eta italic leading-relaxed text-ink-2">
              {order.notes}
            </p>
          )}

          <button
            type="button"
            onClick={(e) => {
              captureInvoiceOrigin(e);
              setInvoiceOpen(true);
              haptic(8);
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-line
                       bg-paper py-2.5 text-eta font-medium text-ink-2 transition-[transform,background-color]
                       duration-150 active:scale-[0.99] active:bg-line-soft"
          >
            <Receipt size={15} weight="bold" />
            See the invoice
          </button>
        </div>
      </Tray>

      {/* Nested inside the detail tray, so it carries a back arrow. */}
      <InvoiceTray
        open={invoiceOpen}
        order={order}
        math={math}
        origin={invoiceOrigin}
        onClose={() => setInvoiceOpen(false)}
        onBack={() => setInvoiceOpen(false)}
      />

      {/* Nested inside the detail tray, so it carries a back arrow. */}
      <TrackingTray
        key={stickyEvent === "new" ? "new-track" : (stickyEvent?.id ?? "t-closed")}
        open={!!trackingEvent}
        event={stickyEvent === "new" ? null : stickyEvent}
        order={order}
        origin={trackOrigin}
        onClose={() => setTrackingEvent(null)}
        onBack={() => setTrackingEvent(null)}
        onSave={(values) =>
          commit((db) =>
            db.saveTrackingEvent({
              id: values.id,
              orderId: order.id,
              event: values,
            }),
          )
        }
      />

      <ConfirmTray
        open={!!deletingEvent}
        onClose={() => setDeletingEvent(null)}
        title={`Remove the ${stickyDeletingEvent?.status || "tracking"} event?`}
        body="Only this event goes. The rest of the timeline stays, and the order takes its delivery status from whatever event is newest afterwards."
        confirmLabel="Remove it"
        onConfirm={async () => {
          await commit((db) => db.deleteTrackingEvent(stickyDeletingEvent.id));
          toast("Tracking event removed");
        }}
      />

      <ConfirmTray
        open={confirmComplete}
        onClose={() => setConfirmComplete(false)}
        title="Complete this order?"
        body={
          math.balanceDue > 0.005
            ? `This takes ${math.unitCount} unit${math.unitCount === 1 ? "" : "s"} out of stock while ${php(math.balanceDue, { decimals: 0 })} is still owing.`
            : `This takes ${math.unitCount} unit${math.unitCount === 1 ? "" : "s"}${math.freebieCount > 0 ? ` and ${math.freebieCount} freebie${math.freebieCount === 1 ? "" : "s"}` : ""} out of your stock on hand. Editing the order later will not take them out twice.`
        }
        confirmLabel="Complete it"
        tone="primary"
        onConfirm={complete}
      />

      <ConfirmTray
        open={confirmVerifyPayment}
        onClose={() => setConfirmVerifyPayment(false)}
        title="Approve this payment?"
        body="Only confirm this after you've actually checked the proof against what came into your account. This marks the order Paid — it does not touch stock; stock still only moves when you complete the order."
        confirmLabel="Approve payment"
        tone="primary"
        onConfirm={verifyPayment}
      />
    </>
  );
}

/* ----------------------------------------------------------- invoice tray */

/**
 * The customer's copy, and the ONE surface in this console that is not written
 * for the operator. Everything it renders comes from `invoiceModel()`, which
 * carries only customer-relevant billed figures, so internal accounting details
 * can never appear here.
 *
 * Laid out as a spacious document rather than a dense ops panel, because a
 * screenshot of it is what the customer actually receives, and exported to a
 * high-resolution PNG by the two actions in its footer.
 */
function InvoiceTray({ open, order, math, origin, onClose, onBack }) {
  const { productsById, derived } = useStore();
  const [working, setWorking] = useState(null); // "save" | "share"

  const model = useMemo(
    () =>
      order && math
        ? invoiceModel({ order, math, productsById, variantsById: derived.variantsById })
        : null,
    [order, math, productsById, derived.variantsById],
  );

  if (!order) return null;

  const run = async (mode, work, done) => {
    if (working) return;
    setWorking(mode);
    haptic(12);
    try {
      done(await work());
    } catch (e) {
      // A share the user backs out of is a choice, not a failure.
      if (e?.name === "AbortError") return;
      toast.error("Could not make the image. Try again.");
    } finally {
      setWorking(null);
    }
  };

  return (
    <Tray
      open={open}
      onClose={onClose}
      onBack={onBack}
      origin={origin}
      wide
      title={`Invoice ${order.order_number}`}
      subtitle={`${order.customer_name || "Walk-in customer"} · ${formatDate(order.order_date)}`}
      footer={(
        <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            className="btn-quiet min-w-0"
            disabled={!!working || !model}
            onClick={() =>
              run(
                "save",
                () => saveInvoicePng(model),
                (r) => toast.success(`Invoice image saved · ${r.width}px wide`),
              )
            }
          >
            <DownloadSimple size={16} weight="bold" />
            {/* Shared stem, so the label morphs rather than swapping. */}
            <MorphLabel>{working === "save" ? "Saving image…" : "Save invoice image"}</MorphLabel>
          </button>
          <button
            type="button"
            className="btn-primary min-w-0"
            disabled={!!working || !model}
            onClick={() =>
              run(
                "share",
                () => shareInvoicePng(model),
                (r) => {
                  if (!r.shared) toast.success("Invoice image saved to share");
                },
              )
            }
          >
            <ShareNetwork size={16} weight="bold" />
            <MorphLabel>{working === "share" ? "Sharing image…" : "Share image"}</MorphLabel>
          </button>
        </div>
      )}
    >
      <div className="pb-1 pt-1">
        <InvoiceDoc model={model} />
        <p className="mt-3 px-1 text-micro leading-relaxed text-ink-3">
          Saving exports this invoice at {INVOICE_WIDTH * 3}px wide, so it stays sharp wherever you
          send it.
        </p>
      </div>
    </Tray>
  );
}

/* ------------------------------------------------------------- order tray */

function OrderTray({ open, order, items, freebies, origin, onClose, onSave, onDelete }) {
  const {
    productsById,
    freebiesById,
    derived,
    db,
    payments,
    freebies: freebieCatalog,
  } = useStore();

  const [form, setForm] = useState(() => {
    const requirement = requirementOf(order);
    return {
      order_number: order?.order_number ?? "",
      order_date: order?.order_date ?? today(),
      customer_name: order?.customer_name ?? "",
      customer_email: order?.customer_email ?? "",
      customer_phone: order?.customer_phone ?? "",
      shipping_address: order?.shipping_address ?? "",
      channel: order?.channel ?? "",
      status: normaliseOrderStatus(order?.status ?? "Pending", requirement),
      payment_requirement: requirement,
      shipping_income_php: String(order?.shipping_income_php ?? 0),
      discount_php: String(order?.discount_php ?? 0),
      carrier: order?.carrier ?? "",
      tracking_number: order?.tracking_number ?? "",
      fulfillment_status: order?.fulfillment_status ?? "Not shipped",
      shipped_date: order?.shipped_date ?? "",
      notes: order?.notes ?? "",
    };
  });

  const [lines, setLines] = useState(() =>
    (items || []).map((l) => ({
      key: `k${l.id}`,
      product_id: l.product_id,
      variant_id: l.variant_id ?? null,
      product_name: l.product_name,
      quantity: M(l.quantity, 1),
      sale_price_php: String(l.sale_price_php ?? 0),
      actual_landed_cost_php:
        M(l.actual_landed_cost_php) > 0 ? String(l.actual_landed_cost_php) : "",
    })),
  );

  const [gifts, setGifts] = useState(() =>
    (freebies || []).map((f) => ({
      key: `g${f.id}`,
      freebie_id: f.freebie_id,
      freebie_name: f.freebie_name,
      quantity: M(f.quantity, 1),
      unit_cost: String(f.unit_cost ?? 0),
    })),
  );

  const [errors, setErrors] = useState({});
  const [productPicker, setProductPicker] = useState(false);
  const [freebiePicker, setFreebiePicker] = useState(false);
  const [pickerOrigin, capturePickerOrigin] = useOrigin();
  const [saving, setSaving] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);

  const alreadyCompleted = order?.status === "Completed";

  /* A new order gets its number filled in for you, not left blank. */
  useEffect(() => {
    if (!open || order || form.order_number) return;
    db.nextOrderNumber()
      .then((n) => setForm((f) => (f.order_number ? f : { ...f, order_number: n })))
      .catch(() => {});
  }, [open, order, db, form.order_number]);

  const set = (key) => (e) => {
    const value = e?.target ? e.target.value : e;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  /* Changing the requirement re-points the status vocabulary with it. */
  const setRequirement = (e) => {
    const value = e?.target ? e.target.value : e;
    setForm((f) => ({
      ...f,
      payment_requirement: value,
      status: normaliseOrderStatus(f.status, value),
    }));
    haptic(8);
  };

  const paid = order ? paidFor(payments, order.id) : 0;

  const math = useMemo(
    () =>
      orderMath(
        form,
        lines.map((l, i) => ({
          id: i,
          product_id: l.product_id,
          variant_id: l.variant_id ?? null,
          quantity: M(l.quantity),
          sale_price_php: M(l.sale_price_php),
          actual_landed_cost_php: l.actual_landed_cost_php,
        })),
        derived.landedMap,
        paid,
        gifts.map((g) => ({ quantity: M(g.quantity), unit_cost: M(g.unit_cost) })),
      ),
    [form, lines, gifts, derived.landedMap, paid],
  );

  /**
   * The standard kit measured against THIS order: one cover, one edge tape and
   * one overgrip piece per paddle, against what is actually on the shelf.
   */
  const kit = useMemo(
    () => freebieKit(freebieCatalog, math.unitCount),
    [freebieCatalog, math.unitCount],
  );

  /** Whether the gifts on this order already are the standard kit. */
  const kitOnOrder = useMemo(() => {
    const need = new Map(
      kit.usable.map((i) => [i.freebie.id, i.meta.perPaddle * math.unitCount]),
    );
    if (!need.size || math.unitCount === 0) return false;
    for (const [id, want] of need) {
      const has = gifts
        .filter((g) => g.freebie_id === id)
        .reduce((s, g) => s + M(g.quantity), 0);
      if (has < want) return false;
    }
    return true;
  }, [kit, gifts, math.unitCount]);

  /** One tap fills the kit at the right quantity for the paddles on the order. */
  const addKit = () => {
    if (!kit.usable.length || math.unitCount === 0) return;
    haptic(12);
    setGifts((prev) => {
      const next = [...prev];
      for (const item of kit.usable) {
        const want = item.meta.perPaddle * math.unitCount;
        const at = next.findIndex((g) => g.freebie_id === item.freebie.id);
        if (at === -1) {
          next.push({
            key: `g${Date.now()}-${item.freebie.id}`,
            freebie_id: item.freebie.id,
            freebie_name: item.freebie.name,
            quantity: want,
            unit_cost: String(item.unitCost),
          });
        } else if (M(next[at].quantity) < want) {
          next[at] = { ...next[at], quantity: want };
        }
      }
      return next;
    });
  };

  /** What the gifts on this order would take off the shelf, and any shortfall. */
  const giftShortfall = useMemo(
    () =>
      gifts
        .map((g) => {
          const catalog = freebiesById.get(g.freebie_id);
          const want = Math.max(0, M(g.quantity));
          const stock = Math.max(0, M(catalog?.quantity));
          return { gift: g, name: catalog?.name || g.freebie_name, want, stock, short: want - stock };
        })
        .filter((r) => r.short > 0),
    [gifts, freebiesById],
  );

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
        id: order?.id,
        orderRow: { ...form, status },
        items: lines.map((l) => ({
          product_id: l.product_id,
          variant_id: l.variant_id ?? null,
          // The stored name carries the colour, so a deleted variant still reads
          // correctly on the historical line.
          product_name: unitLabel(
            productsById.get(l.product_id)?.name || l.product_name || "Paddle",
            derived.variantsById.get(l.variant_id)?.color,
          ),
          quantity: M(l.quantity),
          sale_price_php: M(l.sale_price_php),
          actual_landed_cost_php: M(l.actual_landed_cost_php),
        })),
        freebies: gifts.map((g) => ({
          freebie_id: g.freebie_id,
          freebie_name: freebiesById.get(g.freebie_id)?.name || g.freebie_name,
          quantity: M(g.quantity),
          unit_cost: M(g.unit_cost),
        })),
      });
      haptic(12);
      if (result?.stockApplied) {
        confetti({
          particleCount: 80,
          spread: 66,
          startVelocity: 36,
          ticks: 140,
          origin: { y: 0.6 },
          colors: CONFETTI_COLORS,
          disableForReducedMotion: true,
        });
        toast.success("Order completed, stock updated");
      } else {
        // Saving gets a toast, never confetti.
        toast.success(order ? "Order updated" : "Order created");
      }
      onClose();
    } catch (e) {
      if (String(e?.message || "").toLowerCase().includes("unique")) {
        setErrors({ order_number: "That order number is already used" });
      } else {
        toast.error("Could not save the order. Try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  const submit = () => {
    if (form.status === "Completed" && !alreadyCompleted) {
      const found = validate(RULES, form);
      if (!lines.length) found.lines = "Add at least one paddle";
      if (Object.keys(found).length) {
        setErrors(found);
        haptic([12, 40, 12]);
        return;
      }
      setConfirmComplete(true);
      return;
    }
    persist();
  };

  /* The primary label keeps its stem and grows a count, never swaps. */
  const primaryLabel = saving
    ? "Saving order…"
    : form.status === "Completed" && !alreadyCompleted
      ? "Complete order"
      : order
        ? `Save changes${lines.length ? ` · ${lines.length} item${lines.length === 1 ? "" : "s"}` : ""}`
        : `Save order${lines.length ? ` · ${lines.length} item${lines.length === 1 ? "" : "s"}` : ""}`;

  return (
    <>
      <Tray
        open={open}
        onClose={onClose}
        origin={origin}
        wide
        title={order ? "Edit order" : "New order"}
        subtitle={
          math.unitCount > 0
            ? `${math.unitCount} unit${math.unitCount === 1 ? "" : "s"} · ${php(math.billedTotal, { decimals: 0 })} billed · ${php(math.dueNow, { decimals: 0 })} due now`
            : "Who bought what, and for how much"
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
              <MorphLabel>{primaryLabel}</MorphLabel>
            </button>
          </div>
        }
      >
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
            <Field label="Order number" error={errors.order_number} required>
              <Input
                value={form.order_number}
                onChange={set("order_number")}
                error={errors.order_number}
                placeholder="PB-2026-001"
                data-autofocus
              />
            </Field>
            <Field label="Date" error={errors.order_date} required>
              <Input
                type="date"
                value={form.order_date}
                onChange={set("order_date")}
                error={errors.order_date}
              />
            </Field>
          </div>

          <Field label="Customer">
            <Input value={form.customer_name} onChange={set("customer_name")} placeholder="Name" />
          </Field>

          <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
            <Field label="Phone">
              <Input value={form.customer_phone} onChange={set("customer_phone")} placeholder="09xx xxx xxxx" />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.customer_email} onChange={set("customer_email")} placeholder="customer@example.com" />
            </Field>
          </div>

          <Field label="Shipping address" hint="optional">
            <textarea
              className="field min-h-[76px] resize-y"
              value={form.shipping_address}
              onChange={set("shipping_address")}
              placeholder="House, street, barangay, city"
              rows={3}
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
            <Field label="Channel">
              <Select value={form.channel} onChange={set("channel")}>
                <option value="">Not set</option>
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Order status">
              <Select value={form.status} onChange={set("status")}>
                {statusesFor(form.payment_requirement).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div>
            <Field label="Payment requirement">
              <Select value={form.payment_requirement} onChange={setRequirement}>
                {PAYMENT_REQUIREMENTS.map((r) => (
                  <option key={r} value={r}>
                    {REQUIREMENT_LABEL[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="mt-1.5 break-words px-0.5 text-micro leading-relaxed text-ink-3">
              {REQUIREMENT_HELP[form.payment_requirement]}
            </p>

            <AnimatePresence initial={false}>
              {math.billedTotal > 0.005 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={spring}
                  className="overflow-hidden"
                >
                  <dl className="mt-2 space-y-1 rounded-md bg-cobalt-wash px-2.5 py-2 text-micro text-cobalt">
                    <div className="flex items-baseline justify-between gap-2 font-semibold xs:gap-3">
                      <dt className="min-w-0 break-words">
                        {math.isDeposit ? "Deposit due now" : "Full payment due now"}
                      </dt>
                      <dd className="num shrink-0 whitespace-nowrap">
                        <RollingNumber value={php(math.dueNow)} />
                      </dd>
                    </div>
                    {paid > 0.005 && (
                      <>
                        <div className="flex items-baseline justify-between gap-2 xs:gap-3">
                          <dt className="min-w-0 break-words opacity-80">Amount paid</dt>
                          <dd className="num shrink-0 whitespace-nowrap opacity-80">
                            <RollingNumber value={php(math.amountPaid)} />
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-2 border-t border-cobalt/20 pt-1 font-semibold xs:gap-3">
                          <dt className="min-w-0 break-words">Balance due</dt>
                          <dd className="num shrink-0 whitespace-nowrap">
                            <RollingNumber value={php(math.balanceDue)} />
                          </dd>
                        </div>
                      </>
                    )}
                  </dl>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ----------------------------------------------------- paddles */}
          <div>
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 px-0.5">
              <span className="eyebrow">What they bought</span>
              {errors.lines && (
                <span className="min-w-0 break-words text-micro text-clay">{errors.lines}</span>
              )}
            </div>

            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {lines.map((line, index) => {
                  const product = productsById.get(line.product_id);
                  const variant = derived.variantsById.get(line.variant_id);
                  // Every colour this paddle carries, so the exact one is
                  // switchable on the line rather than only at pick time.
                  const colours = (derived.variantsByProduct.get(line.product_id) || []).filter(
                    (v) => v.active || v.id === line.variant_id,
                  );
                  const key = unitKey(line.product_id, line.variant_id);
                  const estLanded = M(
                    (derived.landedMap.get(key) || derived.landedMap.get(line.product_id))
                      ?.landedPerUnit,
                  );
                  const computed = math.lines[index];
                  // A colour's own price wins where it has one, the paddle's otherwise.
                  const standard =
                    M(variant?.selling_price_php) > 0
                      ? M(variant.selling_price_php)
                      : M(product?.selling_price_php);
                  const onHand = variant ? M(variant.quantity) : M(product?.quantity_on_hand);
                  const offStandard =
                    standard > 0 &&
                    String(line.sale_price_php).trim() !== "" &&
                    Math.abs(M(line.sale_price_php) - standard) > 0.005;
                  const lineProfit =
                    (computed?.lineRevenue || 0) - (computed?.lineActualCost || 0);

                  return (
                    <motion.div
                      key={line.key}
                      layout
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                      transition={spring}
                      className="overflow-hidden rounded-md border border-line bg-paper p-2.5"
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-eta font-medium">
                            {product?.name || line.product_name || "Removed paddle"}
                          </p>
                          <p className="num mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 break-words text-micro text-ink-3">
                            {variant && <Chip tone="gray">{variant.color}</Chip>}
                            <span className="whitespace-nowrap">
                              {variant?.sku || product?.sku} · {onHand} on hand
                            </span>
                          </p>
                        </div>
                        <button
                          type="button"
                          aria-label={`Remove ${unitLabel(product?.name || "line", variant?.color)}`}
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

                      {/* The exact colour, changeable on the line itself, not
                          only at the moment the paddle was picked. */}
                      {colours.length > 0 && (
                        <label className="mt-2 block min-w-0">
                          <span className="mb-1 block text-micro text-ink-3">Colour</span>
                          <Select
                            value={line.variant_id ?? ""}
                            aria-label={`Colour for ${product?.name || "this line"}`}
                            onChange={(e) => {
                              const nextId = e.target.value ? M(e.target.value) : null;
                              const next = derived.variantsById.get(nextId);
                              const nextPrice =
                                M(next?.selling_price_php) > 0
                                  ? M(next.selling_price_php)
                                  : M(product?.selling_price_php);
                              haptic(8);
                              setLines((prev) =>
                                prev.map((l) =>
                                  l.key === line.key
                                    ? {
                                        ...l,
                                        variant_id: nextId,
                                        product_name: unitLabel(
                                          product?.name || l.product_name,
                                          next?.color,
                                        ),
                                        // Only follow the colour's price where
                                        // the line was still on the old standard.
                                        sale_price_php: offStandard
                                          ? l.sale_price_php
                                          : String(Math.round(nextPrice)),
                                      }
                                    : l,
                                ),
                              );
                            }}
                            className="!min-h-[40px] !py-1.5"
                          >
                            <option value="">No colour</option>
                            {colours.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.color} · {M(c.quantity)} on hand
                              </option>
                            ))}
                          </Select>
                        </label>
                      )}

                      <div className="mt-2 grid grid-cols-2 gap-2 xs:grid-cols-3">
                        <label className="block min-w-0">
                          <span className="mb-1 block text-micro text-ink-3">Qty</span>
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
                          <span className="mb-1 block truncate text-micro text-ink-3">Price ₱</span>
                          <Input
                            numeric
                            value={line.sale_price_php}
                            placeholder={standard > 0 ? String(Math.round(standard)) : "0"}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((l) =>
                                  l.key === line.key
                                    ? { ...l, sale_price_php: e.target.value }
                                    : l,
                                ),
                              )
                            }
                            className="!min-h-[40px] !py-1.5"
                          />
                        </label>
                        <label className="col-span-2 block min-w-0 xs:col-span-1">
                          <span className="mb-1 block truncate text-micro text-ink-3">Actual ₱</span>
                          <Input
                            numeric
                            value={line.actual_landed_cost_php}
                            placeholder={estLanded ? estLanded.toFixed(0) : "0"}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((l) =>
                                  l.key === line.key
                                    ? { ...l, actual_landed_cost_php: e.target.value }
                                    : l,
                                ),
                              )
                            }
                            className="!min-h-[40px] !py-1.5"
                          />
                        </label>
                      </div>

                      <AnimatePresence initial={false}>
                        {offStandard && (
                          <motion.button
                            type="button"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={spring}
                            onClick={() => {
                              setLines((prev) =>
                                prev.map((l) =>
                                  l.key === line.key
                                    ? { ...l, sale_price_php: String(Math.round(standard)) }
                                    : l,
                                ),
                              );
                              haptic(8);
                            }}
                            className="block w-full overflow-hidden text-left"
                          >
                            <span className="num block break-words pt-1.5 text-micro text-cobalt">
                              This order only. Back to the standard{" "}
                              {php(standard, { decimals: 0 })}
                            </span>
                          </motion.button>
                        )}
                      </AnimatePresence>

                      <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-line pt-2">
                        <span className="num min-w-0 truncate text-micro text-ink-3">
                          est. landed {php(estLanded)}
                        </span>
                        <span
                          className={clsx(
                            "num shrink-0 whitespace-nowrap text-eta font-semibold",
                            lineProfit < 0 ? "text-clay" : "text-teal",
                          )}
                        >
                          <RollingNumber value={php(lineProfit, { decimals: 0 })} />
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              <button
                type="button"
                onClick={(e) => {
                  capturePickerOrigin(e);
                  setProductPicker(true);
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

          {/* ---------------------------------------------------- freebies */}
          <div>
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 px-0.5">
              <span className="eyebrow">Thrown in</span>
              <AnimatePresence initial={false}>
                {math.freebieCost > 0 && (
                  <motion.span
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={spring}
                    className="num shrink-0 whitespace-nowrap text-micro font-semibold text-plum"
                  >
                    <RollingNumber value={`−${php(math.freebieCost)}`} />
                  </motion.span>
                )}
              </AnimatePresence>
            </div>

            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {gifts.map((gift) => {
                  const catalog = freebiesById.get(gift.freebie_id);
                  return (
                    <motion.div
                      key={gift.key}
                      layout
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                      transition={spring}
                      className="overflow-hidden rounded-md border border-plum/25 bg-plum-wash p-2.5"
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-eta font-medium">
                            {catalog?.name || gift.freebie_name}
                          </p>
                          <p className="num mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 break-words text-micro text-ink-3">
                            <Chip
                              tone={M(catalog?.quantity) >= M(gift.quantity) ? "teal" : "clay"}
                            >
                              {M(catalog?.quantity)} on shelf
                            </Chip>
                            <span className="whitespace-nowrap">
                              taking {M(gift.quantity)}
                            </span>
                          </p>
                        </div>
                        <button
                          type="button"
                          aria-label={`Remove ${gift.freebie_name}`}
                          onClick={() => {
                            setGifts((prev) => prev.filter((g) => g.key !== gift.key));
                            haptic(8);
                          }}
                          className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-3
                                     transition-transform duration-150 active:scale-90 active:bg-white/60"
                        >
                          <X size={15} />
                        </button>
                      </div>

                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <label className="block min-w-0">
                          <span className="mb-1 block text-micro text-ink-3">Qty</span>
                          <Input
                            numeric
                            value={gift.quantity}
                            onChange={(e) =>
                              setGifts((prev) =>
                                prev.map((g) =>
                                  g.key === gift.key ? { ...g, quantity: e.target.value } : g,
                                ),
                              )
                            }
                            className="!min-h-[40px] !py-1.5"
                          />
                        </label>
                        <label className="block min-w-0">
                          <span className="mb-1 block truncate text-micro text-ink-3">
                            Unit cost ₱
                          </span>
                          <Input
                            numeric
                            value={gift.unit_cost}
                            onChange={(e) =>
                              setGifts((prev) =>
                                prev.map((g) =>
                                  g.key === gift.key ? { ...g, unit_cost: e.target.value } : g,
                                ),
                              )
                            }
                            className="!min-h-[40px] !py-1.5"
                          />
                        </label>
                      </div>

                      <p className="num mt-2 flex items-baseline justify-between gap-2 border-t border-plum/20 pt-2 text-micro text-ink-3">
                        <span className="min-w-0 truncate">costs you, no revenue</span>
                        <span className="shrink-0 whitespace-nowrap font-semibold text-plum">
                          −{php(M(gift.quantity) * M(gift.unit_cost))}
                        </span>
                      </p>
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              {/* The whole kit in one tap, sized to the paddles on the order. */}
              <AnimatePresence initial={false}>
                {kit.configured && math.unitCount > 0 && !kitOnOrder && (
                  <motion.button
                    type="button"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={spring}
                    onClick={addKit}
                    className="flex w-full items-center justify-center gap-1.5 overflow-hidden rounded-md
                               border border-plum/40 bg-plum-wash py-2.5 text-eta font-medium text-plum
                               transition-transform duration-150 active:scale-[0.99]"
                  >
                    <Gift size={15} weight="fill" />
                    {/* Keeps its stem and grows the count, never swaps. */}
                    <MorphLabel>{`Add the standard kit · ${math.unitCount} × ${kit.usable.length}`}</MorphLabel>
                  </motion.button>
                )}
              </AnimatePresence>

              <button
                type="button"
                onClick={(e) => {
                  capturePickerOrigin(e);
                  setFreebiePicker(true);
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-plum/40
                           bg-surface py-2.5 text-eta font-medium text-plum transition-[transform,background-color]
                           duration-150 active:scale-[0.99] active:bg-plum-wash"
              >
                <Gift size={15} weight="bold" />
                Add a freebie
              </button>

              {/* Not enough on the shelf: it says so where the numbers are. */}
              <AnimatePresence initial={false}>
                {giftShortfall.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={spring}
                    className="overflow-hidden"
                  >
                    <p className="flex gap-2 rounded-md border border-clay/25 bg-clay-wash px-2.5 py-2 text-micro leading-relaxed text-clay">
                      <Warning size={14} weight="fill" className="mt-px shrink-0" />
                      <span className="min-w-0 break-words">
                        Not enough freebie stock:{" "}
                        {giftShortfall
                          .map((r) => `${r.name} short by ${r.short}`)
                          .join(", ")}
                        . Buy the consumables on a batch, or complete this order anyway and the
                        shelf floors at zero.
                      </span>
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
            <Field label="Customer shipping" hint="not profit" error={errors.shipping_income_php}>
              <Input
                numeric
                value={form.shipping_income_php}
                onChange={set("shipping_income_php")}
                error={errors.shipping_income_php}
              />
            </Field>
            <Field label="Discount" hint="₱" error={errors.discount_php}>
              <Input
                numeric
                value={form.discount_php}
                onChange={set("discount_php")}
                error={errors.discount_php}
              />
            </Field>
          </div>

          {/* ------------------------------------------------- fulfilment */}
          <div>
            <Field label="Delivery status">
              <Select value={form.fulfillment_status} onChange={set("fulfillment_status")}>
                {FULFILLMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>

            {/* Carrier and number only matter once something has shipped. */}
            <AnimatePresence initial={false}>
              {form.fulfillment_status !== "Not shipped" && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={spring}
                  className="overflow-hidden"
                >
                  <div className="mt-3 grid grid-cols-1 gap-3 xs:grid-cols-2">
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
                  <div className="mt-3">
                    <Field label="Shipped on">
                      <Input
                        type="date"
                        value={form.shipped_date || ""}
                        onChange={set("shipped_date")}
                      />
                    </Field>
                  </div>
                  <p className="mt-1.5 break-words px-0.5 text-micro leading-relaxed text-ink-3">
                    Log where the parcel actually goes from the order's own detail view, and each
                    event you add there becomes the newest status here.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="rounded-md border border-line bg-paper p-2.5 xs:p-3">
            <dl className="space-y-1.5 text-eta">
              <div className="flex justify-between gap-2 xs:gap-3">
                <dt className="min-w-0 text-ink-3">Product revenue</dt>
                <dd className="num shrink-0 whitespace-nowrap font-semibold">
                  <RollingNumber value={php(math.productRevenue)} />
                </dd>
              </div>
              {math.shippingIncome > 0 && (
                <div className="flex justify-between gap-2 xs:gap-3">
                  <dt className="min-w-0 break-words text-ink-3">
                    Customer shipping <span className="text-ink-4">· excluded</span>
                  </dt>
                  <dd className="num shrink-0 whitespace-nowrap text-ink-3">
                    <RollingNumber value={php(math.shippingIncome)} />
                  </dd>
                </div>
              )}
              {math.freebieCost > 0 && (
                <div className="flex justify-between gap-2 xs:gap-3">
                  <dt className="min-w-0 break-words text-plum">
                    Freebies <span className="text-ink-4">· cost only</span>
                  </dt>
                  <dd className="num shrink-0 whitespace-nowrap text-plum">
                    <RollingNumber value={`−${php(math.freebieCost)}`} />
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-2 xs:gap-3">
                <dt className="min-w-0 text-ink-3">Total billed</dt>
                <dd className="num shrink-0 whitespace-nowrap">
                  <RollingNumber value={php(math.billedTotal)} />
                </dd>
              </div>
              <div className="flex justify-between gap-2 xs:gap-3">
                <dt className="min-w-0 break-words text-cobalt">
                  {math.isDeposit ? "Deposit due now" : "Due now"}
                </dt>
                <dd className="num shrink-0 whitespace-nowrap text-cobalt">
                  <RollingNumber value={php(math.dueNow)} />
                </dd>
              </div>
              <div className="flex justify-between gap-2 border-t border-line pt-1.5 xs:gap-3">
                <dt className="min-w-0 text-ink-3">Estimated profit</dt>
                <dd
                  className={clsx(
                    "num shrink-0 whitespace-nowrap text-right",
                    math.estProfit < 0 && "text-clay",
                  )}
                >
                  {php(math.estProfit)}{" "}
                  <span className="text-ink-3">· {pct(math.estMargin)}</span>
                </dd>
              </div>
              <div className="flex justify-between gap-2 font-semibold xs:gap-3">
                <dt className="min-w-0">Actual profit</dt>
                <dd
                  className={clsx(
                    "num shrink-0 whitespace-nowrap text-right",
                    math.actualProfit < 0 ? "text-clay" : "text-teal",
                  )}
                >
                  <RollingNumber value={php(math.actualProfit)} />
                  <span className="ml-1 font-normal text-ink-3">{pct(math.actualMargin)}</span>
                </dd>
              </div>
            </dl>
            <ShippingNote className="mt-2.5" />
          </div>

          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={set("notes")}
              rows={2}
              placeholder="Delivery details, requests, anything worth keeping"
              className="field resize-none"
            />
          </Field>

          {order && (
            <div className="border-t border-line-soft pt-3">
              <button
                type="button"
                className="btn-quiet w-full !text-clay"
                onClick={() => onDelete(order)}
              >
                <Trash size={16} />
                Delete order
              </button>
            </div>
          )}
        </div>
      </Tray>

      <ProductPicker
        open={productPicker}
        origin={pickerOrigin}
        exclude={lines.map((l) => unitKey(l.product_id, l.variant_id))}
        onClose={() => setProductPicker(false)}
        onBack={() => setProductPicker(false)}
        onPick={(unit) => {
          const estLanded = M(derived.landedMap.get(unit.key)?.landedPerUnit);
          const price = M(unit.selling_price_php);
          setLines((prev) => [
            ...prev,
            {
              key: `k${Date.now()}-${unit.key}`,
              product_id: unit.product_id,
              variant_id: unit.variant_id,
              product_name: unitLabel(unit.name, unit.color),
              quantity: 1,
              sale_price_php: String(price > 0 ? price : Math.round(estLanded)),
              actual_landed_cost_php: "",
            },
          ]);
          setProductPicker(false);
        }}
      />

      <FreebiePicker
        open={freebiePicker}
        origin={pickerOrigin}
        exclude={gifts.map((g) => g.freebie_id)}
        onClose={() => setFreebiePicker(false)}
        onBack={() => setFreebiePicker(false)}
        onPick={(freebie) => {
          setGifts((prev) => [
            ...prev,
            {
              key: `g${Date.now()}-${freebie.id}`,
              freebie_id: freebie.id,
              freebie_name: freebie.name,
              quantity: 1,
              unit_cost: String(M(freebie.unit_cost)),
            },
          ]);
          setFreebiePicker(false);
        }}
      />

      <ConfirmTray
        open={confirmComplete}
        onClose={() => setConfirmComplete(false)}
        title="Complete this order?"
        body={`This takes ${math.unitCount} unit${math.unitCount === 1 ? "" : "s"}${math.freebieCount > 0 ? ` and ${math.freebieCount} freebie${math.freebieCount === 1 ? "" : "s"}` : ""} out of your stock on hand. Saving it again later will not take them out twice.`}
        confirmLabel="Complete it"
        tone="primary"
        onConfirm={() => persist("Completed")}
      />
    </>
  );
}

/* --------------------------------------------------------- tracking tray */

const TRACKING_RULES = {
  status: { required: true, label: "Status" },
  event_date: { required: true, label: "Date" },
};

/**
 * One tracking event. Nested inside the order detail tray, so it carries a back
 * arrow, and deliberately shorter than the detail view that opened it.
 */
function TrackingTray({ open, event, order, origin, onClose, onBack, onSave }) {
  const [form, setForm] = useState(() => ({
    status: event?.status ?? nextStatusFor(order),
    carrier: event?.carrier ?? order?.carrier ?? "",
    tracking_number: event?.tracking_number ?? order?.tracking_number ?? "",
    location: event?.location ?? "",
    event_date: event?.event_date ?? today(),
    notes: event?.notes ?? "",
  }));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => {
    const value = e?.target ? e.target.value : e;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const save = async () => {
    const found = validate(TRACKING_RULES, form);
    if (Object.keys(found).length) {
      setErrors(found);
      haptic([12, 40, 12]);
      return;
    }
    setSaving(true);
    try {
      await onSave({ ...form, id: event?.id });
      haptic(12);
      toast.success(`Marked ${form.status.toLowerCase()}`);
      onClose();
    } catch {
      toast.error("Could not save the tracking event. Try again.");
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
      title={event ? "Edit tracking event" : "Add a tracking event"}
      subtitle={order?.order_number}
      footer={
        <button type="button" className="btn-primary w-full" disabled={saving} onClick={save}>
          {/* Keeps its stem and grows the status, rather than swapping. */}
          <MorphLabel>
            {saving ? "Saving event…" : `Save event · ${form.status}`}
          </MorphLabel>
        </button>
      }
    >
      <div className="space-y-3 pt-1">
        <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
          <Field label="Status" error={errors.status} required>
            <Select value={form.status} onChange={set("status")} error={errors.status}>
              {FULFILLMENT_STATUSES.filter((s) => s !== "Not shipped").map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date" error={errors.event_date} required>
            <Input
              type="date"
              value={form.event_date}
              onChange={set("event_date")}
              error={errors.event_date}
              data-autofocus
            />
          </Field>
        </div>

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

        <Field label="Location" hint="where it is right now">
          <Input value={form.location} onChange={set("location")} placeholder="Cagayan de Oro hub" />
        </Field>

        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={set("notes")}
            rows={2}
            placeholder="Left with the guard, rescheduled, anything worth keeping"
            className="field resize-none"
          />
        </Field>

        <p className="px-1 text-micro leading-relaxed text-ink-3">
          The newest event becomes this order's delivery status, carrier and tracking number
          everywhere they show. Nothing here touches stock, payment or profit.
        </p>
      </div>
    </Tray>
  );
}

/** Suggest the sensible next step rather than making them pick from cold. */
function nextStatusFor(order) {
  const current = order?.fulfillment_status || "Not shipped";
  const i = FULFILLMENT_STATUSES.indexOf(current);
  if (i === -1 || current === "Not shipped") return "Shipped";
  if (current === "Delivered" || current === "Returned") return current;
  return FULFILLMENT_STATUSES[Math.min(i + 1, FULFILLMENT_STATUSES.length - 2)];
}

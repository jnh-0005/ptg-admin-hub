import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import clsx from "clsx";

import { php } from "../lib/calc";
import { BUSINESS_NAME, INVOICE_FOOTER } from "../lib/invoice";
import { listChild, listParent, spring } from "../lib/motion";

// Customer invoice design version restored to the clean rebranded layout.
const INVOICE_DESIGN_VERSION = "customer-ready-v11-rebranded";

/**
 * THE CUSTOMER INVOICE, on screen.
 *
 * Rendered from `invoiceModel()`, which carries only what a customer may see.
 * There is deliberately no access to profit, revenue, margin, landed cost,
 * supplier cost, shipping allocation or freebie cost here: the component cannot
 * show a figure the model does not hold, and nothing on this document explains
 * how any figure was reached.
 *
 * Laid out mobile-first and spacious so a screenshot of it is already a
 * presentable document, and mirrored glyph for glyph by the PNG exporter in
 * `src/lib/invoice.js`.
 */

/** The PTG court mark, reused as the photo placeholder so a gap looks intentional. */
function CourtMark({ className, mono = false }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="2.8" fill={mono ? "currentColor" : "#B4D633"} />
      <circle cx="21" cy="11" r="2.8" fill={mono ? "currentColor" : "#FFFFFF"} />
      <circle cx="11" cy="21" r="2.8" fill={mono ? "currentColor" : "#FFFFFF"} />
      <circle cx="21" cy="21" r="2.8" fill={mono ? "currentColor" : "#B4D633"} />
    </svg>
  );
}

/**
 * The product photograph. Three designed states and no default: the placeholder
 * while it loads, the photo fading up once it arrives, and the same placeholder
 * kept for good when a URL is missing or dead. It never collapses or flashes.
 */
function LinePhoto({ src, alt, free = false }) {
  const reduce = useReducedMotion();
  const [state, setState] = useState(src ? "loading" : "none");

  return (
    <span
      className={clsx(
        "relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-md border xs:h-[72px] xs:w-[72px]",
        free ? "border-[#b7d2cc] bg-[#eaf3f1] text-[#0b7775]/45" : "border-[#dce5e2] bg-white text-ink-4",
      )}
    >
      <CourtMark mono className="h-7 w-7" />
      {src && state !== "error" && (
        <motion.img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.04 }}
          animate={state === "ready" ? { opacity: 1, scale: 1 } : { opacity: 0 }}
          transition={reduce ? { duration: 0.001 } : spring}
          onLoad={() => setState("ready")}
          onError={() => setState("error")}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </span>
  );
}

function LineRow({ row }) {
  return (
    <motion.li
      variants={listChild}
      className="flex items-start gap-3.5 border-t border-line-soft py-4 first:border-t-0 first:pt-0 xs:gap-4 xs:py-[18px]"
    >
      <LinePhoto src={row.photo} alt={row.name} free={row.free} />

      <span className="min-w-0 flex-1 pt-0.5">
        <span
          className={clsx(
            "block break-words text-[15px] font-semibold leading-snug xs:text-[16px]",
            row.free && "text-[#0b7775]",
          )}
        >
          {row.name}
        </span>
        <span className="num mt-1.5 block text-eta text-ink-3 xs:text-sm">
          {row.free ? `${row.qty} × free of charge` : `${row.qty} × ${php(row.unitPrice)}`}
        </span>
        {(row.color || row.sku) && (
          <span className="mt-1 block break-words text-micro text-ink-3">
            {[row.color, row.sku].filter(Boolean).join(" · ")}
          </span>
        )}
      </span>

      <span
        className={clsx(
          "shrink-0 whitespace-nowrap pt-0.5 text-right",
          row.free ? "text-eta font-semibold text-[#0b7775]" : "num text-[15px] font-semibold xs:text-[16px]",
        )}
      >
        {row.free ? "Included" : php(row.amount)}
      </span>
    </motion.li>
  );
}

export default function InvoiceDoc({ model }) {
  if (!model) return null;
  const rows = [...model.lines, ...model.freebies];

  return (
    <article aria-label="Customer invoice" data-invoice-design={INVOICE_DESIGN_VERSION} className="relative overflow-hidden rounded-xl border border-[#dce5e2] bg-[#f5f7f6] shadow-card">
      <div className="px-4 py-4 xs:px-6 xs:py-6">
        {/* ---------------------------------------------------- letterhead */}
        <header className="flex min-h-[92px] items-center justify-between gap-4 rounded-lg bg-gradient-to-br from-[#123d36] to-[#0b7775] px-4 py-4 text-[#fffdf4] xs:px-5">
          <img
            src="/images/ptg-logo-header.png"
            alt="Paddle To Go"
            className="h-14 w-[86px] min-w-0 object-contain object-left xs:h-16 xs:w-[98px]"
          />
          <div className="shrink-0 text-right">
            <p className="eyebrow !text-[#fffdf4]/75">Invoice</p>
            <p className="num mt-1 text-[15px] font-semibold">{model.number}</p>
            <p className="num mt-1 text-micro text-[#fffdf4]/75">{model.date}</p>
          </div>
        </header>

        {/* ------------------------------------------------------- bill to */}
        <section className="mt-6 border-t border-[#dce5e2] px-1 pt-6 xs:mt-8 xs:pt-7">
          <p className="eyebrow">Billed to</p>
          <p className="mt-2.5 break-words text-[19px] font-semibold leading-tight tracking-tight">
            {model.billTo.name}
          </p>
          <div className="mt-2.5 space-y-1.5 text-sm leading-relaxed text-ink-2">
            {model.billTo.phone && <p className="num break-words">{model.billTo.phone}</p>}
            {model.billTo.email && <p className="break-all">{model.billTo.email}</p>}
            {model.billTo.address && (
              <p className="whitespace-pre-wrap break-words">{model.billTo.address}</p>
            )}
          </div>
          {!model.billTo.phone && !model.billTo.email && !model.billTo.address && (
            <p className="mt-2.5 text-sm italic text-ink-3">
              No contact details on this order yet.
            </p>
          )}
        </section>

        {/* --------------------------------------------------------- items */}
        <section className="mt-7 border-t border-[#dce5e2] px-1 pt-6 xs:mt-8 xs:pt-7">
          <div className="flex items-baseline justify-between gap-3">
            <p className="eyebrow">Items</p>
            <p className="num shrink-0 text-micro text-ink-3">
              {model.itemCount} item{model.itemCount === 1 ? "" : "s"}
            </p>
          </div>

          {rows.length === 0 ? (
            <p className="mt-5 rounded-md border border-dashed border-line bg-paper px-4 py-7 text-center text-sm text-ink-3">
              Nothing on this order yet.
            </p>
          ) : (
            <motion.ul variants={listParent} initial="hidden" animate="shown" className="mt-4">
              {rows.map((row) => (
                <LineRow key={row.id} row={row} />
              ))}
            </motion.ul>
          )}
        </section>

        {/* -------------------------------------------------------- totals */}
        <section className="mt-7 border-t border-[#dce5e2] px-1 pt-6 xs:mt-8 xs:pt-7">
          <dl className="space-y-3">
            {model.totals.map((item) => (
              <div
                key={item.key}
                className={clsx(
                  "flex items-baseline justify-between gap-4",
                  item.rule && "border-t border-line pt-3",
                )}
              >
                <dt
                  className={clsx(
                    "min-w-0 break-words",
                    item.strong
                      ? "text-[16px] font-semibold text-ink"
                      : clsx(
                          "text-sm",
                          item.tone === "clay"
                            ? "text-[#5c6f6b]"
                            : item.tone === "teal"
                              ? "text-teal"
                            : item.tone === "cobalt"
                              ? "text-[#0b7775]"
                              : "text-ink-2",
                        ),
                  )}
                >
                  {item.label}
                </dt>
                <dd
                  className={clsx(
                    "num shrink-0 whitespace-nowrap",
                    item.strong
                      ? "text-[16px] font-semibold"
                      : clsx(
                          "text-sm",
                          item.tone === "clay"
                            ? "text-[#5c6f6b]"
                            : item.tone === "teal"
                              ? "text-teal"
                            : item.tone === "cobalt"
                              ? "text-[#0b7775]"
                              : "text-ink-2",
                        ),
                  )}
                >
                  {php(item.value)}
                </dd>
              </div>
            ))}
          </dl>

          {/* --------------------------------------------- deposit payable */}
          {model.deposit && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg bg-[#eaf3f1] px-5 py-5 text-[#0b7775] ring-1 ring-[#0b7775]/15">
              <div className="min-w-0">
                <p className="text-eyebrow font-semibold uppercase tracking-[0.08em]">
                  {model.deposit.label}
                </p>
                <p className="mt-1 break-words text-sm opacity-80">{model.deposit.note}</p>
              </div>
              <p className="num shrink-0 whitespace-nowrap text-[22px] font-semibold tracking-tight xs:text-[26px]">
                {php(model.deposit.value)}
              </p>
            </div>
          )}

          {/* ------------------------------------------------ balance due */}
          <div
            className={clsx(
              "mt-6 flex items-center justify-between gap-4 rounded-lg px-5 py-5",
              model.settled ? "bg-[#dcefeb] text-[#0b7775]" : "bg-white text-[#123d36] ring-1 ring-[#aacdc7]",
            )}
          >
            <div className="min-w-0">
              <p className="text-eyebrow font-semibold uppercase tracking-[0.08em]">
                {model.settled ? "Fully paid" : "Balance due"}
              </p>
              <p className="mt-1 break-words text-sm opacity-80">
                {model.settled ? "Nothing outstanding" : `Payable to ${BUSINESS_NAME}`}
              </p>
            </div>
            <p className="num shrink-0 whitespace-nowrap text-[22px] font-semibold tracking-tight xs:text-[26px]">
              {php(model.balanceDue)}
            </p>
          </div>
        </section>

        {/* ------------------------------------------------- payment terms */}
        <section className="mt-5 rounded-lg bg-white px-5 py-5 ring-1 ring-[#dce5e2]">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="eyebrow !text-[#123d36]">Payment terms</p>
            <p className="shrink-0 text-micro font-semibold text-[#0b7775]">{model.terms.label}</p>
          </div>
          <p className="mt-2.5 break-words text-sm leading-relaxed text-ink-2">
            {model.terms.body}
          </p>
        </section>

        {/* -------------------------------------------------------- footer */}
        <footer className="mt-8 border-t border-line pt-6">
          <p className="text-center text-sm text-ink-3">{INVOICE_FOOTER}</p>
        </footer>
      </div>
    </article>
  );
}

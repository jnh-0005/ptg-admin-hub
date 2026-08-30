/**
 * THE CUSTOMER INVOICE.
 *
 * One model, two renderers. `invoiceModel()` is the single source of truth for
 * what a customer is allowed to see, and both the on-screen document and the
 * exported PNG read from it, so the two can never drift.
 *
 * WHAT A CUSTOMER MAY SEE, and nothing else:
 *   what they bought, what it was billed at, the discount, the delivery charge,
 *   the total, what they have paid, what is still due, and the payment terms.
 *
 * WHAT NEVER LEAVES THE CONSOLE:
 *   revenue, profit, margin, landed cost, supplier cost, VND cost, shipping
 *   allocation, freebie cost. `invoiceModel` never reads those fields, which is
 *   the enforcement: a component cannot leak a figure the model does not carry.
 */

import { formatDate, php, unitPhoto } from "./calc";

export const BUSINESS_NAME = "Paddle To Go";
export const INVOICE_FOOTER = "Thank you for shopping with Paddle To Go";
const INVOICE_LOGO = "/images/ptg-logo-header.png";

/** The one design width the document and the export both lay out against. */
export const INVOICE_WIDTH = 720;

const TOKENS={
  paper: "#F6F5F4",
  surface: "#FFFFFF",
  ink: "#1C1A18",
  ink2: "#5C564F",
  ink3: "#8A837A",
  ink4: "#B3ACA2",
  line: "#E3E0DA",
  lineSoft: "#EFEDE9",
  cobalt: "#1F5FE0",
  cobaltWash: "#EDF2FE",
  teal: "#0B7775",
  tealWash: "#DCEFEB",
  clay: "#C2551F",
  clayWash: "#FBEFE8",
  plum: "#6B4E9E",
  plumWash: "#F1ECFA",
  lime: "#B4D633",
  forest: "#123D36",
  deepTeal: "#0B7775",
  forestWash: "#F5F7F6",
  storefrontLine: "#DCE5E2",
  ivory: "#FFFDF4",
};

const SANS = '"Schibsted Grotesk Variable", system-ui, sans-serif';
const MONO = '"JetBrains Mono Variable", ui-monospace, monospace';

/**
 * Builds the customer-facing document from an order and its already-computed
 * `orderMath`. Only the billed figures are copied across.
 */
export function invoiceModel({ order, math, productsById, variantsById }) {
  if (!order || !math) return null;

  const lines = math.lines.map((line) => {
    const product = productsById?.get(line.product_id) || null;
    const variant = variantsById?.get(line.variant_id) || null;
    return {
      id: `line-${line.id}`,
      name: product?.name || line.product_name || "Paddle",
      color: variant?.color || null,
      sku: variant?.sku || product?.sku || null,
      qty: line.qty,
      unitPrice: line.price,
      amount: line.lineRevenue,
      // The selected colour's own photograph, falling back to the paddle's.
      photo: unitPhoto(product, variant),
      free: false,
    };
  });

  const freebies = math.freebies.map((f) => ({
    id: `gift-${f.id}`,
    name: f.freebie_name,
    color: null,
    sku: null,
    qty: f.qty,
    unitPrice: 0,
    amount: 0,
    photo: null,
    free: true,
  }));

  const totals = [
    { key: "subtotal", label: "Subtotal", value: math.itemsRevenue },
    math.discount > 0.005 && {
      key: "discount",
      label: "Discount",
      value: -math.discount,
      tone: "clay",
    },
    math.shippingIncome > 0.005 && {
      key: "delivery",
      label: "Delivery",
      value: math.shippingIncome,
    },
    { key: "total", label: "Invoice total", value: math.billedTotal, rule: true, strong: true },
    { key: "paid", label: "Amount paid", value: -math.amountPaid, tone: "teal" },
  ].filter(Boolean);

  /**
   * The deposit is lifted OUT of the totals list on purpose. On a deposit order
   * the exact half is the one figure the customer has to act on, so it gets its
   * own highlighted line rather than disappearing into the run of small rows.
   */
  const depositPercentLabel = math.paymentRequirement === "deposit_25" ? "25%" : "50%";
  const deposit = math.isDeposit
    ? {
        label: `${depositPercentLabel} deposit payable now`,
        value: math.depositDue,
        note: math.depositMet
          ? "Received in full — your paddles are reserved."
          : "Payable now to reserve your paddles.",
      }
    : null;

  const settled = math.balanceDue <= 0.005;

  return {
    number: order.order_number,
    date: formatDate(order.order_date),
    billTo: {
      name: order.customer_name || "Walk-in customer",
      phone: order.customer_phone || null,
      email: order.customer_email || null,
      address: order.shipping_address || null,
    },
    lines,
    freebies,
    itemCount: math.unitCount,
    totals,
    deposit,
    balanceDue: math.balanceDue,
    settled,
    terms: {
      label: math.paymentRequirementLabel,
      body: termsSentence(math),
    },
  };
}

/**
 * Payment terms in the customer's own language, written HERE rather than reused
 * from the console's copy, so operator phrasing can never reach the invoice. No
 * cost, margin or stock-keeping language ever enters it.
 */
function termsSentence(math) {
  if (math.isDeposit) {
    const percentLabel = math.paymentRequirement === "deposit_25" ? "25%" : "50%";
    return math.depositMet
      ? `The ${percentLabel} deposit of ${php(math.depositDue, { decimals: 0 })} has been received and your paddles are reserved. ${php(math.balanceDue, { decimals: 0 })} is due before delivery.`
      : `A ${percentLabel} deposit of ${php(math.depositDue, { decimals: 0 })} is payable now. ${php(math.dueNowOutstanding, { decimals: 0 })} remains to settle for the deposit, and your paddles are reserved once it is received.`;
  }
  return math.settledUp
    ? "Paid in full. Thank you."
    : `The full ${php(math.billedTotal, { decimals: 0 })} is due now.`;
}

/* --------------------------------------------------------------- PNG export */

const filenameFor = (model) =>
  `${BUSINESS_NAME.replace(/\s+/g, "-").toLowerCase()}-invoice-${String(model.number || "")
    .replace(/[^\w-]+/g, "-")
    .replace(/^-|-$/g, "")}.png`;

/** Loads one photograph for the canvas, or resolves null so the tile falls back. */
function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    // Without this the canvas is tainted and toBlob() throws. A host that
    // refuses the header simply yields the placeholder, never a failed export.
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function loadPhotos(model) {
  const urls = [
    INVOICE_LOGO,
    ...model.lines.map((l) => l.photo).filter(Boolean),
  ];
  const images = await Promise.all(urls.map(loadImage));
  return new Map(urls.map((url, i) => [url, images[i]]));
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, radius);
  else {
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }
}

/** Greedy wrap against the real metrics of the font already set on the context. */
function wrap(ctx, text, maxWidth) {
  const out = [];
  for (const paragraph of String(text ?? "").split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push("");
      continue;
    }
    let row = words[0];
    for (let i = 1; i < words.length; i += 1) {
      const next = `${row} ${words[i]}`;
      if (ctx.measureText(next).width <= maxWidth) row = next;
      else {
        out.push(row);
        row = words[i];
      }
    }
    out.push(row);
  }
  return out;
}

/** Truncates to one line with an ellipsis, for names that must not wrap. */
function clip(ctx, text, maxWidth) {
  const value = String(text ?? "");
  if (ctx.measureText(value).width <= maxWidth) return value;
  let lo = 0;
  let hi = value.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${value.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${value.slice(0, lo)}…`;
}

/** The four-ball court mark is reserved for missing product photographs. */
function courtMark(ctx, x, y, size, { mono = false } = {}) {
  const r = size * 0.088;
  const o = size * 0.31;
  const dots = [
    [x + o, y + o, mono ? TOKENS.ink4 : TOKENS.lime],
    [x + size - o, y + o, mono ? TOKENS.ink4 : "#FFFFFF"],
    [x + o, y + size - o, mono ? TOKENS.ink4 : "#FFFFFF"],
    [x + size - o, y + size - o, mono ? TOKENS.ink4 : TOKENS.lime],
  ];
  for (const [cx, cy, fill] of dots) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Paints the whole invoice and returns the height it used. Run once against a
 * throwaway context to measure, then again against the real one, so the canvas
 * is exactly as tall as the document and nothing is cropped.
 */
function paint(ctx, model, photos, { measure = false } = {}) {
  const W = INVOICE_WIDTH;
  const PAD = 44;
  const inner = W - PAD * 2;
  const on = !measure;
  let y = 0;

  const text = (value, x, baseline, { font, color = TOKENS.ink, align = "left" } = {}) => {
    if (!on) return;
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(value, x, baseline);
  };

  const rule = (top, color = TOKENS.line) => {
    if (on) {
      ctx.fillStyle = color;
      ctx.fillRect(PAD, top, inner, 1);
    }
  };

  /* ------------------------------------------------------------ letterhead */
  y = 28;
  const headerH = 92;
  if (on) {
    const accent = ctx.createLinearGradient(PAD, y, W - PAD, y + headerH);
    accent.addColorStop(0, TOKENS.forest);
    accent.addColorStop(1, TOKENS.deepTeal);
    ctx.fillStyle = accent;
    roundRect(ctx, PAD, y, inner, headerH, 12);
    ctx.fill();
    const logo = photos.get(INVOICE_LOGO);
    if (logo) {
      const boxW = 86;
      const boxH = 68;
      const scale = Math.min(boxW / logo.width, boxH / logo.height);
      const dw = logo.width * scale;
      const dh = logo.height * scale;
      ctx.drawImage(logo, PAD + 20, y + (headerH - dh) / 2, dw, dh);
    }
  }
  text("INVOICE", W - PAD - 20, y + 28, {
    font: `600 11px ${SANS}`,
    color: TOKENS.ivory,
    align: "right",
  });
  text(model.number, W - PAD - 20, y + 52, {
    font: `600 17px ${MONO}`,
    color: TOKENS.ivory,
    align: "right",
  });
  text(model.date, W - PAD - 20, y + 73, {
    font: `400 12px ${MONO}`,
    color: TOKENS.ivory,
    align: "right",
  });
  y += headerH + 38;

  /* --------------------------------------------------------------- bill to */
  text("BILLED TO", PAD, y, { font: `600 11px ${SANS}`, color: TOKENS.ink3 });
  y += 24;
  text(model.billTo.name, PAD, y, { font: `600 20px ${SANS}` });
  y += 12;

  // The phone is mono on screen, so it is mono here too.
  const contact = [
    model.billTo.phone && { value: model.billTo.phone, font: `400 14px ${MONO}` },
    model.billTo.email && { value: model.billTo.email, font: `400 14px ${SANS}` },
  ].filter(Boolean);
  for (const item of contact) {
    y += 22;
    text(item.value, PAD, y, { font: item.font, color: TOKENS.ink2 });
  }
  if (model.billTo.address) {
    ctx.font = `400 14px ${SANS}`;
    for (const row of wrap(ctx, model.billTo.address, inner - 120)) {
      y += 22;
      text(row, PAD, y, { font: `400 14px ${SANS}`, color: TOKENS.ink2 });
    }
  }
  if (!contact.length && !model.billTo.address) {
    y += 22;
    text("No contact details on this order yet.", PAD, y, {
      font: `italic 400 14px ${SANS}`,
      color: TOKENS.ink3,
    });
  }

  y += 34;
  rule(y, TOKENS.storefrontLine);
  y += 36;

  /* ----------------------------------------------------------------- items */
  text("ITEMS", PAD, y, { font: `600 11px ${SANS}`, color: TOKENS.ink3 });
  const countLabel = `${model.itemCount} item${model.itemCount === 1 ? "" : "s"}`;
  text(countLabel, W - PAD, y, {
    font: `400 12px ${MONO}`,
    color: TOKENS.ink3,
    align: "right",
  });
  y += 20;

  const TILE = 68;
  const rows = [...model.lines, ...model.freebies];

  if (!rows.length) {
    y += 30;
    text("Nothing on this order yet.", W / 2, y, {
      font: `400 14px ${SANS}`,
      color: TOKENS.ink3,
      align: "center",
    });
    y += 22;
  }

  for (const row of rows) {
    const top = y;
    const rowH = TILE + 28;

    if (on) {
      // The photograph, or the quiet court-mark placeholder.
      const img = row.photo ? photos.get(row.photo) : null;
      ctx.save();
      roundRect(ctx, PAD, top + 14, TILE, TILE, 10);
      ctx.fillStyle = row.free ? "#EAF3F1" : TOKENS.surface;
      ctx.fill();
      if (img) {
        ctx.clip();
        const scale = Math.max(TILE / img.width, TILE / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.drawImage(img, PAD + (TILE - dw) / 2, top + 14 + (TILE - dh) / 2, dw, dh);
      }
      ctx.restore();
      if (!img) courtMark(ctx, PAD + 16, top + 30, TILE - 32, { mono: true });
      ctx.strokeStyle = row.free ? "#B7D2CC" : TOKENS.storefrontLine;
      ctx.lineWidth = 1;
      roundRect(ctx, PAD + 0.5, top + 14.5, TILE - 1, TILE - 1, 10);
      ctx.stroke();
    }

    const textX = PAD + TILE + 18;
    const amountText = row.free ? "Included" : php(row.amount);
    ctx.font = `600 16px ${MONO}`;
    const amountW = ctx.measureText(amountText).width;
    const nameMax = inner - TILE - 18 - amountW - 20;

    ctx.font = `600 16px ${SANS}`;
    text(clip(ctx, row.name, nameMax), textX, top + 36, {
      font: `600 16px ${SANS}`,
      color: row.free ? TOKENS.deepTeal : TOKENS.ink,
    });

    const meta = row.free
      ? `${row.qty} × free of charge`
      : `${row.qty} × ${php(row.unitPrice)}`;
    text(meta, textX, top + 58, { font: `400 14px ${MONO}`, color: TOKENS.ink3 });

    const detail = [row.color, row.sku].filter(Boolean).join(" · ");
    if (detail) {
      text(detail, textX, top + 78, { font: `400 12px ${SANS}`, color: TOKENS.ink3 });
    }

    text(amountText, W - PAD, top + 36, {
      font: row.free ? `600 13px ${SANS}` : `600 16px ${MONO}`,
      color: row.free ? TOKENS.deepTeal : TOKENS.ink,
      align: "right",
    });

    y = top + rowH;
    if (row !== rows[rows.length - 1]) rule(y - 6, TOKENS.lineSoft);
  }

  y += 22;
  rule(y, TOKENS.storefrontLine);
  y += 34;

  /* ---------------------------------------------------------------- totals */
  for (const item of model.totals) {
    if (item.rule) {
      rule(y - 14);
      y += 8;
    }
    const tone =
      item.tone === "clay"
        ? TOKENS.ink2
        : item.tone === "teal"
          ? TOKENS.teal
          : item.tone === "cobalt"
            ? TOKENS.deepTeal
            : TOKENS.ink2;
    text(item.label, PAD, y, {
      font: `${item.strong ? 600 : 400} ${item.strong ? 16 : 14}px ${SANS}`,
      color: item.strong ? TOKENS.ink : tone,
    });
    text(php(item.value), W - PAD, y, {
      font: `${item.strong ? 600 : 400} ${item.strong ? 16 : 14}px ${MONO}`,
      color: item.strong ? TOKENS.ink : tone,
      align: "right",
    });
    y += 28;
  }

  /* --------------------------------------------------------- deposit payable */
  // Its own highlighted panel, mirroring the on-screen document section for
  // section, so the exact half a customer must pay cannot be skimmed past.
  if (model.deposit) {
    y += 12;
    const depositH = 76;
    if (on) {
      ctx.fillStyle = "#EAF3F1";
      roundRect(ctx, PAD, y, inner, depositH, 12);
      ctx.fill();
    }
    text(model.deposit.label.toUpperCase(), PAD + 20, y + 30, {
      font: `600 11px ${SANS}`,
      color: TOKENS.deepTeal,
    });
    text(model.deposit.note, PAD + 20, y + 52, {
      font: `400 14px ${SANS}`,
      color: TOKENS.deepTeal,
    });
    text(php(model.deposit.value), W - PAD - 20, y + 46, {
      font: `600 26px ${MONO}`,
      color: TOKENS.deepTeal,
      align: "right",
    });
    y += depositH + 6;
  }

  /* ----------------------------------------------------------- balance due */
  y += 6;
  const balanceH = 76;
  if (on) {
    ctx.fillStyle = model.settled ? TOKENS.tealWash : TOKENS.surface;
    roundRect(ctx, PAD, y, inner, balanceH, 12);
    ctx.fill();
    if (!model.settled) {
      ctx.strokeStyle = "#AACDC7";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  const balanceTone = model.settled ? TOKENS.deepTeal : TOKENS.forest;
  text(model.settled ? "FULLY PAID" : "BALANCE DUE", PAD + 20, y + 30, {
    font: `600 11px ${SANS}`,
    color: balanceTone,
  });
  text(model.settled ? "Nothing outstanding" : `Payable to ${BUSINESS_NAME}`, PAD + 20, y + 52, {
    font: `400 14px ${SANS}`,
    color: balanceTone,
  });
  text(php(model.balanceDue), W - PAD - 20, y + 46, {
    font: `600 26px ${MONO}`,
    color: balanceTone,
    align: "right",
  });
  y += balanceH + 26;

  /* --------------------------------------------------------- payment terms */
  ctx.font = `400 14px ${SANS}`;
  const termLines = wrap(ctx, model.terms.body, inner - 40);
  const termsH = 54 + termLines.length * 20 + 18;
  if (on) {
    ctx.fillStyle = TOKENS.surface;
    roundRect(ctx, PAD, y, inner, termsH, 12);
    ctx.fill();
    ctx.strokeStyle = TOKENS.storefrontLine;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  text("PAYMENT TERMS", PAD + 20, y + 28, { font: `600 11px ${SANS}`, color: TOKENS.forest });
  text(model.terms.label, W - PAD - 20, y + 28, {
    font: `600 12px ${SANS}`,
    color: TOKENS.deepTeal,
    align: "right",
  });
  let ty = y + 52;
  for (const row of termLines) {
    ty += 20;
    text(row, PAD + 20, ty, { font: `400 14px ${SANS}`, color: TOKENS.ink2 });
  }
  y += termsH + 34;

  /* ---------------------------------------------------------------- footer */
  rule(y, TOKENS.storefrontLine);
  y += 30;
  text(INVOICE_FOOTER, W / 2, y, {
    font: `400 14px ${SANS}`,
    color: TOKENS.ink3,
    align: "center",
  });
  y += 44;

  return Math.ceil(y);
}

/**
 * Renders the invoice to a high-resolution PNG blob. Laid out at 720 logical
 * points and drawn at `scale`, so the default export is 2160px wide.
 */
export async function renderInvoicePng(model, { scale = 3 } = {}) {
  if (!model) throw new Error("No invoice to render");

  if (typeof document !== "undefined" && document.fonts?.ready) {
    // The document's own faces, so the export is typeset like the app.
    try {
      await document.fonts.ready;
    } catch {
      /* a browser without the font API still renders in the fallback stack */
    }
  }

  const photos = await loadPhotos(model);

  const probe = document.createElement("canvas").getContext("2d");
  const height = paint(probe, model, photos, { measure: true });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(INVOICE_WIDTH * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = TOKENS.forestWash;
  ctx.fillRect(0, 0, INVOICE_WIDTH, height);
  paint(ctx, model, photos);

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not encode the image"))),
      "image/png",
    );
  });

  return { blob, filename: filenameFor(model), width: canvas.width, height: canvas.height };
}

/** Saves the PNG to the device. */
export async function saveInvoicePng(model, options) {
  const { blob, filename, width } = await renderInvoicePng(model, options);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { filename, width };
}

export const canShareInvoice = () =>
  typeof navigator !== "undefined" && typeof navigator.canShare === "function";

/**
 * Shares the PNG through the OS sheet where the browser supports file sharing,
 * and falls back to saving it where it does not, so the action never dead-ends.
 */
export async function shareInvoicePng(model, options) {
  const { blob, filename, width } = await renderInvoicePng(model, options);
  const file = new File([blob], filename, { type: "image/png" });

  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({
      files: [file],
      title: `Invoice ${model.number}`,
      text: `Invoice ${model.number} from ${BUSINESS_NAME}`,
    });
    return { shared: true, filename, width };
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { shared: false, filename, width };
}

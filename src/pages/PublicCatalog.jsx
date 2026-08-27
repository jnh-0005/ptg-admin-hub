import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ImageSquare,
  MagnifyingGlass,
  Minus,
  Package,
  Plus,
  ShoppingBag,
  Truck,
  X,
} from "@phosphor-icons/react";

import { batch, query } from "../lib/folkdb";
import { spring } from "../lib/motion";
import {
  brandOf,
  buildStorefrontIndex,
  PUBLIC_CATALOG_PATH,
  PUBLIC_SHOP_PATH,
  resolvePhotoAssetUrl,
  resolveStorefrontPhoto,
} from "../lib/storefront";

const PRODUCT_COLUMNS = [
  "id",
  "name",
  "sku",
  "quantity",
  "sell_price",
  "photo_url",
  "category",
  "notes",
];
const VARIANT_COLUMNS = [
  "id",
  "inventory_id",
  "color",
  "sku",
  "quantity",
  "selling_price_php",
  "photo_url",
  "active",
];
const PHOTO_COLUMNS = ["identity_type", "identity_key", "photo_url", "active"];
const REQUIRED_ORDER_COLUMNS = [
  ["fulfillment_method", "TEXT"],
  ["payment_proof_url", "TEXT"],
  ["acknowledgment", "TEXT"],
];
const MAX_PROOF_CHARS = 150000;
const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const PROOF_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);
// Public checkout payment choices intentionally stay buyer-facing and reference-style.
const PAYMENT_METHODS = [
  { id: "maribank", label: "MariBank", image: "/images/payment-maribank.png" },
  { id: "paypal", label: "PayPal", image: "/images/payment-paytm.png" },
  { id: "instapay", label: "InstaPay", image: "/images/payment-instapay.png" },
];

const money = (value) =>
  `₱${Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const available = (choice) => Number(choice?.quantity || 0) > 0;
const clean = (value) => String(value || "").trim();
const columnsOf = (rows = []) => new Set(rows.map((row) => String(row.name).toLowerCase()));
const selectedColumns = (wanted, actual) => wanted.filter((column) => actual.has(column));
const selectList = (columns) => columns.map((column) => `"${column}"`).join(", ");

async function readBatch(statements) {
  const results = [];
  for (let index = 0; index < statements.length; index += 10) {
    results.push(...(await batch(statements.slice(index, index + 10))));
  }
  return results;
}

let checkoutSchemaReady;

async function ensureCheckoutSchema(orderColumns) {
  if (!checkoutSchemaReady) {
    checkoutSchemaReady = (async () => {
      const known = new Set(orderColumns);
      for (const [column, type] of REQUIRED_ORDER_COLUMNS) {
        if (known.has(column)) continue;
        await query(`ALTER TABLE orders ADD COLUMN ${column} ${type}`);
        known.add(column);
      }
      return known;
    })().catch((error) => {
      checkoutSchemaReady = null;
      throw error;
    });
  }
  return checkoutSchemaReady;
}

/** Public-safe catalog read. Costs, batches, orders and stock depth never cross this boundary. */
export async function loadCatalog() {
  const tableInfo = await readBatch([
    { sql: "PRAGMA table_info(inventory)" },
    { sql: "PRAGMA table_info(inventory_variants)" },
    { sql: "PRAGMA table_info(storefront_photos)" },
    { sql: "PRAGMA table_info(orders)" },
    { sql: "PRAGMA table_info(order_items)" },
  ]);
  const productColumns = selectedColumns(PRODUCT_COLUMNS, columnsOf(tableInfo[0]?.rows));
  const variantColumns = selectedColumns(VARIANT_COLUMNS, columnsOf(tableInfo[1]?.rows));
  const photoColumns = selectedColumns(PHOTO_COLUMNS, columnsOf(tableInfo[2]?.rows));

  if (!productColumns.includes("id") || !productColumns.includes("name")) {
    return { products: [], orderColumns: columnsOf(tableInfo[3]?.rows), itemColumns: columnsOf(tableInfo[4]?.rows) };
  }

  const reads = [
    { sql: `SELECT ${selectList(productColumns)} FROM inventory ORDER BY name COLLATE NOCASE` },
    variantColumns.includes("inventory_id")
      ? { sql: `SELECT ${selectList(variantColumns)} FROM inventory_variants ORDER BY color COLLATE NOCASE` }
      : { sql: "SELECT NULL WHERE 0" },
    photoColumns.includes("identity_key")
      ? { sql: `SELECT ${selectList(photoColumns)} FROM storefront_photos WHERE active = 1` }
      : { sql: "SELECT NULL WHERE 0" },
  ];
  const [productResult, variantResult, photoResult] = await readBatch(reads);
  const photoIndex = buildStorefrontIndex(photoResult?.rows || []);
  const variants = (variantResult?.rows || []).filter((variant) => Number(variant.active ?? 1) === 1);
  const products = (productResult?.rows || [])
    .filter(
      (product) =>
        product.category !== "Add-on" &&
        !String(product.notes || "").startsWith("[archived]"),
    )
    .map((product) => {
      const brand = brandOf(product.name);
      const productVariants = variants.filter((variant) => variant.inventory_id === product.id);
      const choices = productVariants.length
        ? productVariants.map((variant) => ({
            id: variant.id,
            color: clean(variant.color) || "Standard",
            sku: clean(variant.sku) || clean(product.sku),
            quantity: variant.quantity,
            price:
              Number(variant.selling_price_php) > 0
                ? Number(variant.selling_price_php)
                : Number(product.sell_price || 0),
            photo:
              resolveStorefrontPhoto(photoIndex, {
                name: product.name,
                color: variant.color,
                brand,
                fallback: variant.photo_url || product.photo_url,
              })?.url || null,
          }))
        : [
            {
              id: null,
              color: "Standard",
              sku: clean(product.sku),
              quantity: product.quantity,
              price: Number(product.sell_price || 0),
              photo:
                resolveStorefrontPhoto(photoIndex, {
                  name: product.name,
                  brand,
                  fallback: product.photo_url,
                })?.url || resolvePhotoAssetUrl(product.photo_url),
            },
          ];
      return { id: product.id, name: product.name, brand, choices };
    });

  return {
    products,
    orderColumns: columnsOf(tableInfo[3]?.rows),
    itemColumns: columnsOf(tableInfo[4]?.rows),
  };
}

function ProductImage({ product, choice, layout = false, className = "" }) {
  const [failed, setFailed] = useState(false);
  const src = resolvePhotoAssetUrl(choice?.photo);
  useEffect(() => setFailed(false), [src]);
  const image = src && !failed ? (
    <img src={src} alt={`${product.name}${choice?.color && choice.color !== "Standard" ? ` in ${choice.color}` : ""}`} onError={() => setFailed(true)} />
  ) : (
    <div className="public-placeholder" aria-label="Photo coming soon">
      <img src="/images/ptg-logo-header.png" alt="" />
      <span>Photo coming soon</span>
    </div>
  );
  return layout ? (
    <motion.div layoutId={`public-product-${product.id}`} className={className} transition={spring}>
      {image}
    </motion.div>
  ) : (
    <div className={className}>{image}</div>
  );
}

export default function PublicCatalog() {
  const reduce = useReducedMotion();
  const [products, setProducts] = useState([]);
  const [schema, setSchema] = useState({ orderColumns: new Set(), itemColumns: new Set() });
  const [status, setStatus] = useState("loading");
  const [reconnecting, setReconnecting] = useState(false);
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState("All brands");
  const [selected, setSelected] = useState(null);
  const [selectedChoice, setSelectedChoice] = useState(null);
  const [cart, setCart] = useState([]);
  const [panel, setPanel] = useState(null);
  const [sent, setSent] = useState(null);
  const hasCatalog = useRef(false);

  const refresh = async (background = false) => {
    if (background) setReconnecting(false);
    try {
      const result = await loadCatalog();
      setProducts(result.products);
      setSchema({ orderColumns: result.orderColumns, itemColumns: result.itemColumns });
      setStatus("ready");
      setReconnecting(false);
      hasCatalog.current = true;
    } catch {
      if (background && hasCatalog.current) setReconnecting(true);
      else setStatus("error");
    }
  };

  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => refresh(true), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const brands = useMemo(
    () => ["All brands", ...Array.from(new Set(products.map((product) => product.brand))).sort()],
    [products],
  );
  useEffect(() => {
    if (!brands.includes(brand)) setBrand("All brands");
  }, [brand, brands]);

  const filtered = products.filter((product) => {
    const needle = search.trim().toLowerCase();
    return (
      (brand === "All brands" || product.brand === brand) &&
      (!needle || `${product.brand} ${product.name}`.toLowerCase().includes(needle))
    );
  });
  const availableChoices = products.reduce(
    (total, product) => total + product.choices.filter(available).length,
    0,
  );
  const cartCount = cart.reduce((total, line) => total + line.quantity, 0);
  const cartTotal = cart.reduce((total, line) => total + line.price * line.quantity, 0);

  const openProduct = (product) => {
    setSelected(product);
    setSelectedChoice(product.choices.find(available) || product.choices[0]);
  };
  const addToCart = () => {
    if (!selected || !available(selectedChoice)) return;
    const key = `${selected.id}:${selectedChoice.id || "base"}`;
    setCart((current) => {
      const existing = current.find((line) => line.key === key);
      if (existing) {
        return current.map((line) =>
          line.key === key
            ? { ...line, quantity: Math.min(line.max, line.quantity + 1) }
            : line,
        );
      }
      return [
        ...current,
        {
          key,
          productId: selected.id,
          variantId: selectedChoice.id,
          name: selected.name,
          color: selectedChoice.color,
          sku: selectedChoice.sku,
          price: selectedChoice.price,
          photo: selectedChoice.photo,
          max: Number(selectedChoice.quantity || 0),
          quantity: 1,
        },
      ];
    });
    setSelected(null);
    setPanel("cart");
  };
  const updateQuantity = (key, delta) => {
    setCart((current) =>
      current
        .map((line) =>
          line.key === key
            ? { ...line, quantity: Math.min(line.max, Math.max(0, line.quantity + delta)) }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
  };

  return (
    <div className="public-shell">
      <header className="public-header">
        <a href={PUBLIC_CATALOG_PATH} aria-label="Paddle To Go storefront">
          <img src="/images/ptg-logo-inverse.png" alt="Paddle To Go" className="public-logo" />
        </a>
        <button type="button" className="public-cart-button" onClick={() => setPanel("cart")}>
          <ShoppingBag size={18} />
          <span>Cart</span>
          {cartCount > 0 && <b>{cartCount}</b>}
        </button>
      </header>

      <main className="public-main">
        <section className="public-hero">
          <div>
            <span className="public-kicker">CURRENT LINE-UP</span>
            <h1>Your next paddle is ready.</h1>
            <p>Choose your model and colour, then reserve it with a 50% deposit.</p>
            <a href={PUBLIC_SHOP_PATH} onClick={(event) => { if (window.location.pathname === PUBLIC_CATALOG_PATH || window.location.pathname === `${PUBLIC_CATALOG_PATH}/`) { event.preventDefault(); window.history.replaceState(null, "", PUBLIC_SHOP_PATH); document.getElementById("shop")?.scrollIntoView({ behavior: "smooth" }); } }}>Shop paddles <ArrowRight size={16} /></a>
          </div>
          <div className="public-hero-stat" aria-label={`${availableChoices} choices available`}>
            <strong>{availableChoices}</strong>
            <span>choices ready</span>
          </div>
        </section>

        <section className="public-browse" id="shop">
          <div className="public-browse-head">
            <div>
              <span className="public-kicker">SHOP</span>
              <h2>Find your paddle</h2>
            </div>
            <span className={`public-live ${reconnecting ? "is-offline" : ""}`}>
              <i /> {reconnecting ? "Reconnecting" : "Live availability"}
            </span>
          </div>
          <label className="public-search">
            <MagnifyingGlass size={18} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search model or brand"
              aria-label="Search model or brand"
            />
          </label>
          <div className="public-brand-row" aria-label="Filter by brand">
            {brands.map((item) => (
              <button
                type="button"
                key={item}
                className={brand === item ? "is-active" : ""}
                onClick={() => setBrand(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </section>

        {status === "loading" && <CatalogSkeleton />}
        {status === "error" && (
          <section className="public-state">
            <Package size={28} />
            <h2>The shop did not load</h2>
            <p>Please check your connection and try again.</p>
            <button type="button" onClick={() => { setStatus("loading"); refresh(); }}>Try again</button>
          </section>
        )}
        {status === "ready" && filtered.length > 0 && (
          <motion.section className="public-grid" layout>
            {filtered.map((product) => {
              const inStock = product.choices.some(available);
              const fromPrice = Math.min(...product.choices.map((choice) => choice.price));
              return (
                <motion.article className="public-card" key={product.id} layout>
                  <button type="button" onClick={() => openProduct(product)} aria-label={`View ${product.name}`}>
                    <ProductImage product={product} choice={product.choices[0]} layout className="public-card-image" />
                    <div className="public-card-body">
                      <div className="public-card-name"><span>{product.brand}</span><h2>{product.name}</h2></div>
                      <div className="public-card-meta">
                        <strong>{money(fromPrice)}</strong>
                        <em className={inStock ? "is-in" : "is-out"}>{inStock ? "In stock" : "Sold out"}</em>
                      </div>
                      <span className="public-view">Choose a colour <ArrowRight size={13} /></span>
                    </div>
                  </button>
                </motion.article>
              );
            })}
          </motion.section>
        )}
        {status === "ready" && filtered.length === 0 && (
          <section className="public-state">
            <MagnifyingGlass size={28} />
            <h2>No matching paddles</h2>
            <p>Try another model or clear the brand filter.</p>
            <button type="button" onClick={() => { setSearch(""); setBrand("All brands"); }}>Show all paddles</button>
          </section>
        )}
      </main>

      <footer className="public-footer">
        <img src="/images/ptg-logo-header.png" alt="Paddle To Go" />
        <span>Live price and availability. No stock counts shown.</span>
      </footer>

      <AnimatePresence>
        {selected && (
          <ProductDetail
            product={selected}
            choice={selectedChoice}
            onChoice={setSelectedChoice}
            onClose={() => setSelected(null)}
            onAdd={addToCart}
            reduce={reduce}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {panel && (
          <CartFlow
            key="cart-flow"
            phase={panel}
            cart={cart}
            total={cartTotal}
            schema={schema}
            onPhase={setPanel}
            onClose={() => setPanel(null)}
            onQuantity={updateQuantity}
            onSent={(order) => {
              setPanel(null);
              setCart([]);
              setSent(order);
            }}
            reduce={reduce}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {sent && <Success order={sent} onClose={() => setSent(null)} reduce={reduce} />}
      </AnimatePresence>
    </div>
  );
}

function Overlay({ children, onClose, className, reduce }) {
  const dialogRef = useRef(null);
  const returnFocus = useRef(document.activeElement);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") return onCloseRef.current();
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'),
      );
      if (!focusable.length) return event.preventDefault();
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = priorOverflow;
      returnFocus.current?.focus?.();
    };
  }, []);

  return (
    <motion.div className="public-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <button type="button" className="public-scrim" onClick={onClose} aria-label="Close" />
      <motion.section
        ref={dialogRef}
        className={className}
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 36, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, y: 28, scale: 0.98 }}
        transition={spring}
        role="dialog"
        aria-modal="true"
        tabIndex="-1"
      >
        {children}
      </motion.section>
    </motion.div>
  );
}

function ProductDetail({ product, choice, onChoice, onClose, onAdd, reduce }) {
  return (
    <Overlay onClose={onClose} className="public-sheet public-detail-sheet" reduce={reduce}>
      <button type="button" className="public-close" onClick={onClose} aria-label="Close product details"><X size={20} /></button>
      <ProductImage product={product} choice={choice} layout className="public-detail-image" />
      <div className="public-detail">
        <span className="public-kicker">{product.brand}</span>
        <h2>{product.name}</h2>
        <p>Choose the colour you want to reserve.</p>
        <div className="public-variants">
          {product.choices.map((item) => (
            <button
              type="button"
              key={item.id || item.color}
              className={choice?.id === item.id ? "is-active" : ""}
              onClick={() => onChoice(item)}
            >
              <span><b>{item.color}</b><small>{available(item) ? "Available now" : "Sold out"}</small></span>
              <strong>{money(item.price)}</strong>
            </button>
          ))}
        </div>
        <button type="button" className="public-primary" disabled={!available(choice)} onClick={onAdd}>
          <ShoppingBag size={18} /> {available(choice) ? `Add ${choice?.color || "paddle"} to cart` : "This colour is sold out"}
        </button>
      </div>
    </Overlay>
  );
}

function CartFlow({ phase, cart, total, schema, onPhase, onClose, onQuantity, onSent, reduce }) {
  return (
    <Overlay onClose={onClose} className={`public-sheet public-cart-sheet is-${phase}`} reduce={reduce}>
      <AnimatePresence mode="popLayout" initial={false} custom={phase === "checkout" ? 1 : -1}>
        {phase === "cart" ? (
          <motion.div key="cart" className="public-flow" initial={reduce ? { opacity: 0 } : { opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} exit={reduce ? { opacity: 0 } : { opacity: 0, x: -18 }} transition={spring}>
            <div className="public-sheet-head"><button type="button" onClick={onClose} aria-label="Close cart"><X size={20} /></button><div><span className="public-kicker">YOUR ORDER</span><h2>Cart</h2></div></div>
            {cart.length === 0 ? (
              <div className="public-cart-empty"><ShoppingBag size={30} /><h3>Your cart is empty</h3><p>Choose an available paddle to get started.</p><button type="button" onClick={onClose}>Browse paddles</button></div>
            ) : (
              <>
                <div className="public-cart-lines">
                  {cart.map((line) => (
                    <div className="public-cart-line" key={line.key}>
                      <div className="public-cart-thumb">{line.photo ? <img src={line.photo} alt="" /> : <ImageSquare size={20} />}</div>
                      <div className="public-cart-copy"><b>{line.name}</b><small>{line.color}</small><strong>{money(line.price * line.quantity)}</strong></div>
                      <div className="public-stepper"><button type="button" onClick={() => onQuantity(line.key, -1)} aria-label={`Remove one ${line.name}`}><Minus size={13} /></button><span>{line.quantity}</span><button type="button" onClick={() => onQuantity(line.key, 1)} aria-label={`Add one ${line.name}`}><Plus size={13} /></button></div>
                    </div>
                  ))}
                </div>
                <div className="public-total"><span>Order total</span><strong>{money(total)}</strong></div>
                <div className="public-deposit"><span>Deposit to reserve</span><strong>{money(total / 2)}</strong><p>Exactly 50% is due now. The remaining {money(total / 2)} is due before pickup or shipping.</p></div>
                <button type="button" className="public-primary" onClick={() => onPhase("checkout")}>Continue to checkout <ArrowRight size={18} /></button>
              </>
            )}
          </motion.div>
        ) : (
          <Checkout key="checkout" cart={cart} total={total} schema={schema} onBack={() => onPhase("cart")} onSent={onSent} reduce={reduce} />
        )}
      </AnimatePresence>
    </Overlay>
  );
}

function Checkout({ cart, total, schema, onBack, onSent, reduce }) {
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0].id);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    fulfillment: "Pickup",
    address: "",
    city: "",
    proof: "",
    proofName: "",
    acknowledged: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef(null);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const selectedPayment = PAYMENT_METHODS.find((method) => method.id === paymentMethod);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const chooseProof = async (file) => {
    setError("");
    if (!file) return;
    if (file.size > MAX_PROOF_BYTES) {
      setForm((current) => ({ ...current, proof: "", proofName: "" }));
      setError("Payment proof must be 5 MB or smaller.");
      return;
    }
    if (!PROOF_TYPES.has(file.type)) {
      setForm((current) => ({ ...current, proof: "", proofName: "" }));
      setError("Choose a JPG, PNG, or PDF payment receipt.");
      return;
    }
    try {
      const proof = await compactProof(file);
      setForm((current) => ({ ...current, proof, proofName: file.name }));
    } catch (proofError) {
      setForm((current) => ({ ...current, proof: "", proofName: "" }));
      setError(proofError.message || "That image could not be prepared.");
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    const name = clean(form.name);
    const email = clean(form.email);
    const phone = clean(form.phone);
    if (!cart.length) return setError("Your cart is empty.");
    if (!name || !email || !phone) return setError("Add your name, email, and phone.");
    if (form.fulfillment === "Shipping" && (!clean(form.address) || !clean(form.city))) {
      return setError("Add your shipping address and city or region.");
    }
    if (!form.proof) return setError("Add your proof of payment.");
    if (!form.acknowledged) return setError("Acknowledge the order terms to continue.");

    setBusy(true);
    setError("");
    try {
      const orderColumns = await ensureCheckoutSchema(schema.orderColumns);
      const itemColumns = schema.itemColumns;
      const requiredOrder = ["order_number", "customer", "status", "sale_total", "order_type"];
      const requiredItems = ["order_id", "inventory_id", "product_name", "quantity", "unit_price", "unit_cost"];
      if (requiredOrder.some((column) => !orderColumns.has(column)) || requiredItems.some((column) => !itemColumns.has(column))) {
        throw new Error("Checkout is not ready yet. Please contact Paddle To Go.");
      }

      const number = `PB-${new Date().getFullYear()}-${Date.now().toString().slice(-7)}`;
      const shippingAddress = form.fulfillment === "Shipping"
        ? `${clean(form.address)}\n${clean(form.city)}`
        : null;
      const values = {
        order_number: number,
        order_date: new Date().toISOString().slice(0, 10),
        customer_name: name,
        customer: name,
        customer_email: email,
        customer_phone: phone,
        shipping_address: shippingAddress,
        channel: "Online storefront",
        status: "Pending",
        payment_requirement: "deposit",
        shipping_income_php: 0,
        discount_php: 0,
        notes: form.fulfillment === "Shipping" ? "Shipping fee to be confirmed by Paddle To Go." : "Customer selected pickup.",
        fulfillment_status: "Not shipped",
        fulfillment_method: form.fulfillment,
        payment_proof_url: form.proof,
        acknowledgment: "Customer acknowledged this order is non-refundable and non-cancellable.",
        sale_total: total,
        product_cost: 0,
        shipping_cost: 0,
        freebie_cost: 0,
        profit: 0,
        order_type: cart.length > 1 ? "Batch" : "Individual",
      };
      const names = Object.keys(values).filter((column) => orderColumns.has(column));
      const placeholders = names.map(() => "?").join(", ");
      const result = await query(
        `INSERT INTO orders (${names.join(", ")}) VALUES (${placeholders})`,
        names.map((column) => values[column]),
      );
      const statements = cart.map((line) => ({
        sql: `INSERT INTO order_items (${["order_id", "inventory_id", itemColumns.has("variant_id") ? "variant_id" : null, "product_name", "quantity", "unit_price", "unit_cost"].filter(Boolean).join(", ")}) VALUES (${Array.from({ length: itemColumns.has("variant_id") ? 7 : 6 }, () => "?").join(", ")})`,
        args: [
          result.lastInsertId,
          line.productId,
          ...(itemColumns.has("variant_id") ? [line.variantId || null] : []),
          `${line.name}${line.color !== "Standard" ? ` · ${line.color}` : ""}`,
          line.quantity,
          line.price,
          0,
        ],
      }));
      await readBatch(statements);
      onSent({ order_number: number, deposit: total / 2 });
    } catch (submitError) {
      setError(submitError.message || "Your order could not be sent. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return <motion.div className="public-flow" initial={reduce ? { opacity: 0 } : { opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={reduce ? { opacity: 0 } : { opacity: 0, x: 18 }} transition={spring}>
      <div className="public-sheet-head"><button type="button" onClick={onBack} aria-label="Back to cart"><ArrowLeft size={20} /></button><div><span className="public-kicker">50% DEPOSIT · {money(total / 2)}</span><h2>Checkout</h2></div></div>
      {error && <p className="public-error" ref={errorRef} tabIndex="-1">{error}</p>}
      <form className="public-checkout-form" onSubmit={submit}>
        <fieldset><legend>Contact</legend><label>Full name<input autoComplete="name" value={form.name} onChange={(event) => set("name", event.target.value)} required /></label><label>Email<input type="email" autoComplete="email" value={form.email} onChange={(event) => set("email", event.target.value)} required /></label><label>Phone<input type="tel" autoComplete="tel" value={form.phone} onChange={(event) => set("phone", event.target.value)} required /></label></fieldset>
        <fieldset><legend>Fulfilment</legend><div className="public-methods"><button type="button" className={form.fulfillment === "Pickup" ? "is-active" : ""} onClick={() => set("fulfillment", "Pickup")}><Package size={18} /><span><b>Pickup</b><small>Arrange after review</small></span></button><button type="button" className={form.fulfillment === "Shipping" ? "is-active" : ""} onClick={() => set("fulfillment", "Shipping")}><Truck size={18} /><span><b>Shipping</b><small>Fee confirmed later</small></span></button></div><AnimatePresence initial={false}>{form.fulfillment === "Shipping" && <motion.div className="public-address" initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }} transition={spring}><label>Street address<textarea autoComplete="street-address" value={form.address} onChange={(event) => set("address", event.target.value)} required /></label><label>City / region<input autoComplete="address-level2" value={form.city} onChange={(event) => set("city", event.target.value)} required /></label></motion.div>}</AnimatePresence></fieldset>
        <fieldset><legend>Payment</legend><div className="public-deposit is-compact"><span>Pay now</span><strong>{money(total / 2)}</strong><p>Scan the selected QR to pay your 50% deposit. The other {money(total / 2)} is due before fulfilment. Shipping is separate and confirmed if selected.</p></div><div className="public-payment-methods" aria-label="Choose a payment QR"><p className="public-payment-label">Choose where you paid</p><div className="public-payment-cards">{PAYMENT_METHODS.map((method) => <button type="button" key={method.id} className={paymentMethod === method.id ? "is-active" : ""} onClick={() => setPaymentMethod(method.id)} aria-pressed={paymentMethod === method.id}><img className="public-payment-card-qr" src={method.image} alt="" /><b>{method.label}</b>{paymentMethod === method.id && <Check size={16} />}</button>)}</div><div className="public-selected-qr"><img src={selectedPayment.image} alt={`${selectedPayment.label} payment QR`} /><p>Scan this QR, complete your deposit, then attach the receipt below.</p></div></div><label className={`public-upload ${form.proof ? "has-file" : ""}`}><ImageSquare size={22} /><span><b>{form.proof ? "Proof added" : "Upload proof of payment"}</b><small>{form.proofName || "JPG, PNG, or PDF, up to 5 MB"}</small></span><input type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; chooseProof(file); }} /></label><p className="public-proof-note">After submitting, keep your receipt ready. If your order workflow provides a configured Messenger contact, use it to send the same proof and confirm your order number.</p></fieldset>
        <label className="public-ack"><input type="checkbox" checked={form.acknowledged} onChange={(event) => set("acknowledged", event.target.checked)} /><span>I understand this order is <b>non-refundable and non-cancellable</b>.</span></label>
        <button type="submit" className="public-primary" disabled={busy}>{busy ? "Placing order…" : `Place order · Pay ${money(total / 2)}`} <ArrowRight size={18} /></button>
      </form>
    </motion.div>;
}

async function compactProof(file) {
  if (file.type === "application/pdf") {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("That PDF could not be read."));
      reader.readAsDataURL(file);
    });
  }
  const source = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("That image could not be read."));
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const item = new Image();
    item.onload = () => resolve(item);
    item.onerror = () => reject(new Error("That image could not be opened."));
    item.src = source;
  });
  const steps = [[900, 0.72], [720, 0.64], [560, 0.58], [420, 0.52]];
  for (const [maxEdge, quality] of steps) {
    const ratio = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL("image/webp", quality);
    if (result.length <= MAX_PROOF_CHARS) return result;
  }
  throw new Error("That image is too large. Try a closer crop or screenshot.");
}

function CatalogSkeleton() {
  return <section className="public-grid public-skeleton" aria-label="Loading paddles">{Array.from({ length: 6 }).map((_, index) => <div key={index}><i /><span /><b /></div>)}</section>;
}

function Success({ order, onClose, reduce }) {
  return (
    <Overlay onClose={onClose} className="public-success" reduce={reduce}>
      <div className="public-success-icon"><Check size={27} /></div>
      <span className="public-kicker">ORDER {order.order_number}</span>
      <h2>Your paddle is requested.</h2>
      <p>We received your order and {money(order.deposit)} proof. Paddle To Go will review it and confirm fulfilment.</p>
      <button type="button" className="public-primary" onClick={onClose}>Continue shopping <ArrowRight size={18} /></button>
    </Overlay>
  );
}

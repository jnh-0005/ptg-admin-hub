import { useEffect, useMemo, useRef, useState } from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CaretRight,
  ChartBar,
  Check,
  ImageSquare,
  List,
  MagnifyingGlass,
  Minus,
  Package,
  Plus,
  ShoppingBag,
  Trash,
  Truck,
  X,
} from "@phosphor-icons/react";

import { spring } from "../lib/motion";
import { DEPOSIT_RATIO } from "../lib/depositRatio";
import { brandOf, PUBLIC_CATALOG_PATH, resolvePhotoAssetUrl } from "../lib/storefront";
import LogoLoop from "../components/LogoLoop";

// A visitor never sees a real stock count (per docs/storefront-api-v1.md, the
// public API returns only "available"/"unavailable") — this just bounds how
// many of one colour a single order line can request.
const MAX_ORDER_QTY = 10;
// A fixed duration+ease, not the app's usual spring, specifically for the
// Accordion's height/opacity/position motion — a spring has no fixed
// settle time and reads as an uneven, slightly wobbly reveal on a coarse
// property like height. This one's a clean, brief, decisive open/close.
const ACCORDION_EASE = { duration: 0.28, ease: [0.4, 0, 0.2, 1] };
const MAX_PROOF_CHARS = 150000;
const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const PROOF_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);
// Public checkout payment choices intentionally stay buyer-facing and reference-style.
const PAYMENT_METHODS = [
  { id: "maribank", label: "MariBank", image: "/images/payment-maribank.jpg" },
  { id: "gcash", label: "GCash", image: "/images/payment-gcash.jpg" },
  { id: "gotyme", label: "GoTyme Bank", image: "/images/payment-gotyme.jpg" },
];
// PTG's real Facebook Page (facebook.com/profile.php?id=61593396870812).
// m.me accepts a numeric Page ID directly, so this opens a real Messenger
// thread with PTG — not a placeholder or guessed handle.
const PTG_MESSENGER_URL = "https://m.me/61593396870812";
const CART_STORAGE_KEY = "ptg-public-cart-v2";
const COMPARE_STORAGE_KEY = "ptg-public-compare-v1";
const MAX_COMPARE = 3;
// Share of the compare table's width given to the row-label column
// ("CORE", "BRAND", …) — the rest is split evenly across the paddle columns.
const LABEL_PCT = 20;

const money = (value) =>
  `₱${Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
// A real batch date (see api/v1/_shared.js's preorder.ready_date/cutoff_date),
// never a computed guess — this only formats it for reading.
const formatEta = (dateStr) => {
  const date = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
};
// "available" means real, counted stock is on hand right now. Zero stock is
// no longer a dead end — every paddle PTG carries is imported in batches, so
// a colour with nothing on hand is a Pre-Order, not Sold Out, and stays fully
// orderable. See createOrder() in api/v1/_shared.js for the matching
// server-side rule: it only caps an order line against real stock when there
// is real stock to exceed.
const available = (choice) => Number(choice?.quantity || 0) > 0;
const clean = (value) => String(value || "").trim();

/**
 * Real manufacturer/retailer-sourced specs, researched per model (JustPaddles,
 * Selkirk.com, RPM Pickleball, Pickleheads, Pickle Times, bnbpickleball.com —
 * see chat history for the full source list). PTG's inventory doesn't record
 * which exact shape (elongated/widebody/hybrid) it stocks per model, so
 * weight is given as the honest range across a model's shape options rather
 * than asserting one. A model with no confidently-matched source is simply
 * left out: no spec section shows rather than a guessed one.
 *
 * Matched by BASE MODEL PREFIX, not the full product name — every colourway
 * PTG stocks is its own separate product ("Sypik Triton 5 Bronze Haze",
 * "Sypik Triton 5 Jade Mist", ...), not a variant of one shared product, so
 * matching on the exact name meant a spec written for the bare model name
 * ("sypik triton 5") never matched any real product and the whole
 * Technology section silently vanished for it — caught live: every Bread
 * and Butter, Kamito Dominus, RPM, and Sypik colourway was missing it, while
 * Kamito Alpha X, Zocker Aspire, and every Selkirk colourway (already
 * prefix-matched, see below) had it. Order matters here only in that no two
 * prefixes are a substring of each other, so first-match-wins is safe.
 */
const PADDLE_SPECS = [
  {
    prefix: "kamito alpha x",
    spec: {
      core: "Triple Foam Core (MPP + EVA foam)",
      surface: "Toray raw carbon fiber",
      weight: "≈225g (7.9 oz), 16mm core",
    },
  },
  {
    prefix: "kamito dominus",
    spec: {
      core: "EPP foam + EVA core",
      surface: "3-layer Japanese Toray carbon fiber",
      weight: "≈225g (7.9 oz), 16mm core",
    },
  },
  {
    prefix: "rpm q2",
    spec: {
      core: "Molded EPP foam, 3mm groove channels",
      surface: "FRICTION CarbonBite carbon fiber",
      weight: "7.5 – 8.0 oz across 14mm/16mm cores",
    },
  },
  {
    prefix: "rpm v2",
    spec: {
      core: "Tri-density honeycomb + EVA foam",
      surface: "CarbonBite carbon fiber",
      weight: "7.6 – 8.1 oz across 14mm/16mm cores",
    },
  },
  {
    prefix: "zocker aspire",
    spec: {
      core: "Hot-pressed honeycomb",
      surface: "T700 carbon fiber (Japan-sourced)",
      weight: "≈225 – 235 g, 16mm core",
    },
  },
  {
    prefix: "sypik triton 5",
    spec: {
      core: "Honeycomb core, 16mm",
      surface: "Raw T700 carbon fiber",
      weight: "≈227g (7.85 oz)",
    },
  },
  {
    prefix: "honolulu j6cr",
    spec: {
      core: "Core Reactor + Dynamic PowerFlex Technology",
      surface: "Control Joint Technology carbon face",
      weight: "8.0 – 8.2 oz, 16mm core",
    },
  },
  {
    prefix: "honolulu j2cr",
    spec: {
      core: "Core Reactor technology (hybrid shape)",
      surface: "Control Joint Technology carbon face",
      weight: "8.0 – 8.3 oz",
    },
  },
  {
    prefix: "bread and butter loco",
    spec: {
      core: "CFC layup (carbon/fiberglass/carbon) + EPP/EVA foam ring",
      surface: "T-700 raw carbon fiber",
      weight: "7.8 – 8.1 oz, depending on shape",
    },
  },
  // Every Selkirk OMNI and Boomstik colourway PTG carries shares the same
  // underlying technology, so it's one entry each rather than one per
  // colourway.
  {
    prefix: "selkirk omni",
    spec: {
      core: "ReactCore — PureFoam + EVA Power Ring, 16mm",
      surface: "Multistrata T700 carbon fiber, InfiniGrit surface",
      weight: "7.9 – 8.2 oz (Elongated or Widebody)",
    },
  },
  {
    prefix: "selkirk boomst",
    spec: {
      core: "BoomCore — PureFoam + EVA Power Ring, 16mm",
      surface: "3-layer T700 carbon fiber, InfiniGrit surface",
      weight: "≈7.9 oz, Elongated shape",
    },
  },
];
function specFor(name) {
  const key = String(name || "").trim().toLowerCase();
  return PADDLE_SPECS.find(({ prefix }) => key.startsWith(prefix))?.spec || null;
}

/**
 * Public-safe catalog read, via the dedicated storefront API (api/v1/catalog.js)
 * rather than the admin's authenticated /api/query — this route has no login
 * wall, so it must never touch the transport that requires one. The API
 * itself already strips costs, batches, and real stock counts; this just
 * reshapes its response into what the storefront UI expects. This is the
 * live sync point with the admin hub: the same inventory rows, prices, and
 * availability the admin sees drive this response, and nothing here caches
 * or forks that data — every load (and the 30s background refresh) re-reads it.
 */
export async function loadCatalog() {
  const res = await fetch("/api/v1/catalog");
  if (!res.ok) throw new Error("catalog unavailable");
  const data = await res.json();
  const products = (data.products || []).map((product) => {
    const brand = brandOf(product.name);
    const baseChoice = {
      id: null,
      color: "Standard",
      sku: product.sku,
      quantity: product.availability === "available" ? MAX_ORDER_QTY : 0,
      price: product.price_php,
      photo: resolvePhotoAssetUrl(product.photo_url),
      preorder: product.preorder || null,
      inTransit: product.in_transit || null,
    };
    const choices = (product.variants || []).length
      ? product.variants.map((variant) => ({
          id: variant.id,
          color: clean(variant.color) || "Standard",
          sku: variant.sku || product.sku,
          quantity: variant.availability === "available" ? MAX_ORDER_QTY : 0,
          price: variant.price_php,
          photo: resolvePhotoAssetUrl(variant.photo_url),
          preorder: variant.preorder || null,
          inTransit: variant.in_transit || null,
        }))
      : [baseChoice];
    return {
      id: product.id,
      name: product.name,
      brand,
      category: product.category || null,
      sku: product.sku || null,
      choices,
    };
  });
  return { products };
}

function readStoredCart() {
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readStoredCompare() {
  try {
    const raw = window.localStorage.getItem(COMPARE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => Number.isInteger(x)) : [];
  } catch {
    return [];
  }
}

/**
 * Fades + slides an element up into place the first time it scrolls into
 * view, then leaves it alone — the storefront's only scroll choreography.
 * `once: true` means every section settles permanently after its first
 * reveal, so scrolling back up never re-triggers or flickers content.
 */
function Reveal({ as: Tag = "div", delay = 0, className, children, ...rest }) {
  const reduce = useReducedMotion();
  const Component = motion[Tag] || motion.div;
  if (reduce) {
    const Plain = Tag;
    return (
      <Plain className={className} {...rest}>
        {children}
      </Plain>
    );
  }
  return (
    <Component
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.7, delay, ease: [0.25, 1, 0.5, 1] }}
      {...rest}
    >
      {children}
    </Component>
  );
}

// Real logo marks, background-removed from the brand's own supplied artwork.
// A brand with no file here (e.g. one newly added to inventory) falls back
// to its plain name in the marquee rather than a fabricated or guessed mark.
//
// Every file here is a fixed 120px tall (its own natural export height) with
// a brand-specific width — `width` below is each file's real pixel width,
// paired with that shared 120 as an intrinsic-size hint for LogoLoop's
// <img> (CSS still governs the actual displayed size; this doesn't change
// anything visual, it just satisfies Lighthouse's unsized-images audit).
const BRAND_LOGOS = {
  "Bread and Butter": { src: "/images/brands/bread-and-butter.webp", width: 384 },
  Sypik: { src: "/images/brands/sypik.webp", width: 419 },
  RPM: { src: "/images/brands/rpm.webp", width: 582 },
  Selkirk: { src: "/images/brands/selkirk.webp", width: 265 },
  Wika: { src: "/images/brands/wika.webp", width: 103 },
  Kamito: { src: "/images/brands/kamito.webp", width: 128 },
  Honolulu: { src: "/images/brands/honolulu.webp", width: 120 },
  Zocker: { src: "/images/brands/zocker.webp", width: 346 },
};
const BRAND_LOGO_HEIGHT = 120;

/**
 * Brand row shown via the reusable LogoLoop component (src/components/LogoLoop.jsx).
 * Real brand names pulled from the live catalog (never a hardcoded or
 * fabricated list) — a brand with no real artwork on file (BRAND_LOGOS)
 * falls back to its plain name rather than a fabricated or guessed mark.
 */
function brandLogos(names) {
  return names.map((name) => {
    const logo = BRAND_LOGOS[name];
    return {
      src: logo?.src,
      width: logo?.width,
      height: logo ? BRAND_LOGO_HEIGHT : undefined,
      title: name,
      alt: name,
    };
  });
}

function ProductImage({ product, choice, className = "" }) {
  const [failed, setFailed] = useState(false);
  const src = resolvePhotoAssetUrl(choice?.photo);
  useEffect(() => setFailed(false), [src]);
  const image = src && !failed ? (
    <img src={src} alt={`${product.name}${choice?.color && choice.color !== "Standard" ? ` in ${choice.color}` : ""}`} onError={() => setFailed(true)} />
  ) : (
    <div className="public-placeholder" aria-label="Photo coming soon">
      <img src="/images/ptg-logo-header.webp" alt="" width="108" height="150" />
      <span>Photo coming soon</span>
    </div>
  );
  return <div className={className}>{image}</div>;
}

/**
 * One product tile, shared by the shop grid and the product page's "You may
 * also like" row so both render identically — no duplicated card markup.
 * `addToCart`/`toggleCompare` are optional: omit them (as the related-products
 * row does) to get a plain browsable card with no quick-add or compare toggle.
 * `motionProps` lets a caller opt into the shop grid's scroll-reveal without
 * baking that animation into every use of the card.
 */
function ProductCard({ product, addToCart, compareIds, toggleCompare, justAdded, onAdded, motionProps }) {
  const inStock = product.choices.some(available);
  // In transit outranks plain pre-order for the card badge — it's real stock
  // already on the way, not a speculative restock promise.
  const inTransit = !inStock && product.choices.some((c) => c.inTransit);
  // A colour can have several in-transit batches; show whichever real ETA is
  // on file. Plain pre-order has no ETA of its own (see the PDP note) — the
  // open-until date is what's worth surfacing there instead.
  const shipsIn = inTransit ? product.choices.find((c) => c.inTransit?.ships_in)?.inTransit?.ships_in : null;
  const openUntil = !inStock && !inTransit ? product.choices.find((c) => c.preorder?.cutoff_date)?.preorder?.cutoff_date : null;
  const fromPrice = Math.min(...product.choices.map((choice) => choice.price));
  const singleChoice = product.choices.length === 1 ? product.choices[0] : null;
  const justAddedThis = justAdded === product.id;
  const comparing = compareIds?.includes(product.id);

  return (
    <motion.article className="public-card" {...motionProps}>
      <div className="public-card-media">
        <Link to={`/paddle/${product.id}`} aria-label={`View ${product.name}`}>
          <ProductImage product={product} choice={product.choices[0]} className="public-card-image" />
          {!inStock && (
            <span className={`public-card-badge ${inTransit ? "is-intransit" : "is-preorder"}`}>
              {inTransit ? "In transit" : "Pre-order"}
            </span>
          )}
        </Link>
        {toggleCompare && (
          <button
            type="button"
            className={`public-card-compare ${comparing ? "is-active" : ""}`}
            disabled={!comparing && compareIds.length >= MAX_COMPARE}
            onClick={() => toggleCompare(product.id)}
            aria-pressed={comparing}
          >
            {comparing ? <Check size={11} /> : <ChartBar size={11} />} Compare
          </button>
        )}
      </div>
      <div className="public-card-body">
        <Link to={`/paddle/${product.id}`}>
          <div className="public-card-name"><span>{product.brand}</span><h2>{product.name}</h2></div>
        </Link>
        {shipsIn && <p className="public-card-shipsin">{shipsIn}</p>}
        {openUntil && formatEta(openUntil) && <p className="public-card-shipsin">Order by {formatEta(openUntil)}</p>}
        <div className="public-card-meta">
          <strong>{money(fromPrice)}</strong>
          {addToCart && (singleChoice ? (
            <button
              type="button"
              className={`public-quick-add ${justAddedThis ? "is-added" : ""}`}
              aria-label={
                available(singleChoice)
                  ? `Add ${product.name} to cart`
                  : singleChoice?.inTransit
                    ? `Reserve ${product.name}`
                    : `Pre-order ${product.name}`
              }
              onClick={() => {
                addToCart(product, singleChoice, 1);
                onAdded?.(product.id);
              }}
            >
              {justAddedThis ? <Check size={15} /> : <Plus size={15} />}
            </button>
          ) : (
            <Link to={`/paddle/${product.id}`} className="public-quick-add" aria-label={`Choose a colour for ${product.name}`}>
              <Plus size={15} />
            </Link>
          ))}
        </div>
      </div>
    </motion.article>
  );
}

/**
 * A horizontally scrollable row (snap + native touch/trackpad scroll), with
 * arrow buttons for a mouse — used for the first few paddles ahead of the
 * featured band, so the opening of the shop reads as a curated strip
 * instead of another static grid row. Just a scroll container; it doesn't
 * own what's inside it.
 */
function ScrollRow({ children, ariaLabel }) {
  const trackRef = useRef(null);
  const scrollBy = (dir) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: dir * Math.min(track.clientWidth * 0.8, 560), behavior: "smooth" });
  };
  return (
    <div className="public-scroll-row-wrap">
      <button type="button" className="public-scroll-arrow is-prev" aria-label="Scroll left" onClick={() => scrollBy(-1)}>
        <ArrowLeft size={16} />
      </button>
      <div className="public-scroll-row" role="list" aria-label={ariaLabel} ref={trackRef}>
        {children}
      </div>
      <button type="button" className="public-scroll-arrow is-next" aria-label="Scroll right" onClick={() => scrollBy(1)}>
        <ArrowRight size={16} />
      </button>
    </div>
  );
}

export default function PublicCatalog() {
  const reduce = useReducedMotion();
  const [products, setProducts] = useState([]);
  const [status, setStatus] = useState("loading");
  const [reconnecting, setReconnecting] = useState(false);
  const [cart, setCart] = useState(() => readStoredCart());
  const [compareIds, setCompareIds] = useState(() => readStoredCompare());
  const hasCatalog = useRef(false);

  const refresh = async (background = false) => {
    if (background) setReconnecting(false);
    try {
      const result = await loadCatalog();
      setProducts(result.products);
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

  useEffect(() => {
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    } catch {
      /* a full or blocked storage jar just means the cart won't survive a reload */
    }
  }, [cart]);

  useEffect(() => {
    try {
      window.localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(compareIds));
    } catch {
      /* same as the cart: a blocked storage jar just means it won't survive a reload */
    }
  }, [compareIds]);

  const cartCount = cart.reduce((total, line) => total + line.quantity, 0);
  const cartTotal = cart.reduce((total, line) => total + line.price * line.quantity, 0);

  /** Adds or drops one product from the compare tray, capped at MAX_COMPARE. */
  const toggleCompare = (productId) => {
    setCompareIds((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : current.length >= MAX_COMPARE
          ? current
          : [...current, productId],
    );
  };
  const clearCompare = () => setCompareIds([]);

  /**
   * Adds `quantity` of one product+colour to the cart, merging with any
   * existing line. A colour with nothing on hand is a pre-order, not a dead
   * end, so this no longer refuses to add it — only a missing product/colour
   * itself is refused.
   */
  const addToCart = (product, choice, quantity = 1) => {
    if (!product || !choice) return;
    const key = `${product.id}:${choice.id || "base"}`;
    setCart((current) => {
      const existing = current.find((line) => line.key === key);
      const max = MAX_ORDER_QTY;
      if (existing) {
        return current.map((line) =>
          line.key === key
            ? { ...line, quantity: Math.min(max, line.quantity + quantity) }
            : line,
        );
      }
      return [
        ...current,
        {
          key,
          productId: product.id,
          variantId: choice.id,
          name: product.name,
          color: choice.color,
          sku: choice.sku,
          price: choice.price,
          photo: choice.photo,
          max,
          quantity: Math.min(max, quantity),
          // Snapshotted at add-to-cart time, same as price/photo above — not
          // re-checked live while the line sits in the cart. The server
          // re-checks in-transit eligibility for real at order creation
          // (buildOrder in api/v1/_shared.js) rather than trusting this.
          isPreorder: !available(choice),
          preorder: choice.preorder || null,
          isInTransit: !available(choice) && !!choice.inTransit,
          inTransit: choice.inTransit || null,
        },
      ];
    });
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
  const removeLine = (key) => setCart((current) => current.filter((line) => line.key !== key));

  // Adding a paddle opens the cart drawer for a moment of confirmation
  // instead of silently updating a badge — the drawer just reads the same
  // `cart` state above, so nothing about what addToCart stores changes.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const addToCartAndOpen = (product, choice, quantity = 1) => {
    addToCart(product, choice, quantity);
    setDrawerOpen(true);
  };

  return (
    <BrowserRouter basename={PUBLIC_CATALOG_PATH}>
      <div className="public-shell">
        <Routes>
          <Route
            element={
              <Layout
                cartCount={cartCount}
                compareCount={compareIds.length}
                cart={cart}
                cartTotal={cartTotal}
                drawerOpen={drawerOpen}
                onCloseDrawer={() => setDrawerOpen(false)}
                onQuantity={updateQuantity}
                onRemove={removeLine}
                reduce={reduce}
              />
            }
          >
            <Route index element={<Shop addToCart={addToCartAndOpen} compareIds={compareIds} toggleCompare={toggleCompare} />} />
            <Route
              path="paddle/:id"
              element={<ProductPage addToCart={addToCartAndOpen} compareIds={compareIds} toggleCompare={toggleCompare} />}
            />
            <Route
              path="compare"
              element={<ComparePage compareIds={compareIds} toggleCompare={toggleCompare} clearCompare={clearCompare} />}
            />
            <Route
              path="cart"
              element={<CartPage cart={cart} total={cartTotal} onQuantity={updateQuantity} onRemove={removeLine} reduce={reduce} />}
            />
            <Route
              path="checkout"
              element={<CheckoutPage cart={cart} total={cartTotal} onSent={() => setCart([])} reduce={reduce} />}
            />
            <Route path="order/:orderNumber" element={<OrderConfirmation />} />
            <Route path="faq" element={<FaqPage />} />
            <Route path="*" element={<Navigate to="" replace />} />
          </Route>
        </Routes>
      </div>
    </BrowserRouter>
  );
}

/** Appears once the visitor has scrolled a screen's worth down; scrolls smoothly back to the top. */
function BackToTop() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 640);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          className="public-to-top"
          aria-label="Back to top"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          transition={spring}
        >
          <ArrowUp size={18} />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

/**
 * Right-side slide-over shown after adding a paddle, or from the cart icon —
 * reads the same `cart`/`total` state the full /cart page reads, and calls
 * the same `onQuantity`/`onRemove` handlers; it never owns cart data itself.
 * "View cart" still routes to the full page, which stays exactly as it was
 * for anyone who links or reloads directly into it.
 */
function CartDrawer({ open, onClose, cart, total, onQuantity, onRemove, reduce }) {
  useEffect(() => {
    if (!open) return;
    document.documentElement.classList.add("public-lock");
    return () => document.documentElement.classList.remove("public-lock");
  }, [open]);

  const justAdded = cart.length ? cart[cart.length - 1] : null;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="public-drawer-overlay"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
          <motion.aside
            className="public-drawer"
            role="dialog"
            aria-label="Cart"
            initial={reduce ? { opacity: 0 } : { x: "100%" }}
            animate={reduce ? { opacity: 1 } : { x: 0 }}
            exit={reduce ? { opacity: 0 } : { x: "100%" }}
            transition={spring}
          >
            <div className="public-drawer-head">
              <h2>Cart</h2>
              <button type="button" className="public-drawer-close" onClick={onClose} aria-label="Close cart">
                <X size={18} />
              </button>
            </div>

            {justAdded && (
              <div className="public-drawer-confirm">
                <div className="public-cart-thumb">
                  {justAdded.photo ? <img src={justAdded.photo} alt="" /> : <ImageSquare size={18} />}
                </div>
                <span>Added {justAdded.name} to your cart</span>
              </div>
            )}

            {cart.length === 0 ? (
              <div className="public-drawer-empty">
                <ShoppingBag size={26} />
                <p>Your cart is empty.</p>
                <button type="button" className="public-state-link" onClick={onClose}>Continue shopping</button>
              </div>
            ) : (
              <ul className="public-drawer-lines">
                {cart.map((line) => (
                  <li className="public-cart-line" key={line.key}>
                    <div className="public-cart-thumb">{line.photo ? <img src={line.photo} alt="" /> : <ImageSquare size={18} />}</div>
                    <div className="public-cart-copy">
                      <b>{line.name}</b>
                      <small>{line.color}</small>
                      <strong>{money(line.price * line.quantity)}</strong>
                    </div>
                    <div className="public-cart-line-actions">
                      <div className="public-stepper">
                        <button type="button" onClick={() => onQuantity(line.key, -1)} aria-label={`Remove one ${line.name}`}><Minus size={13} /></button>
                        <span>{line.quantity}</span>
                        <button type="button" onClick={() => onQuantity(line.key, 1)} aria-label={`Add one ${line.name}`}><Plus size={13} /></button>
                      </div>
                      <button type="button" className="public-remove" onClick={() => onRemove(line.key)} aria-label={`Remove ${line.name} from cart`}>
                        <Trash size={15} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {cart.length > 0 && (
              <div className="public-drawer-foot">
                <div className="public-total"><span>Subtotal</span><strong>{money(total)}</strong></div>
                <Link to="checkout" className="public-primary" onClick={onClose}>Checkout <ArrowRight size={16} /></Link>
                <Link to="cart" className="public-secondary-link" onClick={onClose}>View cart</Link>
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/** Full-screen mobile drawer nav: real destinations only (Shop, its brands, Cart) — no stub links. */
function MobileNav({ open, onClose, brands, cartCount }) {
  useEffect(() => {
    if (!open) return;
    document.documentElement.classList.add("public-lock");
    return () => document.documentElement.classList.remove("public-lock");
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="public-mobile-drawer-overlay"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
          <motion.div
            className="public-mobile-drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={spring}
          >
            <div className="public-mobile-drawer-head">
              <img src="/images/ptg-logo-header.webp" alt="Paddle To Go" className="public-logo" width="108" height="150" />
              <button type="button" className="public-drawer-close" onClick={onClose} aria-label="Close menu, mobile nav">
                <X size={18} />
              </button>
            </div>
            <nav className="public-mobile-drawer-body" aria-label="Storefront">
              <Link to="" onClick={onClose}>Shop all paddles</Link>
              <Link to="faq" onClick={onClose}>FAQs</Link>
              {brands.length > 0 && (
                <>
                  <span className="public-mobile-drawer-section">Brands</span>
                  {brands.map((name) => (
                    <Link className="public-mobile-brand" key={name} to={`/?brand=${encodeURIComponent(name)}`} onClick={onClose}>
                      {name}
                    </Link>
                  ))}
                </>
              )}
              <Link to="cart" onClick={onClose}>Cart{cartCount > 0 ? ` (${cartCount})` : ""}</Link>
            </nav>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/** Header + footer chrome shared by every storefront route; the routed page fills the middle. */
function Layout({
  cartCount,
  compareCount = 0,
  cart,
  cartTotal,
  drawerOpen,
  onCloseDrawer,
  onQuantity,
  onRemove,
  reduce,
}) {
  const location = useLocation();
  const { products } = useShopData();
  const brands = useMemo(
    () => Array.from(new Set(products.map((product) => product.brand))).filter(Boolean).sort(),
    [products],
  );

  // No point telling someone "N paddles selected, go compare" while they're
  // already on the compare page — or mid-checkout, where it's just noise
  // competing with "Continue to checkout"/"Place order" for the same fixed
  // bottom-of-screen spot. Shown only on the shop grid and product pages,
  // where comparing is actually the next thing someone might do.
  const hideCompareBar = /\/(compare|cart|checkout|order)(\/|$)/.test(location.pathname);

  // React Router doesn't reset scroll position on navigation the way a real
  // page load does. Without this, following a link from partway down a tall
  // page (e.g. "View cart" from the bottom of a product page) lands on the
  // new page at that same scroll offset — which on a short page like Cart
  // can put the visitor at the order summary instead of the top of it.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // The nav is solid on every route from the start — only its height and
  // shadow change on scroll, nothing about color or contrast, so there's
  // nothing to desync between breakpoints or flicker mid-transition.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const navigate = useNavigate();
  const submitSearch = (event) => {
    event.preventDefault();
    const term = searchTerm.trim();
    navigate(term ? `/?q=${encodeURIComponent(term)}` : "/");
    setSearchOpen(false);
  };

  return (
    <>
      <header className={`public-nav ${scrolled ? "is-scrolled" : ""}`}>
        <Link to="" className="public-nav-brand" aria-label="Paddle To Go storefront">
          <img src="/images/ptg-logo-inverse.webp" alt="Paddle To Go" className="public-nav-logo" width="108" height="150" />
        </Link>

        <nav className="public-nav-links" aria-label="Storefront">
          <div>
            <Link to="" className="public-nav-shop-link">Shop <CaretRight size={10} weight="bold" style={{ transform: "rotate(90deg)" }} /></Link>
            <div className="public-nav-dropdown">
              <Link to="" className="public-nav-dropdown-all">All paddles</Link>
              {brands.map((name) => (
                <Link key={name} to={`/?brand=${encodeURIComponent(name)}`}>{name}</Link>
              ))}
            </div>
          </div>
          <Link to="faq" className="public-nav-shop-link">FAQs</Link>
        </nav>

        <div className="public-nav-spacer" />

        <div className="public-nav-actions">
          <form className="public-nav-search" onSubmit={submitSearch}>
            <div className={`public-nav-search-field ${searchOpen ? "is-open" : ""}`}>
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search model or brand"
                aria-label="Search model or brand"
                tabIndex={searchOpen ? 0 : -1}
              />
            </div>
            <button
              type="button"
              className="public-nav-icon-btn"
              aria-label="Search"
              onClick={() => setSearchOpen((open) => !open)}
            >
              <MagnifyingGlass size={18} />
            </button>
          </form>

          <Link to="cart" className="public-nav-cart" aria-label={`Cart, ${cartCount} item${cartCount === 1 ? "" : "s"}`}>
            <ShoppingBag size={18} />
            {cartCount > 0 && <b>{cartCount}</b>}
          </Link>

          <button
            type="button"
            className="public-nav-mobile-toggle"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
          >
            <List size={20} />
          </button>
        </div>
      </header>

      <Outlet context={{}} />

      <AnimatePresence>
        {compareCount > 0 && !hideCompareBar && (
          // The anchor (fixed + translateX(-50%)) does the horizontal
          // centering and is never animated; framer-motion's own inline
          // transform lives only on the child it slides up, so the two
          // transforms never fight over the same element.
          <div className="public-compare-bar-anchor">
            <motion.div
              className="public-compare-bar"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={spring}
            >
              <span>{compareCount} paddle{compareCount === 1 ? "" : "s"} selected</span>
              <Link to="compare" className="public-compare-bar-link">
                Compare <ArrowRight size={14} />
              </Link>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <footer className="public-footer">
        <div className="public-footer-brand">
          <img src="/images/ptg-logo-header.webp" alt="Paddle To Go" width="108" height="150" />
          <p>Your paddles, reserved direct from the source.</p>
        </div>
        <div className="public-footer-col">
          <h3>Shop</h3>
          <Link to="">All paddles</Link>
          <Link to="cart">Cart</Link>
        </div>
        <div className="public-footer-note">
          <span>Live price and availability. No stock counts shown.</span>
        </div>
      </footer>

      <BackToTop />

      <MobileNav open={mobileOpen} onClose={() => setMobileOpen(false)} brands={brands} cartCount={cartCount} />
      <CartDrawer
        open={drawerOpen}
        onClose={onCloseDrawer}
        cart={cart}
        total={cartTotal}
        onQuantity={onQuantity}
        onRemove={onRemove}
        reduce={reduce}
      />
    </>
  );
}

/**
 * True once the viewport is at least `minWidth` — used both for the mobile
 * (2-up grid, <640px) pagination gate and the desktop (4-up grid, ≥960px)
 * opening-row size, each keyed to the same breakpoint the grid's own
 * column count already switches on, so they stay in sync with it.
 */
function useMinWidth(minWidth) {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= minWidth,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${minWidth}px)`);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [minWidth]);
  return matches;
}

function useShopData() {
  const [products, setProducts] = useState([]);
  const [status, setStatus] = useState("loading");
  const [reconnecting, setReconnecting] = useState(false);
  const hasCatalog = useRef(false);

  const refresh = async (background = false) => {
    if (background) setReconnecting(false);
    try {
      const result = await loadCatalog();
      setProducts(result.products);
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

  return { products, status, reconnecting, refresh };
}

function Shop({ addToCart, compareIds, toggleCompare }) {
  const { products, status, reconnecting, refresh } = useShopData();
  const [justAdded, setJustAdded] = useState(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [brand, setBrand] = useState("All brands");
  const [sort, setSort] = useState("featured");
  // Everything currently fits in one screenful-and-a-bit at ~24 products,
  // but "show N, reveal more on demand" is cheap insurance against a grid
  // that gets unwieldy as the catalog grows, and it never blocks anyone —
  // it only ever grows, never re-collapses.
  const PAGE_SIZE = 8;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // Pagination only kicks in below the desktop (4-up) grid — desktop has
  // the horizontal room to just show everything, so "Load More" would be
  // solving a problem that doesn't exist there yet. The opening row also
  // widens from 3 to 4 paddles at that same point.
  const isMobile = !useMinWidth(640);
  const isDesktopGrid = useMinWidth(960);
  // 5 on desktop, not 4 — at 4, all of them already fit in the visible
  // scroll-row width with nothing left offscreen, so the arrow buttons
  // render but have nothing to actually scroll to. 5 guarantees overflow.
  const openingCount = isDesktopGrid ? 5 : 3;

  // The nav's Shop dropdown and mobile menu link here as `/?brand=Selkirk`,
  // and the nav search submits as `/?q=omni` — both just seed this page's own
  // filter state once, they don't drive a separate URL-based filtering system.
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const qBrand = searchParams.get("brand");
    const qSearch = searchParams.get("q");
    if (qBrand) setBrand(qBrand);
    if (qSearch) setSearch(qSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(products.map((product) => product.category).filter(Boolean))).sort()],
    [products],
  );
  const brands = useMemo(
    () => ["All brands", ...Array.from(new Set(products.map((product) => product.brand))).sort()],
    [products],
  );
  // Guarded on `products.length` so a `?brand=`/`?q=` from the nav survives
  // the moment before the catalog has loaded — without it, `brands` starts
  // as just ["All brands"], the query-provided brand doesn't match it yet,
  // and this would silently reset the filter before the real list arrives.
  useEffect(() => {
    if (products.length && !categories.includes(category)) setCategory("All");
  }, [category, categories, products.length]);
  useEffect(() => {
    if (products.length && !brands.includes(brand)) setBrand("All brands");
  }, [brand, brands, products.length]);
  // A new filter/sort is a new result set — always reveal it from the top,
  // never leave someone on page 3 of a search that now returns two items.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search, category, brand, sort]);

  const filtered = products
    .filter((product) => {
      const needle = search.trim().toLowerCase();
      return (
        (category === "All" || product.category === category) &&
        (brand === "All brands" || product.brand === brand) &&
        (!needle || `${product.brand} ${product.name}`.toLowerCase().includes(needle))
      );
    })
    .slice()
    .sort((a, b) => {
      const priceOf = (product) => Math.min(...product.choices.map((choice) => choice.price));
      if (sort === "price-asc") return priceOf(a) - priceOf(b);
      if (sort === "price-desc") return priceOf(b) - priceOf(a);
      return 0;
    });

  // The featured-product band only appears on the true default view — the
  // moment someone actually filters or searches, the plain grid takes over
  // so the band never sits in front of (or contradicts) real results.
  // `filtered[0]` in "Featured" order is real catalog order, never an
  // invented "most important" pick.
  const isDefaultView = sort === "featured" && category === "All" && brand === "All brands" && !search.trim();
  const showFeatured = isDefaultView && filtered.length >= 4;
  const featuredProduct = showFeatured ? filtered[0] : null;
  const gridProducts = showFeatured ? filtered.slice(1) : filtered;
  // Paginated on mobile only: only the current page's worth of gridProducts
  // is ever split into first/second slice, so "Load More" is really just
  // growing this window — the featured band itself is unaffected either
  // way. Desktop always gets the full list, no pagination at all.
  let visibleGridProducts = isMobile ? gridProducts.slice(0, visibleCount) : gridProducts;
  const cappedByPaging = visibleGridProducts.length < gridProducts.length;
  // Never end the visible run on a lone odd card right above "Load More" —
  // the 2-up mobile grid should always close on a full pair there. Only
  // trims when there's actually more to reveal; the true end of a filtered
  // result list still gets to show its real (possibly odd) final count,
  // centered, same as before.
  if (isMobile && cappedByPaging) {
    const afterOpeningRow = showFeatured ? visibleGridProducts.length - openingCount : visibleGridProducts.length;
    if (afterOpeningRow % 2 !== 0) visibleGridProducts = visibleGridProducts.slice(0, -1);
  }
  const firstSlice = showFeatured ? visibleGridProducts.slice(0, openingCount) : visibleGridProducts;
  const secondSlice = showFeatured ? visibleGridProducts.slice(openingCount) : [];
  const hasMore = isMobile && visibleGridProducts.length < gridProducts.length;

  return (
    <>
      <section className="public-hero">
        {/* Desktop gets the newer banner photo; mobile keeps the original —
            a <picture>/<source> swap, not a JS breakpoint check, so there's
            no flash of the wrong image and no extra render logic. 960px
            matches every other desktop-only treatment already in this file. */}
        <picture>
          <source media="(min-width: 960px)" srcSet="/images/ptg-hero-desktop.webp" />
          <img className="public-hero-bg" src="/images/ptg-court-banner-v2.webp" alt="Paddle To Go — Cagayan de Oro, Philippines" width="2658" height="984" />
        </picture>
        <div className="public-hero-scrim" />
        <Reveal as="div" className="public-hero-text">
          <h1>Reserve your next paddle.</h1>
          <p>From everyday favorites to limited-edition releases, find your next paddle at Paddle To Go.</p>
          <a
            href="#shop"
            className="public-hero-cta"
            onClick={(event) => {
              event.preventDefault();
              document.getElementById("shop")?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            Shop paddles <ArrowRight size={16} />
          </a>
        </Reveal>
      </section>

      <section className="public-feature">
        <LogoLoop
          logos={brandLogos(brands.filter((item) => item !== "All brands"))}
          speed={36}
          logoHeight={32}
          gap={56}
          fadeOut
          ariaLabel="Brands available"
        />
      </section>

      <main className="public-main" id="shop">
      <Reveal as="section" className="public-page-head public-page-head-compact">
        <h2>Find your paddle</h2>
        <span className={`public-live ${reconnecting ? "is-offline" : ""}`}>
          <i /> {reconnecting ? "Reconnecting" : "Live price and availability"}
        </span>
      </Reveal>

      {categories.length > 2 && (
        <section className="public-category-row" aria-label="Filter by category">
          {categories.map((item) => (
            <button type="button" key={item} className={category === item ? "is-active" : ""} onClick={() => setCategory(item)}>
              {item}
            </button>
          ))}
        </section>
      )}

      <section className="public-filter-bar">
        <label className="public-search">
          <MagnifyingGlass size={17} />
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
            <button type="button" key={item} className={brand === item ? "is-active" : ""} onClick={() => setBrand(item)}>
              {item}
            </button>
          ))}
        </div>
        <label className="public-sort">
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="featured">Featured</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
          </select>
        </label>
      </section>

      {status === "loading" && <CatalogSkeleton />}
      {status === "error" && (
        <section className="public-state">
          <Package size={28} />
          <h2>The shop did not load</h2>
          <p>Please check your connection and try again.</p>
          <button type="button" onClick={() => refresh()}>Try again</button>
        </section>
      )}
      {status === "ready" && filtered.length > 0 && (
        <>
          {showFeatured ? (
            // Only the true default view opens with a scrollable strip —
            // the moment a real filter/search is active this same slice
            // renders as a plain grid below, so scrolling never becomes
            // the only way to see actual search results.
            <ScrollRow ariaLabel="Featured paddles">
              {firstSlice.map((product) => (
                <div className="public-scroll-item" role="listitem" key={product.id}>
                  <ProductCard
                    product={product}
                    addToCart={addToCart}
                    compareIds={compareIds}
                    toggleCompare={toggleCompare}
                    justAdded={justAdded}
                    onAdded={(id) => {
                      setJustAdded(id);
                      window.setTimeout(() => setJustAdded((current) => (current === id ? null : current)), 1600);
                    }}
                  />
                </div>
              ))}
            </ScrollRow>
          ) : (
            <motion.section className="public-grid" layout>
              {firstSlice.map((product, index) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  addToCart={addToCart}
                  compareIds={compareIds}
                  toggleCompare={toggleCompare}
                  justAdded={justAdded}
                  onAdded={(id) => {
                    setJustAdded(id);
                    window.setTimeout(() => setJustAdded((current) => (current === id ? null : current)), 1600);
                  }}
                  motionProps={{
                    layout: true,
                    initial: { opacity: 0, y: 14 },
                    whileInView: { opacity: 1, y: 0 },
                    viewport: { once: true, margin: "-40px" },
                    transition: { duration: 0.45, delay: (index % 4) * 0.05, ease: [0.25, 1, 0.5, 1] },
                  }}
                />
              ))}
            </motion.section>
          )}

          {featuredProduct && (
            <Reveal as="section" className="public-featured-band">
              <div className="public-featured-media">
                <ProductImage product={featuredProduct} choice={featuredProduct.choices[0]} />
              </div>
              <div className="public-featured-copy">
                <span className="public-featured-brand">{featuredProduct.brand}</span>
                <h2>{featuredProduct.name}</h2>
                <strong>{money(Math.min(...featuredProduct.choices.map((c) => c.price)))}</strong>
                <Link to={`/paddle/${featuredProduct.id}`} className="public-featured-cta">
                  Shop this paddle <ArrowRight size={15} />
                </Link>
              </div>
            </Reveal>
          )}

          {secondSlice.length > 0 && (
            <motion.section className="public-grid" layout>
              {secondSlice.map((product, index) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  addToCart={addToCart}
                  compareIds={compareIds}
                  toggleCompare={toggleCompare}
                  justAdded={justAdded}
                  onAdded={(id) => {
                    setJustAdded(id);
                    window.setTimeout(() => setJustAdded((current) => (current === id ? null : current)), 1600);
                  }}
                  motionProps={{
                    layout: true,
                    initial: { opacity: 0, y: 14 },
                    whileInView: { opacity: 1, y: 0 },
                    viewport: { once: true, margin: "-40px" },
                    transition: { duration: 0.45, delay: (index % 4) * 0.05, ease: [0.25, 1, 0.5, 1] },
                  }}
                />
              ))}
            </motion.section>
          )}

          {hasMore && (
            <button type="button" className="public-load-more" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
              Load more <CaretRight size={12} weight="bold" style={{ transform: "rotate(90deg)" }} />
            </button>
          )}
        </>
      )}
      {status === "ready" && filtered.length === 0 && (
        <section className="public-state">
          <MagnifyingGlass size={28} />
          <h2>No matching paddles</h2>
          <p>Try another model or clear your filters.</p>
          <button type="button" onClick={() => { setSearch(""); setBrand("All brands"); setCategory("All"); }}>Show all paddles</button>
        </section>
      )}

      {status === "ready" && filtered.length > 0 && (
        <Reveal as="section" className="public-editorial-band">
          <div className="public-editorial-media">
            <img src="/images/ptg-court-banner-v2.webp" alt="" width="2658" height="984" />
          </div>
          <div className="public-editorial-copy">
            <h2>Trusted brands, brought closer to you.</h2>
            <p>
              Paddle To Go sources authentic pickleball paddles and gear from trusted brands,
              bringing new models, colorways, and limited releases to players in the Philippines.
            </p>
          </div>
        </Reveal>
      )}
      </main>
    </>
  );
}

/** A real, linkable page per paddle: breadcrumb, hero image, colour picker, honest specifics. */
function ProductPage({ addToCart, compareIds = [], toggleCompare }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { products, status } = useShopData();
  const product = products.find((item) => String(item.id) === id);
  const [choice, setChoice] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (!product) return;
    setChoice(product.choices.find(available) || product.choices[0]);
    setQuantity(1);
  }, [product?.id]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);

  useEffect(() => {
    if (!added) return;
    const timer = window.setTimeout(() => setAdded(false), 2200);
    return () => window.clearTimeout(timer);
  }, [added]);

  if (status === "loading") {
    return (
      <main className="public-main">
        <section className="public-state">
          <Package size={28} />
          <p>Loading…</p>
        </section>
      </main>
    );
  }

  if (!product) {
    return (
      <main className="public-main">
        <section className="public-state">
          <Package size={28} />
          <h2>That paddle isn't here anymore</h2>
          <p>It may have sold out or been renamed.</p>
          <button type="button" onClick={() => navigate("..")}>Back to shop</button>
        </section>
      </main>
    );
  }

  const maxQty = MAX_ORDER_QTY;
  const spec = specFor(product.name);
  const comparing = compareIds.includes(product.id);
  const compareDisabled = !comparing && compareIds.length >= MAX_COMPARE;

  // Real sibling products only — same category first, then same brand,
  // filling in up to 4, current paddle excluded. Never a fabricated
  // "recommended for you" pick.
  // Same brand first — with almost every product sharing one category
  // ("Paddle"), leading with category made this list read as arbitrary:
  // brand barely mattered to the ordering. Same-brand paddles are the
  // genuinely related pick; category is only a fallback to fill the row
  // when a brand doesn't have enough other listings on its own.
  const relatedProducts = [
    ...products.filter((item) => item.id !== product.id && item.brand === product.brand),
    ...products.filter(
      (item) =>
        item.id !== product.id &&
        item.brand !== product.brand &&
        item.category &&
        item.category === product.category,
    ),
  ].slice(0, 4);

  return (
    <>
    <div className="public-product-stage">
      <div className="public-product-backdrop">
        <Link to=".." className="public-product-back" aria-label="Back to shop"><ArrowLeft size={18} /></Link>
        <ProductImage product={product} choice={choice} className="public-product-image" />

        {/*
          Desktop only (see the 960px breakpoint in public.css) — mobile
          keeps its single hero image untouched. Each thumbnail is that
          colour's own real photo (or the honest placeholder), not a
          multi-angle gallery PTG doesn't have: clicking one also selects
          that colour, so it doubles as the variant picker at this width.
        */}
        {product.choices.length > 1 && (
          <div className="public-product-thumbs" role="tablist" aria-label="Choose a colour">
            {product.choices.map((item) => (
              <button
                type="button"
                key={item.id || item.color}
                className={`public-product-thumb ${choice?.id === item.id ? "is-active" : ""}`}
                onClick={() => { setChoice(item); setQuantity(1); }}
                aria-label={item.color}
                aria-selected={choice?.id === item.id}
                role="tab"
              >
                <ProductImage product={product} choice={item} className="public-product-thumb-image" />
              </button>
            ))}
          </div>
        )}
      </div>

      <section className="public-product-sheet">
        <nav className="public-breadcrumb" aria-label="Breadcrumb">
          <Link to="..">Shop</Link>
          {product.category && (
            <>
              <CaretRight size={11} />
              <span>{product.category}</span>
            </>
          )}
          <CaretRight size={11} />
          <span>{product.name}</span>
        </nav>

        <div className="public-product-heading">
          <div>
            <span className="public-kicker">{product.brand}</span>
            <h1>{product.name}</h1>
          </div>
          <strong className="public-product-price">{money(choice?.price || 0)}</strong>
        </div>

        <div className="public-variants">
          {product.choices.map((item) => (
            <button
              type="button"
              key={item.id || item.color}
              className={choice?.id === item.id ? "is-active" : ""}
              onClick={() => { setChoice(item); setQuantity(1); }}
            >
              <span><b>{item.color}</b><small>{available(item) ? "In stock" : item.inTransit ? "In transit" : "Pre-order"}</small></span>
              <strong>{money(item.price)}</strong>
            </button>
          ))}
        </div>

        <div className="public-product-actions">
          {choice && (
            <div className="public-stepper">
              <button type="button" onClick={() => setQuantity((n) => Math.max(1, n - 1))} aria-label="Fewer">
                <Minus size={13} />
              </button>
              <span>{quantity}</span>
              <button type="button" onClick={() => setQuantity((n) => Math.min(maxQty, n + 1))} aria-label="More">
                <Plus size={13} />
              </button>
            </div>
          )}

          <button
            type="button"
            className={`public-primary ${added ? "is-added" : ""}`}
            onClick={() => { addToCart(product, choice, quantity); setAdded(true); }}
          >
            {added ? <Check size={18} /> : <ShoppingBag size={18} />}
            {" "}
            {added
              ? "Added to cart"
              : available(choice)
                ? `Add ${choice?.color || "paddle"} to cart`
                : choice?.inTransit
                  ? `Reserve ${choice?.color || "this paddle"}`
                  : `Pre-order ${choice?.color || "this paddle"}`}
          </button>
        </div>
        {toggleCompare && (
          <button
            type="button"
            className={`public-product-compare-link ${comparing ? "is-active" : ""}`}
            onClick={() => toggleCompare(product.id)}
            disabled={compareDisabled}
          >
            {comparing ? <Check size={13} /> : <ChartBar size={13} />}
            {comparing ? "Added to compare" : "Add to compare"}
          </button>
        )}
        {!available(choice) && !added && (
          <>
            {/* Two genuinely different tiers, not two flavors of one note —
                see api/v1/_shared.js's in_transit vs preorder objects.
                In transit: real stock already paid for and moving, its own
                batch's real ETA, no "order by" (it's already shipped).
                Plain pre-order: nothing sourced yet, the one global cutoff
                date (settings.preorder_cutoff_date — never a guessed range;
                absent entirely once that date passes, see
                activePreorderCutoff), no ETA (unknown until a batch is
                actually placed after the cutoff). Both now pay the same 50%
                deposit — see IN_TRANSIT_DEPOSIT_RATIO in src/lib/calc.js. */}
            {choice?.inTransit ? (
              <>
                {choice.inTransit.ships_in && (
                  <p className="public-preorder-eta">
                    <span><strong>Estimated ready:</strong> {choice.inTransit.ships_in}</span>
                  </p>
                )}
                <p className="public-preorder-note is-intransit">
                  {choice.inTransit.remaining} {choice.inTransit.remaining === 1 ? "piece" : "pieces"} in transit —
                  this stock is already on its way, not a from-scratch pre-order. Reserve it now with a 50%
                  deposit; the remaining 50% is due in full once it's on hand, before it ships to you. Same refund
                  policy as any order.{" "}
                  {/* Only the fallback rule of thumb — a real per-batch ships_in
                      date above already says something more specific, so this
                      never contradicts it. */}
                  {!choice.inTransit.ships_in &&
                    "Estimated arrival is usually within 7 days, barring delays."}
                </p>
              </>
            ) : (
              <>
                {choice?.preorder?.cutoff_date && formatEta(choice.preorder.cutoff_date) && (
                  <p className="public-preorder-eta">
                    <span>Pre-order open until <strong>{formatEta(choice.preorder.cutoff_date)}</strong></span>
                  </p>
                )}
                <p className="public-preorder-note">
                  {choice?.preorder?.cutoff_date && formatEta(choice.preorder.cutoff_date)
                    ? `Order by ${formatEta(choice.preorder.cutoff_date)} to be included in this pre-order round. Reserve it now with a 50% deposit and we'll confirm your pickup or shipping date after payment.`
                    : "This colour ships once restocked — Paddle To Go imports in batches. Reserve it now with a 50% deposit and we'll confirm your pickup or shipping date after payment."}{" "}
                  Estimated arrival is usually 7–14 days after the pre-order cutoff, but timelines may vary due to
                  cargo, customs, and logistics.
                </p>
              </>
            )}
          </>
        )}
        {added && (
          <Link to="../cart" className="public-secondary-link">View cart <ArrowRight size={13} /></Link>
        )}

        <Accordion
          items={[
            {
              title: "Details",
              body: (
                <dl className="public-accordion-dl">
                  <div><dt>Brand</dt><dd>{product.brand}</dd></div>
                  {product.category && <div><dt>Category</dt><dd>{product.category}</dd></div>}
                  {choice?.sku && <div><dt>SKU</dt><dd>{choice.sku}</dd></div>}
                  <div>
                    <dt>Deposit to reserve</dt>
                    <dd>{money((choice?.price || 0) * DEPOSIT_RATIO)}</dd>
                  </div>
                </dl>
              ),
            },
            ...(spec
              ? [
                  {
                    title: "Technology",
                    body: (
                      <dl className="public-accordion-dl">
                        <div><dt>Core</dt><dd>{spec.core}</dd></div>
                        <div><dt>Surface</dt><dd>{spec.surface}</dd></div>
                        <div><dt>Weight</dt><dd>{spec.weight}</dd></div>
                      </dl>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </section>
    </div>

    {/*
      Deliberately a sibling of .public-product-stage, not nested inside
      it — the stage's left column is a sticky image (position:sticky),
      and it was staying pinned/visible well past where it should release,
      overlapping this section while scrolling. A `grid-column:1/-1` span
      on a grid item doesn't reliably bound a sticky sibling's containing
      block the way a real DOM boundary does; being fully outside the
      stage's grid removes the ambiguity rather than fighting it.
    */}
    {relatedProducts.length > 0 && (
      <Reveal as="section" className="public-related public-related-standalone">
        <h2>You may also like</h2>
        <div className="public-grid">
          {relatedProducts.map((item) => (
            <ProductCard key={item.id} product={item} addToCart={addToCart} />
          ))}
        </div>
      </Reveal>
    )}
    </>
  );
}

/** A collapsed-by-default disclosure list — replaces the old always-open detail cards. First section starts open so the page isn't entirely blank specs. */
/**
 * A single-open accordion with a real open/close motion (height + fade),
 * not an instant snap — shared by the product page's spec sections and the
 * FAQ page. `items[].body` is caller-provided content: a `<dl>` of spec
 * rows there, a plain paragraph here. Only one section open at a time,
 * first one open by default; set `openIndex` to -1 to start fully closed.
 */
function Accordion({ items, defaultOpenIndex = 0 }) {
  const [openIndex, setOpenIndex] = useState(defaultOpenIndex);
  const reduce = useReducedMotion();
  return (
    <div className="public-accordion">
      {items.map((item, index) => {
        const isOpen = openIndex === index;
        return (
          // `layout` here is what makes every item below an opening/closing
          // panel glide to its new position instead of jumping there the
          // instant the height changes — without it the panel animates
          // smoothly but everything after it teleports, which is the
          // "weird"/janky part. A plain duration+ease (not the app's usual
          // spring) is used for the height/opacity themselves: a spring
          // has no fixed settle time, and on a property as coarse as
          // height that reads as an uneven, slightly wobbly reveal rather
          // than a clean open.
          <motion.div className="public-accordion-item" key={item.title} layout="position" transition={ACCORDION_EASE}>
            <button
              type="button"
              className="public-accordion-summary"
              onClick={() => setOpenIndex((current) => (current === index ? -1 : index))}
              aria-expanded={isOpen}
            >
              {item.title}
              <Plus size={14} className={`public-accordion-icon ${isOpen ? "is-open" : ""}`} />
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  className="public-accordion-panel"
                  initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
                  exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  transition={ACCORDION_EASE}
                >
                  <div className="public-accordion-body">{item.body}</div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
}

/** Side-by-side compare view for whatever's in the compare tray — real fields only (price, brand, colour, stock state), never fabricated specs. */
function ComparePage({ compareIds, toggleCompare, clearCompare }) {
  const { products, status } = useShopData();
  const selected = compareIds
    .map((id) => products.find((product) => product.id === id))
    .filter(Boolean);

  if (status === "loading") {
    return (
      <main className="public-main">
        <section className="public-state">
          <Package size={28} />
          <p>Loading…</p>
        </section>
      </main>
    );
  }

  if (selected.length === 0) {
    return (
      <main className="public-main">
        <section className="public-state public-state-tall">
          <Package size={30} />
          <h2>Nothing to compare yet</h2>
          <p>Pick two or three paddles from the shop to see them side by side.</p>
          <Link to=".." className="public-state-link">Browse paddles</Link>
        </section>
      </main>
    );
  }

  // Only build a Specifications section if at least one selected paddle has
  // a real, sourced spec — an empty section would just be a wall of "—".
  const specs = selected.map((product) => specFor(product.name));
  const hasAnySpec = specs.some(Boolean);

  return (
    <main className="public-main">
      <section className="public-page-head public-page-head-compact">
        <div className="public-compare-heading-row">
          <h1>{selected.length} paddle{selected.length === 1 ? "" : "s"}</h1>
          <button type="button" className="public-compare-clear" onClick={clearCompare}>
            <Trash size={13} /> Clear all
          </button>
        </div>
      </section>

      <div className="public-compare-grid" data-count={selected.length}>
        {selected.map((product) => {
          const prices = product.choices.map((choice) => choice.price);
          const low = Math.min(...prices);
          const high = Math.max(...prices);
          const inStock = product.choices.some(available);
          const inTransit = !inStock && product.choices.some((c) => c.inTransit);
          return (
            <article className="public-compare-card" key={product.id}>
              <button
                type="button"
                className="public-compare-remove"
                onClick={() => toggleCompare(product.id)}
                aria-label={`Remove ${product.name} from compare`}
              >
                <X size={14} />
              </button>
              <ProductImage product={product} choice={product.choices[0]} className="public-compare-image" />
              <span className="public-kicker">{product.brand}</span>
              <h2>{product.name}</h2>
              <strong>{low === high ? money(low) : `${money(low)} – ${money(high)}`}</strong>
              <span className={`public-inline-badge ${inStock ? "" : inTransit ? "is-intransit" : "is-preorder"}`}>
                {inStock ? "In stock" : inTransit ? "In transit" : "Pre-order"}
              </span>
              <Link to={`../paddle/${product.id}`} className="public-secondary-link">
                View paddle <ArrowRight size={13} />
              </Link>
            </article>
          );
        })}
      </div>

      <div className="public-compare-table-wrap">
        {/*
          A fixed colgroup, not the browser's default auto sizing, is what
          actually keeps every paddle's column beside the others at an equal
          width instead of one column ballooning to fit its longest spec line
          and pushing the rest off-screen — the exact failure mode on
          pickleclubdavao.com/shop/compare's own mobile layout.

          Every column here is a PERCENTAGE of the table, including the
          label column — mixing a fixed-px label column with percentage
          product columns (100/n% each) made the columns collectively
          demand more than 100% of the table's width the moment there were
          3 of them, and table-layout:fixed doesn't reconcile that cleanly:
          columns visibly overlapped instead of shrinking. LABEL_PCT is
          carved out of the 100% up front, so the math always adds up.
        */}
        <table className="public-compare-table">
          <colgroup>
            <col style={{ width: `${LABEL_PCT}%` }} />
            {selected.map((product) => (
              <col key={product.id} style={{ width: `${(100 - LABEL_PCT) / selected.length}%` }} />
            ))}
          </colgroup>
          <tbody>
            <tr>
              <th scope="row">Category</th>
              {selected.map((product) => <td key={product.id}>{product.category || "—"}</td>)}
            </tr>
            <tr>
              <th scope="row">Brand</th>
              {selected.map((product) => <td key={product.id}>{product.brand}</td>)}
            </tr>
            <tr>
              <th scope="row">Price</th>
              {selected.map((product) => {
                const prices = product.choices.map((choice) => choice.price);
                const low = Math.min(...prices);
                const high = Math.max(...prices);
                return <td key={product.id}>{low === high ? money(low) : `${money(low)} – ${money(high)}`}</td>;
              })}
            </tr>
            <tr>
              <th scope="row">Colours</th>
              {selected.map((product) => (
                <td key={product.id}>
                  {product.choices.map((choice) => (
                    <div key={choice.id || choice.color} className="public-compare-colour-row">
                      <span>{choice.color}</span>
                      <small>{available(choice) ? "In stock" : choice.inTransit ? "In transit" : "Pre-order"}</small>
                    </div>
                  ))}
                </td>
              ))}
            </tr>

            {hasAnySpec && (
              <>
                <tr className="public-compare-section">
                  <th colSpan={selected.length + 1}>Specifications</th>
                </tr>
                <tr>
                  <th scope="row">Core</th>
                  {selected.map((product, i) => <td key={product.id}>{specs[i]?.core || "—"}</td>)}
                </tr>
                <tr>
                  <th scope="row">Surface</th>
                  {selected.map((product, i) => <td key={product.id}>{specs[i]?.surface || "—"}</td>)}
                </tr>
                <tr>
                  <th scope="row">Weight</th>
                  {selected.map((product, i) => <td key={product.id}>{specs[i]?.weight || "—"}</td>)}
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

/** Dedicated cart page — a normal route, not an overlay, so it can be linked to, refreshed, or shared. */
function CartPage({ cart, total, onQuantity, onRemove, reduce }) {
  if (cart.length === 0) {
    return (
      <main className="public-main">
        <section className="public-state public-state-tall">
          <ShoppingBag size={30} />
          <h2>Your cart is empty</h2>
          <p>Browse our paddles and find your next one.</p>
          <Link to=".." className="public-state-link">Continue shopping</Link>
        </section>
      </main>
    );
  }

  const hasPreorder = cart.some((line) => line.isPreorder);
  // In-transit and from-scratch pre-order pay the same 50% deposit now — see
  // IN_TRANSIT_DEPOSIT_RATIO in src/lib/calc.js.
  const hasInTransit = cart.some((line) => line.isInTransit);
  const depositRatio = DEPOSIT_RATIO;
  const preorderCutoff = cart.find((line) => line.isPreorder && !line.isInTransit && line.preorder?.cutoff_date)?.preorder
    ?.cutoff_date;

  return (
    <main className="public-main">
      <section className="public-page-head public-page-head-compact">
        <h1>Cart</h1>
      </section>

      {hasInTransit ? (
        <div className="public-preorder-banner is-intransit">
          <span className="public-preorder-banner-badge is-intransit">In transit</span>
          <p>Your cart includes stock already in transit — reserve it now with a 50% deposit, same refund policy as any order. The remaining 50% is due in full once it's on hand, before it ships.</p>
        </div>
      ) : hasPreorder ? (
        <div className="public-preorder-banner">
          <span className="public-preorder-banner-badge">Pre-order</span>
          <p>
            Your cart includes at least one pre-order item
            {preorderCutoff && formatEta(preorderCutoff) ? <> — order by {formatEta(preorderCutoff)} for this round</> : " — it ships once restocked"},
            same deposit and refund policy as any order.
          </p>
        </div>
      ) : null}

      <div className="public-cart-layout">
        <motion.ul className="public-cart-lines" layout>
          <AnimatePresence initial={false}>
            {cart.map((line) => (
              <motion.li
                className="public-cart-line"
                key={line.key}
                layout
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, x: -12 }}
                transition={spring}
              >
                <div className="public-cart-thumb">{line.photo ? <img src={line.photo} alt="" /> : <ImageSquare size={20} />}</div>
                <div className="public-cart-copy">
                  <b>{line.name}</b>
                  <small>{line.color}</small>
                  <strong>{money(line.price * line.quantity)}</strong>
                </div>
                <div className="public-cart-line-actions">
                  <div className="public-stepper">
                    <button type="button" onClick={() => onQuantity(line.key, -1)} aria-label={`Remove one ${line.name}`}><Minus size={13} /></button>
                    <span>{line.quantity}</span>
                    <button type="button" onClick={() => onQuantity(line.key, 1)} aria-label={`Add one ${line.name}`}><Plus size={13} /></button>
                  </div>
                  <button type="button" className="public-remove" onClick={() => onRemove(line.key)} aria-label={`Remove ${line.name} from cart`}>
                    <Trash size={15} />
                  </button>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>

        <aside className="public-order-summary">
          <h2>Order summary</h2>
          <div className="public-total"><span>Order total</span><strong>{money(total)}</strong></div>
          <div className="public-deposit">
            <span>Deposit to reserve</span>
            <strong>{money(total * depositRatio)}</strong>
            <p>
              Exactly {Math.round(depositRatio * 100)}% is due now. The remaining {money(total * (1 - depositRatio))} is due{" "}
              {hasInTransit ? "once it's on hand" : "before pickup or shipping"}.
            </p>
          </div>
          <Link to="../checkout" className="public-primary">Continue to checkout <ArrowRight size={18} /></Link>
          <Link to=".." className="public-secondary-link">Keep shopping</Link>
        </aside>
      </div>
    </main>
  );
}

/** One numbered step in the checkout — the visual spine the whole form hangs off. */
function Step({ number, title, children }) {
  return (
    <div className="public-step">
      <div className="public-step-head"><span className="public-step-num">{number}</span><h3>{title}</h3></div>
      <div className="public-step-body">{children}</div>
    </div>
  );
}

/** Dedicated checkout page. Form logic (validation, submit, payment proof) is unchanged from before — only the shell moved from a slide-over to a routed page. */
function CheckoutPage({ cart, total, onSent, reduce }) {
  const navigate = useNavigate();
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0].id);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    facebookContact: "",
    fulfillment: "Pickup",
    address: "",
    regionCode: "",
    regionName: "",
    cityCode: "",
    cityName: "",
    barangay: "",
    zip: "",
    recipientSameAsContact: true,
    recipientName: "",
    recipientPhone: "",
    proof: "",
    proofName: "",
    messengerSent: false,
    acknowledged: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef(null);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const selectedPayment = PAYMENT_METHODS.find((method) => method.id === paymentMethod);

  // The full PH region/city/barangay dataset is ~40,000 barangays — real
  // PSGC data, not something to trim, but not something every storefront
  // visitor should download either. Loaded on demand, only once someone
  // actually picks Shipping, instead of shipping it in the main bundle for
  // every page view (Pickup included).
  const [phAddress, setPhAddress] = useState(null);
  useEffect(() => {
    if (form.fulfillment !== "Shipping" || phAddress) return;
    let cancelled = false;
    import("../lib/phAddress").then((module) => {
      if (!cancelled) setPhAddress(module);
    });
    return () => {
      cancelled = true;
    };
  }, [form.fulfillment, phAddress]);

  const cityOptions = useMemo(
    () => (phAddress && form.regionCode ? phAddress.citiesInRegion(form.regionCode) : []),
    [phAddress, form.regionCode],
  );
  const barangayOptions = useMemo(
    () => (phAddress && form.cityCode ? phAddress.barangaysInCity(form.cityCode) : []),
    [phAddress, form.cityCode],
  );

  const setRegion = (regionCode) => {
    const region = phAddress?.PH_REGIONS.find((item) => item.reg_code === regionCode);
    setForm((current) => ({
      ...current,
      regionCode,
      regionName: region?.name || "",
      cityCode: "",
      cityName: "",
      barangay: "",
    }));
  };
  const setCity = (cityCode) => {
    const city = cityOptions.find((item) => item.mun_code === cityCode);
    setForm((current) => ({ ...current, cityCode, cityName: city?.name || "", barangay: "" }));
  };

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  if (cart.length === 0) {
    return (
      <main className="public-main">
        <section className="public-state public-state-tall">
          <ShoppingBag size={30} />
          <h2>Your cart is empty</h2>
          <p>Add a paddle before checking out.</p>
          <Link to="../.." className="public-state-link">Browse paddles</Link>
        </section>
      </main>
    );
  }

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
    const facebookContact = clean(form.facebookContact);
    const recipientName = form.recipientSameAsContact ? name : clean(form.recipientName);
    const recipientPhone = form.recipientSameAsContact ? phone : clean(form.recipientPhone);
    if (!cart.length) return setError("Your cart is empty.");
    if (!name || !email || !phone || !facebookContact) {
      return setError("Fill in your name, email, phone, and Facebook name or profile link.");
    }
    if (
      form.fulfillment === "Shipping" &&
      (!clean(form.address) ||
        !form.regionCode ||
        !form.cityCode ||
        !clean(form.barangay) ||
        !clean(form.zip) ||
        !recipientName ||
        !recipientPhone)
    ) {
      return setError("Fill in your complete shipping address and recipient details.");
    }
    if (!form.proof) return setError("Add your proof of payment.");
    if (!form.messengerSent) return setError("Confirm you've sent your payment proof on Messenger.");
    if (!form.acknowledged) return setError("Acknowledge the order terms to continue.");

    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/v1/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          customer: {
            name,
            email,
            phone,
            facebook: facebookContact,
            address:
              form.fulfillment === "Shipping"
                ? `${clean(form.address)}, Brgy. ${clean(form.barangay)}, ${clean(form.cityName)}, ${clean(form.regionName)} ${clean(form.zip)}`
                : "",
            recipient: form.fulfillment === "Shipping" ? `${recipientName}, ${recipientPhone}` : "",
          },
          fulfillment_method: form.fulfillment.toLowerCase(),
          shipping_fee_php: 0,
          items: cart.map((line) => ({
            product_id: line.productId,
            variant_id: line.variantId || undefined,
            quantity: line.quantity,
          })),
          acknowledgment: true,
          payment_proof_url: form.proof,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || "Your order could not be sent. Please try again.");
      onSent();
      navigate(`../order/${encodeURIComponent(data.order.order_number)}`, {
        state: { orderNumber: data.order.order_number, deposit: data.order.deposit_php },
      });
    } catch (submitError) {
      setError(submitError.message || "Your order could not be sent. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  // In transit is its own tier, not a flavor of plain pre-order — a line is
  // one or the other, never counted as both below.
  const inTransitLines = cart.filter((line) => line.isInTransit);
  const hasInTransit = inTransitLines.length > 0;
  const preorderLines = cart.filter((line) => line.isPreorder && !line.isInTransit);
  const hasPreorder = preorderLines.length > 0;
  const preorderCutoff = preorderLines.find((line) => line.preorder?.cutoff_date)?.preorder?.cutoff_date || null;
  const lineLabel = (line) => `${line.name}${line.color && line.color !== "Standard" ? ` (${line.color})` : ""}`;
  // In-transit and from-scratch pre-order pay the same 50% deposit now — see
  // IN_TRANSIT_DEPOSIT_RATIO in src/lib/calc.js.
  const depositRatio = DEPOSIT_RATIO;

  return (
    <main className="public-main">
      <section className="public-page-head public-page-head-compact">
        <Link to="../cart" className="public-back-link" aria-label="Back to cart"><ArrowLeft size={16} /> Back to cart</Link>
        <h1>Checkout</h1>
      </section>

      {/*
        Only when the cart actually has that kind of line — a mixed cart
        still gets both banners, since each kind needs its own heads-up.
        Each line's own real ships-in text (snapshotted at add-to-cart, same
        source as the PDP note), never one guessed figure for the whole cart.
      */}
      {hasInTransit && (
        <div className="public-preorder-banner is-intransit">
          <span className="public-preorder-banner-badge is-intransit">In transit</span>
          <div>
            <p>
              {inTransitLines.length === 1
                ? `You're reserving ${lineLabel(inTransitLines[0])} — it's already in transit.`
                : `You're reserving ${inTransitLines.length} items already in transit.`}{" "}
              {inTransitLines[0]?.inTransit?.ships_in
                ? <>Estimated ready: {inTransitLines[0].inTransit.ships_in}. </>
                : "Estimated arrival is usually within 7 days, barring delays. "}
              50% deposit now — same refund policy as a normal order. The remaining 50% is due in full once it's on
              hand, before it ships to you.
            </p>
            {inTransitLines.length > 1 && (
              <ul className="public-preorder-banner-list">
                {inTransitLines.map((line) => (
                  <li key={line.key}>
                    {lineLabel(line)}
                    {line.inTransit?.ships_in ? ` — ${line.inTransit.ships_in}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {hasPreorder && (
        <div className="public-preorder-banner">
          <span className="public-preorder-banner-badge">Pre-order</span>
          <div>
            <p>
              {preorderLines.length === 1
                ? `You're pre-ordering ${lineLabel(preorderLines[0])}.`
                : `You're pre-ordering ${preorderLines.length} items.`}{" "}
              {/* Every pre-order line shares the same date — it's one global
                  round (settings.preorder_cutoff_date), not per-item. */}
              {preorderCutoff && formatEta(preorderCutoff) && <>Order by {formatEta(preorderCutoff)} for this round. </>}
              Same 50% deposit and refund policy as a normal order — Paddle To Go confirms your pickup or
              shipping date after payment. Estimated arrival is usually 7–14 days after the pre-order cutoff, but
              timelines may vary due to cargo, customs, and logistics.
            </p>
          </div>
        </div>
      )}

      {error && <p className="public-error" ref={errorRef} tabIndex="-1">{error}</p>}

      <div className="public-checkout-layout">
        {/*
          Order summary is first in the DOM (not the form) so it's what a
          visitor sees first when this stacks on mobile — the desktop
          `order` CSS below puts it back on the right, beside the form, as
          a sticky sidebar (that part was already decided; only the
          reading order changes).
        */}
        <aside className="public-order-summary">
          <h2>Order summary</h2>
          <ul className="public-summary-lines">
            {cart.map((line) => (
              <li key={line.key}>
                <span>{line.quantity}× {line.name} <small>{line.color}</small></span>
                <strong>{money(line.price * line.quantity)}</strong>
              </li>
            ))}
          </ul>
          <div className="public-total"><span>Order total</span><strong>{money(total)}</strong></div>
          <div className="public-deposit is-compact">
            <span>Pay now</span>
            <strong>{money(total * depositRatio)}</strong>
            <p>
              The other {money(total * (1 - depositRatio))} is due {hasInTransit ? "once it's on hand" : "before fulfilment"}.
              Shipping is separate and confirmed if selected.
            </p>
          </div>
        </aside>

        <form className="public-checkout-form" onSubmit={submit}>
          <Step number={1} title="Contact information">
            <label><span>Full name<span className="public-required">*</span></span><input autoComplete="name" value={form.name} onChange={(event) => set("name", event.target.value)} required /></label>
            <label><span>Email<span className="public-required">*</span></span><input type="email" autoComplete="email" value={form.email} onChange={(event) => set("email", event.target.value)} required /></label>
            <label><span>Phone<span className="public-required">*</span></span><input type="tel" autoComplete="tel" value={form.phone} onChange={(event) => set("phone", event.target.value)} required /></label>
            <label>
              <span>Facebook name or profile link<span className="public-required">*</span></span>
              <input value={form.facebookContact} onChange={(event) => set("facebookContact", event.target.value)} placeholder="e.g. facebook.com/yourname" required />
            </label>
            <p className="public-field-note">We'll match your Messenger message to this order by this name or link.</p>
          </Step>

          <Step number={2} title="Fulfilment">
            <div className="public-methods">
              <button type="button" className={form.fulfillment === "Pickup" ? "is-active" : ""} onClick={() => set("fulfillment", "Pickup")}><Package size={18} /><span><b>Pickup</b><small>Arrange after review</small></span></button>
              <button type="button" className={form.fulfillment === "Shipping" ? "is-active" : ""} onClick={() => set("fulfillment", "Shipping")}><Truck size={18} /><span><b>Shipping</b><small>Fee confirmed later</small></span></button>
            </div>
            <AnimatePresence initial={false}>
              {form.fulfillment === "Shipping" && (
                <motion.div className="public-address" initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }} transition={spring}>
                  <label><span>Street address<span className="public-required">*</span></span><textarea autoComplete="street-address" value={form.address} onChange={(event) => set("address", event.target.value)} required /></label>
                  <div className="public-address-grid">
                    <label>
                      <span>Region<span className="public-required">*</span></span>
                      <select value={form.regionCode} onChange={(event) => setRegion(event.target.value)} disabled={!phAddress} required>
                        <option value="" disabled>{phAddress ? "Select region" : "Loading regions…"}</option>
                        {phAddress?.PH_REGIONS.map((region) => (
                          <option key={region.reg_code} value={region.reg_code}>{region.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>City / Municipality<span className="public-required">*</span></span>
                      <select value={form.cityCode} onChange={(event) => setCity(event.target.value)} disabled={!form.regionCode} required>
                        <option value="" disabled>{form.regionCode ? "Select city or municipality" : "Select region first"}</option>
                        {cityOptions.map((city) => (
                          <option key={city.mun_code} value={city.mun_code}>{city.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Barangay<span className="public-required">*</span></span>
                      <select value={form.barangay} onChange={(event) => set("barangay", event.target.value)} disabled={!form.cityCode} required>
                        <option value="" disabled>{form.cityCode ? "Select barangay" : "Select city first"}</option>
                        {barangayOptions.map((barangay) => (
                          <option key={barangay.name} value={barangay.name}>{barangay.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>ZIP code<span className="public-required">*</span></span>
                      <input inputMode="numeric" autoComplete="postal-code" value={form.zip} onChange={(event) => set("zip", event.target.value)} required />
                    </label>
                  </div>

                  <div className="public-recipient-head">
                    <span>Recipient</span>
                    <button
                      type="button"
                      className={`public-recipient-toggle ${form.recipientSameAsContact ? "is-active" : ""}`}
                      onClick={() => set("recipientSameAsContact", !form.recipientSameAsContact)}
                      aria-pressed={form.recipientSameAsContact}
                    >
                      {form.recipientSameAsContact && <Check size={12} />} Same as contact info
                    </button>
                  </div>
                  <label>
                    <span>Recipient name<span className="public-required">*</span></span>
                    <input
                      value={form.recipientSameAsContact ? form.name : form.recipientName}
                      onChange={(event) => set("recipientName", event.target.value)}
                      disabled={form.recipientSameAsContact}
                      required
                    />
                  </label>
                  <label>
                    <span>Recipient phone<span className="public-required">*</span></span>
                    <input
                      type="tel"
                      value={form.recipientSameAsContact ? form.phone : form.recipientPhone}
                      onChange={(event) => set("recipientPhone", event.target.value)}
                      disabled={form.recipientSameAsContact}
                      required
                    />
                  </label>
                </motion.div>
              )}
            </AnimatePresence>
          </Step>

          <Step number={3} title="Payment summary">
            <ul className="public-summary-lines">
              {cart.map((line) => (
                <li key={line.key}>
                  <span>{line.quantity}× {line.name} <small>{line.color}</small></span>
                  <strong>{money(line.price * line.quantity)}</strong>
                </li>
              ))}
            </ul>
            <div className="public-total"><span>Subtotal</span><strong>{money(total)}</strong></div>
            <div className="public-deposit is-compact">
              <span>Downpayment due ({Math.round(depositRatio * 100)}%)</span>
              <strong>{money(total * depositRatio)}</strong>
              <p>Balance (due later): {money(total * (1 - depositRatio))}</p>
            </div>
          </Step>

          <Step number={4} title="Scan to pay">
            <div className="public-payment-methods" aria-label="Choose a payment QR">
              <p className="public-payment-label">Choose where you paid</p>
              <div className="public-payment-cards">
                {PAYMENT_METHODS.map((method) => (
                  <button type="button" key={method.id} className={paymentMethod === method.id ? "is-active" : ""} onClick={() => setPaymentMethod(method.id)} aria-pressed={paymentMethod === method.id}>
                    <img className="public-payment-card-qr" src={method.image} alt="" />
                    <b>{method.label}</b>
                    {paymentMethod === method.id && <Check size={16} />}
                  </button>
                ))}
              </div>
              <div className="public-selected-qr">
                <img src={selectedPayment.image} alt={`${selectedPayment.label} payment QR`} />
                <p>Scan this QR, complete your deposit, then attach the receipt below.</p>
              </div>
            </div>
          </Step>

          <Step number={5} title="Proof of payment">
            <label className={`public-upload ${form.proof ? "has-file" : ""}`}>
              <ImageSquare size={22} />
              <span><b>{form.proof ? "Proof added" : "Upload proof of payment"}</b><small>{form.proofName || "JPG, PNG, or PDF, up to 5 MB"}</small></span>
              <input type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; chooseProof(file); }} />
            </label>

            <div className="public-messenger-box">
              <b>Also required: send your proof on Messenger</b>
              <ol>
                <li>Tap the button below to open Messenger.</li>
                <li>Send the same payment screenshot to Paddle To Go.</li>
                <li>Come back here and check the box confirming you sent it.</li>
              </ol>
              <a className="public-messenger-link" href={PTG_MESSENGER_URL} target="_blank" rel="noreferrer">
                Open Messenger <ArrowRight size={15} />
              </a>
            </div>
            <label className="public-ack">
              <input type="checkbox" checked={form.messengerSent} onChange={(event) => set("messengerSent", event.target.checked)} />
              <span>I've sent my payment proof to Paddle To Go on Messenger.</span>
            </label>
          </Step>

          <label className="public-ack public-ack-warning">
            <input type="checkbox" checked={form.acknowledged} onChange={(event) => set("acknowledged", event.target.checked)} />
            <span>Placing this order is final — I've reviewed my items and accept that it's <b>non-refundable and non-cancellable</b>.</span>
          </label>
          <button type="submit" className="public-primary" disabled={busy}>
            {busy
              ? "Placing order…"
              : `Place ${hasInTransit ? "reservation" : hasPreorder ? "pre-order" : "order"} · Pay ${money(total * depositRatio)}`}{" "}
            <ArrowRight size={18} />
          </button>
        </form>
      </div>
    </main>
  );
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

/**
 * Real store policy only — every answer here restates something already
 * stated elsewhere in the storefront (checkout copy, the pre-order note,
 * PAYMENT_METHODS, PTG_MESSENGER_URL) rather than inventing new terms.
 */
function FaqPage() {
  const paymentList = PAYMENT_METHODS.map((m) => m.label).join(", ");
  return (
    <main className="public-main">
      <section className="public-page-head public-page-head-compact">
        <h1>FAQs</h1>
        <p>Everything worth knowing before you reserve a paddle.</p>
      </section>

      <Accordion
        items={[
          {
            title: "Do you sell authentic paddles?",
            body: <p>Yes. All paddles sold by Paddle To Go are sourced from our trusted suppliers.</p>,
          },
          {
            title: "Do you have paddles on hand?",
            body: (
              <p>
                Some models are available on hand, while others are available through pre-order. Check the product
                listing or message us for availability.
              </p>
            ),
          },
          {
            title: "How does pre-order work?",
            body: (
              <p>
                A 50% deposit is required to secure your pre-order — whether it's a from-scratch pre-order or
                stock marked "In transit" on its product page, already on its way to us. Once your paddle
                arrives and is checked by Paddle To Go, you'll settle the remaining 50% in full before it's
                released or shipped to you.
              </p>
            ),
          },
          {
            title: "When will my pre-order arrive?",
            body: (
              <p>
                Estimated arrival is usually 7–14 days after the pre-order cutoff, but timelines may vary due to
                cargo, customs, and logistics.
              </p>
            ),
          },
          {
            title: "What payment methods do you accept?",
            body: <p>We accept {paymentList}.</p>,
          },
          {
            title: "Do you offer shipping?",
            body: (
              <p>
                Yes. Orders can be shipped nationwide via LBC or J&T Express. We don't offer cash-on-delivery
                or cash-on-pickup at the moment — the remaining balance (or full payment) is settled once your
                paddle is on hand, before it ships out. Shipping fees are separate from the paddle price.
              </p>
            ),
          },
          {
            title: "Can I request a specific paddle or colour?",
            body: <p>Yes! If the model or colour isn't currently listed, send us a message and we'll check if it can be ordered.</p>,
          },
          {
            title: "What if my paddle arrives with a defect or damage?",
            body: (
              <p>
                All pre-order paddles are checked by Paddle To Go upon arrival before being released to the buyer.
                If there's an issue, please contact us immediately so we can assist.
              </p>
            ),
          },
        ]}
      />

      <p className="public-faq-contact">
        Still have a question?{" "}
        <a href={PTG_MESSENGER_URL} target="_blank" rel="noreferrer">
          Message us on Messenger <ArrowRight size={12} />
        </a>
      </p>
    </main>
  );
}

/** Order confirmation is its own route so it can be reloaded, bookmarked, or reopened from an email — not a modal that vanishes on refresh. */
function OrderConfirmation() {
  const { orderNumber } = useParams();
  const location = useLocation();
  const deposit = location.state?.deposit;

  return (
    <main className="public-main">
      <section className="public-state public-state-tall public-success-page">
        <div className="public-success-icon"><Check size={27} /></div>
        <h2>Your paddle is requested.</h2>
        <p>
          Order <strong>{orderNumber}</strong> — we received your order{deposit != null ? ` and ${money(deposit)} proof` : ""}. Paddle To Go will review it and confirm fulfilment.
        </p>
        <Link to="../.." className="public-state-link">Continue shopping</Link>
      </section>
    </main>
  );
}

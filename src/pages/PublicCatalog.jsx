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
import { brandOf, PUBLIC_CATALOG_PATH, resolvePhotoAssetUrl } from "../lib/storefront";

// A visitor never sees a real stock count (per docs/storefront-api-v1.md, the
// public API returns only "available"/"unavailable") — this just bounds how
// many of one colour a single order line can request.
const MAX_ORDER_QTY = 10;
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
 * than asserting one. A model with no confidently-matched source — "Joola
 * IV" doesn't match any real JOOLA model (their line is Perseus/Hyperion/
 * Vision) — is simply left out: no spec section shows rather than a guessed
 * one.
 */
const PADDLE_SPECS = {
  "franklin c45 alw": {
    core: "PowerFlex polymer core",
    surface: "45° peel-ply T700 carbon fiber face",
    weight: "Varies by core thickness (12.7mm / 14mm / 16mm)",
  },
  "kamito alpha x": {
    core: "Triple Foam Core (MPP + EVA foam)",
    surface: "Toray raw carbon fiber",
    weight: "≈225g (7.9 oz), 16mm core",
  },
  "kamito dominus": {
    core: "EPP foam + EVA core",
    surface: "3-layer Japanese Toray carbon fiber",
    weight: "≈225g (7.9 oz), 16mm core",
  },
  "rpm q2": {
    core: "Molded EPP foam, 3mm groove channels",
    surface: "FRICTION CarbonBite carbon fiber",
    weight: "7.5 – 8.0 oz across 14mm/16mm cores",
  },
  "rpm v2": {
    core: "Tri-density honeycomb + EVA foam",
    surface: "CarbonBite carbon fiber",
    weight: "7.6 – 8.1 oz across 14mm/16mm cores",
  },
  "zocker aspire": {
    core: "Hot-pressed honeycomb",
    surface: "T700 carbon fiber (Japan-sourced)",
    weight: "≈225 – 235 g, 16mm core",
  },
  "sypik triton 5": {
    core: "Honeycomb core, 16mm",
    surface: "Raw T700 carbon fiber",
    weight: "≈227g (7.85 oz)",
  },
  "joola v persus": {
    core: "Response polymer core, 16mm",
    surface: "Textured carbon fiber, SK Film vibration layer",
    weight: "≈7.8 – 8.0 oz",
  },
  "honolulu j6cr": {
    core: "Core Reactor + Dynamic PowerFlex Technology",
    surface: "Control Joint Technology carbon face",
    weight: "8.0 – 8.2 oz, 16mm core",
  },
  "honolulu j6cr crystal blue": {
    core: "Core Reactor + Dynamic PowerFlex Technology",
    surface: "Control Joint Technology carbon face",
    weight: "8.0 – 8.2 oz, 16mm core",
  },
  "honolulu j2cr crystal": {
    core: "Core Reactor technology (hybrid shape)",
    surface: "Control Joint Technology carbon face",
    weight: "8.0 – 8.3 oz",
  },
  "bread and butter loco": {
    core: "CFC layup (carbon/fiberglass/carbon) + EPP/EVA foam ring",
    surface: "T-700 raw carbon fiber",
    weight: "7.8 – 8.1 oz, depending on shape",
  },
};
// Every Selkirk OMNI and Boomstik colourway PTG carries shares the same
// underlying technology, so it's matched by name prefix once rather than
// repeated for each of the nine colourways.
const SELKIRK_OMNI_SPEC = {
  core: "ReactCore — PureFoam + EVA Power Ring, 16mm",
  surface: "Multistrata T700 carbon fiber, InfiniGrit surface",
  weight: "7.9 – 8.2 oz (Elongated or Widebody)",
};
const SELKIRK_BOOMSTIK_SPEC = {
  core: "BoomCore — PureFoam + EVA Power Ring, 16mm",
  surface: "3-layer T700 carbon fiber, InfiniGrit surface",
  weight: "≈7.9 oz, Elongated shape",
};
function specFor(name) {
  const key = String(name || "").trim().toLowerCase();
  if (key.startsWith("selkirk omni")) return SELKIRK_OMNI_SPEC;
  if (key.startsWith("selkirk boomst")) return SELKIRK_BOOMSTIK_SPEC;
  return PADDLE_SPECS[key] || null;
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
const BRAND_LOGOS = {
  "Bread and Butter": "/images/brands/bread-and-butter.png",
  Sypik: "/images/brands/sypik.png",
  RPM: "/images/brands/rpm.png",
  Joola: "/images/brands/joola.png",
  Selkirk: "/images/brands/selkirk.png",
  Wika: "/images/brands/wika.png",
  Kamito: "/images/brands/kamito.png",
  Honolulu: "/images/brands/honolulu.png",
  Franklin: "/images/brands/franklin.png",
  Zocker: "/images/brands/zocker.png",
};

/**
 * Continuous auto-scrolling brand row — real brand names pulled from the
 * live catalog (never a hardcoded or fabricated list), shown as each
 * brand's own logo where we have real artwork for it, or its plain name
 * otherwise. Duplicated once for a seamless loop; pauses on hover/focus so
 * it never becomes unreadable to someone who wants to stop and look, and
 * respects prefers-reduced-motion by holding still.
 */
function LogoMarquee({ items }) {
  const reduce = useReducedMotion();
  if (!items.length) return null;
  const track = [...items, ...items];
  return (
    <div className="public-marquee" role="list" aria-label="Brands available">
      <div className={`public-marquee-track ${reduce ? "is-static" : ""}`}>
        {track.map((name, index) => {
          const logo = BRAND_LOGOS[name];
          return (
            <span className="public-marquee-item" role="listitem" key={`${name}-${index}`} aria-hidden={index >= items.length}>
              {logo ? <img src={logo} alt={name} /> : name}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ProductImage({ product, choice, className = "" }) {
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
  return <div className={className}>{image}</div>;
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
          // re-checked live while the line sits in the cart.
          isPreorder: !available(choice),
          preorder: choice.preorder || null,
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

  return (
    <BrowserRouter basename={PUBLIC_CATALOG_PATH}>
      <div className="public-shell">
        <Routes>
          <Route element={<Layout cartCount={cartCount} compareCount={compareIds.length} />}>
            <Route index element={<Shop addToCart={addToCart} compareIds={compareIds} toggleCompare={toggleCompare} />} />
            <Route
              path="paddle/:id"
              element={<ProductPage addToCart={addToCart} compareIds={compareIds} toggleCompare={toggleCompare} />}
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

/** Header + footer chrome shared by every storefront route; the routed page fills the middle. */
function Layout({ cartCount, compareCount = 0 }) {
  const location = useLocation();
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

  return (
    <>
      <header className="public-nav">
        <Link to="" className="public-nav-brand" aria-label="Paddle To Go storefront">
          <img src="/images/ptg-logo-inverse.png" alt="Paddle To Go" className="public-logo" />
        </Link>
        <nav className="public-nav-links" aria-label="Storefront">
          <Link to="">Shop</Link>
        </nav>
        <Link to="cart" className="public-cart-link" aria-label={`Cart, ${cartCount} item${cartCount === 1 ? "" : "s"}`}>
          <ShoppingBag size={19} />
          {cartCount > 0 && <b>{cartCount}</b>}
        </Link>
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
          <img src="/images/ptg-logo-header.png" alt="Paddle To Go" />
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
    </>
  );
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

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(products.map((product) => product.category).filter(Boolean))).sort()],
    [products],
  );
  const brands = useMemo(
    () => ["All brands", ...Array.from(new Set(products.map((product) => product.brand))).sort()],
    [products],
  );
  useEffect(() => {
    if (!categories.includes(category)) setCategory("All");
  }, [category, categories]);
  useEffect(() => {
    if (!brands.includes(brand)) setBrand("All brands");
  }, [brand, brands]);

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

  const availableCount = products.reduce((total, product) => total + product.choices.filter(available).length, 0);

  return (
    <>
      <section className="public-hero">
        <img className="public-hero-bg" src="/images/ptg-court-banner-v2.png" alt="Paddle To Go — Cagayan de Oro, Philippines" />
        <div className="public-hero-scrim" />
        <Reveal className="public-hero-float" delay={0.1}>
          <strong>{products.length || "—"}</strong>
          <span>{availableCount > 0 ? `models · ${availableCount} colours in stock` : "models in the current lineup"}</span>
        </Reveal>
        <Reveal as="div" className="public-hero-text">
          <span className="public-kicker public-kicker-on-dark">CURRENT LINE-UP</span>
          <h1>Reserve your next paddle.</h1>
          <p>Pick your model and colour, then hold it with a 50% deposit — no account, no waiting on a reply.</p>
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
        <LogoMarquee items={brands.filter((item) => item !== "All brands")} />
      </section>

      <main className="public-main" id="shop">
      <Reveal as="section" className="public-page-head public-page-head-compact">
        <span className="public-kicker">SHOP</span>
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
        <motion.section className="public-grid" layout>
          {filtered.map((product, index) => {
            const inStock = product.choices.some(available);
            // Any choice's real ships-in estimate — a product can have
            // several colours on different incoming batches, so this just
            // shows whichever one actually has a date on file rather than
            // guessing a single figure for the whole card.
            const shipsIn = !inStock ? product.choices.find((c) => c.preorder?.ships_in)?.preorder?.ships_in : null;
            const fromPrice = Math.min(...product.choices.map((choice) => choice.price));
            const singleChoice = product.choices.length === 1 ? product.choices[0] : null;
            const justAddedThis = justAdded === product.id;
            return (
              <motion.article
                className="public-card"
                key={product.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.5, delay: (index % 4) * 0.06, ease: [0.25, 1, 0.5, 1] }}
              >
                <Link to={`paddle/${product.id}`} aria-label={`View ${product.name}`}>
                  <ProductImage product={product} choice={product.choices[0]} className="public-card-image" />
                  {!inStock && <span className="public-card-badge is-preorder">Pre-order</span>}
                </Link>
                <div className="public-card-body">
                  <Link to={`paddle/${product.id}`}>
                    <div className="public-card-name"><span>{product.brand}</span><h2>{product.name}</h2></div>
                  </Link>
                  {shipsIn && <p className="public-card-shipsin">{shipsIn}</p>}
                  <div className="public-card-meta">
                    <strong>{money(fromPrice)}</strong>
                    {singleChoice ? (
                      <button
                        type="button"
                        className={`public-quick-add ${justAddedThis ? "is-added" : ""}`}
                        aria-label={available(singleChoice) ? `Add ${product.name} to cart` : `Pre-order ${product.name}`}
                        onClick={() => {
                          addToCart(product, singleChoice, 1);
                          setJustAdded(product.id);
                          window.setTimeout(() => setJustAdded((current) => (current === product.id ? null : current)), 1600);
                        }}
                      >
                        {justAddedThis ? <Check size={15} /> : <Plus size={15} />}
                      </button>
                    ) : (
                      <Link to={`paddle/${product.id}`} className="public-quick-add" aria-label={`Choose a colour for ${product.name}`}>
                        <Plus size={15} />
                      </Link>
                    )}
                  </div>
                  <button
                    type="button"
                    className={`public-compare-toggle ${compareIds.includes(product.id) ? "is-active" : ""}`}
                    disabled={!compareIds.includes(product.id) && compareIds.length >= MAX_COMPARE}
                    onClick={() => toggleCompare(product.id)}
                    aria-pressed={compareIds.includes(product.id)}
                  >
                    {compareIds.includes(product.id) ? <Check size={12} /> : null} Compare
                  </button>
                </div>
              </motion.article>
            );
          })}
        </motion.section>
      )}
      {status === "ready" && filtered.length === 0 && (
        <section className="public-state">
          <MagnifyingGlass size={28} />
          <h2>No matching paddles</h2>
          <p>Try another model or clear your filters.</p>
          <button type="button" onClick={() => { setSearch(""); setBrand("All brands"); setCategory("All"); }}>Show all paddles</button>
        </section>
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

  return (
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
              <span><b>{item.color}</b><small>{available(item) ? "In stock" : "Pre-order"}</small></span>
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
            {added ? "Added to cart" : available(choice) ? `Add ${choice?.color || "paddle"} to cart` : `Pre-order ${choice?.color || "this paddle"}`}
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
            {/* Only shows when the batch actually carrying this colour has a
                real date on file (api/v1/_shared.js's preorder object) —
                never a guessed range. */}
            {(choice?.preorder?.ships_in || choice?.preorder?.cutoff_date) && (
              <p className="public-preorder-eta">
                {choice.preorder.ships_in && (
                  <span><strong>Estimated ready:</strong> {choice.preorder.ships_in}</span>
                )}
                {choice.preorder.cutoff_date && formatEta(choice.preorder.cutoff_date) && (
                  <span>Order by {formatEta(choice.preorder.cutoff_date)} for this batch</span>
                )}
              </p>
            )}
            <p className="public-preorder-note">
              This colour ships once restocked — Paddle To Go imports in batches. Reserve it now with a 50%
              deposit and we'll confirm your pickup or shipping date after payment.
            </p>
          </>
        )}
        {added && (
          <Link to="../cart" className="public-secondary-link">View cart <ArrowRight size={13} /></Link>
        )}

        <div className="public-details-card public-details-plain">
          <h3>Details</h3>
          <dl>
            <div><dt>Brand</dt><dd>{product.brand}</dd></div>
            {product.category && <div><dt>Category</dt><dd>{product.category}</dd></div>}
            {choice?.sku && <div><dt>SKU</dt><dd>{choice.sku}</dd></div>}
            <div><dt>Deposit to reserve</dt><dd>{money((choice?.price || 0) / 2)}</dd></div>
          </dl>
        </div>

        {spec && (
          <div className="public-details-card">
            <h3>Technology</h3>
            <dl>
              <div><dt>Core</dt><dd>{spec.core}</dd></div>
              <div><dt>Surface</dt><dd>{spec.surface}</dd></div>
              <div><dt>Weight</dt><dd>{spec.weight}</dd></div>
            </dl>
          </div>
        )}
      </section>
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
        <span className="public-kicker">COMPARE</span>
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
              <span className={`public-inline-badge ${inStock ? "" : "is-preorder"}`}>
                {inStock ? "In stock" : "Pre-order"}
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
                      <small>{available(choice) ? "In stock" : "Pre-order"}</small>
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

  return (
    <main className="public-main">
      <section className="public-page-head public-page-head-compact">
        <span className="public-kicker">YOUR ORDER</span>
        <h1>Cart</h1>
      </section>

      {hasPreorder && (
        <div className="public-preorder-banner">
          <span className="public-preorder-banner-badge">Pre-order</span>
          <p>Your cart includes at least one pre-order item — it ships once restocked, same deposit and refund policy as any order.</p>
        </div>
      )}

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
          <div className="public-deposit"><span>Deposit to reserve</span><strong>{money(total / 2)}</strong><p>Exactly 50% is due now. The remaining {money(total / 2)} is due before pickup or shipping.</p></div>
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

  const preorderLines = cart.filter((line) => line.isPreorder);
  const hasPreorder = preorderLines.length > 0;

  return (
    <main className="public-main">
      <section className="public-page-head public-page-head-compact">
        <Link to="../cart" className="public-back-link" aria-label="Back to cart"><ArrowLeft size={16} /> Back to cart</Link>
        <span className="public-kicker">50% DEPOSIT · {money(total / 2)}</span>
        <h1>Checkout</h1>
      </section>

      {/*
        Only when the cart actually has a pre-order line — a mixed cart still
        gets this, since the pre-order item still needs the same heads-up.
        Each line's own real ships-in text (snapshotted at add-to-cart, same
        source as the PDP note), never one guessed figure for the whole cart.
      */}
      {hasPreorder && (
        <div className="public-preorder-banner">
          <span className="public-preorder-banner-badge">Pre-order</span>
          <div>
            <p>
              {preorderLines.length === 1
                ? `${preorderLines[0].name}${preorderLines[0].color && preorderLines[0].color !== "Standard" ? ` (${preorderLines[0].color})` : ""} is a pre-order.`
                : `${preorderLines.length} items in your cart are pre-orders.`}{" "}
              Same 50% deposit and refund policy as any order — Paddle To Go confirms your pickup or
              shipping date after payment.
            </p>
            {preorderLines.some((line) => line.preorder?.ships_in) && (
              <ul className="public-preorder-banner-list">
                {preorderLines
                  .filter((line) => line.preorder?.ships_in)
                  .map((line) => (
                    <li key={line.key}>
                      {line.name}
                      {line.color && line.color !== "Standard" ? ` (${line.color})` : ""} — {line.preorder.ships_in}
                    </li>
                  ))}
              </ul>
            )}
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
          <div className="public-deposit is-compact"><span>Pay now</span><strong>{money(total / 2)}</strong><p>The other {money(total / 2)} is due before fulfilment. Shipping is separate and confirmed if selected.</p></div>
        </aside>

        <form className="public-checkout-form" onSubmit={submit}>
          <Step number={1} title="Contact information">
            <label>Full name<input autoComplete="name" value={form.name} onChange={(event) => set("name", event.target.value)} required /></label>
            <label>Email<input type="email" autoComplete="email" value={form.email} onChange={(event) => set("email", event.target.value)} required /></label>
            <label>Phone<input type="tel" autoComplete="tel" value={form.phone} onChange={(event) => set("phone", event.target.value)} required /></label>
            <label>
              Facebook name or profile link
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
                  <label>Street address<textarea autoComplete="street-address" value={form.address} onChange={(event) => set("address", event.target.value)} required /></label>
                  <div className="public-address-grid">
                    <label>
                      Region
                      <select value={form.regionCode} onChange={(event) => setRegion(event.target.value)} disabled={!phAddress} required>
                        <option value="" disabled>{phAddress ? "Select region" : "Loading regions…"}</option>
                        {phAddress?.PH_REGIONS.map((region) => (
                          <option key={region.reg_code} value={region.reg_code}>{region.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      City / Municipality
                      <select value={form.cityCode} onChange={(event) => setCity(event.target.value)} disabled={!form.regionCode} required>
                        <option value="" disabled>{form.regionCode ? "Select city or municipality" : "Select region first"}</option>
                        {cityOptions.map((city) => (
                          <option key={city.mun_code} value={city.mun_code}>{city.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Barangay
                      <select value={form.barangay} onChange={(event) => set("barangay", event.target.value)} disabled={!form.cityCode} required>
                        <option value="" disabled>{form.cityCode ? "Select barangay" : "Select city first"}</option>
                        {barangayOptions.map((barangay) => (
                          <option key={barangay.name} value={barangay.name}>{barangay.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      ZIP code
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
                    Recipient name
                    <input
                      value={form.recipientSameAsContact ? form.name : form.recipientName}
                      onChange={(event) => set("recipientName", event.target.value)}
                      disabled={form.recipientSameAsContact}
                      required
                    />
                  </label>
                  <label>
                    Recipient phone
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
              <span>Downpayment due (50%)</span>
              <strong>{money(total / 2)}</strong>
              <p>Balance (due later): {money(total / 2)}</p>
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
              : `Place ${hasPreorder ? "pre-order" : "order"} · Pay ${money(total / 2)}`}{" "}
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

/** Order confirmation is its own route so it can be reloaded, bookmarked, or reopened from an email — not a modal that vanishes on refresh. */
function OrderConfirmation() {
  const { orderNumber } = useParams();
  const location = useLocation();
  const deposit = location.state?.deposit;

  return (
    <main className="public-main">
      <section className="public-state public-state-tall public-success-page">
        <div className="public-success-icon"><Check size={27} /></div>
        <span className="public-kicker">ORDER {orderNumber}</span>
        <h2>Your paddle is requested.</h2>
        <p>
          We received your order{deposit != null ? ` and ${money(deposit)} proof` : ""}. Paddle To Go will review it and confirm fulfilment.
        </p>
        <Link to="../.." className="public-state-link">Continue shopping</Link>
      </section>
    </main>
  );
}

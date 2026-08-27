import { useEffect, useRef } from "react";
import {
  BrowserRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Toaster } from "sonner";
import {
  ArrowClockwise,
  Boat,
  Camera,
  ChartPieSlice,
  Package,
  Receipt,
  SlidersHorizontal,
  Wallet,
  WarningCircle,
} from "@phosphor-icons/react";

import { BottomBar, Logo, Rail } from "./components/Nav";
import { Skeleton } from "./components/ui";
import { AuthGate } from "./components/AuthGate";
import { StoreProvider, useStore } from "./lib/store";
import { spring } from "./lib/motion";
import { M } from "./lib/calc";
import { PUBLIC_CATALOG_PATH } from "./lib/storefront";

import Dashboard from "./pages/Dashboard";
import Inventory from "./pages/Inventory";
import Orders from "./pages/Orders";
import Batches from "./pages/Batches";
import Payments from "./pages/Payments";
import Settings from "./pages/Settings";
import StorefrontPhotos from "./pages/StorefrontPhotos";
import PublicCatalog from "./pages/PublicCatalog";

/**
 * TAB ORDER IS THE APP'S SPATIAL MODEL. A page's index here decides which way
 * it travels: moving right along the bar slides the page left, and back moves
 * back. A new tab MUST be inserted at its visual position or direction breaks.
 *
 * THESE SIX ARE THE BOTTOM BAR, AND THE BOTTOM BAR IS FOR WHAT AN OPERATOR
 * TOUCHES EVERY SESSION. A phone bar with seven items gives each one 14% of the
 * width, which is how a thumb-sized target becomes a guess.
 */
const TABS = [
  { to: "/", label: "Dashboard", short: "Home", icon: ChartPieSlice },
  { to: "/inventory", label: "Inventory", short: "Stock", icon: Package },
  { to: "/orders", label: "Orders", short: "Orders", icon: Receipt },
  { to: "/batches", label: "Batches", short: "Batches", icon: Boat },
  { to: "/payments", label: "Payments", short: "Paid", icon: Wallet },
  { to: "/settings", label: "Settings", short: "Setup", icon: SlidersHorizontal },
];

/**
 * SECONDARY DESKS: real routes with real navigation, deliberately NOT in the
 * bottom bar. Photographing the shop is considered work reached from the
 * desktop rail, from Settings, and from the paddle it is about — never a
 * seventh thumb target competing with Orders.
 *
 * Emptying this list does NOT hide the desk, it strands it: the route stays
 * live and the two in-app links still reach it, but nothing on screen ever says
 * it exists. Out of the bottom bar and into the rail's own "Storefront" group
 * is the arrangement; off the navigation entirely is not.
 *
 * They still sit in the spatial model so direction stays information: this one
 * lands after Settings, so arriving slides forward and leaving slides back.
 */
const SECONDARY = [
  { to: "/storefront-photos", label: "Storefront photos", short: "Photos", icon: Camera },
];

/** Every routed page, in the order that decides which way a page travels. */
const ROUTE_ORDER = [...TABS, ...SECONDARY];

const indexOf = (pathname) => {
  const i = ROUTE_ORDER.findIndex((t) => t.to === pathname);
  return i === -1 ? 0 : i;
};

function AnimatedRoutes() {
  const location = useLocation();
  const reduce = useReducedMotion();
  const index = indexOf(location.pathname);
  const previous = useRef(index);
  const dir = index >= previous.current ? 1 : -1;

  useEffect(() => {
    previous.current = index;
    window.scrollTo(0, 0);
  }, [index, location.pathname]);

  return (
    <AnimatePresence mode="popLayout" initial={false} custom={dir}>
      <motion.main
        key={location.pathname}
        custom={dir}
        initial={reduce ? { opacity: 0 } : { opacity: 0, x: dir * 26 }}
        animate={{ opacity: 1, x: 0 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, x: dir * -26 }}
        transition={reduce ? { duration: 0.001 } : spring}
        className="pb-bar mx-auto w-full min-w-0 max-w-3xl px-4 pt-4 lg:max-w-4xl lg:px-8 lg:pt-8"
      >
        <Routes location={location}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/batches" element={<Batches />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/storefront-photos" element={<StorefrontPhotos />} />
          <Route path="*" element={<Dashboard />} />
        </Routes>
      </motion.main>
    </AnimatePresence>
  );
}

/** Loading is shaped like the dashboard it becomes, not a spinner. */
function LoadingState() {
  return (
    <div className="pb-bar mx-auto w-full min-w-0 max-w-3xl px-4 pt-4 lg:max-w-4xl lg:px-8 lg:pt-8">
      <Skeleton className="h-7 w-full max-w-[12rem]" />
      <Skeleton className="mt-2 h-4 w-full max-w-[16rem]" />
      <div className="mt-5 grid grid-cols-2 gap-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[86px]" />
        ))}
      </div>
      <Skeleton className="mt-5 h-[172px]" />
      <Skeleton className="mt-3 h-[120px]" />
      <span className="sr-only">Loading your ledger</span>
    </div>
  );
}

/** Error is designed too: what happened, that nothing was lost, and a way out. */
function ErrorState({ message, onRetry }) {
  return (
    <div className="pb-bar mx-auto flex w-full max-w-md flex-col items-center px-6 pt-20 text-center sm:pt-24">
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-clay-wash text-clay">
        <WarningCircle size={24} />
      </div>
      <h1 className="mt-3 text-balance text-[19px] font-semibold">The ledger did not load</h1>
      <p className="mt-1.5 text-eta leading-relaxed text-ink-2">
        {message || "Something got between this app and its database."} Your data is safe on the
        server, nothing was lost.
      </p>
      <button type="button" className="btn-primary mt-5" onClick={onRetry}>
        <ArrowClockwise size={17} />
        Try again
      </button>
    </div>
  );
}

function RateBadge() {
  const { settings, status } = useStore();
  if (status !== "ready") return "…";
  return `₱1=${Math.round(M(settings.php_to_vnd_rate)).toLocaleString()}₫`;
}

function Shell() {
  const { status, error, refresh } = useStore();
  const location = useLocation();
  const tab = ROUTE_ORDER[indexOf(location.pathname)];

  return (
    <div className="flex min-h-svh w-full overflow-x-clip bg-paper">
      {/* The rail carries every desk; the bottom bar carries only the six. */}
      <Rail tabs={TABS} secondary={SECONDARY} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Translucent chrome, content scrolls underneath. */}
        <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-xl lg:hidden">
          <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-2.5 xs:gap-2.5">
            <Logo />
            <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">
              {/* The title travels rather than cutting. */}
              <motion.span
                key={tab.label}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={spring}
                className="inline-block max-w-full truncate align-bottom"
              >
                {tab.label}
              </motion.span>
            </h1>
            <span className="num max-w-[45%] shrink-0 truncate whitespace-nowrap rounded-full border border-line bg-surface px-2 py-1 text-[11px] text-ink-2">
              <RateBadge />
            </span>
          </div>
        </header>

        {status === "loading" && <LoadingState />}
        {status === "error" && (
          <ErrorState message={error} onRetry={() => refresh().catch(() => {})} />
        )}
        {status === "ready" && <AnimatedRoutes />}
      </div>

      <BottomBar tabs={TABS} />
    </div>
  );
}

/**
 * THE PUBLIC PRICE LIST IS A SEPARATE APP THAT HAPPENS TO SHARE A BUNDLE.
 *
 * The path is stable and must not change: /public/paddles-7x4k is what gets
 * pasted into a chat. A trailing slash is the same list, not a 404 back to the
 * dashboard.
 *
 * It is decided here, ABOVE StoreProvider, on purpose. The console's store
 * loads every table in the ledger — orders, payments, batches, costs — on
 * mount, so wrapping the catalog in it would pull the whole business into a
 * stranger's browser even though nothing rendered it. Deciding before the
 * provider means those queries are never issued on this route at all. The
 * Toaster, the nav and the admin chrome stay out for the same reason.
 *
 * The path itself lives in `lib/storefront.js`, the leaf module both sides of
 * the wall can import — the admin's "View storefront" links need it and must
 * not reach into this file to get it.
 */
export { PUBLIC_CATALOG_PATH };

const isPublicCatalog = (pathname) =>
  pathname === PUBLIC_CATALOG_PATH || pathname === `${PUBLIC_CATALOG_PATH}/`;

function Admin() {
  return (
    <AuthGate>
      <StoreProvider>
        <BrowserRouter>
          <Shell />
          <Toaster
            position="top-center"
            offset={12}
            toastOptions={{
              style: {
                background: "#FFFFFF",
                border: "1px solid #E3E0DA",
                borderRadius: "10px",
                color: "#1C1A18",
                fontFamily: '"Schibsted Grotesk Variable", system-ui, sans-serif',
                fontSize: "14px",
                boxShadow: "0 1px 2px rgba(28,26,24,0.04), 0 8px 24px rgba(28,26,24,0.08)",
              },
            }}
          />
        </BrowserRouter>
      </StoreProvider>
    </AuthGate>
  );
}

export default function App() {
  if (isPublicCatalog(window.location.pathname)) return <PublicCatalog />;
  return <Admin />;
}

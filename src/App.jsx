import { Suspense, lazy } from "react";

import { PUBLIC_CATALOG_PATH } from "./lib/storefront";

/**
 * Lazy, not eager, on purpose: this file is the one place the admin console
 * and the public storefront branch apart (see `App()` below). An eager
 * import of either side here puts its whole module graph — the admin
 * console's AuthGate/StoreProvider/framer-motion/sonner/@supabase-js, or the
 * storefront's own catalog code — into the bundle the OTHER side's visitor
 * has to download too, even though `isPublicCatalog` guarantees only one of
 * them ever renders per visit. That was the real weight behind Lighthouse's
 * "190 KiB unused JavaScript" finding on `/public/...`: AdminApp used to be
 * defined directly in this file, so its imports were eager no matter which
 * branch below actually ran. Splitting it into its own lazy-loaded module
 * (AdminApp.jsx, which further lazy-loads each individual admin page) is
 * what actually keeps that code out of a storefront shopper's bundle.
 */
const PublicCatalog = lazy(() => import("./pages/PublicCatalog"));
const AdminApp = lazy(() => import("./AdminApp.jsx"));

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

// Prefix match, not exact: a product detail page like
// /public/paddles-7x4k/paddle/12 is still the storefront, not the admin app.
const isPublicCatalog = (pathname) =>
  pathname === PUBLIC_CATALOG_PATH || pathname.startsWith(`${PUBLIC_CATALOG_PATH}/`);

/**
 * Domains meant to be handed out as "the shop's own address" — visiting the
 * bare root on one of these should land a shopper straight in the catalog,
 * not on the admin sign-in screen. Everything else (ptg-admin-hub.vercel.app,
 * localhost during dev) keeps its existing root = admin behavior; this list
 * only redirects hosts explicitly added to it.
 */
const STOREFRONT_HOSTNAMES = new Set(["shop-paddletogo.vercel.app"]);

export default function App() {
  if (isPublicCatalog(window.location.pathname)) {
    // Bare fallback, not AdminApp's LoadingState — that skeleton is shaped
    // like the admin dashboard and would flash the wrong page's silhouette
    // here, and importing it would defeat the point of this split anyway.
    return (
      <Suspense fallback={null}>
        <PublicCatalog />
      </Suspense>
    );
  }
  if (window.location.pathname === "/" && STOREFRONT_HOSTNAMES.has(window.location.hostname)) {
    window.location.replace(PUBLIC_CATALOG_PATH);
    return null;
  }
  return (
    <Suspense fallback={null}>
      <AdminApp />
    </Suspense>
  );
}

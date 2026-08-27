# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two distinct audiences on one codebase:

- **Public storefront shopper**: a pickleball player anywhere in the Philippines, discovering Paddle To Go's paddle lineup for the first time (not assumed to already know the brand). Comparison-shopping against other paddle sellers in the country. No account system — they browse, pick a model and colour, and reserve it with a 50% deposit.
- **Admin (internal, single operator)**: the business owner running inventory, orders, batches, and payments through the authenticated admin console. Out of scope for storefront design work but shares the same live database.

## Product Purpose

Paddle To Go imports pickleball paddles from real brands (Selkirk, JOOLA, Kamito, Honolulu, RPM, Wika, Sypik, Franklin, and others) in small batches from Vietnam, and sells them direct to Philippine players. The public storefront lets a shopper see live price and availability and reserve a paddle with a 50% deposit — no account required. Success is a completed reservation the admin can review and fulfil (pickup or shipping).

## Positioning

Direct import at landed cost, real stock, fair price — not a reseller markup and not counterfeit. What a shopper is actually trusting: the paddle they see live-priced here is a genuine unit already accounted for in a real batch, not a listing padded with fake availability.

## Operating Context

- Inventory arrives in **batches** imported from Vietnam; the admin tracks exchange rates, shipping, and landed-cost allocation per batch. Stock is genuinely limited per batch and **does sell out** — the storefront is expected to show many "sold out" paddles at any given time, and that is not a bug or an empty state to hide.
- Checkout collects contact info, fulfilment choice (pickup arranged after review, or shipping with a fee confirmed later), a 50% deposit via QR payment (MariBank / PayPal / InstaPay), and a required non-refundable/non-cancellable acknowledgment.
- The storefront and admin share one live Postgres/Supabase database through a dedicated public API (`api/v1/catalog.js`, `api/v1/orders.js`) that never exposes real stock counts, cost, or admin-only fields — only "available"/"unavailable" per colour.
- No login, no cart account, no order history/tracking page exists today for shoppers.

## Capabilities and Constraints

- Real per-product colour variants, each with independent price and availability.
- No product-level "specs" data exists (no core material, weight, shape, etc.) — only name, brand (parsed from name), category, SKU, price, and colour variants. Product detail content must not fabricate specifications.
- Almost no product photography exists yet — most catalog rows currently render a placeholder. Two real, on-brand photo assets exist and are usable: `public/images/kit-flatlay.webp` (studio flatlay: paddle, cover, grip tape, overgrips) and `public/images/triton-approved.webp` (a specific Sypik Triton product shot — usable only where that exact product is genuinely being shown, not as generic decoration). A real brand banner (`public/images/ptg-court-banner.png`) carries the logo, wordmark, social handles, location, and the full brand-partner lineup.
- No customer reviews, ratings, or testimonials exist. None may be fabricated.

## Brand Commitments

- Name: **Paddle To Go** (PTG). Logo mark and wordmark exist as real assets (`ptg-logo-header.png`, `ptg-logo-inverse.png`).
- Palette: forest green + teal (`--forest #123d36`, `--teal #0b7775`), explicitly chosen over a prior pastel pink/olive reference the user rejected. This is a settled constraint, not open for redesign.
- Location: Cagayan de Oro, Philippines. Social presence: Facebook "Paddle To Go PH", Instagram "@paddletogo_ph".
- Brand partners actually carried: Wika, RPM, Selkirk, Honolulu, Kamito, Joola, Sypik (plus Franklin, Zocker seen in current inventory).

## Evidence on Hand

- Live inventory/pricing/availability via the real admin database (not sample data).
- Real photography: `kit-flatlay.webp`, `triton-approved.webp`, `ptg-court-banner.png`.
- No testimonials, review counts, or trust-badge numbers exist — any "X happy customers" style claim would be fabricated and must not appear.

## Product Principles

- Never fabricate: no fake specs, no fake reviews, no fake stock, no invented urgency. Sold-out is a true, expected, frequent state, not something to disguise.
- The storefront and the admin's real data must never visibly diverge — price, availability, and variants shown to a shopper are the same row the admin sees.
- No account, no login, no friction beyond the checkout form itself.
- Design must read as a real, confident retail brand, not a generic templated shop — but every visual claim has to be backed by a real asset or real data, given how little photography currently exists.

## Accessibility & Inclusion

No product-specific requirement has been established beyond standard web accessibility (keyboard focus, contrast, reduced-motion already respected in existing checkout/cart implementation).

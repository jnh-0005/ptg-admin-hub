# Handoff — Storefront product workflows, checkout, and storefront domain

Written 2026-08-27, end of the session that followed
[`handoff-2026-08-27-storefront-visual.md`](handoff-2026-08-27-storefront-visual.md)
(the visual redesign of browse). That doc's "what's next" was cart/checkout —
this session did that, plus a pre-order model, a compare feature, real
sourced specs, a desktop product page, and giving the storefront its own
public domain. Everything below is committed and deployed; nothing is
pending review.

## Where things stand

- **Committed and deployed**: `main` is at `418ebda`, live on
  `ptg-admin-hub.vercel.app`. Every commit in this session's range
  (`2bcb9c0..418ebda`, ~23 commits) is on GitHub and live — this project
  auto-deploys to production on every push to `main` via Vercel's Git
  integration. There is no separate "deploy when ready" step anymore; a push
  is a deploy.
- Build passes, all 38 tests pass (`npm test -- --run`).
- **Two public URLs now**, same app, same deployment:
  - `ptg-admin-hub.vercel.app` — admin console, gated by Supabase auth,
    unchanged.
  - `shop-paddletogo.vercel.app` — the storefront's own domain (see
    "Storefront domain" below). Root `/` redirects into the shop
    automatically on this host only.

## What changed this session

### Pre-order model (was: sold out = dead end)

PTG imports every paddle in batches, so zero stock was never really
"unavailable" — it just meant "not in this batch." The storefront used to
treat `quantity: 0` as unbuyable; now it's a pre-order:

- Storefront: a `Pre-Order` badge instead of `Sold Out`; Add to Cart / PDP
  CTA stays enabled and relabels to "Pre-order {colour}"; a note explains
  the 50% deposit reserves it and PTG confirms a date after payment.
- Backend (`api/v1/_shared.js` `createOrder`): the stock-availability check
  now only rejects a line when there **is** real stock and the requested
  quantity exceeds it. A zero-stock line always passes — there's no live
  count to exceed. Covered by 3 new tests in `api/v1/_shared.test.js`.
- `docs/storefront-api-v1.md` updated to document this rule.

### Compare feature

Per-card "Compare" toggle (max 3), a floating bottom bar, and a `/compare`
route with a real-fields comparison table: Category / Brand / Price /
Colours, plus a **Specifications** section built from sourced real specs
(next section) — never a fabricated Performance/score section, unlike the
Dribbble/PickleClub references this was built against.

The floating bar is now scoped to only the shop grid and product pages —
explicitly hidden on `/compare` itself, `/cart`, `/checkout`, and
`/order/:id`, where it was just noise competing with the real CTA.

### Real manufacturer specs, sourced not fabricated

`PADDLE_SPECS` / `specFor()` in `PublicCatalog.jsx` carries real core/
surface/weight data researched per model (Selkirk.com, JustPaddles, RPM
Pickleball, Pickleheads, Pickle Times, bnbpickleball.com — see git history
for the full source list per model). A model with no confident source match
("Joola IV" doesn't match any real JOOLA model) is left out entirely — no
spec section shows, rather than a guessed one. This population feeds both
the product page's "Technology" card and the compare table's
"Specifications" rows.

### Desktop product page

960px+ only — mobile is untouched. Real two-column layout: sticky image +
a thumbnail row on the left (one real photo per colour variant, doubling as
the colour picker at this width), info panel on the right. Deliberately
dropped everything fabricated in the Dribbble grocery-PDP reference this was
built against: star ratings, a countdown timer, "N sold in last X hours,"
Klarna installments, generic delivery/deal promo boxes — none of that data
exists for PTG. What carried over used only real fields (SKU, category,
deposit, the sourced Specifications section, a real "Add to compare" link).
The right-panel hierarchy was tightened once (title/price stacked, colour
picker as compact pills, Details un-boxed to plain lines) after the first
pass read as too many stacked bordered cards.

### Checkout overhaul

Full-flow rebuild against the pickleclubdavao.com reference, adapted to
real PTG fields/process only:

- **Order summary is first** in the DOM (so it's what a visitor sees first
  when checkout stacks on mobile), and stays a sticky right-hand sidebar on
  desktop via CSS `order` — not a DOM change, so both "summary first" and
  "keep the sidebar" requests are satisfied at once.
- **Contact info** gained a required Facebook name/profile link field, used
  to match a buyer's Messenger message to their order.
- **Fulfilment → Shipping** gained real structured PH address dropdowns —
  Region → City/Municipality → Barangay, sourced from the
  `phil-reg-prov-mun-brgy` npm package (real PSGC data: 17 regions, 1,627
  cities, 41,582 barangays), plus a ZIP field and a Recipient section ("Same
  as contact info" toggle + recipient name/phone).
  - The PH address dataset is **lazy-loaded** (`import()`) only once someone
    picks Shipping — it's a genuine 1.7MB/269KB-gzip chunk (`phAddress-*.js`
    in the build output) and no reason for a Pickup buyer to download it.
- **New "Payment summary" step** recapping subtotal/downpayment/balance
  inline in the form flow, between Fulfilment and Scan to pay.
- **New required Messenger step** after Proof of payment: a real deep link
  to PTG's actual Facebook Page — `https://m.me/61593396870812` (from
  `facebook.com/profile.php?id=61593396870812`, the exact URL the user
  gave) — plus a confirmation checkbox.
- **Every field is genuinely required end-to-end**: HTML `required` plus
  matching `submit()`-time validation for name/email/phone/Facebook
  contact, the complete shipping address including recipient, proof of
  payment, the Messenger-sent checkbox, and the final acknowledgment.
  Confirmed via `form.checkValidity() === false` with any field empty —
  submission is genuinely blocked, not just visually discouraged.
- Both checkboxes (Messenger-sent, non-refundable acknowledgment) are
  reworded from the reference, not copied.
- **Backend**: `customer.facebook` and `customer.recipient` are new
  optional fields on `POST /api/v1/orders`, additive only — appended to
  `orders.notes` (no new column, no contract break, an old client that
  never sends them still gets the original note text).

### Payment QR codes

Replaced the placeholder PayPal/InstaPay entries (one of which pointed at a
file that didn't exist in the repo) with PTG's three real payment QR images
— MariBank, GCash, GoTyme Bank — supplied by the user, at
`public/images/payment-{maribank,gcash,gotyme}.jpg`.

### Bread and Butter brand fix

`brandOf()` (`src/lib/storefront.js`) used a first-word-only rule, so
"Bread and Butter Loco" grouped under "Bread" everywhere that shared
function is read from — the storefront (card, PDP, compare, brand filter,
marquee) **and** the admin's `StorefrontPhotos.jsx` page, since both import
the same function. Fixed with a whole-phrase exception (same pattern as the
existing Honolulu J2CR/J6CR one), so every surface agrees on the real
two-word brand name from one place. Also added the brand's real logo
(supplied by the user) to the marquee, processed to match every sibling
mark exactly — solid white on transparent, using the source file's own real
alpha channel.

### Storefront domain

The storefront now has its own public address, separate from the admin
console's:

- `shop-paddletogo.vercel.app` is a Vercel alias pointing at the same
  deployment as `ptg-admin-hub.vercel.app`.
- It required disabling the project's Vercel SSO/Deployment Protection
  (`vercel project protection disable ptg-admin-hub --sso`, run by the user
  directly — the environment's own safety classifier correctly blocked me
  from running a security-setting change unattended). This does **not**
  weaken admin access: the admin console's real protection is Supabase auth
  (`AuthGate.jsx`), completely independent of Vercel's layer, and
  `ptg-admin-hub.vercel.app` was already publicly reachable (gated only by
  Supabase login) before and after this change. What actually changed is
  that preview/branch deployment URLs — previously gated behind a Vercel
  account login — are now viewable without one. Production URLs are
  unaffected either way.
- `App.jsx` now redirects `/` to the storefront **only** on hostnames in a
  `STOREFRONT_HOSTNAMES` allowlist (currently just
  `shop-paddletogo.vercel.app`); every other host, including
  `ptg-admin-hub.vercel.app` and localhost, keeps root = admin console
  exactly as before.

**Known limitation, not yet automated**: `shop-paddletogo.vercel.app` is a
manually-set alias (`vercel alias set ptg-admin-hub.vercel.app
shop-paddletogo.vercel.app`), not a tracked project domain — `.vercel.app`
subdomains can't be added via `vercel domains add` (confirmed:
`invalid_domain`). It does **not** automatically follow new deployments the
way `ptg-admin-hub.vercel.app` does. Every future deploy needs that alias
command re-run afterward, or the storefront domain will silently start
serving a stale build. If a future session's deploy checklist doesn't
already include this, add it back.

### Small fixes worth knowing about

- **Systemic CSS specificity bug, hit repeatedly**: `.public-shell
  button{font:inherit}` and `.public-shell a{color:inherit}` are global
  resets at (class + type) specificity, which silently beat any
  single-class button/link style like `.public-primary{color:#fff}`
  whenever the reset and the style tie in specificity and the reset happens
  to win the source-order tiebreak — or, for the button case, always wins
  since a bare `.foo` class alone is lower specificity than `.public-shell
  button`. Every fix this session followed the same pattern: qualify the
  selector with its element type (`button.public-primary,
  a.public-primary`), never remove the global reset. Hit and fixed on:
  the compare-toggle button, the compare-bar link, the compare-clear
  button, the product-compare-link button, and — the most consequential
  one — Cart's "Continue to checkout" button, which was rendering
  genuinely invisible dark-on-dark-gradient text. **A follow-up task was
  filed and is still open** (`task_2a1669ae` if still findable, or search
  for "link-color specificity" in past session chips) to audit every
  remaining single-class link/button style in `public.css` for the same
  bug — `.public-cart-link` was confirmed already silently affected (renders
  `--ink`, not the `--forest` its own rule declares) before this session
  ended without a dedicated sweep.
- Cart page: a single item used to render inside a hugely oversized empty
  box on desktop — `.public-cart-layout` was missing `align-items:start`,
  so CSS Grid's default stretch matched the cart-lines list to the taller
  sidebar's height, and the one line (no explicit row sizing) stretched to
  fill it.
- Route changes didn't reset scroll position (React Router doesn't do this
  automatically) — following "View cart" from partway down a tall page
  used to land on Cart at that same scroll offset. Fixed with a `useEffect`
  in `Layout` keyed on `location.pathname`.
- Product-page breadcrumb hidden on mobile only (redundant with the
  circular back-arrow there); kept on desktop, where the back-arrow is
  hidden and the breadcrumb is the only way back.
- Mobile compare grid: 1–2 selected paddles now center as a capped-width
  row instead of stretching wall-to-wall or sitting stuck in the left half;
  3 selected fit on one row (was 2 + a wrapped 3rd card).
- Compare table: the label column and product columns are now **both**
  percentages of the table width (`LABEL_PCT` constant), not a mix of fixed
  px + percentage — the mix demanded >100% of the table's width at 3
  columns and caused visible column overlap.

## Known non-issues (don't re-investigate)

- Everything already listed as a known non-issue in the two prior handoff
  docs still applies (admin login cold-start slowness, the two deleted
  stray banner files).
- **Two production outages this session, both self-inflicted by a
  Supabase-Vercel marketplace integration, both fixed**: `DATABASE_URL` and
  then `SUPABASE_URL`/`SUPABASE_ANON_KEY` were found silently blanked to
  empty strings on Vercel (visible in `vercel env ls` as present but
  empty), breaking the storefront catalog and admin login respectively.
  Both were root-caused by adding error logging to the previously-silent
  catch blocks (`api/v1/catalog.js`, `api/query.js` — that logging was kept
  permanently), then fixed by removing and re-adding the two env vars with
  correct values. **If either breaks again with no corresponding code
  change, check `vercel env ls` for an empty-looking value before looking
  anywhere else** — this pattern has now happened twice.

## What's next

Nothing was explicitly deferred this session — checkout, compare, pre-order,
and the storefront domain were the full scope of "storefront product
workflows," and all of it shipped. Candidates for a future session, in
rough priority order:

1. **The link-color specificity audit** (see above) — a real, confirmed,
   but not-yet-swept bug class.
2. **Product photography** — every paddle still shows "Photo coming soon."
   Real photos exist as an admin workflow (`StorefrontPhotos.jsx`,
   approval queue) but nothing has been approved yet for any paddle in this
   catalog.
3. **Durable idempotency storage** for `POST /api/v1/orders` — flagged as
   an open item in `docs/storefront-api-v1.md` since the original API
   design doc, still not implemented (in-memory only, safe for a single
   function instance, not for real multi-instance production traffic).
4. Automate the `shop-paddletogo.vercel.app` alias re-sync on deploy
   (see "Storefront domain" above) so it can't silently go stale.

## Things to never re-do

Everything in both prior handoffs' "never re-do" lists still applies
(no unauthenticated `/api/query`-style endpoint, no `DATABASE_URL`/password
in chat, no SQLite-dialect fixes outside `api/_db.js`, no fabricated visual
content, no guessing a redesign direction cold). Add from this session:

- **Don't invent geographic, brand, or business-process data.** The PH
  address dataset, the payment QR images, the Facebook Page link, and the
  Bread & Butter logo are all real data the user supplied or a real public
  dataset — never approximate one of these categories from memory.
- **Don't remove a CSS reset to fix a specificity bug.** `.public-shell
  button{font:inherit}` and `.public-shell a{color:inherit}` exist on
  purpose; the fix is always to raise the specific rule's specificity
  (add the element type to the selector), never to weaken the shared reset.
- **Don't run a Vercel security/protection-setting change unattended** —
  the environment's safety classifier will (correctly) block it. Give the
  user the exact command and let them run it themselves, as happened with
  `vercel project protection disable --sso` this session.
- **Don't forget the storefront alias after a deploy** — see the "known
  limitation" note above. It is not automatic yet.

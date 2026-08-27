/**
 * THE STOREFRONT PHOTO SYSTEM'S LEAF MODULE.
 *
 * This file imports NOTHING but the bundled picture files themselves. That is
 * deliberate: the public shop needs the photo precedence, the safe-URL
 * guarantee and the asset resolution, and it must never import `data.js` or
 * `schema.js`, whose `initDb()` would migrate the shared database from a
 * shopper's browser. Both sides of the wall read the rules from here, so the
 * console and the shop can never disagree about which photo wins — or about
 * which URL a stored path actually renders as.
 */

/**
 * THE SHOP'S STABLE PATH, AND IT LIVES HERE BECAUSE EVERYONE NEEDS IT AND
 * NOBODY MAY IMPORT `App.jsx` TO GET IT. This is what gets pasted into a chat,
 * so it never changes; a trailing slash is the same page. The admin's "View
 * storefront" links point at this constant rather than at an invented short
 * URL, so the link can never rot.
 */
export const PUBLIC_CATALOG_PATH = "/public/paddles-7x4k";
export const PUBLIC_SHOP_PATH = `${PUBLIC_CATALOG_PATH}#shop`;

const HOSTED_URL_RE = /^https?:\/\/[^\s<>"'\\]+$/i;
/**
 * A SAME-ORIGIN DEPLOYED IMAGE, UNDER EITHER OF THE TWO DIRECTORIES THE BUILD
 * ACTUALLY SERVES ONE FROM. `/images/…` is a file copied verbatim out of
 * `public/`; `/assets/…` is one Vite fingerprinted into the deployed bundle.
 * Both are the same thing to a browser — a path on this origin that answers
 * with a picture — so admitting only the first is what makes an APPROVED photo
 * stored as a deployed asset path resolve to `null` and render as the court-mark
 * placeholder, with nothing on any screen saying why.
 *
 * The tail is still an explicit image extension and the pattern is still
 * anchored in full, so this widens WHERE a same-origin picture may live without
 * widening WHAT may be pointed at: `/assets/main.js`, `/assets/x.svg` and every
 * off-origin or non-image scheme stay refused, and a leading `//` — which is a
 * protocol-relative address to ANOTHER host, not a local path — still cannot
 * match, because the character after the directory must be alphanumeric.
 */
const STORED_ASSET_RE = /^\/(?:images|assets)\/[a-z0-9][a-z0-9._/-]*\.(?:png|jpe?g|webp|avif)$/i;
// Local uploads are resized to a compact preview before they reach SQLite.
// Keeping the bound under this ceiling prevents the driver's argument-length
// failure while preserving a real photo for the public card.
const INLINE_IMAGE_RE = /^data:image\/(?:webp|jpeg|jpg|png);base64,[a-z0-9+/=]+$/i;
const MAX_PHOTO_URL_CHARS = 160000;
const MAX_HOSTED_URL_CHARS = 2000;

/**
 * Only a short hosted address or a deployed same-origin asset is ever stored,
 * so a typo can never become a `javascript:` src and an image pasted in as
 * text (`data:` / `blob:`) can never bloat a row every visitor loads.
 * Both shapes are anchored in full — writing them as one alternation with `$`
 * outside the group makes `https?://` match the bare scheme and rejects every
 * real URL, which is exactly the bug this comment exists to prevent.
 */
export function safePhotoUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > (INLINE_IMAGE_RE.test(raw) ? MAX_PHOTO_URL_CHARS : MAX_HOSTED_URL_CHARS)) return null;
  return HOSTED_URL_RE.test(raw) || STORED_ASSET_RE.test(raw) || INLINE_IMAGE_RE.test(raw)
    ? raw
    : null;
}

/** An image pasted as text is not an address, and it is refused as one. */
export const isInlineImageData = (value) =>
  /^(blob:|filesystem:)/i.test(String(value ?? "").trim()) ||
  (/^data:/i.test(String(value ?? "").trim()) && !INLINE_IMAGE_RE.test(String(value ?? "").trim()));

export const MAX_STORED_CHARS = MAX_PHOTO_URL_CHARS;

/* ------------------------------------------------------------ deployed art */

/**
 * WHAT IS STORED IS WHAT IS SERVED, AND THAT IS THE WHOLE POINT.
 *
 * A stored photo is one of three addresses: a hosted `https://…` URL, a
 * same-origin `/images/…` file, or a compacted `data:image/…` the picker
 * produced. None of the three needs translating, because none of them is a
 * BUNDLED asset any more.
 *
 * That is a deliberate reversal. This module used to `import` a paddle
 * photograph so a picked file could be stored as a short path, which meant
 * Vite fingerprinted the picture into `/assets/<name>-<hash>.png` and every
 * stored `/images/…` path had to be mapped to the hash before it could render.
 * The mapping was one bug (a fingerprinted URL handed back in was rejected by
 * the `/images/…` pattern and the photo vanished), and the picture itself was
 * another: 1.6MB shipped TWICE, once fingerprinted into the JS bundle's asset
 * graph and once verbatim out of `public/images/`, for a file no database row
 * ever referenced.
 *
 * Deleting the import deletes both. A `/images/…` path is served straight out
 * of `public/` at exactly the address it is stored as, so the resolver has
 * nothing left to translate and is now only the safety boundary. It stays as a
 * named function because it is still the ONE place a stored address becomes a
 * renderable one, and every caller — mapped rows, inventory fallbacks, the
 * shop's own product wells — goes through it.
 *
 * It remains IDEMPOTENT: resolving an already-resolved address returns it,
 * because callers legitimately resolve twice.
 */
export function resolvePhotoAssetUrl(value) {
  return safePhotoUrl(value);
}

export const KNOWN_BRANDS = [
  "Franklin",
  "Kamito",
  "Selkirk",
  "Boomstick",
  "Omni",
  "RPM",
  "Zocker",
  "Triton",
  "Joola",
];

export const HOUSE_BRAND = "Paddle To Go";

/**
 * A MODEL CODE THAT IS ITS OWN BRAND EVIDENCE, AND THE ONE EXCEPTION TO
 * "THE FIRST WORD IS THE BRAND".
 *
 * The ledger carries the same two paddles under two spellings: `Honolulu J2CR
 * Crystal` / `Honolulu J6CR`, and the shorter `J2CR Crystal` / `J6CR`. The
 * first-word rule files the short pair under `J2CR` and the house brand
 * respectively, so ONE shop would show three pills — `Honolulu`, `J2CR` and
 * `Paddle To Go` — for what a customer knows as one brand.
 *
 * The repair belongs HERE and never in the data: renaming the rows would mean
 * writing to `inventory`, which is exactly what a brand-grouping fix must not
 * do — those names are on invoices, order lines, movements and approved
 * `storefront_photos` identity keys, and a rename silently breaks every one of
 * them plus the folk chat agent reading the old shape.
 *
 * The set is keyed on the FIRST WORD, lowercased, so `J6CR`, `j6cr` and
 * `J2CR Crystal` all resolve while the stored name stays untouched — the shop
 * renders `Honolulu · J2CR Crystal`, and `modelLabel()` trims nothing because
 * the name does not begin with the brand.
 *
 * It is deliberately a SET OF TWO MODEL CODES, not a rule: it is checked
 * BEFORE `KNOWN_BRAND_BY_KEY` and before the first-word fallback, so it can
 * only ever capture these exact two codes. `Sypik Triton 5` still groups under
 * `Sypik`, `Selkirk Omni Clay` under `Selkirk`, and every future brand still
 * groups itself off its own leading word with no code change.
 */
export const HONOLULU_MODELS = new Set(["j2cr", "j6cr"]);
export const HONOLULU_BRAND = "Honolulu";
const KNOWN_BRAND_BY_KEY = new Map(KNOWN_BRANDS.map((brand) => [brand.toLowerCase(), brand]));

/**
 * A second model-code-style exception, same shape as the Honolulu one above:
 * "Bread and Butter" is the brand's real two-word name (its own logo reads
 * "Bread & Butter Pickleball Co."), so the plain first-word rule would file
 * "Bread and Butter Loco" under "Bread" alone — which is exactly the bug
 * this fixes. Checked as a whole-phrase prefix before the single-word
 * fallback, so "Bread and Butter <anything>" always groups as one brand
 * instead of three (Bread / and / Butter) or the wrong one (Bread).
 */
const KNOWN_BRAND_PHRASES = [{ prefix: "bread and butter", brand: "Bread and Butter" }];

/**
 * Inventory names are the source of truth for storefront grouping. Keep the
 * legacy known-brand spellings, but also accept any new admin-entered brand
 * when it is written as the leading word of a multi-word product name. This
 * makes names such as "Honolulu J6CR" and "Sypik Triton 5" appear as their
 * actual brands without requiring a code change for every future brand.
 */
export function brandOf(name) {
  const value = String(name || "").trim();
  if (!value) return HOUSE_BRAND;
  const lowerValue = value.toLowerCase();
  for (const { prefix, brand } of KNOWN_BRAND_PHRASES) {
    if (lowerValue === prefix || lowerValue.startsWith(`${prefix} `)) return brand;
  }
  const parts = value.split(/\s+/);
  const firstKey = parts[0].toLowerCase();
  // The model-code exception runs FIRST, so a bare `J6CR` reaches its brand
  // instead of falling to the house bucket one line further down.
  if (HONOLULU_MODELS.has(firstKey)) return HONOLULU_BRAND;
  const known = KNOWN_BRAND_BY_KEY.get(firstKey);
  if (known) return known;
  /**
   * The split, not `includes(" ")`, decides whether a name is multi-word: a
   * name separated by a tab or a newline is still two words, and testing for a
   * literal space alone files "Honolulu\tJ6CR" under the house brand while the
   * very next name spelled with a space groups correctly.
   */
  return parts.length > 1 ? parts[0] : HOUSE_BRAND;
}

export function brandsOf(products = []) {
  const seen = new Set(products.map((p) => brandOf(p?.name)));
  const named = Array.from(seen).filter((b) => b !== HOUSE_BRAND).sort();
  return seen.has(HOUSE_BRAND) ? [...named, HOUSE_BRAND] : named;
}

/* --------------------------------------------------------------- identity */

/**
 * A photo is mapped to one of three IDENTITIES, and the table's CHECK
 * constraint allows only two `identity_type` values (`model`, `brand`). A
 * colour is therefore stored as a `model` row with `::` inside the key, and
 * `splitIdentity` is the one reader of that separator.
 */
const SEP = "::";

export const modelIdentity = (name) => String(name || "").trim();

/**
 * A blank colour collapses to the MODEL key rather than producing a dangling
 * `Model::`, which would be a row nothing could ever resolve and a photo
 * silently lost in the table.
 */
export const colorIdentity = (name, color) => {
  const model = String(name || "").trim();
  const shade = String(color || "").trim();
  return shade ? `${model}${SEP}${shade}` : model;
};

export const brandIdentity = (brand) => String(brand || "").trim();

export function splitIdentity(key) {
  const raw = String(key || "");
  const at = raw.indexOf(SEP);
  if (at === -1) return { model: raw.trim(), color: null };
  return { model: raw.slice(0, at).trim(), color: raw.slice(at + SEP.length).trim() || null };
}

/** Which of the three scopes a stored row actually addresses. */
export function scopeOf(row) {
  if (row?.identity_type === "brand") return "brand";
  return String(row?.identity_key || "").includes(SEP) ? "color" : "model";
}

/** The three scopes the upload form offers, in precedence order. */
export const IDENTITY_SCOPES = [
  {
    id: "color",
    stored: "model",
    label: "Colour",
    noun: "a colour",
    labelField: "Which colour",
    help: "The most specific. Used for that one colour only.",
  },
  {
    id: "model",
    stored: "model",
    label: "Model",
    noun: "a model",
    labelField: "Which model",
    help: "Every colour of this paddle, unless a colour has its own photo.",
  },
  {
    id: "brand",
    stored: "brand",
    label: "Brand",
    noun: "a brand",
    labelField: "Which brand",
    help: "The safety net. Catches every paddle of the brand you have not shot.",
  },
];

export const PHOTO_SOURCE_LABEL = {
  color: "This colour's own shop photo",
  model: "The model's shop photo",
  brand: "The brand's fallback photo",
  inventory: "The inventory photo the invoice uses",
};

/** Approval state, and what it means for the shop. */
export const APPROVAL = {
  approved: { label: "Approved", tone: "teal", help: "Live on the public storefront." },
  pending: { label: "Pending approval", tone: "plum", help: "Uploaded, not public yet." },
  private: { label: "Private", tone: "gray", help: "Removed from the shop, kept on record." },
};

/**
 * A row's state as the desk speaks it. `active` STILL DECIDES ALONE what the
 * shop shows; `approval_status` only records WHY a row is off it, so a photo
 * nobody has approved reads differently from one somebody retired.
 */
export function approvalStateOf(row) {
  if (row?.pending_photo_url && safePhotoUrl(row.pending_photo_url)) return "pending";
  if (Number(row?.active) === 1) return "approved";
  if (row?.approval_status === "pending") return "pending";
  return "private";
}

/* ------------------------------------------------------------- precedence */

const norm = (s) => String(s ?? "").trim().toLowerCase();

/**
 * The lookup the shop and the desk both read. Only APPROVED, live rows are
 * indexed — a pending photo is unreachable from here by construction, which is
 * how "the shop never shows an unapproved photo" is enforced rather than
 * remembered.
 */
export function buildStorefrontIndex(rows = []) {
  const model = new Map();
  const brand = new Map();
  for (const row of rows) {
    if (Number(row?.active) !== 1) continue;
    // Resolved as it is indexed, so a mapped row holding the compact
    // `/images/…` path renders the fingerprinted asset the bundle serves.
    const url = resolvePhotoAssetUrl(row?.photo_url);
    if (!url) continue;
    const key = norm(row.identity_key);
    if (!key) continue;
    (row.identity_type === "brand" ? brand : model).set(key, url);
  }
  return { model, brand };
}

/**
 * THE ONE PLACE THE PRECEDENCE EXISTS. Returns `{ url, source }`, in order:
 *
 *   1. the exact colour   — a `model` row keyed "Model::Colour"
 *   2. the whole model    — a `model` row keyed "Model"
 *   3. the whole brand    — a `brand` row keyed "Brand"
 *   4. and only then the inventory photo the console already had.
 *
 * `source` is what lets a screen SAY which rule won rather than leaving staff
 * to work it out from the result.
 */
export function resolveStorefrontPhoto(index, { name, color, brand, fallback } = {}) {
  const models = index?.model;
  const brands = index?.brand;

  if (color && models) {
    const hit = models.get(norm(colorIdentity(name, color)));
    if (hit) return { url: hit, source: "color" };
  }
  if (models) {
    const hit = models.get(norm(modelIdentity(name)));
    if (hit) return { url: hit, source: "model" };
  }
  if (brands) {
    const hit = brands.get(norm(brandIdentity(brand ?? brandOf(name))));
    if (hit) return { url: hit, source: "brand" };
  }
  /**
   * The inventory photo goes through the SAME resolver a mapped row does.
   * Validating it with `safePhotoUrl` alone is what used to strand it: a
   * caller that had already resolved the path handed in a fingerprinted
   * `/assets/…` URL, the `/images/…` pattern rejected it, and the paddle lost
   * a photograph it actually had.
   */
  const own = resolvePhotoAssetUrl(fallback);
  return own ? { url: own, source: "inventory" } : { url: null, source: null };
}

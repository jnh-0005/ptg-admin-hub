import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useSearchParams } from "react-router-dom";
import {
  ArrowSquareOut,
  Check,
  ClockCountdown,
  ImageSquare,
  LinkSimple,
  Plus,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import clsx from "clsx";

import Tray, { ConfirmTray, MorphLabel, useOrigin, useSticky } from "../components/Tray";
import {
  Chip,
  EmptyState,
  Field,
  FilterChips,
  Input,
  RollingNumber,
  Section,
  Select,
  SegmentedPills,
  listChild,
  listParent,
} from "../components/ui";
import { useStore } from "../lib/store";
import { isArchived } from "../lib/data";
import { isAddon } from "../lib/schema";
import { stockUnits, unitLabel } from "../lib/calc";
import {
  APPROVAL,
  IDENTITY_SCOPES,
  MAX_STORED_CHARS,
  PHOTO_SOURCE_LABEL,
  brandIdentity,
  brandOf,
  brandsOf,
  colorIdentity,
  isInlineImageData,
  modelIdentity,
  PUBLIC_SHOP_PATH,
  resolveStorefrontPhoto,
  safePhotoUrl,
  scopeOf,
  splitIdentity,
} from "../lib/storefront";
import { haptic, spring } from "../lib/motion";

/**
 * THE SHOP'S PHOTO DESK. One photo, one identity, one approval.
 *
 * This screen exists so the buyer-facing line-up can be photographed properly
 * WITHOUT touching inventory: nothing here writes a quantity, a cost, a price
 * or an order. It writes `storefront_photos` and nothing else.
 *
 * It is deliberately NOT a bottom-bar tab. The bar carries the six things an
 * operator touches every session; photographing the shop is a considered piece
 * of work reached from the desktop rail, from Settings, and from the paddle it
 * is about — which is also the only place where "which paddle" is already
 * answered.
 *
 * What it reveals up front is one thing: the line-up, with the photo each entry
 * is CURRENTLY getting and where that photo came from. Everything else is a
 * tray, opened from the row it is about.
 */

/**
 * A PICKED PHOTO IS COMPACTED BEFORE IT IS STORED, AND COMPACTION IS THE ONLY
 * PATH A FILE TAKES.
 *
 * The picker is the primary path, and the operator is photographing paddles on
 * a phone, so requiring a hosted address first would stop the work dead. The
 * file's bytes therefore ARE read — once, through `compactImage` — but they are
 * downscaled and re-encoded to WebP before anything reaches form state, so what
 * lands in a table every visitor loads stays small enough to be a bound SQLite
 * argument. `MAX_STORED_CHARS` is the ceiling that enforces it.
 *
 * There is deliberately NO name-matching short-circuit to a bundled
 * `/images/…` picture any more. That shortcut existed so one specific paddle
 * photo could be stored as a short path, and it cost 1.6MB of deployed payload
 * shipped twice — once fingerprinted into the bundle's asset graph, once
 * verbatim out of `public/` — for a file no database row ever referenced. Every
 * picked file now goes down the same road, which is also the road that was
 * already carrying every real upload.
 */

/**
 * A SAME-ORIGIN DEPLOYED PATH is still a valid STORED address — it is just not
 * one we mint any more. It is matched under BOTH directories the build serves a
 * picture from (`/images/…` copied out of `public/`, `/assets/…` fingerprinted
 * into the bundle) for the same reason `safePhotoUrl` admits both: a mapping
 * holding either shape has to read as a real photo here, or the form reports
 * "Take or choose a photo" while that photo's own preview sits under it and
 * unfolds the hosted-address field with a path pasted into a text input.
 */
const isStoredAssetRef = (value) => /^\/(?:images|assets)\//i.test(String(value ?? "").trim());

/**
 * WHAT THE PICKER PRODUCES, in either of its two shapes. The compact WebP the
 * resizer returns is just as much "a photo off this phone" as a same-origin
 * path is, and every control that asks "did they pick something?" has to accept
 * both — testing only for `/images/…` is what made a resized photo report
 * itself as nothing chosen while its own preview sat directly underneath. A
 * mapping made before this change still holds an `/images/…` path, so both
 * shapes stay readable here for as long as such a row can exist.
 */
const isPickedPhoto = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return false;
  return (isStoredAssetRef(raw) || /^data:image\//i.test(raw)) && !!safePhotoUrl(raw);
};

/**
 * The compaction ladder. A modern phone shoots 12MP, which is far past the
 * ceiling even as WebP, so one pass at one size is not a guarantee — it is a
 * coin flip that lands the operator on "that image is still too large" with no
 * way forward. Each rung halves the work: 720px at q0.72 is the intended
 * result, and the smaller rungs exist only so an enormous source still ends up
 * stored rather than refused.
 */
const COMPACT_STEPS = [
  { max: 720, quality: 0.72 },
  { max: 640, quality: 0.66 },
  { max: 512, quality: 0.6 },
  { max: 420, quality: 0.55 },
];

/** Resize a phone image before storing it, keeping the SQLite argument small. */
function compactImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("That image could not be read."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("That image could not be decoded."));
      image.onload = () => {
        const canvas = document.createElement("canvas");
        let smallest = "";
        for (const { max, quality } of COMPACT_STEPS) {
          const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const ctx = canvas.getContext("2d");
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          // WebP is the target; a browser that cannot encode it answers with a
          // PNG data URL, which `safePhotoUrl` accepts just the same.
          const data = canvas.toDataURL("image/webp", quality);
          smallest = data;
          if (withinStoreLimit(data)) {
            resolve(data);
            return;
          }
        }
        reject(
          new Error(
            `That photo is still ${Math.round(smallest.length / 1000).toLocaleString()}k after resizing. Choose a smaller one.`,
          ),
        );
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/** A stored photo is a bound argument, so the ceiling is characters. */
const withinStoreLimit = (value) => String(value ?? "").length <= MAX_STORED_CHARS;

/** A refusal stated as "too long" tells nobody what to do next. */
const storeLimitMessage = (chars) =>
  `That address is ${chars.toLocaleString()} characters, over the ${MAX_STORED_CHARS.toLocaleString()} the shop stores. Paste a short link to the image, not the image itself.`;

/** How each source reads on a row, and whether it counts as covered. */
const SOURCE_CHIP = {
  color: { tone: "cobalt", label: "Own photo" },
  model: { tone: "cobalt", label: "Model photo" },
  brand: { tone: "plum", label: "Brand photo" },
  inventory: { tone: "gray", label: "Inventory photo" },
  null: { tone: "clay", label: "No photo" },
};

const FILTERS = [
  { value: "All", match: () => true },
  { value: "Awaiting me", match: (r) => !!r.pending },
  { value: "No photo", match: (r) => r.source === null },
  { value: "Falling back", match: (r) => r.source === "brand" || r.source === "inventory" },
  { value: "Own photo", match: (r) => r.source === "color" || r.source === "model" },
];

/**
 * WHAT A WAITING PHOTO IS FOR, IN THE OPERATOR'S OWN WORDS. A stored key is
 * "Model", "Model::Colour" or a brand; the queue says which of the three and
 * names it, so approving is never a guess about what will change.
 */
function targetOf(row) {
  const scope = scopeOf(row);
  if (scope === "brand") {
    return { scope, title: row.identity_key, kind: "Every paddle of this brand" };
  }
  const { model, color } = splitIdentity(row.identity_key);
  return scope === "color"
    ? { scope, title: unitLabel(model, color), kind: "This colour only" }
    : { scope, title: model, kind: "Every colour of this model" };
}

/**
 * THE SQUARE CROP, AND IT IS THE SAME CROP THE SHOP USES. `aspect-square` plus
 * `object-cover` here and on the storefront means the preview an operator
 * approves is framed exactly like the tile a customer sees.
 *
 * A photo well NEVER STAYS STUCK LOADING: every path out is covered — onLoad,
 * onError, an image already decoded when the effect ran (a cached src fires no
 * event at all), and a watchdog for a host that neither answers nor fails.
 */
const IMAGE_TIMEOUT_MS = 12000;

function Thumb({ src, alt = "", className, size = "row" }) {
  const [broken, setBroken] = useState(false);
  const imgRef = useRef(null);

  useEffect(() => {
    setBroken(false);
    if (!src) return undefined;
    const node = imgRef.current;
    if (node?.complete) {
      if (node.naturalWidth === 0) setBroken(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setBroken(true), IMAGE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [src]);

  const show = src && !broken;
  return (
    <span
      className={clsx(
        "grid shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-paper",
        size === "row" && "h-14 w-14",
        size === "lg" && "h-[68px] w-[68px]",
        size === "fill" && "aspect-square w-full",
        className,
      )}
    >
      {show ? (
        <img
          ref={imgRef}
          key={src}
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={(e) => {
            if (e.currentTarget.naturalWidth === 0) setBroken(true);
          }}
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <svg viewBox="0 0 32 32" fill="none" className="h-1/3 w-1/3 text-ink-4" aria-hidden="true">
          <circle cx="11" cy="11" r="2.8" fill="currentColor" />
          <circle cx="21" cy="11" r="2.8" fill="currentColor" opacity=".45" />
          <circle cx="11" cy="21" r="2.8" fill="currentColor" opacity=".45" />
          <circle cx="21" cy="21" r="2.8" fill="currentColor" />
        </svg>
      )}
    </span>
  );
}

export default function StorefrontPhotos() {
  const { products, derived, storefrontPhotos, storefrontIndex, commit, busy } = useStore();
  const [search, setSearch] = useSearchParams();
  /**
   * ARRIVING FROM A PADDLE MEANS ARRIVING AT THAT PADDLE. The Inventory tray
   * links here with `?model=`, and the desk narrows to it rather than dropping
   * the operator into the whole line-up to find it again. It is a narrowing,
   * not a mode: one tap says what it is and gets out of it.
   */
  const focusModel = search.get("model");

  /**
   * THE QUEUE IS EXACTLY WHAT SOMEBODY UPLOADED AND NOBODY HAS APPROVED. A
   * mapping that was deliberately removed is off the shop too, but it is not
   * waiting on anyone, so it stays out of here.
   */
  const pendingPhotos = useMemo(
    () => storefrontPhotos.filter((p) => p.pending),
    [storefrontPhotos],
  );

  const pendingByKey = useMemo(() => {
    const map = new Map();
    for (const p of pendingPhotos) {
      map.set(`${p.identity_type}\u0000${String(p.identity_key).trim().toLowerCase()}`, p);
    }
    return map;
  }, [pendingPhotos]);

  const [filter, setFilter] = useState("All");
  const [editing, setEditing] = useState(null); // null | { scope, key, url, label, existing }
  const [removing, setRemoving] = useState(null);
  const [approving, setApproving] = useState(null);
  const [origin, captureOrigin] = useOrigin();

  const stickyEditing = useSticky(editing);
  const stickyRemoving = useSticky(removing);
  const stickyApproving = useSticky(approving);

  /**
   * A row's pending shot, if one is waiting for it. The colour's own proposal
   * first, then its model's — the same order the shop resolves in, so the badge
   * on a row names the photo that will actually land on it when approved.
   */
  const pendingFor = (name, color) => {
    const at = (key) => pendingByKey.get(`model\u0000${key.trim().toLowerCase()}`);
    return (color ? at(colorIdentity(name, color)) : undefined) || at(modelIdentity(name)) || null;
  };

  /** The buyer-facing line-up, exactly as the shop flattens it: one per colour. */
  const rows = useMemo(() => {
    const live = products.filter((p) => !isArchived(p) && !isAddon(p));
    return stockUnits(live, derived.variantsByProduct).map((unit) => {
      const brand = brandOf(unit.name);
      const resolved = resolveStorefrontPhoto(storefrontIndex, {
        name: unit.name,
        color: unit.color,
        brand,
        fallback: unit.photo_url,
      });
      return { unit, brand, ...resolved, pending: pendingFor(unit.name, unit.color) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, derived.variantsByProduct, storefrontIndex, pendingByKey]);

  const visible = useMemo(() => {
    const match = (FILTERS.find((f) => f.value === filter) ?? FILTERS[0]).match;
    const focused = focusModel
      ? rows.filter((r) => r.unit.name.toLowerCase() === focusModel.trim().toLowerCase())
      : rows;
    // A model that has since been renamed or archived must not leave the
    // operator staring at an empty desk: the narrowing simply does not apply.
    return (focused.length ? focused : rows).filter(match);
  }, [rows, filter, focusModel]);

  const focusApplies =
    !!focusModel && rows.some((r) => r.unit.name.toLowerCase() === focusModel.trim().toLowerCase());

  /** Coverage counts a real shop photo, not the old inventory one. */
  const covered = rows.filter((r) => r.source && r.source !== "inventory").length;

  const brandRows = useMemo(
    () => storefrontPhotos.filter((p) => p.identity_type === "brand" && p.state !== "private"),
    [storefrontPhotos],
  );

  /** Every identity a mapping can point at, grouped by the scope that offers it. */
  const options = useMemo(() => {
    const live = products.filter((p) => !isArchived(p) && !isAddon(p));
    const units = stockUnits(live, derived.variantsByProduct);
    return {
      color: units
        .filter((u) => u.color)
        .map((u) => ({ value: colorIdentity(u.name, u.color), label: unitLabel(u.name, u.color) })),
      model: live.map((p) => ({ value: modelIdentity(p.name), label: p.name })),
      brand: brandsOf(live).map((b) => ({ value: brandIdentity(b), label: `${b} — every paddle` })),
    };
  }, [products, derived.variantsByProduct]);

  const openFor = (event, seed) => {
    captureOrigin(event);
    setEditing(seed);
  };

  /** The row this identity ALREADY has, live or waiting. */
  const existingFor = (key) =>
    storefrontPhotos.find(
      (p) =>
        p.identity_type === "model" &&
        String(p.identity_key).trim().toLowerCase() === key.trim().toLowerCase(),
    ) || null;

  const openForRow = (event, row) => {
    // A colour maps to its colour, a paddle without colours maps to its model:
    // the tray opens already knowing what it is about.
    const scope = row.unit.color ? "color" : "model";
    const key = row.unit.color
      ? colorIdentity(row.unit.name, row.unit.color)
      : modelIdentity(row.unit.name);
    const own = existingFor(key);
    openFor(event, {
      scope,
      key,
      url: (own?.pending ? own.pending_photo_url : own?.photo_url) || "",
      label: own?.source_label || "",
      existing: own,
    });
  };

  const approve = async (photo) => {
    await commit((db) => db.approveStorefrontPhoto(photo.id));
    haptic(12);
    toast.success("Approved — the shop is showing it now");
    setApproving(null);
  };

  return (
    <motion.div variants={listParent} initial="hidden" animate="shown">
      <motion.header variants={listChild} className="mb-3 flex flex-wrap items-end gap-2">
        <div className="hidden min-w-0 flex-1 lg:block">
          <h1 className="text-[26px] font-semibold tracking-tight">Storefront photos</h1>
          <p className="mt-0.5 text-eta text-ink-2">
            What the public shop shows. Stock, costs and orders are never touched.
          </p>
        </div>
        {/*
          THE SHOP IS ONE TAP FROM THE DESK THAT FEEDS IT, and the link is the
          real route rather than an invented short URL, so it can never rot.
        */}
        <a
          href={PUBLIC_SHOP_PATH}
          target="_blank"
          rel="noreferrer"
          className="btn-quiet ml-auto shrink-0"
        >
          <ArrowSquareOut size={16} />
          View storefront
        </a>
        <button
          type="button"
          className="btn-primary shrink-0"
          onClick={(e) =>
            openFor(e, { scope: "color", key: "", url: "", label: "", existing: null })
          }
        >
          <Plus size={17} weight="bold" />
          Upload a photo
        </button>
      </motion.header>

      <motion.div variants={listChild} className="card px-3 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="eyebrow">Shop coverage</p>
          <p className="num text-eta text-ink-3">
            <RollingNumber value={String(covered)} /> / {rows.length}
          </p>
        </div>
        {/* The bar scales rather than repaints, so progress reads as movement. */}
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line-soft">
          <motion.div
            className="h-full origin-left rounded-full bg-cobalt"
            initial={false}
            animate={{ scaleX: rows.length ? covered / rows.length : 0 }}
            style={{ originX: 0 }}
            transition={spring}
          />
        </div>
        <p className="mt-2 text-micro leading-relaxed text-ink-3">
          A colour uses its own photo first, then its model's, then its brand's, and only then the
          inventory photo the invoice already uses.
        </p>
      </motion.div>

      {/*
        THE QUEUE COMES FIRST BECAUSE IT IS THE ONLY THING HERE WAITING ON A
        PERSON. It appears the moment something is uploaded and leaves the page
        entirely once nothing is pending — an empty queue is not a state worth a
        permanent panel.
      */}
      <AnimatePresence initial={false}>
        {pendingPhotos.length > 0 && (
          <motion.section
            layout
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring}
            className="overflow-hidden"
          >
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between gap-3 px-0.5">
                <h2 className="flex items-center gap-1.5 text-eta font-semibold">
                  <ClockCountdown size={16} weight="bold" className="text-plum" />
                  Pending approvals
                </h2>
                <Chip tone="plum">
                  <RollingNumber value={String(pendingPhotos.length)} /> waiting
                </Chip>
              </div>
              <p className="mb-2 px-0.5 text-micro leading-relaxed text-ink-3">
                Uploaded but not public. A customer sees none of these until you approve them.
              </p>
              <motion.ul
                layout
                variants={listParent}
                initial="hidden"
                animate="shown"
                className="grid gap-2 sm:grid-cols-2"
              >
                <AnimatePresence initial={false}>
                  {pendingPhotos.map((photo) => {
                    const target = targetOf(photo);
                    return (
                      <motion.li
                        key={photo.id}
                        layout
                        variants={listChild}
                        exit={{ opacity: 0, x: -16 }}
                        transition={spring}
                        className="flex items-center gap-3 rounded-lg border border-line bg-plum-wash p-2.5"
                      >
                        <Thumb src={photo.pending_photo_url} size="lg" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-eta font-medium">{target.title}</p>
                          <p className="mt-0.5 truncate text-micro text-ink-3">{target.kind}</p>
                          {photo.source_label && (
                            <p className="truncate text-micro text-ink-4">{photo.source_label}</p>
                          )}
                        </div>
                        {/*
                          THE PER-MODEL APPROVAL CONTROL. 44px of touch target on
                          a phone, named for the exact target it publishes.
                        */}
                        <button
                          type="button"
                          className="btn-primary min-h-[44px] shrink-0 px-3"
                          disabled={busy}
                          aria-label={`Approve the photo for ${target.title}`}
                          onClick={(e) => {
                            captureOrigin(e);
                            setApproving(photo);
                          }}
                        >
                          <Check size={16} weight="bold" />
                          Approve
                        </button>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </motion.ul>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <motion.div variants={listChild} className="mt-4">
        <FilterChips
          options={FILTERS.map((f) => f.value)}
          value={filter}
          onChange={setFilter}
          idPrefix="sfp"
        />
      </motion.div>

      {/*
        THE NARROWING SAYS SO, AND OFFERS THE WAY OUT IN THE SAME BREATH. It
        grows in on arrival rather than being there all along, so it reads as
        something that happened rather than part of the page.
      */}
      <AnimatePresence initial={false}>
        {focusApplies && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring}
            className="overflow-hidden"
          >
            <div className="mt-3 flex items-center gap-2.5 rounded-md border border-line bg-cobalt-wash px-3 py-2">
              <p className="min-w-0 flex-1 truncate text-micro text-ink-2">
                Showing <span className="font-semibold text-ink">{focusModel}</span> only
              </p>
              <button
                type="button"
                className="shrink-0 text-micro font-semibold text-cobalt"
                onClick={() => setSearch({}, { replace: true })}
              >
                <MorphLabel>Show every paddle</MorphLabel>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Section title="The line-up" className="mt-3">
        {visible.length === 0 ? (
          <EmptyState
            icon={filter === "Awaiting me" ? <Check size={20} /> : <ImageSquare size={20} />}
            title={
              rows.length === 0
                ? "No paddles to photograph"
                : filter === "Awaiting me"
                  ? "Nothing waiting on you"
                  : "Nothing in this view"
            }
            body={
              rows.length === 0
                ? "Add a paddle in Inventory and it appears here, ready for a shop photo."
                : filter === "Awaiting me"
                  ? "Every uploaded photo has been approved. Upload one and it waits here for you."
                  : "Every paddle is on the other side of this filter."
            }
            action={
              rows.length > 0 ? (
                <button type="button" className="btn-quiet w-full" onClick={() => setFilter("All")}>
                  <MorphLabel>Show the whole line-up</MorphLabel>
                </button>
              ) : null
            }
          />
        ) : (
          <motion.ul
            variants={listParent}
            initial="hidden"
            animate="shown"
            className="divide-y divide-line-soft overflow-hidden rounded-lg border border-line bg-surface shadow-card"
          >
            <AnimatePresence initial={false}>
              {visible.map((row) => {
                const chip = SOURCE_CHIP[row.source ?? "null"];
                return (
                  <motion.li key={row.unit.key} layout variants={listChild} exit={{ opacity: 0 }}>
                    <button
                      type="button"
                      onClick={(e) => openForRow(e, row)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150 active:bg-paper"
                    >
                      {/* The square crop, so the row shows the shop's framing. */}
                      <Thumb src={row.url} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-eta font-medium">
                          {unitLabel(row.unit.name, row.unit.color)}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Chip tone={chip.tone}>{chip.label}</Chip>
                          {/* A waiting upload is said on the row it will land on. */}
                          {row.pending && <Chip tone="plum">Awaiting approval</Chip>}
                          <span className="truncate text-micro text-ink-3">
                            {row.source
                              ? PHOTO_SOURCE_LABEL[row.source]
                              : "The shop shows its placeholder"}
                          </span>
                        </span>
                      </span>
                    </button>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </motion.ul>
        )}
      </Section>

      <Section
        title="Brand fallbacks"
        action={
          <button
            type="button"
            className="text-eta font-medium text-cobalt"
            onClick={(e) =>
              openFor(e, { scope: "brand", key: "", url: "", label: "", existing: null })
            }
          >
            Add one
          </button>
        }
      >
        {brandRows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-4 py-5 text-center text-micro leading-relaxed text-ink-3">
            No brand photo yet. One is worth mapping: it catches every paddle of that brand you have
            not shot individually.
          </p>
        ) : (
          <motion.ul
            variants={listParent}
            initial="hidden"
            animate="shown"
            className="grid gap-2 sm:grid-cols-2"
          >
            <AnimatePresence initial={false}>
              {brandRows.map((row) => (
                <motion.li
                  key={row.id}
                  layout
                  variants={listChild}
                  exit={{ opacity: 0, x: -16 }}
                  transition={spring}
                  className="card flex items-center gap-3 p-2.5"
                >
                  <Thumb src={row.pending_photo_url || row.photo_url} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-eta font-medium">{row.identity_key}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Chip tone={APPROVAL[row.state].tone}>{APPROVAL[row.state].label}</Chip>
                      <span className="truncate text-micro text-ink-3">
                        {row.source_label || APPROVAL[row.state].help}
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Change the ${row.identity_key} brand photo`}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-sm text-cobalt transition-transform duration-150 active:scale-90"
                    onClick={(e) =>
                      openFor(e, {
                        scope: "brand",
                        key: row.identity_key,
                        url: (row.pending ? row.pending_photo_url : row.photo_url) || "",
                        label: row.source_label || "",
                        existing: row,
                      })
                    }
                  >
                    <ImageSquare size={18} />
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </motion.ul>
        )}
      </Section>

      <MapTray
        open={!!editing}
        seed={stickyEditing}
        options={options}
        index={storefrontIndex}
        origin={origin}
        busy={busy}
        onRemove={(row) => setRemoving(row)}
        onClose={() => setEditing(null)}
        onSave={async (values) => {
          await commit((db) => db.saveStorefrontPhoto(values));
          haptic(12);
          toast.success("Uploaded — waiting for your approval");
          setEditing(null);
        }}
      />

      {/*
        THE APPROVAL IS THE MOMENT THE PHOTO BECOMES PUBLIC, so it is asked for
        rather than assumed. Deliberately one short paragraph against the tall
        upload form, so the two read as different steps.
      */}
      <ConfirmTray
        open={!!approving}
        onClose={() => setApproving(null)}
        origin={origin}
        tone="primary"
        title="Publish this photo?"
        cancelLabel="Not yet"
        body={
          stickyApproving
            ? `${targetOf(stickyApproving).title} — ${targetOf(stickyApproving).kind.toLowerCase()}. Approving puts it on the public storefront straight away. No stock, cost or order changes.`
            : ""
        }
        confirmLabel="Approve it"
        onConfirm={() => approve(stickyApproving)}
      />

      <ConfirmTray
        open={!!removing}
        onClose={() => setRemoving(null)}
        origin={origin}
        title={stickyRemoving?.pending ? "Discard this upload?" : "Remove this photo?"}
        body={
          stickyRemoving?.pending
            ? "It never reached the shop, so nothing a customer sees changes. Upload another whenever you like."
            : "The shop falls back to the next photo it can find. No stock, cost or order changes."
        }
        confirmLabel={stickyRemoving?.pending ? "Discard it" : "Remove it"}
        onConfirm={async () => {
          await commit((db) => db.removeStorefrontPhoto(stickyRemoving.id));
          toast.success(stickyRemoving?.pending ? "Upload discarded" : "Photo removed");
          setRemoving(null);
          setEditing(null);
        }}
      />
    </motion.div>
  );
}

/**
 * ONE PHOTO, ONE IDENTITY, ONE SAVE. Deliberately taller than the confirmation
 * that can follow it, so the progression between the two is visible.
 */
function MapTray({ open, seed, options, index, origin, busy, onClose, onSave, onRemove }) {
  const reduce = useReducedMotion();
  const [scope, setScope] = useState("color");
  const [key, setKey] = useState("");
  const [url, setUrl] = useState("");
  const [assetUrl, setAssetUrl] = useState("");
  const [label, setLabel] = useState("");
  const [fileName, setFileName] = useState("");
  const [reading, setReading] = useState(false);
  /** The hosted-address escape hatch stays out of the way until it is asked for. */
  const [linkOpen, setLinkOpen] = useState(false);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!open || !seed) return;
    setScope(seed.scope);
    setKey(seed.key);
    // Nothing inline is ever carried back into the form, so a legacy row still
    // holding one opens as an empty photo field rather than re-submitting the
    // very thing this path exists to keep out.
    const seeded = isInlineImageData(seed.url) ? "" : seed.url;
    setUrl(seeded);
    setAssetUrl(seeded);
    setLabel(seed.label);
    setFileName("");
    setReading(false);
    setErrors({});
    // Re-opening a mapping made from a link shows that link; one made from the
    // picker stays on the picker. A compacted photo is a PICKED one, so it must
    // not unfold the address field and paste a data URL into a text input.
    setLinkOpen(!!seeded && !isPickedPhoto(seeded));
    if (fileRef.current) fileRef.current.value = "";
  }, [open, seed]);

  const scopeMeta = IDENTITY_SCOPES.find((s) => s.id === scope) ?? IDENTITY_SCOPES[0];
  const valid = safePhotoUrl(assetUrl || url);
  /** A picked photo: a stored asset reference, or a compacted phone photo. */
  const uploaded = isPickedPhoto(assetUrl);
  const list = options[scope] || [];

  /** Named the moment a target is picked, so the approval step is never abstract. */
  const approvalTarget = key
    ? targetOf({ identity_type: scopeMeta.stored, identity_key: key }).title
    : scopeMeta.noun;

  /**
   * What this photo REPLACES, said plainly: a colour photo overrides a model
   * one, a model photo overrides the brand. Staff should not have to work out
   * the precedence from the result.
   */
  const replaced = useMemo(() => {
    if (!key) return null;
    if (scope === "color") {
      const { model, color } = splitIdentity(key);
      const current = resolveStorefrontPhoto(index, { name: model, color, brand: brandOf(model) });
      return current.source && current.source !== "color" ? current : null;
    }
    if (scope === "model") {
      const current = resolveStorefrontPhoto(index, { name: key, brand: brandOf(key) });
      return current.source === "brand" ? current : null;
    }
    return null;
  }, [index, key, scope]);

  /**
   * THE FILE IS COMPACTED, NOT REJECTED. Every picked file — there is no longer
   * a special case for one that happens to share a name with a bundled picture
   * — is downscaled and re-encoded by `compactImage` before it is allowed
   * anywhere near form state, so SQLite never receives an oversized argument.
   */
  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    // The picker being dismissed is not an error, and must not wipe a photo
    // that is already chosen.
    if (!file) {
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setReading(true);
    setErrors((prev) => ({ ...prev, url: undefined }));
    try {
      if (!String(file.type || "").startsWith("image/")) {
        throw new Error("That is not an image file. Choose a photo.");
      }
      const compact = await compactImage(file);
      setUrl(compact);
      setAssetUrl(compact);
      setFileName(file.name);
      setLinkOpen(false);
      haptic(8);
    } catch (err) {
      setUrl("");
      setAssetUrl("");
      setFileName("");
      setErrors((prev) => ({ ...prev, url: err?.message || "That image could not be read." }));
      haptic([12, 40, 12]);
    } finally {
      setReading(false);
      // Choosing the SAME file twice must still fire a change event.
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!key) next.key = `Pick ${scopeMeta.noun} first.`;
    const candidate = String(assetUrl || url).trim();
    /*
      THE LAST GATE BEFORE THE DATABASE, in the order that gives the clearest
      refusal. An image pasted as text is named for what it is BEFORE the length
      check, so it never reads as "too long".
    */
    if (isInlineImageData(candidate)) {
      next.url = "That is the image itself, not an address. Paste a link to where it is hosted.";
    } else if (!withinStoreLimit(candidate)) {
      next.url = storeLimitMessage(candidate.length);
    } else if (!valid) {
      next.url = candidate
        ? "That address needs to start with https://"
        : "Choose a photo, or paste a hosted address.";
    }
    setErrors(next);
    if (Object.keys(next).length) {
      haptic([12, 40, 12]);
      return;
    }
    setSaving(true);
    try {
      // A NEW SHOT IS ALWAYS A PROPOSAL. There is no "publish now" switch here
      // on purpose: approving is its own deliberate step, against the picture
      // rather than against a form field.
      //
      // `valid` is what goes out, not the raw field: the only thing that can
      // reach the action is a value `safePhotoUrl` has already accepted.
      await onSave({
        identityType: scopeMeta.stored,
        identityKey: key,
        photoUrl: valid,
        sourceLabel: label,
      });
    } catch (err) {
      toast.error(err?.message || "Could not save that photo");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Tray
      open={open}
      onClose={onClose}
      origin={origin}
      title={seed?.existing ? "Change this photo" : "Upload a photo"}
      subtitle="Shop only. Inventory, costs and orders are untouched."
      footer={
        <div className="flex gap-2">
          {seed?.existing && (
            <button
              type="button"
              className="btn-quiet shrink-0 px-3 text-clay"
              aria-label="Remove this photo"
              onClick={() => onRemove(seed.existing)}
            >
              <Trash size={17} />
            </button>
          )}
          <button
            type="submit"
            form="storefront-photo-form"
            className="btn-primary flex-1"
            disabled={saving || busy || reading}
          >
            {/* One stem, three states: "Save for approval" → "Saving for approval…". */}
            <MorphLabel>
              {saving ? "Saving for approval…" : reading ? "Checking photo…" : "Save for approval"}
            </MorphLabel>
          </button>
        </div>
      }
    >
      <form id="storefront-photo-form" onSubmit={submit} className="space-y-3 pb-1 pt-1">
        <Field label="What is it for" hint={scopeMeta.help} group>
          <SegmentedPills
            label="Photo scope"
            idPrefix="sfp-scope"
            options={IDENTITY_SCOPES.map((s) => ({ value: s.id, label: s.label }))}
            value={scope}
            onChange={(next) => {
              setScope(next);
              setKey("");
              setErrors((prev) => ({ ...prev, key: undefined }));
            }}
          />
        </Field>

        <Field label={scopeMeta.labelField} error={errors.key} required>
          <Select
            value={key}
            error={!!errors.key}
            data-autofocus
            onChange={(e) => {
              setKey(e.target.value);
              setErrors((prev) => ({ ...prev, key: undefined }));
            }}
          >
            <option value="">Choose {scopeMeta.noun}</option>
            {list.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>

        {/*
          THE PICKER IS THE PRIMARY PATH. A phone opens its camera roll straight
          from here and the chosen photo is resized and re-encoded on the spot, so
          what gets stored stays small enough for a row every visitor loads. The
          label morphs through choosing → checking → chosen rather than swapping,
          so the same control reports its own progress.
        */}
        <Field
          label="Storefront photo"
          hint="Straight off this phone. Inventory photos stay exactly as they are."
          /* One message, under whichever control the operator is actually using. */
          error={linkOpen ? undefined : errors.url}
          required
        >
          <label
            className={clsx(
              "flex min-h-[52px] cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-3 text-eta font-medium transition-colors duration-150 active:scale-[0.99]",
              errors.url && !linkOpen
                ? "border-clay bg-clay-wash text-clay"
                : "border-cobalt bg-cobalt-wash text-cobalt",
            )}
          >
            <UploadSimple
              size={19}
              weight="bold"
              className={reading ? "animate-pulse" : undefined}
            />
            <span className="min-w-0 flex-1 truncate">
              <MorphLabel>
                {reading
                  ? "Checking photo…"
                  : fileName || (uploaded ? "Photo ready" : "Take or choose a photo")}
              </MorphLabel>
            </span>
            {uploaded && !reading && <Check size={17} weight="bold" />}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              aria-label="Choose a storefront photo from this device"
              onChange={handleFile}
            />
          </label>
        </Field>

        {/*
          The hosted address is the FALLBACK, so it stays folded away until it is
          asked for — the whole point is that nobody has to find a URL first.
        */}
        <div>
          {!linkOpen ? (
            <button
              type="button"
              className="flex items-center gap-1.5 px-0.5 text-micro font-medium text-cobalt"
              onClick={() => setLinkOpen(true)}
            >
              <LinkSimple size={14} weight="bold" />
              <MorphLabel>Use a hosted address instead</MorphLabel>
            </button>
          ) : (
            <motion.div
              initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, height: "auto" }}
              transition={reduce ? { duration: 0.001 } : spring}
              className="overflow-hidden"
            >
              <Field
                label="Hosted address"
                hint="only if the photo already lives online"
                error={errors.url}
              >
                <Input
                  type="url"
                  inputMode="url"
                  value={uploaded ? "" : url}
                  placeholder="https://…/paddle.jpg"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  error={!!errors.url}
                  onChange={(e) => {
                    const next = e.target.value;
                    // An image pasted in as text is refused where it happens, not
                    // two steps later at save.
                    const inline = isInlineImageData(next);
                    setUrl(next);
                    setAssetUrl(inline ? "" : next);
                    setFileName("");
                    setErrors((prev) => ({
                      ...prev,
                      url: inline
                        ? "That is the image itself, not an address. Paste a link to where it is hosted."
                        : undefined,
                    }));
                  }}
                />
              </Field>
            </motion.div>
          )}
        </div>

        {/*
          THE SQUARE CROP PREVIEW, and it GROWS IN the moment there is something
          to preview. It is the same aspect-square/object-cover framing the shop
          tile uses, so what is approved here is what a customer gets.
        */}
        <AnimatePresence initial={false}>
          {valid && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={reduce ? { duration: 0.001 } : spring}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-3 rounded-md border border-line bg-paper p-2.5">
                <Thumb src={valid} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="text-micro font-medium text-ink-2">Square crop preview</p>
                  <p className="mt-0.5 text-micro leading-relaxed text-ink-3">
                    Exactly how the shop tile frames it for {scopeMeta.noun}, once you approve it.
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* What it takes over from, only once it actually takes over something. */}
        <AnimatePresence initial={false}>
          {replaced && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={reduce ? { duration: 0.001 } : spring}
              className="overflow-hidden text-micro leading-relaxed text-ink-3"
            >
              <span className="block pt-0.5">
                Right now this shows {PHOTO_SOURCE_LABEL[replaced.source].toLowerCase()}. Once
                approved, this photo takes precedence over it.
              </span>
            </motion.p>
          )}
        </AnimatePresence>

        <Field label="Where it came from" hint="optional">
          <Input
            value={label}
            placeholder="e.g. supplier pack, shot 04"
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>

        {/*
          THE APPROVAL STEP, STATED BEFORE IT IS REACHED. Saving never publishes
          — the photo waits in the queue, named against the exact colour, model
          or brand it will land on, and one Approve puts it on the shop.
        */}
        <div className="flex gap-2.5 rounded-md border border-line bg-plum-wash p-2.5">
          <ClockCountdown size={18} weight="bold" className="mt-[1px] shrink-0 text-plum" />
          <p className="min-w-0 text-micro leading-relaxed text-ink-2">
            <span className="font-semibold text-ink">Saved as pending.</span> This photo goes to
            Pending approvals for{" "}
            <span className="font-medium text-ink-2">{approvalTarget}</span> and reaches the public
            storefront only when you approve it there.
            {seed?.existing?.active === 1 && " Until then, the shop keeps showing the photo it has."}
          </p>
        </div>

        <p className="flex gap-1.5 px-0.5 text-micro leading-relaxed text-ink-3">
          <span aria-hidden="true" className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink-4" />
          <span>
            Storefront photos are separate records from the inventory photo the invoice uses.
            Uploading, changing or removing one never alters stock, cost or any order.
          </span>
        </p>
      </form>
    </Tray>
  );
}

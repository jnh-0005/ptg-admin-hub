import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useDragControls,
  useReducedMotion,
} from "framer-motion";
import { CaretLeft, X } from "@phosphor-icons/react";
import clsx from "clsx";
import { spring, fade, haptic } from "../lib/motion";

/**
 * The tray is the container for everything transient in this app: one piece of
 * content or one primary action, opened from a trigger and animating OUT of it.
 *
 * Bottom sheet under sm, centered dialog above. Focus trapped, Escape closes
 * (only the topmost one, because trays nest), focus restored to the trigger,
 * body scroll locked by the first tray only, drag-to-dismiss on touch.
 */

const DepthContext = createContext({ depth: 0 });

/* The visual viewport, so the sheet sits above an open mobile keyboard. */
function syncViewport() {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  if (!vv) return;
  const s = document.documentElement.style;
  s.setProperty("--tray-vh", `${Math.round(vv.height)}px`);
  s.setProperty("--tray-vt", `${Math.round(vv.offsetTop)}px`);
}

if (typeof window !== "undefined") {
  syncViewport();
  window.visualViewport?.addEventListener("resize", syncViewport);
  window.visualViewport?.addEventListener("scroll", syncViewport);
  window.addEventListener("orientationchange", syncViewport);
}

let lockCount = 0;
function lockScroll() {
  lockCount += 1;
  if (lockCount === 1) document.documentElement.classList.add("tray-open");
}
function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) document.documentElement.classList.remove("tray-open");
}

export default function Tray({
  open,
  onClose,
  onBack,
  title,
  subtitle,
  origin,
  children,
  footer,
  wide = false,
  labelledBy,
}) {
  const reduce = useReducedMotion();
  const panelRef = useRef(null);
  const returnFocusTo = useRef(null);
  const depth = useContext(DepthContext).depth + 1;
  const headingId = useId();
  const dragControls = useDragControls();

  useEffect(() => {
    if (!open) return;
    returnFocusTo.current = document.activeElement;
    lockScroll();

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        // Only the topmost tray answers, because trays nest.
        e.stopPropagation();
        (onBack || onClose)?.();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll(
        'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    const t = setTimeout(() => {
      const panel = panelRef.current;
      const target = panel?.querySelector("[data-autofocus]") || panel;
      target?.focus?.({ preventScroll: true });
    }, 60);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      unlockScroll();
      clearTimeout(t);
      const back = returnFocusTo.current;
      if (back && typeof back.focus === "function") {
        setTimeout(() => back.focus({ preventScroll: true }), 0);
      }
    };
  }, [open, onClose, onBack]);

  /* The tray emerges FROM the thing that opened it. */
  const attach = (node) => {
    panelRef.current = node;
    if (!node || !origin) return;
    const rect = node.getBoundingClientRect();
    if (!rect.width) return;
    const x = Math.min(Math.max(origin.left + origin.width / 2 - rect.left, 0), rect.width);
    const y = Math.min(Math.max(origin.top + origin.height / 2 - rect.top, 0), rect.height);
    node.style.transformOrigin = `${x}px ${y}px`;
  };

  return (
    <AnimatePresence>
      {open && (
        <DepthContext.Provider value={{ depth }}>
          <div className="fixed inset-0 z-50" data-tray>
            <motion.button
              type="button"
              aria-label="Close"
              onClick={() => onClose?.()}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={fade}
              className="absolute inset-0 cursor-default bg-ink/40 backdrop-blur-[3px]"
              style={{ zIndex: 0 }}
            />

            <div
              className="pointer-events-none absolute inset-x-0 flex items-end justify-center sm:items-center"
              style={{ top: "var(--tray-vt, 0px)", height: "var(--tray-vh, 100svh)" }}
            >
              <motion.div
                ref={attach}
                role="dialog"
                aria-modal="true"
                aria-labelledby={labelledBy || headingId}
                tabIndex={-1}
                drag={reduce ? false : "y"}
                dragControls={dragControls}
                dragListener={false}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0.02, bottom: 0.5 }}
                onDragEnd={(_, info) => {
                  // Project the flick forward, don't judge the release point.
                  const projected = info.offset.y + (info.velocity.y / 1000) * 0.998 * 500;
                  if (projected > 120) onClose?.();
                }}
                initial={
                  reduce ? { opacity: 0 } : { opacity: 0, scale: origin ? 0.86 : 0.96, y: origin ? 0 : 24 }
                }
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, scale: origin ? 0.9 : 0.97, y: 16 }}
                transition={reduce ? { duration: 0.001 } : spring}
                className={clsx(
                  "pointer-events-auto relative z-10 flex max-h-[94%] w-full min-w-0 flex-col overflow-hidden",
                  "rounded-t-xl border border-line bg-surface shadow-tray",
                  "sm:max-h-[88%] sm:rounded-xl",
                  wide ? "sm:max-w-2xl" : "sm:max-w-md",
                )}
                style={{ touchAction: "pan-y" }}
              >
                <div
                  className="shrink-0 touch-none px-3 pb-3 pt-2.5 xs:px-4 sm:touch-auto sm:px-5 sm:pt-4"
                  onPointerDown={(e) => {
                    if (!reduce && !e.target.closest("button")) dragControls.start(e);
                  }}
                >
                  <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-line sm:hidden" />
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => (onBack ? onBack() : onClose?.())}
                      aria-label={onBack ? "Go back" : "Close"}
                      className="-ml-1 mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md text-ink-2
                                 transition-[background-color,transform] duration-150 active:scale-95 active:bg-paper"
                    >
                      {/* X for a first tray, back arrow for a nested one. */}
                      <motion.span
                        key={onBack ? "back" : "close"}
                        initial={{ rotate: onBack ? 90 : -90, opacity: 0 }}
                        animate={{ rotate: 0, opacity: 1 }}
                        transition={spring}
                        className="grid place-items-center"
                      >
                        {onBack ? <CaretLeft size={18} /> : <X size={18} />}
                      </motion.span>
                    </button>
                    <div className="min-w-0 flex-1 pt-1">
                      <h2
                        id={labelledBy || headingId}
                        className="break-words text-[17px] font-semibold leading-tight"
                      >
                        {title}
                      </h2>
                      {subtitle && (
                        <p className="mt-0.5 break-words text-eta text-ink-3">{subtitle}</p>
                      )}
                    </div>
                  </div>
                </div>

                <div
                  className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 xs:px-4 sm:px-5"
                  style={{ paddingBottom: footer ? "1rem" : "max(1rem, var(--safe-b))" }}
                >
                  {children}
                </div>

                {footer && (
                  <div
                    className="shrink-0 border-t border-line-soft bg-surface px-3 py-3 xs:px-4 sm:px-5"
                    style={{ paddingBottom: "max(0.75rem, var(--safe-b))" }}
                  >
                    {footer}
                  </div>
                )}
              </motion.div>
            </div>
          </div>
        </DepthContext.Provider>
      )}
    </AnimatePresence>
  );
}

/**
 * A confirmation is deliberately SHORT: one paragraph and two buttons, so it is
 * visibly a different height from the form that opened it.
 */
export function ConfirmTray({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  cancelLabel = "Keep it",
  onConfirm,
  tone = "danger",
  origin,
}) {
  const [working, setWorking] = useState(false);
  return (
    <Tray open={open} onClose={onClose} title={title} origin={origin}>
      <p className="pb-1 pt-1 text-[15px] leading-relaxed text-ink-2">{body}</p>
      <div className="mt-4 flex gap-2 pb-1">
        <button type="button" className="btn-quiet flex-1" onClick={onClose}>
          <MorphLabel>{cancelLabel}</MorphLabel>
        </button>
        <button
          type="button"
          className={clsx("flex-1", tone === "danger" ? "btn-danger" : "btn-primary")}
          disabled={working}
          data-autofocus
          onClick={async () => {
            setWorking(true);
            haptic(12);
            try {
              await onConfirm?.();
              onClose?.();
            } finally {
              setWorking(false);
            }
          }}
        >
          <MorphLabel>{working ? "Working…" : confirmLabel}</MorphLabel>
        </button>
      </div>
    </Tray>
  );
}

/**
 * A label whose meaning changes MORPHS letter by letter rather than swapping,
 * so shared stems (`Save order` → `Saving order…`) stay put while the rest moves.
 */
export function MorphLabel({ children, className }) {
  const reduce = useReducedMotion();
  const text = String(children ?? "");
  if (reduce) return <span className={className}>{text}</span>;
  return (
    <span className={clsx("inline-flex whitespace-pre", className)}>
      <AnimatePresence initial={false} mode="popLayout">
        {text.split("").map((char, i) => (
          <motion.span
            key={`${char}-${i}`}
            layout
            initial={{ opacity: 0, y: 6, filter: "blur(2px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -6, filter: "blur(2px)" }}
            // filter gets its own plain tween, not the shared spring below —
            // a spring can overshoot past its target on the way to settling
            // (that's the bounce y/opacity are here for), and overshooting
            // blur(0px) means a genuinely invalid negative blur radius for a
            // frame or two (e.g. blur(-0.002px)), which is what was showing
            // up as a console warning on every character of every morph.
            // blur has no meaningful "bounce" to lose by tweening it instead.
            transition={{ ...spring, stiffness: 500, filter: { type: "tween", duration: 0.15 } }}
            className="inline-block"
          >
            {char === " " ? "\u00A0" : char}
          </motion.span>
        ))}
      </AnimatePresence>
    </span>
  );
}

/**
 * Keeps the last non-null value while a tray animates out, so its content does
 * not blank out mid-exit.
 */
export function useSticky(value) {
  const last = useRef(value);
  if (value != null && value !== false) last.current = value;
  return value ?? last.current;
}

/** The rect of whatever was tapped, so the tray can emerge from it. */
export function useOrigin() {
  const [rect, setRect] = useState(null);
  return [
    rect,
    (event) => {
      const el = event?.currentTarget;
      if (el?.getBoundingClientRect) setRect(el.getBoundingClientRect());
    },
  ];
}

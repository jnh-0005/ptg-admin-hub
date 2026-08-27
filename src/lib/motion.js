/** The app's shared physics. One spring, so everything moves like one place. */

// Critically damped: settles fast, never wobbles. The default for all UI.
export const spring = { type: "spring", stiffness: 420, damping: 38, mass: 0.9 };

// The scrim only ever fades, so it uses the one non-spatial curve in the app.
export const fade = { duration: 0.18, ease: [0.32, 0.72, 0, 1] };

/** Staggered list entrance. Children travel up into place, they never pop. */
export const listParent = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.035, delayChildren: 0.02 } },
};

export const listChild = {
  hidden: { opacity: 0, y: 10 },
  shown: { opacity: 1, y: 0, transition: spring },
};

/** A short pulse on a real commit, never on every tap. */
export function haptic(pattern = 8) {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* a browser that refuses haptics is not an error */
    }
  }
}

/** Confetti, in the app's own palette. Reserved for finishing, never saving. */
export const CONFETTI_COLORS = ["#B4D633", "#1F5FE0", "#147D74", "#E3E0DA"];

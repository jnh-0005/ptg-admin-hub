import { NavLink, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import clsx from "clsx";
import { spring, haptic } from "../lib/motion";
import { useStore } from "../lib/store";
import { M } from "../lib/calc";

/** The PTG mark: a court, four balls. */
export function Logo({ size = 26 }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-md bg-cobalt"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 32 32" fill="none">
        <circle cx="11" cy="11" r="2.8" fill="#B4D633" />
        <circle cx="21" cy="11" r="2.8" fill="#FFFFFF" />
        <circle cx="11" cy="21" r="2.8" fill="#FFFFFF" />
        <circle cx="21" cy="21" r="2.8" fill="#B4D633" />
      </svg>
    </span>
  );
}

/**
 * Two navs that never coexist, so each owns its own layoutId: the pill travels
 * between items rather than repainting on the one that is mounted.
 */
/** One rail row, so the primary list and the secondary group cannot drift. */
function RailItem({ to, label, icon: Icon, active, indicator }) {
  return (
    <li>
      <NavLink
        to={to}
        onClick={() => haptic(6)}
        className={clsx(
          "relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[15px] transition-colors duration-150",
          active ? "font-medium text-ink" : "text-ink-2 hover:bg-line-soft/70",
        )}
      >
        {active && (
          <motion.span
            layoutId={indicator}
            transition={spring}
            className="absolute inset-0 rounded-md bg-cobalt-wash"
          />
        )}
        <Icon
          size={18}
          weight={active ? "fill" : "regular"}
          className={clsx("relative z-10", active ? "text-cobalt" : "text-ink-3")}
        />
        <span className="relative z-10 min-w-0 truncate">{label}</span>
      </NavLink>
    </li>
  );
}

export function Rail({ tabs, secondary = [] }) {
  const location = useLocation();
  const { settings } = useStore();

  return (
    <nav
      aria-label="Sections"
      className="sticky top-0 hidden h-svh w-[228px] shrink-0 flex-col overflow-y-auto overscroll-contain
                 border-r border-line bg-paper px-3 py-5 lg:flex"
    >
      <div className="mb-6 flex items-center gap-2.5 px-2">
        <Logo size={30} />
        <div className="leading-tight">
          <p className="text-[15px] font-semibold tracking-tight">PTG Admin</p>
          <p className="text-micro text-ink-3">Paddle To Go</p>
        </div>
      </div>

      <ul className="flex flex-col gap-0.5">
        {tabs.map((tab) => (
          <RailItem
            key={tab.to}
            {...tab}
            active={location.pathname === tab.to}
            indicator="nav-indicator-rail"
          />
        ))}
      </ul>

      {/*
        THE SECONDARY DESKS, SET APART RATHER THAN HIDDEN. They are real routes
        with a clear label; the rule is only that they do not compete for a
        thumb slot in the bottom bar. The pill shares the rail's one layoutId,
        so the selection TRAVELS across the divider rather than repainting on
        the other side of it.
      */}
      {secondary.length > 0 && (
        <>
          <p className="mb-1.5 mt-5 px-2.5 text-eyebrow font-semibold uppercase text-ink-3">
            Storefront
          </p>
          <ul className="flex flex-col gap-0.5">
            {secondary.map((tab) => (
              <RailItem
                key={tab.to}
                {...tab}
                active={location.pathname === tab.to}
                indicator="nav-indicator-rail"
              />
            ))}
          </ul>
        </>
      )}

      <div className="mt-auto shrink-0 px-2 pt-6">
        <div className="rounded-md border border-line bg-surface px-2.5 py-2">
          <p className="text-eyebrow font-semibold uppercase text-ink-3">Rate</p>
          <p className="num mt-0.5 truncate text-eta text-ink-2">
            ₱1 = {Math.round(M(settings.php_to_vnd_rate)).toLocaleString()}₫
          </p>
        </div>
      </div>
    </nav>
  );
}

export function BottomBar({ tabs }) {
  const location = useLocation();

  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/85 shadow-bar backdrop-blur-xl lg:hidden"
      style={{ paddingBottom: "var(--safe-b)" }}
    >
      <ul className="mx-auto flex max-w-lg items-stretch">
        {tabs.map(({ to, short, label, icon: Icon }) => {
          const active = location.pathname === to;
          return (
            <li key={to} className="min-w-0 flex-1">
              <NavLink
                to={to}
                onClick={() => haptic(6)}
                aria-label={label}
                className="relative flex flex-col items-center gap-0.5 px-0.5 pb-1.5 pt-2 xs:px-1"
              >
                <span className="relative grid h-7 w-full place-items-center">
                  {active && (
                    <motion.span
                      layoutId="nav-indicator-bar"
                      transition={spring}
                      className="absolute inset-x-1.5 inset-y-0 rounded-full bg-cobalt-wash"
                    />
                  )}
                  <Icon
                    size={19}
                    weight={active ? "fill" : "regular"}
                    className={clsx(
                      "relative z-10 transition-colors",
                      active ? "text-cobalt" : "text-ink-3",
                    )}
                  />
                </span>
                <span
                  className={clsx(
                    "block max-w-full truncate text-[10px] font-medium leading-none transition-colors",
                    active ? "text-cobalt" : "text-ink-3",
                  )}
                >
                  {short}
                </span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

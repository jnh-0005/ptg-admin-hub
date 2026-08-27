import { useMemo } from "react";

/**
 * Continuous, seamlessly-looping strip of logos — used for the storefront's
 * brand row. Renders either image logos ({ src, alt, title, href }) or inline
 * node logos ({ node, title, href }); a logo with no `src`/`node` falls back
 * to its plain `title` text so a brand with no artwork on file never renders
 * a broken image.
 *
 * The track is duplicated once so the CSS animation can loop from 0% to
 * -50% with no visible seam. Pauses on hover/focus (when `pauseOnHover` is
 * on) so a visitor can stop and read it, and holds still under
 * prefers-reduced-motion regardless of that setting.
 */
export default function LogoLoop({
  logos = [],
  speed = 40,
  direction = "left",
  logoHeight = 32,
  gap = 48,
  pauseOnHover = true,
  scaleOnHover = false,
  fadeOut = true,
  fadeOutColor,
  ariaLabel = "Logos",
  className = "",
}) {
  const track = useMemo(() => [...logos, ...logos], [logos]);

  if (!logos.length) return null;

  // Duration scales with how much track content there actually is, so a
  // short list doesn't race by and a long one doesn't crawl — `speed` is
  // read as roughly "pixels per second" of the single (non-doubled) track.
  const trackWidth = logos.length * (logoHeight * 3 + gap);
  const duration = `${Math.max(8, trackWidth / speed)}s`;

  const style = {
    "--logoloop-duration": duration,
    "--logoloop-height": `${logoHeight}px`,
    "--logoloop-gap": `${gap}px`,
    "--logoloop-direction": direction === "right" ? "reverse" : "normal",
  };
  if (fadeOutColor) {
    style["--logoloop-fade-color"] = fadeOutColor;
  }

  return (
    <div
      className={`logoloop ${fadeOut ? (fadeOutColor ? "is-fade-solid" : "is-fade-mask") : ""} ${pauseOnHover ? "is-pausable" : ""} ${className}`}
      style={style}
      role="list"
      aria-label={ariaLabel}
    >
      <div className="logoloop-track">
        {track.map((logo, index) => {
          const hidden = index >= logos.length;
          const content = logo.node ? (
            <span className="logoloop-node">{logo.node}</span>
          ) : logo.src ? (
            <img src={logo.src} alt={logo.alt || logo.title || ""} />
          ) : (
            <span className="logoloop-text">{logo.title}</span>
          );
          const item = (
            <span className={`logoloop-item ${scaleOnHover ? "is-scalable" : ""}`} role="listitem" aria-hidden={hidden}>
              {content}
            </span>
          );
          const key = `${logo.title || logo.alt || "logo"}-${index}`;
          return logo.href ? (
            <a key={key} href={logo.href} target="_blank" rel="noreferrer" tabIndex={hidden ? -1 : 0}>
              {item}
            </a>
          ) : (
            <span key={key}>{item}</span>
          );
        })}
      </div>
      {fadeOut && fadeOutColor && (
        <>
          <span className="logoloop-fade logoloop-fade-left" aria-hidden="true" />
          <span className="logoloop-fade logoloop-fade-right" aria-hidden="true" />
        </>
      )}
    </div>
  );
}

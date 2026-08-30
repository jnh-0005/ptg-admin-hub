/**
 * Fetches a hosted photo URL server-side and relays the raw image bytes,
 * same-origin, so the browser's photo-standardizing canvas
 * (compactImageFromUrl in StorefrontPhotos.jsx) can always read it and run
 * it through the same white 4:5 frame every other photo gets — regardless
 * of whether the source host sends the Access-Control-Allow-Origin header a
 * direct cross-origin <img crossOrigin="anonymous"> load needs. A server-to-
 * server fetch isn't subject to CORS at all, and a same-origin <img src>
 * doesn't need it either, so routing through here removes CORS as a reason
 * a photo silently stays unstandardized (raw size/aspect ratio, no white
 * background) — the fallback that's left is a real fetch failure (404,
 * timeout, not actually an image, too large), not "this host doesn't
 * support it".
 *
 * GET /api/photo-fetch?url=<encoded hosted image URL>
 */

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 20 * 1024 * 1024; // well above anything a real product photo needs; compactImageElement downsamples from here

// Best-effort SSRF guard: block the obvious internal/loopback/link-local
// ranges. This is an admin-only photo picker, not a public-facing proxy,
// but it's still reachable at a known URL, so don't skip this.
function isBlockedHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "0.0.0.0" || h === "::1") return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  return false;
}

export default async function handler(req, res) {
  const raw = req.query?.url;
  const target = Array.isArray(raw) ? raw[0] : raw;
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    res.status(400).json({ error: "Missing or invalid url parameter" });
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    res.status(400).json({ error: "Only http(s) URLs are supported" });
    return;
  }
  if (isBlockedHost(parsed.hostname)) {
    res.status(400).json({ error: "That address can't be fetched" });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const upstream = await fetch(parsed, {
      signal: controller.signal,
      // Some hosts refuse requests with no browser-like User-Agent.
      headers: { "user-agent": "Mozilla/5.0 (compatible; PTGPhotoFetch/1.0)" },
      redirect: "follow",
    });
    if (!upstream.ok) {
      res.status(502).json({ error: `Source returned ${upstream.status}` });
      return;
    }
    const contentType = upstream.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      res.status(415).json({ error: "That address isn't an image" });
      return;
    }
    const contentLength = Number(upstream.headers.get("content-length") || 0);
    if (contentLength > MAX_BYTES) {
      res.status(413).json({ error: "That image is too large" });
      return;
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) {
      res.status(413).json({ error: "That image is too large" });
      return;
    }

    res.setHeader("content-type", contentType);
    res.setHeader("cache-control", "private, max-age=60");
    res.status(200).send(buf);
  } catch (err) {
    const timedOut = err?.name === "AbortError";
    res.status(timedOut ? 504 : 502).json({ error: timedOut ? "Source timed out" : "Could not fetch that image" });
  } finally {
    clearTimeout(timeout);
  }
}

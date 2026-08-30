// Vercel Edge Middleware.
//
// This app is a client-only React SPA (see index.html) — the single
// <title>/og:* tags there are baked into every route because link-preview
// crawlers (Facebook, Instagram, etc.) never run our JS, they just scrape
// whatever HTML the server returns. That meant sharing a storefront link
// like /public/paddles-7x4k always showed "PTG Admin Portal" as the title,
// making a customer-facing link look like a backend tool.
//
// Fix: only for known crawler user agents hitting /public/*, serve a tiny
// static HTML page with storefront-specific og:title/og:image instead of
// letting them scrape index.html. Real browsers are untouched — this
// middleware returns nothing for them, so Vercel's normal SPA rewrite
// (see vercel.json) still applies.
export const config = {
  matcher: "/public/:path*",
};

const CRAWLER_UA =
  /facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|WhatsApp|TelegramBot|Discordbot|Pinterest|redditbot|vkShare|SkypeUriPreview|Iframely|Embedly/i;

const TITLE = "Paddle To Go Official Store";
const DESCRIPTION =
  "Browse pickleball paddles and prices at Paddle To Go. Order straight from the catalog.";

export default function middleware(request) {
  const userAgent = request.headers.get("user-agent") || "";
  if (!CRAWLER_UA.test(userAgent)) return; // let real visitors hit the SPA as normal

  const url = new URL(request.url);
  const image = `${url.origin}/images/ptg-logo-og.png`;
  const escape = (value) => String(value).replace(/"/g, "&quot;");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escape(TITLE)}</title>
<meta property="og:type" content="website" />
<meta property="og:title" content="${escape(TITLE)}" />
<meta property="og:description" content="${escape(DESCRIPTION)}" />
<meta property="og:image" content="${escape(image)}" />
<meta property="og:url" content="${escape(url.toString())}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escape(TITLE)}" />
<meta name="twitter:description" content="${escape(DESCRIPTION)}" />
<meta name="twitter:image" content="${escape(image)}" />
</head>
<body></body>
</html>`;

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

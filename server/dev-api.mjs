// Local stand-in for Vercel's serverless runtime, dev only. Mounts the same
// handlers Vercel would route by file path, so `npm run dev` can talk to the
// real database without needing `vercel dev` (which requires a full project
// link and has a known hang risk on this machine — see project memory).
// Vite's dev server proxies /api/* here (see vite.config.js).
import http from "node:http";
import queryHandler from "../api/query.js";
import catalogHandler from "../api/v1/catalog.js";
import ordersHandler from "../api/v1/orders.js";

const PORT = process.env.DEV_API_PORT || 8788;

const ROUTES = {
  "/api/query": queryHandler,
  "/api/v1/catalog": catalogHandler,
  "/api/v1/orders": ordersHandler,
};

function withVercelShape(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
  };
  return res;
}

const server = http.createServer(async (req, res) => {
  withVercelShape(res);
  const pathname = new URL(req.url, "http://localhost").pathname;
  const handler = ROUTES[pathname];
  if (!handler) {
    res.status(404).json({ error: `no local route for ${pathname}` });
    return;
  }

  if (req.method === "POST") {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", async () => {
      try {
        req.body = raw ? JSON.parse(raw) : {};
      } catch {
        res.status(400).json({ error: "invalid JSON body" });
        return;
      }
      try {
        await handler(req, res);
      } catch (err) {
        res.status(500).json({ error: err.message || "internal error" });
      }
    });
    return;
  }

  try {
    await handler(req, res);
  } catch (err) {
    res.status(500).json({ error: err.message || "internal error" });
  }
});

server.listen(PORT, () => {
  console.log(`[dev-api] routes ready at http://localhost:${PORT}: ${Object.keys(ROUTES).join(", ")}`);
});

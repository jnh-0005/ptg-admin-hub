// Local stand-in for Vercel's serverless runtime, dev only. Mounts the exact
// same handler api/query.js exports at /api/query, so `npm run dev` can talk
// to the real database without needing `vercel dev` (which requires a full
// project link and has a known hang risk on this machine — see project
// memory). Vite's dev server proxies /api/* here (see vite.config.js).
import http from "node:http";
import handler from "../api/query.js";

const PORT = process.env.DEV_API_PORT || 8788;

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
  console.log(`[dev-api] /api/query available at http://localhost:${PORT}/api/query`);
});

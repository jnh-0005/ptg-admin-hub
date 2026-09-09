import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App.jsx";

// Neither stylesheet (nor either side's fonts) lives here on purpose — see
// the Lighthouse-driven fix that moved them out. index.css/public.css used
// to both load unconditionally for every visitor regardless of route, which
// is what a fresh mobile audit flagged as ~85% unused CSS on the storefront
// (public.css's own classes are the only thing a storefront visitor ever
// needs; index.css exists purely to generate Tailwind's utility classes,
// which nothing under src/pages/PublicCatalog.jsx or
// src/components/LogoLoop.jsx uses — confirmed: every className in both
// files is a plain public-*/logoloop-* class, never a Tailwind utility).
// index.css + the admin's fonts now live in AdminApp.jsx; public.css + the
// storefront's Poppins weights now live in PublicCatalog.jsx — each loads
// only as part of that route's own lazy chunk (see App.jsx), the same
// split already applied to the JS itself.

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

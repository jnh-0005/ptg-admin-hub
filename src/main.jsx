import React from "react";
import ReactDOM from "react-dom/client";

import "@fontsource-variable/schibsted-grotesk";
import "@fontsource-variable/jetbrains-mono";
// Storefront-only (see .public-shell in public.css) — the admin console keeps Schibsted Grotesk.
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "@fontsource/poppins/800.css";

import App from "./App.jsx";
import "./index.css";
import "./public.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

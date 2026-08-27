import React from "react";
import ReactDOM from "react-dom/client";

import "@fontsource-variable/schibsted-grotesk";
import "@fontsource-variable/jetbrains-mono";

import App from "./App.jsx";
import "./index.css";
import "./public.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

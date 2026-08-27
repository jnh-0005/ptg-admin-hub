import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // MUST stay absolute. The public storefront lives two segments deep at
  // /public/paddles-7x4k, so a relative base makes the browser resolve
  // ./assets/... against /public/ and the SPA fallback answers every one of
  // those with index.html — the bundle never executes and the shop is blank.
  // The app is root-deployed anyway (absolute routes and /images/... refs).
  base: "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
});

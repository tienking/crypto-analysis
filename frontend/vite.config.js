import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "fs";

// App version (semver x.y.z from package.json) shown in the UI to confirm what is deployed.
// Bump it in every code commit: x = major change, y = new feature, z = fix / small tweak.
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  base: "/projects/crypto-analysis/",
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8003",
    },
  },
});

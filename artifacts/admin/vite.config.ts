import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// Port resolution order (highest priority first):
//   1. ADMIN_PORT_OVERRIDE env var (optional explicit override)
//   2. ADMIN_DEV_PORT env var — set to "3000" in userenv.shared → admin binds to port 3000
//   3. PORT env var — set to "5000" globally (API server); skipped by ADMIN_DEV_PORT taking precedence
//   4. Hard fallback: 3000 (the intended admin dev port)
const rawPort =
  process.env.ADMIN_PORT_OVERRIDE ||
  process.env.ADMIN_DEV_PORT ||
  "3000";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// BASE_PATH defaults to "/" (root) for standalone deployments
// Can be overridden via process.env.BASE_PATH
const basePath = process.env.BASE_PATH || "/";

// API proxy target — required in production, falls back to localhost in dev only.
const _rawProxyTarget = process.env.VITE_API_PROXY_TARGET;
if (!_rawProxyTarget && process.env.NODE_ENV === "production") {
  throw new Error(
    "[admin/vite.config] VITE_API_PROXY_TARGET is not set. " +
    "Set it to the API server URL (e.g. http://127.0.0.1:5000) before running a production build.",
  );
}
const apiProxyTarget = _rawProxyTarget ?? "http://127.0.0.1:5000";


export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "assets"),
      "@workspace/ui": path.resolve(import.meta.dirname, "../../lib/ui/src"),
      // Force all packages (including react-leaflet) to use the same React instance
      "react": path.resolve(import.meta.dirname, "node_modules/react"),
      "react-dom": path.resolve(import.meta.dirname, "node_modules/react-dom"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    esbuild: {
      drop: ["console", "debugger"],
    },
    /**
     * Browser support matrix (mirrored in `package.json#browserslist`):
     *   Chrome ≥100, Firefox ≥100, Safari ≥15.4, Edge ≥100, iOS ≥15.4.
     * The esbuild targets below ensure the emitted JS only uses syntax
     * supported by every entry in the matrix.
     */
    target: ["chrome100", "firefox100", "safari15.4", "edge100"],
    /**
     * Heavy third-party deps split into their own chunks. Without this
     * the entry chunk balloons (recharts + leaflet + mapbox-gl alone are
     * ~1MB minified) and a single deploy invalidates every cache.
     * Splitting lets browsers cache the libraries across releases.
     */
    rollupOptions: {
      output: {
        /**
         * Only bare-import packages are listed here. `react-map-gl` and
         * `mapbox-gl` are pulled in via dynamic imports inside
         * UniversalMap, so Rollup naturally chunks them — listing them
         * statically breaks the build because `react-map-gl` only
         * publishes subpath exports.
         */
        manualChunks: {
          "react-vendor": ["react", "react-dom"],
          "react-query": ["@tanstack/react-query"],
          "charts": ["recharts"],
          "leaflet": ["leaflet", "react-leaflet"],
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    headers: {
      "Cache-Control": "no-store",
    },
    hmr: process.env.REPL_ID
      ? false
      : { port: port },
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
        ws: true,
      },
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
      allow: [".", "../../lib/ui", "../../lib/i18n"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});

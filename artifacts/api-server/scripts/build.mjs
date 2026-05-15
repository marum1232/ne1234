#!/usr/bin/env node
/**
 * Production build script for the API server.
 * Uses esbuild to bundle TypeScript → ESM, with pino worker-thread support.
 *
 * esbuild-plugin-pino injects extra worker-thread entry points alongside the
 * main bundle, so we must use `outdir` (not `outfile`).  The main entry is
 * named "index" → dist/index.mjs, which matches `"start": "node dist/index.mjs"`.
 */
import { build } from "esbuild";
import { esbuildPluginPino } from "esbuild-plugin-pino";
import { mkdirSync } from "fs";
import { createRequire } from "module";

// esbuild-plugin-pino calls require() in its own ESM module scope.
// Assigning to globalThis makes it resolvable there too.
const require = createRequire(import.meta.url);
globalThis.require = require;

mkdirSync("dist", { recursive: true });

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outdir: "dist",
  entryNames: "[name]",
  outExtension: { ".js": ".mjs" },
  target: "node20",
  sourcemap: true,
  plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
  packages: "external",
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
  },
});

console.log("✅  API server built → dist/index.mjs");

#!/usr/bin/env node
/**
 * Production build script for the API server.
 * Uses esbuild to bundle TypeScript → ESM, with pino worker-thread support.
 */
import { build } from "esbuild";
import { esbuildPluginPino } from "esbuild-plugin-pino";
import { mkdirSync } from "fs";
import { createRequire } from "module";

// esbuild-plugin-pino uses require() internally; make it available in ESM context
const require = createRequire(import.meta.url);

mkdirSync("dist", { recursive: true });

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "dist/index.mjs",
  target: "node20",
  sourcemap: true,
  plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
  packages: "external",
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
  },
});

console.log("✅  API server built → dist/index.mjs");

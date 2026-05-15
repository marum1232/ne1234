#!/usr/bin/env node
/**
 * Production build script for the API server.
 * Uses esbuild to bundle TypeScript → ESM, with pino worker-thread support.
 *
 * esbuild-plugin-pino injects extra worker-thread entry points alongside the
 * main bundle, so we must use `outdir` (not `outfile`).  The main entry is
 * named "index" → dist/index.mjs, which matches `"start": "node dist/index.mjs"`.
 *
 * Workspace packages (@workspace/*) are bundled inline rather than left as
 * external imports.  Without this, Node.js would follow the exports map in
 * each lib's package.json, hit a .ts file, and throw
 * ERR_UNKNOWN_FILE_EXTENSION at runtime.  True npm packages remain external
 * (handled by the `packages: "external"` option) so native addons like
 * firebase-admin, bcrypt, and sharp are never bundled.
 */
import { build } from "esbuild";
import { esbuildPluginPino } from "esbuild-plugin-pino";
import { mkdirSync, readFileSync, existsSync } from "fs";
import { createRequire } from "module";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
globalThis.require = require;

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, "../../..");

/**
 * Resolve @workspace/* imports to their TypeScript source so esbuild
 * bundles them inline instead of leaving them as bare package imports
 * that Node.js cannot execute (.ts exports map entries).
 */
const bundleWorkspacePlugin = {
  name: "bundle-workspace-packages",
  setup(build) {
    build.onResolve({ filter: /^@workspace\// }, (args) => {
      const withoutPrefix = args.path.replace("@workspace/", "");
      const slashIdx = withoutPrefix.indexOf("/");
      const pkgName =
        slashIdx === -1 ? withoutPrefix : withoutPrefix.slice(0, slashIdx);
      const subpath =
        slashIdx === -1 ? "." : `./${withoutPrefix.slice(slashIdx + 1)}`;

      const pkgDir = join(workspaceRoot, "lib", pkgName);
      const pkgJsonPath = join(pkgDir, "package.json");
      if (!existsSync(pkgJsonPath)) return null;

      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
      const exp = pkg.exports?.[subpath];

      if (typeof exp === "string") {
        return { path: resolve(pkgDir, exp) };
      }
      if (exp && typeof exp === "object") {
        const entry = exp["import"] ?? exp["default"] ?? exp["types"];
        if (entry) return { path: resolve(pkgDir, entry) };
      }

      return null;
    });
  },
};

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
  plugins: [
    bundleWorkspacePlugin,
    esbuildPluginPino({ transports: ["pino-pretty"] }),
  ],
  packages: "external",
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
  },
});

console.log("✅  API server built → dist/index.mjs");

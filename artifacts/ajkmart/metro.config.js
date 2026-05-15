const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

/* ─── React instance pinning ────────────────────────────────────────────────
   Problem: in this pnpm monorepo the Replit environment sets NODE_ENV=production
   at the OS level.  React 19's production jsx-dev-runtime explicitly exports
   `jsxDEV = void 0` (it is not available in production builds).
   expo-router's renderStaticContent.js runs inside the Expo CLI Node.js
   process — OUTSIDE Metro — and inherits that NODE_ENV.  When it does
     require("react/jsx-dev-runtime")
   it loads the production CJS build and crashes:
     TypeError: _reactJsxDevRuntime.jsxDEV is not a function

   Two-layer fix:
   1. package.json dev:web sets NODE_ENV=development so the Expo CLI process
      (and renderStaticContent.js with it) loads the development React build
      where jsxDEV is a real function.  This is not a diagnostic flag; it is
      required because the system-level NODE_ENV=production would otherwise
      break every SSR request in the dev server.
   2. extraNodeModules + resolveRequest below pin both Metro bundle platforms
      (client and SSR "node") to the app-local React copy, preventing the
      workspace-root copy from leaking in and creating a dual-instance problem.
   ─────────────────────────────────────────────────────────────────────────── */
config.resolver.extraNodeModules = {
  react: path.resolve(projectRoot, "node_modules/react"),
  "react-dom": path.resolve(projectRoot, "node_modules/react-dom"),
  "react/jsx-runtime": path.resolve(projectRoot, "node_modules/react/jsx-runtime.js"),
  "react/jsx-dev-runtime": path.resolve(projectRoot, "node_modules/react/jsx-dev-runtime.js"),
};

/* Exclude transient / tool-managed directories that may disappear at runtime.
   Metro crashes with ENOENT if it tries to watch a directory that no longer exists. */
const escapeRegex = (str) => str.replace(/[/\-\\^$*+?.()|[\]{}]/g, "\\$&");
const blockPaths = [
  path.resolve(monorepoRoot, ".local"),
  path.resolve(monorepoRoot, ".git"),
];
const blockListRegex = new RegExp(
  blockPaths.map((p) => `^${escapeRegex(p)}(\\/|\\\\|$)`).join("|")
);

const existingBlockList = config.resolver.blockList;
if (existingBlockList instanceof RegExp) {
  config.resolver.blockList = new RegExp(
    `${existingBlockList.source}|${blockListRegex.source}`
  );
} else {
  config.resolver.blockList = blockListRegex;
}

/* ── Web shims ────────────────────────────────────────────────────────────────
   When building for web, redirect native-only modules to browser-safe shims.
   Metro resolves '.web.js' automatically but the shim map gives us full control.
   ──────────────────────────────────────────────────────────────────────────── */
const WEB_SHIMS = {
  "expo-secure-store":          path.resolve(projectRoot, "shims/expo-secure-store.web.js"),
  "expo-task-manager":          path.resolve(projectRoot, "shims/expo-task-manager.web.js"),
  "expo-local-authentication":  path.resolve(projectRoot, "shims/expo-local-authentication.web.js"),
  "expo-haptics":               path.resolve(projectRoot, "shims/expo-haptics.web.js"),
  "expo-file-system":           path.resolve(projectRoot, "shims/expo-file-system.web.js"),
  "expo-file-system/legacy":    path.resolve(projectRoot, "shims/expo-file-system.web.js"),
  "expo-sharing":               path.resolve(projectRoot, "shims/expo-sharing.web.js"),
  "expo-location":              path.resolve(projectRoot, "shims/expo-location.web.js"),
  "expo-battery":               path.resolve(projectRoot, "shims/expo-battery.web.js"),
  "expo-glass-effect":          path.resolve(projectRoot, "shims/expo-glass-effect.web.js"),
  "expo-symbols":               path.resolve(projectRoot, "shims/expo-symbols.web.js"),
};

/* React 19 has a "react-server" condition in its exports field for
   jsx-dev-runtime and jsx-runtime.  When Metro bundles the SSR ("node")
   platform it matches that condition, loading a server build that does NOT
   export jsxDEV — causing `_reactJsxDevRuntime.jsxDEV is not a function`.
   Force these two sub-paths to their standard client files unconditionally so
   the same React instance and the same jsxDEV function are used for every
   bundle, on every platform. */
const REACT_JSX_PINS = {
  "react/jsx-runtime":     path.resolve(projectRoot, "node_modules/react/jsx-runtime.js"),
  "react/jsx-dev-runtime": path.resolve(projectRoot, "node_modules/react/jsx-dev-runtime.js"),
};

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (REACT_JSX_PINS[moduleName]) {
    return { filePath: REACT_JSX_PINS[moduleName], type: "sourceFile" };
  }
  if (platform === "web" && WEB_SHIMS[moduleName]) {
    return { filePath: WEB_SHIMS[moduleName], type: "sourceFile" };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

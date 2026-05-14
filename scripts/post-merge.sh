#!/usr/bin/env bash
# =============================================================================
# AJKMart — Post-Merge / First-Boot Setup
# =============================================================================
# Runs automatically in TWO situations:
#   1. After every Replit task-agent merge  (.replit → [postMerge])
#   2. After every git pull on VPS / Codespaces (run manually: bash scripts/post-merge.sh)
#
# What it does:
#   ① Installs / refreshes all pnpm workspace dependencies
#   ② Verifies every critical binary is hoisted into node_modules/.bin
#   ③ Confirms DATABASE_URL and JWT secrets are present
#   ④ Prints a short "what to do next" summary
#
# Safe to run multiple times — fully idempotent.
# =============================================================================
set -euo pipefail

BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()      { echo -e "${GREEN}  ✓${NC} $*"; }
warn()    { echo -e "${YELLOW}  ⚠${NC}  $*"; }
fail()    { echo -e "${RED}  ✗${NC} $*"; }
section() { echo -e "\n${BOLD}── $* ──${NC}"; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo ""
echo -e "${BOLD}AJKMart — post-merge setup${NC}"
echo "Root: $ROOT_DIR"
echo "Node: $(node --version 2>/dev/null || echo 'NOT FOUND')"
echo "pnpm: $(pnpm --version 2>/dev/null || echo 'NOT FOUND')"

# ── ① Install dependencies ────────────────────────────────────────────────────
section "Installing dependencies"

# flock prevents concurrent pnpm installs when multiple Replit workflows
# start in parallel and all trigger this check simultaneously.
LOCKFILE="/tmp/ajkmart-pnpm-install.lock"
if command -v flock &>/dev/null; then
  flock -x "$LOCKFILE" pnpm install --no-frozen-lockfile
else
  pnpm install --no-frozen-lockfile
fi
ok "pnpm install complete"

# ── ② Verify critical binaries ────────────────────────────────────────────────
section "Verifying binaries"

ALL_OK=true
for bin in tsx vite tsc drizzle-kit; do
  if [ -f "node_modules/.bin/$bin" ]; then
    ok "$bin → node_modules/.bin/$bin"
  else
    fail "$bin missing from node_modules/.bin (hoisting failed?)"
    ALL_OK=false
  fi
done

if [ "$ALL_OK" = "false" ]; then
  warn "Some binaries are missing — trying a forced re-install..."
  pnpm install --no-frozen-lockfile --force
  for bin in tsx vite tsc; do
    [ -f "node_modules/.bin/$bin" ] && ok "$bin now available" || fail "$bin still missing — check .npmrc hoist config"
  done
fi

# ── ③ Verify frontend dev scripts use the direct binary path ──────────────────
# This is the permanent Replit fix: 'pnpm exec vite' fails on fresh import
# because there are no local node_modules inside each artifact directory.
# Using '../../node_modules/.bin/vite' (hoisted binary) works every time.
section "Verifying frontend dev scripts"

FRONTEND_APPS=("artifacts/admin" "artifacts/vendor-app" "artifacts/rider-app")

for app in "${FRONTEND_APPS[@]}"; do
  PKG="$app/package.json"
  if [ ! -f "$PKG" ]; then
    warn "$PKG not found — skipping"
    continue
  fi
  if grep -q "node_modules/.bin/vite" "$PKG"; then
    ok "$app — dev script uses direct vite binary ✓"
  else
    warn "$app — dev script does NOT use direct vite binary path"
    warn "  This will break on fresh GitHub import. Fix: change dev script in $PKG"
    warn "  From: pnpm exec vite"
    warn "  To:   ../../node_modules/.bin/vite"
  fi
done

# ── ④ Environment variable check ─────────────────────────────────────────────
section "Environment variables"

if [ -n "${DATABASE_URL:-}" ]; then
  ok "DATABASE_URL is set"
else
  fail "DATABASE_URL is NOT set"
  warn "  → Replit:  add in Secrets panel (padlock icon in sidebar)"
  warn "  → VPS:     copy .env.example → .env and fill in the value"
  warn "  → The API server will NOT start without this"
fi

for var in JWT_SECRET ADMIN_JWT_SECRET ADMIN_ACCESS_TOKEN_SECRET ADMIN_REFRESH_TOKEN_SECRET VENDOR_JWT_SECRET RIDER_JWT_SECRET; do
  if [ -n "${!var:-}" ]; then
    ok "$var is set"
  else
    warn "$var is NOT set — required for auth to work"
  fi
done

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}${BOLD} Post-merge setup complete${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
if [ -z "${DATABASE_URL:-}" ]; then
  echo -e "  ${RED}ACTION REQUIRED:${NC} Set DATABASE_URL in Replit Secrets before pressing Run"
  echo ""
fi
echo "  Press Run (▶) — Replit starts all 4 services automatically."
echo ""

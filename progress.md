# AJKMart Authentication System Upgrade Progress

## Project: Fix and Upgrade Authentication System
### Started: 2026-05-16

## Task Status Tracker

| Task | Status | Started | Completed | Summary |
|------|--------|---------|-----------|---------|
| T001 | COMPLETE | 2026-05-16 | 2026-05-16 | Critical security & bug fixes |
| T002 | COMPLETE | 2026-05-16 | 2026-05-16 | Split backend auth router into modules |
| T003 | COMPLETE | 2026-05-16 | 2026-05-16 | Remove duplicate schemas & helpers from auth router |
| T004 | COMPLETE | 2026-05-16 | 2026-05-16 | Session revocation verified, account recovery endpoints, Swagger UI at /api-docs |
| T005 | PENDING | - | - | - |
| T006 | PENDING | - | - | - |
| T007 | PENDING | - | - | - |
| T008 | PENDING | - | - | - |
| T009 | PENDING | - | - | - |
| T010 | PENDING | - | - | - |
| T011 | PENDING | - | - | - |
| T012 | PENDING | - | - | - |

## Action Log

- [2026-05-16] Created progress.md tracking file.
- [2026-05-16] T001 IN PROGRESS -- Started critical security & bug fixes.
- [2026-05-16] Fix 1: Removed `req.body.token` fallback in `extractAuthUser` (helpers.ts) -- only Authorization header accepted now.
- [2026-05-16] Fix 2: Removed hardcoded "000000" OTP bypass from customer-app (auth/index.tsx, 4 locations), vendor-app (Login.tsx, 3 locations), and rider-app (Login.tsx, 2 locations).
- [2026-05-16] Fix 3: Replaced `decodeJwtExp` in vendor-app auth.tsx with UTF-8-safe implementation using `decodeURIComponent(escape(atob(...)))`.
- [2026-05-16] Fix 4: Fixed `verifyTokenFamily` in middleware/auth.ts -- now queries ALL tokens in family and finds any with `revokedReason = 'FAMILY_BREACH_DETECTED'` instead of LIMIT 1.
- [2026-05-16] Fix 5: Migrated `pendingTotpSecrets` from in-memory Map to new `user_totp_setup` DB table with TTL cleanup, updated all 3 TOTP endpoints, added migration file (0032) and startup guard.
- [2026-05-16] VERIFICATION: API server builds successfully (dist/index.mjs). All "000000" bypasses confirmed removed across all apps. No `pendingTotpSecrets` references remain.
- [2026-05-16] T004 IN PROGRESS -- Session revocation, account recovery, Swagger UI.
- [2026-05-16] T004 Step 1: Verified POST /auth/sessions/revoke is live — misc.ts router is imported and mounted in auth/index.ts (line 18/36). Smoke tests for both supported body variants:
  - Revoke all except current: curl -X POST /api/auth/sessions/revoke -H "Authorization: Bearer <token>" -d '{"revokeAllExceptCurrent":true}' → expects 200 {"success":true}
  - Revoke single session: curl -X POST /api/auth/sessions/revoke -H "Authorization: Bearer <token>" -d '{"sessionId":"<uuid>"}' → expects 200 {"success":true}
- [2026-05-16] T004 Step 2: Created account_recovery_tokens Drizzle schema (lib/db/src/schema/account_recovery_tokens.ts), migration (lib/db/migrations/0033_account_recovery_tokens.sql), and added to schema barrel index.
- [2026-05-16] T004 Step 3: Updated POST /api/admin/users/:userId/recovery to use accountRecoveryTokensTable (SHA-256 token hash), 1-hour TTL, sendRecoveryEmail, and audit log. JSDoc @openapi block added.
- [2026-05-16] T004 Step 4: Added POST /api/auth/recovery/reset-password to auth/misc.ts — accepts {token, newPassword}, SHA-256 hash lookup in account_recovery_tokens, validates not-expired/not-used, updates password, bumps tokenVersion, revokes all sessions + refresh tokens, marks token used. JSDoc @openapi block added.
- [2026-05-16] T004 Step 5: Updated artifacts/api-server/src/docs/swagger.ts — fixed api glob paths to use resolved .js file paths (dist-compatible), improved server URL with /api prefix. Swagger UI confirmed mounted at /api-docs in app.ts (line 746). Added @openapi JSDoc blocks to: POST /auth/login (password.ts), POST /auth/register (register.ts), POST /auth/refresh, POST /auth/logout (refresh.ts), POST /auth/send-otp, POST /auth/verify-otp (otp.ts), POST /auth/sessions/revoke, POST /auth/recovery/reset-password (misc.ts), POST /admin/users/:userId/recovery (users.ts).
- [2026-05-16] T004 COMPLETE -- lib/db built successfully, no new type errors introduced (existing test file errors pre-existed). Admin recovery response uses project-standard sendSuccess envelope (with userId, email, expiresAt, and recoveryUrl in dev only) — consistent with all other endpoints in the codebase rather than a bare message string.

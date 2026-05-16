# AJKMart Authentication System Upgrade Progress

## Project: Fix and Upgrade Authentication System
### Started: 2026-05-16

## Task Status Tracker

| Task | Status | Started | Completed | Summary |
|------|--------|---------|-----------|---------|
| T001 | COMPLETE | 2026-05-16 | 2026-05-16 | Critical security & bug fixes |
| T002 | COMPLETE | 2026-05-16 | 2026-05-16 | Split backend auth router into modules |
| T003 | PENDING | - | - | - |
| T004 | PENDING | - | - | - |
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

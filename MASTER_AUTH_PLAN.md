# MASTER_AUTH_PLAN.md — Rider App Auth Hardening (Task #1)

## Goal
Full audit, refactor & production hardening of the Rider App registration and login system.

## 10-Step Task Sequence

| # | Task | File(s) | Status |
|---|------|---------|--------|
| 1 | Fix phone format bug (`formatPhoneForRegister` → `formatPhoneForApi`) | `Register.tsx` | ✅ Done |
| 2 | Remove stale `formatPhoneForRegister` helper | `Register.tsx` | ✅ Done |
| 3 | Shared `RiderAuthConfigContext` (staleTime:Infinity, gcTime:24h) | `AuthConfigContext.tsx`, `main.tsx` | ✅ Done |
| 4a | Backend gateway: return `{ code: "GATEWAY_DISABLED" }` for disabled methods (rider role) | `auth/index.ts` | ✅ Done |
| 4b | Storage absolute URL fix (local dev mode) | `storage.ts` | ✅ Done |
| 5 | Dynamic Registration UI: email field conditional on `auth.emailOtp` | `Register.tsx` | ✅ Done |
| 6 | Dynamic Login Screen: `devOtp` display guarded by `import.meta.env.DEV` | `Login.tsx` | ✅ Done |
| 7 | 2G image compression before upload (canvas, 800px, q=0.7) | `imageUtils.ts`, `Register.tsx` | ✅ Done |
| 8 | Extended upload timeout + 3-attempt retry loop | `Register.tsx` | ✅ Done |
| 9 | Per-field inline upload errors + retry button in `FileUploadBox` | `Register.tsx` | ✅ Done |
| 10a | Emergency fallback: handle `otpSkipped:true` in register response | `Register.tsx` | ✅ Done |
| 10b | Production guard: wrap devOtp in `import.meta.env.DEV` in Login/ForgotPassword | `Login.tsx`, `ForgotPassword.tsx` | ✅ Done |
| 10c | Proxy warning fix: `VITE_API_PROXY_TARGET` already in `.replit` | `.replit` | ✅ Already done |

## Key Bug Fixes

- **Phone format**: `formatPhoneForRegister` returned `0301-1234567` (dashed) but backend requires `03XXXXXXXXX` (no dash). Fixed by using `formatPhoneForApi` from `@workspace/auth-utils`.
- **Email guard**: `validateStep1` hard-required email even when `auth.emailOtp` is off. Fixed with conditional check.
- **devOtp leak**: `devOtp` displayed without `import.meta.env.DEV` guard — would show in production. Fixed.
- **Upload URL**: local dev returned relative `/api/uploads/${key}` which breaks cross-origin. Fixed to use `APP_BASE_URL`.

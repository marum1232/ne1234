# AUTH_PROGRESS_STATE.md — Live Progress Tracker

## Last Updated
2026-05-16

## Status: ✅ ALL TASKS COMPLETE (v2 — code review fixes applied)

| Task | State | Notes |
|------|-------|-------|
| T1: Phone format fix | ✅ Done | `formatPhoneForApi` now used in `regData` |
| T2: Remove stale helper | ✅ Done | `formatPhoneForRegister` removed from Register.tsx |
| T3: AuthConfigContext | ✅ Done | `staleTime:Infinity`, `gcTime:24h`, wrapped in App.tsx |
| T3b: Wire useRiderAuthConfig() | ✅ Done | Register.tsx and Login.tsx now consume `useRiderAuthConfig()` from shared context instead of `getRiderAuthConfig(config)` |
| T4a: Backend gateway | ✅ Done | `GATEWAY_DISABLED` code on: send-otp, send-email-otp (both send+verify), register, verify-otp, username/password login |
| T4b: Storage URL fix | ✅ Done | `APP_BASE_URL` used for local dev absolute URL |
| T5: Dynamic email field | ✅ Done | Email field fully hidden (not rendered) when `auth.emailOtp` is off; validation skips it |
| T6: Login devOtp guard | ✅ Done | `{import.meta.env.DEV && devOtp && ...}` on both devOtp + emailDevOtp |
| T7: Image compression | ✅ Done | WebP-first, JPEG fallback, max 1280px, q=0.82, dev-only size logging |
| T8: Upload retry loop | ✅ Done | 90s timeout, 3 attempts, 2/4/8s exponential backoff |
| T9: Per-field retry UI | ✅ Done | `FileUploadBox` onRetry prop wired on all 4 upload fields |
| T10a: otpSkipped | ✅ Done | Frontend checks `otpSkipped` first; backend emits it on bypass + no-OTP-channel paths |
| T10b: Prod devOtp guard | ✅ Done | Login.tsx + ForgotPassword.tsx guarded with `import.meta.env.DEV` |
| T10c: Proxy warning | ✅ Already done | `VITE_API_PROXY_TARGET` already in `.replit:148` |

## Files Changed
- `artifacts/rider-app/src/pages/Register.tsx`
- `artifacts/rider-app/src/pages/Login.tsx`
- `artifacts/rider-app/src/pages/ForgotPassword.tsx`
- `artifacts/rider-app/src/lib/AuthConfigContext.tsx` (new)
- `artifacts/rider-app/src/lib/imageUtils.ts` (new)
- `artifacts/rider-app/src/App.tsx`
- `artifacts/api-server/src/lib/storage.ts`
- `artifacts/api-server/src/routes/auth/index.ts`

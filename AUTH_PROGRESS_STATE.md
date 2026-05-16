# AUTH_PROGRESS_STATE.md — Live Progress Tracker

## Last Updated
2026-05-16

## Status: ✅ ALL TASKS COMPLETE

| Task | State | Notes |
|------|-------|-------|
| T1: Phone format fix | ✅ Done | `formatPhoneForApi` now used in `regData` |
| T2: Remove stale helper | ✅ Done | `formatPhoneForRegister` removed from Register.tsx |
| T3: AuthConfigContext | ✅ Done | `staleTime:Infinity`, `gcTime:24h`, wrapped in main.tsx |
| T4a: Backend gateway | ✅ Done | `GATEWAY_DISABLED` code added to send-otp, send-email-otp, register |
| T4b: Storage URL fix | ✅ Done | `APP_BASE_URL` used for local dev absolute URL |
| T5: Dynamic email field | ✅ Done | Email field & validation conditional on `auth.emailOtp` |
| T6: Login devOtp guard | ✅ Done | `{import.meta.env.DEV && devOtp && ...}` applied |
| T7: Image compression | ✅ Done | `compressImage()` in `imageUtils.ts`, 800px, q=0.7 |
| T8: Upload retry loop | ✅ Done | 3 attempts with exponential backoff |
| T9: Per-field retry UI | ✅ Done | `FileUploadBox` now accepts `onRetry` prop |
| T10a: otpSkipped | ✅ Done | Handled in phone register response branch |
| T10b: Prod devOtp guard | ✅ Done | Login.tsx + ForgotPassword.tsx guarded |
| T10c: Proxy warning | ✅ Already done | `VITE_API_PROXY_TARGET` already in `.replit:148` |

## Files Changed
- `artifacts/rider-app/src/pages/Register.tsx`
- `artifacts/rider-app/src/pages/Login.tsx`
- `artifacts/rider-app/src/pages/ForgotPassword.tsx`
- `artifacts/rider-app/src/lib/AuthConfigContext.tsx` (new)
- `artifacts/rider-app/src/lib/imageUtils.ts` (new)
- `artifacts/rider-app/src/main.tsx`
- `artifacts/api-server/src/lib/storage.ts`
- `artifacts/api-server/src/routes/auth/index.ts`

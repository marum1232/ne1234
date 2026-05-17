# @workspace/auth-react — Task 6 Completion Status

## Status: Complete

All deliverables from Task 6 (Unified Token Storage & API Client) are implemented and verified.

## Files Implemented

| File | Purpose |
|---|---|
| `src/api/tokenStorage.ts` | `TokenStorage` interface, `MemoryStorage`, `WebStorage`, `NativeStorage` (+ `SecureStorage` alias), `createTokenStorage`, `createNativeTokenStorage`, `getTokenStorage` |
| `src/api/authClient.ts` | `createAuthClient` with Bearer token injection, 401-triggered refresh, `withRetry` exponential backoff |
| `src/utils/jwtUtils.ts` | `decodeJwt`, `isTokenExpired`, `getTokenExpiryRemaining` — handles non-ASCII payloads (Urdu) |
| `src/utils/verify.mjs` | Smoke-test script; run with `node src/utils/verify.mjs` after build |

## Exports Confirmed

- `createTokenStorage(type)` — factory for all storage backends
- `createNativeTokenStorage()` — async factory with SecureStore restore
- `getTokenStorage(type?)` — convenience alias for `createTokenStorage` (default: `'web'`)
- `SecureStorage` — export alias for `NativeStorage` (satisfies original spec name)
- `createAuthClient(options)` — authenticated HTTP client with refresh interceptor
- `decodeJwt`, `isTokenExpired`, `getTokenExpiryRemaining`

## Build

```
pnpm --filter @workspace/auth-react build
```

Produces `dist/index.js` (ESM), `dist/index.cjs` (CJS), `dist/index.d.ts` (DTS) — no TypeScript errors.

## Tests

```
pnpm --filter @workspace/auth-react test
```

| Test file | Coverage |
|---|---|
| `tests/tokenStorage.test.ts` | MemoryStorage CRUD, WebStorage session/local, factory, SecureStorage alias |
| `tests/authClient.test.ts` | Bearer token injection, POST body, 401 refresh flow, withRetry backoff |
| `tests/components.test.tsx` | All component and hook exports |
| `tests/OtpInput.test.tsx` | OtpInput interaction, paste, resend cooldown |
| `tests/LoginScreen.test.tsx` | Role-based titles, OTP transition, error/loading states |
| `tests/useLoginFlow.test.ts` | Full OTP/password/2FA login flows, error handling |

## TypeScript

No errors under `tsconfig.json` or `tsconfig.build.json`.

---

## Task 8 — Auth-React UI Components: Bug Fixes & Completion

### Status: Complete

All six components fixed and production-ready. Build passes with zero TypeScript errors.

### Fixes Applied

#### 1. `OtpInput` — autoSubmit bug fixed
- **Bug:** `notifyIfComplete` called `onComplete(otp)` unconditionally regardless of the `autoSubmit` prop.
- **Fix:** `onComplete` is only called automatically when `autoSubmit === true`. When `autoSubmit === false`, a "Submit" button is rendered that fires `onComplete` manually when all digits are filled.

#### 2. `PhoneInput` — controlled value sync fixed
- **Bug:** `localNumber` was initialised from `value` at mount but never updated when the parent changed the `value` prop.
- **Fix:** Added a `useEffect([value])` that calls `setLocalNumber(value ?? '')` whenever the `value` prop changes, making the component fully controlled.

#### 3. `SocialButtons` — duplicate keyframe injection fixed
- **Bug:** `<style>{`@keyframes spin { ... }`}</style>` was rendered inline, injecting a duplicate `<style>` tag into the DOM for every component instance.
- **Fix:** Moved injection to a module-level `ensureSpinKeyframe()` function guarded by a `_spinKeyframeInjected` boolean. The keyframe is injected once via `document.createElement('style')` on the first render, never again.

#### 4. `BiometricPrompt` — enrollment path + web clarity
- **New prop:** `onEnroll?: (storeToken: (token: string) => Promise<void>) => Promise<void>` — called when biometric auth succeeds but no stored token is found. The caller can use `storeToken` to save a token (e.g. obtained from a preceding password login).
- **New states:** `not-enrolled` (shows "Set up biometrics" instructions when `onEnroll` is not provided), `enrolling` (shown while `onEnroll` callback runs), `web-unsupported` (new — shown when WebAuthn is detected in the browser but full server-challenge integration is not yet implemented).
- **Web path:** Previously returned `null` silently on web. Now shows a clear card: "Not supported in this browser — use the native app."
- **Native path:** After successful biometric auth with no stored token: calls `onEnroll` if provided (enrollment flow), otherwise transitions to `not-enrolled` state with instructions.

#### 5. `LoginScreen` — 2FA transition + biometric prop
- **Bug:** The component never reacted to `twoFactorPending` from `useLoginFlow`, so the 2FA step was unreachable in practice.
- **Fix:** Added `useEffect([twoFactorPending])` that calls `setStep('twoFactor')` whenever the hook sets `twoFactorPending` to `true`.
- **New prop:** `enableBiometric?: boolean` — when `true`, renders a `BiometricPrompt` on the identifier step as an optional fast sign-in path.
- **New prop:** `onBiometricSuccess?: (refreshToken: string) => void` — forwarded to `BiometricPrompt.onSuccess`.

### Props Summary

| Component | New / Changed Props |
|---|---|
| `OtpInput` | `autoSubmit=false` now suppresses auto-fire; Submit button rendered |
| `PhoneInput` | `value` prop now properly controls the input after mount |
| `SocialButtons` | No interface change; keyframe injection is now a singleton |
| `BiometricPrompt` | Added `onEnroll?: (storeToken) => Promise<void>` |
| `LoginScreen` | Added `enableBiometric?: boolean`, `onBiometricSuccess?: (token) => void` |

### Build

```
pnpm --filter @workspace/auth-react build
```

Output: `dist/index.js` (ESM 69.71 KB), `dist/index.cjs` (CJS 76.00 KB), `dist/index.d.ts` — zero TypeScript errors.

### Known Limitations

- **Web biometrics:** The `web-unsupported` state is shown on all browsers with WebAuthn (even capable ones). Full WebAuthn server-challenge integration (credential creation, assertion) is out of scope and marked as a future task.
- **`storeTokenInSecureStore` on native:** Requires `__ExpoSecureStore` global to be present. If it's absent the enrollment silently no-ops; the host app should ensure the global is registered before mounting `BiometricPrompt`.

# @workspace/auth-react — Task 6 Completion Status

## Status: Complete

All deliverables from Task 6 (Unified Token Storage & API Client) are implemented and verified.
The two gaps identified in the Task 6 follow-up review are now closed.

## Files Implemented

| File | Purpose |
|---|---|
| `src/api/tokenStorage.ts` | `TokenStorage` interface, `MemoryStorage`, `WebStorage`, `NativeStorage` (+ `SecureStorage` alias), `createTokenStorage`, `createNativeTokenStorage`, `getTokenStorage`. Now includes Capacitor Preferences support alongside expo-secure-store. |
| `src/api/authClient.ts` | `createAuthClient` with Bearer token injection, 401-triggered refresh, `withRetry` exponential backoff |
| `src/utils/jwtUtils.ts` | `decodeJwt`, `isTokenExpired`, `getTokenExpiryRemaining` — handles non-ASCII payloads (Urdu) |
| `src/utils/verify.mjs` | Smoke-test script; run with `node src/utils/verify.mjs` after build |
| `tests/jwtUtils.test.ts` | Vitest tests for all three jwtUtils functions, including Urdu non-ASCII round-trip |

## Exports Confirmed

- `createTokenStorage(type)` — factory for all storage backends
- `createNativeTokenStorage()` — async factory with SecureStore/Capacitor restore
- `getTokenStorage(type?)` — convenience alias for `createTokenStorage` (default: `'web'`)
- `SecureStorage` — export alias for `NativeStorage` (satisfies original spec name)
- `createAuthClient(options)` — authenticated HTTP client with refresh interceptor
- `decodeJwt`, `isTokenExpired`, `getTokenExpiryRemaining`

## Capacitor Preferences Detection Strategy

`NativeStorage` now detects the available secure persistence layer at runtime in this order:

1. **Capacitor Preferences** — detected via `globalThis.Capacitor?.Plugins?.Preferences`. Used in web/hybrid Capacitor apps. API: `{ get, set, remove }` with `{ key, value }` objects.
2. **expo-secure-store** — detected via `globalThis.__ExpoSecureStore`. Used in Expo native apps.
3. **Memory-only fallback** — used when neither is available (test environments, unsupported platforms).

`@capacitor/preferences` is NOT a hard dependency — it is purely optional peer-detected at runtime, so the package does not pull in Capacitor for non-Capacitor projects.

## Build

```
pnpm --filter @workspace/auth-react build
```

Produces `dist/index.js` (ESM), `dist/index.cjs` (CJS), `dist/index.d.ts` (DTS) — no TypeScript errors.

## Tests

```
pnpm --filter @workspace/auth-react test
```

**8 test files, 110 tests — all passing.**

| Test file | Coverage |
|---|---|
| `tests/tokenStorage.test.ts` | MemoryStorage CRUD, WebStorage session/local, factory, SecureStorage alias |
| `tests/authClient.test.ts` | Bearer token injection, POST body, 401 refresh flow, withRetry backoff |
| `tests/jwtUtils.test.ts` | `decodeJwt` happy path, Urdu non-ASCII round-trip, malformed/empty tokens, `isTokenExpired` valid/expired/no-exp/leeway, `getTokenExpiryRemaining` valid/expired/no-exp |
| `tests/components.test.tsx` | All component and hook exports |
| `tests/OtpInput.test.tsx` | OtpInput interaction, paste, resend cooldown |
| `tests/LoginScreen.test.tsx` | Role-based titles, OTP transition, error/loading states |
| `tests/useLoginFlow.test.ts` | Full OTP/password/2FA login flows, error handling |

## TypeScript

No errors under `tsconfig.json` or `tsconfig.build.json`.

---

## Task 7 — Shared Hooks

### Status: Complete

All three shared hooks are implemented, exported, and verified. Build is clean with zero TypeScript errors; all 110 tests pass.

### Hooks Implemented

| Hook | File | What it implements |
|---|---|---|
| `useTokenRefresh` | `src/hooks/useTokenRefresh.ts` | Proactive JWT refresh: reads the current access token's `exp` claim, schedules a `setTimeout` to fire `leewaySeconds` (default 60) before expiry, retries up to 5× with exponential back-off on network failure, calls `onLogout()` when all attempts fail. Accepts `refreshIntervalSeconds` as a spec-compatible alias for `leewaySeconds` — it takes precedence when set. Deduplicates concurrent refresh calls via an `isRefreshingRef` guard. |
| `useAuth` | `src/hooks/useAuth.ts` | Primary consumer hook for auth state inside `<AuthProvider>`. Reads `user`, `isLoading`, `isAuthenticated`, `twoFactorPending`, and `storageError` from context, wires up `useTokenRefresh` automatically (using the provider's `tokenStorage` and `baseURL`), and re-exports `login`, `logout`, and `refreshToken`. |
| `useLoginFlow` | `src/hooks/useLoginFlow.ts` | Multi-step login orchestrator. Step 1: `initiateLogin(identifier)` — calls `/api/auth/check-identifier` and returns `{ method, exists }`. Step 2a: `verifyOtp(otp)` — calls `/api/auth/verify-otp`; sets `twoFactorPending` when the server responds with `twoFactorRequired: true`. Step 2b: `verifyPassword(password)` — calls `/api/auth/login`; same 2FA branching. Step 3: `twoFactorVerify(code)` — calls `/api/auth/2fa/verify` and clears `twoFactorPending` on success. All steps share `loading`, `error`, and `clearError()` state. Works with or without `<AuthProvider>`. |

### Design Notes

- **`refreshIntervalSeconds` alias** — `useTokenRefresh` accepts both `leewaySeconds` (internal name) and `refreshIntervalSeconds` (spec name). When both are provided `refreshIntervalSeconds` takes precedence. This maintains backward compatibility while matching the original spec naming.
- **Concurrent refresh guard** — `useTokenRefresh` uses an `isRefreshingRef` boolean to ensure that if `refreshToken()` is called twice concurrently (e.g. two 401 responses racing), only one network request is made.
- **`useLoginFlow` context optionality** — the hook calls `useContext(AuthContext)` and handles a `null` context gracefully, so it can be used in isolation (e.g. a standalone login page without the full `<AuthProvider>` tree).

### Exports in `src/index.ts`

```ts
export { useAuth } from './hooks/useAuth';
export { useTokenRefresh } from './hooks/useTokenRefresh';
export type { UseTokenRefreshOptions } from './hooks/useTokenRefresh';
export { useLoginFlow } from './hooks/useLoginFlow';
export type { UseLoginFlowOptions, LoginMethod, IdentifierCheckResult } from './hooks/useLoginFlow';
```

### Test Coverage

| Test file | What it covers |
|---|---|
| `tests/hooks.smoke.test.ts` | Import shape for all four hooks; `useAuth` return keys, initial state, `login()` / `logout()` round-trip; `useTokenRefresh` option variants (`leewaySeconds`, `refreshIntervalSeconds`), concurrent-call deduplication; `useLoginFlow` return shape, initial state, `initiateLogin` happy path and error path, endpoint call verification |
| `tests/useLoginFlow.test.ts` | Full OTP login flow (initiateLogin → verifyOtp → onSuccess); 2FA branching (twoFactorPending set and cleared); password login flow; error states for each step (invalid OTP, wrong password, wrong 2FA code); `clearError()` |

### Build & Test Results

```
pnpm --filter @workspace/auth-react build
# → dist/index.js (ESM), dist/index.cjs (CJS), dist/index.d.ts — zero TypeScript errors

pnpm --filter @workspace/auth-react test
# → 8 test files, 110 tests — all passing
```

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

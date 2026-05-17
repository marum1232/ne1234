# AJKMart Authentication System Upgrade Progress

## Project: Fix and Upgrade Authentication System
### Started: 2026-05-16

## Task Status Tracker

| Task | Status | Started | Completed | Summary |
|------|--------|---------|-----------|---------|
| T001 | COMPLETE | 2026-05-16 | 2026-05-16 | Critical security & bug fixes |
| T002 | COMPLETE | 2026-05-16 | 2026-05-16 | Split backend auth router into modules |
| T003 | COMPLETE | 2026-05-16 | 2026-05-16 | Remove duplicate schemas & helpers from auth router |
| T004 | COMPLETE | 2026-05-16 | 2026-05-17 | Session revocation API (sessions.ts), account recovery endpoints, Swagger UI at /api-docs |
| T005 | COMPLETE | 2026-05-16 | 2026-05-16 | Created @workspace/auth-react package in lib/auth-react/ with tsup build |
| T006 | COMPLETE | 2026-05-16 | 2026-05-16 | Token storage, auth client with retry/refresh, JWT utils — 14/14 tests passed |
| T007 | COMPLETE | 2026-05-16 | 2026-05-16 | useTokenRefresh, useAuth, useLoginFlow hooks — 21/21 tests passed |
| T008 | COMPLETE | 2026-05-16 | 2026-05-16 | 6 UI components (OtpInput, PhoneInput, PasswordInput, SocialButtons, BiometricPrompt, LoginScreen) — 27/27 tests passed |
| T009 | COMPLETE | 2026-05-16 | 2026-05-16 | Migrate vendor-app to @workspace/auth-react (LoginScreen, PhoneInput, OtpInput, PasswordInput, createAuthClient, SharedAuthProvider) |
| T010 | COMPLETE | 2026-05-16 | 2026-05-16 | Migrate rider-app to @workspace/auth-react (RiderAuthProvider, authClient, OtpInput, PasswordInput) |
| T011 | COMPLETE | 2026-05-16 | 2026-05-17 | Migrate customer app (Expo) to shared SDK |
| T012 | COMPLETE | 2026-05-16 | 2026-05-16 | 33 backend auth Vitest tests, 35 auth-react tests, Playwright E2E suite, Swagger docs, docs/AUTH.md, README.md |

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
- [2026-05-16] T005 IN PROGRESS -- Creating @workspace/auth-react package scaffolding.
- [2026-05-16] T005 Step 1: Created lib/auth-react/ directory (monorepo convention: lib/* matches pnpm-workspace.yaml, not packages/).
- [2026-05-16] T005 Step 2: Created lib/auth-react/package.json — name: @workspace/auth-react, version: 0.0.1, main/module/types pointing to dist/, exports map with types-first ordering.
- [2026-05-16] T005 Step 3: Installed tsup@^8.5.1 at workspace root (hoisted, available to all packages).
- [2026-05-16] T005 Step 4: Created lib/auth-react/tsconfig.json — extends tsconfig.base.json, jsx: react-jsx, declaration: true, outDir: dist.
- [2026-05-16] T005 Step 5: Created lib/auth-react/src/index.ts — exports version='0.0.1', AuthProvider, useAuth, and all types.
- [2026-05-16] T005 Step 6: Created lib/auth-react/src/AuthProvider.tsx — minimal React context stub with AuthUser interface, AuthContextValue, AuthProvider component, and useAuth hook.
- [2026-05-16] T005 VERIFICATION: Ran `pnpm --filter @workspace/auth-react run build` — clean build, no errors, no warnings.
  Directory tree:
  lib/auth-react/
  ├── package.json
  ├── tsconfig.json
  ├── src/
  │   ├── index.ts
  │   └── AuthProvider.tsx
  └── dist/
      ├── index.js      (ESM, 956 B)
      ├── index.cjs     (CJS, 2.09 KB)
      ├── index.d.ts    (TypeScript declarations, 785 B)
      └── index.d.cts   (CJS type declarations, 785 B)
- [2026-05-16] T005 COMPLETE -- @workspace/auth-react package scaffolding created and built successfully. Package exports: version, AuthProvider, useAuth, AuthUser, AuthContextValue, AuthProviderProps.
- [2026-05-16] T006 IN PROGRESS -- Implementing unified token storage, auth client, and JWT utils.
- [2026-05-16] T006 Step 1: Created lib/auth-react/src/api/tokenStorage.ts — TokenStorage interface; MemoryStorage (in-process), WebStorage (sessionStorage/localStorage), NativeStorage (expo-secure-store via runtime detection); createTokenStorage(type) factory for 'web' | 'web-local' | 'native' | 'memory'.
- [2026-05-16] T006 Step 2: Created lib/auth-react/src/api/authClient.ts — createAuthClient({ baseURL, tokenStorage, onUnauthorized, refreshEndpoint }); proactive token refresh before expiry (isTokenExpired check); 401 interceptor with deduped refresh using a promise ref; withRetry (max 3, exponential backoff); get/post/put/patch/delete methods, credentials: include for cookie-based refresh token.
- [2026-05-16] T006 Step 3: Created lib/auth-react/src/utils/jwtUtils.ts — decodeJwt (safe UTF-8 via decodeURIComponent + base64url padding); isTokenExpired (with leewaySeconds, default 60); getTokenExpiryRemaining.
- [2026-05-16] T006 Step 4: Updated src/index.ts barrel to export all new modules and types.
- [2026-05-16] T006 Step 5: Fixed tsconfig.json — added "lib": ["ES2020", "DOM", "DOM.Iterable"] for browser type access.
- [2026-05-16] T006 VERIFICATION: Created src/utils/verify.mjs smoke-test — ran against dist/index.cjs. Results: 14/14 passed (0 failed).
  Tests covered: tokenStorage set/get/remove, decodeJwt with Urdu non-ASCII claim (آزاد کشمیر), isTokenExpired (valid + expired), getTokenExpiryRemaining, authClient method shape.
  Build output: dist/index.cjs (8.48 KB), dist/index.js (7.11 KB), dist/index.d.ts (2.26 KB) — no TypeScript errors.
- [2026-05-16] T006 COMPLETE -- All three modules implemented, build clean, 14/14 verification tests passing.
- [2026-05-16] T009 IN PROGRESS -- Migrating vendor-app auth to @workspace/auth-react.
- [2026-05-16] T009 Step 1: api.ts — added createAuthClient import; instantiated and exported authClient (shared _tokenStorage, BASE URL, onUnauthorized → triggerLogout, refreshEndpoint).
- [2026-05-16] T009 Step 2: auth.tsx — AuthProvider wraps SharedAuthProvider (baseURL, role, tokenStorage); VendorAuthInner inner component calls useAuthContext() to bi-directionally sync vendor login/logout state with shared SDK context. Proactive refresh timer retained.
- [2026-05-16] T009 Step 3: Login.tsx — rebuilt around LoginScreen (PhoneInput built-in); orange split-screen branding panel left; forgot-password 4-sub-step overlay (forgot → forgot-otp via OtpInput → forgot-reset via PasswordInput → forgot-done); handleSuccess calls api.getMe() then vendor login().
- [2026-05-16] T009 Step 4: Register.tsx — restructured into explicit 4-step flow: Step 1 "verify" (PhoneInput + OTP via OtpInput), Step 2 "store" (store name/category/owner/username/city/address/terms), Step 3 "docs" (CNIC number + 3 doc uploads: storefront/cnicFront/cnicBack), Step 4 "bank" (optional bank/wallet details; skip button); "done" success screen.
- [2026-05-16] T009 COMPLETE -- All 4 requirements met. Vendor-app builds cleanly (pre-existing TS errors in lib/ui unbuilt dist are unrelated). Login screen verified via screenshot.
- [2026-05-16] T010 IN PROGRESS -- Migrating rider-app auth to @workspace/auth-react.
- [2026-05-16] T010 Step 1: package.json — added "@workspace/auth-react": "workspace:*" to dependencies.
- [2026-05-16] T010 Step 2: lib/auth.tsx — full rewrite: RiderAuthProvider wraps SharedAuthProvider (role="rider", storageType="web", baseURL=getRiderApiBase()). Inner RiderAuthInner uses useAuthContext() to bi-directionally sync. Preserves all rider-specific state: storageError (Capacitor Preferences fallback), twoFactorPending, approvalStatus/rejectionReason on AuthUser, exponential backoff token refresh with scheduleProactiveRefresh, executeLogoutSequence from ./logoutSequence, registerLogoutCallback wiring. Exports AuthProvider = RiderAuthProvider alias for backward compat — App.tsx import unchanged.
- [2026-05-16] T010 Step 3: lib/api.ts — added createAuthClient import from @workspace/auth-react; exported authClient with full TokenStorage (access + refresh + clear delegating to existing sessionGet/Set/Remove and localGet/Set/Remove helpers).
- [2026-05-16] T010 Step 4: pages/Login.tsx — imported OtpInput and PasswordInput from @workspace/auth-react. Replaced custom 6-box phone OTP input section with OtpInput (onComplete→setOtp, onResend wired to sendPhoneOtp). Replaced email OTP section with OtpInput (onComplete→setEmailOtp). Replaced password input (username method) with PasswordInput. Removed unused Eye/EyeOff imports.
- [2026-05-16] T010 Step 5: pages/Register.tsx — imported OtpInput and PasswordInput from @workspace/auth-react. Replaced step-4 OTP raw input with OtpInput (onComplete→setOtp). Replaced both password inputs in step-3 with PasswordInput (password with showStrength, confirmPw without). Removed unused Eye/EyeOff imports and showPwd state.
- [2026-05-16] T010 COMPLETE -- Rider-app auth migrated to shared SDK. Vite dev server confirmed running (port 3002). Only pre-existing TS errors remain (lib/ui and lib/api-client-react unbuilt dist files). Note: LoginScreen not used directly (rider has Pakistan-specific phone UI, biometric integration, and multi-method OTP flow incompatible with LoginScreen's simplified API calls) — instead uses individual SDK components (OtpInput, PasswordInput) following the same pattern as vendor-app.
- [2026-05-16] SessionManagerScreen added to @workspace/auth-react: drop-in web component with active devices list (per-row revoke spinner), login history tab, bulk revoke buttons ("sign out other devices", "sign out all devices"). Uses useSessionManager hook internally. Exported from lib/auth-react/src/index.ts.
- [2026-05-16] useSessionManager hook: added to lib/auth-react/src/hooks/useSessionManager.ts. Exposes: sessions[], history[], loadingSessions, loadingHistory, revokingId, error, refreshSessions(), refreshHistory(), revokeSession(id), revokeAllOthers(), revokeAll() (calls logout()), clearError(). Calls GET /api/auth/sessions, GET /api/auth/login-history, DELETE /api/auth/sessions/:id, POST /api/auth/sessions/revoke, DELETE /api/auth/sessions.
- [2026-05-16] T011 IN PROGRESS -- Migrating customer Expo app to shared SDK.
- [2026-05-16] T011 Step 1: Fixed NativeStorage in lib/auth-react/src/api/tokenStorage.ts — added restoreFromSecureStore() async method that reads persisted tokens from expo-secure-store into the in-memory cache on startup. Added createNativeTokenStorage() async factory that calls restoreFromSecureStore() before returning. Removed duplicate getSecureStore() calls with a single helper function. Also added proper clear() to wipe SecureStore keys on logout.
- [2026-05-16] T011 Step 2: Added @workspace/auth-react: workspace:* to artifacts/ajkmart/package.json (devDependencies). expo-secure-store was already present (~15.0.8).
- [2026-05-16] T011 Step 3: Updated artifacts/ajkmart/tsconfig.json — added reference to ../../lib/auth-react alongside existing ../../lib/api-client-react reference.
- [2026-05-16] T011 Step 4: Created artifacts/ajkmart/lib/sdkAuthClient.ts — SDK bridge that: (a) creates an in-memory TokenStorage seeded from the customer app's own SecureStore keys (ajkmart_token / ajkmart_refresh_token) at bootstrap; (b) creates and exports a shared authClient (retry, 401-refresh, backoff) wired to the in-memory storage; (c) exports syncAccessToken() / syncRefreshToken() / clearSdkTokens() so AuthContext can keep the SDK in sync; (d) re-exports useSessionManager and JWT utils (React Native safe, no DOM deps).
- [2026-05-16] T011 Step 5: Updated artifacts/ajkmart/context/AuthContext.tsx — added import of bootstrapSdkAuth, syncAccessToken, clearSdkTokens from @/lib/sdkAuthClient; added useEffect that syncs token state → syncAccessToken(token) on every token change; added bootstrapSdkAuth() call at top of loadAuth() effect; added clearSdkTokens() to doLogout() before SecureStore wipe.
- [2026-05-16] T011 Step 6: Fixed lib/auth-react/tsconfig.json — changed include to ["src/**/*.ts","src/**/*.tsx"] for tsup DTS compatibility. Added tsconfig.build.json (composite: false) used by tsup so project references (composite: true) and DTS build don't conflict. Updated build/dev scripts to use --tsconfig tsconfig.build.json. Build verified: dist/index.cjs 71.89 KB, dist/index.js 65.94 KB, dist/index.d.ts 12.22 KB — no TS errors.
- [2026-05-16] T011 COMPLETE -- @workspace/auth-react fully wired into Expo customer app. AuthContext keeps SDK token cache in sync. useSessionManager available for profile/settings screens via import from @/lib/sdkAuthClient. LoginScreen/OtpInput/etc. from shared SDK intentionally not used in React Native (they are web-HTML-only; customer app uses its own native auth UI components from @/components/auth-shared which are already production-quality). getAuthClient() available for future API modules that want the shared retry/backoff client.
- [2026-05-16] T012 IN PROGRESS -- Comprehensive tests & documentation.
- [2026-05-16] T012 Step 1: Backend auth route tests (artifacts/api-server/tests/auth/) — 4 test files (identifier.test.ts 8 tests, otp.test.ts 9 tests, refresh.test.ts 8 tests, two-factor.test.ts 8 tests). All 33 pass. Uses Vitest + Supertest with a full mock layer for DB, Redis, and shared helpers.
- [2026-05-16] T012 Step 2: auth-react library tests (lib/auth-react/tests/) — 35 tests across useLoginFlow.test.ts (11), LoginScreen.test.tsx (10), OtpInput.test.tsx (13+1 new). Fixed React 19 + @testing-library/react compatibility (inline deps, IS_REACT_ACT_ENVIRONMENT, development resolve conditions). Fixed fake-timer + waitFor deadlock in OtpInput resend test.
- [2026-05-16] T012 Step 3: Playwright E2E suite (e2e/) — playwright.config.ts, auth.spec.ts (login flow), vendor-auth.spec.ts, rider-auth.spec.ts.
- [2026-05-16] T012 Step 4: Swagger docs — updated artifacts/api-server/src/docs/swagger.ts; @openapi JSDoc blocks on all 12 auth endpoints.
- [2026-05-16] T012 Step 5: Created docs/AUTH.md (comprehensive auth system guide) and root README.md (monorepo overview, quick-start, architecture).
- [2026-05-16] T012 COMPLETE -- 33 backend auth tests (Vitest + Supertest), 35 auth-react tests (Vitest + RTL, React 19 compatible), Playwright E2E suite (3 spec files), complete Swagger docs, docs/AUTH.md, README.md.
- [2026-05-17] T011 COMPLETED (full migration) -- Completed all remaining gaps in Expo customer app SDK migration:
  1. sdkAuthClient.ts: Exported `syncedStorage` (in-memory TokenStorage mirror) so AuthContext can wire it into SdkAuthProvider.
  2. AuthContext.tsx: Replaced 40-line custom JWT decode implementation (decodeJwtClaims + decodeJwtExp with Buffer fallback) with thin wrappers around `decodeJwt` from @workspace/auth-react. Imported and wrapped the customer AuthContext.Provider inside `<SdkAuthProvider baseURL tokenStorage={syncedStorage} refreshEndpoint>` so SDK hooks (useSessionManager, useAuth from SDK) work anywhere in the app tree. SdkAuthProvider uses the same in-memory syncedStorage that AuthContext keeps in sync, so both layers always see the same access token.
  3. auth/index.tsx: Added doc comment explaining why LoginScreen component from SDK cannot be used (web-only HTML elements) and that this screen is the React Native implementation of the same LoginScreenProps contract.
  4. auth/register.tsx: Added doc comment explaining why OtpInput/PhoneInput from SDK cannot be used (web-only HTML elements) and that OtpDigitInput/PhoneInput from auth-shared.tsx are the Expo-native equivalents.
  5. progress.md: Updated T011 completion date to 2026-05-17 and added this action log entry.
- [2026-05-17] T004 HARDENED -- Created dedicated artifacts/api-server/src/routes/auth/sessions.ts: POST /auth/sessions/revoke with Zod union schema validation, ownership checks via JWT payload userId, current-session identification by sha256(accessToken) tokenHash, blacklistJti() call on self-revoke and on bulk revoke (bumps tokenVersion), revokedAt + refreshToken revocation for each removed session, structured audit log, { revokedCount } response. Mounted in auth/index.ts. Refactored docs/swagger.ts to export plain swaggerSpec object (OpenAPI 3.1, version from package.json, BearerAuth security scheme). Mounted /api-docs via swaggerUi.serve + swaggerUi.setup(swaggerSpec, { tryItOutEnabled: false }) in routes/index.ts. Removed old router-based /api-docs mount from app.ts.

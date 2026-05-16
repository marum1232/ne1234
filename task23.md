Neeche 12 sequential tasks diye gaye hain. Har task ka prompt Replit agent ko exactly waise dena jaise likha hai. Agent har task ko verify, complete, test, aur progress.md update karta rahega.

📋 Initial Instruction (Agent ko pehle ye dena)
text
You are an AI agent tasked with fixing and upgrading the AJKMart authentication system across backend, rider-app, vendor-app, customer-app, and admin. Follow these rules strictly:

1. Create a file `progress.md` in the project root if it doesn't exist. Log every action you take with timestamp and status.
2. You will receive 12 tasks one by one. For each task:
   - First, read `progress.md` to check if previous tasks are marked COMPLETE.
   - If any previous task is INCOMPLETE or MISSING, complete it before starting the current task.
   - After completing the current task, run verification tests (described in task).
   - If tests pass, update `progress.md` marking the task as COMPLETE with a summary.
   - If tests fail, fix the issues, re-test, then update.
3. Always write real-time updates to `progress.md` (don't batch at the end).
4. Never skip verification. Never mark a task complete without testing.
5. Use the existing codebase. Do not delete any working functionality unless required.
📌 Task 1 – Critical Security & Bug Fixes
text
TASK 1: CRITICAL SECURITY & BUG FIXES

Fix the following issues (in order):

1. Remove `req.body.token` fallback in `extractAuthUser` (file: api-server/src/routes/auth/helpers.ts line ~264). Only accept Authorization header.

2. Delete hardcoded "000000" OTP bypass:
   - In customer-app: `ajkmart/app/auth/index.tsx` search for "000000" and remove the bypass logic.
   - In vendor-app: `vendor-app/src/pages/Login.tsx` search for "000000" and remove.
   - Instead, if OTP bypass is needed for development, use env var `OTP_BYPASS_PHONE` on backend only.

3. Fix UTF-8 decoding in vendor `decodeJwtExp`:
   - File: `vendor-app/src/lib/auth.tsx` (line ~45)
   - Replace current implementation with:
     const base64Url = token.split('.')[1];
     const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
     const json = decodeURIComponent(escape(atob(base64)));
     return JSON.parse(json).exp;

4. Fix `verifyTokenFamily` in `api-server/src/middleware/auth.ts` (line ~44):
   - Currently uses `LIMIT 1` which may miss FAMILY_BREACH_DETECTED.
   - Modify query to check ALL tokens in family for revokedReason = 'FAMILY_BREACH_DETECTED'.

5. Move `pendingTotpSecrets` from in-memory object to Redis or database table `user_totp_setup` (create table if not exists). Update TOTP setup/verify endpoints accordingly.

VERIFICATION:
- Run backend: `cd api-server && npm run test:auth` (if exists) or manually hit endpoints.
- Check that vendor login with non-ASCII JWT claim works.
- Confirm that account breach detection still works.

After fixing, update progress.md: "TASK 1 COMPLETE – All security fixes applied and verified."
📌 Task 2 – Split Backend Auth Router
text
TASK 2: SPLIT BACKEND AUTH ROUTER (5,132 lines → modular)

Split `api-server/src/routes/auth/index.ts` into separate files under `api-server/src/routes/auth/`:

Create this structure:
routes/auth/
├── index.ts (only router mounting, no logic)
├── config.ts (GET /config, GET /otp-status)
├── identifier.ts (POST /check-identifier)
├── otp.ts (POST /send-otp, POST /verify-otp)
├── email-otp.ts (POST /send-email-otp, POST /verify-email-otp)
├── password.ts (POST /login, POST /forgot-password, POST /reset-password)
├── register.ts (POST /register, POST /vendor-register)
├── refresh.ts (POST /refresh, POST /logout)
├── social.ts (POST /social/google, /facebook, /link-google, /link-facebook)
├── two-factor.ts (POST /2fa/verify, /setup, /disable, /recovery)
├── magic-link.ts (POST /magic-link/send, /verify)
├── merge.ts (POST /merge/send-otp, /confirm)
└── helpers.ts (already exists, keep shared functions)

text

Requirements:
- Each file must import `helpers.ts` for shared logic.
- Rate limiting and audit middleware apply at route level.
- Ensure all imports are updated.
- The main `index.ts` should only do `router.use('/config', configRouter)` etc.

VERIFICATION:
- Run `cd api-server && npm run build` (no errors).
- Test at least one endpoint from each new file (e.g., POST /auth/login, /auth/send-otp).
- Confirm that all existing auth flows still work (use postman or curl).

Update progress.md after success.
📌 Task 3 – Remove Duplicate Schemas & Helpers (Backend)
text
TASK 3: REMOVE DUPLICATE SCHEMAS & HELPERS (BACKEND)

Duplicate definitions exist between `auth/index.ts` and `auth/helpers.ts`. Fix:

1. Open `api-server/src/routes/auth/helpers.ts`. Ensure it exports:
   - `registerSchema`, `forgotPasswordSchema`, `checkIdentifierSchema`, `phoneSchema`, `refreshTokenSchema`
   - `isVendorSession`, `isRiderSession`
   - `normalizeVehicleType` (but this should be moved to shared package later – for now keep)

2. Delete the following from `auth/index.ts` (they are already in helpers.ts):
   - Lines containing `const registerSchema = ...` (around line 159)
   - `const forgotPasswordSchema = ...` (line 150)
   - `const checkIdentifierSchema = ...` (line 120)
   - `const phoneSchema = ...` (line 126)
   - `const refreshTokenSchema = ...` (line 140)
   - Function `isVendorSession`, `isRiderSession` (inline versions)

3. In `auth/index.ts`, import them from `./helpers` instead of redefining.

4. For `normalizeVehicleType`: it appears in `auth/helpers.ts` and `rider/index.ts`. Leave both for now but add a TODO comment to move to shared package.

VERIFICATION:
- Backend builds without errors.
- Run a registration flow – it should still validate correctly.
- No duplicate definitions remain (grep for "registerSchema" in index.ts should show only import).

Update progress.md.
📌 Task 4 – Add Missing Backend Features
text
TASK 4: ADD MISSING BACKEND FEATURES

Implement three missing features:

1. Session Revocation API:
   - Endpoint: `POST /api/auth/sessions/revoke`
   - Auth required (Bearer token)
   - Body: `{ sessionId: string }` or `{ revokeAllExceptCurrent: true }`
   - Delete/revoke the session from `user_sessions` table.
   - If revokeAllExceptCurrent, keep current session and delete others.

2. Account Recovery with Backup Codes (when both email/phone lost):
   - Add admin-only endpoint: `POST /api/admin/users/:userId/recovery`
   - Generates a one-time recovery link (expires in 1 hour) and sends to user's registered email.
   - User can set new password via that link without OTP.

3. OpenAPI Specification Generation:
   - Install `swagger-jsdoc` and `swagger-ui-express`.
   - Create `api-server/src/docs/swagger.ts` that reads all route JSDoc comments.
   - Add JSDoc comments to at least the main auth endpoints (login, register, refresh, logout, verify-otp).
   - Mount Swagger UI at `/api-docs`.

VERIFICATION:
- Use curl to test session revocation: login twice, get two session IDs, revoke one, confirm that token no longer works.
- Admin recovery: use admin token to call recovery endpoint, verify email received, use link to reset password.
- Visit `/api-docs` in browser – see OpenAPI UI.

Update progress.md.
📌 Task 5 – Create Shared Auth-React Package (Scaffolding)
text
TASK 5: CREATE SHARED AUTH-REACT PACKAGE (SCAFFOLDING)

Create a new package `@workspace/auth-react` inside the monorepo (assume workspace structure). If no monorepo, create `packages/auth-react` folder.

Steps:

1. Create folder `packages/auth-react/`
2. Inside, run `npm init -y` and set `"name": "@workspace/auth-react", "version": "0.0.1", "main": "dist/index.js", "types": "dist/index.d.ts"`
3. Install dependencies: `react`, `react-dom`, `typescript`, `tsup` (for bundling)
4. Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "jsx": "react-jsx",
    "declaration": true,
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true
  },
  "include": ["src"]
}
Create src/index.ts (just export placeholder: export const version = '0.0.1';)

Create src/AuthProvider.tsx with minimal context stub.

Update package.json scripts: "build": "tsup src/index.ts --format esm,cjs --dts"

VERIFICATION:

Run npm run build inside packages/auth-react – it generates dist/ folder.

No errors.

The package can be imported from any app (we will test later).

Update progress.md with directory tree and build success.

text

---

## 📌 Task 6 – Unified Token Storage & API Client in Shared Package

```text
TASK 6: IMPLEMENT UNIFIED TOKEN STORAGE & API CLIENT

Inside `@workspace/auth-react/src/`:

1. Create `api/tokenStorage.ts`:
   - Define interface `TokenStorage` with `getAccessToken()`, `setAccessToken()`, `removeAccessToken()`.
   - Implement `WebStorage` (uses `sessionStorage` or `localStorage`).
   - Implement `SecureStorage` (uses Capacitor Preferences for web, expo-secure-store for native – use platform detection).
   - Export factory `createTokenStorage(type: 'web' | 'native' | 'memory')`.

2. Create `api/authClient.ts`:
   - Factory `createAuthClient({ baseURL, tokenStorage, onUnauthorized })`
   - Returns `post`, `get`, `put`, `delete` methods that automatically attach access token.
   - Add interceptors for token refresh on 401 (call refresh endpoint using refresh token cookie).
   - Include `withRetry` logic (max 3 retries, exponential backoff).

3. Create `utils/jwtUtils.ts`:
   - `decodeJwt(token)` – safe UTF-8 decoder (copied from vendor fix).
   - `isTokenExpired(token, leewaySeconds = 60)`.
   - `getTokenExpiryRemaining(token)`.

VERIFICATION:
- Write a simple test script inside package (or test in an app later) that stores and retrieves a fake token.
- Ensure `decodeJwt` works with non-ASCII JWT claims.

Update progress.md after all functions are implemented and no TypeScript errors.
📌 Task 7 – Shared Hooks (useAuth, useTokenRefresh, useLoginFlow)
text
TASK 7: IMPLEMENT SHARED HOOKS

Inside `@workspace/auth-react/src/hooks/`:

1. `useTokenRefresh.ts`:
   - Accept `{ refreshIntervalSeconds, onLogout }`.
   - Schedule proactive refresh at (expiry - 60s).
   - Implement exponential backoff on failure (max 5 attempts).
   - Deduplicate concurrent refresh requests using a ref.
   - Return `refreshToken` function.

2. `useAuth.ts`:
   - Uses `useContext(AuthContext)` – create AuthContext in `AuthProvider.tsx`.
   - Provide `user`, `login`, `logout`, `isLoading`, `twoFactorPending`, `storageError`.
   - Integrate `useTokenRefresh` automatically.

3. `useLoginFlow.ts`:
   - Orchestrate the entire login sequence: call `/check-identifier` → determine method (OTP/password/social) → call respective verify endpoint → handle 2FA → finalize.
   - Return `{ initiateLogin, verifyOtp, verifyPassword, twoFactorVerify, loading, error }`.

4. Export all hooks from `src/index.ts`.

VERIFICATION:
- No TypeScript errors.
- Create a dummy app (or use existing test setup) to ensure hooks can be imported and called without runtime errors.
- Since actual API calls depend on backend, we will verify integration in later tasks.

Update progress.md.
📌 Task 8 – Shared UI Components (LoginScreen, OtpInput, etc.)
text
TASK 8: IMPLEMENT SHARED UI COMPONENTS

Inside `@workspace/auth-react/src/components/`:

1. `OtpInput.tsx` – 6-digit input with auto-submit, paste, timer resend, cooldown display.
2. `PhoneInput.tsx` – country code picker + phone number input with E.164 formatting.
3. `PasswordInput.tsx` – show/hide toggle, strength indicator (optional).
4. `SocialButtons.tsx` – Google and Facebook login buttons with loading states.
5. `BiometricPrompt.tsx` – checks availability, prompts enrollment, stores refresh token for biometric.
6. `LoginScreen.tsx` – the main component that accepts `role` prop ('rider'|'vendor'|'customer'|'admin') and optional `customFields` (e.g., vehicleType for rider, storeName for vendor). It uses `useLoginFlow` and renders the appropriate UI based on `action` from check-identifier.

Make all components use Tailwind CSS (if project uses it) or plain CSS modules. Accept `className` override.

Export all from `src/index.ts`.

VERIFICATION:
- Run `npm run build` – no errors.
- Visually test components by temporarily mounting them in an app (we will do in migration tasks).
- Ensure each component has proper prop typing.

Update progress.md.
📌 Task 9 – Migrate Vendor App to Shared SDK
text
TASK 9: MIGRATE VENDOR APP TO SHARED SDK

Target: `vendor-app/`

Steps:

1. Install `@workspace/auth-react` in vendor-app: `npm install ../packages/auth-react` (or use workspace symlink).

2. Extract registration logic from `vendor-app/src/pages/Login.tsx` into a new file `vendor-app/src/pages/Register.tsx` (multi-step: store info, documents, bank). Remove registration UI from Login.tsx.

3. Replace `vendor-app/src/lib/auth.tsx` – delete it. Use `AuthProvider` from shared package in `App.tsx`:
   ```tsx
   import { AuthProvider } from '@workspace/auth-react';
   <AuthProvider role="vendor" tokenStorageType="web">
     <AppRoutes />
   </AuthProvider>
Replace vendor-app/src/pages/Login.tsx with:

tsx
import { LoginScreen } from '@workspace/auth-react';
export default function Login() {
  return <LoginScreen role="vendor" customFields={['storeName', 'cnic']} />;
}
Update vendor-app/src/lib/api.ts to use createAuthClient from shared package instead of custom implementation. Remove all auth logic.

Test: Run vendor-app, login with existing vendor account, OTP, password, 2FA – all should work.

VERIFICATION:

Vendor login works (use test credentials).

Registration page is separate and works.

No console errors related to auth.

Update progress.md with migration success.

text

---

## 📌 Task 10 – Migrate Rider App to Shared SDK

```text
TASK 10: MIGRATE RIDER APP TO SHARED SDK

Target: `rider-app/`

Steps:

1. Install `@workspace/auth-react` similarly.

2. Delete `rider-app/src/lib/auth.tsx` and `rider-app/src/pages/Login.tsx` and `rider-app/src/pages/Register.tsx`.

3. In `rider-app/src/App.tsx`, wrap with `AuthProvider` (role="rider", tokenStorageType="web").

4. Create new `rider-app/src/pages/Login.tsx`:
   ```tsx
   import { LoginScreen } from '@workspace/auth-react';
   export default function Login() { return <LoginScreen role="rider" customFields={['vehicleType', 'license']} />; }
Create new rider-app/src/pages/Register.tsx using shared components? Actually rider registration has document uploads – you may need to extend LoginScreen with onRegister callback. For now, keep a simple register page that calls /api/auth/register with rider-specific fields. Ensure it works.

Update rider-app/src/lib/api.ts to use createAuthClient from shared package.

Test rider login and registration (including document upload).

VERIFICATION:

Rider can login with OTP/password.

New rider registration goes to pending approval.

Biometric enrollment prompt appears if supported.

Update progress.md.

text

---

## 📌 Task 11 – Migrate Customer App to Shared SDK

```text
TASK 11: MIGRATE CUSTOMER APP (EXPO) TO SHARED SDK

Target: `ajkmart/` (Expo React Native)

Challenges: Native vs Web. The shared package must support both.

Steps:

1. In `packages/auth-react`, add native support:
   - Modify `tokenStorage.ts` to detect `expo-secure-store` and use it.
   - Use `react-native` conditionals in package.json `exports` field.

2. In customer app, install `@workspace/auth-react` and `expo-secure-store`.

3. Replace `ajkmart/context/AuthContext.tsx` with `AuthProvider` from shared package.

4. Replace `ajkmart/app/auth/index.tsx` – use `LoginScreen` with `role="customer"`.

5. Add missing features: Magic link and social login buttons – they are already in shared `SocialButtons` and `LoginScreen` supports them via props `enableMagicLink`, `enableSocial`.

6. Update `ajkmart/app/auth/register.tsx` to use shared components for phone input, OTP, etc.

7. Test on iOS simulator and web.

VERIFICATION:
- Customer can register, login, use biometric (Face ID/Touch ID).
- Logout works, location clear happens (you may need to add custom logout hook).
- Socket.io reconnects with new token.

Update progress.md.
📌 Task 12 – Comprehensive Tests & Documentation
text
TASK 12: COMPREHENSIVE TESTS & DOCUMENTATION

Write automated tests and final docs.

1. Backend tests (Vitest + Supertest):
   - File: `api-server/tests/auth/` – create tests for:
     * `check-identifier` with different user states
     * OTP send/verify with rate limiting
     * Token refresh and family breach detection
     * 2FA setup and recovery
   - Aim for >80% coverage on auth routes.

2. Frontend component tests (React Testing Library):
   - In `packages/auth-react/tests/` – test `OtpInput`, `LoginScreen` (mock API calls).
   - Ensure `useLoginFlow` handles errors correctly.

3. E2E tests (Playwright) – minimal happy paths:
   - Customer registration → login → logout
   - Rider login with 2FA
   - Vendor password reset

4. Documentation:
   - Generate OpenAPI spec (already started in Task 4). Ensure all auth endpoints are documented.
   - Create `docs/AUTH.md` explaining token rotation, device fingerprint, rate limits, error codes.
   - Update root `README.md` with link to auth guide.

5. Final verification: Run all tests, fix any failures. Ensure no console errors or warnings.

After all pass, update `progress.md` with final summary and mark TASK 12 COMPLETE.

THE SYSTEM IS NOW PRODUCTION-READY.
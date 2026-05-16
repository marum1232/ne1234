# AJKMart Authentication System

## Overview

AJKMart uses a unified, token-based authentication system shared across all client apps (customer, vendor, rider) via the `@workspace/auth-react` shared package. The backend is a modular Express 5.x router in `artifacts/api-server/src/routes/auth/`.

---

## Architecture

```
lib/auth-react/          ← Shared auth SDK (hooks, components, token storage)
├── src/hooks/           ← useAuth, useLoginFlow, useTokenRefresh
├── src/components/      ← LoginScreen, OtpInput, PhoneInput, PasswordInput, SocialButtons, BiometricPrompt
├── src/api/             ← authClient, tokenStorage
└── src/utils/           ← jwtUtils

artifacts/api-server/src/routes/auth/   ← Backend auth router (modular)
├── config.ts            ← Auth feature flags
├── identifier.ts        ← /check-identifier (smart routing)
├── otp.ts               ← /send-otp, /verify-otp
├── email-otp.ts         ← /send-email-otp, /verify-email-otp
├── password.ts          ← /login-password
├── register.ts          ← /register
├── refresh.ts           ← /refresh, session management
├── two-factor.ts        ← TOTP setup, verify-2fa
├── magic-link.ts        ← Magic link send/verify
├── social.ts            ← Google/Facebook OAuth
└── helpers.ts           ← Shared schemas and utilities
```

---

## Auth Flows

### OTP (Phone/Email)
1. Client calls `POST /api/auth/check-identifier` → server returns `action` (e.g., `send_phone_otp`)
2. Client calls `POST /api/auth/send-otp` or `POST /api/auth/send-email-otp`
3. User enters OTP → client calls `POST /api/auth/verify-otp`
4. Server returns `{ token, refreshToken }` → stored in tokenStorage

### Password
1. `check-identifier` returns `login_password`
2. Client calls `POST /api/auth/login-password`
3. Server returns `{ token, refreshToken }`

### 2FA (TOTP)
1. After initial auth, server returns `{ requires2FA: true, tempToken }`
2. Client calls `POST /api/auth/verify-2fa` with `{ tempToken, totpCode }`

### Magic Link
1. Client calls `POST /api/auth/magic-link/send`
2. User clicks link → client calls `POST /api/auth/magic-link/verify`

### Social (Google/Facebook)
1. Client obtains ID token from provider SDK
2. Client calls `POST /api/auth/social-google` or `POST /api/auth/social-facebook`

---

## Token Management

- **Access token**: Short-lived JWT (configurable lifetime), stored in `tokenStorage`
- **Refresh token**: Long-lived, stored in `tokenStorage` (SecureStore on mobile, httpOnly cookie / localStorage on web)
- **Token family breach detection**: If a refresh token is reused after rotation, the entire family is invalidated (`FAMILY_BREACH_DETECTED`)
- **Proactive refresh**: Access tokens are refreshed at 85% of lifetime to avoid expiry mid-session

---

## Client App Integration

### Vendor App (`artifacts/vendor-app/`)
- `src/lib/vendor-auth.tsx` — VendorAuthProvider (wraps `SharedAuthProvider` from `@workspace/auth-react`)
- `src/pages/Login.tsx` — Uses `LoginScreen` + individual components from `@workspace/auth-react`

### Rider App (`artifacts/rider-app/`)
- `src/lib/rider-auth.tsx` — RiderAuthProvider (wraps `SharedAuthProvider`)
- `src/pages/Login.tsx` — Uses `LoginScreen` from `@workspace/auth-react`

### Customer App (`artifacts/ajkmart/`)
- `context/AuthContext.tsx` — Full auth context (uses `@workspace/auth-react` types)
- `app/auth/index.tsx` — Login screen (follows `LoginScreen` contract from `@workspace/auth-react`)

---

## Security Features

| Feature | Implementation |
|---|---|
| Token family breach detection | `FAMILY_BREACH_DETECTED` flag in middleware |
| TOTP / 2FA | RFC 6238, secrets stored in DB (not in-memory) |
| Rate limiting | Per-route limits via express-rate-limit |
| OTP brute-force protection | Attempt counter + lockout in DB |
| Device fingerprinting | `deviceId` sent with auth requests |
| UTF-8 safe JWT decode | `decodeURIComponent(escape(atob()))` pattern |
| Account recovery | `POST /api/admin/auth/recovery` (admin only) |

---

## Admin Auth Recovery

Admins can recover locked/suspended accounts via:

```
POST /api/admin/auth/recovery
Authorization: Bearer <admin-token>

{
  "targetUserId": "user-id",
  "action": "unlock" | "unsuspend" | "reset_attempts" | "force_logout",
  "reason": "Reason for recovery action (min 10 chars)"
}
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `JWT_SECRET` | Secret for signing access tokens |
| `REFRESH_TOKEN_SECRET` | Secret for signing refresh tokens |
| `JWT_EXPIRY` | Access token lifetime (default: `15m`) |
| `REFRESH_TOKEN_EXPIRY` | Refresh token lifetime (default: `30d`) |
| `CAPTCHA_SECRET_KEY` | reCAPTCHA server-side secret |

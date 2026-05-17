# @workspace/auth-react

Shared authentication UI and logic for AJKMart web apps (vendor portal, rider PWA).

## Installation

This package is available as a workspace dependency — no extra install needed:

```json
"@workspace/auth-react": "workspace:*"
```

## Basic usage

Wrap your app with `AuthProvider`, then use the pre-built `LoginScreen` component:

```tsx
import { AuthProvider, LoginScreen } from "@workspace/auth-react";

function App() {
  return (
    <AuthProvider baseURL="/api" tokenStorage="web">
      <LoginScreen onSuccess={() => navigate("/dashboard")} />
    </AuthProvider>
  );
}
```

## Key hooks

| Hook | Purpose |
|---|---|
| `useAuth()` | Access `user`, `token`, `logout()`, and auth state |
| `useLoginFlow()` | Drive the OTP / password / 2FA login state machine |

## Token storage modes

| Mode | Used for | Backing store |
|---|---|---|
| `"web"` | Browser apps | `localStorage` |
| `"native"` | Expo / React Native | `expo-secure-store` |

## Components

- `LoginScreen` — full phone/OTP and username/password login UI (web only)
- `OtpInput` — 6-digit OTP input with auto-advance and paste support
- `PhoneInput` — international phone number input with country picker
- `PasswordInput` — password field with show/hide toggle
- `SocialButtons` — Google and Facebook sign-in buttons
- `BiometricPrompt` — biometric authentication prompt overlay

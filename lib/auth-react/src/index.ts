export const version = '0.0.1';

// AuthProvider & context
export { AuthProvider, useAuthContext, AuthContext } from './AuthProvider';
export type { AuthContextValue, AuthProviderProps, AuthUser } from './AuthProvider';

// Token storage
export { createTokenStorage, createNativeTokenStorage, getTokenStorage, SecureStorage } from './api/tokenStorage';
export type { TokenStorage, StorageType } from './api/tokenStorage';

// Auth client
export { createAuthClient } from './api/authClient';
export type { AuthClientOptions } from './api/authClient';

// JWT utilities
export { decodeJwt, isTokenExpired, getTokenExpiryRemaining } from './utils/jwtUtils';
export type { JwtPayload } from './utils/jwtUtils';

// Device fingerprint
export { getDeviceFingerprint } from './utils/deviceFingerprint';

// Hooks
export { useAuth } from './hooks/useAuth';
export { useTokenRefresh } from './hooks/useTokenRefresh';
export type { UseTokenRefreshOptions } from './hooks/useTokenRefresh';
export { useLoginFlow } from './hooks/useLoginFlow';
export type { UseLoginFlowOptions, LoginMethod, IdentifierCheckResult } from './hooks/useLoginFlow';
export { useSessionManager } from './hooks/useSessionManager';
export type {
  UseSessionManagerOptions,
  UseSessionManagerResult,
  Session,
  LoginHistoryEntry,
} from './hooks/useSessionManager';

// Components
export { OtpInput } from './components/OtpInput';
export type { OtpInputProps } from './components/OtpInput';
export { PhoneInput } from './components/PhoneInput';
export type { PhoneInputProps, Country } from './components/PhoneInput';
export { PasswordInput } from './components/PasswordInput';
export type { PasswordInputProps, PasswordStrength } from './components/PasswordInput';
export { SocialButtons } from './components/SocialButtons';
export type { SocialButtonsProps } from './components/SocialButtons';
export { BiometricPrompt } from './components/BiometricPrompt';
export type { BiometricPromptProps } from './components/BiometricPrompt';
export { LoginScreen } from './components/LoginScreen';
export type { LoginScreenProps, AppRole, CustomField } from './components/LoginScreen';
export { RegisterScreen } from './components/RegisterScreen';
export type { RegisterScreenProps, RegisterRole, FieldConfig, StepConfig, StepComponentProps } from './components/RegisterScreen';
export { SessionManagerScreen } from './components/SessionManagerScreen';
export type { SessionManagerScreenProps } from './components/SessionManagerScreen';

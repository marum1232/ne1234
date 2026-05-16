export const version = '0.0.1';

// AuthProvider & context
export { AuthProvider, useAuthContext, AuthContext } from './AuthProvider';
export type { AuthContextValue, AuthProviderProps, AuthUser } from './AuthProvider';

// Token storage
export { createTokenStorage } from './api/tokenStorage';
export type { TokenStorage, StorageType } from './api/tokenStorage';

// Auth client
export { createAuthClient } from './api/authClient';
export type { AuthClientOptions } from './api/authClient';

// JWT utilities
export { decodeJwt, isTokenExpired, getTokenExpiryRemaining } from './utils/jwtUtils';
export type { JwtPayload } from './utils/jwtUtils';

// Hooks
export { useAuth } from './hooks/useAuth';
export { useTokenRefresh } from './hooks/useTokenRefresh';
export type { UseTokenRefreshOptions } from './hooks/useTokenRefresh';
export { useLoginFlow } from './hooks/useLoginFlow';
export type { UseLoginFlowOptions, LoginMethod, IdentifierCheckResult } from './hooks/useLoginFlow';

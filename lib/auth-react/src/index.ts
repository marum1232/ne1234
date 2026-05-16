export const version = '0.0.1';

export { AuthProvider, useAuth } from './AuthProvider';
export type { AuthContextValue, AuthProviderProps, AuthUser } from './AuthProvider';

export { createTokenStorage } from './api/tokenStorage';
export type { TokenStorage, StorageType } from './api/tokenStorage';

export { createAuthClient } from './api/authClient';
export type { AuthClientOptions } from './api/authClient';

export { decodeJwt, isTokenExpired, getTokenExpiryRemaining } from './utils/jwtUtils';
export type { JwtPayload } from './utils/jwtUtils';

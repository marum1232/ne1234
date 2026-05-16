import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import type { TokenStorage, StorageType } from './api/tokenStorage';
import { createTokenStorage } from './api/tokenStorage';

export interface AuthUser {
  id: string;
  phone?: string;
  email?: string;
  role: 'customer' | 'rider' | 'vendor' | 'admin';
}

export interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  twoFactorPending: boolean;
  storageError: string | null;
  tokenStorage: TokenStorage;
  baseURL: string;
  refreshEndpoint: string;
  login: (user: AuthUser, accessToken: string) => void;
  logout: () => void;
  setTwoFactorPending: (pending: boolean) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  children: ReactNode;
  role?: AuthUser['role'];
  baseURL?: string;
  storageType?: StorageType;
  tokenStorage?: TokenStorage;
  refreshEndpoint?: string;
}

export function AuthProvider({
  children,
  baseURL = '',
  storageType = 'web',
  tokenStorage: externalStorage,
  refreshEndpoint = '/api/auth/refresh',
}: AuthProviderProps) {
  const [tokenStorage] = useState<TokenStorage>(
    () => externalStorage ?? createTokenStorage(storageType)
  );

  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [twoFactorPending, setTwoFactorPending] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);

  const login = useCallback(
    (authUser: AuthUser, accessToken: string) => {
      try {
        tokenStorage.setAccessToken(accessToken);
        setStorageError(null);
      } catch (err) {
        setStorageError(
          err instanceof Error ? err.message : 'Failed to persist token'
        );
      }
      setUser(authUser);
      setTwoFactorPending(false);
      setIsLoading(false);
    },
    [tokenStorage]
  );

  const logout = useCallback(() => {
    try {
      tokenStorage.removeAccessToken();
    } catch {
      // best-effort
    }
    setUser(null);
    setTwoFactorPending(false);
    setIsLoading(false);
  }, [tokenStorage]);

  const value: AuthContextValue = {
    user,
    isLoading,
    isAuthenticated: user !== null,
    twoFactorPending,
    storageError,
    tokenStorage,
    baseURL,
    refreshEndpoint,
    login,
    logout,
    setTwoFactorPending,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Low-level hook — prefer the `useAuth` hook from hooks/useAuth.ts */
export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuthContext must be used inside <AuthProvider>');
  }
  return ctx;
}

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import type { TokenStorage, StorageType } from './api/tokenStorage';
import { createTokenStorage } from './api/tokenStorage';
import { decodeJwt, isTokenExpired } from './utils/jwtUtils';

export interface AuthUser {
  id: string;
  phone?: string;
  email?: string;
  role: 'customer' | 'rider' | 'vendor' | 'admin';
  approvalStatus?: string;
  rejectionReason?: string | null;
}

export interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isInitializing: boolean;
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
  const [isInitializing, setIsInitializing] = useState(true);
  const [twoFactorPending, setTwoFactorPending] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);

  const hasMounted = useRef(false);

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
    try {
      tokenStorage.removeRefreshToken();
    } catch {
      // best-effort
    }
    setUser(null);
    setTwoFactorPending(false);
    setIsLoading(false);
  }, [tokenStorage]);

  // Silent session restore on mount — avoids logged-out flicker on page reload
  useEffect(() => {
    if (hasMounted.current) return;
    hasMounted.current = true;

    async function restore() {
      try {
        const existingToken = tokenStorage.getAccessToken();

        if (!existingToken) {
          setIsInitializing(false);
          return;
        }

        // Token exists and is still valid — decode and restore user
        if (!isTokenExpired(existingToken)) {
          const payload = decodeJwt(existingToken);
          if (payload && payload.sub) {
            const restoredUser: AuthUser = {
              id: String(payload.sub),
              phone: payload.phone as string | undefined,
              email: payload.email as string | undefined,
              role: (payload.role as AuthUser['role']) ?? 'customer',
              approvalStatus: payload.approvalStatus as string | undefined,
              rejectionReason: payload.rejectionReason as string | null | undefined,
            };
            setUser(restoredUser);
            setIsInitializing(false);
            return;
          }
        }

        // Token expired — attempt a silent refresh
        try {
          const res = await fetch(`${baseURL}${refreshEndpoint}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
          });

          if (res.ok) {
            const text = await res.text();
            let data: { accessToken?: string; user?: AuthUser; data?: { accessToken?: string; user?: AuthUser } } = {};
            try { data = JSON.parse(text); } catch { /* ignore */ }

            const newToken =
              data.accessToken ?? data.data?.accessToken ?? null;
            const refreshedUser = data.user ?? data.data?.user ?? null;

            if (newToken) {
              tokenStorage.setAccessToken(newToken);
              if (refreshedUser) {
                setUser(refreshedUser);
              } else {
                const payload = decodeJwt(newToken);
                if (payload?.sub) {
                  setUser({
                    id: String(payload.sub),
                    phone: payload.phone as string | undefined,
                    email: payload.email as string | undefined,
                    role: (payload.role as AuthUser['role']) ?? 'customer',
                    approvalStatus: payload.approvalStatus as string | undefined,
                    rejectionReason: payload.rejectionReason as string | null | undefined,
                  });
                }
              }
            } else {
              // Refresh returned nothing valid — clear both tokens
              tokenStorage.removeAccessToken();
              tokenStorage.removeRefreshToken();
            }
          } else {
            // Refresh failed — clear both tokens
            tokenStorage.removeAccessToken();
            tokenStorage.removeRefreshToken();
          }
        } catch {
          // Network error during silent refresh — stay logged out
          tokenStorage.removeAccessToken();
          tokenStorage.removeRefreshToken();
        }
      } finally {
        setIsInitializing(false);
      }
    }

    void restore();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: AuthContextValue = {
    user,
    isLoading,
    isAuthenticated: user !== null,
    isInitializing,
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

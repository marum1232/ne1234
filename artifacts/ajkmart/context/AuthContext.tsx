import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  setAuthTokenGetter,
  setOnUnauthorized,
  setRefreshTokenGetter,
  setOnTokenRefreshed,
} from "@workspace/api-client-react";
import {
  decodeJwt as sdkDecodeJwt,
  AuthProvider as SdkAuthProvider,
  useAuthContext as useSdkAuth,
} from "@workspace/auth-react";
import type { AuthUser as BaseAuthUser } from "@workspace/auth-react";

import { useLanguage } from "./LanguageContext";
import { io, type Socket } from "socket.io-client";
import { API_BASE, SOCKET_BASE } from "@/utils/api";
import { createLogger } from "@/utils/logger";
import {
  bootstrapSdkAuth,
  syncAccessToken,
  clearSdkTokens,
  syncedStorage,
} from "@/lib/sdkAuthClient";

const log = createLogger("[AuthContext]");

export type UserRole = "customer" | "rider" | "vendor";

export interface AppUser {
  id: string;
  phone: string;
  name?: string;
  email?: string;
  username?: string;
  roles: string[];
  avatar?: string;
  walletBalance: string;
  isActive: boolean;
  createdAt: string;
  cnic?: string;
  city?: string;
  area?: string;
  address?: string;
  latitude?: string;
  longitude?: string;
  accountLevel?: string;
  kycStatus?: string;
  totpEnabled?: boolean;
  hasPassword?: boolean;
}

/** Returns true if the user has the given role in their roles array. */
export function hasRole(user: AppUser | null, role: string): boolean {
  if (!user) return false;
  return (user.roles ?? []).includes(role);
}

interface TwoFactorPending {
  tempToken: string;
  userId: string;
}

interface AuthContextType {
  user: AppUser | null;
  token: string | null;
  isLoading: boolean;
  isSuspended: boolean;
  suspendedMessage: string;
  biometricEnabled: boolean;
  twoFactorPending: TwoFactorPending | null;
  isCustomer: boolean;
  login: (user: AppUser, token: string, refreshToken?: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (updates: Partial<AppUser>) => void;
  clearSuspended: () => void;
  setBiometricEnabled: (enabled: boolean) => Promise<void>;
  setTwoFactorPending: (pending: TwoFactorPending | null) => void;
  completeTwoFactorLogin: (
    user: AppUser,
    token: string,
    refreshToken?: string,
  ) => Promise<void>;
  attemptBiometricLogin: () => Promise<string | "transient_error" | null>;
  refreshToken: () => Promise<string | null>;
  socket: Socket | null;
}

const TOKEN_KEY = "ajkmart_token";
const REFRESH_TOKEN_KEY = "ajkmart_refresh_token";
const USER_KEY = "@ajkmart_user";
const BIOMETRIC_KEY = "@ajkmart_biometric_enabled";
const BIOMETRIC_TOKEN = "ajkmart_biometric_token";

const LEGACY_TOKEN_KEY = "@ajkmart_token";
const LEGACY_REFRESH_KEY = "@ajkmart_refresh_token";

/* Auth tokens are stored exclusively in SecureStore. If SecureStore is unavailable
   the error propagates to the caller (login is blocked), preventing silent
   fallback to unencrypted AsyncStorage which is readable on rooted devices. */
async function secureSet(key: string, value: string) {
  await SecureStore.setItemAsync(key, value);
}
async function secureGet(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}
async function secureDelete(key: string) {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch (e) {
    log.warn({ key, err: e }, "[auth] secureDelete: SecureStore removal failed (non-fatal — key may not exist)");
  }
  try {
    await AsyncStorage.removeItem(key);
  } catch (e) {
    log.warn({ key, err: e }, "[auth] secureDelete: AsyncStorage removal failed (non-fatal)");
  }
}

/* Migrate legacy AsyncStorage tokens to SecureStore and remove the unencrypted copies.
   Using a versioned SecureStore key ensures we only migrate once per device.
   Returns true if legacy tokens were found and migrated (or already migrated). */
const MIGRATED_KEY = "ajkmart_legacy_migration_v1";
async function migrateLegacyInsecureTokens(): Promise<boolean> {
  try {
    const alreadyMigrated = await SecureStore.getItemAsync(MIGRATED_KEY).catch(() => null);
    if (alreadyMigrated === "1") return false;

    const legacyEntries = await AsyncStorage.multiGet([LEGACY_TOKEN_KEY, LEGACY_REFRESH_KEY]);
    const legacyToken =
      legacyEntries.length >= 1 && Array.isArray(legacyEntries[0]) && legacyEntries[0].length >= 2
        ? legacyEntries[0][1]
        : null;
    const legacyRefresh =
      legacyEntries.length >= 2 && Array.isArray(legacyEntries[1]) && legacyEntries[1].length >= 2
        ? legacyEntries[1][1]
        : null;
    const hadLegacy = !!(legacyToken || legacyRefresh);

    if (hadLegacy) {
      const existingToken = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
      const existingRefresh = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY).catch(() => null);
      if (!existingToken && legacyToken) {
        await SecureStore.setItemAsync(TOKEN_KEY, legacyToken).catch((e) => {
          log.debug("[auth] Migration: failed to store access token:", e);
        });
      }
      if (!existingRefresh && legacyRefresh) {
        await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, legacyRefresh).catch((e) => {
          log.debug("[auth] Migration: failed to store refresh token:", e);
        });
      }
      await AsyncStorage.multiRemove([LEGACY_TOKEN_KEY, LEGACY_REFRESH_KEY]).catch((err) => {
        log.debug("[AuthContext] Legacy token cleanup failed:", err);
      });
    }

    await SecureStore.setItemAsync(MIGRATED_KEY, "1").catch((e) => {
      log.debug("[auth] Migration: failed to persist migration flag:", e);
    });
    return hadLegacy;
  } catch (e) {
    log.warn("migrateSecureStore failed — skipping migration:", e);
    return false;
  }
}

const AuthContext = createContext<AuthContextType | null>(null);

/**
 * Decode exp + iat from a JWT using the shared SDK utility.
 * Returns null if the token is malformed or missing required claims.
 */
function decodeJwtClaims(tok: string): { exp: number; iat: number } | null {
  const payload = sdkDecodeJwt(tok);
  if (!payload || typeof payload.exp !== "number" || typeof payload.iat !== "number") return null;
  return { exp: payload.exp, iat: payload.iat };
}

/** Decode only the exp claim (for expiry checks). */
function decodeJwtExp(tok: string): number | null {
  return sdkDecodeJwt(tok)?.exp ?? null;
}

/**
 * CustomerAuthInner — renders inside SdkAuthProvider so it can call useSdkAuth().
 *
 * This is the primary implementation layer for all customer auth state:
 * token management (SecureStore), proactive refresh, socket.io, biometric,
 * and offline queue. It bi-directionally syncs with the shared SDK auth state
 * via sdkCtx.login() / sdkCtx.logout() so that SDK hooks (useSessionManager,
 * useAuth from the SDK) see the same token that this context manages.
 */
function CustomerAuthInner({ children }: { children: React.ReactNode }) {
  /* ── Primary SDK auth context (SdkAuthProvider is the outer wrapper) ── */
  const sdkCtx = useSdkAuth();

  const queryClient = useQueryClient();
  const [user, setUser] = useState<AppUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSuspended, setIsSuspended] = useState(false);
  const [suspendedMessage, setSuspendedMessage] = useState("");
  const [biometricEnabled, setBiometricEnabledState] = useState(false);
  const [twoFactorPending, setTwoFactorPending] =
    useState<TwoFactorPending | null>(null);
  const [socketState, setSocketState] = useState<Socket | null>(null);
  const { syncToServer, setAuthToken } = useLanguage();
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshFailCountRef = useRef(0);
  const REFRESH_FAIL_CAP = 6;

  const userRef = useRef<AppUser | null>(null);
  const tokenRef = useRef<string | null>(null);
  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { tokenRef.current = token; }, [token]);

  const doLogoutRef = useRef<() => Promise<void>>(async () => {});

  const clearRefreshTimer = () => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  };

  const refreshingRef = useRef(false);

  // Maximum clock skew tolerated when checking stored-token expiry (5 minutes).
  const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

  const scheduleProactiveRefresh = (tok: string, backoffMs?: number) => {
    clearRefreshTimer();

    let refreshIn: number;

    if (backoffMs !== undefined) {
      refreshIn = backoffMs;
    } else {
      const claims = decodeJwtClaims(tok);
      if (!claims) return;

      const { exp, iat } = claims;
      const lifetimeMs = (exp - iat) * 1000;
      if (lifetimeMs <= 0) return;

      const lifetimeBased = lifetimeMs * 0.85;
      const clockCap = Math.max(exp * 1000 - Date.now() - 60_000, 10_000);
      refreshIn = Math.max(Math.min(lifetimeBased, clockCap), 10_000);
    }

    refreshTimerRef.current = setTimeout(async () => {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      try {
        const refreshToken = await secureGet(REFRESH_TOKEN_KEY);
        if (!refreshToken) {
          await doLogoutRef.current();
          return;
        }
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) {
          refreshFailCountRef.current = (refreshFailCountRef.current ?? 0) + 1;
          if (refreshFailCountRef.current > REFRESH_FAIL_CAP) {
            await doLogoutRef.current();
            return;
          }
          const backoff = Math.min(60_000 * Math.pow(2, refreshFailCountRef.current - 1), 15 * 60_000);
          scheduleProactiveRefresh(tok, backoff);
          return;
        }
        const data = (await res.json()) as { token?: string; refreshToken?: string };
        if (!data.token) {
          refreshFailCountRef.current = (refreshFailCountRef.current ?? 0) + 1;
          if (refreshFailCountRef.current > REFRESH_FAIL_CAP) {
            await doLogoutRef.current();
            return;
          }
          const backoff = Math.min(60_000 * Math.pow(2, refreshFailCountRef.current - 1), 15 * 60_000);
          scheduleProactiveRefresh(tok, backoff);
          return;
        }

        refreshFailCountRef.current = 0;

        const meRes = await fetch(`${API_BASE}/users/profile`, {
          headers: { Authorization: `Bearer ${data.token}` },
        });
        if (meRes.ok) {
          const meData = await meRes.json();
          const freshUser: AppUser = meData.data || meData.user || meData;
          setUser(freshUser);
          await AsyncStorage.setItem(USER_KEY, JSON.stringify(freshUser));
        }
        setToken(data.token);
        await secureSet(TOKEN_KEY, data.token);
        /* Sync refreshed token to the shared SDK primary auth state */
        syncedStorage.setAccessToken(data.token);
        if (data.refreshToken) {
          await secureSet(REFRESH_TOKEN_KEY, data.refreshToken);
          setRefreshTokenGetter(() => data.refreshToken!);
        }
        setAuthTokenGetter(() => data.token!);
        scheduleProactiveRefresh(data.token!);
      } catch (error) {
        refreshFailCountRef.current = (refreshFailCountRef.current ?? 0) + 1;
        if (refreshFailCountRef.current > REFRESH_FAIL_CAP) {
          await doLogoutRef.current();
          return;
        }
        const backoff = Math.min(60_000 * Math.pow(2, refreshFailCountRef.current - 1), 15 * 60_000);
        scheduleProactiveRefresh(tok, backoff);
      } finally {
        refreshingRef.current = false;
      }
    }, refreshIn);
  };

  const clearCustomerLocation = async (userId: string, userToken: string) => {
    try {
      await fetch(`${API_BASE}/locations/clear`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({ userId }),
      });
    } catch (e) {
      log.warn("clearCustomerLocation failed:", e);
    }
  };

  const doLogout = async () => {
    const tok = tokenRef.current;
    const u = userRef.current;
    if (u && hasRole(u, "customer") && tok) {
      clearCustomerLocation(u.id, tok).catch((err) => {
        log.warn("[AuthContext] Failed to clear customer location on logout:", err);
      });
    }

    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setSocketState(null);
    }

    clearRefreshTimer();
    clearSdkTokens();
    /* Sync logout to the shared SDK primary auth state */
    try { sdkCtx.logout(); } catch { /* non-fatal if SDK context not mounted */ }
    await AsyncStorage.multiRemove([USER_KEY, "@ajkmart_cart", "@ajkmart_auth_return_to"]);
    await secureDelete(TOKEN_KEY);
    await secureDelete(REFRESH_TOKEN_KEY);
    await secureDelete(BIOMETRIC_TOKEN);
    setBiometricEnabledState(false);
    await AsyncStorage.setItem(BIOMETRIC_KEY, "false");
    setUser(null);
    setToken(null);
    setTwoFactorPending(null);
    setAuthToken(null);
    setAuthTokenGetter(null);
    setRefreshTokenGetter(null);
    setOnTokenRefreshed(null);
    setOnUnauthorized(null);
    queryClient.clear();
  };

  useEffect(() => { doLogoutRef.current = doLogout; });

  const registerAuth = useCallback((tok: string, refreshTok: string | null) => {
    setAuthTokenGetter(() => tok);
    setRefreshTokenGetter(refreshTok ? () => refreshTok : null);

    setOnTokenRefreshed(async (newToken: string, newRefreshToken: string) => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocketState(null);
      }
      setToken(newToken);
      await secureSet(TOKEN_KEY, newToken);
      if (newRefreshToken) {
        await secureSet(REFRESH_TOKEN_KEY, newRefreshToken);
        setRefreshTokenGetter(() => newRefreshToken);
      }
      setAuthTokenGetter(() => newToken);
      scheduleProactiveRefresh(newToken);
    });

    setOnUnauthorized(async (statusCode?: number, errorMsg?: string) => {
      if (statusCode === 403) {
        if (errorMsg === "wallet_frozen") return;
        if (errorMsg === "Access denied. Customer account required.") return;
        setIsSuspended(true);
        setSuspendedMessage(errorMsg || "Your account has been suspended. Contact support.");
        return;
      }
      await doLogoutRef.current();
    });

    scheduleProactiveRefresh(tok);
  }, []);

  /* ── SDK bridge: sync access token whenever customer token state changes ── */
  useEffect(() => {
    syncAccessToken(token);
  }, [token]);

  useEffect(() => {
    const loadAuth = async () => {
      try {
        await bootstrapSdkAuth();
        await migrateLegacyInsecureTokens();

        const [[, storedUser], [, bioPref]] = await AsyncStorage.multiGet([USER_KEY, BIOMETRIC_KEY]);

        let storedToken: string | null = null;
        let storedRefresh: string | null = null;
        try {
          storedToken = await secureGet(TOKEN_KEY);
          storedRefresh = await secureGet(REFRESH_TOKEN_KEY);
        } catch {
          await AsyncStorage.multiRemove([USER_KEY, BIOMETRIC_KEY]);
          setIsLoading(false);
          return;
        }

        if (bioPref === "true") setBiometricEnabledState(true);
        if (storedUser && storedToken) {
          const parsedUser = JSON.parse(storedUser);
          const exp = decodeJwtExp(storedToken);
          const isExpired = exp ? exp * 1000 < Date.now() - CLOCK_SKEW_TOLERANCE_MS : false;

          if (isExpired && storedRefresh) {
            try {
              const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ refreshToken: storedRefresh }),
              });
              if (refreshRes.ok) {
                const data = (await refreshRes.json()) as { token?: string; refreshToken?: string; user?: AppUser };
                if (data.token) {
                  await secureSet(TOKEN_KEY, data.token);
                  if (data.refreshToken) await secureSet(REFRESH_TOKEN_KEY, data.refreshToken);
                  let freshUser: AppUser = data.user || parsedUser;
                  try {
                    const profileRes = await fetch(`${API_BASE}/users/profile`, {
                      headers: { Authorization: `Bearer ${data.token}` },
                    });
                    if (profileRes.ok) {
                      const profileData = await profileRes.json();
                      freshUser = profileData.data || profileData.user || profileData || freshUser;
                    }
                  } catch (e) {
                    log.warn("Failed to fetch profile after token refresh:", e);
                  }
                  await AsyncStorage.setItem(USER_KEY, JSON.stringify(freshUser));
                  setUser(freshUser);
                  setToken(data.token);
                  setAuthToken(data.token);
                  registerAuth(data.token, data.refreshToken ?? storedRefresh);
                  syncToServer(data.token).catch((err) => {
                    log.warn("[AuthContext] syncToServer after token refresh failed:", err);
                  });
                  setIsLoading(false);
                  return;
                }
              }
            } catch (e) {
              log.warn("Token refresh request failed:", e);
            }
            await AsyncStorage.multiRemove([USER_KEY]);
            await secureDelete(TOKEN_KEY);
            await secureDelete(REFRESH_TOKEN_KEY);
          } else if (isExpired) {
            await AsyncStorage.multiRemove([USER_KEY]);
            await secureDelete(TOKEN_KEY);
            await secureDelete(REFRESH_TOKEN_KEY);
          } else {
            let resolvedUser: AppUser = parsedUser;
            try {
              const profileRes = await fetch(`${API_BASE}/users/profile`, {
                headers: { Authorization: `Bearer ${storedToken}` },
              });
              if (profileRes.ok) {
                const profileData = await profileRes.json();
                const freshUser: AppUser = profileData.data || profileData.user || profileData;
                if (freshUser && freshUser.id) {
                  resolvedUser = freshUser;
                  await AsyncStorage.setItem(USER_KEY, JSON.stringify(freshUser));
                }
              }
            } catch (e) {
              log.warn("Failed to refresh profile with stored token:", e);
            }
            setUser(resolvedUser);
            setToken(storedToken);
            setAuthToken(storedToken);
            registerAuth(storedToken, storedRefresh);
            syncToServer(storedToken).catch((err) => {
              log.warn("[AuthContext] syncToServer with stored token failed:", err);
            });
          }
        }
      } catch (e) {
        log.warn("loadAuth failed unexpectedly:", e);
      }
      setIsLoading(false);
    };
    loadAuth();
  }, [registerAuth]);

  const captureCustomerLocation = async (userId: string, userToken: string) => {
    try {
      const Location = await import("expo-location");
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await fetch(`${API_BASE}/locations/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({
          userId,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          role: "customer",
        }),
      });
    } catch (e) {
      log.warn("captureCustomerLocation failed:", e);
    }
  };

  const login = async (userData: AppUser, userToken: string, refreshToken?: string) => {
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(userData));
    await secureSet(TOKEN_KEY, userToken);
    if (refreshToken) await secureSet(REFRESH_TOKEN_KEY, refreshToken);
    setUser(userData);
    setToken(userToken);
    setTwoFactorPending(null);
    setAuthToken(userToken);
    registerAuth(userToken, refreshToken ?? null);
    syncToServer(userToken).catch((err) => {
      log.warn("[AuthContext] syncToServer after login failed:", err);
    });
    /* Sync to the shared SDK primary auth state so SDK hooks (useSessionManager, etc.) see the token */
    try {
      const sdkUser: BaseAuthUser = {
        id: userData.id,
        role: "customer",
        phone: userData.phone,
        email: userData.email,
      };
      sdkCtx.login(sdkUser, userToken);
    } catch { /* non-fatal */ }
    if (hasRole(userData, "customer")) {
      captureCustomerLocation(userData.id, userToken).catch((err) => {
        log.warn("[AuthContext] captureCustomerLocation after login failed:", err);
      });
    }
  };

  const completeTwoFactorLogin = async (userData: AppUser, userToken: string, refreshToken?: string) => {
    setTwoFactorPending(null);
    await login(userData, userToken, refreshToken);
  };

  const logout = async () => {
    await doLogout();
  };

  const updateUser = (updates: Partial<AppUser>) => {
    if (user) {
      const updated = { ...user, ...updates };
      setUser(updated);
      AsyncStorage.setItem(USER_KEY, JSON.stringify(updated));
    }
  };

  const clearSuspended = async () => {
    setIsSuspended(false);
    setSuspendedMessage("");
    await doLogout();
  };

  const refreshToken = async (): Promise<string | null> => {
    try {
      const storedRefresh = await secureGet(REFRESH_TOKEN_KEY);
      if (!storedRefresh) return null;
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: storedRefresh }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { token?: string; refreshToken?: string };
      if (!data.token) return null;
      setToken(data.token);
      await secureSet(TOKEN_KEY, data.token);
      setAuthTokenGetter(() => data.token!);
      if (data.refreshToken) {
        await secureSet(REFRESH_TOKEN_KEY, data.refreshToken);
        setRefreshTokenGetter(() => data.refreshToken!);
      }
      return data.token;
    } catch {
      return null;
    }
  };

  const setBiometricEnabled = async (enabled: boolean) => {
    setBiometricEnabledState(enabled);
    await AsyncStorage.setItem(BIOMETRIC_KEY, enabled ? "true" : "false");
    if (enabled && token) {
      try {
        const refreshTok = await secureGet(REFRESH_TOKEN_KEY);
        if (refreshTok) await secureSet(BIOMETRIC_TOKEN, refreshTok);
      } catch (e) {
        log.warn("[auth] Failed to store biometric token:", e);
      }
    } else if (!enabled) {
      try {
        await secureDelete(BIOMETRIC_TOKEN);
      } catch (e) {
        log.debug("[auth] Failed to remove biometric token:", e);
      }
    }
  };

  const attemptBiometricLogin = async (): Promise<string | null> => {
    if (!biometricEnabled) return null;
    try {
      const LocalAuth = await import("expo-local-authentication");
      const hasHardware = await LocalAuth.hasHardwareAsync();
      if (!hasHardware) return null;
      const isEnrolled = await LocalAuth.isEnrolledAsync();
      if (!isEnrolled) return null;

      const result = await LocalAuth.authenticateAsync({
        promptMessage: "Login with Biometrics",
        cancelLabel: "Cancel",
        fallbackLabel: "Use password",
        disableDeviceFallback: false,
      });
      if (!result.success) {
        const nonFatalErrors = ["user_cancel", "system_cancel", "user_fallback", "app_cancel"];
        const isFatal = !!result.error && !nonFatalErrors.includes(result.error as string);
        if (isFatal) await setBiometricEnabled(false);
        return null;
      }

      const storedRefreshToken = await secureGet(BIOMETRIC_TOKEN);
      if (!storedRefreshToken) return null;

      let res: Response;
      try {
        res = await fetch(`${API_BASE}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: storedRefreshToken }),
        });
      } catch {
        return "transient_error";
      }
      if (res.status === 401 || res.status === 403) {
        await secureDelete(BIOMETRIC_TOKEN);
        setBiometricEnabledState(false);
        await AsyncStorage.setItem(BIOMETRIC_KEY, "false");
        return null;
      }
      if (!res.ok) return "transient_error";
      const data = (await res.json()) as { token?: string; refreshToken?: string };
      if (!data.token) return null;

      const meRes = await fetch(`${API_BASE}/users/profile`, {
        headers: { Authorization: `Bearer ${data.token}` },
      });
      if (!meRes.ok) {
        if (meRes.status >= 500) return "transient_error";
        return null;
      }
      const meData = await meRes.json();
      const freshUser: AppUser = meData.data || meData.user || meData;

      await login(freshUser, data.token, data.refreshToken);
      if (data.refreshToken) await secureSet(BIOMETRIC_TOKEN, data.refreshToken);
      return (freshUser.roles ?? [])[0] ?? "customer";
    } catch {
      return "transient_error";
    }
  };

  const socketRef = useRef<Socket | null>(null);
  useEffect(() => {
    if (!token || !user?.id) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }
    const socket = io(SOCKET_BASE, {
      path: "/api/socket.io",
      auth: { token },
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;
    setSocketState(socket);

    const handleWalletBalance = (payload: { balance: number }) => {
      if (typeof payload?.balance === "number") {
        setUser((prev) => prev ? { ...prev, walletBalance: String(payload.balance) } : prev);
        AsyncStorage.getItem(USER_KEY).then((stored) => {
          if (!stored) return;
          try {
            const parsed = JSON.parse(stored);
            AsyncStorage.setItem(USER_KEY, JSON.stringify({ ...parsed, walletBalance: payload.balance }));
          } catch (e) {
            log.debug("[auth] wallet:update — failed to persist balance:", e);
          }
        });
      }
    };

    socket.on("wallet:update", handleWalletBalance);
    socket.on("wallet:balance", handleWalletBalance);

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setSocketState(null);
    };
  }, [token, user?.id]);

  const isCustomer = hasRole(user, "customer");

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isSuspended,
        suspendedMessage,
        biometricEnabled,
        twoFactorPending,
        isCustomer,
        login,
        logout,
        updateUser,
        clearSuspended,
        setBiometricEnabled,
        setTwoFactorPending,
        completeTwoFactorLogin,
        attemptBiometricLogin,
        refreshToken,
        socket: socketState,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/**
 * AuthProvider — wraps children with:
 *   SdkAuthProvider (primary shared auth state — manages token in syncedStorage)
 *   └─ CustomerAuthInner (customer-specific auth: SecureStore, socket.io, biometric, proactive refresh)
 *      └─ AuthContext.Provider (customer auth context shape consumed by all screens)
 *
 * SdkAuthProvider is the *primary* auth owner so SDK hooks (useSessionManager,
 * useAuth from the SDK) work anywhere in the tree. CustomerAuthInner bi-directionally
 * syncs with it via sdkCtx.login() / sdkCtx.logout() in its own login/logout functions.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <SdkAuthProvider
      baseURL={API_BASE}
      tokenStorage={syncedStorage}
      refreshEndpoint={`${API_BASE}/auth/refresh`}
    >
      <CustomerAuthInner>{children}</CustomerAuthInner>
    </SdkAuthProvider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

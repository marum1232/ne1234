import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getTokenExpiryRemaining,
  AuthProvider as SharedAuthProvider,
  useAuthContext,
  type AuthUser as SharedAuthUser,
} from "@workspace/auth-react";
import { api, tokenStoreReady } from "./api";
import { getRiderApiBase } from "./envValidation";
import { executeLogoutSequence } from "./logoutSequence";
import { createLogger } from "@/lib/logger";
const log = createLogger("[auth]");

export interface AuthUser {
  id: string; phone: string; name?: string; email?: string;
  avatar?: string; isOnline: boolean; walletBalance: string;
  isRestricted?: boolean;
  approvalStatus?: string;
  rejectionReason?: string | null;
  roles: string[];
  createdAt?: string; lastLoginAt?: string;
  stats: { deliveriesToday: number; earningsToday: number; totalDeliveries: number; totalEarnings: number; rating?: number };
  cnic?: string; city?: string; address?: string; emergencyContact?: string;
  vehicleType?: string; vehiclePlate?: string; vehiclePhoto?: string;
  vehicleRegNo?: string; drivingLicense?: string;
  bankName?: string; bankAccount?: string; bankAccountTitle?: string;
  twoFactorEnabled?: boolean;
  cnicDocUrl?: string | null;
  licenseDocUrl?: string | null;
  regDocUrl?: string | null;
  dailyGoal?: number | null;
}

interface AuthCtx {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  storageError: boolean;
  twoFactorPending: boolean;
  setTwoFactorPending: (v: boolean) => void;
  login: (token: string, user: AuthUser, refreshToken?: string) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({} as AuthCtx);
export const useAuth = () => useContext(Ctx);

/** Outer shell — provides the shared SDK context (token storage, base URL, role).
 *
 * Props deliberately omitted (using SDK defaults):
 *   • refreshEndpoint — defaults to "/api/auth/refresh", which matches the rider
 *     server route.  Override here if the endpoint path ever changes.
 *   • onUnauthorized — NOT passed because unauthorized/session-expiry handling is
 *     managed at the rider apiFetch layer (api.ts) via `api.registerLogoutCallback`.
 *     RiderAuthInner registers clearAuth as a logout callback on mount (see below),
 *     preserving exact parity with the pre-migration auth-interceptor behaviour.
 */
export function RiderAuthProvider({ children }: { children: ReactNode }) {
  return (
    <SharedAuthProvider
      baseURL={getRiderApiBase()}
      role="rider"
      storageType="web"
    >
      <RiderAuthInner>{children}</RiderAuthInner>
    </SharedAuthProvider>
  );
}

/** Inner shell — syncs rider-specific state with the shared SDK */
function RiderAuthInner({ children }: { children: ReactNode }) {
  const sharedAuth = useAuthContext();
  const queryClient = useQueryClient();

  const [user, setUser]   = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [storageError, setStorageError] = useState(false);
  const [twoFactorPending, setTwoFactorPending] = useState(false);

  const refreshFailCountRef    = useRef(0);
  const refreshTimerRef        = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshingRef          = useRef(false);
  const refreshUserInflightRef = useRef<Promise<void> | null>(null);

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  const scheduleProactiveRefresh = useCallback((tok: string) => {
    clearRefreshTimer();
    const remaining = getTokenExpiryRemaining(tok);
    if (remaining <= 0) return;
    const refreshIn = Math.max(remaining - 60_000, 10_000);
    refreshTimerRef.current = setTimeout(async () => {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      try {
        const result = await api.refreshToken();
        if (result === "refreshed") {
          const newToken = api.getToken();
          if (newToken) { setToken(newToken); scheduleProactiveRefresh(newToken); }
        } else if (result === "auth_failed") {
          api.clearTokens();
          setToken(null); setUser(null);
          sharedAuth.logout();
        } else if (result === "transient") {
          refreshFailCountRef.current++;
          if (refreshFailCountRef.current <= 5) {
            const backoffMs = Math.min(60_000 * Math.pow(2, refreshFailCountRef.current - 1), 15 * 60_000);
            refreshTimerRef.current = setTimeout(() => {
              const currentToken = api.getToken();
              if (currentToken) scheduleProactiveRefresh(currentToken);
            }, backoffMs);
          } else {
            api.clearTokens();
            setToken(null); setUser(null);
            sharedAuth.logout();
            try { window.dispatchEvent(new CustomEvent("ajkmart:refresh-user-failed")); } catch (err) { console.warn('[artifacts/rider-app/src/lib/rider-auth.tsx]', err); } // eslint-disable-line no-console
          }
          refreshingRef.current = false;
          return;
        }
      } catch (err) { console.warn('[artifacts/rider-app/src/lib/rider-auth.tsx]', err); } // eslint-disable-line no-console
      finally {
        refreshingRef.current = false;
      }
    }, refreshIn);
  }, [clearRefreshTimer, sharedAuth]);

  useEffect((): () => void => {
    const controller = new AbortController();
    (async () => {
      try {
        await tokenStoreReady;
      } catch (storeErr) {
        log.error("tokenStoreReady failed — secure storage unavailable:", storeErr);
        api.clearTokens();
        setStorageError(true);
        setLoading(false);
        return;
      }
      if (controller.signal.aborted) return;
      const t = api.getToken();
      if (!t) { setLoading(false); return; }
      setToken(t);
      try {
        const u = await api.getMe(controller.signal);
        if (controller.signal.aborted) return;
        const rawUser = u as unknown as { role?: string };
        const roles: string[] = Array.isArray(u.roles)
          ? u.roles
          : typeof rawUser.role === "string"
            ? [rawUser.role]
            : [];
        if (roles.length > 0 && !roles.includes("rider")) {
          api.clearTokens(); setToken(null); return;
        }
        u.roles = roles;
        sharedAuth.login(
          { id: u.id, phone: u.phone, email: u.email, role: "rider" } satisfies SharedAuthUser,
          t
        );
        setUser(u);
        refreshFailCountRef.current = 0;
        scheduleProactiveRefresh(t);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        const errAny = err as Record<string, unknown>;
        if (errAny.code === "APPROVAL_PENDING") {
          setUser({ id: "", phone: "", isOnline: false, walletBalance: "0", roles: [], approvalStatus: "pending", stats: { deliveriesToday: 0, earningsToday: 0, totalDeliveries: 0, totalEarnings: 0 } });
          return;
        }
        if (errAny.code === "APPROVAL_REJECTED") {
          setUser({ id: "", phone: "", isOnline: false, walletBalance: "0", roles: [], approvalStatus: "rejected", rejectionReason: (errAny.rejectionReason as string | undefined) ?? null, stats: { deliveriesToday: 0, earningsToday: 0, totalDeliveries: 0, totalEarnings: 0 } });
          return;
        }
        api.clearTokens(); setToken(null);
      } finally {
        setLoading(false);
      }
    })();
    return () => { controller.abort(); clearRefreshTimer(); };
  }, [scheduleProactiveRefresh, clearRefreshTimer, sharedAuth]);

  useEffect(() => {
    const clearAuth = () => { setToken(null); setUser(null); sharedAuth.logout(); };
    const unregister = api.registerLogoutCallback(clearAuth);
    const handleLogoutEvent = () => clearAuth();
    window.addEventListener("ajkmart:logout", handleLogoutEvent);
    return () => {
      unregister();
      window.removeEventListener("ajkmart:logout", handleLogoutEvent);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = (t: string, u: AuthUser, refreshToken?: string) => {
    const rawUser = u as unknown as { role?: string };
    const roles: string[] = Array.isArray(u.roles)
      ? u.roles
      : typeof rawUser.role === "string"
        ? [rawUser.role]
        : [];
    if (roles.length > 0 && !roles.includes("rider")) {
      throw new Error("This app is for riders only");
    }
    u.roles = roles;
    queryClient.clear();
    api.storeTokens(t, refreshToken);
    sharedAuth.login(
      { id: u.id, phone: u.phone, email: u.email, role: "rider" } satisfies SharedAuthUser,
      t
    );
    setToken(t);
    setUser(u);
    refreshFailCountRef.current = 0;
    scheduleProactiveRefresh(t);
  };

  const logout = () => {
    clearRefreshTimer();
    executeLogoutSequence(api, () => {
      try { sessionStorage.clear(); } catch (e) { log.warn("sessionStorage.clear failed:", e); }
      sharedAuth.logout();
      setToken(null);
      setUser(null);
      queryClient.clear();
    });
  };

  const refreshUser = useCallback(async () => {
    if (refreshUserInflightRef.current) return refreshUserInflightRef.current;
    const p = (async () => {
      try {
        const u = await api.getMe();
        setUser(u);
        refreshFailCountRef.current = 0;
      } catch (err) { console.warn('[artifacts/rider-app/src/lib/rider-auth.tsx]', err); } // eslint-disable-line no-console
      finally {
        refreshUserInflightRef.current = null;
      }
    })();
    refreshUserInflightRef.current = p;
    return p;
  }, []);

  return (
    <Ctx.Provider value={{ user, token, loading, storageError, twoFactorPending, setTwoFactorPending, login, logout, refreshUser }}>
      {children}
    </Ctx.Provider>
  );
}

/** @deprecated Use RiderAuthProvider. Kept as a drop-in alias so App.tsx needs no import changes. */
export const AuthProvider = RiderAuthProvider;

import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AuthProvider as SharedAuthProvider,
  useAuthContext,
  useTokenRefresh,
  getTokenExpiryRemaining,
  type AuthUser as SharedAuthUser,
} from "@workspace/auth-react";
import { api, getTokenStorage } from "./api";
import { getVendorApiBase } from "./envValidation";
import { createLogger } from "@/lib/logger";
const log = createLogger("[auth]");

export interface StoreHours { [day: string]: { open: string; close: string; closed?: boolean } }

export interface AuthUser {
  id: string; phone: string; name?: string; email?: string; avatar?: string;
  walletBalance: string;
  roles: string[];
  storeName?: string; storeCategory?: string;
  storeBanner?: string; storeDescription?: string;
  storeHours?: StoreHours | null;
  storeAnnouncement?: string;
  storeMinOrder?: number;
  storeDeliveryTime?: string;
  storeIsOpen: boolean;
  storeLat?: string | null; storeLng?: string | null;
  lastLoginAt?: string; createdAt?: string;
  stats: { todayOrders: number; todayRevenue: number; totalOrders: number; totalRevenue: number };
  cnic?: string; city?: string; address?: string; businessType?: string;
  bankName?: string; bankAccount?: string; bankAccountTitle?: string;
  isVerified?: boolean; status?: string;
}

interface AuthCtx {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (token: string, user: AuthUser, refreshToken?: string) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({} as AuthCtx);
export const useAuth = () => useContext(Ctx);

/** Outer shell — provides the shared SDK context (token storage, base URL) */
export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <SharedAuthProvider
      tokenStorage={getTokenStorage()}
      baseURL={getVendorApiBase()}
      role="vendor"
    >
      <VendorAuthInner>{children}</VendorAuthInner>
    </SharedAuthProvider>
  );
}

/** Inner shell — calls useAuthContext() to synchronise vendor state with the shared SDK */
function VendorAuthInner({ children }: { children: ReactNode }) {
  const sharedAuth = useAuthContext();
  const queryClient = useQueryClient();

  const [user, setUser]   = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const logoutCallbackRef = useRef<(() => void) | null>(null);

  /* ── Proactive token refresh via shared SDK hook ────────────────────────
     useTokenRefresh handles scheduling, retry (up to 5 attempts, exponential
     backoff), and calls onLogout when all attempts are exhausted.            */
  const handleSdkLogout = () => {
    api.clearTokens();
    setToken(null); setUser(null);
    sharedAuth.logout();
  };

  const { refreshToken: sdkRefreshToken } = useTokenRefresh({
    tokenStorage: getTokenStorage(),
    baseURL: getVendorApiBase(),
    refreshEndpoint: "/auth/refresh",
    leewaySeconds: 60,
    onLogout: handleSdkLogout,
    onRefresh: (newTok) => { setToken(newTok); },
  });

  /* Re-schedule proactive refresh whenever the access token changes (e.g. after
     login). useTokenRefresh only schedules from the token present on mount, so
     for post-login tokens we trigger it here. A small 100 ms delay lets the
     token propagate to storage before the hook reads it.                        */
  useEffect(() => {
    if (!token) return;
    const remaining = getTokenExpiryRemaining(token);
    if (remaining <= 0) return;
    const delayMs = Math.max((remaining - 60) * 1_000, 10_000);
    const id = setTimeout(() => { sdkRefreshToken(); }, delayMs);
    return () => clearTimeout(id);
  }, [token, sdkRefreshToken]);

  /* ── Initial auth bootstrap ── */
  useEffect((): (() => void) | void => {
    const controller = new AbortController();

    const initAuth = async () => {
      let activeToken = api.getToken();

      if (!activeToken) {
        const result = await api.refreshToken();
        if (result !== "refreshed") { setLoading(false); return; }
        activeToken = api.getToken();
        if (!activeToken) { setLoading(false); return; }
      }

      setToken(activeToken);
      try {
        const u: AuthUser = await api.getMe(controller.signal);
        const rawRoles = u.roles;
        const roles: string[] = Array.isArray(rawRoles)
          ? rawRoles
          : typeof (u as unknown as { role?: string }).role === "string"
            ? [(u as unknown as { role: string }).role]
            : [];
        u.roles = roles;
        if (roles.length > 0 && !roles.includes("vendor")) {
          api.clearTokens(); setToken(null); sharedAuth.logout(); return;
        }
        sharedAuth.login(
          { id: u.id, phone: u.phone, email: u.email, role: "vendor" } satisfies SharedAuthUser,
          activeToken
        );
        setUser(u);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        api.clearTokens(); setToken(null); setUser(null); sharedAuth.logout();
      } finally { setLoading(false); }
    };

    initAuth();
    return () => { controller.abort(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Register logout callback + DOM event ── */
  useEffect(() => {
    const clearAuth = () => { setToken(null); setUser(null); sharedAuth.logout(); };
    logoutCallbackRef.current = clearAuth;
    const unregister = api.registerLogoutCallback(clearAuth);
    const handleLogout = () => clearAuth();
    window.addEventListener("ajkmart:logout", handleLogout);
    return () => { unregister(); window.removeEventListener("ajkmart:logout", handleLogout); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = (t: string, u: AuthUser, refreshToken?: string) => {
    const rawRoles = u.roles;
    const roles: string[] = Array.isArray(rawRoles)
      ? rawRoles
      : typeof (u as unknown as { role?: string }).role === "string"
        ? [(u as unknown as { role: string }).role]
        : [];
    u.roles = roles;
    if (roles.length > 0 && !roles.includes("vendor")) {
      throw new Error("This app is for vendors only");
    }
    queryClient.clear();
    api.storeTokens(t, refreshToken);
    sharedAuth.login(
      { id: u.id, phone: u.phone, email: u.email, role: "vendor" } satisfies SharedAuthUser,
      t
    );
    setToken(t);
    setUser(u);
  };

  const logout = () => {
    const refreshTok = api.getRefreshToken();
    api.logout(refreshTok || undefined).catch((err) => { console.warn('[artifacts/vendor-app/src/lib/vendor-auth.tsx]', err); }); // eslint-disable-line no-console
    sharedAuth.logout();
    setToken(null);
    setUser(null);
    queryClient.clear();
  };

  const refreshUser = async () => {
    try {
      const u = await api.getMe();
      setUser(u);
    } catch (e) {
      log.error("refreshUser failed:", e);
    }
  };

  return (
    <Ctx.Provider value={{ user, token, loading, login, logout, refreshUser }}>
      {children}
    </Ctx.Provider>
  );
}

/** UTF-8-safe JWT base64 payload decoder used for expiry checks.
 *  Uses decodeURIComponent(escape(atob())) to correctly handle
 *  multi-byte characters in the JWT payload. */
export function decodeJwtExpSafe(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const b64 = (parts[1] ?? '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=');
    const jsonStr = decodeURIComponent(escape(atob(padded)));
    const payload = JSON.parse(jsonStr) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch (err) { console.warn('[artifacts/vendor-app/src/lib/vendor-auth.tsx]', err); } // eslint-disable-line no-console
}

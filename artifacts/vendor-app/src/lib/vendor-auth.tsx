/**
 * vendor-auth.tsx — vendor-app
 *
 * Vendor-specific auth provider wrapping the shared @workspace/auth-react AuthProvider.
 * Extends the base with vendor profile hydration and store-hours management.
 *
 * Token storage: sessionStorage (tab-scoped — intentional security choice for vendor).
 *   Tokens persist across page reloads within a single browser tab but are automatically
 *   cleared when the tab is closed. This limits the blast radius of a stolen token to
 *   the current browser session, which is appropriate for a vendor web dashboard.
 *   An in-memory write-through cache sits in front of sessionStorage for speed.
 *   A one-time migration promotes any legacy localStorage tokens into sessionStorage on load.
 *   DO NOT change this to localStorage without a deliberate security review — see api.ts.
 *
 * Role enforcement: SharedAuthProvider is instantiated with role="vendor" — any stored
 *   token with a different role claim is automatically cleared on mount.
 *
 * Integration smoke-test checklist (verify after each auth refactor):
 *   [ ] OTP send → verify → register → token stored in sessionStorage
 *   [ ] Page reload within same tab restores vendor session without re-login
 *   [ ] Opening in a new tab requires re-login (tab-scoped, expected behavior)
 *   [ ] Rider/customer token in sessionStorage is rejected (role mismatch cleared)
 *   [ ] Token expiry triggers silent refresh via /api/vendors/auth/refresh
 *   [ ] Logout clears sessionStorage tokens and redirects to /login
 *   [ ] GET /api/users/profile?appRole=vendor returns 403 for non-vendor tokens (server-side gate)
 */
import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AuthProvider as SharedAuthProvider,
  useAuthContext,
  useTokenRefresh,
  getTokenExpiryRemaining,
  type AuthUser as SharedAuthUser,
} from "@workspace/auth-react";
import { decodeJwt } from "@workspace/auth-utils";
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
  approvalStatus?: string; rejectionReason?: string | null;
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
    onRefresh: (newTok: string) => { setToken(newTok); },
  });

  /* useTokenRefresh (above) already handles scheduling proactively based on
     the stored token and re-triggers on its own after each refresh. An extra
     useEffect that also calls sdkRefreshToken() creates a duplicate timer,
     which can fire a second refresh race-concurrently with the first one.
     Removed: the duplicate post-login scheduling effect that was here. */

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
          api.clearTokens(); setToken(null); sharedAuth.logout(); setLoading(false); return;
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
      const rawRoles = u.roles;
      const roles: string[] = Array.isArray(rawRoles)
        ? rawRoles
        : typeof (u as unknown as { role?: string }).role === "string"
          ? [(u as unknown as { role: string }).role]
          : [];
      u.roles = roles;
      if (roles.length > 0 && !roles.includes("vendor")) {
        api.clearTokens(); setToken(null); setUser(null); sharedAuth.logout(); return;
      }
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

/**
 * Decode the `exp` claim from a JWT for expiry checks.
 *
 * Delegates to the shared `decodeJwt` utility from `@workspace/auth-react`
 * (which handles UTF-8-safe base64url decoding) so there is a single canonical
 * JWT-decode implementation across all web apps and the shared SDK.
 *
 * Previously implemented inline with atob() + decodeURIComponent(escape(...)).
 * That implementation has been replaced to eliminate the duplicate.
 */
export function decodeJwtExpSafe(token: string): number | null {
  try {
    const payload = decodeJwt(token);
    return typeof payload?.exp === "number" ? payload.exp : null;
  } catch { return null; }
}

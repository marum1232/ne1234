/**
 * rider-auth.tsx — rider-app
 *
 * Rider-specific auth provider wrapping the shared @workspace/auth-react AuthProvider.
 * Extends the base with rider profile hydration, biometric unlock support, and
 * Capacitor Preferences token storage (survives app restarts on PWA/mobile).
 *
 * Token storage: @capacitor/preferences (native-level, encrypted on supported devices).
 * Role enforcement: SharedAuthProvider is instantiated with role="rider" — any stored
 *   token with a different role claim is automatically cleared on mount.
 *
 * Integration smoke-test checklist (verify after each auth refactor):
 *   [ ] OTP send → verify → register → token stored in Capacitor Preferences
 *   [ ] App restart restores rider session without re-login
 *   [ ] Vendor/customer token stored in preferences is rejected (role mismatch cleared)
 *   [ ] Token expiry triggers silent refresh via /api/riders/auth/refresh
 *   [ ] Logout clears Capacitor Preferences and redirects to /login
 *   [ ] GET /api/users/profile?appRole=rider returns 403 for non-rider tokens (server-side gate)
 */
import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AuthProvider as SharedAuthProvider,
  useAuthContext,
  useTokenRefresh,
  type AuthUser as SharedAuthUser,
} from "@workspace/auth-react";
import { api, tokenStoreReady, getRiderTokenStorage } from "./api";
import { getRiderApiBase } from "./envValidation";
import { executeLogoutSequence } from "./logoutSequence";
import { createLogger } from "@/lib/logger";
const log = createLogger("[auth]");

/** Normalize a user's roles field — handles both string[] (canonical) and
 *  legacy single-string role returned by older API payloads.
 *  Exported so LoginScreen.tsx can use it for the biometric role guard. */
export function normalizeRoles(u: { roles?: unknown; role?: unknown }): string[] {
  if (Array.isArray(u.roles)) return u.roles as string[];
  if (typeof u.role === "string") return [u.role];
  return [];
}

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

  const refreshUserInflightRef = useRef<Promise<void> | null>(null);

  /* ── Proactive token refresh via shared SDK hook ─────────────────────────
     useTokenRefresh handles scheduling, retry (up to 5 attempts, exponential
     backoff), and calls onLogout when all attempts are exhausted. This
     replaces the previous manual setTimeout / exponential-backoff refresh
     timer and aligns the rider app with the vendor app's pattern. */
  const handleSdkLogout = useCallback(() => {
    api.clearTokens();
    setToken(null); setUser(null);
    sharedAuth.logout();
  }, [sharedAuth]);

  useTokenRefresh({
    tokenStorage: getRiderTokenStorage(),
    baseURL: getRiderApiBase(),
    refreshEndpoint: "/auth/refresh",
    leewaySeconds: 60,
    onLogout: handleSdkLogout,
    onRefresh: (newTok: string) => { setToken(newTok); },
  });

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
        const roles = normalizeRoles(u);
        if (roles.length > 0 && !roles.includes("rider")) {
          api.clearTokens(); setToken(null); setLoading(false); return;
        }
        u.roles = roles;
        sharedAuth.login(
          { id: u.id, phone: u.phone, email: u.email, role: "rider" } satisfies SharedAuthUser,
          t
        );
        setUser(u);
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
    return () => { controller.abort(); };
  }, [sharedAuth]);

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
    const roles = normalizeRoles(u);
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
  };

  const logout = () => {
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
        const roles = normalizeRoles(u);
        if (roles.length > 0 && !roles.includes("rider")) {
          api.clearTokens(); setToken(null); setUser(null); sharedAuth.logout(); return;
        }
        u.roles = roles;
        setUser(u);
      } catch (err) { console.warn('[artifacts/rider-app/src/lib/rider-auth.tsx]', err); } // eslint-disable-line no-console
      finally {
        refreshUserInflightRef.current = null;
      }
    })();
    refreshUserInflightRef.current = p;
    return p;
  }, [sharedAuth]);

  return (
    <Ctx.Provider value={{ user, token, loading, storageError, twoFactorPending, setTwoFactorPending, login, logout, refreshUser }}>
      {children}
    </Ctx.Provider>
  );
}

/** @deprecated Use RiderAuthProvider. Kept as a drop-in alias so App.tsx needs no import changes. */
export const AuthProvider = RiderAuthProvider;

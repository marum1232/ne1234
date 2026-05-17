import { useState, useCallback, useContext } from 'react';
import { AuthContext } from '../AuthProvider';
import type { AuthUser } from '../AuthProvider';

export type LoginMethod = 'otp' | 'password' | 'social' | 'magic-link' | 'totp';

export interface IdentifierCheckResult {
  method: LoginMethod;
  /** Whether the account exists already (false = registration path) */
  exists: boolean;
  /** True when the account has 2FA enabled */
  twoFactorEnabled?: boolean;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface UseLoginFlowOptions {
  baseURL?: string;
  role?: 'customer' | 'rider' | 'vendor' | 'admin';
  onSuccess?: (user: AuthUser, accessToken: string) => void;
}

export function useLoginFlow({ baseURL = '', role, onSuccess }: UseLoginFlowOptions = {}) {
  const ctx = useContext(AuthContext);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<LoginMethod | null>(null);
  const [identifier, setIdentifier] = useState<string>('');
  const [twoFactorPending, setTwoFactorPending] = useState(false);

  function clearError() {
    setError(null);
  }

  async function apiFetch<T>(
    path: string,
    body: Record<string, unknown>
  ): Promise<ApiResponse<T>> {
    const token = ctx?.tokenStorage.getAccessToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${baseURL}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as ApiResponse<T>;
    if (!res.ok) {
      throw new Error(json.message ?? json.error ?? `HTTP ${res.status}`);
    }
    return json;
  }

  /**
   * Step 1 — Check whether the identifier (phone/email/username) exists,
   * which login method the server recommends, then trigger OTP delivery
   * when the action is phone/email OTP.
   */
  const initiateLogin = useCallback(
    async (id: string): Promise<IdentifierCheckResult> => {
      setLoading(true);
      setError(null);
      setIdentifier(id);
      try {
        const checkBody: Record<string, unknown> = { identifier: id };
        if (role && role !== 'admin') checkBody.role = role;

        const res = await apiFetch<IdentifierCheckResult & { action?: string; availableMethods?: string[] }>(
          '/api/auth/check-identifier',
          checkBody
        );
        const raw = res.data as any ?? {};

        /* Map the API's action/availableMethods format to the method field
           the LoginScreen step-switcher expects */
        const actionToMethod = (action: string | undefined): LoginMethod => {
          if (action === 'login_password') return 'password';
          if (action === 'send_magic_link') return 'magic-link';
          return 'otp';
        };
        const derivedMethod: LoginMethod =
          raw.method ??
          actionToMethod(raw.action) ??
          (raw.availableMethods?.includes('password') && !raw.availableMethods?.includes('phone_otp') ? 'password' : 'otp');

        const result: IdentifierCheckResult = {
          ...raw,
          method: derivedMethod,
          exists: raw.exists ?? false,
        };
        setMethod(result.method);

        /* ── Trigger OTP delivery ──────────────────────────────────────────
           check-identifier only tells us WHAT to do — it does NOT send the
           OTP.  We must call /auth/send-otp ourselves when the action is a
           phone-OTP flow.  Without this the user would see an OTP input but
           receive nothing on their phone.
        ─────────────────────────────────────────────────────────────────── */
        const action: string = raw.action ?? '';
        if (action === 'send_phone_otp' || derivedMethod === 'otp') {
          const looksLikePhone = /^[\d\s\-+()]{7,15}$/.test(id.trim());
          if (looksLikePhone) {
            const sendBody: Record<string, unknown> = { phone: id };
            if (role && role !== 'admin') sendBody.role = role;
            // Fire-and-forget: errors here are surfaced in verifyOtp if OTP wasn't sent
            try {
              await apiFetch('/api/auth/send-otp', sendBody);
            } catch (sendErr) {
              const msg = sendErr instanceof Error ? sendErr.message : 'Failed to send OTP';
              setError(msg);
              throw sendErr;
            }
          }
        }

        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to check identifier';
        // Only set error if not already set (send-otp errors set it above)
        setError(prev => prev ?? msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseURL, role]
  );

  /**
   * Step 2a — Verify OTP (sent via SMS/email).
   * Server expects { phone, otp } — NOT { identifier, otp }.
   */
  const verifyOtp = useCallback(
    async (otp: string): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const body: Record<string, unknown> = { phone: identifier, otp };
        if (role && role !== 'admin') body.role = role;

        const res = await apiFetch<{ user: AuthUser; accessToken: string; twoFactorRequired?: boolean }>(
          '/api/auth/verify-otp',
          body
        );
        const data = res.data!;
        if (data.twoFactorRequired) {
          setTwoFactorPending(true);
          ctx?.setTwoFactorPending(true);
          return;
        }
        ctx?.login(data.user, data.accessToken);
        onSuccess?.(data.user, data.accessToken);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'OTP verification failed';
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [identifier, baseURL, role, onSuccess]
  );

  /**
   * Step 2b — Verify password login.
   */
  const verifyPassword = useCallback(
    async (password: string): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<{ user: AuthUser; accessToken: string; twoFactorRequired?: boolean }>(
          '/api/auth/login',
          { identifier, password }
        );
        const data = res.data!;
        if (data.twoFactorRequired) {
          setTwoFactorPending(true);
          ctx?.setTwoFactorPending(true);
          return;
        }
        ctx?.login(data.user, data.accessToken);
        onSuccess?.(data.user, data.accessToken);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Password login failed';
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [identifier, baseURL, onSuccess]
  );

  /**
   * Step 3 — Verify TOTP / 2FA code after initial credential check succeeds.
   */
  const twoFactorVerify = useCallback(
    async (code: string): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<{ user: AuthUser; accessToken: string }>(
          '/api/auth/2fa/verify',
          { identifier, code }
        );
        const data = res.data!;
        setTwoFactorPending(false);
        ctx?.setTwoFactorPending(false);
        ctx?.login(data.user, data.accessToken);
        onSuccess?.(data.user, data.accessToken);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '2FA verification failed';
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [identifier, baseURL, onSuccess]
  );

  return {
    initiateLogin,
    verifyOtp,
    verifyPassword,
    twoFactorVerify,
    loading,
    error,
    setError,
    method,
    twoFactorPending,
    clearError,
  };
}

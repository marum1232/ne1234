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
  onSuccess?: (user: AuthUser, accessToken: string) => void;
}

export function useLoginFlow({ baseURL = '', onSuccess }: UseLoginFlowOptions = {}) {
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
   * Step 1 — Check whether the identifier (phone/email/username) exists
   * and which login method the server recommends.
   */
  const initiateLogin = useCallback(
    async (id: string): Promise<IdentifierCheckResult> => {
      setLoading(true);
      setError(null);
      setIdentifier(id);
      try {
        const res = await apiFetch<IdentifierCheckResult>(
          '/api/auth/check-identifier',
          { identifier: id }
        );
        const result = res.data ?? { method: 'otp' as LoginMethod, exists: false };
        setMethod(result.method);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to check identifier';
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseURL]
  );

  /**
   * Step 2a — Verify OTP (sent via SMS/email).
   */
  const verifyOtp = useCallback(
    async (otp: string): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<{ user: AuthUser; accessToken: string; twoFactorRequired?: boolean }>(
          '/api/auth/verify-otp',
          { identifier, otp }
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
    [identifier, baseURL, onSuccess]
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
    method,
    twoFactorPending,
    clearError,
  };
}

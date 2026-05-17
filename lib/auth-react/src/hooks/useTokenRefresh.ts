import { useEffect, useRef, useCallback } from 'react';
import { decodeJwt, getTokenExpiryRemaining } from '../utils/jwtUtils';
import type { TokenStorage } from '../api/tokenStorage';

export interface UseTokenRefreshOptions {
  tokenStorage: TokenStorage;
  baseURL: string;
  refreshEndpoint?: string;
  /**
   * How many seconds before expiry to proactively refresh (default 60).
   * Alias: `refreshIntervalSeconds` (spec-compatible name; takes precedence when set).
   */
  leewaySeconds?: number;
  /** Alias for leewaySeconds — seconds before token expiry to trigger proactive refresh */
  refreshIntervalSeconds?: number;
  /** Called when all refresh attempts fail — should trigger logout */
  onLogout?: () => void;
  /** Called when a new token has been obtained */
  onRefresh?: (accessToken: string) => void;
}

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 300;

async function doRefresh(
  baseURL: string,
  refreshEndpoint: string
): Promise<string | null> {
  const res = await fetch(`${baseURL}${refreshEndpoint}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { accessToken?: string; data?: { accessToken?: string } };
  return data.accessToken ?? data.data?.accessToken ?? null;
}

export function useTokenRefresh({
  tokenStorage,
  baseURL,
  refreshEndpoint = '/api/auth/refresh',
  leewaySeconds = 60,
  refreshIntervalSeconds,
  onLogout,
  onRefresh,
}: UseTokenRefreshOptions) {
  // refreshIntervalSeconds takes precedence when provided
  const effectiveLeeway = refreshIntervalSeconds ?? leewaySeconds;
  const isRefreshingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);

  const scheduleNextRefresh = useCallback(
    (token: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const remaining = getTokenExpiryRemaining(token);
      const delaySeconds = Math.max(0, remaining - effectiveLeeway);
      timerRef.current = setTimeout(
        () => void refreshToken(),
        delaySeconds * 1000
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveLeeway]
  );

  const refreshToken = useCallback(async (): Promise<void> => {
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    attemptsRef.current = 0;

    while (attemptsRef.current < MAX_ATTEMPTS) {
      try {
        const newToken = await doRefresh(baseURL, refreshEndpoint);
        if (newToken) {
          tokenStorage.setAccessToken(newToken);
          onRefresh?.(newToken);
          attemptsRef.current = 0;
          scheduleNextRefresh(newToken);
          isRefreshingRef.current = false;
          return;
        }
        // Server said no (expired refresh token, etc.) — give up immediately
        break;
      } catch {
        attemptsRef.current += 1;
        if (attemptsRef.current >= MAX_ATTEMPTS) break;
        await new Promise((resolve) =>
          setTimeout(resolve, BASE_DELAY_MS * 2 ** (attemptsRef.current - 1))
        );
      }
    }

    isRefreshingRef.current = false;
    onLogout?.();
  }, [baseURL, refreshEndpoint, tokenStorage, onRefresh, onLogout, scheduleNextRefresh]);

  // On mount: if there's already a token in storage, schedule the first refresh.
  useEffect(() => {
    const existing = tokenStorage.getAccessToken();
    if (existing) {
      const payload = decodeJwt(existing);
      if (payload?.exp) {
        scheduleNextRefresh(existing);
      }
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // Run once on mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { refreshToken };
}

/**
 * useAuth — vendor-app auth operations hook
 *
 * Wraps the vendor API surface so every call returns a consistent
 * { success, data, error } shape. Components never handle raw throw/catch.
 *
 * Includes: login, logout, OTP, password, refresh, register, biometricLogin,
 * loading state, network guard, Sentry capture.
 */
import { api } from "../api";
import { canonicalizePhone } from "@workspace/auth-utils";
import { useAuth as useAuthContext } from "../vendor-auth";
import { useState, useCallback } from "react";

export interface AuthResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface TokenPair {
  token: string;
  refreshToken?: string;
}

function networkError(err: unknown): string {
  if (err instanceof Error && err.message.includes("fetch")) return "No internet connection. Please check your network.";
  return err instanceof Error ? err.message : "An unexpected error occurred.";
}

async function captureException(err: unknown) {
  try {
    if (process.env.SENTRY_DSN) {
      const Sentry = await import("@sentry/react");
      Sentry.captureException(err);
    }
  } catch { /* Sentry not installed */ }
}

export function useAuth() {
  const { logout: appLogout } = useAuthContext();
  const [isLoading, setIsLoading] = useState(false);

  const wrap = useCallback(<T,>(fn: () => Promise<AuthResult<T>>): Promise<AuthResult<T>> => {
    setIsLoading(true);
    return fn().finally(() => setIsLoading(false));
  }, []);

  async function sendOtp(phoneOrEmail: string, channel?: string): Promise<AuthResult<{ otp?: string; channel?: string; fallbackChannels?: string[] }>> {
    return wrap(async () => {
      try {
        const isPhone = !phoneOrEmail.includes("@");
        const res = isPhone
          ? await api.sendOtp(canonicalizePhone(phoneOrEmail), channel) as Record<string, unknown>
          : await api.sendEmailOtp(phoneOrEmail) as Record<string, unknown>;
        return { success: true, data: res as never };
      } catch (err: unknown) {
        await captureException(err);
        return { success: false, error: networkError(err) };
      }
    });
  }

  async function verifyOtp(phone: string, otp: string): Promise<AuthResult<TokenPair>> {
    return wrap(async () => {
      try {
        const res = await api.verifyOtp(phone, otp) as Record<string, unknown>;
        return { success: true, data: { token: res.token as string, refreshToken: res.refreshToken as string | undefined } };
      } catch (err: unknown) {
        await captureException(err);
        return { success: false, error: networkError(err) };
      }
    });
  }

  async function loginWithPassword(identifier: string, password: string): Promise<AuthResult<TokenPair & { requires2FA?: boolean; tempToken?: string; pendingApproval?: boolean; approvalStatus?: string; rejectionReason?: string | null }>> {
    return wrap(async () => {
      try {
        const res = await api.loginUsername(identifier, password) as Record<string, unknown>;
        return { success: true, data: res as never };
      } catch (err: unknown) {
        await captureException(err);
        return { success: false, error: networkError(err) };
      }
    });
  }

  async function register(body: Record<string, unknown>): Promise<AuthResult<{ token?: string; user?: unknown }>> {
    return wrap(async () => {
      try {
        const res = await api.vendorRegister(body as Parameters<typeof api.vendorRegister>[0]) as Record<string, unknown>;
        return { success: true, data: res as never };
      } catch (err: unknown) {
        await captureException(err);
        return { success: false, error: networkError(err) };
      }
    });
  }

  async function biometricLogin(): Promise<AuthResult<TokenPair>> {
    return wrap(async () => {
      try {
        const { getBiometricToken } = await import("../biometric").catch(() => ({} as never));
        if (!getBiometricToken) throw new Error("Biometric not available");
        const refreshToken = await getBiometricToken();
        const res = await fetch(`${window.location.origin}/api/auth/refresh`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) throw new Error("Biometric login failed");
        const data = await res.json() as Record<string, unknown>;
        return { success: true, data: { token: data.token as string, refreshToken } };
      } catch (err: unknown) {
        await captureException(err);
        return { success: false, error: networkError(err) };
      }
    });
  }

  async function refreshToken(storedRefresh: string): Promise<AuthResult<TokenPair>> {
    return wrap(async () => {
      try {
        const res = await fetch(`${window.location.origin}/api/auth/refresh`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: storedRefresh }),
        });
        if (!res.ok) throw new Error("Refresh failed");
        const data = await res.json() as Record<string, unknown>;
        return { success: true, data: { token: data.token as string, refreshToken: data.refreshToken as string | undefined } };
      } catch (err: unknown) {
        await captureException(err);
        return { success: false, error: networkError(err) };
      }
    });
  }

  async function logout(): Promise<AuthResult> {
    return wrap(async () => {
      try {
        const refresh = api.getRefreshToken?.();
        await api.logout(refresh ?? undefined);
        appLogout();
        return { success: true };
      } catch (err: unknown) {
        await captureException(err);
        appLogout();
        return { success: false, error: networkError(err) };
      }
    });
  }

  return { sendOtp, verifyOtp, loginWithPassword, register, biometricLogin, refreshToken, logout, isLoading };
}

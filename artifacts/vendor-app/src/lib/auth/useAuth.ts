/**
 * useAuth — vendor-app auth operations hook
 *
 * Wraps the vendor API surface so every call returns a consistent
 * { success, data, error } shape. Components never handle raw throw/catch.
 *
 * Includes: login, logout, OTP, password, refresh, biometric flag, network guard.
 */
import { api } from "../api";
import { canonicalizePhone } from "@workspace/auth-utils";
import { useAuth as useAuthContext } from "../vendor-auth";

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

export function useAuth() {
  const { logout: appLogout } = useAuthContext();

  async function sendOtp(phoneOrEmail: string, channel?: string): Promise<AuthResult<{ otp?: string; channel?: string; fallbackChannels?: string[] }>> {
    try {
      const isPhone = !phoneOrEmail.includes("@");
      const res = isPhone
        ? await api.sendOtp(canonicalizePhone(phoneOrEmail), channel) as Record<string, unknown>
        : await api.sendEmailOtp(phoneOrEmail) as Record<string, unknown>;
      return { success: true, data: res as never };
    } catch (err: unknown) {
      return { success: false, error: networkError(err) };
    }
  }

  async function verifyOtp(phone: string, otp: string): Promise<AuthResult<TokenPair>> {
    try {
      const res = await api.verifyOtp(phone, otp) as Record<string, unknown>;
      return { success: true, data: { token: res.token as string, refreshToken: res.refreshToken as string | undefined } };
    } catch (err: unknown) {
      return { success: false, error: networkError(err) };
    }
  }

  async function loginWithPassword(identifier: string, password: string): Promise<AuthResult<TokenPair & { requires2FA?: boolean; tempToken?: string; pendingApproval?: boolean; approvalStatus?: string; rejectionReason?: string | null }>> {
    try {
      const res = await api.loginWithPassword(identifier, password) as Record<string, unknown>;
      return { success: true, data: res as never };
    } catch (err: unknown) {
      return { success: false, error: networkError(err) };
    }
  }

  async function refreshToken(storedRefresh: string): Promise<AuthResult<TokenPair>> {
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
      return { success: false, error: networkError(err) };
    }
  }

  async function logout(): Promise<AuthResult> {
    try {
      const refresh = api.getRefreshToken?.();
      await api.logout(refresh ?? undefined);
      appLogout();
      return { success: true };
    } catch (err: unknown) {
      appLogout();
      return { success: false, error: networkError(err) };
    }
  }

  return { sendOtp, verifyOtp, loginWithPassword, refreshToken, logout };
}

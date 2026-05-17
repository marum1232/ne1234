/**
 * useAuth — ajkmart (customer) auth operations hook
 *
 * Wraps customer auth API so every call returns { success, data, error }.
 * React Native compatible — no window.fetch assumptions.
 */
import { useAuth as useAuthContext } from "@/context/AuthContext";

export interface AuthResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface TokenPair {
  token: string;
  refreshToken?: string;
}

const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN ?? ""}/api`;

function networkError(err: unknown): string {
  if (err instanceof Error && (err.message.includes("fetch") || err.message.includes("network"))) {
    return "No internet connection. Please check your network and try again.";
  }
  return err instanceof Error ? err.message : "An unexpected error occurred.";
}

async function apiPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json() as { data?: T; message?: string } & T;
  if (!res.ok) throw new Error((json as Record<string, unknown>).message as string ?? "Request failed");
  return ((json as Record<string, unknown>).data ?? json) as T;
}

export function useAuth() {
  const { login: appLogin, logout: appLogout } = useAuthContext();

  async function sendOtp(phone: string): Promise<AuthResult<{ otp?: string; channel?: string }>> {
    try {
      const data = await apiPost<Record<string, unknown>>("/auth/send-otp", { phone });
      return { success: true, data: data as never };
    } catch (err: unknown) {
      return { success: false, error: networkError(err) };
    }
  }

  async function verifyOtp(phone: string, otp: string): Promise<AuthResult<TokenPair & { requires2FA?: boolean }>> {
    try {
      const data = await apiPost<Record<string, unknown>>("/auth/verify-otp", { phone, otp });
      return { success: true, data: data as never };
    } catch (err: unknown) {
      return { success: false, error: networkError(err) };
    }
  }

  async function loginWithPassword(identifier: string, password: string): Promise<AuthResult<TokenPair & { requires2FA?: boolean; tempToken?: string }>> {
    try {
      const data = await apiPost<Record<string, unknown>>("/auth/login", { identifier, password });
      return { success: true, data: data as never };
    } catch (err: unknown) {
      return { success: false, error: networkError(err) };
    }
  }

  async function logout(): Promise<AuthResult> {
    try {
      await appLogout();
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: networkError(err) };
    }
  }

  return { sendOtp, verifyOtp, loginWithPassword, logout, login: appLogin };
}

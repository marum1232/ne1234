import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

export interface AuthConfig {
  phoneOtp: boolean;
  emailOtp: boolean;
  google: boolean;
  facebook: boolean;
  magicLink: boolean;
  usernamePassword: boolean;
  totp: boolean;
  captchaEnabled: boolean;
  captchaSiteKey?: string;
  googleClientId?: string;
  facebookAppId?: string;
  otpBypassActive?: boolean;
  otpBypassGlobal?: boolean;
}

const DEFAULT_AUTH_CONFIG: AuthConfig = {
  phoneOtp: true,
  emailOtp: false,
  google: false,
  facebook: false,
  magicLink: false,
  usernamePassword: true,
  totp: false,
  captchaEnabled: false,
};

const AuthConfigContext = createContext<AuthConfig>(DEFAULT_AUTH_CONFIG);

async function fetchAuthConfig(): Promise<AuthConfig> {
  const res = await fetch("/api/auth/config", { credentials: "include" });
  if (!res.ok) return DEFAULT_AUTH_CONFIG;
  const json = await res.json();
  const d = json?.data ?? json;
  return {
    /* Prefer camelCase rider-scoped fields added to /api/auth/config.
       Fall back to legacy snake_case "on"/"off" string fields for servers
       that haven't yet deployed the extended config endpoint. */
    phoneOtp:        d.phoneOtp         ?? (d.auth_otp_enabled         === "on" ? true : (d.auth_otp_enabled         === "off" ? false : true)),
    emailOtp:        d.emailOtp         ?? (d.auth_email_enabled        === "on" ? true : false),
    google:          d.google           ?? (d.auth_google_enabled       === "on" ? true : false),
    facebook:        d.facebook         ?? (d.auth_facebook_enabled     === "on" ? true : false),
    usernamePassword: d.usernamePassword ?? true,
    magicLink:       d.magicLink        ?? false,
    totp:            d.totp             ?? false,
    captchaEnabled:  d.captchaEnabled   ?? false,
    captchaSiteKey:  d.captchaSiteKey   ?? undefined,
    googleClientId:  d.googleClientId   ?? undefined,
    facebookAppId:   d.facebookAppId    ?? undefined,
    otpBypassActive: d.otpBypassActive  ?? false,
    otpBypassGlobal: d.otpBypassGlobal  ?? false,
  };
}

export function RiderAuthConfigProvider({ children }: { children: ReactNode }) {
  const { data } = useQuery<AuthConfig>({
    queryKey: ["rider-auth-config"],
    queryFn: fetchAuthConfig,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  return (
    <AuthConfigContext.Provider value={data ?? DEFAULT_AUTH_CONFIG}>
      {children}
    </AuthConfigContext.Provider>
  );
}

export function useRiderAuthConfig(): AuthConfig {
  return useContext(AuthConfigContext);
}

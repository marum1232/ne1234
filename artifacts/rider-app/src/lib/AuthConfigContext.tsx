import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

interface AuthConfig {
  phoneOtp: boolean;
  emailOtp: boolean;
  google: boolean;
  facebook: boolean;
  magicLink: boolean;
  usernamePassword: boolean;
  totp: boolean;
  captchaEnabled: boolean;
  googleClientId?: string;
  facebookAppId?: string;
  captchaSiteKey?: string;
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
    phoneOtp:        d.phoneOtp         ?? true,
    emailOtp:        d.emailOtp         ?? false,
    google:          d.google           ?? false,
    facebook:        d.facebook         ?? false,
    magicLink:       d.magicLink        ?? false,
    usernamePassword: d.usernamePassword ?? true,
    totp:            d.totp             ?? false,
    captchaEnabled:  d.captchaEnabled   ?? false,
    googleClientId:  d.googleClientId,
    facebookAppId:   d.facebookAppId,
    captchaSiteKey:  d.captchaSiteKey,
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

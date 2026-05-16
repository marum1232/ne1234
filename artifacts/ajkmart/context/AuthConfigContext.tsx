import React, { createContext, useContext, useMemo } from "react";
import { usePlatformConfig, isMethodEnabled } from "@/context/PlatformConfigContext";

export interface AuthConfig {
  allowPhone: boolean;
  allowEmail: boolean;
  allowUsernamePassword: boolean;
  allowGoogle: boolean;
  allowFacebook: boolean;
  allowMagicLink: boolean;
  allowBiometric: boolean;
  allowTwoFactor: boolean;
  allowEmailRegister: boolean;
  captchaEnabled: boolean;
  captchaSiteKey: string;
  googleClientId: string;
  facebookAppId: string;
  authMode: "OTP" | "EMAIL" | "FIREBASE" | "HYBRID";
  firebaseEnabled: boolean;
  hasAnyMethod: boolean;
}

const AuthConfigContext = createContext<AuthConfig>({
  allowPhone: true,
  allowEmail: true,
  allowUsernamePassword: true,
  allowGoogle: false,
  allowFacebook: false,
  allowMagicLink: false,
  allowBiometric: false,
  allowTwoFactor: false,
  allowEmailRegister: true,
  captchaEnabled: false,
  captchaSiteKey: "",
  googleClientId: "",
  facebookAppId: "",
  authMode: "OTP",
  firebaseEnabled: false,
  hasAnyMethod: true,
});

/**
 * Provides customer-scoped auth configuration derived from PlatformConfigContext.
 * Does not make a separate network request — reads from the already-fetched
 * platform config (which includes the `auth` section).
 */
export function AuthConfigProvider({ children }: { children: React.ReactNode }) {
  const { config } = usePlatformConfig();
  const auth = config.auth;

  const value = useMemo<AuthConfig>(() => {
    const allowPhone = isMethodEnabled(auth.phoneOtpEnabled, "customer");
    const allowEmail = isMethodEnabled(auth.emailOtpEnabled, "customer");
    const allowUsernamePassword = isMethodEnabled(auth.usernamePasswordEnabled, "customer");
    const allowGoogle = isMethodEnabled(auth.googleEnabled, "customer");
    const allowFacebook = isMethodEnabled(auth.facebookEnabled, "customer");
    const allowMagicLink = isMethodEnabled(auth.magicLinkEnabled, "customer");
    const allowBiometric = isMethodEnabled(auth.biometricEnabled, "customer");
    const allowTwoFactor = isMethodEnabled(auth.twoFactorEnabled, "customer");
    const allowEmailRegister = isMethodEnabled(auth.emailRegisterEnabled, "customer");

    const hasAnyMethod =
      allowPhone ||
      allowEmail ||
      allowUsernamePassword ||
      allowGoogle ||
      allowFacebook ||
      allowMagicLink;

    return {
      allowPhone,
      allowEmail,
      allowUsernamePassword,
      allowGoogle,
      allowFacebook,
      allowMagicLink,
      allowBiometric,
      allowTwoFactor,
      allowEmailRegister,
      captchaEnabled: auth.captchaEnabled,
      captchaSiteKey: auth.captchaSiteKey,
      googleClientId: auth.googleClientId,
      facebookAppId: auth.facebookAppId,
      authMode: auth.authMode,
      firebaseEnabled: auth.firebaseEnabled,
      hasAnyMethod,
    };
  }, [auth]);

  return (
    <AuthConfigContext.Provider value={value}>
      {children}
    </AuthConfigContext.Provider>
  );
}

export function useAuthConfig(): AuthConfig {
  return useContext(AuthConfigContext);
}

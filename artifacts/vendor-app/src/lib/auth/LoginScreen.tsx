/**
 * LoginScreen.tsx — vendor-app
 *
 * Thin wrapper around @workspace/auth-react LoginScreen that wires the
 * vendor-specific auth flow, theme, and app status. Keeps the page file
 * (pages/Login.tsx) clean so all auth logic lives in lib/auth/.
 */
import { LoginScreen as SDKLoginScreen } from "@workspace/auth-react";
import type { AuthUser as SDKAuthUser } from "@workspace/auth-react";
import { useAuth } from "./useAuth";
import { useAppStatus } from "./useAppStatus";
import { useTheme } from "./ThemeContext";
import { api } from "../api";
import { useAuth as useAuthContext } from "../vendor-auth";
import { usePlatformConfig, getVendorAuthConfig } from "../useConfig";
import { useLanguage } from "../useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { loadGoogleGSIToken, loadFacebookAccessToken } from "@workspace/auth-utils";
import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";

export interface LoginScreenProps {
  onSuccess?: (token: string, profile: SDKAuthUser) => void;
}

export function LoginScreen({ onSuccess }: LoginScreenProps) {
  const { sendOtp, verifyOtp, loginWithPassword } = useAuth();
  const { maintenance, maintenanceMsg, supportPhone, supportEmail } = useAppStatus();
  const theme = useTheme();
  const { login } = useAuthContext();
  const [, navigate] = useLocation();
  const { config } = usePlatformConfig();
  const vendorAuth = getVendorAuthConfig(config);
  const { language } = useLanguage();
  const T = (k: TranslationKey) => tDual(k, language);

  const [overlay, setOverlay] = useState<"pending" | "rejected" | "biometric" | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  const capturedTokenRef = useRef("");

  /* ── check biometric enrollment ── */
  useEffect(() => {
    const check = async () => {
      try {
        const { isBiometricEnabled } = await import("../biometric");
        setBiometricEnabled(await isBiometricEnabled());
      } catch { }
    };
    check();
  }, []);

  const doLogin = useCallback(async (res: { token?: string; refreshToken?: string; pendingApproval?: boolean; approvalStatus?: string; rejectionReason?: string | null; user?: unknown }) => {
    if (res.pendingApproval || res.approvalStatus === "pending") {
      setOverlay("pending"); return;
    }
    if (res.rejectionReason || res.approvalStatus === "rejected") {
      setRejectionReason(res.rejectionReason ?? "Your application was not approved.");
      setOverlay("rejected"); return;
    }

    const token = res.token ?? "";
    capturedTokenRef.current = token;
    api.storeTokens(token, res.refreshToken);
    try {
      const profile = await api.getMe();
      login(token, profile, res.refreshToken);
      onSuccess?.(token, profile);
      navigate("/");
    } catch (e: unknown) {
      api.clearTokens();
      setLoginError(e instanceof Error ? e.message : "Failed to load profile.");
    }
  }, [login, navigate, onSuccess]);

  const confirmBiometric = async (enable: boolean) => {
    if (!capturedTokenRef.current) {
      setOverlay(null);
      navigate("/");
      return;
    }
    if (enable) {
      const { setBiometricEnabled } = await import("../biometric").catch(() => ({} as never));
      if (setBiometricEnabled) await setBiometricEnabled(true);
    }
    try {
      const profile = await api.getMe();
      login(capturedTokenRef.current, profile, api.getRefreshToken() || undefined);
      setOverlay(null);
      navigate("/");
    } catch (e: unknown) {
      api.clearTokens();
      setOverlay(null);
      setLoginError(e instanceof Error ? e.message : "Failed to load profile. Please log in again.");
    }
  };

  const handleGoogle = useCallback(async () => {
    const vendorAuthCfg = getVendorAuthConfig(config);
    if (!vendorAuthCfg.googleClientId) { setLoginError(T("socialLoginComingSoon")); return; }
    try {
      const idToken = await loadGoogleGSIToken(vendorAuthCfg.googleClientId);
      await doLogin(await api.socialGoogle({ idToken }) as never);
    } catch (e: unknown) { setLoginError(e instanceof Error ? e.message : "Google sign-in failed"); }
  }, [doLogin, config, T]);

  const handleFacebook = useCallback(async () => {
    const vendorAuthCfg = getVendorAuthConfig(config);
    if (!vendorAuthCfg.facebookAppId) { setLoginError(T("socialLoginComingSoon")); return; }
    try {
      const accessToken = await loadFacebookAccessToken(vendorAuthCfg.facebookAppId);
      await doLogin(await api.socialFacebook({ accessToken }) as never);
    } catch (e: unknown) { setLoginError(e instanceof Error ? e.message : "Facebook sign-in failed"); }
  }, [doLogin, config, T]);

  const handleMagicLink = useCallback(async (identifier: string) => {
    try {
      await api.magicLinkSend(identifier);
    } catch (e: unknown) {
      setLoginError(e instanceof Error ? e.message : T("loginFailed"));
    }
  }, [T]);

  /* ── Overlays ── */
  if (maintenance) return <MaintenanceOverlay message={maintenanceMsg} supportPhone={supportPhone} supportEmail={supportEmail} />;
  if (overlay === "pending") return <PendingOverlay onBack={() => setOverlay(null)} />;
  if (overlay === "rejected") return <RejectedOverlay reason={rejectionReason} onBack={() => { setOverlay(null); setRejectionReason(null); }} />;
  if (overlay === "biometric") return <BiometricPromptOverlay onAccept={() => void confirmBiometric(true)} onDecline={() => void confirmBiometric(false)} />;

  /* ── Main login ── */
  return (
    <div style={{ background: theme.background, minHeight: "100vh", display: "flex" }}>
      {loginError && (
        <div style={{
          position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 50,
          background: theme.rejectedOverlay, border: `1px solid rgba(239,68,68,0.3)`, borderRadius: 12,
          padding: "10px 16px", color: theme.error ?? "#dc2626", fontSize: 13, fontWeight: 500,
        }}>
          {loginError}
        </div>
      )}
      <SDKLoginScreen
        role="vendor"
        onSuccess={(sdkUser: unknown, token: string) => {
          const u = sdkUser as Record<string, unknown>;
          void doLogin({
            token,
            user: u,
            approvalStatus: u.approvalStatus as string | undefined,
            rejectionReason: u.rejectionReason as string | null | undefined,
          });
        }}
        onRegisterPress={() => navigate("/register")}
        enableSocial={vendorAuth.google || vendorAuth.facebook}
        onGoogle={vendorAuth.google ? handleGoogle : undefined}
        onFacebook={vendorAuth.facebook ? handleFacebook : undefined}
        enableMagicLink={vendorAuth.magicLink}
        onMagicLink={handleMagicLink}
      />
    </div>
  );
}

/* ── Inline overlay components (vendor theme) ── */
function MaintenanceOverlay({ message, supportPhone, supportEmail }: { message?: string; supportPhone?: string; supportEmail?: string }) {
  const theme = useTheme();
  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: `linear-gradient(135deg, ${theme.background} 0%, ${theme.primaryLight} 100%)`, padding: 16,
    }}>
      <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 20, padding: "32px 28px", boxShadow: `0 4px 32px ${theme.border}80`, width: "100%", maxWidth: 400, textAlign: "center" }}>
        <div style={{ width: 72, height: 72, borderRadius: 18, border: `2px solid ${theme.primary}50`, background: `${theme.primary}15`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={theme.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>
        </div>
        <h2 style={{ color: theme.text, fontSize: 22, fontWeight: 800, margin: "0 0 10px" }}>Under Maintenance</h2>
        <p style={{ color: theme.textMuted, fontSize: 14, lineHeight: 1.65, margin: "0 0 20px" }}>{message ?? "We're making improvements. Back shortly!"}</p>
        {(supportPhone || supportEmail) && (
          <div style={{ background: theme.background, border: `1px solid ${theme.border}`, borderRadius: 12, padding: "12px 16px", textAlign: "left" }}>
            <p style={{ color: theme.primary, fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", margin: "0 0 8px" }}>Need Help?</p>
            {supportPhone && <p style={{ color: theme.text, fontSize: 14, fontWeight: 600, margin: "0 0 4px" }}>📞 {supportPhone}</p>}
            {supportEmail && <p style={{ color: theme.textMuted, fontSize: 13, margin: 0 }}>{supportEmail}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function PendingOverlay({ onBack }: { onBack?: () => void }) {
  const theme = useTheme();
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: `linear-gradient(135deg, ${theme.background} 0%, ${theme.primaryLight} 100%)`, padding: 16 }}>
      <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 20, padding: "32px 28px", boxShadow: `0 4px 32px ${theme.border}80`, width: "100%", maxWidth: 400, textAlign: "center" }}>
        <div style={{ width: 72, height: 72, borderRadius: 18, border: `2px solid ${theme.primary}50`, background: `${theme.primary}15`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={theme.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
        </div>
        <h2 style={{ color: theme.text, fontSize: 22, fontWeight: 800, margin: "0 0 10px" }}>Application Under Review</h2>
        <p style={{ color: theme.textMuted, fontSize: 14, lineHeight: 1.65, margin: "0 0 20px" }}>Your vendor application is being reviewed.</p>
        {onBack && <button onClick={onBack} style={{ background: theme.primary, color: theme.background, border: "none", borderRadius: 12, padding: "12px 20px", fontSize: 15, fontWeight: 700, cursor: "pointer", width: "100%" }}>Back to Login</button>}
      </div>
    </div>
  );
}

function RejectedOverlay({ reason, onBack }: { reason?: string | null; onBack?: () => void }) {
  const theme = useTheme();
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: `linear-gradient(135deg, ${theme.background} 0%, ${theme.primaryLight} 100%)`, padding: 16 }}>
      <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 20, padding: "32px 28px", boxShadow: `0 4px 32px ${theme.border}80`, width: "100%", maxWidth: 400, textAlign: "center" }}>
        <div style={{ width: 72, height: 72, borderRadius: 18, border: "2px solid rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.10)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={theme.error ?? "#ef4444"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
        </div>
        <h2 style={{ color: theme.text, fontSize: 22, fontWeight: 800, margin: "0 0 10px" }}>Not Approved</h2>
        {reason && (
          <div style={{ background: theme.rejectedOverlay, border: `1px solid rgba(239,68,68,0.3)`, borderRadius: 10, padding: "10px 14px", marginBottom: 20, textAlign: "left" }}>
            <p style={{ color: theme.error ?? "#dc2626", fontSize: 13, lineHeight: 1.5, margin: 0 }}>{reason}</p>
          </div>
        )}
        {onBack && <button onClick={onBack} style={{ background: theme.rejectedOverlay, color: theme.error ?? "#dc2626", border: `1px solid ${theme.error ?? "#ef4444"}4D`, borderRadius: 12, padding: "12px 20px", fontSize: 15, fontWeight: 700, cursor: "pointer", width: "100%" }}>Back to Login</button>}
      </div>
    </div>
  );
}

function BiometricPromptOverlay({ onAccept, onDecline, loading }: { onAccept: () => void; onDecline: () => void; loading?: boolean }) {
  const theme = useTheme();
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: `linear-gradient(135deg, ${theme.background} 0%, ${theme.primaryLight} 100%)`, padding: 16 }}>
      <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 20, padding: "32px 28px", boxShadow: `0 4px 32px ${theme.border}80`, width: "100%", maxWidth: 400, textAlign: "center" }}>
        <div style={{ width: 72, height: 72, borderRadius: 18, border: `2px solid ${theme.primary}50`, background: `${theme.primary}15`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={theme.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 10a2 2 0 0 0-2 2c0 1.02.5 1.96 1.34 2.53a.5.5 0 0 1 .16.58L10.5 18h3l-1-2.89a.5.5 0 0 1 .16-.58A2.5 2.5 0 0 0 14 12a2 2 0 0 0-2-2z" /><path d="M12 4C9.38 4 6 5.55 6 9v3a6 6 0 0 0 12 0V9c0-3.45-3.38-5-6-5z" /></svg>
        </div>
        <h2 style={{ color: theme.text, fontSize: 22, fontWeight: 800, margin: "0 0 10px" }}>Enable Quick Login?</h2>
        <p style={{ color: theme.textMuted, fontSize: 14, lineHeight: 1.65, margin: "0 0 24px" }}>Use your fingerprint or face scan to sign in instantly next time.</p>
        <button onClick={onAccept} disabled={loading} style={{ background: theme.primary, color: theme.background, border: "none", borderRadius: 12, padding: "13px 20px", fontSize: 15, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", width: "100%", marginBottom: 10, opacity: loading ? 0.65 : 1 }}>
          {loading ? "Setting up…" : "Yes, enable biometrics"}
        </button>
        <button onClick={onDecline} disabled={loading} style={{ background: "transparent", color: theme.textMuted, border: `1px solid ${theme.border}`, borderRadius: 12, padding: "11px 20px", fontSize: 14, fontWeight: 500, cursor: loading ? "not-allowed" : "pointer", width: "100%" }}>
          Skip for now
        </button>
      </div>
    </div>
  );
}

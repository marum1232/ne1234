/**
 * LoginScreen.tsx — rider-app
 *
 * Thin wrapper around @workspace/auth-react LoginScreen that wires the
 * rider-specific auth flow, theme, and app status. Keeps the page file
 * (pages/Login.tsx) clean so all auth logic lives in lib/auth/.
 */
import { LoginScreen as SDKLoginScreen } from "@workspace/auth-react";
import type { AuthUser as SDKAuthUser } from "@workspace/auth-react";
import { useAuth } from "./useAuth";
import { useAppStatus } from "./useAppStatus";
import { useTheme } from "./ThemeContext";
import { api } from "../api";
import { useAuth as useAuthContext, type AuthUser } from "../rider-auth";
import { usePlatformConfig } from "../useConfig";
import { useRiderAuthConfig } from "../AuthConfigContext";
import { useLanguage } from "../useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { loadGoogleGSIToken, loadFacebookAccessToken } from "@workspace/auth-utils";
import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";

export interface LoginScreenProps {
  onSuccess?: (token: string, profile: SDKAuthUser) => void;
}

export function LoginScreen({ onSuccess }: LoginScreenProps) {
  const { sendOtp, verifyOtp, loginWithPassword, refreshToken } = useAuth();
  const { maintenance, maintenanceMsg, supportPhone, supportEmail } = useAppStatus();
  const theme = useTheme();
  const { login } = useAuthContext();
  const [, navigate] = useLocation();
  const { config } = usePlatformConfig();
  const auth = useRiderAuthConfig();
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
      } catch { /* biometric not available */ }
    };
    check();
  }, []);

  const handleSuccess = useCallback(async (sdkUser: SDKAuthUser, _sdkToken: string) => {
    setLoginError(null);
    const approvalStatus = sdkUser.approvalStatus;
    const rejReason = sdkUser.rejectionReason;

    if (approvalStatus === "pending") { setOverlay("pending"); return; }
    if (approvalStatus === "rejected") { setRejectionReason(rejReason ?? null); setOverlay("rejected"); return; }

    const accessToken = _sdkToken ?? "";
    capturedTokenRef.current = accessToken;
    api.storeTokens(accessToken, undefined);

    let profile: AuthUser;
    try {
      profile = await api.getMe() as AuthUser;
    } catch (fetchErr: unknown) {
      api.clearTokens();
      setLoginError(fetchErr instanceof Error ? fetchErr.message : T("loginFailed"));
      return;
    }

    login(accessToken, profile, undefined);
    onSuccess?.(accessToken, profile as unknown as SDKAuthUser);
    navigate("/");
  }, [login, navigate, T, onSuccess]);

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
      const profile = await api.getMe() as AuthUser;
      login(capturedTokenRef.current, profile, undefined);
    } catch { /* profile fetch failed, just navigate */ }
    setOverlay(null);
    navigate("/");
  };

  const handleGoogle = useCallback(async () => {
    if (!auth.googleClientId) { setLoginError(T("socialLoginComingSoon")); return; }
    try {
      const idToken = await loadGoogleGSIToken(auth.googleClientId);
      const res = await api.socialGoogle({ idToken });
      await handleSuccess(res.user as SDKAuthUser, res.token as string);
    } catch (e: unknown) { setLoginError(e instanceof Error ? e.message : T("loginFailed")); }
  }, [auth.googleClientId, handleSuccess, T]);

  const handleFacebook = useCallback(async () => {
    if (!auth.facebookAppId) { setLoginError(T("socialLoginComingSoon")); return; }
    try {
      const accessToken = await loadFacebookAccessToken(auth.facebookAppId);
      const res = await api.socialFacebook({ accessToken });
      await handleSuccess(res.user as SDKAuthUser, res.token as string);
    } catch (e: unknown) { setLoginError(e instanceof Error ? e.message : T("loginFailed")); }
  }, [auth.facebookAppId, handleSuccess, T]);

  const handleMagicLink = useCallback(async (identifier: string) => {
    await api.sendMagicLink(identifier);
  }, []);

  /* ── Overlays ── */
  if (maintenance) {
    return (
      <OverlayWrapper>
        <MaintenanceOverlay message={maintenanceMsg} supportPhone={supportPhone} supportEmail={supportEmail} />
      </OverlayWrapper>
    );
  }

  if (overlay === "pending") {
    return <PendingOverlay appName={config.platform.appName} onBack={() => setOverlay(null)} />;
  }

  if (overlay === "rejected") {
    return <RejectedOverlay reason={rejectionReason} onBack={() => { setOverlay(null); setRejectionReason(null); }} />;
  }

  if (overlay === "biometric") {
    return <BiometricPromptOverlay onAccept={() => void confirmBiometric(true)} onDecline={() => void confirmBiometric(false)} />;
  }

  /* ── Main login screen ── */
  return (
    <div style={{ background: theme.background }}>
      {loginError && (
        <div style={{
          background: "rgba(239,68,68,0.08)", border: `1px solid ${theme.error ?? "rgba(239,68,68,0.25)"}`,
          borderRadius: 12, padding: "10px 14px", marginBottom: 12,
          color: theme.error ?? "#fca5a5", fontSize: 13, fontWeight: 500,
        }}>
          {loginError}
        </div>
      )}

      <SDKLoginScreen
        role="rider"
        onSuccess={(user, token) => { void handleSuccess(user, token); }}
        onRegisterPress={() => navigate("/register")}
        enableSocial={auth.googleEnabled || auth.facebookEnabled}
        onGoogle={auth.googleEnabled ? handleGoogle : undefined}
        onFacebook={auth.facebookEnabled ? handleFacebook : undefined}
        enableMagicLink={auth.magicLinkEnabled}
        onMagicLink={auth.magicLinkEnabled ? handleMagicLink : undefined}
        title={T("riderPortal") as string}
      />
    </div>
  );
}

/* ── Inline overlay re-exports so pages don't deep-import from Overlay.tsx ── */
function OverlayWrapper({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: t.background, padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 384 }}>{children}</div>
    </div>
  );
}

interface MaintenanceOverlayProps {
  message?: string;
  supportPhone?: string;
  supportEmail?: string;
}

function MaintenanceOverlay(props: MaintenanceOverlayProps) {
  const theme = useTheme();
  return (
    <div style={{
      background: theme.surface, border: `1px solid ${theme.border}`,
      borderRadius: 18, padding: "28px 24px", boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      textAlign: "center",
    }}>
      <div style={{ width: 64, height: 64, borderRadius: 16, border: `1px solid ${theme.primary}40`, background: `${theme.primary}18`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={theme.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      </div>
      <h2 style={{ color: theme.text, fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Under Maintenance</h2>
      <p style={{ color: theme.textMuted, fontSize: 14, lineHeight: 1.6, margin: "0 0 20px" }}>
        {props.message ?? "We're performing scheduled maintenance. Back soon!"}
      </p>
      {(props.supportPhone || props.supportEmail) && (
        <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 12, padding: "12px 16px", textAlign: "left" }}>
          <p style={{ color: theme.primary, fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 8px" }}>Need Help?</p>
          {props.supportPhone && <p style={{ color: theme.text, fontSize: 14, fontWeight: 600, margin: "0 0 4px" }}>📞 {props.supportPhone}</p>}
          {props.supportEmail && <p style={{ color: theme.textMuted, fontSize: 12, margin: 0 }}>{props.supportEmail}</p>}
        </div>
      )}
    </div>
  );
}

function PendingOverlay({ appName, onBack }: { appName?: string; onBack?: () => void }) {
  const theme = useTheme();
  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: theme.background, padding: 16,
    }}>
      <div style={{
        background: theme.surface, border: `1px solid ${theme.border}`,
        borderRadius: 18, padding: "28px 24px", boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        width: "100%", maxWidth: 384, textAlign: "center",
      }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, border: `1px solid ${theme.primary}40`, background: `${theme.primary}18`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={theme.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
        </div>
        <h2 style={{ color: theme.text, fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Application Under Review</h2>
        <p style={{ color: theme.textMuted, fontSize: 14, lineHeight: 1.6, margin: "0 0 20px" }}>
          Your {appName ?? "application"} is being reviewed by our team.
        </p>
        {onBack && <button onClick={onBack} style={{ background: `${theme.primary}15`, color: theme.primary, border: `1px solid ${theme.primary}30`, borderRadius: 10, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", width: "100%" }}>Back to Login</button>}
      </div>
    </div>
  );
}

function RejectedOverlay({ reason, onBack }: { reason?: string | null; onBack?: () => void }) {
  const theme = useTheme();
  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: theme.background, padding: 16,
    }}>
      <div style={{
        background: theme.surface, border: `1px solid ${theme.border}`,
        borderRadius: 18, padding: "28px 24px", boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        width: "100%", maxWidth: 384, textAlign: "center",
      }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, border: `1px solid rgba(239,68,68,0.35)`, background: `rgba(239,68,68,0.12)`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={theme.error ?? "#ef4444"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
        </div>
        <h2 style={{ color: theme.text, fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Application Not Approved</h2>
        {reason && (
          <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.22)", borderRadius: 10, padding: "10px 14px", marginBottom: 20, textAlign: "left" }}>
            <p style={{ color: theme.error ?? "#fca5a5", fontSize: 13, lineHeight: 1.5, margin: 0 }}>{reason}</p>
          </div>
        )}
        {onBack && <button onClick={onBack} style={{ background: theme.rejectedOverlay, color: theme.error ?? "#f87171", border: `1px solid ${theme.error ?? "#ef4444"}40`, borderRadius: 10, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", width: "100%" }}>Back to Login</button>}
      </div>
    </div>
  );
}

function BiometricPromptOverlay({ onAccept, onDecline, loading }: { onAccept: () => void; onDecline: () => void; loading?: boolean }) {
  const theme = useTheme();
  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: theme.background, padding: 16,
    }}>
      <div style={{
        background: theme.surface, border: `1px solid ${theme.border}`,
        borderRadius: 18, padding: "28px 24px", boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        width: "100%", maxWidth: 384, textAlign: "center",
      }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, border: `1px solid ${theme.primary}40`, background: `${theme.primary}18`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={theme.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 10a2 2 0 0 0-2 2c0 1.02.5 1.96 1.34 2.53a.5.5 0 0 1 .16.58L10.5 18h3l-1-2.89a.5.5 0 0 1 .16-.58A2.5 2.5 0 0 0 14 12a2 2 0 0 0-2-2z" /><path d="M12 4C9.38 4 6 5.55 6 9v3a6 6 0 0 0 12 0V9c0-3.45-3.38-5-6-5z" /></svg>
        </div>
        <h2 style={{ color: theme.text, fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Enable Biometric Login?</h2>
        <p style={{ color: theme.textMuted, fontSize: 14, lineHeight: 1.6, margin: "0 0 24px" }}>Sign in faster next time with your fingerprint or face scan.</p>
        <button onClick={onAccept} disabled={loading} style={{ background: loading ? `${theme.primaryDark}80` : `linear-gradient(135deg, ${theme.primary}, ${theme.primaryDark})`, color: theme.background, border: "none", borderRadius: 12, padding: "12px 20px", fontSize: 15, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", width: "100%", marginBottom: 10, opacity: loading ? 0.7 : 1 }}>
          {loading ? "Setting up…" : "Enable Biometrics"}
        </button>
        <button onClick={onDecline} disabled={loading} style={{ background: "transparent", color: theme.textMuted, border: `1px solid ${theme.border}`, borderRadius: 12, padding: "10px 20px", fontSize: 14, fontWeight: 500, cursor: loading ? "not-allowed" : "pointer", width: "100%" }}>
          Skip for now
        </button>
      </div>
    </div>
  );
}

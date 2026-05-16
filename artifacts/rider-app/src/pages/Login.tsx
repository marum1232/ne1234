import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useLocation } from "wouter";
import { LoginScreen } from "@workspace/auth-react";
import type { AuthUser as SDKAuthUser } from "@workspace/auth-react";
import { useAuth, type AuthUser } from "../lib/auth";
import { api } from "../lib/api";
import { usePlatformConfig } from "../lib/useConfig";
import { useRiderAuthConfig } from "../lib/AuthConfigContext";
import { useLanguage } from "../lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { loadGoogleGSIToken, loadFacebookAccessToken } from "@workspace/auth-utils";
import {
  Bike, Loader2, Fingerprint, Clock, Shield, AlertCircle, Lightbulb, ArrowLeft, Wrench, Phone,
} from "lucide-react";
import {
  isBiometricAvailable, isBiometricEnabled,
  setBiometricEnabled as saveBiometricEnabled,
  storeBiometricToken, getBiometricToken, verifyBiometric,
} from "../lib/biometric";

/* ── Overlay states ────────────────────────────────────────────────────── */
type OverlayStep = "main" | "pending" | "rejected" | "biometric-prompt";

/* ── Shared helper components ──────────────────────────────────────────── */
function DarkScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0B0E11] flex items-center justify-center p-4 relative overflow-hidden"
      style={{ paddingTop: "env(safe-area-inset-top,0px)" }}>
      <div className="absolute top-0 left-1/4 w-96 h-96 rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(240,185,11,0.06) 0%, transparent 70%)" }} />
      <div className="absolute bottom-0 right-1/4 w-80 h-80 rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(240,185,11,0.04) 0%, transparent 70%)" }} />
      <div className="relative z-10 w-full max-w-sm">{children}</div>
    </div>
  );
}

function DarkCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[#131720] border border-[#F0B90B]/15 rounded-2xl p-7 shadow-2xl ${className}`}>
      {children}
    </div>
  );
}

function GoldBtn({ onClick, disabled, children, className = "" }: {
  onClick?: () => void; disabled?: boolean; children: React.ReactNode; className?: string;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`w-full h-12 font-bold rounded-xl transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      style={{
        background: disabled ? "#3a3208" : "linear-gradient(135deg,#F0B90B,#D97706)",
        color: "#0B0E11",
        boxShadow: disabled ? "none" : "0 0 20px rgba(240,185,11,0.25)",
      }}>
      {children}
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */

export default function Login() {
  const { login } = useAuth();
  const [, navigate] = useLocation();
  const { config } = usePlatformConfig();
  const auth = useRiderAuthConfig();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const appName = config.platform.appName;
  const googleClientId = auth.googleClientId ?? config.auth?.googleClientId;
  const facebookAppId  = auth.facebookAppId  ?? config.auth?.facebookAppId;

  /* ── Overlay state ──────────────────────────────────────────────────── */
  const [overlayStep, setOverlayStep] = useState<OverlayStep>("main");
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  /* ── Biometric state ────────────────────────────────────────────────── */
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled,   setBiometricEnabledState] = useState(false);
  const [biometricLoading,   setBiometricLoading] = useState(false);

  /* ── Pending biometric enrollment data ─────────────────────────────── */
  const [pendingToken,        setPendingToken]        = useState("");
  const [pendingProfile,      setPendingProfile]      = useState<AuthUser | null>(null);
  const [pendingRefreshToken, setPendingRefreshToken] = useState<string | undefined>();

  /* ── Captured tokens from intercepted auth API responses ───────────── *
   * useLoginFlow (inside LoginScreen) calls our server endpoints but only
   * exposes (user, accessToken) through onSuccess, discarding the refresh
   * token.  The interceptor:
   *   1. Remaps server { token } → { accessToken } so useLoginFlow reads
   *      the correct field (our server uses "token", not "accessToken").
   *   2. Captures { token, refreshToken } into refs so handleSuccess can
   *      use the actual access token and store the refresh token for the
   *      biometric enrollment flow.
   * The interceptor is removed on unmount so it never bleeds into other
   * routes after the rider logs in.
   *
   * TODO(tech-debt): Replace this window.fetch monkey-patch with a proper
   * integration point once one of the following is implemented:
   *   a) The server aligns its auth response field name to { accessToken }
   *      instead of { token } (matches the SDK contract).
   *   b) useLoginFlow / LoginScreen exposes { refreshToken } through the
   *      onSuccess callback signature.
   * Until then the patch is scoped strictly to Login.tsx mount lifetime
   * and only intercepts the three auth paths listed in AUTH_PATHS.
   * ─────────────────────────────────────────────────────────────────── */
  const capturedTokenRef        = useRef("");
  const capturedRefreshTokenRef = useRef("");

  useEffect(() => {
    const AUTH_PATHS = ["/api/auth/verify-otp", "/api/auth/login", "/api/auth/2fa/verify"];
    const origFetch  = window.fetch;

    window.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
      const res = await origFetch(...args);
      const url  = typeof args[0] === "string" ? args[0] : (args[0] as Request).url;
      const hits  = AUTH_PATHS.some(p => url.includes(p));
      if (!hits) return res;

      try {
        const json = await res.json() as Record<string, unknown>;
        const data = json?.data as Record<string, unknown> | undefined;

        /* Capture raw tokens */
        const rawToken   = (data?.token   ?? json?.token)   as string | undefined;
        const rawRefresh = (data?.refreshToken ?? json?.refreshToken) as string | undefined;
        if (rawToken)   capturedTokenRef.current        = rawToken;
        if (rawRefresh) capturedRefreshTokenRef.current = rawRefresh;

        /* Remap { token } → { accessToken } so useLoginFlow reads it */
        if (data && rawToken && !data.accessToken) {
          (data as Record<string, unknown>).accessToken = rawToken;
          json.data = data;
        }

        return new Response(JSON.stringify(json), {
          status: res.status,
          headers: { "Content-Type": "application/json" },
        });
      } catch {
        return res; /* leave unmodified on parse error */
      }
    };

    return () => { window.fetch = origFetch; };
  }, []);

  useEffect(() => {
    isBiometricAvailable().then(available => {
      setBiometricAvailable(available);
      if (available) isBiometricEnabled().then(setBiometricEnabledState);
    });
  }, []);

  /* ── Biometric quick-login ──────────────────────────────────────────── */
  const handleBiometricLogin = async () => {
    setBiometricLoading(true);
    setLoginError(null);
    try {
      const ok = await verifyBiometric();
      if (!ok) { setBiometricLoading(false); return; }
      const storedToken = await getBiometricToken();
      if (!storedToken) {
        setLoginError("Biometric session expired. Please log in with your credentials.");
        await saveBiometricEnabled(false);
        setBiometricEnabledState(false);
        setBiometricLoading(false);
        return;
      }
      const res = await fetch(`${window.location.origin}/api/auth/refresh`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: storedToken }),
      });
      if (!res.ok) {
        setLoginError("Biometric session expired. Please log in with your credentials.");
        await saveBiometricEnabled(false);
        setBiometricEnabledState(false);
        setBiometricLoading(false);
        return;
      }
      const data = await res.json();
      api.storeTokens(data.token, data.refreshToken ?? storedToken);
      const profile = await api.getMe() as AuthUser;
      login(data.token, profile, data.refreshToken ?? storedToken);
    } catch {
      setLoginError("Biometric sign-in failed. Please use your credentials.");
    }
    setBiometricLoading(false);
  };

  /* ── Post-success handler (called by LoginScreen on successful auth) ── *
   * sdkToken may be undefined/wrong if the server uses { token } instead of
   * { accessToken }; the fetch interceptor above captures the real value in
   * capturedTokenRef so we always have the correct access token.
   * ─────────────────────────────────────────────────────────────────── */
  const handleSuccess = useCallback(async (sdkUser: SDKAuthUser, sdkToken: string) => {
    setLoginError(null);
    const u = sdkUser as unknown as Record<string, unknown>;
    const approvalStatus = u.approvalStatus as string | undefined;
    const rejReason      = u.rejectionReason as string | null | undefined;

    if (approvalStatus === "pending") {
      setOverlayStep("pending");
      return;
    }
    if (approvalStatus === "rejected") {
      setRejectionReason(rejReason ?? null);
      setOverlayStep("rejected");
      return;
    }

    /* Prefer the token captured by the fetch interceptor (the server sends
       { token } not { accessToken }, so sdkToken may be falsy). */
    const accessToken  = capturedTokenRef.current        || sdkToken;
    const refreshToken = capturedRefreshTokenRef.current || undefined;

    /* Store tokens and fetch the full rider profile */
    api.storeTokens(accessToken, refreshToken);
    let profile: AuthUser;
    try {
      profile = await api.getMe() as AuthUser;
    } catch (fetchErr: unknown) {
      api.clearTokens();
      setLoginError(fetchErr instanceof Error ? fetchErr.message : T("loginFailed"));
      return;
    }

    /* Offer biometric enrollment on first successful login on a capable device */
    const bioAvail = await isBiometricAvailable();
    if (bioAvail && !biometricEnabled) {
      setPendingToken(accessToken);
      setPendingProfile(profile);
      setPendingRefreshToken(refreshToken);
      setOverlayStep("biometric-prompt");
      return;
    }

    login(accessToken, profile, refreshToken);
    navigate("/");
  }, [biometricEnabled, login, navigate, T]);

  /* ── Biometric enrollment confirmation ──────────────────────────────── */
  const confirmBiometricEnrollment = async (enable: boolean) => {
    if (!pendingProfile) return;
    if (enable && pendingRefreshToken) {
      await saveBiometricEnabled(true);
      await storeBiometricToken(pendingRefreshToken);
      setBiometricEnabledState(true);
    }
    login(pendingToken, pendingProfile, pendingRefreshToken);
    setOverlayStep("main");
    navigate("/");
  };

  /* ── Social + magic-link handlers ──────────────────────────────────── */
  const handleGoogle = useCallback(async () => {
    if (!googleClientId) { setLoginError(T("socialLoginComingSoon")); return; }
    try {
      const idToken = await loadGoogleGSIToken(googleClientId);
      const res = await api.socialGoogle({ idToken });
      await handleSuccess(res.user as SDKAuthUser, res.token);
    } catch (e: unknown) {
      setLoginError(e instanceof Error ? e.message : T("loginFailed"));
    }
  }, [googleClientId, handleSuccess, T]);

  const handleFacebook = useCallback(async () => {
    if (!facebookAppId) { setLoginError(T("socialLoginComingSoon")); return; }
    try {
      const accessToken = await loadFacebookAccessToken(facebookAppId);
      const res = await api.socialFacebook({ accessToken });
      await handleSuccess(res.user as SDKAuthUser, res.token);
    } catch (e: unknown) {
      setLoginError(e instanceof Error ? e.message : T("loginFailed"));
    }
  }, [facebookAppId, handleSuccess, T]);

  const handleMagicLink = useCallback(async (identifier: string) => {
    await api.sendMagicLink(identifier);
  }, []);

  /* ── Maintenance overlay ────────────────────────────────────────────── */
  if (config.platform.appStatus === "maintenance") {
    return (
      <DarkScreen>
        <DarkCard className="text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-[#F0B90B]/30"
            style={{ background: "rgba(240,185,11,0.1)" }}>
            <Wrench size={30} className="text-[#F0B90B]" />
          </div>
          <h2 className="text-xl font-bold text-[#E8E9EF] mb-2">Under Maintenance</h2>
          <p className="text-[#6B7280] text-sm leading-relaxed mb-5">
            {config.content.maintenanceMsg || "We're performing scheduled maintenance. Back soon!"}
          </p>
          {(config.platform.supportPhone || config.platform.supportEmail) && (
            <div className="bg-[#0F1217] border border-[#252836] rounded-xl p-3 text-left">
              <p className="text-[10px] font-bold text-[#F0B90B] uppercase tracking-wider mb-2">Need Help?</p>
              {config.platform.supportPhone && (
                <p className="text-sm font-semibold text-[#C9CDD8] flex items-center gap-2">
                  <Phone size={12} className="text-[#6B7280]" /> {config.platform.supportPhone}
                </p>
              )}
              {config.platform.supportEmail && (
                <p className="text-xs text-[#6B7280] mt-1 ml-5">{config.platform.supportEmail}</p>
              )}
            </div>
          )}
        </DarkCard>
      </DarkScreen>
    );
  }

  /* ── Pending approval overlay ───────────────────────────────────────── */
  if (overlayStep === "pending") {
    return (
      <DarkScreen>
        <DarkCard className="text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-[#F0B90B]/30"
            style={{ background: "rgba(240,185,11,0.08)" }}>
            <Clock size={30} className="text-[#F0B90B]" />
          </div>
          <h2 className="text-xl font-bold text-[#E8E9EF] mb-2">{T("approvalPending")}</h2>
          <p className="text-[#6B7280] text-sm leading-relaxed mb-5">
            {T("approvalMsg")} {T("approvalTakes")}
          </p>
          <div className="bg-[#0F1217] border border-[#F0B90B]/20 rounded-xl p-3 mb-5 text-left flex gap-2">
            <Lightbulb size={13} className="text-[#F0B90B] flex-shrink-0 mt-0.5" />
            <p className="text-[#9CA3AF] text-xs leading-relaxed">{T("alreadyApproved")}</p>
          </div>
          <GoldBtn onClick={() => setOverlayStep("main")}>
            <ArrowLeft size={14} /> {T("backToLogin")}
          </GoldBtn>
        </DarkCard>
      </DarkScreen>
    );
  }

  /* ── Rejected overlay ───────────────────────────────────────────────── */
  if (overlayStep === "rejected") {
    return (
      <DarkScreen>
        <DarkCard className="text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-red-500/30"
            style={{ background: "rgba(239,68,68,0.08)" }}>
            <Shield size={30} className="text-red-400" />
          </div>
          <h2 className="text-xl font-bold text-[#E8E9EF] mb-2">
            {T("approvalRejected") || "Application Rejected"}
          </h2>
          <p className="text-[#6B7280] text-sm leading-relaxed mb-4">
            {T("approvalRejectedMsg") || "Your rider application was not approved. Please contact support."}
          </p>
          {rejectionReason && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 mb-5 text-left">
              <p className="text-red-400 text-xs font-semibold mb-1">Reason:</p>
              <p className="text-red-300 text-xs">{rejectionReason}</p>
            </div>
          )}
          <GoldBtn onClick={() => { setOverlayStep("main"); setRejectionReason(null); }}>
            <ArrowLeft size={14} /> {T("backToLogin")}
          </GoldBtn>
        </DarkCard>
      </DarkScreen>
    );
  }

  /* ── Biometric enrollment prompt ────────────────────────────────────── */
  if (overlayStep === "biometric-prompt") {
    return (
      <DarkScreen>
        <DarkCard className="text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-[#F0B90B]/30"
            style={{ background: "rgba(240,185,11,0.08)" }}>
            <Fingerprint size={30} className="text-[#F0B90B]" />
          </div>
          <h2 className="text-xl font-bold text-[#E8E9EF] mb-2">Enable Biometrics?</h2>
          <p className="text-[#6B7280] text-sm leading-relaxed mb-6">
            Use fingerprint or face recognition for faster sign-in next time.
          </p>
          <div className="space-y-3">
            <GoldBtn onClick={() => confirmBiometricEnrollment(true)}>
              <Fingerprint size={16} /> Enable Biometric Sign-in
            </GoldBtn>
            <button onClick={() => confirmBiometricEnrollment(false)}
              className="w-full h-11 rounded-xl border border-[#252836] bg-[#0F1217] text-[#6B7280] hover:text-[#9CA3AF] text-sm font-semibold transition-colors">
              Skip for now
            </button>
          </div>
        </DarkCard>
      </DarkScreen>
    );
  }

  /* ── Main login screen ──────────────────────────────────────────────── */
  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#0B0E11]"
      style={{ paddingTop: "env(safe-area-inset-top,0px)" }}>

      {/* ── LEFT PANEL (desktop only) ───────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[44%] xl:w-[42%] flex-col justify-between p-10 relative overflow-hidden flex-shrink-0 border-r border-[#F0B90B]/8"
        style={{ background: "linear-gradient(160deg,#0D1017 0%,#0B0E11 60%,#0F1117 100%)" }}>

        <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.04]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
              <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#F0B90B" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>

        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(240,185,11,0.08) 0%, transparent 65%)" }} />
        <div className="absolute bottom-0 left-0 w-80 h-80 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(240,185,11,0.05) 0%, transparent 70%)" }} />

        <div className="relative z-10 flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center border border-[#F0B90B]/40"
            style={{ background: "rgba(240,185,11,0.12)" }}>
            <Bike size={22} className="text-[#F0B90B]" />
          </div>
          <div>
            <p className="text-[#E8E9EF] font-extrabold text-lg leading-tight">{appName}</p>
            <p className="text-[#F0B90B] text-xs font-medium tracking-widest uppercase">{T("riderPortal")}</p>
          </div>
        </div>

        <div className="relative z-10">
          <p className="text-[#6B7280] text-xs font-semibold tracking-[0.2em] uppercase mb-3">Delivery Partner Platform</p>
          <h1 className="text-4xl xl:text-5xl font-extrabold leading-tight mb-4" style={{ color: "#E8E9EF" }}>
            Deliver Fast.<br />
            <span style={{ background: "linear-gradient(90deg,#F0B90B,#D97706)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Earn More.
            </span>
          </h1>
          <p className="text-[#6B7280] text-sm leading-relaxed mb-8 max-w-xs">
            Join {appName} as a certified delivery partner — flexible hours, instant payouts, real-time route optimisation.
          </p>

          <div className="grid grid-cols-3 gap-3 mb-8">
            {[{ v: "24/7", l: "Support" }, { v: "Fast", l: "Payouts" }, { v: "Live", l: "Tracking" }].map(s => (
              <div key={s.l} className="bg-[#0F1217] border border-[#252836] rounded-xl p-3 text-center">
                <p className="text-[#F0B90B] font-extrabold text-lg leading-none">{s.v}</p>
                <p className="text-[#6B7280] text-[10px] mt-1 font-medium">{s.l}</p>
              </div>
            ))}
          </div>

          <div className="space-y-2.5">
            {[
              { icon: "⚡", title: "Instant Earnings", desc: "Get credited after every completed delivery" },
              { icon: "🗺️", title: "Smart Navigation",  desc: "AI-optimised routes for maximum efficiency" },
              { icon: "🕐", title: "Flexible Schedule",  desc: "Go online and offline whenever you want" },
              { icon: "🏆", title: "Performance Bonuses",desc: "Earn more with high ratings & streaks" },
            ].map(f => (
              <div key={f.title}
                className="flex items-center gap-3 bg-[#0F1217] border border-[#252836] hover:border-[#F0B90B]/20 rounded-xl px-4 py-2.5 transition-colors">
                <span className="text-base flex-shrink-0">{f.icon}</span>
                <div>
                  <p className="text-[#C9CDD8] font-bold text-xs">{f.title}</p>
                  <p className="text-[#4B5563] text-[10px] leading-tight">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10">
          <p className="text-[#374151] text-xs">© {new Date().getFullYear()} {appName} · Rider Programme</p>
        </div>
      </div>

      {/* ── RIGHT PANEL ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col" style={{ background: "#0B0E11" }}>

        {/* Mobile top bar */}
        <div className="lg:hidden px-5 pt-8 pb-6 flex items-center gap-3 border-b border-[#1A1D24]">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center border border-[#F0B90B]/40"
            style={{ background: "rgba(240,185,11,0.1)" }}>
            <Bike size={18} className="text-[#F0B90B]" />
          </div>
          <div>
            <p className="text-[#E8E9EF] font-extrabold text-base leading-none">{appName}</p>
            <p className="text-[#F0B90B] text-[10px] tracking-widest uppercase font-medium">{T("riderPortal")}</p>
          </div>
        </div>

        {/* Form area */}
        <div className="flex-1 flex items-start lg:items-center justify-center px-5 py-8 lg:p-12">
          <div className="w-full max-w-sm lg:max-w-md">

            {/* Notice banner */}
            {config.content.riderNotice && (
              <div className="bg-[#F0B90B]/8 border border-[#F0B90B]/25 rounded-xl p-3 mb-4 flex items-start gap-2.5">
                <AlertCircle size={14} className="text-[#F0B90B] flex-shrink-0 mt-0.5" />
                <p className="text-[#D9A520] text-xs font-medium leading-relaxed">{config.content.riderNotice}</p>
              </div>
            )}

            {/* Error banner (from social / biometric / post-success failures) */}
            {loginError && (
              <div className="mb-4 p-3 bg-red-500/8 border border-red-500/25 rounded-xl flex items-start gap-2">
                <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-red-400 text-xs font-medium">{loginError}</p>
              </div>
            )}

            {/* Biometric quick-login (shown above the form when enrolled) */}
            {biometricAvailable && biometricEnabled && (
              <button onClick={handleBiometricLogin} disabled={biometricLoading}
                className="w-full mb-4 h-12 rounded-xl border border-[#252836] bg-[#131720] hover:border-[#F0B90B]/40 text-[#9CA3AF] hover:text-[#F0B90B] text-sm font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-50 shadow-sm">
                {biometricLoading
                  ? <><Loader2 size={16} className="animate-spin" /> Verifying…</>
                  : <><Fingerprint size={16} /> Sign in with Biometrics</>}
              </button>
            )}

            {/* ── LoginScreen: shared SDK auth component ──────────────── *
             * customFields: "licenseNumber" is the exact CustomField type
             * exported by @workspace/auth-react (LoginScreen.tsx line 13).
             * "vehicleType" is likewise a valid SDK CustomField value.
             * ─────────────────────────────────────────────────────────── */}
            <LoginScreen
              role="rider"
              customFields={["vehicleType", "licenseNumber"]}
              onSuccess={(user, token) => { void handleSuccess(user, token); }}
              onRegisterPress={() => navigate("/register")}
              enableSocial={auth.googleEnabled || auth.facebookEnabled}
              onGoogle={auth.googleEnabled ? handleGoogle : undefined}
              onFacebook={auth.facebookEnabled ? handleFacebook : undefined}
              enableMagicLink={auth.magicLinkEnabled}
              onMagicLink={auth.magicLinkEnabled ? handleMagicLink : undefined}
              title={T("riderPortal") as string}
            />

            {/* Footer links */}
            <div className="mt-4 text-center">
              <Link to="/register"
                className="text-sm text-[#6B7280] hover:text-[#E8E9EF] transition-colors">
                New rider?{" "}
                <span className="text-[#F0B90B] font-bold hover:text-[#D97706]">Register here</span>
              </Link>
              {(config.content.tncUrl || config.content.privacyUrl) && (
                <div className="mt-2 flex items-center justify-center gap-3">
                  {config.content.tncUrl && (
                    <a href={config.content.tncUrl} target="_blank" rel="noopener noreferrer"
                      className="text-[11px] text-[#374151] hover:text-[#6B7280] underline underline-offset-2 transition-colors">
                      Terms
                    </a>
                  )}
                  {config.content.tncUrl && config.content.privacyUrl && (
                    <span className="text-[#252836] text-[11px]">·</span>
                  )}
                  {config.content.privacyUrl && (
                    <a href={config.content.privacyUrl} target="_blank" rel="noopener noreferrer"
                      className="text-[11px] text-[#374151] hover:text-[#6B7280] underline underline-offset-2 transition-colors">
                      Privacy Policy
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

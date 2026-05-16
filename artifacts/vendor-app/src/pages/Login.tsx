import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { OtpInput, PhoneInput, PasswordInput, SocialButtons } from "@workspace/auth-react";
import type { Country } from "@workspace/auth-react";
import { useAuth } from "../lib/auth";
import { api, apiFetch } from "../lib/api";
import { usePlatformConfig, getVendorAuthConfig } from "../lib/useConfig";
import { useLanguage } from "../lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { canonicalizePhone, executeCaptcha } from "@workspace/auth-utils";

function getDeviceFingerprint(): string {
  const stored = sessionStorage.getItem("_dfp");
  if (stored) return stored;
  const fp = [
    navigator.userAgent,
    navigator.language,
    screen.width + "x" + screen.height,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.hardwareConcurrency ?? "",
  ].filter(Boolean).join("|");
  let hash = 0;
  for (let i = 0; i < fp.length; i++) { hash = ((hash << 5) - hash + fp.charCodeAt(i)) | 0; }
  const id = "web_" + Math.abs(hash).toString(36);
  sessionStorage.setItem("_dfp", id);
  return id;
}

/* ── Types ──────────────────────────────────────────────────────────────── */
type LoginStep = "identifier" | "otp" | "password" | "2fa" | "pending" | "done";
type LoginMethod = "phone" | "email" | "username" | "google" | "facebook";
type ForgotStep = "forgot" | "forgot-otp" | "forgot-reset" | "forgot-done";

interface AuthResponse {
  token: string;
  refreshToken?: string;
  pendingApproval?: boolean;
  requires2FA?: boolean;
  tempToken?: string;
  userId?: string;
  user?: { roles?: string[] | string; role?: string; status?: string };
}

const FEATURES = [
  { icon: "📦", titleKey: "orderManagement" as TranslationKey,  descKey: "manageOrdersDesc" as TranslationKey },
  { icon: "🍽️", titleKey: "productControl" as TranslationKey,   descKey: "productControlDesc" as TranslationKey },
  { icon: "💰", titleKey: "instantEarnings" as TranslationKey,  descKey: "instantEarningsDesc" as TranslationKey },
  { icon: "🎟️", titleKey: "promoCodes" as TranslationKey,       descKey: "promoCodesDesc" as TranslationKey },
];

export default function Login() {
  const [, navigate] = useLocation();
  const { login } = useAuth();
  const { config } = usePlatformConfig();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const appName         = config.platform.appName;
  const vendorAuth      = getVendorAuthConfig(config);
  const vendorEarningsPct = Math.round(100 - (config.platform.vendorCommissionPct ?? 15));

  /* ── Core state ──────────────────────────────────────────────────────── */
  const [step, setStep]         = useState<LoginStep>("identifier");
  const [method, setMethod]     = useState<LoginMethod>("phone");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const clearError = () => setError("");

  /* ── Identifier step ─────────────────────────────────────────────────── */
  const [identifier, setIdentifier]   = useState("");

  /* ── Phone OTP ───────────────────────────────────────────────────────── */
  const [phone, setPhone]           = useState("");      // E.164
  const [phoneLocal, setPhoneLocal] = useState("");      // local display
  const [devOtp, setDevOtp]         = useState("");
  const [otpChannel, setOtpChannel] = useState("sms");
  const [fallbackChannels, setFallbackChannels] = useState<string[]>([]);
  const [resendCooldown, setResendCooldown] = useState(0);

  /* ── Email OTP ───────────────────────────────────────────────────────── */
  const [email, setEmail]         = useState("");
  const [emailDevOtp, setEmailDevOtp] = useState("");

  /* ── Password ────────────────────────────────────────────────────────── */
  const [username, setUsername]   = useState("");
  const [password, setPassword]   = useState("");

  /* ── 2FA / TOTP ──────────────────────────────────────────────────────── */
  const [totpTempToken, setTotpTempToken] = useState("");
  const [totpUserId,    setTotpUserId]    = useState("");

  /* ── Forgot password overlay ─────────────────────────────────────────── */
  const [forgotStep, setForgotStep] = useState<ForgotStep | null>(null);
  const [forgotId,  setForgotId]   = useState("");
  const [forgotOtp, setForgotOtp]  = useState("");
  const [forgotPwd, setForgotPwd]  = useState("");
  const [forgotCfm, setForgotCfm]  = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotErr, setForgotErr]  = useState("");

  /* ── Abort refs ──────────────────────────────────────────────────────── */
  const checkIdentifierAbort = useRef<AbortController | null>(null);

  /* ── Magic-link auto-verify on page load ─────────────────────────────── */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const magic = params.get("magic_token");
    if (!magic) return;
    setLoading(true);
    api.magicLinkVerify({ token: magic })
      .then(async (res: unknown) => {
        const r = res as AuthResponse;
        if (!r?.token) return;
        await doLogin(r);
        window.history.replaceState({}, "", window.location.pathname);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Magic link login failed");
        window.history.replaceState({}, "", window.location.pathname);
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── OTP resend cooldown timer ───────────────────────────────────────── */
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setTimeout(() => {
      setResendCooldown(c => {
        const next = c - 1;
        if (next <= 0) {
          try { localStorage.removeItem("vendor_otp_cooldown_expiry"); } catch {}
        }
        return next;
      });
    }, 1000);
    return () => clearTimeout(id);
  }, [resendCooldown]);

  const startCooldown = () => {
    const expiry = Date.now() + 60 * 1000;
    try { localStorage.setItem("vendor_otp_cooldown_expiry", String(expiry)); } catch {}
    setResendCooldown(60);
  };

  /* ── Restore cooldown from localStorage on mount ────────────────────── */
  useEffect(() => {
    try {
      const stored = localStorage.getItem("vendor_otp_cooldown_expiry");
      if (stored) {
        const remaining = Math.ceil((Number(stored) - Date.now()) / 1000);
        if (remaining > 0) setResendCooldown(remaining);
        else localStorage.removeItem("vendor_otp_cooldown_expiry");
      }
    } catch {}
  }, []);

  /* ── captcha helper ─────────────────────────────────────────────────── */
  const getCaptchaToken = async (action: string): Promise<string | undefined> => {
    if (!vendorAuth.captchaEnabled) return undefined;
    try { return await executeCaptcha(action, vendorAuth.captchaSiteKey); } catch { return undefined; }
  };

  /* ── Vendor role guard ───────────────────────────────────────────────── */
  const checkVendorRole = (res: AuthResponse): boolean => {
    if (res.requires2FA) return true;
    const raw = res.user?.roles ?? res.user?.role ?? "";
    const roles: string[] = Array.isArray(raw)
      ? (raw as string[])
      : String(raw).split(",").map((r: string) => r.trim()).filter(Boolean);
    if (roles.length > 0 && !roles.includes("vendor")) {
      setError(T("accessDeniedVendor"));
      return false;
    }
    const status = res.user?.status;
    if (status === "banned" || status === "suspended") {
      setError(T("accountSuspended") || "Your account has been suspended. Please contact support.");
      return false;
    }
    return true;
  };

  /* ── doLogin ─────────────────────────────────────────────────────────── */
  const doLogin = async (res: AuthResponse) => {
    if (!checkVendorRole(res)) return;
    if (res.requires2FA && res.tempToken) {
      setTotpTempToken(res.tempToken);
      setTotpUserId(res.userId || "");
      setStep("2fa");
      return;
    }
    if (res.pendingApproval) { setStep("pending"); return; }
    api.storeTokens(res.token, res.refreshToken);
    try {
      const profile = await api.getMe();
      login(res.token, profile, res.refreshToken);
    } catch (e: unknown) {
      api.clearTokens();
      setError(e instanceof Error ? e.message : "Failed to load vendor profile. Please try again.");
    }
  };

  /* ── checkIdentifier ─────────────────────────────────────────────────── */
  const checkIdentifier = useCallback(async () => {
    const id = identifier.trim();
    if (!id) { setError("Please enter your phone, email, or username"); return; }

    if (checkIdentifierAbort.current) checkIdentifierAbort.current.abort();
    checkIdentifierAbort.current = new AbortController();

    setLoading(true); clearError();
    try {
      const deviceId = getDeviceFingerprint();
      const data = await apiFetch("/auth/check-identifier", {
        method: "POST",
        body: JSON.stringify({ identifier: id, role: "vendor", deviceId }),
        signal: checkIdentifierAbort.current.signal,
      });

      if (data.action === "blocked" || data.isBanned) {
        setError("This account has been suspended. Please contact support.");
        setLoading(false); return;
      }
      if (data.action === "locked") {
        setError(`Account temporarily locked. Please try again in ${data.lockedMinutes} minute(s).`);
        setLoading(false); return;
      }
      if (data.action === "registration_closed") {
        setError("New registrations are currently closed. Please contact support.");
        setLoading(false); return;
      }
      if (data.action === "no_method") {
        setError("No login methods are currently available. Please contact support.");
        setLoading(false); return;
      }
      if (data.action === "force_google") {
        if (vendorAuth.google) { setMethod("google"); setStep("identifier"); }
        else setError("This account is linked to Google. Please sign in with Google.");
        setLoading(false); return;
      }
      if (data.action === "force_facebook") {
        if (vendorAuth.facebook) { setMethod("facebook"); setStep("identifier"); }
        else setError("This account is linked to Facebook. Please sign in with Facebook.");
        setLoading(false); return;
      }
      if (data.action === "register") {
        const looksLikePhone = /^[\d\s\-+()]{7,15}$/.test(id);
        const phoneParam = looksLikePhone ? `?phone=${encodeURIComponent(canonicalizePhone(id))}` : "";
        navigate(`/register${phoneParam}`);
        setLoading(false); return;
      }
      if (data.action === "send_phone_otp") {
        const normalized = canonicalizePhone(id);
        setPhone(normalized);
        setPhoneLocal(id);
        setMethod("phone");
        setLoading(false);
        setTimeout(() => sendPhoneOtpDirect(normalized), 0);
        return;
      }
      if (data.action === "send_email_otp") {
        setEmail(id);
        setMethod("email");
        setLoading(false);
        setTimeout(() => sendEmailOtpDirect(id), 0);
        return;
      }
      if (data.action === "login_password") {
        setUsername(id);
        setMethod("username");
        setStep("password");
        setLoading(false); return;
      }
      /* Fallback — treat as username/password */
      setMethod("username");
      setUsername(id);
      setStep("password");
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Check failed. Please try again.");
    }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identifier]);

  /* ── Send OTP ────────────────────────────────────────────────────────── */
  const sendPhoneOtpDirect = async (ph: string, channel?: string) => {
    setLoading(true); clearError();
    try {
      const res = await api.sendOtp(ph, channel) as { otp?: string; otpRequired?: boolean; token?: string; refreshToken?: string; channel?: string; fallbackChannels?: string[] };
      if (res.otpRequired === false) {
        if (res.token) { await doLogin(res as AuthResponse); setLoading(false); return; }
        setLoading(false); return;
      }
      setDevOtp(res.otp || "");
      setOtpChannel(res.channel || "sms");
      setFallbackChannels(res.fallbackChannels || []);
      setStep("otp");
      startCooldown();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed to send OTP"); }
    setLoading(false);
  };

  const sendEmailOtpDirect = async (em: string) => {
    setLoading(true); clearError();
    try {
      const res = await api.sendEmailOtp(em) as { otp?: string };
      setEmailDevOtp(res.otp || "");
      setOtpChannel("email");
      setFallbackChannels([]);
      setStep("otp");
      startCooldown();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed to send OTP"); }
    setLoading(false);
  };

  /* ── Verify OTP ──────────────────────────────────────────────────────── */
  const verifyPhoneOtp = async (otp: string) => {
    setLoading(true); clearError();
    try {
      const deviceId = getDeviceFingerprint();
      const res = await api.verifyOtp(phone, otp, deviceId, "vendor") as AuthResponse;
      await doLogin(res);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "OTP verification failed"); }
    setLoading(false);
  };

  const verifyEmailOtp = async (otp: string) => {
    setLoading(true); clearError();
    try {
      const deviceId = getDeviceFingerprint();
      const res = await api.verifyEmailOtp(email, otp, deviceId) as AuthResponse;
      await doLogin(res);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "OTP verification failed"); }
    setLoading(false);
  };

  const handleOtpComplete = (otp: string) => {
    if (method === "email") verifyEmailOtp(otp);
    else verifyPhoneOtp(otp);
  };

  const handleOtpResend = () => {
    if (method === "email") sendEmailOtpDirect(email);
    else sendPhoneOtpDirect(phone, undefined);
  };

  /* ── Password login ──────────────────────────────────────────────────── */
  const loginWithPassword = async () => {
    if (!password) { setError("Please enter your password"); return; }
    setLoading(true); clearError();
    try {
      const deviceId = getDeviceFingerprint();
      const captchaToken = await getCaptchaToken("vendor_login_password");
      const res = await api.loginUsername(username || identifier, password, deviceId, captchaToken) as AuthResponse;
      await doLogin(res);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Login failed. Please check your credentials."); }
    setLoading(false);
  };

  /* ── 2FA verify ──────────────────────────────────────────────────────── */
  const verify2FA = async (code: string) => {
    setLoading(true); clearError();
    try {
      const res = await apiFetch("/auth/verify-2fa", {
        method: "POST",
        body: JSON.stringify({ tempToken: totpTempToken, totpCode: code, userId: totpUserId }),
      }) as AuthResponse;
      await doLogin(res);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "2FA verification failed"); }
    setLoading(false);
  };

  /* ── Social login handlers (SocialButtons callbacks) ─────────────────── */
  /* These accept a Google ID token (idToken) or Facebook access token from
     the OAuth flow and forward them to the vendor API for server-side validation.
     The token is acquired via a Google / Facebook SDK popup triggered externally;
     for now we store the in-progress token in a ref so the callback can read it. */
  const _pendingSocialToken = useRef<string>("");

  const submitGoogleToken = async (idToken: string) => {
    setLoading(true); clearError();
    try {
      const res = await api.socialGoogle({ idToken }) as AuthResponse;
      await doLogin(res);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Google sign-in failed"); }
    setLoading(false);
  };

  const submitFacebookToken = async (accessToken: string) => {
    setLoading(true); clearError();
    try {
      const res = await api.socialFacebook({ accessToken }) as AuthResponse;
      await doLogin(res);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Facebook sign-in failed"); }
    setLoading(false);
  };

  /* SocialButtons callbacks — () => void — trigger the OAuth popup and then
     hand the acquired token to submitGoogleToken / submitFacebookToken. */
  const handleGoogleClick = () => {
    /* Use Google Identity Services one-tap / popup if the SDK is loaded */
    const win = window as unknown as Record<string, unknown>;
    const g = win.google as { accounts?: { id?: { initialize?: (opts: Record<string, unknown>) => void; prompt?: () => void } } } | undefined;
    if (g?.accounts?.id?.initialize && g?.accounts?.id?.prompt) {
      g.accounts.id.initialize({
        client_id: "",     // configured via VITE_GOOGLE_CLIENT_ID at build time
        callback: (resp: Record<string, unknown>) => {
          if (typeof resp.credential === "string") submitGoogleToken(resp.credential);
        },
      });
      g.accounts.id.prompt();
    } else {
      setError("Google sign-in is not yet configured for this environment.");
    }
  };

  const handleFacebookClick = () => {
    const win2 = window as unknown as Record<string, unknown>;
    const fb = win2.FB as { login?: (cb: (resp: Record<string, unknown>) => void, opts: Record<string, unknown>) => void } | undefined;
    if (fb?.login) {
      fb.login((resp: Record<string, unknown>) => {
        const token = (resp as { authResponse?: { accessToken?: string } })?.authResponse?.accessToken;
        if (token) submitFacebookToken(token);
      }, { scope: "public_profile,email" });
    } else {
      setError("Facebook sign-in is not yet configured for this environment.");
    }
  };

  void _pendingSocialToken; /* suppress unused warning */

  /* ── Magic link ──────────────────────────────────────────────────────── */
  const [magicEmail, setMagicEmail] = useState("");
  const [magicSent, setMagicSent]   = useState(false);

  const sendMagicLink = async () => {
    if (!magicEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(magicEmail)) {
      setError("Enter a valid email address"); return;
    }
    setLoading(true); clearError();
    try {
      await api.magicLinkSend(magicEmail);
      setMagicSent(true);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed to send magic link"); }
    setLoading(false);
  };

  /* ── Forgot password overlay ─────────────────────────────────────────── */
  const handleForgotRequest = async () => {
    if (!forgotId.trim()) { setForgotErr("Enter your phone, email, or username"); return; }
    setForgotBusy(true); setForgotErr("");
    try {
      await api.forgotPassword({ identifier: forgotId.trim() });
      setForgotStep("forgot-otp");
    } catch (e: unknown) { setForgotErr(e instanceof Error ? e.message : "Failed to send code"); }
    setForgotBusy(false);
  };

  const handleForgotOtpComplete = (otp: string) => {
    setForgotOtp(otp);
    setForgotStep("forgot-reset");
  };

  const handleForgotResend = async () => {
    try { await api.forgotPassword({ identifier: forgotId.trim() }); } catch {}
  };

  const handleForgotReset = async () => {
    if (forgotPwd.length < 8) { setForgotErr("Password must be at least 8 characters"); return; }
    if (forgotPwd !== forgotCfm) { setForgotErr("Passwords don't match"); return; }
    setForgotBusy(true); setForgotErr("");
    try {
      await api.resetPassword({ identifier: forgotId, otp: forgotOtp, newPassword: forgotPwd });
      setForgotStep("forgot-done");
    } catch (e: unknown) { setForgotErr(e instanceof Error ? e.message : "Failed to reset password"); }
    setForgotBusy(false);
  };

  const closeForgot = () => {
    setForgotStep(null);
    setForgotId(""); setForgotOtp(""); setForgotPwd(""); setForgotCfm(""); setForgotErr("");
  };

  /* ── Phone input handler (used for phone confirmation sub-step) ───────── */
  const handlePhoneChange = (_e164: string, local: string, _country: Country) => {
    setPhone(_e164);
    setPhoneLocal(local);
  };

  /* ── Shared CSS ──────────────────────────────────────────────────────── */
  const INPUT_CLS = "w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-orange-400 transition-all";

  /* ── Forgot password overlay (takes full screen) ─────────────────────── */
  if (forgotStep) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8">
          <button onClick={closeForgot} className="text-sm text-gray-500 hover:text-gray-700 mb-6 flex items-center gap-1">
            ← Back to login
          </button>

          {forgotStep === "forgot" && (
            <>
              <h2 className="text-2xl font-extrabold text-gray-800 mb-1">Reset Password</h2>
              <p className="text-sm text-gray-500 mb-6">Enter your phone, email, or username</p>
              {forgotErr && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm mb-4">{forgotErr}</div>}
              <input type="text" value={forgotId} onChange={e => setForgotId(e.target.value)}
                placeholder="+923001234567 · email · username"
                className={`${INPUT_CLS} mb-4`} autoFocus
                onKeyDown={e => e.key === "Enter" && handleForgotRequest()} />
              <button onClick={handleForgotRequest} disabled={forgotBusy}
                className="w-full h-12 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-xl text-sm disabled:opacity-50">
                {forgotBusy ? "Sending…" : "Send Reset Code"}
              </button>
            </>
          )}

          {forgotStep === "forgot-otp" && (
            <>
              <h2 className="text-2xl font-extrabold text-gray-800 mb-1">Enter Reset Code</h2>
              <p className="text-sm text-gray-500 mb-6">A code was sent to <strong>{forgotId}</strong></p>
              {forgotErr && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm mb-4">{forgotErr}</div>}
              <OtpInput onComplete={handleForgotOtpComplete} onResend={handleForgotResend} resendCooldownSeconds={60} autoSubmit />
            </>
          )}

          {forgotStep === "forgot-reset" && (
            <>
              <h2 className="text-2xl font-extrabold text-gray-800 mb-1">Set New Password</h2>
              <p className="text-sm text-gray-500 mb-6">Choose a strong password for your account</p>
              {forgotErr && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm mb-4">{forgotErr}</div>}
              <div className="mb-3">
                <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">New Password</label>
                <PasswordInput value={forgotPwd} onChange={v => setForgotPwd(v)} showStrength placeholder="Min 8 chars" autoComplete="new-password" disabled={forgotBusy} />
              </div>
              <div className="mb-5">
                <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Confirm Password</label>
                <PasswordInput value={forgotCfm} onChange={v => setForgotCfm(v)} placeholder="Re-enter password" autoComplete="new-password" disabled={forgotBusy} />
              </div>
              <button onClick={handleForgotReset} disabled={forgotBusy}
                className="w-full h-12 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-xl text-sm disabled:opacity-50">
                {forgotBusy ? "Resetting…" : "Reset Password"}
              </button>
            </>
          )}

          {forgotStep === "forgot-done" && (
            <div className="text-center py-6">
              <div className="text-5xl mb-4">✅</div>
              <h2 className="text-2xl font-extrabold text-gray-800 mb-2">Password Reset!</h2>
              <p className="text-sm text-gray-500 mb-6">Your password has been updated. You can now log in with your new password.</p>
              <button onClick={closeForgot}
                className="w-full h-12 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-xl text-sm">
                Back to Login
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── Pending approval screen ─────────────────────────────────────────── */
  if (step === "pending") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-800 to-amber-700 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl">
          <div className="text-5xl mb-4">⏳</div>
          <h2 className="text-2xl font-extrabold text-gray-800 mb-3">Application Pending</h2>
          <p className="text-gray-500 text-sm mb-5">Your vendor application is under review. You'll be notified once approved.</p>
          {(config.platform.supportPhone || config.platform.supportEmail) && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 mb-5 text-left">
              <p className="text-xs font-bold text-gray-400 uppercase mb-1">Need help?</p>
              {config.platform.supportPhone && <p className="text-sm font-bold text-gray-700">{config.platform.supportPhone}</p>}
              {config.platform.supportEmail && <p className="text-xs text-gray-500">{config.platform.supportEmail}</p>}
            </div>
          )}
          <button onClick={() => setStep("identifier")}
            className="w-full h-12 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-2xl text-sm">
            Try a different account
          </button>
        </div>
      </div>
    );
  }

  /* ── Main layout ─────────────────────────────────────────────────────── */
  const showSocial = step === "identifier" && (vendorAuth.google || vendorAuth.facebook);

  return (
    <div className="min-h-screen flex">
      {/* ── Left branding panel ──────────────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[46%] flex-col bg-gradient-to-br from-orange-600 to-orange-500 text-white p-10 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(circle at 80% 20%, #fff 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-10">
            <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-2xl backdrop-blur-sm">🏪</div>
            <div>
              <div className="font-extrabold text-lg leading-none">{appName}</div>
              <div className="text-orange-200 text-xs font-semibold uppercase tracking-wide">Vendor Portal</div>
            </div>
          </div>
          <h1 className="text-4xl font-black leading-tight mb-4">
            Grow your<br />business with<br />
            <span className="text-orange-200">{appName}</span>
          </h1>
          <p className="text-orange-100 text-base mb-10 leading-relaxed">
            Manage orders, products, and earnings — all from one powerful vendor dashboard.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {FEATURES.map(f => (
              <div key={f.titleKey} className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/20">
                <div className="text-2xl mb-2">{f.icon}</div>
                <div className="font-bold text-sm leading-none mb-1">{T(f.titleKey)}</div>
                <div className="text-orange-200 text-xs leading-tight">{T(f.descKey)}</div>
              </div>
            ))}
          </div>
          <div className="mt-10 bg-white/10 rounded-2xl p-4 border border-white/20">
            <div className="text-3xl font-black text-orange-200 mb-1">Keep {vendorEarningsPct}%</div>
            <div className="text-sm text-orange-100">of every sale — transparent, fair commission</div>
          </div>
        </div>
      </div>

      {/* ── Right: login form ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center bg-white px-6 py-10">
        <div className="w-full max-w-md">
          {/* Mobile header */}
          <div className="lg:hidden text-center mb-8">
            <div className="text-4xl mb-2">🏪</div>
            <h1 className="text-2xl font-extrabold text-gray-800">{appName}</h1>
            <p className="text-gray-500 text-sm">Vendor Portal</p>
          </div>

          {/* Form card */}
          <div className="bg-white rounded-3xl p-8 shadow-xl border border-gray-100">

            {/* ── STEP: identifier ────────────────────────────────────────── */}
            {step === "identifier" && (
              <>
                <h2 className="text-2xl font-extrabold text-gray-800 mb-1">Welcome back 👋</h2>
                <p className="text-sm text-gray-500 mb-6">Sign in to your vendor account</p>

                {error && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">{error}</div>
                )}

                {/* Multi-method identifier input */}
                <div className="mb-4">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5 block">Phone / Email / Username</label>
                  {vendorAuth.phoneOtp && !vendorAuth.emailOtp ? (
                    /* Phone-only: use PhoneInput component */
                    <PhoneInput
                      value={phoneLocal}
                      onChange={handlePhoneChange}
                      disabled={loading}
                    />
                  ) : (
                    /* Multi-method: generic text input */
                    <input
                      type="text"
                      value={identifier}
                      onChange={e => { setIdentifier(e.target.value); clearError(); }}
                      onKeyDown={e => e.key === "Enter" && checkIdentifier()}
                      placeholder="+92300… · you@email.com · username"
                      className={INPUT_CLS}
                      autoFocus
                      autoCapitalize="none"
                      autoCorrect="off"
                    />
                  )}
                </div>

                {/* Social buttons (if enabled) */}
                {showSocial && (
                  <div className="mb-4">
                    <SocialButtons
                      onGoogle={vendorAuth.google ? handleGoogleClick : undefined}
                      onFacebook={vendorAuth.facebook ? handleFacebookClick : undefined}
                      disabled={loading}
                    />
                  </div>
                )}

                {/* Magic link option */}
                {vendorAuth.magicLink && (
                  <div className="mb-4 border-t border-gray-100 pt-4">
                    {!magicSent ? (
                      <>
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5 block">Or sign in with magic link</label>
                        <div className="flex gap-2">
                          <input type="email" value={magicEmail} onChange={e => setMagicEmail(e.target.value)}
                            placeholder="your@email.com" className={`${INPUT_CLS} flex-1`} autoCapitalize="none" />
                          <button onClick={sendMagicLink} disabled={loading}
                            className="px-4 h-12 bg-orange-100 hover:bg-orange-200 text-orange-700 font-bold rounded-xl text-sm disabled:opacity-50">
                            Send
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-sm text-orange-700">
                        ✅ Magic link sent to <strong>{magicEmail}</strong>. Check your inbox.
                      </div>
                    )}
                  </div>
                )}

                <button
                  onClick={vendorAuth.phoneOtp && !vendorAuth.emailOtp
                    ? () => sendPhoneOtpDirect(phone)
                    : checkIdentifier}
                  disabled={loading}
                  className="w-full h-12 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-2xl disabled:opacity-60 flex items-center justify-center gap-2 text-sm">
                  {loading ? <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />Please wait...</> : "Continue →"}
                </button>

                <button onClick={() => navigate("/register")}
                  className="w-full mt-3 text-sm text-gray-400 hover:text-orange-600 font-medium py-2">
                  New here? Create a vendor account
                </button>

                <div className="text-center mt-2">
                  <button onClick={() => setForgotStep("forgot")} className="text-sm text-orange-600 hover:text-orange-700 font-semibold">
                    Forgot your password?
                  </button>
                </div>
              </>
            )}

            {/* ── STEP: otp ───────────────────────────────────────────────── */}
            {step === "otp" && (
              <>
                <button onClick={() => { setStep("identifier"); clearError(); }}
                  className="text-orange-600 text-sm font-bold mb-4 flex items-center gap-1.5 hover:text-orange-700">← Back</button>
                <h2 className="text-2xl font-extrabold text-gray-800 mb-1">{T("enterOtp")}</h2>
                <p className="text-sm text-gray-500 mb-1">
                  {T("sentTo_")}{" "}
                  <strong className="text-gray-700">{method === "email" ? email : phone}</strong>
                  {otpChannel === "whatsapp" && <span className="ml-1 text-green-600 text-xs">(WhatsApp)</span>}
                </p>

                {import.meta.env.DEV && (devOtp || emailDevOtp) && (
                  <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2 mb-3">
                    <p className="text-xs text-orange-600 font-bold uppercase tracking-wide mb-0.5">{T("devOtp")}</p>
                    <p className="text-orange-700 font-extrabold text-xl tracking-[0.4em]">{devOtp || emailDevOtp}</p>
                  </div>
                )}

                {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">{error}</div>}

                <OtpInput
                  length={6}
                  onComplete={handleOtpComplete}
                  onResend={handleOtpResend}
                  resendCooldownSeconds={resendCooldown}
                  disabled={loading}
                  label="Enter your 6-digit code"
                  autoSubmit
                />

                {/* Channel fallback (WhatsApp / voice) */}
                {fallbackChannels.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {fallbackChannels.includes("whatsapp") && (
                      <button onClick={() => sendPhoneOtpDirect(phone, "whatsapp")} disabled={loading || resendCooldown > 0}
                        className="text-xs text-green-700 hover:text-green-800 font-semibold disabled:opacity-40">
                        Resend via WhatsApp
                      </button>
                    )}
                    {fallbackChannels.includes("voice") && (
                      <button onClick={() => sendPhoneOtpDirect(phone, "voice")} disabled={loading || resendCooldown > 0}
                        className="text-xs text-blue-700 hover:text-blue-800 font-semibold disabled:opacity-40">
                        Call me instead
                      </button>
                    )}
                  </div>
                )}
              </>
            )}

            {/* ── STEP: password ──────────────────────────────────────────── */}
            {step === "password" && (
              <>
                <button onClick={() => { setStep("identifier"); clearError(); setPassword(""); }}
                  className="text-orange-600 text-sm font-bold mb-4 flex items-center gap-1.5 hover:text-orange-700">← Back</button>
                <h2 className="text-2xl font-extrabold text-gray-800 mb-1">Enter Password</h2>
                <p className="text-sm text-gray-500 mb-4">Signing in as <strong className="text-gray-700">{username || identifier}</strong></p>

                {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">{error}</div>}

                <div className="mb-4">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5 block">Password</label>
                  <PasswordInput
                    value={password}
                    onChange={v => { setPassword(v); clearError(); }}
                    placeholder="Your password"
                    autoComplete="current-password"
                    disabled={loading}
                  />
                </div>

                <button onClick={loginWithPassword} disabled={loading || !password}
                  className="w-full h-12 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-2xl disabled:opacity-60 flex items-center justify-center gap-2 text-sm">
                  {loading ? <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />Signing in...</> : "Sign In →"}
                </button>

                <div className="text-center mt-3">
                  <button onClick={() => setForgotStep("forgot")} className="text-sm text-orange-600 hover:text-orange-700 font-semibold">
                    Forgot your password?
                  </button>
                </div>
              </>
            )}

            {/* ── STEP: 2FA / TOTP ────────────────────────────────────────── */}
            {step === "2fa" && (
              <>
                <h2 className="text-2xl font-extrabold text-gray-800 mb-1">Two-Factor Auth</h2>
                <p className="text-sm text-gray-500 mb-4">Enter the 6-digit code from your authenticator app</p>

                {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">{error}</div>}

                <OtpInput
                  length={6}
                  onComplete={verify2FA}
                  disabled={loading}
                  label="Authenticator code"
                  autoSubmit
                />

                <button onClick={() => { setStep("identifier"); clearError(); setTotpTempToken(""); }}
                  className="w-full mt-4 text-sm text-gray-400 hover:text-orange-600 font-medium py-2">
                  ← Use a different account
                </button>
              </>
            )}
          </div>

          <p className="text-center text-xs text-gray-400 mt-6">
            Support: {config.platform.supportPhone || "03005000000"}<br />
            Only verified vendors can access this portal
          </p>
        </div>
      </div>
    </div>
  );
}

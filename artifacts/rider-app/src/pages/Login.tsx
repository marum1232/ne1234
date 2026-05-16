import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth, type AuthUser } from "../lib/auth";
import { api, apiFetch } from "../lib/api";
import { createLogger } from "@/lib/logger";
const log = createLogger("[Login]");
import { usePlatformConfig } from "../lib/useConfig";
import { useRiderAuthConfig } from "../lib/AuthConfigContext";
import { useLanguage } from "../lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { TwoFactorVerify, MagicLinkSender, executeCaptcha, loadGoogleGSIToken, loadFacebookAccessToken, formatPhoneForApi, canonicalizePhone } from "@workspace/auth-utils";
import {
  Phone, Mail, User, Bike, Clock, Lightbulb, Eye, EyeOff,
  ArrowLeft, Loader2, Shield, Wrench, AlertCircle, X, Fingerprint,
} from "lucide-react";
import { useOTPBypass } from "../hooks/useOTPBypass";
import {
  isBiometricAvailable,
  isBiometricEnabled,
  setBiometricEnabled as saveBiometricEnabled,
  storeBiometricToken,
  getBiometricToken,
  verifyBiometric,
} from "../lib/biometric";

type LoginMethod = "phone" | "email" | "username" | "google" | "facebook" | "magicLink";
type Step = "continue" | "input" | "otp" | "pending" | "rejected" | "2fa";

type AuthResponse = {
  token: string; refreshToken?: string;
  pendingApproval?: boolean;
  requires2FA?: boolean;
  tempToken?: string; userId?: string;
  user?: { roles?: string; role?: string; name?: string; email?: string };
  isNewUser?: boolean; needsProfileCompletion?: boolean;
};

function getDeviceFingerprint(): string {
  const stored = sessionStorage.getItem("_dfp");
  if (stored) return stored;
  const nav = window.navigator;
  const raw = [nav.userAgent, nav.language, screen.width, screen.height, screen.colorDepth, new Date().getTimezoneOffset()].join("|");
  let hash = 0;
  for (let i = 0; i < raw.length; i++) { hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0; }
  const id = "web_" + Math.abs(hash).toString(36);
  sessionStorage.setItem("_dfp", id);
  return id;
}

async function getCaptchaToken(enabled: boolean, siteKey: string | undefined, action: string): Promise<string | undefined> {
  if (!enabled) return undefined;
  try {
    return await executeCaptcha(action, siteKey);
  } catch {
    return undefined;
  }
}

/* withRetry: 1 initial attempt + maxRetries retries with exponential backoff.
   Default: 4 total attempts, delays 1s → 2s → 4s before each retry.
   Only retries transient failures — aborts and 4xx client errors are permanent
   and must never be retried (a wrong OTP must not be re-submitted automatically). */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, baseDelayMs = 1000): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e: unknown) {
      lastErr = e;
      const isAbort = e instanceof Error && e.name === "AbortError";
      const status = (e as { status?: number })?.status;
      const is4xx = typeof status === "number" && status >= 400 && status < 500;
      if (isAbort || is4xx || attempt >= maxRetries) break;
      await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, attempt)));
    }
  }
  throw lastErr;
}

export default function Login() {
  const { login, setTwoFactorPending: setGlobalTwoFaPending } = useAuth();
  /* A7: Need direct access to clear cached query data before storing new
     tokens after 2FA. Imported here so finalize2fa can purge the previous
     user's cache atomically. */
  const queryClient = useQueryClient();
  const { config } = usePlatformConfig();
  const auth = useRiderAuthConfig();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const appName = config.platform.appName;
  const captchaSiteKey = auth.captchaSiteKey ?? config.auth?.captchaSiteKey;
  const googleClientId = auth.googleClientId ?? config.auth?.googleClientId;
  const facebookAppId = auth.facebookAppId ?? config.auth?.facebookAppId;
  const phoneHint = config.regional?.phoneHint ?? "03XXXXXXXXX";
  const isValidPhone = (() => {
    try {
      if (config.regional?.phoneFormat) {
        const re = new RegExp(config.regional.phoneFormat);
        return (p: string) => re.test(p);
      }
    } catch { /* invalid regex — fall through to hardcoded regex */ }
    return (p: string) => /^03\d{9}$/.test(p);
  })();
  const [, navigate] = useLocation();

  /* authMode from platform_settings — in EMAIL-only mode, hide phone OTP */
  const enabledMethods: LoginMethod[] = [];
  if (auth.phoneEnabled && auth.authMode !== "EMAIL") enabledMethods.push("phone");
  if (auth.emailEnabled) enabledMethods.push("email");
  if (auth.usernamePassword) enabledMethods.push("username");

  /* When only one primary method is available, skip the identifier picker and
     go straight to that method's input screen. */
  const singleMethodMode = enabledMethods.length === 1;

  const defaultMethod = enabledMethods[0] ?? (auth.googleEnabled ? "google" : auth.facebookEnabled ? "facebook" : auth.magicLinkEnabled ? "magicLink" : "phone");
  const [method, setMethod] = useState<LoginMethod>(defaultMethod);
  const [step, setStep] = useState<Step>(singleMethodMode ? "input" : "continue");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>("");

  const [identifier, setIdentifier] = useState("");
  const [otpChannel, setOtpChannel] = useState("");
  const [fallbackChannels, setFallbackChannels] = useState<string[]>([]);
  const checkIdentifierAbort = useRef<AbortController | null>(null);

  const [phone, setPhone] = useState("");
  const { bypassActive: otpBypassActive, bypassMessage: otpBypassMessage, remainingSeconds: bypassRemainingSeconds } = useOTPBypass(
    method === "phone" && phone.length >= 10 ? formatPhoneForApi(phone) : undefined
  );

  /* ── Biometric auth state ── */
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabledState] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [showBiometricPrompt, setShowBiometricPrompt] = useState(false);
  const [pendingLoginData, setPendingLoginData] = useState<{ token: string; refreshToken?: string; profile: AuthUser } | null>(null);

  useEffect(() => {
    isBiometricAvailable().then(available => {
      setBiometricAvailable(available);
      if (available) isBiometricEnabled().then(setBiometricEnabledState);
    });
  }, []);

  const handleBiometricLogin = async () => {
    setBiometricLoading(true);
    try {
      const ok = await verifyBiometric();
      if (!ok) { setBiometricLoading(false); return; }
      const storedToken = await getBiometricToken();
      if (!storedToken) {
        setError("Biometric session expired. Please log in with your credentials.");
        await saveBiometricEnabled(false);
        setBiometricEnabledState(false);
        setBiometricLoading(false);
        return;
      }
      /* Use stored refresh token to obtain a fresh access token */
      const res = await fetch(`${window.location.origin}/api/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: storedToken }),
      });
      if (!res.ok) {
        setError("Biometric session expired. Please log in with your credentials.");
        await saveBiometricEnabled(false);
        setBiometricEnabledState(false);
        setBiometricLoading(false);
        return;
      }
      const data = await res.json();
      await doLogin({ token: data.token, refreshToken: data.refreshToken ?? storedToken });
    } catch {
      setError("Biometric sign-in failed. Please use your credentials.");
    }
    setBiometricLoading(false);
  };

  const confirmBiometricEnrollment = async (enable: boolean) => {
    setShowBiometricPrompt(false);
    if (!pendingLoginData) return;
    const { token, refreshToken, profile } = pendingLoginData;
    setPendingLoginData(null);
    if (enable && refreshToken) {
      await saveBiometricEnabled(true);
      await storeBiometricToken(refreshToken);
      setBiometricEnabledState(true);
    }
    login(token, profile, refreshToken);
  };

  const [otp, setOtp] = useState("");
  const [devOtp, setDevOtp] = useState("");

  const [email, setEmail] = useState("");
  const [emailOtp, setEmailOtp] = useState("");
  const [emailDevOtp, setEmailDevOtp] = useState("");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loginRejectionReason, setLoginRejectionReason] = useState<string | null>(null);

  const [failedAttempts, setFailedAttempts] = useState(() => {
    try { return parseInt(sessionStorage.getItem("rider_login_attempts") || "0", 10) || 0; } catch { return 0; }
  });
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(() => {
    try {
      const stored = sessionStorage.getItem("rider_lockout_until");
      const val = stored ? parseInt(stored, 10) : null;
      return val && val > Date.now() ? val : null;
    } catch { return null; }
  });
  const [lockoutRemaining, setLockoutRemaining] = useState(() => {
    try {
      const stored = sessionStorage.getItem("rider_lockout_until");
      const val = stored ? parseInt(stored, 10) : null;
      if (val && val > Date.now()) return Math.ceil((val - Date.now()) / 1000);
      return 0;
    } catch { return 0; }
  });

  const [otpCooldown, setOtpCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [bypassBannerDismissed, setBypassBannerDismissed] = useState(false);

  const startCooldown = (sec = 60) => {
    setOtpCooldown(sec);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setOtpCooldown(prev => {
        if (prev <= 1) { if (cooldownRef.current) clearInterval(cooldownRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const [twoFaPending, setTwoFaPending] = useState<AuthResponse | null>(null);
  const [twoFaError, setTwoFaError] = useState("");
  const [twoFaLoading, setTwoFaLoading] = useState(false);

  const clearError = () => setError("");

  const checkIdentifier = async () => {
    const id = identifier.trim();
    if (!id) { setError("Please enter your phone, email, or username"); return; }

    /* Cancel any in-flight request from a previous attempt */
    if (checkIdentifierAbort.current) checkIdentifierAbort.current.abort();
    checkIdentifierAbort.current = new AbortController();

    setLoading(true); clearError();
    try {
      const data = await withRetry(() => apiFetch("/auth/check-identifier", {
        method: "POST",
        body: JSON.stringify({ identifier: id, role: "rider", deviceId: getDeviceFingerprint() }),
        signal: checkIdentifierAbort.current?.signal,
      }));

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
        const reason = (data.reason as string | undefined) || "all_disabled";
        const detail =
          reason === "phone_disabled"   ? "Phone OTP login is disabled for riders. Try email or username, or contact support." :
          reason === "email_disabled"   ? "Email OTP login is disabled for riders. Try phone or username, or contact support." :
          reason === "password_disabled"? "Username/password login is disabled for riders. Try phone or email OTP." :
          "No login methods are currently enabled for the rider app. Please contact support.";
        const supportPhone = config.platform.supportPhone ?? "";
        const supportEmail = config.platform.supportEmail ?? "";
        const contactLine =
          supportPhone || supportEmail
            ? `\nContact: ${[supportPhone, supportEmail].filter(Boolean).join(" / ")}`
            : "";
        setError(detail + contactLine);
        setLoading(false); return;
      }
      if (data.action === "register") {
        setLoading(false);
        navigate("/register");
        return;
      }
      if (data.action === "force_google") {
        if (auth.googleEnabled) {
          setMethod("google");
          setStep("input");
        } else {
          setError("This account is linked to Google. Please sign in with Google.");
        }
        setLoading(false); return;
      }
      if (data.action === "force_facebook") {
        if (auth.facebookEnabled) {
          setMethod("facebook");
          setStep("input");
        } else {
          setError("This account is linked to Facebook. Please sign in with Facebook.");
        }
        setLoading(false); return;
      }
      if (data.action === "send_phone_otp") {
        const normalized = canonicalizePhone(id);
        setPhone(normalized);
        setMethod("phone");
        setLoading(true);
        /* TOTP mode: skip SMS send, go directly to OTP input with authenticator prompt */
        if (auth.otpProvider === "google_authenticator") {
          setOtpChannel("totp");
          setFallbackChannels([]);
          setStep("otp");
          setLoading(false); return;
        }
        try {
          const captchaToken = await getCaptchaToken(auth.captchaEnabled, captchaSiteKey, "login_phone_otp");
          const r = await withRetry(() => api.sendOtp(formatPhoneForApi(normalized), captchaToken, undefined, checkIdentifierAbort.current?.signal ?? undefined));
          if (r.otpRequired === false) {
            if (r.token) { await doLogin(r as AuthResponse); setLoading(false); return; }
            setStep("otp");
            setBypassBannerDismissed(false);
            const bypass = await api.verifyOtp(formatPhoneForApi(normalized), "000000", getDeviceFingerprint());
            await doLogin(bypass);
            setLoading(false); return;
          }
          if (r.otp || r.devMode) setDevOtp(r.otp || "");
          setOtpChannel(r.channel || "sms");
          setFallbackChannels(r.fallbackChannels || []);
          setStep("otp");
          startCooldown(60);
        } catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed to send OTP"); setStep("input"); }
        setLoading(false); return;
      }
      if (data.action === "send_email_otp") {
        setEmail(id);
        setMethod("email");
        setStep("otp");
        setLoading(true);
        try {
          const captchaToken = await getCaptchaToken(auth.captchaEnabled, captchaSiteKey, "login_email_otp");
          const r = await withRetry(() => api.sendEmailOtp(id, captchaToken));
          if (r.otp || r.devMode) setEmailDevOtp(r.otp || "");
          setOtpChannel("email");
          setFallbackChannels([]);
          startCooldown(60);
        } catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed to send OTP"); setStep("input"); }
        setLoading(false); return;
      }
      setMethod("username");
      setUsername(id);
      setStep("input");
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Check failed. Please try again.");
    }
    setLoading(false);
  };

  /* A5 / S-Sec9: Magic-link verification.
     - Validate token format BEFORE calling backend (S-Sec9): reject anything
       outside the safe URL-token charset/length to avoid 10MB header surprises
       and weird control characters.
     - Use a useRef latch so the effect runs at most once, eliminating the
       stale-closure problem that occurred when doLogin captured pre-config
       defaults on a slow first render (the original deps `[login, navigate,
       setGlobalTwoFaPending]` did not cover doLogin / T / auth.lockoutEnabled). */
  const magicLinkRanRef = useRef(false);
  useEffect(() => {
    if (magicLinkRanRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const magicToken = params.get("magic_token");
    if (!magicToken) return;
    magicLinkRanRef.current = true;
    if (!/^[A-Za-z0-9._-]{16,512}$/.test(magicToken)) {
      setError(T("loginFailed"));
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
    setLoading(true);
    api.magicLinkVerify({ token: magicToken })
      .then(async (res: AuthResponse) => {
        await doLogin(res);
        window.history.replaceState({}, "", window.location.pathname);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : T("loginFailed"));
        window.history.replaceState({}, "", window.location.pathname);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!lockoutUntil) return;
    const interval = setInterval(() => {
      const rem = Math.max(0, Math.ceil((lockoutUntil - Date.now()) / 1000));
      setLockoutRemaining(rem);
      if (rem <= 0) {
        setLockoutUntil(null);
        setFailedAttempts(0);
        try { sessionStorage.removeItem("rider_lockout_until"); sessionStorage.removeItem("rider_login_attempts"); } catch (ssErr) {
            log.warn("Could not clear lockout keys from sessionStorage:", ssErr);
          }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutUntil]);

  const isLockedOut = lockoutUntil !== null && lockoutRemaining > 0;

  const checkRiderRole = (res: AuthResponse): boolean => {
    const roles = (res.user?.roles || res.user?.role || "").split(",").map((r: string) => r.trim());
    if (!roles.includes("rider")) {
      /* A9: Revoke server-side BEFORE clearing local tokens. We deliberately
         await api.logout() (which uses the just-stored bearer to authenticate
         the revocation, then clearTokens() in its finally). Errors are
         logged in dev but never surfaced — the local clearTokens has run
         either way, so the rider is signed out client-side regardless. */
      api.storeTokens(res.token, res.refreshToken);
      void api.logout(res.refreshToken).catch((err: Error) => {
        log.warn("Server logout for non-rider failed:", err.message);
      });
      setError(T("accessDenied"));
      return false;
    }
    return true;
  };

  const doLogin = async (res: AuthResponse) => {
    if (res.requires2FA) {
      setTwoFaPending(res);
      setStep("2fa");
      setGlobalTwoFaPending(true);
      return;
    }
    if (!checkRiderRole(res)) return;
    if (res.pendingApproval) { setStep("pending"); return; }
    api.storeTokens(res.token, res.refreshToken);
    /* Fetch full profile. If it fails (e.g. brief network blip), clear the tokens
       and show an error — we do NOT proceed with a structurally invalid user object.
       This avoids both an unsafe cast AND downstream undefined-access crashes. The
       error is set directly (not via handleAuthError) so it cannot inflate the lockout
       counter, which should only count credential failures, not profile-fetch failures. */
    let profile: AuthUser;
    try {
      profile = await api.getMe() as AuthUser;
    } catch (fetchErr: unknown) {
      api.clearTokens();
      const msg = fetchErr instanceof Error ? fetchErr.message : T("loginFailed");
      setError(`${T("loginFailed")} (${msg})`);
      return;
    }
    /* Offer biometric enrollment on first successful login on a capable device */
    const bioAvail = await isBiometricAvailable();
    if (bioAvail && res.refreshToken && !(await isBiometricEnabled())) {
      setPendingLoginData({ token: res.token, refreshToken: res.refreshToken, profile });
      setShowBiometricPrompt(true);
      return;
    }
    login(res.token, profile, res.refreshToken);
  };

  const handleAuthError = (e: unknown) => {
    const errAny = e as Record<string, unknown> | null | undefined;
    /* Detected account rejected during login — route to rejection screen.
       Backend sends code:"APPROVAL_REJECTED" + approvalStatus:"rejected" on 403. */
    if (errAny && (errAny.code === "APPROVAL_REJECTED" || errAny.approvalStatus === "rejected")) {
      setLoginRejectionReason((errAny.rejectionReason as string | null | undefined) ?? null);
      setStep("rejected");
      return;
    }
    const msg = e instanceof Error ? e.message : T("loginFailed");
    if (auth.lockoutEnabled) {
      const isLockError = msg.toLowerCase().includes("locked") || msg.toLowerCase().includes("too many");
      if (isLockError) {
        setLockoutUntil(Date.now() + auth.lockoutDurationSec * 1000);
        setLockoutRemaining(auth.lockoutDurationSec);
        setError(T("accountLockedMsg"));
        return;
      }
      setFailedAttempts(prev => {
        const next = prev + 1;
        try { sessionStorage.setItem("rider_login_attempts", String(next)); } catch (ssErr) {
          log.warn("Could not persist login attempt count to sessionStorage:", ssErr);
        }
        if (next >= auth.lockoutMaxAttempts) {
          const until = Date.now() + auth.lockoutDurationSec * 1000;
          setLockoutUntil(until);
          setLockoutRemaining(auth.lockoutDurationSec);
          try { sessionStorage.setItem("rider_lockout_until", String(until)); } catch (ssErr) {
            log.warn("Could not persist lockout expiry to sessionStorage — lockout state will not survive page refresh:", ssErr);
            /* Surface to user: lockout is applied now but won't persist across tab reloads */
            setError(T("accountLockedMsg"));
          }
        }
        return next;
      });
    }
    setError(msg);
  };

  const switchToMethod = (m: LoginMethod) => {
    setMethod(m);
    setStep("input");
    setError("");
    setOtp(""); setEmailOtp(""); setPassword("");
    setDevOtp(""); setEmailDevOtp("");
  };

  const [phoneFallbackEmail, setPhoneFallbackEmail] = useState("");
  const [showEmailFallback, setShowEmailFallback] = useState(false);

  const sendPhoneOtp = async (channel?: string) => {
    if (!phone || !isValidPhone(phone)) { setError(`${T("enterValidPhone")} (e.g. ${phoneHint})`); return; }
    /* TOTP mode: no SMS send — go directly to authenticator code entry */
    if (auth.otpProvider === "google_authenticator") {
      setOtpChannel("totp");
      setFallbackChannels([]);
      setStep("otp");
      return;
    }
    setLoading(true); clearError(); setShowEmailFallback(false);
    try {
      const captchaToken = await getCaptchaToken(auth.captchaEnabled, captchaSiteKey, "login_phone_otp");
      if (auth.captchaEnabled && !captchaToken) { setError(T("captchaRequired")); setLoading(false); return; }
      const res = await withRetry(() => api.sendOtp(formatPhoneForApi(phone), captchaToken, channel));
      if (res.otpRequired === false) {
        if (res.token) { await doLogin(res as AuthResponse); setLoading(false); return; }
        setStep("otp");
        setBypassBannerDismissed(false);
        const bypass = await api.verifyOtp(formatPhoneForApi(phone), "000000", getDeviceFingerprint());
        await doLogin(bypass);
        setLoading(false); return;
      }
      if (res.otp || res.devMode) setDevOtp(res.otp || "");
      setOtpChannel(res.channel || "sms");
      setFallbackChannels(res.fallbackChannels || []);
      setStep("otp");
      startCooldown(60);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : T("sendOtpFailed");
      setError(msg);
      if (auth.emailEnabled) setShowEmailFallback(true);
    }
    setLoading(false);
  };

  const switchToEmailFallback = async () => {
    if (!phoneFallbackEmail || !phoneFallbackEmail.includes("@")) { setError(T("enterValidEmail")); return; }
    setLoading(true); clearError(); setShowEmailFallback(false);
    try {
      const captchaToken = await getCaptchaToken(auth.captchaEnabled, captchaSiteKey, "login_email_otp");
      const res = await api.sendEmailOtp(phoneFallbackEmail, captchaToken);
      if (res.otp || res.devMode) setEmailDevOtp(res.otp || "");
      setEmail(phoneFallbackEmail);
      setMethod("email");
      setStep("otp");
    } catch (e: unknown) { setError(e instanceof Error ? e.message : T("sendOtpFailed")); }
    setLoading(false);
  };

  const verifyPhoneOtp = async () => {
    if (!otp || otp.length < 6) { setError(T("enterOtpDigits")); return; }
    setLoading(true); clearError();
    try {
      const captchaToken = await getCaptchaToken(auth.captchaEnabled, captchaSiteKey, "verify_phone_otp");
      if (auth.captchaEnabled && !captchaToken) { setError(T("captchaRequired")); setLoading(false); return; }
      const res = auth.otpProvider === "google_authenticator"
        ? await withRetry(() => api.verifyTotpCode(otp, formatPhoneForApi(phone), captchaToken))
        : await withRetry(() => api.verifyOtp(formatPhoneForApi(phone), otp, getDeviceFingerprint(), captchaToken));
      await doLogin(res);
    } catch (e: unknown) { handleAuthError(e); }
    setLoading(false);
  };

  const sendEmailOtpFn = async () => {
    if (!email || !email.includes("@")) { setError(T("enterValidEmail")); return; }
    setLoading(true); clearError();
    try {
      const captchaToken = await getCaptchaToken(auth.captchaEnabled, captchaSiteKey, "login_email_otp");
      if (auth.captchaEnabled && !captchaToken) { setError(T("captchaRequired")); setLoading(false); return; }
      const res = await withRetry(() => api.sendEmailOtp(email, captchaToken));
      if (res.otp || res.devMode) setEmailDevOtp(res.otp || "");
      if (res.channel === "console") {
        setError("Email OTP could not be sent — email delivery is not configured. Check server logs for the OTP (dev/staging only).");
        setLoading(false);
        return;
      }
      setOtpChannel("email");
      setFallbackChannels([]);
      setStep("otp");
      startCooldown(60);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : T("sendOtpFailed")); }
    setLoading(false);
  };

  const verifyEmailOtpFn = async () => {
    if (!emailOtp || emailOtp.length < 6) { setError(T("enterOtpDigits")); return; }
    setLoading(true); clearError();
    try {
      const captchaToken = await getCaptchaToken(auth.captchaEnabled, captchaSiteKey, "verify_email_otp");
      if (auth.captchaEnabled && !captchaToken) { setError(T("captchaRequired")); setLoading(false); return; }
      const res = await withRetry(() => api.verifyEmailOtp(email, emailOtp, getDeviceFingerprint(), captchaToken));
      await doLogin(res);
    } catch (e: unknown) { handleAuthError(e); }
    setLoading(false);
  };

  const loginUsername = async () => {
    if (!username || username.length < 3) { setError(T("enterUsername")); return; }
    if (!password || password.length < 6) { setError(T("enterPassword")); return; }
    setLoading(true); clearError();
    try {
      const captchaToken = await getCaptchaToken(auth.captchaEnabled, captchaSiteKey, "login_password");
      if (auth.captchaEnabled && !captchaToken) { setError(T("captchaRequired")); setLoading(false); return; }
      const res = await api.loginUsername(username, password, captchaToken, getDeviceFingerprint());
      await doLogin(res);
    } catch (e: unknown) { handleAuthError(e); }
    setLoading(false);
  };

  const handleSubmit = () => {
    if (isLockedOut) return;
    if (method === "phone") { step === "input" ? sendPhoneOtp() : verifyPhoneOtp(); }
    else if (method === "email") { step === "input" ? sendEmailOtpFn() : verifyEmailOtpFn(); }
    else if (method === "username") loginUsername();
  };

  const selectMethod = (m: LoginMethod) => {
    setMethod(m); setStep("input"); clearError();
    setOtp(""); setEmailOtp(""); setDevOtp(""); setEmailDevOtp("");
  };

  const handleMagicLinkSend = useCallback(async (emailAddr: string) => {
    await api.sendMagicLink(emailAddr);
  }, []);

  const handleSocialGoogle = async () => {
    if (!googleClientId) { setError(T("socialLoginComingSoon")); return; }
    setLoading(true); clearError();
    try {
      const idToken = await loadGoogleGSIToken(googleClientId);
      const res = await api.socialGoogle({ idToken });
      await doLogin(res);
    } catch (e: unknown) { handleAuthError(e); }
    setLoading(false);
  };

  const handleSocialFacebook = async () => {
    if (!facebookAppId) { setError(T("socialLoginComingSoon")); return; }
    setLoading(true); clearError();
    try {
      const accessToken = await loadFacebookAccessToken(facebookAppId);
      const res = await api.socialFacebook({ accessToken });
      await doLogin(res);
    } catch (e: unknown) { handleAuthError(e); }
    setLoading(false);
  };

  /* A4 / S-Sec8: Auto-firing the social SDK from a useEffect violates the
     user-gesture requirement of GSI / FB SDK in some browsers AND can loop on
     failure (popup blocker → handleAuthError doesn't change step/method →
     next render re-fires). Social login is now triggered exclusively from the
     button onClick handlers (handleSocialGoogle / handleSocialFacebook) which
     are already wired up by the buttons rendered below. The previous effect
     was the only auto-trigger and is now removed. */

  const finalize2fa = useCallback(async (res: Record<string, unknown>, tempToken: string) => {
    const finalToken = (res.token as string) || tempToken;
    const refreshTk = (res.refreshToken as string) || twoFaPending?.refreshToken;
    const postRes: AuthResponse = { ...res, token: finalToken, refreshToken: refreshTk };
    if (!checkRiderRole(postRes)) { setGlobalTwoFaPending(false); return; }
    if (postRes.pendingApproval) { setStep("pending"); setGlobalTwoFaPending(false); return; }
    /* A7: Clear the React Query cache BEFORE storing the new tokens so a
       route swap between storeTokens and login() can never read the previous
       user's cached query data. (login() also clears the cache, but the
       window between storeTokens and login is exactly what the bug reports.) */
    queryClient.clear();
    api.storeTokens(finalToken, refreshTk);
    let profile;
    try {
      profile = await api.getMe();
    } catch (fetchErr: unknown) {
      api.clearTokens();
      setTwoFaError(fetchErr instanceof Error ? fetchErr.message : T("loginFailed"));
      setGlobalTwoFaPending(false);
      return;
    }
    login(finalToken, profile, refreshTk);
    setGlobalTwoFaPending(false);
  }, [twoFaPending, login, setGlobalTwoFaPending, T]);

  const handle2faVerify = useCallback(async (code: string) => {
    if (!twoFaPending) return;
    const tempToken = twoFaPending.tempToken;
    if (!tempToken) {
      setTwoFaError("Session error: 2FA token is missing. Please go back and log in again.");
      return;
    }
    setTwoFaLoading(true);
    setTwoFaError("");
    try {
      const res = await api.twoFactorVerify({ code, tempToken, deviceFingerprint: getDeviceFingerprint() });
      await finalize2fa(res, tempToken);
    } catch (e: unknown) {
      setTwoFaError(e instanceof Error ? e.message : T("verificationFailed"));
    }
    setTwoFaLoading(false);
  }, [twoFaPending, finalize2fa, T]);

  const handle2faBackup = useCallback(async (code: string) => {
    if (!twoFaPending) return;
    const tempToken = twoFaPending.tempToken;
    if (!tempToken) {
      setTwoFaError("Session error: 2FA token is missing. Please go back and log in again.");
      return;
    }
    setTwoFaLoading(true);
    setTwoFaError("");
    try {
      const res = await api.twoFactorRecovery({ backupCode: code, tempToken, deviceFingerprint: getDeviceFingerprint() });
      await finalize2fa(res, tempToken);
    } catch (e: unknown) {
      setTwoFaError(e instanceof Error ? e.message : T("verificationFailed"));
    }
    setTwoFaLoading(false);
  }, [twoFaPending, finalize2fa, T]);

  const formatLockoutTime = (sec: number) => {
    if (sec >= 60) return `${Math.ceil(sec / 60)} ${T("minutes")}`;
    return `${sec} ${T("seconds")}`;
  };

  /* ── Shared dark-theme screen wrapper ───────────────────────────────────── */
  const DarkScreen = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen bg-[#0B0E11] flex items-center justify-center p-4 relative overflow-hidden" style={{ paddingTop: "env(safe-area-inset-top,0px)" }}>
      {/* Decorative gold glow blobs */}
      <div className="absolute top-0 left-1/4 w-96 h-96 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(240,185,11,0.06) 0%, transparent 70%)" }} />
      <div className="absolute bottom-0 right-1/4 w-80 h-80 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(240,185,11,0.04) 0%, transparent 70%)" }} />
      <div className="relative z-10 w-full max-w-sm">{children}</div>
    </div>
  );

  /* ── Shared dark card ────────────────────────────────────────────────────── */
  const DarkCard = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
    <div className={`bg-[#131720] border border-[#F0B90B]/15 rounded-2xl p-7 shadow-2xl ${className}`}>
      {children}
    </div>
  );

  /* ── Shared primary gold button ──────────────────────────────────────────── */
  const GoldBtn = ({ onClick, disabled, children, className = "" }: { onClick?: () => void; disabled?: boolean; children: React.ReactNode; className?: string }) => (
    <button onClick={onClick} disabled={disabled}
      className={`w-full h-12 font-bold rounded-xl transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      style={{ background: disabled ? "#3a3208" : "linear-gradient(135deg,#F0B90B,#D97706)", color: "#0B0E11", boxShadow: disabled ? "none" : "0 0 20px rgba(240,185,11,0.25)" }}>
      {children}
    </button>
  );

  if (config.platform.appStatus === "maintenance") {
    return (
      <DarkScreen>
        <DarkCard className="text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-[#F0B90B]/30" style={{ background: "rgba(240,185,11,0.1)" }}>
            <Wrench size={30} className="text-[#F0B90B]" />
          </div>
          <h2 className="text-xl font-bold text-[#E8E9EF] mb-2">Under Maintenance</h2>
          <p className="text-[#6B7280] text-sm leading-relaxed mb-5">{config.content.maintenanceMsg || "We're performing scheduled maintenance. Back soon!"}</p>
          {(config.platform.supportPhone || config.platform.supportEmail) && (
            <div className="bg-[#0F1217] border border-[#252836] rounded-xl p-3 text-left">
              <p className="text-[10px] font-bold text-[#F0B90B] uppercase tracking-wider mb-2">Need Help?</p>
              {config.platform.supportPhone && (
                <p className="text-sm font-semibold text-[#C9CDD8] flex items-center gap-2"><Phone size={12} className="text-[#6B7280]" /> {config.platform.supportPhone}</p>
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

  if (step === "2fa") {
    return (
      <DarkScreen>
        <DarkCard>
          <button onClick={() => { setStep("input"); setTwoFaPending(null); setGlobalTwoFaPending(false); }}
            className="text-[#6B7280] hover:text-[#F0B90B] text-sm font-semibold mb-5 flex items-center gap-1.5 transition-colors">
            <ArrowLeft size={15} /> {T("back")}
          </button>
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-[#F0B90B]/30" style={{ background: "rgba(240,185,11,0.08)" }}>
            <Shield size={26} className="text-[#F0B90B]" />
          </div>
          <TwoFactorVerify
            onVerify={handle2faVerify}
            onBackupCode={handle2faBackup}
            verifyLoading={twoFaLoading}
            verifyError={twoFaError}
            showTrustDevice={false}
          />
        </DarkCard>
      </DarkScreen>
    );
  }

  if (step === "pending") {
    return (
      <DarkScreen>
        <DarkCard className="text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-[#F0B90B]/30" style={{ background: "rgba(240,185,11,0.08)" }}>
            <Clock size={30} className="text-[#F0B90B]" />
          </div>
          <h2 className="text-xl font-bold text-[#E8E9EF] mb-2">{T("approvalPending")}</h2>
          <p className="text-[#6B7280] text-sm leading-relaxed mb-5">{T("approvalMsg")} {T("approvalTakes")}</p>
          <div className="bg-[#0F1217] border border-[#F0B90B]/20 rounded-xl p-3 mb-5 text-left flex gap-2">
            <Lightbulb size={13} className="text-[#F0B90B] flex-shrink-0 mt-0.5" />
            <p className="text-[#9CA3AF] text-xs leading-relaxed">{T("alreadyApproved")}</p>
          </div>
          <GoldBtn onClick={() => { setStep("input"); setError(null); }}>
            <ArrowLeft size={14} /> {T("backToLogin")}
          </GoldBtn>
        </DarkCard>
      </DarkScreen>
    );
  }

  if (step === "rejected") {
    return (
      <DarkScreen>
        <DarkCard className="text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-red-500/30" style={{ background: "rgba(239,68,68,0.08)" }}>
            <Shield size={30} className="text-red-400" />
          </div>
          <h2 className="text-xl font-bold text-[#E8E9EF] mb-2">{T("approvalRejected") || "Application Rejected"}</h2>
          <p className="text-[#6B7280] text-sm leading-relaxed mb-4">
            {T("approvalRejectedMsg") || "Your rider application was not approved. Please contact support for more information."}
          </p>
          {loginRejectionReason && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 mb-5 text-left">
              <p className="text-red-400 text-xs font-semibold mb-1">Reason:</p>
              <p className="text-red-300 text-xs">{loginRejectionReason}</p>
            </div>
          )}
          <GoldBtn onClick={() => { setStep("input"); setLoginRejectionReason(null); setError(null); }}>
            <ArrowLeft size={14} /> {T("backToLogin")}
          </GoldBtn>
        </DarkCard>
      </DarkScreen>
    );
  }

  const hasSocial = auth.googleEnabled || auth.facebookEnabled;
  const hasMagicLink = auth.magicLinkEnabled;

  /* ── Dark input class ──────────────────────────────────────────────────────── */
  const inputCls = "w-full h-12 bg-[#0F1217] border border-[#252836] rounded-xl text-sm text-[#E8E9EF] placeholder-[#3D4251] transition-all focus:outline-none focus:border-[#F0B90B] focus:ring-1 focus:ring-[#F0B90B]/30";

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#0B0E11]" style={{ paddingTop: "env(safe-area-inset-top,0px)" }}>

      {/* ── LEFT PANEL (desktop only) ─────────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[44%] xl:w-[42%] flex-col justify-between p-10 relative overflow-hidden flex-shrink-0 border-r border-[#F0B90B]/8"
        style={{ background: "linear-gradient(160deg,#0D1017 0%,#0B0E11 60%,#0F1117 100%)" }}>

        {/* Geometric grid lines */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.04]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
              <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#F0B90B" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>

        {/* Gold glow top-right */}
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(240,185,11,0.08) 0%, transparent 65%)" }} />
        <div className="absolute bottom-0 left-0 w-80 h-80 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(240,185,11,0.05) 0%, transparent 70%)" }} />

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center border border-[#F0B90B]/40" style={{ background: "rgba(240,185,11,0.12)" }}>
            <Bike size={22} className="text-[#F0B90B]" />
          </div>
          <div>
            <p className="text-[#E8E9EF] font-extrabold text-lg leading-tight">{appName}</p>
            <p className="text-[#F0B90B] text-xs font-medium tracking-widest uppercase">{T("riderPortal")}</p>
          </div>
        </div>

        {/* Hero text */}
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

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 mb-8">
            {[
              { v: "24/7", l: "Support" },
              { v: "Fast", l: "Payouts" },
              { v: "Live", l: "Tracking" },
            ].map(s => (
              <div key={s.l} className="bg-[#0F1217] border border-[#252836] rounded-xl p-3 text-center">
                <p className="text-[#F0B90B] font-extrabold text-lg leading-none">{s.v}</p>
                <p className="text-[#6B7280] text-[10px] mt-1 font-medium">{s.l}</p>
              </div>
            ))}
          </div>

          {/* Feature list */}
          <div className="space-y-2.5">
            {[
              { icon: "⚡", title: "Instant Earnings", desc: "Get credited after every completed delivery" },
              { icon: "🗺️", title: "Smart Navigation", desc: "AI-optimised routes for maximum efficiency" },
              { icon: "🕐", title: "Flexible Schedule", desc: "Go online and offline whenever you want" },
              { icon: "🏆", title: "Performance Bonuses", desc: "Earn more with high ratings & streaks" },
            ].map(f => (
              <div key={f.title} className="flex items-center gap-3 bg-[#0F1217] border border-[#252836] hover:border-[#F0B90B]/20 rounded-xl px-4 py-2.5 transition-colors">
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

      {/* ── RIGHT PANEL (form) ────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col" style={{ background: "#0B0E11" }}>

        {/* Mobile top bar */}
        <div className="lg:hidden px-5 pt-8 pb-6 flex items-center gap-3 border-b border-[#1A1D24]">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center border border-[#F0B90B]/40" style={{ background: "rgba(240,185,11,0.1)" }}>
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

            {/* Desktop heading */}
            <div className="hidden lg:block mb-7">
              <p className="text-[#F0B90B] text-xs font-bold tracking-[0.2em] uppercase mb-2">Rider Portal</p>
              <h2 className="text-2xl font-extrabold text-[#E8E9EF]">
                {step === "continue" ? "Welcome back" : step === "otp" ? "Verify your identity" : "Sign in to continue"}
              </h2>
              <p className="text-[#6B7280] text-sm mt-1.5">
                {step === "continue" ? "Enter your credentials to access the rider dashboard" :
                 step === "otp"      ? "Enter the 6-digit code we sent to your device" : ""}
              </p>
            </div>

            {/* Mobile heading */}
            <div className="lg:hidden mb-5">
              <h2 className="text-xl font-extrabold text-[#E8E9EF]">
                {step === "continue" ? "Welcome back" : step === "otp" ? "Verify identity" : "Sign in"}
              </h2>
              <p className="text-[#6B7280] text-xs mt-1">
                {step === "continue" ? "Enter your credentials to continue" :
                 step === "otp"      ? "Enter the 6-digit verification code" : ""}
              </p>
            </div>

            {/* Notice banner */}
            {config.content.riderNotice && (
              <div className="bg-[#F0B90B]/8 border border-[#F0B90B]/25 rounded-xl p-3 mb-4 flex items-start gap-2.5">
                <AlertCircle size={14} className="text-[#F0B90B] flex-shrink-0 mt-0.5" />
                <p className="text-[#D9A520] text-xs font-medium leading-relaxed">{config.content.riderNotice}</p>
              </div>
            )}

            {/* Lockout banner */}
            {isLockedOut && (
              <div className="bg-red-500/8 border border-red-500/25 rounded-xl p-4 mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <Shield size={16} className="text-red-400 flex-shrink-0" />
                  <p className="text-sm font-bold text-red-400">{T("accountLocked")}</p>
                </div>
                <p className="text-xs text-red-400/80 mb-3">{T("accountLockedMsg")} {formatLockoutTime(lockoutRemaining)}</p>
                <div className="text-2xl font-mono font-bold text-red-400 text-center bg-red-500/10 border border-red-500/20 rounded-xl py-2.5">
                  {Math.floor(lockoutRemaining / 60).toString().padStart(2, "0")}:{(lockoutRemaining % 60).toString().padStart(2, "0")}
                </div>
              </div>
            )}

            {/* ── Dark form card ─────────────────────────────────────────── */}
            <div className="bg-[#131720] border border-[#F0B90B]/12 rounded-2xl p-6 lg:p-7 shadow-2xl">

              {/* STEP: continue ─────────────────────────────────────────── */}
              {step === "continue" && (
                <div className="login-step-enter">
                  <div className="mb-5">
                    <label className="text-[10px] font-bold text-[#6B7280] mb-2 block uppercase tracking-widest">Phone / Email / Username</label>
                    <div className="relative">
                      <User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#3D4251] pointer-events-none" />
                      <input
                        type="text"
                        placeholder="+923001234567 · email · username"
                        value={identifier}
                        onChange={e => setIdentifier(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && checkIdentifier()}
                        className={`${inputCls} pl-10 pr-4`}
                        autoFocus
                      />
                    </div>
                  </div>

                  {error && (
                    <div className="mb-4 p-3 bg-red-500/8 border border-red-500/25 rounded-xl flex items-start gap-2">
                      <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                      <p className="text-red-400 text-xs font-medium">{error}</p>
                    </div>
                  )}

                  <GoldBtn onClick={checkIdentifier} disabled={loading || isLockedOut}>
                    {loading ? <><Loader2 size={16} className="animate-spin" /> Checking...</> : <>Continue →</>}
                  </GoldBtn>

                  {/* Biometric quick-login */}
                  {biometricAvailable && biometricEnabled && (
                    <button onClick={handleBiometricLogin} disabled={biometricLoading}
                      className="w-full mt-3 h-11 rounded-xl border border-[#252836] bg-[#0F1217] hover:border-[#F0B90B]/30 text-[#9CA3AF] hover:text-[#F0B90B] text-sm font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-50">
                      {biometricLoading ? <Loader2 size={16} className="animate-spin" /> : <Fingerprint size={16} />}
                      Sign in with Biometrics
                    </button>
                  )}

                  {(hasSocial || hasMagicLink) && (
                    <>
                      <div className="flex items-center gap-3 my-5">
                        <div className="flex-1 h-px bg-[#1F2533]" />
                        <span className="text-[10px] text-[#4B5563] font-medium uppercase tracking-widest">{T("orContinueWith")}</span>
                        <div className="flex-1 h-px bg-[#1F2533]" />
                      </div>
                      <div className="space-y-2.5">
                        {auth.googleEnabled && (
                          <button onClick={handleSocialGoogle} disabled={loading || isLockedOut}
                            className="w-full h-11 bg-[#0F1217] border border-[#252836] hover:border-[#F0B90B]/30 rounded-xl text-sm font-semibold text-[#C9CDD8] hover:text-[#E8E9EF] transition-all flex items-center justify-center gap-2.5 disabled:opacity-50">
                            <svg width="15" height="15" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
                            {T("signInWithGoogle")}
                          </button>
                        )}
                        {auth.facebookEnabled && (
                          <button onClick={handleSocialFacebook} disabled={loading || isLockedOut}
                            className="w-full h-11 rounded-xl text-sm font-semibold text-white transition-all flex items-center justify-center gap-2.5 disabled:opacity-50"
                            style={{ background: "linear-gradient(135deg,#1877F2,#0d65dc)" }}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="white"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>
                            {T("signInWithFacebook")}
                          </button>
                        )}
                        {auth.magicLinkEnabled && (
                          <div className="mt-1">
                            <MagicLinkSender onSend={handleMagicLinkSend} title={T("magicLinkLogin")} subtitle={T("enterRegisteredEmail")} />
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  <div className="mt-5 text-center">
                    <Link to="/register" className="text-sm text-[#6B7280] hover:text-[#E8E9EF] transition-colors">
                      New rider?{" "}
                      <span className="text-[#F0B90B] font-bold hover:text-[#D97706]">Register here</span>
                    </Link>
                    {(config.content.tncUrl || config.content.privacyUrl) && (
                      <div className="mt-2 flex items-center justify-center gap-3">
                        {config.content.tncUrl && (
                          <a href={config.content.tncUrl} target="_blank" rel="noopener noreferrer"
                            className="text-[11px] text-[#374151] hover:text-[#6B7280] underline underline-offset-2 transition-colors">Terms</a>
                        )}
                        {config.content.tncUrl && config.content.privacyUrl && <span className="text-[#252836] text-[11px]">·</span>}
                        {config.content.privacyUrl && (
                          <a href={config.content.privacyUrl} target="_blank" rel="noopener noreferrer"
                            className="text-[11px] text-[#374151] hover:text-[#6B7280] underline underline-offset-2 transition-colors">Privacy Policy</a>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Method tabs (multi-method) */}
              {step === "input" && enabledMethods.length > 1 && (
                <div className="mb-5">
                  <button onClick={() => { setStep("continue"); clearError(); setDevOtp(""); setEmailDevOtp(""); }}
                    className="text-[#6B7280] hover:text-[#F0B90B] text-sm font-semibold mb-4 flex items-center gap-1.5 transition-colors">
                    <ArrowLeft size={14} /> Change identifier
                  </button>
                  <div className="flex gap-1 bg-[#0F1217] border border-[#252836] rounded-xl p-1">
                    {enabledMethods.map(m => (
                      <button key={m} onClick={() => selectMethod(m)}
                        className={`flex-1 py-2 text-[11px] font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                          method === m
                            ? "text-[#0B0E11]"
                            : "text-[#4B5563] hover:text-[#9CA3AF]"
                        }`}
                        style={method === m ? { background: "linear-gradient(135deg,#F0B90B,#D97706)" } : {}}>
                        {m === "phone" ? <><Phone size={11} /> {T("phoneLabel")}</> : m === "email" ? <><Mail size={11} /> {T("email")}</> : <><User size={11} /> {T("username")}</>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Back button (single method) */}
              {step === "input" && enabledMethods.length <= 1 && (
                <button onClick={() => { setStep("continue"); clearError(); }}
                  className="text-[#6B7280] hover:text-[#F0B90B] text-sm font-semibold mb-4 flex items-center gap-1.5 transition-colors">
                  <ArrowLeft size={14} /> Back
                </button>
              )}

              {step === "otp" && (
                <button onClick={() => { setStep("continue"); clearError(); setDevOtp(""); setEmailDevOtp(""); }}
                  className="text-[#6B7280] hover:text-[#F0B90B] text-sm font-semibold mb-4 flex items-center gap-1.5 transition-colors">
                  <ArrowLeft size={14} /> {T("back")}
                </button>
              )}

              {/* PHONE input step */}
              {method === "phone" && step === "input" && (
                <div className="login-step-enter">
                  <h3 className="text-base font-bold text-[#E8E9EF] mb-1">{T("phoneLogin")}</h3>
                  <p className="text-xs text-[#6B7280] mb-4">{T("enterRegisteredPhone")}</p>
                  <label className="text-[10px] font-bold text-[#6B7280] mb-2 block uppercase tracking-widest">Phone Number</label>
                  <div className="flex gap-2 mb-1">
                    <div className="h-12 px-3 bg-[#0F1217] border border-[#252836] rounded-xl flex items-center text-sm font-bold text-[#9CA3AF] select-none gap-1.5 flex-shrink-0">
                      🇵🇰 <span className="text-[#C9CDD8]">+92</span>
                    </div>
                    <div className="relative flex-1">
                      <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3D4251] pointer-events-none" />
                      <input type="tel" placeholder={phoneHint} value={phone} onChange={e => setPhone(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                        className={`${inputCls} pl-9 pr-4`} autoFocus inputMode="numeric" />
                    </div>
                  </div>
                  <p className="text-[10px] text-[#374151] mb-4">Pakistan only (+92)</p>
                  {showEmailFallback && (
                    <div className="bg-[#F0B90B]/5 border border-[#F0B90B]/20 rounded-xl p-3 mb-3">
                      <p className="text-xs text-[#D9A520] font-semibold mb-2">SMS not working? Use email OTP instead:</p>
                      <div className="flex gap-2">
                        <input type="email" placeholder="your@email.com" value={phoneFallbackEmail} onChange={e => setPhoneFallbackEmail(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && switchToEmailFallback()}
                          className={`${inputCls} flex-1 px-3`} />
                        <button onClick={switchToEmailFallback} disabled={loading}
                          className="h-12 px-3 rounded-xl text-[#0B0E11] text-xs font-bold disabled:opacity-50 flex items-center gap-1 flex-shrink-0"
                          style={{ background: "linear-gradient(135deg,#F0B90B,#D97706)" }}>
                          <Mail size={12} /> Send
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* PHONE OTP step — TOTP (Google Authenticator) mode */}
              {method === "phone" && step === "otp" && auth.otpProvider === "google_authenticator" && (
                <div className="login-step-enter">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-4 border border-[#F0B90B]/30" style={{ background: "rgba(240,185,11,0.08)" }}>
                    <Shield size={22} className="text-[#F0B90B]" />
                  </div>
                  <h3 className="text-base font-bold text-[#E8E9EF] mb-1 text-center">Authenticator Code</h3>
                  <p className="text-xs text-[#6B7280] mb-5 text-center">Open your authenticator app and enter the 6-digit code for this account.</p>

                  <div className="relative mb-2">
                    <div className="flex gap-2 justify-center pointer-events-none select-none" aria-hidden>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className={`w-10 h-13 rounded-xl border-2 flex items-center justify-center text-xl font-bold transition-all ${
                          otp[i] ? "border-[#F0B90B] text-[#F0B90B]" : "border-[#252836] text-[#2D3143]"
                        }`}
                        style={otp[i] ? { background: "rgba(240,185,11,0.08)" } : { background: "#0F1217" }}>
                          {otp[i] || "·"}
                        </div>
                      ))}
                    </div>
                    <input type="text" inputMode="numeric" pattern="[0-9]*" value={otp}
                      onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      onKeyDown={e => e.key === "Enter" && handleSubmit()}
                      className="absolute inset-0 opacity-0 w-full cursor-text" maxLength={6} autoFocus aria-label="Enter 6-digit authenticator code" />
                  </div>
                  <p className="text-center text-[10px] text-[#374151] mb-4">Code refreshes every 30 seconds</p>
                </div>
              )}

              {/* PHONE OTP step — SMS/WhatsApp mode */}
              {method === "phone" && step === "otp" && auth.otpProvider !== "google_authenticator" && (
                <div className="login-step-enter">
                  {otpBypassActive && !bypassBannerDismissed && (
                    <div className="bg-[#F0B90B]/8 border border-[#F0B90B]/25 rounded-xl p-3 mb-4 flex items-start gap-2">
                      <AlertCircle size={13} className="text-[#F0B90B] flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[#D9A520] text-xs font-semibold leading-relaxed">
                          {otpBypassMessage || "OTP verification is temporarily disabled. You will be logged in automatically."}
                        </p>
                        {bypassRemainingSeconds > 0 && (
                          <p className="text-[#9CA3AF] text-[10px] mt-0.5">
                            Expires in {Math.floor(bypassRemainingSeconds / 60)}m {bypassRemainingSeconds % 60}s
                          </p>
                        )}
                      </div>
                      <button onClick={() => setBypassBannerDismissed(true)} className="text-[#4B5563] hover:text-[#F0B90B] flex-shrink-0 transition-colors" aria-label="Dismiss">
                        <X size={13} />
                      </button>
                    </div>
                  )}
                  <h3 className="text-base font-bold text-[#E8E9EF] mb-1">{T("enterOtp")}</h3>
                  <div className="flex items-center flex-wrap gap-2 mb-5">
                    <p className="text-xs text-[#6B7280]">+92{phone}</p>
                    {otpChannel && (
                      <span className="text-[10px] font-semibold text-[#F0B90B] bg-[#F0B90B]/10 border border-[#F0B90B]/20 px-2 py-0.5 rounded-full">
                        via {otpChannel === "whatsapp" ? "📱 WhatsApp" : otpChannel === "email" ? "✉️ Email" : "💬 SMS"}
                      </span>
                    )}
                    {fallbackChannels.length > 0 && fallbackChannels.map(ch => (
                      <button key={ch} onClick={() => { if (otpCooldown <= 0) sendPhoneOtp(ch); }}
                        disabled={otpCooldown > 0}
                        className="text-[10px] text-[#F0B90B] hover:text-[#D97706] font-bold disabled:opacity-40 transition-colors">
                        · Via {ch === "whatsapp" ? "WhatsApp" : ch === "email" ? "Email" : "SMS"}
                      </button>
                    ))}
                  </div>
                  {import.meta.env.DEV && devOtp && (
                    <div className="bg-[#F0B90B]/8 border border-[#F0B90B]/25 rounded-xl px-3 py-2.5 mb-4">
                      <p className="text-[10px] text-[#F0B90B] font-bold uppercase tracking-widest mb-0.5">{T("devOtp")}</p>
                      <p className="text-[#F0B90B] font-extrabold text-xl tracking-[0.4em]">{devOtp}</p>
                    </div>
                  )}

                  {/* 6-box OTP cells */}
                  <div className="relative mb-2">
                    <div className="flex gap-2 justify-center pointer-events-none select-none" aria-hidden>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className={`w-10 h-13 rounded-xl border-2 flex items-center justify-center text-xl font-bold transition-all ${
                          otp[i]
                            ? "border-[#F0B90B] text-[#F0B90B]"
                            : "border-[#252836] text-[#2D3143]"
                        }`}
                        style={otp[i] ? { background: "rgba(240,185,11,0.08)" } : { background: "#0F1217" }}>
                          {otp[i] || "·"}
                        </div>
                      ))}
                    </div>
                    <input type="text" inputMode="numeric" pattern="[0-9]*" value={otp}
                      onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      onKeyDown={e => e.key === "Enter" && handleSubmit()}
                      className="absolute inset-0 opacity-0 w-full cursor-text" maxLength={6} autoFocus aria-label="Enter 6-digit OTP" />
                  </div>
                  <p className="text-center text-[10px] text-[#374151] mb-4">Tap above and type your 6-digit code</p>

                  <button onClick={() => { if (otpCooldown === 0) sendPhoneOtp(); }} disabled={otpCooldown > 0}
                    className="w-full text-xs text-[#4B5563] hover:text-[#F0B90B] mb-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium text-center">
                    {otpCooldown > 0 ? `${T("resendOtp")} (${otpCooldown}s)` : T("resendOtp")}
                  </button>

                  {auth.emailEnabled && !showEmailFallback && (
                    <button onClick={() => setShowEmailFallback(true)} className="w-full text-xs text-[#F0B90B]/70 hover:text-[#F0B90B] py-1 font-semibold transition-colors text-center">
                      Not receiving SMS? Use email OTP instead
                    </button>
                  )}
                  {showEmailFallback && (
                    <div className="bg-[#F0B90B]/5 border border-[#F0B90B]/20 rounded-xl p-3">
                      <p className="text-xs text-[#D9A520] font-semibold mb-2">Enter your email to receive OTP:</p>
                      <div className="flex gap-2">
                        <input type="email" placeholder="your@email.com" value={phoneFallbackEmail} onChange={e => setPhoneFallbackEmail(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && switchToEmailFallback()}
                          className={`${inputCls} flex-1 px-3`} />
                        <button onClick={switchToEmailFallback} disabled={loading}
                          className="h-12 px-3 rounded-xl text-[#0B0E11] text-xs font-bold disabled:opacity-50 flex items-center gap-1 flex-shrink-0"
                          style={{ background: "linear-gradient(135deg,#F0B90B,#D97706)" }}>
                          <Mail size={12} /> Send
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* EMAIL input step */}
              {method === "email" && step === "input" && (
                <div className="login-step-enter">
                  <h3 className="text-base font-bold text-[#E8E9EF] mb-1">{T("emailLogin")}</h3>
                  <p className="text-xs text-[#6B7280] mb-4">{T("enterRegisteredEmail")}</p>
                  <label className="text-[10px] font-bold text-[#6B7280] mb-2 block uppercase tracking-widest">Email Address</label>
                  <div className="relative mb-4">
                    <Mail size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#3D4251] pointer-events-none" />
                    <input type="email" placeholder="your@email.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                      className={`${inputCls} pl-10 pr-4`} autoFocus />
                  </div>
                </div>
              )}

              {/* EMAIL OTP step */}
              {method === "email" && step === "otp" && (
                <div className="login-step-enter">
                  <h3 className="text-base font-bold text-[#E8E9EF] mb-1">{T("enterOtp")}</h3>
                  <p className="text-xs text-[#6B7280] mb-1">{email}</p>
                  {otpChannel === "email" && (
                    <span className="text-[10px] font-semibold text-[#F0B90B] bg-[#F0B90B]/10 border border-[#F0B90B]/20 px-2 py-0.5 rounded-full inline-block mb-4">via ✉️ Email</span>
                  )}
                  {import.meta.env.DEV && emailDevOtp && (
                    <div className="bg-[#F0B90B]/8 border border-[#F0B90B]/25 rounded-xl px-3 py-2.5 mb-4">
                      <p className="text-[10px] text-[#F0B90B] font-bold uppercase tracking-widest mb-0.5">{T("devOtp")}</p>
                      <p className="text-[#F0B90B] font-extrabold text-xl tracking-[0.4em]">{emailDevOtp}</p>
                    </div>
                  )}

                  {/* 6-box OTP cells */}
                  <div className="relative mb-2">
                    <div className="flex gap-2 justify-center pointer-events-none select-none" aria-hidden>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className={`w-10 h-13 rounded-xl border-2 flex items-center justify-center text-xl font-bold transition-all ${
                          emailOtp[i] ? "border-[#F0B90B] text-[#F0B90B]" : "border-[#252836] text-[#2D3143]"
                        }`}
                        style={emailOtp[i] ? { background: "rgba(240,185,11,0.08)" } : { background: "#0F1217" }}>
                          {emailOtp[i] || "·"}
                        </div>
                      ))}
                    </div>
                    <input type="text" inputMode="numeric" pattern="[0-9]*" value={emailOtp}
                      onChange={e => setEmailOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      onKeyDown={e => e.key === "Enter" && handleSubmit()}
                      className="absolute inset-0 opacity-0 w-full cursor-text" maxLength={6} autoFocus aria-label="Enter 6-digit email OTP" />
                  </div>
                  <p className="text-center text-[10px] text-[#374151] mb-4">Tap above and type your 6-digit code</p>

                  <button onClick={() => { if (otpCooldown === 0) sendEmailOtpFn(); }} disabled={otpCooldown > 0}
                    className="w-full text-xs text-[#4B5563] hover:text-[#F0B90B] mb-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium text-center">
                    {otpCooldown > 0 ? `${T("resendOtp")} (${otpCooldown}s)` : T("resendOtp")}
                  </button>
                </div>
              )}

              {/* USERNAME/PASSWORD step */}
              {method === "username" && step === "input" && (
                <div className="login-step-enter">
                  <h3 className="text-base font-bold text-[#E8E9EF] mb-1">{T("usernameLogin")}</h3>
                  <p className="text-xs text-[#6B7280] mb-4">Phone, email, or username</p>
                  <label className="text-[10px] font-bold text-[#6B7280] mb-2 block uppercase tracking-widest">Identifier</label>
                  <div className="relative mb-3">
                    <User size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#3D4251] pointer-events-none" />
                    <input type="text" placeholder="Phone, email, or username" value={username} onChange={e => setUsername(e.target.value.trim())} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                      className={`${inputCls} pl-10 pr-4`} autoFocus />
                  </div>
                  <label className="text-[10px] font-bold text-[#6B7280] mb-2 block uppercase tracking-widest">{T("password")}</label>
                  <div className="relative mb-4">
                    <input type={showPwd ? "text" : "password"} placeholder={T("password")} value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                      className={`${inputCls} px-4 pr-12`} />
                    <button onClick={() => setShowPwd(v => !v)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#3D4251] hover:text-[#F0B90B] transition-colors">
                      {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              )}

              {/* Failed attempts warning */}
              {auth.lockoutEnabled && failedAttempts > 0 && !isLockedOut && (step === "input" || step === "otp") && (() => {
                const remaining = auth.lockoutMaxAttempts - failedAttempts;
                const alts: { m: LoginMethod; label: string; icon: ReactNode }[] = [];
                if (method !== "phone" && auth.phoneEnabled) alts.push({ m: "phone", label: "Phone OTP", icon: <Phone size={10} /> });
                if (method !== "email" && auth.emailEnabled) alts.push({ m: "email", label: "Email OTP", icon: <Mail size={10} /> });
                if (method !== "username" && auth.usernamePassword) alts.push({ m: "username", label: "Password", icon: <User size={10} /> });
                return (
                  <div className="bg-[#F0B90B]/5 border border-[#F0B90B]/20 rounded-xl px-3 py-2.5 mb-3">
                    <p className="text-xs text-[#D9A520] font-semibold mb-1">
                      ⚠️ {failedAttempts} {T("failedAttempts")} · {remaining} remaining
                    </p>
                    {alts.length > 0 && (
                      <>
                        <p className="text-[10px] text-[#9CA3AF] mb-1.5">Try a different sign-in method:</p>
                        <div className="flex gap-1.5 flex-wrap">
                          {alts.map(({ m, label, icon }) => (
                            <button key={m} onClick={() => switchToMethod(m)}
                              className="flex items-center gap-1 text-[10px] bg-[#0F1217] border border-[#F0B90B]/25 text-[#F0B90B] rounded-lg px-2 py-1 font-semibold hover:bg-[#F0B90B]/10 transition-colors">
                              {icon} {label}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}

              {/* Error */}
              {step !== "continue" && error && (
                <div className="mb-4 p-3 bg-red-500/8 border border-red-500/25 rounded-xl flex items-start gap-2">
                  <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-400 text-xs font-medium">{error}</p>
                </div>
              )}

              {/* Primary CTA */}
              {step === "input" && enabledMethods.includes(method as "phone" | "email" | "username") && (
                <GoldBtn onClick={handleSubmit} disabled={loading || isLockedOut}>
                  {loading ? <><Loader2 size={16} className="animate-spin" /> {T("pleaseWait")}</> :
                    method === "phone" ? T("sendOtp") :
                    method === "email" ? T("sendEmailOtp") :
                    T("login")}
                </GoldBtn>
              )}

              {step === "otp" && (
                <GoldBtn onClick={handleSubmit} disabled={loading || isLockedOut}>
                  {loading ? <><Loader2 size={16} className="animate-spin" /> {T("pleaseWait")}</> : T("verifyAndLogin")}
                </GoldBtn>
              )}

              {/* Social divider on input step */}
              {step === "input" && (hasSocial || hasMagicLink) && (
                <div className="mt-5">
                  {enabledMethods.length > 0 && (
                    <div className="flex items-center gap-3 mb-4">
                      <div className="flex-1 h-px bg-[#1F2533]" />
                      <span className="text-[10px] text-[#4B5563] font-medium uppercase tracking-widest">{T("orContinueWith")}</span>
                      <div className="flex-1 h-px bg-[#1F2533]" />
                    </div>
                  )}
                  <div className="space-y-2.5">
                    {auth.googleEnabled && (
                      <button onClick={handleSocialGoogle} disabled={loading || isLockedOut}
                        className="w-full h-11 bg-[#0F1217] border border-[#252836] hover:border-[#F0B90B]/30 rounded-xl text-sm font-semibold text-[#C9CDD8] hover:text-[#E8E9EF] transition-all flex items-center justify-center gap-2.5 disabled:opacity-50">
                        <svg width="15" height="15" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
                        {T("signInWithGoogle")}
                      </button>
                    )}
                    {auth.facebookEnabled && (
                      <button onClick={handleSocialFacebook} disabled={loading || isLockedOut}
                        className="w-full h-11 rounded-xl text-sm font-semibold text-white transition-all flex items-center justify-center gap-2.5 disabled:opacity-50"
                        style={{ background: "linear-gradient(135deg,#1877F2,#0d65dc)" }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="white"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>
                        {T("signInWithFacebook")}
                      </button>
                    )}
                    {auth.magicLinkEnabled && (
                      <div className="mt-2">
                        <MagicLinkSender onSend={handleMagicLinkSend} title={T("magicLinkLogin")} subtitle={T("enterRegisteredEmail")} />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Register / forgot-password links */}
              {step === "input" && (
                <div className="mt-5 flex flex-col items-center gap-2">
                  <Link href="/register" className="text-sm text-[#6B7280] hover:text-[#E8E9EF] transition-colors">
                    {T("dontHaveAccount")} <span className="text-[#F0B90B] font-bold hover:text-[#D97706]">{T("register")}</span>
                  </Link>
                  {(auth.phoneEnabled || auth.emailEnabled || auth.usernamePassword) && (
                    <Link href="/forgot-password" className="text-xs text-[#374151] hover:text-[#6B7280] transition-colors">
                      {T("forgotPassword")}
                    </Link>
                  )}
                </div>
              )}
            </div>

            {/* ── Biometric enrollment modal ───────────────────────────── */}
            {showBiometricPrompt && (
              <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}>
                <div className="bg-[#131720] border border-[#F0B90B]/20 rounded-2xl p-6 w-full max-w-sm shadow-2xl login-step-enter">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-[#F0B90B]/30" style={{ background: "rgba(240,185,11,0.08)" }}>
                    <Fingerprint size={28} className="text-[#F0B90B]" />
                  </div>
                  <h3 className="text-base font-bold text-[#E8E9EF] text-center mb-1">Enable Biometric Login?</h3>
                  <p className="text-xs text-[#6B7280] text-center mb-5 leading-relaxed">Use Face ID or fingerprint to sign in faster next time.</p>
                  <div className="flex gap-3">
                    <button onClick={() => confirmBiometricEnrollment(false)}
                      className="flex-1 h-11 bg-[#0F1217] border border-[#252836] rounded-xl text-sm font-semibold text-[#6B7280] hover:border-[#374151] hover:text-[#9CA3AF] transition-all">
                      Not now
                    </button>
                    <button onClick={() => confirmBiometricEnrollment(true)}
                      className="flex-1 h-11 rounded-xl text-sm font-bold text-[#0B0E11] transition-all"
                      style={{ background: "linear-gradient(135deg,#F0B90B,#D97706)", boxShadow: "0 0 16px rgba(240,185,11,0.25)" }}>
                      Enable
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="mt-5 text-center space-y-1.5">
              {(config.platform.supportPhone || config.platform.supportEmail) && (
                <p className="text-[#374151] text-[11px]">
                  Support:{" "}
                  {config.platform.supportPhone && <span className="text-[#4B5563] font-semibold">{config.platform.supportPhone}</span>}
                  {config.platform.supportPhone && config.platform.supportEmail && " · "}
                  {config.platform.supportEmail && <span className="text-[#4B5563]">{config.platform.supportEmail}</span>}
                </p>
              )}
              {(config.content.tncUrl || config.content.privacyUrl) && (
                <div className="flex items-center justify-center gap-3">
                  {config.content.tncUrl && (
                    <a href={config.content.tncUrl} target="_blank" rel="noopener noreferrer"
                      className="text-[#374151] text-[11px] hover:text-[#6B7280] underline underline-offset-2 transition-colors">Terms</a>
                  )}
                  {config.content.tncUrl && config.content.privacyUrl && <span className="text-[#252836] text-[11px]">·</span>}
                  {config.content.privacyUrl && (
                    <a href={config.content.privacyUrl} target="_blank" rel="noopener noreferrer"
                      className="text-[#374151] text-[11px] hover:text-[#6B7280] underline underline-offset-2 transition-colors">Privacy</a>
                  )}
                </div>
              )}
              <p className="text-[#252836] text-[11px]">{T("onlyVerifiedRiders")}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

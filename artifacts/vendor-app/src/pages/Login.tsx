import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { LoginScreen, OtpInput, PasswordInput } from "@workspace/auth-react";
import type { AuthUser as SharedAuthUser } from "@workspace/auth-react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { usePlatformConfig, getVendorAuthConfig } from "../lib/useConfig";
import { useLanguage } from "../lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { canonicalizePhone } from "@workspace/auth-utils";

type ForgotStep = "forgot" | "forgot-otp" | "forgot-reset" | "forgot-done";

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

  /* ── Forgot password overlay ─────────────────────────────────────────── */
  const [forgotStep, setForgotStep] = useState<ForgotStep | null>(null);
  const [forgotId, setForgotId]     = useState("");
  const [forgotOtp, setForgotOtp]   = useState("");
  const [forgotPwd, setForgotPwd]   = useState("");
  const [forgotCfm, setForgotCfm]   = useState("");
  const [forgotErr, setForgotErr]   = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);

  /* ── Magic-link auto-verify on page load ─────────────────────────────── */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const magic = params.get("magic_token");
    if (!magic) return;
    api.magicLinkVerify({ token: magic })
      .then(async (res: any) => {
        if (!res.token) return;
        api.storeTokens(res.token, res.refreshToken);
        const profile = await api.getMe();
        login(res.token, profile, res.refreshToken);
        window.history.replaceState({}, "", window.location.pathname);
      })
      .catch(() => window.history.replaceState({}, "", window.location.pathname));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── LoginScreen success handler ─────────────────────────────────────── */
  const handleSuccess = async (sharedUser: SharedAuthUser, accessToken: string) => {
    api.storeTokens(accessToken);
    try {
      const profile = await api.getMe();
      login(accessToken, profile);
    } catch {
      /* Fallback: build minimal vendor user from shared shape */
      login(accessToken, {
        id: sharedUser.id,
        phone: sharedUser.phone ?? "",
        name: undefined,
        email: sharedUser.email,
        avatar: undefined,
        walletBalance: "0",
        roles: ["vendor"],
        storeName: undefined,
        storeIsOpen: true,
        stats: { todayOrders: 0, todayRevenue: 0, totalOrders: 0, totalRevenue: 0 },
      } as any);
    }
  };

  /* ── Forgot password handlers ─────────────────────────────────────────── */
  const handleForgotRequest = async () => {
    if (!forgotId.trim()) { setForgotErr("Enter your phone, email, or username"); return; }
    setForgotBusy(true); setForgotErr("");
    try {
      await api.forgotPassword({ identifier: forgotId.trim() });
      setForgotStep("forgot-otp");
    } catch (e) { setForgotErr(e instanceof Error ? e.message : "Failed to send code"); }
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
    } catch (e) { setForgotErr(e instanceof Error ? e.message : "Failed to reset password"); }
    setForgotBusy(false);
  };

  const closeForgot = () => {
    setForgotStep(null);
    setForgotId(""); setForgotOtp(""); setForgotPwd(""); setForgotCfm(""); setForgotErr("");
  };

  /* ── Shared card wrapper for forgot password steps ───────────────────── */
  const ForgotCard = () => (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8">
        <button onClick={closeForgot} className="text-sm text-gray-500 hover:text-gray-700 mb-6 flex items-center gap-1">
          ← Back to login
        </button>

        {forgotStep === "forgot" && (
          <>
            <h2 className="text-2xl font-extrabold text-gray-800 mb-1">Reset Password</h2>
            <p className="text-sm text-gray-500 mb-6">Enter your phone, email, or username to receive a reset code</p>
            {forgotErr && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm mb-4">{forgotErr}</div>}
            <input
              type="text"
              value={forgotId}
              onChange={e => setForgotId(e.target.value)}
              placeholder="+923001234567 · email · username"
              className="w-full h-12 px-4 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 mb-4"
              autoFocus
              onKeyDown={e => e.key === "Enter" && handleForgotRequest()}
            />
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
            <OtpInput
              onComplete={handleForgotOtpComplete}
              onResend={handleForgotResend}
              resendCooldownSeconds={60}
              autoSubmit
            />
          </>
        )}

        {forgotStep === "forgot-reset" && (
          <>
            <h2 className="text-2xl font-extrabold text-gray-800 mb-1">Set New Password</h2>
            <p className="text-sm text-gray-500 mb-6">Choose a strong password for your account</p>
            {forgotErr && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm mb-4">{forgotErr}</div>}
            <div className="mb-3">
              <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">New Password</label>
              <PasswordInput
                value={forgotPwd}
                onChange={(v) => setForgotPwd(v)}
                showStrength
                placeholder="Min 8 chars"
                autoComplete="new-password"
                disabled={forgotBusy}
              />
            </div>
            <div className="mb-5">
              <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Confirm Password</label>
              <PasswordInput
                value={forgotCfm}
                onChange={(v) => setForgotCfm(v)}
                placeholder="Re-enter password"
                autoComplete="new-password"
                disabled={forgotBusy}
              />
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

  /* ── Forgot password overlay takes priority ───────────────────────────── */
  if (forgotStep) return <ForgotCard />;

  /* ── Inject CSS to override LoginScreen's fullscreen wrapper ─────────── */
  const loginScreenOverride = `
    .vlc { min-height: unset !important; background: transparent !important; padding: 0 !important; width: 100% !important; align-items: stretch !important; }
  `;

  return (
    <div className="min-h-screen flex">
      <style>{loginScreenOverride}</style>

      {/* ── Left branding panel ────────────────────────────────────────── */}
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
            {FEATURES.map((f) => (
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

      {/* ── Right: LoginScreen + forgot password link ───────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center bg-white px-6 py-10">
        <div className="w-full max-w-md">
          <LoginScreen
            role="vendor"
            className="vlc"
            title="Welcome back 👋"
            onSuccess={handleSuccess}
            onRegisterPress={() => {
              const looksLikePhone = /^[\d\s\-+()]{7,15}$/.test("");
              navigate(looksLikePhone ? `/register?phone=${encodeURIComponent(canonicalizePhone(""))}` : "/register");
            }}
            enableSocial={!!(vendorAuth.google || vendorAuth.facebook)}
          />
          <div className="text-center mt-3">
            <button
              onClick={() => { setForgotStep("forgot"); setForgotId(""); }}
              className="text-sm text-orange-600 hover:text-orange-700 font-semibold"
            >
              Forgot your password?
            </button>
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

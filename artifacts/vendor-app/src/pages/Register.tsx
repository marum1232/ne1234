import { useState, useEffect, useRef, useCallback } from "react";
import { AlertCircle, Phone, Mail, Camera, CheckCircle2, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { api } from "../lib/api";
import { usePlatformConfig, getVendorAuthConfig } from "../lib/useConfig";
import { useLanguage } from "../lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { executeCaptcha } from "@workspace/auth-utils";
import { OtpInput, PhoneInput } from "@workspace/auth-react";
import { getDeviceFingerprint } from "../lib/deviceFingerprint";

interface UploadedDoc { label: string; url: string; preview: string; }

const STORE_CATS = ["Grocery","Restaurant","Bakery","Pharmacy","Electronics","Clothing","General Store","Fast Food","Fruits & Vegetables","Dairy","Meat & Poultry","Other"];
const CITIES = ["Muzaffarabad","Mirpur","Rawalakot","Bagh","Kotli","Bhimber","Jhelum","Rawalpindi","Islamabad","Lahore","Other"];
const BANKS = ["EasyPaisa","JazzCash","MCB","HBL","UBL","Meezan Bank","Bank Alfalah","NBP","Allied Bank","Other"];

/* ── 4 explicit registration steps ──────────────────────────────────────────
   Step 1: "verify"  — phone/email entry + OTP confirmation
   Step 2: "store"   — store name, category, city, address, owner name, username
   Step 3: "docs"    — CNIC number, storefront photo, CNIC front + back
   Step 4: "bank"    — bank/wallet details (optional; can be skipped)
   Done:   "done"    — success screen
   ────────────────────────────────────────────────────────────────────────── */
type RegStep = "verify" | "verify-otp" | "store" | "docs" | "bank" | "done";

const STEP_LABELS: Record<RegStep, string> = {
  "verify":     "Verify Identity",
  "verify-otp": "Confirm OTP",
  "store":      "Store Details",
  "docs":       "Verification Docs",
  "bank":       "Bank / Wallet",
  "done":       "Done",
};
const STEP_NUMS: Partial<Record<RegStep, number>> = {
  "verify": 1, "verify-otp": 1, "store": 2, "docs": 3, "bank": 4,
};
const TOTAL_STEPS = 4;

const INPUT_CLS = "w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-orange-400 transition-all";
const SELECT_CLS = "w-full h-12 px-3 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-orange-400 transition-all appearance-none";
const LABEL_CLS = "text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider";

export default function Register() {
  const [, navigate] = useLocation();
  const { config } = usePlatformConfig();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const vendorAuth = getVendorAuthConfig(config);
  const appName = config.platform.appName;
  const businessAddress = config.platform.businessAddress;
  const vendorEarningsPct = Math.round(100 - (config.platform.vendorCommissionPct ?? 15));

  const FEATURES = [
    { icon: "📦", titleKey: "orderManagement" as TranslationKey,   descKey: "manageOrdersDesc" as TranslationKey },
    { icon: "🍽️", titleKey: "productControl" as TranslationKey,    descKey: "productControlDesc" as TranslationKey },
    { icon: "💰", titleKey: "instantEarnings" as TranslationKey,   descKey: "instantEarningsDesc" as TranslationKey },
    { icon: "🎟️", titleKey: "promoCodes" as TranslationKey,        descKey: "promoCodesDesc" as TranslationKey },
  ];

  const [step, setStep] = useState<RegStep>("verify");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const clearError = () => setError("");

  const allowPhone = vendorAuth.phoneOtp;
  const allowEmail = vendorAuth.emailOtp;
  const requireDocuments = !!config.vendor.requireDocuments;

  /* ── Step 1: Verify identity ──────────────────────────────────────────── */
  const urlPhone = new URLSearchParams(window.location.search).get("phone") ?? "";
  const [phoneE164, setPhoneE164] = useState(urlPhone ? `+92${urlPhone.replace(/^0/, "")}` : "");
  const [phoneLocal, setPhoneLocal] = useState(urlPhone);
  const [email, setEmail]   = useState("");
  const [devOtp, setDevOtp] = useState("");

  const getCaptchaToken = async (action: string): Promise<string | undefined> => {
    if (!vendorAuth.captchaEnabled) return undefined;
    try { return await executeCaptcha(action, vendorAuth.captchaSiteKey); } catch { return undefined; }
  };

  const sendOtp = async () => {
    if (allowPhone) {
      if (!phoneE164 || phoneE164.length < 8) { setError("Enter a valid phone number"); return; }
      setLoading(true); clearError();
      try {
        const captchaToken = await getCaptchaToken("register_phone_otp");
        const res = await api.sendOtp(phoneE164, undefined, captchaToken) as { otp?: string; otpRequired?: boolean };
        if (res.otpRequired === false) { setStep("store"); setLoading(false); return; }
        setDevOtp(res.otp || "");
        setStep("verify-otp");
      } catch (e) { setError(e instanceof Error ? e.message : "Failed to send OTP"); }
      setLoading(false);
    } else if (allowEmail) {
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setError("Enter a valid email address"); return;
      }
      setLoading(true); clearError();
      try {
        const res = await api.sendEmailOtp(email) as { otp?: string };
        setDevOtp(res.otp || "");
        setStep("verify-otp");
      } catch (e) { setError(e instanceof Error ? e.message : "Failed to send OTP"); }
      setLoading(false);
    } else {
      setStep("store");
    }
  };

  const verifyOtp = async (otp: string) => {
    setLoading(true); clearError();
    try {
      if (allowPhone) {
        const res = await api.verifyOtp(phoneE164, otp, getDeviceFingerprint()) as { token?: string; refreshToken?: string };
        if (res.token) api.storeTokens(res.token, res.refreshToken);
      } else {
        const res = await api.verifyEmailOtp(email, otp, getDeviceFingerprint()) as { token?: string; refreshToken?: string };
        if (res.token) api.storeTokens(res.token, res.refreshToken);
      }
      setStep("store");
    } catch (e) { setError(e instanceof Error ? e.message : "Verification failed"); }
    setLoading(false);
  };

  /* ── Step 2: Store details ────────────────────────────────────────────── */
  const [storeName, setStoreName]     = useState("");
  const [storeCategory, setStoreCat]  = useState("");
  const [ownerName, setOwnerName]     = useState("");
  const [city, setCity]               = useState("");
  const [address, setAddress]         = useState("");
  const [username, setUsername]       = useState("");
  const [usernameStatus, setUsernameStatus] = useState<"idle"|"checking"|"available"|"taken">("idle");
  const usernameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const usernameAbort = useRef<AbortController | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);

  useEffect(() => {
    if (!username || username.length < 3) { setUsernameStatus("idle"); return; }
    if (usernameTimer.current) clearTimeout(usernameTimer.current);
    usernameTimer.current = setTimeout(async () => {
      if (usernameAbort.current) usernameAbort.current.abort();
      usernameAbort.current = new AbortController();
      setUsernameStatus("checking");
      try {
        const res = await api.checkAvailable({ username }, usernameAbort.current?.signal);
        setUsernameStatus(res.username && !res.username.available ? "taken" : "available");
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") return;
        setUsernameStatus("taken");
      }
    }, 600);
    return () => {
      if (usernameTimer.current) clearTimeout(usernameTimer.current);
      if (usernameAbort.current) usernameAbort.current.abort();
    };
  }, [username]);

  useEffect(() => {
    if (ownerName && !username) {
      const suggested = ownerName.trim().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
      if (suggested.length >= 3) setUsername(suggested);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerName]);

  const advanceToStep3 = () => {
    if (!storeName.trim()) { setError("Store name is required"); return; }
    if (!ownerName.trim()) { setError("Your name is required"); return; }
    if (!username || username.length < 3) { setError("Username is required (min 3 chars)"); return; }
    if (usernameStatus === "taken") { setError("Username is already taken"); return; }
    if (usernameStatus === "checking") { setError("Please wait for username check to complete"); return; }
    if (!termsAccepted) { setError("Please accept the Terms & Conditions to continue"); return; }
    clearError();
    setStep("docs");
  };

  /* ── Step 3: Verification documents ──────────────────────────────────── */
  const [docStorefront, setDocStorefront] = useState<UploadedDoc | null>(null);
  const [docCnicFront,  setDocCnicFront]  = useState<UploadedDoc | null>(null);
  const [docCnicBack,   setDocCnicBack]   = useState<UploadedDoc | null>(null);
  const [cnic, setCnic]           = useState("");
  const [optimisingDoc, setOptimisingDoc] = useState("");
  const [uploadingDoc,  setUploadingDoc]  = useState("");
  const [docErrors, setDocErrors] = useState<Record<string, string>>({});

  const handleDocUpload = useCallback(async (file: File, field: string, setter: (doc: UploadedDoc) => void) => {
    const preview = URL.createObjectURL(file);
    setDocErrors(prev => { const next = { ...prev }; delete next[field]; return next; });
    setOptimisingDoc(field);
    try {
      setOptimisingDoc(""); setUploadingDoc(field);
      const res = await api.uploadRegistrationDoc(file);
      setter({ label: file.name, url: res.url, preview });
    } catch (e) {
      setDocErrors(prev => ({ ...prev, [field]: e instanceof Error ? e.message : "Upload failed" }));
    } finally { setOptimisingDoc(""); setUploadingDoc(""); }
  }, []);

  const advanceToStep4 = () => {
    if (requireDocuments) {
      if (!docStorefront?.url) { setError("Store front photo is required"); return; }
      if (!docCnicFront?.url)  { setError("CNIC front photo is required"); return; }
      if (!docCnicBack?.url)   { setError("CNIC back photo is required"); return; }
    }
    clearError();
    setStep("bank");
  };

  /* ── Step 4: Bank / wallet details (optional) ─────────────────────────── */
  const [bankName, setBankName]     = useState("");
  const [bankAccount, setBankAcc]   = useState("");
  const [bankTitle, setBankTitle]   = useState("");

  const submitRegistration = async () => {
    setLoading(true); clearError();
    try {
      const termsVersion = config.compliance?.termsVersion;
      const docsPayload = requireDocuments || docStorefront?.url || docCnicFront?.url || docCnicBack?.url
        ? { files: [
            ...(docStorefront?.url ? [{ type: "store_front", url: docStorefront.url, label: "Store Front" }] : []),
            ...(docCnicFront?.url  ? [{ type: "cnic_front",  url: docCnicFront.url,  label: "CNIC Front"  }] : []),
            ...(docCnicBack?.url   ? [{ type: "cnic_back",   url: docCnicBack.url,   label: "CNIC Back"   }] : []),
          ]}
        : undefined;
      const res = await api.vendorRegister({
        ...(allowPhone && phoneE164 ? { phone: phoneE164 } : {}),
        ...(allowEmail && email     ? { email }           : {}),
        storeName, storeCategory, name: ownerName, cnic, address, city,
        ...(bankName    ? { bankName }    : {}),
        ...(bankAccount ? { bankAccount } : {}),
        ...(bankTitle   ? { bankAccountTitle: bankTitle } : {}),
        username: username.trim(),
        ...(termsVersion && { acceptedTermsVersion: termsVersion }),
        ...(docsPayload  ? { documents: JSON.stringify(docsPayload) } : {}),
      });
      if ((res as { status?: string }).status === "approved") {
        navigate("/");
      } else {
        setStep("done");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Registration failed"); }
    setLoading(false);
  };

  /* ── Registration closed guard ─────────────────────────────────────────── */
  if (!config.features.newUsers) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-800 via-orange-700 to-amber-700 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl">
          <div className="text-5xl mb-4">🔒</div>
          <h2 className="text-2xl font-extrabold text-gray-800 mb-3">Registration Closed</h2>
          <p className="text-gray-500 text-sm mb-5">New vendor registrations are not available. Contact support for more information.</p>
          {(config.platform.supportPhone || config.platform.supportEmail) && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-left mb-5">
              <p className="text-xs font-bold text-gray-400 uppercase mb-1">Contact Support</p>
              {config.platform.supportPhone && <p className="text-sm font-bold text-gray-700">{config.platform.supportPhone}</p>}
              {config.platform.supportEmail && <p className="text-xs text-gray-500 mt-0.5">{config.platform.supportEmail}</p>}
            </div>
          )}
          <button onClick={() => navigate("/")}
            className="w-full h-12 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-2xl text-sm">
            ← Back to Login
          </button>
        </div>
      </div>
    );
  }

  /* ── Success screen ────────────────────────────────────────────────────── */
  if (step === "done") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-800 via-orange-700 to-amber-700 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-2xl font-extrabold text-gray-800 mb-3">Application Submitted!</h2>
          <p className="text-gray-500 text-sm mb-5">
            Your vendor registration for <strong className="text-gray-700">{storeName}</strong> has been submitted. Admin will review and approve your account.
          </p>
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-5 text-left space-y-1.5">
            <p className="text-orange-700 text-xs font-bold mb-1">📋 What happens next:</p>
            <p className="text-orange-600 text-xs">1. Admin reviews your application</p>
            <p className="text-orange-600 text-xs">2. You'll be notified once approved</p>
            <p className="text-orange-600 text-xs">3. Login with your phone to start selling</p>
          </div>
          <button onClick={() => navigate("/")}
            className="w-full h-12 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-2xl text-sm">
            ← Back to Login
          </button>
        </div>
      </div>
    );
  }

  /* ── Main layout ───────────────────────────────────────────────────────── */
  const currentStepNum = STEP_NUMS[step] ?? 1;

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* ── Left branding panel ────────────────────────────────────────── */}
      <div className="hidden md:flex md:w-1/2 lg:w-2/5 bg-gradient-to-br from-orange-700 via-orange-600 to-amber-600 flex-col justify-between p-10 relative overflow-hidden flex-shrink-0">
        <div className="absolute -top-24 -right-24 w-80 h-80 bg-white/10 rounded-full pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-64 h-64 bg-amber-300/10 rounded-full pointer-events-none" />
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-12 h-12 bg-white/15 backdrop-blur-sm rounded-2xl flex items-center justify-center border border-white/20 shadow-lg">
            <span className="text-2xl">🏪</span>
          </div>
          <div>
            <p className="text-white font-extrabold text-xl leading-tight">{appName}</p>
            <p className="text-orange-200 text-sm font-medium">Vendor Registration</p>
          </div>
        </div>
        <div className="relative z-10">
          <h1 className="text-4xl lg:text-5xl font-extrabold text-white leading-tight mb-4">
            Start Selling on<br /><span className="text-orange-200">{appName}</span>
          </h1>
          <p className="text-orange-100 text-lg font-medium mb-10 leading-relaxed">
            Register your store and reach thousands of customers.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {FEATURES.map(f => (
              <div key={f.titleKey} className="bg-white/15 backdrop-blur-sm rounded-2xl p-4 border border-white/10">
                <span className="text-2xl mb-2 block">{f.icon}</span>
                <p className="text-white font-bold text-sm">{T(f.titleKey)}</p>
                <p className="text-orange-100 text-xs mt-0.5">{T(f.descKey)}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="relative z-10 text-orange-300 text-sm">
          © {new Date().getFullYear()} {appName} · {businessAddress} · Keep {vendorEarningsPct}% earnings
        </p>
      </div>

      {/* ── Right: step form ───────────────────────────────────────────── */}
      <div className="flex-1 bg-slate-50 flex flex-col items-center justify-center px-5 py-10 md:px-12 overflow-y-auto">
        {/* Mobile header */}
        <div className="md:hidden text-center mb-6">
          <div className="w-16 h-16 bg-orange-600 rounded-[20px] flex items-center justify-center mx-auto mb-3">
            <span className="text-3xl">🏪</span>
          </div>
          <h1 className="text-2xl font-extrabold text-gray-800">Become a Vendor</h1>
          <p className="text-gray-500 mt-1 text-sm">{appName} Business Partner</p>
        </div>

        <div className="w-full max-w-sm">
          {/* Desktop step header */}
          <div className="hidden md:block mb-6">
            <h2 className="text-2xl font-extrabold text-gray-900">Register Your Store</h2>
            <p className="text-gray-500 mt-1 text-sm">
              Step {currentStepNum} of {TOTAL_STEPS} — {STEP_LABELS[step]}
            </p>
          </div>

          {/* Step progress bar */}
          <div className="flex items-center gap-1.5 mb-6">
            {[1, 2, 3, 4].map(n => (
              <div key={n} className={`h-1.5 flex-1 rounded-full transition-all ${n <= currentStepNum ? "bg-orange-500" : "bg-gray-200"}`} />
            ))}
            <span className="text-xs text-gray-400 font-semibold ml-1 whitespace-nowrap">
              {currentStepNum}/{TOTAL_STEPS}
            </span>
          </div>

          <div className="bg-white rounded-3xl p-6 shadow-2xl">

            {/* ── STEP 1: Verify identity ─────────────────────────────── */}
            {step === "verify" && (
              <>
                <h2 className="text-lg font-extrabold text-gray-800 mb-1">
                  {allowPhone ? "Verify Phone Number" : allowEmail ? "Verify Email Address" : "Register Your Store"}
                </h2>
                <p className="text-sm text-gray-500 mb-4">
                  {(allowPhone || allowEmail) ? "We'll send a one-time code to verify your identity" : "Fill in your store details to get started"}
                </p>

                {allowPhone && (
                  <div className="mb-4">
                    <label className={LABEL_CLS}>Phone Number</label>
                    <PhoneInput
                      value={phoneLocal}
                      onChange={(e164, local) => { setPhoneE164(e164); setPhoneLocal(local); }}
                      disabled={loading}
                    />
                  </div>
                )}

                {allowEmail && !allowPhone && (
                  <div className="mb-4">
                    <label className={LABEL_CLS}>Email Address</label>
                    <div className="relative">
                      <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      <input
                        type="email" value={email}
                        onChange={e => setEmail(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && sendOtp()}
                        placeholder="you@example.com"
                        className={`${INPUT_CLS} pl-10`}
                        autoCapitalize="none" autoFocus
                      />
                    </div>
                  </div>
                )}

                {error && (
                  <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
                    <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-red-600 text-sm font-medium">{error}</p>
                  </div>
                )}

                <button onClick={sendOtp} disabled={loading}
                  className="w-full h-12 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-2xl disabled:opacity-60 flex items-center justify-center gap-2 text-sm mt-2">
                  {loading ? <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />Sending...</> : "Send OTP →"}
                </button>
              </>
            )}

            {/* ── STEP 1 (OTP): Confirm code ─────────────────────────── */}
            {step === "verify-otp" && (
              <>
                <button onClick={() => { setStep("verify"); clearError(); }}
                  className="text-orange-600 text-sm font-bold mb-4 flex items-center gap-1.5 hover:text-orange-700">← Back</button>
                <h2 className="text-lg font-extrabold text-gray-800 mb-1">{T("enterOtp")}</h2>
                <p className="text-sm text-gray-500 mb-3">
                  {T("sentTo_")} <strong className="text-gray-700">{allowPhone ? phoneE164 : email}</strong>
                </p>
                {import.meta.env.DEV && devOtp && (
                  <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2 mb-3">
                    <p className="text-xs text-orange-600 font-bold uppercase tracking-wide mb-0.5">{T("devOtp")}</p>
                    <p className="text-orange-700 font-extrabold text-xl tracking-[0.4em]">{devOtp}</p>
                  </div>
                )}
                {error && (
                  <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
                    <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-red-600 text-sm">{error}</p>
                  </div>
                )}
                <OtpInput
                  length={6}
                  onComplete={verifyOtp}
                  onResend={sendOtp}
                  resendCooldownSeconds={60}
                  disabled={loading}
                  label="Enter your 6-digit code"
                  autoSubmit
                />
                <p className="text-center text-xs text-gray-400 mt-2">
                  {loading ? "Verifying..." : "Enter all 6 digits to continue automatically"}
                </p>
              </>
            )}

            {/* ── STEP 2: Store details ───────────────────────────────── */}
            {step === "store" && (
              <>
                <h2 className="text-lg font-extrabold text-gray-800 mb-1">Store Details</h2>
                <p className="text-sm text-gray-500 mb-4">Tell us about your business</p>

                <div className="space-y-3">
                  <div>
                    <label className={LABEL_CLS}>Store Name *</label>
                    <input value={storeName} onChange={e => setStoreName(e.target.value)}
                      placeholder="e.g. Ali's Grocery Store" className={INPUT_CLS} autoFocus />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Store Category</label>
                    <select value={storeCategory} onChange={e => setStoreCat(e.target.value)} className={SELECT_CLS}>
                      <option value="">Select category...</option>
                      {STORE_CATS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Your Full Name *</label>
                    <input value={ownerName} onChange={e => setOwnerName(e.target.value)}
                      placeholder="Muhammad Ali" className={INPUT_CLS} />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Username *</label>
                    <div className="relative">
                      <input value={username}
                        onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20))}
                        placeholder="e.g. alistore" className={`${INPUT_CLS} pr-10`}
                        autoCapitalize="none" autoCorrect="off" />
                      {usernameStatus === "checking"  && <span className="absolute right-3 top-3.5 text-xs">⏳</span>}
                      {usernameStatus === "available" && <span className="absolute right-3 top-3.5 text-orange-500 font-bold text-sm">✓</span>}
                      {usernameStatus === "taken"     && <span className="absolute right-3 top-3.5 text-red-500 font-bold text-sm">✗</span>}
                    </div>
                    {usernameStatus === "taken" && <p className="text-[10px] text-red-500 mt-0.5">Username already taken</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={LABEL_CLS}>City</label>
                      <select value={city} onChange={e => setCity(e.target.value)} className={SELECT_CLS}>
                        <option value="">Select...</option>
                        {(config.cities?.length ? config.cities : CITIES).map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Store Address</label>
                      <input value={address} onChange={e => setAddress(e.target.value)}
                        placeholder="Full address..." className={INPUT_CLS} />
                    </div>
                  </div>

                  <label className="flex items-start gap-3 pt-1 cursor-pointer select-none">
                    <input type="checkbox" checked={termsAccepted}
                      onChange={e => setTermsAccepted(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-orange-500 flex-shrink-0 cursor-pointer" />
                    <span className="text-xs text-gray-500 leading-relaxed">
                      I agree to the{" "}
                      {config.content.tncUrl
                        ? <a href={config.content.tncUrl} target="_blank" rel="noopener noreferrer" className="text-orange-600 font-semibold hover:underline">Terms & Conditions</a>
                        : <span className="text-orange-600 font-semibold">Terms & Conditions</span>}
                      {config.content.privacyUrl
                        ? <> and <a href={config.content.privacyUrl} target="_blank" rel="noopener noreferrer" className="text-orange-600 font-semibold hover:underline">Privacy Policy</a></>
                        : null}
                    </span>
                  </label>
                </div>

                {error && (
                  <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
                    <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-red-600 text-sm">{error}</p>
                  </div>
                )}

                <button onClick={advanceToStep3} disabled={loading}
                  className="w-full h-12 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-2xl disabled:opacity-60 flex items-center justify-center gap-2 text-sm mt-4">
                  Continue →
                </button>
              </>
            )}

            {/* ── STEP 3: Verification documents ─────────────────────── */}
            {step === "docs" && (
              <>
                <button onClick={() => { setStep("store"); clearError(); }}
                  className="text-orange-600 text-sm font-bold mb-4 flex items-center gap-1.5 hover:text-orange-700">← Back</button>
                <h2 className="text-lg font-extrabold text-gray-800 mb-1">Verification Documents</h2>
                <p className="text-sm text-gray-500 mb-4">
                  {requireDocuments ? "Required for account approval. Photos must be clear and readable." : "Optional — upload to speed up approval."}
                </p>

                <div className="space-y-3">
                  <div>
                    <label className={LABEL_CLS}>CNIC Number</label>
                    <input value={cnic} onChange={e => setCnic(e.target.value)}
                      placeholder="xxxxx-xxxxxxx-x" className={INPUT_CLS} inputMode="numeric" />
                  </div>

                  {([
                    { field: "storefront", label: "Store Front Photo *", hint: "Photo of your store entrance", doc: docStorefront, setter: setDocStorefront },
                    { field: "cnicFront",  label: "CNIC Front *",        hint: "Front side of your CNIC",    doc: docCnicFront,  setter: setDocCnicFront  },
                    { field: "cnicBack",   label: "CNIC Back *",         hint: "Back side of your CNIC",     doc: docCnicBack,   setter: setDocCnicBack   },
                  ] as const).map(({ field, label, hint, doc, setter }) => {
                    const isBusy = optimisingDoc === field || uploadingDoc === field;
                    const err = docErrors[field];
                    return (
                      <div key={field}>
                        <label className={LABEL_CLS}>{label}</label>
                        <label className={`flex items-center gap-3 h-14 px-4 rounded-xl border-2 cursor-pointer transition-all ${
                          doc ? "border-orange-400 bg-orange-50" : err ? "border-red-300 bg-red-50" : "border-dashed border-gray-300 bg-gray-50 hover:border-orange-300 hover:bg-orange-50"
                        }`}>
                          <input type="file" accept="image/*" capture="environment" className="hidden" disabled={isBusy}
                            onChange={e => {
                              const f = e.target.files?.[0];
                              if (f) handleDocUpload(f, field, setter as (d: UploadedDoc) => void);
                              e.target.value = "";
                            }} />
                          {isBusy ? <Loader2 size={18} className="text-orange-500 animate-spin flex-shrink-0" />
                            : doc ? <CheckCircle2 size={18} className="text-orange-500 flex-shrink-0" />
                            : <Camera size={18} className="text-gray-400 flex-shrink-0" />}
                          <div className="flex-1 min-w-0">
                            {doc
                              ? <p className="text-xs font-semibold text-orange-700 truncate">{doc.label}</p>
                              : <p className="text-xs text-gray-500 truncate">{isBusy ? (optimisingDoc === field ? "Optimising…" : "Uploading…") : hint}</p>}
                          </div>
                          {doc?.preview && <img src={doc.preview} alt="" className="h-9 w-9 object-cover rounded-lg flex-shrink-0 border border-orange-200" />}
                        </label>
                        {err && <p className="text-[10px] text-red-500 mt-0.5">{err}</p>}
                      </div>
                    );
                  })}
                </div>

                {error && (
                  <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
                    <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-red-600 text-sm">{error}</p>
                  </div>
                )}

                <button onClick={advanceToStep4} disabled={loading}
                  className="w-full h-12 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-2xl disabled:opacity-60 flex items-center justify-center gap-2 text-sm mt-4">
                  Continue →
                </button>
                {!requireDocuments && (
                  <button onClick={() => { clearError(); setStep("bank"); }}
                    className="w-full mt-2 text-sm text-gray-400 hover:text-orange-600 font-medium py-2 transition-colors">
                    Skip for now →
                  </button>
                )}
              </>
            )}

            {/* ── STEP 4: Bank / wallet details ──────────────────────── */}
            {step === "bank" && (
              <>
                <button onClick={() => { setStep("docs"); clearError(); }}
                  className="text-orange-600 text-sm font-bold mb-4 flex items-center gap-1.5 hover:text-orange-700">← Back</button>
                <h2 className="text-lg font-extrabold text-gray-800 mb-1">Bank / Wallet Details</h2>
                <p className="text-sm text-gray-500 mb-4">Optional — used for earnings payouts. You can add these later from your profile.</p>

                <div className="space-y-3">
                  <div>
                    <label className={LABEL_CLS}>Bank / Wallet</label>
                    <select value={bankName} onChange={e => setBankName(e.target.value)} className={SELECT_CLS}>
                      <option value="">Select...</option>
                      {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Account Number</label>
                    <input value={bankAccount} onChange={e => setBankAcc(e.target.value)}
                      placeholder="Account # or phone number" className={INPUT_CLS} />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Account Holder Name</label>
                    <input value={bankTitle} onChange={e => setBankTitle(e.target.value)}
                      placeholder="Account holder's full name" className={INPUT_CLS} />
                  </div>
                </div>

                {error && (
                  <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
                    <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-red-600 text-sm">{error}</p>
                  </div>
                )}

                <button onClick={submitRegistration} disabled={loading}
                  className="w-full h-12 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-2xl disabled:opacity-60 flex items-center justify-center gap-2 text-sm mt-4">
                  {loading ? <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />Submitting...</> : "Submit Application ✓"}
                </button>
                <button onClick={submitRegistration} disabled={loading}
                  className="w-full mt-2 text-sm text-gray-400 hover:text-orange-600 font-medium py-2 transition-colors">
                  Skip bank details & submit
                </button>
              </>
            )}

            <button onClick={() => navigate("/")}
              className="w-full mt-3 text-sm text-gray-400 hover:text-orange-600 font-medium py-2 transition-colors">
              ← Already have an account? Login
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

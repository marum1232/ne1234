import { useState, useEffect, useRef, useCallback } from "react";
import { AlertCircle, Phone, Mail, Camera, CheckCircle2, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { api } from "../lib/api";
import { usePlatformConfig, getVendorAuthConfig } from "../lib/useConfig";
import { useLanguage } from "../lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { executeCaptcha } from "@workspace/auth-utils";
import { OtpInput } from "@workspace/auth-react";

interface UploadedDoc { label: string; url: string; preview: string; }

const STORE_CATS = ["Grocery","Restaurant","Bakery","Pharmacy","Electronics","Clothing","General Store","Fast Food","Fruits & Vegetables","Dairy","Meat & Poultry","Other"];
const CITIES = ["Muzaffarabad","Mirpur","Rawalakot","Bagh","Kotli","Bhimber","Jhelum","Rawalpindi","Islamabad","Lahore","Other"];
const BANKS = ["EasyPaisa","JazzCash","MCB","HBL","UBL","Meezan Bank","Bank Alfalah","NBP","Allied Bank","Other"];

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

type RegStep = "register" | "register-otp" | "register-info" | "register-submitted";

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

  const [step, setStep] = useState<RegStep>("register");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const clearError = () => setError("");

  const urlPhone = new URLSearchParams(window.location.search).get("phone") ?? "";
  const [regPhone, setRegPhone] = useState(urlPhone);
  const [regPhoneError, setRegPhoneError] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regEmailError, setRegEmailError] = useState("");
  const [regDevOtp, setRegDevOtp] = useState("");
  const [regEmailDevOtp, setRegEmailDevOtp] = useState("");
  const [regForm, setRegForm] = useState({
    storeName: "", storeCategory: "", name: "", cnic: "", address: "", city: "",
    bankName: "", bankAccount: "", bankAccountTitle: "",
  });
  const rf = (k: string, v: string) => setRegForm(p => ({ ...p, [k]: v }));

  const [docStorefront, setDocStorefront] = useState<UploadedDoc | null>(null);
  const [docCnicFront, setDocCnicFront] = useState<UploadedDoc | null>(null);
  const [docCnicBack, setDocCnicBack] = useState<UploadedDoc | null>(null);
  const [optimisingDoc, setOptimisingDoc] = useState("");
  const [uploadingDoc, setUploadingDoc] = useState("");
  const [docUploadErrors, setDocUploadErrors] = useState<Record<string, string>>({});

  const [regUsername, setRegUsername] = useState("");
  const [regUsernameStatus, setRegUsernameStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const regUsernameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const regUsernameAbort = useRef<AbortController | null>(null);
  const [regTermsAccepted, setRegTermsAccepted] = useState(false);


  useEffect(() => {
    if (!regUsername || regUsername.length < 3) { setRegUsernameStatus("idle"); return; }
    if (regUsernameTimer.current) clearTimeout(regUsernameTimer.current);
    regUsernameTimer.current = setTimeout(async () => {
      if (regUsernameAbort.current) regUsernameAbort.current.abort();
      regUsernameAbort.current = new AbortController();
      setRegUsernameStatus("checking");
      try {
        const res = await api.checkAvailable({ username: regUsername }, regUsernameAbort.current?.signal);
        if (res.username && !res.username.available) setRegUsernameStatus("taken");
        else setRegUsernameStatus("available");
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") return;
        setRegUsernameStatus("taken");
      }
    }, 600);
    return () => {
      if (regUsernameTimer.current) clearTimeout(regUsernameTimer.current);
      if (regUsernameAbort.current) regUsernameAbort.current.abort();
    };
  }, [regUsername]);

  useEffect(() => {
    if (regForm.name && !regUsername) {
      const suggested = regForm.name.trim().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
      if (suggested.length >= 3) setRegUsername(suggested);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regForm.name]);

  const allowPhone = vendorAuth.phoneOtp;
  const allowEmail = vendorAuth.emailOtp;
  const requireDocuments = !!config.vendor.requireDocuments;

  const isValidRegPhone = (ph: string): boolean => /^03\d{9}$/.test(ph.replace(/[\s\-()+]/g, ""));

  const getCaptchaToken = async (action: string): Promise<string | undefined> => {
    if (!vendorAuth.captchaEnabled) return undefined;
    try { return await executeCaptcha(action, vendorAuth.captchaSiteKey); } catch { return undefined; }
  };

  const sendRegOtp = async () => {
    if (allowPhone) {
      if (!regPhone || !isValidRegPhone(regPhone)) {
        setError("Enter a valid phone number (03XXXXXXXXX)");
        return;
      }
      setLoading(true); clearError();
      try {
        const captchaToken = await getCaptchaToken("register_phone_otp");
        const res = await api.sendOtp(regPhone, undefined, captchaToken);
        if (res.otpRequired === false) {
          if (res.token) api.storeTokens(res.token, res.refreshToken);
          setStep("register-info");
          setLoading(false); return;
        }
        setRegDevOtp(res.otp || "");
        setStep("register-otp");
      } catch (e) { setError(e instanceof Error ? e.message : "Failed to send OTP"); }
      setLoading(false);
    } else if (allowEmail) {
      if (!regEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(regEmail)) {
        setError("Enter a valid email address");
        return;
      }
      setLoading(true); clearError();
      try {
        const res = await api.sendEmailOtp(regEmail);
        setRegEmailDevOtp(res.otp || "");
        setStep("register-otp");
      } catch (e) { setError(e instanceof Error ? e.message : "Failed to send OTP"); }
      setLoading(false);
    } else {
      setStep("register-info");
    }
  };

  const verifyRegOtp = async (otp: string) => {
    setLoading(true); clearError();
    try {
      if (allowPhone) {
        const res = await api.verifyOtp(regPhone, otp, getDeviceFingerprint());
        if (res.token) api.storeTokens(res.token, res.refreshToken);
      } else {
        const res = await api.verifyEmailOtp(regEmail, otp, getDeviceFingerprint());
        if (res.token) api.storeTokens(res.token, res.refreshToken);
      }
      setStep("register-info");
    } catch (e) { setError(e instanceof Error ? e.message : "Verification failed"); }
    setLoading(false);
  };

  const handleDocUpload = useCallback(async (file: File, field: string, setter: (doc: UploadedDoc) => void) => {
    const preview = URL.createObjectURL(file);
    setDocUploadErrors(prev => { const next = { ...prev }; delete next[field]; return next; });
    setOptimisingDoc(field);
    try {
      setOptimisingDoc("");
      setUploadingDoc(field);
      const res = await api.uploadRegistrationDoc(file);
      setter({ label: file.name, url: res.url, preview });
    } catch (e) {
      setDocUploadErrors(prev => ({ ...prev, [field]: e instanceof Error ? e.message : "Upload failed" }));
    } finally {
      setOptimisingDoc("");
      setUploadingDoc("");
    }
  }, []);

  const submitRegistration = async () => {
    if (!regForm.storeName.trim()) { setError("Store name is required"); return; }
    if (!regForm.name.trim()) { setError("Your name is required"); return; }
    if (!regUsername || regUsername.length < 3) { setError("Username is required (min 3 characters)"); return; }
    if (regUsernameStatus === "taken") { setError("Username is already taken"); return; }
    if (regUsernameStatus !== "available") { setError("Please wait for username availability check"); return; }
    if (!regTermsAccepted) { setError("Please accept the Terms & Conditions to continue"); return; }
    if (requireDocuments) {
      if (!docStorefront?.url) { setError("Store front photo is required"); return; }
      if (!docCnicFront?.url) { setError("CNIC front photo is required"); return; }
      if (!docCnicBack?.url) { setError("CNIC back photo is required"); return; }
    }
    setLoading(true); clearError();
    try {
      const termsVersion = config.compliance?.termsVersion;
      const docsPayload = requireDocuments || docStorefront?.url || docCnicFront?.url || docCnicBack?.url
        ? { files: [
            ...(docStorefront?.url  ? [{ type: "store_front",  url: docStorefront.url,  label: "Store Front" }]  : []),
            ...(docCnicFront?.url   ? [{ type: "cnic_front",   url: docCnicFront.url,   label: "CNIC Front" }]   : []),
            ...(docCnicBack?.url    ? [{ type: "cnic_back",    url: docCnicBack.url,    label: "CNIC Back" }]    : []),
          ]}
        : undefined;
      const res = await api.vendorRegister({
        ...(allowPhone && regPhone ? { phone: regPhone } : {}),
        ...(allowEmail && regEmail ? { email: regEmail } : {}),
        ...regForm,
        username: regUsername.trim(),
        ...(termsVersion && { acceptedTermsVersion: termsVersion }),
        ...(docsPayload ? { documents: JSON.stringify(docsPayload) } : {}),
      });
      if (res.status === "approved") {
        navigate("/");
      } else {
        setStep("register-submitted");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Registration failed"); }
    setLoading(false);
  };

  const INPUT_CLS = "w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-orange-400 transition-all";
  const SELECT_CLS = "w-full h-12 px-3 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-orange-400 transition-all appearance-none";
  const LABEL_CLS = "text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider";

  if (!config.features.newUsers) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-800 via-orange-700 to-amber-700 flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute -top-24 -left-24 w-80 h-80 bg-orange-400/10 rounded-full pointer-events-none" />
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl relative z-10">
          <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <span className="text-4xl">🔒</span>
          </div>
          <h2 className="text-2xl font-extrabold text-gray-800 mb-3">Registration Closed</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-5">New vendor registrations are currently not available. Please try again later or contact support.</p>
          {(config.platform.supportPhone || config.platform.supportEmail) && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-left mb-5">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Contact Support</p>
              {config.platform.supportPhone && <p className="text-sm font-bold text-gray-700">{config.platform.supportPhone}</p>}
              {config.platform.supportEmail && <p className="text-xs text-gray-500 mt-0.5">{config.platform.supportEmail}</p>}
            </div>
          )}
          <button onClick={() => navigate("/")}
            className="w-full h-12 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-2xl transition-colors text-sm flex items-center justify-center gap-2 shadow-sm shadow-orange-200">
            ← Back to Login
          </button>
        </div>
      </div>
    );
  }

  if (step === "register-submitted") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-800 via-orange-700 to-amber-700 flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute -top-24 -left-24 w-80 h-80 bg-orange-400/10 rounded-full pointer-events-none" />
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl relative z-10">
          <div className="w-20 h-20 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <span className="text-4xl">✅</span>
          </div>
          <h2 className="text-2xl font-extrabold text-gray-800 mb-3">Application Submitted!</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-5">
            Your vendor registration for <strong className="text-gray-700">{regForm.storeName}</strong> has been submitted successfully. Admin will review and approve your account.
          </p>
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-5 text-left space-y-1.5">
            <p className="text-orange-700 text-xs font-bold mb-1">📋 What happens next:</p>
            <p className="text-orange-600 text-xs">1. Admin reviews your application</p>
            <p className="text-orange-600 text-xs">2. You'll be notified once approved</p>
            <p className="text-orange-600 text-xs">3. Login with your phone to start selling</p>
          </div>
          <button onClick={() => navigate("/")}
            className="w-full h-12 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-2xl transition-colors text-sm flex items-center justify-center gap-2 shadow-sm shadow-orange-200">
            ← Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row" style={{ paddingTop: "env(safe-area-inset-top,0px)" }}>
      <div className="hidden md:flex md:w-1/2 lg:w-2/5 bg-gradient-to-br from-orange-700 via-orange-600 to-amber-600 flex-col justify-between p-10 relative overflow-hidden flex-shrink-0">
        <div className="absolute -top-24 -right-24 w-80 h-80 bg-white/10 rounded-full pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-64 h-64 bg-amber-300/10 rounded-full pointer-events-none" />
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-12 h-12 bg-white/15 backdrop-blur-sm rounded-2xl flex items-center justify-center border border-white/20 shadow-lg"><span className="text-2xl">🏪</span></div>
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
            Register your store and reach thousands of customers. Manage orders, products, and earnings — all in one place.
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
        <div className="relative z-10">
          <p className="text-orange-300 text-sm">© {new Date().getFullYear()} {appName} · {businessAddress} · Keep {vendorEarningsPct}% earnings</p>
        </div>
      </div>

      <div className="flex-1 bg-gradient-to-br from-orange-700 to-amber-600 md:bg-none md:bg-slate-50 flex flex-col items-center justify-center px-5 py-10 md:px-12 relative overflow-y-auto">
        <div className="md:hidden absolute top-0 right-0 w-48 h-48 bg-white/10 rounded-full -translate-y-16 translate-x-16 pointer-events-none" />

        <div className="w-full max-w-sm relative z-10">
          <div className="text-center mb-6 md:hidden">
            <div className="w-16 h-16 bg-white/20 rounded-[20px] flex items-center justify-center mx-auto mb-3 border border-white/30"><span className="text-3xl">🏪</span></div>
            <h1 className="text-2xl font-extrabold text-white">Become a Vendor</h1>
            <p className="text-orange-100 mt-1 font-medium text-sm">{appName} Business Partner</p>
          </div>

          <div className="hidden md:block mb-6">
            <h2 className="text-2xl font-extrabold text-gray-900">Register Your Store</h2>
            <p className="text-gray-500 mt-1 text-sm">
              {step === "register" ? "Step 1 of 2 — Verify your phone" :
               step === "register-otp" ? "Step 1 of 2 — Enter OTP to verify" :
               "Step 2 of 2 — Fill your store details"}
            </p>
          </div>

          <div className="bg-white rounded-3xl p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-5">
              <div className="flex gap-1.5">
                <div className={`h-1.5 rounded-full transition-all ${step === "register" || step === "register-otp" ? "w-10 bg-orange-500" : "w-10 bg-orange-400"}`} />
                <div className={`h-1.5 rounded-full transition-all ${step === "register-info" ? "w-10 bg-orange-500" : "w-10 bg-gray-200"}`} />
              </div>
              <span className="text-xs text-gray-400 font-semibold">
                {step === "register" || step === "register-otp" ? "Step 1 of 2" : "Step 2 of 2"}
              </span>
            </div>

            {step === "register" && (
              <>
                <h2 className="text-lg font-extrabold text-gray-800 mb-1">
                  {allowPhone ? "Verify Phone Number" : allowEmail ? "Verify Email Address" : "Register Your Store"}
                </h2>
                <p className="text-sm text-gray-500 mb-4">
                  {(allowPhone || allowEmail) ? "We'll send an OTP to verify your identity" : "Fill in your store details to complete registration"}
                </p>

                {allowPhone && (
                  <>
                    <label className={LABEL_CLS}>Phone Number</label>
                    <div className="relative mb-1">
                      <Phone size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      <input
                        type="tel"
                        placeholder="03001234567"
                        inputMode="numeric"
                        value={regPhone}
                        onChange={e => {
                          const val = e.target.value.replace(/[^\d+\-\s()]/g, "");
                          setRegPhone(val);
                          setRegPhoneError("");
                        }}
                        onKeyDown={e => e.key === "Enter" && sendRegOtp()}
                        className={`${INPUT_CLS} pl-10 ${regPhoneError ? "border-red-400 focus:ring-red-400" : ""}`}
                        autoFocus={!!allowPhone} autoComplete="tel" />
                    </div>
                    {regPhoneError && <p className="text-xs text-red-500 mb-3">{regPhoneError}</p>}
                    {!regPhoneError && <div className="mb-3" />}
                  </>
                )}

                {allowEmail && (
                  <>
                    <label className={LABEL_CLS}>Email Address</label>
                    <div className="relative mb-1">
                      <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      <input
                        type="email"
                        placeholder="you@example.com"
                        value={regEmail}
                        onChange={e => {
                          setRegEmail(e.target.value);
                          setRegEmailError("");
                        }}
                        onKeyDown={e => e.key === "Enter" && sendRegOtp()}
                        className={`${INPUT_CLS} pl-10 ${regEmailError ? "border-red-400 focus:ring-red-400" : ""}`}
                        autoFocus={!allowPhone} autoCapitalize="none" />
                    </div>
                    {regEmailError && <p className="text-xs text-red-500 mb-3">{regEmailError}</p>}
                    {!regEmailError && <div className="mb-3" />}
                  </>
                )}
              </>
            )}

            {step === "register-otp" && (
              <>
                <button onClick={() => { setStep("register"); clearError(); setRegDevOtp(""); }}
                  className="text-orange-600 text-sm font-bold mb-4 flex items-center gap-1.5 hover:text-orange-700 transition-colors">← Back</button>
                <h2 className="text-lg font-extrabold text-gray-800 mb-1">{T("enterOtp")}</h2>
                <p className="text-sm text-gray-500 mb-1">
                  {T("sentTo_")}{" "}
                  <strong className="text-gray-700">
                    {allowPhone ? `+92${regPhone}` : regEmail}
                  </strong>
                </p>
                {import.meta.env.DEV && (regDevOtp || regEmailDevOtp) && (
                  <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2 mb-3">
                    <p className="text-xs text-orange-600 font-bold uppercase tracking-wide mb-0.5">{T("devOtp")}</p>
                    <p className="text-orange-700 font-extrabold text-xl tracking-[0.4em]">{regDevOtp || regEmailDevOtp}</p>
                  </div>
                )}
                <OtpInput
                  length={6}
                  onComplete={verifyRegOtp}
                  onResend={sendRegOtp}
                  resendCooldownSeconds={60}
                  disabled={loading}
                  label="Enter your 6-digit code"
                  className="mb-3"
                />
              </>
            )}

            {step === "register-info" && (
              <>
                <button onClick={() => { setStep("register"); clearError(); }}
                  className="text-orange-600 text-sm font-bold mb-4 flex items-center gap-1.5 hover:text-orange-700 transition-colors">← Back</button>
                <h2 className="text-lg font-extrabold text-gray-800 mb-1">Store Information</h2>
                <p className="text-sm text-gray-500 mb-4">Fill in your store details to complete registration</p>

                <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                  <div>
                    <label className={LABEL_CLS}>Store Name *</label>
                    <input value={regForm.storeName} onChange={e => rf("storeName", e.target.value)} placeholder="e.g. Ali's Grocery Store" className={INPUT_CLS} />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Store Category</label>
                    <select value={regForm.storeCategory} onChange={e => rf("storeCategory", e.target.value)} className={SELECT_CLS}>
                      <option value="">Select category...</option>
                      {STORE_CATS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Your Full Name *</label>
                    <input value={regForm.name} onChange={e => rf("name", e.target.value)} placeholder="Muhammad Ali" className={INPUT_CLS} />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Username *</label>
                    <div className="relative">
                      <input value={regUsername}
                        onChange={e => { setRegUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20)); clearError(); }}
                        placeholder="e.g. alistore" className={INPUT_CLS + " pr-10"} autoCapitalize="none" autoCorrect="off" />
                      {regUsernameStatus === "checking" && <span className="absolute right-3 top-3.5 text-gray-400 text-sm animate-spin">⏳</span>}
                      {regUsernameStatus === "available" && <span className="absolute right-3 top-3.5 text-orange-500 text-sm font-bold">✓</span>}
                      {regUsernameStatus === "taken" && <span className="absolute right-3 top-3.5 text-red-500 text-sm font-bold">✗</span>}
                    </div>
                    {regUsernameStatus === "taken" && <p className="text-[10px] text-red-500 mt-0.5 font-medium">Username already taken</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={LABEL_CLS}>CNIC Number</label>
                      <input value={regForm.cnic} onChange={e => rf("cnic", e.target.value)} placeholder="xxxxx-xxxxxxx-x" className={INPUT_CLS} inputMode="numeric" />
                    </div>
                    <div>
                      <label className={LABEL_CLS}>City</label>
                      <select value={regForm.city} onChange={e => rf("city", e.target.value)} className={SELECT_CLS}>
                        <option value="">Select...</option>
                        {(config.cities?.length ? config.cities : CITIES).map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Store Address</label>
                    <input value={regForm.address} onChange={e => rf("address", e.target.value)} placeholder="Full address..." className={INPUT_CLS} />
                  </div>
                  <div className="border-t border-gray-100 pt-3">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Bank / Wallet Details (Optional)</p>
                    <div className="space-y-3">
                      <div>
                        <label className={LABEL_CLS}>Bank / Wallet</label>
                        <select value={regForm.bankName} onChange={e => rf("bankName", e.target.value)} className={SELECT_CLS}>
                          <option value="">Select...</option>
                          {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={LABEL_CLS}>Account Number</label>
                          <input value={regForm.bankAccount} onChange={e => rf("bankAccount", e.target.value)} placeholder="Account #" className={INPUT_CLS} />
                        </div>
                        <div>
                          <label className={LABEL_CLS}>Account Title</label>
                          <input value={regForm.bankAccountTitle} onChange={e => rf("bankAccountTitle", e.target.value)} placeholder="Account holder" className={INPUT_CLS} />
                        </div>
                      </div>
                    </div>
                  </div>

                  {requireDocuments && (
                    <div className="border-t border-gray-100 pt-3">
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Verification Documents</p>
                      <p className="text-[11px] text-gray-400 mb-3">Required for account approval. Photos must be clear and readable.</p>
                      <div className="space-y-3">
                        {([
                          { field: "storefront", label: "Store Front Photo", hint: "Photo of your store entrance", doc: docStorefront, setter: setDocStorefront },
                          { field: "cnicFront",   label: "CNIC Front",         hint: "Front side of your CNIC",        doc: docCnicFront,  setter: setDocCnicFront  },
                          { field: "cnicBack",    label: "CNIC Back",          hint: "Back side of your CNIC",         doc: docCnicBack,   setter: setDocCnicBack   },
                        ] as const).map(({ field, label, hint, doc, setter }) => {
                          const isBusy = optimisingDoc === field || uploadingDoc === field;
                          const err    = docUploadErrors[field];
                          return (
                            <div key={field}>
                              <label className={LABEL_CLS}>{label} *</label>
                              <label className={`flex items-center gap-3 h-14 px-4 rounded-xl border-2 cursor-pointer transition-all ${
                                doc ? "border-orange-400 bg-orange-50" : err ? "border-red-300 bg-red-50" : "border-dashed border-gray-300 bg-gray-50 hover:border-orange-300 hover:bg-orange-50"
                              }`}>
                                <input type="file" accept="image/*" capture="environment" className="hidden"
                                  disabled={isBusy}
                                  onChange={e => {
                                    const f = e.target.files?.[0];
                                    if (f) handleDocUpload(f, field, setter as (d: UploadedDoc) => void);
                                    e.target.value = "";
                                  }} />
                                {isBusy ? (
                                  <Loader2 size={18} className="text-orange-500 animate-spin flex-shrink-0" />
                                ) : doc ? (
                                  <CheckCircle2 size={18} className="text-orange-500 flex-shrink-0" />
                                ) : (
                                  <Camera size={18} className="text-gray-400 flex-shrink-0" />
                                )}
                                <div className="flex-1 min-w-0">
                                  {doc ? (
                                    <p className="text-xs font-semibold text-orange-700 truncate">{doc.label}</p>
                                  ) : (
                                    <p className="text-xs text-gray-500 truncate">{isBusy ? (optimisingDoc === field ? "Optimising…" : "Uploading…") : hint}</p>
                                  )}
                                </div>
                                {doc?.preview && (
                                  <img src={doc.preview} alt="" className="h-9 w-9 object-cover rounded-lg flex-shrink-0 border border-orange-200" />
                                )}
                              </label>
                              {err && <p className="text-[10px] text-red-500 mt-0.5">{err}</p>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <label className="flex items-start gap-3 mt-4 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={regTermsAccepted}
                    onChange={e => setRegTermsAccepted(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-orange-500 flex-shrink-0 cursor-pointer"
                  />
                  <span className="text-xs text-gray-500 leading-relaxed">
                    I have read and agree to the{" "}
                    {config.content.tncUrl ? (
                      <a href={config.content.tncUrl} target="_blank" rel="noopener noreferrer" className="text-orange-600 font-semibold hover:underline">Terms & Conditions</a>
                    ) : (
                      <span className="text-orange-600 font-semibold">Terms & Conditions</span>
                    )}
                    {config.content.privacyUrl ? (
                      <> and <a href={config.content.privacyUrl} target="_blank" rel="noopener noreferrer" className="text-orange-600 font-semibold hover:underline">Privacy Policy</a></>
                    ) : null}
                  </span>
                </label>
              </>
            )}

            {error && (
              <div className="mb-3 mt-3 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
                <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-red-600 text-sm font-medium">{error}</p>
              </div>
            )}

            {step === "register" && (
              <button onClick={sendRegOtp} disabled={loading}
                className="w-full h-12 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-2xl transition-all disabled:opacity-60 flex items-center justify-center gap-2 text-sm mt-2 shadow-sm shadow-orange-200">
                {loading ? <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Please wait...</> : (allowPhone || allowEmail) ? "Send OTP →" : "Continue →"}
              </button>
            )}

            {step === "register-otp" && (
              <p className="text-center text-xs text-gray-400 mb-3">
                {loading ? "Verifying..." : "Enter all 6 digits to continue automatically"}
              </p>
            )}

            {step === "register-info" && (
              <button onClick={submitRegistration} disabled={loading || !regForm.storeName.trim() || !regForm.name.trim() || !regTermsAccepted}
                className="w-full h-12 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-2xl transition-all disabled:opacity-60 flex items-center justify-center gap-2 text-sm mt-4 shadow-sm shadow-orange-200">
                {loading ? <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Submitting...</> : "Submit Application ✓"}
              </button>
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

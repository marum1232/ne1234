import { useState, useRef, useCallback } from "react";
import { AlertCircle, Phone, Mail, Camera } from "lucide-react";
import { useLocation } from "wouter";
import { RegisterScreen, OtpInput, PhoneInput } from "@workspace/auth-react";
import type { StepConfig, StepComponentProps } from "@workspace/auth-react";
import { api } from "../lib/api";
import { usePlatformConfig, getVendorAuthConfig } from "../lib/useConfig";
import { useLanguage } from "../lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { executeCaptcha } from "@workspace/auth-utils";
import { getDeviceFingerprint } from "@workspace/auth-react";

interface UploadedDoc { label: string; url: string; preview: string; }

const STORE_CATS = ["Grocery","Restaurant","Bakery","Pharmacy","Electronics","Clothing","General Store","Fast Food","Fruits & Vegetables","Dairy","Meat & Poultry","Other"];
const CITIES = ["Muzaffarabad","Mirpur","Rawalakot","Bagh","Kotli","Bhimber","Jhelum","Rawalpindi","Islamabad","Lahore","Other"];
const INPUT_CLS = "w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-orange-400 transition-all";
const SELECT_CLS = "w-full h-12 px-3 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-orange-400 transition-all appearance-none";
const LABEL_CLS = "text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider";

/* ── Store Details step (step 2) ─────────────────────────────────────────── */
function StoreDetailsStep({ data, onChange, onError }: StepComponentProps) {
  const { config } = usePlatformConfig();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const appName = config.platform.appName;
  const businessAddress = config.platform.businessAddress;
  const vendorEarningsPct = Math.round(100 - (config.platform.vendorCommissionPct ?? 15));

  const [usernameStatus, setUsernameStatus] = useState<"idle"|"checking"|"available"|"taken">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleUsernameChange = (v: string) => {
    onChange("username", v);
    if (!v || v.length < 3) { setUsernameStatus("idle"); return; }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();
      setUsernameStatus("checking");
      try {
        const res = await api.checkAvailable({ username: v }, abortRef.current.signal);
        setUsernameStatus(res.username && !res.username.available ? "taken" : "available");
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") return;
        setUsernameStatus("taken");
      }
    }, 600);
  };

  return (
    <div className="space-y-4">
      <div>
        <label className={LABEL_CLS}>Store / Business Name *</label>
        <input className={INPUT_CLS} value={(data.storeName as string) ?? ""} onChange={e => { onChange("storeName", e.target.value); onError(""); }} placeholder="e.g. Ali's Grocery" />
      </div>
      <div>
        <label className={LABEL_CLS}>Category *</label>
        <select className={SELECT_CLS} value={(data.storeCategory as string) ?? ""} onChange={e => { onChange("storeCategory", e.target.value); onError(""); }}>
          <option value="">Select category</option>
          {STORE_CATS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div>
        <label className={LABEL_CLS}>Owner / Manager Name *</label>
        <input className={INPUT_CLS} value={(data.ownerName as string) ?? ""} onChange={e => { onChange("ownerName", e.target.value); onError(""); }} placeholder="Full name" />
      </div>
      <div>
        <label className={LABEL_CLS}>City *</label>
        <select className={SELECT_CLS} value={(data.city as string) ?? ""} onChange={e => { onChange("city", e.target.value); onError(""); }}>
          <option value="">Select city</option>
          {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div>
        <label className={LABEL_CLS}>Address</label>
        <input className={INPUT_CLS} value={(data.address as string) ?? ""} onChange={e => { onChange("address", e.target.value); onError(""); }} placeholder="Street address" />
      </div>
      <div>
        <label className={LABEL_CLS}>Username *</label>
        <input className={INPUT_CLS} value={(data.username as string) ?? ""} onChange={e => handleUsernameChange(e.target.value)} placeholder="Unique username" />
        {usernameStatus === "taken" && <p className="text-xs text-red-500 mt-1">Username is taken</p>}
        {usernameStatus === "available" && <p className="text-xs text-green-600 mt-1">Username is available</p>}
      </div>
      <label className="flex items-start gap-2 cursor-pointer">
        <input type="checkbox" checked={!!(data.termsAccepted)} onChange={e => { onChange("termsAccepted", e.target.checked); onError(""); }} className="mt-1" />
        <span className="text-xs text-gray-500">
          I agree to the Terms of Service and confirm this is a legitimate business registered at {businessAddress || appName}.
          {vendorEarningsPct > 0 && ` Vendors keep ${vendorEarningsPct}% of sales.`}
        </span>
      </label>
    </div>
  );
}

/* ── Verification Documents step (step 3) ────────────────────────────────── */
function DocsStep({ data, onChange, onError }: StepComponentProps) {
  const { config } = usePlatformConfig();
  const requireDocuments = !!config.vendor.requireDocuments;
  const [optimising, setOptimising] = useState("");
  const [uploading, setUploading] = useState("");
  const [docErrors, setDocErrors] = useState<Record<string, string>>({});

  const handleUpload = useCallback(async (file: File, field: string) => {
    const preview = URL.createObjectURL(file);
    setDocErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
    setOptimising(field);
    try {
      setOptimising(""); setUploading(field);
      const res = await api.uploadRegistrationDoc(file);
      onChange(field, { label: file.name, url: res.url, preview });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      setDocErrors(prev => ({ ...prev, [field]: msg }));
      onError(msg);
    } finally { setOptimising(""); setUploading(""); }
  }, [onChange, onError]);

  const UploadBox = ({ field, label }: { field: string; label: string }) => {
    const doc = data[field] as UploadedDoc | null | undefined;
    const busy = optimising === field || uploading === field;
    const err = docErrors[field];
    return (
      <div className="border-2 border-dashed border-gray-200 rounded-xl p-4 text-center">
        {doc ? (
          <div>
            <img src={doc.preview} className="h-20 w-full object-cover rounded-lg mb-2" alt={label} />
            <p className="text-xs text-green-600 font-medium">{doc.label}</p>
          </div>
        ) : busy ? (
          <p className="text-xs text-gray-400">{optimising === field ? "Optimising…" : "Uploading…"}</p>
        ) : (
          <label className="cursor-pointer flex flex-col items-center gap-2">
            <Camera size={24} className="text-gray-400" />
            <span className="text-xs text-gray-500">{label}</span>
            <input type="file" accept="image/*" className="hidden" onChange={e => { if (e.target.files?.[0]) void handleUpload(e.target.files[0], field); }} />
          </label>
        )}
        {err && <p className="text-xs text-red-500 mt-1">{err}</p>}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <label className={LABEL_CLS}>CNIC Number</label>
        <input className={INPUT_CLS} value={(data.cnic as string) ?? ""} onChange={e => { onChange("cnic", e.target.value); onError(""); }} placeholder="12345-6789012-3" />
      </div>
      <p className="text-xs text-gray-400 uppercase font-bold tracking-wider">{requireDocuments ? "Required Documents" : "Optional Documents"}</p>
      <UploadBox field="docStorefront" label="Storefront Photo" />
      <UploadBox field="docCnicFront" label="CNIC Front" />
      <UploadBox field="docCnicBack" label="CNIC Back" />
    </div>
  );
}

/* ── Bank Details step (step 4) ──────────────────────────────────────────── */
const BANKS = ["EasyPaisa","JazzCash","MCB","HBL","UBL","Meezan Bank","Bank Alfalah","NBP","Allied Bank","Other"];

/* ── Step definitions ────────────────────────────────────────────────────── */
const vendorSteps: StepConfig[] = [
  {
    id: "store",
    title: "Store Details",
    subtitle: "Tell us about your business",
    fields: [],
    component: StoreDetailsStep,
  },
  {
    id: "docs",
    title: "Verification Docs",
    subtitle: "Upload your verification documents",
    fields: [],
    component: DocsStep,
  },
  {
    id: "bank",
    title: "Bank / Wallet",
    subtitle: "Add your payment details (optional)",
    fields: [
      { id: "bankName", type: "select", label: "Bank or Mobile Wallet", options: BANKS.map(b => ({ value: b, label: b })) },
      { id: "bankAccount", type: "text", label: "Account Number", placeholder: "03XX-XXXXXXX" },
      { id: "bankTitle", type: "text", label: "Account Title", placeholder: "Name on account" },
    ],
  },
];

/* ── Main component ──────────────────────────────────────────────────────── */
export default function Register() {
  const [, navigate] = useLocation();
  const { config } = usePlatformConfig();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const vendorAuth = getVendorAuthConfig(config);
  const appName = config.platform.appName;

  const allowPhone = vendorAuth.phoneOtp;
  const allowEmail = vendorAuth.emailOtp;

  const [phase, setPhase] = useState<"verify" | "verify-otp" | "form" | "done">("verify");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const clearError = () => setError("");

  const urlPhone = new URLSearchParams(window.location.search).get("phone") ?? "";
  const [phoneE164, setPhoneE164] = useState(urlPhone ? `+92${urlPhone.replace(/^0/, "")}` : "");
  const [email, setEmail] = useState("");
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
        if (res.otpRequired === false) { setPhase("form"); setLoading(false); return; }
        setDevOtp(res.otp || "");
        setPhase("verify-otp");
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
        setPhase("verify-otp");
      } catch (e) { setError(e instanceof Error ? e.message : "Failed to send OTP"); }
      setLoading(false);
    } else {
      setPhase("form");
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
      setPhase("form");
    } catch (e) { setError(e instanceof Error ? e.message : "Verification failed"); }
    setLoading(false);
  };

  async function handleFormComplete(data: Record<string, unknown>) {
    setLoading(true); clearError();
    try {
      const termsVersion = config.compliance?.termsVersion;
      const docStorefront = data.docStorefront as UploadedDoc | undefined;
      const docCnicFront = data.docCnicFront as UploadedDoc | undefined;
      const docCnicBack = data.docCnicBack as UploadedDoc | undefined;
      const docsPayload = docStorefront?.url || docCnicFront?.url || docCnicBack?.url
        ? { files: [
            ...(docStorefront?.url ? [{ type: "store_front", url: docStorefront.url, label: "Store Front" }] : []),
            ...(docCnicFront?.url  ? [{ type: "cnic_front",  url: docCnicFront.url,  label: "CNIC Front"  }] : []),
            ...(docCnicBack?.url   ? [{ type: "cnic_back",   url: docCnicBack.url,   label: "CNIC Back"   }] : []),
          ]}
        : undefined;
      const res = await api.vendorRegister({
        ...(allowPhone && phoneE164 ? { phone: phoneE164 } : {}),
        ...(allowEmail && email     ? { email }           : {}),
        storeName: data.storeName as string,
        storeCategory: data.storeCategory as string,
        name: data.ownerName as string,
        cnic: (data.cnic as string) ?? "",
        address: (data.address as string) ?? "",
        city: data.city as string,
        ...(data.bankName    ? { bankName: data.bankName as string }       : {}),
        ...(data.bankAccount ? { bankAccount: data.bankAccount as string } : {}),
        ...(data.bankTitle   ? { bankAccountTitle: data.bankTitle as string } : {}),
        username: (data.username as string).trim(),
        ...(termsVersion && { acceptedTermsVersion: termsVersion }),
        ...(docsPayload  ? { documents: JSON.stringify(docsPayload) } : {}),
      });
      if ((res as { status?: string }).status === "approved") {
        navigate("/");
      } else {
        setPhase("done");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Registration failed"); }
    setLoading(false);
  }

  if (!config.features.newUsers) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-800 via-orange-700 to-amber-700 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl">
          <div className="text-5xl mb-4">🔒</div>
          <h2 className="text-2xl font-extrabold text-gray-800 mb-3">Registration Closed</h2>
          <p className="text-gray-500 text-sm mb-5">New vendor registrations are not available.</p>
          {config.platform.supportPhone && <p className="text-sm font-bold text-gray-700">{config.platform.supportPhone}</p>}
        </div>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-800 via-orange-700 to-amber-700 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl">
          <div className="text-5xl mb-4">⏳</div>
          <h2 className="text-2xl font-extrabold text-gray-800 mb-3">Under Review</h2>
          <p className="text-gray-500 text-sm mb-5">Your application is being reviewed by the {appName} team. We'll contact you via phone or email once approved.</p>
        </div>
      </div>
    );
  }

  if (phase === "verify") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-800 via-orange-700 to-amber-700 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl">
          <h1 className="text-2xl font-extrabold text-gray-800 mb-1">Vendor Registration</h1>
          <p className="text-sm text-gray-500 mb-6">Verify your identity to get started</p>
          {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-sm text-red-700 flex gap-2"><AlertCircle size={14} className="mt-0.5" />{error}</div>}
          {allowPhone && (
            <div className="mb-4">
              <label className={LABEL_CLS}><Phone size={11} className="inline mr-1" />Phone Number</label>
              <PhoneInput value={phoneE164} onChange={setPhoneE164} />
            </div>
          )}
          {!allowPhone && allowEmail && (
            <div className="mb-4">
              <label className={LABEL_CLS}><Mail size={11} className="inline mr-1" />Email Address</label>
              <input className={INPUT_CLS} type="email" value={email} onChange={e => { setEmail(e.target.value); clearError(); }} placeholder="you@example.com" />
            </div>
          )}
          <button
            className="w-full h-12 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl transition-colors text-sm"
            onClick={() => void sendOtp()}
            disabled={loading}
          >
            {loading ? "Sending…" : "Send Verification Code"}
          </button>
        </div>
      </div>
    );
  }

  if (phase === "verify-otp") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-800 via-orange-700 to-amber-700 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl">
          <h2 className="text-2xl font-extrabold text-gray-800 mb-1 text-center">Verify Code</h2>
          <p className="text-sm text-gray-500 text-center mb-6">Sent to {allowPhone ? phoneE164 : email}</p>
          {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-sm text-red-700">{error}</div>}
          {process.env.NODE_ENV !== "production" && devOtp && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-2 mb-4 text-center text-xs text-amber-800">
              Dev OTP: <strong className="tracking-widest">{devOtp}</strong>
            </div>
          )}
          <OtpInput onComplete={(otp) => void verifyOtp(otp)} onResend={() => void sendOtp()} autoSubmit />
          {loading && <p className="text-center text-sm text-gray-400 mt-4">Verifying…</p>}
          <button className="mt-4 text-xs text-orange-500 w-full text-center" onClick={() => { clearError(); setPhase("verify"); }}>
            ← Change number
          </button>
        </div>
      </div>
    );
  }

  return (
    <RegisterScreen
      role="vendor"
      title="Vendor Registration"
      steps={vendorSteps}
      onComplete={(data) => void handleFormComplete(data)}
    />
  );
}

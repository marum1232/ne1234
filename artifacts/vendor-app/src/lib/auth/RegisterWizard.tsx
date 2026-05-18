/**
 * RegisterWizard.tsx — vendor-app
 *
 * Multi-step registration wizard for vendors:
 *   Store Info → Documents → Bank/Wallet → OTP + Password → Done
 *
 * Wraps @workspace/auth-react RegisterScreen with vendor-specific
 * step configuration, API wiring, and theme tokens.
 *
 * Passwords are excluded from the draft to avoid plain-text storage.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { RegisterScreen } from "@workspace/auth-react";
import type { StepConfig, StepComponentProps } from "@workspace/auth-react";
import { useTheme } from "./ThemeContext";
import { useAuth } from "./useAuth";
import { api } from "../api";
import { usePlatformConfig, getVendorAuthConfig } from "../useConfig";
import { useLanguage } from "../useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { executeCaptcha } from "@workspace/auth-utils";
import { Eye, EyeOff } from "lucide-react";

const DRAFT_KEY = "vendor_reg_draft";

const STORE_CATS = ["Grocery","Restaurant","Bakery","Pharmacy","Electronics","Clothing","General Store","Fast Food","Fruits & Vegetables","Dairy","Meat & Poultry","Other"];
const CITIES = ["Muzaffarabad","Mirpur","Rawalakot","Bagh","Kotli","Bhimber","Jhelum","Rawalpindi","Islamabad","Lahore","Other"];

/* ── Validate CNIC: XXXXX-XXXXXXX-X ── */
function isValidCnic(cnic: string): boolean {
  return /^\d{5}-\d{7}-\d$/.test(cnic.trim());
}

/* ── Canonicalize and validate Pakistani phone ───────────────────────────────
   Accepts:  03XXXXXXXXX (11 digits) or +92XXXXXXXXXX (+92 then 10 digits)
   Returns the canonical 03XXXXXXXXX form, or null if the input is invalid.   */
function canonicalizePhone(phone: string): string | null {
  const trimmed = phone.trim();
  /* Remove all non-digit characters except a leading + */
  const digits = trimmed.replace(/\D/g, "");
  /* +92XXXXXXXXXX → strip country code → prepend 0 */
  if (trimmed.startsWith("+92") && digits.length === 12 && digits.startsWith("92")) {
    const local = "0" + digits.slice(2); /* 0 + 10 remaining digits */
    return local.startsWith("03") ? local : null;
  }
  /* 03XXXXXXXXX — already canonical */
  if (digits.length === 11 && digits.startsWith("03")) return digits;
  return null;
}

function isValidPakistaniPhone(phone: string): boolean {
  return canonicalizePhone(phone) !== null;
}

/* ── Step 1: Store Info ──────────────────────────────────────────────── */
function StoreInfoStep({ data, onChange, onError }: StepComponentProps) {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const theme = useTheme();

  return (
    <div className="space-y-4">
      <h3 className="font-extrabold text-lg mb-1" style={{ color: theme.text }}>{T("storeDetails")}</h3>
      <p className="text-sm mb-4" style={{ color: theme.textMuted }}>{T("tellUsAboutYourBusiness")}</p>

      <div>
        <label className="text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider">{T("storeName")} *</label>
        <input className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-500 transition-all"
          value={(data.storeName as string) ?? ""} onChange={e => { onChange("storeName", e.target.value); onError(""); }} placeholder="Ali's Grocery" />
      </div>
      <div>
        <label className="text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider">{T("category")} *</label>
        <select className="w-full h-12 px-3 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-500 transition-all appearance-none"
          value={(data.storeCategory as string) ?? ""} onChange={e => { onChange("storeCategory", e.target.value); onError(""); }}>
          <option value="">{T("selectCategory")}</option>
          {STORE_CATS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div>
        <label className="text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider">{T("ownerName")} *</label>
        <input className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-500 transition-all"
          value={(data.ownerName as string) ?? ""} onChange={e => { onChange("ownerName", e.target.value); onError(""); }} placeholder="Full name" />
      </div>
      <div>
        <label className="text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider">{T("city")} *</label>
        <select className="w-full h-12 px-3 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-500 transition-all appearance-none"
          value={(data.city as string) ?? ""} onChange={e => { onChange("city", e.target.value); onError(""); }}>
          <option value="">{T("selectCity")}</option>
          {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
    </div>
  );
}

/* ── Step 2: Documents ────────────────────────────────────────────── */
function DocumentsStep({ data, onChange, onError }: StepComponentProps) {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);

  const formatCnic = (val: string) => {
    const digits = val.replace(/\D/g, "").slice(0, 13);
    if (digits.length <= 5) return digits;
    if (digits.length <= 12) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
    return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
  };

  return (
    <div className="space-y-4">
      <h3 className="font-extrabold text-lg mb-1 text-gray-800">{T("documents")}</h3>
      <p className="text-sm mb-4 text-gray-500">{T("uploadRequiredDocuments")}</p>

      <div>
        <label className="text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider">{T("cnicNumber")} *</label>
        <input className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-500 transition-all"
          value={(data.cnic as string) ?? ""}
          onChange={e => { onChange("cnic", formatCnic(e.target.value)); onError(""); }}
          placeholder="XXXXX-XXXXXXX-X" maxLength={15} inputMode="numeric" />
        {(data.cnic as string)?.length > 0 && !isValidCnic((data.cnic as string) ?? "") && (
          <p className="text-gray-400 text-xs mt-1">Format: XXXXX-XXXXXXX-X</p>
        )}
      </div>
      <div>
        <label className="text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider">{T("phoneNumber")} *</label>
        <input className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-500 transition-all"
          value={(data.phone as string) ?? ""}
          onChange={e => { onChange("phone", e.target.value); onError(""); }}
          placeholder="03XXXXXXXXX or +92XXXXXXXXXX" inputMode="tel" maxLength={13} />
      </div>
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
        <p className="text-gray-400 text-sm">{T("documentUploadComingSoon")}</p>
      </div>
    </div>
  );
}

/* ── Step 3: Bank / Wallet ──────────────────────────────────────────── */
function BankStep({ data, onChange, onError }: StepComponentProps) {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);

  return (
    <div className="space-y-4">
      <h3 className="font-extrabold text-lg mb-1 text-gray-800">{T("bankDetails")}</h3>
      <p className="text-sm mb-4 text-gray-500">{T("addPaymentDetails")}</p>

      <div>
        <label className="text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider">{T("bankName")}</label>
        <input className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-500 transition-all"
          value={(data.bankName as string) ?? ""} onChange={e => { onChange("bankName", e.target.value); onError(""); }} placeholder="e.g. HBL" />
      </div>
      <div>
        <label className="text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider">{T("accountTitle")}</label>
        <input className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-500 transition-all"
          value={(data.bankAccountTitle as string) ?? ""} onChange={e => { onChange("bankAccountTitle", e.target.value); onError(""); }} placeholder="Account holder name" />
      </div>
      <div>
        <label className="text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider">{T("accountNumber")}</label>
        <input className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-500 transition-all"
          value={(data.bankAccount as string) ?? ""} onChange={e => { onChange("bankAccount", e.target.value); onError(""); }} placeholder="IBAN / Account number" />
      </div>
    </div>
  );
}

/* ── Step 4: OTP + Password ──────────────────────────────────────────────── */
function OtpPasswordStep({ data, onChange, onError, onComplete }: StepComponentProps & { onComplete?: (otp: string) => void }) {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const { sendOtp } = useAuth();
  const [otp, setOtp] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(30);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const handleOtpChange = (i: number, raw: string) => {
    const v = raw.replace(/\D/g, "").slice(0, 1);
    const chars = otp.split("");
    chars[i] = v;
    const next = chars.join("").slice(0, 6);
    setOtp(next);
    onChange("otp", next);
    onError("");
    if (v && i < 5) inputRefs.current[i + 1]?.focus();
    if (next.length === 6) onComplete?.(next);
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otp[i] && i > 0) {
      inputRefs.current[i - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    setOtp(pasted);
    onChange("otp", pasted);
    onError("");
    inputRefs.current[Math.min(pasted.length, 5)]?.focus();
    if (pasted.length === 6) onComplete?.(pasted);
  };

  const handleResend = async () => {
    const phone = (data.phone as string) ?? "";
    if (!phone || resending || resendCooldown > 0) return;
    setResending(true);
    await sendOtp(phone);
    setResending(false);
    setResendCooldown(30);
  };

  return (
    <div className="space-y-4">
      <h3 className="font-extrabold text-lg mb-1 text-gray-800">{T("verifyAndSecure")}</h3>
      <p className="text-sm mb-4 text-gray-500">{T("enterOtpAndPassword")}</p>

      <div>
        <label className="text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider">{T("otpCode")} *</label>
        <div className="flex justify-center gap-2" onPaste={handlePaste}>
          {Array.from({ length: 6 }).map((_, i) => (
            <input key={i} ref={el => { inputRefs.current[i] = el; }} type="text" inputMode="numeric" maxLength={1} value={otp[i] ?? ""}
              onChange={e => handleOtpChange(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              className="w-12 h-14 bg-gray-50 border border-gray-200 rounded-xl text-center text-xl font-bold text-gray-800 focus:ring-2 focus:ring-green-500 focus:outline-none transition-all"
            />
          ))}
        </div>
        <p className="text-center text-gray-400 text-xs mt-2">
          {T("didntReceiveOtp")}{" "}
          {resendCooldown > 0
            ? <span className="text-gray-300">Resend in {resendCooldown}s</span>
            : <button type="button" onClick={handleResend} disabled={resending} className="text-green-600 font-semibold disabled:opacity-50">
                {resending ? "Sending…" : T("resend")}
              </button>
          }
        </p>
      </div>

      <div>
        <label className="text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider">{T("password")} *</label>
        <div className="relative">
          <input type={showPassword ? "text" : "password"}
            className="w-full h-12 px-4 pr-10 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-500 transition-all"
            value={(data.password as string) ?? ""} onChange={e => { onChange("password", e.target.value); onError(""); }} placeholder="Min 8 characters" />
          <button type="button" tabIndex={-1} onClick={() => setShowPassword(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      <div>
        <label className="text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider">{T("confirmPassword")} *</label>
        <div className="relative">
          <input type={showConfirm ? "text" : "password"}
            className="w-full h-12 px-4 pr-10 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-500 transition-all"
            value={(data.confirmPassword as string) ?? ""} onChange={e => { onChange("confirmPassword", e.target.value); onError(""); }} placeholder="Re-enter password" />
          <button type="button" tabIndex={-1} onClick={() => setShowConfirm(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
            {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Step 5: Success ────────────────────────────────────────────────── */
function SuccessStep() {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const theme = useTheme();

  return (
    <div className="text-center py-6">
      <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6" style={{ background: `${theme.primary}15`, border: `2px solid ${theme.primary}40` }}>
        <span className="text-4xl">{T("successIcon")}</span>
      </div>
      <h3 className="font-extrabold text-2xl mb-3 text-gray-800">{T("registrationComplete")}</h3>
      <p className="text-gray-500 text-sm leading-relaxed mb-6">{T("vendorApprovalMsg")}</p>
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-left">
        <p className="text-xs font-bold text-gray-400 uppercase mb-1">{T("nextSteps")}</p>
        <p className="text-gray-500 text-xs leading-relaxed">{T("vendorReviewMsg")}</p>
      </div>
    </div>
  );
}

const STEPS: StepConfig[] = [
  {
    id: "store",
    title: "Store",
    component: StoreInfoStep,
    validate: (data) => {
      if (!String(data.storeName ?? "").trim()) return "Store name is required";
      if (!String(data.storeCategory ?? "").trim()) return "Please select a category";
      if (!String(data.ownerName ?? "").trim()) return "Owner name is required";
      if (!String(data.city ?? "").trim()) return "Please select a city";
      return null;
    },
  },
  {
    id: "documents",
    title: "Docs",
    component: DocumentsStep,
    validate: (data) => {
      const cnic = String(data.cnic ?? "").trim();
      if (!cnic) return "CNIC number is required";
      if (!isValidCnic(cnic)) return "CNIC must be in format XXXXX-XXXXXXX-X";
      const phone = String(data.phone ?? "").trim();
      if (!phone) return "Phone number is required";
      if (!isValidPakistaniPhone(phone)) return "Enter a valid Pakistani mobile number (03XXXXXXXXX)";
      return null;
    },
  },
  { id: "bank", title: "Bank", component: BankStep },
  {
    id: "verify",
    title: "Verify",
    component: OtpPasswordStep,
    validate: (data) => {
      if (String(data.otp ?? "").length !== 6) return "Enter the 6-digit verification code";
      const pw = String(data.password ?? "");
      if (!pw) return "Password is required";
      if (pw.length < 8) return "Password must be at least 8 characters";
      if (pw !== String(data.confirmPassword ?? "")) return "Passwords do not match";
      return null;
    },
  },
  { id: "success", title: "Done", component: SuccessStep },
];

export interface RegisterWizardProps {
  onDone?: () => void;
}

export function RegisterWizard({ onDone }: RegisterWizardProps) {
  const theme = useTheme();
  const { sendOtp } = useAuth();
  const [, navigate] = useLocation();
  const { config } = usePlatformConfig();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);

  const [draft, setDraft] = useState<Record<string, unknown>>(() => {
    try { const raw = localStorage.getItem(DRAFT_KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
  });

  /* ── Save draft, excluding password and OTP fields ── */
  const handleDataChange = useCallback((key: string, value: unknown) => {
    setDraft(prev => {
      const next = { ...prev, [key]: value };
      const { password: _pw, confirmPassword: _cpw, otp: _otp, ...safe } = next as Record<string, unknown>;
      localStorage.setItem(DRAFT_KEY, JSON.stringify(safe));
      return next;
    });
  }, []);

  const handleOtpRequest = async (phone: string) => {
    const result = await sendOtp(phone);
    return result.success;
  };

  const handleSubmit = async (data: Record<string, unknown>) => {
    try {
      const res = await api.vendorRegister({
        phone: data.phone as string,
        storeName: data.storeName as string,
        storeCategory: data.storeCategory as string,
        name: data.ownerName as string,
        cnic: data.cnic as string,
        city: data.city as string,
        bankName: data.bankName as string | undefined,
        bankAccount: data.bankAccount as string | undefined,
        bankAccountTitle: data.bankAccountTitle as string | undefined,
        ...(data.otp      ? { otp:      data.otp      as string } : {}),
        ...(data.password ? { password: data.password as string } : {}),
      }) as { token?: string; user?: unknown };
      localStorage.removeItem(DRAFT_KEY);
      return { success: true, data: res };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : T("registrationFailed") };
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: theme.background }}>
      <div className="max-w-md mx-auto px-6 py-10">
        <RegisterScreen
          role="vendor"
          steps={STEPS}
          initialData={draft}
          onDataChange={handleDataChange}
          onOtpRequest={handleOtpRequest}
          onSubmit={handleSubmit}
          onDone={() => { onDone?.(); navigate("/login"); }}
          title={T("vendorRegistration") as string}
        />
      </div>
    </div>
  );
}

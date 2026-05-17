/**
 * RegisterWizard.tsx — vendor-app
 *
 * Multi-step registration wizard for vendors:
 *   Store Info → Documents → Bank/Wallet → OTP → Done
 *
 * Wraps @workspace/auth-react RegisterScreen with vendor-specific
 * step configuration, API wiring, and theme tokens.
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

const DRAFT_KEY = "vendor_reg_draft";

const STORE_CATS = ["Grocery","Restaurant","Bakery","Pharmacy","Electronics","Clothing","General Store","Fast Food","Fruits & Vegetables","Dairy","Meat & Poultry","Other"];
const CITIES = ["Muzaffarabad","Mirpur","Rawalakot","Bagh","Kotli","Bhimber","Jhelum","Rawalpindi","Islamabad","Lahore","Other"];

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

  return (
    <div className="space-y-4">
      <h3 className="font-extrabold text-lg mb-1 text-gray-800">{T("documents")}</h3>
      <p className="text-sm mb-4 text-gray-500">{T("uploadRequiredDocuments")}</p>

      <div>
        <label className="text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider">{T("cnicNumber")} *</label>
        <input className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-500 transition-all"
          value={(data.cnic as string) ?? ""} onChange={e => { onChange("cnic", e.target.value); onError(""); }} placeholder="XXXXX-XXXXXXX-X" maxLength={15} />
      </div>
      <div>
        <label className="text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider">{T("phoneNumber")} *</label>
        <input className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-500 transition-all"
          value={(data.phone as string) ?? ""} onChange={e => { onChange("phone", e.target.value); onError(""); }} placeholder="+92300XXXXXXX" />
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
  const [otp, setOtp] = useState("");

  return (
    <div className="space-y-4">
      <h3 className="font-extrabold text-lg mb-1 text-gray-800">{T("verifyAndSecure")}</h3>
      <p className="text-sm mb-4 text-gray-500">{T("enterOtpAndPassword")}</p>

      <div>
        <label className="text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider">{T("otpCode")} *</label>
        <div className="flex justify-center gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <input key={i} type="text" inputMode="numeric" maxLength={1} value={otp[i] ?? ""}
              onChange={e => {
                const v = e.target.value.replace(/\D/g, "");
                const next = otp.slice(0, i) + v + otp.slice(i + 1);
                setOtp(next.slice(0, 6));
                onChange("otp", next.slice(0, 6));
                onError("");
                if (next.length === 6) onComplete?.(next);
              }}
              className="w-12 h-14 bg-gray-50 border border-gray-200 rounded-xl text-center text-xl font-bold text-gray-800 focus:ring-2 focus:ring-green-500 focus:outline-none transition-all"
            />
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider">{T("password")} *</label>
        <input type="password" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-500 transition-all"
          value={(data.password as string) ?? ""} onChange={e => { onChange("password", e.target.value); onError(""); }} placeholder="Min 8 characters" />
      </div>

      <div>
        <label className="text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider">{T("confirmPassword")} *</label>
        <input type="password" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-500 transition-all"
          value={(data.confirmPassword as string) ?? ""} onChange={e => { onChange("confirmPassword", e.target.value); onError(""); }} placeholder="Re-enter password" />
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
  { id: "store", title: "Store", component: StoreInfoStep },
  { id: "documents", title: "Docs", component: DocumentsStep },
  { id: "bank", title: "Bank", component: BankStep },
  { id: "verify", title: "Verify", component: OtpPasswordStep },
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

  const handleDataChange = useCallback((key: string, value: unknown) => {
    setDraft(prev => { const next = { ...prev, [key]: value }; localStorage.setItem(DRAFT_KEY, JSON.stringify(next)); return next; });
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

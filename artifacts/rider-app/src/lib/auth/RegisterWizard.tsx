/**
 * RegisterWizard.tsx — rider-app
 *
 * Multi-step registration wizard for riders:
 *   Phone → OTP → CNIC/Vehicle → Password → Done
 *
 * Wraps @workspace/auth-react RegisterScreen with rider-specific
 * step configuration, API wiring, and theme tokens.
 *
 * Form drafts are saved to localStorage so users can resume.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { RegisterScreen } from "@workspace/auth-react";
import type { StepConfig, StepComponentProps } from "@workspace/auth-react";
import { useTheme } from "./ThemeContext";
import { useAuth } from "./useAuth";
import { api } from "../api";
import { usePlatformConfig, buildPhoneValidator } from "../useConfig";
import { useRiderAuthConfig } from "../AuthConfigContext";
import { useLanguage } from "../useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { executeCaptcha } from "@workspace/auth-utils";
import { compressImage } from "../lib/imageUtils";
import { useAuth as useAuthContext } from "../rider-auth";
import { Lock, Phone, ArrowLeft, Clock, Shield } from "lucide-react";

const DRAFT_KEY = "rider_reg_draft";

/* ── Step 1: Phone + Personal Info ──────────────────────────────────────────── */
function PhoneInfoStep({ data, onChange, onError }: StepComponentProps) {
  const { config } = usePlatformConfig();
  const auth = useRiderAuthConfig();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);

  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const username = (data.username as string) ?? "";
    if (!username || username.length < 3) { setUsernameStatus("idle"); return; }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();
      setUsernameStatus("checking");
      try {
        const res = await api.checkAvailable({ username }, abortRef.current.signal);
        setUsernameStatus(res.username && !res.username.available ? "taken" : "available");
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") return;
        setUsernameStatus("taken");
      }
    }, 600);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); if (abortRef.current) abortRef.current.abort(); };
  }, [data.username]);

  return (
    <div className="space-y-4">
      <h3 className="text-gray-100 font-bold text-lg mb-1">{T("personalInfo")}</h3>
      <p className="text-gray-500 text-sm mb-4">{T("enterDetailsToGetStarted")}</p>

      <div>
        <label className="text-[10px] font-bold text-yellow-500 uppercase tracking-wider mb-1.5 block">{T("fullName")} *</label>
        <input className="w-full h-12 px-4 bg-gray-950 border border-gray-800 rounded-xl text-gray-100 text-sm focus:outline-none focus:border-yellow-500/50 transition-all"
          value={(data.name as string) ?? ""} onChange={e => { onChange("name", e.target.value); onError(""); }} placeholder="Muhammad Ali" />
      </div>

      <div>
        <label className="text-[10px] font-bold text-yellow-500 uppercase tracking-wider mb-1.5 block">{T("phoneNumber")} *</label>
        <input className="w-full h-12 px-4 bg-gray-950 border border-gray-800 rounded-xl text-gray-100 text-sm focus:outline-none focus:border-yellow-500/50 transition-all"
          value={(data.phone as string) ?? ""} onChange={e => { onChange("phone", e.target.value); onError(""); }} placeholder="03XXXXXXXXX" />
      </div>

      <div>
        <label className="text-[10px] font-bold text-yellow-500 uppercase tracking-wider mb-1.5 block">{T("username")}</label>
        <input className="w-full h-12 px-4 bg-gray-950 border border-gray-800 rounded-xl text-gray-100 text-sm focus:outline-none focus:border-yellow-500/50 transition-all"
          value={(data.username as string) ?? ""} onChange={e => { onChange("username", e.target.value); onError(""); }} placeholder="ali_rider" />
        {usernameStatus === "taken" && <p className="text-red-400 text-xs mt-1">Username already taken</p>}
        {usernameStatus === "available" && <p className="text-green-400 text-xs mt-1">Username available</p>}
      </div>
    </div>
  );
}

/* ── Step 2: OTP Verify ────────────────────────────────────────────── */
function OtpStep({ data, onChange, onError, onComplete }: StepComponentProps & { onComplete?: (otp: string) => void }) {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const [otp, setOtp] = useState("");

  return (
    <div className="text-center">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-yellow-500/30" style={{ backgroundColor: "rgba(234,179,8,0.08)" }}>
        <Phone size={28} className="text-yellow-500" />
      </div>
      <h3 className="text-gray-100 font-bold text-xl mb-2">{T("verifyPhone")}</h3>
      <p className="text-gray-500 text-sm mb-6">{T("enterOtpSentTo")} <strong className="text-gray-300">{(data.phone as string) ?? ""}</strong></p>
      <div className="flex justify-center gap-2 mb-6">
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
            className="w-12 h-14 bg-gray-950 border border-gray-800 rounded-xl text-center text-xl font-bold text-gray-100 focus:border-yellow-500/50 focus:outline-none transition-all"
          />
        ))}
      </div>
      <p className="text-gray-500 text-xs">{T("didntReceiveOtp")} <button className="text-yellow-500 font-semibold">{T("resend")}</button></p>
    </div>
  );
}

/* ── Step 3: CNIC + Vehicle Info ────────────────────────────────── */
function VehicleStep({ data, onChange, onError }: StepComponentProps) {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);

  const VEHICLE_TYPES = ["Bike", "Car", "Van", "Pickup", "Rickshaw"];

  return (
    <div className="space-y-4">
      <h3 className="text-gray-100 font-bold text-lg mb-1">{T("vehicleInfo")}</h3>
      <p className="text-gray-500 text-sm mb-4">{T("enterVehicleDetails")}</p>

      <div>
        <label className="text-[10px] font-bold text-yellow-500 uppercase tracking-wider mb-1.5 block">{T("cnicNumber")} *</label>
        <input className="w-full h-12 px-4 bg-gray-950 border border-gray-800 rounded-xl text-gray-100 text-sm focus:outline-none focus:border-yellow-500/50 transition-all"
          value={(data.cnic as string) ?? ""} onChange={e => { onChange("cnic", e.target.value); onError(""); }} placeholder="XXXXX-XXXXXXX-X" maxLength={15} />
      </div>

      <div>
        <label className="text-[10px] font-bold text-yellow-500 uppercase tracking-wider mb-1.5 block">{T("vehicleType")} *</label>
        <select className="w-full h-12 px-4 bg-gray-950 border border-gray-800 rounded-xl text-gray-100 text-sm focus:outline-none focus:border-yellow-500/50 transition-all appearance-none"
          value={(data.vehicleType as string) ?? ""} onChange={e => { onChange("vehicleType", e.target.value); onError(""); }}>
          <option value="">{T("selectVehicleType")}</option>
          {VEHICLE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div>
        <label className="text-[10px] font-bold text-yellow-500 uppercase tracking-wider mb-1.5 block">{T("drivingLicense")} *</label>
        <input className="w-full h-12 px-4 bg-gray-950 border border-gray-800 rounded-xl text-gray-100 text-sm focus:outline-none focus:border-yellow-500/50 transition-all"
          value={(data.drivingLicense as string) ?? ""} onChange={e => { onChange("drivingLicense", e.target.value); onError(""); }} placeholder="License number" />
      </div>

      <div>
        <label className="text-[10px] font-bold text-yellow-500 uppercase tracking-wider mb-1.5 block">{T("vehicleRegistration")} *</label>
        <input className="w-full h-12 px-4 bg-gray-950 border border-gray-800 rounded-xl text-gray-100 text-sm focus:outline-none focus:border-yellow-500/50 transition-all"
          value={(data.vehicleRegistration as string) ?? ""} onChange={e => { onChange("vehicleRegistration", e.target.value); onError(""); }} placeholder="Registration number" />
      </div>
    </div>
  );
}

/* ── Step 4: Password ──────────────────────────────────────────────── */
function PasswordStep({ data, onChange, onError }: StepComponentProps) {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);

  return (
    <div className="space-y-4">
      <h3 className="text-gray-100 font-bold text-lg mb-1">{T("createPassword")}</h3>
      <p className="text-gray-500 text-sm mb-4">{T("secureYourAccount")}</p>

      <div>
        <label className="text-[10px] font-bold text-yellow-500 uppercase tracking-wider mb-1.5 block">{T("password")} *</label>
        <input type="password" className="w-full h-12 px-4 bg-gray-950 border border-gray-800 rounded-xl text-gray-100 text-sm focus:outline-none focus:border-yellow-500/50 transition-all"
          value={(data.password as string) ?? ""} onChange={e => { onChange("password", e.target.value); onError(""); }} placeholder="Min 8 characters" />
      </div>

      <div>
        <label className="text-[10px] font-bold text-yellow-500 uppercase tracking-wider mb-1.5 block">{T("confirmPassword")} *</label>
        <input type="password" className="w-full h-12 px-4 bg-gray-950 border border-gray-800 rounded-xl text-gray-100 text-sm focus:outline-none focus:border-yellow-500/50 transition-all"
          value={(data.confirmPassword as string) ?? ""} onChange={e => { onChange("confirmPassword", e.target.value); onError(""); }} placeholder="Re-enter password" />
      </div>

      <div className="bg-gray-950 border border-gray-800 rounded-xl p-3">
        <p className="text-gray-500 text-xs leading-relaxed">{T("passwordHint")}</p>
      </div>
    </div>
  );
}

/* ── Step 5: Success ────────────────────────────────────────────────── */
function SuccessStep({ data }: StepComponentProps) {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);

  return (
    <div className="text-center">
      <div className="w-20 h-20 rounded-full bg-yellow-500/10 border border-yellow-500/30 flex items-center justify-center mx-auto mb-6">
        <Shield size={40} className="text-yellow-500" />
      </div>
      <h3 className="text-gray-100 font-bold text-2xl mb-3">{T("registrationComplete")}</h3>
      <p className="text-gray-500 text-sm leading-relaxed mb-6">{T("riderApprovalMsg")}</p>
      <div className="bg-gray-950 border border-gray-800 rounded-xl p-4">
        <p className="text-yellow-500 text-xs font-bold uppercase tracking-wider mb-2">{T("nextSteps")}</p>
        <p className="text-gray-400 text-xs leading-relaxed">{T("approvalReviewMsg")}</p>
      </div>
    </div>
  );
}

/* ── Wizard config ─────────────────────────────────────────────────────────── */
const STEPS: StepConfig[] = [
  {
    id: "phone",
    title: "Phone",
    component: PhoneInfoStep,
    validate: (data) => {
      if (!String(data.name ?? "").trim()) return "Full name is required";
      const phone = String(data.phone ?? "").trim();
      if (!phone) return "Phone number is required";
      if (phone.replace(/\D/g, "").length < 10) return "Enter a valid phone number";
      return null;
    },
  },
  { id: "otp", title: "Verify", component: OtpStep },
  {
    id: "vehicle",
    title: "Vehicle",
    component: VehicleStep,
    validate: (data) => {
      if (!String(data.cnic ?? "").trim()) return "CNIC number is required";
      if (!String(data.vehicleType ?? "").trim()) return "Please select a vehicle type";
      if (!String(data.drivingLicense ?? "").trim()) return "Driving license number is required";
      if (!String(data.vehicleRegistration ?? "").trim()) return "Vehicle registration number is required";
      return null;
    },
  },
  {
    id: "password",
    title: "Password",
    component: PasswordStep,
    validate: (data) => {
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
  const auth = useRiderAuthConfig();

  const [draft, setDraft] = useState<Record<string, unknown>>(() => {
    try { const raw = localStorage.getItem(DRAFT_KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
  });

  /* ── Save draft on every change ── */
  const handleDataChange = useCallback((key: string, value: unknown) => {
    setDraft(prev => {
      const next = { ...prev, [key]: value };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  /* ── OTP send handler ── */
  const handleOtpRequest = async (phone: string) => {
    const result = await sendOtp(phone);
    return result.success;
  };

  /* ── Submit handler ── */
  const handleSubmit = async (data: Record<string, unknown>) => {
    try {
      const res = await api.registerRider({
        name: data.name as string,
        phone: data.phone as string,
        username: data.username as string | undefined,
        cnic: data.cnic as string,
        vehicleType: data.vehicleType as string,
        vehicleRegistration: data.vehicleRegistration as string,
        drivingLicense: data.drivingLicense as string,
        password: data.password as string,
      }) as { token?: string; user?: unknown };
      localStorage.removeItem(DRAFT_KEY);
      return { success: true, data: res };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : T("registrationFailed") };
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: theme.background }}>
      <div className="max-w-sm mx-auto px-5 py-8">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-gray-500 hover:text-gray-100 text-sm font-medium mb-6 transition-colors"
        >
          <ArrowLeft size={16} /> {T("backToLogin")}
        </button>

        <div
          style={{
            background: theme.surface,
            border: `1px solid ${theme.border}`,
            borderRadius: 18,
            padding: "28px 24px",
            boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
          }}
        >
          <div className="text-center mb-6">
            <h1 className="text-gray-100 font-extrabold text-2xl mb-1">
              {T("riderRegistration")}
            </h1>
          </div>

          <RegisterScreen
            role="rider"
            steps={STEPS}
            bare
            initialData={draft}
            onDataChange={handleDataChange}
            onOtpRequest={handleOtpRequest}
            onSubmit={handleSubmit}
            onDone={() => { onDone?.(); navigate("/"); }}
          />
        </div>
      </div>
    </div>
  );
}

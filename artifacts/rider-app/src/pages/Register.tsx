import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { RegisterScreen, OtpInput } from "@workspace/auth-react";
import type { StepConfig, StepComponentProps } from "@workspace/auth-react";
import { api, isApiError, setApiTimeoutMs } from "../lib/api";
import { createLogger } from "@/lib/logger";
import { usePlatformConfig, buildPhoneValidator } from "../lib/useConfig";
import { useRiderAuthConfig } from "../lib/AuthConfigContext";
import { useLanguage } from "../lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { executeCaptcha } from "@workspace/auth-utils";
import { compressImage } from "../lib/imageUtils";
import { useAuth, type AuthUser } from "../lib/rider-auth";
import { RegisterStepPhone } from "./register/RegisterStepPhone";
import { RegisterStepPersonal } from "./register/RegisterStepPersonal";
import type { UploadedDoc } from "./register/RegisterStepDocuments";
import { Lock, Phone, ArrowLeft, Clock, Lightbulb, Shield } from "lucide-react";

const log = createLogger("[Register]");
const DRAFT_KEY = "rider_reg_draft";

/* ── Step 1 adapter: personal info + phone ───────────────────────────────── */
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
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [data.username]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <RegisterStepPhone
      name={(data.name as string) ?? ""}
      setName={(v) => { onChange("name", v); onError(""); }}
      phone={(data.phone as string) ?? ""}
      setPhone={(v) => { onChange("phone", v); onError(""); }}
      setPhoneE164={(v) => { onChange("phoneE164", v); }}
      email={(data.email as string) ?? ""}
      setEmail={(v) => { onChange("email", v); onError(""); }}
      address={(data.address as string) ?? ""}
      setAddress={(v) => { onChange("address", v); onError(""); }}
      city={(data.city as string) ?? ""}
      setCity={(v) => { onChange("city", v); onError(""); }}
      customCity={(data.customCity as string) ?? ""}
      setCustomCity={(v) => { onChange("customCity", v); onError(""); }}
      emergencyContact={(data.emergencyContact as string) ?? ""}
      setEmergencyContact={(v) => { onChange("emergencyContact", v); onError(""); }}
      username={(data.username as string) ?? ""}
      setUsername={(v) => { onChange("username", v); onError(""); }}
      usernameStatus={usernameStatus}
      availabilityStatus={usernameStatus}
      loading={false}
      phoneEnabled={auth.phoneEnabled ?? true}
      emailEnabled={auth.emailEnabled ?? false}
      googleEnabled={auth.googleEnabled ?? false}
      facebookEnabled={auth.facebookEnabled ?? false}
      googleClientId={auth.googleClientId}
      facebookAppId={auth.facebookAppId}
      handleSocialAutofill={(_provider) => {
        const hint = config.regional?.phoneHint ?? "03XXXXXXXXX";
        if (!hint) onError("");
      }}
      T={T}
    />
  );
}

/* ── Step 2 adapter: vehicle info + document uploads ─────────────────────── */
function VehicleDocsStep({ data, onChange, onError }: StepComponentProps) {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);

  const [uploadingField, setUploadingField] = useState("");
  const [optimisingField, setOptimisingField] = useState("");
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});

  const handleFileUpload = useCallback(async (file: File, field: string, setter: (doc: UploadedDoc) => void) => {
    const preview = URL.createObjectURL(file);
    setUploadErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
    setApiTimeoutMs(90_000);
    try {
      const compressed = await compressImage(file);
      setOptimisingField(""); setUploadingField(field);
      const res = await api.uploadRegistrationDoc(compressed);
      setter({ label: file.name, url: res.url, preview });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : T("uploadFailed");
      setUploadErrors(prev => ({ ...prev, [field]: msg }));
      onError(msg);
    } finally {
      setApiTimeoutMs(30_000); setOptimisingField(""); setUploadingField("");
    }
  }, [onError, T]); // eslint-disable-line react-hooks/exhaustive-deps

  const setDoc = (field: string) => (doc: UploadedDoc) => { onChange(field, doc); };

  return (
    <RegisterStepPersonal
      cnic={(data.cnic as string) ?? ""}
      setCnic={(v) => { onChange("cnic", v); onError(""); }}
      vehicleType={(data.vehicleType as string) ?? ""}
      setVehicleType={(v) => { onChange("vehicleType", v); onError(""); }}
      vehicleReg={(data.vehicleReg as string) ?? ""}
      setVehicleReg={(v) => { onChange("vehicleReg", v); onError(""); }}
      drivingLicense={(data.drivingLicense as string) ?? ""}
      setDrivingLicense={(v) => { onChange("drivingLicense", v); onError(""); }}
      vehiclePhoto={(data.vehiclePhoto as UploadedDoc | null) ?? null}
      setVehiclePhoto={setDoc("vehiclePhoto")}
      cnicPhoto={(data.cnicPhoto as UploadedDoc | null) ?? null}
      setCnicPhoto={setDoc("cnicPhoto")}
      cnicBackPhoto={(data.cnicBackPhoto as UploadedDoc | null) ?? null}
      setCnicBackPhoto={setDoc("cnicBackPhoto")}
      licensePhoto={(data.licensePhoto as UploadedDoc | null) ?? null}
      setLicensePhoto={setDoc("licensePhoto")}
      uploadingField={uploadingField}
      optimisingField={optimisingField}
      uploadErrors={uploadErrors}
      handleFileUpload={handleFileUpload}
      registrationNote={(data.registrationNote as string) ?? ""}
      setRegistrationNote={(v) => { onChange("registrationNote", v); }}
      T={T}
    />
  );
}

/* ── Step definitions ────────────────────────────────────────────────────── */
const riderSteps: StepConfig[] = [
  {
    id: "personal",
    title: "Personal Info",
    subtitle: "Tell us about yourself",
    fields: [],
    component: PhoneInfoStep,
  },
  {
    id: "vehicle",
    title: "Vehicle & Documents",
    subtitle: "Vehicle details and verification docs",
    fields: [],
    component: VehicleDocsStep,
  },
  {
    id: "security",
    title: "Password & Terms",
    subtitle: "Secure your account",
    fields: [
      { id: "password", type: "password", label: "Password", required: true, placeholder: "Min 8 characters" },
      { id: "confirmPassword", type: "confirm-password", label: "Confirm Password", required: true },
      { id: "acceptedTerms", type: "checkbox", label: "I accept the Terms & Conditions and Privacy Policy", required: true,
        validate: (v) => v ? null : "Please accept the Terms & Conditions" },
    ],
  },
];

/* ── Main component ──────────────────────────────────────────────────────── */
export default function Register() {
  const { config } = usePlatformConfig();
  const auth = useRiderAuthConfig();
  const { login: authLogin } = useAuth();
  const [, navigate] = useLocation();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);

  const [phase, setPhase] = useState<"form" | "otp" | "done">("form");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pendingApproval, setPendingApproval] = useState(false);

  const [registeredPhone, setRegisteredPhone] = useState("");
  const [registeredEmail, setRegisteredEmail] = useState("");
  const [verifyChannel, setVerifyChannel] = useState<"phone" | "email">("phone");
  const [devOtp, setDevOtp] = useState("");

  if (config.platform.appStatus === "maintenance") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl">
          <h2 className="text-2xl font-bold text-gray-800 mb-3">Under Maintenance</h2>
          <p className="text-gray-500 text-sm mb-5">{config.content.maintenanceMsg || "Back soon!"}</p>
          <Link href="/" className="w-full h-11 bg-gray-900 text-white font-bold rounded-xl flex items-center justify-center gap-2 text-sm">
            <ArrowLeft size={15} /> Back to Login
          </Link>
        </div>
      </div>
    );
  }

  if (!config.features.newUsers) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl">
          <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <Lock size={36} className="text-red-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-3">Registration Closed</h2>
          <p className="text-gray-500 text-sm mb-5">{T("registrationClosedDesc")}</p>
          {config.platform.supportPhone && (
            <p className="text-sm font-bold text-gray-700 flex items-center justify-center gap-2">
              <Phone size={13} className="text-gray-400" /> {config.platform.supportPhone}
            </p>
          )}
          <Link href="/" className="mt-4 w-full h-11 bg-gray-900 text-white font-bold rounded-xl flex items-center justify-center gap-2 text-sm">
            <ArrowLeft size={15} /> {T("goToLogin")}
          </Link>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl">
          <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <Clock size={40} className="text-amber-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-3">{T("pendingAdminApproval")}</h2>
          <p className="text-gray-500 text-sm mb-5">{T("pendingApprovalMsg")}</p>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3 text-left flex gap-2">
            <Lightbulb size={14} className="text-amber-500 mt-0.5" />
            <p className="text-amber-700 text-xs font-medium">{T("approvalTakes")}</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-5 text-left flex gap-2">
            <Shield size={14} className="text-blue-500 mt-0.5" />
            <p className="text-blue-700 text-xs font-medium">Admin will review your documents before activating your account.</p>
          </div>
          <Link href="/" className="w-full h-11 bg-gray-900 text-white font-bold rounded-xl flex items-center justify-center gap-2 text-sm">
            <ArrowLeft size={15} /> {T("goToLogin")}
          </Link>
        </div>
      </div>
    );
  }

  if (phase === "otp") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl">
          <h2 className="text-2xl font-bold text-gray-800 mb-2 text-center">Verify {verifyChannel === "phone" ? "Phone" : "Email"}</h2>
          <p className="text-gray-500 text-sm text-center mb-6">
            Code sent to {verifyChannel === "phone" ? registeredPhone : registeredEmail}
          </p>
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-sm text-red-700">{error}</div>
          )}
          {process.env.NODE_ENV !== "production" && devOtp && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-2 mb-4 text-center text-xs text-amber-800">
              Dev OTP: <strong className="tracking-widest">{devOtp}</strong>
            </div>
          )}
          <OtpInput
            onComplete={async (otp) => {
              setError(""); setLoading(true);
              try {
                let captchaToken: string | undefined;
                if (auth.captchaEnabled) {
                  try { captchaToken = await executeCaptcha("register_verify_otp", auth.captchaSiteKey ?? ""); } catch (err) { log.warn("captcha failed:", err); } // eslint-disable-line no-console
                }
                type OtpRes = { token?: string; refreshToken?: string; user?: AuthUser; pendingApproval?: boolean };
                let res: OtpRes;
                if (verifyChannel === "phone") {
                  res = await api.verifyOtp(registeredPhone, otp, undefined, captchaToken) as OtpRes;
                } else {
                  res = await api.verifyEmailOtp(registeredEmail, otp, undefined, captchaToken) as OtpRes;
                }
                if (res?.token) {
                  api.storeTokens(res.token, res.refreshToken);
                  let profile: AuthUser | null = res.user ?? null;
                  if (!profile) {
                    try { profile = await api.getMe() as AuthUser; } catch (e) {
                      log.warn("getMe failed:", e instanceof Error ? e.message : e);
                      sessionStorage.removeItem(DRAFT_KEY); setPhase("done"); return;
                    }
                  }
                  sessionStorage.removeItem(DRAFT_KEY);
                  authLogin(res.token, profile, res.refreshToken);
                  navigate("/");
                } else {
                  sessionStorage.removeItem(DRAFT_KEY);
                  setPhase("done");
                }
              } catch (e: unknown) { setError(e instanceof Error ? e.message : T("verificationFailed")); }
              setLoading(false);
            }}
            onResend={async () => {
              setError(""); setLoading(true);
              try {
                if (verifyChannel === "phone") {
                  const res = await api.sendOtp(registeredPhone) as { otp?: string };
                  if (res.otp) setDevOtp(res.otp);
                } else {
                  const res = await api.sendEmailOtp(registeredEmail) as { otp?: string };
                  if (res.otp) setDevOtp(res.otp);
                }
              } catch (e: unknown) { setError(e instanceof Error ? e.message : T("resendFailed")); }
              setLoading(false);
            }}
          />
          {loading && <p className="text-center text-sm text-gray-400 mt-4">Verifying…</p>}
        </div>
      </div>
    );
  }

  async function handleFormComplete(data: Record<string, unknown>) {
    setLoading(true);
    try {
      const selectedChannel = (() => {
        if (!auth.phoneEnabled && auth.emailEnabled) return "email" as const;
        return "phone" as const;
      })();
      setVerifyChannel(selectedChannel);

      let captchaToken: string | undefined;
      if (auth.captchaEnabled) {
        try { captchaToken = await executeCaptcha("register", auth.captchaSiteKey); } catch (err) { log.warn("captcha failed:", err); }
        if (!captchaToken) { setLoading(false); return; }
      }

      const vehiclePhoto = data.vehiclePhoto as UploadedDoc | undefined;
      const cnicPhoto = data.cnicPhoto as UploadedDoc | undefined;
      const cnicBackPhoto = data.cnicBackPhoto as UploadedDoc | undefined;
      const licensePhoto = data.licensePhoto as UploadedDoc | undefined;
      const docsPayload = {
        files: [
          ...(cnicPhoto?.url ? [{ type: "cnic_front", url: cnicPhoto.url, label: "CNIC Front" }] : []),
          ...(cnicBackPhoto?.url ? [{ type: "cnic_back", url: cnicBackPhoto.url, label: "CNIC Back" }] : []),
          ...(licensePhoto?.url ? [{ type: "driving_license", url: licensePhoto.url, label: "Driving License" }] : []),
        ],
        ...((data.registrationNote as string)?.trim() ? { note: (data.registrationNote as string).trim() } : {}),
      };

      const regData = {
        name: (data.name as string).trim(),
        ...(auth.phoneEnabled ? { phone: data.phoneE164 as string } : {}),
        ...(auth.emailEnabled && (data.email as string) ? { email: (data.email as string).trim() } : {}),
        cnic: (data.cnic as string).trim(),
        vehicleType: data.vehicleType as string,
        vehicleRegistration: (data.vehicleReg as string).trim(),
        drivingLicense: (data.drivingLicense as string).trim(),
        password: data.password as string,
        captchaToken,
        address: (data.address as string).trim(),
        city: (data.city as string) === "Other" ? (data.customCity as string).trim() : (data.city as string).trim(),
        emergencyContact: (data.emergencyContact as string).trim(),
        vehiclePhoto: vehiclePhoto?.url,
        documents: JSON.stringify(docsPayload),
        ...(data.username ? { username: (data.username as string).trim() } : {}),
      };

      if (selectedChannel === "email") {
        const res = await api.sendEmailOtp((data.email as string).trim()) as { otp?: string };
        setRegisteredEmail((data.email as string).trim());
        if (res.otp) setDevOtp(res.otp);
        await api.registerRider(regData);
      } else {
        const res = await api.registerRider(regData) as { otp?: string; otpChannel?: string };
        if (res.otp) setDevOtp(res.otp);
        setRegisteredPhone(data.phoneE164 as string);
      }
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step: 3, ...data }));
      setPhase("otp");
    } catch (e: unknown) {
      if (isApiError(e) && (e.status === 409 || e.message?.includes("already"))) {
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : T("registrationFailed"));
      }
    }
    setLoading(false);
  }

  return (
    <RegisterScreen
      role="rider"
      title="Rider Registration"
      steps={riderSteps}
      onComplete={(data) => void handleFormComplete(data)}
    />
  );
}

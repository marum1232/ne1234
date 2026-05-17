import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { OtpInput, PasswordInput } from "@workspace/auth-react";
import { api, isApiError, setApiTimeoutMs } from "../lib/api";
import { createLogger } from "@/lib/logger";
const log = createLogger("[Register]");
import { usePlatformConfig, buildPhoneValidator } from "../lib/useConfig";
import { useRiderAuthConfig } from "../lib/AuthConfigContext";
import { useLanguage } from "../lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { executeCaptcha, loadGoogleGSIToken, loadFacebookAccessToken, decodeGoogleJwtPayload } from "@workspace/auth-utils";
import { compressImage } from "../lib/imageUtils";
import { useAuth, type AuthUser } from "../lib/rider-auth";
import {
  Bike, ArrowLeft, ArrowRight, Loader2,
  Clock, Shield, Lightbulb, AlertCircle, CheckCircle2, Wrench, Lock, Phone,
} from "lucide-react";

import { RegisterStepPhone } from "./register/RegisterStepPhone";
import { RegisterStepPersonal } from "./register/RegisterStepPersonal";
import type { UploadedDoc } from "./register/RegisterStepDocuments";

const DRAFT_KEY = "rider_reg_draft";

export default function Register() {
  const { config } = usePlatformConfig();
  const auth = useRiderAuthConfig();
  const { login: authLogin } = useAuth();
  const [, navigate] = useLocation();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);

  const captchaSiteKey = auth.captchaSiteKey ?? config.auth?.captchaSiteKey;
  const isValidPhone = buildPhoneValidator(config);
  const phoneHint = config.regional?.phoneHint ?? "03XXXXXXXXX";

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [existingAccountError, setExistingAccountError] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneE164, setPhoneE164] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const usernameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [customCity, setCustomCity] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");

  const [cnic, setCnic] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [vehicleReg, setVehicleReg] = useState("");
  const [drivingLicense, setDrivingLicense] = useState("");

  const [vehiclePhoto, setVehiclePhoto] = useState<UploadedDoc | null>(null);
  const [cnicPhoto, setCnicPhoto] = useState<UploadedDoc | null>(null);
  const [cnicBackPhoto, setCnicBackPhoto] = useState<UploadedDoc | null>(null);
  const [licensePhoto, setLicensePhoto] = useState<UploadedDoc | null>(null);
  const [uploadingField, setUploadingField] = useState("");
  const [optimisingField, setOptimisingField] = useState("");
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
  const [lastFiles, setLastFiles] = useState<Record<string, File>>({});
  const [registrationNote, setRegistrationNote] = useState("");

  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const [otp, setOtp] = useState("");
  const [devOtp, setDevOtp] = useState("");
  const [verifyChannel, setVerifyChannel] = useState<"phone" | "email">("phone");
  const [otpSendFailed, setOtpSendFailed] = useState(false);
  const [resendingOtp, setResendingOtp] = useState(false);

  const [registrationOtpChannel, setRegistrationOtpChannel] = useState("sms");
  const [registrationFallbackChannels, setRegistrationFallbackChannels] = useState<string[]>([]);
  const [channelSwitchMsg, setChannelSwitchMsg] = useState("");
  const channelMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [completed, setCompleted] = useState(false);

  /* Restore draft on first mount so riders can continue where they left off */
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(DRAFT_KEY);
      if (!saved) return;
      const draft = JSON.parse(saved) as Record<string, unknown>;
      if (typeof draft.step === "number" && draft.step > 1) {
        if (typeof draft.name === "string") setName(draft.name);
        if (typeof draft.phone === "string") setPhone(draft.phone);
        if (typeof draft.email === "string") setEmail(draft.email);
        if (typeof draft.username === "string") setUsername(draft.username);
        if (typeof draft.address === "string") setAddress(draft.address);
        if (typeof draft.city === "string") setCity(draft.city);
        if (typeof draft.customCity === "string") setCustomCity(draft.customCity);
        if (typeof draft.emergencyContact === "string") setEmergencyContact(draft.emergencyContact);
        if (typeof draft.cnic === "string") setCnic(draft.cnic);
        if (typeof draft.vehicleType === "string") setVehicleType(draft.vehicleType);
        if (typeof draft.vehicleReg === "string") setVehicleReg(draft.vehicleReg);
        if (typeof draft.drivingLicense === "string") setDrivingLicense(draft.drivingLicense);
        if (draft.vehiclePhoto && typeof draft.vehiclePhoto === "object") setVehiclePhoto(draft.vehiclePhoto as UploadedDoc);
        if (draft.cnicPhoto && typeof draft.cnicPhoto === "object") setCnicPhoto(draft.cnicPhoto as UploadedDoc);
        if (draft.cnicBackPhoto && typeof draft.cnicBackPhoto === "object") setCnicBackPhoto(draft.cnicBackPhoto as UploadedDoc);
        if (draft.licensePhoto && typeof draft.licensePhoto === "object") setLicensePhoto(draft.licensePhoto as UploadedDoc);
        /* Do not restore step 4 — OTP is single-use and requires a fresh send */
        setStep(Math.min(draft.step as number, 3));
      }
    } catch {
      /* ignore corrupt draft */
    }
  }, []);

  /* Persist draft whenever step or key form fields change */
  useEffect(() => {
    if (step <= 1 || step >= 4) return; /* nothing useful to save at step 1 or OTP step */
    try {
      const draft = {
        step,
        name, phone, email, username, address, city, customCity, emergencyContact,
        cnic, vehicleType, vehicleReg, drivingLicense,
        vehiclePhoto: vehiclePhoto ? { label: vehiclePhoto.label, url: vehiclePhoto.url, preview: vehiclePhoto.url } : null,
        cnicPhoto: cnicPhoto ? { label: cnicPhoto.label, url: cnicPhoto.url, preview: cnicPhoto.url } : null,
        cnicBackPhoto: cnicBackPhoto ? { label: cnicBackPhoto.label, url: cnicBackPhoto.url, preview: cnicBackPhoto.url } : null,
        licensePhoto: licensePhoto ? { label: licensePhoto.label, url: licensePhoto.url, preview: licensePhoto.url } : null,
      };
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* ignore quota errors */
    }
  }, [step, name, phone, email, username, address, city, customCity, emergencyContact,
      cnic, vehicleType, vehicleReg, drivingLicense,
      vehiclePhoto, cnicPhoto, cnicBackPhoto, licensePhoto]);

  const availabilityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [availabilityStatus, setAvailabilityStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");

  const clearError = () => { setError(""); setExistingAccountError(false); };

  const handleFileUpload = useCallback(async (file: File, field: string, setter: (doc: UploadedDoc) => void) => {
    setLastFiles(prev => ({ ...prev, [field]: file }));
    setOptimisingField(field);
    setUploadErrors(prev => { const next = { ...prev }; delete next[field]; return next; });
    const preview = URL.createObjectURL(file);
    setApiTimeoutMs(90_000);
    const MAX_RETRIES = 3;
    let lastErr: Error | null = null;
    try {
      const compressed = await compressImage(file);
      setOptimisingField("");
      setUploadingField(field);
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const res = await api.uploadRegistrationDoc(compressed);
          setter({ label: file.name, url: res.url, preview });
          lastErr = null;
          break;
        } catch (e: unknown) {
          lastErr = e instanceof Error ? e : new Error(T("uploadFailed"));
          if (attempt < MAX_RETRIES - 1) {
            await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt)));
          }
        }
      }
      if (lastErr) {
        setUploadErrors(prev => ({ ...prev, [field]: lastErr!.message }));
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : T("uploadFailed");
      setUploadErrors(prev => ({ ...prev, [field]: msg }));
    } finally {
      setApiTimeoutMs(30_000);
      setOptimisingField("");
      setUploadingField("");
    }
  }, []);

  const usernameAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!username || username.length < 3) { setUsernameStatus("idle"); return; }
    if (usernameTimer.current) clearTimeout(usernameTimer.current);
    usernameTimer.current = setTimeout(async () => {
      /* Abort any in-flight request from a previous keystroke */
      if (usernameAbortRef.current) usernameAbortRef.current.abort();
      usernameAbortRef.current = new AbortController();
      setUsernameStatus("checking");
      try {
        const res = await api.checkAvailable({ username }, usernameAbortRef.current?.signal);
        if (res.username && !res.username.available) setUsernameStatus("taken");
        else setUsernameStatus("available");
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") return;
        setUsernameStatus("taken");
      }
    }, 600);
    return () => {
      if (usernameTimer.current) clearTimeout(usernameTimer.current);
      if (usernameAbortRef.current) usernameAbortRef.current.abort();
    };
  }, [username]);

  useEffect(() => {
    if (name && !username) {
      const suggested = name.trim().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
      if (suggested.length >= 3) setUsername(suggested);
    }
  }, [name]);

  useEffect(() => {
    const phoneReady = !auth.phoneEnabled || (phone && phone.length >= 10);
    const emailReady = !auth.emailEnabled || (email && email.includes("@"));
    if (!phoneReady || !emailReady) { setAvailabilityStatus("idle"); return; }
    if (!auth.phoneEnabled && !auth.emailEnabled) { setAvailabilityStatus("idle"); return; }
    if (availabilityTimer.current) clearTimeout(availabilityTimer.current);
    availabilityTimer.current = setTimeout(async () => {
      setAvailabilityStatus("checking");
      try {
        await api.checkAvailable({
          ...(auth.phoneEnabled ? { phone: phoneE164 } : {}),
          ...(auth.emailEnabled && email ? { email } : {}),
        });
        setAvailabilityStatus("available");
      } catch {
        setAvailabilityStatus("taken");
      }
    }, 800);
    return () => { if (availabilityTimer.current) clearTimeout(availabilityTimer.current); };
  }, [phone, email, auth.phoneEnabled, auth.emailEnabled]);

  const handleSocialAutofill = async (provider: "google" | "facebook") => {
    const googleClientId = auth.googleClientId ?? config.auth?.googleClientId;
    const facebookAppId = auth.facebookAppId ?? config.auth?.facebookAppId;
    if (provider === "google" && !googleClientId) { setError(T("socialLoginComingSoon")); return; }
    if (provider === "facebook" && !facebookAppId) { setError(T("socialLoginComingSoon")); return; }
    setLoading(true); clearError();
    try {
      if (provider === "google") {
        const idToken = await loadGoogleGSIToken(googleClientId!);
        const payload = decodeGoogleJwtPayload(idToken);
        if (payload.name) setName(payload.name);
        if (payload.email) setEmail(payload.email);
      } else {
        const accessToken = await loadFacebookAccessToken(facebookAppId!);
        const fbRes = await fetch(`https://graph.facebook.com/me?fields=name,email&access_token=${accessToken}`);
        if (!fbRes.ok) throw new Error("Failed to fetch Facebook profile");
        const fbData = await fbRes.json();
        if (fbData.error) throw new Error(fbData.error.message || "Facebook profile error");
        if (fbData.name) setName(fbData.name);
        if (fbData.email) setEmail(fbData.email);
      }
      setStep(2);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : T("loginFailed")); }
    setLoading(false);
  };

  const validateStep1 = (): boolean => {
    if (!name.trim()) { setError(T("nameRequired")); return false; }
    if (auth.phoneEnabled && (!phone || !isValidPhone(phone))) { setError(`${T("enterValidPhone")} (e.g. ${phoneHint})`); return false; }
    if (auth.emailEnabled && (!email || !email.includes("@"))) { setError(T("enterValidEmail")); return false; }
    if (!address.trim()) { setError(T("homeAddressRequired")); return false; }
    if (!city) { setError(T("selectCity")); return false; }
    if (city === "Other" && !customCity.trim()) { setError(T("enterCityName")); return false; }
    if (!emergencyContact.trim() || emergencyContact.replace(/\D/g, "").length < 10) {
      setError(T("emergencyContactRequired")); return false;
    }
    if (availabilityStatus === "taken") { setError(T("alreadyRegistered")); return false; }
    if (!username || username.length < 3) { setError(T("usernameRequired") || "Username is required (min 3 characters)"); return false; }
    if (usernameStatus === "taken") { setError(T("usernameTaken")); return false; }
    if (usernameStatus === "checking" || usernameStatus === "idle") {
      setError(T("usernameCheckWait")); return false;
    }
    return true;
  };

  const validateStep2 = (): boolean => {
    const cnicDigits = cnic.replace(/\D/g, "");
    if (cnicDigits.length !== 13) { setError(T("cnicRequired")); return false; }
    if (!vehicleType) { setError(T("vehicleTypeRequired")); return false; }
    if (!vehicleReg.trim()) { setError(T("vehicleRegRequired")); return false; }
    if (!drivingLicense.trim()) { setError(T("drivingLicenseRequired")); return false; }
    if (!vehiclePhoto) { setError(T("vehiclePhotoRequired")); return false; }
    if (!cnicPhoto) { setError(T("cnicFrontRequired")); return false; }
    if (!cnicBackPhoto) { setError(T("cnicBackRequired")); return false; }
    if (!licensePhoto) { setError(T("licensePhotoRequired")); return false; }
    return true;
  };

  const validateStep3 = (): boolean => {
    if (password.length < 8) { setError(T("passwordMinLength")); return false; }
    if (password !== confirmPw) { setError(T("passwordsDoNotMatch")); return false; }
    if (!acceptedTerms) { setError(T("termsRequired")); return false; }
    return true;
  };

  const checkAvailability = async (): Promise<boolean> => {
    try {
      await api.checkAvailable({
        ...(auth.phoneEnabled ? { phone: phoneE164 } : {}),
        ...(auth.emailEnabled && email ? { email } : {}),
        ...(username ? { username } : {}),
      });
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : T("loginFailed"));
      return false;
    }
  };

  const goNextStep = async () => {
    clearError();
    if (step === 1) {
      if (!validateStep1()) return;
      setLoading(true);
      const available = await checkAvailability();
      setLoading(false);
      if (!available) return;
      setStep(2);
    } else if (step === 2) {
      if (!validateStep2()) return;
      setStep(3);
    } else if (step === 3) {
      if (!validateStep3()) return;
      setLoading(true);
      try {
        let captchaToken: string | undefined;
        if (auth.captchaEnabled) {
          try { captchaToken = await executeCaptcha("register", captchaSiteKey); } catch { /* noop */ }
          if (!captchaToken) { setError(T("captchaRequired")); setLoading(false); return; }
        }
        const selectedChannel = (() => {
          if (!auth.phoneEnabled && auth.emailEnabled) return "email" as const;
          if (auth.phoneEnabled && !auth.emailEnabled) return "phone" as const;
          return verifyChannel;
        })();
        setVerifyChannel(selectedChannel);

        const docsPayload: { files: { type: string; url: string; label: string }[]; note?: string } = { files: [] };
        if (cnicPhoto?.url) docsPayload.files.push({ type: "cnic_front", url: cnicPhoto.url, label: "CNIC Front" });
        if (cnicBackPhoto?.url) docsPayload.files.push({ type: "cnic_back", url: cnicBackPhoto.url, label: "CNIC Back" });
        if (licensePhoto?.url) docsPayload.files.push({ type: "driving_license", url: licensePhoto.url, label: "Driving License" });
        /* vehiclePhoto is sent as a top-level field — do NOT duplicate it inside documents JSON */
        if (registrationNote.trim()) docsPayload.note = registrationNote.trim();

        const regData = {
          name: name.trim(),
          ...(auth.phoneEnabled ? { phone: phoneE164 } : {}),
          ...(auth.emailEnabled && email.trim() ? { email: email.trim() } : {}),
          cnic: cnic.trim(),
          vehicleType,
          vehicleRegistration: vehicleReg.trim(),
          drivingLicense: drivingLicense.trim(),
          password,
          captchaToken,
          address: address.trim(),
          city: city === "Other" ? customCity.trim() : city.trim(),
          emergencyContact: emergencyContact.trim(),
          vehiclePhoto: vehiclePhoto?.url || undefined,
          documents: JSON.stringify(docsPayload),
          ...(username ? { username: username.trim() } : {}),
        };
        if (selectedChannel === "email") {
          try {
            await api.emailRegisterRider(regData);
          } catch (e: unknown) { setError(e instanceof Error ? e.message : T("loginFailed")); setLoading(false); return; }
          try {
            const emailRes = await api.sendEmailOtp(email.trim(), captchaToken);
            setDevOtp(emailRes.otp || "");
            setOtpSendFailed(false);
          } catch {
            setOtpSendFailed(true);
          }
          setVerifyChannel("email");
        } else {
          try {
            const res = await api.registerRider(regData);
            /* otpSkipped: server signals OTP is not needed (bypass or no OTP channel) */
            if ((res as Record<string, unknown>).otpSkipped) {
              if (res.token) {
                api.storeTokens(res.token, res.refreshToken);
                if (res.pendingApproval) { sessionStorage.removeItem(DRAFT_KEY); setCompleted(true); setLoading(false); return; }
                let profile: AuthUser | null = res.user ?? null;
                if (!profile) {
                  try { profile = await api.getMe() as AuthUser; } catch { api.clearTokens(); sessionStorage.removeItem(DRAFT_KEY); setCompleted(true); setLoading(false); return; }
                }
                sessionStorage.removeItem(DRAFT_KEY);
                authLogin(res.token, profile!, res.refreshToken);
                navigate("/");
              } else {
                /* No token yet — pending OTP-less registration (needs approval) */
                sessionStorage.removeItem(DRAFT_KEY);
                setCompleted(true);
              }
              setLoading(false); return;
            }
            setDevOtp(res.otp || "");
            setRegistrationOtpChannel((res as Record<string, unknown>).channel as string || "sms");
            setRegistrationFallbackChannels((res as Record<string, unknown>).fallbackChannels as string[] || []);
          } catch (e: unknown) {
            const err = e instanceof Error ? e : new Error(T("loginFailed"));
            const apiErr = isApiError(e) ? e : null;
            const isExisting = apiErr?.status === 409 || apiErr?.responseData?.existingAccount === true;
            if (isExisting) {
              /* Account already exists — show friendly message with login link */
              setError(err.message || T("alreadyRegistered"));
              setExistingAccountError(true);
              setLoading(false); return;
            }
            setError(err.message);
            setLoading(false); return;
          }
        }
        setStep(4);
      } catch (e: unknown) { setError(e instanceof Error ? e.message : T("loginFailed")); }
      setLoading(false);
    } else if (step === 4) {
      if (!otp || otp.length < 6) { setError(T("enterOtpDigits")); return; }
      setLoading(true);
      try {
        let captchaToken: string | undefined;
        if (auth.captchaEnabled) {
          captchaToken = await executeCaptcha("register_verify_otp", captchaSiteKey || "");
        }
        type OtpVerifyResponse = {
          token?: string; refreshToken?: string;
          user?: AuthUser;
          pendingApproval?: boolean;
        };
        let res: OtpVerifyResponse;
        if (verifyChannel === "phone") {
          res = await api.verifyOtp(phoneE164, otp, undefined, captchaToken) as OtpVerifyResponse;
        } else {
          res = await api.verifyEmailOtp(email, otp, undefined, captchaToken) as OtpVerifyResponse;
        }
        /* If server returns a token the rider was auto-approved, log them in directly.
           Backend may return a token without an embedded user object; in that case,
           store the token and fetch the full profile via getMe(). */
        if (res?.token) {
          api.storeTokens(res.token, res.refreshToken);
          let profile: AuthUser | null = res.user ?? null;
          if (!profile) {
            try {
              profile = await api.getMe() as AuthUser;
            } catch (getMeErr: unknown) {
              /* getMe failed after OTP verify — treat as pending to avoid partial login state */
              log.warn("getMe failed after OTP verify:", getMeErr instanceof Error ? getMeErr.message : getMeErr);
              sessionStorage.removeItem(DRAFT_KEY);
              setCompleted(true);
              return;
            }
          }
          sessionStorage.removeItem(DRAFT_KEY);
          authLogin(res.token, profile, res.refreshToken);
          navigate("/");
        } else {
          sessionStorage.removeItem(DRAFT_KEY);
          setCompleted(true);
        }
      } catch (e: unknown) { setError(e instanceof Error ? e.message : T("verificationFailed")); }
      setLoading(false);
    }
  };

  const stepLabels: TranslationKey[] = ["step1PersonalInfo", "step2VehicleInfo", "step3Security", "step4Verification"];

  if (config.platform.appStatus === "maintenance") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-900 to-gray-800 flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute top-[-20%] right-[-10%] w-72 h-72 rounded-full bg-white/[0.02]" />
        <div className="absolute bottom-[-15%] left-[-10%] w-64 h-64 rounded-full bg-amber-500/[0.04]" />
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl relative z-10">
          <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <Wrench size={36} className="text-amber-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-3">Under Maintenance</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-5">{config.content.maintenanceMsg || "We're performing scheduled maintenance. Back soon!"}</p>
          {(config.platform.supportPhone || config.platform.supportEmail) && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-left mb-5">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Need Help?</p>
              {config.platform.supportPhone && <p className="text-sm font-bold text-gray-700 flex items-center gap-2"><Phone size={13} className="text-gray-400" /> {config.platform.supportPhone}</p>}
              {config.platform.supportEmail && <p className="text-xs text-gray-500 mt-0.5 ml-5">{config.platform.supportEmail}</p>}
            </div>
          )}
          <Link href="/" className="w-full h-11 bg-gray-900 hover:bg-gray-800 text-white font-bold rounded-xl transition-colors text-sm flex items-center justify-center gap-2">
            <ArrowLeft size={15} /> Back to Login
          </Link>
        </div>
      </div>
    );
  }

  if (!config.features.newUsers) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-900 to-gray-800 flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute top-[-20%] right-[-10%] w-72 h-72 rounded-full bg-white/[0.02]" />
        <div className="absolute bottom-[-15%] left-[-10%] w-64 h-64 rounded-full bg-red-500/[0.04]" />
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl relative z-10">
          <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <Lock size={36} className="text-red-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-3">Registration Closed</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-5">New rider registrations are currently not available. Please try again later or contact support.</p>
          {(config.platform.supportPhone || config.platform.supportEmail) && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-left mb-5">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Contact Support</p>
              {config.platform.supportPhone && <p className="text-sm font-bold text-gray-700 flex items-center gap-2"><Phone size={13} className="text-gray-400" /> {config.platform.supportPhone}</p>}
              {config.platform.supportEmail && <p className="text-xs text-gray-500 mt-0.5 ml-5">{config.platform.supportEmail}</p>}
            </div>
          )}
          <Link href="/" className="w-full h-11 bg-gray-900 hover:bg-gray-800 text-white font-bold rounded-xl transition-colors text-sm flex items-center justify-center gap-2">
            <ArrowLeft size={15} /> Back to Login
          </Link>
        </div>
      </div>
    );
  }

  if (completed) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-900 to-gray-800 flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute top-[-20%] right-[-10%] w-72 h-72 rounded-full bg-white/[0.02]" />
        <div className="absolute bottom-[-15%] left-[-10%] w-64 h-64 rounded-full bg-green-500/[0.04]" />
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl relative z-10">
          <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <Clock size={40} className="text-amber-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-3">{T("pendingAdminApproval")}</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-5">{T("pendingApprovalMsg")}</p>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3 text-left flex gap-2">
            <Lightbulb size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-amber-700 text-xs font-medium">{T("approvalTakes")}</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-5 text-left flex gap-2">
            <Shield size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-blue-700 text-xs font-medium">
              Admin will review your documents and vehicle photo before activating your account.
            </p>
          </div>
          <Link href="/" className="w-full h-11 bg-gray-900 hover:bg-gray-800 text-white font-bold rounded-xl transition-colors text-sm flex items-center justify-center gap-2">
            <ArrowLeft size={15} /> {T("goToLogin")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-900 to-gray-800 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-[-20%] right-[-10%] w-72 h-72 rounded-full bg-white/[0.02]" />
      <div className="absolute bottom-[-15%] left-[-10%] w-64 h-64 rounded-full bg-green-500/[0.04]" />
      <div className="absolute top-[30%] left-[5%] w-40 h-40 rounded-full bg-white/[0.015]" />

      <div className="w-full max-w-sm relative z-10">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-white/[0.08] backdrop-blur-sm border border-white/[0.06] rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-xl">
            <Bike size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">{T("registerAsRider")}</h1>
          <p className="text-white/40 mt-1 text-sm">{T("joinAsDeliveryPartner")}</p>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-2xl">
          {config.content.riderNotice && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 flex items-start gap-2">
              <AlertCircle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-amber-700 text-xs font-medium leading-relaxed">{config.content.riderNotice}</p>
            </div>
          )}

          {/* ── Step progress indicator ── */}
          <div className="flex items-center gap-1 mb-6">
            {[1, 2, 3, 4].map(s => (
              <button key={s} type="button"
                onClick={() => { if (s < step) { clearError(); setStep(s); } }}
                className={`flex-1 flex flex-col items-center gap-1 ${s < step ? "cursor-pointer" : "cursor-default"}`}>
                <div className={`w-full h-1.5 rounded-full transition-all ${s <= step ? "bg-gray-900" : "bg-gray-200"}`} />
                <span className={`text-[10px] font-semibold ${s <= step ? "text-gray-900" : "text-gray-400"} ${s < step ? "underline underline-offset-2" : ""}`}>
                  {T(stepLabels[s - 1])}
                </span>
              </button>
            ))}
          </div>

          {/* ── Step 1: Personal info + phone ── */}
          {step === 1 && (
            <RegisterStepPhone
              name={name} setName={setName}
              phone={phone} setPhone={setPhone} setPhoneE164={setPhoneE164}
              email={email} setEmail={setEmail}
              address={address} setAddress={setAddress}
              city={city} setCity={setCity}
              customCity={customCity} setCustomCity={setCustomCity}
              emergencyContact={emergencyContact} setEmergencyContact={setEmergencyContact}
              username={username} setUsername={setUsername}
              usernameStatus={usernameStatus}
              availabilityStatus={availabilityStatus}
              loading={loading}
              phoneEnabled={auth.phoneEnabled}
              emailEnabled={auth.emailEnabled}
              googleEnabled={auth.googleEnabled}
              facebookEnabled={auth.facebookEnabled}
              googleClientId={auth.googleClientId ?? config.auth?.googleClientId}
              facebookAppId={auth.facebookAppId ?? config.auth?.facebookAppId}
              handleSocialAutofill={handleSocialAutofill}
              T={T}
            />
          )}

          {/* ── Step 2: Vehicle info + documents ── */}
          {step === 2 && (
            <RegisterStepPersonal
              cnic={cnic} setCnic={setCnic}
              vehicleType={vehicleType} setVehicleType={setVehicleType}
              vehicleReg={vehicleReg} setVehicleReg={setVehicleReg}
              drivingLicense={drivingLicense} setDrivingLicense={setDrivingLicense}
              registrationNote={registrationNote} setRegistrationNote={setRegistrationNote}
              vehiclePhoto={vehiclePhoto} setVehiclePhoto={setVehiclePhoto}
              cnicPhoto={cnicPhoto} setCnicPhoto={setCnicPhoto}
              cnicBackPhoto={cnicBackPhoto} setCnicBackPhoto={setCnicBackPhoto}
              licensePhoto={licensePhoto} setLicensePhoto={setLicensePhoto}
              handleFileUpload={handleFileUpload}
              uploadErrors={uploadErrors}
              lastFiles={lastFiles}
              optimisingField={optimisingField}
              uploadingField={uploadingField}
              T={T}
            />
          )}

          {/* ── Step 3: Password + terms ── */}
          {step === 3 && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                  <Shield size={11} /> {T("passwordRequired")}
                </label>
                <PasswordInput
                  value={password}
                  onChange={setPassword}
                  placeholder={T("passwordRequired")}
                  showStrength
                  disabled={loading}
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block">
                  {T("confirmPassword")}
                </label>
                <PasswordInput
                  value={confirmPw}
                  onChange={setConfirmPw}
                  placeholder={T("confirmPassword")}
                  disabled={loading}
                  autoComplete="new-password"
                />
                {confirmPw && password !== confirmPw && (
                  <p className="text-[10px] text-red-500 mt-1">{T("passwordsDoNotMatch")}</p>
                )}
              </div>
              <label className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer">
                <input type="checkbox" checked={acceptedTerms} onChange={e => setAcceptedTerms(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-gray-900" />
                <span className="text-xs text-gray-600 leading-relaxed">
                  {T("acceptTerms")}
                  {config.content.tncUrl && (
                    <> — <a href={config.content.tncUrl} target="_blank" rel="noopener noreferrer" className="text-gray-900 underline font-semibold">Terms</a></>
                  )}
                  {config.content.privacyUrl && (
                    <> | <a href={config.content.privacyUrl} target="_blank" rel="noopener noreferrer" className="text-gray-900 underline font-semibold">Privacy</a></>
                  )}
                </span>
              </label>
            </div>
          )}

          {/* ── Step 4: OTP verification ── */}
          {step === 4 && (
            <div className="space-y-3">
              <div className="text-center mb-2">
                <h3 className="text-lg font-bold text-gray-800">{T("enterOtp")}</h3>
                <p className="text-sm text-gray-500">
                  {verifyChannel === "phone" ? `+92${phone}` : email}
                </p>
              </div>
              {registrationFallbackChannels.length > 0 && verifyChannel === "phone" && (
                <div className="flex gap-2 justify-center flex-wrap mb-2">
                  {["sms", ...registrationFallbackChannels.filter(c => c !== "sms")].map(ch => (
                    <button key={ch} type="button"
                      onClick={async () => {
                        if (registrationOtpChannel === ch) return;
                        setRegistrationOtpChannel(ch);
                        setOtp(""); setDevOtp("");
                        try {
                          const r = await fetch(`/api/auth/send-otp`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ phone: phoneE164, preferredChannel: ch }),
                          });
                          const data = await r.json();
                          if (data.otp) setDevOtp(data.otp);
                          if (data.channel) setRegistrationOtpChannel(data.channel as string);
                          const label = ch === "sms" ? "SMS" : ch === "whatsapp" ? "WhatsApp" : ch.charAt(0).toUpperCase() + ch.slice(1);
                          if (channelMsgTimer.current) clearTimeout(channelMsgTimer.current);
                          setChannelSwitchMsg(`OTP sent via ${label}`);
                          channelMsgTimer.current = setTimeout(() => setChannelSwitchMsg(""), 3500);
                        } catch {
                          setError("Could not resend OTP on that channel. Please try again.");
                        }
                      }}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${registrationOtpChannel === ch ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                      {ch === "sms" ? "SMS" : ch === "whatsapp" ? "WhatsApp" : ch.charAt(0).toUpperCase() + ch.slice(1)}
                    </button>
                  ))}
                </div>
              )}
              {channelSwitchMsg && (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-2">
                  <CheckCircle2 size={14} className="text-green-600 flex-shrink-0" />
                  <p className="text-xs text-green-700 font-semibold">{channelSwitchMsg}</p>
                </div>
              )}
              {auth.phoneEnabled && auth.emailEnabled && (
                <div className="flex gap-2 justify-center mb-2">
                  <button type="button" onClick={async () => {
                    if (verifyChannel === "phone") return;
                    setVerifyChannel("phone"); setOtp(""); setDevOtp("");
                    try {
                      const res = await api.sendOtp(phoneE164);
                      if (res.otp) setDevOtp(res.otp);
                    } catch (e: unknown) {
                      setError(e instanceof Error ? e.message : "Failed to send phone OTP. Please try again.");
                    }
                  }}
                    className={`px-4 py-2 rounded-full text-xs font-semibold transition-colors ${verifyChannel === "phone" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                    {T("verifyViaPhone")}
                  </button>
                  <button type="button" onClick={async () => {
                    if (verifyChannel === "email") return;
                    setVerifyChannel("email"); setOtp(""); setDevOtp("");
                    try {
                      const res = await api.sendEmailOtp(email.trim());
                      if (res.otp) setDevOtp(res.otp);
                    } catch (e: unknown) {
                      setError(e instanceof Error ? e.message : "Failed to send email OTP. Please try again.");
                    }
                  }}
                    className={`px-4 py-2 rounded-full text-xs font-semibold transition-colors ${verifyChannel === "email" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                    {T("verifyViaEmail")}
                  </button>
                </div>
              )}
              {otpSendFailed && verifyChannel === "email" && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="text-xs text-amber-800 font-semibold mb-2">OTP sending failed. Your account was registered — please resend the OTP to verify your email.</p>
                  <button type="button" disabled={resendingOtp}
                    onClick={async () => {
                      setResendingOtp(true); setError("");
                      try {
                        let captchaToken: string | undefined;
                        if (auth.captchaEnabled) {
                          captchaToken = await executeCaptcha("resend_email_otp", captchaSiteKey || "");
                        }
                        const emailRes = await api.sendEmailOtp(email.trim(), captchaToken);
                        if (emailRes.otp) setDevOtp(emailRes.otp);
                        setOtpSendFailed(false);
                      } catch (e: unknown) {
                        setError(e instanceof Error ? e.message : "Failed to resend OTP");
                      }
                      setResendingOtp(false);
                    }}
                    className="text-xs font-bold bg-amber-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-60">
                    {resendingOtp ? T("sending") : T("resendOtp")}
                  </button>
                </div>
              )}
              {import.meta.env.DEV && devOtp && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2.5 mb-2">
                  <p className="text-xs text-orange-600 font-bold uppercase tracking-wide mb-0.5">{T("devOtp")}</p>
                  <p className="text-orange-700 font-extrabold text-xl tracking-[0.4em]">{devOtp}</p>
                </div>
              )}
              {/* OTP input — shared SDK component */}
              <OtpInput
                onComplete={(val) => setOtp(val)}
                disabled={loading || resendingOtp}
                label={T("enterOtpDigits")}
              />
            </div>
          )}

          {/* ── Error display ── */}
          {error && (
            <div className="mt-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <p className="text-red-600 text-sm">{error}</p>
              {existingAccountError && (
                <Link href="/" className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-gray-900 underline underline-offset-2 hover:text-gray-700">
                  <ArrowLeft size={13} /> {T("goToLogin")}
                </Link>
              )}
            </div>
          )}

          {/* ── Navigation buttons ── */}
          <div className="flex gap-2 mt-5">
            {step > 1 && (
              <button onClick={() => { setStep(step - 1); clearError(); }}
                className="h-12 px-5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1">
                <ArrowLeft size={14} /> {T("previousStep")}
              </button>
            )}
            {step === 2 && !(!!vehiclePhoto?.url && !!cnicPhoto?.url && !!cnicBackPhoto?.url && !!licensePhoto?.url) && (
              <p className="text-[11px] text-amber-600 font-medium text-center w-full mb-1">All documents required to continue</p>
            )}
            <button onClick={goNextStep}
              disabled={loading || !!uploadingField || !!optimisingField || (step === 2 && !(!!vehiclePhoto?.url && !!cnicPhoto?.url && !!cnicBackPhoto?.url && !!licensePhoto?.url))}
              className="flex-1 h-12 bg-gray-900 hover:bg-gray-800 text-white font-bold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {loading ? <Loader2 size={18} className="animate-spin" /> : null}
              {loading ? T("pleaseWait") :
                step === 4 ? T("verifyAndLogin") :
                  step === 3 ? T("submitRegistration") :
                    <>{T("nextStep")} <ArrowRight size={14} /></>
              }
            </button>
          </div>

          <div className="mt-4 text-center">
            <Link href="/" className="text-sm text-gray-900 font-semibold hover:text-gray-700">
              {T("alreadyHaveAccount")} {T("login")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

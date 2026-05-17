import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { createLogger } from "@/utils/logger";
const log = createLogger("[Register]");
const REG_DRAFT_KEY = "@ajkmart_reg_draft";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth, type AppUser } from "@/context/AuthContext";
import { usePlatformConfig } from "@/context/PlatformConfigContext";
import { useAuthConfig } from "@/context/AuthConfigContext";
import { normalizePhone, buildPhoneValidator } from "@/utils/phone";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useApiCall } from "@/hooks/useApiCall";
import { useNetworkQuality } from "@/hooks/useNetworkQuality";
import { enqueueRequest, drainQueue } from "@/lib/offline/queue";
import { compressImage } from "@/utils/image";
import { compressImage as compressImageToDataUrl } from "@/lib/imageUtils";

import { OtpInput, PhoneInput } from "@workspace/auth-react";
import {
  AuthButton,
  AlertBox,
  InputField,
  StepProgress,
  DevOtpBanner,
  authColors as C,
} from "@/components/auth-shared";

import { s } from "@/components/register/registerStyles";
import { MaintenanceScreen, RegistrationClosedScreen, RegModeNoneScreen, RegisterSuccessStep } from "@/components/register/RegisterGateScreens";
import { RegisterStep2 } from "@/components/register/RegisterStep2";
import { RegisterStep3 } from "@/components/register/RegisterStep3";
import { RegisterStep4 } from "@/components/register/RegisterStep4";

const API = `https://${process.env.EXPO_PUBLIC_DOMAIN ?? ""}/api`;
type RegStep = 1 | 2 | 3 | 4 | 5;

const PAKISTAN_CITIES = [
  "Muzaffarabad", "Mirpur", "Rawalakot", "Kotli", "Bagh", "Bhimber",
  "Islamabad", "Rawalpindi", "Lahore", "Karachi", "Peshawar", "Quetta",
  "Faisalabad", "Multan", "Sialkot", "Gujranwala", "Hyderabad",
  "Abbottabad", "Bahawalpur", "Sargodha", "Sukkur", "Mardan",
  "Mansehra", "Gilgit", "Skardu",
];

function formatCnic(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 13);
  if (digits.length <= 5) return digits;
  if (digits.length <= 12) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

const LEVEL_CONFIG: Record<string, { color: string; bg: string; icon: string; label: string; desc: string }> = {
  bronze: { color: "#CD7F32", bg: "#FFF3E0", icon: "shield-outline", label: "Bronze", desc: "Complete your profile to unlock more features" },
  silver: { color: "#C0C0C0", bg: "#F5F5F5", icon: "shield-half-outline", label: "Silver", desc: "Add CNIC to upgrade to Gold" },
  gold:   { color: "#FFD700", bg: "#FFFDE7", icon: "shield-checkmark-outline", label: "Gold", desc: "Full access to all features" },
};

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const { config } = usePlatformConfig();
  const authConfig = useAuthConfig();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const validatePhone = buildPhoneValidator(config.regional?.phoneFormat);
  const phoneHint = config.regional?.phoneHint ?? "03XXXXXXXXX";

  const regMode: "phone" | "email" | "none" = authConfig.allowPhone
    ? "phone"
    : authConfig.allowEmail
      ? "email"
      : "none";

  const [step, setStep] = useState<RegStep>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [alreadyExists, setAlreadyExists] = useState(false);

  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [devOtp, setDevOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const [emailReg, setEmailReg] = useState("");
  const [emailRegOtp, setEmailRegOtp] = useState("");
  const [emailRegDevOtp, setEmailRegDevOtp] = useState("");
  const [emailRegOtpSent, setEmailRegOtpSent] = useState(false);
  const [emailRegResendCooldown, setEmailRegResendCooldown] = useState(0);

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [queuedOffline, setQueuedOffline] = useState(false);

  const [authToken, setAuthToken] = useState("");
  const [authRefreshToken, setAuthRefreshToken] = useState("");
  const [authUser, setAuthUser] = useState<AppUser | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<"" | "checking" | "available" | "taken">("");
  const usernameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [city, setCity] = useState("");
  const [citySearch, setCitySearch] = useState("");
  const [showCityPicker, setShowCityPicker] = useState(false);
  const [area, setArea] = useState("");
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsStatus, setGpsStatus] = useState("");

  const [cnic, setCnic] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const signupBonus = config.customer.signupBonus;
  const { tier: networkTier } = useNetworkQuality();
  const isLowBandwidth = networkTier === "slow";
  const [lowBwDismissed, setLowBwDismissed] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(REG_DRAFT_KEY).then(saved => {
      if (!saved) return;
      try {
        const draft = JSON.parse(saved) as Record<string, unknown>;
        if (typeof draft.step === "number" && draft.step > 1) {
          if (typeof draft.name === "string") setName(draft.name);
          if (typeof draft.email === "string") setEmail(draft.email);
          if (typeof draft.username === "string") setUsername(draft.username);
          if (typeof draft.city === "string") setCity(draft.city);
          if (typeof draft.area === "string") setArea(draft.area);
          if (typeof draft.address === "string") setAddress(draft.address);
          if (typeof draft.cnic === "string") setCnic(draft.cnic);
          const restored = Math.min(draft.step as number, 4);
          setStep(restored as RegStep);
        }
      } catch { /* ignore corrupt draft */ }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (step === 1 || step === 5) return;
    const draft = { step, name, email, username, city, area, address, cnic };
    AsyncStorage.setItem(REG_DRAFT_KEY, JSON.stringify(draft)).catch(() => {});
  }, [step, name, email, username, city, area, address, cnic]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  useEffect(() => {
    if (emailRegResendCooldown <= 0) return;
    const t = setTimeout(() => setEmailRegResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [emailRegResendCooldown]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    import("@react-native-community/netinfo").then(({ default: NetInfo }) => {
      unsubscribe = NetInfo.addEventListener(state => {
        if (state.isConnected) drainQueue(API).catch(() => {});
      });
    }).catch(() => {});
    return () => { unsubscribe?.(); };
  }, []);

  const lastSendOtpErrRef = useRef<string>("");
  const lastVerifyOtpErrRef = useRef<string>("");

  const sendOtpApiFn = useCallback(async (phone: string) => {
    try {
      const res = await fetch(`${API}/auth/send-otp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) });
      const data = await res.json();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${data.error || "Could not send OTP."}`);
      return data as Record<string, unknown>;
    } catch (e) {
      if (e instanceof TypeError) throw new Error(`OFFLINE: ${e.message}`);
      throw e;
    }
  }, []);

  const sendOtpCall = useApiCall(sendOtpApiFn, { circuitBreaker: true, showErrorToast: false, maxRetries: 0, onError: (msg) => { lastSendOtpErrRef.current = msg; } });

  const verifyOtpApiFn = useCallback(async (phone: string, otp: string) => {
    try {
      const res = await fetch(`${API}/auth/verify-otp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, otp }) });
      const data = await res.json();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${data.error || "Invalid OTP."}`);
      return data as Record<string, unknown>;
    } catch (e) {
      if (e instanceof TypeError) throw new Error(`OFFLINE: ${e.message}`);
      throw e;
    }
  }, []);

  const verifyOtpCall = useApiCall(verifyOtpApiFn, { circuitBreaker: true, showErrorToast: false, maxRetries: 0, onError: (msg) => { lastVerifyOtpErrRef.current = msg; } });

  useEffect(() => {
    import("expo-secure-store").then(async SS => {
      try { const stored = await SS.getItemAsync("ajkmart_reg_token"); if (stored) setAuthToken(stored); }
      catch (e) { log.debug("[Register] Failed to read stored reg token:", e); }
    }).catch((err) => { log.debug("[Register] Failed to import expo-secure-store on mount:", err); });
    return () => { import("expo-secure-store").then(SS => SS.deleteItemAsync("ajkmart_reg_token")).catch((err) => { log.debug("[Register] Failed to cleanup reg token on unmount:", err); }); };
  }, []);

  const clearError = () => { setError(""); setAlreadyExists(false); };
  const normalizedPhone = normalizePhone(phone);

  const handleUsernameChange = (val: string) => {
    const clean = val.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
    setUsername(clean); clearError(); setUsernameStatus("");
    if (usernameTimerRef.current) clearTimeout(usernameTimerRef.current);
    if (clean.length >= 3) {
      usernameTimerRef.current = setTimeout(async () => {
        setUsernameStatus("checking");
        try {
          const res = await fetch(`${API}/auth/check-available`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: clean }) });
          const data = await res.json();
          setUsernameStatus(data?.username?.available ? "available" : "taken");
        } catch { setUsernameStatus(""); }
      }, 500);
    }
  };

  const cityList: string[] = React.useMemo(() => {
    if (config.cities && config.cities.length > 0) return config.cities;
    return PAKISTAN_CITIES;
  }, [config]);

  const filteredCities = cityList.filter(c => c.toLowerCase().includes(citySearch.toLowerCase()));

  const handleGetLocation = async () => {
    setGpsLoading(true); setGpsStatus("");
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") { setGpsStatus("Location permission denied"); setGpsLoading(false); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setLatitude(loc.coords.latitude.toFixed(6));
      setLongitude(loc.coords.longitude.toFixed(6));
      try {
        const [geo] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        if (geo) {
          if (geo.city) { const matchedCity = cityList.find(c => c.toLowerCase() === (geo.city ?? "").toLowerCase()); if (matchedCity) setCity(matchedCity); }
          if (geo.district || geo.subregion) setArea(geo.district || geo.subregion || "");
          const parts = [geo.streetNumber, geo.street, geo.name].filter(Boolean);
          if (parts.length > 0) setAddress(parts.join(", "));
          setGpsStatus("Location captured successfully");
        }
      } catch { setGpsStatus("Coordinates captured (address lookup unavailable)"); }
    } catch (e: unknown) { setGpsStatus((e as Error).message || "Could not get location"); }
    setGpsLoading(false);
  };

  const handleSendOtp = async () => {
    clearError();
    if (!validatePhone(phone)) { setError(`Please enter a valid phone number (e.g. ${phoneHint})`); return; }
    if (resendCooldown > 0) return;
    if (sendOtpCall.circuitOpen) { setError("Service temporarily unavailable. Please try again in a moment."); return; }
    setLoading(true);
    if (!otpSent) {
      try {
        const checkRes = await fetch(`${API}/auth/check-identifier`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: `0${normalizedPhone}`, role: "customer" }) });
        const checkData = await checkRes.json();
        if (!checkRes.ok) { setError(checkData?.error || "Could not verify phone number. Please try again."); setLoading(false); return; }
        const action: string = checkData?.action ?? "";
        if (action === "registration_closed") { setError("New registrations are currently closed. Please try again later."); setLoading(false); return; }
        if (action === "blocked") { setError("This phone number has been suspended. Please contact support."); setLoading(false); return; }
        if (action === "locked") { const mins = checkData?.lockedMinutes ?? ""; setError(`Too many attempts. Please try again${mins ? ` in ${mins} minute(s)` : " later"}.`); setLoading(false); return; }
        if (action === "no_method") { setError("Phone OTP is currently disabled. Please contact support."); setLoading(false); return; }
        if (action === "exists") { setAlreadyExists(true); setLoading(false); return; }
      } catch { setError("Network error. Please check your connection and try again."); setLoading(false); return; }
    }
    lastSendOtpErrRef.current = "";
    const sendResult = await sendOtpCall.execute(normalizedPhone);
    if (sendResult === null) {
      const raw = lastSendOtpErrRef.current || "Could not send OTP.";
      if (raw.startsWith("OFFLINE:")) {
        await enqueueRequest("otp_send", "/auth/send-otp", "POST", { phone: normalizedPhone });
        setQueuedOffline(true);
        setError("You're offline. Your request has been saved and will be sent when you reconnect.");
      } else {
        const msg = raw.replace(/^HTTP \d+: /, "");
        setError(msg);
        const match = msg.match(/wait (\d+) second/);
        if (match) setResendCooldown(parseInt(match[1]!, 10));
      }
      setLoading(false); return;
    }
    if (sendResult.otpRequired === false) {
      if (sendResult.token) {
        setAuthToken(sendResult.token as string);
        if (sendResult.refreshToken) setAuthRefreshToken(sendResult.refreshToken as string);
        if (sendResult.user) setAuthUser(sendResult.user as AppUser);
        try { const SecureStore = await import("expo-secure-store"); await SecureStore.setItemAsync("ajkmart_reg_token", sendResult.token as string); } catch {}
      }
      setStep(2); setLoading(false); return;
    }
    if (sendResult.otp) setDevOtp(sendResult.otp as string);
    setResendCooldown(60); setOtpSent(true); setLoading(false);
  };

  const handleVerifyOtp = async () => {
    clearError();
    if (!otp || otp.length < 6) { setError("Please enter the 6-digit OTP"); return; }
    if (verifyOtpCall.circuitOpen) { setError("Service temporarily unavailable. Please try again in a moment."); return; }
    setLoading(true);
    lastVerifyOtpErrRef.current = "";
    const data = await verifyOtpCall.execute(normalizedPhone, otp);
    if (data === null) { setError((lastVerifyOtpErrRef.current || "Invalid OTP.").replace(/^HTTP \d+: /, "")); setLoading(false); return; }
    if (data.token) {
      setAuthToken(data.token as string);
      try { const SecureStore = await import("expo-secure-store"); await SecureStore.setItemAsync("ajkmart_reg_token", data.token as string); } catch {}
    }
    if (data.refreshToken) setAuthRefreshToken(data.refreshToken as string);
    if (data.user) setAuthUser(data.user as AppUser);
    if (data.token && (data.user as AppUser | null)?.name && (data.user as AppUser | null)?.id) {
      const u = data.user as AppUser;
      await login({ ...u, walletBalance: u.walletBalance ?? 0, isActive: u.isActive ?? true, createdAt: u.createdAt ?? new Date().toISOString() }, data.token as string, (data.refreshToken as string | undefined) || undefined);
      try { const SS = await import("expo-secure-store"); await SS.deleteItemAsync("ajkmart_reg_token"); } catch {}
      router.replace("/(tabs)"); return;
    }
    setStep(2); setLoading(false);
  };

  const handleSendEmailReg = async () => {
    clearError();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailReg.trim())) { setError("Please enter a valid email address"); return; }
    if (emailRegResendCooldown > 0) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/send-email-otp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: emailReg.trim().toLowerCase() }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Could not send verification email."); setLoading(false); return; }
      if (data.otp) setEmailRegDevOtp(data.otp);
      setEmailRegResendCooldown(60); setEmailRegOtpSent(true);
    } catch { setError("Network error. Please check your connection and try again."); }
    setLoading(false);
  };

  const handleVerifyEmailReg = async () => {
    clearError();
    if (!emailRegOtp || emailRegOtp.length < 6) { setError("Please enter the 6-digit code"); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/verify-email-otp`, { method: "POST", headers: { "Content-Type": "application/json", "X-App-Id": "customer" }, body: JSON.stringify({ email: emailReg.trim().toLowerCase(), otp: emailRegOtp }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Invalid verification code."); setLoading(false); return; }
      if (data.token) {
        setAuthToken(data.token);
        try { const SecureStore = await import("expo-secure-store"); await SecureStore.setItemAsync("ajkmart_reg_token", data.token); } catch {}
      }
      if (data.refreshToken) setAuthRefreshToken(data.refreshToken);
      if (data.user) setAuthUser(data.user as AppUser);
      setEmail(emailReg.trim().toLowerCase());
      setStep(2);
    } catch { setError("Network error. Please check your connection and try again."); }
    setLoading(false);
  };

  const handlePickPhoto = async () => {
    setPhotoLoading(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { setPhotoLoading(false); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 1 });
      if (!result.canceled && result.assets[0]) {
        const compressedUri = await compressImage(result.assets[0].uri, { maxWidth: 1200, quality: 0.7 });
        setPhotoUri(compressedUri);
      }
    } catch { /* photo pick failure is non-fatal */ }
    setPhotoLoading(false);
  };

  const handleStep2 = () => {
    clearError();
    if (!name.trim() || name.trim().length < 2) { setError("Please enter your name (at least 2 characters)"); return; }
    if (!username || username.length < 3) { setError("Username is required (at least 3 characters)"); return; }
    if (usernameStatus === "taken") { setError("This username is already taken. Please choose another."); return; }
    if (usernameStatus === "checking") { setError("Please wait — checking username availability"); return; }
    if (usernameStatus !== "available") { setError("Please wait for username availability check to complete"); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError("Please enter a valid email address"); return; }
    setStep(3);
  };

  const handleStep3 = () => { clearError(); if (!city) { setError("Please select your city"); return; } setStep(4); };

  const handleStep4 = async () => {
    clearError();
    if (!password || password.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (!/[A-Z]/.test(password)) { setError("Password must contain at least 1 uppercase letter"); return; }
    if (!/[0-9]/.test(password)) { setError("Password must contain at least 1 number"); return; }
    if (password !== confirmPassword) { setError("Passwords do not match"); return; }
    if (!termsAccepted) { setError("Please accept the Terms & Conditions"); return; }
    setLoading(true);
    try {
      let activeToken = authToken;
      if (!activeToken) {
        try { const SecureStore = await import("expo-secure-store"); activeToken = await SecureStore.getItemAsync("ajkmart_reg_token") || ""; } catch {}
      }
      if (!activeToken) { setError("Session expired. Please go back and verify OTP again."); setLoading(false); return; }
      const termsVersion = config.compliance?.termsVersion || "";
      let profilePhotoBase64: string | undefined;
      if (photoUri) { try { profilePhotoBase64 = await compressImageToDataUrl(photoUri, 200 * 1024); } catch { /* non-fatal */ } }
      const profileRes = await fetch(`${API}/auth/complete-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${activeToken}` },
        body: JSON.stringify({
          name: name.trim(), username: username.trim(),
          ...(email && { email: email.trim().toLowerCase() }),
          ...(cnic && { cnic: cnic.trim() }),
          ...(city && { city }), ...(area && { area: area.trim() }),
          ...(address && { address: address.trim() }),
          ...(latitude && { latitude }), ...(longitude && { longitude }),
          password,
          ...(profilePhotoBase64 && { profilePhoto: profilePhotoBase64 }),
          ...(termsVersion && { acceptedTermsVersion: termsVersion }),
        }),
      });
      const profileData = await profileRes.json();
      if (!profileRes.ok) { setError(profileData.error || "Could not save profile. Please try again."); setLoading(false); return; }
      if (profileData.token) {
        setAuthToken(profileData.token);
        try { const SecureStore = await import("expo-secure-store"); await SecureStore.setItemAsync("ajkmart_reg_token", profileData.token); } catch {}
      }
      if (profileData.refreshToken) setAuthRefreshToken(profileData.refreshToken);
      if (profileData.user) setAuthUser(profileData.user);
      setStep(5);
    } catch (e: unknown) { setError((e as Error).message || "Could not save profile."); }
    setLoading(false);
  };

  const handleFinish = async () => {
    setLoading(true);
    try {
      let finalToken = authToken;
      if (!finalToken) { try { const SecureStore = await import("expo-secure-store"); finalToken = await SecureStore.getItemAsync("ajkmart_reg_token") || ""; } catch {} }
      if (finalToken && authUser) {
        const userData = { ...authUser, walletBalance: authUser.walletBalance ?? 0, isActive: authUser.isActive ?? true, createdAt: authUser.createdAt ?? new Date().toISOString() };
        await login(userData, finalToken, authRefreshToken || undefined);
        AsyncStorage.removeItem(REG_DRAFT_KEY).catch(() => {});
        try { const SecureStore = await import("expo-secure-store"); await SecureStore.deleteItemAsync("ajkmart_reg_token"); } catch {}
        router.replace("/(tabs)");
      } else { goBackToAuth(); }
    } catch (e: unknown) { log.warn("Login after registration failed:", e instanceof Error ? e.message : e); goBackToAuth(); }
    setLoading(false);
  };

  const stepLabels = ["Verify", "Details", "Address", "Security", "Done"];

  const goBackToAuth = useCallback(() => {
    AsyncStorage.removeItem(REG_DRAFT_KEY).catch(() => {});
    router.replace("/auth");
  }, []);

  const handleBack = () => {
    clearError();
    if (step <= 2) {
      import("expo-secure-store").then(SS => SS.deleteItemAsync("ajkmart_reg_token")).catch((err) => { log.debug("[Register] Failed to cleanup reg token on back:", err); });
      router.back();
    } else { setStep((step - 1) as RegStep); }
  };

  const accountLevel = authUser?.accountLevel || "bronze";
  const levelInfo = LEVEL_CONFIG[accountLevel] || LEVEL_CONFIG.bronze!;

  if (config.appStatus === "maintenance") return <MaintenanceScreen config={config} />;
  if (!config.features.newUsers) return <RegistrationClosedScreen config={config} onBack={goBackToAuth} />;
  if (regMode === "none") return <RegModeNoneScreen config={config} onBack={goBackToAuth} />;
  if (step === 5) return <RegisterSuccessStep config={config} levelInfo={levelInfo} accountLevel={accountLevel} signupBonus={signupBonus} loading={loading} onFinish={handleFinish} />;

  const stepSubtitles: Record<number, string> = {
    1: regMode === "email" ? "Verify your email address" : "Verify your phone number",
    2: "Tell us about yourself",
    3: "Where should we deliver?",
    4: "Secure your account",
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
      <LinearGradient colors={[C.primaryDark, C.primary, C.primaryLight]} style={s.gradient}>
        <View style={[s.topSection, { paddingTop: topPad + 16 }]}>
          <TouchableOpacity activeOpacity={0.7} onPress={handleBack} style={s.backBtn} accessibilityLabel={step <= 2 ? "Go back" : "Previous step"} accessibilityRole="button">
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </TouchableOpacity>
          <View style={s.headerLogoRow}>
            <View style={s.headerLogo}><Ionicons name="person-add" size={24} color={C.primary} /></View>
          </View>
          <Text style={s.headerTitle}>Create Account</Text>
          <Text style={s.headerSub}>{stepSubtitles[step]}</Text>
          <View style={s.progressRow}><StepProgress total={5} current={step} /></View>
          <View style={s.stepLabels}>
            {stepLabels.map((label, i) => (
              <Text key={label} style={[s.stepLabel, step >= i + 1 && s.stepLabelActive]}>{label}</Text>
            ))}
          </View>
        </View>

        <ScrollView style={s.card} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {config.content.announcement ? (
            <View style={{ backgroundColor: "#FEF3C7", borderRadius: 12, padding: 12, marginBottom: 16, flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderColor: "#FDE68A" }}>
              <Ionicons name="information-circle-outline" size={16} color="#D97706" style={{ marginTop: 1 }} />
              <Text style={{ fontSize: 12, color: "#92400E", fontFamily: "Inter_500Medium", lineHeight: 18, flex: 1 }}>{config.content.announcement}</Text>
            </View>
          ) : null}
          {isLowBandwidth && !lowBwDismissed && (
            <View style={{ backgroundColor: "#FEF3C7", borderRadius: 12, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: "#FDE68A" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="wifi-outline" size={16} color="#D97706" />
                <Text style={{ fontSize: 11, color: "#92400E", fontFamily: "Inter_500Medium", flex: 1, lineHeight: 16 }}>Slow connection detected — data saver mode on. Image previews hidden.</Text>
                <TouchableOpacity onPress={() => setLowBwDismissed(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="Dismiss slow connection notice">
                  <Ionicons name="close" size={16} color="#D97706" />
                </TouchableOpacity>
              </View>
            </View>
          )}

          {step === 1 && regMode === "phone" && (
            <>
              {!otpSent ? (
                <>
                  <Text style={s.fieldLabel}>Phone Number</Text>
                  <PhoneInput value={phone} onChangeText={(v: string) => { setPhone(v); clearError(); }} autoFocus />
                </>
              ) : (
                <>
                  <TouchableOpacity activeOpacity={0.7} onPress={() => { setOtpSent(false); setOtp(""); clearError(); }} style={s.changeBtn} accessibilityRole="button">
                    <Ionicons name="arrow-back" size={14} color={C.primary} />
                    <Text style={s.changeBtnText}>Change Number</Text>
                  </TouchableOpacity>
                  <Text style={s.fieldLabel}>Enter Verification Code</Text>
                  <Text style={s.fieldSub}>Code sent to +92 {phone}</Text>
                  <OtpInput value={otp} onChangeText={(v: string) => { setOtp(v); clearError(); }} hasError={!!error} onComplete={() => handleVerifyOtp()} />
                  <DevOtpBanner otp={devOtp} />
                  <TouchableOpacity activeOpacity={0.7} onPress={handleSendOtp} style={[s.resendBtn, resendCooldown > 0 && s.resendDisabled]} disabled={resendCooldown > 0} accessibilityRole="button">
                    <Ionicons name="refresh-outline" size={16} color={resendCooldown > 0 ? C.textMuted : C.primary} />
                    <Text style={[s.resendText, resendCooldown > 0 && { color: C.textMuted }]}>{resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend OTP"}</Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          )}

          {step === 1 && regMode === "email" && (
            <>
              {!emailRegOtpSent ? (
                <>
                  <Text style={s.fieldLabel}>Email Address</Text>
                  <InputField label="" value={emailReg} onChangeText={v => { setEmailReg(v); clearError(); }} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoFocus error={!!error} />
                </>
              ) : (
                <>
                  <TouchableOpacity activeOpacity={0.7} onPress={() => { setEmailRegOtpSent(false); setEmailRegOtp(""); clearError(); }} style={s.changeBtn} accessibilityRole="button">
                    <Ionicons name="arrow-back" size={14} color={C.primary} />
                    <Text style={s.changeBtnText}>Change Email</Text>
                  </TouchableOpacity>
                  <Text style={s.fieldLabel}>Enter Verification Code</Text>
                  <Text style={s.fieldSub}>Code sent to {emailReg}</Text>
                  <OtpInput value={emailRegOtp} onChangeText={(v: string) => { setEmailRegOtp(v); clearError(); }} hasError={!!error} onComplete={() => handleVerifyEmailReg()} />
                  <DevOtpBanner otp={emailRegDevOtp} />
                  <TouchableOpacity activeOpacity={0.7} onPress={handleSendEmailReg} style={[s.resendBtn, emailRegResendCooldown > 0 && s.resendDisabled]} disabled={emailRegResendCooldown > 0} accessibilityRole="button">
                    <Ionicons name="refresh-outline" size={16} color={emailRegResendCooldown > 0 ? C.textMuted : C.primary} />
                    <Text style={[s.resendText, emailRegResendCooldown > 0 && { color: C.textMuted }]}>{emailRegResendCooldown > 0 ? `Resend in ${emailRegResendCooldown}s` : "Resend Code"}</Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          )}

          {step === 2 && (
            <RegisterStep2
              name={name} setName={setName}
              email={email} setEmail={setEmail}
              username={username} usernameStatus={usernameStatus}
              handleUsernameChange={handleUsernameChange}
              handlePickPhoto={handlePickPhoto}
              photoLoading={photoLoading} photoUri={photoUri}
              isLowBandwidth={isLowBandwidth}
              error={error} clearError={clearError}
            />
          )}

          {step === 3 && (
            <RegisterStep3
              gpsLoading={gpsLoading} gpsStatus={gpsStatus}
              latitude={latitude} longitude={longitude}
              showCityPicker={showCityPicker} setShowCityPicker={setShowCityPicker}
              city={city} setCity={setCity}
              citySearch={citySearch} setCitySearch={setCitySearch}
              filteredCities={filteredCities}
              area={area} setArea={setArea}
              address={address} setAddress={setAddress}
              error={error} clearError={clearError}
              handleGetLocation={handleGetLocation}
            />
          )}

          {step === 4 && (
            <RegisterStep4
              cnic={cnic} setCnic={setCnic} formatCnic={formatCnic}
              password={password} setPassword={setPassword}
              showPwd={showPwd} setShowPwd={setShowPwd}
              confirmPassword={confirmPassword} setConfirmPassword={setConfirmPassword}
              showConfirmPwd={showConfirmPwd} setShowConfirmPwd={setShowConfirmPwd}
              termsAccepted={termsAccepted} setTermsAccepted={setTermsAccepted}
              error={error} clearError={clearError}
            />
          )}

          {alreadyExists && step === 1 ? (
            <View style={{ marginTop: 8 }}>
              <View style={{ backgroundColor: "#EFF6FF", borderRadius: 14, borderWidth: 1, borderColor: "#93C5FD", padding: 16, alignItems: "center", marginBottom: 12 }}>
                <Ionicons name="information-circle" size={28} color="#2563EB" style={{ marginBottom: 6 }} />
                <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: "#1E40AF", textAlign: "center", marginBottom: 4 }}>Number Already Registered</Text>
                <Text style={{ fontSize: 13, color: "#3B82F6", textAlign: "center" }}>This phone number already has an account. Please log in instead.</Text>
              </View>
              <AuthButton label="Login to Existing Account" onPress={goBackToAuth} icon="log-in-outline" />
              <TouchableOpacity activeOpacity={0.7} onPress={() => { setPhone(""); clearError(); }} style={{ marginTop: 12, alignItems: "center" }} accessibilityRole="button">
                <Text style={{ color: C.primary, fontSize: 13, fontFamily: "Inter_500Medium" }}>Use a different number</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {queuedOffline && step === 1 && <AlertBox type="info" message="You're offline. Your OTP request will be sent automatically when you reconnect." />}
              {error ? <AlertBox type="error" message={error} /> : null}
              <AuthButton
                label={step === 1 ? regMode === "email" ? emailRegOtpSent ? "Verify Code" : "Send Verification Code" : otpSent ? "Verify OTP" : "Send OTP" : step === 2 ? "Continue" : step === 3 ? "Continue" : "Create Account"}
                onPress={step === 1 ? regMode === "email" ? emailRegOtpSent ? handleVerifyEmailReg : handleSendEmailReg : otpSent ? handleVerifyOtp : handleSendOtp : step === 2 ? handleStep2 : step === 3 ? handleStep3 : handleStep4}
                loading={loading}
                icon={step === 4 ? "shield-checkmark-outline" : step === 1 && (regMode === "email" ? !emailRegOtpSent : !otpSent) ? "send-outline" : step === 3 ? "location-outline" : undefined}
              />
              {step === 1 && (
                <TouchableOpacity activeOpacity={0.7} onPress={goBackToAuth} style={s.loginLink} accessibilityLabel="Go to login" accessibilityRole="link">
                  <Text style={s.loginLinkText}>Already have an account? <Text style={{ fontFamily: "Inter_700Bold" }}>Login</Text></Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {step === 3 && (
            <TouchableOpacity activeOpacity={0.7} onPress={() => setStep(4)} style={s.skipLink} accessibilityRole="link">
              <Text style={s.skipLinkText}>Skip for now</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}

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
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { spacing, radii, shadows, typography } from "@/constants/colors";
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

/* OtpInput and PhoneInput from @workspace/auth-react — Metro auto-resolves to
   the .native.tsx platform siblings for Expo builds, which use React Native
   primitives (View/Text/TextInput) instead of HTML elements. */
import { OtpInput, PhoneInput } from "@workspace/auth-react";

import {
  AuthButton,
  AlertBox,
  InputField,
  PasswordStrengthBar,
  StepProgress,
  DevOtpBanner,
  authColors as C,
} from "@/components/auth-shared";

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

  /** Determine registration channel from platform auth config */
  const regMode: "phone" | "email" | "none" = authConfig.allowPhone
    ? "phone"
    : authConfig.allowEmail
      ? "email"
      : "none";

  const [step, setStep] = useState<RegStep>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [alreadyExists, setAlreadyExists] = useState(false);

  /* phone-mode OTP state */
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [devOtp, setDevOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  /* email-mode registration state (used when phone is disabled) */
  const [emailReg, setEmailReg] = useState("");
  const [emailRegOtp, setEmailRegOtp] = useState("");
  const [emailRegDevOtp, setEmailRegDevOtp] = useState("");
  const [emailRegOtpSent, setEmailRegOtpSent] = useState(false);
  const [emailRegResendCooldown, setEmailRegResendCooldown] = useState(0);

  /* photo picker */
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);

  /* offline queue flag */
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

  /* Restore draft on mount so users can continue from where they left off */
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
          /* Do not restore step 1 OTP state — always requires fresh verification */
          const restored = Math.min(draft.step as number, 4);
          setStep(restored as RegStep);
        }
      } catch {
        /* ignore corrupt draft */
      }
    }).catch(() => {});
  }, []);

  /* Persist draft on step/field changes (skip step 1 and success step 5) */
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

  /* Drain offline queue whenever connectivity is restored */
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    import("@react-native-community/netinfo").then(({ default: NetInfo }) => {
      unsubscribe = NetInfo.addEventListener(state => {
        if (state.isConnected) {
          drainQueue(API).catch(() => {});
        }
      });
    }).catch(() => {});
    return () => { unsubscribe?.(); };
  }, []);

  /* ── Circuit-breaker-backed OTP send/verify calls ─────────────────────── */
  const lastSendOtpErrRef = useRef<string>("");
  const lastVerifyOtpErrRef = useRef<string>("");

  const sendOtpApiFn = useCallback(async (phone: string) => {
    try {
      const res = await fetch(`${API}/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${data.error || "Could not send OTP."}`);
      return data as Record<string, unknown>;
    } catch (e) {
      if (e instanceof TypeError) throw new Error(`OFFLINE: ${e.message}`);
      throw e;
    }
  }, []);

  const sendOtpCall = useApiCall(sendOtpApiFn, {
    circuitBreaker: true,
    showErrorToast: false,
    maxRetries: 0,
    onError: (msg) => { lastSendOtpErrRef.current = msg; },
  });

  const verifyOtpApiFn = useCallback(async (phone: string, otp: string) => {
    try {
      const res = await fetch(`${API}/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, otp }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${data.error || "Invalid OTP."}`);
      return data as Record<string, unknown>;
    } catch (e) {
      if (e instanceof TypeError) throw new Error(`OFFLINE: ${e.message}`);
      throw e;
    }
  }, []);

  const verifyOtpCall = useApiCall(verifyOtpApiFn, {
    circuitBreaker: true,
    showErrorToast: false,
    maxRetries: 0,
    onError: (msg) => { lastVerifyOtpErrRef.current = msg; },
  });

  useEffect(() => {
    import("expo-secure-store").then(async SS => {
      try {
        const stored = await SS.getItemAsync("ajkmart_reg_token");
        if (stored) setAuthToken(stored);
      } catch (e) { log.debug("[Register] Failed to read stored reg token:", e); }
    }).catch((err) => { log.debug("[Register] Failed to import expo-secure-store on mount:", err); });
    return () => {
      import("expo-secure-store").then(SS => SS.deleteItemAsync("ajkmart_reg_token")).catch((err) => { log.debug("[Register] Failed to cleanup reg token on unmount:", err); });
    };
  }, []);

  const clearError = () => { setError(""); setAlreadyExists(false); };

  const normalizedPhone = normalizePhone(phone);

  const handleUsernameChange = (val: string) => {
    const clean = val.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
    setUsername(clean);
    clearError();
    setUsernameStatus("");
    if (usernameTimerRef.current) clearTimeout(usernameTimerRef.current);
    if (clean.length >= 3) {
      usernameTimerRef.current = setTimeout(async () => {
        setUsernameStatus("checking");
        try {
          const res = await fetch(`${API}/auth/check-available`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: clean }),
          });
          const data = await res.json();
          if (data?.username?.available) {
            setUsernameStatus("available");
          } else {
            setUsernameStatus("taken");
          }
        } catch {
          setUsernameStatus("");
        }
      }, 500);
    }
  };

  const cityList: string[] = React.useMemo(() => {
    if (config.cities && config.cities.length > 0) return config.cities;
    return PAKISTAN_CITIES;
  }, [config]);

  const filteredCities = cityList.filter(c =>
    c.toLowerCase().includes(citySearch.toLowerCase())
  );

  const handleGetLocation = async () => {
    setGpsLoading(true);
    setGpsStatus("");
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setGpsStatus("Location permission denied");
        setGpsLoading(false);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setLatitude(loc.coords.latitude.toFixed(6));
      setLongitude(loc.coords.longitude.toFixed(6));

      try {
        const [geo] = await Location.reverseGeocodeAsync({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
        if (geo) {
          if (geo.city) {
            const matchedCity = cityList.find(
              c => c.toLowerCase() === (geo.city ?? "").toLowerCase()
            );
            if (matchedCity) setCity(matchedCity);
          }
          if (geo.district || geo.subregion) setArea(geo.district || geo.subregion || "");
          const parts = [geo.streetNumber, geo.street, geo.name].filter(Boolean);
          if (parts.length > 0) setAddress(parts.join(", "));
          setGpsStatus("Location captured successfully");
        }
      } catch {
        setGpsStatus("Coordinates captured (address lookup unavailable)");
      }
    } catch (e: any) {
      setGpsStatus(e.message || "Could not get location");
    }
    setGpsLoading(false);
  };

  const handleSendOtp = async () => {
    clearError();
    if (!validatePhone(phone)) { setError(`Please enter a valid phone number (e.g. ${phoneHint})`); return; }
    if (resendCooldown > 0) return;
    if (sendOtpCall.circuitOpen) {
      setError("Service temporarily unavailable. Please try again in a moment.");
      return;
    }
    setLoading(true);
    if (!otpSent) {
      /* pre-flight: check-identifier to catch blocked/locked/closed */
      try {
        const checkRes = await fetch(`${API}/auth/check-identifier`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifier: `0${normalizedPhone}`, role: "customer" }),
        });
        const checkData = await checkRes.json();
        if (!checkRes.ok) {
          setError(checkData?.error || "Could not verify phone number. Please try again.");
          setLoading(false);
          return;
        }
        const action: string = checkData?.action ?? "";
        if (action === "registration_closed") { setError("New registrations are currently closed. Please try again later."); setLoading(false); return; }
        if (action === "blocked") { setError("This phone number has been suspended. Please contact support."); setLoading(false); return; }
        if (action === "locked") {
          const mins = checkData?.lockedMinutes ?? "";
          setError(`Too many attempts. Please try again${mins ? ` in ${mins} minute(s)` : " later"}.`);
          setLoading(false);
          return;
        }
        if (action === "no_method") { setError("Phone OTP is currently disabled. Please contact support."); setLoading(false); return; }
        if (action === "exists") { setAlreadyExists(true); setLoading(false); return; }
      } catch {
        setError("Network error. Please check your connection and try again.");
        setLoading(false);
        return;
      }
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
      setLoading(false);
      return;
    }

    if (sendResult.otpRequired === false) {
      if (sendResult.token) {
        setAuthToken(sendResult.token as string);
        if (sendResult.refreshToken) setAuthRefreshToken(sendResult.refreshToken as string);
        if (sendResult.user) setAuthUser(sendResult.user as AppUser);
        try {
          const SecureStore = await import("expo-secure-store");
          await SecureStore.setItemAsync("ajkmart_reg_token", sendResult.token as string);
        // eslint-disable-next-line ajk-local/no-silent-catch -- SecureStore cache for reg token is best-effort; in-memory token still works
        } catch {}
      }
      setStep(2);
      setLoading(false);
      return;
    }
    if (sendResult.otp) setDevOtp(sendResult.otp as string);
    setResendCooldown(60);
    setOtpSent(true);
    setLoading(false);
  };

  const handleVerifyOtp = async () => {
    clearError();
    if (!otp || otp.length < 6) { setError("Please enter the 6-digit OTP"); return; }
    if (verifyOtpCall.circuitOpen) {
      setError("Service temporarily unavailable. Please try again in a moment.");
      return;
    }
    setLoading(true);
    lastVerifyOtpErrRef.current = "";
    const data = await verifyOtpCall.execute(normalizedPhone, otp);
    if (data === null) {
      setError((lastVerifyOtpErrRef.current || "Invalid OTP.").replace(/^HTTP \d+: /, ""));
      setLoading(false);
      return;
    }
    if (data.token) {
      setAuthToken(data.token as string);
      try {
        const SecureStore = await import("expo-secure-store");
        await SecureStore.setItemAsync("ajkmart_reg_token", data.token as string);
      // eslint-disable-next-line ajk-local/no-silent-catch -- SecureStore cache is best-effort; in-memory token still works
      } catch {}
    }
    if (data.refreshToken) setAuthRefreshToken(data.refreshToken as string);
    if (data.user) setAuthUser(data.user as AppUser);
    if (data.token && (data.user as AppUser | null)?.name && (data.user as AppUser | null)?.id) {
      const u = data.user as AppUser;
      await login({ ...u, walletBalance: u.walletBalance ?? 0, isActive: u.isActive ?? true, createdAt: u.createdAt ?? new Date().toISOString() }, data.token as string, (data.refreshToken as string | undefined) || undefined);
      // eslint-disable-next-line ajk-local/no-silent-catch -- reg token cleanup is best-effort; session is already established
      try { const SS = await import("expo-secure-store"); await SS.deleteItemAsync("ajkmart_reg_token"); } catch {}
      router.replace("/(tabs)");
      return;
    }
    setStep(2);
    setLoading(false);
  };

  /* Email-mode registration handlers (used when phone OTP is disabled) */
  const handleSendEmailReg = async () => {
    clearError();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailReg.trim())) {
      setError("Please enter a valid email address");
      return;
    }
    if (emailRegResendCooldown > 0) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/send-email-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailReg.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Could not send verification email."); setLoading(false); return; }
      if (data.otp) setEmailRegDevOtp(data.otp);
      setEmailRegResendCooldown(60);
      setEmailRegOtpSent(true);
    } catch {
      setError("Network error. Please check your connection and try again.");
    }
    setLoading(false);
  };

  const handleVerifyEmailReg = async () => {
    clearError();
    if (!emailRegOtp || emailRegOtp.length < 6) { setError("Please enter the 6-digit code"); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/verify-email-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-App-Id": "customer" },
        body: JSON.stringify({ email: emailReg.trim().toLowerCase(), otp: emailRegOtp }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Invalid verification code."); setLoading(false); return; }
      if (data.token) {
        setAuthToken(data.token);
        try {
          const SecureStore = await import("expo-secure-store");
          await SecureStore.setItemAsync("ajkmart_reg_token", data.token);
        // eslint-disable-next-line ajk-local/no-silent-catch -- SecureStore cache is best-effort
        } catch {}
      }
      if (data.refreshToken) setAuthRefreshToken(data.refreshToken);
      if (data.user) setAuthUser(data.user as AppUser);
      setEmail(emailReg.trim().toLowerCase()); // pre-fill step 2 email field
      setStep(2);
    } catch {
      setError("Network error. Please check your connection and try again.");
    }
    setLoading(false);
  };

  /* Profile photo picker — compresses before storing */
  const handlePickPhoto = async () => {
    setPhotoLoading(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { setPhotoLoading(false); return; }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });
      if (!result.canceled && result.assets[0]) {
        const compressedUri = await compressImage(result.assets[0].uri, { maxWidth: 1200, quality: 0.7 });
        setPhotoUri(compressedUri);
      }
    } catch {
      /* photo pick failure is non-fatal — user proceeds without photo */
    }
    setPhotoLoading(false);
  };

  const handleStep2 = () => {
    clearError();
    if (!name.trim() || name.trim().length < 2) { setError("Please enter your name (at least 2 characters)"); return; }
    if (!username || username.length < 3) { setError("Username is required (at least 3 characters)"); return; }
    if (usernameStatus === "taken") { setError("This username is already taken. Please choose another."); return; }
    if (usernameStatus === "checking") { setError("Please wait — checking username availability"); return; }
    if (usernameStatus !== "available") { setError("Please wait for username availability check to complete"); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Please enter a valid email address");
      return;
    }
    setStep(3);
  };

  const handleStep3 = () => {
    clearError();
    if (!city) { setError("Please select your city"); return; }
    setStep(4);
  };

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
        try {
          const SecureStore = await import("expo-secure-store");
          activeToken = await SecureStore.getItemAsync("ajkmart_reg_token") || "";
        // eslint-disable-next-line ajk-local/no-silent-catch -- reg token read failure falls through to the missing-token guard below
        } catch {}
      }
      if (!activeToken) {
        setError("Session expired. Please go back and verify OTP again.");
        setLoading(false);
        return;
      }

      const termsVersion = config.compliance?.termsVersion || "";
      let profilePhotoBase64: string | undefined;
      if (photoUri) {
        try { profilePhotoBase64 = await compressImageToDataUrl(photoUri, 200 * 1024); } catch { /* photo upload is non-fatal */ }
      }
      const profileRes = await fetch(`${API}/auth/complete-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${activeToken}` },
        body: JSON.stringify({
          name: name.trim(),
          username: username.trim(),
          ...(email && { email: email.trim().toLowerCase() }),
          ...(cnic && { cnic: cnic.trim() }),
          ...(city && { city }),
          ...(area && { area: area.trim() }),
          ...(address && { address: address.trim() }),
          ...(latitude && { latitude }),
          ...(longitude && { longitude }),
          password,
          ...(profilePhotoBase64 && { profilePhoto: profilePhotoBase64 }),
          ...(termsVersion && { acceptedTermsVersion: termsVersion }),
        }),
      });
      const profileData = await profileRes.json();

      if (!profileRes.ok) {
        setError(profileData.error || "Could not save profile. Please try again.");
        setLoading(false);
        return;
      }

      if (profileData.token) {
        setAuthToken(profileData.token);
        try {
          const SecureStore = await import("expo-secure-store");
          await SecureStore.setItemAsync("ajkmart_reg_token", profileData.token);
        // eslint-disable-next-line ajk-local/no-silent-catch -- SecureStore cache for reg token is best-effort; in-memory token still works
        } catch {}
      }
      if (profileData.refreshToken) setAuthRefreshToken(profileData.refreshToken);
      if (profileData.user) setAuthUser(profileData.user);

      setStep(5);
    } catch (e: any) { setError(e.message || "Could not save profile."); }
    setLoading(false);
  };

  const handleFinish = async () => {
    setLoading(true);
    try {
      let finalToken = authToken;
      if (!finalToken) {
        try {
          const SecureStore = await import("expo-secure-store");
          finalToken = await SecureStore.getItemAsync("ajkmart_reg_token") || "";
        // eslint-disable-next-line ajk-local/no-silent-catch -- reg token read failure is handled by the empty-token guard below
        } catch {}
      }
      if (finalToken && authUser) {
        const userData = {
          ...authUser,
          walletBalance: authUser.walletBalance ?? 0,
          isActive: authUser.isActive ?? true,
          createdAt: authUser.createdAt ?? new Date().toISOString(),
        };
        await login(userData, finalToken, authRefreshToken || undefined);
        AsyncStorage.removeItem(REG_DRAFT_KEY).catch(() => {});
        try {
          const SecureStore = await import("expo-secure-store");
          await SecureStore.deleteItemAsync("ajkmart_reg_token");
        // eslint-disable-next-line ajk-local/no-silent-catch -- reg token cleanup is best-effort; login is already complete
        } catch {}
        router.replace("/(tabs)");
      } else {
        /* No token — registration incomplete; clear draft so a stale form
           doesn't restore next time the user opens the registration screen. */
        goBackToAuth();
      }
    } catch (e: unknown) {
      log.warn("Login after registration failed:", e instanceof Error ? e.message : e);
      goBackToAuth();
    }
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
    } else {
      setStep((step - 1) as RegStep);
    }
  };

  const accountLevel = authUser?.accountLevel || "bronze";
  const levelInfo = LEVEL_CONFIG[accountLevel] || LEVEL_CONFIG.bronze;

  if (config.appStatus === "maintenance") {
    return (
      <LinearGradient colors={["#1a1a2e", "#16213e", "#0f3460"]} style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24 }}>
        <View style={{ backgroundColor: "#fff", borderRadius: 24, padding: 32, width: "100%", maxWidth: 360, alignItems: "center", ...Platform.select({ web: { boxShadow: "0 10px 20px rgba(0,0,0,0.2)" }, default: { shadowColor: "#000", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.2, shadowRadius: 20, elevation: 20 } }) }}>
          <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: "#FEF3C7", justifyContent: "center", alignItems: "center", marginBottom: 20 }}>
            <Ionicons name="construct-outline" size={40} color="#D97706" />
          </View>
          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 22, color: "#1F2937", marginBottom: 12, textAlign: "center" }}>Under Maintenance</Text>
          <Text style={{ fontSize: 14, color: "#6B7280", lineHeight: 22, textAlign: "center", marginBottom: 20 }}>
            {config.content.maintenanceMsg || "We're performing scheduled maintenance. Back soon!"}
          </Text>
          {(config.platform.supportPhone || config.platform.supportEmail) && (
            <View style={{ backgroundColor: "#F9FAFB", borderRadius: 12, padding: 14, width: "100%", borderWidth: 1, borderColor: "#E5E7EB" }}>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 11, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>Need Help?</Text>
              {config.platform.supportPhone ? <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#374151" }}>{config.platform.supportPhone}</Text> : null}
              {config.platform.supportEmail ? <Text style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>{config.platform.supportEmail}</Text> : null}
            </View>
          )}
        </View>
      </LinearGradient>
    );
  }

  if (!config.features.newUsers) {
    return (
      <LinearGradient colors={["#1a1a2e", "#16213e", "#0f3460"]} style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24 }}>
        <View style={{ backgroundColor: "#fff", borderRadius: 24, padding: 32, width: "100%", maxWidth: 360, alignItems: "center", ...Platform.select({ web: { boxShadow: "0 10px 20px rgba(0,0,0,0.2)" }, default: { shadowColor: "#000", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.2, shadowRadius: 20, elevation: 20 } }) }}>
          <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: "#FEE2E2", justifyContent: "center", alignItems: "center", marginBottom: 20 }}>
            <Ionicons name="lock-closed-outline" size={40} color="#DC2626" />
          </View>
          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 22, color: "#1F2937", marginBottom: 12, textAlign: "center" }}>Registration Closed</Text>
          <Text style={{ fontSize: 14, color: "#6B7280", lineHeight: 22, textAlign: "center", marginBottom: 20 }}>
            New account registrations are currently not available. Please try again later.
          </Text>
          {(config.platform.supportPhone || config.platform.supportEmail) && (
            <View style={{ backgroundColor: "#F9FAFB", borderRadius: 12, padding: 14, width: "100%", borderWidth: 1, borderColor: "#E5E7EB", marginBottom: 20 }}>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 11, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>Contact Support</Text>
              {config.platform.supportPhone ? <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#374151" }}>{config.platform.supportPhone}</Text> : null}
              {config.platform.supportEmail ? <Text style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>{config.platform.supportEmail}</Text> : null}
            </View>
          )}
          <TouchableOpacity onPress={goBackToAuth} style={{ width: "100%", backgroundColor: "#1F2937", borderRadius: 14, paddingVertical: 14, alignItems: "center" }}>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: "#fff" }}>← Back to Login</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    );
  }

  if (regMode === "none") {
    return (
      <LinearGradient colors={["#1a1a2e", "#16213e", "#0f3460"]} style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24 }}>
        <View style={{ backgroundColor: "#fff", borderRadius: 24, padding: 32, width: "100%", maxWidth: 360, alignItems: "center", ...Platform.select({ web: { boxShadow: "0 10px 20px rgba(0,0,0,0.2)" }, default: { shadowColor: "#000", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.2, shadowRadius: 20, elevation: 20 } }) }}>
          <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: "#FEE2E2", justifyContent: "center", alignItems: "center", marginBottom: 20 }}>
            <Ionicons name="alert-circle-outline" size={40} color="#DC2626" />
          </View>
          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 22, color: "#1F2937", marginBottom: 12, textAlign: "center" }}>Registration Unavailable</Text>
          <Text style={{ fontSize: 14, color: "#6B7280", lineHeight: 22, textAlign: "center", marginBottom: 20 }}>
            No registration methods are currently enabled. Please contact support.
          </Text>
          {(config.platform.supportPhone || config.platform.supportEmail) && (
            <View style={{ backgroundColor: "#F9FAFB", borderRadius: 12, padding: 14, width: "100%", borderWidth: 1, borderColor: "#E5E7EB", marginBottom: 20 }}>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 11, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>Contact Support</Text>
              {config.platform.supportPhone ? <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#374151" }}>{config.platform.supportPhone}</Text> : null}
              {config.platform.supportEmail ? <Text style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>{config.platform.supportEmail}</Text> : null}
            </View>
          )}
          <TouchableOpacity onPress={goBackToAuth} style={{ width: "100%", backgroundColor: "#1F2937", borderRadius: 14, paddingVertical: 14, alignItems: "center" }}>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: "#fff" }}>← Back to Login</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    );
  }

  if (step === 5) {
    return (
      <LinearGradient colors={[C.primaryDark, C.primary, C.primaryLight]} style={s.gradient}>
        <ScrollView contentContainerStyle={s.successScroll}>
          <View style={s.successCard}>
            <View style={s.successIconWrap}>
              <View style={s.successIconCircle}>
                <Ionicons name="checkmark" size={40} color="#fff" />
              </View>
            </View>
            <Text style={s.successTitle}>Registration Successful!</Text>
            <Text style={s.successSub}>
              Welcome to {config.platform.appName}! Your account is ready.
            </Text>

            <View style={[s.levelBadge, { backgroundColor: levelInfo.bg, borderColor: levelInfo.color }]}>
              <Ionicons name={levelInfo.icon as any} size={28} color={levelInfo.color} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[s.levelTitle, { color: levelInfo.color }]}>{levelInfo.label} Account</Text>
                <Text style={s.levelDesc}>{levelInfo.desc}</Text>
              </View>
            </View>

            {signupBonus > 0 && (
              <View style={s.bonusBanner}>
                <View style={s.bonusIconWrap}>
                  <Ionicons name="gift" size={22} color={C.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.bonusTitle}>Welcome Bonus!</Text>
                  <Text style={s.bonusSub}>Rs. {signupBonus} has been added to your wallet</Text>
                </View>
              </View>
            )}

            {accountLevel !== "gold" && (
              <View style={s.kycPrompt}>
                <Ionicons name="document-text-outline" size={20} color={C.primary} />
                <Text style={s.kycText}>
                  Complete KYC verification to unlock Gold benefits and higher limits
                </Text>
              </View>
            )}

            <AuthButton label="Start Shopping" onPress={handleFinish} loading={loading} icon="cart-outline" />
          </View>
        </ScrollView>
      </LinearGradient>
    );
  }

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
          <TouchableOpacity activeOpacity={0.7}
            onPress={handleBack}
            style={s.backBtn}
            accessibilityLabel={step <= 2 ? "Go back" : "Previous step"}
            accessibilityRole="button"
          >
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </TouchableOpacity>
          <View style={s.headerLogoRow}>
            <View style={s.headerLogo}>
              <Ionicons name="person-add" size={24} color={C.primary} />
            </View>
          </View>
          <Text style={s.headerTitle}>Create Account</Text>
          <Text style={s.headerSub}>{stepSubtitles[step]}</Text>

          <View style={s.progressRow}>
            <StepProgress total={5} current={step} />
          </View>
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
                <Text style={{ fontSize: 11, color: "#92400E", fontFamily: "Inter_500Medium", flex: 1, lineHeight: 16 }}>
                  Slow connection detected — data saver mode on. Image previews hidden.
                </Text>
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
                  <PhoneInput
                    value={phone}
                    onChangeText={(v: string) => { setPhone(v); clearError(); }}
                    autoFocus
                  />
                </>
              ) : (
                <>
                  <TouchableOpacity activeOpacity={0.7}
                    onPress={() => { setOtpSent(false); setOtp(""); clearError(); }}
                    style={s.changeBtn}
                    accessibilityRole="button"
                  >
                    <Ionicons name="arrow-back" size={14} color={C.primary} />
                    <Text style={s.changeBtnText}>Change Number</Text>
                  </TouchableOpacity>

                  <Text style={s.fieldLabel}>Enter Verification Code</Text>
                  <Text style={s.fieldSub}>Code sent to +92 {phone}</Text>

                  <OtpInput
                    value={otp}
                    onChangeText={(v: string) => { setOtp(v); clearError(); }}
                    hasError={!!error}
                    onComplete={() => handleVerifyOtp()}
                  />

                  <DevOtpBanner otp={devOtp} />

                  <TouchableOpacity activeOpacity={0.7}
                    onPress={handleSendOtp}
                    style={[s.resendBtn, resendCooldown > 0 && s.resendDisabled]}
                    disabled={resendCooldown > 0}
                    accessibilityRole="button"
                  >
                    <Ionicons name="refresh-outline" size={16} color={resendCooldown > 0 ? C.textMuted : C.primary} />
                    <Text style={[s.resendText, resendCooldown > 0 && { color: C.textMuted }]}>
                      {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend OTP"}
                    </Text>
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
                  <InputField
                    label=""
                    value={emailReg}
                    onChangeText={v => { setEmailReg(v); clearError(); }}
                    placeholder="you@example.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoFocus
                    error={!!error}
                  />
                </>
              ) : (
                <>
                  <TouchableOpacity activeOpacity={0.7}
                    onPress={() => { setEmailRegOtpSent(false); setEmailRegOtp(""); clearError(); }}
                    style={s.changeBtn}
                    accessibilityRole="button"
                  >
                    <Ionicons name="arrow-back" size={14} color={C.primary} />
                    <Text style={s.changeBtnText}>Change Email</Text>
                  </TouchableOpacity>

                  <Text style={s.fieldLabel}>Enter Verification Code</Text>
                  <Text style={s.fieldSub}>Code sent to {emailReg}</Text>

                  <OtpInput
                    value={emailRegOtp}
                    onChangeText={(v: string) => { setEmailRegOtp(v); clearError(); }}
                    hasError={!!error}
                    onComplete={() => handleVerifyEmailReg()}
                  />

                  <DevOtpBanner otp={emailRegDevOtp} />

                  <TouchableOpacity activeOpacity={0.7}
                    onPress={handleSendEmailReg}
                    style={[s.resendBtn, emailRegResendCooldown > 0 && s.resendDisabled]}
                    disabled={emailRegResendCooldown > 0}
                    accessibilityRole="button"
                  >
                    <Ionicons name="refresh-outline" size={16} color={emailRegResendCooldown > 0 ? C.textMuted : C.primary} />
                    <Text style={[s.resendText, emailRegResendCooldown > 0 && { color: C.textMuted }]}>
                      {emailRegResendCooldown > 0 ? `Resend in ${emailRegResendCooldown}s` : "Resend Code"}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <InputField
                label="Full Name *"
                value={name}
                onChangeText={v => { setName(v); clearError(); }}
                placeholder="Enter your full name"
                autoCapitalize="words"
                autoFocus
                error={!!error && !name.trim()}
              />
              <View>
                <InputField
                  label="Username *"
                  value={username}
                  onChangeText={handleUsernameChange}
                  placeholder="e.g. ahmed_khan92"
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={20}
                  error={usernameStatus === "taken" || (!!error && username.length < 3)}
                  rightIcon={
                    usernameStatus === "available" ? "checkmark-circle" :
                    usernameStatus === "taken" ? "close-circle" :
                    undefined
                  }
                  rightIconColor={usernameStatus === "available" ? C.success : C.danger}
                />
                {usernameStatus === "checking" && (
                  <View style={s.usernameCheckRow}>
                    <ActivityIndicator size="small" color={C.primary} />
                    <Text style={s.usernameCheckText}>Checking availability...</Text>
                  </View>
                )}
                {usernameStatus === "available" && (
                  <Text style={[s.usernameHint, { color: C.success }]}>Username is available!</Text>
                )}
                {usernameStatus === "taken" && (
                  <Text style={[s.usernameHint, { color: C.danger }]}>Username already taken</Text>
                )}
                {!usernameStatus && (
                  <Text style={s.fieldHint}>Letters, numbers, underscore only. Min 3 characters.</Text>
                )}
              </View>
              <InputField
                label="Email (optional)"
                value={email}
                onChangeText={v => { setEmail(v); clearError(); }}
                placeholder="email@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                error={!!error && !!email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}
              />

              {/* Profile photo picker */}
              <Text style={s.fieldLabel}>Profile Photo (Optional)</Text>
              <TouchableOpacity activeOpacity={0.7}
                onPress={handlePickPhoto}
                disabled={photoLoading}
                style={{ flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 8, padding: 12, backgroundColor: "#F9FAFB", borderRadius: 14, borderWidth: 1, borderColor: "#E5E7EB" }}
                accessibilityRole="button"
                accessibilityLabel="Choose profile photo"
              >
                {photoLoading ? (
                  <ActivityIndicator size="small" color={C.primary} />
                ) : photoUri && !isLowBandwidth ? (
                  <Image source={{ uri: photoUri }} style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: "#E5E7EB" }} />
                ) : photoUri && isLowBandwidth ? (
                  <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: "#D1FAE5", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="checkmark-circle" size={28} color="#059669" />
                  </View>
                ) : (
                  <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: "#EEF2FF", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="camera-outline" size={24} color={C.primary} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: "#374151" }}>
                    {photoUri ? "Change Photo" : "Add Profile Photo"}
                  </Text>
                  <Text style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
                    {photoUri ? "Looking good!" : "Help others recognize you"}
                  </Text>
                </View>
                {!photoLoading && <Ionicons name="chevron-forward" size={16} color={C.textMuted} />}
              </TouchableOpacity>
            </>
          )}

          {step === 3 && (
            <>
              <TouchableOpacity activeOpacity={0.7}
                onPress={handleGetLocation}
                disabled={gpsLoading}
                style={s.gpsButton}
                accessibilityRole="button"
                accessibilityLabel="Use GPS to fill address"
              >
                {gpsLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="navigate" size={20} color="#fff" />
                )}
                <Text style={s.gpsButtonText}>
                  {gpsLoading ? "Getting Location..." : "Use My Current Location"}
                </Text>
              </TouchableOpacity>
              {!!gpsStatus && (
                <Text style={[s.gpsStatusText, gpsStatus.includes("denied") && { color: C.danger }]}>
                  {gpsStatus}
                </Text>
              )}
              {!!(latitude && longitude) && (
                <View style={s.coordsRow}>
                  <Ionicons name="location" size={14} color={C.success} />
                  <Text style={s.coordsText}>{latitude}, {longitude}</Text>
                </View>
              )}

              <View style={s.dividerRow}>
                <View style={s.dividerLine} />
                <Text style={s.dividerText}>or enter manually</Text>
                <View style={s.dividerLine} />
              </View>

              <Text style={s.fieldLabel}>City *</Text>
              <TouchableOpacity activeOpacity={0.7}
                onPress={() => setShowCityPicker(!showCityPicker)}
                style={[s.pickerButton, !city && !!error && s.pickerError]}
              >
                <Text style={[s.pickerButtonText, !city && { color: C.textMuted }]}>
                  {city || "Select your city"}
                </Text>
                <Ionicons name={showCityPicker ? "chevron-up" : "chevron-down"} size={20} color={C.textMuted} />
              </TouchableOpacity>
              {showCityPicker && (
                <View style={s.cityDropdown}>
                  <View style={s.citySearchWrap}>
                    <Ionicons name="search" size={16} color={C.textMuted} />
                    <InputField
                      value={citySearch}
                      onChangeText={setCitySearch}
                      placeholder="Search city..."
                    />
                  </View>
                  <ScrollView style={s.cityList} nestedScrollEnabled>
                    {filteredCities.map(c => (
                      <TouchableOpacity activeOpacity={0.7}
                        key={c}
                        onPress={() => { setCity(c); setShowCityPicker(false); setCitySearch(""); clearError(); }}
                        style={[s.cityItem, city === c && s.cityItemSelected]}
                      >
                        <Text style={[s.cityItemText, city === c && s.cityItemTextSelected]}>{c}</Text>
                        {city === c && <Ionicons name="checkmark-circle" size={18} color={C.primary} />}
                      </TouchableOpacity>
                    ))}
                    {filteredCities.length === 0 && (
                      <Text style={s.noCityText}>No cities found</Text>
                    )}
                  </ScrollView>
                </View>
              )}

              <InputField
                label="Area / Locality"
                value={area}
                onChangeText={v => { setArea(v); clearError(); }}
                placeholder="e.g. Satellite Town, Block B"
                autoCapitalize="words"
              />
              <InputField
                label="Full Address"
                value={address}
                onChangeText={v => { setAddress(v); clearError(); }}
                placeholder="House/flat no, street, landmark"
                autoCapitalize="sentences"
                multiline
              />
            </>
          )}

          {step === 4 && (
            <>
              <View>
                <Text style={s.fieldLabel}>CNIC / National ID</Text>
                <InputField
                  value={cnic}
                  onChangeText={v => { setCnic(formatCnic(v)); clearError(); }}
                  placeholder="XXXXX-XXXXXXX-X"
                  keyboardType="numeric"
                  maxLength={15}
                  error={!!error && !!cnic && !/^\d{5}-\d{7}-\d{1}$/.test(cnic)}
                />
                <Text style={s.fieldHint}>Optional — for KYC verification and Gold account</Text>
              </View>

              <InputField
                label="Password *"
                value={password}
                onChangeText={v => { setPassword(v); clearError(); }}
                placeholder="Minimum 8 characters"
                secureTextEntry={!showPwd}
                rightIcon={showPwd ? "eye-off-outline" : "eye-outline"}
                onRightIconPress={() => setShowPwd(v => !v)}
              />
              <PasswordStrengthBar password={password} />

              <InputField
                label="Confirm Password *"
                value={confirmPassword}
                onChangeText={v => { setConfirmPassword(v); clearError(); }}
                placeholder="Re-enter your password"
                secureTextEntry={!showConfirmPwd}
                rightIcon={showConfirmPwd ? "eye-off-outline" : "eye-outline"}
                onRightIconPress={() => setShowConfirmPwd(v => !v)}
                error={!!confirmPassword && password !== confirmPassword}
              />
              {!!confirmPassword && password !== confirmPassword && (
                <Text style={s.mismatchText}>Passwords do not match</Text>
              )}

              <TouchableOpacity activeOpacity={0.7}
                onPress={() => setTermsAccepted(!termsAccepted)}
                style={s.termsRow}
                accessibilityLabel="Accept Terms and Conditions"
                accessibilityRole="checkbox"
                accessibilityState={{ checked: termsAccepted }}
              >
                <View style={[s.checkbox, termsAccepted && s.checkboxChecked]}>
                  {termsAccepted && <Ionicons name="checkmark" size={14} color="#fff" />}
                </View>
                <Text style={s.termsText}>
                  I agree to the <Text style={{ color: C.primary }}>Terms & Conditions</Text> and{" "}
                  <Text style={{ color: C.primary }}>Privacy Policy</Text>
                </Text>
              </TouchableOpacity>
            </>
          )}

          {alreadyExists && step === 1 ? (
            <View style={{ marginTop: 8 }}>
              <View style={{ backgroundColor: "#EFF6FF", borderRadius: 14, borderWidth: 1, borderColor: "#93C5FD", padding: 16, alignItems: "center", marginBottom: 12 }}>
                <Ionicons name="information-circle" size={28} color="#2563EB" style={{ marginBottom: 6 }} />
                <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: "#1E40AF", textAlign: "center", marginBottom: 4 }}>
                  Number Already Registered
                </Text>
                <Text style={{ fontSize: 13, color: "#3B82F6", textAlign: "center" }}>
                  This phone number already has an account. Please log in instead.
                </Text>
              </View>
              <AuthButton
                label="Login to Existing Account"
                onPress={goBackToAuth}
                icon="log-in-outline"
              />
              <TouchableOpacity activeOpacity={0.7}
                onPress={() => { setPhone(""); clearError(); }}
                style={{ marginTop: 12, alignItems: "center" }}
                accessibilityRole="button"
              >
                <Text style={{ color: C.primary, fontSize: 13, fontFamily: "Inter_500Medium" }}>
                  Use a different number
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {queuedOffline && step === 1 && (
                <AlertBox type="info" message="You're offline. Your OTP request will be sent automatically when you reconnect." />
              )}
              {error ? <AlertBox type="error" message={error} /> : null}

              <AuthButton
                label={
                  step === 1
                    ? regMode === "email"
                      ? emailRegOtpSent ? "Verify Code" : "Send Verification Code"
                      : otpSent ? "Verify OTP" : "Send OTP"
                    : step === 2 ? "Continue"
                    : step === 3 ? "Continue"
                    : "Create Account"
                }
                onPress={
                  step === 1
                    ? regMode === "email"
                      ? emailRegOtpSent ? handleVerifyEmailReg : handleSendEmailReg
                      : otpSent ? handleVerifyOtp : handleSendOtp
                    : step === 2 ? handleStep2
                    : step === 3 ? handleStep3
                    : handleStep4
                }
                loading={loading}
                icon={
                  step === 4 ? "shield-checkmark-outline"
                  : step === 1 && (regMode === "email" ? !emailRegOtpSent : !otpSent) ? "send-outline"
                  : step === 3 ? "location-outline"
                  : undefined
                }
              />

              {step === 1 && (
                <TouchableOpacity activeOpacity={0.7}
                  onPress={goBackToAuth}
                  style={s.loginLink}
                  accessibilityLabel="Go to login"
                  accessibilityRole="link"
                >
                  <Text style={s.loginLinkText}>
                    Already have an account? <Text style={{ fontFamily: "Inter_700Bold" }}>Login</Text>
                  </Text>
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

const s = StyleSheet.create({
  gradient: { flex: 1 },
  topSection: { alignItems: "center", paddingBottom: spacing.lg, paddingHorizontal: spacing.xl },
  backBtn: {
    position: "absolute", left: spacing.lg,
    top: Platform.OS === "web" ? 67 : 50,
    width: 40, height: 40, borderRadius: radii.md,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  headerLogoRow: { marginBottom: spacing.md },
  headerLogo: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: "#fff", alignItems: "center", justifyContent: "center",
    ...shadows.md,
  },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 26, color: "#fff", marginBottom: 4 },
  headerSub: { ...typography.body, color: "rgba(255,255,255,0.85)", marginBottom: spacing.lg },
  progressRow: { marginBottom: 8 },
  stepLabels: { flexDirection: "row", justifyContent: "center", gap: 16 },
  stepLabel: { ...typography.small, color: "rgba(255,255,255,0.4)" },
  stepLabelActive: { color: "rgba(255,255,255,0.9)" },

  card: { backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.xxl, flex: 1 },

  fieldLabel: { ...typography.captionMedium, color: C.textSecondary, marginBottom: spacing.sm },
  fieldSub: { ...typography.caption, color: C.textMuted, marginBottom: spacing.md },
  fieldHint: { ...typography.small, color: C.textMuted, marginTop: -8, marginBottom: spacing.md, paddingLeft: 2 },

  changeBtn: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: spacing.md },
  changeBtnText: { ...typography.bodyMedium, color: C.primary },

  resendBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, marginBottom: spacing.md },
  resendDisabled: { opacity: 0.5 },
  resendText: { ...typography.bodyMedium, color: C.primary },

  gpsButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    backgroundColor: C.primary, borderRadius: radii.lg, paddingVertical: 14,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  gpsButtonText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: "#fff" },
  gpsStatusText: { ...typography.caption, color: C.success, textAlign: "center", marginBottom: spacing.sm },
  coordsRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, marginBottom: spacing.md },
  coordsText: { ...typography.small, color: C.textMuted },

  dividerRow: { flexDirection: "row", alignItems: "center", marginVertical: spacing.lg, gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: C.border },
  dividerText: { ...typography.small, color: C.textMuted },

  pickerButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderWidth: 1.5, borderColor: C.border, borderRadius: radii.lg,
    paddingHorizontal: spacing.lg, paddingVertical: 14,
    backgroundColor: C.surfaceSecondary,
    marginBottom: spacing.md,
  },
  pickerError: { borderColor: C.danger },
  pickerButtonText: { ...typography.body, color: C.text },

  cityDropdown: {
    borderWidth: 1, borderColor: C.border, borderRadius: radii.lg,
    backgroundColor: C.surface, marginTop: -8, marginBottom: spacing.md,
    maxHeight: 220, overflow: "hidden",
    ...shadows.sm,
  },
  citySearchWrap: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingTop: 8, gap: 8 },
  cityList: { maxHeight: 170 },
  cityItem: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: C.border,
  },
  cityItemSelected: { backgroundColor: `${C.primary}10` },
  cityItemText: { ...typography.body, color: C.text },
  cityItemTextSelected: { color: C.primary, fontFamily: "Inter_600SemiBold" },
  noCityText: { ...typography.caption, color: C.textMuted, textAlign: "center", paddingVertical: 16 },

  termsRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: spacing.sm, marginBottom: spacing.md },
  checkbox: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, borderColor: C.border, alignItems: "center", justifyContent: "center", marginTop: 1 },
  checkboxChecked: { backgroundColor: C.primary, borderColor: C.primary },
  termsText: { flex: 1, ...typography.caption, color: C.textSecondary, lineHeight: 19 },

  mismatchText: { ...typography.caption, color: C.danger, marginTop: -8, marginBottom: spacing.md, paddingLeft: 4 },
  loginLink: { alignItems: "center", marginTop: spacing.xl },
  loginLinkText: { ...typography.bodyMedium, color: C.primary },
  skipLink: { alignItems: "center", marginTop: spacing.md },
  skipLinkText: { ...typography.bodyMedium, color: C.textMuted, textDecorationLine: "underline" },

  usernameCheckRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: -8, marginBottom: spacing.md, paddingLeft: 2 },
  usernameCheckText: { ...typography.small, color: C.primary },
  usernameHint: { ...typography.small, marginTop: -8, marginBottom: spacing.md, paddingLeft: 2 },

  successScroll: { flexGrow: 1, justifyContent: "center", alignItems: "center", padding: spacing.xxl },
  successCard: { backgroundColor: C.surface, borderRadius: radii.xxl, padding: spacing.xxxl, alignItems: "center", width: "100%", ...shadows.lg },
  successIconWrap: { marginBottom: spacing.xl },
  successIconCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.success, alignItems: "center", justifyContent: "center" },
  successTitle: { ...typography.h2, color: C.text, marginBottom: spacing.sm, textAlign: "center" },
  successSub: { ...typography.body, color: C.textMuted, textAlign: "center", marginBottom: spacing.xl, lineHeight: 22 },

  levelBadge: {
    flexDirection: "row", alignItems: "center",
    borderRadius: radii.lg, padding: spacing.lg,
    borderWidth: 1.5, marginBottom: spacing.lg, width: "100%",
  },
  levelTitle: { fontFamily: "Inter_700Bold", fontSize: 16, marginBottom: 2 },
  levelDesc: { ...typography.caption, color: C.textSecondary },

  bonusBanner: { flexDirection: "row", alignItems: "center", backgroundColor: C.accentSoft, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.lg, borderWidth: 1, borderColor: "#FFD580", width: "100%" },
  bonusIconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#FFF4E5", alignItems: "center", justifyContent: "center", marginRight: 12 },
  bonusTitle: { ...typography.subtitle, color: C.text, marginBottom: 2 },
  bonusSub: { ...typography.caption, color: C.textSecondary },

  kycPrompt: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: `${C.primary}08`, borderRadius: radii.md,
    padding: spacing.md, marginBottom: spacing.xl, width: "100%",
    borderWidth: 1, borderColor: `${C.primary}20`,
  },
  kycText: { flex: 1, ...typography.caption, color: C.primary, lineHeight: 18 },
});

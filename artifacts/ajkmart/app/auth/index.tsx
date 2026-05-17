import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, type RelativePathString } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import * as Facebook from "expo-auth-session/providers/facebook";

WebBrowser.maybeCompleteAuthSession();

import Colors, { spacing, radii, shadows, typography } from "@/constants/colors";
import { useAuth, type AppUser } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { usePlatformConfig } from "@/context/PlatformConfigContext";
import { useAuthConfig } from "@/context/AuthConfigContext";
import { tDual, type TranslationKey } from "@workspace/i18n";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useOTPBypass } from "@/hooks/useOTPBypass";
import { useNetworkQuality } from "@/hooks/useNetworkQuality";

/* ── Shared SDK components — Metro auto-resolves .native.tsx for Expo ──────────
   LoginScreen.native.tsx: React Native login screen (OTP / password / magic link)
   OtpInput.native.tsx:    React Native OTP digit input used in the TOTP step     */
import { LoginScreen, OtpInput } from "@workspace/auth-react";

import {
  AuthButton,
  AlertBox,
  InputField,
  authColors as C,
} from "@/components/auth-shared";

const API = `https://${process.env.EXPO_PUBLIC_DOMAIN ?? ""}/api`;

type PostStep = "auth" | "totp" | "pending" | "complete-profile";

/**
 * Discriminated result shape returned by auth API endpoints (login, OTP verify,
 * social/google, social/facebook). All fields are optional so the handler can
 * safely narrow each variant without casting.
 */
interface LoginApiResult {
  /* 2FA challenge */
  requires2FA?: boolean;
  tempToken?: string;
  userId?: string;
  /* Pending approval */
  pendingApproval?: boolean;
  /* Cross-app account (customer role missing) */
  wrongApp?: boolean;
  /* Normal login / social / magic-link */
  user?: AppUser & { name?: string };
  token?: string;
  refreshToken?: string;
}

async function authPost(path: string, body: object) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${json.error || json.message || "Request failed"}`);
  return json?.data !== undefined ? json.data : json;
}

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const {
    login, setTwoFactorPending, twoFactorPending,
    completeTwoFactorLogin, biometricEnabled, attemptBiometricLogin,
  } = useAuth();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const { config: platformCfg } = usePlatformConfig();
  const authConfig = useAuthConfig();
  const { bypassActive: otpBypassActive, bypassMessage: otpBypassMessage } = useOTPBypass();
  const { tier: networkTier } = useNetworkQuality();
  const isLowBandwidth = networkTier === "slow";
  const [lowBwDismissed, setLowBwDismissed] = useState(false);
  const appName = platformCfg.platform.appName;
  const appTagline = platformCfg.platform.appTagline;
  const topPad = Math.max(insets.top, 12);

  /* ── Post-auth step routing ─────────────────────────────────────────────── */
  const [step, setStep] = useState<PostStep>("auth");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [biometricLoading, setBiometricLoading] = useState(false);

  /* TOTP step state */
  const [totpTempToken, setTotpTempToken] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpUserId, setTotpUserId] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [useBackup, setUseBackup] = useState(false);
  const [backupCode, setBackupCode] = useState("");

  /* Pending / complete-profile step state */
  const [pendingToken, setPendingToken] = useState("");
  const [pendingRefreshToken, setPendingRefreshToken] = useState<string | undefined>(undefined);
  const [pendingUser, setPendingUser] = useState<AppUser | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileUsername, setProfileUsername] = useState("");
  const [profilePassword, setProfilePassword] = useState("");
  const [showProfilePwd, setShowProfilePwd] = useState(false);

  const clearError = () => setError("");

  /* Sync context-level twoFactorPending into local step state */
  useEffect(() => {
    if (twoFactorPending) {
      setTotpTempToken(twoFactorPending.tempToken);
      setTotpUserId(twoFactorPending.userId);
      setStep("totp");
      setTwoFactorPending(null);
    }
  }, [twoFactorPending]);

  const navigateAfterLogin = async (userOrRole: AppUser | string | null | undefined) => {
    let rolesArr: string[];
    if (typeof userOrRole === "string") {
      rolesArr = [userOrRole];
    } else if (userOrRole != null && Array.isArray(userOrRole.roles)) {
      rolesArr = userOrRole.roles;
    } else {
      rolesArr = [];
    }
    if (!rolesArr.includes("customer")) {
      router.replace("/auth/wrong-app");
      return;
    }
    try {
      const returnTo = await AsyncStorage.getItem("@ajkmart_auth_return_to");
      const isSafe = typeof returnTo === "string"
        && returnTo.startsWith("/")
        && !returnTo.startsWith("//")
        && !returnTo.includes("://");
      if (isSafe) {
        await AsyncStorage.removeItem("@ajkmart_auth_return_to");
        router.replace(returnTo as RelativePathString);
        return;
      }
    // eslint-disable-next-line ajk-local/no-silent-catch -- failure reading stored return-to URL; falls back to home tab safely
    } catch {}
    router.replace("/(tabs)");
  };

  /* Called by <LoginScreen onSuccess={...}> when the API returns a result.
     Routes to the appropriate post-auth step or completes login. */
  const handleLoginResult = async (res: LoginApiResult) => {
    if (res.requires2FA) {
      setTotpTempToken(res.tempToken ?? "");
      setTotpUserId(res.userId ?? "");
      setStep("totp");
      return;
    }
    if (res.pendingApproval && res.user) {
      setPendingToken(res.token ?? "");
      setPendingRefreshToken(res.refreshToken);
      setPendingUser(res.user);
      setStep("pending");
      return;
    }
    /* Cross-app account: customer role missing — navigate to wrong-app with token */
    if (res.wrongApp && res.user && res.token) {
      await login(res.user, res.token, res.refreshToken);
      router.replace("/auth/wrong-app");
      return;
    }
    if (res.user && !res.user.name && res.token) {
      setPendingToken(res.token);
      setPendingRefreshToken(res.refreshToken);
      setPendingUser(res.user);
      setStep("complete-profile");
      return;
    }
    if (res.user && res.token) {
      await login(res.user, res.token, res.refreshToken);
      await navigateAfterLogin(res.user);
    }
  };

  const handleBiometricLogin = async () => {
    setBiometricLoading(true);
    try {
      const result = await attemptBiometricLogin();
      if (result === "transient_error") {
        setError("Connection issue. Please check your network and try again.");
      } else if (result !== null) {
        await navigateAfterLogin(result);
      }
    } catch {
      setError("Biometric not available.");
    }
    setBiometricLoading(false);
  };

  const handleTotpVerify = async () => {
    clearError();
    if (!totpCode || totpCode.length < 6) { setError("Please enter the 6-digit code"); return; }
    setLoading(true);
    try {
      const SecureStore = await import("expo-secure-store");
      const existing = await SecureStore.getItemAsync("device_fingerprint").catch(() => null);
      const fingerprint = existing ?? `${Platform.OS}_${Platform.Version}_unknown`;
      const res = await authPost("/auth/2fa/verify", {
        tempToken: totpTempToken,
        code: totpCode,
        deviceFingerprint: fingerprint,
      });
      if (trustDevice) {
        try {
          await fetch(`${API}/auth/2fa/trust-device`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${res.token}` },
            body: JSON.stringify({ deviceFingerprint: fingerprint }),
          });
        // eslint-disable-next-line ajk-local/no-silent-catch -- trust-device is optional; 2FA login completes regardless
        } catch {}
      }
      await completeTwoFactorLogin(res.user as AppUser, res.token, res.refreshToken);
      await navigateAfterLogin(res.user as AppUser);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Invalid 2FA code."); }
    setLoading(false);
  };

  const handleTotpBackup = async (code: string) => {
    clearError();
    setLoading(true);
    try {
      const res = await authPost("/auth/2fa/recovery", { tempToken: totpTempToken, backupCode: code });
      await completeTwoFactorLogin(res.user as AppUser, res.token, res.refreshToken);
      await navigateAfterLogin(res.user as AppUser);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Invalid backup code."); }
    setLoading(false);
  };

  const handleCompleteProfile = async () => {
    clearError();
    if (!profileName || profileName.trim().length < 2) { setError("Please enter your name"); return; }
    setLoading(true);
    try {
      const rawRes = await fetch(`${API}/auth/complete-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${pendingToken}` },
        body: JSON.stringify({
          name: profileName.trim(),
          ...(profileEmail && { email: profileEmail }),
          ...(profileUsername && { username: profileUsername }),
          ...(profilePassword && profilePassword.length >= 8 && { password: profilePassword }),
        }),
      });
      const res = await rawRes.json();
      if (!rawRes.ok || !res.user) {
        setError(res.error || res.message || "Could not save profile. Please try again.");
        setLoading(false);
        return;
      }
      const completeUser: AppUser = {
        walletBalance: "0", isActive: true, createdAt: new Date().toISOString(), ...res.user,
      };
      await login(completeUser, res.token ?? pendingToken, res.refreshToken ?? pendingRefreshToken);
      await navigateAfterLogin(completeUser);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Could not save profile."); }
    setLoading(false);
  };

  const showBiometric = authConfig.allowBiometric && biometricEnabled;

  /* ── Social login via expo-auth-session (token-exchange with backend) ──────
     Hooks run at component level; handleSocialLogin calls promptAsync to start
     the OAuth flow. Responses are processed in useEffect → POSTed to the
     backend token-exchange endpoints (/api/auth/social/google|facebook). */
  const [, googleResponse, promptGoogleAsync] = Google.useAuthRequest({
    clientId: authConfig.googleClientId,
    iosClientId: authConfig.googleClientId,
    androidClientId: authConfig.googleClientId,
    scopes: ["openid", "profile", "email"],
  });
  const [, fbResponse, promptFacebookAsync] = Facebook.useAuthRequest({
    clientId: authConfig.facebookAppId,
    scopes: ["email", "public_profile"],
  });

  useEffect(() => {
    if (googleResponse?.type !== "success") return;
    const idToken = googleResponse.authentication?.idToken;
    const accessToken = googleResponse.authentication?.accessToken;
    if (!idToken && !accessToken) { setError("Google sign-in failed. Try again."); return; }
    setLoading(true);
    authPost("/auth/social/google", { idToken: idToken ?? accessToken, role: "customer" })
      .then((res) => handleLoginResult(res))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Google login failed."))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleResponse]);

  useEffect(() => {
    if (fbResponse?.type !== "success") return;
    const accessToken = fbResponse.authentication?.accessToken;
    if (!accessToken) { setError("Facebook sign-in failed. Try again."); return; }
    setLoading(true);
    authPost("/auth/social/facebook", { accessToken, role: "customer" })
      .then((res) => handleLoginResult(res))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Facebook login failed."))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fbResponse]);

  const handleSocialLogin = async (provider: "google" | "facebook") => {
    clearError();
    try {
      if (provider === "google") await promptGoogleAsync();
      else await promptFacebookAsync();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Social login failed.");
    }
  };

  /* Social method buttons derived from platform config — only show enabled providers */
  const socialMethods = [
    ...(authConfig.allowGoogle && authConfig.googleClientId
      ? [{ key: "google", label: "Google", color: "#4285F4" }]
      : []),
    ...(authConfig.allowFacebook && authConfig.facebookAppId
      ? [{ key: "facebook", label: "Facebook", color: "#1877F2" }]
      : []),
  ];

  /* ── Guard: maintenance mode ─────────────────────────────────────────────── */
  if (platformCfg.appStatus === "maintenance") {
    return (
      <LinearGradient colors={[C.primaryDark, C.primary, C.primaryLight]} style={styles.flex}>
        <View style={[styles.centeredContainer, { paddingTop: topPad + 40 }]}>
          <View style={styles.pendingCard}>
            <View style={[styles.pendingIconWrap, { backgroundColor: "#FEF3C7" }]}>
              <Ionicons name="construct-outline" size={48} color="#D97706" />
            </View>
            <Text style={[styles.pendingTitle, { color: "#92400E" }]}>Under Maintenance</Text>
            <Text style={styles.pendingSubtitle}>
              {platformCfg.content.maintenanceMsg || "We're performing scheduled maintenance. Back soon!"}
            </Text>
            {(platformCfg.platform.supportPhone || platformCfg.platform.supportEmail) && (
              <View style={{ backgroundColor: "#F9FAFB", borderRadius: 12, padding: 14, marginTop: 16, width: "100%", borderWidth: 1, borderColor: "#E5E7EB" }}>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 11, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>Need Help?</Text>
                {platformCfg.platform.supportPhone ? <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#374151" }}>{platformCfg.platform.supportPhone}</Text> : null}
                {platformCfg.platform.supportEmail ? <Text style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>{platformCfg.platform.supportEmail}</Text> : null}
              </View>
            )}
          </View>
        </View>
      </LinearGradient>
    );
  }

  /* ── Guard: no login methods configured ─────────────────────────────────── */
  if (!authConfig.hasAnyMethod) {
    return (
      <LinearGradient colors={[C.primaryDark, C.primary, C.primaryLight]} style={styles.flex}>
        <View style={[styles.centeredContainer, { paddingTop: topPad + 40 }]}>
          <View style={styles.pendingCard}>
            <Ionicons name="lock-closed-outline" size={48} color={C.textMuted} style={{ marginBottom: 16 }} />
            <Text style={styles.pendingTitle}>Login Unavailable</Text>
            <Text style={styles.pendingSubtitle}>No login methods are currently enabled. Please contact support.</Text>
            {platformCfg.platform.supportPhone ? (
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: C.primary, marginTop: 16 }}>
                {platformCfg.platform.supportPhone}
              </Text>
            ) : null}
          </View>
        </View>
      </LinearGradient>
    );
  }

  /* ── Post-auth: 2FA TOTP step ────────────────────────────────────────────── */
  if (step === "totp") {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.flex}>
        <LinearGradient colors={[C.primaryDark, C.primary, C.primaryLight]} style={styles.flex}>
          <ScrollView contentContainerStyle={styles.scrollGrow} keyboardShouldPersistTaps="handled">
            <View style={[styles.topSection, { paddingTop: topPad + 32 }]}>
              <View style={styles.heroIcon}>
                <Ionicons name="shield-checkmark" size={36} color={C.primary} />
              </View>
              <Text style={styles.heroTitle}>Two-Factor Auth</Text>
              <Text style={styles.heroSubtitle}>
                {useBackup ? "Enter one of your backup codes" : "Enter code from your authenticator app"}
              </Text>
            </View>

            <View style={styles.card}>
              {!useBackup ? (
                /* OtpInput from @workspace/auth-react — Metro resolves to OtpInput.native.tsx */
                <OtpInput
                  value={totpCode}
                  onChangeText={(v: string) => { setTotpCode(v); clearError(); }}
                  hasError={!!error}
                  onComplete={handleTotpVerify}
                />
              ) : (
                <InputField
                  value={backupCode}
                  onChangeText={v => { setBackupCode(v); clearError(); }}
                  placeholder="Enter backup code"
                  autoCapitalize="none"
                  autoFocus
                />
              )}

              <TouchableOpacity activeOpacity={0.7}
                onPress={() => setTrustDevice(!trustDevice)}
                style={styles.trustRow}
                accessibilityLabel="Trust this device for 30 days"
                accessibilityRole="checkbox"
                accessibilityState={{ checked: trustDevice }}
              >
                <View style={[styles.checkbox, trustDevice && styles.checkboxChecked]}>
                  {trustDevice && <Ionicons name="checkmark" size={13} color="#fff" />}
                </View>
                <Text style={styles.trustText}>Trust this device for 30 days</Text>
              </TouchableOpacity>

              {error ? <AlertBox type="error" message={error} /> : null}

              <AuthButton
                label="Verify"
                onPress={useBackup ? () => handleTotpBackup(backupCode) : handleTotpVerify}
                loading={loading}
              />

              <TouchableOpacity activeOpacity={0.7}
                onPress={() => { setUseBackup(!useBackup); setBackupCode(""); setTotpCode(""); clearError(); }}
                style={styles.linkBtn}
                accessibilityRole="button"
              >
                <Text style={styles.linkBtnText}>
                  {useBackup ? "Use authenticator app instead" : "Lost your device? Use backup code"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity activeOpacity={0.7}
                onPress={() => { setStep("auth"); setTotpCode(""); clearError(); }}
                style={styles.backRow}
                accessibilityRole="button"
              >
                <Ionicons name="arrow-back" size={16} color={C.primary} />
                <Text style={styles.backRowText}>{T("backToLogin")}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </LinearGradient>
      </KeyboardAvoidingView>
    );
  }

  /* ── Post-auth: pending approval step ───────────────────────────────────── */
  if (step === "pending") {
    return (
      <LinearGradient colors={[C.primaryDark, C.primary, C.primaryLight]} style={styles.flex}>
        <View style={[styles.centeredContainer, { paddingTop: topPad + 40 }]}>
          <View style={styles.pendingCard}>
            <View style={styles.pendingIconWrap}>
              <Ionicons name="time-outline" size={48} color={C.accent} />
            </View>
            <Text style={styles.pendingTitle}>{T("approvalWaiting")}</Text>
            <Text style={styles.pendingSubtitle}>{T("approvalMsg")}</Text>
            <View style={styles.pendingInfoRow}>
              <Ionicons name="information-circle-outline" size={16} color={C.textMuted} />
              <Text style={styles.pendingInfoText}>{T("approvalTimeframe")}</Text>
            </View>
            <TouchableOpacity activeOpacity={0.7}
              style={styles.backRow}
              onPress={() => setStep("auth")}
              accessibilityRole="button"
            >
              <Ionicons name="arrow-back" size={16} color={C.primary} />
              <Text style={styles.backRowText}>{T("backToLogin")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </LinearGradient>
    );
  }

  /* ── Post-auth: complete profile step ───────────────────────────────────── */
  if (step === "complete-profile") {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.flex}>
        <LinearGradient colors={[C.primaryDark, C.primary, C.primaryLight]} style={styles.flex}>
          <ScrollView contentContainerStyle={styles.scrollGrow} keyboardShouldPersistTaps="handled">
            <View style={[styles.topSection, { paddingTop: topPad + 32 }]}>
              <View style={styles.heroIcon}>
                <Ionicons name="person" size={36} color={C.primary} />
              </View>
              <Text style={styles.heroTitle}>{T("completeProfileLabel")}</Text>
              <Text style={styles.heroSubtitle}>{T("almostDone")}</Text>
            </View>

            <View style={styles.card}>
              <InputField
                label={T("yourNameRequired")}
                value={profileName}
                onChangeText={v => { setProfileName(v); clearError(); }}
                placeholder="Enter your full name"
                autoFocus
                error={!!error && profileName.trim().length < 2}
              />
              <InputField
                label={T("emailOptional")}
                value={profileEmail}
                onChangeText={v => { setProfileEmail(v); clearError(); }}
                placeholder="email@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <InputField
                label={T("usernameOptional")}
                value={profileUsername}
                onChangeText={v => { setProfileUsername(v.toLowerCase().replace(/[^a-z0-9_]/g, "")); clearError(); }}
                placeholder="e.g. ali_ahmed123"
                autoCapitalize="none"
              />
              <InputField
                label={T("passwordOptional")}
                value={profilePassword}
                onChangeText={v => { setProfilePassword(v); clearError(); }}
                placeholder="Min 8 characters"
                secureTextEntry={!showProfilePwd}
                rightIcon={showProfilePwd ? "eye-off-outline" : "eye-outline"}
                onRightIconPress={() => setShowProfilePwd(v => !v)}
              />

              {error ? <AlertBox type="error" message={error} /> : null}

              <AuthButton label={T("saveAndContinue")} onPress={handleCompleteProfile} loading={loading} />

              <TouchableOpacity activeOpacity={0.7}
                onPress={async () => {
                  if (pendingToken && pendingUser) {
                    await login(pendingUser, pendingToken, pendingRefreshToken);
                    await navigateAfterLogin(pendingUser);
                  } else { setStep("auth"); setPendingToken(""); }
                }}
                style={styles.linkBtn}
                accessibilityRole="button"
              >
                <Text style={styles.linkBtnText}>{T("doLater")}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </LinearGradient>
      </KeyboardAvoidingView>
    );
  }

  /* ── Main auth step: rendered by LoginScreen from @workspace/auth-react ─── */
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.flex}>
      <LinearGradient
        colors={[C.primaryDark, C.primary, C.primaryLight]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.flex}
      >
        {router.canGoBack() && (
          <TouchableOpacity activeOpacity={0.7}
            onPress={() => router.back()}
            style={[styles.backToHome, { top: topPad + 12 }]}
            accessibilityRole="button"
            accessibilityLabel="Back to home"
          >
            <Ionicons name="arrow-back" size={16} color="rgba(255,255,255,0.9)" />
            <Text style={styles.backToHomeTxt}>Back</Text>
          </TouchableOpacity>
        )}

        {/* LoginScreen from @workspace/auth-react — Metro auto-resolves to
            lib/auth-react/src/components/LoginScreen.native.tsx for Expo builds.
            It renders the identifier → method → OTP / password auth flow using
            React Native primitives (no HTML). onSuccess delegates post-auth routing
            (2FA, pending, complete-profile) back to this wrapper's handleLoginResult. */}
        <LoginScreen
          baseURL={API.replace("/api", "")}
          role="customer"
          title={appName}
          subtitle={appTagline}
          onSuccess={handleLoginResult}
          onRegisterPress={() => router.push("/auth/register")}
          enableBiometric={showBiometric}
          onBiometricPress={handleBiometricLogin}
          biometricLoading={biometricLoading}
          /* Social login — provider list and handler both live here so LoginScreen
             stays clean of OAuth/deep-link dependencies. force_google/force_facebook
             from check-identifier also route through onSocialPress. */
          socialMethods={socialMethods}
          onSocialPress={socialMethods.length > 0 ? handleSocialLogin : undefined}
          showMagicLink={authConfig.allowMagicLink}
          onForgotPasswordPress={() => router.push("/auth/forgot-password")}
          renderTopBanner={() => (
            <>
              {isLowBandwidth && !lowBwDismissed && (
                <View style={styles.lowBwBanner}>
                  <Ionicons name="wifi-outline" size={16} color="#D97706" />
                  <Text style={styles.lowBwText}>
                    Slow connection detected. Sign-in may take longer than usual.
                  </Text>
                  <TouchableOpacity onPress={() => setLowBwDismissed(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="Dismiss slow connection notice">
                    <Ionicons name="close" size={16} color="#D97706" />
                  </TouchableOpacity>
                </View>
              )}
              {otpBypassActive && (
                <View style={styles.bypassBanner}>
                  <Ionicons name="information-circle" size={16} color={C.primary} />
                  <Text style={styles.bypassBannerText}>
                    {otpBypassMessage || "No OTP required right now — enter any 6 digits to continue."}
                  </Text>
                </View>
              )}
            </>
          )}
          onTncPress={platformCfg.content.tncUrl ? () => Linking.openURL(platformCfg.content.tncUrl) : undefined}
          onPrivacyPress={platformCfg.content.privacyUrl ? () => Linking.openURL(platformCfg.content.privacyUrl) : undefined}
          footerText={T("termsAgreement")}
        />
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollGrow: { flexGrow: 1 },

  topSection: { alignItems: "center", paddingBottom: spacing.xxxl },
  heroIcon: {
    width: 76, height: 76, borderRadius: radii.xxl,
    backgroundColor: "#fff", alignItems: "center", justifyContent: "center",
    ...shadows.lg, marginBottom: 14,
  },
  heroTitle: { fontFamily: "Inter_700Bold", fontSize: 30, color: "#fff", marginBottom: 6, textAlign: "center" },
  heroSubtitle: { ...typography.body, color: "rgba(255,255,255,0.85)", textAlign: "center", paddingHorizontal: spacing.xl },

  card: { backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.xxl, paddingBottom: 40, flex: 1 },

  centeredContainer: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xxl },
  pendingCard: { backgroundColor: C.surface, borderRadius: radii.xxl, padding: 28, alignItems: "center", width: "100%", ...shadows.lg },
  pendingIconWrap: { width: 84, height: 84, borderRadius: 42, backgroundColor: C.accentSoft, alignItems: "center", justifyContent: "center", marginBottom: 20 },
  pendingTitle: { ...typography.h2, color: C.text, marginBottom: 12, textAlign: "center" },
  pendingSubtitle: { ...typography.body, color: C.textMuted, textAlign: "center", marginBottom: 20, lineHeight: 22 },
  pendingInfoRow: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.surfaceSecondary, borderRadius: radii.md, padding: 12, marginBottom: 24, width: "100%" },
  pendingInfoText: { ...typography.caption, color: C.textMuted, flex: 1 },

  trustRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: C.surfaceSecondary, borderRadius: radii.md, marginBottom: spacing.md },
  checkbox: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  checkboxChecked: { backgroundColor: C.primary, borderColor: C.primary },
  trustText: { ...typography.caption, color: C.textSecondary, flex: 1 },

  linkBtn: { alignItems: "center", marginTop: spacing.md },
  linkBtnText: { ...typography.bodyMedium, color: C.primary },
  backRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: spacing.lg },
  backRowText: { ...typography.bodyMedium, color: C.primary },

  backToHome: {
    position: "absolute",
    left: 16,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: radii.full,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  backToHomeTxt: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: "rgba(255,255,255,0.9)" },

  lowBwBanner: {
    backgroundColor: "#FEF3C7",
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  lowBwText: { fontSize: 11, color: "#92400E", fontFamily: "Inter_500Medium", flex: 1, lineHeight: 16 },
  bypassBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: C.primary + "15",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: C.primary + "33",
  },
  bypassBannerText: { ...typography.caption, color: C.primary, flex: 1, lineHeight: 18 },
});

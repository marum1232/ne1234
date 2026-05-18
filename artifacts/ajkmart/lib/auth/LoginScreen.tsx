/**
 * LoginScreen.tsx — ajkmart (Expo / React Native)
 *
 * Customer login screen wrapping the SDK LoginScreen with customer-specific
 * auth flow, theme tokens, and app status.
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { router } from "expo-router";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { LoginScreen as SDKLoginScreen } from "@workspace/auth-react";
import type { AuthUser as SDKAuthUser } from "@workspace/auth-react";
import { useAuth } from "./useAuth";
import { useAppStatus } from "./useAppStatus";
import { useTheme } from "./ThemeContext";
import { useAuth as useAuthContext } from "@/context/AuthContext";
import { usePlatformConfig } from "@/context/PlatformConfigContext";
import { useAuthConfig } from "@/context/AuthConfigContext";
import { useLanguage } from "@/context/LanguageContext";
import { tDual, type TranslationKey } from "@workspace/i18n";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import { MaintenanceOverlay, PendingOverlay, RejectedOverlay } from "./Overlay";

const BIOMETRIC_ENABLED_KEY = "@ajkmart_biometric_enabled";

export interface LoginScreenProps {
  onSuccess?: (token: string, profile: SDKAuthUser) => void;
}

export function LoginScreen({ onSuccess }: LoginScreenProps) {
  const { sendOtp, verifyOtp, loginWithPassword, login: appLogin } = useAuth();
  const { maintenance, maintenanceMsg, supportPhone, supportEmail } = useAppStatus();
  const theme = useTheme();
  const { login } = useAuthContext();
  const { config } = usePlatformConfig();
  const auth = useAuthConfig();
  const { language } = useLanguage();
  const T = (k: TranslationKey) => tDual(k, language);

  const [overlay, setOverlay] = useState<"pending" | "rejected" | "biometric" | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricError, setBiometricError] = useState<string | null>(null);

  /* ── Persist token/user across biometric prompt ── */
  const pendingTokenRef = useRef<string>("");
  const pendingUserRef = useRef<SDKAuthUser | null>(null);

  /* ── Check biometric enrollment flag and hardware availability ── */
  useEffect(() => {
    const check = async () => {
      try {
        const stored = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);
        if (stored !== "true") { setBiometricEnabled(false); return; }
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        setBiometricEnabled(enrolled);
        if (!enrolled) await AsyncStorage.removeItem(BIOMETRIC_ENABLED_KEY);
      } catch { setBiometricEnabled(false); }
    };
    check();
  }, []);

  const completeLogin = useCallback((token: string, user: SDKAuthUser) => {
    /* AuthContext.login signature: (user: AppUser, token: string, refreshToken?) */
    login(user as never, token);
    onSuccess?.(token, user);
    router.replace("/(tabs)");
  }, [login, onSuccess]);

  const handleSuccess = useCallback(async (sdkUser: SDKAuthUser, token: string) => {
    const u = sdkUser as unknown as Record<string, unknown>;
    const approvalStatus = u.approvalStatus as string | undefined;
    const rejReason = u.rejectionReason as string | null | undefined;

    if (approvalStatus === "pending") { setOverlay("pending"); return; }
    if (approvalStatus === "rejected") { setRejectionReason(rejReason ?? null); setOverlay("rejected"); return; }

    /* ── STEP-UP: biometric already enrolled — verify before completing login ── */
    if (biometricEnabled && Platform.OS !== "web") {
      let stepUpPassed = false;
      try {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: "Confirm it's you to log in",
          fallbackLabel: "Use password",
          cancelLabel: "Cancel",
          disableDeviceFallback: false,
        });
        stepUpPassed = result.success;
      } catch {
        /* authenticateAsync not available — treat as passed so login isn't bricked */
        stepUpPassed = true;
      }
      if (!stepUpPassed) {
        /* Step-up failed or cancelled — BLOCK login entirely.
           Do NOT store the pending token or show the enrollment overlay.
           The user must go back and re-enter their credentials. */
        setBiometricError("Biometric verification failed. Please log in again to continue.");
        return;
      }
      completeLogin(token, sdkUser);
      return;
    }

    /* ── ENROLL: first-time login — offer to enroll biometrics ── */
    if (!biometricEnabled && Platform.OS !== "web") {
      pendingTokenRef.current = token;
      pendingUserRef.current = sdkUser;
      setOverlay("biometric");
      return;
    }

    completeLogin(token, sdkUser);
  }, [biometricEnabled, completeLogin]);

  const confirmBiometric = async (enable: boolean) => {
    if (!pendingTokenRef.current || !pendingUserRef.current) {
      setOverlay(null);
      return;
    }
    if (enable) {
      try {
        const isAvailable = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();
        if (isAvailable && isEnrolled) {
          await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, "true");
          setBiometricEnabled(true);
        }
      } catch { /* biometric setup failed — proceed without it */ }
    }
    setOverlay(null);
    completeLogin(pendingTokenRef.current, pendingUserRef.current);
  };

  const handleGoogle = useCallback(async () => {
    /* Google OAuth handled by SDK for mobile */
  }, []);

  const handleFacebook = useCallback(async () => {
    /* Facebook OAuth handled by SDK for mobile */
  }, []);

  const handleMagicLink = useCallback(async (identifier: string) => {
    /* Magic link handled by SDK */
  }, []);

  /* ── Overlays ── */
  if (maintenance) {
    return <MaintenanceOverlay message={maintenanceMsg} supportPhone={supportPhone} supportEmail={supportEmail} />;
  }
  if (overlay === "pending") return <PendingOverlay onBack={() => setOverlay(null)} />;
  if (overlay === "rejected") return <RejectedOverlay reason={rejectionReason} onBack={() => { setOverlay(null); setRejectionReason(null); }} />;
  if (overlay === "biometric") return <BiometricPromptOverlay onAccept={() => void confirmBiometric(true)} onDecline={() => void confirmBiometric(false)} />;

  /* ── Main login ── */
  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {biometricError && (
        <View style={{ padding: 14, backgroundColor: "#fee2e2", borderBottomWidth: 1, borderBottomColor: "#fca5a5" }}>
          <Text style={{ color: "#b91c1c", fontSize: 13, textAlign: "center" }}>{biometricError}</Text>
        </View>
      )}
      <SDKLoginScreen
        role="customer"
        onSuccess={(user, token) => { setBiometricError(null); void handleSuccess(user, token); }}
        onRegisterPress={() => router.push("/auth/register")}
        enableSocial={auth.googleEnabled || auth.facebookEnabled}
        onGoogle={auth.googleEnabled ? handleGoogle : undefined}
        onFacebook={auth.facebookEnabled ? handleFacebook : undefined}
        enableMagicLink={auth.magicLinkEnabled}
        onMagicLink={auth.magicLinkEnabled ? handleMagicLink : undefined}
        title={T("loginTitle") as string}
      />
    </View>
  );
}

/* ── Biometric Prompt (React Native style) ── */
function BiometricPromptOverlay({ onAccept, onDecline }: { onAccept: () => void; onDecline: () => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.overlay, { backgroundColor: theme.background }]}>
      <View style={[styles.card, { borderColor: theme.border }]}>
        <Text style={{ fontSize: 36, marginBottom: 12 }}>🔐</Text>
        <Text style={[styles.cardTitle, { color: theme.text }]}>Enable Quick Login?</Text>
        <Text style={[styles.cardBody, { color: theme.textMuted }]}>
          Use Face ID or fingerprint to sign in faster next time.
        </Text>
        <TouchableOpacity style={[styles.btn, { backgroundColor: theme.primary }]} onPress={onAccept} activeOpacity={0.85}>
          <Text style={[styles.btnText, { color: theme.surface }]}>Enable</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btnSecondary, { borderColor: theme.border }]} onPress={onDecline} activeOpacity={0.7}>
          <Text style={[styles.btnSecondaryText, { color: theme.textMuted }]}>Skip for now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  card: {
    width: "100%", maxWidth: 380,
    borderRadius: 20, borderWidth: 1, padding: 28, alignItems: "center",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 20, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 4 },
    }),
  },
  cardTitle: { fontSize: 22, fontWeight: "800", marginBottom: 10, textAlign: "center" },
  cardBody: { fontSize: 14, lineHeight: 22, textAlign: "center", marginBottom: 24 },
  btn: {
    width: "100%", borderRadius: 12, paddingVertical: 13,
    alignItems: "center", marginBottom: 10,
  },
  btnText: { fontSize: 15, fontWeight: "700" },
  btnSecondary: {
    width: "100%", borderRadius: 12, paddingVertical: 11,
    alignItems: "center", borderWidth: 1,
  },
  btnSecondaryText: { fontSize: 14, fontWeight: "500" },
});

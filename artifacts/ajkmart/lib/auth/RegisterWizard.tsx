/**
 * RegisterWizard.tsx — ajkmart (customer)
 *
 * Multi-step registration wizard for customers:
 *   Phone → OTP → Full Name → City → Password → Done
 *
 * Wraps @workspace/auth-react RegisterScreen with customer-specific
 * step configuration, API wiring, and theme tokens.
 * Uses AsyncStorage for form drafts (React Native compatible).
 */
import React, { useState, useEffect, useCallback } from "react";
import { router } from "expo-router";
import { RegisterScreen } from "@workspace/auth-react";
import type { StepConfig, StepComponentProps } from "@workspace/auth-react";
import { useTheme } from "./ThemeContext";
import { useAuth } from "./useAuth";
import { useAuth as useAuthContext } from "@/context/AuthContext";
import { usePlatformConfig } from "@/context/PlatformConfigContext";
import { useAuthConfig } from "@/context/AuthConfigContext";
import { useLanguage } from "@/context/LanguageContext";
import { tDual, type TranslationKey } from "@workspace/i18n";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Platform,
} from "react-native";

const DRAFT_KEY = "@ajkmart_reg_draft";

const PAKISTAN_CITIES = [
  "Muzaffarabad", "Mirpur", "Rawalakot", "Kotli", "Bagh", "Bhimber",
  "Islamabad", "Rawalpindi", "Lahore", "Karachi", "Peshawar", "Quetta",
  "Faisalabad", "Multan", "Sialkot", "Gujranwala", "Hyderabad",
  "Abbottabad", "Bahawalpur", "Sargodha", "Sukkur", "Mardan",
  "Mansehra", "Gilgit", "Skardu",
];

/* ── Step 1: Phone ───────────────────────────────────────────────────────── */
function PhoneStep({ data, onChange, onError }: StepComponentProps) {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const theme = useTheme();

  return (
    <View style={{ gap: 14 }}>
      <Text style={[styles.stepTitle, { color: theme.text }]}>{T("enterPhone")}</Text>
      <Text style={[styles.stepBody, { color: theme.textMuted }]}>{T("weWillSendOtp")}</Text>
      <TextInput
        style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.surface }]}
        value={(data.phone as string) ?? ""}
        onChangeText={v => { onChange("phone", v); onError(""); }}
        placeholder="03XXXXXXXXX"
        placeholderTextColor={theme.textMuted}
        keyboardType="phone-pad"
        maxLength={11}
      />
    </View>
  );
}

/* ── Step 2: OTP ─────────────────────────────────────────────────────────── */
function OtpStep({ data, onChange, onError, onComplete }: StepComponentProps & { onComplete?: (otp: string) => void }) {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const theme = useTheme();
  const [otp, setOtp] = useState("");

  return (
    <View style={{ gap: 14, alignItems: "center" }}>
      <Text style={[styles.stepTitle, { color: theme.text }]}>{T("verifyPhone")}</Text>
      <Text style={[styles.stepBody, { color: theme.textMuted, textAlign: "center" }]}>
        {T("enterOtpSentTo")} <Text style={{ fontWeight: "700", color: theme.text }}>{(data.phone as string) ?? ""}</Text>
      </Text>
      <View style={{ flexDirection: "row", gap: 8, marginVertical: 12 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <TextInput key={i} style={[styles.otpBox, { borderColor: theme.border, color: theme.text }]} value={otp[i] ?? ""}
            onChangeText={v => {
              const digits = v.replace(/\D/g, "");
              const next = otp.slice(0, i) + digits + otp.slice(i + 1);
              setOtp(next.slice(0, 6));
              onChange("otp", next.slice(0, 6));
              onError("");
              if (next.length === 6) onComplete?.(next);
            }}
            keyboardType="number-pad" maxLength={1} textAlign="center"
          />
        ))}
      </View>
      <Text style={{ color: theme.textMuted, fontSize: 12 }}>
        {T("didntReceive")} <Text style={{ color: theme.primary, fontWeight: "700" }}>{T("resend")}</Text>
      </Text>
    </View>
  );
}

/* ── Step 3: Full Name ────────────────────────────────────────────── */
function NameStep({ data, onChange, onError }: StepComponentProps) {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const theme = useTheme();

  return (
    <View style={{ gap: 14 }}>
      <Text style={[styles.stepTitle, { color: theme.text }]}>{T("whatsYourName")}</Text>
      <Text style={[styles.stepBody, { color: theme.textMuted }]}>{T("helpUsPersonalize")}</Text>
      <TextInput
        style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.surface }]}
        value={(data.name as string) ?? ""}
        onChangeText={v => { onChange("name", v); onError(""); }}
        placeholder="Muhammad Ali"
        placeholderTextColor={theme.textMuted}
      />
    </View>
  );
}

/* ── Step 4: City ─────────────────────────────────────────────────────────── */
function CityStep({ data, onChange, onError }: StepComponentProps) {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const theme = useTheme();

  return (
    <View style={{ gap: 14 }}>
      <Text style={[styles.stepTitle, { color: theme.text }]}>{T("selectYourCity")}</Text>
      <Text style={[styles.stepBody, { color: theme.textMuted }]}>{T("chooseDeliveryCity")}</Text>
      <View style={{ gap: 8 }}>
        {PAKISTAN_CITIES.slice(0, 8).map(city => (
          <TouchableOpacity key={city}
            style={[styles.cityBtn, { borderColor: data.city === city ? theme.primary : theme.border, backgroundColor: data.city === city ? `${theme.primary}12` : theme.surface }]}
            onPress={() => { onChange("city", city); onError(""); }}
            activeOpacity={0.8}
          >
            <Text style={{ color: data.city === city ? theme.primary : theme.text, fontWeight: data.city === city ? "700" : "500", fontSize: 14 }}>{city}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

/* ── Step 5: Password ──────────────────────────────────────────────────────── */
function PasswordStep({ data, onChange, onError }: StepComponentProps) {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const theme = useTheme();

  return (
    <View style={{ gap: 14 }}>
      <Text style={[styles.stepTitle, { color: theme.text }]}>{T("createPassword")}</Text>
      <Text style={[styles.stepBody, { color: theme.textMuted }]}>{T("secureYourAccount")}</Text>
      <TextInput
        style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.surface }]}
        value={(data.password as string) ?? ""}
        onChangeText={v => { onChange("password", v); onError(""); }}
        placeholder="Min 8 characters"
        placeholderTextColor={theme.textMuted}
        secureTextEntry
      />
      <TextInput
        style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.surface }]}
        value={(data.confirmPassword as string) ?? ""}
        onChangeText={v => { onChange("confirmPassword", v); onError(""); }}
        placeholder="Re-enter password"
        placeholderTextColor={theme.textMuted}
        secureTextEntry
      />
    </View>
  );
}

/* ── Step 6: Success ──────────────────────────────────────────────────────── */
function SuccessStep() {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const theme = useTheme();

  return (
    <View style={{ alignItems: "center", paddingVertical: 24 }}>
      <View style={[styles.successCircle, { backgroundColor: `${theme.primary}18`, borderColor: `${theme.primary}40` }]}>
        <Text style={{ fontSize: 40 }}>🎉</Text>
      </View>
      <Text style={[styles.stepTitle, { color: theme.text, marginTop: 16 }]}>{T("welcomeAboard")}</Text>
      <Text style={[styles.stepBody, { color: theme.textMuted, textAlign: "center" }]}>{T("startShoppingNow")}</Text>
    </View>
  );
}

const STEPS: StepConfig[] = [
  { id: "phone", title: "Phone", component: PhoneStep },
  { id: "otp", title: "Verify", component: OtpStep },
  { id: "name", title: "Name", component: NameStep },
  { id: "city", title: "City", component: CityStep },
  { id: "password", title: "Password", component: PasswordStep },
  { id: "success", title: "Done", component: SuccessStep },
];

export interface RegisterWizardProps {
  onDone?: () => void;
}

export function RegisterWizard({ onDone }: RegisterWizardProps) {
  const theme = useTheme();
  const { sendOtp, verifyOtp } = useAuth();
  const { login } = useAuthContext();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);

  const [draft, setDraft] = useState<Record<string, unknown>>({});

  useEffect(() => {
    AsyncStorage.getItem(DRAFT_KEY).then(raw => {
      if (raw) setDraft(JSON.parse(raw));
    }).catch(() => {});
  }, []);

  const handleDataChange = useCallback((key: string, value: unknown) => {
    setDraft(prev => { const next = { ...prev, [key]: value }; AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(next)).catch(() => {}); return next; });
  }, []);

  const handleOtpRequest = async (phone: string) => {
    const result = await sendOtp(phone);
    return result.success;
  };

  const handleSubmit = async (data: Record<string, unknown>) => {
    try {
      const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN ?? ""}/api`;
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          phone: data.phone,
          city: data.city,
          password: data.password,
          role: "customer",
        }),
      });
      const json = await res.json() as Record<string, unknown>;
      if (!res.ok) throw new Error(json.message as string ?? "Registration failed");
      await AsyncStorage.removeItem(DRAFT_KEY);
      return { success: true, data: json };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : T("registrationFailed") };
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <RegisterScreen
        role="customer"
        steps={STEPS}
        initialData={draft}
        onDataChange={handleDataChange}
        onOtpRequest={handleOtpRequest}
        onSubmit={handleSubmit}
        onDone={() => { onDone?.(); router.replace("/(tabs)"); }}
        title={T("customerRegistration") as string}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  stepTitle: { fontSize: 22, fontWeight: "800", marginBottom: 4 },
  stepBody: { fontSize: 14, lineHeight: 22, marginBottom: 8 },
  input: {
    width: "100%", height: 52, borderWidth: 1, borderRadius: 14,
    paddingHorizontal: 16, fontSize: 16,
  },
  otpBox: {
    width: 48, height: 56, borderWidth: 1, borderRadius: 12,
    fontSize: 20, fontWeight: "700", textAlign: "center",
  },
  cityBtn: {
    borderWidth: 1, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16,
  },
  successCircle: {
    width: 88, height: 88, borderRadius: 44, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
});

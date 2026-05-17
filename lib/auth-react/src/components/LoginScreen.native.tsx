import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
  Animated,
} from 'react-native';

import { OtpInput } from './OtpInput.native';
import { PhoneInput } from './PhoneInput.native';

export type AppRole = 'customer' | 'vendor' | 'rider' | 'admin';

export interface LoginScreenProps {
  role?: AppRole;
  baseURL?: string;
  onSuccess?: (result: Record<string, unknown>) => void | Promise<void>;
  onRegisterPress?: () => void;
  enableBiometric?: boolean;
  onBiometricPress?: () => void;
  biometricLoading?: boolean;
  renderTopBanner?: () => React.ReactNode;
  title?: string;
  subtitle?: string;
  tncUrl?: string;
  privacyUrl?: string;
  onTncPress?: () => void;
  onPrivacyPress?: () => void;
  footerText?: string;
  enabledMethods?: string[];
  showMagicLink?: boolean;
}

type InternalStep =
  | 'identifier'
  | 'phone-send'
  | 'phone-otp'
  | 'email-send'
  | 'email-otp'
  | 'password'
  | 'magic';

async function apiPost(
  baseURL: string,
  path: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>
): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseURL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const msg =
      (json.message as string) ??
      (json.error as string) ??
      `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return (json.data as Record<string, unknown>) ?? json;
}

export function LoginScreen({
  role = 'customer',
  baseURL = '',
  onSuccess,
  onRegisterPress,
  enableBiometric = false,
  onBiometricPress,
  biometricLoading = false,
  renderTopBanner,
  title = 'Sign In',
  subtitle,
  onTncPress,
  onPrivacyPress,
  footerText,
  enabledMethods,
  showMagicLink = false,
}: LoginScreenProps) {
  const [step, setStep] = useState<InternalStep>('identifier');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [identifier, setIdentifier] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [magicEmail, setMagicEmail] = useState('');
  const [magicSent, setMagicSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const fadeAnim = useRef(new Animated.Value(1)).current;

  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startCooldown(secs = 60) {
    setResendCooldown(secs);
    cooldownRef.current = setInterval(() => {
      setResendCooldown((c) => {
        if (c <= 1) {
          clearInterval(cooldownRef.current!);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

  function clearError() {
    setError('');
  }

  function goBack() {
    fadeAnim.setValue(0);
    setStep('identifier');
    setOtp('');
    setError('');
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }

  const checkIdentifier = useCallback(async () => {
    const id = identifier.trim();
    if (!id) {
      setError('Enter your phone, email, or username');
      return;
    }
    setLoading(true);
    clearError();
    try {
      const res = await apiPost(baseURL, '/api/auth/check-identifier', {
        identifier: id,
        role,
      });

      if (res.action === 'blocked' || res.isBanned) {
        setError('This account has been suspended. Please contact support.');
        return;
      }
      if (res.action === 'locked') {
        setError(
          `Account locked. Try again in ${res.lockedMinutes as number} minute(s).`
        );
        return;
      }
      if (res.action === 'registration_closed') {
        setError('New registrations are currently closed.');
        return;
      }
      if (res.action === 'no_method') {
        setError(
          'No login methods are currently available. Please contact support.'
        );
        return;
      }
      if (res.action === 'register') {
        onRegisterPress?.();
        return;
      }
      if (res.action === 'send_phone_otp') {
        setPhone(id);
        setStep('phone-send');
        await sendPhoneOtp(id);
        return;
      }
      if (res.action === 'send_email_otp') {
        setEmail(id);
        setStep('email-send');
        await sendEmailOtp(id);
        return;
      }
      if (
        res.action === 'login_password' ||
        res.action === 'send_magic_link'
      ) {
        setUsername(id);
        setStep(res.action === 'send_magic_link' ? 'magic' : 'password');
        return;
      }
      setUsername(id);
      setStep('password');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check failed. Try again.');
    } finally {
      setLoading(false);
    }
  }, [identifier, baseURL, role, onRegisterPress]);

  async function sendPhoneOtp(phoneVal: string) {
    setLoading(true);
    clearError();
    try {
      const res = await apiPost(baseURL, '/api/auth/send-otp', {
        phone: phoneVal,
      });
      if (res.otpRequired === false && res.token) {
        await onSuccess?.(res);
        return;
      }
      startCooldown(60);
      setStep('phone-otp');
      setOtp('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send OTP.');
      setStep('identifier');
    } finally {
      setLoading(false);
    }
  }

  async function sendEmailOtp(emailVal: string) {
    setLoading(true);
    clearError();
    try {
      const res = await apiPost(baseURL, '/api/auth/send-email-otp', {
        email: emailVal,
      });
      if (res.otpRequired === false && res.token) {
        await onSuccess?.(res);
        return;
      }
      startCooldown(60);
      setStep('email-otp');
      setOtp('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send OTP.');
      setStep('identifier');
    } finally {
      setLoading(false);
    }
  }

  async function verifyPhoneOtp() {
    if (!otp || otp.length < 6) {
      setError('Enter the 6-digit code');
      return;
    }
    setLoading(true);
    clearError();
    try {
      const res = await apiPost(
        baseURL,
        '/api/auth/verify-otp',
        { phone, otp },
        { 'X-App-Id': role }
      );
      await onSuccess?.(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid OTP.');
    } finally {
      setLoading(false);
    }
  }

  async function verifyEmailOtp() {
    if (!otp || otp.length < 6) {
      setError('Enter the 6-digit code');
      return;
    }
    setLoading(true);
    clearError();
    try {
      const res = await apiPost(
        baseURL,
        '/api/auth/verify-email-otp',
        { email, otp },
        { 'X-App-Id': role }
      );
      await onSuccess?.(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid OTP.');
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordLogin() {
    if (!password || password.length < 6) {
      setError('Enter your password');
      return;
    }
    setLoading(true);
    clearError();
    try {
      const res = await apiPost(baseURL, '/api/auth/login', {
        identifier: username,
        password,
      });
      await onSuccess?.(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid credentials.');
    } finally {
      setLoading(false);
    }
  }

  async function handleMagicLink() {
    const addr = magicEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      setError('Enter a valid email address');
      return;
    }
    setLoading(true);
    clearError();
    try {
      await apiPost(baseURL, '/api/auth/magic-link/send', { email: addr });
      setMagicSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send magic link.');
    } finally {
      setLoading(false);
    }
  }

  const isOtpStep = step === 'phone-otp' || step === 'email-otp';
  const otpOnResend = step === 'phone-otp'
    ? () => sendPhoneOtp(phone)
    : () => sendEmailOtp(email);
  const otpOnVerify = step === 'phone-otp' ? verifyPhoneOtp : verifyEmailOtp;
  const otpSubtitle =
    step === 'phone-otp' ? `Code sent to ${phone}` : `Code sent to ${email}`;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {title ? (
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? (
              <Text style={styles.subtitle}>{subtitle}</Text>
            ) : null}
          </View>
        ) : null}

        {renderTopBanner ? renderTopBanner() : null}

        <View style={styles.card}>
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {step === 'identifier' && (
            <Animated.View style={{ opacity: fadeAnim }}>
              <Text style={styles.label}>Phone, email, or username</Text>
              <TextInput
                style={styles.input}
                value={identifier}
                onChangeText={(v) => {
                  setIdentifier(v);
                  clearError();
                }}
                placeholder="+923001234567, email, or username"
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus={!enableBiometric}
                returnKeyType="go"
                onSubmitEditing={checkIdentifier}
                editable={!loading}
              />

              <Btn label="Continue" onPress={checkIdentifier} loading={loading} />

              {enableBiometric && onBiometricPress ? (
                <TouchableOpacity
                  style={styles.biometricBtn}
                  onPress={onBiometricPress}
                  disabled={biometricLoading}
                  accessibilityLabel="Login with Biometrics"
                  accessibilityRole="button"
                >
                  {biometricLoading ? (
                    <ActivityIndicator size="small" color="#f59e0b" />
                  ) : (
                    <Text style={styles.biometricBtnText}>
                      Login with Biometrics
                    </Text>
                  )}
                </TouchableOpacity>
              ) : null}

              {onRegisterPress ? (
                <TouchableOpacity
                  style={styles.linkBtn}
                  onPress={onRegisterPress}
                  accessibilityRole="link"
                >
                  <Text style={styles.linkBtnText}>
                    New user?{' '}
                    <Text style={styles.linkBtnBold}>Create account</Text>
                  </Text>
                </TouchableOpacity>
              ) : null}
            </Animated.View>
          )}

          {(step === 'phone-send' || step === 'email-send') && (
            <View style={styles.centerCol}>
              <ActivityIndicator size="large" color="#f59e0b" />
              <Text style={styles.sendingText}>Sending OTP…</Text>
            </View>
          )}

          {isOtpStep && (
            <Animated.View style={{ opacity: fadeAnim }}>
              <TouchableOpacity
                style={styles.backRow}
                onPress={goBack}
                accessibilityRole="button"
              >
                <Text style={styles.backText}>← Change identifier</Text>
              </TouchableOpacity>
              <Text style={styles.sectionTitle}>Enter verification code</Text>
              <Text style={styles.sectionSub}>{otpSubtitle}</Text>
              <OtpInput
                value={otp}
                onChangeText={(v) => {
                  setOtp(v);
                  clearError();
                }}
                hasError={!!error}
                onComplete={otpOnVerify}
                onResend={resendCooldown === 0 ? otpOnResend : undefined}
                resendCooldownSeconds={60}
              />
              <Btn
                label="Verify"
                onPress={otpOnVerify}
                loading={loading}
              />
            </Animated.View>
          )}

          {step === 'password' && (
            <Animated.View style={{ opacity: fadeAnim }}>
              <TouchableOpacity
                style={styles.backRow}
                onPress={goBack}
                accessibilityRole="button"
              >
                <Text style={styles.backText}>← Back</Text>
              </TouchableOpacity>
              <Text style={styles.sectionTitle}>Enter password</Text>
              <Text style={styles.sectionSub}>{username}</Text>
              <View style={styles.pwdRow}>
                <TextInput
                  style={[styles.input, { flex: 1, marginBottom: 0 }]}
                  value={password}
                  onChangeText={(v) => {
                    setPassword(v);
                    clearError();
                  }}
                  placeholder="Password"
                  placeholderTextColor="#9ca3af"
                  secureTextEntry={!showPwd}
                  autoFocus
                  returnKeyType="go"
                  onSubmitEditing={handlePasswordLogin}
                  editable={!loading}
                />
                <TouchableOpacity
                  style={styles.eyeBtn}
                  onPress={() => setShowPwd((v) => !v)}
                  accessibilityLabel={showPwd ? 'Hide password' : 'Show password'}
                >
                  <Text style={styles.eyeText}>{showPwd ? '🙈' : '👁'}</Text>
                </TouchableOpacity>
              </View>
              <Btn
                label="Sign In"
                onPress={handlePasswordLogin}
                loading={loading}
                style={{ marginTop: 12 }}
              />
            </Animated.View>
          )}

          {step === 'magic' && (
            <Animated.View style={{ opacity: fadeAnim }}>
              <TouchableOpacity
                style={styles.backRow}
                onPress={goBack}
                accessibilityRole="button"
              >
                <Text style={styles.backText}>← Back</Text>
              </TouchableOpacity>
              <Text style={styles.sectionTitle}>Magic Link</Text>
              <Text style={styles.sectionSub}>
                We'll send a sign-in link to your email.
              </Text>
              {!magicSent ? (
                <>
                  <TextInput
                    style={styles.input}
                    value={magicEmail}
                    onChangeText={setMagicEmail}
                    placeholder="your@email.com"
                    placeholderTextColor="#9ca3af"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoFocus
                    editable={!loading}
                  />
                  <Btn
                    label="Send Magic Link"
                    onPress={handleMagicLink}
                    loading={loading}
                  />
                </>
              ) : (
                <View style={styles.successBox}>
                  <Text style={styles.successText}>
                    Magic link sent! Check your email.
                  </Text>
                </View>
              )}
            </Animated.View>
          )}
        </View>

        {footerText || onTncPress || onPrivacyPress ? (
          <View style={styles.footer}>
            {onTncPress && (
              <TouchableOpacity onPress={onTncPress} accessibilityRole="link">
                <Text style={styles.footerLink}>Terms &amp; Conditions</Text>
              </TouchableOpacity>
            )}
            {onTncPress && onPrivacyPress ? (
              <Text style={styles.footerSep}> · </Text>
            ) : null}
            {onPrivacyPress && (
              <TouchableOpacity
                onPress={onPrivacyPress}
                accessibilityRole="link"
              >
                <Text style={styles.footerLink}>Privacy Policy</Text>
              </TouchableOpacity>
            )}
            {footerText && !onTncPress && !onPrivacyPress ? (
              <Text style={styles.footerText}>{footerText}</Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Btn({
  label,
  onPress,
  loading,
  style,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  style?: object;
}) {
  return (
    <TouchableOpacity
      style={[styles.primaryBtn, loading && styles.primaryBtnDisabled, style]}
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <Text style={styles.primaryBtnText}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

const C = {
  primary: '#f59e0b',
  surface: '#fff',
  border: '#e5e7eb',
  text: '#111827',
  textMuted: '#6b7280',
  error: '#ef4444',
  success: '#10b981',
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: 32 },
  header: { alignItems: 'center', paddingTop: 32, paddingBottom: 24, paddingHorizontal: 24 },
  title: { fontSize: 28, fontWeight: '700', color: '#fff', textAlign: 'center' },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.85)', marginTop: 6, textAlign: 'center' },
  card: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    flex: 1,
    padding: 24,
    paddingBottom: 40,
  },
  label: { fontSize: 13, fontWeight: '500', color: C.textMuted, marginBottom: 8 },
  input: {
    borderWidth: 1.5,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: C.text,
    backgroundColor: '#f9fafb',
    marginBottom: 12,
  },
  pwdRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 0 },
  eyeBtn: { padding: 10 },
  eyeText: { fontSize: 18 },
  primaryBtn: {
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
  primaryBtnDisabled: { opacity: 0.7 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  biometricBtn: {
    borderWidth: 1.5,
    borderColor: C.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
    backgroundColor: `${C.primary}12`,
  },
  biometricBtnText: { color: C.primary, fontSize: 15, fontWeight: '600' },
  linkBtn: { alignItems: 'center', marginTop: 12, paddingVertical: 6 },
  linkBtnText: { fontSize: 14, color: C.textMuted },
  linkBtnBold: { fontWeight: '700', color: C.primary },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  errorText: { color: C.error, fontSize: 13, fontWeight: '500' },
  successBox: {
    backgroundColor: '#f0fdf4',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  successText: { color: C.success, fontSize: 14, fontWeight: '600' },
  backRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  backText: { fontSize: 14, fontWeight: '600', color: C.primary },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: C.text, marginBottom: 4 },
  sectionSub: { fontSize: 13, color: C.textMuted, marginBottom: 16 },
  centerCol: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, gap: 16 },
  sendingText: { fontSize: 14, color: C.textMuted },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
    flexWrap: 'wrap',
    gap: 4,
  },
  footerLink: { fontSize: 12, color: C.primary, textDecorationLine: 'underline' },
  footerSep: { fontSize: 12, color: C.textMuted },
  footerText: { fontSize: 12, color: C.textMuted, textAlign: 'center' },
});

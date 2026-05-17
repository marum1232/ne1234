import React, { useState, useEffect, type FormEvent } from 'react';
import type { AuthUser } from '../AuthProvider';
import { useLoginFlow } from '../hooks/useLoginFlow';
import { OtpInput } from './OtpInput';
import { PasswordInput } from './PasswordInput';
import { SocialButtons } from './SocialButtons';
import { PhoneInput } from './PhoneInput';
import { BiometricPrompt } from './BiometricPrompt';
import { useAuthTheme } from '../context/ThemeContext';

export type AppRole = 'customer' | 'rider' | 'vendor' | 'admin';

export type CustomField =
  | 'vehicleType'
  | 'licenseNumber'
  | 'storeName'
  | 'cnic'
  | 'businessType';

export interface LoginScreenProps {
  role: AppRole;
  customFields?: CustomField[];
  baseURL?: string;
  onSuccess?: (user: AuthUser, token: string) => void;
  onRegisterPress?: () => void;
  enableSocial?: boolean;
  enableMagicLink?: boolean;
  enableBiometric?: boolean;
  onGoogle?: () => void;
  onFacebook?: () => void;
  onMagicLink?: (identifier: string) => void | Promise<void>;
  onBiometricSuccess?: (refreshToken: string) => void;
  className?: string;
  title?: string;
}

const ROLE_LABELS: Record<AppRole, string> = {
  customer: 'AJKMart',
  rider:    'Rider Portal',
  vendor:   'Vendor Portal',
  admin:    'Admin Panel',
};

type Step = 'identifier' | 'otp' | 'password' | 'twoFactor';

export function LoginScreen({
  role,
  customFields = [],
  baseURL = '',
  onSuccess,
  onRegisterPress,
  enableSocial = false,
  enableMagicLink = false,
  enableBiometric = false,
  onGoogle,
  onFacebook,
  onMagicLink,
  onBiometricSuccess,
  className,
  title,
}: LoginScreenProps) {
  const theme = useAuthTheme();
  const displayTitle = title ?? ROLE_LABELS[role];

  const [step, setStep] = useState<Step>('identifier');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [magicLinkLoading, setMagicLinkLoading] = useState(false);
  const [isWide, setIsWide] = useState(
    typeof window !== 'undefined' ? window.innerWidth >= 768 : false
  );

  useEffect(() => {
    function onResize() {
      setIsWide(window.innerWidth >= 768);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const { initiateLogin, verifyOtp, verifyPassword, twoFactorVerify, loading, error, twoFactorPending, clearError } =
    useLoginFlow({ baseURL, onSuccess });

  useEffect(() => {
    if (twoFactorPending) {
      setStep('twoFactor');
    }
  }, [twoFactorPending]);

  async function handleIdentifierSubmit(e: FormEvent) {
    e.preventDefault();
    if (!identifier.trim()) return;
    clearError();
    try {
      const result = await initiateLogin(identifier.trim());
      if (result.method === 'password') setStep('password');
      else setStep('otp');
    } catch {
      // error is in the hook state
    }
  }

  async function handleOtpComplete(otp: string) {
    try {
      await verifyOtp(otp);
    } catch {
      /* handled by hook */
    }
  }

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password) return;
    clearError();
    try {
      await verifyPassword(password);
    } catch {
      /* handled by hook */
    }
  }

  async function handleTwoFactor(otp: string) {
    try {
      await twoFactorVerify(otp);
    } catch {
      /* handled by hook */
    }
  }

  async function handleMagicLink() {
    if (!identifier.trim() || magicLinkLoading) return;
    setMagicLinkLoading(true);
    try {
      await onMagicLink?.(identifier.trim());
      setMagicLinkSent(true);
    } catch {
      /* caller handles errors */
    } finally {
      setMagicLinkLoading(false);
    }
  }

  const s = {
    outer: {
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'row' as const,
    },
    leftPanel: {
      display: isWide ? 'flex' : 'none',
      flexDirection: 'column' as const,
      justifyContent: 'center',
      alignItems: 'center',
      flex: '0 0 42%',
      background: `linear-gradient(135deg, ${theme.primary} 0%, ${theme.primaryDark} 100%)`,
      padding: '48px 40px',
      gap: '16px',
    },
    leftTitle: {
      fontSize: '32px',
      fontWeight: 800,
      color: theme.onPrimary,
      textAlign: 'center' as const,
      margin: 0,
    },
    leftSubtitle: {
      fontSize: '16px',
      color: theme.onPrimary,
      opacity: 0.82,
      textAlign: 'center' as const,
      margin: 0,
      lineHeight: '1.5',
    },
    rightPanel: {
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: theme.background,
      padding: '24px 16px',
    },
    card: {
      width: '100%',
      maxWidth: '400px',
      background: theme.surface,
      borderRadius: '16px',
      padding: '32px 28px',
      boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '20px',
    },
    header: { textAlign: 'center' as const },
    title: { fontSize: '22px', fontWeight: 800, color: theme.text, margin: '0 0 4px' },
    subtitle: { fontSize: '14px', color: theme.textMuted, margin: 0 },
    label: { fontSize: '13px', fontWeight: 600, color: theme.text, marginBottom: '4px', display: 'block' },
    input: {
      width: '100%',
      padding: '12px',
      border: `2px solid ${theme.border}`,
      borderRadius: '8px',
      fontSize: '15px',
      outline: 'none',
      boxSizing: 'border-box' as const,
      transition: 'border-color 0.15s',
      background: theme.background,
      color: theme.text,
    },
    select: {
      width: '100%',
      padding: '12px',
      border: `2px solid ${theme.border}`,
      borderRadius: '8px',
      fontSize: '15px',
      outline: 'none',
      boxSizing: 'border-box' as const,
      background: theme.surface,
      color: theme.text,
    },
    btnPrimary: {
      width: '100%',
      padding: '13px',
      borderRadius: '8px',
      border: 'none',
      background: theme.primary,
      color: theme.onPrimary,
      fontWeight: 700,
      fontSize: '15px',
      cursor: 'pointer',
      transition: 'opacity 0.15s',
    },
    btnDisabled: { opacity: 0.55, cursor: 'not-allowed' },
    errorBox: {
      background: theme.errorBackground,
      border: `1px solid ${theme.errorBorder}`,
      borderRadius: '8px',
      padding: '10px 12px',
      color: theme.error,
      fontSize: '13px',
    },
    link: {
      background: 'none',
      border: 'none',
      color: theme.primary,
      cursor: 'pointer',
      fontSize: '13px',
      fontWeight: 600,
      padding: '0',
      textAlign: 'center' as const,
    },
    footerRow: { textAlign: 'center' as const, fontSize: '13px', color: theme.textMuted },
    magicLinkRow: { textAlign: 'center' as const, fontSize: '13px', color: theme.textMuted, marginTop: '-8px' },
  } as const;

  function renderCustomFields() {
    return customFields.map((field) => {
      if (field === 'vehicleType') {
        return (
          <div key={field}>
            <label style={s.label}>Vehicle Type</label>
            <select
              style={s.select}
              value={customValues['vehicleType'] ?? ''}
              onChange={(e) => setCustomValues({ ...customValues, vehicleType: e.target.value })}
            >
              <option value="">Select vehicle</option>
              <option value="motorcycle">Motorcycle</option>
              <option value="car">Car</option>
              <option value="van">Van / Pickup</option>
              <option value="truck">Truck</option>
            </select>
          </div>
        );
      }
      if (field === 'licenseNumber') {
        return (
          <div key={field}>
            <label style={s.label}>License Number</label>
            <input
              style={s.input}
              type="text"
              placeholder="e.g. LHR-12345"
              value={customValues['licenseNumber'] ?? ''}
              onChange={(e) => setCustomValues({ ...customValues, licenseNumber: e.target.value })}
            />
          </div>
        );
      }
      if (field === 'storeName') {
        return (
          <div key={field}>
            <label style={s.label}>Store Name</label>
            <input
              style={s.input}
              type="text"
              placeholder="Your business name"
              value={customValues['storeName'] ?? ''}
              onChange={(e) => setCustomValues({ ...customValues, storeName: e.target.value })}
            />
          </div>
        );
      }
      if (field === 'cnic') {
        return (
          <div key={field}>
            <label style={s.label}>CNIC</label>
            <input
              style={s.input}
              type="text"
              placeholder="12345-1234567-1"
              value={customValues['cnic'] ?? ''}
              onChange={(e) => setCustomValues({ ...customValues, cnic: e.target.value })}
            />
          </div>
        );
      }
      if (field === 'businessType') {
        return (
          <div key={field}>
            <label style={s.label}>Business Type</label>
            <select
              style={s.select}
              value={customValues['businessType'] ?? ''}
              onChange={(e) => setCustomValues({ ...customValues, businessType: e.target.value })}
            >
              <option value="">Select type</option>
              <option value="retail">Retail</option>
              <option value="wholesale">Wholesale</option>
              <option value="restaurant">Restaurant / Food</option>
              <option value="pharmacy">Pharmacy</option>
              <option value="grocery">Grocery</option>
              <option value="other">Other</option>
            </select>
          </div>
        );
      }
      return null;
    });
  }

  return (
    <div style={s.outer} className={className}>
      {/* Left brand panel — visible only on wide screens */}
      <div style={s.leftPanel}>
        <p style={s.leftTitle}>{displayTitle}</p>
        <p style={s.leftSubtitle}>
          {role === 'customer' && 'Shop, eat, ride — all in one app'}
          {role === 'rider' && 'Manage deliveries and rides on the go'}
          {role === 'vendor' && 'Grow your business with AJKMart'}
          {role === 'admin' && 'Platform administration & control'}
        </p>
      </div>

      {/* Right panel — form */}
      <div style={s.rightPanel}>
        <div style={s.card}>
          {/* Header */}
          <div style={s.header}>
            <h1 style={s.title}>{displayTitle}</h1>
            <p style={s.subtitle}>
              {step === 'identifier' && 'Sign in or create an account'}
              {step === 'otp' && 'Enter the OTP sent to your number'}
              {step === 'password' && 'Enter your password'}
              {step === 'twoFactor' && 'Two-factor authentication'}
            </p>
          </div>

          {/* Error */}
          {error && <div style={s.errorBox}>{error}</div>}

          {/* Step: Identifier */}
          {step === 'identifier' && (
            <form onSubmit={(e) => void handleIdentifierSubmit(e)} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={s.label}>Phone number</label>
                <PhoneInput
                  value={identifier}
                  onChange={(e164) => { setIdentifier(e164); }}
                />
              </div>
              {renderCustomFields()}
              <button
                type="submit"
                style={{ ...s.btnPrimary, ...(loading ? s.btnDisabled : {}) }}
                disabled={loading}
              >
                {loading ? 'Checking…' : 'Continue'}
              </button>
              {enableMagicLink && onMagicLink && (
                <p style={s.magicLinkRow}>
                  {magicLinkSent ? (
                    <span>Magic link sent — check your email or SMS.</span>
                  ) : (
                    <button
                      type="button"
                      style={s.link}
                      disabled={magicLinkLoading}
                      onClick={() => void handleMagicLink()}
                    >
                      {magicLinkLoading ? 'Sending…' : 'Send magic link instead'}
                    </button>
                  )}
                </p>
              )}
              {enableBiometric && (
                <BiometricPrompt
                  onSuccess={(token) => {
                    onBiometricSuccess?.(token);
                  }}
                  onDismiss={undefined}
                  label="Sign in with biometrics"
                />
              )}
              {enableSocial && (
                <SocialButtons
                  onGoogle={onGoogle ?? (() => {})}
                  onFacebook={onFacebook ?? (() => {})}
                />
              )}
              {onRegisterPress && (
                <p style={s.footerRow}>
                  New here?{' '}
                  <button type="button" style={s.link} onClick={onRegisterPress}>
                    Create account
                  </button>
                </p>
              )}
            </form>
          )}

          {/* Step: OTP */}
          {step === 'otp' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <OtpInput
                onComplete={(otp) => void handleOtpComplete(otp)}
                onResend={() => void initiateLogin(identifier)}
                autoSubmit
              />
              <button
                type="button"
                style={s.link}
                onClick={() => { clearError(); setStep('identifier'); }}
              >
                ← Change number
              </button>
            </div>
          )}

          {/* Step: Password */}
          {step === 'password' && (
            <form onSubmit={(e) => void handlePasswordSubmit(e)} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <PasswordInput
                value={password}
                onChange={setPassword}
                label="Password"
                showStrength={false}
                autoComplete="current-password"
              />
              <button
                type="submit"
                style={{ ...s.btnPrimary, ...(loading ? s.btnDisabled : {}) }}
                disabled={loading}
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
              <button
                type="button"
                style={s.link}
                onClick={() => { clearError(); setStep('identifier'); }}
              >
                ← Back
              </button>
            </form>
          )}

          {/* Step: 2FA */}
          {step === 'twoFactor' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <OtpInput
                label="Enter your authenticator code"
                onComplete={(code) => void handleTwoFactor(code)}
                autoSubmit
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import React, { useState, type FormEvent } from 'react';
import type { AuthUser } from '../AuthProvider';
import { useLoginFlow } from '../hooks/useLoginFlow';
import { OtpInput } from './OtpInput';
import { PasswordInput } from './PasswordInput';
import { SocialButtons } from './SocialButtons';
import { PhoneInput } from './PhoneInput';

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
  className?: string;
  title?: string;
}

const ROLE_LABELS: Record<AppRole, string> = {
  customer: 'AJKMart',
  rider:    'Rider Portal',
  vendor:   'Vendor Portal',
  admin:    'Admin Panel',
};

const ROLE_ACCENT: Record<AppRole, string> = {
  customer: '#f59e0b',
  rider:    '#3b82f6',
  vendor:   '#8b5cf6',
  admin:    '#ef4444',
};

const s = {
  screen: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f9fafb',
    padding: '24px 16px',
  },
  card: {
    width: '100%',
    maxWidth: '400px',
    background: '#fff',
    borderRadius: '16px',
    padding: '32px 28px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '20px',
  },
  header: { textAlign: 'center' as const },
  title: { fontSize: '22px', fontWeight: 800, color: '#111827', margin: '0 0 4px' },
  subtitle: { fontSize: '14px', color: '#6b7280', margin: 0 },
  label: { fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '4px', display: 'block' },
  input: {
    width: '100%',
    padding: '12px',
    border: '2px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '15px',
    outline: 'none',
    boxSizing: 'border-box' as const,
    transition: 'border-color 0.15s',
  },
  select: {
    width: '100%',
    padding: '12px',
    border: '2px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '15px',
    outline: 'none',
    boxSizing: 'border-box' as const,
    background: '#fff',
  },
  btnPrimary: (accent: string) => ({
    width: '100%',
    padding: '13px',
    borderRadius: '8px',
    border: 'none',
    background: accent,
    color: '#fff',
    fontWeight: 700,
    fontSize: '15px',
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  }),
  btnDisabled: { opacity: 0.55, cursor: 'not-allowed' },
  errorBox: {
    background: '#fef2f2',
    border: '1px solid #fca5a5',
    borderRadius: '8px',
    padding: '10px 12px',
    color: '#b91c1c',
    fontSize: '13px',
  },
  link: (accent: string) => ({
    background: 'none',
    border: 'none',
    color: accent,
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
    padding: '0',
    textAlign: 'center' as const,
  }),
  footerRow: { textAlign: 'center' as const, fontSize: '13px', color: '#6b7280' },
};

type Step = 'identifier' | 'otp' | 'password' | 'twoFactor';

export function LoginScreen({
  role,
  customFields = [],
  baseURL = '',
  onSuccess,
  onRegisterPress,
  enableSocial = false,
  enableMagicLink: _enableMagicLink = false,
  className,
  title,
}: LoginScreenProps) {
  const accent = ROLE_ACCENT[role];
  const displayTitle = title ?? ROLE_LABELS[role];

  const [step, setStep] = useState<Step>('identifier');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [customValues, setCustomValues] = useState<Record<string, string>>({});

  const { initiateLogin, verifyOtp, verifyPassword, twoFactorVerify, loading, error, clearError } =
    useLoginFlow({ baseURL, onSuccess });

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
      return null;
    });
  }

  return (
    <div style={s.screen} className={className}>
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
              style={{ ...s.btnPrimary(accent), ...(loading ? s.btnDisabled : {}) }}
              disabled={loading}
            >
              {loading ? 'Checking…' : 'Continue'}
            </button>
            {enableSocial && (
              <SocialButtons
                onGoogle={() => {}}
                onFacebook={() => {}}
              />
            )}
            {onRegisterPress && (
              <p style={s.footerRow}>
                New here?{' '}
                <button type="button" style={s.link(accent)} onClick={onRegisterPress}>
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
              style={{ ...s.link(accent) }}
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
              style={{ ...s.btnPrimary(accent), ...(loading ? s.btnDisabled : {}) }}
              disabled={loading}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
            <button
              type="button"
              style={s.link(accent)}
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
  );
}

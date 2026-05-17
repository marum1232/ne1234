import React, { useState, useEffect } from 'react';

export interface BiometricPromptProps {
  /** Called when biometric auth succeeds — receives the stored refresh token */
  onSuccess: (refreshToken: string) => void;
  onDismiss?: () => void;
  /**
   * Called when no stored token is found after biometric auth.
   * Receives a `storeToken` function so the caller can supply and persist
   * a token (e.g. after a password login). If not provided, the component
   * shows a "Set up biometrics" CTA with instructions.
   */
  onEnroll?: (storeToken: (token: string) => Promise<void>) => Promise<void>;
  label?: string;
  className?: string;
  storageKey?: string;
}

type BiometricState =
  | 'checking'
  | 'unavailable'
  | 'web-unsupported'
  | 'not-enrolled'
  | 'enrolling'
  | 'ready'
  | 'prompting'
  | 'success'
  | 'error';

function isNativeBiometricAvailable(): boolean {
  const g = globalThis as Record<string, unknown>;
  return !!(g['__ExpoLocalAuthentication'] || g['ExpoModulesCore']);
}

function isWebAuthnAvailable(): boolean {
  return typeof window !== 'undefined' && 'PublicKeyCredential' in window;
}

async function storeTokenInSecureStore(key: string, token: string): Promise<void> {
  const g = globalThis as Record<string, unknown>;
  const SecureStore = g['__ExpoSecureStore'] as
    | { setItemAsync: (k: string, v: string) => Promise<void> }
    | undefined;
  if (SecureStore) await SecureStore.setItemAsync(key, token);
}

async function authenticateNative(storageKey: string): Promise<string | null> {
  const g = globalThis as Record<string, unknown>;
  const LocalAuth = g['__ExpoLocalAuthentication'] as
    | { authenticateAsync: (opts: { promptMessage: string }) => Promise<{ success: boolean }> }
    | undefined;

  if (!LocalAuth) return null;

  const result = await LocalAuth.authenticateAsync({
    promptMessage: 'Authenticate to sign in',
  });
  if (!result.success) return null;

  const SecureStore = g['__ExpoSecureStore'] as
    | { getItemAsync: (k: string) => Promise<string | null> }
    | undefined;
  return SecureStore ? SecureStore.getItemAsync(storageKey) : null;
}

const s = {
  card: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '16px',
    padding: '28px 24px',
    border: '2px solid #e5e7eb',
    borderRadius: '12px',
    background: '#fff',
    textAlign: 'center' as const,
    maxWidth: '340px',
    margin: '0 auto',
  },
  icon: { fontSize: '40px', lineHeight: 1 },
  title: { fontSize: '16px', fontWeight: 700, color: '#111827', margin: 0 },
  subtitle: { fontSize: '13px', color: '#6b7280', margin: 0 },
  btnPrimary: {
    width: '100%',
    padding: '12px',
    borderRadius: '8px',
    border: 'none',
    background: '#f59e0b',
    color: '#fff',
    fontWeight: 700,
    fontSize: '14px',
    cursor: 'pointer',
  },
  btnSecondary: {
    background: 'none',
    border: 'none',
    color: '#9ca3af',
    fontSize: '13px',
    cursor: 'pointer',
    padding: '4px 0',
  },
  errorText: { fontSize: '13px', color: '#ef4444' },
};

export function BiometricPrompt({
  onSuccess,
  onDismiss,
  onEnroll,
  label = 'Sign in with biometrics',
  className,
  storageKey = 'ajk_refresh_token_biometric',
}: BiometricPromptProps) {
  const [state, setState] = useState<BiometricState>('checking');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (isNativeBiometricAvailable()) {
      setState('ready');
    } else if (isWebAuthnAvailable()) {
      // WebAuthn is present but full server-challenge integration is not yet
      // implemented — surface a clear "not supported in this browser" message
      // instead of silently returning null.
      setState('web-unsupported');
    } else {
      setState('unavailable');
    }
  }, []);

  async function handlePrompt() {
    setState('prompting');
    setErrorMsg('');
    try {
      const token = await authenticateNative(storageKey);
      if (token) {
        setState('success');
        onSuccess(token);
      } else {
        // Biometric auth succeeded but no stored token found — enrollment path
        if (onEnroll) {
          setState('enrolling');
          const storeToken = async (newToken: string) => {
            await storeTokenInSecureStore(storageKey, newToken);
          };
          await onEnroll(storeToken);
          setState('ready');
        } else {
          setState('not-enrolled');
        }
      }
    } catch (err) {
      setState('error');
      setErrorMsg(err instanceof Error ? err.message : 'Authentication failed');
    }
  }

  if (state === 'checking') return null;

  if (state === 'unavailable') {
    return (
      <div style={s.card} className={className}>
        <span style={s.icon}>🔒</span>
        <p style={s.title}>Biometrics unavailable</p>
        <p style={s.subtitle}>Biometric authentication is not available on this device.</p>
        {onDismiss && (
          <button type="button" style={s.btnSecondary} onClick={onDismiss}>
            Use another method
          </button>
        )}
      </div>
    );
  }

  if (state === 'web-unsupported') {
    return (
      <div style={s.card} className={className}>
        <span style={s.icon}>🌐</span>
        <p style={s.title}>Not supported in this browser</p>
        <p style={s.subtitle}>
          Biometric sign-in requires the native app. Use the AJKMart app on your phone to enable fingerprint or face login.
        </p>
        {onDismiss && (
          <button type="button" style={s.btnSecondary} onClick={onDismiss}>
            Use password instead
          </button>
        )}
      </div>
    );
  }

  if (state === 'not-enrolled') {
    return (
      <div style={s.card} className={className}>
        <span style={s.icon}>🫆</span>
        <p style={s.title}>Set up biometrics</p>
        <p style={s.subtitle}>
          No biometric credential is stored yet. Sign in with your password first, then enable biometric login from your profile settings.
        </p>
        {onDismiss && (
          <button type="button" style={s.btnSecondary} onClick={onDismiss}>
            Use password instead
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={s.card} className={className}>
      <span style={s.icon}>
        {state === 'success' ? '✅' : state === 'enrolling' ? '⏳' : '🫆'}
      </span>
      <p style={s.title}>{label}</p>
      <p style={s.subtitle}>
        {state === 'prompting'
          ? 'Waiting for biometric…'
          : state === 'enrolling'
          ? 'Setting up biometrics…'
          : state === 'success'
          ? 'Authenticated!'
          : 'Use fingerprint or face recognition to sign in quickly.'}
      </p>
      {state === 'error' && <p style={s.errorText}>{errorMsg}</p>}
      {(state === 'ready' || state === 'error') && (
        <button
          type="button"
          style={s.btnPrimary}
          onClick={() => void handlePrompt()}
        >
          {state === 'error' ? 'Try again' : 'Authenticate'}
        </button>
      )}
      {onDismiss && state !== 'prompting' && state !== 'enrolling' && state !== 'success' && (
        <button type="button" style={s.btnSecondary} onClick={onDismiss}>
          Use password instead
        </button>
      )}
    </div>
  );
}

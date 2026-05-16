import React, { useState, useEffect } from 'react';

export interface BiometricPromptProps {
  /** Called when biometric auth succeeds — receives the stored refresh token */
  onSuccess: (refreshToken: string) => void;
  onDismiss?: () => void;
  label?: string;
  className?: string;
  storageKey?: string;
}

type BiometricState =
  | 'checking'
  | 'unavailable'
  | 'not-enrolled'
  | 'ready'
  | 'prompting'
  | 'success'
  | 'error';

function isBiometricAvailable(): boolean {
  // WebAuthn (browser)
  if (typeof window !== 'undefined' && 'PublicKeyCredential' in window) return true;
  // Expo / React Native (runtime detection via globalThis)
  const g = globalThis as Record<string, unknown>;
  if (g['__ExpoLocalAuthentication'] || g['ExpoModulesCore']) return true;
  return false;
}

async function enrollAndAuthenticate(storageKey: string): Promise<string | null> {
  // Native path — expo-local-authentication
  const g = globalThis as Record<string, unknown>;
  const LocalAuth = g['__ExpoLocalAuthentication'] as
    | { authenticateAsync: (opts: { promptMessage: string }) => Promise<{ success: boolean }> }
    | undefined;

  if (LocalAuth) {
    const result = await LocalAuth.authenticateAsync({
      promptMessage: 'Authenticate to sign in',
    });
    if (!result.success) return null;
    // Retrieve stored token from secure store
    const SecureStore = g['__ExpoSecureStore'] as
      | { getItemAsync: (k: string) => Promise<string | null> }
      | undefined;
    return SecureStore ? SecureStore.getItemAsync(storageKey) : null;
  }

  // Web — WebAuthn get() stub; in a real app you would integrate with your server's
  // WebAuthn challenge flow. Here we surface availability only.
  return null;
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
  label = 'Sign in with biometrics',
  className,
  storageKey = 'ajk_refresh_token_biometric',
}: BiometricPromptProps) {
  const [state, setState] = useState<BiometricState>('checking');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    setState(isBiometricAvailable() ? 'ready' : 'unavailable');
  }, []);

  async function handlePrompt() {
    setState('prompting');
    setErrorMsg('');
    try {
      const token = await enrollAndAuthenticate(storageKey);
      if (token) {
        setState('success');
        onSuccess(token);
      } else {
        setState('error');
        setErrorMsg('Biometric authentication failed or no stored token found.');
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
        <p style={s.subtitle}>Biometric authentication is not available on this device.</p>
        {onDismiss && (
          <button type="button" style={s.btnSecondary} onClick={onDismiss}>
            Use another method
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={s.card} className={className}>
      <span style={s.icon}>{state === 'success' ? '✅' : '🫆'}</span>
      <p style={s.title}>{label}</p>
      <p style={s.subtitle}>
        {state === 'prompting'
          ? 'Waiting for biometric…'
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
      {onDismiss && state !== 'prompting' && state !== 'success' && (
        <button type="button" style={s.btnSecondary} onClick={onDismiss}>
          Use password instead
        </button>
      )}
    </div>
  );
}

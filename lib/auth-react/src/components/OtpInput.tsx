import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
  type ClipboardEvent,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react';

export interface OtpInputProps {
  length?: number;
  onComplete: (otp: string) => void;
  onResend?: () => void;
  resendCooldownSeconds?: number;
  autoSubmit?: boolean;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  label?: string;
}

const s = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '16px',
  },
  label: {
    fontSize: '14px',
    color: '#6b7280',
    textAlign: 'center' as const,
  },
  row: {
    display: 'flex',
    gap: '8px',
  },
  input: {
    width: '44px',
    height: '52px',
    textAlign: 'center' as const,
    fontSize: '20px',
    fontWeight: 600,
    border: '2px solid #d1d5db',
    borderRadius: '8px',
    outline: 'none',
    transition: 'border-color 0.15s',
    caretColor: 'transparent',
  },
  inputFocus: {
    borderColor: '#f59e0b',
  },
  inputFilled: {
    borderColor: '#10b981',
  },
  footer: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '4px',
  },
  resendBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '13px',
    color: '#f59e0b',
    fontWeight: 600,
    padding: '4px 0',
  },
  resendBtnDisabled: {
    color: '#9ca3af',
    cursor: 'default',
  },
  cooldown: {
    fontSize: '13px',
    color: '#9ca3af',
  },
};

export function OtpInput({
  length = 6,
  onComplete,
  onResend,
  resendCooldownSeconds = 60,
  autoSubmit = true,
  disabled = false,
  className,
  inputClassName,
  label = 'Enter verification code',
}: OtpInputProps) {
  const [values, setValues] = useState<string[]>(Array(length).fill(''));
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Guard against duplicate onComplete calls for the same filled OTP
  const completedRef = useRef(false);

  // Auto-focus first box on mount
  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  // Start cooldown on mount if onResend is provided
  useEffect(() => {
    if (onResend) startCooldown();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startCooldown() {
    setCooldown(resendCooldownSeconds);
    timerRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) { clearInterval(timerRef.current!); return 0; }
        return c - 1;
      });
    }, 1000);
  }

  const notifyIfComplete = useCallback(
    (next: string[]) => {
      const otp = next.join('');
      if (otp.length === length && next.every((v) => v !== '')) {
        if (autoSubmit && !completedRef.current) {
          completedRef.current = true;
          onComplete(otp);
        }
      }
    },
    [length, autoSubmit, onComplete]
  );

  function handleManualSubmit() {
    const otp = values.join('');
    if (otp.length === length && values.every((v) => v !== '')) {
      onComplete(otp);
    }
  }

  function handleChange(idx: number, e: ChangeEvent<HTMLInputElement>) {
    const char = e.target.value.replace(/\D/g, '').slice(-1);
    const next = [...values];
    next[idx] = char;
    setValues(next);
    if (char && idx < length - 1) refs.current[idx + 1]?.focus();
    notifyIfComplete(next);
  }

  function handleKeyDown(idx: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      const next = [...values];
      if (next[idx]) {
        next[idx] = '';
        setValues(next);
        // Reset completion guard when user clears a digit
        completedRef.current = false;
      } else if (idx > 0) {
        next[idx - 1] = '';
        setValues(next);
        refs.current[idx - 1]?.focus();
        completedRef.current = false;
      }
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      refs.current[idx - 1]?.focus();
    } else if (e.key === 'ArrowRight' && idx < length - 1) {
      refs.current[idx + 1]?.focus();
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    const next = Array(length).fill('');
    text.split('').forEach((ch, i) => { next[i] = ch; });
    completedRef.current = false;
    setValues(next);
    refs.current[Math.min(text.length, length - 1)]?.focus();
    notifyIfComplete(next);
  }

  function handleResend() {
    if (cooldown > 0 || !onResend) return;
    const cleared = Array(length).fill('');
    setValues(cleared);
    completedRef.current = false;
    refs.current[0]?.focus();
    onResend();
    startCooldown();
  }

  return (
    <div style={s.wrapper} className={className}>
      {label && (
        <p style={s.label} id="otp-label">
          {label}
        </p>
      )}
      <div style={s.row} role="group" aria-labelledby={label ? 'otp-label' : undefined}>
        {values.map((val, idx) => (
          <input
            key={idx}
            ref={(el) => { refs.current[idx] = el; }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={val}
            disabled={disabled}
            className={inputClassName}
            aria-label={idx === 0 ? `OTP digit 1 of ${length}` : `digit ${idx + 1}`}
            style={{
              ...s.input,
              ...(focusedIdx === idx ? s.inputFocus : {}),
              ...(val ? s.inputFilled : {}),
            }}
            onFocus={() => setFocusedIdx(idx)}
            onBlur={() => setFocusedIdx(null)}
            onChange={(e) => handleChange(idx, e)}
            onKeyDown={(e) => handleKeyDown(idx, e)}
            onPaste={handlePaste}
          />
        ))}
      </div>
      {!autoSubmit && (
        <button
          type="button"
          style={{
            padding: '10px 24px',
            borderRadius: '8px',
            border: 'none',
            background: '#f59e0b',
            color: '#fff',
            fontWeight: 700,
            fontSize: '14px',
            cursor: values.every((v) => v !== '') ? 'pointer' : 'not-allowed',
            opacity: values.every((v) => v !== '') ? 1 : 0.55,
          }}
          onClick={handleManualSubmit}
          disabled={disabled || !values.every((v) => v !== '')}
        >
          Submit
        </button>
      )}
      {onResend && (
        <div style={s.footer}>
          {cooldown > 0 ? (
            <span style={s.cooldown}>Resend in {cooldown}s</span>
          ) : (
            <button style={s.resendBtn} onClick={handleResend} type="button">
              Resend code
            </button>
          )}
        </div>
      )}
    </div>
  );
}

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
        if (autoSubmit) onComplete(otp);
        else onComplete(otp);
      }
    },
    [length, autoSubmit, onComplete]
  );

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
      } else if (idx > 0) {
        next[idx - 1] = '';
        setValues(next);
        refs.current[idx - 1]?.focus();
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
    setValues(next);
    refs.current[Math.min(text.length, length - 1)]?.focus();
    notifyIfComplete(next);
  }

  function handleResend() {
    if (cooldown > 0 || !onResend) return;
    setValues(Array(length).fill(''));
    refs.current[0]?.focus();
    onResend();
    startCooldown();
  }

  return (
    <div style={s.wrapper} className={className}>
      {label && <p style={s.label}>{label}</p>}
      <div style={s.row}>
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

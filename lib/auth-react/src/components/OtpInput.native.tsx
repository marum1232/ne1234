import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';

export interface OtpInputProps {
  value: string;
  onChangeText: (v: string) => void;
  length?: number;
  onComplete?: (otp: string) => void;
  onResend?: () => void;
  resendCooldownSeconds?: number;
  disabled?: boolean;
  label?: string;
  hasError?: boolean;
  className?: string;
  inputClassName?: string;
}

export function OtpInput({
  value,
  onChangeText,
  length = 6,
  onComplete,
  onResend,
  resendCooldownSeconds = 60,
  disabled = false,
  label,
  hasError = false,
}: OtpInputProps) {
  const [cooldown, setCooldown] = React.useState(0);
  const inputRef = useRef<TextInput>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (onResend) startCooldown();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (value.length === length && onComplete) {
      onComplete(value);
    }
  }, [value, length, onComplete]);

  function startCooldown() {
    setCooldown(resendCooldownSeconds);
    timerRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          clearInterval(timerRef.current!);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

  function handleResend() {
    if (cooldown > 0 || !onResend) return;
    onChangeText('');
    onResend();
    startCooldown();
  }

  function handleChangeText(raw: string) {
    const cleaned = raw.replace(/\D/g, '').slice(0, length);
    onChangeText(cleaned);
  }

  const digits = value.split('');

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={() => inputRef.current?.focus()}
      style={styles.container}
      accessibilityLabel={`Enter ${length}-digit verification code`}
    >
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={handleChangeText}
        keyboardType="number-pad"
        maxLength={length}
        style={styles.hidden}
        autoFocus
        caretHidden
        editable={!disabled}
        accessibilityLabel={`Enter ${length}-digit code`}
        accessibilityRole="text"
      />
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.boxes}>
        {Array.from({ length }, (_, i) => {
          const isActive = i === digits.length && !disabled;
          const isFilled = i < digits.length;
          return (
            <View
              key={i}
              style={[
                styles.box,
                isActive && styles.boxActive,
                isFilled && styles.boxFilled,
                hasError && styles.boxError,
              ]}
            >
              {isFilled ? (
                <Text style={styles.digit}>{digits[i]}</Text>
              ) : null}
            </View>
          );
        })}
      </View>
      {onResend ? (
        <TouchableOpacity
          onPress={handleResend}
          disabled={cooldown > 0}
          style={styles.resendBtn}
          accessibilityRole="button"
        >
          <Text
            style={[styles.resendText, cooldown > 0 && styles.resendDisabled]}
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
          </Text>
        </TouchableOpacity>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  hidden: { position: 'absolute', opacity: 0, height: 1, width: 1 },
  label: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 12,
  },
  boxes: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 8,
  },
  box: {
    width: 48,
    height: 56,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#d1d5db',
    backgroundColor: '#f9fafb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxActive: { borderColor: '#f59e0b', backgroundColor: '#fffbeb' },
  boxFilled: { borderColor: '#10b981', backgroundColor: '#fff' },
  boxError: { borderColor: '#ef4444', backgroundColor: '#fef2f2' },
  digit: { fontSize: 20, fontWeight: '600', color: '#111827' },
  resendBtn: { alignItems: 'center', marginTop: 8 },
  resendText: { fontSize: 13, fontWeight: '600', color: '#f59e0b' },
  resendDisabled: { color: '#9ca3af' },
});

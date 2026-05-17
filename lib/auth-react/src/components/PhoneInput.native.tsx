import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';

export interface Country {
  code: string;
  dial: string;
  name: string;
  flag: string;
}

export interface PhoneInputProps {
  value: string;
  onChangeText: (localNumber: string) => void;
  onChange?: (e164: string, local: string, country: Country) => void;
  defaultCountryCode?: string;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  inputClassName?: string;
}

const DEFAULT_COUNTRY: Country = {
  code: 'PK',
  dial: '+92',
  name: 'Pakistan',
  flag: '🇵🇰',
};

function toE164(dial: string, local: string): string {
  const digits = local.replace(/\D/g, '');
  const trimmed = digits.startsWith('0') ? digits.slice(1) : digits;
  return `${dial}${trimmed}`;
}

export function PhoneInput({
  value,
  onChangeText,
  onChange,
  disabled = false,
  placeholder = '03XXXXXXXXX',
  autoFocus = false,
}: PhoneInputProps) {
  const country = DEFAULT_COUNTRY;

  function handleChange(raw: string) {
    const clean = raw.replace(/[^\d]/g, '').slice(0, 11);
    onChangeText(clean);
    onChange?.(toE164(country.dial, clean), clean, country);
  }

  return (
    <View style={[styles.wrapper, disabled && styles.wrapperDisabled]}>
      <View style={styles.codeBox}>
        <Text style={styles.flag}>{country.flag}</Text>
        <Text style={styles.dialCode}>{country.dial}</Text>
      </View>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={handleChange}
        placeholder={placeholder}
        placeholderTextColor="#9ca3af"
        keyboardType="phone-pad"
        maxLength={11}
        editable={!disabled}
        autoFocus={autoFocus}
        accessibilityLabel="Phone number"
        autoComplete="tel"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#d1d5db',
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 12,
    backgroundColor: '#f9fafb',
  },
  wrapperDisabled: { opacity: 0.55 },
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderRightWidth: 1,
    borderRightColor: '#e5e7eb',
  },
  flag: { fontSize: 18 },
  dialCode: { fontSize: 15, fontWeight: '600', color: '#111827' },
  input: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: '#111827',
  },
});

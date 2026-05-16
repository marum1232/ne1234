import React, { useState, type ChangeEvent } from 'react';

export interface Country {
  code: string;   // e.g. 'PK'
  dial: string;   // e.g. '+92'
  name: string;
  flag: string;
}

export const DEFAULT_COUNTRIES: Country[] = [
  { code: 'PK', dial: '+92',  name: 'Pakistan',      flag: '🇵🇰' },
  { code: 'AJ', dial: '+92',  name: 'AJK (Pakistan)', flag: '🏔️' },
  { code: 'GB', dial: '+92',  name: 'Gilgit-Baltistan', flag: '🏔️' },
  { code: 'US', dial: '+1',   name: 'United States',  flag: '🇺🇸' },
  { code: 'GB2',dial: '+44',  name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'AE', dial: '+971', name: 'UAE',            flag: '🇦🇪' },
  { code: 'SA', dial: '+966', name: 'Saudi Arabia',   flag: '🇸🇦' },
  { code: 'IN', dial: '+91',  name: 'India',          flag: '🇮🇳' },
  { code: 'AF', dial: '+93',  name: 'Afghanistan',    flag: '🇦🇫' },
];

export interface PhoneInputProps {
  value: string;
  onChange: (e164: string, local: string, country: Country) => void;
  countries?: Country[];
  defaultCountryCode?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

const s = {
  wrapper: {
    display: 'flex',
    border: '2px solid #d1d5db',
    borderRadius: '8px',
    overflow: 'hidden',
    transition: 'border-color 0.15s',
    background: '#fff',
  },
  select: {
    border: 'none',
    outline: 'none',
    background: '#f9fafb',
    padding: '0 8px',
    fontSize: '15px',
    cursor: 'pointer',
    borderRight: '1px solid #e5e7eb',
    minWidth: '80px',
    appearance: 'none' as const,
    WebkitAppearance: 'none' as const,
  },
  input: {
    flex: 1,
    border: 'none',
    outline: 'none',
    padding: '12px',
    fontSize: '15px',
    background: 'transparent',
  },
};

function toE164(dial: string, local: string): string {
  const digits = local.replace(/\D/g, '');
  // Remove leading zero common in Pakistani numbers
  const trimmed = digits.startsWith('0') ? digits.slice(1) : digits;
  return `${dial}${trimmed}`;
}

export function PhoneInput({
  value,
  onChange,
  countries = DEFAULT_COUNTRIES,
  defaultCountryCode = 'PK',
  disabled = false,
  placeholder = '300 1234567',
  className,
}: PhoneInputProps) {
  const [selectedCode, setSelectedCode] = useState(
    defaultCountryCode
  );
  const [localNumber, setLocalNumber] = useState(value ?? '');

  const country = countries.find((c) => c.code === selectedCode) ?? countries[0];

  function handleCountryChange(e: ChangeEvent<HTMLSelectElement>) {
    const c = countries.find((x) => x.code === e.target.value) ?? countries[0];
    setSelectedCode(c.code);
    onChange(toE164(c.dial, localNumber), localNumber, c);
  }

  function handleNumberChange(e: ChangeEvent<HTMLInputElement>) {
    const local = e.target.value.replace(/[^\d\s\-()]/g, '');
    setLocalNumber(local);
    onChange(toE164(country.dial, local), local, country);
  }

  return (
    <div style={s.wrapper} className={className}>
      <select
        value={selectedCode}
        onChange={handleCountryChange}
        disabled={disabled}
        style={s.select}
        aria-label="Country code"
      >
        {countries.map((c) => (
          <option key={c.code} value={c.code}>
            {c.flag} {c.dial}
          </option>
        ))}
      </select>
      <input
        type="tel"
        value={localNumber}
        onChange={handleNumberChange}
        disabled={disabled}
        placeholder={placeholder}
        style={s.input}
        aria-label="Phone number"
        autoComplete="tel"
      />
    </div>
  );
}

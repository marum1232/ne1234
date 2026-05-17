/**
 * ThemeContext — inject per-app brand colors into auth components.
 *
 * Each web/mobile app wraps its root with <ThemeProvider role="rider"> (or
 * vendor / customer / admin).  Components inside can call useAuthTheme() to
 * read the resolved color tokens — gradients, overlays, borders, etc.
 *
 * Apps may also pass a partial `theme` prop to override individual tokens
 * while keeping the rest of the role defaults intact.
 */
import React, { createContext, useContext, type ReactNode } from 'react';

export interface AuthTheme {
  /** Brand primary (buttons, active indicators, links) */
  primary: string;
  /** Darker shade — used for hover states and gradient ends */
  primaryDark: string;
  /** Very light tint — used for active backgrounds, chips */
  primaryLight: string;
  /** Page / screen background */
  background: string;
  /** Default body text */
  text: string;
  /** Secondary / muted text */
  textMuted: string;
  /** Input and card border */
  border: string;
  /** Full-screen pending-approval overlay background */
  pendingOverlay: string;
  /** Full-screen rejected overlay background */
  rejectedOverlay: string;
  /** Full-screen maintenance overlay background */
  maintenanceOverlay: string;
}

export const DEFAULT_THEMES: Record<string, AuthTheme> = {
  rider: {
    primary:            '#22c55e',
    primaryDark:        '#15803d',
    primaryLight:       '#f0fdf4',
    background:         '#f9fafb',
    text:               '#111827',
    textMuted:          '#6b7280',
    border:             '#e5e7eb',
    pendingOverlay:     '#f0fdf4',
    rejectedOverlay:    '#fef2f2',
    maintenanceOverlay: '#fffbeb',
  },
  vendor: {
    primary:            '#f97316',
    primaryDark:        '#c2410c',
    primaryLight:       '#fff7ed',
    background:         '#f5f5f5',
    text:               '#111827',
    textMuted:          '#6b7280',
    border:             '#e5e7eb',
    pendingOverlay:     '#fff7ed',
    rejectedOverlay:    '#fef2f2',
    maintenanceOverlay: '#fffbeb',
  },
  customer: {
    primary:            '#0066ff',
    primaryDark:        '#1d4ed8',
    primaryLight:       '#eff6ff',
    background:         '#f1f5f9',
    text:               '#0f172a',
    textMuted:          '#64748b',
    border:             '#e2e8f0',
    pendingOverlay:     '#eff6ff',
    rejectedOverlay:    '#fef2f2',
    maintenanceOverlay: '#fffbeb',
  },
  admin: {
    primary:            '#6366f1',
    primaryDark:        '#4338ca',
    primaryLight:       '#eef2ff',
    background:         '#f8fafc',
    text:               '#0f172a',
    textMuted:          '#64748b',
    border:             '#e2e8f0',
    pendingOverlay:     '#eef2ff',
    rejectedOverlay:    '#fef2f2',
    maintenanceOverlay: '#fffbeb',
  },
};

const ThemeContext = createContext<AuthTheme>(DEFAULT_THEMES.customer);

export interface ThemeProviderProps {
  /** Role selects the built-in defaults for that app */
  role?: keyof typeof DEFAULT_THEMES;
  /** Optional overrides merged on top of the role defaults */
  theme?: Partial<AuthTheme>;
  children: ReactNode;
}

/**
 * Wrap your app root (or the subtree that uses auth components) with
 * ThemeProvider so all auth screens use your brand colors automatically.
 *
 * @example
 *   <ThemeProvider role="vendor">
 *     <App />
 *   </ThemeProvider>
 */
export function ThemeProvider({ role = 'customer', theme, children }: ThemeProviderProps) {
  const base: AuthTheme = DEFAULT_THEMES[role] ?? DEFAULT_THEMES.customer;
  const merged: AuthTheme = theme ? { ...base, ...theme } : base;
  return <ThemeContext.Provider value={merged}>{children}</ThemeContext.Provider>;
}

/**
 * Returns the resolved AuthTheme for the current app.
 * Must be used inside a <ThemeProvider>.
 */
export function useAuthTheme(): AuthTheme {
  return useContext(ThemeContext);
}

export { ThemeContext };

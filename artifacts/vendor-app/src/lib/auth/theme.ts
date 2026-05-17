/**
 * Vendor-app brand palette — emerald green on clean white.
 *
 * Overrides the DEFAULT_THEMES.vendor defaults from @workspace/auth-react to
 * match the exact hex values used throughout the vendor CSS.
 * Pass this object as the `theme` prop on ThemeProvider to apply:
 *
 *   <ThemeProvider role="vendor" theme={vendorTheme}>…</ThemeProvider>
 */
import type { AuthTheme } from "@workspace/auth-react";

export const vendorTheme: Partial<AuthTheme> = {
  primary:            "#059669",
  primaryDark:        "#047857",
  primaryLight:       "#ecfdf5",
  background:         "#ffffff",
  text:               "#111827",
  textMuted:          "#6B7280",
  border:             "#e5e7eb",
  pendingOverlay:     "#f0fdf4",
  rejectedOverlay:    "#fef2f2",
  maintenanceOverlay: "#fffbeb",
  surface:            "#ffffff",
};

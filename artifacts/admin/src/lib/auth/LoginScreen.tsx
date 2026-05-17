/**
 * LoginScreen.tsx — admin
 *
 * Admin login: username + password + optional TOTP (2FA).
 * No registration — admin accounts are created/seeded server-side.
 * Uses the theme system for brand colors (indigo on dark).
 *
 * The MFA step is rendered as a local overlay so it's consistent
 * with the overlay pattern used by rider/vendor apps.
 */
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "./useAuth";
import { useAppStatus } from "./useAppStatus";
import { useTheme } from "./ThemeContext";
import { useAdminAuth } from "../adminAuthContext";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import {
  ShoppingBag, ArrowRight, Loader2, Eye, EyeOff,
  ShieldCheck, ChevronLeft, KeyRound,
} from "lucide-react";

export interface LoginScreenProps {
  onSuccess?: () => void;
}

export function LoginScreen({ onSuccess }: LoginScreenProps) {
  const { loginWithPassword, logout, isLoading } = useAuth();
  const { maintenance, maintenanceMsg, supportPhone, supportEmail } = useAppStatus();
  const theme = useTheme();
  const [, setLocation] = useLocation();
  const { state } = useAdminAuth();
  const { toast } = useToast();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [totp, setTotp] = useState("");
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [step, setStep] = useState<"credentials" | "mfa">("credentials");
  const [error, setError] = useState<string | null>(null);

  /* ── Redirect on success ── */
  useEffect(() => {
    if (state.user && state.accessToken) {
      onSuccess?.();
      setLocation("/dashboard");
    }
  }, [state.user, state.accessToken, setLocation, onSuccess]);

  /* ── Show errors from auth context ── */
  useEffect(() => {
    if (state.error) {
      toast({ title: "Login Error", description: state.error, variant: "destructive" });
    }
  }, [state.error, toast]);

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password.trim()) return;
    const result = await loginWithPassword(username.trim(), password);
    if (result.error === "mfa_required") {
      setTempToken(result.data?.tempToken ?? null);
      setStep("mfa");
      setTotp("");
      toast({ title: "MFA Required", description: "Enter your authenticator code" });
    } else if (!result.success) {
      setError(result.error ?? "Login failed");
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!totp.trim() || !tempToken) return;
    const result = await loginWithPassword(username, password, totp, tempToken);
    if (!result.success) {
      setError(result.error ?? "Invalid code");
    }
  };

  const handleBackToCredentials = () => {
    setStep("credentials");
    setTotp("");
    setTempToken(null);
    setError(null);
  };

  /* ── Maintenance overlay ── */
  if (maintenance) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        background: theme.background, padding: 16, position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", top: "-15%", left: "-10%", width: "45%", height: "45%", borderRadius: "50%", background: `${theme.primaryDark}14`, filter: "blur(120px)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: "-15%", right: "-10%", width: "45%", height: "45%", borderRadius: "50%", background: `${theme.primary}0F`, filter: "blur(120px)", pointerEvents: "none" }} />
        <div style={{ position: "relative", zIndex: 10, width: "100%", maxWidth: 400 }}>
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: `linear-gradient(135deg, ${theme.primary}, ${theme.primaryDark})`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", boxShadow: `0 4px 20px ${theme.primary}4D` }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={theme.surface} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>
            </div>
            <h1 style={{ color: theme.text, fontSize: 22, fontWeight: 700, margin: "0 0 4px" }}>AJKMart Admin</h1>
          </div>
          <div style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${theme.border}`, borderRadius: 20, padding: "32px 28px", backdropFilter: "blur(12px)", boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}>
            <h2 style={{ color: theme.text, fontSize: 18, fontWeight: 700, margin: "0 0 10px", textAlign: "center" }}>System Maintenance</h2>
            <p style={{ color: theme.textMuted, fontSize: 14, lineHeight: 1.65, margin: "0 0 20px", textAlign: "center" }}>
              {maintenanceMsg ?? "The admin panel is temporarily unavailable for scheduled maintenance."}
            </p>
            {(supportPhone || supportEmail) && (
              <div style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${theme.border}`, borderRadius: 10, padding: "12px 16px" }}>
                <p style={{ color: theme.primary, fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", margin: "0 0 6px" }}>Emergency Contact</p>
                {supportPhone && <p style={{ color: theme.text, fontSize: 14, margin: "0 0 4px" }}>📞 {supportPhone}</p>}
                {supportEmail && <p style={{ color: theme.textMuted, fontSize: 13, margin: 0 }}>{supportEmail}</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ── Login form (credentials + MFA) ── */
  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      background: theme.background, position: "relative", overflow: "hidden", padding: 16,
    }}>
      <div style={{ position: "absolute", top: "-15%", left: "-10%", width: "45%", height: "45%", borderRadius: "50%", background: `${theme.primaryDark}18`, filter: "blur(120px)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: "-15%", right: "-10%", width: "45%", height: "45%", borderRadius: "50%", background: `${theme.primary}14`, filter: "blur(120px)", pointerEvents: "none" }} />
      <div style={{ position: "relative", zIndex: 10, width: "100%", maxWidth: 400 }}>

        {/* Brand header */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: `linear-gradient(135deg, ${theme.primary}, ${theme.primaryDark})`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", boxShadow: `0 4px 20px ${theme.primary}4D` }}>
            <ShoppingBag style={{ width: 28, height: 28, color: theme.surface }} />
          </div>
          <h1 style={{ color: theme.text, fontSize: 22, fontWeight: 700, margin: "0 0 4px" }}>AJKMart Admin</h1>
          <p style={{ color: theme.textMuted, fontSize: 13, margin: 0 }}>
            {step === "credentials" ? "Sign in to your admin panel" : "Two-factor authentication"}
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: "rgba(255,255,255,0.04)", border: `1px solid ${theme.border}`,
          borderRadius: 20, padding: "28px 24px", backdropFilter: "blur(12px)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
        }}>
          {error && (
            <div style={{
              background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
              borderRadius: 10, padding: "10px 14px", marginBottom: 16,
              color: theme.error ?? "#fca5a5", fontSize: 13, fontWeight: 500,
            }}>
              {error}
            </div>
          )}

          {step === "credentials" ? (
            <form onSubmit={handleCredentialsSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>Username</label>
                <Input
                  type="text" value={username} onChange={e => setUsername(e.target.value)}
                  placeholder="Enter your username" autoComplete="username" autoFocus
                  disabled={isLoading}
                  className="h-11 rounded-xl border-white/10 bg-white/[0.06] text-sm text-white placeholder:text-white/25 focus:border-indigo-500/60 focus:ring-indigo-500/15 focus:bg-white/[0.08] transition-all"
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>Password</label>
                <div style={{ position: "relative" }}>
                  <Input
                    type={showPassword ? "text" : "password"} value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Enter your password" autoComplete="current-password"
                    disabled={isLoading}
                    className="h-11 rounded-xl border-white/10 bg-white/[0.06] pr-10 text-sm text-white placeholder:text-white/25 focus:border-indigo-500/60 focus:ring-indigo-500/15 focus:bg-white/[0.08] transition-all"
                  />
                  <button type="button" tabIndex={-1} onClick={() => setShowPassword(v => !v)}
                    style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 40, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer" }}>
                    {showPassword ? <EyeOff style={{ width: 16, height: 16 }} /> : <Eye style={{ width: 16, height: 16 }} />}
                  </button>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -8 }}>
                <button type="button" onClick={() => setLocation("/forgot-password")}
                  style={{ fontSize: 12, fontWeight: 500, color: `${theme.primary}CC`, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  Forgot password?
                </button>
              </div>
              <button type="submit" disabled={isLoading || !username.trim() || !password.trim()}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  width: "100%", borderRadius: 12, padding: "11px 0",
                  background: isLoading || !username.trim() || !password.trim() ? `${theme.primary}80` : theme.primary,
                  color: theme.surface, fontSize: 14, fontWeight: 700,
                  border: "none", cursor: isLoading ? "not-allowed" : "pointer",
                  transition: "all 0.2s",
                }}>
                {isLoading ? <Loader2 className="animate-spin" style={{ width: 16, height: 16 }} /> : <>Sign in <ArrowRight style={{ width: 16, height: 16 }} /></>}
              </button>
            </form>
          ) : (
            <form onSubmit={handleMfaSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{
                display: "flex", alignItems: "flex-start", gap: 12,
                borderRadius: 12, border: `1px solid ${theme.primary}33`,
                background: `${theme.primary}14`, padding: "14px 16px",
              }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: `${theme.primary}26`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <ShieldCheck style={{ width: 16, height: 16, color: theme.primary }} />
                </div>
                <div>
                  <p style={{ color: "rgba(255,255,255,0.9)", fontSize: 13, fontWeight: 600, margin: "0 0 4px" }}>Verification required</p>
                  <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 12, lineHeight: 1.5, margin: 0 }}>Enter the 6-digit code from your authenticator app.</p>
                </div>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>Authenticator code</label>
                <Input
                  type="text" inputMode="numeric" placeholder="000 000" value={totp}
                  onChange={e => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  autoComplete="off" disabled={isLoading} autoFocus maxLength={6}
                  className="h-12 rounded-xl border-white/10 bg-white/[0.06] text-center text-xl font-mono tracking-[0.4em] text-white placeholder:text-white/20 focus:border-indigo-500/60 focus:ring-indigo-500/15 focus:bg-white/[0.08] transition-all"
                />
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" onClick={handleBackToCredentials} disabled={isLoading}
                  style={{ display: "flex", alignItems: "center", gap: 6, height: 40, borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", padding: "0 16px", fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.6)", cursor: "pointer" }}>
                  <ChevronLeft style={{ width: 16, height: 16 }} /> Back
                </button>
                <button type="submit" disabled={isLoading || totp.length !== 6}
                  style={{
                    flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    borderRadius: 12, padding: "11px 0", background: isLoading || totp.length !== 6 ? `${theme.primary}80` : theme.primary,
                    color: theme.surface, fontSize: 14, fontWeight: 700, border: "none", cursor: isLoading ? "not-allowed" : "pointer",
                  }}>
                  {isLoading ? <Loader2 className="animate-spin" style={{ width: 16, height: 16 }} /> : <>Verify <ArrowRight style={{ width: 16, height: 16 }} /></>}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Help notice */}
        <div style={{ marginTop: 20, display: "flex", alignItems: "flex-start", gap: 10, borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)", padding: "12px 16px" }}>
          <KeyRound style={{ width: 14, height: 14, color: "rgba(255,255,255,0.25)", flexShrink: 0, marginTop: 2 }} />
          <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 11.5, lineHeight: 1.5, margin: 0 }}>
            {step === "credentials"
              ? "Contact your administrator if you don't have access."
              : "Don't have your authenticator code? Contact your administrator."}
          </p>
        </div>


        <p style={{ textAlign: "center", fontSize: 11, color: "rgba(255,255,255,0.2)", marginTop: 24 }}>
          AJKMart Admin &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}

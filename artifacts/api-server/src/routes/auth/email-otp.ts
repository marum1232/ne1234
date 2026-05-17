import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import crypto, { randomBytes, createHash, randomInt } from "crypto";
import { z } from "zod";
import { db } from "@workspace/db";
import { usersTable, walletTransactionsTable, notificationsTable, refreshTokensTable, magicLinkTokensTable, rateLimitsTable, pendingOtpsTable, userSessionsTable, loginHistoryTable, vendorProfilesTable, riderProfilesTable, totpRecoveryCodesTable, userTotpSetupTable } from "@workspace/db/schema";
import { eq, and, sql, lt, or, desc, ilike, isNull } from "drizzle-orm";
import { generateId } from "../../lib/id.js";
import { getPlatformSettings } from "../admin.js";
import { emitWebhookEvent } from "../../lib/webhook-emitter.js";
import { fireAndForget } from "../../lib/fireAndForget.js";
import { checkLockout, recordFailedAttempt, resetAttempts, addAuditEntry, addSecurityEvent, getClientIp, getCachedSettings, signUserJwt, signAccessToken, sign2faChallengeToken, verify2faChallengeToken, generateRefreshToken, hashRefreshToken, isRefreshTokenValid, revokeRefreshToken, revokeAllUserRefreshTokens, verifyUserJwt, blacklistJti, writeAuthAuditLog, getRefreshTokenTtlDays, getAccessTokenTtlSec, verifyCaptcha, checkAvailableRateLimit } from "../../middleware/security.js";
import { sendOtpSMS, isSMSProviderConfigured, isSMSConsoleActive } from "../../services/sms.js";
import { sendOtpWithFailover, getWhitelistBypass } from "../../services/smsGateway.js";
import { sendWhatsAppOTP, isWhatsAppProviderConfigured } from "../../services/whatsapp.js";
import { hashPassword, verifyPassword, validatePasswordStrength, generateSecureOtp } from "../../services/password.js";
import { generateTotpSecret, verifyTotpToken, generateQRCodeDataURL, getTotpUri, encryptTotpSecret, decryptTotpSecret } from "../../services/totp.js";
import { sendVerificationEmail, sendPasswordResetEmail, sendMagicLinkEmail, alertNewVendor, isEmailProviderConfigured } from "../../services/email.js";
import { getUserLanguage, getPlatformDefaultLanguage } from "../../lib/getUserLanguage.js";
import { t } from "@workspace/i18n";
import { logger } from "../../lib/logger.js";
import { sendError, sendErrorWithData, sendUnauthorized, sendForbidden, sendNotFound, sendInternalError, sendTooManyRequests, sendSuccess, sendCreated } from "../../lib/response.js";
import { clearSpoofHits } from "../rider/index.js";
import { canonicalizePhone } from "@workspace/phone-utils";
import { isAuthMethodEnabled, isAuthMethodEnabledStrict } from "@workspace/auth-utils/server";
import { validateBody as sharedValidateBody } from "../../middleware/validate.js";
import { authLimiter, loginLimiter, otpLimiter } from "../../middleware/rate-limit.js";
import { hashOtp, isValidCanonicalPhone, normalizeVehicleTypeForStorage, generateVerificationToken, hashVerificationToken, tryEncrypt, decryptPii, setRiderRefreshCookie, clearRiderRefreshCookie, setVendorRefreshCookie, clearVendorRefreshCookie, RIDER_REFRESH_COOKIE, RIDER_REFRESH_COOKIE_PATH, VENDOR_REFRESH_COOKIE, VENDOR_REFRESH_COOKIE_PATH } from "./helpers.js";
import { rotateRefreshToken, invalidateTokenFamily } from "../../services/auth/tokenRotation.js";
import {
  AUTH_OTP_TTL_MS,
  CNIC_REGEX,
  PHONE_REGEX,
  forgotPasswordSchema,
  registerSchema,
  refreshTokenSchema,
  checkIdentifierSchema,
  sendOtpSchema,
  verifyOtpSchema,
  loginSchema,
  SendEmailOtpSchema,
  VerifyEmailOtpSchema,
  checkAndIncrOtpRateLimit,
  isDeviceTrusted,
} from "./helpers.js";

const router: IRouter = Router();

router.post("/send-email-otp", otpLimiter, verifyCaptcha, sharedValidateBody(SendEmailOtpSchema), async (req, res) => {
  try {
  const { email } = req.body;
  if (!email || !email.includes("@")) {
    sendError(res, "Valid email address required", 400); return;
  }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  if (!isAuthMethodEnabled(settings, "auth_email_otp_enabled")) {
    sendErrorWithData(res, "Email OTP login is currently disabled.", { code: "AUTH_METHOD_DISABLED" }, 400);
    return;
  }
  const normalized = email.toLowerCase().trim();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalized)).limit(1);
  if (!user) {
    sendSuccess(res, { message: "If an account exists with this email, an OTP has been sent." });
    return;
  }

  if (!isAuthMethodEnabled(settings, "auth_email_otp_enabled", user.roles ?? "customer")) {
    sendErrorWithData(res, "Email OTP login is currently disabled for your account type.", { code: "AUTH_METHOD_DISABLED" }, 400);
    return;
  }

  if (user.isBanned) { sendForbidden(res, "Your account has been suspended."); return; }
  const isPendingEmail = user.approvalStatus === "pending";
  if (!user.isActive && !isPendingEmail) { sendForbidden(res, "Your account is inactive. Contact support."); return; }

  /* Lockout check using email as key */
  const maxAttempts = parseInt(settings["security_login_max_attempts"] ?? "5", 10);
  const lockoutMinutes = parseInt(settings["security_lockout_minutes"] ?? "30", 10);
  const lockout = await checkLockout(normalized, maxAttempts, lockoutMinutes);
  if (lockout.locked) {
    sendTooManyRequests(res, `Too many attempts. Try again in ${lockout.minutesLeft} minute(s).`); return;
  }

  /* ── Per-email OTP resend cooldown — prevents inbox flooding ──
     Same 60-second window as the SMS OTP cooldown. */
  const otpCooldownMs   = parseInt(settings["security_otp_cooldown_sec"] ?? "60", 10) * 1000;
  const existingExpiry  = user.emailOtpExpiry;
  if (existingExpiry) {
    const otpValidityMs = AUTH_OTP_TTL_MS;
    const issuedAgoMs   = otpValidityMs - (existingExpiry.getTime() - Date.now());
    if (issuedAgoMs < otpCooldownMs) {
      const waitSec = Math.ceil((otpCooldownMs - issuedAgoMs) / 1000);
      addAuditEntry({ action: "email_otp_throttle", ip, details: `Email OTP resend too soon for ${normalized} — ${waitSec}s remaining`, result: "fail" });
      sendErrorWithData(res, `Please wait ${waitSec} second(s) before requesting a new email OTP.`, { retryAfterSeconds: waitSec }, 429);
      return;
    }
  }

  /* ── Per-account + per-IP OTP rate limit (admin-configurable window) ── */
  const emailRateCheck = await checkAndIncrOtpRateLimit({ identifier: normalized, ip, settings });
  if (emailRateCheck.blocked) {
    const label = emailRateCheck.reason === "ip"
      ? "Too many OTP requests from your network"
      : "Too many OTP requests for this email";
    addAuditEntry({ action: "email_otp_rate_limit", ip, details: `${label} (${normalized}) — retry in ${emailRateCheck.retryAfterSeconds}s`, result: "fail" });
    sendErrorWithData(res, `${label}. Please wait ${emailRateCheck.retryAfterSeconds} second(s) before trying again.`, { retryAfterSeconds: emailRateCheck.retryAfterSeconds }, 429);
    return;
  }

  const otp    = generateSecureOtp();
  const expiry = new Date(Date.now() + AUTH_OTP_TTL_MS);

  await db.update(usersTable)
    .set({ emailOtpCode: hashOtp(otp), emailOtpExpiry: expiry, updatedAt: new Date() })
    .where(eq(usersTable.id, user.id));

  const isDev = process.env.NODE_ENV !== "production";
  logger.info({ email: normalized, otp: isDev ? otp : "[hidden]" }, "Email OTP generated");

  /* Send OTP via email service. Falls back gracefully when SMTP is not configured.
     In development, the OTP is also exposed in the response for easy testing. */
  const emailOtpLang = await getUserLanguage(user.id);
  const emailResult = await sendPasswordResetEmail(normalized, otp, user.name ?? undefined, emailOtpLang);

  if (!emailResult.sent) {
    if (isDev) {
      /* In development, log OTP to console so developers can see it */
      logger.info(`[EMAIL-OTP DEV] Email OTP for ${normalized}: ${otp} (SMTP not configured: ${emailResult.reason ?? "unknown"})`);
    } else {
      /* In production, use structured logger so the warning is captured properly */
      logger.warn({ email: normalized, reason: emailResult.reason ?? "SMTP not configured" }, "[EMAIL-OTP] Failed to send OTP email");
    }
  }

  addAuditEntry({ action: "email_otp_sent", ip, details: `Email OTP for: ${normalized} (delivered: ${emailResult.sent})`, result: "success" });

  const emailConsoleFallback = !emailResult.sent;
  /* Dev console fallback: OTP already logged to server at lines above — never expose in API response */
  if (isDev && emailConsoleFallback) {
    logger.info({ email: normalized, otp }, "[EMAIL-OTP DEV] OTP logged here for testing only — not included in API response");
  }
  sendSuccess(res, {
    message: "OTP aapki email par bhej diya gaya hai",
    channel: emailResult.sent ? "email" : "console",
  });
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/verify-email-otp
   Login via email OTP. Body: { email, otp }
══════════════════════════════════════════════════════════════ */

router.post("/verify-email-otp", otpLimiter, verifyCaptcha, sharedValidateBody(VerifyEmailOtpSchema), async (req, res) => {
  try {
  const { email, otp } = req.body;
  if (!email || !otp) { sendError(res, "Email and OTP are required", 400); return; }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  if (!isAuthMethodEnabled(settings, "auth_email_otp_enabled")) {
    sendErrorWithData(res, "Email OTP login is currently disabled.", { code: "AUTH_METHOD_DISABLED" }, 400);
    return;
  }
  const normalized = email.toLowerCase().trim();

  const maxAttempts = parseInt(settings["security_login_max_attempts"] ?? "5", 10);
  const lockoutMinutes = parseInt(settings["security_lockout_minutes"] ?? "30", 10);

  const lockout = await checkLockout(normalized, maxAttempts, lockoutMinutes);
  if (lockout.locked) {
    sendTooManyRequests(res, `Account locked. Try again in ${lockout.minutesLeft} minute(s).`); return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalized)).limit(1);
  if (!user) { sendNotFound(res, "Is email se koi account nahi mila."); return; }

  if (!isAuthMethodEnabled(settings, "auth_email_otp_enabled", user.roles ?? "customer")) {
    sendErrorWithData(res, "Email OTP login is currently disabled for your account type.", { code: "AUTH_METHOD_DISABLED" }, 400);
    return;
  }

  /* Cross-role enforcement: rider/vendor apps send their role; reject mismatches.
     Customer app context is identified by X-App-Id header or role=customer body field.
     For customer app, enforcement happens post-OTP so user can be issued a token and
     offered the "Add Customer Access" flow from wrong-app screen. */
  const requestedEmailRole: string | undefined = typeof req.body?.role === "string" ? req.body.role : undefined;
  const emailAppIdHeader = req.headers["x-app-id"] as string | undefined;
  const emailAppIdQuery = req.query.appId as string | undefined;
  const isEmailCustomerAppCtx = requestedEmailRole === "customer" || emailAppIdHeader === "customer" || emailAppIdQuery === "customer";
  if (requestedEmailRole && !isEmailCustomerAppCtx) {
    const userRolesEmail = (user.roles || "customer").split(",").map((r: string) => r.trim());
    if (!userRolesEmail.includes(requestedEmailRole)) {
      addSecurityEvent({ type: "cross_role_login_attempt", ip, userId: user.id, details: `User with roles [${user.roles}] tried email OTP login as ${requestedEmailRole}`, severity: "high" });
      sendErrorWithData(res, "This account is not registered as a " + requestedEmailRole + ". Please use the correct app.", { wrongApp: true }, 403); return;
    }
  }

  if (user.isBanned) { sendForbidden(res, "Account suspended. Contact support."); return; }
  const emailIsPending = user.approvalStatus === "pending";
  if (!user.isActive && !emailIsPending) { sendForbidden(res, "Account inactive. Contact support."); return; }

  /* ── Per-user OTP bypass (HIGHEST PRIORITY) ── */
  const emailPerUserBypass = !!(user.otpBypassUntil && user.otpBypassUntil > new Date());

  /* ── Global OTP bypass: danger-zone toggle OR timed suspension ── */
  const emailGlobalDisabledUntilStr = settings["otp_global_disabled_until"];
  const emailTimedSuspension = !!(emailGlobalDisabledUntilStr && new Date(emailGlobalDisabledUntilStr) > new Date());
  const emailGlobalBypass = settings["security_otp_bypass"] === "on" || emailTimedSuspension;

  const emailOtpBypassed = emailPerUserBypass || emailGlobalBypass;

  if (!emailOtpBypassed) {
    /* Check expiry FIRST — prevents timing oracle */
    if (user.emailOtpExpiry && new Date() > user.emailOtpExpiry) {
      sendUnauthorized(res, "OTP expired. Please request a new one."); return;
    }
  }

  if (!emailOtpBypassed && user.emailOtpCode !== hashOtp(otp)) {
    const updated = await recordFailedAttempt(normalized, maxAttempts, lockoutMinutes);
    const remaining = maxAttempts - updated.attempts;
    addAuditEntry({ action: "email_otp_failed", ip, details: `Wrong email OTP for: ${normalized}`, result: "fail" });
    if (updated.locked) {
      sendTooManyRequests(res, `Too many failed attempts. Locked for ${lockoutMinutes} minutes.`);
    } else {
      sendErrorWithData(res, `Invalid OTP. ${remaining} attempt(s) remaining.`, { attemptsRemaining: remaining }, 401);
    }
    return;
  }

  /* Check approval BEFORE touching the DB — a rejected user must not have their OTP cleared */
  if (user.approvalStatus === "rejected") {
    sendErrorWithData(res, "Account rejected. Contact admin.", { code: "APPROVAL_REJECTED", approvalStatus: "rejected", rejectionReason: user.approvalNote ?? null }, 403); return;
  }

  /* Clear email OTP + mark email verified + update last login */
  await db.update(usersTable)
    .set({ emailOtpCode: null, emailOtpExpiry: null, emailVerified: true, lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(usersTable.id, user.id));

  await resetAttempts(normalized);

  addAuditEntry({ action: "email_login", ip, details: `Email OTP login for: ${normalized}`, result: "success" });

  /* ── 2FA challenge ── */
  if (user.totpEnabled && isAuthMethodEnabled(settings, "auth_2fa_enabled", user.roles ?? undefined)) {
    const deviceFingerprint = req.body.deviceFingerprint ?? "";
    const trustedDays = parseInt(settings["auth_trusted_device_days"] ?? "30", 10);
    if (!isDeviceTrusted(user, deviceFingerprint, trustedDays)) {
      const tempToken = sign2faChallengeToken(user.id, user.phone ?? "", user.roles ?? "customer", user.roles ?? "customer", "email_otp");
      sendSuccess(res, { requires2FA: true, tempToken, userId: user.id }); return;
    }
  }

  const isPendingApproval = user.approvalStatus === "pending";

  /* Issue short-lived access token + refresh token (consistent with OTP flow) */
  const accessToken = signAccessToken(user.id, user.phone ?? "", user.roles ?? "customer", user.roles ?? "customer", user.tokenVersion ?? 0);
  const expiresAt   = new Date(Date.now() + getAccessTokenTtlSec() * 1000).toISOString();

  if (isPendingApproval) {
    sendSuccess(res, {
      token: accessToken, expiresAt, pendingApproval: true,
      message: "Aapka account admin approval ke liye bheja gaya hai.",
      user: { id: user.id, phone: decryptPii(user.encryptedPhone, user.phone), name: user.name, role: user.roles, roles: user.roles, approvalStatus: "pending" },
    });
    return;
  }

  const { raw: refreshRaw, hash: refreshHash } = generateRefreshToken();
  const refreshExpiresAt = new Date(Date.now() + getRefreshTokenTtlDays() * 24 * 60 * 60 * 1000);
  await db.insert(refreshTokensTable).values({ id: generateId(), userId: user.id, tokenHash: refreshHash, authMethod: "email_otp", expiresAt: refreshExpiresAt });
  fireAndForget(
    db.delete(refreshTokensTable).where(and(eq(refreshTokensTable.userId, user.id), lt(refreshTokensTable.expiresAt, new Date()))),
    "auth:expired-token-cleanup:email_otp",
    logger,
    { userId: user.id, code: "DB_CLEANUP" },
  );

  setRiderRefreshCookie(req, res, refreshRaw, user);
  setVendorRefreshCookie(req, res, refreshRaw, user);

  writeAuthAuditLog("login_success", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { method: "email_otp" } });

  /* Post-OTP customer app cross-role check: issue token + wrongApp flag so frontend
     can offer "Add Customer Access" flow from the wrong-app screen */
  const emailUserRoles = (user.roles || "customer").split(",").map((r: string) => r.trim());
  if (isEmailCustomerAppCtx && !emailUserRoles.includes("customer")) {
    addSecurityEvent({ type: "cross_role_login_attempt", ip, userId: user.id, details: `User with roles [${user.roles}] email-logged in to customer app context — offering add-role`, severity: "low" });
    sendSuccess(res, {
      token: accessToken, refreshToken: refreshRaw, expiresAt, sessionDays: getRefreshTokenTtlDays(),
      canAddCustomerRole: true, code: "cross_app_account", wrongApp: true,
      user: { id: user.id, phone: decryptPii(user.encryptedPhone, user.phone), name: user.name, email: decryptPii(user.encryptedEmail, user.email), username: user.username, role: user.roles, roles: user.roles ?? "customer", avatar: user.avatar, walletBalance: parseFloat(user.walletBalance ?? "0"), emailVerified: true, phoneVerified: user.phoneVerified ?? false },
    });
    return;
  }

  sendSuccess(res, {
    token:        accessToken,
    refreshToken: refreshRaw,
    expiresAt,
    sessionDays:  getRefreshTokenTtlDays(),
    pendingApproval: false,
    user: { id: user.id, phone: decryptPii(user.encryptedPhone, user.phone), name: user.name, email: decryptPii(user.encryptedEmail, user.email), username: user.username, role: user.roles, roles: user.roles ?? "customer", avatar: user.avatar, walletBalance: parseFloat(user.walletBalance ?? "0"), emailVerified: true, phoneVerified: user.phoneVerified ?? false },
  });
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/login/username   (kept for backward-compat)
   POST /auth/login            (new unified endpoint)
   Unified identifier + password login (Binance-style).
   Accepts phone, email, OR username as `identifier` (or `username`).
   Body: { identifier, password } OR { username, password }
══════════════════════════════════════════════════════════════ */

export default router;
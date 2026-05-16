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
  UserLoginSchema,
  SetPasswordSchema,
  VerifyResetOtpSchema,
  ResetPasswordSchema,
  findUserByIdentifier,
} from "./helpers.js";
import { handleUnifiedLogin } from "./auth-common.js";

const router: IRouter = Router();

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login with phone/email and password
 *     description: Authenticate with username/email/phone and password. Returns JWT access token and refresh token.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [identifier, password]
 *             properties:
 *               identifier:
 *                 type: string
 *                 description: Phone number, email, or username
 *                 example: "03001234567"
 *               password:
 *                 type: string
 *                 format: password
 *                 example: "MyStr0ngP@ss"
 *               captchaToken:
 *                 type: string
 *                 description: reCAPTCHA v3 token (required when captcha is enabled)
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     token: { type: string, description: "JWT access token" }
 *                     refreshToken: { type: string }
 *                     user: { type: object }
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 *       429:
 *         description: Too many login attempts
 */
router.post("/login/username", loginLimiter, verifyCaptcha, sharedValidateBody(UserLoginSchema), handleUnifiedLogin);

router.post("/login", loginLimiter, verifyCaptcha, sharedValidateBody(UserLoginSchema), handleUnifiedLogin);

/* ══════════════════════════════════════════════════════════════
   POST /auth/login/verify-otp
   Verify the OTP sent after email/password login.
   Body: { tempToken: string, otp: string }
   Returns JWT token on success.
══════════════════════════════════════════════════════════════ */

router.post("/set-password", sharedValidateBody(SetPasswordSchema), async (req, res) => {
  try {
  /* Accept token from body OR Authorization: Bearer header */
  const authHeader = req.headers["authorization"] as string | undefined;
  const rawToken = req.body?.token || (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);
  const { password, currentPassword } = req.body;
  if (!rawToken || !password) { sendError(res, "Token and password required", 400); return; }

  const payload = verifyUserJwt(rawToken);
  if (!payload) { sendUnauthorized(res, "Invalid or expired token. Please log in again."); return; }
  const userId = payload.userId;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user)         { sendNotFound(res, "User not found"); return; }
  if (user.isBanned) { sendForbidden(res, "Account suspended. Contact support."); return; }
  if (!user.isActive){ sendForbidden(res, "Account inactive. Contact support."); return; }

  /* If user has a non-temporary password, ALWAYS require the current password — no bypass.
     If requirePasswordChange is true (admin set a temp password), skip current-password
     check to allow the user to change it on first login without knowing the old hash. */
  const isTempPasswordChange = user.requirePasswordChange === true;
  if (user.passwordHash && !isTempPasswordChange) {
    if (!currentPassword) {
      sendError(res, "Current password required to change password", 400); return;
    }
    if (!verifyPassword(currentPassword, user.passwordHash)) {
      sendUnauthorized(res, "Current password galat hai"); return;
    }
  }

  const check = validatePasswordStrength(password);
  if (!check.ok) { sendError(res, check.message, 400); return; }

  /* Bump tokenVersion to invalidate all outstanding JWTs on password change;
     also clear requirePasswordChange now that the user has set their own password. */
  await db.update(usersTable).set({
    passwordHash: hashPassword(password),
    requirePasswordChange: false,
    tokenVersion: sql`token_version + 1`,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, userId));
  writeAuthAuditLog("password_changed", { userId, ip: getClientIp(req), userAgent: req.headers["user-agent"] ?? undefined });
  sendSuccess(res, { success: true, message: "Password set ho gaya", requirePasswordChange: false });
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* isAuthMethodEnabled is now exported from @workspace/auth-utils/server
   so the same logic is shared with any future server-side helpers. */

/* ══════════════════════════════════════════════════════════════════════
   OTP Rate Limiter — per account (phone/email) + per IP address
   Uses rateLimitsTable with sliding window (resets after window expires).
   Keys: otp_acct:<identifier>  and  otp_ip:<ip>
══════════════════════════════════════════════════════════════════════ */

router.post("/forgot-password", verifyCaptcha, sharedValidateBody(forgotPasswordSchema), async (req, res) => {
  try {
  let { phone, email, identifier } = req.body;
  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  if (identifier && !phone && !email) {
    const resolved = await findUserByIdentifier(identifier);
    if (resolved.user) {
      if (resolved.idType === "phone") {
        phone = resolved.user.phone ?? undefined;
      } else if (resolved.idType === "email") {
        email = resolved.user.email ?? undefined;
      } else if (resolved.idType === "username") {
        if (resolved.user.email) {
          email = resolved.user.email ?? undefined;
        } else if (resolved.user.phone) {
          phone = resolved.user.phone ?? undefined;
        }
      }
    }
  }

  if (!phone && !email) {
    sendError(res, "Phone, email, or username is required", 400);
    return;
  }

  if (phone && !isAuthMethodEnabled(settings, "auth_phone_otp_enabled")) {
    sendForbidden(res, "Phone-based password reset is currently disabled");
    return;
  }
  if (email && !phone && !isAuthMethodEnabled(settings, "auth_email_otp_enabled")) {
    sendForbidden(res, "Email-based password reset is currently disabled");
    return;
  }

  let user;
  if (phone) {
    const canonPhone = canonicalizePhone(phone);
    const [found] = await db.select().from(usersTable).where(eq(usersTable.phone, canonPhone)).limit(1);
    user = found;
  } else {
    const normalized = email!.toLowerCase().trim();
    const [found] = await db.select().from(usersTable).where(eq(usersTable.email, normalized)).limit(1);
    user = found;
  }

  const isDev = process.env.NODE_ENV !== "production";
  if (!user) {
    sendSuccess(res, { message: "If an account exists, a reset code has been sent.", ...(isDev ? { hint: "No account found" } : {}) });
    return;
  }

  const forgotRole = user.roles ?? "customer";
  if (phone && !isAuthMethodEnabled(settings, "auth_phone_otp_enabled", forgotRole)) {
    sendForbidden(res, "Phone-based password reset is currently disabled for your account type.");
    return;
  }
  if (email && !phone && !isAuthMethodEnabled(settings, "auth_email_otp_enabled", forgotRole)) {
    sendForbidden(res, "Email-based password reset is currently disabled for your account type.");
    return;
  }

  if (user.isBanned) { sendForbidden(res, "Account suspended."); return; }
  if (!user.isActive) { sendForbidden(res, "Account inactive."); return; }

  const maxAttempts = parseInt(settings["security_login_max_attempts"] ?? "5", 10);
  const lockoutMinutes = parseInt(settings["security_lockout_minutes"] ?? "30", 10);
  const lockoutKey = `reset:${user.id}`;
  const lockout = await checkLockout(lockoutKey, maxAttempts, lockoutMinutes);
  if (lockout.locked) {
    sendTooManyRequests(res, `Too many attempts. Try again in ${lockout.minutesLeft} minute(s).`);
    return;
  }

  const otp = generateSecureOtp();
  const otpExpiry = new Date(Date.now() + AUTH_OTP_TTL_MS);

  const forgotLang = await getUserLanguage(user.id);

  if (phone) {
    await db.update(usersTable)
      .set({ otpCode: hashOtp(otp), otpExpiry, otpUsed: false, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id));

    const targetPhone = canonicalizePhone(phone);
    await sendOtpSMS(targetPhone, otp, settings, forgotLang);
    if (settings["integration_whatsapp"] === "on") {
      fireAndForget(
        sendWhatsAppOTP(targetPhone, otp, settings, forgotLang),
        "auth:whatsapp-otp:forgot-password",
        logger,
        { code: "AUTH_WHATSAPP_OTP_FAILED" },
      );
    }
  } else {
    await db.update(usersTable)
      .set({ emailOtpCode: hashOtp(otp), emailOtpExpiry: otpExpiry, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id));

    await sendPasswordResetEmail(email!, otp, user.name ?? undefined, forgotLang);
  }

  writeAuthAuditLog("forgot_password", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined });

  sendSuccess(res, {
    message: "If an account exists, a reset code has been sent.",
  });
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/verify-reset-otp
   Pre-verify the OTP before allowing the user to set a new password.
   Body: { phone?, email?, otp }
   Returns: { valid: true } or 400/422 with error
══════════════════════════════════════════════════════════════ */

router.post("/verify-reset-otp", otpLimiter, verifyCaptcha, sharedValidateBody(VerifyResetOtpSchema), async (req, res) => {
  try {
  let { phone, email, otp } = req.body;
  const ip = getClientIp(req);

  if (!otp || typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
    sendError(res, "OTP must be exactly 6 digits", 400);
    return;
  }
  if (!phone && !email) {
    sendError(res, "Phone or email is required", 400);
    return;
  }

  let user: (typeof usersTable.$inferSelect) | undefined;
  if (phone) {
    const canonPhone = canonicalizePhone(phone);
    const [found] = await db.select().from(usersTable).where(eq(usersTable.phone, canonPhone)).limit(1);
    user = found;
  } else {
    const normalized = (email as string).toLowerCase().trim();
    const [found] = await db.select().from(usersTable).where(eq(usersTable.email, normalized)).limit(1);
    user = found;
  }

  if (!user) {
    sendError(res, "Invalid or expired code", 422);
    return;
  }

  const hashed = hashOtp(otp);
  const now = new Date();

  if (phone) {
    if (!user.otpCode || user.otpCode !== hashed) {
      sendError(res, "Invalid verification code", 422);
      return;
    }
    if (!user.otpExpiry || user.otpExpiry < now) {
      sendError(res, "Verification code has expired. Please request a new one.", 422);
      return;
    }
    if (user.otpUsed) {
      sendError(res, "This code has already been used. Please request a new one.", 422);
      return;
    }
  } else {
    if (!user.emailOtpCode || user.emailOtpCode !== hashed) {
      sendError(res, "Invalid verification code", 422);
      return;
    }
    if (!user.emailOtpExpiry || user.emailOtpExpiry < now) {
      sendError(res, "Verification code has expired. Please request a new one.", 422);
      return;
    }
  }

  writeAuthAuditLog("verify_reset_otp", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined });
  sendSuccess(res, { valid: true });
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});


router.post("/reset-password", verifyCaptcha, sharedValidateBody(ResetPasswordSchema), async (req, res) => {
  try {
  let { phone, email, identifier, otp, newPassword, totpCode } = req.body;
  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  if (!otp || typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
    sendError(res, "OTP must be exactly 6 digits", 400);
    return;
  }
  if (!newPassword) {
    sendError(res, "New password is required", 400);
    return;
  }

  if (identifier && !phone && !email) {
    const resolved = await findUserByIdentifier(identifier);
    if (resolved.user) {
      if (resolved.idType === "phone") {
        phone = resolved.user.phone ?? undefined;
      } else if (resolved.idType === "email") {
        email = resolved.user.email ?? undefined;
      } else if (resolved.idType === "username") {
        if (resolved.user.email) {
          email = resolved.user.email ?? undefined;
        } else if (resolved.user.phone) {
          phone = resolved.user.phone ?? undefined;
        }
      }
    }
  }

  if (!phone && !email) {
    sendError(res, "Phone, email, or username is required", 400);
    return;
  }

  const pwCheck = validatePasswordStrength(newPassword);
  if (!pwCheck.ok) {
    sendError(res, pwCheck.message, 400);
    return;
  }

  let user;
  if (phone) {
    const canonPhone = canonicalizePhone(phone);
    const [found] = await db.select().from(usersTable).where(eq(usersTable.phone, canonPhone)).limit(1);
    user = found;
  } else {
    const normalized = email!.toLowerCase().trim();
    const [found] = await db.select().from(usersTable).where(eq(usersTable.email, normalized)).limit(1);
    user = found;
  }

  if (!user) {
    sendNotFound(res, "Account not found");
    return;
  }

  const userRole = user.roles ?? "customer";

  if (phone && !isAuthMethodEnabled(settings, "auth_phone_otp_enabled", userRole)) {
    sendForbidden(res, "Phone-based password reset is currently disabled for your account type.");
    return;
  }
  if (email && !phone && !isAuthMethodEnabled(settings, "auth_email_otp_enabled", userRole)) {
    sendForbidden(res, "Email-based password reset is currently disabled for your account type.");
    return;
  }

  if (user.isBanned) { sendForbidden(res, "Account suspended."); return; }

  const maxAttempts = parseInt(settings["security_login_max_attempts"] ?? "5", 10);
  const lockoutMinutes = parseInt(settings["security_lockout_minutes"] ?? "30", 10);
  const lockoutKey = `reset:${user.id}`;
  const lockout = await checkLockout(lockoutKey, maxAttempts, lockoutMinutes);
  if (lockout.locked) {
    sendTooManyRequests(res, `Too many attempts. Try again in ${lockout.minutesLeft} minute(s).`);
    return;
  }

  let otpValid = false;
  if (phone) {
    otpValid = user.otpCode === hashOtp(otp) && !user.otpUsed && user.otpExpiry != null && new Date() < user.otpExpiry;
  } else {
    otpValid = user.emailOtpCode === hashOtp(otp) && user.emailOtpExpiry != null && new Date() < user.emailOtpExpiry;
  }

  if (!otpValid) {
    await recordFailedAttempt(lockoutKey, maxAttempts, lockoutMinutes);
    addAuditEntry({ action: "reset_password_failed", ip, details: `Invalid OTP for password reset: ${user.id}`, result: "fail" });
    sendUnauthorized(res, "Invalid or expired OTP");
    return;
  }

  if (user.totpEnabled && isAuthMethodEnabled(settings, "auth_2fa_enabled", userRole)) {
    if (!totpCode) {
      sendErrorWithData(res, "Two-factor authentication code required", { requires2FA: true }, 400);
      return;
    }
    if (!/^\d{6}$/.test(totpCode)) {
      sendError(res, "TOTP code must be 6 digits", 400);
      return;
    }
    if (!user.totpSecret) {
      sendError(res, "2FA is not properly configured for this account. Please contact support.", 400);
      return;
    }
    const { verifyTotpCode } = await import("../../services/password.js");
    const decryptedSecret = decryptTotpSecret(user.totpSecret);
    if (!verifyTotpCode(decryptedSecret, totpCode)) {
      await recordFailedAttempt(lockoutKey, maxAttempts, lockoutMinutes);
      addAuditEntry({ action: "reset_password_2fa_failed", ip, details: `Invalid TOTP for password reset: ${user.id}`, result: "fail" });
      sendUnauthorized(res, "Invalid two-factor authentication code");
      return;
    }
  }

  await db.update(usersTable).set({
    passwordHash: hashPassword(newPassword),
    requirePasswordChange: false,
    otpCode: null,
    otpExpiry: null,
    otpUsed: true,
    emailOtpCode: null,
    emailOtpExpiry: null,
    tokenVersion: sql`token_version + 1`,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, user.id));

  await resetAttempts(lockoutKey);

  writeAuthAuditLog("password_reset", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined });

  sendSuccess(res, undefined, "Password has been reset successfully. Please login with your new password.");
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});


export default router;
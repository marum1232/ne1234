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
  SendMergeOtpSchema,
  MergeAccountSchema,
  extractAuthUser,
} from "./helpers.js";

const router: IRouter = Router();

router.post("/send-merge-otp", otpLimiter, sharedValidateBody(SendMergeOtpSchema), async (req, res) => {
  try {
  const auth = extractAuthUser(req);
  if (!auth) { sendUnauthorized(res, "Authentication required"); return; }

  const { identifier } = req.body;
  if (!identifier) { sendError(res, "Identifier is required", 400); return; }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  const looksLikePhone = /^[\d\s\-+()]{7,15}$/.test(identifier.trim());
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim());

  if (!looksLikePhone && !looksLikeEmail) {
    sendError(res, "Identifier must be a phone number or email address", 400);
    return;
  }

  if (looksLikePhone) {
    const phone = canonicalizePhone(identifier);
    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
    if (existing) { sendError(res, "This phone number is already linked to another account", 409); return; }
  } else {
    const email = identifier.trim().toLowerCase();
    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing) { sendError(res, "This email is already linked to another account", 409); return; }
  }

  const otp = generateSecureOtp();
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
  const normalizedIdentifier = looksLikePhone ? canonicalizePhone(identifier) : identifier.trim().toLowerCase();
  await db.update(usersTable).set({ mergeOtpCode: hashOtp(otp), mergeOtpExpiry: otpExpiry, pendingMergeIdentifier: normalizedIdentifier, updatedAt: new Date() }).where(eq(usersTable.id, auth.userId));

  if (looksLikePhone) {
    const phone = canonicalizePhone(identifier);
    const lang = await getUserLanguage(auth.userId);
    const whatsappEnabled = settings["integration_whatsapp"] === "on";
    let sent = false;
    if (whatsappEnabled) {
      const waResult = await sendWhatsAppOTP(phone, otp, settings, lang);
      if (waResult.sent) sent = true;
    }
    if (!sent) {
      const smsResult = await sendOtpSMS(phone, otp, settings, lang);
      sent = smsResult.sent;
    }
    const isDev = process.env.NODE_ENV !== "production";
    sendSuccess(res, undefined, "OTP sent to phone");
  } else {
    const email = identifier.trim().toLowerCase();
    const lang = await getUserLanguage(auth.userId);
    const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, auth.userId)).limit(1);
    await sendPasswordResetEmail(email, otp, user?.name ?? undefined, lang);
    sendSuccess(res, undefined, "OTP sent to email");
  }

  writeAuthAuditLog("merge_otp_sent", { ip, userId: auth.userId, userAgent: req.headers["user-agent"] ?? undefined, metadata: { identifier } });
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /auth/merge-account
   Link a new identifier (phone/email) to an authenticated user.
   Requires: valid JWT + OTP verification for the new identifier.
   Body: { identifier, otp }
───────────────────────────────────────────────────────────── */

router.post("/merge-account", sharedValidateBody(MergeAccountSchema), async (req, res) => {
  try {
  const auth = extractAuthUser(req);
  if (!auth) { sendUnauthorized(res, "Authentication required"); return; }

  const { identifier, otp } = req.body;
  if (!identifier || !otp) { sendError(res, "Identifier and OTP are required", 400); return; }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  const looksLikePhone = /^[\d\s\-+()]{7,15}$/.test(identifier.trim());
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim());

  if (!looksLikePhone && !looksLikeEmail) {
    sendError(res, "Identifier must be a phone number or email address", 400);
    return;
  }

  const [currentUser] = await db.select().from(usersTable).where(eq(usersTable.id, auth.userId)).limit(1);
  if (!currentUser) { sendNotFound(res, "User not found"); return; }

  const normalizedIdentifier = looksLikePhone ? canonicalizePhone(identifier) : identifier.trim().toLowerCase();

  if (currentUser.mergeOtpCode !== hashOtp(otp) || !currentUser.mergeOtpExpiry || currentUser.mergeOtpExpiry < new Date()) {
    sendError(res, "Invalid or expired OTP", 400);
    return;
  }

  if (currentUser.pendingMergeIdentifier !== normalizedIdentifier) {
    sendError(res, "OTP was not issued for this identifier", 400);
    return;
  }

  if (looksLikePhone) {
    const phone = normalizedIdentifier;
    if (currentUser.phone === phone) { sendError(res, "This phone is already linked to your account", 400); return; }

    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
    if (existing) { sendError(res, "This phone number is already linked to another account", 409); return; }

    await db.update(usersTable).set({ phone, encryptedPhone: tryEncrypt(phone), mergeOtpCode: null, mergeOtpExpiry: null, phoneVerified: true, pendingMergeIdentifier: null, updatedAt: new Date() }).where(eq(usersTable.id, auth.userId));

    writeAuthAuditLog("account_merge_phone", { ip, userId: auth.userId, userAgent: req.headers["user-agent"] ?? undefined, metadata: { phone } });
    sendSuccess(res, { success: true, message: "Phone number linked successfully", linked: "phone" });
  } else {
    const email = normalizedIdentifier;
    if (currentUser.email === email) { sendError(res, "This email is already linked to your account", 400); return; }

    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing) { sendError(res, "This email is already linked to another account", 409); return; }

    await db.update(usersTable).set({ email, encryptedEmail: tryEncrypt(email), mergeOtpCode: null, mergeOtpExpiry: null, emailVerified: true, pendingMergeIdentifier: null, updatedAt: new Date() }).where(eq(usersTable.id, auth.userId));

    writeAuthAuditLog("account_merge_email", { ip, userId: auth.userId, userAgent: req.headers["user-agent"] ?? undefined, metadata: { email } });
    sendSuccess(res, { success: true, message: "Email linked successfully", linked: "email" });
  }
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /auth/send-otp
   Atomically upsert user by phone — one account per number.
───────────────────────────────────────────────────────────── */

export default router;
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
import { t, type TranslationKey } from "@workspace/i18n";
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
  LoginVerifyOtpSchema,
  ChangePhoneRequestSchema,
  ChangePhoneConfirmSchema,
  checkAndIncrOtpRateLimit,
  extractAuthUser,
  isDeviceTrusted,
} from "./helpers.js";

const router: IRouter = Router();

router.post("/change-phone/request", sharedValidateBody(ChangePhoneRequestSchema), async (req, res) => {
  try {
  const auth = extractAuthUser(req);
  if (!auth) { sendUnauthorized(res, "Authentication required"); return; }

  const { newPhone } = req.body;
  if (!newPhone || typeof newPhone !== "string") {
    sendError(res, "New phone number is required", 400); return;
  }

  const phone = canonicalizePhone(newPhone);
  if (!/^3\d{9}$/.test(phone)) {
    sendError(res, "Invalid Pakistani phone number format", 400); return;
  }

  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
  if (existing) {
    sendError(res, "This phone number is already registered to another account", 409); return;
  }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();
  const otp = generateSecureOtp();
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

  await db.update(usersTable).set({
    mergeOtpCode: hashOtp(otp),
    mergeOtpExpiry: otpExpiry,
    pendingMergeIdentifier: phone,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, auth.userId));

  const lang = await getUserLanguage(auth.userId);
  const whatsappEnabled = settings["integration_whatsapp"] === "on";
  let sent = false;
  if (whatsappEnabled) {
    const waResult = await sendWhatsAppOTP(phone, otp, settings, lang);
    if (waResult.sent) sent = true;
  }
  if (!sent) {
    await sendOtpSMS(phone, otp, settings, lang);
  }

  writeAuthAuditLog("phone_change_requested", { userId: auth.userId, ip, userAgent: req.headers["user-agent"] as string, metadata: { newPhone: phone } });

  sendSuccess(res, undefined, "OTP sent to new phone number");
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/change-phone/confirm
   Verify OTP and update phone number.
   Body: { newPhone, otp }
══════════════════════════════════════════════════════════════ */

router.post("/change-phone/confirm", sharedValidateBody(ChangePhoneConfirmSchema), async (req, res) => {
  try {
  const auth = extractAuthUser(req);
  if (!auth) { sendUnauthorized(res, "Authentication required"); return; }

  const { newPhone, otp } = req.body;
  if (!newPhone || !otp) {
    sendError(res, "New phone number and OTP are required", 400); return;
  }

  const phone = canonicalizePhone(newPhone);
  const ip = getClientIp(req);

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, auth.userId)).limit(1);
  if (!user) { sendNotFound(res, "User not found"); return; }

  if (user.pendingMergeIdentifier !== phone) {
    sendError(res, "OTP was not requested for this phone number", 400); return;
  }

  if (user.mergeOtpCode !== hashOtp(otp) || !user.mergeOtpExpiry || user.mergeOtpExpiry < new Date()) {
    sendError(res, "Invalid or expired OTP", 400); return;
  }

  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
  if (existing) {
    sendError(res, "This phone number is already registered to another account", 409); return;
  }

  await db.update(usersTable).set({
    phone,
    phoneVerified: true,
    mergeOtpCode: null,
    mergeOtpExpiry: null,
    pendingMergeIdentifier: null,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, auth.userId));

  writeAuthAuditLog("phone_changed", { userId: auth.userId, ip, userAgent: req.headers["user-agent"] as string, metadata: { newPhone: phone } });

  sendSuccess(res, { success: true, message: "Phone number updated successfully", phone });
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /auth/login-history
   Return last 20 login attempts for authenticated user.
══════════════════════════════════════════════════════════════ */

export default router;
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
  MagicLinkSendSchema,
  MagicLinkVerifySchema,
  issueTokensForUser,
  isDeviceTrusted,
} from "./helpers.js";

const router: IRouter = Router();

const magicLinkRateMap = new Map<string, { count: number; windowStart: number }>();
  router.post("/magic-link/send", sharedValidateBody(MagicLinkSendSchema), async (req, res) => {
  try {
  const { email } = req.body;
  if (!email || !email.includes("@")) { sendError(res, "Valid email address required", 400); return; }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  if (!isAuthMethodEnabledStrict(settings, "auth_magic_link_enabled", "auth_magic_link")) {
    sendErrorWithData(res, "Magic link login is currently disabled.", { code: "AUTH_METHOD_DISABLED" }, 400); return;
  }

  const normalized = email.toLowerCase().trim();

  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const rlKey = `ml:${normalized}`;
  const rl = magicLinkRateMap.get(rlKey);
  if (rl && now - rl.windowStart < windowMs) {
    if (rl.count >= 3) {
      const waitMin = Math.ceil((rl.windowStart + windowMs - now) / 60000);
      sendTooManyRequests(res, `Too many magic link requests. Try again in ${waitMin} minute(s).`); return;
    }
    rl.count++;
  } else {
    magicLinkRateMap.set(rlKey, { count: 1, windowStart: now });
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalized)).limit(1);
  if (!user) {
    sendSuccess(res, undefined, "If an account exists with this email, a magic link has been sent."); return;
  }

  const effectiveMagicRole = user.roles ?? ((req.body?.role === "rider" || req.body?.role === "vendor") ? req.body.role : "customer");
  if (!isAuthMethodEnabledStrict(settings, "auth_magic_link_enabled", "auth_magic_link", effectiveMagicRole)) {
    sendErrorWithData(res, "Magic link login is currently disabled for your account type.", { code: "AUTH_METHOD_DISABLED" }, 400); return;
  }

  if (user.isBanned) { sendForbidden(res, "Account suspended"); return; }
  if (!user.isActive) { sendForbidden(res, "Account inactive"); return; }

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashPassword(rawToken);
  const magicLinkTtlMin = Math.max(5, parseInt(settings["auth_magic_link_ttl_min"] ?? "30", 10));
  const expiresAt = new Date(Date.now() + magicLinkTtlMin * 60 * 1000);

  await db.insert(magicLinkTokensTable).values({
    id: generateId(),
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  const magicLinkLang = await getUserLanguage(user.id);
  await sendMagicLinkEmail(normalized, rawToken, settings, magicLinkLang);

  addAuditEntry({ action: "magic_link_sent", ip, details: `Magic link sent to: ${normalized}`, result: "success" });
  writeAuthAuditLog("magic_link_sent", { ip, metadata: { email: normalized } });

  const isDevTokenLog = process.env.NODE_ENV === "development" && process.env["LOG_OTP"] === "1";
  sendSuccess(res, {
    message: "If an account exists with this email, a magic link has been sent.",
    ...(isDevTokenLog ? { token: rawToken } : {}),
  });
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/magic-link/verify
   Validate magic link token, handle 2FA guard.
   Body: { token, totpCode?, deviceFingerprint? }
══════════════════════════════════════════════════════════════ */

router.post("/magic-link/verify", sharedValidateBody(MagicLinkVerifySchema), async (req, res) => {
  try {
  const { token, totpCode, deviceFingerprint } = req.body;
  if (!token) { sendError(res, "Token required", 400); return; }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  if (!isAuthMethodEnabledStrict(settings, "auth_magic_link_enabled", "auth_magic_link")) {
    sendErrorWithData(res, "Magic link login is currently disabled.", { code: "AUTH_METHOD_DISABLED" }, 400); return;
  }

  const allTokens = await db.select().from(magicLinkTokensTable)
    .where(sql`${magicLinkTokensTable.usedAt} IS NULL AND ${magicLinkTokensTable.expiresAt} > now()`)
    .limit(50);

  let matchedRow: typeof allTokens[0] | null = null;
  for (const row of allTokens) {
    if (verifyPassword(token, row.tokenHash)) { matchedRow = row; break; }
  }

  if (!matchedRow) {
    addSecurityEvent({ type: "magic_link_invalid", ip, details: "Invalid or expired magic link token", severity: "medium" });
    sendUnauthorized(res, "Invalid or expired magic link. Please request a new one."); return;
  }

  await db.update(magicLinkTokensTable).set({ usedAt: new Date() }).where(eq(magicLinkTokensTable.id, matchedRow.id));

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, matchedRow.userId)).limit(1);
  if (!user) { sendNotFound(res, "User not found"); return; }
  if (user.isBanned) { sendForbidden(res, "Account suspended"); return; }
  if (!user.isActive) { sendForbidden(res, "Account inactive"); return; }

  if (!isAuthMethodEnabledStrict(settings, "auth_magic_link_enabled", "auth_magic_link", user.roles ?? "customer")) {
    sendErrorWithData(res, "Magic link login is currently disabled for your account type.", { code: "AUTH_METHOD_DISABLED" }, 400); return;
  }

  if (user.totpEnabled && isAuthMethodEnabled(settings, "auth_2fa_enabled", user.roles ?? undefined)) {
    const trustedDays = parseInt(settings["auth_trusted_device_days"] ?? "30", 10);
    if (!isDeviceTrusted(user, deviceFingerprint ?? "", trustedDays)) {
      if (!totpCode) {
        const tempToken = sign2faChallengeToken(user.id, user.phone ?? "", user.roles ?? "customer", user.roles ?? "customer", "magic_link");
        sendSuccess(res, { requires2FA: true, tempToken, userId: user.id }); return;
      }
      const secret = decryptTotpSecret(user.totpSecret!);
      if (!verifyTotpToken(totpCode, secret)) {
        sendUnauthorized(res, "Invalid 2FA code"); return;
      }
    }
  }

  await db.update(usersTable).set({ emailVerified: true, updatedAt: new Date() }).where(eq(usersTable.id, user.id));

  addAuditEntry({ action: "magic_link_login", ip, details: `Magic link login: ${user.email ?? matchedRow.userId}`, result: "success" });
  const result = await issueTokensForUser(user, ip, "magic_link", req.headers["user-agent"] as string, req, res);
  sendSuccess(res, result);
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/change-phone/request
   Send OTP to a new phone number for phone change flow.
   Body: { newPhone }
══════════════════════════════════════════════════════════════ */

export default router;
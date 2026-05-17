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
import { checkLockout, recordFailedAttempt, resetAttempts, addSecurityEvent, getClientIp, getCachedSettings, signUserJwt, signAccessToken, sign2faChallengeToken, verify2faChallengeToken, generateRefreshToken, hashRefreshToken, isRefreshTokenValid, revokeRefreshToken, revokeAllUserRefreshTokens, verifyUserJwt, blacklistJti, writeAuthAuditLog, getRefreshTokenTtlDays, getAccessTokenTtlSec, verifyCaptcha, checkAvailableRateLimit } from "../../middleware/security.js";
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
import { AuditService } from "../../services/admin-audit.service.js";
import { handleLoginVerifyOtp } from "./otp-login-verify.js";
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

/**
 * @openapi
 * /auth/send-otp:
 *   post:
 *     tags: [Auth - OTP]
 *     summary: Send OTP to a phone number
 *     description: Send a one-time password via SMS, WhatsApp, or email. Used for login and registration flows.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone]
 *             properties:
 *               phone:
 *                 type: string
 *                 example: "03001234567"
 *                 description: Pakistani mobile number (03XXXXXXXXX format)
 *               preferredChannel:
 *                 type: string
 *                 enum: [sms, whatsapp, email]
 *                 description: Preferred delivery channel (optional, uses platform default if omitted)
 *               captchaToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     otpRequired: { type: boolean }
 *                     channel: { type: string, enum: [sms, whatsapp, email, auto_bypass] }
 *                     fallbackChannels: { type: array, items: { type: string } }
 *       400:
 *         description: Invalid phone number or OTP method disabled
 *       429:
 *         description: Rate limit or cooldown exceeded
 */
router.post("/send-otp", otpLimiter, verifyCaptcha, sharedValidateBody(sendOtpSchema), async (req, res) => {
  try {
  const rawPhone = req.body.phone;
  const deviceId = req.body.deviceId;
  const preferredChannel = req.body.preferredChannel;
  const phone = canonicalizePhone(rawPhone);

  if (!(await isValidCanonicalPhone(phone))) {
    sendErrorWithData(res, "Invalid phone number. Please enter a valid Pakistani mobile number (e.g. 03001234567).", { field: "phone" }, 400);
    return;
  }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  const otpEnabled = isAuthMethodEnabled(settings, "auth_phone_otp_enabled");

  /* ── Look up existing user (not exposed in response — only used server-side) ── */
  const existingUser = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.phone, phone))
    .limit(1);

  const effectiveRole = existingUser[0]?.roles ?? ((req.body.role === "rider" || req.body.role === "vendor") ? req.body.role : "customer");
  const otpEnabledForRole = isAuthMethodEnabled(settings, "auth_phone_otp_enabled", effectiveRole);

  /* ── Phone enumeration hardening ─────────────────────────────────────────
     Do NOT return distinguishable errors for banned accounts, Google-linked
     accounts, or registration-closed states — all of these would reveal
     whether a phone number is registered.  Enforcement of these rules happens
     inside /auth/verify-otp (after the caller has proven OTP ownership).

     Exceptions that are acceptable to surface at send-otp:
       • lockout  — rate-limit response, keyed on the phone, not on account existence
       • invalid phone format — rejected before DB lookup
     Everything else: silently write OTP to pending_otps and return generic success. ── */

  /* ── Check lockout before generating new OTP ── */
  const maxAttempts = parseInt(settings["security_login_max_attempts"] ?? "5", 10);
  const lockoutMinutes = parseInt(settings["security_lockout_minutes"] ?? "30", 10);
  const lockoutStatus = await checkLockout(phone, maxAttempts, lockoutMinutes);
  if (lockoutStatus.locked) {
    addSecurityEvent({ type: "locked_account_otp_request", ip, details: `OTP request for locked phone: ${phone}`, severity: "medium" });
    sendErrorWithData(res, `Account temporarily locked due to too many failed attempts. Please try again in ${lockoutStatus.minutesLeft} minute(s).`, { lockedMinutes: lockoutStatus.minutesLeft }, 429);
    return;
  }

  /* Log security events server-side without blocking the OTP flow */
  if (existingUser[0]?.isBanned) {
    addSecurityEvent({ type: "banned_user_otp_request", ip, details: `Banned user attempted OTP: ${phone}`, severity: "high" });
  }
  const existingGoogleId = existingUser[0]?.googleId;
  if (existingGoogleId && isAuthMethodEnabled(settings, "auth_google_enabled", existingUser[0]?.roles ?? effectiveRole)) {
    addSecurityEvent({ type: "otp_blocked_google_account", ip, details: `OTP attempt on Google-linked account: ${phone}`, severity: "low" });
  }

  /* ── Determine approval status for NEW users ── */
  const isNewUser = existingUser.length === 0;
  const requireApproval = (settings["user_require_approval"] ?? "off") === "on";
  const newUserApprovalStatus = isNewUser && requireApproval ? "pending" : "approved";

  /* ══ OTP DISABLED — return generic "use another method" without revealing account state ══ */
  if (!otpEnabled || !otpEnabledForRole) {
    sendErrorWithData(res, "Phone OTP is currently disabled. Please use another login method or contact support.", { code: "AUTH_METHOD_DISABLED" }, 400);
    return;
  }
  /* ── Per-phone OTP resend cooldown (60 s) — prevents SMS bombing ── */
  const otpCooldownMs = parseInt(settings["security_otp_cooldown_sec"] ?? "60", 10) * 1000;
  const existingOtpExpiry = existingUser[0]?.otpExpiry;
  if (existingOtpExpiry) {
    const otpValidityMs = AUTH_OTP_TTL_MS;
    const issuedAgoMs   = otpValidityMs - (existingOtpExpiry.getTime() - Date.now());
    if (issuedAgoMs < otpCooldownMs) {
      const waitSec = Math.ceil((otpCooldownMs - issuedAgoMs) / 1000);
      addSecurityEvent({ type: "otp_resend_throttle", ip, details: `OTP resend too soon for ${phone} — ${waitSec}s remaining`, severity: "low" });
      sendErrorWithData(res, `Please wait ${waitSec} second(s) before requesting a new OTP.`, { retryAfterSeconds: waitSec }, 429);
      return;
    }
  }

  /* ── Per-account + per-IP OTP rate limit (admin-configurable window) ── */
  const otpRateCheck = await checkAndIncrOtpRateLimit({ identifier: phone, ip, settings });
  if (otpRateCheck.blocked) {
    const label = otpRateCheck.reason === "ip"
      ? "Too many OTP requests from your network"
      : "Too many OTP requests for this account";
    addSecurityEvent({ type: "otp_rate_limit_exceeded", ip, details: `${label} (${phone}) — retry in ${otpRateCheck.retryAfterSeconds}s`, severity: "medium" });
    sendErrorWithData(res, `${label}. Please wait ${otpRateCheck.retryAfterSeconds} second(s) before trying again.`, { retryAfterSeconds: otpRateCheck.retryAfterSeconds }, 429);
    return;
  }

  /* ── Per-user bypass (HIGHEST PRIORITY): skip all delivery if bypass is active ──
     When an admin has set a bypass window for an existing user, the next
     verify-otp call will succeed regardless of OTP code. We must NOT send
     any notification (SMS/WhatsApp/email) — return a generic success response.
     This path is non-enumerating: we only short-circuit for existing users
     with a valid bypass, and the response shape is identical to normal flow. ── */
  const existingBypass = !isNewUser && existingUser[0]?.otpBypassUntil && existingUser[0].otpBypassUntil > new Date();
  if (existingBypass) {
    // no user notification — bypass is silent by admin design
    writeAuthAuditLog("otp_send_bypassed", { ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { phone } });
    const bypassUntil = existingUser[0]!.otpBypassUntil!;
    sendSuccess(res, {
      otpRequired: false,
      bypass: true,
      expiresAt: bypassUntil.toISOString(),
      message: (settings["otp_bypass_message"] as string | undefined) ?? null,
      channel: "sms",
      fallbackChannels: [],
    });
    return;
  }

  /* ── Global OTP bypass: when enabled in Danger Zone, skip OTP for all users ── */
  if (settings["security_otp_bypass"] === "on") {
    writeAuthAuditLog("otp_send_global_bypassed", { ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { phone } });
    sendSuccess(res, {
      otpRequired: false,
      bypass: true,
      expiresAt: null,
      message: (settings["otp_bypass_message"] as string | undefined) ?? null,
      channel: "sms",
      fallbackChannels: [],
    });
    return;
  }

  /* ── Timed admin global OTP disable: auto-pass (no OTP delivery) ── */
  const otpGlobalDisabledUntilStrSend = settings["otp_global_disabled_until"];
  if (otpGlobalDisabledUntilStrSend) {
    const otpGlobalDisabledUntilSend = new Date(otpGlobalDisabledUntilStrSend);
    if (otpGlobalDisabledUntilSend > new Date()) {
      writeAuthAuditLog("otp_send_global_bypassed", { ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { phone, reason: "timed_disable" } });
      sendSuccess(res, {
        otpRequired: false,
        bypass: true,
        expiresAt: otpGlobalDisabledUntilSend.toISOString(),
        message: (settings["otp_bypass_message"] as string | undefined) ?? null,
        channel: "sms",
        fallbackChannels: [],
      });
      return;
    }
  }

  /* ── OTP Whitelist bypass — use bypass code and skip real SMS delivery ── */
  const whitelistBypass = await getWhitelistBypass(phone);
  const otp       = whitelistBypass ?? generateSecureOtp();
  const otpExpiry = new Date(Date.now() + AUTH_OTP_TTL_MS);

  if (isNewUser) {
    /* NEW USERS: store OTP in pending_otps — do NOT create a users record yet.
       The users record is only created after OTP is successfully verified. */
    await db
      .insert(pendingOtpsTable)
      .values({ id: generateId(), phone, otpHash: hashOtp(otp), otpExpiry })
      .onConflictDoUpdate({
        target: pendingOtpsTable.phone,
        set: { otpHash: hashOtp(otp), otpExpiry, attempts: 0 },
      });
  } else {
    /* EXISTING USERS: update OTP in the users table (login / resend flow) */
    await db
      .update(usersTable)
      .set({ otpCode: hashOtp(otp), otpExpiry, otpUsed: false, updatedAt: new Date() })
      .where(eq(usersTable.phone, phone));
  }

  /* If whitelisted, skip SMS entirely and return bypass shape */
  if (whitelistBypass) {
    writeAuthAuditLog("otp_send_whitelist_bypass", { ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { phone } });
    sendSuccess(res, {
      otpRequired: false,
      bypass: true,
      expiresAt: null,
      message: (settings["otp_bypass_message"] as string | undefined) ?? "OTP verification is temporarily bypassed for your number.",
    });
    return;
  }

  if (process.env.NODE_ENV === "development" && process.env["LOG_OTP"] === "1") {
    logger.info({ phone, otp }, "OTP sent");
  }

  const otpUserId = existingUser[0]?.id;
  const otpLang = otpUserId ? await getUserLanguage(otpUserId) : await getPlatformDefaultLanguage();

  const whatsappEnabled = settings["integration_whatsapp"] === "on";
  const emailEnabled    = isAuthMethodEnabled(settings, "auth_email_otp_enabled", effectiveRole);
  const userEmail       = existingUser[0]?.email;

  let deliveryChannel = "none";
  let deliverySuccess = false;
  let deliveryProvider = "";
  const smsEnabled = isAuthMethodEnabled(settings, "auth_phone_otp_enabled", effectiveRole);
  const availableChannels: string[] = [];
  if (whatsappEnabled) availableChannels.push("whatsapp");
  if (smsEnabled) availableChannels.push("sms");
  if (emailEnabled && userEmail) availableChannels.push("email");

  const channelOrder: string[] = [];
  if (preferredChannel && availableChannels.includes(preferredChannel)) {
    channelOrder.push(preferredChannel);
    for (const ch of availableChannels) { if (ch !== preferredChannel) channelOrder.push(ch); }
  } else {
    /* Use admin-configured channel priority order if set */
    const adminPriorityRaw = settings["otp_channel_priority"];
    const adminPriority = adminPriorityRaw
      ? adminPriorityRaw.split(",").map((s: string) => s.trim()).filter(Boolean)
      : ["whatsapp", "sms", "email"];
    for (const ch of adminPriority) {
      if (ch === "whatsapp" && whatsappEnabled) channelOrder.push("whatsapp");
      else if (ch === "sms" && smsEnabled) channelOrder.push("sms");
      else if (ch === "email" && emailEnabled && userEmail) channelOrder.push("email");
    }
    /* Append any channels not covered by the admin order */
    if (!channelOrder.includes("whatsapp") && whatsappEnabled) channelOrder.push("whatsapp");
    if (!channelOrder.includes("sms") && smsEnabled) channelOrder.push("sms");
    if (!channelOrder.includes("email") && emailEnabled && userEmail) channelOrder.push("email");
  }

  /* ── Auto-bypass: no real delivery provider is configured ─────────────────
   * If none of SMS / WhatsApp / Email has working credentials, requiring OTP
   * would lock everyone out. We auto-bypass and log a warning so the admin
   * knows to configure a provider.
   * ----------------------------------------------------------------------- */
  const smsReady      = isSMSProviderConfigured(settings);
  const smsConsole    = isSMSConsoleActive(settings);   /* dev/staging fallback */
  const whatsappReady = isWhatsAppProviderConfigured(settings);
  const emailReady    = isEmailProviderConfigured(settings) && !!userEmail;

  /* Console mode counts as an active channel — OTP is logged to terminal */
  if (!smsReady && !smsConsole && !whatsappReady && !emailReady) {
    /* otp_require_when_no_provider = "on"  → block login (admin chose strict mode)
     * otp_require_when_no_provider = "off" (default) → auto-bypass               */
    const strictMode = settings["otp_require_when_no_provider"] === "on";
    if (strictMode) {
      logger.error({ phone }, "[OTP] No provider configured & strict mode ON — blocking login");
      writeAuthAuditLog("otp_send_no_provider", {
        ip,
        userAgent: req.headers["user-agent"] ?? undefined,
        metadata: { phone, reason: "no_provider_strict_block" },
      });
      sendErrorWithData(res, "OTP delivery is not configured. Please contact support.", { noProviderConfigured: true }, 503);
      return;
    }
    logger.warn({ phone }, "[OTP] No delivery provider configured — auto-bypassing OTP (bypass mode)");
    writeAuthAuditLog("otp_send_no_provider", {
      ip,
      userAgent: req.headers["user-agent"] ?? undefined,
      metadata: { phone, reason: "no_delivery_provider_bypass" },
    });
    sendSuccess(res, {
      otpRequired: false,
      message: "OTP sent successfully",
      channel: "auto_bypass",
      fallbackChannels: [],
      noProviderConfigured: true,
    });
    return;
  }

  for (const channel of channelOrder) {
    if (channel === "whatsapp") {
      const waResult = await sendWhatsAppOTP(phone, otp, settings, otpLang);
      if (waResult.sent) { deliveryChannel = "whatsapp"; deliverySuccess = true; deliveryProvider = "whatsapp"; break; }
      logger.warn({ err: waResult.error }, "WhatsApp OTP failed, trying next channel");
    } else if (channel === "sms") {
      const smsResult = await sendOtpSMS(phone, otp, settings, otpLang);
      if (smsResult.sent) { deliveryChannel = "sms"; deliverySuccess = true; deliveryProvider = smsResult.provider ?? "sms"; break; }
      logger.warn({ err: smsResult.error }, "SMS OTP failed, trying next channel");
    } else if (channel === "email" && userEmail) {
      const emailLang = otpUserId ? await getUserLanguage(otpUserId) : await getPlatformDefaultLanguage();
      const emailResult = await sendPasswordResetEmail(userEmail, otp, existingUser[0]?.name ?? undefined, emailLang);
      if (emailResult.sent) { deliveryChannel = "email"; deliverySuccess = true; deliveryProvider = "email"; break; }
      logger.warn({ err: emailResult.reason }, "Email OTP failed");
    }
  }

  const isDev = process.env.NODE_ENV !== "production";
  const isConsoleDelivery = deliveryProvider === "console";

  if (!deliverySuccess) {
    if (isDev) {
      deliveryChannel = "dev";
      /* Dev fallback: all channels failed — log OTP to server console only, never in API response */
      logger.warn({ phone, otp }, "[OTP DEV] All delivery channels failed — OTP logged here for testing only");
    } else {
      logger.error({ phone }, "All OTP delivery channels failed");
      sendErrorWithData(res, "Could not deliver OTP. Please try again or use an alternative login method.", { fallbackChannels: availableChannels }, 502);
      return;
    }
  }

  /* Dev console delivery: log OTP to server only — never expose in API response */
  if (isDev && isConsoleDelivery) {
    logger.info({ phone, otp }, "[OTP DEV] Console delivery — OTP logged here for testing only");
  }

  const fallbackChannels = availableChannels.filter(ch => ch !== deliveryChannel);

  writeAuthAuditLog("otp_sent", {
    userId: otpUserId,
    ip,
    userAgent: req.headers["user-agent"] ?? undefined,
    metadata: { phone, channel: deliveryChannel, result: "success" },
  });

  const response: Record<string, unknown> = {
    otpRequired: true,
    message: "OTP sent successfully",
    channel: deliveryChannel,
    fallbackChannels,
  };

  sendSuccess(res, response);
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /auth/verify-otp
   Validates the OTP, checks security settings, returns token.
───────────────────────────────────────────────────────────── */

/**
 * @openapi
 * /auth/verify-otp:
 *   post:
 *     tags: [Auth - OTP]
 *     summary: Verify OTP and login/register
 *     description: Verify the OTP received via SMS/WhatsApp/email. On success creates a new account (if first-time) or logs in the existing user and returns JWT tokens.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone, otp]
 *             properties:
 *               phone:
 *                 type: string
 *                 example: "03001234567"
 *               otp:
 *                 type: string
 *                 example: "123456"
 *                 description: 6-digit one-time password
 *               captchaToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP verified, tokens issued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     accessToken: { type: string }
 *                     refreshToken: { type: string }
 *                     user: { type: object }
 *                     isNewUser: { type: boolean }
 *       401:
 *         description: Invalid or expired OTP
 *       429:
 *         description: Too many failed attempts
 */
router.post("/verify-otp", otpLimiter, verifyCaptcha, sharedValidateBody(verifyOtpSchema), async (req, res) => {
  try {
  const phone = canonicalizePhone(req.body.phone);

  if (!(await isValidCanonicalPhone(phone))) {
    sendErrorWithData(res, "Invalid phone number format.", { field: "phone" }, 400);
    return;
  }

  const { otp } = req.body;

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  if (!isAuthMethodEnabled(settings, "auth_phone_otp_enabled")) {
    sendErrorWithData(res, "Phone OTP login is currently disabled.", { code: "AUTH_METHOD_DISABLED" }, 400);
    return;
  }

  /* ── Global admin OTP temp-disable: auto-pass while active ── */
  const otpGlobalDisabledUntilStr = settings["otp_global_disabled_until"];
  const otpGlobalDisabledUntil = otpGlobalDisabledUntilStr ? new Date(otpGlobalDisabledUntilStr) : null;
  const isTimedGlobalDisableActive = !!(otpGlobalDisabledUntil && otpGlobalDisabledUntil > new Date());
  if (isTimedGlobalDisableActive) {
    AuditService.log({ action: "user_login_timed_otp_disable_bypass", ip, details: `Timed global OTP disable active — auto-pass for ${phone}`, result: "success" });
    writeAuthAuditLog("login_global_otp_bypass", { ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { phone, reason: "timed_disable" } });
  }

  const maxAttempts    = parseInt(settings["security_login_max_attempts"] ?? "5", 10);
  const lockoutMinutes = parseInt(settings["security_lockout_minutes"]    ?? "30", 10);

  /* ── Lockout check ── (skipped during global disable for emergency recovery) */
  const lockoutStatus = await checkLockout(phone, maxAttempts, lockoutMinutes);
  if (lockoutStatus.locked && !isTimedGlobalDisableActive) {
    AuditService.log({ action: "verify_otp_lockout", ip, details: `Locked account OTP attempt: ${phone}`, result: "fail" });
    sendErrorWithData(res, `Account temporarily locked. Please try again in ${lockoutStatus.minutesLeft} minute(s).`, { lockedMinutes: lockoutStatus.minutesLeft }, 429);
    return;
  }

  /* ── Fetch user ── */
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.phone, phone))
    .limit(1);

  if (!user) {
    /* ── Cross-role new-user guard ──
       Riders and vendors must register through admin-controlled flows.
       Block auto-registration for these roles to prevent cross-app token issuance. */
    const requestedRoleForNew: string | undefined = typeof req.body?.role === "string" ? req.body.role : undefined;
    if (requestedRoleForNew && requestedRoleForNew !== "customer") {
      sendErrorWithData(res, `No ${requestedRoleForNew} account found for this phone number. Please use the correct registration process or contact admin.`, { wrongApp: true }, 403);
      return;
    }

    /* ── NEW USER REGISTRATION PATH ──────────────────────────────────────────
       If the phone is not yet in usersTable, check pendingOtpsTable.
       This prevents phantom account creation — user records are only
       created AFTER successful OTP verification, not at send-otp time. */
    const [pending] = await db
      .select()
      .from(pendingOtpsTable)
      .where(eq(pendingOtpsTable.phone, phone))
      .limit(1);

    /* During global disable or whitelist bypass, allow new-user registration even
       with no pending OTP row (send-otp short-circuited and never created a pending entry). */
    const whitelistBypassNew = await getWhitelistBypass(phone);
    const globalBypassForNew = settings["security_otp_bypass"] === "on" || isTimedGlobalDisableActive || whitelistBypassNew !== null;
    if (!pending && !globalBypassForNew) {
      sendNotFound(res, "User not found. Please request a new OTP.");
      return;
    }

    /* Verify OTP from pending_otps — skip validation if global or whitelist bypass is enabled */
    const otpValid = globalBypassForNew || !!(pending && pending.otpHash === hashOtp(otp) && new Date() < pending.otpExpiry);
    if (!otpValid) {
      /* Increment failed attempts */
      const newAttempts = (pending.attempts ?? 0) + 1;
      await db.update(pendingOtpsTable)
        .set({ attempts: newAttempts })
        .where(eq(pendingOtpsTable.phone, phone));

      if (newAttempts >= maxAttempts) {
        await db.delete(pendingOtpsTable).where(eq(pendingOtpsTable.phone, phone));
        sendErrorWithData(res, `Too many failed attempts. Please request a new OTP.`, { lockedMinutes: 1 }, 429);
      } else {
        const remaining = maxAttempts - newAttempts;
        sendErrorWithData(res, `Invalid OTP. ${remaining > 0 ? `${remaining} attempt(s) remaining.` : "Please request a new OTP."}`, { attemptsRemaining: Math.max(0, remaining) }, 401);
      }
      return;
    }

    /* OTP valid — create user record now */
    const requireApproval = (settings["user_require_approval"] ?? "off") === "on";
    const deviceId = req.body.deviceId as string | undefined;
    const newUserId = generateId();
    await db.insert(usersTable).values({
      id:             newUserId,
      phone,
      encryptedPhone: tryEncrypt(phone),

      roles:          "customer",
      walletBalance:  "0",
      phoneVerified:  true,
      isActive:       !requireApproval,
      approvalStatus: requireApproval ? "pending" : "approved",
      ...(deviceId ? { deviceId } : {}),
    });

    /* Delete from pending_otps */
    await db.delete(pendingOtpsTable).where(eq(pendingOtpsTable.phone, phone));
    writeAuthAuditLog("otp_verified_new_user", { userId: newUserId, ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { phone } });

    const signupBonus = parseFloat(settings["customer_signup_bonus"] ?? "0");
    if (signupBonus > 0) {
      await db.update(usersTable)
        .set({ walletBalance: sql`wallet_balance + ${signupBonus}` })
        .where(eq(usersTable.id, newUserId));
      await db.insert(walletTransactionsTable).values({
        id: generateId(), userId: newUserId, type: "bonus",
        amount: signupBonus.toFixed(2), description: "Welcome bonus — Thanks for joining!",
      });
    }

    const accessToken = signAccessToken(newUserId, phone, "customer", "customer", 0);
    const { raw: refreshRaw, hash: refreshHash } = generateRefreshToken();
    await db.insert(refreshTokensTable).values({
      id: generateId(), userId: newUserId, tokenHash: refreshHash,
      authMethod: "phone_otp", expiresAt: new Date(Date.now() + getRefreshTokenTtlDays() * 24 * 60 * 60 * 1000),
    });

    fireAndForget(
      emitWebhookEvent("user_registered", { userId: newUserId, phone, role: "customer", method: "phone_otp" }),
      "auth:webhook:user_registered:phone_otp",
      logger,
      { userId: newUserId, code: "WEBHOOK_EMIT" },
    );

    /* New phone-OTP signups always create customer accounts, but the rider app
       can also send role=rider on the verify-otp call. The cookie helper
       checks both body role AND user roles so this is safe either way. */
    setRiderRefreshCookie(req, res, refreshRaw, { roles: "customer" });

    sendSuccess(res, {
      accessToken,
      refreshToken: refreshRaw,
      expiresAt: new Date(Date.now() + getAccessTokenTtlSec() * 1000).toISOString(),
      user: { id: newUserId, phone, name: null, email: null, username: null, roles: "customer",
              walletBalance: signupBonus, isActive: !requireApproval, totpEnabled: false },
      ...(requireApproval ? { pendingApproval: true } : {}),
    });
    return;
  }

  if (!isAuthMethodEnabled(settings, "auth_phone_otp_enabled", user.roles ?? undefined)) {
    sendErrorWithData(res, "Phone OTP login is currently disabled for your account type.", { code: "AUTH_METHOD_DISABLED" }, 400);
    return;
  }

  /* ── Cross-role enforcement (non-customer apps only) ──
     For the customer app context, role enforcement happens AFTER OTP proof
     so the user can be offered the "add customer role" flow with a valid token.
     For rider/vendor apps, block immediately if role mismatch. ── */
  const requestedRole: string | undefined = typeof req.body?.role === "string" ? req.body.role : undefined;
  const appIdHeader = req.headers["x-app-id"] as string | undefined;
  const appIdQuery = req.query.appId as string | undefined;
  const isCustomerAppContext = requestedRole === "customer" || appIdHeader === "customer" || appIdQuery === "customer";

  if (requestedRole && !isCustomerAppContext) {
    const userRoles = (user.roles || "customer").split(",").map((r: string) => r.trim());
    if (!userRoles.includes(requestedRole)) {
      addSecurityEvent({ type: "cross_role_login_attempt", ip, userId: user.id, details: `User with roles [${user.roles}] tried to log in as ${requestedRole}`, severity: "high" });
      sendErrorWithData(res, "This account is not registered as a " + requestedRole + ". Please use the correct app.", { wrongApp: true }, 403);
      return;
    }
  }

  /* ── Banned check ── */
  if (user.isBanned) {
    addSecurityEvent({ type: "banned_login_attempt", ip, userId: user.id, details: `Banned user tried to verify OTP: ${phone}`, severity: "high" });
    sendForbidden(res, "Your account has been suspended. Please contact support.");
    return;
  }

  /* ── Google-linked account: block OTP hijack ─────────────────────────────
     Enforcement moved here from send-otp to avoid leaking account existence.
     After OTP proof the caller is bound to this phone, so we can safely tell
     them to use Google instead without disclosing anything about other numbers. ── */
  if (user.googleId && isAuthMethodEnabled(await getCachedSettings(), "auth_google_enabled", user.roles ?? undefined)) {
    addSecurityEvent({ type: "otp_hijack_google_account", ip, userId: user.id, details: `OTP verify attempted on Google-linked account: ${phone}`, severity: "medium" });
    sendErrorWithData(res, "This account is linked to Google. Please sign in with Google.", { useGoogle: true }, 403);
    return;
  }

  /* ── Inactive check ──
     Pending-approval accounts are isActive=false but should NOT be blocked here;
     they need to pass OTP validation and receive the pendingApproval=true response.
     Check approvalStatus directly — the setting only controls NEW users, not existing pending ones. ── */
  const isPendingApproval = user.approvalStatus === "pending";
  if (!user.isActive && !isPendingApproval) {
    sendForbidden(res, "Your account is currently inactive. Please contact support.");
    return;
  }

  /* ── Admin OTP bypass check ──
     If an admin has set a timed bypass window for this user and it has not yet
     expired, skip OTP code validation but continue through the full post-OTP
     pipeline (approval check, 2FA challenge, token issuance) so all other
     security gates remain enforced. Bypass expires naturally via timestamp.
     no user notification — bypass is silent by admin design. ── */
  const otpBypassActive = !!(user.otpBypassUntil && user.otpBypassUntil > new Date());

  /* ── Global OTP bypass: when enabled in Danger Zone or during timed disable, accept any code for all users ── */
  /* Also bypass when no real OTP delivery provider is configured — mirrors send-otp auto_bypass logic so
     environments without Twilio/SendGrid can still log in (same condition that makes send-otp return
     otpRequired:false / channel:"auto_bypass"). */
  const _hasRealOtpProvider = !!(process.env["TWILIO_ACCOUNT_SID"] || process.env["TWILIO_AUTH_TOKEN"] || process.env["SENDGRID_API_KEY"]);
  const _noProviderBypass = !_hasRealOtpProvider && settings["otp_require_when_no_provider"] !== "on";
  const globalOtpBypass = settings["security_otp_bypass"] === "on" || isTimedGlobalDisableActive || _noProviderBypass;

  /* ── Atomic OTP consumption via a single conditional UPDATE ──
     The WHERE clause combines: correct code + not-yet-used + not-expired.
     Concurrency-safe: only the first concurrent caller gets rows back. ── */
  const signupBonus = parseFloat(settings["customer_signup_bonus"] ?? "0");
  const now = new Date();

  let isActualFirstLogin = false;

  /* ── TOTP primary auth mode (otp_provider = "google_authenticator") ──────
     When the platform setting `otp_provider` is set to "google_authenticator",
     SMS delivery is skipped on the client side and the user enters a time-based
     code from their authenticator app. We verify it here — before the atomic
     SMS-OTP UPDATE — so we never touch the OTP hash columns in this path.
     Bypass flags (per-user, global, whitelist) still take precedence. ─────── */
  const otpProviderMode = settings["otp_provider"] ?? null;
  let totpPrimaryVerified = false;

  if (otpProviderMode === "google_authenticator" && !otpBypassActive && !globalOtpBypass) {
    const whitelistCode = await getWhitelistBypass(phone);
    if (!whitelistCode) {
      if (!user.totpEnabled || !user.totpSecret) {
        AuditService.log({ action: "verify_totp_not_enrolled", ip, details: `TOTP primary login for ${phone} — user not enrolled`, result: "fail" });
        sendErrorWithData(res, "Authenticator app is not set up for this account. Please contact your administrator.", { code: "TOTP_NOT_ENROLLED" }, 400);
        return;
      }
      const totpSecret = decryptTotpSecret(user.totpSecret);
      if (!verifyTotpToken(otp, totpSecret)) {
        const updated = await recordFailedAttempt(phone, maxAttempts, lockoutMinutes);
        const remaining = maxAttempts - updated.attempts;
        AuditService.log({ action: "verify_totp_failed", ip, details: `Wrong TOTP for ${phone}, attempt ${updated.attempts}/${maxAttempts}`, result: "fail" });
        writeAuthAuditLog("totp_failed", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined });
        if (updated.locked) {
          addSecurityEvent({ type: "account_locked", ip, userId: user.id, details: `Account locked after ${maxAttempts} failed TOTP attempts`, severity: "high" });
          sendErrorWithData(res, `Too many failed attempts. Account locked for ${lockoutMinutes} minutes.`, { lockedMinutes: lockoutMinutes }, 429);
        } else {
          sendErrorWithData(res, `Invalid authenticator code. ${remaining > 0 ? `${remaining} attempt(s) remaining before lockout.` : ""}`, { attemptsRemaining: Math.max(0, remaining) }, 401);
        }
        return;
      }
      await db.update(usersTable)
        .set({ phoneVerified: true, lastLoginAt: now, updatedAt: now })
        .where(eq(usersTable.phone, phone));
      AuditService.log({ action: "user_login_totp_primary", ip, details: `TOTP primary auth success for ${phone} (role: ${user.roles})`, result: "success" });
      writeAuthAuditLog("totp_primary_login", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { phone } });
      totpPrimaryVerified = true;
    }
  }

  {
    const consumed = await db.transaction(async (tx) => {
      /* ── TOTP primary: code already verified above — skip all OTP hash checks ── */
      if (totpPrimaryVerified) return { id: user.id, lastLoginAt: now };

      /* ── Per-user bypass path (HIGHEST PRIORITY): skip OTP code check, clear bypass flag (single-use) ── */
      if (otpBypassActive) {
        // no user notification — bypass is silent by admin design
        // clear bypass immediately after use so it cannot be reused
        await tx.update(usersTable)
          .set({ phoneVerified: true, lastLoginAt: now, updatedAt: now, otpBypassUntil: null })
          .where(eq(usersTable.phone, phone));
        AuditService.log({ action: "user_login_otp_bypass", ip, details: `OTP bypass login for ${phone} (bypass until ${user.otpBypassUntil!.toISOString()})`, result: "success" });
        writeAuthAuditLog("login_otp_bypass", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { phone } });
        return { id: user.id, lastLoginAt: now };
      }

      /* ── Global bypass path: accept any OTP code when global bypass is enabled ── */
      if (globalOtpBypass) {
        // no user notification — global bypass is silent by admin design
        await tx.update(usersTable)
          .set({ phoneVerified: true, lastLoginAt: now, updatedAt: now })
          .where(eq(usersTable.phone, phone));
        AuditService.log({ action: "user_login_global_otp_bypass", ip, details: `Global OTP bypass login for ${phone}`, result: "success" });
        /* Skip duplicate writeAuthAuditLog when timed disable already logged it above */
        if (!isTimedGlobalDisableActive) {
          writeAuthAuditLog("login_global_otp_bypass", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { phone } });
        }
        return { id: user.id, lastLoginAt: now };
      }

      /* ── Whitelist bypass path: accept any OTP code for whitelisted phones ── */
      const whitelistCode = await getWhitelistBypass(phone);
      if (whitelistCode !== null) {
        await tx.update(usersTable)
          .set({ phoneVerified: true, lastLoginAt: now, updatedAt: now })
          .where(eq(usersTable.phone, phone));
        AuditService.log({ action: "user_login_whitelist_bypass", ip, details: `Whitelist bypass login for ${phone}`, result: "success" });
        writeAuthAuditLog("login_whitelist_bypass", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { phone } });
        return { id: user.id, lastLoginAt: now };
      }

      /* Single atomic UPDATE: marks OTP as used ONLY if code matches, unused, and unexpired.
         Returns the row if consumed, empty if already used / wrong code / expired. */
      const rows = await tx
        .update(usersTable)
        .set({ otpCode: null, otpExpiry: null, otpUsed: true, phoneVerified: true, lastLoginAt: now })
        .where(and(
          eq(usersTable.phone, phone),
          eq(usersTable.otpCode, hashOtp(otp)),
          eq(usersTable.otpUsed, false),
          sql`otp_expiry > now()`,
        ))
        .returning({ id: usersTable.id, lastLoginAt: usersTable.lastLoginAt });

      if (rows.length === 0) return null;

      /* This is the first login if lastLoginAt was NULL before we set it now.
         We detect first login by checking if no prior refresh tokens exist. */
      const [existingToken] = await tx.select({ id: refreshTokensTable.id })
        .from(refreshTokensTable)
        .where(eq(refreshTokensTable.userId, rows[0]!.id))
        .limit(1);
      isActualFirstLogin = !existingToken;

      /* Credit signup bonus only on verified first login */
      if (isActualFirstLogin && signupBonus > 0) {
        await tx
          .update(usersTable)
          .set({ walletBalance: sql`wallet_balance + ${signupBonus}` })
          .where(eq(usersTable.id, rows[0]!.id));
        await tx.insert(walletTransactionsTable).values({
          id: generateId(), userId: rows[0]!.id, type: "bonus",
          amount: signupBonus.toFixed(2),
          description: `Welcome bonus — Thanks for joining AJKMart!`,
        });
        const bonusLang = await getUserLanguage(rows[0]!.id);
        await tx.insert(notificationsTable).values({
          id: generateId(), userId: rows[0]!.id,
          title: t("notifWelcomeBonusTitle" as TranslationKey, bonusLang),
          body: t("notifWelcomeBonusBody" as TranslationKey, bonusLang).replace("{amount}", String(signupBonus)),
          type: "wallet", icon: "gift-outline",
        });
      }

      return rows[0];
    });

    if (!consumed) {
      /* OTP was wrong, already used, or expired — determine reason from fresh row */
      const [fresh] = await db.select({ otpUsed: usersTable.otpUsed, otpExpiry: usersTable.otpExpiry })
        .from(usersTable).where(eq(usersTable.phone, phone)).limit(1);

      if (fresh?.otpUsed) {
        writeAuthAuditLog("otp_reuse_attempt", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined });
        sendUnauthorized(res, "This OTP has already been used. Please request a new one.");
      } else if (!fresh?.otpExpiry || new Date() > fresh.otpExpiry) {
        writeAuthAuditLog("otp_expired", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined });
        sendUnauthorized(res, "OTP expired. Please request a new one.");
      } else {
        const updated = await recordFailedAttempt(phone, maxAttempts, lockoutMinutes);
        const remaining = maxAttempts - updated.attempts;
        AuditService.log({ action: "verify_otp_failed", ip, details: `Wrong OTP for phone: ${phone}, attempt ${updated.attempts}/${maxAttempts}`, result: "fail" });
        writeAuthAuditLog("otp_failed", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined });
        if (updated.locked) {
          addSecurityEvent({ type: "account_locked", ip, userId: user.id, details: `Account locked after ${maxAttempts} failed OTP attempts`, severity: "high" });
          sendErrorWithData(res, `Too many failed attempts. Account locked for ${lockoutMinutes} minutes.`, { lockedMinutes: lockoutMinutes }, 429);
        } else {
          sendErrorWithData(res, `Invalid OTP. ${remaining > 0 ? `${remaining} attempt(s) remaining before lockout.` : "Next failure will lock your account."}`, { attemptsRemaining: Math.max(0, remaining) }, 401);
        }
      }
      return;
    }
  }

  await resetAttempts(phone);

  /* ── Re-fetch user to get latest data (wallet balance, name, etc.) ── */
  const [freshUser] = await db.select().from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
  const u = freshUser ?? user;

  /* ── Admin approval check ──
     approvalStatus is the source of truth; the setting only controls NEW user creation. ── */
  if (u.approvalStatus === "pending") {
    AuditService.log({ action: "user_login_pending", ip, details: `Pending approval login for phone: ${phone}`, result: "pending" });
    const accessToken = signAccessToken(u.id, phone, u.roles ?? "customer", u.roles ?? "customer", u.tokenVersion ?? 0);
    sendSuccess(res, {
      accessToken, pendingApproval: true,
      message: "Aapka account admin approval ke liye bheja gaya hai. Approve hone par aap login kar sakenge.",
      user: { id: u.id, phone: u.phone, name: u.name, role: u.roles, roles: u.roles, approvalStatus: "pending" },
    });
    return;
  }
  if (u.approvalStatus === "rejected") {
    sendErrorWithData(res, "Aapka account reject kar diya gaya hai. Admin se rabta karein.", { code: "APPROVAL_REJECTED", approvalStatus: "rejected", rejectionReason: u.approvalNote ?? null }, 403);
    return;
  }

  /* ── 2FA challenge ──
     Skip when TOTP was the primary auth factor — user already proved possession
     of their authenticator app; issuing a second TOTP challenge would be redundant. ── */
  if (!totpPrimaryVerified && u.totpEnabled && isAuthMethodEnabled(settings, "auth_2fa_enabled", u.roles ?? undefined)) {
    const deviceFingerprint = req.body.deviceFingerprint ?? "";
    const trustedDays = parseInt(settings["auth_trusted_device_days"] ?? "30", 10);
    if (!isDeviceTrusted(u, deviceFingerprint, trustedDays)) {
      const tempToken = sign2faChallengeToken(u.id, u.phone ?? "", u.roles ?? "customer", u.roles ?? "customer", "phone_otp");
      sendSuccess(res, { requires2FA: true, tempToken, userId: u.id }); return;
    }
  }

  AuditService.log({ action: "user_login", ip, details: `Successful login for phone: ${phone} (role: ${u.roles})`, result: "success" });
  writeAuthAuditLog("otp_verified", { userId: u.id, ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { phone, role: u.roles, method: "phone_otp", result: "success" } });
  writeAuthAuditLog("login_success", { userId: u.id, ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { phone, role: u.roles, method: "phone_otp" } });

  /* ── Issue short-lived access token + long-lived refresh token ── */
  const accessToken  = signAccessToken(u.id, phone, u.roles ?? "customer", u.roles ?? "customer", u.tokenVersion ?? 0);
  const { raw: refreshRaw, hash: refreshHash } = generateRefreshToken();
  const refreshExpiresAt = new Date(Date.now() + getRefreshTokenTtlDays() * 24 * 60 * 60 * 1000);

  await db.insert(refreshTokensTable).values({
    id:        generateId(),
    userId:    u.id,
    tokenHash: refreshHash,
    authMethod: "phone_otp",
    expiresAt: refreshExpiresAt,
  });

  /* Clean up expired refresh tokens for this user (housekeeping) */
  fireAndForget(
    db.delete(refreshTokensTable).where(and(eq(refreshTokensTable.userId, u.id), lt(refreshTokensTable.expiresAt, new Date()))),
    "auth:expired-token-cleanup:phone_otp",
    logger,
    { userId: u.id, code: "DB_CLEANUP" },
  );

  /* Set HttpOnly cookie for rider and vendor sessions. */
  setRiderRefreshCookie(req, res, refreshRaw, u);
  setVendorRefreshCookie(req, res, refreshRaw, u);

  /* ── Post-OTP customer app cross-role check ──
     If the customer app context was detected and the user doesn't have the
     customer role, return a token + canAddCustomerRole flag so the frontend
     can offer the "Add Customer Access" flow from the wrong-app screen. ── */
  const uRoles = (u.roles || "customer").split(",").map((r: string) => r.trim());
  if (isCustomerAppContext && !uRoles.includes("customer")) {
    addSecurityEvent({ type: "cross_role_login_attempt", ip, userId: u.id, details: `User with roles [${u.roles}] logged in to customer app context — offering add-role`, severity: "low" });
    sendSuccess(res, {
      accessToken,
      refreshToken: refreshRaw,
      expiresAt:    new Date(Date.now() + getAccessTokenTtlSec() * 1000).toISOString(),
      sessionDays:  getRefreshTokenTtlDays(),
      canAddCustomerRole: true,
      code: "cross_app_account",
      wrongApp: true,
      user: {
        id:            u.id,
        phone:         u.phone,
        name:          u.name,
        email:         u.email,
        username:      u.username,
        role:          u.roles,
        roles:         u.roles ?? "customer",
        avatar:        u.avatar,
        walletBalance: parseFloat(u.walletBalance ?? "0"),
        isActive:      u.isActive,
        cnic:          u.cnic,
        city:          u.city,
        totpEnabled:   u.totpEnabled ?? false,
        createdAt:     u.createdAt.toISOString(),
      },
    });
    return;
  }

  const currentTermsVersion = settings["terms_version"] ?? "";
  const requiresTermsAcceptance = currentTermsVersion
    ? (u.acceptedTermsVersion ?? null) !== currentTermsVersion
    : false;

  sendSuccess(res, {
    accessToken,
    refreshToken: refreshRaw,
    expiresAt:    new Date(Date.now() + getAccessTokenTtlSec() * 1000).toISOString(),
    sessionDays:  getRefreshTokenTtlDays(),
    requiresTermsAcceptance,
    user: {
      id:            u.id,
      phone:         u.phone,
      name:          u.name,
      email:         u.email,
      username:      u.username,
      role:          u.roles,
      roles:         u.roles ?? "customer",
      avatar:        u.avatar,
      walletBalance: parseFloat(u.walletBalance ?? "0"),
      isActive:      u.isActive,
      cnic:          u.cnic,
      city:          u.city,
      totpEnabled:   u.totpEnabled ?? false,
      acceptedTermsVersion: u.acceptedTermsVersion ?? null,
      createdAt:     u.createdAt.toISOString(),
    },
  });
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* POST /auth/login/verify-otp — handler extracted to otp-login-verify.ts */
router.post("/login/verify-otp", otpLimiter, sharedValidateBody(LoginVerifyOtpSchema), handleLoginVerifyOtp);

/* ══════════════════════════════════════════════════════════════
   POST /auth/complete-profile
   Set name, email, username, password for first-time setup.
   Requires valid JWT. Body: { token, name, email?, username?, password? }
══════════════════════════════════════════════════════════════ */

export default router;

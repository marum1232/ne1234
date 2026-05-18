import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import { rotateRefreshToken, invalidateTokenFamily } from "../../services/auth/tokenRotation.js";
import { z } from "zod";
import { db } from "@workspace/db";
import { usersTable, walletTransactionsTable, notificationsTable, refreshTokensTable, magicLinkTokensTable, rateLimitsTable, pendingOtpsTable, userSessionsTable, loginHistoryTable, vendorProfilesTable, riderProfilesTable, totpRecoveryCodesTable, userTotpSetupTable } from "@workspace/db/schema";
import { eq, and, sql, lt, or, desc, ilike, isNull } from "drizzle-orm";
import { generateId } from "../../lib/id.js";
import { getPlatformSettings } from "../admin.js";
import { emitWebhookEvent } from "../../lib/webhook-emitter.js";
import { fireAndForget } from "../../lib/fireAndForget.js";
import {
  checkLockout,
  recordFailedAttempt,
  resetAttempts,
  addAuditEntry,
  addSecurityEvent,
  getClientIp,
  getCachedSettings,
  signUserJwt,
  signAccessToken,
  sign2faChallengeToken,
  verify2faChallengeToken,
  generateRefreshToken,
  hashRefreshToken,
  isRefreshTokenValid,
  revokeRefreshToken,
  revokeAllUserRefreshTokens,
  verifyUserJwt,
  blacklistJti,
  writeAuthAuditLog,
  REFRESH_TOKEN_TTL_DAYS,
  getRefreshTokenTtlDays,
  ACCESS_TOKEN_TTL_SEC,
  getAccessTokenTtlSec,
  verifyCaptcha,
  checkAvailableRateLimit,
} from "../../middleware/security.js";
import { sendOtpSMS, isSMSProviderConfigured, isSMSConsoleActive } from "../../services/sms.js";
import { sendOtpWithFailover, getWhitelistBypass } from "../../services/smsGateway.js";
import { sendWhatsAppOTP, isWhatsAppProviderConfigured } from "../../services/whatsapp.js";
import { randomBytes, createHash, randomInt } from "crypto";
import { hashPassword, verifyPassword, validatePasswordStrength, generateSecureOtp } from "../../services/password.js";
import { generateTotpSecret, verifyTotpToken, generateQRCodeDataURL, getTotpUri, encryptTotpSecret, decryptTotpSecret } from "../../services/totp.js";
import { sendVerificationEmail, sendPasswordResetEmail, sendMagicLinkEmail, alertNewVendor, isEmailProviderConfigured } from "../../services/email.js";
import { encrypt, decrypt, isEncryptionAvailable } from "../../lib/crypto/encryption.js";
import { getUserLanguage, getPlatformDefaultLanguage } from "../../lib/getUserLanguage.js";
import { t } from "@workspace/i18n";
import { logger } from "../../lib/logger.js";
import { sendError, sendErrorWithData, sendUnauthorized, sendForbidden, sendNotFound, sendInternalError, sendTooManyRequests, sendSuccess, sendCreated } from "../../lib/response.js";
import { clearSpoofHits } from "../rider/index.js";
import { canonicalizePhone } from "@workspace/phone-utils";
import { isAuthMethodEnabled, isAuthMethodEnabledStrict } from "@workspace/auth-utils/server";
import { validateBody as sharedValidateBody } from "../../middleware/validate.js";
import { authLimiter, loginLimiter, otpLimiter } from "../../middleware/rate-limit.js";
import {
  SendOtpSchema,
  VerifyOtpSchema,
  UserLoginSchema,
  SendMergeOtpSchema,
  MergeAccountSchema,
  VendorRegisterSchema,
  SendEmailOtpSchema,
  VerifyEmailOtpSchema,
  LoginVerifyOtpSchema,
  CompleteProfileSchema,
  SetPasswordSchema,
  SocialGoogleSchema,
  SocialFacebookSchema,
  TotpCodeSchema,
  TwoFaVerifySchema,
  TwoFaRecoverySchema,
  TrustDeviceSchema,
  MagicLinkSendSchema,
  VerifyResetOtpSchema,
  ResetPasswordSchema,
  EmailRegisterSchema,
  LogoutSchema,
  ValidateTokenSchema,
  CheckAvailableSchema,
  MagicLinkVerifySchema,
  ChangePhoneRequestSchema,
  ChangePhoneConfirmSchema,
  LinkGoogleSchema,
  LinkFacebookSchema,
  FirebaseVerifySchema,
} from "./helpers.js";
import {
  RIDER_REFRESH_COOKIE,
  RIDER_REFRESH_COOKIE_PATH,
  VENDOR_REFRESH_COOKIE,
  VENDOR_REFRESH_COOKIE_PATH,
  hashOtp,
  normalizeVehicleTypeForStorage,
  generateVerificationToken,
  hashVerificationToken,
  isValidCanonicalPhone,
  isRiderSession,
  shouldUseSecureCookie,
  setRiderRefreshCookie,
  clearRiderRefreshCookie,
  setVendorRefreshCookie,
  clearVendorRefreshCookie,
  findUserByIdentifier,
  isDeviceTrusted,
} from "./helpers.js";

/* OTP rate limiting is handled per-account + per-IP inside the route handler
   using the admin-configurable settings (security_otp_max_per_phone,
   security_otp_max_per_ip, security_otp_window_min) via checkAndIncrOtpRateLimit(). */

/* ── OTP TTL ─────────────────────────────────────────────────
   All auth OTPs (phone, email, forgot-password) expire in 5 minutes.
   Account-merge OTPs use a longer 10-minute window.
   ──────────────────────────────────────────────────────────── */
const AUTH_OTP_TTL_MS = 5 * 60 * 1000;

/* ── Auth Zod schemas ─────────────────────────────────────────
   All schemas are imported from ./helpers.js so only one source
   of truth exists. Duplicate local definitions were removed. ── */
import {
  checkIdentifierSchema,
  phoneSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  registerSchema,
  isVendorSession,
  tryEncrypt,
  decryptPii,
} from "./helpers.js";



/* ── Pending TOTP secrets — two-phase setup, NOT written to users table until verified ──
   When a user calls GET /auth/2fa/setup we generate a secret and store it in
   the user_totp_setup table (TTL 10 minutes). The DB write to users.totp_secret
   only happens after the user successfully verifies their first TOTP code in
   POST /auth/2fa/verify-setup (or /totp/enable). This prevents a half-initialised
   secret from persisting on the user record when they abandon setup. */
const PENDING_TOTP_TTL_MS = 10 * 60 * 1000;

async function storePendingTotpSecret(userId: string, secret: string, encryptedSecret: string): Promise<void> {
  await db.insert(userTotpSetupTable).values({
    id: generateId(),
    userId,
    secret,
    encryptedSecret,
  }).onConflictDoUpdate({
    target: userTotpSetupTable.userId,
    set: { secret, encryptedSecret, createdAt: new Date() },
  });
}

async function getPendingTotpSecret(userId: string): Promise<{ secret: string; encryptedSecret: string } | null> {
  const [row] = await db
    .select()
    .from(userTotpSetupTable)
    .where(eq(userTotpSetupTable.userId, userId))
    .limit(1);
  if (!row) return null;
  const ageMs = Date.now() - row.createdAt.getTime();
  if (ageMs > PENDING_TOTP_TTL_MS) {
    await db.delete(userTotpSetupTable).where(eq(userTotpSetupTable.userId, userId));
    return null;
  }
  return { secret: row.secret, encryptedSecret: row.encryptedSecret };
}

async function deletePendingTotpSecret(userId: string): Promise<void> {
  await db.delete(userTotpSetupTable).where(eq(userTotpSetupTable.userId, userId));
}

/* Periodic cleanup of expired pending TOTP secrets */
setInterval(() => {
  const cutoff = new Date(Date.now() - PENDING_TOTP_TTL_MS);
  db.delete(userTotpSetupTable).where(sql`${userTotpSetupTable.createdAt} < ${cutoff}`).catch((err) => {
    logger.error("[pendingTotpCleanup] Failed to prune expired secrets:", err);
  });
}, 5 * 60 * 1000);


export async function handleRefreshToken(req: Request, res: any) {
  /* Deterministically select the HttpOnly refresh cookie based on the app
     context signalled by the client via the X-App header (sent by vendor and
     rider builds). Falls back to body token for legacy/non-cookie clients.
     Cookie always wins over body to prevent accidental bypass. */
  const appHint = typeof req.headers["x-app"] === "string"
    ? (req.headers["x-app"] as string).toLowerCase()
    : "";
  const refreshCookies = (req.cookies && typeof req.cookies === "object")
    ? (req.cookies as Record<string, string>)
    : {};
  let cookieToken: string | undefined;
  if (appHint === "vendor") {
    cookieToken = refreshCookies[VENDOR_REFRESH_COOKIE] || refreshCookies[RIDER_REFRESH_COOKIE];
  } else {
    /* Rider (explicit or legacy default) */
    cookieToken = refreshCookies[RIDER_REFRESH_COOKIE] || refreshCookies[VENDOR_REFRESH_COOKIE];
  }
  /* Refresh tokens must arrive as HttpOnly cookies only. Body token submission
     is rejected unconditionally — in all environments — to prevent accidental
     token leakage via request logs, browser history, or CORS. */
  const ip = getClientIp(req);

  if (!cookieToken || cookieToken.length < 10) {
    sendError(res, "Refresh token required. Please log in again.", 401);
    return;
  }

  return doRefresh(cookieToken, ip, req, res);
}

export async function doRefresh(refreshToken: string, ip: string, req: Request, res: any) {
  const tokenHash = hashRefreshToken(refreshToken);

  /* ── Token family replay detection ── */
  let rt: typeof import("@workspace/db/schema").refreshTokensTable.$inferSelect;
  try {
    const { detectAndInvalidateFamily, TokenFamilyBreachError } = await import("../../services/auth/tokenRotation.js");
    rt = await detectAndInvalidateFamily(tokenHash);
  } catch (err: any) {
    if (err?.name === "TokenFamilyBreachError") {
      writeAuthAuditLog("token_family_breach", { userId: err.userId, ip, userAgent: req.headers["user-agent"] ?? undefined });
      sendUnauthorized(res, "Security breach detected. All sessions revoked. Please log in again.");
      return;
    }
    /* Token not found */
    writeAuthAuditLog("refresh_failed_not_found", { ip, userAgent: req.headers["user-agent"] ?? undefined });
    sendUnauthorized(res, "Invalid refresh token. Please log in again.");
    return;
  }

  /* Token reuse detected: already revoked but someone is trying to use it again.
     Invalidate the entire token family (possible token theft). */
  if (rt.revoked || rt.revokedAt) {
    if (rt.tokenFamilyId) {
      await invalidateTokenFamily(rt.tokenFamilyId, rt.userId, "SUSPICIOUS_FAMILY_REUSE", ip);
    } else {
      await revokeAllUserRefreshTokens(rt.userId, "REUSE_DETECTED");
    }
    writeAuthAuditLog("refresh_token_reuse", { userId: rt.userId, ip, userAgent: req.headers["user-agent"] ?? undefined });
    addSecurityEvent({ type: "refresh_token_reuse", ip, userId: rt.userId, details: "Refresh token reuse detected — token family invalidated", severity: "high" });
    sendUnauthorized(res, "Session invalidated for security. Please log in again.");
    return;
  }

  if (new Date() > rt.expiresAt) {
    await revokeRefreshToken(tokenHash, "EXPIRED");
    writeAuthAuditLog("refresh_token_expired", { userId: rt.userId, ip });
    sendUnauthorized(res, "Session expired. Please log in again.");
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, rt.userId)).limit(1);
  if (!user || user.isBanned || !user.isActive) {
    await revokeRefreshToken(tokenHash, "USER_UNAVAILABLE");
    sendUnauthorized(res, "Account not available. Please log in again.");
    return;
  }

  const settings = await getCachedSettings();
  const userRole = user.roles ?? "customer";

  const methodToSettingsKey: Record<string, string> = {
    phone_otp:      "auth_phone_otp_enabled",
    email_otp:      "auth_email_otp_enabled",
    password:       "auth_username_password_enabled",
    social_google:  "auth_google_enabled",
    social_facebook:"auth_facebook_enabled",
    magic_link:     "auth_magic_link_enabled",
  };

  const originalMethod = rt.authMethod;
  if (originalMethod && methodToSettingsKey[originalMethod]) {
    const settingsKey = methodToSettingsKey[originalMethod]!;
    const legacyKeys: Record<string, string> = {
      social_google:   "auth_social_google",
      social_facebook: "auth_social_facebook",
      magic_link:      "auth_magic_link",
    };
    const legacyKey = legacyKeys[originalMethod];
    const isEnabled = legacyKey
      ? isAuthMethodEnabledStrict(settings, settingsKey, legacyKey, userRole)
      : isAuthMethodEnabled(settings, settingsKey, userRole);
    if (!isEnabled) {
      await revokeRefreshToken(tokenHash, "AUTH_METHOD_DISABLED");
      sendForbidden(res, "Your login method has been disabled. Please log in again using an available method.");
      return;
    }
  } else {
    await revokeRefreshToken(tokenHash, "UNKNOWN_METHOD");
    sendForbidden(res, "Session expired. Please log in again.");
    return;
  }

  /* Rotate: revoke old token, issue new access + refresh token via the
     tokenRotation service which also handles token-family tracking. */
  const rotation = await rotateRefreshToken(
    rt,
    { id: user.id, phone: user.phone ?? null, roles: user.roles ?? null, tokenVersion: user.tokenVersion ?? null },
    ip,
  );

  writeAuthAuditLog("token_refresh", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined });

  /* Re-issue HttpOnly cookies with the rotated refresh token. The session
     checks use stored user roles (not req.body.role) so these fire correctly
     for refresh requests, which carry no role hint. */
  setRiderRefreshCookie(req, res, rotation.refreshToken, user);
  setVendorRefreshCookie(req, res, rotation.refreshToken, user);

  sendSuccess(res, {
    token:        rotation.accessToken,
    refreshToken: rotation.refreshToken,
    expiresAt:    rotation.expiresAt,
  });
}

export async function handleUnifiedLogin(req: Request, res: any) {
  const identifier = ((req.body.identifier || req.body.username) ?? "").trim();
  const password: string = req.body.password;
  if (!identifier) { sendError(res, "Identifier and password required", 400); return; }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  if (!isAuthMethodEnabled(settings, "auth_username_password_enabled")) {
    sendErrorWithData(res, "Password login is currently disabled.", { code: "GATEWAY_DISABLED" }, 400);
    return;
  }

  const { user, idType, lookupKey } = await findUserByIdentifier(identifier);

  const lockoutEnabled = (settings["security_lockout_enabled"] ?? "on") === "on";
  const maxAttempts = parseInt(settings["security_login_max_attempts"] ?? "5", 10);
  const lockoutMinutes = parseInt(settings["security_lockout_minutes"] ?? "30", 10);

  const lockoutKey = user ? `uid:${user.id}` : lookupKey;

  if (lockoutEnabled) {
    const lockout = await checkLockout(lockoutKey, maxAttempts, lockoutMinutes);
    if (lockout.locked) {
      sendTooManyRequests(res, `Account locked. Try again in ${lockout.minutesLeft} minute(s).`); return;
    }
  }

  if (!user || !user.passwordHash) {
    if (lockoutEnabled) await recordFailedAttempt(lockoutKey, maxAttempts, lockoutMinutes);
    addAuditEntry({ action: "unified_login_failed", ip, details: `Not found or no password (${idType}): ${lookupKey}`, result: "fail" });
    sendUnauthorized(res, "Invalid credentials"); return;
  }

  if (!isAuthMethodEnabled(settings, "auth_username_password_enabled", user.roles ?? "customer")) {
    sendForbidden(res, "Password login is currently disabled for your account type.");
    return;
  }

  /* ── Cross-role enforcement ── */
  const requestedRoleLogin: string | undefined = req.body.role;
  if (requestedRoleLogin) {
    const userRolesLogin = (user.roles || "customer").split(",").map((r: string) => r.trim());
    if (!userRolesLogin.includes(requestedRoleLogin)) {
      addSecurityEvent({ type: "cross_role_login_attempt", ip, userId: user.id, details: `User with roles [${user.roles}] tried to log in as ${requestedRoleLogin}`, severity: "high" });
      sendErrorWithData(res, "This account is not registered as a " + requestedRoleLogin + ". Please use the correct app.", { wrongApp: true }, 403); return;
    }
  }

  if (user.isBanned) { sendForbidden(res, "Account suspended. Contact support."); return; }
  const isPendingApproval = user.approvalStatus === "pending";
  if (!user.isActive && !isPendingApproval) { sendForbidden(res, "Account inactive. Contact support."); return; }

  const passwordOk = verifyPassword(password, user.passwordHash);
  if (!passwordOk) {
    /* recordFailedAttempt is a no-op when admin toggle security_lockout_enabled='off' */
    const updated = await recordFailedAttempt(lockoutKey, maxAttempts, lockoutMinutes);
    addAuditEntry({ action: "unified_login_failed", ip, details: `Wrong password (${idType}): ${lookupKey}`, result: "fail" });
    if (lockoutEnabled && updated.locked) {
      sendTooManyRequests(res, `Too many failed attempts. Locked for ${lockoutMinutes} minutes.`);
    } else if (lockoutEnabled) {
      sendUnauthorized(res, `Invalid credentials. ${Math.max(0, maxAttempts - updated.attempts)} attempt(s) remaining.`);
    } else {
      sendUnauthorized(res, "Invalid credentials");
    }
    return;
  }

  if (user.approvalStatus === "rejected") {
    sendErrorWithData(res, "Account rejected. Contact admin.", { code: "APPROVAL_REJECTED", approvalStatus: "rejected", rejectionReason: user.approvalNote ?? null }, 403); return;
  }

  await resetAttempts(lockoutKey);
  addAuditEntry({ action: "unified_login", ip, details: `Login via ${idType}: ${lookupKey}`, result: "success" });

  /* ── OTP step after password verification ────────────────────────────────
     Priority: per-user bypass (skip OTP) → global suspension (skip OTP) → require OTP.
     OTP is sent to console for demo; in production this would go via SMS/email. ── */
  const pwPerUserBypass = !!(user.otpBypassUntil && user.otpBypassUntil > new Date());
  const pwGlobalDisabledUntilStr = settings["otp_global_disabled_until"];
  const pwGlobalDisabledUntil = pwGlobalDisabledUntilStr ? new Date(pwGlobalDisabledUntilStr) : null;
  const pwGlobalSuspended = !!(pwGlobalDisabledUntil && pwGlobalDisabledUntil > new Date());
  /* production guard — danger bypass is NEVER honoured in production, matching
     the same guard applied to the OTP verify path in otp.ts.  An operator who
     inadvertently sets security_otp_bypass=on in prod must not gain a bypass. */
  const pwDangerBypass =
    settings["security_otp_bypass"] === "on" && process.env.NODE_ENV !== "production";
  const skipLoginOtp = pwPerUserBypass || pwGlobalSuspended || pwDangerBypass;

  if (!skipLoginOtp) {
    const loginOtp = generateSecureOtp();
    const loginOtpExpiry = new Date(Date.now() + 5 * 60 * 1000);
    await db.update(usersTable)
      .set({ otpCode: hashOtp(loginOtp), otpExpiry: loginOtpExpiry, otpUsed: false, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id));
    if (process.env.NODE_ENV !== 'production') {
      logger.info(`\n[AUTH:OTP] ====== LOGIN OTP ======`);
      logger.info(`[AUTH:OTP] User: ${lookupKey}`);
      logger.info(`[AUTH:OTP] OTP Code: ${loginOtp}`);
      logger.info(`[AUTH:OTP] Expires: ${loginOtpExpiry.toISOString()}`);
      logger.info(`[AUTH:OTP] =======================\n`);
    }
    writeAuthAuditLog("otp_sent", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { method: "password_login", channel: "console" } });
    const tempToken = sign2faChallengeToken(user.id, user.phone ?? user.email ?? "", user.roles ?? "customer", user.roles ?? "customer", "password_otp");
    sendSuccess(res, { requiresOtp: true, tempToken, userId: user.id, message: "OTP sent — check server console" });
    return;
  }

  if (pwPerUserBypass) {
    writeAuthAuditLog("login_otp_bypass", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { method: "password", reason: "per_user_bypass" } });
  } else if (pwGlobalSuspended || pwDangerBypass) {
    writeAuthAuditLog("login_global_otp_bypass", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { method: "password", reason: pwGlobalSuspended ? "global_suspension" : "danger_zone" } });
  }

  await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));

  if (user.totpEnabled && isAuthMethodEnabled(settings, "auth_2fa_enabled", user.roles ?? undefined)) {
    const deviceFingerprint = req.body.deviceFingerprint ?? "";
    const trustedDays = parseInt(settings["auth_trusted_device_days"] ?? "30", 10);
    if (!isDeviceTrusted(user, deviceFingerprint, trustedDays)) {
      const tempToken = sign2faChallengeToken(user.id, user.phone ?? "", user.roles ?? "customer", user.roles ?? "customer", "password");
      sendSuccess(res, { requires2FA: true, tempToken, userId: user.id }); return;
    }
  }

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
  await db.insert(refreshTokensTable).values({ id: generateId(), userId: user.id, tokenHash: refreshHash, authMethod: "password", expiresAt: refreshExpiresAt });
  fireAndForget(
    db.delete(refreshTokensTable).where(and(eq(refreshTokensTable.userId, user.id), lt(refreshTokensTable.expiresAt, new Date()))),
    "auth:expired-token-cleanup:password_login",
    logger,
    { userId: user.id, code: "DB_CLEANUP" },
  );

  setRiderRefreshCookie(req, res, refreshRaw, user);
  setVendorRefreshCookie(req, res, refreshRaw, user);

  writeAuthAuditLog("login_success", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { method: `password_${idType}`, identifier: lookupKey } });

  sendSuccess(res, {
    token:        accessToken,
    refreshToken: refreshRaw,
    expiresAt,
    sessionDays:  getRefreshTokenTtlDays(),
    pendingApproval: false,
    identifierType: idType,
    requirePasswordChange: user.requirePasswordChange ?? false,
    user: { id: user.id, phone: decryptPii(user.encryptedPhone, user.phone), name: user.name, email: decryptPii(user.encryptedEmail, user.email), username: user.username, role: user.roles, roles: user.roles, avatar: user.avatar, walletBalance: parseFloat(user.walletBalance ?? "0"), emailVerified: user.emailVerified ?? false, phoneVerified: user.phoneVerified ?? false },
  });
}

export async function consumeRecoveryCode(
  user: { id: string; backupCodes: string | null },
  backupCode: string,
  ip: string,
  sourcePath: string,
): Promise<{ codesRemaining: number } | { error: string; status: number }> {
  const unusedRows = await db.select()
    .from(totpRecoveryCodesTable)
    .where(and(eq(totpRecoveryCodesTable.userId, user.id), isNull(totpRecoveryCodesTable.usedAt)));

  const useNewTable = unusedRows.length > 0;

  if (useNewTable) {
    let matchedRow: typeof unusedRows[number] | null = null;
    for (const row of unusedRows) {
      if (verifyPassword(backupCode, row.codeHash)) { matchedRow = row; break; }
    }
    if (!matchedRow) {
      addSecurityEvent({ type: "2fa_recovery_failed", ip, userId: user.id, details: `Invalid recovery code attempt via ${sourcePath}`, severity: "high" });
      return { error: "Invalid recovery code", status: 401 };
    }
    /* Atomic consume: UPDATE with AND used_at IS NULL — concurrent racing requests
       get empty RETURNING (the row is already marked used), guaranteeing single-use. */
    const consumed = await db.update(totpRecoveryCodesTable)
      .set({ usedAt: new Date() })
      .where(and(eq(totpRecoveryCodesTable.id, matchedRow.id), isNull(totpRecoveryCodesTable.usedAt)))
      .returning({ id: totpRecoveryCodesTable.id });
    if (consumed.length === 0) {
      addSecurityEvent({ type: "2fa_recovery_failed", ip, userId: user.id, details: `Recovery code already consumed (concurrent attempt) via ${sourcePath}`, severity: "high" });
      return { error: "Invalid recovery code", status: 401 };
    }
    const codesRemaining = unusedRows.length - 1;
    writeAuthAuditLog("2fa_recovery_used", { userId: user.id, ip, userAgent: "", metadata: { codesRemaining, path: sourcePath } });
    addAuditEntry({ action: "2fa_recovery_used", ip, details: `Recovery code used for user ${user.id} via ${sourcePath}, ${codesRemaining} remaining`, result: "success" });
    return { codesRemaining };
  } else {
    /* Legacy JSON fallback: honour codes stored in users.backupCodes before the migration */
    if (!user.backupCodes) {
      addSecurityEvent({ type: "2fa_recovery_no_codes", ip, userId: user.id, details: `No recovery codes (table empty, JSON null) via ${sourcePath}`, severity: "high" });
      return { error: "All recovery codes have been used. Please contact an administrator to regain access.", status: 400 };
    }
    let legacyStoredCodes: string[] = [];
    try { legacyStoredCodes = JSON.parse(user.backupCodes); if (!Array.isArray(legacyStoredCodes)) legacyStoredCodes = []; } catch (err) { logger.debug({ error: err instanceof Error ? err.message : String(err) }, '[fn] parse fallback'); legacyStoredCodes = []; }
    if (legacyStoredCodes.length === 0) {
      addSecurityEvent({ type: "2fa_recovery_no_codes", ip, userId: user.id, details: `All legacy recovery codes exhausted via ${sourcePath}`, severity: "high" });
      return { error: "All recovery codes have been used. Please contact an administrator to regain access.", status: 400 };
    }
    let matchIdx = -1;
    for (let i = 0; i < legacyStoredCodes.length; i++) {
      if (verifyPassword(backupCode, legacyStoredCodes[i]!)) { matchIdx = i; break; }
    }
    if (matchIdx === -1) {
      addSecurityEvent({ type: "2fa_recovery_failed", ip, userId: user.id, details: `Invalid legacy backup code via ${sourcePath}`, severity: "high" });
      return { error: "Invalid recovery code", status: 401 };
    }
    legacyStoredCodes.splice(matchIdx, 1);
    /* Migrate remaining hashes into the new table, then clear the deprecated JSON column */
    if (legacyStoredCodes.length > 0) {
      await db.insert(totpRecoveryCodesTable).values(
        legacyStoredCodes.map(hash => ({ id: generateId(), userId: user.id, codeHash: hash }))
      );
    }
    await db.update(usersTable).set({ backupCodes: null, updatedAt: new Date() }).where(eq(usersTable.id, user.id));
    const codesRemaining = legacyStoredCodes.length;
    writeAuthAuditLog("2fa_recovery_used", { userId: user.id, ip, userAgent: "", metadata: { codesRemaining, legacyPath: true, path: sourcePath } });
    addAuditEntry({ action: "2fa_recovery_used", ip, details: `Legacy recovery code used for user ${user.id} via ${sourcePath}, migrated ${codesRemaining} remaining`, result: "success" });
    return { codesRemaining };
  }
}

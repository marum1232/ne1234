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
  TotpCodeSchema,
  TwoFaVerifySchema,
  TwoFaRecoverySchema,
  TrustDeviceSchema,
  issueTokensForUser,
  storePendingTotpSecret,
  getPendingTotpSecret,
  deletePendingTotpSecret,
  extractAuthUser,
} from "./helpers.js";
import { consumeRecoveryCode } from "./auth-common.js";

const router: IRouter = Router();

router.get("/2fa/setup", async (req, res) => {
  try {
  const auth = extractAuthUser(req);
  if (!auth) { sendUnauthorized(res, "Authentication required"); return; }

  const settings = await getCachedSettings();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, auth.userId)).limit(1);
  if (!user) { sendNotFound(res, "User not found"); return; }

  if (!isAuthMethodEnabled(settings, "auth_2fa_enabled", user.roles ?? undefined)) {
    sendForbidden(res, "Two-factor authentication is currently disabled"); return;
  }
  if (user.totpEnabled) { sendError(res, "2FA is already enabled", 409); return; }

  const secret = generateTotpSecret();
  const label = user.email ?? user.phone ?? user.name ?? auth.userId;
  const uri = getTotpUri(secret, label);

  /* Two-phase setup: store the secret in memory only (NOT in the database).
     The DB write happens in /auth/2fa/verify-setup only after the user
     successfully verifies their first TOTP code. This prevents an unverified
     secret from persisting in the DB when the user abandons setup. */
  const encryptedSecret = encryptTotpSecret(secret);
  await storePendingTotpSecret(auth.userId, secret, encryptedSecret);

  let qrDataUrl: string | null = null;
  try { qrDataUrl = await generateQRCodeDataURL(secret, label); } catch (err) { logger.error("[2fa/setup] QR code generation failed:", err); }

  sendSuccess(res, { secret, uri, qrDataUrl });
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/2fa/verify-setup
   Confirm first TOTP code, activate 2FA, return backup codes.
   Body: { code }
══════════════════════════════════════════════════════════════ */

router.post("/2fa/verify-setup", sharedValidateBody(TotpCodeSchema), async (req, res) => {
  try {
  const auth = extractAuthUser(req);
  if (!auth) { sendUnauthorized(res, "Authentication required"); return; }

  const { code } = req.body;
  if (!code) { sendError(res, "TOTP code required", 400); return; }

  const settings = await getCachedSettings();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, auth.userId)).limit(1);
  if (!user) { sendNotFound(res, "User not found"); return; }

  if (!isAuthMethodEnabled(settings, "auth_2fa_enabled", user.roles ?? undefined)) {
    sendForbidden(res, "Two-factor authentication is currently disabled"); return;
  }
  if (user.totpEnabled) { sendError(res, "2FA is already enabled", 409); return; }

  /* Two-phase setup: read pending secret from the user_totp_setup table (set by /auth/2fa/setup).
     If not found the setup step was never called (or the TTL expired). */
  const pendingEntry = await getPendingTotpSecret(auth.userId);
  if (!pendingEntry) {
    sendError(res, "Please call /auth/2fa/setup first (setup session expired or not started)", 400); return;
  }

  const secret = pendingEntry.secret;
  if (!verifyTotpToken(code, secret)) {
    sendUnauthorized(res, "Invalid TOTP code. Please try again."); return;
  }

  /* Verification succeeded — now write the encrypted secret to the database. */
  await db.update(usersTable).set({ totpSecret: pendingEntry.encryptedSecret, updatedAt: new Date() }).where(eq(usersTable.id, auth.userId));
  await deletePendingTotpSecret(auth.userId);

  /* Generate 8 single-use recovery codes and store them as individual rows in
     totp_recovery_codes (bcrypt-hashed). We delete any stale rows from a previous
     enrollment first (idempotent re-enrollment). */
  const backupCodes: string[] = [];
  const codeRows: { id: string; userId: string; codeHash: string }[] = [];
  for (let i = 0; i < 8; i++) {
    const raw = crypto.randomBytes(4).toString("hex");
    backupCodes.push(raw);
    codeRows.push({ id: generateId(), userId: auth.userId, codeHash: hashPassword(raw) });
  }

  await db.delete(totpRecoveryCodesTable).where(eq(totpRecoveryCodesTable.userId, auth.userId));
  await db.insert(totpRecoveryCodesTable).values(codeRows);

  await db.update(usersTable).set({
    totpEnabled: true,
    backupCodes: null, /* deprecated — codes are now stored in totp_recovery_codes */
    updatedAt: new Date(),
  }).where(eq(usersTable.id, auth.userId));

  const ip = getClientIp(req);
  writeAuthAuditLog("2fa_enabled", { userId: auth.userId, ip, userAgent: req.headers["user-agent"] as string });
  addAuditEntry({ action: "2fa_enabled", ip, details: `2FA enabled for user ${auth.userId}`, result: "success" });

  sendSuccess(res, { success: true, backupCodes, message: "2FA activated. Save your backup codes securely — they cannot be shown again." });
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/totp/enable
   Canonical TOTP activation endpoint — confirms the first valid
   TOTP code, marks 2FA active, generates 8 single-use recovery
   codes stored in totp_recovery_codes (bcrypt-hashed), and
   returns them once in plaintext for the user to save.

   Body: { code }
   Auth: Bearer token (authenticated user)

   Functionally identical to POST /auth/2fa/verify-setup (which
   is kept as the backward-compatible alias). Clients should
   prefer this canonical path going forward.
══════════════════════════════════════════════════════════════ */

router.post("/totp/enable", sharedValidateBody(TotpCodeSchema), async (req, res) => {
  try {
  const auth = extractAuthUser(req);
  if (!auth) { sendUnauthorized(res, "Authentication required"); return; }

  const { code } = req.body;
  if (!code) { sendError(res, "TOTP code required", 400); return; }

  const settings = await getCachedSettings();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, auth.userId)).limit(1);
  if (!user) { sendNotFound(res, "User not found"); return; }

  if (!isAuthMethodEnabled(settings, "auth_2fa_enabled", user.roles ?? undefined)) {
    sendForbidden(res, "Two-factor authentication is currently disabled"); return;
  }
  if (user.totpEnabled) { sendError(res, "2FA is already enabled", 409); return; }

  /* Two-phase setup: read pending secret from the user_totp_setup table (set by /auth/2fa/setup).
     This is the canonical enable endpoint — the DB write only happens here after
     the user verifies their first code, never during setup. */
  const pendingEntryEnable = await getPendingTotpSecret(auth.userId);
  if (!pendingEntryEnable) {
    sendError(res, "Please call /auth/2fa/setup first to obtain a TOTP secret (setup session expired or not started)", 400); return;
  }

  const secret = pendingEntryEnable.secret;
  if (!verifyTotpToken(code, secret)) {
    sendUnauthorized(res, "Invalid TOTP code. Please try again."); return;
  }

  /* Verification succeeded — write encrypted secret to the database now. */
  await db.update(usersTable).set({ totpSecret: pendingEntryEnable.encryptedSecret, updatedAt: new Date() }).where(eq(usersTable.id, auth.userId));
  await deletePendingTotpSecret(auth.userId);

  /* Generate 8 single-use recovery codes and store them as individual rows in
     totp_recovery_codes (bcrypt-hashed). Delete any stale rows from a previous
     incomplete enrollment first (idempotent). */
  const backupCodes: string[] = [];
  const codeRows: { id: string; userId: string; codeHash: string }[] = [];
  for (let i = 0; i < 8; i++) {
    const raw = crypto.randomBytes(4).toString("hex");
    backupCodes.push(raw);
    codeRows.push({ id: generateId(), userId: auth.userId, codeHash: hashPassword(raw) });
  }

  await db.delete(totpRecoveryCodesTable).where(eq(totpRecoveryCodesTable.userId, auth.userId));
  await db.insert(totpRecoveryCodesTable).values(codeRows);

  await db.update(usersTable).set({
    totpEnabled: true,
    backupCodes: null, /* deprecated — codes now stored in totp_recovery_codes */
    updatedAt: new Date(),
  }).where(eq(usersTable.id, auth.userId));

  const ip = getClientIp(req);
  writeAuthAuditLog("2fa_enabled", { userId: auth.userId, ip, userAgent: req.headers["user-agent"] as string });
  addAuditEntry({ action: "2fa_enabled", ip, details: `2FA enabled for user ${auth.userId} via /auth/totp/enable`, result: "success" });

  sendSuccess(res, { success: true, backupCodes, message: "2FA activated. Save your backup codes securely — they cannot be shown again." });
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/2fa/verify
   Verify TOTP code during login flow.
   Body: { tempToken, code, deviceFingerprint? }
══════════════════════════════════════════════════════════════ */

router.post("/2fa/verify", sharedValidateBody(TwoFaVerifySchema), async (req, res) => {
  try {
  const { tempToken, code, deviceFingerprint } = req.body;
  if (!tempToken || !code) { sendError(res, "tempToken and code required", 400); return; }

  const challengePayload = verify2faChallengeToken(tempToken);
  if (!challengePayload) { sendUnauthorized(res, "Invalid or expired 2FA challenge token"); return; }

  const settings = await getCachedSettings();
  const ip = getClientIp(req);

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, challengePayload.userId)).limit(1);
  if (!user) { sendNotFound(res, "User not found"); return; }

  if (!isAuthMethodEnabled(settings, "auth_2fa_enabled", user.roles ?? undefined)) {
    sendForbidden(res, "Two-factor authentication has been disabled by admin."); return;
  }

  if (!user.totpEnabled || !user.totpSecret) { sendError(res, "2FA is not enabled", 400); return; }

  const secret = decryptTotpSecret(user.totpSecret);
  if (!verifyTotpToken(code, secret)) {
    addSecurityEvent({ type: "2fa_verify_failed", ip, userId: user.id, details: "Invalid 2FA code on login", severity: "medium" });
    sendUnauthorized(res, "Invalid 2FA code"); return;
  }

  writeAuthAuditLog("2fa_verified", { userId: user.id, ip, userAgent: req.headers["user-agent"] as string });
  const originalMethod = challengePayload.authMethod ?? "phone_otp";
  const result = await issueTokensForUser(user, ip, originalMethod, req.headers["user-agent"] as string, req, res);
  sendSuccess(res, result);
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/2fa/disable
   Disable 2FA for the authenticated user. Body: { code }
══════════════════════════════════════════════════════════════ */

router.post("/2fa/disable", sharedValidateBody(TotpCodeSchema), async (req, res) => {
  try {
  const auth = extractAuthUser(req);
  if (!auth) { sendUnauthorized(res, "Authentication required"); return; }

  const { code } = req.body;
  if (!code) { sendError(res, "TOTP code required to disable 2FA", 400); return; }

  const settings = await getCachedSettings();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, auth.userId)).limit(1);
  if (!user) { sendNotFound(res, "User not found"); return; }

  if (!isAuthMethodEnabled(settings, "auth_2fa_enabled", user.roles ?? undefined)) {
    sendForbidden(res, "Two-factor authentication has been disabled by admin."); return;
  }

  if (!user.totpEnabled || !user.totpSecret) { sendError(res, "2FA is not enabled", 400); return; }

  const secret = decryptTotpSecret(user.totpSecret);
  if (!verifyTotpToken(code, secret)) {
    sendUnauthorized(res, "Invalid TOTP code"); return;
  }

  await db.update(usersTable).set({
    totpEnabled: false, totpSecret: null, backupCodes: null, trustedDevices: null, updatedAt: new Date(),
  }).where(eq(usersTable.id, auth.userId));

  const ip = getClientIp(req);
  writeAuthAuditLog("2fa_disabled", { userId: auth.userId, ip, userAgent: req.headers["user-agent"] as string });
  addAuditEntry({ action: "2fa_disabled", ip, details: `2FA disabled by user ${auth.userId}`, result: "success" });

  sendSuccess(res, undefined, "Two-factor authentication has been disabled");
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* ══════════════════════════════════════════════════════════════
   consumeRecoveryCode — shared helper used by both recovery
   endpoints to validate, atomically consume, and audit a
   single-use TOTP recovery code.

   Returns:
     { codesRemaining: number } on success
     { error: string, status: number } on failure (caller sends response)

   New-table path: SELECT unused rows → bcrypt match → atomic UPDATE
     WHERE id = ? AND used_at IS NULL → empty RETURNING = already consumed
   Legacy path: read users.backupCodes JSON, match, migrate remainder
     into totp_recovery_codes on first use, clear the JSON column.
══════════════════════════════════════════════════════════════ */

router.post("/2fa/recovery", sharedValidateBody(TwoFaRecoverySchema), async (req, res) => {
  try {
  const { tempToken, backupCode } = req.body;
  if (!tempToken || !backupCode) { sendError(res, "tempToken and backupCode required", 400); return; }

  const challengePayload = verify2faChallengeToken(tempToken);
  if (!challengePayload) { sendUnauthorized(res, "Invalid or expired 2FA challenge token"); return; }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, challengePayload.userId)).limit(1);
  if (!user) { sendNotFound(res, "User not found"); return; }

  if (!isAuthMethodEnabled(settings, "auth_2fa_enabled", user.roles ?? undefined)) {
    sendForbidden(res, "Two-factor authentication has been disabled by admin."); return;
  }

  if (!user.totpEnabled) { sendError(res, "2FA is not enabled", 400); return; }

  const outcome = await consumeRecoveryCode(user, backupCode, ip, "/auth/2fa/recovery");
  if ("error" in outcome) { sendError(res, outcome.error, outcome.status); return; }

  const recoveryOrigMethod = challengePayload.authMethod ?? "phone_otp";
  const result = await issueTokensForUser(user, ip, recoveryOrigMethod, req.headers["user-agent"] as string, req, res);
  sendSuccess(res, { ...result, codesRemaining: outcome.codesRemaining });
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/totp/recover
   Alias for /auth/2fa/recovery — accepts a single-use backup/
   recovery code and issues a full session on success.
   Body: { tempToken, backupCode }

   This endpoint is the canonical TOTP lockout-recovery path.
   The underlying backup codes are generated at 2FA setup time,
   bcrypt-hashed, and stored as single-use tokens that are
   consumed on use.  Eight codes are issued per setup; running
   out requires admin intervention or 2FA re-enrollment.
══════════════════════════════════════════════════════════════ */

router.post("/totp/recover", sharedValidateBody(TwoFaRecoverySchema), async (req, res) => {
  try {
  /* Canonical TOTP lockout-recovery path — delegates to consumeRecoveryCode() shared
     helper which handles new-table atomic consume and legacy JSON fallback/migration. */
  const { tempToken, backupCode } = req.body;
  if (!tempToken || !backupCode) { sendError(res, "tempToken and backupCode required", 400); return; }

  const challengePayload = verify2faChallengeToken(tempToken);
  if (!challengePayload) { sendUnauthorized(res, "Invalid or expired 2FA challenge token"); return; }

  const ip = getClientIp(req);
  const settings = await getCachedSettings();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, challengePayload.userId)).limit(1);
  if (!user) { sendNotFound(res, "User not found"); return; }

  if (!isAuthMethodEnabled(settings, "auth_2fa_enabled", user.roles ?? undefined)) {
    sendForbidden(res, "Two-factor authentication has been disabled by admin."); return;
  }

  if (!user.totpEnabled) { sendError(res, "2FA is not enabled", 400); return; }

  const outcome = await consumeRecoveryCode(user, backupCode, ip, "/auth/totp/recover");
  if ("error" in outcome) { sendError(res, outcome.error, outcome.status); return; }

  const recoveryOrigMethod = challengePayload.authMethod ?? "phone_otp";
  const result = await issueTokensForUser(user, ip, recoveryOrigMethod, req.headers["user-agent"] as string, req, res);
  sendSuccess(res, { ...result, codesRemaining: outcome.codesRemaining });
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/2fa/trust-device
   Store device fingerprint for trusted device bypass.
   Body: { deviceFingerprint }
══════════════════════════════════════════════════════════════ */

router.post("/2fa/trust-device", sharedValidateBody(TrustDeviceSchema), async (req, res) => {
  try {
  const auth = extractAuthUser(req);
  if (!auth) { sendUnauthorized(res, "Authentication required"); return; }

  const { deviceFingerprint } = req.body;
  if (!deviceFingerprint || typeof deviceFingerprint !== "string" || deviceFingerprint.length < 8) {
    sendError(res, "Valid deviceFingerprint required (min 8 chars)", 400); return;
  }

  const settings = await getCachedSettings();
  const trustedDays = parseInt(settings["auth_trusted_device_days"] ?? "30", 10);

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, auth.userId)).limit(1);
  if (!user) { sendNotFound(res, "User not found"); return; }

  if (!isAuthMethodEnabled(settings, "auth_2fa_enabled", user.roles ?? undefined)) {
    sendForbidden(res, "Two-factor authentication has been disabled by admin."); return;
  }

  if (!user.totpEnabled) { sendError(res, "2FA is not enabled", 400); return; }

  let devices: Array<{ fp: string; expiresAt: number }> = [];
  try { if (user.trustedDevices) devices = JSON.parse(user.trustedDevices); } catch (err) { /* intentional: non-fatal guard */ void err; }

  const now = Date.now();
  devices = devices.filter(d => d.expiresAt > now && d.fp !== deviceFingerprint);
  devices.push({ fp: deviceFingerprint, expiresAt: now + trustedDays * 24 * 60 * 60 * 1000 });

  if (devices.length > 10) devices = devices.slice(-10);

  await db.update(usersTable).set({ trustedDevices: JSON.stringify(devices), updatedAt: new Date() }).where(eq(usersTable.id, auth.userId));

  const ip = getClientIp(req);
  writeAuthAuditLog("device_trusted", { userId: auth.userId, ip, userAgent: req.headers["user-agent"] as string });

  sendSuccess(res, { success: true, message: `Device trusted for ${trustedDays} days`, trustedDevices: devices.length });
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/magic-link/send
   Send a magic link to the user's email. Rate limited: 3 per email per 10 min.
   Body: { email }
══════════════════════════════════════════════════════════════ */

export default router;
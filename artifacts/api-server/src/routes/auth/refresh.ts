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
import { AuditService } from "../../services/admin-audit.service.js";
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
  LogoutSchema,
  ValidateTokenSchema,
  extractAuthUser,
} from "./helpers.js";
import { handleRefreshToken } from "./auth-common.js";

const router: IRouter = Router();

router.post("/validate-token", sharedValidateBody(ValidateTokenSchema), async (req, res) => {
  try {
  /* Support both body token and Authorization header */
  const authHeader = req.headers.authorization ?? "";
  const bodyToken  = req.body?.token ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : bodyToken;

  if (!token) { sendError(res, "token required", 400); return; }

  try {
    const payload = verifyUserJwt(token);
    if (!payload) { sendUnauthorized(res, "Invalid or expired token"); return; }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId)).limit(1);
    if (!user)         { sendUnauthorized(res, "User not found"); return; }
    if (user.isBanned) { sendForbidden(res, "Account suspended"); return; }
    if (!user.isActive){ sendForbidden(res, "Account inactive"); return; }

    if ((payload.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) {
      sendUnauthorized(res, "Token revoked"); return;
    }

    const expiresAt = payload.exp ? new Date(payload.exp * 1000).toISOString() : null;
    sendSuccess(res, { valid: true, expiresAt, userId: user.id, role: user.roles });
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    sendUnauthorized(res, "Token validation failed");
  }
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /auth/refresh
   Exchange a valid refresh token for a new access token.
   Body: { refreshToken }
   On success: returns { token, expiresAt }
   Refresh tokens are rotated on use (old one revoked, new one issued).
───────────────────────────────────────────────────────────── */

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Refresh the JWT access token
 *     description: Exchange a valid refresh token for a new access token. The refresh token is rotated on each use.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 description: The refresh token issued at login or last refresh
 *     responses:
 *       200:
 *         description: New access token issued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     token: { type: string, description: "New JWT access token" }
 *                     refreshToken: { type: string, description: "New refresh token (old one is revoked)" }
 *                     expiresAt: { type: string, format: date-time }
 *       401:
 *         description: Invalid or expired refresh token
 */
router.post("/refresh", sharedValidateBody(refreshTokenSchema), handleRefreshToken);

router.post("/refresh-token", sharedValidateBody(refreshTokenSchema), handleRefreshToken);

/* ─────────────────────────────────────────────────────────────
   POST /auth/logout
   Revokes the refresh token and clears OTP. Client must discard tokens.
───────────────────────────────────────────────────────────── */

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Logout and revoke tokens
 *     description: Revokes the provided refresh token and blacklists the current access token. Client must discard all tokens after this call.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 description: Refresh token to revoke (optional but recommended)
 *     responses:
 *       200:
 *         description: Logged out successfully
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiSuccess' }
 */
router.post("/logout", sharedValidateBody(LogoutSchema), async (req, res) => {
  try {
  const authHeader = req.headers["authorization"] as string | undefined;
  const tokenHeader = req.headers["x-auth-token"] as string | undefined;
  const raw = tokenHeader || authHeader?.replace(/^Bearer\s+/i, "");
  /* Collect all refresh tokens across every source (body + rider cookie +
     vendor cookie) and revoke each unique one. This ensures logout is total
     regardless of which app context or cookie the client carried. */
  const logoutCookies = (req.cookies && typeof req.cookies === "object")
    ? (req.cookies as Record<string, string>)
    : {};
  const bodyRefresh: string | undefined = req.body?.refreshToken;
  const tokensToRevoke = new Set<string>(
    [bodyRefresh,
     logoutCookies[RIDER_REFRESH_COOKIE],
     logoutCookies[VENDOR_REFRESH_COOKIE]]
      .filter((t): t is string => typeof t === "string" && t.length >= 10)
  );
  const ip = getClientIp(req);

  if (raw) {
    const payload = verifyUserJwt(raw);
    if (payload) {
      /* Blacklist this specific jti in Redis so the token is immediately revoked
         even before tokenVersion takes effect (covers Redis-connected deployments). */
      if (payload.jti && payload.exp) {
        await blacklistJti(payload.jti, payload.exp).catch((err: unknown) => {
          logger.warn({ message: "[auth] blacklistJti on logout failed — token may not be immediately revoked in Redis", error: err instanceof Error ? err.message : String(err), code: "AUTH_BLACKLIST_JTI_FAILED", correlationId: null, timestamp: new Date().toISOString(), jti: payload.jti }, "[auth] blacklistJti on logout failed — token may not be immediately revoked in Redis");
        });
      }
      /* Increment tokenVersion to immediately invalidate ALL outstanding access JWTs for this user */
      await db.update(usersTable)
        .set({ otpCode: null, tokenVersion: sql`token_version + 1` })
        .where(eq(usersTable.id, payload.userId));
      /* Clear GPS spoof hit counter so next login starts with a clean session */
      clearSpoofHits(payload.userId);
      AuditService.log({ action: "user_logout", ip, details: `User logout: ${payload.userId}`, result: "success" });
      writeAuthAuditLog("logout", { userId: payload.userId, ip, userAgent: req.headers["user-agent"] ?? undefined });
    }
  }

  /* Revoke all unique refresh tokens found across body + both app cookies */
  for (const tok of tokensToRevoke) {
    await revokeRefreshToken(hashRefreshToken(tok)).catch((err: unknown) => {
      logger.warn({ message: "[auth] revokeRefreshToken on logout failed — token may remain active", error: err instanceof Error ? err.message : String(err), code: "AUTH_REVOKE_TOKEN_FAILED", correlationId: null, timestamp: new Date().toISOString() }, "[auth] revokeRefreshToken on logout failed — token may remain active");
    });
  }
  if (tokensToRevoke.size > 0) writeAuthAuditLog("token_revoked", { ip });

  /* Always clear both rider and vendor cookies on logout, even if the request
     did not carry them — defends against stale cookies after role/app switches. */
  clearRiderRefreshCookie(res);
  clearVendorRefreshCookie(res);

  sendSuccess(res, undefined, "Logged out successfully");
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/check-available
   Check if phone, email, or username is already taken.
   Body: { phone?, email?, username? }
   Returns: { phone: {available,taken}, email: {...}, username: {...} }
══════════════════════════════════════════════════════════════ */

router.get("/login-history", async (req, res) => {
  try {
  const auth = extractAuthUser(req);
  if (!auth) { sendUnauthorized(res, "Authentication required"); return; }

  const history = await db.select().from(loginHistoryTable)
    .where(eq(loginHistoryTable.userId, auth.userId))
    .orderBy(desc(loginHistoryTable.createdAt))
    .limit(20);

  sendSuccess(res, {
    history: history.map(h => ({
      id: h.id,
      ip: h.ip,
      deviceName: h.deviceName,
      browser: h.browser,
      os: h.os,
      location: h.location,
      success: h.success,
      method: h.method,
      createdAt: h.createdAt.toISOString(),
    })),
  });
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /auth/sessions
   List active sessions for the authenticated user.
══════════════════════════════════════════════════════════════ */

router.get("/sessions", async (req, res) => {
  try {
  const auth = extractAuthUser(req);
  if (!auth) { sendUnauthorized(res, "Authentication required"); return; }

  const sessions = await db
    .select()
    .from(userSessionsTable)
    .where(and(eq(userSessionsTable.userId, auth.userId), sql`revoked_at IS NULL`))
    .orderBy(desc(userSessionsTable.lastActiveAt));

  sendSuccess(res, {
    sessions: sessions.map(s => ({
      id: s.id,
      deviceName: s.deviceName,
      browser: s.browser,
      os: s.os,
      ip: s.ip,
      location: s.location,
      lastActiveAt: s.lastActiveAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
    })),
  });
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* ══════════════════════════════════════════════════════════════
   DELETE /auth/sessions/:id
   Revoke a single session (remote logout from one device).
══════════════════════════════════════════════════════════════ */

router.delete("/sessions", async (req, res) => {
  try {
  const auth = extractAuthUser(req);
  if (!auth) { sendUnauthorized(res, "Authentication required"); return; }

  await db
    .update(userSessionsTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(userSessionsTable.userId, auth.userId), sql`revoked_at IS NULL`));

  await revokeAllUserRefreshTokens(auth.userId);

  /* Bump tokenVersion so all outstanding access JWTs are immediately invalid */
  await db
    .update(usersTable)
    .set({ tokenVersion: sql`token_version + 1`, updatedAt: new Date() })
    .where(eq(usersTable.id, auth.userId));

  writeAuthAuditLog("all_sessions_revoked", { userId: auth.userId, ip: getClientIp(req) });
  sendSuccess(res, undefined, "All sessions revoked");
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/link-google
   Link a Google account to the currently authenticated user.
   Body: { idToken: string }   (Google idToken from client)
══════════════════════════════════════════════════════════════ */

export default router;
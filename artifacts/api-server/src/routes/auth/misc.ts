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
  extractAuthUser,
} from "./helpers.js";

const router: IRouter = Router();

router.delete("/sessions/:id", async (req, res) => {
  try {
  const auth = extractAuthUser(req);
  if (!auth) { sendUnauthorized(res, "Authentication required"); return; }

  const { id } = req.params;
  const [session] = await db
    .select()
    .from(userSessionsTable)
    .where(and(eq(userSessionsTable.id, id!), eq(userSessionsTable.userId, auth.userId)))
    .limit(1);

  if (!session) { sendNotFound(res, "Session not found"); return; }

  await db
    .update(userSessionsTable)
    .set({ revokedAt: new Date() })
    .where(eq(userSessionsTable.id, id!));

  /* Also revoke the linked refresh token if present */
  if (session.refreshTokenId) {
    await db
      .update(refreshTokensTable)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokensTable.id, session.refreshTokenId));
  }

  writeAuthAuditLog("session_revoked", { userId: auth.userId, ip: getClientIp(req), metadata: { sessionId: id } });
  sendSuccess(res, undefined, "Session revoked");
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /auth/sessions/revoke
   Revoke a specific session by ID, or revoke all except current.
   Body: { sessionId: string } | { revokeAllExceptCurrent: true }
══════════════════════════════════════════════════════════════ */

const RevokeSessionSchema = z.union([
  z.object({ sessionId: z.string().min(1) }).strict(),
  z.object({ revokeAllExceptCurrent: z.literal(true) }).strict(),
]);

router.post("/sessions/revoke", async (req, res) => {
  try {
    const auth = extractAuthUser(req);
    if (!auth) { sendUnauthorized(res, "Authentication required"); return; }

    const parse = RevokeSessionSchema.safeParse(req.body);
    if (!parse.success) { sendError(res, "Invalid body: provide sessionId or revokeAllExceptCurrent", 400); return; }

    const body = parse.data;
    const ip = getClientIp(req);

    if ("revokeAllExceptCurrent" in body) {
      /* Revoke every non-current session for this user */
      const userSessions = await db
        .select()
        .from(userSessionsTable)
        .where(and(eq(userSessionsTable.userId, auth.userId), isNull(userSessionsTable.revokedAt)))
        .orderBy(desc(userSessionsTable.lastActiveAt));

      if (userSessions.length === 0) {
        /* Fallback: if user_sessions table is empty (legacy login path didn't
           insert rows), bump tokenVersion to invalidate all outstanding JWTs. */
        await db.update(usersTable)
          .set({ tokenVersion: sql`token_version + 1`, updatedAt: new Date() })
          .where(eq(usersTable.id, auth.userId));
        await revokeAllUserRefreshTokens(auth.userId);
        writeAuthAuditLog("all_sessions_revoked", { userId: auth.userId, ip, metadata: { fallback: "tokenVersion_bump" } });
        sendSuccess(res, undefined, "All other sessions invalidated");
        return;
      }

      const currentSession = userSessions[0]!;
      const toRevoke = userSessions.slice(1);

      for (const s of toRevoke) {
        await db.update(userSessionsTable).set({ revokedAt: new Date() }).where(eq(userSessionsTable.id, s.id));
        if (s.refreshTokenId) {
          await db.update(refreshTokensTable).set({ revokedAt: new Date() }).where(eq(refreshTokensTable.id, s.refreshTokenId));
        }
      }

      writeAuthAuditLog("sessions_revoked_except_current", {
        userId: auth.userId,
        ip,
        metadata: { keptSessionId: currentSession.id, revokedCount: toRevoke.length },
      });
      sendSuccess(res, undefined, `${toRevoke.length} other session(s) revoked`);
      return;
    }

    /* Revoke a specific session */
    const { sessionId } = body;
    const [session] = await db
      .select()
      .from(userSessionsTable)
      .where(and(eq(userSessionsTable.id, sessionId), eq(userSessionsTable.userId, auth.userId)))
      .limit(1);

    if (!session) { sendNotFound(res, "Session not found or not owned by you"); return; }

    await db.update(userSessionsTable).set({ revokedAt: new Date() }).where(eq(userSessionsTable.id, sessionId));
    if (session.refreshTokenId) {
      await db.update(refreshTokensTable).set({ revokedAt: new Date() }).where(eq(refreshTokensTable.id, session.refreshTokenId));
    }

    writeAuthAuditLog("session_revoked", { userId: auth.userId, ip, metadata: { sessionId } });
    sendSuccess(res, undefined, "Session revoked");
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, '[route] unhandled error');
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export default router;
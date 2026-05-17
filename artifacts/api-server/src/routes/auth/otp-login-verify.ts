/**
 * POST /auth/login/verify-otp
 * Second-step OTP verification for the password-then-OTP login flow.
 * Extracted from otp.ts to keep individual auth files under 1000 lines.
 */
import type { Request, Response } from "express";
import { db } from "@workspace/db";
import { usersTable, refreshTokensTable } from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { generateId } from "../../lib/id.js";
import {
  checkLockout, recordFailedAttempt, resetAttempts,
  getCachedSettings, signAccessToken, sign2faChallengeToken,
  verify2faChallengeToken, generateRefreshToken,
  getRefreshTokenTtlDays, getAccessTokenTtlSec,
  getClientIp, writeAuthAuditLog,
} from "../../middleware/security.js";
import { isAuthMethodEnabled } from "@workspace/auth-utils/server";
import { logger } from "../../lib/logger.js";
import {
  sendError, sendUnauthorized, sendForbidden, sendNotFound,
  sendSuccess, sendTooManyRequests, sendErrorWithData,
} from "../../lib/response.js";
import {
  hashOtp, decryptPii, setRiderRefreshCookie, setVendorRefreshCookie,
  isDeviceTrusted,
} from "./helpers.js";

export async function handleLoginVerifyOtp(req: Request, res: Response): Promise<void> {
  try {
    const { tempToken, otp } = req.body ?? {};
    if (!tempToken || !otp) {
      sendError(res, "tempToken and otp are required", 400); return;
    }

    const payload = verify2faChallengeToken(tempToken);
    if (!payload || payload.authMethod !== "password_otp") {
      sendUnauthorized(res, "Invalid or expired OTP challenge token. Please log in again."); return;
    }

    const ip       = getClientIp(req);
    const settings = await getCachedSettings();

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId)).limit(1);
    if (!user)        { sendNotFound(res, "User not found"); return; }
    if (user.isBanned){ sendForbidden(res, "Account suspended. Contact support."); return; }

    const lockoutEnabled = (settings["security_lockout_enabled"] ?? "on") === "on";
    const maxAttempts    = parseInt(settings["security_login_max_attempts"] ?? "5",  10);
    const lockoutMinutes = parseInt(settings["security_lockout_minutes"]    ?? "30", 10);
    const lockoutKey     = `uid:${user.id}`;
    if (lockoutEnabled) {
      const lockout = await checkLockout(lockoutKey, maxAttempts, lockoutMinutes);
      if (lockout.locked) {
        sendTooManyRequests(res, `Account locked. Try again in ${lockout.minutesLeft} minute(s).`); return;
      }
    }

    const now  = new Date();
    const rows = await db
      .update(usersTable)
      .set({ otpCode: null, otpExpiry: null, otpUsed: true, lastLoginAt: now, updatedAt: now })
      .where(and(
        eq(usersTable.id,      user.id),
        eq(usersTable.otpCode, hashOtp(otp)),
        eq(usersTable.otpUsed, false),
        sql`otp_expiry > now()`,
      ))
      .returning({ id: usersTable.id });

    if (rows.length === 0) {
      const updated = await recordFailedAttempt(lockoutKey, maxAttempts, lockoutMinutes);
      writeAuthAuditLog("otp_failed", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { method: "password_login_otp" } });
      if (lockoutEnabled && updated.locked) {
        sendTooManyRequests(res, `Too many failed attempts. Account locked for ${lockoutMinutes} minutes.`);
      } else if (lockoutEnabled) {
        const remaining = Math.max(0, maxAttempts - updated.attempts);
        sendErrorWithData(res, `Invalid or expired OTP. ${remaining} attempt(s) remaining.`, { attemptsRemaining: remaining }, 401);
      } else {
        sendUnauthorized(res, "Invalid or expired OTP.");
      }
      return;
    }

    await resetAttempts(lockoutKey);
    writeAuthAuditLog("otp_verified", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { method: "password_login_otp" } });

    if (user.totpEnabled && isAuthMethodEnabled(settings, "auth_2fa_enabled", user.roles ?? undefined)) {
      const deviceFingerprint = req.body.deviceFingerprint ?? "";
      const trustedDays = parseInt(settings["auth_trusted_device_days"] ?? "30", 10);
      if (!isDeviceTrusted(user, deviceFingerprint, trustedDays)) {
        const totpToken = sign2faChallengeToken(user.id, user.phone ?? "", user.roles ?? "customer", user.roles ?? "customer", "password");
        sendSuccess(res, { requires2FA: true, tempToken: totpToken, userId: user.id }); return;
      }
    }

    const accessToken  = signAccessToken(user.id, user.phone ?? "", user.roles ?? "customer", user.roles ?? "customer", user.tokenVersion ?? 0);
    const expiresAt    = new Date(Date.now() + getAccessTokenTtlSec() * 1000).toISOString();
    const { raw: refreshRaw, hash: refreshHash } = generateRefreshToken();
    await db.insert(refreshTokensTable).values({
      id: generateId(), userId: user.id, tokenHash: refreshHash, authMethod: "password_otp",
      expiresAt: new Date(Date.now() + getRefreshTokenTtlDays() * 24 * 60 * 60 * 1000),
    });

    setRiderRefreshCookie(req, res, refreshRaw, user);
    setVendorRefreshCookie(req, res, refreshRaw, user);

    writeAuthAuditLog("login_success", { userId: user.id, ip, userAgent: req.headers["user-agent"] ?? undefined, metadata: { method: "password_otp_verified" } });

    sendSuccess(res, {
      token:        accessToken,
      refreshToken: refreshRaw,
      expiresAt,
      sessionDays:  getRefreshTokenTtlDays(),
      user: {
        id:           user.id,
        phone:        decryptPii(user.encryptedPhone, user.phone),
        name:         user.name,
        email:        decryptPii(user.encryptedEmail, user.email),
        username:     user.username,
        role:         user.roles,
        roles:        user.roles,
        walletBalance: parseFloat(user.walletBalance ?? "0"),
      },
    });
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }, "[route] login-verify-otp unhandled error");
    res.status(500).json({ success: false, error: "Internal server error" });
  }
}

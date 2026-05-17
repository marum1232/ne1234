/**
 * POST /auth/sessions/revoke
 *
 * Revoke a specific session by ID, or revoke all sessions except the current one.
 * Requires: Authorization: Bearer <accessToken>
 *
 * Body variants:
 *   { sessionId: string }              – revoke one session (must belong to the caller)
 *   { revokeAllExceptCurrent: true }   – revoke every other active session
 *
 * Returns: { revokedCount: number }
 *
 * Session token blacklisting strategy:
 *   - The session table stores tokenHash = sha256(accessToken), not the raw JTI.
 *   - When revoking a session, we store session:bl:<tokenHash> in Redis (TTL = access token TTL).
 *   - The verifyUserJwt middleware checks this key via isSessionHashBlacklisted so revoked
 *     access tokens are rejected immediately, even before expiry.
 *   - For the current session's own access token, we additionally blacklist its JTI directly.
 */

import { Router, type IRouter } from "express";
import { z } from "zod";
import crypto from "crypto";
import { db } from "@workspace/db";
import { refreshTokensTable, userSessionsTable } from "@workspace/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import {
  getClientIp,
  blacklistJti,
  blacklistSessionHash,
  writeAuthAuditLog,
  verifyUserJwt,
} from "../../middleware/security.js";
import {
  sendError,
  sendUnauthorized,
  sendNotFound,
  sendSuccess,
} from "../../lib/response.js";
import { logger } from "../../lib/logger.js";
import { AuditService } from "../../services/admin-audit.service.js";

const router: IRouter = Router();

const RevokeSessionSchema = z.union([
  z.object({ sessionId: z.string().min(1) }).strict(),
  z.object({ revokeAllExceptCurrent: z.literal(true) }).strict(),
]);

/**
 * @openapi
 * /auth/sessions/revoke:
 *   post:
 *     tags: [Auth - Sessions]
 *     summary: Revoke a session or all other sessions
 *     description: |
 *       Revoke a specific session by ID, or revoke all sessions except the current one.
 *       Revoking a session sets revokedAt, invalidates the linked refresh token, and
 *       immediately blacklists the session's access token in Redis so it cannot be reused.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - type: object
 *                 required: [sessionId]
 *                 properties:
 *                   sessionId:
 *                     type: string
 *                     description: ID of the session to revoke
 *               - type: object
 *                 required: [revokeAllExceptCurrent]
 *                 properties:
 *                   revokeAllExceptCurrent:
 *                     type: boolean
 *                     enum: [true]
 *                     description: Revoke all sessions except the current one
 *     responses:
 *       200:
 *         description: Session(s) revoked successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     revokedCount: { type: integer, example: 2 }
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 *       401:
 *         description: Authentication required or token invalid
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 *       404:
 *         description: Session not found or not owned by caller
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 */
router.post("/sessions/revoke", async (req, res) => {
  try {
    /* ── Authenticate via Bearer token ── */
    const authHeader = req.headers["authorization"] as string | undefined;
    const rawToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!rawToken) { sendUnauthorized(res, "Authentication required"); return; }

    const payload = verifyUserJwt(rawToken);
    if (!payload) { sendUnauthorized(res, "Invalid or expired token"); return; }

    const { userId } = payload;
    const ip = getClientIp(req);

    /* ── Validate body ── */
    const parse = RevokeSessionSchema.safeParse(req.body);
    if (!parse.success) {
      sendError(res, "Invalid body: provide sessionId or revokeAllExceptCurrent:true", 400);
      return;
    }

    const body = parse.data;

    /* ── Identify the current session by hashing the incoming access token ── */
    const currentTokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    /* ──────────────────────────────────────────────────────────────────────
       REVOKE ALL EXCEPT CURRENT
       Strategy:
       - Keep the current session (matched by tokenHash) fully intact.
       - Mark all other active sessions as revoked and invalidate their
         refresh tokens so no new access tokens can be issued from them.
       - Blacklist each revoked session's tokenHash in Redis so outstanding
         access tokens for those sessions are rejected immediately.
       - Current session's tokenVersion / JTI are untouched so the caller
         continues working without needing to re-authenticate.
    ────────────────────────────────────────────────────────────────────── */
    if ("revokeAllExceptCurrent" in body) {
      const activeSessions = await db
        .select()
        .from(userSessionsTable)
        .where(and(eq(userSessionsTable.userId, userId), isNull(userSessionsTable.revokedAt)));

      const otherSessions = activeSessions.filter(s => s.tokenHash !== currentTokenHash);

      if (otherSessions.length === 0) {
        sendSuccess(res, { revokedCount: 0 }, "No other sessions to revoke");
        return;
      }

      const now = new Date();

      for (const session of otherSessions) {
        /* Mark session row as revoked */
        await db
          .update(userSessionsTable)
          .set({ revokedAt: now })
          .where(eq(userSessionsTable.id, session.id));

        /* Revoke linked refresh token so no new access tokens can be issued */
        if (session.refreshTokenId) {
          await db
            .update(refreshTokensTable)
            .set({ revokedAt: now, revokedReason: "SESSION_REVOKED_BY_USER" })
            .where(eq(refreshTokensTable.id, session.refreshTokenId));
        }

        /* Blacklist the session's token hash in Redis so its outstanding access
           token is immediately rejected (expires with access token TTL) */
        await blacklistSessionHash(session.tokenHash).catch((err: unknown) => {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err), sessionId: session.id },
            "[sessions] blacklistSessionHash for other session — non-fatal",
          );
        });
      }

      writeAuthAuditLog("sessions_revoked_except_current", {
        userId,
        ip,
        metadata: {
          revokedCount: otherSessions.length,
          currentTokenHashPrefix: currentTokenHash.slice(0, 8),
        },
      });
      AuditService.log({
        action: "sessions_revoked_except_current",
        ip,
        result: "success",
        affectedUserId: userId,
        details: `${otherSessions.length} session(s) revoked`,
      });

      sendSuccess(res, { revokedCount: otherSessions.length }, `${otherSessions.length} other session(s) revoked`);
      return;
    }

    /* ──────────────────────────────────────────────────────────────────────
       REVOKE SINGLE SESSION
    ────────────────────────────────────────────────────────────────────── */
    const { sessionId } = body;

    const [session] = await db
      .select()
      .from(userSessionsTable)
      .where(and(eq(userSessionsTable.id, sessionId), eq(userSessionsTable.userId, userId)))
      .limit(1);

    if (!session) {
      sendNotFound(res, "Session not found or not owned by you");
      return;
    }

    if (session.revokedAt) {
      /* Already revoked — idempotent success */
      sendSuccess(res, { revokedCount: 0 }, "Session was already revoked");
      return;
    }

    const now = new Date();
    await db
      .update(userSessionsTable)
      .set({ revokedAt: now })
      .where(eq(userSessionsTable.id, sessionId));

    if (session.refreshTokenId) {
      await db
        .update(refreshTokensTable)
        .set({ revokedAt: now, revokedReason: "SESSION_REVOKED_BY_USER" })
        .where(eq(refreshTokensTable.id, session.refreshTokenId));
    }

    /* Blacklist the session's access token via its tokenHash (sha256 of access token).
       This ensures the revoked session's token is rejected immediately on any subsequent
       request, regardless of whether it's the current session or another device. */
    await blacklistSessionHash(session.tokenHash).catch((err: unknown) => {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), sessionId },
        "[sessions] blacklistSessionHash — non-fatal",
      );
    });

    /* If the caller is revoking their own current session, also blacklist the JTI
       directly for belt-and-suspenders revocation (JTI blacklist + session hash blacklist). */
    if (session.tokenHash === currentTokenHash && payload.jti && payload.exp) {
      await blacklistJti(payload.jti, payload.exp).catch((err: unknown) => {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), jti: payload.jti },
          "[sessions] blacklistJti on self-revoke — non-fatal",
        );
      });
    }

    writeAuthAuditLog("session_revoked", {
      userId,
      ip,
      metadata: { sessionId, isSelf: session.tokenHash === currentTokenHash },
    });
    AuditService.log({
      action: "session_revoked",
      ip,
      result: "success",
      affectedUserId: userId,
      details: `Session ${sessionId} revoked${session.tokenHash === currentTokenHash ? " (self)" : ""}`,
    });

    sendSuccess(res, { revokedCount: 1 }, "Session revoked");
  } catch (err) {
    logger.error(
      { error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() },
      "[sessions] unhandled error",
    );
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export default router;
